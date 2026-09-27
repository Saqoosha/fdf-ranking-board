# LiveFPV notes

LiveFPV has no public API, so the board reads its HTML. Everything here was observed on `fdf2784.livefpv.com` during FDFCUP 2026 Round 6.

## Pages the scraper reads

| Page | URL | Used for |
|---|---|---|
| Results | `/results/` | Event name (`<title>`), round ranking links, heat sheet links, the race list grouped by round heading with completion times |
| Round ranking | `/results/?p=view_round_ranking&id=<round>` | One tab per class, a row per pilot with Laps/Time, Top 2/3 consecutive, fastest, average and a link to that pilot's heat |
| Heat page | `/results/?p=view_race_result&id=<race>` | `class_header` (e.g. `Pro Class Racing A1-Main`), `Length: 3 Laps`, the result table, and laps |
| Heat sheet | `/results/?p=view_heat_sheet&id=<sheet>` | The Main Events sheet: heats, their pilots and status before they race |

Laps are not in the result table. The heat page embeds them as JavaScript:

```js
racerLaps[812982] = {
  'driverName' : 'KANATAFPV',
  'fastLap' : '17.558', 'top3Consecutive' : '53.564', ...
  'laps' : [ { 'lapNum' : '0', 'time' : '0', ... }, { 'lapNum' : '1', 'time' : '21.211', ... }, ... ]
};
```

Lap 0 is the holeshot (start to the first gate) and is excluded; LiveFPV's own Top 3 excludes it too. `parseRace` splits the block at each `'lapNum'`, which keeps parsing linear on odd input.

## Naming

- Qualifying heats: `Pro Class Racing (Heat 4/5)`
- Main heats: `Pro Class Racing A1-Main` (a numbered semifinal heat of A Main)
- Finals: `Pro Class Racing A-Main` (no number)

## Surprises

**Round ranking positions shuffle.** Pilots tied on DNS/DNF swap `pos` between fetches. Comparing whole rows made every poll look like a change; the board compares only the displayed values.

**Short laps are false detections.** Single laps of 5–10 s next to normal 17–60 s laps (e.g. `46.587 → 5.836 → 62.112`). See the minimum lap rule in [architecture.md](architecture.md).

**Organizers rebuild Main Events mid-event.** After the semifinals ran, the Main Events sheet was rebuilt for the finals:

- the A2 and B2 races were deleted (their pages became empty)
- the A1, B1 and C1 races were renamed to `A-Main`, `B-Main`, `C-Main`
- races disappeared from and reappeared in the results list
- the heat sheet's pilot lists were edited after heats had run

The board therefore trusts a heat's results over the heat sheet once the heat has run, and the lost semifinal results are restored from `src/semis.json`, captured from earlier scrapes.

**Race ids are reused.** Each final heat was written into the same race id, overwriting the previous heat, and that id had been a semifinal heat before. Two consequences:

- Every distinct final result is saved to KV as soon as it appears, and a cron scrapes every minute so a heat can't be missed while nobody watches. Heats are told apart by the completion time in the results list; if the race isn't listed, by its content
- A saved semifinal is only refreshed from its old race page while the page still has the same pilots

Main race ids are consecutive (7087380–7087386 at Round 6), so the scraper also checks the ids between known ones for heats that fell off the list.

**Points page.** `view_points` ("Race Points") covers qualifying rounds only, not the finals.

**Bot filtering.** Cloudflare in front of the board rejects Python `urllib`'s user agent with 403; use `curl` to inspect it.
