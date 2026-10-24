// Morning merge: bring new lecture claims into the personal notes, on the laptop, with a local model.
// The notes never leave the laptop: the model runs in Ollama, and notes/ is gitignored (it has its own local git).
//   1. find lectures not merged yet (notes/.merged.json)
//   2. each claim goes to at most one note: the note named after one of its concepts, else a note whose text
//      names one, else the note closest in meaning (local embeddinggemma, cosine >= NEAR)
//   3. the local model says, per claim, "known" (the note already says it; it must copy the sentence),
//      "new", or "unrelated" (the closest note is not about it); code checks the copied sentence is really
//      in the note, otherwise the claim counts as new
//   4. new claims are appended under "## From lectures"; nothing above it is changed (code checks this)
//   5. claims no note of the person's takes go to the note of their lecture's section (notes/sections/<section>.md),
//      judged the same way, so a point the section note already has is skipped; notes/00 Morning.md lists what went where
//   6. a claim that corrects or sharpens a sentence the person wrote becomes an edit proposal (notes/.proposals.json);
//      the note changes only when the person approves it on the local page (src/cli/web.ts)
// git commits notes/ before and after, so any merge can be undone.
// Usage: npx tsx src/cli/merge.ts --init          copy notes.sample/ into an empty notes/
//        npx tsx src/cli/merge.ts [--model ollama/gemma4:12b] [--last N]   merge (only the newest N unmerged lectures)
import '../lib/env.ts';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { chatRetry } from '../lib/llm.ts';
import { embed, cosine } from '../lib/embed.ts';

const root = new URL('../../', import.meta.url);
const notesDir = new URL('notes/', root);
const arg = (name: string) => (process.argv.indexOf(name) > 0 ? process.argv[process.argv.indexOf(name) + 1] : null);
const model = arg('--model') ?? 'ollama/gemma4:12b'; // 12b over e4b: E25
// The notes go into the prompt, so only a local model may read them.
if (!model.startsWith('ollama/')) { console.error(`--model ${model}: the merge runs on a local model only (ollama/...); personal notes never leave the laptop`); process.exit(1); }
const git = (...a: string[]) => execFileSync('git', ['-C', fileURLToPath(notesDir), ...a], { encoding: 'utf8' });
const commit = (msg: string) => { git('add', '-A'); if (git('status', '--porcelain').trim()) git('commit', '-q', '-m', msg); };

if (process.argv.includes('--init')) {
  if (existsSync(notesDir) && readdirSync(notesDir).length) { console.log('notes/ is not empty; nothing copied'); process.exit(1); }
  // A plain copy loop: fs.cpSync crashed node on this Windows path (exit 0xC0000409).
  mkdirSync(notesDir, { recursive: true });
  for (const f of readdirSync(new URL('notes.sample/', root))) writeFileSync(new URL(f, notesDir), readFileSync(new URL(`notes.sample/${f}`, root)));
  git('init', '-q'); git('config', 'core.autocrlf', 'false'); commit('sample notes');
  console.log(`notes/: ${readdirSync(notesDir).length} files copied from notes.sample/, git initialised`);
  process.exit(0);
}

const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const videos: any[] = read('data/videos.json');
const mentions: { videoId: string; name: string; concept: string }[] = read('data/concepts.json').mentions;
const cards = readdirSync(new URL('data/cards/', root)).filter(f => f.endsWith('.json')).map(f => read(`data/cards/${f}`));
const order = new Map(videos.map((v, i) => [v.videoId, i]));
cards.sort((a, b) => order.get(a.videoId)! - order.get(b.videoId)!);
const STATE = new URL('.merged.json', notesDir);
const merged: string[] = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : [];
let todo = cards.filter(c => !merged.includes(c.videoId));
if (arg('--last')) todo = todo.slice(-Number(arg('--last')));
if (!todo.length) { console.log('no new lectures to merge'); process.exit(0); }

// Same file names as the map builder.
const file = (name: string) => name.replace(/[\\/:*?"<>|#^[\]]/g, '-').trim();
const sec = (mmss: string) => mmss.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
const groupBy = <T>(xs: T[], key: (x: T) => string) => { const m = new Map<string, T[]>(); for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]); return m; }; // Map.groupBy is not in the ES2022 lib
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const has = (text: string, c: { claim: string }) => norm(text).includes(norm(c.claim)); // the note already holds this claim word for word

