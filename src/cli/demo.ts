// Live demo: one YouTube link in, one checked card out, printed for an audience.
// The transcript comes from the SerpApi cache when present (no search spent); the card is made live.
// Writes only data/demo/<id>.json, never data/cards or the notes.
// Usage: npx tsx src/cli/demo.ts <youtube url or id> [--saved]   (--saved prints the last saved run, offline)
import '../lib/env.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { transcript } from '../lib/serpapi.ts';
import { loadLecture } from '../lib/transcript.ts';
import { makeCard, CARD_SYSTEM } from '../lib/card.ts';

const model = 'do/gemma-4-31B-it';
const arg = process.argv[2] ?? '', saved = process.argv.includes('--saved');
const id = arg.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/)?.[1] ?? (/^[\w-]{11}$/.test(arg) ? arg : null);
if (!id) { console.log('Usage: npx tsx src/cli/demo.ts <youtube url or id> [--saved]'); process.exit(1); }
const root = new URL('../../', import.meta.url);
const url = `https://www.youtube.com/watch?v=${id}`;
const outFile = new URL(`data/demo/${id}.json`, root);
const toSec = (at: string) => at.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);

function show(card: any, quotes: { found: boolean }[]) {
  console.log(`\n${card.title}\n→ ${card.one_line}\n`);
  card.claims.forEach((c: any, i: number) => {
    console.log(`${i + 1}. ${c.claim}\n   ${quotes[i]?.found ? '✓' : '✗'} "${c.quote}"\n   ${c.at}  ${url}&t=${toSec(c.at)}s`);
  });
  console.log(`\nQuotes found word for word in the transcript: ${quotes.filter(q => q.found).length}/${quotes.length}`);
}

// Offline fallback: the last run as it was saved.
if (saved) {
  if (!existsSync(outFile)) { console.log(`No saved run for ${id}`); process.exit(1); }
  const d = JSON.parse(readFileSync(outFile, 'utf8'));
  console.log(`Saved run from ${d.at} (card took ${d.cardSec.toFixed(1)}s)`);
  show(d.card, d.quotes);
  process.exit(0);
}

const t0 = Date.now();
const cached = existsSync(new URL(`data/cache/transcript_${id}.json`, root));
const tr = await transcript(id).catch(e => { console.log(`${url}: ${(e as Error).message}`); process.exit(1); });
if (!tr.segments.length) { console.log(`${url}: no English transcript yet`); process.exit(1); }
const videos = JSON.parse(readFileSync(new URL('data/videos.json', root), 'utf8'));
const lecture = loadLecture(id, videos.find((v: any) => v.videoId === id)?.title ?? id);
const t1 = Date.now();
console.log(`Transcript: ${lecture.lines.length} lines, ${cached ? 'from cache' : 'fetched (1 search)'} in ${((t1 - t0) / 1000).toFixed(1)}s`);
if (existsSync(new URL(`data/cards/${id}.json`, root))) console.log('Note: already in the map (data/cards); making a fresh card anyway');

const r = await makeCard(model, lecture, CARD_SYSTEM);
const secs = (Date.now() - t1) / 1000;
if (!r.card) { console.log(`Card failed after ${secs.toFixed(1)}s: ${r.problems.join(' | ')}`); process.exit(1); }
show(r.card, r.quotes);
console.log(`Card: ${secs.toFixed(1)}s, attempt ${r.attempts}${r.problems.length ? ` (retries: ${r.problems.join(' | ')})` : ''}`);

mkdirSync(new URL('data/demo/', root), { recursive: true });
writeFileSync(outFile, JSON.stringify({
  videoId: id, url, at: new Date().toISOString(), model, transcriptCached: cached, transcriptSec: (t1 - t0) / 1000, cardSec: secs,
  attempts: r.attempts, problems: r.problems, card: r.card, quotes: r.quotes,
}, null, 1));
