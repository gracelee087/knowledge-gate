# Known issues and improvements

Every failure and weak spot found so far, with its status. Evidence is in `EXPERIMENTS.md` (E-numbers) and `LESSONS.md`.
Status: **open** (not solved), **fixed** (a change was made and measured), **accepted** (known and left as is, with the reason).

## Cards

| # | Issue | Evidence | Status |
|---|---|---|---|
| 1 | `B1FXnXlIm8c` kept Korean chapter titles in all 3 attempts; no card. | E16, E22 | fixed: passed on the first attempt with prompt v7 (it was not retried on its own) |
| 2 | Lectures narrated in Korean by the channel (5 of 77) cannot meet the English-only rule with verbatim quotes. | E17 | accepted: left out of this map; prompt v5 (Korean quote + English translation) worked on 4 of 4 but is unused |
| 3 | `kind` was "talk" for technical talks such as the BM25 lecture. | E15, E18, E21 | fixed in prompt v7: BM25 is technical and the Jensen Huang interview is an interview again (v6 had broken that) |
| 4 | Concept names copied from the prompt's examples: "Retrieval-Augmented Generation" on the BM25 lecture, which never says it. | E18 | fixed in v6: names must be terms the speaker uses; grounded names 95% → 99% on the test set |
| 5 | A card stopped early: 1 of 11 chapters, half the usual output (`VOToAHcnhyA`, test run). | E15 | fixed: a card with fewer chapters than the channel lists fails and is retried |
| 6 | 12% of quotes are not found word for word (304 of 342 found). | E16, E17 | open: the misses have not been examined yet |
| 7 | Quotes keep auto-caption errors ("a hardness" for "a harness"). | map | accepted: quotes must match the transcript; the page shows the time link to check |
| 8 | Speaker names come from auto-captions and can be misspelled ("Mark Venioff"). | E13 | open |
| 9 | Dates are approximate: YouTube lists only "N weeks ago". | map | accepted: shown with "~" |
| 10 | Concept lists change between runs of the same lecture (stability about 0.5). | E9, E12, E15 | open: the concept agent merges names after the fact |

## Concepts and categories (agents)

| # | Issue | Evidence | Status |
|---|---|---|---|
| 11 | 254 concept names; most appear in one lecture only. The concept agent merged 18 groups (254 → 246) and its checker removed 5 wrong members. | E19 | open: 224 concepts still have one lecture; this may be real variety |
| 12 | Questionable merge: "Decoupled Architecture" (separating session, model and sandbox) was put under "Sandboxing". | E19 | open |
| 13 | Card categories were skewed: 35 of 74 cards in "Harness & agent design". | E16 | fixed: the category agent designs its own categories under size rules (largest 13 of 72 on v7 cards) |
| 14 | Asked for 71 assignments in one answer, the category agent dropped most lectures; showing it its past mistakes did not help (4 of 4 rounds failed). | E20 | fixed: design and assignment split into small steps (batches of 12, category as a JSON enum) |
| 15 | Lessons are recorded by code and shown to the agent on its next run, but nothing yet checks that a lesson improves results before it is kept. | E20 | open: needs replay on past failures plus the test set |

## Running it

| # | Issue | Evidence | Status |
|---|---|---|---|
| 16 | DigitalOcean requests sometimes hang with no reply. | LESSONS | fixed: 120 s timeout, then retry (3 of 30 test runs hit it in E18) |
| 17 | Stopping a background shell left the Node process running and writing files. | LESSONS | accepted: check and stop leftover processes before a restart |
| 18 | Free Gemini API: mostly 429/500/503 under load. | E9 | accepted: last fallback only |
| 19 | Gemma 3 4B invents quotes (1 of 7 found). | E13 | fixed: dropped from the model list |
| 20 | A laptop CPU needs 4–34 minutes per card. | E13 | accepted: local models are the fallback for cards; their main job is the shorter morning merge |
| 21 | A just-uploaded video had no transcript 2 hours later. | E5 | open: the watchdog must retry later |
| 22 | The report labelled every prompt version "v0" and priced rows at $0. | — | fixed |
| 23 | The category agent crashed on a DigitalOcean timeout: the agents had no retry (the card script did). | E20 | fixed: agents call `chatRetry` (5 tries, waiting 10 s, 20 s, ...); trials still call `chat` so their error counts stay honest |
| 24 | Category names came back with JSON pasted into them and passed every rule. | E20 | fixed: names must be short plain names |
| 25 | Prompt v7 wrote one card's chapter summaries in Korean (1 of 28 test cards); a fresh retry often repeats it. | E21, E24 | fixed: a failed card is revised with the defect and a fixed direction (3 of 3 fixed vs 1 of 3 when made again) |
| 26 | The category agent kept leaving out `-TeOEuplMrQ` (3 rounds in a row). Ids that start with "-" look like list bullets at the start of a line. | E22 | fixed: ids are written as `id="..."`; the next run passed in round 1 (one run) |
| 27 | The lesson verifier can show "no harm" but not "helps" for rare failures (about 1 in 28 cards): one replay rarely reproduces them. | E23 | open: replay more runs on the failing lecture, or test prompt rules on saved failing outputs |
| 28 | Baseline runs of the category agent vary from 0 to 1 broken rule per round across the same hour; 3 runs per arm detect only large effects. | E23 | open |
| 29 | Two adopted category rules say nearly the same thing (no ids in category names). | E23 | open: the writer sees current rules but still wrote a near-duplicate; exact duplicates are now blocked |
| 30 | The first card verification did not replay the lecture the lesson came from. | E23 | fixed |

