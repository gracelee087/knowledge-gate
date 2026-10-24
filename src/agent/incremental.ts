// Incremental processing: add one new lecture to the map without re-running the batch agents.
//   1. card: the checked card (made by src/cli/cards.ts if it does not exist yet)
//   2. concepts: each mention is embedded (bge-m3) and Atlas vector search finds the 6 closest old mentions;
//      the model decides, from context, whether it is one of those concepts or a new one.
//      Code keeps an answer only if it names one of the candidates (else the mention stays new; a lesson is recorded).
//   3. category: the model puts the lecture in one existing category; code checks the category rules.
//      If a rule breaks, the categories are designed again (src/agent/categories.ts).
//   4. Atlas, data/concepts.json, data/categories.json and the map are updated, and the data is pushed to Atlas
//      for the laptop (src/cli/sync.ts).
// Usage: npx tsx src/agent/incremental.ts <videoId> [--test] [--dup-only]
//   --test: Atlas is updated (the next test lecture needs it) but data/ and map/ are not; the decisions are
//   compared with the batch run and written to data/incremental_test.json.
import '../lib/env.ts';
import * as Sentry from '@sentry/node';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { chatRetry } from '../lib/llm.ts';
import { embed } from '../lib/embed.ts';
import { db, closeDb } from '../lib/db.ts';
import { recordLesson } from '../lib/lessons.ts';
import { RULES } from './categories.ts';
import { adoptedRules, rulesBlock } from '../lib/rules.ts';

Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 1.0 });
const MODEL = 'do/gemma-4-31B-it', EMBED = 'do/bge-m3';
const videoId = process.argv[2];
const test = process.argv.includes('--test');
const data = (p: string) => new URL(`../../data/${p}`, import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(data(p), 'utf8'));
const run = (script: string, ...args: string[]) => execFileSync('npx', ['tsx', script, ...args], { stdio: 'inherit', shell: true, cwd: new URL('../../', import.meta.url) });

// A model call whose answer must parse; a cut-off answer (seen once in the first test) is asked again.
async function ask<T extends z.ZodType>(schema: T, system: string, user: string, tries = 3) {
  for (let i = 1; ; i++) {
    const res = await chatRetry(MODEL, system, user, z.toJSONSchema(schema));
    try { return { data: schema.parse(JSON.parse(res.text)) as z.infer<T>, inputTokens: res.inputTokens, outputTokens: res.outputTokens }; }
    catch (e) { if (i >= tries) throw e; console.log(`  answer did not parse (${(e as Error).message.slice(0, 60)}), asking again`); }
  }
}

// 1. Card.
if (!existsSync(data(`cards/${videoId}.json`))) run('src/cli/cards.ts', MODEL, '9999', videoId);
if (!existsSync(data(`cards/${videoId}.json`))) { console.log(`${videoId}: no card (see cards.ts output)`); process.exit(1); }
const c = read(`cards/${videoId}.json`);
const d = await db();
const mentions = d.collection('mentions'), lectures = d.collection('lectures');

// 1b. Same talk twice? TechBridge-KR re-uploads English talks with subtitles, so a talk can arrive from two
// channels. Only lectures that share a speaker are compared; the model decides from titles and summaries.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const speakers = new Set(c.card.speakers.map((s: any) => norm(s.name)).filter((n: string) => n.length > 3));
const others = readdirSync(data('cards/')).filter(f => f.endsWith('.json') && f !== `${videoId}.json`).map(f => read(`cards/${f}`))
  .filter(o => o.card.speakers.some((s: any) => speakers.has(norm(s.name))));
if (others.length) {
  const Dup = z.object({ same_as: z.string().describe('the id of the lecture that is the same talk, or empty'), reason: z.string() });
  const r0 = await ask(Dup, `You check whether a new lecture is the same talk as one already in a knowledge map (for example the original and a re-upload with subtitles). Same talk means the same speaker giving the same presentation, not only the same topic. English only. Answer with JSON matching the schema.`,
    `New: id="${videoId}" "${c.card.title}" by ${c.card.speakers.map((s: any) => s.name).join(', ')}: ${c.card.one_line}

Already in the map:
${others.map(o => `- id="${o.videoId}" "${o.card.title}" by ${o.card.speakers.map((s: any) => s.name).join(', ')}: ${o.card.one_line}`).join('\n')}`);
  const dup = others.find(o => o.videoId === r0.data.same_as.trim());
  if (dup) {
    console.log(`${videoId}: same talk as ${dup.videoId} (${r0.data.reason}); not added to the map`);
    if (!test) {
      mkdirSync(data('cards_duplicates/'), { recursive: true });
      renameSync(data(`cards/${videoId}.json`), data(`cards_duplicates/${videoId}.json`));
      writeFileSync(data(`cards/${videoId}.skipped.txt`), `same talk as ${dup.videoId}`); // the watchdog will not start it again
    }
    process.exit(0);
  }
}
if (process.argv.includes('--dup-only')) { console.log(`${videoId}: not a duplicate (${others.length} lectures share a speaker)`); process.exit(0); } // for tests

