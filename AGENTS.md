# AGENTS.md — FDF Cup Ranking Board

## これは何

FPV レース FDF Cup の LiveFPV 結果（`https://fdf2784.livefpv.com/results/`）をスクレイプして見やすいボードにする Cloudflare Worker。Cloudflare アカウントは `Saqoosha`（a@saqoo.sh）、Worker 名 `fdf-ranking-board`。リポジトリは `Saqoosha/fdf-ranking-board`（private）。

## 構成

- `src/index.js` — ライブ版 Worker。`/data.json`（全ラウンド＋Main、45 秒エッジキャッシュ）、`/laps.json?race=<id>`（ヒートのラップ、5 分キャッシュ）、1 分ごとの cron
- `src/page.html` — ボード本体。ライブもアーカイブも同じファイル。`data.json` に `"final": true` があるとアーカイブ動作（ポーリング停止、「確定」表示、ラップは `laps/<id>.json`）
- `src/semis.json` — LiveFPV から消えた準決勝の保存データ（2026 Round 6 専用）
- `public/<年>/<ラウンド>/` — 終わった大会のアーカイブ。`public/_redirects` で `/` を最新大会へ 302

## コマンド

- ローカル: `npx -y wrangler@latest dev -c wrangler.live.toml --port 8799`（`wrangler` は PATH に無いので npx）
- zsh で URL を curl するときは必ず引用符。`?race=` がグロブ扱いされて `no matches found` で止まる
- Cloudflare は Python の urllib の User-Agent を 403 で弾く。本番の JSON を見るときは curl

## アーカイブ化の手順

1. 本番の `/data.json` を保存して `"final": true` を足す（`mainRaceIds` は不要）
2. `data.json` の全 `raceId` について本番の `/laps.json?race=<id>` を `laps/<id>.json` に保存（Round 6 は 43 ヒート、全体で約 212KB）
3. `src/page.html` を `index.html` としてコピー
4. `public/_redirects` の転送先を更新して `npx wrangler deploy`（`wrangler.toml` の `crons = []` で cron が消える。キーを省くだけだと既存の cron が残る）

ライブ版を止める前に取ること。ライブ版を止めた後は `/laps.json` が無いので取れない。

## LiveFPV の挙動（ハマりどころ）

- **ラウンドのランキング** — `view_round_ranking` ページ。Laps/Time・Top 2/3 Consecutive・Fastest は LiveFPV 計算済み。ラウンド内の `pos` は DNS/DNF 同士の並びが取得ごとに入れ替わる → 変化検出（フラッシュ）には使わない
- **ラップ** — ヒートページ（`view_race_result`）に JS の `racerLaps[id] = {...}` として埋め込まれている。`lapNum` 0 はホールショットなので除外（LiveFPV の Top 3 も除外して計算している）
- **最小ラップ** — 12 秒未満（`MIN_LAP`）は誤検知扱い。その時間は次のラップに足す（最後の周なら捨ててトータルから引く）。Fastest が 12 秒未満の行があるヒートだけラップを取って Laps/Time 等を計算し直す
- **Main** — ヒート表（`view_heat_sheet`、ラベルに "Main"）で組み合わせとパイロット、結果一覧の「Main Events」見出しの下にレースが並ぶ。レースページの `class_header` が `Pro Class Racing A1-Main`（番号あり＝準決勝ヒート）か `A-Main`（番号なし＝決勝）
- **運営が大会中に Main Events を作り直す** — 準決勝が終わると決勝用に組み直され、A2/B2 のレースは削除、A1/B1/C1 のレースは `X-Main` に改名されて一覧から消えた。ヒート表のパイロットもレース後に書き換わる → 結果が出たヒートはヒート表でなく結果を正とする。準決勝は消える前に取った値を `src/semis.json` に保存して復元した
- **決勝の各ヒートは同じレース ID を上書きする** — 決勝 1〜3 本目が同じ `view_race_result&id=` に順に上書きされる。だから結果が変わるたびに KV（binding `FINALS`、キー `finals:<base>:<event>`）に積む。ヒートの区別は結果一覧の完了時刻、一覧に無いときは結果の中身。誰も見ていなくても取りこぼさないよう cron で毎分スクレイプ。レース ID も準決勝→決勝で使い回されるので、保存した準決勝はパイロットの顔ぶれが一致するときだけそのページで上書きする
- Main のレース ID は連番で作られる（Round 6 は 7087380〜7087386）ので、既知の ID の間の欠番も確認している
- 「Race Points」ページ（`view_points`）は予選のポイントだけで、決勝には使えない

## ルール（2026 Round 6 時点）

- 総合 = Practice と Qualifier の全ラウンドから、パイロットごとのベスト 1 回（合計ではない）。既定の基準は Laps / Time
- Main: A/B/C。準決勝は各ヒートの上位 2 人（`ADVANCE`）が決勝へ。決勝は 3 ヒート（`FINAL_HEATS`）のポイント制 1 位 5・2 位 3・3 位 2・4 位 1、周回数が規定に届かなければ DNF 0。同点は 1 位の回数 → ベスト Laps/Time（タイブレークは Saqoosha 未確認、ぼくが決めた）

## 残タスク

- KV namespace `FINALS`（id `2a8b171b2ae240529a17249a39f06a45`）はアーカイブでは未使用。消すかは未決定
- ライブ版とアーカイブを同時に出す構成（ライブ Worker が `public/` も配る）は未実装。今はどちらか一方
- テストは無い。壊れやすいのは `parseRace` / `parseRaceRows`（LiveFPV の HTML 形式に依存）
