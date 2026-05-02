# ステータス定義 (Status Definitions)

階層モデル全体で使用するタスクステータスの定義と遷移規則。

## ステータス一覧

| ステータス | 説明 |
| :--- | :--- |
| `TODO` | 未着手。キューに入っている状態 |
| `IN_PROGRESS` | マネージャーが作業中 |
| `IN_REVIEW` | マネージャーが作業完了し、オーケストレーターのレビュー待ち |
| `APPROVED` | オーケストレーターがレビューを通過と判定 |
| `REJECTED` | オーケストレーターが差し戻しと判定。理由の記載が必須 |
| `ERROR` | マネージャーが異常終了またはタイムアウト。手動介入待ち |

---

## 遷移規則

```text
TODO
  └─(マネージャー起動)─→ IN_PROGRESS
                          └─(マネージャー完了)─→ IN_REVIEW
                                                  ├─(APPROVED)─→ APPROVED  ← ゴール
                                                  └─(REJECTED)─→ REJECTED
                                                                  └─(再キュー)─→ TODO

任意のステータス ─(マネージャー異常終了)─→ ERROR
                                            └─(ユーザー「再試」)─→ TODO
```

---

## ステータス更新権限

| 遷移先 | 更新権限 |
| :--- | :--- |
| `TODO` | orchestrator (初期化時・差し戻し再キュー時) |
| `IN_PROGRESS` | **orchestrator のみ** (manager ディスパッチ時) |
| `IN_REVIEW` | **manager のみ** (作業完了時、`manager_output.json` で報告) |
| `APPROVED` | **orchestrator のみ** |
| `REJECTED` | **orchestrator のみ** (差し戻し理由の記載必須) |
| `ERROR` | **orchestrator のみ** (ワーカー異常検知時) |

> **禁止**: マネージャーが 'APPROVED' / 'REJECTED' / 'ERROR' へ遷移させること。

---

## 差し戻し上限

`'max_rejections'` を超えた場合は `'REJECTED'` のままユーザーにエスカレーションする。
エスカレーション時の報告フォーマット：

```text
⚠エスカレーション: タスク {task_id} が差し戻し上限 ({max_rejections}回) を超えました。
累積差し戻し理由：
1回目: [理由]
2回目: [理由]
...
手動での確認・対応をお願いします。
```