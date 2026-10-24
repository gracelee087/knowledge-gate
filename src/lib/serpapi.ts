// SerpApi client for YouTube. Every response is cached on disk: the free plan has 250 searches a month,
// so a repeated run must never spend a search twice.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { need } from './env.ts';

const CACHE = new URL('../../data/cache/', import.meta.url);
mkdirSync(CACHE, { recursive: true });

export let searchesSpent = 0;

// keep: whether a response is worth caching (an empty transcript is not: it may be ready on the next try).
async function search(params: Record<string, string>, cacheKey: string, keep = (body: any) => true): Promise<any> {
  const file = new URL(`${cacheKey}.json`, CACHE);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const url = new URL('https://serpapi.com/search.json');
  for (const [k, v] of Object.entries({ ...params, api_key: need('SERPAPI_API_KEY') })) url.searchParams.set(k, v);
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`SerpApi ${params.engine}: ${body.error ?? res.status}`);
  searchesSpent++;
  delete body.search_parameters?.api_key;
  if (keep(body)) writeFileSync(file, JSON.stringify(body));
  return body;
}

// Google Flights, at most one search per route, dates and day (the cache key carries today's date).
export const googleFlights = (p: { departure_id: string; arrival_id: string; outbound_date: string; return_date?: string; adults?: string }) =>
  search({ engine: 'google_flights', currency: 'EUR', hl: 'en', type: p.return_date ? '1' : '2', adults: '1', ...p } as Record<string, string>,
    `flights_${p.departure_id}_${p.arrival_id}_${p.outbound_date}_${p.return_date ?? 'oneway'}_${new Date().toISOString().slice(0, 10)}`);
// Searches left this month (the account endpoint does not spend one).
export const searchesLeft = async () => (await (await fetch(`https://serpapi.com/account.json?api_key=${need('SERPAPI_API_KEY')}`)).json()).total_searches_left as number;

export interface ChannelVideo {
  videoId: string;
  title: string;
  length: string;
  views: number | null;
  publishedText: string; // relative, e.g. "3 weeks ago"
}

// One page of a channel's videos, newest first.
export async function channelPage(handle: string, pageToken?: string) {
  const params: Record<string, string> = { engine: 'youtube_channel', channel_id: handle, sort: 'latest' };
  if (pageToken) params.next_page_token = pageToken;
  const key = `channel_${handle}_${pageToken ? pageToken.slice(-24).replace(/[^A-Za-z0-9]/g, '') : 'first'}`;
  const body = await search(params, key);
  const videos: ChannelVideo[] = (body.videos_results ?? []).map((v: any) => ({
    videoId: v.video_id,
    title: v.title,
    length: v.length,
    views: v.extracted_views ?? null,
    publishedText: v.published_date,
  }));
  return { videos, next: body.serpapi_pagination?.next_page_token as string | undefined };
}

export interface Segment { startMs: number; text: string }
export interface Transcript { videoId: string; segments: Segment[]; chapters: { title: string; startMs: number }[] }

export async function transcript(videoId: string): Promise<Transcript> {
  const body = await search(
    { engine: 'youtube_video_transcript', v: videoId, language_code: 'en', type: 'asr' },
    `transcript_${videoId}`,
    body => Boolean(body.transcript?.length),
  );
  return {
    videoId,
    segments: (body.transcript ?? []).map((s: any) => ({ startMs: s.start_ms, text: s.snippet })),
    chapters: (body.chapters ?? []).map((c: any) => ({ title: c.chapter, startMs: c.start_ms })),
  };
}
