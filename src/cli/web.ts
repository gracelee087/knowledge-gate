// The local page: my notes (with what the morning merge appended) and a chat that asks src/lib/ask.ts.
// It listens on 127.0.0.1 only, the page loads nothing from the internet, and the models run in local Ollama,
// so it works with Wi-Fi off. Notes are only read.
// Usage: npx tsx src/cli/web.ts [--port 4321]   then open http://127.0.0.1:4321
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ask } from '../lib/ask.ts';

const root = new URL('../../', import.meta.url);
const arg = (name: string) => (process.argv.indexOf(name) > 0 ? process.argv[process.argv.indexOf(name) + 1] : null);
const PORT = Number(arg('--port') ?? 4321);
const MODELS = ['ollama/gemma4:12b', 'ollama/gemma4:e4b']; // 12b answers better, e4b about 3x faster (E13, E25)
const notesDir = new URL('notes/', root);

const send = (res: any, code: number, body: string, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(body);
};

// The category reports: per category, its concepts, and per concept what each talk added (claims with verified
// quotes and time links). Talks that arrived on the latest upload day are "new", so the page can mark them.
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const FETCHED = Date.parse('2026-10-20T00:00:00Z'); // as in map.ts: videos.json ages count back from this day
const sec = (mmss: string) => mmss.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
function report() {
  const videos: any[] = read('data/videos.json');
  const cats = read('data/categories.json');
  const catOf = new Map<string, string>(cats.assignments.map((a: any) => [a.videoId, a.category]));
  const local = (iso: string) => new Date(iso).toLocaleDateString('sv');
  const keys = existsSync(new URL('data/highlights.json', root)) ? read('data/highlights.json') : {}; // src/cli/highlight.ts
  const latest = videos.filter(v => v.published).map(v => local(v.published)).sort().at(-1) ?? '';
  const talks = new Map(readdirSync(new URL('data/cards/', root)).filter(f => f.endsWith('.json')).map(f => {
    const c = read(`data/cards/${f}`), v = videos.find(x => x.videoId === c.videoId);
    const date = v?.published ? local(v.published) : v ? new Date(FETCHED - v.ageDays * 86400000).toISOString().slice(0, 10) : '';
    return [c.videoId, {
      videoId: c.videoId, title: c.card.title, url: c.url, oneLine: c.card.one_line, summary: c.card.summary ?? null, keys: keys[c.videoId] ?? [], kind: c.card.kind, length: c.length,
      speakers: c.card.speakers.map((s: any) => s.org ? `${s.name} (${s.org})` : s.name).join(', '),
      category: catOf.get(c.videoId) ?? 'Other', date, approx: !v?.published, isNew: Boolean(v?.published) && local(v.published) === latest,
      claims: c.card.claims.map((cl: any, i: number) => ({ claim: cl.claim, at: cl.at, quote: c.quotes[i]?.found ? cl.quote : null, link: `${c.url}&t=${sec(cl.at)}s` })),
    }];
  }));
  // Concept names that differ only in case are one concept, as in map.ts.
  const spelling = new Map<string, string>();
  const mentions = read('data/concepts.json').mentions.filter((m: any) => talks.has(m.videoId)).map((m: any) => {
    const t = talks.get(m.videoId)!;
    const concept = spelling.get(m.concept.toLowerCase()) ?? (spelling.set(m.concept.toLowerCase(), m.concept), m.concept);
    return { concept, videoId: m.videoId, name: m.name, what: m.what, claims: t.claims.filter((c: any) => m.claims.includes(c.claim)) };
  });
  const skipped = existsSync(new URL('data/skipped.json', root)) ? read('data/skipped.json') : null;
  const noCard = videos.filter(v => v.published && !talks.has(v.videoId))
    .map(v => ({ videoId: v.videoId, title: v.title, date: local(v.published), reason: skipped ? skipped[v.videoId] ?? 'no reason recorded (still running, or failed before giving up)' : null }));
  const proposals = existsSync(PROPOSALS) ? JSON.parse(readFileSync(PROPOSALS, 'utf8')) : [];
  const watch = existsSync(WATCH) ? JSON.parse(readFileSync(WATCH, 'utf8')) : [];
  return { latest, talks: [...talks.values()], mentions, noCard, proposals, watch };
}

