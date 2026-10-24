# Experiments log

Every test we ran while building the lecture map, oldest first. Numbers are measured, not estimated, unless a line says "estimate". Raw outputs live in `data/` (not committed); the scripts that produced them are named in each entry.

Machine: Windows 11 laptop, no NVIDIA GPU, 15.4 GB RAM. Ollama 0.32.15.

---

## E1 — How fast is Whisper on a laptop CPU? (2026-10-20)
- **Question:** can a laptop with no GPU transcribe lectures overnight?
- **Setup:** faster-whisper 1.2.1, int8, CPU, VAD on. 10-minute clip of a Stanford lecture.
- **Result:**

  | model | load | transcribe 600 s of audio | real-time factor |
  |---|---|---|---|
  | base | 15.7 s | 63.7 s | 0.106 |
  | small | 4.9 s | 215.4 s | 0.359 |

  A 10-minute TechBridge clip took 1 min 52 s end to end with base (model load included).
- **Conclusion:** usable as a fallback, too slow to be the main path for 30 hours of lectures.

## E2 — Can we fetch YouTube transcripts directly? (2026-10-20)
- **Setup:** yt-dlp 2026.08.19 from the home connection, then from a DigitalOcean Droplet (s-4vcpu-8gb, ams3, about 8 minutes of runtime).
- **Result:**
  - Home: subtitle download failed twice with HTTP 429; audio download worked.
  - Droplet: both audio and subtitles failed with "Sign in to confirm you're not a bot".
  - Whisper base on the Droplet: 159.8 s for the same 10-minute clip (real-time factor 0.266), slower than the laptop.
- **Conclusion:** YouTube blocks scripted transcript fetches, and blocks data-center IPs harder. We need another source (→ E5).

## E3 — Can a small local model drive an agent by itself? (2026-10-20)
- **Setup:** Mastra 1.78.0 agent with two tools (get transcript, check my notes), Ollama `gemma4:e4b`, one run.
- **Result:** 52.5 s. It called the transcript tool once, never called the notes tool, and answered by asking for the video ID it had just used.
- **Conclusion:** one run is not proof, but we stopped letting a small model choose the steps. Steps are fixed in a workflow; models get one job at a time.

## E4 — How much does one channel publish? (2026-10-20)
- **Setup:** SerpApi `youtube_channel`, @TechBridge-KR, 6 pages.
- **Result:**
  - About 3 uploads a day; 2 to 4 per day across the last 14 days.
  - 179 videos reached back about 2 months: 68.4 hours of video. Median 19.3 minutes, longest 76 minutes.
  - Last 30 days: 77 videos, 30.6 hours.
- **Conclusion:** one channel posts more than a person can watch. This is the problem the project solves.

## E5 — SerpApi as the transcript source (2026-10-20)
- **Setup:** SerpApi `youtube_video_transcript`, English auto-captions.
- **Result:**
  - A 35-minute lecture: 273 timed segments in 9.9 s, no 429. One search used.
  - Every response also carried the channel's own chapter list.
  - Last 30 days: 76 of 77 transcripts fetched. The miss was a Korean-language video with no English captions. 75 searches used.
  - A video uploaded 2 hours earlier had no transcript yet.
- **Conclusion:** SerpApi is the main transcript path. A just-uploaded video needs a delayed retry.

## E6 — Free and cheap places to run Gemma in the cloud (2026-10-20)
- **Result:**
  - DigitalOcean serverless inference serves Gemma 4 31B IT (256K context): $0.18 input / $0.50 output per 1M tokens. First call: 1.2 s.
  - Gemini API serves `gemma-4-26b-a4b-it` and `gemma-4-31b-it`, free of charge. Its replies include the model's thinking as extra parts, which we filter out.
  - Backboard lists 16,338 LLMs, including Gemma 4 26B and 31B, but its free credit covers memory and RAG only; a chat call was refused.

## E7 — Vector search on the free MongoDB Atlas tier (2026-10-20)
- **Setup:** Atlas M0 (free), AWS Frankfurt, MongoDB 8.0.34.
- **Result:** connected in 1.2 s; a `vectorSearch` index became queryable after 20 s; a `$vectorSearch` query returned the nearest document first (score 0.997).
- **Conclusion:** the free tier is enough for the map.

## E8 — First summaries and the quote checker (2026-10-20)
- **Setup:** 2 lectures (BM25 talk, 18 min; Altman–Benioff interview, 37 min), prompt v0, one run each. Code checks that every quote appears in the transcript and sits within ±30 s of its timestamp.
- **Result:**
  - Gemma 4 31B (DigitalOcean): quotes 5/5 on the interview. On the BM25 talk, the checker first rejected 2 of 4 quotes.
  - Those 2 quotes were real: the model had dropped the "uh"s that auto-captions contain. After the checker learned to ignore fillers: 4/4.
  - Gemma 4 26B (Gemini API): quotes 5/5 on the BM25 talk, but only 1/5 on the long interview; the other 4 stitched or reworded sentences.
  - Gemma 4 31B (Gemini API): once returned 503 (overloaded).
- **Conclusion:** the checker is needed, and it can be wrong too. Its first lesson went into `LESSONS.md`.

