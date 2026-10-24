// Ask: a question about the lectures and my notes, answered on the laptop by a local model.
//   1. the question, every lecture claim and every note are embedded with local embeddinggemma
//      (claim vectors are cached in data/ask_vectors.json; data/ stays on the laptop)
//   2. the closest claims (top K) and the closest notes (cosine >= NEAR, at most 2) plus today's 00 Morning.md
//      go to the local model, which may answer only from them and must cite them as [C1], [N1], [M]
//   3. code keeps only citations that exist; each cited claim comes back with its verified quote and time link
// Notes are only read, never written. Nothing leaves the laptop.
// Used by src/cli/ask.ts (terminal) and src/cli/web.ts (the local page).
import './env.ts';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chatRetry } from './llm.ts';
import { embed, cosine } from './embed.ts';

const root = new URL('../../', import.meta.url);
export const NEAR = 0.45, EMBED = 'ollama/embeddinggemma'; // same model and threshold as the morning merge (E26)
export const NOT_FOUND = "There's nothing on that in your notes yet. I've noted your question, and I'll let you know when related material comes in!";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
export const sec = (mmss: string) => mmss.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);

// Every claim of every card; a quote is shown only if it was found in the transcript.
type Claim = { key: string; title: string; url: string; claim: string; quote: string | null; at: string; concepts: string[] };
export type Source =
  | { id: string; kind: 'claim'; title: string; claim: string; quote: string | null; at: string; link: string }
  | { id: string; kind: 'note'; name: string }
  | { id: 'M'; kind: 'morning' };
export interface Answer { text: string; sources: Source[]; fake: string[]; claims: number; notes: number; model: string; seconds: number }

// The closest lecture claims (top K) and notes (cosine >= NEAR, at most 2) to the question, with their scores.
const noteVec = new Map<string, number[]>();
async function search(question: string, K: number) {
  const claims: Claim[] = readdirSync(new URL('data/cards/', root)).filter(f => f.endsWith('.json')).flatMap(f => {
    const c = read(`data/cards/${f}`);
    return c.card.claims.map((cl: any, i: number) => ({
      key: `${c.videoId}#${i}`, title: c.card.title, url: c.url, claim: cl.claim, at: cl.at,
      quote: c.quotes[i]?.found ? cl.quote : null,
      concepts: c.card.concepts.filter((k: any) => k.claim_ids.includes(i)).map((k: any) => k.name),
    }));
  });

  // Claim vectors: embed only the claims not cached yet.
  const CACHE = new URL('data/ask_vectors.json', root);
  const cache: Record<string, number[]> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
  const missing = claims.filter(c => !cache[c.key]);
  if (missing.length) {
    const v = await embed(EMBED, missing.map(c => c.claim));
    missing.forEach((c, i) => { cache[c.key] = v[i]; });
    writeFileSync(CACHE, JSON.stringify(cache));
  }

  const notesDir = new URL('notes/', root);
  // My own notes only: the generated pages (Hackathons, Travel, Me from the CV) are not "what I wrote"; their data is
  // answered by quick.ts. notes/sections/ holds lecture claims, which the claim search already covers.
  const notes = existsSync(notesDir) ? readdirSync(notesDir).filter(f => f.endsWith('.md') && !f.startsWith('00 ') && !['README.md', 'Hackathons.md', 'Travel.md', 'Me.md'].includes(f))
    .map(f => ({ name: f.replace(/\.md$/, ''), text: readFileSync(new URL(f, notesDir), 'utf8') })) : [];
  const morning = existsSync(new URL('00 Morning.md', notesDir)) ? readFileSync(new URL('00 Morning.md', notesDir), 'utf8') : '';

  // Note vectors are kept in memory by note text, so a repeated ask embeds only the question and changed notes.
  const fresh = notes.filter(n => !noteVec.has(n.text));
  const [qv, ...fv] = await embed(EMBED, [question, ...fresh.map(n => n.text)]);
  fresh.forEach((n, i) => noteVec.set(n.text, fv[i]));
  const nv = notes.map(n => noteVec.get(n.text)!);
  // A note named in the question comes first (as in the morning merge, words before meaning), then the closest by meaning.
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const named = notes.filter(n => ` ${norm(question)} `.includes(` ${norm(n.name)} `));
  // Claims about a concept named in the question come first, then the closest by meaning.
  const byName = claims.filter(c => c.concepts.some(k => k.length >= 4 && ` ${norm(question)} `.includes(` ${norm(k)} `)));
  const top = [
    ...byName.map(c => ({ c, s: 1 })),
    ...claims.filter(c => !byName.includes(c)).map(c => ({ c, s: cosine(qv, cache[c.key]) })).sort((a, b) => b.s - a.s),
  ].slice(0, K);
  const near = [
    ...named.map(n => ({ n, s: 1 })),
    ...notes.map((n, i) => ({ n, s: cosine(qv, nv[i]) })).filter(x => x.s >= NEAR && !named.includes(x.n)).sort((a, b) => b.s - a.s),
  ].slice(0, 2);

  return { claims, top, near, morning };
}

