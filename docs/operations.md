# Operations

Commands use `npx -y wrangler@latest`; a global `wrangler` works the same.

## Before an event

1. In `wrangler.live.toml`, check `LIVEFPV_BASE`. For the same track nothing changes: the scraper follows whatever event the results page shows.
2. Empty `src/semis.json` (`"heats": []`). Its contents are Round 6's hand-saved semifinals and would otherwise be merged into the next event.
3. Check the rules in `src/page.html`: `ADVANCE` (semifinal qualifiers per heat), `FINAL_HEATS`, `POINTS`, and `MIN_LAP` in the config.
4. Deploy live: `npx -y wrangler@latest deploy -c wrangler.live.toml`

Deploying live replaces the archive: the Worker serves only the live board until the archive config is deployed again.

Local run: `npx -y wrangler@latest dev -c wrangler.live.toml --port 8799`, then `http://localhost:8799/`.

## During an event

- `curl -s https://fdf-ranking-board.saqoosha.workers.dev/data.json` shows what the board sees. `x-board-cache` says `HIT`, `MISS` or `STALE` (LiveFPV failed, last good copy served)
- When LiveFPV reshapes the mains (see [livefpv.md](livefpv.md)), save the visible results before they disappear
- Final heats accumulate in KV: `npx -y wrangler@latest kv key get --binding FINALS --remote 'finals:https://fdf2784.livefpv.com:<EVENT>' -c wrangler.live.toml`

## After an event: archive it

Do this while the live Worker is still deployed; afterwards `/laps.json` no longer exists.

```sh
E=public/2026/round7   # year/round of the event
U=https://fdf-ranking-board.saqoosha.workers.dev
mkdir -p $E/laps
curl -s $U/data.json | python3 -c 'import json,sys; d=json.load(sys.stdin); d["final"]=True; d.pop("mainRaceIds",None); json.dump(d,sys.stdout,ensure_ascii=False,separators=(",",":"))' > $E/data.json
python3 - "$E" <<'PY'
import json, subprocess, sys
e = sys.argv[1]; d = json.load(open(f"{e}/data.json"))
rows = [r for x in d["rounds"] for rs in x["classes"].values() for r in rs]
rows += [r for m in d["mains"] for h in m["heats"] for r in h["rows"]]
for rid in sorted({r["raceId"] for r in rows if r.get("raceId")}):
    out = subprocess.run(["curl", "-s", "-f", f"https://fdf-ranking-board.saqoosha.workers.dev/laps.json?race={rid}"], capture_output=True, text=True).stdout
    open(f"{e}/laps/{rid}.json", "w").write(out)
PY
cp src/page.html $E/index.html
printf '/ /2026/round7/ 302\n' > public/_redirects
npx -y wrangler@latest deploy
```

Round 6 came to 43 heats and about 210 KB.

`wrangler.toml` keeps `[triggers] crons = []`. Leaving the key out does not remove the live config's cron; the empty list does.

## Cloudflare resources

| Resource | Name |
|---|---|
| Worker | `fdf-ranking-board` on the `saqoosha` workers.dev subdomain |
| KV namespace | `FINALS` (`2a8b171b2ae240529a17249a39f06a45`), used by the live config only |
