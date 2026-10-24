// Category agent: designs the map's categories from the lectures themselves and assigns each lecture.
// Asking for 71 assignments in one answer failed (lectures were dropped, E20), so the work is split:
//   1. design: the model proposes category names and definitions (a short answer)
//   2. assign: lectures go in batches of 12; the answer can only name a designed category (JSON enum)
//   3. check: code applies the size rules; a broken rule goes back to step 1 as feedback
// Every broken rule is written to data/lessons.jsonl; only verified rules (src/agent/verify.ts) reach the prompt.
// Output: data/categories.json. Usage: npx tsx src/agent/categories.ts [model]
import '../lib/env.ts';
import * as Sentry from '@sentry/node';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { chatRetry as chat } from '../lib/llm.ts';
import { nonEnglish } from '../lib/english.ts';
import { recordLesson } from '../lib/lessons.ts';
import { adoptedRules, rulesBlock } from '../lib/rules.ts';

const data = (p: string) => new URL(`../../data/${p}`, import.meta.url);

// The rules a good set of categories must meet. Checked by code, never by the model.
export const RULES = { minCategories: 5, maxCategories: 9, maxShare: 0.25, maxOther: 3, rounds: 4, batch: 12 };

const Design = z.object({ categories: z.array(z.object({ name: z.string(), definition: z.string().describe('what belongs here, one sentence') })) });
type Category = z.infer<typeof Design>['categories'][number];
export type CategoryRun = { categories: Category[] | null; assign: Map<string, string>; violations: number[]; tokens: [number, number] };

function loadLectures() {
  const concepts = JSON.parse(readFileSync(data('concepts.json'), 'utf8')).mentions as { videoId: string; concept: string }[];
  return readdirSync(data('cards/')).filter(f => f.endsWith('.json')).sort().map(f => {
    const c = JSON.parse(readFileSync(data(`cards/${f}`), 'utf8'));
    return { videoId: c.videoId as string, title: c.card.title as string, one_line: c.card.one_line as string, concepts: concepts.filter(m => m.videoId === c.videoId).map(m => m.concept) };
  });
}