## Morning merge

| # | Issue | Where | Status |
|---|---|---|---|
| 31 | `fs.cpSync` crashed Node with no message (exit 0xC0000409) when copying into `notes/` under this Windows path. | E25 | fixed: plain read/write copy loop |
| 32 | A [[link]] in a note's "Related" line made the note receive claims about the linked topic. | E25 | fixed: only the note title and its own text count |
| 33 | The same claim was judged "known" for one note and appended to another. | E25 | fixed: each claim goes to at most one note |
| 34 | gemma4:e4b appended 4 of 17 claims that the note already said (12b: 0 of those 4). | E25 | fixed: 12b is the default for the merge |
| 35 | Matching notes by words misses related notes (Context Poisoning vs a Context Engineering note); 226 of 347 claims touched no note. | E25, E26 | fixed: then by meaning with local embeddinggemma (cosine >= 0.45), and the model may answer "unrelated" |
| 36 | The first import puts 226 claims on one morning page (244 lines). | E25 | accepted: a daily run brings 1–3 lectures |

## Incremental processing

| # | Issue | Where | Status |
|---|---|---|---|
| 37 | With one decision call, incremental processing joined "Outcome" (a rubric check) to "Goal" (a long-running objective). | E26 | fixed: a strict checker call, as in the batch agent |
| 38 | A category answer came back cut off and did not parse; the run crashed. | E26 | fixed: unparsable answers are asked again (3 tries) |
| 39 | Incremental and batch disagree on 2 of 27 mentions (Vault→Credential Proxy, Verification Loop→Closed Loop Pattern); which is right is a judgement call. | E26 | open |
| 40 | The progress log printed "(new)" when a mention joined a concept of the same name (Sandbox→Sandbox). Display only. | E26 | fixed |
| 41 | The merge wrote the UTC date (2026-10-20) just after local midnight on 2026-10-21 (laptop time zone W. Europe, UTC+2). | E27 | fixed: local date |
| 42 | Of 107 claims sent to notes, 66 were judged unrelated: the 0.45 threshold sends many weak candidates (about 10 s of local model time each). | E27 | accepted for daily runs; raise the threshold if it gets slow |

## Workflow (Mastra + Temporal)

| # | Issue | Where | Status |
|---|---|---|---|
| 43 | The Temporal plugin's worker build failed when the workflow or `init()` was in a separate file (shared chunk not recognised). | E28 | fixed: one file `src/mastra/index.ts` |
| 44 | Bundled step code runs from `node_modules/.mastra/output`, so modules that find .env and data/ by relative path break there. | E28 | fixed: steps run the project CLIs from the project folder |
| 45 | After a crash a step waits up to its 5-minute timeout before it runs again (no heartbeat option in the plugin). | E28 | accepted |
| 46 | Mastra warns that without `storage` it keeps run data in memory; Temporal holds the durable state. | E28 | open: check if Mastra storage is needed once runs are started from the server |
| 47 | `@mastra/temporal` is marked experimental in its README. | E28 | accepted for the hackathon |
| 48 | `tsc` reports 3 type errors in `src/mastra/index.ts` (steps typed for the default engine vs the Temporal engine); the code follows the plugin's own example and runs. | E28 | accepted: changing the file risks the fragile worker build |
| 49 | A new upload from the feed has no video length until a card is made; the map's length column stays empty for it. | E29 | open |
| 50 | The first Droplet create in fra1 failed with "subnet status is not available" (404); the retry a minute later worked. | E30 | accepted |
| 51 | The server uses 833 of 961 MiB RAM plus 215 MiB swap at idle; a card step adds more. | E30 | open: watch during the first real run |
| 52 | `deploy/push.sh` copied the laptop .env over the server's, dropping the server-only WEBSUB_SECRET and CALLBACK_URL, and copied data/ over the server's newer data. | E30, E31 | fixed: push keeps those two lines and skips data/ unless --with-data |
| 53 | The first watchdog run would have started every video in the new channels' feeds (about 20) at once. | E31 | fixed: per-channel start time; worker runs one step at a time |
| 54 | Sandeep Swadia's long videos are mostly not about AI; they would add off-topic lectures to the map. | E31 | accepted: the user chose to take them all; the category agent redesigns if the rules break |
| 55 | The duplicate-talk check was only tested on an easy fake re-upload. | E31 | open |