## E9 — Cloud models on a 10-lecture test set, 3 runs each (2026-10-20, interim)
- **Setup:** 10 lectures spread by length (8 to 46 minutes, technical talks and interviews), prompt v0, 3 runs per model. Script: `src/cli/trial.ts`, table: `src/cli/report.ts`.
- **Result:**

  | model | runs | errors | schema ok | quotes found | quotes found (technical / talk) | chapters exact | concept stability | median time | $ per lecture |
  |---|---|---|---|---|---|---|---|---|---|
  | Gemma 4 31B (DigitalOcean) | 30 | 1 | 97% | 90% | 91% / 86% | 100% | 0.39 | 29.6 s | $0.0018 |
  | gpt-oss-120b (DigitalOcean) | 30 | 0 | 100% | 71% | 80% / 52% | 100% | 0.05 | 31.8 s | $0.0021 |
  | Gemma 4 26B (Gemini API, free) | 16 | 13 | 19% | — | — | — | — | 16.5 s | $0 |
  | Gemma 4 31B (Gemini API, free) | 30 | 26 | 13% | — | — | — | — | 69.3 s | $0 |

  - Concept stability = mean Jaccard overlap of the concept list across the 3 runs of the same lecture (1.0 = identical).
  - Gemini API errors seen: 429 quota exceeded (22 runs), 500 (9), 503 (4), and fetch failures. Too few successful Gemini runs to compare quality.
- **Conclusion:** Gemma 4 31B on DigitalOcean is the most faithful, especially on long interviews. The free Gemini API cannot carry bulk work; it stays at the back of the fallback order. Concept names change from run to run (0.39), which would split one concept across several pages; the prompt must fix names.

## E10 — Adding category, speakers and per-concept notes (2026-10-20)
- **Setup:** prompt v1 (Korean output), Gemma 4 31B on DigitalOcean, the same 10 lectures, 1 run each.
- **Result:** schema 10/10; quotes found 37/42; chapters exact 9/10 (one lecture returned 6 of 13 chapters).

## E11 — English cards (2026-10-20)
- **Setup:** prompt v2 (all English), Gemma 4 31B on DigitalOcean, BM25 talk, 1 run.
- **Result:** 26.1 s; quotes 5/5; chapters 11/11; speaker "Joe Bergam, Hornet Dev" (both appear at 0:00 and 0:03 of the transcript, spelled as in auto-captions). Wrong: `kind` = news and `category` = Other for a technical search talk, and every concept's `claim_ids` was empty.
- **Next:** describe each category and kind in the prompt, require stable concept names, and compare against v2 on the test set.

## E12 — Prompt v3: defined categories, glossary concept names, required claim links (2026-10-20)
- **Question:** does describing each category and kind, and requiring every concept to cite a claim, fix what E11 got wrong without hurting quotes?
- **Setup:** Gemma 4 31B on DigitalOcean, the 10-lecture test set, 3 runs per lecture, prompt v2 vs v3 (`prompts/summarize.v3.md`, schema `LectureCardV3`). Table from `src/cli/report.ts`.
- **Result:**

  | prompt | runs | errors | schema ok | quotes found (technical / talk) | chapters exact | concept stability | category stable | category Other | concepts linked | median time |
  |---|---|---|---|---|---|---|---|---|---|---|
  | v2 | 30 | 4 | 87% | 88% (87% / 90%) | 100% | 0.49 | 78% | 88% | 0% | 22.9 s |
  | v3 | 30 | 1 | 97% | 90% (90% / 91%) | 100% | 0.51 | 100% | 0% | 100% | 25.7 s |

  - Category stable = share of lectures whose 3 runs picked the same category.
  - Concepts linked = share of concepts with at least one `claim_id`.
  - Cost per lecture stayed about $0.0017 (token counts × list price).
- **Conclusion:** v3 replaces v2. Categories went from mostly "Other" to always a real one, and stable across runs. Concept names are still only half stable (0.51): the same idea can get two names across runs, so the map still needs a name-normalization step before concept pages are merged.

## E14 — Are the cards really English only? (2026-10-20)
- **Question:** the channel's titles and chapter names are Korean and the prompt says "translate them". Does every model do it?
- **Setup:** new code check `src/lib/english.ts` flags any string in a card that contains Hangul. Re-scored every saved card; added an "English only" column to `report.ts` and `trial.ts`.
- **Result:**
  - Prompt v3: 34 cards saved; 2 contain Korean, both from small local models on the BM25 lecture (Gemma 4 E2B and E4B copied the Korean chapter titles). All 30 Gemma 4 31B cards: English only.
  - Prompt v2 (Gemma 4 31B): 92% of cards English only.
  - v0/v1 asked for Korean on purpose, so they score 0%.
- **Change:** prompt v4 = v3 + an English `title` field (notes no longer need the Korean video title) + "No Korean characters anywhere". One run, Gemma 4 31B, BM25 lecture: title "Why 30-Year-Old BM25 is Surprisingly Powerful in Agent Search", English only yes, chapters 11/11, quotes 4/5, 23.1 s.
- **Conclusion:** a prompt instruction is not enough for small models; the code check decides. v4 on the full test set is still to be run before it replaces v3.

