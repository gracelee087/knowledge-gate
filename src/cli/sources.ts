// Text sources besides the talks: new arXiv papers become the same checked cards.
// A post is cut into paragraphs and given to the card writer like a transcript (one "line" per paragraph);
// a quote is kept only if it is word for word in the post, exactly as for a talk. Papers: the abstract only.
// Each line gets a reading time (200 words a minute), so the claim count scales with length as it does for talks.
// Public text only, so the cloud model may read it; the merge into the notes still runs on the laptop.
// Writes data/cards/<id>.json and adds the item to data/videos.json, so merge.ts and the page pick it up.
// Usage: npx tsx src/cli/sources.ts [--n 2] [--model do/gemma-4-31B-it] [--only paper]
import '../lib/env.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { makeCard, CARD_SYSTEM, CARD_VERSION } from '../lib/card.ts';
import type { Lecture } from '../lib/transcript.ts';

const root = new URL('../../', import.meta.url);
const arg = (name: string) => (process.argv.indexOf(name) > 0 ? process.argv[process.argv.indexOf(name) + 1] : null);
// gemini/gemma-4-26b-a4b-it answered HTTP 400 INVALID_ARGUMENT on 2026-10-24, so the server's model is the default.
const N = Number(arg('--n') ?? 2), model = arg('--model') ?? 'do/gemma-4-31B-it', only = arg('--only');
const UA = { 'User-Agent': 'lecture-gate/0.1 (personal notes; github.com/gracelee087/knowledge-gate)' };
const get = async (u: string) => { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.text(); };

const unescape = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');
const tag = (x: string, t: string) => x.match(new RegExp(`<${t}(?:\\s[^>]*)?>([^]*?)</${t}>`))?.[1] ?? '';
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
// Paragraphs: block tags end one; very long ones are cut at sentence ends so a quote can be found in a window.
const paragraphs = (html: string) => unescape(html).split(/<\/(?:p|li|h[1-6]|blockquote|pre)>|<br\s*\/?>/i).map(text).filter(p => p.split(' ').length >= 4)
  .flatMap(p => (p.length > 600 ? p.match(/[^.!?]+[.!?]+\S*\s*/g) ?? [p] : [p])).map(s => s.trim()).filter(Boolean);

type Item = { id: string; kind: 'paper'; source: string; title: string; url: string; published: string; body: string };
const feed = (xml: string, item: string) => xml.split(`<${item}`).slice(1).map(e => ({
  title: text(unescape(tag(e, 'title'))), url: e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? text(tag(e, 'link')),
  published: tag(e, 'published') || tag(e, 'updated') || tag(e, 'pubDate'), body: tag(e, 'content:encoded') || tag(e, 'content') || tag(e, 'summary') || tag(e, 'description'),
}));
const slug = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(-60);
// A blog (Simon Willison) and a newsletter (Latent Space) were tried and left out on 2026-10-24: posts of 20k-105k
// characters, much of it overlapping the talks. The feed reader above works for both if they come back.
const SOURCES: Record<Item['kind'], () => Promise<Item[]>> = {
  paper: async () => feed(await get('https://export.arxiv.org/api/query?search_query=(cat:cs.AI+OR+cat:cs.CL)+AND+abs:agent&sortBy=submittedDate&sortOrder=descending&max_results=10'), 'entry')
    .map(x => ({ ...x, body: `<p>${x.body}</p>`, id: `arxiv-${slug(x.url)}`, kind: 'paper' as const, source: 'arXiv (abstract)' })),
};

const videosFile = new URL('data/videos.json', root);
const videos: any[] = JSON.parse(readFileSync(videosFile, 'utf8'));
let made = 0;
for (const kind of Object.keys(SOURCES) as Item['kind'][]) {
  if (only && only !== kind) continue;
  let items: Item[];
  try { items = await SOURCES[kind](); } catch (e) { console.log(`${kind}: ${(e as Error).message}`); continue; }
  for (const it of items.filter(x => !existsSync(new URL(`data/cards/${x.id}.json`, root))).slice(0, N)) {
    const paras = paragraphs(it.body);
    let ms = 0;
    const lecture: Lecture = { videoId: it.id, title: it.title, chapters: [], lines: paras.map(p => { const line = { ms, text: p }; ms += p.split(' ').length * 300; return line; }) };
    if (!lecture.lines.length) { console.log(`${it.id}: no text`); continue; }
    const r = await makeCard(model, lecture, CARD_SYSTEM);
    if (!r.card) { console.log(`${it.id}: no card (${r.problems.join('; ')})`); continue; }
    const found = r.quotes.filter(q => q.found).length;
    writeFileSync(new URL(`data/cards/${it.id}.json`, root), JSON.stringify({
      videoId: it.id, url: it.url, kind: it.kind, source: it.source, length: `${Math.round(ms / 60000)} min read`,
      model, prompt: CARD_VERSION, attempts: r.attempts, problems: r.problems, ms: r.ms, card: { ...r.card, title: it.title }, quotes: r.quotes,
    }, null, 1));
    if (!videos.some(v => v.videoId === it.id)) videos.push({ videoId: it.id, title: it.title, kind: it.kind, source: it.source, url: it.url, published: new Date(it.published).toISOString() });
    made++;
    console.log(`${kind} ${it.id}: ${r.card.claims.length} claims, ${found} quotes found word for word, ${paras.length} paragraphs, ${(r.ms / 1000).toFixed(0)} s`);
  }
}
writeFileSync(videosFile, JSON.stringify(videos, null, 1));
console.log(`${made} new cards from text sources (model ${model})`);
