// Trial: summarize the given videos with the given models, check every quote, save outputs and a table.
// Usage: npx tsx src/cli/trial.ts <videoId,videoId> <model,model> [runs]
import '../lib/env.ts';
import * as Sentry from '@sentry/node';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chat } from '../lib/llm.ts';
import { loadLecture, checkQuote } from '../lib/transcript.ts';
import { cardPrompt } from '../lib/card.ts';
import { z } from 'zod';
import { SCHEMAS, type PromptVersion } from '../schema/summary.ts';
import { nonEnglish } from '../lib/english.ts';

Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 1.0 });

const [ids, models, runsArg, versionArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 1);
const version = (versionArg ?? 'v2') as PromptVersion;
const Summary = SCHEMAS[version];
const summaryJsonSchema = z.toJSONSchema(Summary);
const videos = JSON.parse(readFileSync(new URL('../../data/videos.json', import.meta.url), 'utf8'));
const system = readFileSync(new URL(`../../prompts/summarize.${version}.md`, import.meta.url), 'utf8');
const outDir = new URL('../../data/trials/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const rows: string[] = [];
for (const videoId of ids.split(',')) {
  const lecture = loadLecture(videoId, videos.find((v: any) => v.videoId === videoId)?.title ?? videoId);
  const prompt = cardPrompt(lecture, system); // v8 on: plus the claim count for this lecture
  for (const model of models.split(',')) {
    for (let run = 1; run <= runs; run++) {
      await Sentry.startSpan({ op: 'lecture.summarize', name: `summarize ${videoId}`, attributes: { model, run, prompt: version } }, async () => {
        const tag = `${videoId}.${model.replace(/[\/:]/g, '_')}.${version}.r${run}`;
        try {
          const r = await chat(model, system, prompt, summaryJsonSchema);
          writeFileSync(new URL(`${tag}.raw.txt`, outDir), r.text);
          writeFileSync(new URL(`${tag}.meta.json`, outDir), JSON.stringify({ videoId, model, run, ms: r.ms, inputTokens: r.inputTokens, outputTokens: r.outputTokens }));
          const parsed = Summary.safeParse(JSON.parse(r.text));
          const quotes = parsed.success ? parsed.data.claims.map(c => checkQuote(lecture, c.quote, c.at)) : [];
          if (parsed.success) writeFileSync(new URL(`${tag}.json`, outDir), JSON.stringify(parsed.data, null, 1));
          const korean = parsed.success ? nonEnglish(parsed.data) : [];
          const ch = parsed.success ? `${parsed.data.chapters.length}/${lecture.chapters.length}` : '-';
          rows.push(`| ${videoId} | ${model} | ${run} | ${(r.ms / 1000).toFixed(1)}s | ${r.inputTokens}/${r.outputTokens} | ${parsed.success ? 'ok' : 'FAIL'} | ${quotes.filter(q => q.found).length}/${quotes.length} | ${quotes.filter(q => q.nearAt).length}/${quotes.length} | ${ch} | ${parsed.success ? (korean.length ? `NO (${korean.length})` : 'yes') : '-'} |`);
        } catch (e) {
          rows.push(`| ${videoId} | ${model} | ${run} | - | - | ERROR ${(e as Error).message.slice(0, 80)} | - | - | - | - |`);
          writeFileSync(new URL(`${tag}.error.txt`, outDir), (e as Error).message);
        }
        console.log(rows.at(-1));
      });
    }
  }
}
const table = ['| video | model | run | time | tokens in/out | schema | quotes found | quotes near time | chapters | English only |', '|---|---|---|---|---|---|---|---|---|---|', ...rows].join('\n');
writeFileSync(new URL(`trial_${models.replace(/[\/:,]/g, '_')}_${Date.now()}.md`, outDir), table);
console.log('\n' + table);
await Sentry.flush(10000);
