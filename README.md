# knowledge-gate



New AI talks from a few YouTube channels become checked cards, the cards grow into one map of concepts,
and every morning the new points are added to my own notes on the laptop, by a local model.

```
server (DigitalOcean Droplet)                          laptop
YouTube push ─► Mastra workflow on Temporal             log in / unlock
  1 transcript   SerpApi (cached)                         sync.ts pull   Atlas ─► data/, map/
  2 card         Gemma 4 31B + checks (quotes, format)    merge.ts       embeddinggemma + gemma4:12b (Ollama)
  3 map          bge-m3 ─► Atlas vector search ─► Gemma     ─► notes/ (append only, own git) + 00 Morning.md
                 decides, a second call checks           ask.ts         questions over cards and notes
  ─► MongoDB Atlas
nightly 03:00 UTC: verify.ts turns repeated mistakes into rules (Backboard) that the card and map prompts read
```

Personal notes never leave the laptop: `notes/` is gitignored and only Ollama reads it.

## Setup

Node 22. Install with the lockfile and without install scripts:

```
npm ci --ignore-scripts
cp .env.example .env   # then fill it in
```

Server: `deploy/push.sh` copies the project to the Droplet, `deploy/setup.sh` installs Node, the Temporal CLI and
the systemd units in `deploy/` (Temporal, worker, webhook, watchdog every 3 hours, verifier at 03:00 UTC).

Laptop: install [Ollama](https://ollama.com) and pull `gemma4:12b` and `embeddinggemma`.

```
npx tsx src/cli/merge.ts --init          # first time: copy notes.sample/ into notes/ (your own notes go here)
npm run morning                          # pull from Atlas, merge into notes/, mark key phrases
npm run web                              # the local page on http://127.0.0.1:4321
npm run ask -- "a question"              # answered only from the cards and your notes, with sources
```

The local page shows the morning's new talks, each section of the map, **My Note** (each of your notes in full,
with what the merge added under your own words, newest first) and a chat over the cards and your notes.
It listens on 127.0.0.1 only and loads nothing from the internet.

`deploy/morning-task.ps1` runs the morning step from Windows Task Scheduler at log-in and unlock.

## Where things are

| | |
|---|---|
| `src/mastra/` | the fixed workflow (transcript → card → map) and its Temporal worker |
| `src/lib/card.ts` | card prompt, checks and the revision loop |
| `src/agent/` | concept map: batch build, incremental join for a new lecture, nightly verifier |
| `src/cli/` | one script per task; each file starts with what it does and its usage |
| `docs/EXPERIMENTS.md` | the measurements behind each choice (models, thresholds) |
| `docs/ISSUES.md` | known problems |
| `docs/evidence/` | screenshots behind the claims in the write-up, grouped by step ([index](docs/evidence/README.md)) |

There are no automated tests yet.

## Added on 2026-10-24

Each item was run once on 2026-10-24. `npm run morning` now also runs the arXiv, hackathon and flight steps;
if one of those fails, it is logged and the rest go on.

- **arXiv papers** (`src/cli/sources.ts`): new cs.AI / cs.CL papers about agents; the abstract becomes a card
  with the same quote check as a talk, using `do/gemma-4-31B-it`. One test card: 3 claims, 3 of 3 quotes found, 12 s.
  `npx tsx src/cli/sources.ts --n 2`
- **Answers to open questions** (`src/cli/merge.ts`): a claim that answers a question under `## Open questions`
  in a note is marked 🔔 and listed first in `notes/00 Morning.md`. Text sources link to the page, not to a YouTube second.
- **Hackathons** (`src/cli/hackathons.ts`): `notes/Hackathons.md` from hackathonhub.eu (sitemap and JSON-LD; the
  first 20 event pages by default, a sample, not all events), the Devpost API and DEV challenge posts. No model;
  every field is copied from the listing. `npx tsx src/cli/hackathons.ts [--hub N]`
- **Flights** (`src/cli/flights.ts`): `notes/Travel.md` with Google Flights prices via SerpApi (cached per day) for
  the trips in `notes/trips.json`, and the monthly fuel surcharge table (Korean Air, Asiana) from ktravelacademy.com.
  `npx tsx src/cli/flights.ts`
- **Profile from a CV** (`src/cli/persona.ts`): `notes/Me.md`, local Ollama only; every item is kept only if its
  phrase is in the CV. Set `PYTHON` in `.env` to a real `python.exe` for a PDF CV.
  `npx tsx src/cli/persona.ts <cv.pdf|cv.txt>`
- **Voice questions** (`src/lib/stt.ts`): local Whisper (transformers.js 4.3.1) turns a spoken question on the
  local page into text.

## License

MIT © 2026 Sohee Lee
