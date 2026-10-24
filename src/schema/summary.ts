// Lecture card contract. Everything the card holds is in English: it feeds the second-brain notes
// (category index + concept pages). Earlier drafts v0/v1 asked for Korean text and are kept only as
// trial data under data/trials/.
import { z } from 'zod';

export const CATEGORIES = [
  'Harness & agent design',
  'Context, memory & search',
  'Dev workflow & software factories',
  'Evaluation, verification & security',
  'Self-improving agents',
  'AI industry & leaders',
  'Other',
] as const;

export const LectureCard = z.object({
  one_line: z.string().describe('one-sentence summary'),
  kind: z.enum(['technical', 'talk', 'interview', 'news', 'other']),
  level: z.enum(['intro', 'intermediate', 'advanced']),
  category: z.enum(CATEGORIES),
  speakers: z.array(z.object({
    name: z.string(),
    org: z.string().describe('company or project, empty if not stated'),
    source: z.enum(['title', 'transcript']).describe('where the name appears'),
  })).describe('only people named in the title or transcript; empty if nobody is named'),
  chapters: z.array(z.object({
    start: z.string().describe('mm:ss, copied from the chapter list'),
    title: z.string().describe('chapter title translated to English'),
    summary: z.string().describe('1-2 sentences'),
  })),
  claims: z.array(z.object({
    claim: z.string().describe('the key claim'),
    quote: z.string().describe('verbatim words copied from the transcript that support the claim'),
    at: z.string().describe('mm:ss of the transcript line the quote comes from'),
  })).min(3).max(5),
  concepts: z.array(z.object({
    name: z.string().describe('canonical name, e.g. "BM25", "Progressive Disclosure"'),
    what: z.string().describe('what THIS lecture says about the concept, one sentence'),
    claim_ids: z.array(z.number().int()).describe('0-based indexes into claims that support it'),
  })).min(1).max(8),
  skippable: z.array(z.object({ from: z.string(), to: z.string(), why: z.string() })).describe('intro, ads, Q&A housekeeping'),
});
export type LectureCard = z.infer<typeof LectureCard>;

// v3: same card, but every concept must point at a supporting claim.
export const LectureCardV3 = LectureCard.extend({
  concepts: z.array(z.object({
    name: z.string().describe('glossary-style name, Title Case, e.g. "BM25", "Spec-Driven Development"'),
    what: z.string().describe('what THIS lecture says about the concept, one sentence'),
    claim_ids: z.array(z.number().int()).min(1).describe('0-based indexes into claims that support it'),
  })).min(1).max(8),
});

// v4: v3 plus the lecture title in English, so notes never show the channel's Korean title.
export const LectureCardV4 = LectureCardV3.extend({
  title: z.string().describe('the lecture title translated to English, without the bracketed subtitle tag'),
});

// v5: for lectures spoken (partly) in Korean. The quote stays verbatim, so it can be checked against
// the transcript, and an English translation sits next to it.
export const LectureCardV5 = LectureCardV4.extend({
  claims: z.array(z.object({
    claim: z.string().describe('the key claim'),
    quote: z.string().describe('verbatim words copied from the transcript, in the language of the transcript'),
    quote_en: z.string().describe('English translation of the quote; the same text if the quote is already English'),
    at: z.string().describe('mm:ss of the transcript line the quote comes from'),
  })).min(3).max(5),
});

// v8: the card is the lecture's part of the morning report: a one-line conclusion, an ~100-word summary,
// and more claims for longer lectures (the count is set by code, see claimTarget in src/lib/card.ts).
export const LectureCardV8 = LectureCardV4.extend({
  one_line: z.string().describe('one-line conclusion: the single takeaway'),
  summary: z.string().describe('the key content, 80 to 110 words of prose'),
  claims: z.array(z.object({
    claim: z.string().describe('the key claim'),
    quote: z.string().describe('verbatim words copied from the transcript that support the claim'),
    at: z.string().describe('mm:ss of the transcript line the quote comes from'),
  })).min(3).max(12),
});

// v6 and v7 use the v4 card; only the prompt changes (kind definitions, concept names must come from the transcript).
export const SCHEMAS = { v2: LectureCard, v3: LectureCardV3, v4: LectureCardV4, v5: LectureCardV5, v6: LectureCardV4, v7: LectureCardV4, v8: LectureCardV8 } as const;
export type PromptVersion = keyof typeof SCHEMAS;
