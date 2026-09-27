# Architecture

One Cloudflare Worker (`fdf-ranking-board`) and one HTML page. There is no build step and no dependency.

## Live mode (`wrangler.live.toml`)

```
browser ──30 s──▶ /data.json ──edge cache 45 s──▶ scrape() ──▶ LiveFPV HTML
        ──tap──▶ /laps.json?race=<id> ──edge cache 5 min──▶ one heat page
cron (every minute) ──▶ scrape() ──▶ KV: final heat results
```

| Route | Source |
|---|---|
| `GET /` | `src/page.html`, imported as a string |
| `GET /data.json` | `getData()` → `scrape()`. Cached `CACHE_TTL` s (45). A second copy is kept for a day and served (`x-board-cache: STALE`) if LiveFPV errors |
| `GET /laps.json?race=<id>` | `getLaps()` → `parseRace()` on one `view_race_result` page, laps cleaned by the minimum lap rule |
| `scheduled` | Runs `scrape()` so final heats are saved even when nobody has the board open |

`scrape()` does, in order:

1. Fetch `/results/`, read the event name and every round ranking link
2. Fetch each round ranking (`parseRound`) → rows per class
3. `fixShortLaps`: for rows whose fastest lap is under `MIN_LAP`, fetch that heat and recompute the row
4. `scrapeMains`: heat sheet + main races + semifinal snapshot + KV finals

Subrequests per scrape are about 1 + rounds + short-lap heats + main races (about 20 at Round 6), under the 50 limit of the free plan. Per-heat laps are fetched lazily by the page for the same reason.

### Configuration (`[vars]`)

| Var | Default | Meaning |
|---|---|---|
| `LIVEFPV_BASE` | `https://fdf2784.livefpv.com` | Track's LiveFPV site. The scraper reads whatever event its results page currently shows |
| `CACHE_TTL` | `45` | Seconds a scrape is reused |
| `MIN_LAP` | `12` | Seconds. A gate crossing sooner than this after the last accepted one is ignored |

KV binding `FINALS` stores final heats under `finals:<LIVEFPV_BASE>:<event>`.

## Minimum lap rule

A lap shorter than `MIN_LAP` is a false detection (the pilot passed the gate once, the timer saw it twice). The crossing is ignored, so its time is added to the next lap; a short final lap is dropped and subtracted from the total. This is the same thing a timing system's "minimum lap time" setting does. LiveFPV's own values (Laps/Time, Top 3, fastest) include the false lap, so those rows are recomputed from the raw laps (`cleanLaps`, `recomputeRow`).

Only rows whose LiveFPV fastest lap is under the minimum can contain a false lap, which is how `fixShortLaps` avoids fetching every heat.

## Data (`data.json`)

```jsonc
{
  "event": "FDFCUP2026ROUND6",
  "source": "https://fdf2784.livefpv.com/results/",
  "rounds": [{ "id", "label", "url", "kind": "practice|qualifier|other", "n",
               "classes": { "Pro Class Racing": [ROW, ...] } }],
  "mains":  [{ "name": "A", "heats": [{ "name": "A1" | "A Final 2", "main", "n", "final",
               "klass", "status", "pilots": [...], "raceId", "url", "rows": [ROW, ...] }] }],
  "minLap": 12,
  "fetchedAt": "ISO time",
  "final": true              // archive only
}
// ROW: { driver, pos, lapsTime: "3/1:28.942", top3, top2, fastest, avg, raceId, heat }
```

Times stay as LiveFPV formats them (`m:ss.sss` or `ss.sss`); the page parses them. `raceId` is `null` when the heat's race page no longer shows that result (see [livefpv.md](livefpv.md)); the page then shows the result without laps.

## The page (`src/page.html`)

Plain HTML, CSS and one script. All ranking happens in the browser from `data.json`:

- **総合 / Practice / Qualifier** — for each pilot, the best value across the selected rounds under the chosen metric (not a sum). `#n` is the position within that round
- **Main** — per main: the final first, ranked by points; then each semifinal heat ranked by Laps/Time, top `ADVANCE` (2) marked 決勝へ
- **Final points** — `POINTS = [5, 3, 2, 1]` by finishing position; a pilot who didn't complete the race distance scores 0. Ties: more wins, then best Laps/Time (this tiebreak was chosen for the board, not taken from an official rule)
- Cells that changed since the last poll flash once; rank changes show ▲▼
- Rows open to show lap chips; Enter/Space works for keyboard users
- Below 560 px the layout compacts for phones

When `data.json` has `"final": true` the page stops polling, shows 確定 with the result time, and reads laps from `laps/<id>.json` instead of `/laps.json`.

## Archive mode (`wrangler.toml`)

Workers Static Assets serving `public/`. Each event is a folder:

```
public/2026/round6/index.html      copy of src/page.html
public/2026/round6/data.json       frozen data.json with "final": true
public/2026/round6/laps/<id>.json  one file per heat
public/_redirects                  / → /2026/round6/ (302)
```

`html_handling = "auto-trailing-slash"` turns `/2026/round6` into `/2026/round6/`, which the page's relative URLs need.
