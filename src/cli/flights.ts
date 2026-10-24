// Flight prices for my own trips, into notes/Travel.md (private: notes/ stays on the laptop).
//   price: SerpApi Google Flights, once a day per trip (cached by date); the cheapest and Google's top "best" flight,
//          the price level Google gives, and the change since the last run (data/flights_history.json)
//   fuel surcharge: ktravelacademy.com's monthly page, one distance table per airline (Korean Air, Asiana) for
//          flights departing Korea; the row naming the trip's city is copied as it is; once a month
//          (koreanair.com and myrealtrip.com answer 403 to a script)
// The flight price is Google's total, surcharge included; the surcharge line is for knowing next month's change.
// Note: a ticket bought in Germany pays the surcharge set for departures from Germany; the Korean notice
// covers tickets departing Korea (e.g. the way back on a separate ticket).
// Trips: notes/trips.json, e.g. [{"from":"FRA","to":"ICN","out":"2026-12-19","back":"2027-01-04","city":"프랑크푸르트"}]
// Usage: npx tsx src/cli/flights.ts
import '../lib/env.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { googleFlights, searchesLeft } from '../lib/serpapi.ts';

const root = new URL('../../', import.meta.url);
const tripsFile = new URL('notes/trips.json', root), histFile = new URL('data/flights_history.json', root);
type Trip = { from: string; to: string; out: string; back?: string; city?: string };
if (!existsSync(tripsFile)) {
  writeFileSync(tripsFile, JSON.stringify([{ from: 'FRA', to: 'ICN', out: '2026-12-19', back: '2027-01-04', city: '프랑크푸르트' }], null, 1));
  console.log('notes/trips.json created with an example trip; edit the dates');
}
const trips: Trip[] = JSON.parse(readFileSync(tripsFile, 'utf8'));
const hist: Record<string, { day: string; low: number }[]> = existsSync(histFile) ? JSON.parse(readFileSync(histFile, 'utf8')) : {};
const today = new Date().toISOString().slice(0, 10);
const hm = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
const legs = (f: any) => f.flights.map((x: any) => `${x.airline} ${x.flight_number}`).join(' + ');
const via = (f: any) => (f.layovers?.length ? f.layovers.map((l: any) => l.id).join(', ') : 'direct');

// ktravelacademy.com posts one page a month with a distance table per airline (Korean Air, Asiana): previous
// month, this month, change. The row whose routes name the trip's city is copied as it is; cached per month.
const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
async function fuelTable(year: number, month: number, city: string) {
  const url = `https://ktravelacademy.com/${encodeURIComponent(`${year}년-${month}월-국제선-유류할증료`)}/`;
  const cache = new URL(`data/cache/fuel_kta_${year}_${month}.html`, root);
  let h: string;
  if (existsSync(cache)) h = readFileSync(cache, 'utf8');
  else {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (lecture-gate personal travel note)' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { url, rows: [] as { airline: string; cells: string[]; head: string[] }[] };
    h = await r.text(); writeFileSync(cache, h);
  }
  const rows: { airline: string; cells: string[]; head: string[] }[] = [];
  for (const m of h.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const before = strip(h.slice(Math.max(0, m.index! - 300), m.index!));
    const airline = before.match(/(대한항공|아시아나항공|[가-힣A-Za-z]+항공) 거리별 유류할증료[^가-힣]*$/)?.[1] ?? before.match(/([가-힣]+항공)[^항]*$/)?.[1] ?? '?';
    const trs = [...m[0].matchAll(/<tr[\s\S]*?<\/tr>/g)].map(r => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => strip(c[1])));
    const row = trs.find(r => r.join(' ').includes(city));
    if (row) rows.push({ airline, cells: row, head: trs[0] });
  }
  return { url, rows };
}

const lines: string[] = [`# ✈️ Travel (updated ${today})`, '', 'Prices from Google Flights through SerpApi (EUR, 1 adult, totals with taxes and surcharges). Collected by src/cli/flights.ts.', ''];
for (const t of trips) {
  const id = `${t.from}-${t.to}-${t.out}-${t.back ?? 'oneway'}`;
  lines.push(`## ${t.from} → ${t.to} · ${t.out}${t.back ? ` – ${t.back}` : ' (one way)'}`, '');
  try {
    const r = await googleFlights({ departure_id: t.from, arrival_id: t.to, outbound_date: t.out, ...(t.back && { return_date: t.back }) });
    const all = [...(r.best_flights ?? []), ...(r.other_flights ?? [])].filter((f: any) => typeof f.price === 'number');
    if (!all.length) { lines.push('No priced flights in the result.', ''); continue; }
    const cheap = all.reduce((a: any, b: any) => (b.price < a.price ? b : a)), best = r.best_flights?.[0] ?? cheap;
    const prev = (hist[id] ?? []).filter(h => h.day < today).at(-1);
    if (!(hist[id] ?? []).some(h => h.day === today)) (hist[id] ??= []).push({ day: today, low: cheap.price });
    const change = prev ? cheap.price - prev.low : null;
    lines.push(
      ...(change !== null && change < 0 ? [`🔔 €${-change} cheaper than on ${prev!.day} (€${prev!.low})`, ''] : []),
      '| | Price | Flights | Via | Time |', '|---|---|---|---|---|',
      `| Cheapest | €${cheap.price} | ${legs(cheap)} | ${via(cheap)} | ${hm(cheap.total_duration)} |`,
      `| Google's best | €${best.price} | ${legs(best)} | ${via(best)} | ${hm(best.total_duration)} |`, '',
      `Google: price level **${r.price_insights?.price_level ?? '?'}**, typical €${r.price_insights?.typical_price_range?.join('–') ?? '?'}${change !== null ? ` · since ${prev!.day}: ${change >= 0 ? '+' : ''}€${change}` : ''} · [open in Google Flights](${r.search_metadata?.google_flights_url})`, '',
    );
  } catch (e) { lines.push(`Not collected: ${(e as Error).message}`, ''); }
  if (t.city) {
    // The newest monthly page: next month's appears around the middle of this month.
    const now = new Date(), next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    let f = await fuelTable(next.getFullYear(), next.getMonth() + 1, t.city);
    if (!f.rows.length) f = await fuelTable(now.getFullYear(), now.getMonth() + 1, t.city);
    lines.push(`**Fuel surcharge departing Korea, one way, route with ${t.city}** ([source](${decodeURI(f.url)}))`, '');
    if (!f.rows.length) lines.push('- not found this time', '');
    else lines.push(`| Airline | ${f.rows[0].head.join(' | ')} |`, `|---|${f.rows[0].head.map(() => '---').join('|')}|`,
      ...f.rows.map(r => `| ${r.airline} | ${r.cells.map(c => c.replace(/\|/g, '/')).join(' | ')} |`), '');
  }
}
writeFileSync(histFile, JSON.stringify(hist, null, 1));
writeFileSync(new URL('notes/Travel.md', root), lines.join('\n'));
console.log(`notes/Travel.md: ${trips.length} trip(s); SerpApi searches left this month: ${await searchesLeft()}`);
