// Load cached transcripts, render them for a prompt, and check quotes against the source.
import { readFileSync } from 'node:fs';

export interface Line { ms: number; text: string }
export interface Lecture { videoId: string; title: string; lines: Line[]; chapters: { title: string; ms: number }[] }

export const mmss = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const toMs = (t: string) => t.split(':').map(Number).reduce((a, b) => a * 60 + b, 0) * 1000;

export function loadLecture(videoId: string, title: string): Lecture {
  const d = JSON.parse(readFileSync(new URL(`../../data/cache/transcript_${videoId}.json`, import.meta.url), 'utf8'));
  return {
    videoId, title,
    lines: d.transcript.map((s: any) => ({ ms: s.start_ms, text: s.snippet })),
    chapters: (d.chapters ?? []).map((c: any) => ({ title: c.chapter, ms: c.start_ms })),
  };
}

export function renderForPrompt(l: Lecture): string {
  return [
    `Title: ${l.title}`,
    'Chapters:', ...l.chapters.map(c => `- [${mmss(c.ms)}] ${c.title}`),
    'Transcript:', ...l.lines.map(x => `[${mmss(x.ms)}] ${x.text}`),
  ].join('\n');
}

// Models drop speech fillers when quoting ("uh", "um"), so the check ignores them on both sides.
// Letters of any script are kept, so quotes from Korean transcripts can be checked too.
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\b(uh|um|uhm)\b/g, ' ').replace(/\s+/g, ' ').trim();

// A quote passes if its words appear in the transcript; "nearAt" also needs it within ±30 s of the cited time.
export function checkQuote(l: Lecture, quote: string, at: string) {
  const q = norm(quote);
  if (!q) return { found: false, nearAt: false };
  // Quotes can straddle two segments, so search over a sliding window of three lines.
  for (let i = 0; i < l.lines.length; i++) {
    const win = norm(l.lines.slice(i, i + 3).map(x => x.text).join(' '));
    if (win.includes(q)) return { found: true, nearAt: Math.abs(l.lines[i].ms - toMs(at)) <= 30000 || Math.abs((l.lines[i + 1]?.ms ?? -1e9) - toMs(at)) <= 30000 };
  }
  return { found: false, nearAt: false };
}

// A concept name is grounded when the lecture says it: every word of the name (by its first 5 letters,
// so "Sandboxing" matches "sandbox") appears in the transcript, or its acronym does ("MCP").
export function conceptInTranscript(l: Lecture, name: string) {
  const text = ' ' + norm(l.lines.map(x => x.text).join(' ')) + ' ';
  const words = norm(name).split(' ').filter(w => w.length > 2 && !['the', 'and', 'for', 'of'].includes(w));
  if (!words.length) return false;
  if (words.every(w => text.includes(' ' + w.slice(0, 5)))) return true;
  const acronym = norm(name).split(' ').map(w => w[0]).join('');
  return acronym.length > 1 && text.includes(' ' + acronym + ' ');
}