// One claim per (lecture, claim index), with the concepts it supports.
type Claim = { videoId: string; title: string; url: string; claim: string; quote: string | null; at: string; concepts: string[] };
const claims: Claim[] = [];
for (const c of todo) {
  const byIndex = new Map<number, string[]>();
  for (const k of c.card.concepts) {
    const m = mentions.find(x => x.videoId === c.videoId && x.name === k.name);
    for (const i of k.claim_ids) byIndex.set(i, [...(byIndex.get(i) ?? []), m?.concept ?? k.name]);
  }
  c.card.claims.forEach((cl: any, i: number) => claims.push({
    videoId: c.videoId, title: c.card.title, url: c.url, claim: cl.claim, at: cl.at,
    quote: c.quotes[i]?.found ? cl.quote : null, // only verified quotes are shown
    concepts: [...new Set(byIndex.get(i) ?? [])],
  }));
}

// Each claim goes to at most one note. A [[link]] alone does not count: a note links related topics it is
// not about (E25 run 1). Words first; then meaning, so "Context Poisoning" can find a Context Engineering note.
const GENERATED = ['README.md', 'Hackathons.md', 'Travel.md', 'Me.md']; // written by other scripts, not by the person
const notes = readdirSync(notesDir).filter(f => f.endsWith('.md') && !f.startsWith('00 ') && !GENERATED.includes(f))
  .map(f => ({ file: f, name: f.replace(/\.md$/, ''), text: readFileSync(new URL(f, notesDir), 'utf8') }));
const own = (note: typeof notes[number]) => note.text.split('\n## From lectures')[0].replace(/\[\[[^\]]*\]\]/g, ' '); // what the person wrote, minus links
const noteFor = (c: Claim) =>
  notes.find(n => c.concepts.some(k => norm(n.name) === norm(k)))
  ?? notes.find(n => c.concepts.some(k => k.length >= 4 && ` ${norm(own(n))} `.includes(` ${norm(k)} `)));
const home = new Map(claims.map(c => [c, noteFor(c)]));
// NEAR: in E26 the top quarter of claims scored >= 0.45 against their closest sample note, and those read as related.
const NEAR = 0.45, EMBED = 'ollama/embeddinggemma';
const unmatched = claims.filter(c => !home.get(c));
if (notes.length && unmatched.length) {
  const nv = await embed(EMBED, notes.map(own)), cv = await embed(EMBED, unmatched.map(c => c.claim));
  unmatched.forEach((c, i) => {
    const s = nv.map(v => cosine(cv[i], v)), j = s.indexOf(Math.max(...s));
    if (s[j] >= NEAR) home.set(c, notes[j]);
  });
}
const byMeaning = unmatched.filter(c => home.get(c)).length;

