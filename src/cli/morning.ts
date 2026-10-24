// The laptop's morning routine, one command:
//   1. pull the server's cards and map data from Atlas (src/cli/sync.ts pull), which also rebuilds map/
//   2. merge the new lectures into the personal notes with the local model (src/cli/merge.ts)
//   3. mark the key phrases of each new summary for the morning page (src/cli/highlight.ts)
// The notes never leave the laptop; only public lecture data comes down from Atlas.
// Usage: npx tsx src/cli/morning.ts [merge options, e.g. --model ollama/gemma4:e4b]
import { execFileSync } from 'node:child_process';

const run = (...args: string[]) => execFileSync('npx', ['tsx', ...args], { stdio: 'inherit', shell: true, cwd: new URL('../../', import.meta.url) });
run('src/cli/sync.ts', 'pull');
run('src/cli/merge.ts', ...process.argv.slice(2));
run('src/cli/highlight.ts');
