// Aggregate trial outputs for the test set into a per-model, per-stage table.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { loadLecture, checkQuote, conceptInTranscript } from '../lib/transcript.ts';
import { nonEnglish } from '../lib/english.ts';

const dir = new URL('../../data/trials/', import.meta.url);
const ids: string[] = readFileSync(new URL('../../data/test_ids.txt', import.meta.url), 'utf8').trim().split(',');
const titles = Object.fromEntries(JSON.parse(readFileSync(new URL('../../data/testset.json', import.meta.url), 'utf8')).test.map((v: any) => [v.videoId, v.title]));
// Talk vs technical comes from the cards themselves: the first saved card's `kind` for each lecture.
const kindOf: Record<string, string> = {};
for (const f of readdirSync(new URL('../../data/trials/', import.meta.url)).filter(f => /\.r\d\.json$/.test(f) && !f.includes('.meta.'))) {
  const id = f.split('.')[0];
  kindOf[id] ??= JSON.parse(readFileSync(new URL(`../../data/trials/${f}`, import.meta.url), 'utf8')).kind;
}
const isTalk = (id: string) => kindOf[id] === 'talk' || kindOf[id] === 'interview';
// USD per 1M tokens (input, output). Gemini API Gemma and local Ollama are free.
const PRICE: Record<string, [number, number]> = { 'do/gemma-4-31B-it': [0.18, 0.5], 'do/openai-gpt-oss-120b': [0.1, 0.7] };

const files = readdirSync(dir);
const models = [...new Set(files.filter(f => f.endsWith('.meta.json') || f.endsWith('.error.txt'))
  .map(f => f.split('.').slice(1, -3).join('.')))];

type Acc = { grounded: number; kinds: Record<string, number>; english: number; cats: Record<string, string[]>; otherCat: number; linked: number; conceptsN: number; runs: number; errors: string[]; schemaOk: number; q: number; qFound: number; qNear: number; chExact: number; ms: number[]; tin: number; tout: number; talkQ: number; talkFound: number; techQ: number; techFound: number; jacc: number[] };
const rows: [string, Acc][] = [];
for (const tag of models) {
  const a: Acc = { grounded: 0, kinds: {}, english: 0, cats: {}, otherCat: 0, linked: 0, conceptsN: 0, runs: 0, errors: [], schemaOk: 0, q: 0, qFound: 0, qNear: 0, chExact: 0, ms: [], tin: 0, tout: 0, talkQ: 0, talkFound: 0, techQ: 0, techFound: 0, jacc: [] };
  let model = tag;
  for (const id of ids) {
    const lecture = loadLecture(id, titles[id]);
    const concepts: Set<string>[] = [];
    for (let run = 1; run <= 3; run++) {
      const base = `${id}.${tag}.r${run}`;
      const meta = new URL(`${base}.meta.json`, dir), err = new URL(`${base}.error.txt`, dir), out = new URL(`${base}.json`, dir);
      if (!existsSync(meta) && !existsSync(err)) continue;
      a.runs++;
      if (existsSync(err) && !existsSync(meta)) { a.errors.push(readFileSync(err, 'utf8').slice(0, 40)); continue; }
      const m = JSON.parse(readFileSync(meta, 'utf8'));
      model = m.model; a.ms.push(m.ms); a.tin += m.inputTokens; a.tout += m.outputTokens;
      if (!existsSync(out)) { a.errors.push('schema/json invalid'); continue; }
      const s = JSON.parse(readFileSync(out, 'utf8'));
      a.schemaOk++;
      if (!nonEnglish(s).length) a.english++;
      if (s.kind) a.kinds[s.kind] = (a.kinds[s.kind] ?? 0) + 1;
      if (s.chapters.length === lecture.chapters.length) a.chExact++;
      for (const c of s.claims) {
        const r = checkQuote(lecture, c.quote ?? c.quote_en, c.at);
        a.q++; if (r.found) a.qFound++; if (r.nearAt) a.qNear++;
        if (isTalk(id)) { a.talkQ++; if (r.found) a.talkFound++; } else { a.techQ++; if (r.found) a.techFound++; }
      }
      const names = s.concepts.map((x: any) => (typeof x === 'string' ? x : x.name).toLowerCase().trim());
      concepts.push(new Set(names));
      if (s.category) { (a.cats[id] ??= []).push(s.category); if (s.category === 'Other') a.otherCat++; }
      for (const c of s.concepts) if (typeof c !== 'string') { a.conceptsN++; if (c.claim_ids?.length) a.linked++; if (conceptInTranscript(lecture, c.name)) a.grounded++; }
    }
    // Stability: mean pairwise Jaccard of concept sets across runs of the same lecture.
    for (let i = 0; i < concepts.length; i++) for (let j = i + 1; j < concepts.length; j++) {
      const inter = [...concepts[i]].filter(x => concepts[j].has(x)).length;
      const uni = new Set([...concepts[i], ...concepts[j]]).size;
      if (uni) a.jacc.push(inter / uni);
    }
  }
  const ver = tag.match(/\.(v\d)$/)?.[1] ?? (tag.includes('gemma-4-31B-it') && a.runs === 10 ? 'v1' : 'v0');
  rows.push([`${model} (${ver})`, a]);
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '-');
const med = (xs: number[]) => (xs.length ? [...xs].sort((x, y) => x - y)[xs.length >> 1] : 0);
const lines = [
  '| model | runs | errors | schema ok | quotes found | quotes near time | quotes found (tech / talk) | chapters exact | English only | concept stability | category stable | category Other | concepts linked | concepts grounded | kinds | median time | $ per lecture |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map(([model, a]) => {
    const p = PRICE[model.replace(/ \(v\d\)$/, '')] ?? [0, 0];
    const ok = a.ms.length || 1;
    const cost = ((a.tin / ok) * p[0] + (a.tout / ok) * p[1]) / 1e6;
    const stab = a.jacc.length ? (a.jacc.reduce((x, y) => x + y, 0) / a.jacc.length).toFixed(2) : '-';
    const catLists = Object.values(a.cats).filter(l => l.length > 1);
    const catStable = catLists.length ? pct(catLists.filter(l => new Set(l).size === 1).length, catLists.length) : '-';
    const catTotal = Object.values(a.cats).flat().length;
    return `| ${model} | ${a.runs} | ${a.errors.length} | ${pct(a.schemaOk, a.runs)} | ${pct(a.qFound, a.q)} | ${pct(a.qNear, a.q)} | ${pct(a.techFound, a.techQ)} / ${pct(a.talkFound, a.talkQ)} | ${pct(a.chExact, a.schemaOk)} | ${pct(a.english, a.schemaOk)} | ${stab} | ${catStable} | ${catTotal ? pct(a.otherCat, catTotal) : '-'} | ${a.conceptsN ? pct(a.linked, a.conceptsN) : '-'} | ${a.conceptsN ? pct(a.grounded, a.conceptsN) : '-'} | ${Object.entries(a.kinds).map(([k, n]) => `${k} ${n}`).join(', ') || '-'} | ${(med(a.ms) / 1000).toFixed(1)}s | ${cost ? '$' + cost.toFixed(4) : '$0'} |`;
  }),
];
const errs = rows.filter(([, a]) => a.errors.length).map(([m, a]) => `- ${m}: ${[...new Set(a.errors)].join('; ')}`);
const md = [lines.join('\n'), '', 'Errors:', ...(errs.length ? errs : ['- none'])].join('\n');
writeFileSync(new URL('../../data/report.md', import.meta.url), md);
console.log(md);
