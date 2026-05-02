# スタンス定義 (Stance Definitions)

メンバーが発言時に使用するスタンスの定義。全メンバー共通。

| スタンス | 意味 | 使用場面 |
| :--- | :--- | :--- |
| `PROPOSE` | 新しい提案やアイデアを提示 | 議論の初期段階やブレイクスルーが必要な時 |
| `CRITIQUE` | 問題点やリスクを指摘 | 提案に対して懸念がある時。**必ず代替案または改善条件を付記**すること |
| `APPROVE` | 現行案を承認 | 自分の基準を満たしている時。`condition_for_approval` は `null` |
| `REVISE` | 軽微な修正案を提示 | 大筋は合意だが微調整が必要な時 |

## ルール

* `CRITIQUE` 時は必ず `condition_for_approval` （どうすれば承認するか）を記載すること。
* `APPROVE` 時は `condition_for_approval` を `null` にすること。
* 一度の発言で扱う論点は **最大2つ** まで。焦点を絞ること。
* **論点の粒度**: 1論点 = 「1つの主張 + その根拠」のセット。同一テーマ内の複数の懸念（例：接続プール管理の複雑さ + 障害時ハンドリング）は、根拠が異なれば別論点としてカウントする。

## ロール別スタンス選択ガイダンス

スタンス選択に迷った場合、以下のヒューリスティクスを参考にする：

| ロール | 初回発言の推奨スタンス | 他者 PROPOSE への応答 | 合意形成段階 |
| :--- | :--- | :--- | :--- |
| **Advocate** | PROPOSE (推進案を提示) | REVISE (自案との統合) | APPROVE or REVISE |
| **Reviewer** | CRITIQUE (品質リスク指摘) | CRITIQUE (品質基準チェック) | APPROVE or REVISE |
| **Compliance** | CRITIQUE (規約・制約違反チェック) | CRITIQUE (規約適合性評価) | APPROVE or REVISE |
| **Pragmatist** | PROPOSE or REVISE (実現可能性重視の案) | REVISE (コスト・工数観点の調整) | APPROVE or REVISE |

> これはヒューリスティクスであり、文脈に応じて逸脱してよい。例：Reviewer が他者の懸念に対して解決策を持つ場合は PROPOSE を使ってもよい。

---