## E15 — Prompt v4 on the full test set (2026-10-20)
- **Question:** does v4 (English `title`, "no Korean anywhere") keep v3's quality?
- **Setup:** Gemma 4 31B on DigitalOcean, 10-lecture test set, 3 runs. 3 runs first ended with `fetch failed` (network) and were re-run.
- **Result:**

  | prompt | runs | errors | schema ok | quotes found (technical / talk) | chapters exact | English only | concept stability | category stable | category Other | concepts linked | median time | $ per lecture |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|
  | v3 | 30 | 1 | 97% | 90% (90% / 91%) | 100% | 100% | 0.51 | 100% | 0% | 100% | 25.7 s | $0.0017 |
  | v4 | 30 | 0 | 100% | 92% (90% / 100%) | 97% | 100% | 0.49 | 90% | 0% | 100% | 24.1 s | $0.0017 |

  - The one chapter miss: VOToAHcnhyA run 2 returned 1 of 11 chapters with 600 output tokens (other runs: ~1,100); it stopped early.
  - The one category change: VOToAHcnhyA got "Harness & agent design" twice and "Evaluation, verification & security" once (v3: Evaluation 3 times). Every other lecture kept the same category as v3.
- **Conclusion:** v4 replaces v3; the differences come from one lecture. A card with fewer chapters than the channel lists must fail the checks and be retried.

## E13 — Local models on a laptop CPU (2026-10-20)
- **Question:** which model can make cards on the laptop, for the morning step and as the last fallback?
- **Setup:** Ollama, prompt v3, `num_ctx` 24576, 1 run each on 2 lectures: the BM25 talk (yNPS1Z64wQM, 18 min, ~5,200 input tokens) and the Altman–Benioff interview (vMlsLmKuFZk, 37 min, ~10,800 input tokens). Qwen3 8B is the non-Gemma open-weight baseline. 12B and Qwen3 8B first hit the client timeout (see LESSONS) and were re-run.
- **Result:**

  | model | BM25: time | quotes | chapters | English only | interview: time | quotes | chapters | English only | interview `kind` |
  |---|---|---|---|---|---|---|---|---|---|
  | Gemma 4 E2B | 219.6 s | 4/4 | 11/11 | no | 337.3 s | 4/5 | 8/8 | yes | talk |
  | Gemma 4 E4B | 477.2 s | 5/5 | 11/11 | no | 599.0 s | 5/5 | 8/8 | yes | interview |
  | Gemma 4 12B | 1306.6 s | 4/4 | 11/11 | yes | 1221.7 s | 4/4 | 8/8 | yes | talk |
  | Gemma 3 4B | 680.9 s | 1/3 | 11/11 | yes | 584.5 s | 0/4 | 8/8 | yes | talk |
  | Qwen3 8B | 1154.4 s | 5/5 | 11/11 | yes | 2022.5 s | 4/5 | 8/8 | yes | talk |

  - All 10 cards passed the schema, and every concept cited at least one claim.
  - Speaker spelling on the interview (auto-captions): E2B "Mark Venioff", E4B and Qwen3 8B "Mark Benioff", 12B "Marc Benioff", Gemma 3 4B "Mark Vini off".
  - Category: every model chose "Context, memory & search" for BM25; for the interview, all chose "AI industry & leaders" except Gemma 3 4B ("Self-improving agents").
  - For comparison, Gemma 4 31B on DigitalOcean takes about 20–25 s per lecture (E15).
- **Conclusion:** one run on two lectures, so this ranks, it does not prove. Gemma 4 E4B had every quote right on both lectures and was the only model to call the interview an interview, at 2–3× the speed of 12B and Qwen3 8B. Gemma 3 4B invents quotes (1/7 found) and is dropped. A CPU laptop needs 4–34 minutes per card, so it can only be the fallback for cards; its real job is the shorter morning merge.

## E16 — Cards for every lecture of the month (2026-10-20)
- **Setup:** `src/cli/cards.ts`, Gemma 4 31B on DigitalOcean, prompt v4, 77 lectures oldest first. A card fails if the schema breaks, any Korean is left, or the chapter count differs from the channel's; it is tried up to 3 times. Quotes are checked per claim and stored with the card.
- **Result:**
  - 74 cards out of 76 lectures that have an English transcript. 70 passed on the first attempt, 2 on the second, 2 on the third.
  - Quotes found verbatim: 311 of 356 (87.4%); 49 cards had every quote found.
  - Median 28.0 s per successful call (13.5 s to 76.5 s).
  - Retries: one card hit the 120 s timeout twice, then passed; others failed the Korean check once or twice.
  - Failed: ffzZCOWth68 is a Korean-language lecture (71 of 132 transcript lines are Korean), so verbatim quotes are Korean and can never pass the English rule. B1FXnXlIm8c kept Korean chapter titles in all 3 attempts (cause not known).
  - Skipped: WPJoi3ezJJc has no English transcript.
  - Categories: Harness & agent design 35, Dev workflow & software factories 12, Evaluation, verification & security 9, AI industry & leaders 8, Context, memory & search 7, Self-improving agents 2, Other 1. Kinds: talk 36, technical 29, interview 9.
  - Tokens for the resumed run: 566,637 in / 94,699 out (about $0.15 at list price; the first 4 cards are not in this count).
- **Conclusion:** every saved card is English and has the full chapter list. Korean-language lectures need their own path (skip, or quote in Korean and translate). Half the cards land in one category, so the category list may need splitting.