// 2. Concepts.
const mine: { name: string; what: string; claims: string[] }[] = c.card.concepts.map((k: any) => ({ name: k.name, what: k.what, claims: k.claim_ids.map((i: number) => c.card.claims[i]?.claim).filter(Boolean) }));
const vectors = await embed(EMBED, mine.map((m: any) => `${m.name}: ${m.what}`));
const candidates: { name: string; what: string; concept: string; title: string; score: number }[][] = [];
for (const v of vectors) candidates.push(await mentions.aggregate<any>([
  { $vectorSearch: { index: 'vec', path: 'vector', queryVector: v, numCandidates: 100, limit: 6, filter: { videoId: { $ne: videoId } } } },
  { $project: { _id: 0, name: 1, what: 1, concept: 1, title: 1, score: { $meta: 'vectorSearchScore' } } },
]).toArray());

const Decisions = z.object({ decisions: z.array(z.object({
  mention: z.number().int(),
  same_as: z.string().describe('the concept name of the candidate it is the same idea as, copied exactly; empty if it is a new concept'),
  reason: z.string(),
})) });
const SYSTEM = `You maintain the glossary of a knowledge map built from many lectures. A new lecture arrived.
For each of its concept mentions you get the closest concepts already in the map, found by meaning.
Decide if the mention is the same idea as one of them.
- Same idea only when the context shows they mean the same thing. Similar words or a shared topic are not enough.
- If it is the same, copy that candidate's concept name exactly into "same_as". Otherwise leave "same_as" empty: it is a new concept.
- Decide every mention once. English only. Answer with JSON matching the schema.` + rulesBlock(await adoptedRules('concepts'));
const prompt = mine.map((m: any, i: number) => [
  `Mention ${i}: "${m.name}" in "${c.card.title}": ${m.what}`,
  ...[...new Map(candidates[i].map(x => [x.concept, x])).values()].map(x => `  - concept "${x.concept}" (called "${x.name}" in "${x.title}"): ${x.what}`),
].join('\n')).join('\n\n');
const r = await ask(Decisions, SYSTEM, prompt);
const dec = r.data.decisions;
const first = mine.map((m: any, i: number) => {
  const x = dec.find(y => y.mention === i);
  const same = x?.same_as.trim() ?? '';
  const ok = !same || candidates[i].some(k => k.concept === same);
  if (!ok) recordLesson('incremental', 'concept answer named no candidate', { videoId, mention: m.name, answer: same });
  return { i, same: ok ? same : '', reason: ok ? x?.reason ?? '' : '' };
});
// A second, strict call checks every join, as the batch concept agent does (a first test joined "Outcome",
// a rubric check, to "Goal", a long-running objective).
const Checks = z.object({ checks: z.array(z.object({ mention: z.number().int(), keep: z.boolean(), reason: z.string() })) });
const joins = first.filter(f => f.same);
let rk = { inputTokens: 0, outputTokens: 0 };
const kept = new Set<number>();
if (joins.length) {
  const what = (concept: string, i: number) => candidates[i].find(k => k.concept === concept)!.what;
  const res = await ask(Checks, `You check glossary decisions for a knowledge map. Each item says a new lecture's concept mention is the same idea as an existing concept.
Keep it only if both descriptions mean the same thing, so that one page could describe both without being wrong about either. A related idea, a part of it, or a broader idea is not the same: say keep false.
English only. Answer with JSON matching the schema.`,
    joins.map(f => `Mention ${f.i}: "${mine[f.i].name}": ${mine[f.i].what}\n  joined to "${f.same}": ${what(f.same, f.i)}`).join('\n\n'));
  rk = res;
  for (const ch of res.data.checks) if (ch.keep) kept.add(ch.mention);
  // A join the checker undid is the same mistake the batch concept agent records, so it feeds the same verifier.
  for (const f of joins.filter(f => !kept.has(f.i))) recordLesson('concepts', 'checker dropped mentions from a group',
    { concept: f.same, dropped: [`${mine[f.i].name} @ ${videoId}`], reason: res.data.checks.find(ch => ch.mention === f.i)?.reason ?? 'no verdict' });
}
const decided = mine.map((m: any, i: number) => {
  const f = first[i], joined = Boolean(f.same) && kept.has(i);
  return { ...m, joined, concept: joined ? f.same : m.name, reason: joined ? f.reason : '', dropped: f.same && !joined ? f.same : '',
    top: candidates[i][0] ? `${candidates[i][0].concept} (${candidates[i][0].score.toFixed(3)})` : '' };
});

