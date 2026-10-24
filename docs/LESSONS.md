# Lessons

What failed, why, and what changed. Newest first.

## 2026-10-20 — Showing an agent its past mistakes did not stop them
- **What:** the category agent got its earlier violations in the prompt ("these lectures have no category", "a category is empty") and still failed 4 of 4 rounds the same way: most of 71 lectures left out (E20).
- **Why (from these runs, not proven):** the lessons named the symptom, not a way to avoid it, and the rule they repeated was already in the prompt. The cause was not a choice the model could make differently: one long answer with 71 assignments, and ids starting with "-" read as list bullets. What fixed it was structure and code (assign in batches of 12, quote the ids). By contrast, a prompt rule did fix a judgement error: "two or more people talking is an interview" (v7, E21).
- **Change:** lessons now go through a verification step before an agent sees them: a rule is kept only if runs with it are at least as good as runs without it. A failure that rules do not fix is marked "needs a code change" for a person.
- **Who uses it:** the lesson verifier; the operator.

## 2026-10-20 — Cloud requests that hang for 5 minutes
- **What:** while making all cards, one request to Gemma 4 31B on DigitalOcean got no reply and ended with `fetch failed` only after about 5 minutes; a later one had no reply after more than 3 minutes when the run was stopped. A normal card takes 15–35 s.
- **Change:** DigitalOcean calls now give up after 120 s, so the retry starts sooner.
- **Also found:** stopping the background shell did not stop the Node process under it; an old run kept writing files. Leftover processes are now checked and stopped by hand before a restart.
- **Who uses it:** the cloud model adapter (code); the operator.

## 2026-10-20 — Small models left Korean chapter titles in English cards
- **What:** Gemma 4 E2B and E4B (prompt v3, BM25 lecture) copied the channel's Korean chapter titles instead of translating them. The readers of the map read English.
- **Why:** the instruction "translate them" was only in the prompt; nothing checked it.
- **Change:** `nonEnglish()` flags any Hangul in a card; such a card counts as failed. Prompt v4 adds an English `title` and says "No Korean characters anywhere".
- **Who uses it:** the card checks (code); the lecture workflow will retry, then move to a bigger model, when a card fails.

## 2026-10-20 — Streaming was not enough for bigger local models
- **What:** after the streaming fix, Gemma 4 E2B, E4B and Gemma 3 4B finished on the BM25 lecture, but Gemma 4 12B and Qwen3 8B still ended with `fetch failed`.
- **Why:** the Ollama log shows the request ending at 5 min 7 s while the model was still reading the prompt (4,096 of ~5,200 tokens). Ollama sends no bytes until reading is done, so fetch's 5-minute header timeout still fired.
- **Change:** the Ollama adapter uses `node:http`, which has no header timeout.
- **Who uses it:** the local model adapter (code).

## 2026-10-20 — Local models failed with "fetch failed"
- **What:** 9 of 10 local runs (Gemma 4 E4B/12B, Gemma 3 4B, Qwen3 8B on two lectures) ended with `fetch failed`. Only Gemma 4 E2B on the shorter lecture finished (174 s).
- **Why:** the Ollama call waited for the whole reply before sending any bytes. On a CPU a long lecture takes more than 5 minutes, and Node's fetch stops waiting for response headers after 5 minutes.
- **Change:** the Ollama adapter now streams the reply and reads the token counts from the last chunk.
- **Who uses it:** the local model adapter (code).

## 2026-10-20 — Card got the category and kind wrong
- **What:** on the BM25 lecture (yNPS1Z64wQM), Gemma 4 31B with prompt v2 set `kind: news` and `category: Other`, and left every concept's `claim_ids` empty. Quotes were 5/5 correct.
- **Why (guess, then tested):** the prompt lists category names but never says what each one covers, and nothing forces `claim_ids` to be filled.
- **Change:** prompt v3 describes each category and kind, asks for glossary-style concept names, and the schema requires at least one `claim_id`. On the 10-lecture test set, 3 runs (E12): category Other 88% → 0%, concepts linked 0% → 100%, quotes 88% → 90%. v3 replaces v2.
- **Who uses it:** the summarizer prompt.

## 2026-10-20 — Quote check rejected real quotes
- **What:** 2 of 4 quotes from Gemma 4 31B on the BM25 lecture (yNPS1Z64wQM) failed the verbatim check.
- **Why:** the quotes were real; the model dropped speech fillers ("uh") the auto-captions contain.
- **Change:** the checker now ignores "uh"/"um" on both sides. Re-check: 4/4 found.
- **Who uses it:** the quote checker (code).

## 2026-10-20 — Gemma on the Gemini API returns its thinking
- **What:** a reply to "Reply with exactly: ok" came back with a plan paragraph before "ok".
- **Why:** Gemma 4 on the Gemini API returns thought parts alongside the answer.
- **Change:** `geminiChat` keeps only parts without `thought`.
- **Who uses it:** the Gemini model adapter (code).

## 2026-10-20 — YouTube blocks direct transcript fetches
- **What:** yt-dlp subtitle download got HTTP 429 at home; a DigitalOcean server got "Sign in to confirm you are not a bot".
- **Change:** transcripts come from SerpApi; yt-dlp/Whisper stay as fallbacks on the home connection.
- **Who uses it:** the fallback order (Temporal activities).
