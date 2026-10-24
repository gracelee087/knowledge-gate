// Concept naming agent: decides which concept mentions across lectures are the same idea.
// A mention is (lecture, name, what the lecture says about it, the claims behind it). Names alone are not
// enough: two lectures can use one name for different ideas, or two names for one idea. So the model
// reads the context, a second call checks every group, and code enforces the rules below.
// Output: data/concepts.json (mention -> concept, with reasons). Rejected decisions go to data/lessons.jsonl;
// only rules that passed the verifier (src/agent/verify.ts) reach the prompt.
// Usage: npx tsx src/agent/concepts.ts [model]
import '../lib/env.ts';
import * as Sentry from '@sentry/node';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { chatRetry as chat } from '../lib/llm.ts';
import { nonEnglish } from '../lib/english.ts';
import { recordLesson } from '../lib/lessons.ts';
import { adoptedRules, rulesBlock } from '../lib/rules.ts';

const data = (p: string) => new URL(`../../data/${p}`, import.meta.url);

type Mention = { id: number; videoId: string; title: string; name: string; what: string; claims: string[] };
const mentions: Mention[] = [];
for (const f of readdirSync(data('cards/')).filter(f => f.endsWith('.json')).sort()) {
  const c = JSON.parse(readFileSync(data(`cards/${f}`), 'utf8'));
  for (const k of c.card.concepts) {
    mentions.push({ id: mentions.length, videoId: c.videoId, title: c.card.title, name: k.name, what: k.what, claims: k.claim_ids.map((i: number) => c.card.claims[i]?.claim).filter(Boolean) });
  }
}
const render = (m: Mention) => `[${m.id}] "${m.name}" in "${m.title}": ${m.what} | claims: ${m.claims.join(' / ')}`;

const Groups = z.object({
  groups: z.array(z.object({
    concept: z.string().describe('the shared name; must be one of the member mentions\' names'),
    mention_ids: z.array(z.number().int()).min(2),
    reason: z.string().describe('why these mentions are the same idea in context'),
  })),
  renames: z.array(z.object({
    mention_id: z.number().int(),
    concept: z.string().describe('a more specific name, used when a common name hides a different idea'),
    reason: z.string(),
  })).describe('mentions that share a name with others but mean something different'),
});

const GROUP_BASE = `You maintain the glossary of a knowledge map built from many lectures.
You get concept mentions. Each has an id, the name a lecture used, what that lecture says about it, and the claims behind it.
Decide which mentions are the same idea.
- Group mentions only when the context shows they mean the same thing. Similar words are not enough.
- If mentions share a name but the context shows different ideas, do not group them; give the odd one a more specific name in "renames".
- The group's concept name must be one of its members' names, the clearest one. Never invent a broader umbrella name.
- A mention that matches nothing stays alone; leave it out.
- English only. Answer with JSON matching the schema.`;

const Verdicts = z.object({
  verdicts: z.array(z.object({
    group: z.number().int(),
    keep: z.array(z.number().int()).describe('mention ids that truly mean the group concept'),
    drop: z.array(z.number().int()).describe('mention ids that mean something else'),
    reason: z.string(),
  })),
});
const CHECK_SYSTEM = `You check another editor's work on a glossary. For each proposed group of concept mentions, read each mention's context and decide whether it really means the group's concept. Keep the ones that do and drop the ones that don't. Be strict: a related idea is not the same idea. English only. Answer with JSON matching the schema.`;

export type ConceptRun = { out: (Mention & { concept: string; reason: string })[]; merged: number; dropped: number; renames: number; violations: number; tokens: [number, number] };

