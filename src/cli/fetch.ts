// Fetch transcripts for data/videos.json (oldest first), limited to videos younger than N days.
import { readFileSync } from 'node:fs';
import { transcript, searchesSpent } from '../lib/serpapi.ts';

const maxDays = Number(process.argv[2] ?? 30);
const videos = JSON.parse(readFileSync(new URL('../../data/videos.json', import.meta.url), 'utf8'))
  .filter((v: any) => v.ageDays < maxDays);
let ok = 0, empty = 0;
for (const v of videos) {
  try {
    const t = await transcript(v.videoId);
    if (t.segments.length) ok++; else { empty++; console.log('no transcript:', v.videoId); }
  } catch (e) {
    empty++; console.log('error:', v.videoId, (e as Error).message);
  }
}
console.log(`${videos.length} videos: ${ok} with transcript, ${empty} without; SerpApi searches spent: ${searchesSpent}`);
