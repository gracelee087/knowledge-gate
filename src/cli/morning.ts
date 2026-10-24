// The laptop's morning routine, one command:
//   1. pull the server's cards and map data from Atlas (src/cli/sync.ts pull), which also rebuilds map/
//   2. turn up to 2 new arXiv papers into checked cards (src/cli/sources.ts --n 2)
//   3. merge the new lectures and papers into the personal notes with the local model (src/cli/merge.ts)
//   4. mark the key phrases of each new summary for the morning page (src/cli/highlight.ts)
//   5. rewrite notes/Hackathons.md from public listings (src/cli/hackathons.ts)
//   6. rewrite notes/Travel.md with flight prices for notes/trips.json (src/cli/flights.ts)
// Steps 1, 3 and 4 stop the routine if they fail, as before; a failing step 2, 5 or 6 is logged and the rest go on.
// The notes never leave the laptop; only public data comes down (Atlas, arXiv, listings, flight prices).
// Usage: npx tsx src/cli/morning.ts [merge options, e.g. --model ollama/gemma4:e4b]
import { execFileSync } from 'node:child_process';

const run = (...args: string[]) => execFileSync('npx', ['tsx', ...args], { stdio: 'inherit', shell: true, cwd: new URL('../../', import.meta.url) });
const tryRun = (...args: string[]) => { try { run(...args); } catch (e) { console.error(`morning: ${args[0]} failed, going on: ${(e as Error).message}`); } };
run('src/cli/sync.ts', 'pull');
tryRun('src/cli/sources.ts', '--n', '2');
run('src/cli/merge.ts', ...process.argv.slice(2));
run('src/cli/highlight.ts');
tryRun('src/cli/hackathons.ts');
tryRun('src/cli/flights.ts');
