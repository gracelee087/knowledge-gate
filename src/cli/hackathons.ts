// Hackathon schedule for the morning: upcoming events from public listings, written to notes/Hackathons.md.
// No model here: every date, place and prize is copied from the listing's own structured data; a field the
// listing does not give is shown as "?", never guessed.
//   hackathonhub.eu  sitemap-events.xml, then each event page's schema.org Event (JSON-LD)
//   Devpost          /api/hackathons (upcoming and open), submission period, prize, themes
//   DEV              devteam "Join the … Challenge" posts
// notes/Hackathons.md is rewritten each run (like 00 Morning.md); the person's own notes are not touched.
// Usage: npx tsx src/cli/hackathons.ts [--hub N]   (N = event pages read from hackathonhub, default 20)
// The sitemap is not in date order, so the first 20 pages are a sample of hackathonhub, not all its events.
import { writeFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const arg = (name: string) => (process.argv.indexOf(name) > 0 ? process.argv[process.argv.indexOf(name) + 1] : null);
const HUB_PAGES = Number(arg('--hub') ?? 20);
const UA = { 'User-Agent': 'lecture-gate/0.1 (personal hackathon list; github.com/gracelee087/knowledge-gate)' };
const get = async (u: string) => { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const strip = (s: string) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();

type Event = { name: string; start?: string; end?: string; period?: string; where: string; prize: string; themes: string; link: string; source: string; text: string };
const events: Event[] = [];
const failed: string[] = [];

try {
  const locs = [...(await (await get('https://hackathonhub.eu/sitemap-events.xml')).text()).matchAll(/<loc>([^<]+)/g)].map(m => m[1]);
  for (const u of locs.slice(0, HUB_PAGES)) {
    const h = await (await get(u)).text();
    const j = h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    const doc = j ? JSON.parse(j) : null;
    const ev = (doc?.['@graph'] ?? [doc]).find((x: any) => x?.['@type'] === 'Event');
    if (ev) events.push({
      name: ev.name, start: ev.startDate, end: ev.endDate, where: [ev.location?.address?.addressLocality ?? ev.location?.name, ev.location?.address?.addressCountry].filter(Boolean).join(', ') || '?',
      prize: '?', themes: '', link: ev.url ?? u, source: 'hackathonhub', text: ev.description ?? '',
    });
    await sleep(300); // one page at a time, gently
  }
} catch (e) { failed.push(`hackathonhub: ${(e as Error).message}`); }

try {
  for (const page of [1, 2]) {
    const d: any = await (await get(`https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&page=${page}`)).json();
    for (const h of d.hackathons ?? []) events.push({
      name: h.title, period: h.submission_period_dates, where: h.displayed_location?.location ?? '?', prize: strip(h.prize_amount) || '?',
      themes: (h.themes ?? []).map((t: any) => t.name).join(', '), link: h.url, source: 'devpost', text: '',
    });
  }
} catch (e) { failed.push(`devpost: ${(e as Error).message}`); }

try {
  const posts: any[] = await (await get('https://dev.to/api/articles?username=devteam&per_page=30')).json();
  for (const a of posts.filter(a => /^Join\b.*Challenge/i.test(a.title))) events.push({
    name: a.title.replace(/^Join (our |the )?/i, '').replace(/!.*$/, ''), start: a.published_at, where: 'Online', prize: a.title.match(/\$[\d,]+/)?.[0] ?? '?',
    themes: (a.tag_list ?? []).join(', '), link: a.url, source: 'DEV', text: a.title,
  });
} catch (e) { failed.push(`DEV: ${(e as Error).message}`); }

// ⭐ = about AI or open source (from the listing's own words); 📍 = online or in Germany.
const star = (e: Event) => /\b(ai|a\.i\.|llm|agents?|machine learning|open[- ]source|gemma|genai)\b/i.test(`${e.name} ${e.themes} ${e.text}`);
const pin = (e: Event) => /online|germany|\bDE\b|deutschland/i.test(e.where);
const day = (s?: string) => (s ? s.slice(0, 10) : '');
const now = new Date().toISOString().slice(0, 10);
// Devpost gives a text period ("Oct 01 - Nov 12, 2026"): it is shown as written and sorted by its end date.
const periodEnd = (p: string) => { const t = Date.parse(p.split(' - ').at(-1)!.replace(/^(\w{3} \d+)$/, `$1, ${now.slice(0, 4)}`)); return isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10); };
const endOf = (e: Event) => day(e.end) || (e.period ? periodEnd(e.period) : '') || day(e.start);
const dates = (e: Event) => e.period ?? [day(e.start), day(e.end)].filter(Boolean).filter((d, i, a) => a.indexOf(d) === i).join(' – ');
// A DEV challenge post has no end date; its challenges run about a week, so posts from the last 7 days count.
const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
const open = (e: Event) => (e.source === 'DEV' ? day(e.start) >= weekAgo : (endOf(e) || now) >= now);
const upcoming = events.filter(open)
  .sort((a, b) => (day(a.start) || endOf(a)).localeCompare(day(b.start) || endOf(b)));
const row = (e: Event) => `| ${dates(e) || '?'} | ${star(e) ? '⭐ ' : ''}${pin(e) ? '📍 ' : ''}${e.name.replace(/\|/g, '/')} | ${e.where} | ${e.prize} | ${e.themes || '?'} | [${e.source}](${e.link}) |`;

writeFileSync(new URL('notes/Hackathons.md', root), [
  `# Hackathons (updated ${now})`, '',
  `Collected by src/cli/hackathons.ts from hackathonhub.eu (first ${HUB_PAGES} event pages), Devpost and DEV; rewritten each morning.`,
  'Every field is copied from the listing; "?" means the listing does not say. ⭐ AI or open source · 📍 online or in Germany.', '',
  '| Dates | Name | Where | Prize | Themes | Link |', '|---|---|---|---|---|---|',
  ...upcoming.map(row), '',
  ...(failed.length ? ['## Not collected this time', '', ...failed.map(f => `- ${f}`), ''] : []),
].join('\n'));
writeFileSync(new URL('data/hackathons.json', root), JSON.stringify(events, null, 1));
console.log(`${events.length} events (${upcoming.length} upcoming or open, ${upcoming.filter(star).length} ⭐, ${upcoming.filter(pin).length} 📍) → notes/Hackathons.md${failed.length ? `; failed: ${failed.join('; ')}` : ''}`);
