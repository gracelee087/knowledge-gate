// Temporal setup, the Mastra instance and its workflow, all in one file. @mastra/temporal 0.4.16 rewrites this
// file for the worker; with the workflow or the init() call in other files, the Mastra bundler put them in a
// shared chunk that the rewrite did not recognise, and the worker build failed (E28).
// Each step becomes a Temporal activity, so a run survives a killed worker and picks up at the unfinished step.
//
// processLecture: one new lecture from upload to map. Every step can run again safely:
//   transcript  SerpApi, cached on disk (a second run spends no search)
//   card        src/cli/cards.ts skips a lecture that already has a card
//   addToMap    src/agent/incremental.ts replaces this lecture's own decisions
// Steps run the project's CLIs instead of importing its modules: the Temporal plugin bundles this file into
// node_modules/.mastra/output, where the modules' relative paths (.env, data/) would point to the wrong place.
// The worker is started from the project folder, so process.cwd() is the project root.
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { Mastra } from '@mastra/core';
import { init } from '@mastra/temporal';
import { Client, Connection } from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';

const config = loadClientConnectConfig();
const connection = await Connection.connect(config.connectionOptions);
const client = new Client({ connection });

const { createWorkflow, createStep } = init({
  client,
  taskQueue: 'lecture-gate',
  // The default is 1 minute; a card can take a few minutes with retries. Temporal notices a dead worker only
  // when this runs out, so it is also how long a killed step waits before it runs again.
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 3 },
});

const tsx = (...args: string[]) => execFileSync('npx', ['tsx', ...args], { cwd: process.cwd(), encoding: 'utf8', shell: true });
const last = (log: string) => log.trim().split('\n').at(-1) ?? '';

const transcriptStep = createStep({
  id: 'transcript',
  inputSchema: z.object({ videoId: z.string(), test: z.boolean() }),
  outputSchema: z.object({ videoId: z.string(), test: z.boolean(), log: z.string() }),
  execute: async ({ inputData }) => ({ ...inputData, log: last(tsx('src/cli/transcript.ts', inputData.videoId)) }), // exit 1 = no transcript yet: retried
});

const cardStep = createStep({
  id: 'card',
  inputSchema: z.object({ videoId: z.string(), test: z.boolean(), log: z.string() }),
  outputSchema: z.object({ videoId: z.string(), test: z.boolean(), log: z.string() }),
  execute: async ({ inputData }) => {
    const log = tsx('src/cli/cards.ts', 'do/gemma-4-31B-it', '9999', inputData.videoId);
    if (/FAILED/.test(log)) throw new Error(last(log));
    return { ...inputData, log: /narrated in Korean/.test(log) ? 'narrated in Korean, skipped' : last(log) };
  },
});

const mapStep = createStep({
  id: 'addToMap',
  inputSchema: z.object({ videoId: z.string(), test: z.boolean(), log: z.string() }),
  outputSchema: z.object({ videoId: z.string(), result: z.string() }),
  execute: async ({ inputData }) => {
    if (/narrated in Korean/.test(inputData.log)) return { videoId: inputData.videoId, result: 'skipped: narrated in Korean' };
    const log = tsx('src/agent/incremental.ts', inputData.videoId, ...(inputData.test ? ['--test'] : []));
    return { videoId: inputData.videoId, result: log.trim().split('\n').filter(l => /mentions joined|nearest:|vs batch|checks/.test(l)).join(' | ') };
  },
});

const workflow = createWorkflow({
  id: 'process-lecture',
  inputSchema: z.object({ videoId: z.string(), test: z.boolean() }),
  outputSchema: z.object({ videoId: z.string(), result: z.string() }),
  steps: [transcriptStep, cardStep, mapStep],
})
  .then(transcriptStep)
  .then(cardStep)
  .then(mapStep);

workflow.commit();

export const mastra = new Mastra({ workflows: { processLecture: workflow } });
