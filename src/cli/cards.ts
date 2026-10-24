// Make one checked card per lecture, oldest first, into data/cards/<videoId>.json.
// The card itself comes from src/lib/card.ts (checks, and the revision loop for failed checks, live there).
// Quotes are checked per claim and recorded, so the notes only show verified quotes.
// Lectures narrated in Korean (the channel's own explainers) are left out of the English map.
// Prompt v5 (verbatim Korean quote + English translation) worked on them but is not used for now (E17).
// Every failed attempt is written to data/lessons.jsonl for the lesson verifier; verified rules are added to the prompt.
// Usage: npx tsx src/cli/cards.ts [model] [maxDays] [id,id]   (existing cards are skipped, so it can resume)
import '../lib/env.ts';
import * as Sentry from '@sentry/node';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadLecture } from '../lib/transcript.ts';
import { nonEnglish } from '../lib/english.ts';
import { makeCard, CARD_SYSTEM, CARD_VERSION } from '../lib/card.ts';
import { recordLesson } from '../lib/lessons.ts';
import { adoptedRules, rulesBlock } from '../lib/rules.ts';

Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 1.0 });

const model = process.argv[2] ?? 'do/gemma-4-31B-it';
const maxDays = Number(process.argv[3] ?? 30);
const only = process.argv[4]?.split(',');
const system = CARD_SYSTEM + rulesBlock(await adoptedRules('cards'));
// A transcript counts as Korean when at least 10% of its lines contain Korean.
const isKorean = (lines: { text: string }[]) => lines.filter(l => nonEnglish(l.text).length).length >= lines.length * 0.1;
const outDir = new URL('../../data/cards/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const videos = JSON.parse(readFileSync(new URL('../../data/videos.json', import.meta.url), 'utf8')).filter((v: any) => v.ageDays < maxDays && (!only || only.includes(v.videoId)));
let made = 0, skipped = 0, failed = 0, tin = 0, tout = 0;
for (const v of videos) {
  const out = new URL(`${v.videoId}.json`, outDir);
  if (existsSync(out)) { skipped++; continue; }
  if (!existsSync(new URL(`../../data/cache/transcript_${v.videoId}.json`, import.meta.url))) { console.log(`${v.videoId}: no transcript, skipped`); skipped++; continue; }
  const lecture = loadLecture(v.videoId, v.title);
  if (!lecture.lines.length) { console.log(`${v.videoId}: empty transcript, skipped`); skipped++; continue; }
  // The marker tells the watchdog not to start this lecture again.
  if (isKorean(lecture.lines)) { console.log(`${v.videoId}: narrated in Korean, skipped`); writeFileSync(new URL(`${v.videoId}.skipped.txt`, outDir), 'narrated in Korean'); skipped++; continue; }
  const r = await Sentry.startSpan({ op: 'lecture.card', name: `card ${v.videoId}`, attributes: { model, prompt: CARD_VERSION } }, () => makeCard(model, lecture, system));
  tin += r.tokens[0]; tout += r.tokens[1];
  // Network timeouts are not the model's mistake; everything else is a lesson candidate.
  for (const p of r.problems) if (!/timeout|fetch failed/i.test(p)) recordLesson('cards', 'card failed a check', { videoId: v.videoId, problem: p });
  if (!r.card) { failed++; console.log(`${v.videoId}: FAILED ${r.problems.join(' | ')}`); writeFileSync(new URL(`${v.videoId}.failed.txt`, outDir), r.problems.join('\n')); continue; }
  writeFileSync(out, JSON.stringify({
    videoId: v.videoId, url: `https://www.youtube.com/watch?v=${v.videoId}`, length: v.length,
    model, prompt: CARD_VERSION, attempts: r.attempts, revisions: r.revisions, problems: r.problems, ms: r.ms,
    card: r.card, quotes: r.quotes,
  }, null, 1));
  made++;
  console.log(`${v.videoId}: ok (attempt ${r.attempts}, ${(r.ms / 1000).toFixed(1)}s, quotes ${r.quotes.filter(q => q.found).length}/${r.quotes.length}) ${r.card.title}`);
  if (r.problems.length) console.log(`  retries: ${r.problems.join(' | ')}`);
}
console.log(`\n${videos.length} videos: ${made} cards made, ${skipped} skipped, ${failed} failed; tokens in/out ${tin}/${tout}`);
await Sentry.flush(10000);