## E17 — Lectures narrated in Korean (2026-10-20)
- **Question:** why did some "English" auto-caption transcripts contain Korean, and can those lectures still get a checked card?
- **Finding:** 4 of 76 transcripts contain Korean lines: `_RSwx0GvVvY` 73/73, `6gakvEF9m20` 42/53, `ffzZCOWth68` 71/132, `OLYuAekOBeA` 44/84. All were fetched as English auto-captions (`language_code=en`, `type=asr`). The Korean lines are spoken narration by the channel (for example an English clip at 0:16–0:25 of ffzZCOWth68, then Korean narration from 0:25), not a subtitle track. These are the channel's own Korean explainers about English-language sources.
- Before this fix, Gemma 4 31B translated the Korean speech into English quotes, which the checker can't find: `_RSwx0GvVvY` 0/5, `6gakvEF9m20` 2/4.
- **Change:** prompt v5 (`LectureCardV5`): `quote` stays verbatim in the transcript's language and `quote_en` carries an English translation; the English-only check allows Korean only in `quote`. The quote checker now keeps letters of any script (re-check of all 74 saved cards: 311 found before and after, 0 changed). `cards.ts` picks v5 when at least 10% of transcript lines contain Korean.
- **Result:** all 4 lectures got a card: `OLYuAekOBeA` 5/5, `ffzZCOWth68` 4/4, `6gakvEF9m20` 4/4, `_RSwx0GvVvY` 4/4 (after two 120 s timeouts). Old v4 cards kept in `data/cards_v4_korean/`.
- **Decision (same day):** for this project the map covers English lectures only. The 5 Korean-language lectures (the 4 above plus `WPJoi3ezJJc`, which has no English transcript) are left out; `cards.ts` now skips any transcript with at least 10% Korean lines. Their v5 cards are kept in `data/cards_excluded_korean/`; prompt v5 stays in the repo, unused.
- **Map after the decision:** 72 English lectures, 71 cards (1 failed: `B1FXnXlIm8c`, kept as a recorded failure, not retried). Quotes found verbatim: 304 of 342 (88.9%). 2 cards needed a retry.

## E18 — Fixing `kind` and concept names copied from the prompt (2026-10-20)
- **Question:** the BM25 card said `kind: talk` for a technical talk and named a concept "Retrieval-Augmented Generation", a term the lecture never uses. Can the prompt fix both?
- **Finding before the fix:** the BM25 transcript has "retrieval" 23 times and "RAG" or "retrieval-augmented" 0 times. The 4 concept names given as examples in prompt v4 were used 18 times across all cards; 6 of those 18 uses are on lectures whose transcript never says the term. New report column "concepts grounded": every word of the concept name (first 5 letters) or its acronym appears in the transcript.
- **Setup:** prompt v6 = v4 with (a) `technical` vs `talk` defined by whether the lecture explains how something works, and (b) concept names must be terms the speaker uses, no example names. Gemma 4 31B on DigitalOcean, 10-lecture test set, 3 runs.
- **Result (v4 → v6):** quotes found 92% → 95%; chapters exact 97% → 100%; concepts grounded 95% → 99%; concept stability 0.49 → 0.53; category stable 90% → 100%; 3 runs ended in the 120 s timeout. `kind`: the BM25 lecture went talk → technical in 3 of 3 runs. But the Jensen Huang interview (`XZuws4hFG4o`, it opens with "Jensen, thank you for doing this today") went interview → talk in 3 of 3 runs.
- **Next:** v7 puts the format test first ("two or more people talking is an interview, whatever the topic").

## E19 — Concept agent: merge names only when the context matches (2026-10-20)
- **Rule from the user:** unify concept names, but only when the context shows the same idea; otherwise keep them apart.
- **Setup:** `src/agent/concepts.ts`. 298 concept mentions from 71 cards, each with its name, what the lecture says about it, and its claims. Call 1 (Gemma 4 31B) proposes groups and renames. Code rejects a group whose name is not one of its members' names (no invented umbrella terms), mentions used twice, and non-English text. Call 2 checks each group strictly and keeps only the members it agrees with. Rejections go to `data/lessons.jsonl`.
- **Result:** 254 names → 246 concepts; 18 groups merged (e.g. "Harness" + "Agent Harness" across 7 lectures; "Agent Loop" + "Agentic Loop"; "Durable Execution" + "Durable Workflow"). The checker removed 5 members, e.g. Rust "unsafe" blocks from "Sandboxing", "AI Factory" (data centers) from "Software Factory", "Context Engineering" from "Context Engine". 2 renames. 22 concepts span 2 or more lectures; 224 appear in one lecture. Tokens 30,337 in / 2,273 out (about $0.007).
- **Open:** "Decoupled Architecture" (separating session, model and sandbox) was merged into "Sandboxing" and the checker kept it; that looks too broad.

