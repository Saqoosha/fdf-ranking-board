// FDF Cup Ranking Board — Cloudflare Worker
//   GET /           -> ranking page (src/page.html)
//   GET /data.json  -> all round rankings of the current LiveFPV event, cached CACHE_TTL seconds
//
// Config (wrangler.toml [vars]):
//   LIVEFPV_BASE  e.g. "https://fdf2784.livefpv.com"
//   CACHE_TTL     seconds to reuse a scrape (default 45)
//   MIN_LAP       seconds; a gate crossing sooner than this after the last one is ignored (default 12)
import PAGE from "./page.html";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(PAGE, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
      });
    }
    if (url.pathname === "/data.json") {
      return getData(env, ctx, url);
    }
    if (url.pathname === "/laps.json") {
      return getLaps(env, ctx, url);
    }
    return new Response("Not found", { status: 404 });
  },
};

async function getData(env, ctx, url) {
  const base = (env.LIVEFPV_BASE || "https://fdf2784.livefpv.com").replace(/\/$/, "");
  const ttl = Number(env.CACHE_TTL || 45);
  const cache = caches.default;
  const key = new Request(`${url.origin}/__cache/data.json?base=${encodeURIComponent(base)}`);

  const hit = await cache.match(key);
  if (hit) return withHeaders(hit, "HIT");

  try {
    const state = await scrape(base, minLap(env));
    const body = JSON.stringify(state);
    const res = new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${ttl}`,
      },
    });
    ctx.waitUntil(cache.put(key, res.clone()));
    // keep a longer-lived copy to fall back on if LiveFPV is down
    const backupKey = new Request(key.url + "&backup=1");
    ctx.waitUntil(cache.put(backupKey, new Response(body, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=86400" },
    })));
    return withHeaders(res, "MISS");
  } catch (e) {
    const backup = await cache.match(new Request(key.url + "&backup=1"));
    if (backup) return withHeaders(backup, "STALE");
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 502, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

async function getLaps(env, ctx, url) {
  const base = (env.LIVEFPV_BASE || "https://fdf2784.livefpv.com").replace(/\/$/, "");
  const race = url.searchParams.get("race") || "";
  if (!/^\d{1,12}$/.test(race)) {
    return new Response(JSON.stringify({ error: "race must be numeric" }), {
      status: 400, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const cache = caches.default;
  const key = new Request(`${url.origin}/__cache/laps.json?base=${encodeURIComponent(base)}&race=${race}&min=${minLap(env)}`);
  const hit = await cache.match(key);
  if (hit) return withHeaders(hit, "HIT");
  try {
    const src = `${base}/results/?p=view_race_result&id=${race}`;
    const data = parseRace(await get(src), race, src);
    const min = minLap(env);
    for (const name in data.drivers) data.drivers[name] = cleanLaps(data.drivers[name], min).laps.map(fmtT);
    const res = new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
    });
    // an empty parse may be a layout change or a placeholder page; don't pin it for 5 minutes
    if (Object.keys(data.drivers).length) ctx.waitUntil(cache.put(key, res.clone()));
    return withHeaders(res, "MISS");
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 502, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

function withHeaders(res, status) {
  const r = new Response(res.body, res);
  r.headers.set("cache-control", "no-store");
  r.headers.set("x-board-cache", status);
  return r;
}

/* ---------------- scraping ---------------- */

async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (FDF ranking board)" } });
  if (!r.ok) throw new Error(`LiveFPV ${r.status} for ${url}`);
  return r.text();
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
function unescape(s) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(n);
    }
    return ENTITIES[e] ?? m;
  });
}
const text = (s) => unescape(s.replace(/<[^>]+>/g, "")).trim();

function cellValue(td) {
  // cells look like <div class="hidden">sortkey</div>display
  const m = td.match(/<div class="hidden">[\s\S]*?<\/div>([\s\S]*)/);
  return text(m ? m[1] : td);
}

const KEYMAP = {
  "Laps/Time": "lapsTime", "Top 2 Consecutive": "top2", "Top 3 Consecutive": "top3",
  "Top 5 Average": "top5", "Fastest Lap": "fastest", "Avg Lap": "avg", "Heat": "heat",
  "Pos": "pos", "Driver": "driver",
};

function parseRound(page) {
  const classes = {};
  const tabs = {};
  for (const m of page.matchAll(/<a href="#([^"]+)" data-toggle="tab">([\s\S]*?)<\/a>/g)) tabs[m[1]] = text(m[2]);
  for (const m of page.matchAll(/<div class="tab-pane[^"]*" id="([^"]+)">([\s\S]*?)<\/table>/g)) {
    const cname = tabs[m[1]] || m[1];
    const body = m[2];
    let heads = [...body.matchAll(/<th>([\s\S]*?)<\/th>/g)].map((x) => text(x[1]));
    const hi = heads.indexOf("Heat");
    if (hi >= 0) heads = heads.slice(0, hi + 1);
    const tbody = body.includes("<tbody") ? body.split("<tbody")[1] : body;
    const rows = [];
    for (const tr of tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
      if (tds.length !== heads.length) continue;
      const row = {};
      heads.forEach((h, i) => {
        const k = KEYMAP[h] || h;
        if (k === "heat") {
          const id = tds[i].match(/id=(\d+)/);
          row.raceId = id ? id[1] : null;
        }
        row[k] = cellValue(tds[i]);
      });
      if (row.driver) rows.push(row);
    }
    classes[cname] = rows;
  }
  return classes;
}

async function scrape(base, min) {
  const res = await get(base + "/results/");
  const title = res.match(/<title>([\s\S]*?)<\/title>/);
  const event = title ? (text(title[1]).split("::")[1] || "").trim() : "";

  const links = [...res.matchAll(/href="(\/results\/\?p=view_round_ranking&(?:amp;)?id=(\d+)[^"]*)"[^>]*>[\s\S]*?<\/i>\s*([\s\S]*?)<\/a>/g)];
  const rounds = await Promise.all(links.map(async ([, href, id, label]) => {
    label = text(label).replace(/ Rankings$/, "");
    const m = label.match(/(Practice|Qualifier)\s+Round\s+(\d+)/);
    const u = base + href.replace(/&amp;/g, "&");
    const page = await get(u);
    return {
      id, label, url: u,
      kind: m ? m[1].toLowerCase() : "other",
      n: m ? Number(m[2]) : 0,
      classes: parseRound(page),
    };
  }));
  const order = { practice: 0, qualifier: 1 };
  rounds.sort((a, b) => ((order[a.kind] ?? 2) - (order[b.kind] ?? 2)) || a.n - b.n);
  await fixShortLaps(base, rounds, min);

  const race = res.match(/view_race_result&(?:amp;)?id=\d+"[^>]*>([\s\S]*?)<\/a><\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/);
  return {
    event,
    source: base + "/results/",
    rounds,
    lastRace: race ? text(race[1]) : "",
    lastRaceAt: race ? text(race[2]) : "",
    minLap: min,
    fetchedAt: new Date().toISOString(),
  };
}

// race result pages embed per-driver laps as `racerLaps[id] = { 'driverName' : '...', 'laps' : [ {'lapNum':'0','time':'0',...}, ... ] };`
// lap 0 is the holeshot (start to first gate) and is dropped.
function parseRace(page, id, url) {
  const jsStr = (s) => s.replace(/\\(.)/g, "$1");
  const drivers = Object.create(null);
  for (const m of page.matchAll(/racerLaps\[\d+\]\s*=\s*\{([\s\S]*?)\n\s*\};/g)) {
    const name = m[1].match(/'driverName'\s*:\s*'((?:[^'\\]|\\.)*)'/);
    if (!name) continue;
    const laps = [];
    // one chunk per lap object; searching each chunk once keeps this linear on odd input
    for (const chunk of m[1].split(/'lapNum'\s*:\s*/).slice(1)) {
      const n = chunk.match(/^'(\d+)'/);
      const t = chunk.match(/'time'\s*:\s*'([^']*)'/);
      if (n && t && n[1] !== "0") laps.push(t[1]);
    }
    drivers[unescape(jsStr(name[1])).trim()] = laps;
  }
  const hdr = page.match(/class="class_header">([\s\S]*?)<\/span>/);
  const rnd = page.match(/class="class_sub_header">Round:\s*([\s\S]*?)<\/span>/);
  return { id, url, title: hdr ? text(hdr[1]).replace(/\s+/g, " ") : "", round: rnd ? text(rnd[1]) : "", drivers };
}

/* ---------------- minimum lap ---------------- */

const minLap = (env) => Number(env.MIN_LAP || 12);

function secs(s) {
  if (!s || !/\d/.test(s)) return null;
  let v = 0;
  for (const x of String(s).trim().split(":")) v = v * 60 + parseFloat(x);
  return isFinite(v) ? v : null;
}
function fmtT(v) {
  if (v >= 60) { const m = Math.floor(v / 60); return m + ":" + (v - m * 60).toFixed(3).padStart(6, "0"); }
  return v.toFixed(3);
}

// A crossing less than `min` seconds after the last accepted one is a false detection:
// ignore it, so its time carries into the next lap. A short lap at the very end is dropped.
function cleanLaps(times, min) {
  const laps = [];
  let carry = 0;
  for (const t of times) {
    const v = secs(t);
    if (v == null) continue;
    if (carry + v < min) { carry += v; continue; }
    laps.push(carry + v);
    carry = 0;
  }
  return { laps, dropped: carry };
}

function bestWindow(laps, n) {
  let best = null;
  for (let i = 0; i + n <= laps.length; i++) {
    const sum = laps.slice(i, i + n).reduce((a, b) => a + b, 0);
    if (best == null || sum < best) best = sum;
  }
  return best == null ? "" : fmtT(best);
}

// LiveFPV's ranking values count false detections as laps. Only rows whose fastest lap is
// under `min` can contain one, so only their heats are fetched and recomputed.
async function fixShortLaps(base, rounds, min) {
  const rows = [];
  for (const r of rounds) for (const list of Object.values(r.classes)) {
    for (const row of list) {
      const f = secs(row.fastest);
      if (f != null && f < min && row.raceId) rows.push(row);
    }
  }
  const ids = [...new Set(rows.map((row) => row.raceId))];
  const races = Object.fromEntries(await Promise.all(ids.map(async (id) =>
    [id, parseRace(await get(`${base}/results/?p=view_race_result&id=${id}`), id, "").drivers])));
  for (const row of rows) {
    const raw = races[row.raceId][row.driver];
    if (!raw) continue;
    const { laps, dropped } = cleanLaps(raw, min);
    const total = secs(String(row.lapsTime).split("/")[1]);
    if (total != null) row.lapsTime = `${laps.length}/${fmtT(total - dropped)}`;
    row.fastest = laps.length ? fmtT(Math.min(...laps)) : "";
    row.avg = laps.length ? fmtT(laps.reduce((a, b) => a + b, 0) / laps.length) : "";
    row.top2 = bestWindow(laps, 2);
    row.top3 = bestWindow(laps, 3);
    row.minLapFixed = true;
  }
}