export async function ask(question: string, model = 'ollama/gemma4:12b', K = 8): Promise<Answer> {
  const t0 = Date.now();
  const { claims, top, near, morning } = await search(question, K);
  const SYSTEM = `You answer one question for a person who follows AI lectures and keeps their own notes.
Use only the sources given: lecture claims [C1]..., the person's notes [N1]..., and today's morning page [M].
- Cite every point with the source ids in square brackets, e.g. [C2] or [N1].
- If the sources do not answer the question, reply with exactly NOT_IN_NOTES and nothing else; do not add outside knowledge.
- When a lecture claim agrees with or contradicts the person's note, say which.
- Answer in the language of the question. Keep it short: a few sentences or a short list.`;
  const sources = [
    ...top.map((x, i) => `[C${i + 1}] "${x.c.title}" ${x.c.at}: ${x.c.claim}${x.c.quote ? ` (quote: "${x.c.quote}")` : ''}`),
    ...near.map((x, i) => `[N${i + 1}] my note "${x.n.name}":\n${x.n.text.slice(0, 3000)}`),
    ...(morning ? [`[M] today's morning page:\n${morning.slice(0, 2000)}`] : []),
  ].join('\n\n');
  const r = await chatRetry(model, SYSTEM, `Sources:\n${sources}\n\nQuestion: ${question}`);
  // Not in the sources: one fixed reply, and the question is kept in data/open_questions.json (on the laptop).
  if (/NOT_IN_NOTES/.test(r.text)) {
    const OPEN = new URL('data/open_questions.json', root);
    const open: { question: string; at: string }[] = existsSync(OPEN) ? JSON.parse(readFileSync(OPEN, 'utf8')) : [];
    writeFileSync(OPEN, JSON.stringify([...open, { question, at: new Date().toISOString() }], null, 1));
    return { text: NOT_FOUND, sources: [], fake: [], claims: claims.length, notes: near.length, model, seconds: Math.round((Date.now() - t0) / 1000) };
  }

  // Only citations that exist count.
  const cited = [...new Set([...r.text.matchAll(/\[([^\]]+)\]/g)].flatMap(m => m[1].split(/[,\s]+/)).filter(id => /^(C\d+|N\d+|M)$/.test(id)))]; // [C1], [N1, C3]
  const real = cited.filter(id => id === 'M' ? Boolean(morning) : Number(id.slice(1)) >= 1 && Number(id.slice(1)) <= (id[0] === 'C' ? top.length : near.length));
  return {
    text: r.text.trim(),
    sources: real.map((id): Source => {
      if (id === 'M') return { id: 'M', kind: 'morning' };
      if (id[0] === 'N') return { id, kind: 'note', name: near[Number(id.slice(1)) - 1].n.name };
      const c = top[Number(id.slice(1)) - 1].c;
      return { id, kind: 'claim', title: c.title, claim: c.claim, quote: c.quote, at: c.at, link: `${c.url}&t=${sec(c.at)}s` };
    }),
    fake: cited.filter(id => !real.includes(id)),
    claims: claims.length, notes: near.length, model, seconds: Math.round((Date.now() - t0) / 1000),
  };
}

// A spoken question about the notes, answered by code from the search alone (no model), so it comes back in seconds:
// the start of the closest note in my own words, then up to 2 close lecture claims with their verified quotes.
// Nothing close enough: the NOT_FOUND reply, and the question is kept in data/open_questions.json.
export const CLAIM_NEAR = 0.55;
export async function recall(question: string): Promise<Answer> {
  const t0 = Date.now();
  const { claims, top, near } = await search(question, 8);
  const n = near[0]?.n, cs = top.filter(x => x.s >= CLAIM_NEAR).slice(0, 2);
  const done = (text: string, sources: Source[]) => ({ text, sources, fake: [], claims: claims.length, notes: n ? 1 : 0, model: 'search only, no model', seconds: Math.round((Date.now() - t0) / 1000) });
  if (!n && !cs.length) {
    const OPEN = new URL('data/open_questions.json', root);
    const open: { question: string; at: string }[] = existsSync(OPEN) ? JSON.parse(readFileSync(OPEN, 'utf8')) : [];
    writeFileSync(OPEN, JSON.stringify([...open, { question, at: new Date().toISOString() }], null, 1));
    return done(NOT_FOUND, []);
  }
  // My own words: the lines before the first "## " heading, without the title.
  const mine = n ? n.text.split('\n## ')[0].split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 2).join(' ') : '';
  const text = [
    ...(n ? [`In your note "${n.name}", you wrote: ${mine} [N1]`] : []),
    ...cs.map((x, i) => `${i ? 'And' : 'From the lectures'}: "${x.c.title}" says ${x.c.claim} [C${i + 1}]`),
  ].join('\n\n');
  return done(text, [
    ...(n ? [{ id: 'N1', kind: 'note' as const, name: n.name }] : []),
    ...cs.map((x, i): Source => ({ id: `C${i + 1}`, kind: 'claim', title: x.c.title, claim: x.c.claim, quote: x.c.quote, at: x.c.at, link: `${x.c.url}&t=${sec(x.c.at)}s` })),
  ]);
}

// "Tell me more about the A/B testing in today's talk": the newest talk's claims closest to the question, read in order
// of the talk with their verified quotes and times (no model). `url` is the talk (from quick.ts latest).
export async function deeper(question: string, url: string): Promise<Answer> {
  const t0 = Date.now();
  const { claims, top } = await search(question, 100000);
  const picked = top.filter(x => x.c.url === url).slice(0, 3).sort((a, b) => sec(a.c.at) - sec(b.c.at));
  if (!picked.length) return recall(question);
  const text = [`In "${picked[0].c.title}":`, ...picked.map((x, i) => `At ${x.c.at}, ${x.c.claim}${x.c.quote ? ` In the speaker's words: "${x.c.quote}"` : ''} [C${i + 1}]`)].join('\n\n');
  return {
    text, fake: [], claims: claims.length, notes: 0, model: 'search only, no model', seconds: Math.round((Date.now() - t0) / 1000),
    sources: picked.map((x, i): Source => ({ id: `C${i + 1}`, kind: 'claim', title: x.c.title, claim: x.c.claim, quote: x.c.quote, at: x.c.at, link: `${x.c.url}&t=${sec(x.c.at)}s` })),
  };
}
