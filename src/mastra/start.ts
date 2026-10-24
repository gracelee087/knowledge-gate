// Start processLecture for one lecture. The Temporal workflow id is "lecture-<videoId>", so a lecture that is
// already being processed is not started twice (Temporal refuses a second run with a running id).
// Usage: npx tsx src/mastra/start.ts <videoId> [--test]   (waits for the result)
import '../lib/env.ts';
import { mastra } from './index.ts';

export async function startLecture(videoId: string, test = false, wait = false) {
  const run = await mastra.getWorkflow('processLecture').createRun({ runId: `lecture-${videoId}` });
  const input = { inputData: { videoId, test } };
  return wait ? run.start(input) : run.startAsync(input);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('mastra/start.ts')) {
  console.log(JSON.stringify(await startLecture(process.argv[2], process.argv.includes('--test'), true), null, 1));
  process.exit(0);
}