// One full run: up to `rounds` design rounds. `rules` are added to the designer's prompt.
// `violations[i]` is the number of broken rules in round i+1 (the verifier compares these).
export async function runCategories(model: string, rules: string[], { rounds = RULES.rounds, record = true } = {}): Promise<CategoryRun> {
  const lectures = loadLectures();
  const limit = Math.floor(lectures.length * RULES.maxShare);
  // The id is quoted: some ids start with "-" and were read as list bullets and dropped (E22).
  const line = (l: typeof lectures[number]) => `id="${l.videoId}" | ${l.title} | ${l.one_line} | concepts: ${l.concepts.join(', ')}`;
  const tokens: [number, number] = [0, 0];
  const ask = async <T extends z.ZodType>(system: string, user: string, schema: T): Promise<z.infer<T>> => {
    const r = await chat(model, system, user, z.toJSONSchema(schema));
    tokens[0] += r.inputTokens; tokens[1] += r.outputTokens;
    return schema.parse(JSON.parse(r.text));
  };
  const DESIGN_SYSTEM = `You organize a reader's knowledge map of AI engineering lectures.
Design the categories from what these lectures are actually about, so a reader can browse the map and find a lecture fast.
- ${RULES.minCategories} to ${RULES.maxCategories} categories, each with a one-sentence definition that says what belongs in it and what does not.
- Each category should end up with at most ${limit} of the ${lectures.length} lectures. Split a big topic by what readers would look for.
- Include "Other" only if some lectures fit nowhere; it may hold at most ${RULES.maxOther}.
- Short Title Case names, English.
Answer with JSON matching the schema.` + rulesBlock(rules);
  const ASSIGN_SYSTEM = `Put each lecture in the one category whose definition fits it best. Use every videoId given, exactly once, copied exactly. Answer with JSON matching the schema.`;

  const violations: number[] = [];
  let feedback = '';
  for (let round = 1; round <= rounds; round++) {
    const design = await ask(DESIGN_SYSTEM, lectures.map(line).join('\n') + feedback, Design);
    const names = [...new Set(design.categories.map(c => c.name))];
    const problems: string[] = [];
    if (names.length < RULES.minCategories || names.length > RULES.maxCategories) problems.push(`you made ${names.length} categories; make ${RULES.minCategories} to ${RULES.maxCategories}`);
    if (nonEnglish(design).length) problems.push('write everything in English');
    // A name once came back with JSON pasted into it ('Harness Engineering, videoIds": [...').
    const badNames = names.filter(n => !/^[A-Za-z0-9][A-Za-z0-9 &,'-]{1,39}$/.test(n));
    if (badNames.length) problems.push(`these category names are not short plain names: ${badNames.map(n => JSON.stringify(n.slice(0, 60))).join('; ')}. Write only the name, at most 40 letters`);

    const assign = new Map<string, string>();
    const catList = design.categories.map(c => `- ${c.name}: ${c.definition}`).join('\n');
    for (let i = 0; i < lectures.length && !problems.length; i += RULES.batch) {
      const batch = lectures.slice(i, i + RULES.batch);
      const Assign = z.object({ assignments: z.array(z.object({ videoId: z.enum(batch.map(l => l.videoId) as [string, ...string[]]), category: z.enum(names as [string, ...string[]]) })) });
      for (let tries = 1; tries <= 2; tries++) {
        const missing = batch.filter(l => !assign.has(l.videoId));
        if (!missing.length) break;
        const a = await ask(ASSIGN_SYSTEM, `Categories:\n${catList}\n\nLectures:\n${missing.map(line).join('\n')}`, Assign);
        for (const x of a.assignments) if (!assign.has(x.videoId)) assign.set(x.videoId, x.category);
      }
    }
    const missing = lectures.filter(l => !assign.has(l.videoId)).map(l => l.videoId);
    if (!problems.length && missing.length) problems.push(`these lectures got no category: ${missing.join(', ')}`);
    if (assign.size) for (const n of names) {
      const k = [...assign.values()].filter(c => c === n).length;
      const max = n.toLowerCase() === 'other' ? RULES.maxOther : limit;
      if (k > max) problems.push(`"${n}" got ${k} lectures; the limit is ${max}. Split it or define it more narrowly`);
      if (!k) problems.push(`"${n}" got no lectures; drop it or merge it`);
    }
    console.log(`  round ${round}: ${names.length} categories, ${problems.length} rule violations`);
    violations.push(problems.length);
    if (!problems.length) return { categories: design.categories, assign, violations, tokens };
    if (record) recordLesson('categories', 'answer broke category rules', { round, violations: problems });
    feedback = `\n\nYour previous categories were:\n${catList}\nThey broke these rules. Design them again:\n- ${problems.join('\n- ')}`;
  }
  return { categories: null, assign: new Map(), violations, tokens };
}

// CLI: design categories with the adopted rules and write data/categories.json.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('agent/categories.ts')) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 1.0 });
  const model = process.argv[2] ?? 'do/gemma-4-31B-it';
  const run = await runCategories(model, await adoptedRules('categories'));
  if (!run.categories) { console.log('FAILED: no design met the rules; data/categories.json was not changed'); process.exit(1); }
  const assignments = [...run.assign].map(([videoId, category]) => ({ videoId, category }));
  const sizes = Object.fromEntries(run.categories.map(c => [c.name, assignments.filter(x => x.category === c.name).length]));
  writeFileSync(data('categories.json'), JSON.stringify({ model, at: new Date().toISOString(), rules: RULES, categories: run.categories, assignments, sizes }, null, 1));
  console.log(sizes, 'tokens', run.tokens.join('/'));
  await Sentry.flush(10000);
}
