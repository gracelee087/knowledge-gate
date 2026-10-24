// Overview of fetched lectures: length, transcript size, chapters, title tags.
import { readFileSync, existsSync } from 'node:fs';

const videos = JSON.parse(readFileSync(new URL('../../data/videos.json', import.meta.url), 'utf8')).filter((v: any) => v.ageDays < 30);
const rows = [];
for (const v of videos) {
  const f = new URL(`../../data/cache/transcript_${v.videoId}.json`, import.meta.url);
  if (!existsSync(f)) { rows.push({ ...v, words: 0, chapters: 0 }); continue; }
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const words = (d.transcript ?? []).reduce((s: number, x: any) => s + x.snippet.split(/\s+/).length, 0);
  rows.push({ ...v, words, chapters: (d.chapters ?? []).length });
}
const withT = rows.filter(r => r.words);
const tags: Record<string, number> = {};
for (const r of rows) for (const t of r.title.match(/^\[[^\]]+\]/g) ?? ['(none)']) tags[t] = (tags[t] ?? 0) + 1;
const sorted = withT.map(r => r.words).sort((a, b) => a - b);
console.log(`lectures ${rows.length}, with transcript ${withT.length}, with chapters ${withT.filter(r => r.chapters).length}`);
console.log(`words: total ${sorted.reduce((a, b) => a + b, 0)}, median ${sorted[sorted.length >> 1]}, max ${sorted.at(-1)}`);
console.log('title tags:', tags);
console.log('oldest 5 / newest 3:');
for (const r of [...rows.slice(0, 5), ...rows.slice(-3)]) console.log(` ${r.publishedText} | ${r.length} | ${r.words}w | ch ${r.chapters} | ${r.title.slice(0, 70)}`);
