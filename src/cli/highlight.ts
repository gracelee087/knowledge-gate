// The key phrases of each card's summary, for the light-green marks on the morning page.
// The local model picks one or two phrases; code keeps a phrase only if it appears word for word in the summary,
// so a mark can never show text the card does not have. Cards already done are skipped.
// Usage: npx tsx src/cli/highlight.ts [--model ollama/gemma4:12b]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { chat } from '../lib/llm.ts';

const root = new URL('../../', import.meta.url);
const OUT = new URL('data/highlights.json', root);
const model = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : 'ollama/gemma4:12b';
const Picked = z.object({ phrases: z.array(z.string()).min(1).max(2) });
const SYSTEM = `You mark what a busy reader must not miss in a lecture summary.
Return one or two phrases copied exactly, character for character, from the summary: the core argument or the most useful takeaway.
Each phrase is 4 to 20 words long. Do not rephrase, shorten inside, or join phrases.`;

const done: Record<string, string[]> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
for (const f of readdirSync(new URL('data/cards/', root)).filter(f => f.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(new URL(`data/cards/${f}`, root), 'utf8'));
  const summary: string | undefined = c.card.summary;
  if (!summary || done[c.videoId]) continue;
  const r = await chat(model, SYSTEM, `Summary:\n${summary}`, z.toJSONSchema(Picked));
  const parsed = Picked.safeParse(JSON.parse(r.text));
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const kept = parsed.success ? parsed.data.phrases.map(p => p.trim().replace(/[.,;]$/, '')).filter(p => summary.includes(p) && words(p) >= 4 && words(p) <= 20) : [];
  console.log(`${c.videoId}: ${kept.length}/${parsed.success ? parsed.data.phrases.length : 0} phrases kept (${Math.round(r.ms / 1000)} s)`);
  if (kept.length) { done[c.videoId] = kept; writeFileSync(OUT, JSON.stringify(done, null, 2)); }
}
