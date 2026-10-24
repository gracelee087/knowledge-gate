// Temporal worker for the Mastra workflows. Runs as a long-lived process.
// Usage: npx tsx src/mastra/worker.ts   (needs a Temporal server, e.g. `temporal server start-dev`)
import '../lib/env.ts';
import { MastraPlugin } from '@mastra/temporal/worker';
import { NativeConnection, Worker } from '@temporalio/worker';

const connection = await NativeConnection.connect({ address: 'localhost:7233' });
const worker = await Worker.create({
  connection, namespace: 'default', taskQueue: 'lecture-gate',
  // One step at a time: the server has 1 GiB of RAM, and a card step runs a whole Node process.
  maxConcurrentActivityTaskExecutions: 1,
  plugins: [new MastraPlugin(import.meta.resolve('./index.ts'))],
});
console.log('worker ready');
await worker.run();
