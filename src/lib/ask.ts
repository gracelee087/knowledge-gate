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

const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
export const sec = (mmss: string) => mmss.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);

// Every claim of every card; a quote is shown only if it was found in the transcript.
type Claim = { key: string; title: string; url: string; claim: string; quote: string | null; at: string; concepts: string[] };
export type Source =
  | { id: string; kind: 'claim'; title: string; claim: string; quote: string | null; at: string; link: string }
  | { id: string; kind: 'note'; name: string }
  | { id: 'M'; kind: 'morning' };
export interface Answer { text: string; sources: Source[]; fake: string[]; claims: number; notes: number; model: string; seconds: number }

export async function ask(question: string, model = 'ollama/gemma4:12b', K = 8): Promise<Answer> {
  const t0 = Date.now();
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
  const notes = existsSync(notesDir) ? readdirSync(notesDir).filter(f => f.endsWith('.md') && !f.startsWith('00 ') && f !== 'README.md')
    .map(f => ({ name: f.replace(/\.md$/, ''), text: readFileSync(new URL(f, notesDir), 'utf8') })) : [];
  const morning = existsSync(new URL('00 Morning.md', notesDir)) ? readFileSync(new URL('00 Morning.md', notesDir), 'utf8') : '';

  const [qv, ...nv] = await embed(EMBED, [question, ...notes.map(n => n.text)]);
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

  const SYSTEM = `You answer one question for a person who follows AI lectures and keeps their own notes.
Use only the sources given: lecture claims [C1]..., the person's notes [N1]..., and today's morning page [M].
- Cite every point with the source ids in square brackets, e.g. [C2] or [N1].
- If the sources do not answer the question, say so plainly; do not add outside knowledge.
- When a lecture claim agrees with or contradicts the person's note, say which.
- Answer in the language of the question. Keep it short: a few sentences or a short list.`;
  const sources = [
    ...top.map((x, i) => `[C${i + 1}] "${x.c.title}" ${x.c.at}: ${x.c.claim}${x.c.quote ? ` (quote: "${x.c.quote}")` : ''}`),
    ...near.map((x, i) => `[N${i + 1}] my note "${x.n.name}":\n${x.n.text.slice(0, 3000)}`),
    ...(morning ? [`[M] today's morning page:\n${morning.slice(0, 2000)}`] : []),
  ].join('\n\n');
  const r = await chatRetry(model, SYSTEM, `Sources:\n${sources}\n\nQuestion: ${question}`);

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
