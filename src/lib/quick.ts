// Quick answers: "what's new today", hackathons, flights and the latest material are answered by code from the files
// the morning routine wrote (notes/00 Morning.md + the notes' git, notes/Hackathons.md, notes/Travel.md,
// data/cards + data/videos.json), in milliseconds, instead of minutes in the local model. Every name, date and price is copied from those files.
// Anything else returns null and goes to the Notes Assistant (src/lib/ask.ts).
// Used by src/cli/web.ts for typed and spoken questions. Files are only read.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const text = (p: string) => (existsSync(new URL(p, root)) ? readFileSync(new URL(p, root), 'utf8') : '');
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

export interface Quick { topic: 'today' | 'hackathons' | 'flights' | 'latest'; say: string; lines: string[]; links: { label: string; url: string }[]; source: string; ms: number }

// Keyword routing; Whisper sometimes splits "hackathon" into "hack a thon".
const TOPICS: [Quick['topic'], RegExp][] = [
  ['today', /what'?s new|what is new today|new today|anything new|what('s| has| have)? changed|changes? (in|to|since|compared)|compared to my|since (yesterday|last time)|morning (merge|update|summary|page)|today'?s (update|changes|summary)/i],
  ['hackathons', /hack\s?-?a?\s?-?thons?|hack ?days?|해커톤/i],
  ['flights', /\bflights?\b|\bfly\b|\bfares?\b|airfare|ticket|\btravel|\btrip\b|korea|seoul|incheon|\bicn\b|surcharge|비행기|항공|유류/i],
  ['latest', /\btoday\b|\bnews\b|latest|newest|\brecent|\bnew (talks?|papers?|material|videos?)|\bpapers?\b|arxiv|material|today'?s talks/i],
];

export function quick(question: string): Quick | null {
  let topic = TOPICS.find(([, re]) => re.test(question))?.[0];
  // A question that names one of my notes ("What is new for my Agent Harness note?") is for the Notes Assistant,
  // and so is "the latest ... in my notes": the quick answers know the whole morning, not what one note says.
  if ((topic === 'today' || topic === 'latest') && (namesNote(question) || (topic === 'latest' && /\bnotes?\b/i.test(question)))) topic = undefined;
  // "what did today's talks add to my notes" = the morning merge, unless one note is named.
  if (/\btoday\b/i.test(question) && /\bnotes?\b/i.test(question) && !namesNote(question)) topic = 'today';
  if (!topic) return null;
  const t0 = Date.now();
  const a = topic === 'today' ? today_() : topic === 'hackathons' ? hackathons() : topic === 'flights' ? flights() : latest(/paper|arxiv/i.test(question));
  return a && { topic, ...a, ms: Date.now() - t0 };
}

// notes/Me.md (src/cli/persona.ts), if it exists: interests and location help rank; without it nothing is ranked by me.
function me() {
  const md = text('notes/Me.md');
  const field = (k: string) => md.match(new RegExp(`^- \\*\\*${k}:\\*\\* (.*)$`, 'm'))?.[1] ?? '';
  return { interests: field('Interests').split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 2), city: field('Location').split(',')[0].trim().toLowerCase() };
}
const today = () => new Date().toLocaleDateString('sv');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The last day of a Dates cell, as written by src/cli/hackathons.ts: "2026-10-24 – 2026-10-25", "Oct 05 - 27, 2026",
// "Sep 22 - Oct 26, 2026", "Jul 18, 2026 - Jan 14, 2027". Only used to drop events that are over.
function endOf(cell: string) {
  const iso = cell.match(/\d{4}-\d{2}-\d{2}/g);
  if (iso) return iso.at(-1)!;
  const end = cell.split(/ [-–] /).at(-1)!, m = end.match(/(?:([A-Z][a-z]{2}) )?(\d{1,2}), (\d{4})/);
  if (!m) return '';
  const mon = m[1] ?? cell.match(/[A-Z][a-z]{2}/)?.[0] ?? '';
  return `${m[3]}-${String(MON.indexOf(mon) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function hackathons() {
  const p = me();
  const rows = text('notes/Hackathons.md').split('\n').filter(l => /^\| (?!Dates|---)/.test(l)).map(l => {
    const [dates, name, where, prize, themes, link] = l.slice(2, -2).split(' | ');
    return { dates, name: name.replace(/[⭐📍]\s*/gu, '').trim(), ai: name.includes('⭐'), near: name.includes('📍'), where, prize, themes, url: link?.match(/\((.*)\)/)?.[1] ?? '', end: endOf(dates) };
  }).filter(r => r.end >= today());
  if (!rows.length) return null;
  // ⭐ and 📍 first (the note's own marks), then my interests and city if notes/Me.md has them, then the soonest end.
  const hay = (r: typeof rows[0]) => `${r.name} ${r.themes} ${r.where}`.toLowerCase();
  const score = (r: typeof rows[0]) => (r.ai ? 2 : 0) + (r.near ? 2 : 0) + p.interests.filter(i => hay(r).includes(i)).length + (p.city && r.where.toLowerCase().includes(p.city) ? 3 : 0);
  const top = [...rows].sort((a, b) => score(b) - score(a) || a.end.localeCompare(b.end)).slice(0, 3);
  const one = (r: typeof rows[0]) => `${r.name}, ${r.where}, ${r.dates}${r.prize && r.prize !== '?' ? `, prize ${r.prize}` : ''}`;
  // Why it fits me, from the data only: an interest from notes/Me.md that shares a word with the themes, and the marks.
  const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 5);
  const fit = (r: typeof rows[0]) => {
    const i = p.interests.find(x => words(x).some(w => words(`${r.name} ${r.themes}`).includes(w)));
    return [i && `its themes (${r.themes}) match your interest in ${i}`, r.where === 'Online' ? 'you can join online' : r.near && 'it is in Germany'].filter(Boolean).join(', and ');
  };
  const pick = (r: typeof rows[0]) => `${r.name}, ${r.where}, ${r.dates}${r.prize && r.prize !== '?' ? `, prize ${r.prize}` : ''}${fit(r) ? `. Why it fits you: ${fit(r)}` : ''}`;
  return {
    say: `${rows.length} upcoming hackathons; my top two for you. First, ${pick(top[0])}.${top[1] ? ` Second, ${pick(top[1])}.` : ''}`,
    lines: top.map(r => `${r.ai ? '⭐ ' : ''}${r.near ? '📍 ' : ''}${one(r)}${r.themes && r.themes !== '?' ? ` · ${r.themes}` : ''}`),
    links: top.map(r => ({ label: r.name, url: r.url })),
    source: `notes/Hackathons.md${p.interests.length || p.city ? ' + notes/Me.md' : ''}`,
  };
}

function flights() {
  const md = text('notes/Travel.md');
  const trips = md.split(/^## /m).slice(1).filter(s => /\| Cheapest \|/.test(s));
  if (!trips.length) return null;
  const hist: Record<string, { day: string; low: number }[]> = existsSync(new URL('data/flights_history.json', root)) ? read('data/flights_history.json') : {};
  const say: string[] = [], lines: string[] = [], links: Quick['links'] = [];
  for (const s of trips) {
    const head = s.split('\n')[0].trim(); // "FRA → ICN · 2026-12-19 – 2027-01-04"
    const [, price, fl, via, time] = s.match(/^\| Cheapest \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$/m)!;
    const level = s.match(/^Google: price level \*\*(.*?)\*\*, typical (\S+)/m);
    const gf = s.match(/\[open in Google Flights\]\((.*?)\)/)?.[1];
    say.push(`${head.replace(' → ', ' to ').replace(' · ', ', ').replace(' – ', ' to ')}: cheapest ${price}, ${fl} via ${via}, ${time}${level && level[1] !== '?' ? `; Google calls it ${level[1]}; the usual range is ${level[2]}` : ''}.`);
    lines.push(`${head}: cheapest ${price} · ${fl} · via ${via} · ${time}${level ? ` · price level ${level[1]}, usual range ${level[2]}` : ''}`);
    // The trend, if the history has more than one day for this trip.
    const [from, to] = head.split(' · ')[0].split(' → '), dates = head.split(' · ')[1]?.split(' – ') ?? [];
    const h = hist[[from, to, ...dates].join('-')] ?? [];
    if (h.length > 1) lines.push(`History: €${h[0].low} on ${h[0].day} → €${h.at(-1)!.low} on ${h.at(-1)!.day} (${h.length} days)`);
    if (gf) links.push({ label: `${head} in Google Flights`, url: gf });
  }
  // The fuel surcharge table is in Korean; shown, not spoken (the voice is English).
  const fuel = md.split('\n').filter(l => /^\| (대한항공|아시아나항공)/.test(l)).map(l => l.slice(2, -2).split(' | '))
    .map(c => `Fuel surcharge from Korea, ${c[0]}: ${c[3]} → ${c[4]} (${c[5]}) for 10월 → 11월`);
  lines.push(...fuel);
  const src = md.match(/\*\*Fuel surcharge.*?\*\* \(\[source\]\((.*?)\)\)/)?.[1];
  if (src) links.push({ label: 'Fuel surcharge source', url: src });
  return { say: say.join(' '), lines, links, source: 'notes/Travel.md' + (Object.keys(hist).length ? ' + data/flights_history.json' : '') };
}

function latest(papersOnly: boolean) {
  const p = me();
  const videos: any[] = read('data/videos.json');
  const FETCHED = Date.parse('2026-10-20T00:00:00Z'); // as in web.ts: videos.json ages count back from this day
  const cards = readdirSync(new URL('data/cards/', root)).filter(f => f.endsWith('.json')).map(f => read(`data/cards/${f}`))
    .filter(c => !papersOnly || c.kind === 'paper').map(c => {
      const v = videos.find(x => x.videoId === c.videoId);
      const date = v?.published ? new Date(v.published).toLocaleDateString('sv') : v ? new Date(FETCHED - v.ageDays * 86400000).toISOString().slice(0, 10) : '';
      const hay = `${c.card.title} ${c.card.one_line} ${(c.card.concepts ?? []).map((k: any) => k.name).join(' ')}`.toLowerCase();
      return { title: c.card.title, oneLine: c.card.one_line, url: c.url, kind: c.kind === 'paper' ? 'paper' : 'talk', date, fit: p.interests.filter(i => hay.includes(i)).length };
    }).filter(c => c.date);
  if (!cards.length) return null;
  // Newest first; on the same day, the ones that match my interests (notes/Me.md) first.
  const top = cards.sort((a, b) => b.date.localeCompare(a.date) || b.fit - a.fit).slice(0, 3);
  const [first, ...rest] = top;
  return {
    say: `The newest is the ${first.kind} "${first.title}", from ${first.date}: ${first.oneLine}${rest.length ? ` ${rest.length} more are on the screen.` : ''}`,
    lines: top.map(c => `${c.date} · ${c.kind} · ${c.title} — ${c.oneLine}`),
    links: top.map(c => ({ label: c.title, url: c.url })),
    source: 'data/cards + data/videos.json' + (p.interests.length ? ' + notes/Me.md' : ''),
  };
}

const notesDir = new URL('notes/', root);
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
function namesNote(question: string) {
  const names = ['', 'sections/'].flatMap(d => (existsSync(new URL(d, notesDir)) ? readdirSync(new URL(d, notesDir)).filter(f => f.endsWith('.md')) : []))
    .map(f => f.replace(/\.md$/, '')).filter(n => !['00 Morning', 'README', 'Hackathons', 'Travel', 'Me'].includes(n));
  return names.some(n => ` ${norm(question)} `.includes(` ${norm(n)} `));
}

// What changed this morning: the counts and 🔔 answers from notes/00 Morning.md (src/cli/merge.ts), the lines the
// latest merge commit appended (the notes' own git), and the edit proposals still open (notes/.proposals.json).
function today_() {
  const md = text('notes/00 Morning.md');
  if (!md) return null;
  const sect = (h: string) => (md.split(/^## /m).find(s => s.startsWith(h)) ?? '').split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2));
  const day = md.match(/^# Morning (\S+)/m)?.[1] ?? '';
  const lectures = md.match(/^(\d+) new lectures?\./m)?.[1];
  const bells = sect('🔔').filter(l => l !== 'none today');
  const added = sect('Added to your notes').map(l => l.match(/^\[\[(.*)\]\]: (\d+) new$/)).filter(m => m !== null).map(m => ({ note: m[1], n: Number(m[2]) }));
  const topics = sect('New topics').length;
  // The latest merge commit (merge.ts commits "merge <day>: ..."); an "applied edit" commit after it is not a merge.
  const git = (...a: string[]) => execFileSync('git', ['-C', fileURLToPath(notesDir), ...a], { encoding: 'utf8' });
  const lines: string[] = [], links: Quick['links'] = [], titles: string[] = [];
  try {
    const c = git('log', '-1', '--format=%H', '--grep=^merge ').trim();
    let note = '', title = '';
    for (const l of c ? git('diff', `${c}~1`, c).split('\n') : []) {
      const f = l.match(/^\+\+\+ b\/(.*?)\t?$/);
      if (f) { note = f[1].endsWith('.md') && f[1] !== '00 Morning.md' ? f[1].replace(/^sections\//, '').replace(/\.md$/, '') : ''; continue; }
      if (!note) continue;
      const h = l.match(/^\+### merged \S+ · \[(.*)\]\((.*)\)$/);
      if (h) { title = h[1]; if (!titles.includes(title)) titles.push(title); continue; }
      const p = l.match(/^\+- (.*?)(?: — ".*")? \[([^\]]*)\]\(([^)]*)\)$/);
      if (p) { lines.push(`${note} · ${p[1]} (${title}, ${p[2]})`); links.push({ label: `${note} · ${title} · ${p[2]}`, url: p[3] }); }
    }
  } catch { /* no git in notes/: the counts from 00 Morning.md still answer */ }
  const props = existsSync(new URL('.proposals.json', notesDir)) ? read('notes/.proposals.json').filter((p: any) => p.status === 'open') : [];
  const total = added.reduce((a, x) => a + x.n, 0), n = lectures ?? String(titles.length);
  const say = [
    ...bells.map(b => `An answer to your open question: ${b}.`),
    total ? `This morning's merge, ${day}, added ${total} new point${total > 1 ? 's' : ''} to your notes from ${n} new lecture${n === '1' ? '' : 's'}: ${added.map(x => `${x.note} ${x.n}`).join(', ')}.${titles.length ? ` The lecture${titles.length > 1 ? 's' : ''}: ${titles.map(t => `"${t}"`).join(' and ')}.` : ''}`
      : `This morning's merge, ${day}, added nothing to your notes.`,
    props.length ? `${props.length} suggested edit${props.length > 1 ? 's wait' : ' waits'} for you: ${props.map((p: any) => `in ${p.note}, from "${p.title}"`).join('; ')}.` : 'No suggested edits are open.',
  ];
  return {
    say: say.join(' '),
    lines: [...bells.map(b => `🔔 ${b}`), ...lines, ...props.map((p: any) => `Suggested edit in ${p.note}: ${p.revised} (${p.title})`), ...(topics ? [`${topics} new topic${topics > 1 ? 's' : ''} with no note of yours yet (see 00 Morning.md)`] : [])],
    links, source: 'notes/00 Morning.md + the notes git + notes/.proposals.json',
  };
}
