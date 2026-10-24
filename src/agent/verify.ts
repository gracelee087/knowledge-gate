// Lesson verifier: turns recorded lessons into candidate rules and keeps a rule only if runs with it are
// at least as good as runs without it ("same or better"). Adopted rules go to Backboard memory, where the
// agents read them; every candidate and its evidence goes to data/rules.json and docs/RULES.md.
//   1. read new lessons for an agent (data/lessons.jsonl)
//   2. a writer call turns them into general rules, and says if a rule in the prompt can fix the mistake
//      ("prompt") or if it needs a code change ("code": input format, output length, network...)
//   3. each "prompt" rule is tested: the same task is run with and without it
//      - categories: 3 runs each, one design round; fewer broken rules is better
//      - cards: the lectures the lessons came from plus 2 test lectures, first attempt only;
//        more cards passing the checks is better, and verbatim quotes may not drop by more than 10 points
//   4. adopt or reject; "code" rules are marked needs-code for a person
// Usage: npx tsx src/agent/verify.ts [categories|cards]        verify new lessons
//        npx tsx src/agent/verify.ts categories --rule "text"  test one given rule (used to test the verifier)
//        npx tsx src/agent/verify.ts cards --rule "text" --on id,id   test a card rule on given lectures too
import '../lib/env.ts';
import * as Sentry from '@sentry/node';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { chatRetry } from '../lib/llm.ts';
import { nonEnglish } from '../lib/english.ts';
import { readLessons } from '../lib/lessons.ts';
import { adoptedRules, loadRules, saveRules, publishRule, rulesBlock, type Rule } from '../lib/rules.ts';
import { runCategories } from './categories.ts';
import { runConcepts } from './concepts.ts';
import { makeCard, CARD_SYSTEM } from '../lib/card.ts';
import { loadLecture } from '../lib/transcript.ts';

Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 1.0 });
const MODEL = 'do/gemma-4-31B-it';
const agent = (process.argv[2] ?? 'categories') as 'categories' | 'cards' | 'concepts';
const arg = (name: string) => (process.argv.indexOf(name) > 0 ? process.argv[process.argv.indexOf(name) + 1] : null);
const given = arg('--rule');
const on = arg('--on')?.split(',') ?? []; // extra lectures to test a given card rule on
const SEEN = new URL('../../data/lessons_seen.json', import.meta.url);
const seen: string[] = existsSync(SEEN) ? JSON.parse(readFileSync(SEEN, 'utf8')) : [];
const videos = JSON.parse(readFileSync(new URL('../../data/videos.json', import.meta.url), 'utf8'));
const TEST_LECTURES = ['yNPS1Z64wQM', 'vMlsLmKuFZk']; // BM25 talk and the Altman–Benioff interview
const ROLE = {
  categories: 'designs the categories of a knowledge map of lectures and assigns each lecture to one',
  cards: 'turns one lecture transcript into a card: title, chapters, claims with verbatim quotes, concepts; everything in English',
  concepts: 'decides which concept mentions from different lectures are the same idea, so they share one glossary page; a related idea is not the same idea',
};

const Candidates = z.object({ candidates: z.array(z.object({
  rule: z.string().describe('one general instruction for the agent, one sentence'),
  kind: z.enum(['prompt', 'code']).describe('"prompt" if an instruction can prevent the mistake; "code" if it comes from input format, output length, network or other limits an instruction cannot fix'),
  lessons: z.array(z.number().int()).describe('indexes of the lessons this rule addresses'),
  why: z.string(),
})) });
const WRITER = `You improve an AI agent from its own mistakes. The agent ${'{role}'}.
You get its current extra rules and a numbered list of mistakes that code checks caught.
Write the smallest set of general rules that would prevent these mistakes in future runs.
- A rule says what to do, in one sentence. It is about the kind of mistake, never about one lecture or id.
- Do not repeat a current rule.
- Mark kind "code" when no instruction can fix it (an input that misleads the model, an answer too long to finish, a network error, a hard limit).
English only. Answer with JSON matching the schema.`;

type Score = { better: number; guard?: number; detail: object };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

async function scoreCategories(rules: string[]): Promise<Score> {
  const v: number[] = [];
  for (let i = 0; i < 3; i++) v.push((await runCategories(MODEL, rules, { rounds: 1, record: false })).violations[0]);
  return { better: -mean(v), detail: { runs: 3, violationsRound1: v } }; // fewer violations = higher score
}

async function scoreConcepts(rules: string[]): Promise<Score> {
  const v: number[] = [];
  for (let i = 0; i < 3; i++) v.push((await runConcepts(MODEL, rules, { record: false })).violations);
  return { better: -mean(v), detail: { runs: 3, violations: v } }; // broken code rules + checker drops; fewer = higher score
}