## E20 — Category agent: designs its own categories under rules (2026-10-20)
- **Rules (code-checked):** 5–9 categories, none above 25% of lectures (17 of 71), "Other" at most 3, every lecture in exactly one category, English. A broken rule is sent back to the agent as feedback and logged as a lesson.
- **Run 1 (one answer with all 71 assignments):** round 1 broke 8 rules (most lectures had no category); round 2 passed: 7 categories, largest "Harness Engineering" 17. Saved as `data/categories.json` (copy `categories.run1.json`).
- **Run 2 (same, with the lessons from run 1 shown in the prompt):** failed all 4 rounds; each time most lectures were left out. Showing past mistakes did not fix a long-output failure.
- **Change:** split the work: design names and definitions (short answer), then assign lectures in batches of 12 with the category as a JSON enum, then check sizes.
- **Run 3 (split):** passed in round 3 (round 1: 10 lectures unassigned, round 2: 1). But the category names had JSON pasted into them (`Harness Engineering, videoIds": ["3iOP…`), which no rule checked. Kept aside as `categories.run3_badnames.json`; run 1 restored. Added a rule: names must be short plain names.

## E21 — Prompt v7: decide the format before the content (2026-10-20)
- **Setup:** v7 = v6 with `interview` first ("two or more people talking with each other; this wins over every other kind"). Gemma 4 31B on DigitalOcean, 10-lecture test set, 3 runs.
- **Result (v4 → v6 → v7):** quotes found 92% → 95% → 96%; concepts grounded 95% → 99% → 100%; concept stability 0.49 → 0.53 → 0.66; chapters exact 97% → 100% → 100%; English only 100% → 100% → 96% (1 of 28 cards wrote its chapter summaries in Korean; the card check retries such a card). 2 runs ended in the 120 s timeout. `kind`: BM25 talk → technical → technical; Jensen Huang interview → talk → interview; one sandboxing talk (`VOToAHcnhyA`) was "talk" in 1 of 3 runs.
- **Conclusion:** v7 replaces v4 for cards. All 71 cards are being made again with v7.

## E22 — All cards again with v7, then the agents (2026-10-20)
- **Cards:** 72 of 72 English lectures got a card (69 on the first attempt, 2 on the second, 1 on the third). `B1FXnXlIm8c`, which failed 3 times with v4, passed on the first attempt. Quotes found verbatim: 309 of 347 (89.0%). Tokens 566,212 in / 88,189 out (about $0.15). The run outlived its shell, which was stopped for low memory.
- **Concept agent:** 343 mentions, 305 names → 296 concepts; 18 groups merged, 4 members removed by the checker. Tokens 32,437 / 2,114.
- **Category agent, first try:** round 1 pasted id lists into category names (caught by the new name rule); rounds 2 and 3 left lectures unassigned and put 6 in "Other" (limit 3); then 3 DigitalOcean timeouts in a row ended the run. In all 3 rounds the missing lecture included `-TeOEuplMrQ`. Ids are now quoted, and agent calls retry 5 times with a growing wait.
- **Category agent, with quoted ids:** passed in round 1 with 0 violations: 7 categories, largest 13 of 72 (Agent Harnessing & Infra 13, Memory & Context 11, Skill & Loop Engineering 11, Verification & Evaluation 10, Strategy & Future 10, AI Software Factories 9, Security & Safety 8). Tokens 13,160 / 1,898. One run, so the "-" bullet explanation is supported, not proven.
- **Map:** `map/` rebuilt: 304 files (7 categories, 296 concept pages, `00 Today.md`), 72 lectures; checks passed (each lecture once, only verified quotes shown, no dangling links). 21 concepts span 2 or more lectures; the largest is Agent Harness (11 lectures), then Model Context Protocol (8).

