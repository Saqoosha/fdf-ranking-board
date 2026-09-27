# AGENTS.md — FDF Cup Ranking Board

LiveFPV の結果をスクレイプする Cloudflare Worker と、大会後の静的アーカイブ。人向けの説明は `README.md` と `docs/`。

- 全体の仕組みとデータ形式: `docs/architecture.md`
- LiveFPV の HTML と、大会中に起きたこと（Main の作り直し、レース ID の使い回し）: `docs/livefpv.md`
- 大会前・中・後の作業とアーカイブ化の手順: `docs/operations.md`

## エージェント向けの注意

- `wrangler` は PATH に無い。`npx -y wrangler@latest`
- `wrangler.toml` はアーカイブ用（`public/` を配るだけ）。ライブ版は `-c wrangler.live.toml`。ライブ版をデプロイするとアーカイブは配られなくなる
- zsh で `?race=` を含む URL を curl するときは引用符で囲む。囲まないとグロブ扱いで `no matches found` になり、ループごと止まる
- 本番の JSON を Python の urllib で取ると Cloudflare に 403 で弾かれる。curl を使う
- `src/page.html` を直したら、アーカイブ側にも反映するなら `public/<年>/<ラウンド>/index.html` へコピーが要る（自動では同期しない）
- LiveFPV の見た目が変わったら、まず `docs/livefpv.md` の前提（`class_header` の命名、`racerLaps` の形）がまだ正しいか確かめる
- テストは無い。壊れやすいのは `parseRace` / `parseRaceRows` / `scrapeMains`

## 未決定

- 決勝の同点の扱い（1 位の回数 → ベスト Laps/Time）は公式ルールを確認していない
- KV `FINALS` をアーカイブ後も残すか
- ライブ版とアーカイブを同時に配る構成は未実装
