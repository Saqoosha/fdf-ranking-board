# FDF Cup Ranking Board (Cloudflare Worker)

LiveFPV の大会結果を取ってきて、Practice / Qualifier の合算ボードと Main（準決勝・決勝）の表を出す。

公開 URL: https://fdf-ranking-board.saqoosha.workers.dev （`/` は最新大会のアーカイブへ転送）

## 2 つのモード

| モード | 設定 | 中身 |
|---|---|---|
| アーカイブ（今の本番） | `wrangler.toml` | `public/` を Static Assets で配るだけ。大会ごとに `public/<年>/<ラウンド>/` |
| ライブ（大会中） | `wrangler.live.toml` | `src/index.js` が LiveFPV をスクレイプして `/data.json` と `/laps.json?race=<id>` を返す |

```
npx wrangler deploy                          # アーカイブ
npx wrangler deploy -c wrangler.live.toml    # ライブ（アーカイブのページは配られなくなる）
```

## 次の大会

1. `wrangler.live.toml` の `LIVEFPV_BASE` を確認（同じトラックなら「現在のイベント」を読むのでそのまま）
2. `src/semis.json` を空にする（`heats: []`）。中身は 2026 Round 6 専用の保存データ
3. `npx wrangler deploy -c wrangler.live.toml`
4. 大会が終わったらアーカイブ化（AGENTS.md の手順）
