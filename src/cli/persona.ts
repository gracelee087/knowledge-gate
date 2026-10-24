// The person's profile, from their own CV, on the laptop: notes/Me.md. The CV is read by the local model only
// (Ollama) and never leaves the laptop. Every item must come with a phrase copied from the CV; code keeps an
// item only if that phrase is really in the CV, so the profile holds nothing the CV does not say.
// The hackathon list and the Notes Assistant read notes/Me.md to rank and answer for this person.
// Usage: npx tsx src/cli/persona.ts <cv.pdf|cv.txt> [--model ollama/gemma4:12b]
import '../lib/env.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { chatRetry } from '../lib/llm.ts';

const root = new URL('../../', import.meta.url);
const file = process.argv[2];
if (!file) { console.log('usage: npx tsx src/cli/persona.ts <cv.pdf|cv.txt>'); process.exit(1); }
const model = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : 'ollama/gemma4:12b';
if (!model.startsWith('ollama/')) { console.log('the CV is read by a local model only: use an ollama/ model'); process.exit(1); }
// pypdf, not pdftotext: the mingw pdftotext cannot open a path with Korean letters in it.
const PDF_TEXT = 'import sys,pypdf;sys.stdout.reconfigure(encoding="utf-8");print("\\n".join(p.extract_text() or "" for p in pypdf.PdfReader(sys.argv[1]).pages))';
const cv = file.toLowerCase().endsWith('.pdf') ? execFileSync(process.env.PYTHON ?? 'python', ['-I', '-c', PDF_TEXT, file], { encoding: 'utf8' }) : readFileSync(file, 'utf8');

const Item = z.object({ value: z.string(), evidence: z.string().describe('a phrase copied exactly from the CV that shows this') });
const Persona = z.object({
  role: Item, stage: Item, location: Item,
  interests: z.array(Item), skills: z.array(Item), languages: z.array(Item), looking_for: z.array(Item),
});
const SYSTEM = `You read a person's CV and write a short profile that helps an assistant pick learning material and hackathons for them.
Fields: role (what they do now), stage (student, early career, senior ...), location (city/country they live in),
interests (topics they work on or study), skills (methods and tools they use), languages (spoken), looking_for (what they seem to aim for next).
Every item needs "evidence": a phrase copied exactly, word for word, from the CV. Write nothing the CV does not show. English only. Answer with JSON matching the schema.`;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const r = await chatRetry(model, SYSTEM, `CV:\n${cv}`, z.toJSONSchema(Persona));
const p = Persona.parse(JSON.parse(r.text));
const cvn = norm(cv);
let kept = 0, dropped = 0;
const ok = (i: z.infer<typeof Item>) => { const y = i.evidence.trim().length > 2 && cvn.includes(norm(i.evidence)); y ? kept++ : dropped++; return y; };
const one = (k: string, i: z.infer<typeof Item>) => (ok(i) ? [`- **${k}:** ${i.value}`] : []);
const many = (k: string, xs: z.infer<typeof Item>[]) => { const v = xs.filter(ok).map(i => i.value); return v.length ? [`- **${k}:** ${v.join(', ')}`] : []; };

writeFileSync(new URL('notes/Me.md', root), [
  '# Me', '',
  `Made from my CV on this laptop by ${model} (src/cli/persona.ts). Only items backed by a phrase from the CV are kept. Edit freely: the assistant reads this file as it is.`, '',
  ...one('Role', p.role), ...one('Stage', p.stage), ...one('Location', p.location),
  ...many('Interests', p.interests), ...many('Skills', p.skills), ...many('Languages', p.languages), ...many('Looking for', p.looking_for), '',
].join('\n'));
console.log(`notes/Me.md written: ${kept} items kept, ${dropped} dropped (no exact phrase from the CV), ${(r.ms / 1000).toFixed(0)} s`);