// The person's open questions: the "- " lines under a "## Open questions" heading in their own part of the note.
const questionsOf = (note: typeof notes[number]) => (own(note).split(/\n## Open questions[^\n]*\n/)[1] ?? '').split('\n## ')[0]
  .split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
const Judged = z.object({ judgments: z.array(z.object({
  claim: z.number().int(),
  verdict: z.enum(['known', 'new', 'update', 'answers', 'unrelated']),
  evidence: z.string().describe('for "known" and "update": the sentence from the note, copied exactly; for "answers": the open question, copied exactly; otherwise empty'),
  revised: z.string().describe('for "update": the note sentence rewritten so it agrees with the claim; otherwise empty'),
})) });
const SYSTEM = `You help a person keep their own notes up to date with lectures they follow.
You get one of their notes and numbered claims from new lectures.
For each claim decide:
- "known": the note already says the same thing (the same point, not only the same topic). Copy the sentence from the note that says it into "evidence", exactly as written.
- "new": the note is about this topic but does not say it yet. Leave "evidence" empty.
- "update": a sentence the person wrote says something this claim corrects, sharpens or makes outdated. Copy that sentence into "evidence" exactly as written, and put the sentence rewritten to agree with the claim into "revised" (same style, one sentence). Use this only when the note really needs to change.
- "answers": the claim answers, fully or in part, one of the questions listed under "Open questions" in the note. Copy that question into "evidence" exactly as written.
- "unrelated": the note is not about this topic at all. Leave "evidence" empty.
Judge every claim once. English only. Answer with JSON matching the schema.`;

commit(`before merge ${new Date().toISOString()}`);
const plan: { note: typeof notes[number]; add: Claim[]; known: { c: Claim; evidence: string }[]; update: { c: Claim; old: string; revised: string }[] }[] = [];
const covered = new Set<Claim>();
const answers = new Map<Claim, string>(); // claim -> the open question it answers
const held: Claim[] = []; // no verdict (broken or cut-off JSON): not written, the lecture stays unmerged and the next run retries
let fixed = 0;
for (const note of notes) {
  const mine = claims.filter(c => home.get(c) === note);
  if (!mine.length) continue;
  const add: Claim[] = [], known: { c: Claim; evidence: string }[] = [], update: { c: Claim; old: string; revised: string }[] = [];
  // A claim the note already has word for word is known without asking the model (the model once let one through twice).
  for (const c of mine.filter(c => has(note.text, c))) { covered.add(c); known.push({ c, evidence: c.claim }); }
  const ask = mine.filter(c => !has(note.text, c));
  for (let s = 0; s < ask.length; s += 12) { // judged 12 claims per call
    const batch = ask.slice(s, s + 12);
    const r = await chatRetry(model, SYSTEM, `Note "${note.name}":\n${note.text}\n\nClaims:\n${batch.map((c, i) => `${i}. ${c.claim}`).join('\n')}`, z.toJSONSchema(Judged));
    let j: ReturnType<typeof Judged.safeParse>;
    try { j = Judged.safeParse(JSON.parse(r.text)); } catch { j = Judged.safeParse(null); } // a cut-off answer: every claim is held
    batch.forEach((c, i) => {
      const v = j.success ? j.data.judgments.find(x => x.claim === i) : undefined;
      if (!v) { held.push(c); return; }
      // "known" stands only if the copied sentence is really in the note.
      if (v.verdict === 'unrelated') return; // stays out of the note, listed under New topics
      covered.add(c);
      if (v?.verdict === 'known' && v.evidence.trim() && norm(note.text).includes(norm(v.evidence))) known.push({ c, evidence: v.evidence.trim() });
      // An edit is only proposed for a sentence the person wrote, copied exactly; the page applies it after approval.
      else if (v?.verdict === 'update' && v.revised.trim() && own(note).includes(v.evidence.trim()) && v.evidence.trim() !== v.revised.trim()) update.push({ c, old: v.evidence.trim(), revised: v.revised.trim() });
      // An answer counts only for a question the person really wrote; otherwise it is added as a plain new point.
      else if (v?.verdict === 'answers' && questionsOf(note).includes(v.evidence.trim())) { answers.set(c, v.evidence.trim()); add.push(c); }
      else { if (v?.verdict === 'known') fixed++; add.push(c); }
    });
    console.log(`${note.name}: claims ${s + 1}-${s + batch.length} judged in ${(r.ms / 1000).toFixed(0)} s`);
  }
  plan.push({ note, add, known, update });
}

// Section notes: what no note of the person's took goes to the note of its lecture's section (the map's categories).
// The merge alone writes these notes, only appending; a point the note already has ("known", sentence checked) is skipped.
const catOf = new Map<string, string>(read('data/categories.json').assignments.map((a: any) => [a.videoId, a.category]));
const sections = [...groupBy(claims.filter(c => !covered.has(c) && !held.includes(c) && catOf.has(c.videoId)), c => catOf.get(c.videoId)!)].map(([cat, cs]) => {
  const f = `sections/${file(cat)}.md`, u = new URL(f, notesDir);
  const text = existsSync(u) ? readFileSync(u, 'utf8') : `# ${cat}\n\nPoints from the lectures in this section, added by the morning merge. Only appended to; a point this note already has is skipped.\n`;
  return { note: { file: f, name: cat, text }, cs };
});
if (sections.length) mkdirSync(new URL('sections/', notesDir), { recursive: true });
for (const { note, cs } of sections) {
  const add: Claim[] = [], known: { c: Claim; evidence: string }[] = [];
  for (const c of cs.filter(c => has(note.text, c))) { covered.add(c); known.push({ c, evidence: c.claim }); }
  const ask = cs.filter(c => !has(note.text, c));
  for (let s = 0; s < ask.length; s += 12) {
    const batch = ask.slice(s, s + 12);
    const r = await chatRetry(model, SYSTEM, `Note "${note.name}":\n${note.text}\n\nClaims:\n${batch.map((c, i) => `${i}. ${c.claim}`).join('\n')}`, z.toJSONSchema(Judged));
    let j: ReturnType<typeof Judged.safeParse>;
    try { j = Judged.safeParse(JSON.parse(r.text)); } catch { j = Judged.safeParse(null); }
    batch.forEach((c, i) => {
      const v = j.success ? j.data.judgments.find(x => x.claim === i) : undefined;
      if (!v) { held.push(c); return; }
      covered.add(c);
      if (v?.verdict === 'known' && v.evidence.trim() && norm(note.text).includes(norm(v.evidence))) known.push({ c, evidence: v.evidence.trim() });
      else { if (v?.verdict === 'known') fixed++; add.push(c); } // the section is the claim's home: "unrelated" and "update" are added too
    });
    console.log(`section ${note.name}: claims ${s + 1}-${s + batch.length} judged in ${(r.ms / 1000).toFixed(0)} s`);
  }
  plan.push({ note, add, known, update: [] });
}

// The person may have edited a note while the model was judging (minutes): then write nothing, the next run merges again.
const edited = [...notes, ...sections.map(s => s.note)].filter(n => existsSync(new URL(n.file, notesDir)) && readFileSync(new URL(n.file, notesDir), 'utf8') !== n.text);
if (edited.length) { console.log(`edited during the merge: ${edited.map(n => n.name).join(', ')}; nothing written, run again`); process.exit(1); }

// A talk links to the second it was said; a text source (blog, paper, newsletter) links to the page.
const cite = (c: Claim) => (/youtube\.com|youtu\.be/.test(c.url) ? `[${c.at}](${c.url}&t=${sec(c.at)}s)` : `[source](${c.url})`);
// Write: append only.
const day =new Date().toLocaleDateString('sv-SE'); // local date: just after midnight here, UTC is still the day before
for (const p of plan.filter(p => p.add.length)) {
  const byLecture = groupBy(p.add, c => c.videoId);
  const block = [
    ...(p.note.text.includes('\n## From lectures') ? [] : ['', '## From lectures', '']),
    ...[...byLecture.values()].flatMap(cs => [
      `### merged ${day} · [${cs[0].title}](${cs[0].url})`,
      ...cs.map(c => `- ${answers.has(c) ? `🔔 answers "${answers.get(c)}": ` : ''}${c.claim}${c.quote ? ` — "${c.quote}"` : ' (quote not verified)'} ${cite(c)}`),
      '',
    ]),
  ].join('\n');
  writeFileSync(new URL(p.note.file, notesDir), p.note.text.replace(/\n*$/, '\n') + block);
}

// Edit proposals wait in notes/.proposals.json; nothing in a note changes until the person approves one on the page.
const PROPOSALS = new URL('.proposals.json', notesDir);
const proposals: any[] = existsSync(PROPOSALS) ? JSON.parse(readFileSync(PROPOSALS, 'utf8')) : [];
const before = proposals.length;
// A lecture with held claims is merged again next run; an edit already proposed is not proposed twice.
for (const p of plan) for (const u of p.update.filter(u => !proposals.some(x => x.note === p.note.name && x.old === u.old && x.claim === u.c.claim))) proposals.push({
  id: `${day}-${proposals.length + 1}`, date: day, note: p.note.name, old: u.old, revised: u.revised,
  claim: u.c.claim, quote: u.c.quote, at: u.c.at, title: u.c.title, link: cite(u.c).replace(/^\[[^\]]*\]\((.*)\)$/, '$1'), status: 'open',
});
writeFileSync(PROPOSALS, JSON.stringify(proposals, null, 1));
const proposed = proposals.length - before;

// Questions asked on the page that the notes could not answer (data/open_questions.json, written by src/lib/ask.ts):
// code lists this run's claims closest in meaning, no model judgment; each claim is shown once per question ("matched").
const QNEAR = 0.55; // as CLAIM_NEAR in src/lib/ask.ts: a claim this close is read out as an answer there
const OPEN = new URL('data/open_questions.json', root);
const maybe: { q: string; c: Claim }[] = [];
if (existsSync(OPEN) && claims.length) {
  const open: { question: string; at: string; matched?: { claim: string; url: string; day: string }[] }[] = JSON.parse(readFileSync(OPEN, 'utf8'));
  if (open.length) {
    const qv = await embed(EMBED, open.map(o => o.question)), cv = await embed(EMBED, claims.map(c => c.claim));
    open.forEach((o, k) => {
      const top = claims.map((c, i) => ({ c, s: cosine(qv[k], cv[i]) })).filter(x => x.s >= QNEAR && !o.matched?.some(m => m.claim === x.c.claim && m.url === x.c.url))
        .sort((a, b) => b.s - a.s).slice(0, 2);
      for (const { c } of top) { maybe.push({ q: o.question, c }); (o.matched ??= []).push({ claim: c.claim, url: c.url, day }); }
    });
    // ask.ts may have added a question while the model was judging: keep those, add only the matches.
    const now: typeof open = JSON.parse(readFileSync(OPEN, 'utf8'));
    writeFileSync(OPEN, JSON.stringify(now.map(o => ({ ...o, matched: open.find(x => x.question === o.question && x.at === o.at)?.matched ?? o.matched })), null, 1));
  }
}

const rest = claims.filter(c => !covered.has(c) && !held.includes(c) && c.concepts.length);
const topics = groupBy(rest, c => c.concepts[0]);
const map = (k: string) => `[${k}](../map/concepts/${encodeURI(file(k))}.md)`;
writeFileSync(new URL('00 Morning.md', notesDir), [
  `# Morning ${day}`, '',
  `Generated by the morning merge (local model ${model}); rewritten every morning. Your notes are only appended to.`, '',
  `${todo.length} new lecture${todo.length > 1 ? 's' : ''}. In your notes: ${plan.reduce((a, p) => a + p.add.length, 0)} new points added, ${plan.reduce((a, p) => a + p.known.length, 0)} skipped because you already have them, ${proposed} edit${proposed === 1 ? '' : 's'} proposed (apply them on the page)${held.length ? `, ${held.length} held (no verdict from the model)` : ''}.`, '',
  '## 🔔 Answers to your open questions', '',
  ...[...answers].map(([c, q]) => `- "${q}" — ${c.claim} (${c.title})`),
  ...maybe.map(({ q, c }) => `- possibly answers your question "${q}": ${c.claim} (${c.title}) ${cite(c)}`),
  ...(answers.size || maybe.length ? [] : ['- none today']), '',
  ...(held.length ? ['## Held: the model gave no verdict, retried next run', '', ...held.map(c => `- ${c.claim} (${c.title})`), ''] : []),
  '## Added to your notes', '',
  ...plan.filter(p => p.add.length).map(p => `- [[${p.note.name}]]: ${p.add.length} new`), '',
  '## Skipped: you already have these', '',
  ...plan.flatMap(p => p.known.map(k => `- ${k.c.claim} — your note [[${p.note.name}]]: "${k.evidence}"`)), '',
  '## New topics (no note of yours and no section yet)', '',
  ...[...topics].sort((a, b) => b[1].length - a[1].length).map(([k, cs]) => `- ${map(k)} — ${cs.length} point${cs.length > 1 ? 's' : ''}, e.g. ${cs[0].claim}`), '',
].join('\n'));

// A lecture with a held claim is not marked merged; next run its written claims are found word for word in the note.
writeFileSync(STATE, JSON.stringify([...merged, ...todo.map(c => c.videoId).filter(id => !held.some(c => c.videoId === id))]));
const problems: string[] = [];
commit(`merge ${day}: ${todo.length} lectures`);
// Check with git: the merge may add lines to your notes but never remove or change one.
for (const line of git('diff', '--numstat', 'HEAD~1', 'HEAD').trim().split('\n').filter(Boolean)) {
  const [, del, f] = line.split('\t');
  if (f !== '00 Morning.md' && f !== '.merged.json' && f !== '.proposals.json' && Number(del) > 0) problems.push(`${f}: ${del} lines removed or changed`);
}
console.log(`\n${todo.length} lectures, ${claims.length} claims; ${byMeaning} sent to a note by meaning, ${claims.filter(c => home.get(c) && !covered.has(c) && !held.includes(c)).length} judged unrelated, ${held.length} held (no verdict); ${covered.size} touch your notes: ${plan.reduce((a, p) => a + p.add.length, 0)} added, ${plan.reduce((a, p) => a + p.known.length, 0)} known, ${proposed} edits proposed (${fixed} "known" answers without a real sentence from the note were counted as new); ${topics.size} new topics`);
console.log(problems.length ? 'CHECK FAILED:\n- ' + problems.join('\n- ') : 'check passed: existing note text unchanged');
