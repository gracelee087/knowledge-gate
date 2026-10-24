// Lessons: what an agent got wrong, written by code when a check fails. They are raw material for the
// lesson verifier (src/agent/verify.ts), which turns them into candidate rules and keeps only the rules
// that measurably do no harm. Agents never read lessons directly; they read verified rules (src/lib/rules.ts).
// Stored as one JSON object per line in data/lessons.jsonl.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const FILE = new URL('../../data/lessons.jsonl', import.meta.url);
export type Lesson = { at: string; agent: string; what: string; [k: string]: unknown };

export function recordLesson(agent: string, what: string, detail: object = {}) {
  appendFileSync(FILE, JSON.stringify({ at: new Date().toISOString(), agent, what, ...detail }) + '\n');
}

export function readLessons(): Lesson[] {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}
