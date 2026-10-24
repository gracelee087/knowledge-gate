// Fetch (or read from cache) one lecture's transcript and print its line count; exit 1 if there is none yet.
// Usage: npx tsx src/cli/transcript.ts <videoId>
import { transcript } from '../lib/serpapi.ts';

const t = await transcript(process.argv[2]);
console.log(`${process.argv[2]}: ${t.segments.length} transcript lines`);
if (!t.segments.length) process.exit(1);
