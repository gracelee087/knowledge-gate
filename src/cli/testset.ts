// Pick a test set of 10 and a held-out set of 5, spread evenly across transcript length.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const videos = JSON.parse(readFileSync(new URL('../../data/videos.json', import.meta.url), 'utf8')).filter((v: any) => v.ageDays < 30);
const withLen = videos.flatMap((v: any) => {
  const f = new URL(`../../data/cache/transcript_${v.videoId}.json`, import.meta.url);
  if (!existsSync(f)) return [];
  const words = JSON.parse(readFileSync(f, 'utf8')).transcript.reduce((s: number, x: any) => s + x.snippet.split(/\s+/).length, 0);
  return [{ videoId: v.videoId, title: v.title, length: v.length, words }];
}).sort((a: any, b: any) => a.words - b.words);
// Every 5th lecture by length: positions 0,5,10,... -> 15 picks; alternate them into test (10) and held-out (5).
const picks = withLen.filter((_: any, i: number) => i % 5 === 2).slice(0, 15);
const test = picks.filter((_: any, i: number) => i % 3 !== 2);
const holdout = picks.filter((_: any, i: number) => i % 3 === 2);
writeFileSync(new URL('../../data/testset.json', import.meta.url), JSON.stringify({ test, holdout }, null, 1));
for (const [name, set] of [['TEST', test], ['HOLDOUT', holdout]] as const) {
  console.log(name);
  for (const v of set) console.log(` ${v.videoId} | ${v.length} | ${v.words}w | ${v.title.slice(0, 60)}`);
}
