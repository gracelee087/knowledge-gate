# Evidence

Screenshots and records behind the claims in the README. Each one is a real screen or a read-only query result. Where I cropped or placed screenshots side by side, the file says so. Dates are October 2026, Europe/Berlin time unless marked UTC.

Personal notes stay on the laptop. The only note shown here is `Agent Harness`, one of the four sample notes. Screens that show a speaker's name are not published here.

Files ending in `_dev.png` are crops of the screenshots listed here, cut to the part the post talks about so they stay readable at DEV's 800 px width.

## 01 · One new talk on the server (Oct 22)

"Better AI Models Won't Fix Your Engineering Team" (video `Ve2bAarPA2I`): the server steps. Its laptop screens show the speaker's name, so they stay local.

| File | What it shows |
|---|---|
| `T_temporal_retry_Ve2bAarPA2I.png` | Temporal on the server. The card step hit its 5-minute limit once; Temporal retried it by itself (Attempt 2) and the run completed in 9 min 3 s |
| `A_atlas_card_Ve2bAarPA2I.png` | The card in MongoDB Atlas `lecture_gate.cards` (81 documents), written by Gemma 4 31B with prompt v8 |

## 02 · My note grows

| File | What it shows |
|---|---|
| `note_before_after_real.png` | The laptop page, My Note → Agent Harness, before (Oct 20, 42 lines) and after (Oct 21, 44 lines) the GEICO talk was merged. Two real screenshots, cropped and placed side by side; the speaker's name is pixelated. My own words are unchanged; the new point is marked NEW. The "before" page was served from a temporary copy of the notes at the commit before the merge (`72204cc^`) |

## 03 · Temporal and Mastra

| File | What it shows |
|---|---|
| `P_mastra.png` | The Mastra workflow definition (transcript → card → addToMap, 5-minute timeout, 3 attempts) and the same steps as Temporal recorded them |
| `A3_temporal_geico_history.png` / `.json` | One production run (GEICO talk, Oct 21), event history |
| `A3_temporal_geico_timeline.png` | The same run as a timeline |
| `A3_temporal_workflow_list.png` | The workflow list on Oct 21 |
| `E28_kill_history.png`, `E28_kill_timeline.png` | The kill test: the worker was stopped during addToMap, and Temporal ran the step again (Attempt 2) until the workflow completed |

## 04 · MongoDB Atlas

| File | What it shows |
|---|---|
| `A_atlas_vec_index.png` | The vector search index `vec` on `lecture_gate.mentions`: 1024 dimensions, cosine, filter on videoId |
| `A8_atlas_vectors.png` | The stored vectors for the GEICO talk's 5 concepts (bge-m3, first 6 of 1024 numbers shown), and the index definition |
| `A6_atlas.png`, `A6_atlas_quotes.png` | A card document and its quote checks (found / nearAt) |

## 05 · Sentry

| File | What it shows |
|---|---|
| `S_sentry_issue.png` | The real incident LECTURE-GATE-4: the map step failed on the server |
| `S_sentry_llm_calls.png` | LLM calls traced over the project |
| `A_sentry_list.png`, `A_sentry_trace.png`, `A_sentry_trace_attrs.png` | One card call traced end to end (lecture.card → gen_ai.chat → http.client) with its model and prompt version |
| `E13_sentry_local_models.png` | The local model comparison on the laptop: one talk summarized by five Ollama models in one trace |

## 06 · Backboard

| File | What it shows |
|---|---|
| `P_backboard_rules.png`, `P_backboard_snapshot.png` | The rules the agents read before each run, as stored in Backboard (7 by Oct 22) |
| `P_backboard.png` | An earlier read-only query (Oct 21): 5 adopted rules with the verifier's evidence, and 2 rejected ones |

## 07 · Cost (DigitalOcean)

| File | What it shows |
|---|---|
| `DO_cost_compact.png` | Month-to-date bill, Oct 1–21. lecture-gate is GenAI Serverless Inference $0.83 + Droplets $0.02; "Apps $1.48" is another project on the same account |
| `DO_droplet_cpu_disk.png`, `DO_droplet_bandwidth.png` | The 1 vCPU droplet during runs |

## Figures

| File | What it shows |
|---|---|
| `lecture-gate-flow.png` | The flow: server (Temporal + Mastra + Gemma 4 31B) → Atlas → laptop (Gemma 4 12B, my notes) |
| `agent-roles.png` | The agents and what each one does |
| `map_concept_graph.png` | The concept map built from the talks |

## 09 · SerpApi

| File | What it shows |
|---|---|
| `S_serpapi_searches.png` | The SerpApi search log, Oct 15–22: one `youtube_video_transcript` request per row, the top row being the talk in 01 (Oct 22, 19:01 UTC); 105 of 250 searches used. The dashboard's menu was cropped off |
