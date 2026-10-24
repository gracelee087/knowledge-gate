// Load the batch results into MongoDB Atlas so new lectures can be compared with old ones by meaning.
//   mentions: one document per concept mention (lecture, name, what, concept) with a bge-m3 vector of "name: what"
//   lectures: one document per lecture (title, one line, category)
// A vector search index on mentions.vector finds the old mentions closest to a new one.
// Usage: npx tsx src/cli/index.ts [--except id,id]   (rebuilds both collections; --except leaves lectures out, for tests)
import '../lib/env.ts';
import { readFileSync } from 'node:fs';
import { db, closeDb } from '../lib/db.ts';
import { embed } from '../lib/embed.ts';

export const EMBED = 'do/bge-m3';
const read = (p: string) => JSON.parse(readFileSync(new URL(`../../data/${p}`, import.meta.url), 'utf8'));
const except = process.argv.includes('--except') ? process.argv[process.argv.indexOf('--except') + 1].split(',') : [];

const mentions = read('concepts.json').mentions.filter((m: any) => !except.includes(m.videoId));
const cats = read('categories.json');
const lectures = cats.assignments.filter((a: any) => !except.includes(a.videoId)).map((a: any) => {
  const c = read(`cards/${a.videoId}.json`);
  return { videoId: a.videoId, title: c.card.title, one_line: c.card.one_line, category: a.category };
});

const vectors = await embed(EMBED, mentions.map((m: any) => `${m.name}: ${m.what}`));
const d = await db();
await d.collection('mentions').deleteMany({});
await d.collection('mentions').insertMany(mentions.map((m: any, i: number) => ({
  videoId: m.videoId, title: m.title, name: m.name, what: m.what, concept: m.concept, vector: vectors[i],
})));
await d.collection('lectures').deleteMany({});
await d.collection('lectures').insertMany(lectures);

const indexes = await d.collection('mentions').listSearchIndexes().toArray();
if (!indexes.some(i => i.name === 'vec')) {
  await d.collection('mentions').createSearchIndex({
    name: 'vec', type: 'vectorSearch',
    definition: { fields: [{ type: 'vector', path: 'vector', numDimensions: vectors[0].length, similarity: 'cosine' }, { type: 'filter', path: 'videoId' }] },
  });
}
// The index builds in the background; wait until searches can use it.
for (let i = 0; ; i++) {
  const [ix]: any[] = await d.collection('mentions').listSearchIndexes('vec').toArray();
  if (ix?.queryable && ix.status === 'READY') break;
  if (i > 60) throw new Error(`vector index not ready: ${ix?.status}`);
  await new Promise(r => setTimeout(r, 5000));
}
console.log(`Atlas: ${mentions.length} mentions (${vectors[0].length}-dim ${EMBED}), ${lectures.length} lectures; vector index ready${except.length ? `; left out ${except.join(', ')}` : ''}`);
await closeDb();
