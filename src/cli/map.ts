// Build the knowledge map (Markdown, Obsidian-style links) from checked cards and the agents' decisions.
// No model here: code writes every line, and only quotes the checker found in the transcript are shown.
//   map/00 Today.md            what is in the map, newest lectures, concepts that span lectures
//   map/<Category>.md          one row per lecture, oldest first
//   map/concepts/<Concept>.md  what each lecture added about the concept, with verified quotes
// Usage: npx tsx src/cli/map.ts   (rebuilds map/ from scratch; then checks the result)
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { handleOf } from '../lib/channel.ts';

const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const FETCHED = new Date('2026-10-20T00:00:00Z'); // day data/videos.json was listed; its ages count back from here

const videos: any[] = read('data/videos.json');
const concepts: { videoId: string; name: string; concept: string; reason: string }[] = read('data/concepts.json').mentions;
// Names that differ only in case are one page (Windows file names ignore case); keep the first spelling.
const spelling = new Map<string, string>();
for (const m of concepts) m.concept = spelling.get(m.concept.toLowerCase()) ?? (spelling.set(m.concept.toLowerCase(), m.concept), m.concept);
const cats = read('data/categories.json');
const catOf = new Map<string, string>(cats.assignments.map((a: any) => [a.videoId, a.category]));
const cards = readdirSync(new URL('data/cards/', root)).filter(f => f.endsWith('.json')).map(f => read(`data/cards/${f}`));
const order = new Map(videos.map((v, i) => [v.videoId, i]));
cards.sort((a, b) => order.get(a.videoId)! - order.get(b.videoId)!); // oldest first (videos.json is oldest first)

const file = (name: string) => name.replace(/[\\/:*?"<>|#^[\]]/g, '-').trim();
const sec = (mmss: string) => mmss.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
const at = (c: any, mmss: string) => `[${mmss}](${c.url}&t=${sec(mmss)}s)`;
const date = (videoId: string) => {
  const v = videos.find(x => x.videoId === videoId);
  const d = new Date(FETCHED.getTime() - v.ageDays * 86400000);
  return `~${d.toISOString().slice(0, 10)}`; // YouTube only says "N weeks ago", so dates are approximate
};
const conceptsOf = (videoId: string) => [...new Set(concepts.filter(m => m.videoId === videoId).map(m => m.concept))];
const speakers = (c: any) => c.card.speakers.map((s: any) => s.org ? `${s.name} (${s.org})` : s.name).join(', ') || '—';
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const out = new URL('map/', root);
rmSync(out, { recursive: true, force: true });
mkdirSync(new URL('concepts/', out), { recursive: true });
const written: Record<string, string> = {};
const write = (path: string, text: string) => { written[path] = text; writeFileSync(new URL(path, out), text); };

// Category pages.
for (const cat of cats.categories) {
  const rows = cards.filter(c => catOf.get(c.videoId) === cat.name);
  write(`${file(cat.name)}.md`, [
    `# ${cat.name}`, '', cat.definition, '',
    `${rows.length} lectures, oldest first. Dates are approximate. "Key moments" jump to the verified quotes.`, '',
    '| Date | Lecture | Speakers | Length | Kind | Concepts | Key moments |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(c => `| ${date(c.videoId)} | [${cell(c.card.title)}](${c.url}) — ${cell(c.card.one_line)} | ${cell(speakers(c))} | ${c.length} | ${c.card.kind} | ${conceptsOf(c.videoId).map(n => `[[${file(n)}]]`).join(', ')} | ${c.card.claims.filter((_: any, i: number) => c.quotes[i].found).map((cl: any) => at(c, cl.at)).join(' ')} |`),
    '',
  ].join('\n'));
}

// Concept pages.
const byConcept = new Map<string, typeof concepts>();
for (const m of concepts) byConcept.set(m.concept, [...(byConcept.get(m.concept) ?? []), m]);
for (const [name, ms] of byConcept) {
  const lectures = cards.filter(c => ms.some(m => m.videoId === c.videoId));
  const related = new Map<string, number>();
  for (const c of lectures) for (const other of conceptsOf(c.videoId)) if (other !== name) related.set(other, (related.get(other) ?? 0) + 1);
  const sections = lectures.map(c => {
    const m = ms.find(x => x.videoId === c.videoId)!;
    const k = c.card.concepts.find((x: any) => x.name === m.name);
    const quotes = (k?.claim_ids ?? []).filter((i: number) => c.quotes[i]?.found).map((i: number) => `> "${c.card.claims[i].quote}" — ${at(c, c.card.claims[i].at)}`);
    return [
      `### ${date(c.videoId)} · [${c.card.title}](${c.url})`,
      k?.what ?? '',
      ...(quotes.length ? ['', ...quotes] : ['', '_No verified quote for this concept._']),
      ...(m.name !== name ? ['', `_Called "${m.name}" in this lecture; merged because: ${m.reason}_`] : []),
      '',
    ].join('\n');
  });
  write(`concepts/${file(name)}.md`, [
    `# ${name}`, '',
    `In ${lectures.length} lecture${lectures.length > 1 ? 's' : ''}. Categories: ${[...new Set(lectures.map(c => `[[${file(catOf.get(c.videoId)!)}]]`))].join(', ')}`, '',
    '## What the lectures add', '', ...sections,
    ...(related.size ? ['## Related', '', [...related].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n]) => `[[${file(n)}]]`).join(', '), ''] : []),
  ].join('\n'));
}

