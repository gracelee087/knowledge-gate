// Receives YouTube push notifications (WebSub, hub https://pubsubhubbub.appspot.com) and starts processLecture.
//   GET  /websub  the hub checks a subscription: answer with hub.challenge, only for our channels' topics
//   POST /websub  a notification (Atom): checked with the shared secret (X-Hub-Signature, HMAC-SHA1);
//                 a new upload (not a Short) is added to data/videos.json and its workflow is started.
//                 Title or description edits of known videos are ignored.
//   GET  /health  for the watchdog and for people
// Usage: npx tsx src/server/webhook.ts   (env: PORT, default 8080; WEBSUB_SECRET)
import '../lib/env.ts';
import * as Sentry from '@sentry/node';
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { need } from '../lib/env.ts';
import { CHANNELS, TOPICS, parseAtom, addVideo, isShort, videos, wanted } from '../lib/channel.ts';
import { startLecture } from '../mastra/start.ts';

Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 1.0 });
const SECRET = need('WEBSUB_SECRET');
const PORT = Number(process.env.PORT ?? 8080);
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

const signed = (body: Buffer, header: string | undefined) => {
  const [algo, hex] = (header ?? '').split('=');
  if (algo !== 'sha1' || !hex) return false;
  const want = createHmac('sha1', SECRET).update(body).digest();
  const got = Buffer.from(hex, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
};

export async function onNotification(xml: string) {
  for (const e of parseAtom(xml)) {
    if (!CHANNELS.some(c => c.id === e.channelId)) { log('ignored: other channel', e.videoId); continue; }
    if (!wanted(e)) { log('ignored: older than the channel was added', e.videoId); continue; }
    if (videos().some(v => v.videoId === e.videoId)) { log('ignored: known video (an edit)', e.videoId); continue; }
    if (await isShort(e)) { log('ignored: a Short', e.videoId); continue; }
    addVideo(e);
    log('new upload', e.videoId, e.title);
    startLecture(e.videoId).then(() => log('workflow started', e.videoId))
      .catch(err => { log('workflow not started', e.videoId, String(err).slice(0, 200)); Sentry.captureException(err); });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') { res.end('ok'); return; }
  if (url.pathname !== '/websub') { res.statusCode = 404; res.end(); return; }
  if (req.method === 'GET') {
    const topic = url.searchParams.get('hub.topic'), challenge = url.searchParams.get('hub.challenge');
    if (!TOPICS.includes(topic ?? '') || !challenge) { res.statusCode = 404; res.end(); log('refused verification for', topic); return; }
    log(`verified ${url.searchParams.get('hub.mode')} ${topic?.split('=')[1]} (lease ${url.searchParams.get('hub.lease_seconds')} s)`);
    res.end(challenge);
    return;
  }
  if (req.method === 'POST') {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    // A notification without a valid signature is answered 2xx (as WebSub asks) but ignored.
    res.statusCode = 204; res.end();
    if (!signed(body, req.headers['x-hub-signature'] as string | undefined)) { log('ignored: bad signature'); return; }
    await onNotification(body.toString('utf8')).catch(err => { log('error', String(err)); Sentry.captureException(err); });
    return;
  }
  res.statusCode = 405; res.end();
});
server.listen(PORT, () => log(`webhook listening on :${PORT}`));
