// List a channel's videos back to a cutoff (default ~3 months), oldest first, into data/videos.json.
import { writeFileSync } from 'node:fs';
import { channelPage, searchesSpent, type ChannelVideo } from '../lib/serpapi.ts';

const handle = process.argv[2] ?? '@TechBridge-KR';
const maxDays = Number(process.argv[3] ?? 92);
const maxPages = Number(process.argv[4] ?? 6);

// "3 weeks ago" -> 21. Month/year are approximate (30/365 days).
function ageDays(text: string): number {
  const m = /(\d+)\s+(second|minute|hour|day|week|month|year)/.exec(text ?? '');
  if (!m) return NaN;
  const per = { second: 0, minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365 }[m[2] as 'day'];
  return Number(m[1]) * per;
}

const all: (ChannelVideo & { ageDays: number })[] = [];
let token: string | undefined;
for (let page = 0; page < maxPages; page++) {
  const { videos, next } = await channelPage(handle, token);
  for (const v of videos) all.push({ ...v, ageDays: ageDays(v.publishedText) });
  const oldest = all.at(-1)?.ageDays ?? 0;
  console.log(`page ${page + 1}: ${videos.length} videos, oldest so far "${all.at(-1)?.publishedText}"`);
  if (!next || oldest > maxDays) break;
  token = next;
}

const inRange = all.filter(v => v.ageDays <= maxDays).reverse();
writeFileSync(new URL('../../data/videos.json', import.meta.url), JSON.stringify(inRange, null, 1));
const minutes = inRange.reduce((s, v) => s + v.length.split(':').map(Number).reduce((a, b) => a * 60 + b, 0), 0) / 60;
console.log(`${inRange.length} videos within ${maxDays} days, ${(minutes / 60).toFixed(1)} hours total; SerpApi searches spent: ${searchesSpent}`);