// Today page.
const newest = [...cards].reverse().slice(0, 5);
const spanning = [...byConcept].map(([n, ms]) => [n, new Set(ms.map(m => m.videoId)).size] as const).filter(([, k]) => k > 1).sort((a, b) => b[1] - a[1]);
write('00 Today.md', [
  '# Today', '',
  `The map holds ${cards.length} lectures from ${[...new Set(cards.map(c => handleOf(videos.find(v => v.videoId === c.videoId)?.channel)))].join(', ')} (${date(cards[0].videoId)} to ${date(cards.at(-1)!.videoId)}), ${byConcept.size} concepts and ${cats.categories.length} categories.`, '',
  '## Newest lectures', '',
  ...newest.map(c => `- [${c.card.title}](${c.url}) · ${c.length} · [[${file(catOf.get(c.videoId)!)}]] — ${c.card.one_line}`), '',
  '## Concepts that span lectures', '',
  ...spanning.map(([n, k]) => `- [[${file(n)}]] — ${k} lectures`), '',
  '## Categories', '',
  ...cats.categories.map((c: any) => `- [[${file(c.name)}]] (${cats.sizes[c.name]}) — ${c.definition}`), '',
].join('\n'));

// Checks: every lecture listed once, every shown quote verified, every link points at a page that exists.
const problems: string[] = [];
const catText = cats.categories.map((c: any) => written[`${file(c.name)}.md`]).join('\n');
for (const c of cards) {
  const n = catText.split(`(${c.url})`).length - 1;
  if (n !== 1) problems.push(`${c.videoId} appears ${n} times in category pages`);
}
const allQuotes = cards.flatMap(c => c.card.claims.map((cl: any, i: number) => ({ q: cl.quote, ok: c.quotes[i].found })));
const bad = allQuotes.filter(x => !x.ok && Object.values(written).some(t => t.includes(`"${x.q}"`)));
if (bad.length) problems.push(`${bad.length} unverified quotes shown`);
const pages = new Set(Object.keys(written).map(p => p.replace(/^concepts\//, '').replace(/\.md$/, '')));
const links = Object.values(written).flatMap(t => [...t.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]));
const dangling = [...new Set(links.filter(l => !pages.has(l)))];
if (dangling.length) problems.push(`links to missing pages: ${dangling.slice(0, 5).join(', ')}`);
console.log(`map/: ${Object.keys(written).length} files (${cats.categories.length} categories, ${byConcept.size} concepts); ${cards.length} lectures; quotes shown ${allQuotes.filter(x => x.ok).length} verified of ${allQuotes.length}`);
console.log(problems.length ? 'CHECK FAILED:\n- ' + problems.join('\n- ') : 'checks passed: each lecture once, only verified quotes, no dangling links');
