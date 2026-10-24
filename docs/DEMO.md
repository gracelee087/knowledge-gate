# Live demo (2 minutes)

One URL in, one checked result out. All numbers below were measured on 2026-10-24 on this laptop.

## Before going on stage

- Open a terminal in the repo root. Font large.
- Optional: start the page in a second terminal, `npx tsx src/cli/web.ts`, and open http://127.0.0.1:4321 (it answered HTTP 200 on 2026-10-24).
- The transcripts of all samples below are already cached in `data/cache/`, so the talk runs spend **no** SerpApi search. The card itself is made live by the model `do/gemma-4-31B-it`, which needs the internet.

## Script

**0:00 – Lecture (main sample).** Say: "I paste one YouTube link."

```
npx tsx src/cli/demo.ts "https://www.youtube.com/watch?v=FHewiSeWJhQ"
```

The audience sees: the transcript line count ("from cache"), then after about 30 s the title, a one-line conclusion, and 3–5 claims. Each claim has its quote, a ✓ if the quote is found word for word in the transcript (✗ if not), the time, and a link that jumps to that second (`&t=…s`). Last lines: "Quotes found word for word: n/m" and the card time.

Say while it runs: "The model must quote the talk; code then checks every quote against the transcript. A ✗ is shown, not hidden."

**1:00 – Flight.** Say: "Same idea for a trip: one route, price plus the fuel surcharge table."

```
npx tsx src/cli/flights.ts
```

Then open `notes/Travel.md`. Results are cached per route and day, so on the same day it spends no search (an earlier all-cached run with three trips took 10.5 s). On another day it spends one search per trip.

**1:45 – Close** on the ✓/✗ line: "Nothing the tool says is trusted until the quote is found."

## Samples (pre-run 2026-10-24)

| Talk | URL | Card time | Wall time | Quotes ✓ |
|---|---|---|---|---|
| The Last Human Code Review — Itamar Friedman, Qodo (18 min) — **main** | https://www.youtube.com/watch?v=FHewiSeWJhQ | 25.1 s; rerun from cache 27.2 s | 38.2 s (first, incl. transcript fetch); 32.9 s (rerun) | 3/4 |
| The Era of Compound Engineering — Kieran Klaassen, Every/Cora (19 min) | https://www.youtube.com/watch?v=m8pBazNPvZE | 30.1 s | 43.2 s (incl. transcript fetch) | 2/4 |
| Why AI Agents Have Now Become Distributed Systems — Salman Munaf, TikTok (19 min) | https://youtu.be/XV6WcGliCGM | 154.0 s (first try timed out, second worked) | 167.0 s | 5/5 |

The ✗ quotes seen so far were quotes where the model joined parts with "..." or reworded them, so they are not word for word.

Flights (Google Flights through SerpApi, EUR, 1 adult, run 2026-10-24, copied from `notes/Travel.md`):

| Trip | Cheapest | Google's best | Google price level |
|---|---|---|---|
| FRA → ICN 2026-12-23 one way (main) | €698, MIAT OM 138 + OM 301 via UBN, 14h 30m | €763, Finnair AY 1412 + AY 41 via HEL, 16h 55m | typical (€345–700) |
| MUC → ICN 2026-12-23 one way | €769, Air France AF 1123 + AF 264 via CDG, 20h 10m | €790, Emirates EK 50 + EK 322 via DXB, 18h 25m | not given |

Fuel surcharge (ktravelacademy.com, November 2026 page, departing Korea, one way) for the Frankfurt row: Korean Air 370,100 KRW (+14.9%), Asiana 351,100 KRW (+16.6%). Munich is not listed on that page, so the MUC trip has no surcharge table.

## If something fails

- **Internet down or the model slow:** print the saved run instead (no network, about 6 s):
  `npx tsx src/cli/demo.ts FHewiSeWJhQ --saved` (also works for `m8pBazNPvZE`, `XV6WcGliCGM`).
- **Model call times out:** `makeCard` retries by itself (seen once: 154 s instead of about 30 s). If it takes over a minute, stop it and use `--saved`.
- **Flights offline:** `notes/Travel.md` already holds today's result; open it directly.
- **A brand-new URL from the audience:** it spends one SerpApi search for the transcript. Some videos have no transcript; then the tool prints the SerpApi message and stops (seen once with `H_zE_JwstWU`). Use a sample above instead.

The demo writes only `data/demo/<id>.json`; it never changes the map (`data/cards`) or the notes.