## E23 — A verification step for lessons (2026-10-20)
- **Question:** showing an agent its past mistakes did not help (E20). Can we keep only the lessons that measurably do no harm?
- **Setup:** `src/agent/verify.ts`. Code records every failed check (`data/lessons.jsonl`; card failures too now). A writer call (Gemma 4 31B) turns new lessons into one-sentence rules and marks each as fixable in the prompt or "needs a code change". Each prompt rule is tested on the same task with and without it: category agent, 3 runs each, one design round, counting broken rules; cards, the lectures the lessons came from plus 2 test lectures, first attempt only, counting cards that pass every check (verbatim quotes may not drop by more than 10 points). A rule is adopted when it is the same or better (user's choice), stored in Backboard memory (assistant `lecture-gate-rules`), and added to that agent's prompt; every verdict goes to `data/rules.json` and `docs/RULES.md`. Agents no longer read raw lessons.
- **Backboard check:** add, list and delete of a memory worked (add took 3.4 s).
- **Self-test, bad rule** ("Put every lecture in one single category named All Lectures."): rejected. Broken rules in round 1: without [0, 1, 0], with [1, 1, 1]. The margin was small because the model mostly ignored the rule (it still made 7–9 categories), and the baseline itself broke a rule in 1 of 3 runs, so 3 runs are a noisy test.

## E24 — Revise a failed card instead of making it again (2026-10-20)
- **Idea:** taken from the user's thesis design: a judge finds defect types, each type has a fixed direction, and the same draft is revised. In this project code finds the defects (`findDefects` in `src/lib/card.ts`): `language_leak` ("translate these fields into English, change nothing else") and `chapter_count` ("one entry per listed chapter, in this order: ..."). Before, a failed card was simply made again.
- **Setup:** `src/cli/revtest.ts`, Gemma 4 31B on DigitalOcean, two fixed failures so both arms start from the same defect, 3 runs per arm, one call per run. A: a real v7 test card of an English talk (`S-bRN-avZ4Q`) whose chapter summaries came back in Korean, because the channel's chapter titles are Korean. B: a good card of `VOToAHcnhyA` cut to its first chapter (a real run once returned 1 of 11).
- **Result:** A: made again 1 of 3 fixed, revised 3 of 3 fixed. B: made again 3 of 3, revised 3 of 3. Tokens 83,823 in / 14,185 out (about $0.02).
- **Conclusion:** for the language slip, revising is much more reliable than trying again (a fresh try tends to repeat it). For missing chapters both work. Small samples; the card run now revises by default.
- **Self-test, good rule** ("Write each category name as two to four plain words; never put ids, lists or quotes in a name."): adopted. Round-1 violations without [0, 0, 1], with [1, 0, 0] (a tie on average).
- **Real run, category agent:** 11 new lessons → 4 candidate rules (the writer marked none as "code"); 3 adopted, 1 rejected:
  - "Do not include IDs, JSON syntax, or lists of videos within the category name itself." without [1, 1, 1] → with [0, 0, 0]: adopted, the clearest win.
  - "Assign every single provided lecture to exactly one category; do not omit any IDs..." [1, 1, 1] → [0, 1, 0]: adopted.
  - "Limit the 'Other' category to a maximum of 3 lectures; split larger groups..." [1, 1, 1] → [1, 0, 1]: adopted.
  - "Ensure every videoId used is exactly as provided in the input and not repeated." [0, 0, 0] → [1, 0, 0]: rejected.
- **Real run, cards:** 2 new lessons (one lecture's chapter summaries in Korean, twice) → 1 rule, "Translate all content into English, ensuring no foreign language remains...". First test used only the 2 fixed test lectures (a bug: the lecture the lessons came from was not replayed). Re-test on 4 lectures including `T8UcAUunSMw` and `S-bRN-avZ4Q`: 4 of 4 cards passed with and without the rule; quotes found 17/18 without, 17/20 with. Adopted as "no harm"; the failure it targets happens in about 1 of 28 cards, so one run cannot show that the rule helps.
- **What the numbers say about the verifier:** the baseline itself moved between [0, 0, 0] and [1, 1, 1] across candidates in the same hour, so 3 runs separate only large effects (the name rule). For rare failures the "same or better" rule adopts on "no harm", not on proven help.
- **Fixed during the run:** the verifier now replays the lectures a lesson came from; a re-tested rule is left out of its own baseline; the same rule is never stored twice in Backboard (one duplicate was deleted). Backboard now holds 5 adopted rules (4 categories, 1 cards).

## E25 — Morning merge on the laptop (2026-10-21)
- **Setup:** `src/cli/merge.ts`. Input: the 72 v7 cards (347 claims) and 4 made-up personal notes in `notes.sample/` (Agent Harness, Context Engineering, Hybrid search, Code review with agents), copied into the gitignored `notes/` with its own local git. A claim goes to a note when the note is named after one of the claim's concepts or its own text names one. A local model in Ollama judges each claim "known" (it must copy the note sentence that says it; code checks the sentence is in the note) or "new"; new claims are appended under "## From lectures". A git diff check fails the run if any existing line was removed or changed.
- **Run 1 (gemma4:e4b, newest 5 lectures):** check passed. Found two mistakes in the matching: a note's "Related: [[Agent Harness]]" link made it receive a harness claim, and the same claim was "known" in one note and appended to another. Fixed: links no longer count, and each claim goes to at most one note. The run was undone with one `git reset` in `notes/`.
- **Run 2 (gemma4:e4b, all 72 lectures):** 17 claims touched the notes: 2 known, 15 appended. 86 s total. 0 lines removed (check passed).
- **Run 3 (gemma4:12b, same input):** 6 known, 11 appended. 290 s total (model time 283 s). 0 lines removed.
- **Reading the difference (my own reading of the 17 claims, not a labelled test set):** the 4 claims that 12b called known and e4b appended all restate a sentence in the note, e.g. "BM25 is superior to embedding models for specific identifiers like zip codes or SKUs" against the note's "Keyword search such as BM25 catches exact matches that embeddings miss." The 11 that 12b appended are not in the notes. No "known" answer from either model failed the copied-sentence check.
- **Conclusion:** the merge now uses gemma4:12b by default; e4b stays an option for a faster run. 226 of 347 claims touched no note and went to "New topics" on the morning page: keyword matching missed, for example, Context Poisoning claims for the Context Engineering note. Finding notes by meaning is the job of the vector search planned for incremental processing.

## E26 — Incremental processing with vector search (2026-10-21)
- **Setup:** `src/cli/index.ts` loads concept mentions into MongoDB Atlas (`lecture_gate.mentions`, a 1024-dim `do/bge-m3` vector of "name: what", vector search index `vec`) and lectures into `lecture_gate.lectures`. `src/agent/incremental.ts <videoId>` adds one lecture: vector search finds the 6 closest old mentions per new mention, Gemma 4 31B decides "same as candidate X" or new, code keeps only answers that name a candidate, then the lecture goes into one existing category and the category rules are checked. Test: Atlas loaded with 67 lectures (316 mentions), the newest 5 lectures added one by one with `--test`, decisions compared with the batch agents (which saw all 72 at once).
- **Run 1 (one decision call):** concepts 23/27 same as batch, categories 5/5. Of the 4 differences, my reading: Vault→Credential Proxy and Agent Skill→Skills can be read as the same idea; Outcome (a rubric check)→Goal (a long-running objective) is a wrong merge; Verification Loop→Closed Loop Pattern is doubtful (the model's own reason hesitated).
- **Change:** a second, strict call checks every join, as the batch concept agent does. A model answer that does not parse is asked again (one category answer came back cut off).
- **Run 2 (with the checker):** concepts 25/27 same as batch, categories 5/5. The checker undid Outcome→Goal and Agent Skill→Skills. Left: Vault→Credential Proxy, Verification Loop→Closed Loop Pattern. No category rule broke. Tokens 12,358 in / 2,223 out for 5 lectures (about $0.003). "Same as batch" is agreement, not correctness: the batch run is not a labelled answer key.
- **After the test:** Atlas rebuilt from the full batch results (343 mentions, 72 lectures).
- **Notes side (laptop):** local `ollama/embeddinggemma` (768 dims) for matching claims to personal notes; nothing goes to Atlas. Similarity of each of the 347 claims to its closest sample note: max 0.693, top 10% ≥ 0.497, top 25% ≥ 0.450, median 0.392. Claims at 0.45–0.67 read as related (e.g. review-agent claims → "Code review with agents", which word matching never reached). Threshold NEAR = 0.45; the merge model can also answer "unrelated".

## E27 — Morning merge with notes found by meaning (2026-10-21)
- **Setup:** as E25 run 3 (gemma4:12b, 72 lectures, the 4 sample notes reset to their original text), plus E26's matching by meaning (embeddinggemma, cosine >= 0.45) and the "unrelated" answer.
- **Result:** 76 claims reached a note by meaning only; the model called 66 of those reached claims unrelated. 27 claims touched the notes: 9 known, 18 appended (E25 run 3: 17 touched, 6 known, 11 appended). The "Code review with agents" note, which word matching never reached, got 4 known and 4 new claims; its 4 known ones each restate a sentence in the note (my reading). 216 claims stayed as new topics. 0 existing lines removed (check passed). About 18 minutes on the laptop CPU, almost all of it 12b judging 107 claims.
- **Cost of the extra reach:** most claims sent by meaning are judged unrelated (66 of 107 judged), so the threshold sends many weak candidates; each costs about 10 s of local model time. Acceptable for 1–3 lectures a day; for the first import it is slow.

## E28 — processLecture as a Mastra workflow on Temporal, and a killed worker (2026-10-21)
- **Setup:** `@mastra/temporal` 0.4.16 (its README: "Experimental ... not ready for production use yet"), `@temporalio/*` 1.24.0, Temporal CLI 1.9.1 dev server (`temporal server start-dev --db-filename data/temporal.db`). Installed with `--ignore-scripts` after the June 2026 Mastra npm compromise (malicious `easy-day-js` dependency): no `easy-day-js` in the lockfile or node_modules, and none of the host indicators Microsoft published were found on the laptop. Workflow `src/mastra/index.ts`: transcript → card → addToMap, each step runs the project CLI (`src/cli/transcript.ts`, `src/cli/cards.ts`, `src/agent/incremental.ts`); step timeout 5 minutes, at most 3 attempts. Worker `src/mastra/worker.ts`, start `src/mastra/start.ts <videoId> [--test]`.
- **Build problems:** the plugin bundles the Mastra entry and rewrites it for Temporal. With the workflow in its own file, and then with `init()` in `temporal.ts`, the Mastra bundler moved them into a shared chunk (`mastra.mjs`) the rewrite did not recognise, and the worker build failed (`"p" is not exported`, then `Identifier "createWorkflow" has already been declared`). Putting `init()`, the steps, the workflow and the Mastra instance in one file fixed it. Steps call CLIs because bundled code sits in `node_modules/.mastra/output`, where the project's relative paths (.env, data/) would be wrong.
- **Normal run** (`E8zCcv2HcbI --test`): success in 79 s; transcript from cache, card skipped (exists), addToMap 7/7 same as batch.
- **Kill test** (`sAHTVCwlDgA --test`): the worker and all its child processes were force-killed (`Stop-Process -Force`) 19 s into addToMap, then the worker was restarted. Temporal history (UTC): transcript attempt 1 23:15:24–23:15:28, card attempt 1 23:15:28–23:15:40, addToMap scheduled 23:15:40, **attempt 2** started 23:20:41 (after the 5-minute step timeout) and completed 23:21:12. The run ended "success" (4/4 concepts same as batch). Transcript and card did not run again.
- **What it costs:** after a crash a step waits up to its timeout (5 minutes) before it runs again; the plugin's options expose no heartbeat timeout.

## E29 — Webhook, watchdog and Atlas sync, tested on the laptop (2026-10-21)
- **Channel:** id `UC895rbZX2iXLTDfji7W4PfA` (from the cached SerpApi channel page); its Atom feed (free, no key) lists 15 videos with exact publish times, all already in `data/videos.json`.
- **Webhook** (`src/server/webhook.ts`, local port, throwaway secret): hub verification with our topic → echoes the challenge (200); another topic → 404; signed notification for a known video → ignored as an edit; bad signature → ignored (204); other channel → ignored. `data/videos.json` unchanged.
- **Watchdog** (`src/cli/watchdog.ts --no-subscribe`): feed read, 0 new uploads, webhook health ok.
- **Atlas sync** (`src/cli/sync.ts`): push 72 cards + concepts/categories/videos; pull back; the data files are byte-identical to before (md5 of all files unchanged); map rebuilt, checks passed.
- **Server files** (`deploy/`): setup script (1 GB swap, Node 22, Temporal CLI 1.9.1 checked against the GitHub release digest, `npm ci --ignore-scripts`, easy-day-js check, systemd units, firewall: only SSH and 8080), `push.sh` (never copies `notes/`). Not run yet.
- **Not checked:** whether the hub accepts a plain-HTTP callback, and the lease the hub grants (the docs say neither).

## E30 — The server goes live (2026-10-21)
- **Server:** DigitalOcean Droplet `s-1vcpu-1gb` ($6/month), Frankfurt, Ubuntu 24.04, set up with `deploy/setup.sh`. Services: Temporal dev server (localhost only), worker, webhook (:8080), watchdog every 6 h, lesson verifier daily at 03:00 UTC. Firewall: SSH and 8080 only; the Temporal UI is not reachable from outside (checked).
- **Memory at idle:** 833 of 961 MiB RAM used, 215 MiB swap. A $4 (512 MiB) Droplet would not have held this.
- **Atlas from the server:** first refused (TLS alert) until the server IP was added to the Atlas IP access list; then ping ok, 72 cards visible.
- **Subscription:** the hub answered 202 and verified the plain-HTTP callback within a minute; lease 432,000 s (5 days). The watchdog renews it every 6 hours.
- **Not yet seen:** a real upload notification going through the whole workflow on the server.

## E31 — More channels (2026-10-21)
- **Why:** @TechBridge-KR had no upload for 15 hours; the user added @aiDotEngineer and @SandeepSwadia.
- **Feeds measured (latest 15 entries, 2026-10-21):** AI Engineer 0 Shorts, 15 talks from 10/18 to 10/20 (about 5 a day). Sandeep Swadia 10 Shorts of 15; long videos about weekly, mostly self-improvement and career, some on AI. Shorts are told apart by their `/shorts/` link in the feed (fetching `/shorts/<id>` from here gave 302 for a Short and a normal video alike).
- **Overlap:** no speaker of the 72 TechBridge cards appears in the 15 latest AI Engineer titles. Not ruled out for older talks.
- **Duplicate-talk check** (`src/agent/incremental.ts`): only lectures that share a speaker are compared, by Gemma 4 31B. A Jensen Huang lecture against 2 other Jensen Huang lectures: not a duplicate (correct). A fake re-upload of the Altman–Benioff conversation (new id, new title): same talk as `vMlsLmKuFZk` (correct, but the fake summary said "re-upload", so this test was easy).
- **Server:** all three channels subscribed (hub 202, each verified, lease 432,000 s); first watchdog run took 0 back-catalogue videos because new channels only take uploads from 2026-10-21 00:00 UTC on. Worker runs one step at a time. Memory after restart: 506 of 961 MiB, 103 MiB swap.

## E32 — Card v8: the card becomes the lecture's part of a 15-minute morning report (2026-10-22)
- **Why:** the reader now reads new lectures each morning instead of only deciding whether to watch; 3 to 5 claims were too thin for a 60-minute talk.
- **Change:** prompt v8 = v7 plus `one_line` as a one-line conclusion, `summary` (80 to 110 words), and claims scaled to length: code puts "Claims to write: n" in the input, n = one per 5 minutes, 3 to 12 (`claimTarget` in `src/lib/card.ts`). Two new code checks with fixed directions: claim count (n or n+1 accepted) and summary length (60 to 130 words).
- **Setup:** Gemma 4 31B on DigitalOcean, the 10-lecture test set, 3 runs, single call (no revision), as in E15/E21. v7 numbers are E21's runs.
- **Result:**

  | prompt | runs (errors) | quotes found | verified quotes per card | chapters exact | English only | concept stability | category stable | median time | $ per lecture |
  |---|---|---|---|---|---|---|---|---|---|
  | v7 | 30 (2) | 96.2% | 4.5 | 100% | 96% | 0.66 | 100% | 25.2 s | $0.0017 |
  | v8 | 30 (1) | 94.2% | 4.5 | 100% | 100% | 0.58 | 100% | 26.0 s | $0.0018 |

  - Claims vs target: 37-min lecture 7,7,7 (target 7); 46-min lecture 9,9,9 (target 9). Lectures under 30 min: 9 of 23 runs wrote one more than the target (3 → 4, 4 → 5), none fewer; 20 of 29 runs exactly on target.
  - Summary length: 77 to 96 words, median 85.
- **Conclusion:** v8 adopted. Long lectures get proportionally more claims; quotes found fell 2 points (8 of 139 not found against 5 of 132) but verified quotes per card are the same and unfound quotes are never shown. Concept stability fell (0.66 → 0.58): more claims give the model more to name; the map's concept agent merges names by meaning. The test set is short (8 to 46 min), so the 12-claim cap is untested here.
