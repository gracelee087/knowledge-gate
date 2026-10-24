// One checked card for one lecture. Used by the card run (src/cli/cards.ts) and by the lesson verifier.
// Checks: schema, English only, one chapter per channel chapter.
// When a card fails a check, it is revised, not made again from scratch: the model gets its own card back
// with the defects, each with a fixed direction (the revision loop of the thesis design: judge -> defect
// types -> fixed directions -> revised draft). Only a broken answer (no valid JSON) is made again.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { chat } from './llm.ts';
import { renderForPrompt, checkQuote, mmss, type Lecture } from './transcript.ts';
import { nonEnglish } from './english.ts';
import { SCHEMAS } from '../schema/summary.ts';

export const CARD_VERSION = 'v8'; // v8: conclusion + summary + claims scaled to length (E32)
const Card = SCHEMAS[CARD_VERSION];
type CardT = z.infer<typeof Card>;
const jsonSchema = z.toJSONSchema(Card);
export const CARD_SYSTEM = readFileSync(new URL(`../../prompts/summarize.${CARD_VERSION}.md`, import.meta.url), 'utf8');

// v8: one claim per 5 minutes of lecture, 3 to 12, so a long talk is not squeezed into the same few claims.
export const claimTarget = (l: Lecture) => Math.min(12, Math.max(3, Math.round((l.lines.at(-1)?.ms ?? 0) / 300000)));
const summaryWords = (card: any) => String(card.summary ?? '').split(/\s+/).filter(Boolean).length;
// The prompt input: the lecture, plus the claim count for cards that have a summary (v8 on).
export const cardPrompt = (l: Lecture, system = CARD_SYSTEM) => renderForPrompt(l)
  + (system.includes('Claims to write') ? `\n\nClaims to write: ${claimTarget(l)} (the lecture is ${Math.round((l.lines.at(-1)?.ms ?? 0) / 60000)} minutes long)` : '');

// Defect types and their fixed directions. Code finds the defect; the direction tells the model what to do.
export type Defect = { type: 'language_leak' | 'chapter_count' | 'claim_count' | 'summary_length'; direction: string };
export function findDefects(lecture: Lecture, card: Pick<CardT, 'claims' | 'chapters'> & { summary?: string }): Defect[] { // v7 cards too (revtest)
  const out: Defect[] = [];
  if ('summary' in card) {
    const n = claimTarget(lecture), words = summaryWords(card);
    // One claim over the target is accepted: in the v8 test the model often wrote one more on short lectures (E32).
    if (card.claims.length < n || card.claims.length > n + 1) out.push({ type: 'claim_count', direction: `Write exactly ${n} claims (you wrote ${card.claims.length}), spread over the whole lecture, each with a verbatim quote and its [mm:ss]. Update every concept's claim_ids to match. Keep the other fields unchanged.` });
    if (words < 60 || words > 130) out.push({ type: 'summary_length', direction: `Rewrite summary in 80 to 110 words (it has ${words}). Keep the other fields unchanged.` });
  }
  const korean = nonEnglish(card);
  if (korean.length) out.push({ type: 'language_leak', direction: `Translate these fields into English: ${korean.join(', ')}. Change nothing else.` });
  if (lecture.chapters.length && card.chapters.length !== lecture.chapters.length) out.push({
    type: 'chapter_count',
    direction: `The channel lists ${lecture.chapters.length} chapters; your card has ${card.chapters.length}. Return exactly one chapter entry per listed chapter, in this order: ${lecture.chapters.map(c => `[${mmss(c.ms)}] ${c.title}`).join('; ')}. Translate each title to English. Keep the other fields unchanged.`,
  });
  return out;
}

const REVISE = `\n\nRevision: you get a card you made for this lecture and a list of defects found by code checks. Fix exactly those defects, following each direction, and return the whole corrected card. Keep every other field as it was.`;

export type CardResult = {
  card: CardT | null; quotes: { found: boolean; nearAt: boolean }[];
  attempts: number; revisions: string[]; problems: string[]; ms: number; tokens: [number, number];
};

export async function makeCard(model: string, lecture: Lecture, system = CARD_SYSTEM, attempts = 3, { revise = true } = {}): Promise<CardResult> {
  const prompt = cardPrompt(lecture, system);
  const problems: string[] = [], revisions: string[] = [];
  const tokens: [number, number] = [0, 0];
  let last: CardT | null = null, defects: Defect[] = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const revising = revise && last && defects.length;
    try {
      const r = revising
        ? await chat(model, system + REVISE, `${prompt}\n\nYour card:\n${JSON.stringify(last)}\n\nDefects:\n${defects.map(d => `- ${d.type}: ${d.direction}`).join('\n')}`, jsonSchema)
        : await chat(model, system, prompt, jsonSchema);
      if (revising) revisions.push(defects.map(d => d.type).join('+'));
      tokens[0] += r.inputTokens; tokens[1] += r.outputTokens;
      const parsed = Card.safeParse(JSON.parse(r.text));
      if (!parsed.success) { problems.push(`attempt ${attempt}: schema`); last = null; defects = []; continue; }
      defects = findDefects(lecture, parsed.data);
      if (defects.length) { last = parsed.data; problems.push(`attempt ${attempt}: ${defects.map(d => d.type).join(', ')}`); continue; }
      const quotes = parsed.data.claims.map(c => checkQuote(lecture, c.quote, c.at));
      return { card: parsed.data, quotes, attempts: attempt, revisions, problems, ms: r.ms, tokens };
    } catch (e) {
      problems.push(`attempt ${attempt}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return { card: null, quotes: [], attempts, revisions, problems, ms: 0, tokens };
}