// Edit proposals from the morning merge: approving one replaces that one sentence in the note, and the notes'
// own git records it, so it can be undone. Nothing else in the note changes.
const PROPOSALS = new URL('notes/.proposals.json', root);
const notesGit = (...a: string[]) => execFileSync('git', ['-C', fileURLToPath(notesDir), ...a], { encoding: 'utf8' });
function decide(id: string, action: string) {
  const all = JSON.parse(readFileSync(PROPOSALS, 'utf8'));
  const p = all.find((x: any) => x.id === id);
  if (!p || p.status !== 'open') return 'no open proposal with that id';
  if (action === 'apply') {
    const f = new URL(`notes/${p.note}.md`, root), text = readFileSync(f, 'utf8');
    if (text.split(p.old).length !== 2) return 'the sentence is no longer in the note exactly once; nothing changed';
    writeFileSync(f, text.replace(p.old, () => p.revised));
  }
  p.status = action === 'apply' ? 'applied' : 'rejected';
  writeFileSync(PROPOSALS, JSON.stringify(all, null, 1));
  notesGit('add', '-A'); notesGit('commit', '-q', '-m', `${p.status} edit ${p.id} in ${p.note}`);
  return null;
}

// Talks to watch tonight, kept on the laptop.
const WATCH = new URL('data/watchlist.json', root);

createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') return send(res, 200, readFileSync(new URL('src/web/index.html', root), 'utf8'), 'text/html');
    if (req.method === 'GET' && req.url === '/api/notes') {
      const notes = existsSync(notesDir) ? readdirSync(notesDir).filter(f => f.endsWith('.md') && !f.startsWith('00 ') && f !== 'README.md')
        .map(f => ({ name: f.replace(/\.md$/, ''), text: readFileSync(new URL(f, notesDir), 'utf8') })) : [];
      const cards = readdirSync(new URL('data/cards/', root)).filter(f => f.endsWith('.json')).length;
      // The map's categories, so the page can file each appended note line under its lecture's category.
      const c = JSON.parse(readFileSync(new URL('data/categories.json', root), 'utf8'));
      const categories = c.categories.map((k: any) => ({ name: k.name, definition: k.definition, size: c.sizes[k.name] ?? 0 }));
      const category = Object.fromEntries(c.assignments.map((a: any) => [a.videoId, a.category]));
      // When the morning routine last downloaded the server's cards from MongoDB Atlas (written by sync.ts pull).
      const PULL = new URL('data/last_pull.json', root);
      const pulled = existsSync(PULL) ? JSON.parse(readFileSync(PULL, 'utf8')).at : null;
      // Uploads the server got by push (they carry "published"), and whether each became a card.
      // One without a card was skipped (e.g. narrated in Korean) or failed; the laptop can't tell which.
      const arrivals = JSON.parse(readFileSync(new URL('data/videos.json', root), 'utf8')).filter((v: any) => v.published)
        .map((v: any) => ({ videoId: v.videoId, title: v.title, published: v.published, card: existsSync(new URL(`data/cards/${v.videoId}.json`, root)) }));
      return send(res, 200, JSON.stringify({ notes, cards, models: MODELS, categories, category, pulled, arrivals, today: new Date().toLocaleDateString('sv') }));
    }
    if (req.method === 'GET' && req.url === '/api/report') return send(res, 200, JSON.stringify(report()));
    if (req.method === 'GET' && req.url === '/api/ollama') {
      // Is local Ollama up, and which models does it have? (127.0.0.1 only)
      const r = await fetch('http://127.0.0.1:11434/api/tags').then(r => r.json()).catch(() => null);
      return send(res, 200, JSON.stringify({ up: Boolean(r), models: r?.models?.map((m: any) => m.name) ?? [] }));
    }
    if (req.method === 'POST' && req.url === '/api/ask') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { question, model } = JSON.parse(body);
      if (typeof question !== 'string' || !question.trim() || question.length > 500) return send(res, 400, JSON.stringify({ error: 'question: 1 to 500 characters' }));
      if (!MODELS.includes(model)) return send(res, 400, JSON.stringify({ error: `model: one of ${MODELS.join(', ')}` }));
      return send(res, 200, JSON.stringify(await ask(question.trim(), model)));
    }
    if (req.method === 'POST' && (req.url === '/api/proposal' || req.url === '/api/watch')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const b = JSON.parse(body);
      if (req.url === '/api/proposal') {
        if (!['apply', 'reject'].includes(b.action)) return send(res, 400, JSON.stringify({ error: 'action: apply or reject' }));
        const err = decide(String(b.id), b.action);
        return send(res, err ? 409 : 200, JSON.stringify(err ? { error: err } : { ok: true }));
      }
      const list: string[] = existsSync(WATCH) ? JSON.parse(readFileSync(WATCH, 'utf8')) : [];
      const next = b.on ? [...new Set([...list, String(b.videoId)])] : list.filter(v => v !== b.videoId);
      writeFileSync(WATCH, JSON.stringify(next));
      return send(res, 200, JSON.stringify({ watch: next }));
    }
    send(res, 404, JSON.stringify({ error: 'not found' }));
  } catch (e: any) {
    send(res, 500, JSON.stringify({ error: String(e?.message ?? e) }));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`lecture-gate on this laptop: http://127.0.0.1:${PORT}`));
