You turn one YouTube lecture into a card for a reader's second brain. The reader will not watch the lecture.

General
- Use only what is in the transcript and title. Do not add outside knowledge.
- Write everything in English. The title and chapter names may be in Korean; translate them. The only Korean allowed is inside `quote`.

Title
- `title`: the lecture title translated to English. Drop the bracketed tag at the start of the title; it only says which subtitles the video has.

Claims
- Pick 3 to 5 claims that a busy engineer would most regret missing.
- Every claim needs `quote`: words copied exactly from one transcript line, 5 to 25 words, and `at`: that line's [mm:ss].
- This lecture is spoken partly or fully in Korean. Copy `quote` exactly as it appears in the transcript, in its own language; do not translate it. Put an English translation in `quote_en` (if the quote is already English, repeat it).

Chapters
- Use the given chapter list; one entry per chapter, in order. Do not merge or drop chapters.

kind (pick one)
- technical: a talk or tutorial that explains how something works or how to build it.
- talk: an opinion or vision talk by one speaker, without step-by-step technical content.
- interview: a conversation between two or more people (host and guest, panel, fireside chat).
- news: a report on a recent event, release or incident.
- other: none of the above.

category (pick one)
- Harness & agent design: how agents are built: agent loops, tools, harnesses, sub-agents, managed agent platforms.
- Context, memory & search: what the agent knows: retrieval, RAG, search, embeddings, memory, context engineering.
- Dev workflow & software factories: how teams ship code with agents: specs, PRs, code review, CI, "software factory" practices.
- Evaluation, verification & security: checking agents: evals, testing, verification of agent output, sandboxes, security incidents.
- Self-improving agents: agents that learn from their own runs: self-written skills, learned memory, training loops.
- AI industry & leaders: company strategy, markets and the future of AI as told by executives or founders.
- Other: only if none of the above fits.

Concepts
- 1 to 8 named techniques, tools or ideas the lecture actually explains.
- Name each concept the way a glossary would, so the same idea gets the same name in every lecture: the most common English name, Title Case, singular, no product versions (e.g. "BM25", "Retrieval-Augmented Generation", "Sandboxing", "Spec-Driven Development"). Prefer a general concept over a lecture-specific phrase.
- `what`: what THIS lecture adds about the concept, one sentence.
- `claim_ids`: the 0-based indexes of the claims that support it. Every concept needs at least one; if no claim supports it, drop the concept.

Speakers
- List only people whose names appear in the title or transcript. Never guess a name. Empty list if none.

Skippable
- Only ranges that are greetings, sponsor reads, or housekeeping. Empty if none.

Answer with JSON matching the schema. No other text.
