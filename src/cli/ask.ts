// Ask: a question about the lectures and my notes, answered on the laptop by a local model (src/lib/ask.ts).
// The morning page is a report; this is for the follow-up question it raises.
// Notes are only read, never written. Nothing leaves the laptop.
// Usage: npx tsx src/cli/ask.ts "question" [--model ollama/gemma4:12b] [--k 8]
import { ask } from '../lib/ask.ts';

const arg = (name: string) => (process.argv.indexOf(name) > 0 ? process.argv[process.argv.indexOf(name) + 1] : null);
const question = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
if (!question) { console.log('usage: npx tsx src/cli/ask.ts "question" [--model ollama/gemma4:12b] [--k 8]'); process.exit(1); }

const a = await ask(question, arg('--model') ?? 'ollama/gemma4:12b', Number(arg('--k') ?? 8));
console.log(`\n${a.text}\n`);
console.log('Sources');
for (const s of a.sources) {
  if (s.kind === 'morning') console.log('  [M] notes/00 Morning.md');
  else if (s.kind === 'note') console.log(`  [${s.id}] notes/${s.name}.md (read only)`);
  else console.log(`  [${s.id}] ${s.title} — ${s.claim}${s.quote ? `\n        "${s.quote}"` : ''}\n        ${s.link}`);
}
if (!a.sources.length) console.log('  (the answer cites no source; treat it as unsupported)');
if (a.fake.length) console.log(`  ignored citations that do not exist: ${a.fake.join(', ')}`);
console.log(`\n${a.claims} claims searched, ${a.notes} note(s) used; ${a.model}; ${a.seconds} s`);
