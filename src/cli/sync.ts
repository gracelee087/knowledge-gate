// Move the map's source data between the server and the laptop through MongoDB Atlas.
// Only public lecture data goes through Atlas; personal notes stay on the laptop.
//   push (server, after each lecture): every card -> lecture_gate.cards; concepts.json, categories.json,
//        videos.json and skipped.json (why an upload has no card) -> lecture_gate.state (one document each)
//   pull (laptop, in the morning): the same back into data/, then the map is rebuilt; run merge.ts after it
// Usage: npx tsx src/cli/sync.ts push|pull
import '../lib/env.ts';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { db, closeDb } from '../lib/db.ts';

const data = (p: string) => new URL(`../../data/${p}`, import.meta.url);
const STATE = ['concepts.json', 'categories.json', 'videos.json', 'skipped.json'];

// Old paper entries (from a removed arXiv step) exist in videos.json on the laptop only; a pull keeps them.
export function keepLocalPapers(atlas: any[], local: any[]) {
  const ids = new Set(atlas.map(v => v.videoId));
  return atlas.concat(local.filter(v => v.kind === 'paper' && !ids.has(v.videoId)));
}

export async function push() {
  const d = await db();
  const files = readdirSync(data('cards/')).filter(f => f.endsWith('.json'));
  if (files.length) await d.collection('cards').bulkWrite(files.map(f => {
    const card = JSON.parse(readFileSync(data(`cards/${f}`), 'utf8'));
    return { replaceOne: { filter: { videoId: card.videoId }, replacement: card, upsert: true } };
  }));
  // Why an upload has no card (narrated in Korean, same talk as another, gave up after N tries), for the laptop's page.
  writeFileSync(data('skipped.json'), JSON.stringify(Object.fromEntries(readdirSync(data('cards/')).filter(f => f.endsWith('.skipped.txt'))
    .map(f => [f.replace('.skipped.txt', ''), readFileSync(data(`cards/${f}`), 'utf8').trim()]))));
  for (const f of STATE) await d.collection('state').replaceOne({ _id: f as any }, { _id: f as any, json: readFileSync(data(f), 'utf8'), at: new Date() }, { upsert: true });
  return `pushed ${files.length} cards and ${STATE.join(', ')}`;
}

export async function pull() {
  const d = await db();
  mkdirSync(data('cards/'), { recursive: true });
  const local = new Set(readdirSync(data('cards/')));
  let added = 0;
  for (const c of await d.collection('cards').find({}, { projection: { _id: 0 } }).toArray()) {
    if (!local.has(`${c.videoId}.json`)) added++;
    writeFileSync(data(`cards/${c.videoId}.json`), JSON.stringify(c, null, 1));
  }
  for (const f of STATE) {
    const s = await d.collection('state').findOne({ _id: f as any });
    if (s) writeFileSync(data(f), f === 'videos.json' && existsSync(data(f))
      ? JSON.stringify(keepLocalPapers(JSON.parse(s.json), JSON.parse(readFileSync(data(f), 'utf8'))), null, 1) : s.json);
  }
  writeFileSync(data('last_pull.json'), JSON.stringify({ at: new Date().toISOString(), cards: local.size + added })); // shown on the local page
  return `pulled cards (${added} new) and ${STATE.join(', ')}`;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('cli/sync.ts')) {
  const mode = process.argv[2];
  if (mode !== 'push' && mode !== 'pull') { console.log('usage: sync.ts push|pull'); process.exit(1); }
  console.log(mode === 'push' ? await push() : await pull());
  await closeDb();
  if (mode === 'pull') execFileSync('npx', ['tsx', 'src/cli/map.ts'], { stdio: 'inherit', shell: true, cwd: new URL('../../', import.meta.url) });
}
