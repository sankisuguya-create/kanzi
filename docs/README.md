# docs — 文書の置き場

| 置き場 | 中身 | 書くとき |
|---|---|---|
| [design.md](design.md) | 全体の設計書。目的・決定一覧（WHY）・データ・保存・学級と担当・ゲート・過年度など、モードをまたぐ決定の正本。§1〜§28 の節番号はコード・テストのコメントから引かれているので変えない | モードをまたぐ決定を変えた時 |
| [research.md](research.md) | 根拠の一覧（`S`＝制度・基準、`R`＝研究、`T`＝実装資源）。design.md から番号で引く | 根拠を足した時 |
| [features/](features/) | モードごとの仕様（実装済み）。design.md の節から分けたものは節番号を引き継ぐ | モードを足した・変えた時 |
| [requirements/](requirements/) | 実装前の要件定義（利用者の指定・決定・未決事項）。実装後も、何を頼まれたかの記録として残す | 新しいモードを頼まれた時 |
| [reports/](reports/) | 生成物・確認用の一覧（ツールが書き出すもの、先生の目で見直すための一覧） | ツールが更新する。手で直さない |

## 機能の一覧

| モード | 仕様 | design.md |
|---|---|---|
| 成長する森（メニューの木） | [features/forest.md](features/forest.md) | D12・§19 |
| 一文の分解 | [features/bunkai.md](features/bunkai.md) | §25 |
| れんしゅうプリント | [features/tprint.md](features/tprint.md) | §26 |
| 説明文の分解 | [features/setsumei.md](features/setsumei.md) | §27 |
| 説明文を書く（未実装） | [requirements/setsumei-writing.md](requirements/setsumei-writing.md) | §28 |

よむ・かく・カード・ひらがな・カタカナ・テストの範囲・ボタンのオン・オフ・過年度データは design.md の本文（§12〜§24）にある。

## 生成物（reports/）

- `reports/tprint-report.txt` … `npm run build:tprint` が書き出す（目視で除外した字・四角の問題が無い字）
- `reports/setsumei-review.md` … 説明文20本を先生の目で確かめるための一覧
