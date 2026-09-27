# FDF Cup Ranking Board (Cloudflare Worker)

LiveFPV のラウンド別ランキングを全部取ってきて、Practice / Qualifier を合算したボードを出す Worker。

- `GET /` … ボード（30秒ごとに `/data.json` を再取得）
- `GET /data.json` … 全ラウンドの JSON。LiveFPV への取得は `CACHE_TTL` 秒（既定 45）キャッシュ。LiveFPV が落ちたら直近の取得結果を返す

## デプロイ

```
npm i -g wrangler      # or npx wrangler
wrangler login
wrangler deploy
```

## 大会が変わったとき

`wrangler.toml` の `LIVEFPV_BASE` をそのトラックの LiveFPV URL に変えて `wrangler deploy`。
（Results ページに出ている「現在のイベント」を読むので、同じトラックならそのままで次の大会に切り替わる）
