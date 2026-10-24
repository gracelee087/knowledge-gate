// Experiment: does revising a failed card fix it more often than making it again from scratch?
// Two fixed failures, so both arms start from the same defect:
//   A. a real v7 test card whose chapter summaries came back in Korean (S-bRN-avZ4Q, trial run 2)
//   B. a good card with all but its first chapter removed (VOToAHcnhyA; a real run once returned 1 of 11)
// Each arm runs 3 times with one model call; a run counts as fixed when the card passes every check.
// Usage: npx tsx src/cli/revtest.ts
import '../lib/env.ts';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { chat } from '../lib/llm.ts';
import { loadLecture, renderForPrompt } from '../lib/transcript.ts';
import { findDefects, CARD_SYSTEM } from '../lib/card.ts';
import { SCHEMAS } from '../schema/summary.ts';

const MODEL = 'do/gemma-4-31B-it', RUNS = 3;
const Card = SCHEMAS.v7, schema = z.toJSONSchema(Card);
const read = (p: string) => JSON.parse(readFileSync(new URL(`../../data/${p}`, import.meta.url), 'utf8'));
const videos = read('videos.json');
const REVISE = `\n\nRevision: you get a card you made for this lecture and a list of defects found by code checks. Fix exactly those defects, following each direction, and return the whole corrected card. Keep every other field as it was.`;

const good = read('cards/VOToAHcnhyA.json').card;
const cases = [
  { name: 'A language_leak', id: 'S-bRN-avZ4Q', card: read('trials/S-bRN-avZ4Q.do_gemma-4-31B-it.v7.r2.json') },
  { name: 'B chapter_count', id: 'VOToAHcnhyA', card: { ...good, chapters: good.chapters.slice(0, 1) } },
];
let tokens = [0, 0];
const fixed = async (lecture: any, text: string) => { const p = Card.safeParse(JSON.parse(text)); return p.success && !findDefects(lecture, p.data).length; };
for (const c of cases) {
  const lecture = loadLecture(c.id, videos.find((v: any) => v.videoId === c.id).title);
  const defects = findDefects(lecture, c.card);
  console.log(`${c.name}: starting defects ${defects.map(d => d.type).join(', ')}`);
  const res: Record<string, boolean[]> = { scratch: [], revise: [] };
  for (let i = 0; i < RUNS; i++) {
    for (const arm of ['scratch', 'revise'] as const) {
      try {
        const r = arm === 'scratch'
          ? await chat(MODEL, CARD_SYSTEM, renderForPrompt(lecture), schema)
          : await chat(MODEL, CARD_SYSTEM + REVISE, `${renderForPrompt(lecture)}\n\nYour card:\n${JSON.stringify(c.card)}\n\nDefects:\n${defects.map(d => `- ${d.type}: ${d.direction}`).join('\n')}`, schema);
        tokens = [tokens[0] + r.inputTokens, tokens[1] + r.outputTokens];
        res[arm].push(await fixed(lecture, r.text));
      } catch (e) { console.log(`  ${arm} call failed: ${(e as Error).message.slice(0, 60)}`); }
    }
  }
  console.log(`  scratch fixed ${res.scratch.filter(Boolean).length}/${res.scratch.length}, revise fixed ${res.revise.filter(Boolean).length}/${res.revise.length}`);
}
console.log('tokens', tokens.join('/'));