// violations = groups that broke a code rule + mentions the checker dropped (each one is a lesson); fewer is better.
// record: false is for src/agent/verify.ts, which runs this to test a candidate rule.
export async function runConcepts(model: string, rules: string[], { record = true } = {}): Promise<ConceptRun> {
let violations = 0;
const lesson = (what: string, detail: object) => { violations++; if (record) recordLesson('concepts', what, detail); };

// 1. Propose groups.
const r1 = await chat(model, GROUP_BASE + rulesBlock(rules), mentions.map(render).join('\n'), z.toJSONSchema(Groups));
const proposal = Groups.parse(JSON.parse(r1.text));

// 2. Code rules: valid ids, one group per mention, name taken from a member, English.
const used = new Set<number>();
const groups: { concept: string; mention_ids: number[]; reason: string }[] = [];
for (const g of proposal.groups) {
  const ids = [...new Set(g.mention_ids)].filter(i => mentions[i] && !used.has(i));
  const memberNames = ids.map(i => mentions[i].name.toLowerCase());
  if (ids.length < 2) { lesson('group too small after removing invalid or reused ids', { group: g }); continue; }
  if (!memberNames.includes(g.concept.toLowerCase())) { lesson('group name is not a member name (invented umbrella term)', { group: g }); continue; }
  if (nonEnglish(g).length) { lesson('group not in English', { group: g }); continue; }
  ids.forEach(i => used.add(i));
  groups.push({ ...g, mention_ids: ids });
}

// 3. Second call checks each group; only mentions it keeps are merged.
const r2 = await chat(model, CHECK_SYSTEM,
  groups.map((g, gi) => `Group ${gi}: "${g.concept}"\n` + g.mention_ids.map(i => render(mentions[i])).join('\n')).join('\n\n'),
  z.toJSONSchema(Verdicts));
const verdicts = Verdicts.parse(JSON.parse(r2.text)).verdicts;
const concepts: Record<number, { concept: string; reason: string }> = {};
let merged = 0, dropped = 0;
groups.forEach((g, gi) => {
  const v = verdicts.find(x => x.group === gi);
  const keep = v ? g.mention_ids.filter(i => v.keep.includes(i)) : [];
  const drop = g.mention_ids.filter(i => !keep.includes(i));
  if (drop.length) { dropped += drop.length; lesson('checker dropped mentions from a group', { concept: g.concept, dropped: drop.map(i => `${mentions[i].name} @ ${mentions[i].videoId}`), reason: v?.reason ?? 'no verdict' }); }
  if (keep.length < 2) return;
  for (const i of keep) concepts[i] = { concept: g.concept, reason: g.reason };
  merged++;
});

// 4. Renames for same-name, different-idea mentions (not inside a kept group).
for (const r of proposal.renames) {
  if (!mentions[r.mention_id] || concepts[r.mention_id] || nonEnglish(r).length) continue;
  concepts[r.mention_id] = { concept: r.concept, reason: r.reason };
}

// Everything else keeps its own name. Same names are joined only when the agent did not split them.
const out = mentions.map(m => ({ ...m, concept: concepts[m.id]?.concept ?? m.name, reason: concepts[m.id]?.reason ?? '' }));
return { out, merged, dropped, renames: proposal.renames.length, violations, tokens: [r1.inputTokens + r2.inputTokens, r1.outputTokens + r2.outputTokens] };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('agent/concepts.ts')) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 1.0 });
  const model = process.argv[2] ?? 'do/gemma-4-31B-it';
  const r = await runConcepts(model, await adoptedRules('concepts'));
  writeFileSync(data('concepts.json'), JSON.stringify({ model, at: new Date().toISOString(), mentions: r.out }, null, 1));
  const distinct = new Set(r.out.map(m => m.concept.toLowerCase())).size;
  console.log(`${mentions.length} mentions, ${new Set(mentions.map(m => m.name.toLowerCase())).size} names before -> ${distinct} concepts after; ${r.merged} groups merged, ${r.dropped} mentions dropped by the checker, ${r.renames} renames proposed; tokens ${r.tokens[0]}/${r.tokens[1]}`);
  await Sentry.flush(10000);
}