async function scoreCards(rules: string[], lectureIds: string[]): Promise<Score> {
  const system = CARD_SYSTEM + rulesBlock(rules);
  let passed = 0, found = 0, quotes = 0;
  const per: object[] = [];
  for (const id of lectureIds) {
    const lecture = loadLecture(id, videos.find((v: any) => v.videoId === id)?.title ?? id);
    const r = await makeCard(MODEL, lecture, system, 1);
    if (r.card) passed++;
    found += r.quotes.filter(q => q.found).length; quotes += r.quotes.length;
    per.push({ id, passed: Boolean(r.card), problem: r.problems[0] ?? '' });
  }
  return { better: passed, guard: quotes ? found / quotes : 0, detail: { lectures: lectureIds.length, passed, quotesFound: `${found}/${quotes}`, per } };
}

async function verify(rule: string, from: string[], cardLectures: string[]) {
  const adopted = (await adoptedRules(agent)).filter(a => a !== rule); // re-testing a rule must not count it in the baseline
  const score = (rules: string[]) => (agent === 'categories' ? scoreCategories(rules) : agent === 'concepts' ? scoreConcepts(rules) : scoreCards(rules, cardLectures));
  console.log(`testing: ${rule}`);
  const without = await score(adopted);
  const withRule = await score([...adopted, rule]);
  const ok = withRule.better >= without.better && (withRule.guard === undefined || withRule.guard >= (without.guard ?? 0) - 0.10);
  const r: Rule = { id: `${agent}-${Date.now()}`, agent, rule, status: ok ? 'adopted' : 'rejected', from, evidence: { without: without.detail, with: withRule.detail }, at: new Date().toISOString() };
  if (ok) r.memoryId = await publishRule(r);
  console.log(`  ${r.status}: without ${JSON.stringify(without.detail)} | with ${JSON.stringify(withRule.detail)}`);
  return r;
}

const rules = loadRules();
if (given) {
  rules.push(await verify(given, ['given'], [...new Set([...on, ...TEST_LECTURES])]));
} else {
  const lessons = readLessons().filter(l => l.agent === agent && !seen.includes(l.at));
  if (!lessons.length) { console.log(`no new lessons for ${agent}`); process.exit(0); }
  const adopted = await adoptedRules(agent);
  const list = lessons.slice(-30).map((l, i) => `${i}. ${l.what}: ${JSON.stringify({ ...l, at: undefined, agent: undefined, what: undefined }).slice(0, 300)}`).join('\n');
  const r = await chatRetry(MODEL, WRITER.replace('{role}', ROLE[agent]), `Current extra rules:\n${adopted.map(a => `- ${a}`).join('\n') || '(none)'}\n\nMistakes:\n${list}`, z.toJSONSchema(Candidates));
  const cands = Candidates.parse(JSON.parse(r.text)).candidates.filter(c => !nonEnglish(c).length && c.rule.length <= 300);
  console.log(`${lessons.length} new lessons -> ${cands.length} candidate rules`);
  for (const c of cands) {
    const from = c.lessons.map(i => lessons.slice(-30)[i]?.at).filter(Boolean) as string[];
    if (c.kind === 'code') {
      rules.push({ id: `${agent}-${Date.now()}`, agent, rule: c.rule, status: 'needs-code', from, evidence: { why: c.why }, at: new Date().toISOString() });
      console.log(`needs-code: ${c.rule}`);
      continue;
    }
    // Test on the lectures the mistakes came from; if the writer's indexes don't map, on all lectures in these lessons.
    const ids = (ls: any[]) => [...new Set(ls.map(l => l?.videoId).filter(Boolean))] as string[];
    const mapped = ids(c.lessons.map(i => lessons.slice(-30)[i]));
    const failedOn = (mapped.length ? mapped : ids(lessons.slice(-30))).slice(0, 3);
    rules.push(await verify(c.rule, from, [...new Set([...failedOn, ...TEST_LECTURES])]));
  }
  writeFileSync(SEEN, JSON.stringify([...seen, ...lessons.map(l => l.at)]));
}
saveRules(rules);

// docs/RULES.md: every candidate with its verdict and evidence, for people and for the post.
const md = ['# Rules the agents learned', '', 'Generated by `src/agent/verify.ts`. A rule is adopted only if runs with it were at least as good as runs without it; adopted rules are stored in Backboard memory and added to the agent\'s prompt.', '',
  '| Agent | Rule | Status | Evidence | Date |', '|---|---|---|---|---|',
  ...rules.map(r => `| ${r.agent} | ${r.rule.replace(/\|/g, '\\|')} | ${r.status} | ${JSON.stringify(r.evidence).replace(/\|/g, '\\|').slice(0, 400)} | ${r.at.slice(0, 10)} |`), ''].join('\n');
writeFileSync(new URL('../../docs/RULES.md', import.meta.url), md);
await Sentry.flush(10000);
