// Watchdog, run every few hours: catches what the webhook missed.
//   1. renews the hub subscription (leases run out)
//   2. reads every channel's feed (free, no key): uploads not in data/videos.json are added (Shorts are skipped)
//   3. starts processLecture for every new-era lecture (one with a "published" date) that is not on the map yet and
//      was not skipped (narrated in Korean). A lecture whose run is still going is not started twice (Temporal ids).
//      This also retries a lecture whose transcript was not ready the first time; after 3 restarts it gives up.
//   4. checks that the webhook answers
// Usage: npx tsx src/cli/watchdog.ts [--no-subscribe]
import '../lib/env.ts';
import * as Sentry from '@sentry/node';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CHANNELS, feed, addVideo, videos, wanted } from '../lib/channel.ts';
import { subscribe } from './subscribe.ts';
import { startLecture } from '../mastra/start.ts';

Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 1.0 });
const card = (id: string, ext: string) => existsSync(new URL(`../../data/cards/${id}.${ext}`, import.meta.url));
const problems: string[] = [];

if (!process.argv.includes('--no-subscribe')) console.log(await subscribe().catch(e => { problems.push(`subscribe: ${e}`); return 'subscribe failed'; }));
for (const c of CHANNELS) {
  try {
    const added = (await feed(c.id)).filter(e => !e.short && wanted(e)).filter(addVideo);
    console.log(`feed ${c.handle}: ${added.length} new uploads ${added.map(e => e.videoId).join(' ')}`);
  } catch (e) { problems.push(`feed ${c.handle}: ${e}`); }
}

// A lecture that keeps failing (no transcript ever, or a card that never passes) is given up after MAX_TRIES
// restarts, so it does not use SerpApi searches every 6 hours forever. The count is kept in <id>.tries.
const MAX_TRIES = 3;
const cardFile = (id: string, ext: string) => new URL(`../../data/cards/${id}.${ext}`, import.meta.url);
// A lecture is done when addToMap gave it a category (src/agent/incremental.ts writes data/categories.json). One with
// a card but no category is started again: the transcript is cached and cards.ts skips the card, so only addToMap runs.
// (incremental.ts then rebuilds the map and pushes everything, so a failed map.ts or push is redone by the next lecture.)
const mapped = new Set(JSON.parse(readFileSync(new URL('../../data/categories.json', import.meta.url), 'utf8')).assignments.map((a: any) => a.videoId));
for (const v of videos().filter(v => v.published && v.kind !== 'paper' && !mapped.has(v.videoId) && !card(v.videoId, 'skipped.txt'))) {
  const tries = card(v.videoId, 'tries') ? Number(readFileSync(cardFile(v.videoId, 'tries'), 'utf8')) : 0;
  if (tries >= MAX_TRIES) {
    writeFileSync(cardFile(v.videoId, 'skipped.txt'), `gave up after ${tries} tries`);
    problems.push(`gave up on ${v.videoId} after ${tries} tries`);
    console.log(`gave up ${v.videoId}`);
    continue;
  }
  try { await startLecture(v.videoId); writeFileSync(cardFile(v.videoId, 'tries'), String(tries + 1)); console.log(`started ${v.videoId} (try ${tries + 1})`); }
  catch (e) { console.log(`not started ${v.videoId}: ${String(e).slice(0, 120)}`); } // usually: already running
}

const port = process.env.PORT ?? '8080';
const health = await fetch(`http://localhost:${port}/health`).then(r => r.ok).catch(() => false);
if (!health) problems.push('webhook does not answer');
for (const p of problems) Sentry.captureMessage(`watchdog: ${p}`, 'error');
console.log(problems.length ? `PROBLEMS: ${problems.join('; ')}` : 'watchdog: ok');
await Sentry.flush(10000);
process.exit(0);
