// Quick answers: "what's new today" and the latest talks are answered by code from the files
// the morning routine wrote (notes/00 Morning.md + the notes' git, data/cards + data/videos.json), in milliseconds, instead of minutes in the local model. Every name and date is copied from those files.
// Anything else returns null and goes to the Notes Assistant (src/lib/ask.ts).
// Used by src/cli/web.ts for typed and spoken questions. Files are only read.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const text = (p: string) => (existsSync(new URL(p, root)) ? readFileSync(new URL(p, root), 'utf8') : '');
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

export interface Quick { topic: 'today' | 'latest'; say: string; lines: string[]; links: { label: string; url: string }[]; source: string; ms: number }

// Keyword routing.
const TOPICS: [Quick['topic'], RegExp][] = [
  ['today', /what'?s new|what is new today|new today|anything new|what('s| has| have)? changed|changes? (in|to|since|compared)|compared to my|since (yesterday|last time)|morning (merge|update|summary|page)|today'?s (update|changes|summary)/i],
  ['latest', /\btoday\b|\bnews\b|latest|newest|\brecent|\bnew (talks?|material|videos?)|material|today'?s talks/i],
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
  const a = topic === 'today' ? today_() : latest();
  return a && { topic, ...a, ms: Date.now() - t0 };
}

const today = () => new Date().toLocaleDateString('sv');

// The newest AI talks, from the cards on this laptop (paper cards from the old arXiv step are left out).
function latest() {
  const videos: any[] = read('data/videos.json');
  const FETCHED = Date.parse('2026-10-20T00:00:00Z'); // as in web.ts: videos.json ages count back from this day
  const cards = readdirSync(new URL('data/cards/', root)).filter(f => f.endsWith('.json')).map(f => read(`data/cards/${f}`))
    .filter(c => c.kind !== 'paper').map(c => {
      const v = videos.find(x => x.videoId === c.videoId);
      const date = v?.published ? new Date(v.published).toLocaleDateString('sv') : v ? new Date(FETCHED - v.ageDays * 86400000).toISOString().slice(0, 10) : '';
      return { title: c.card.title, oneLine: c.card.one_line, url: c.url, kind: 'talk', date };
    }).filter(c => c.date);
  if (!cards.length) return null;
  const top = cards.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const [first, ...rest] = top;
  return {
    say: `${first.date !== today() ? `No new talks today. ` : ''}The newest is the ${first.kind} "${first.title}", from ${first.date}: ${first.oneLine}${rest.length ? ` ${rest.length} more are on the screen.` : ''}`,
    lines: top.map(c => `${c.date} · ${c.kind} · ${c.title} — ${c.oneLine}`),
    links: top.map(c => ({ label: c.title, url: c.url })),
    source: 'data/cards + data/videos.json',
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
    // No merge today: say so first, then what the last one did.
    ...(day && day !== today() ? [`No new lectures today. The last update was on ${day}.`] : []),
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
