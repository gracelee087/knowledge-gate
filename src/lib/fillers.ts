// What the host says while a slow answer is on its way: a greeting by the Berlin hour, the weather where I am, with a
// clothing tip, a few headlines, then a hackathon closing soon and today's flight price. Weather from Open-Meteo (no key;
// only the city name is sent); tech headlines copied verbatim from the Hacker News API; the hackathon and flight
// lines are copied from notes/Hackathons.md and notes/Travel.md. Fetched data is cached for 30 minutes.
import { existsSync, readFileSync } from 'node:fs';
import { quick } from './quick.ts';

const root = new URL('../../', import.meta.url);
const note = (f: string) => (existsSync(new URL(`notes/${f}`, root)) ? readFileSync(new URL(`notes/${f}`, root), 'utf8') : '');
const SKY: [number, string][] = [[0, 'clear'], [3, 'partly cloudy'], [48, 'foggy'], [67, 'rainy'], [77, 'snowy'], [82, 'showery'], [99, 'stormy']];
let cache: { at: number; city: string; weather: string | null; news: string[] } | null = null;
export const READY = 'Your answer is ready. Starting your notes briefing!';

async function weather(city: string) {
  const g: any = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`, { signal: AbortSignal.timeout(5000) })).json();
  const p = g.results?.[0];
  if (!p) return null;
  const w: any = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,precipitation_probability_max&timezone=auto&forecast_days=1`, { signal: AbortSignal.timeout(5000) })).json();
  const t = Math.round(w.current.temperature_2m), max = Math.round(w.daily.temperature_2m_max[0]), rain = w.daily.precipitation_probability_max[0];
  const sky = SKY.find(([code]) => w.current.weather_code <= code)?.[1] ?? 'cloudy';
  const wear = rain >= 50 ? 'take an umbrella' : t < 8 ? 'a warm coat is a good idea' : t < 15 ? 'a light jacket will do' : 'no jacket needed';
  return `Weather: ${p.name}, ${t} degrees and ${sky}, up to ${max}, ${rain} percent chance of rain, so ${wear}.`;
}

// The titles of the top n Hacker News stories, from the official API (hnrss.org timed out on the hotspot); [] if it fails.
async function headlines(n: number) {
  try {
    const get = async (p: string) => (await fetch(`https://hacker-news.firebaseio.com/v0/${p}.json`, { signal: AbortSignal.timeout(8000) })).json();
    const ids: number[] = await get('topstories');
    const items: any[] = await Promise.all(ids.slice(0, n).map(id => get(`item/${id}`)));
    return items.map(i => String(i?.title ?? '').trim()).filter(t => t && t.length <= 140);
  } catch { return []; }
}

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Berlin' }).format(new Date()));
  return h >= 5 && h < 11 ? 'Hello Ms Lee, good morning! Let me look through your notes.'
    : h >= 11 && h < 17 ? "Sleepy lunchtime, Ms Lee? Hang in there. I'm looking through your notes."
    : "Good work today, Ms Lee. Let's look back at today's notes.";
};

export async function fillers(city: string) {
  if (!cache || cache.city !== city || Date.now() - cache.at >= 30 * 60e3) {
    const [w, tech] = await Promise.all([weather(city).catch(() => null), headlines(4)]);
    cache = { at: Date.now(), city, weather: w, news: tech };
  }
  // Greeting, then "today's news" in short lines: the weather, then the three things I follow (talks, hackathons, travel).
  const lines = [greeting(), "While we wait, here's today's news!"];
  if (cache.weather) lines.push(cache.weather);
  // The newest AI talk, from the cards on this laptop (the same answer as "latest material"), without the speaker part.
  const talk = quick('latest material')?.links[0]?.label?.split(/ [-—] /)[0];
  if (talk) lines.push(`AI talks: the newest is "${talk}".`);
  // The top hackathon pick (the same ranking as the quick answer) and the cheapest flight of the first trip.
  const hack = quick('hackathons')?.links[0]?.label, row = hack && note('Hackathons.md').split('\n').find(l => l.includes(hack))?.split('|').map(s => s.trim());
  if (row) lines.push(`Hackathons: ${hack}, ${row[3]}, ${row[1]}.`);
  const trip = note('Travel.md').match(/^## (.+)$/m)?.[1], cheap = note('Travel.md').match(/^\| Cheapest \| (€\d+) \| ([^|]+)\|/m);
  if (trip && cheap) lines.push(`Travel: ${trip.replace('→', 'to').replace(/ · .*/, '')} on ${trip.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''}, from ${cheap[1]} today.`);
  return lines;
}

// The city for the weather: --city on the page server, else the Location line of notes/Me.md.
export const homeCity = (override: string | null) => override ?? note('Me.md').match(/\*\*Location:\*\*\s*([^,\n]+)/)?.[1]?.trim() ?? '';