// 3. Category.
const cats = read('categories.json');
const names = cats.categories.map((k: any) => k.name);
const Cat = z.object({ category: z.enum(names), reason: z.string() });
const rc = await ask(Cat, `You file a new lecture into one category of a knowledge map. Pick the category whose definition fits the lecture best. English only. Answer with JSON matching the schema.`,
  `Categories:\n${cats.categories.map((k: any) => `- ${k.name}: ${k.definition}`).join('\n')}\n\nLecture: "${c.card.title}": ${c.card.one_line}\nConcepts: ${decided.map((m: any) => m.concept).join(', ')}`);
const category = rc.data.category;
const sizes = { ...cats.sizes } as Record<string, number>;
const before = cats.assignments.find((a: any) => a.videoId === videoId)?.category;
if (before) sizes[before]--;
sizes[category] = (sizes[category] ?? 0) + 1;
const total = Object.values(sizes).reduce((a, b) => a + b, 0);
const broken = Object.entries(sizes).filter(([, n]) => n > Math.ceil(total * RULES.maxShare)).map(([k, n]) => `${k} has ${n} of ${total}`);

// 4. Store.
await mentions.deleteMany({ videoId });
await mentions.insertMany(decided.map((m: any, i: number) => ({ videoId, title: c.card.title, name: m.name, what: m.what, concept: m.concept, vector: vectors[i] })));
await lectures.replaceOne({ videoId }, { videoId, title: c.card.title, one_line: c.card.one_line, category }, { upsert: true });
// The evidence for every decision: the 6 candidates vector search found with their scores, the model's first
// answer, and what the checker kept. Without this only the summary line survives a run.
await d.collection('decisions').replaceOne({ videoId }, {
  videoId, title: c.card.title, at: new Date().toISOString(), test, model: MODEL, embedModel: EMBED, category, categoryReason: rc.data.reason, broken,
  mentions: decided.map((m: any, i: number) => ({
    name: m.name, what: m.what, concept: m.concept, joined: m.joined, firstAnswer: first[i].same, reason: first[i].reason, checkerUndid: m.dropped,
    candidates: candidates[i].map(k => ({ concept: k.concept, name: k.name, title: k.title, score: +k.score.toFixed(4) })),
  })),
}, { upsert: true });
await closeDb();
console.log(`${videoId}: ${decided.filter((m: any) => m.joined).length}/${decided.length} mentions joined existing concepts; category ${category}${broken.length ? `; RULE BROKEN: ${broken.join(', ')}` : ''}`);
for (const m of decided) console.log(`  ${m.name} -> ${m.concept}${m.joined ? '' : ' (new)'}${m.dropped ? ` (checker undid join to ${m.dropped})` : ''}   nearest: ${m.top}`);

if (test) {
  // Compare with the batch agents, which saw all lectures at once.
  const batch = read('concepts.json').mentions.filter((m: any) => m.videoId === videoId);
  const rows = decided.map((m: any) => {
    const b = batch.find((x: any) => x.name === m.name)?.concept ?? m.name;
    return { name: m.name, incremental: m.concept, batch: b, same: b.toLowerCase() === m.concept.toLowerCase(), dropped: m.dropped, nearest: m.top, reason: m.reason };
  });
  const out = existsSync(data('incremental_test.json')) ? read('incremental_test.json') : [];
  out.push({ videoId, title: c.card.title, at: new Date().toISOString(), category, batchCategory: before, broken, mentions: rows, tokens: [r.inputTokens + rk.inputTokens + rc.inputTokens, r.outputTokens + rk.outputTokens + rc.outputTokens] });
  writeFileSync(data('incremental_test.json'), JSON.stringify(out, null, 1));
  console.log(`  vs batch: concepts ${rows.filter((x: any) => x.same).length}/${rows.length} same; category ${category === before ? 'same' : `batch had ${before}`}`);
} else {
  const cj = read('concepts.json');
  cj.mentions = cj.mentions.filter((m: any) => m.videoId !== videoId);
  for (const m of decided) cj.mentions.push({ id: cj.mentions.length, videoId, title: c.card.title, name: m.name, what: m.what, claims: m.claims, concept: m.concept, reason: m.reason });
  writeFileSync(data('concepts.json'), JSON.stringify(cj, null, 1));
  cats.assignments = cats.assignments.filter((a: any) => a.videoId !== videoId).concat({ videoId, category });
  cats.sizes = sizes;
  writeFileSync(data('categories.json'), JSON.stringify(cats, null, 1));
  if (broken.length) { console.log('category rules broken: designing the categories again'); run('src/agent/categories.ts'); }
  run('src/cli/map.ts');
  run('src/cli/sync.ts', 'push'); // the laptop pulls from Atlas in the morning
}
await Sentry.flush(10000);
