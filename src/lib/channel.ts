// The channels we follow, their Atom feeds (free, no key) and the list of known videos (data/videos.json).
import { readFileSync, writeFileSync } from 'node:fs';

export const CHANNELS = [
  { id: 'UC895rbZX2iXLTDfji7W4PfA', handle: '@TechBridge-KR' }, // English talks with Korean subtitles; the first map
  { id: 'UCLKPca3kwwd-B59HNr-_lvA', handle: '@aiDotEngineer', since: '2026-10-21T00:00:00Z' }, // AI Engineer conference talks, about 5 a day (2026-10-21)
  { id: 'UC4ZVkG3RQPzvZk7alIVjcCg', handle: '@SandeepSwadia', since: '2026-10-21T00:00:00Z' }, // added by the user 2026-10-21
] as { id: string; handle: string; since?: string }[];
// A channel's uploads from before `since` are not taken (its feed's back catalogue would start many runs at once).
export const wanted = (e: { channelId: string; published: string }) => {
  const since = CHANNELS.find(c => c.id === e.channelId)?.since;
  return !since || Date.parse(e.published) >= Date.parse(since);
};
export const CHANNEL_ID = CHANNELS[0].id;
export const topicOf = (channelId: string) => `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;
export const TOPICS = CHANNELS.map(c => topicOf(c.id));
export const TOPIC = TOPICS[0];
export const handleOf = (channelId?: string) => CHANNELS.find(c => c.id === channelId)?.handle ?? '@TechBridge-KR'; // videos listed before 2026-10-21 have no channel
const VIDEOS = new URL('../../data/videos.json', import.meta.url);
const FETCHED = Date.parse('2026-10-20T00:00:00Z'); // ageDays in videos.json count back from this day (see map.ts)

export type Entry = { videoId: string; channelId: string; title: string; published: string; short: boolean };

// Entries of an Atom document: the channel feed and the hub's push notifications use the same format.
// In the feed a Short links to /shorts/<id>; that is how Shorts are told apart (fetching /shorts/<id> only
// redirected from here, for Shorts and normal videos alike).
export const parseAtom = (xml: string): Entry[] => [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
  videoId: e.match(/<yt:videoId>([^<]+)</)?.[1] ?? '',
  channelId: e.match(/<yt:channelId>([^<]+)</)?.[1] ?? '',
  title: (e.match(/<title>([^<]*)</)?.[1] ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
  published: e.match(/<published>([^<]+)</)?.[1] ?? '',
  short: /href="https:\/\/www\.youtube\.com\/shorts\//.test(e),
})).filter(e => e.videoId);

export async function feed(channelId = CHANNEL_ID): Promise<Entry[]> {
  const res = await fetch(topicOf(channelId), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  return parseAtom(await res.text());
}

// A push notification may not say whether the video is a Short; the channel feed does. A video too new for the
// feed is treated as not a Short.
export const isShort = async (e: Entry) => e.short || (await feed(e.channelId).catch(() => [])).some(x => x.videoId === e.videoId && x.short);

export const videos = (): any[] => JSON.parse(readFileSync(VIDEOS, 'utf8'));

// Add a new upload to data/videos.json (oldest first, so it goes at the end). Returns false if it is known.
// The feed has no video length; it stays empty until a card is made.
export function addVideo(e: Entry): boolean {
  const all = videos();
  if (all.some(v => v.videoId === e.videoId)) return false;
  all.push({ videoId: e.videoId, title: e.title, length: '', views: '', publishedText: e.published, published: e.published, channel: e.channelId,
    ageDays: Math.round((FETCHED - Date.parse(e.published)) / 86400000) }); // negative for uploads after the list was made
  writeFileSync(VIDEOS, JSON.stringify(all, null, 1));
  return true;
}
