---
name: call-refine-loop
description: "refine-loop (反復改善ループ) を起動するスキル。成果物（コード・設計・計画）を refine-loop エージェントに委譲し、毎イテレーションで新規ブランクスレートサブエージェントによるバイアスフリーレビューを行って品質を収束させる。Verify フェーズで自己評価ループ (REVISE) の代わりに使用する。"
user-invocable: false
tools: [read, edit, search, execute, agent]
agents: [refine-loop]
---

# call-refine-loop — 反復改善ループ呼び出しスキル

## Purpose (目的)

成果物（コード・設計・計画）を受け取り、「実行 → バイアスフリーレビュー → 修正 → 再レビュー → 収束」のループを繰り返す。

**核心的な前提**: 作成者は自分の成果物を客観視できない。そのため毎イテレーションで**新規サブエージェント**をレビュアーとして dispatch し、ブランクスレート視点での評価を得る。これは empirical-prompt-tuning と同じ原理を、コード・設計・計画の品質改善に適用したもの。

## When to use (使用場面)

- Verify フェーズで自己評価が 2回連続 REVISE になった場合
- 外部視点による品質保証が必要な成果物（設計書、アーキテクチャ決定、重要ロジック）
- Phase Gate で REVISE が繰り返され、「なぜ品質が上がらないか」が自己診断できない場合

## When NOT to use

- 単純な typo 修正・既知パターンの適用（自律実行で十分）
- Explore フェーズの情報収集（レビューではなく調査が必要）
- ユーザーが `max_iterations=0` を指定した場合
- 実行環境に `agent` dispatch ツールがない場合（Step 0 で ABORT になる。refine-loop は easy-agent などトップレベルオーケストレーターから直接呼び出す必要がある）

---

## 入力パラメータ

| パラメータ | 必須 | 型 | 説明 |
| :--- | :--- | :--- | :--- |
| `subject` | ✓ | string | 対象の説明とファイルパス（レビュアーに渡す） |
| `requirements_checklist` | ✓ | list | 成果物が満たすべき要件リスト。最低1つ `[critical]` タグ必須。Hierarchy 委譲後は `manager_output.residual_risks` を `[critical]` タグなし項目として追記する（ADR-020）。 |
| `task_context` | ✓ | string | 背景・制約・意図（成果物パスリストを含む。レビュアーが判断に使う）。`residual_risks` はここではなく `requirements_checklist` に追記する（ADR-020）。 |
| `max_iterations` | — | int | 最大反復数（デフォルト: 3） |

> **[critical] タグのルール**: 最低1つが必須。事後追加・削除禁止。[critical] が1つも達成されなければ Success 判定しない。

---

## ループ構造

```
[成果物の現在状態]
      ↓
  Iteration N
  ───────────────────────────────────
  ① レビュアー dispatch
     新規サブエージェントをブランクスレートで起動
     → subject + requirements_checklist + task_context を渡す
  ② 構造化レポート収集
     → 要件達成状況 + Unclear Points + 裁量判断
  ③ 収束チェック
     → [critical] 未達 0件 が 2連続 → CONVERGED
     → max_iterations 到達 → MAX_ITER
     → 同一 Fix Rule が 3回出現 → ESCALATE
  ④ [未収束の場合] 最小差分修正を1テーマ適用
  ───────────────────────────────────
      ↓
  Iteration N+1
```

> **1テーマの原則**: 1イテレーションにつき1つのテーマを修正する（複数の無関係な修正は次回へ）。複数の関連マイクロ修正は1テーマとして束ねて良い。

---

## レビュアーサブエージェント 呼び出しコントラクト

レビュアー dispatch 時のプロンプトは必ず以下の構造に従う。

```
あなたはブランクスレートのレビュアーです。先入観なく成果物を評価してください。

## 対象成果物
{subject}
（必要に応じてファイルパスを Read ツールで確認してください）

## タスクコンテキスト
{task_context}

## 要件チェックリスト
{requirements_checklist の各項目を番号付きで列挙。[critical] タグを保持する}

## タスク
要件チェックリストに対して評価し、以下のレポート構造で回答してください。

## レポート構造
- **要件達成状況**: 各項目 ○ / × / partial（理由付き）
- **成功/失敗判定**: [critical] 項目が全て ○ なら成功(○)、1つでも × なら失敗(×)
- **構造化 Unclear Points**（問題を発見した場合のみ）:
  - Issue: <何が起きているか>
  - Cause: <原因（成果物レベル）>
  - Fix Rule: <このクラスの問題を防ぐ一般ルール>
- **裁量判断**: 成果物に明記されていないが自分の判断で補完した点（箇条書き）
- **Retries**: 同じ判断を何度しなおしたか、理由
```

---

## 収束判定規則

| 条件 | ステータス | 対応 |
| :--- | :--- | :--- |
| [critical] 未達 0件 が **2連続** | `CONVERGED` | ループ終了、完了レポート出力 |
| `max_iterations` に到達 | `MAX_ITER` | ユーザーへ残存 issues を報告して終了 |
| 同一 Fix Rule が **3回以上** 出現 | `ESCALATE` | 設計上の問題として Phase Gate へ返す |
| イテレーション中に [critical] タグが追加・削除された | `ABORT` | エラー — [critical] タグは固定 |

> **複数条件の同時成立時の優先順位**: `ABORT` > `ESCALATE` > `MAX_ITER` > `CONVERGED`
> 例: あるイテレーションで「Fix Rule 3回出現（ESCALATE 条件）」と「[critical] 未達 0件 2連続（CONVERGED 条件）」が同時に成立した場合、`ESCALATE` を返す。根本原因パターンが収束前に繰り返された事実を呼び出し元に伝えることを優先する。

---

## 評価軸（measurement）

empirical-prompt-tuning の評価軸に対応する形で、以下を各イテレーションで記録する。

| 軸 | 取得方法 | 意味 |
| :--- | :--- | :--- |
| 成功/失敗 | [critical] 項目が全て ○ か | 最低ライン |
| Accuracy | 要件チェックリストの達成率 (%) — **最終イテレーション** の値を使用（累積平均ではない） | 部分達成の度合い |
| Unclear points | レビュアーの自己報告 | 定性的改善材料 |
| 裁量判断 | レビュアーの自己報告 | 暗黙仕様の発見 |
| Retries | レビュアーの自己報告 | 成果物の曖昧さの信号 |

**重み付け**: 定性（Unclear points / 裁量判断）が主、定量（Accuracy）が補助。Accuracy だけを追うと成果物が薄くなる。

---

## Fix Rule レジャー (Failure Pattern Ledger)

同一の Fix Rule が繰り返し出現する場合、それは成果物の設計上の問題である。

エントリー形式:
```
- **Pattern**: <短い名称（名詞句・ケバブケース推奨: null-safety, input-validation）>
  - Example: <代表的な Issue 文言>
  - Fix Rule: <クラスレベルのルール>
  - Seen in: Iter N, Iter M, ...
```

### Fix Rule の照合ルール

Fix Rule の「同一性」は **表面テキストの一致ではなく根本原因クラスの一致** で判定する。

- **大文字小文字を無視**: `Null Check Missing` と `null check missing` は同一
- **同義表現を同一視**: 「null チェック漏れ」「NPE ガード不足」「null pointer guard」は根本原因クラス `null-safety` として統一
- **判定のヒューリスティクス**: 「同じコード変更で解決できる問題を指している」なら同一クラス
- **パターン名の正規化**: 登録時は動詞句ではなく名詞句（例: `null-safety`, `input-validation`, `error-propagation`）を推奨

ルール:
- 修正適用前に Fix Rule レジャーを参照する。既存パターンと一致する場合、なぜ以前の修正が防げなかったかを先に調べる。
- 3回以上繰り返す Fix Rule は `ESCALATE` トリガーとなる（優先順位: ABORT > ESCALATE > MAX_ITER > CONVERGED）。

---

## 出力フォーマット

```markdown
## refine-loop 完了レポート

- **ステータス**: CONVERGED / MAX_ITER / ESCALATE / ABORT
- **実行回数**: N / {max_iterations}
- **最終 Accuracy**: XX%

### イテレーション別サマリー
| Iter | 成功/失敗 | Accuracy | 適用テーマ |
| --- | --- | --- | --- |
| 1 | × | 60% | <修正テーマ> |
| 2 | ○ | 90% | <修正テーマ> |

### 残存 issues（あれば）
- <issue>

### Fix Rule レジャー（本ループ内で発見）
- <pattern>
```

---

## 呼び出し元の応答コントラクト (Caller Response Contract)

refine-loop を呼び出したエージェント（通常 easy-agent）が各返却ステータスを受け取った際に取るべきアクションを定義する。

| ステータス | 意味 | 呼び出し元が取るべきアクション |
| :--- | :--- | :--- |
| `CONVERGED` | [critical] 要件が2連続で全達成 → 品質収束確認 | 次フェーズへ進む。追加の品質チェック不要。 |
| `MAX_ITER` | max_iterations 到達後も品質未収束 | **ユーザーに残存 issues を提示し、次の選択肢を提示する**: (a) `APPROVED(partial)` として後続フェーズへ続行、(b) `Implement` フェーズに差し戻して成果物を修正。自動で先に進まない。 |
| `ESCALATE` | 同一 Fix Rule が3回以上出現 → 成果物に設計上の根本問題 | `Implement` フェーズに差し戻す。設計の根本原因を再検討してから再実装する。必要に応じて Advisory または Parliament へ委譲する。 |
| `ABORT` ([critical] タグなし) | requirements_checklist に [critical] タグが存在しない | requirements_checklist を再構築し、最低1つ `[critical]` タグを付与して refine-loop を再呼び出しする。再度 ABORT が発生した場合は Phase Gate で STOP してユーザーに報告する。 |
| `ABORT` (dispatch 不可) | `agent` ツールが利用不可のため refine-loop を起動できない | REVISE ループ（最大2回）にフォールバックする。ユーザーに `[refine-loop 不可: agent ツールなし。自己評価モードで継続します]` と通知する。 |
| `DISPATCH_FAILURE` | `agent` / `task` / `runSubagent` ツール不可でサブエージェントが起動できない（[ADR-015](../../../docs/adr/ADR-015-dispatch-failure-protocol.md) 正規名。`ABORT (dispatch 不可)` と等価） | **Fallback-Mode**: REVISE ループ（最大2回）にフォールバックする。ユーザーに `[refine-loop 不可: agent ツールなし。自己評価モードで継続します]` と通知する。 |

> **MAX_ITER と ESCALATE の違い**: `MAX_ITER` は「時間切れ（品質は向上しているが収束しなかった）」、`ESCALATE` は「設計的な詰まり（同じ問題が繰り返される）」。前者はユーザーの裁量で続行可能、後者は再設計が必要。

---

## Context Window Management (コンテキスト管理)

### オーケストレーター → refine-loop への委譲時

1. **requirements_checklist は完全に渡す**: `[critical]` タグの整合性チェックはループ全体を通じて行われるため省略不可。
2. **task_context の最小化**: `{task_context}` はレビュアーが参照すべきファイルの相対パスリストと要点のみ。上限400トークン。
3. **subject の一貫性**: 同一 subject をループ全体で変更しない（収束判定の基準が変わるため）。

### イテレーション中のコンテキスト爆発防止

1. **レビュアーはブランクスレート**: 各イテレーションで新規サブエージェントを起動。前イテレーションの議論ログは渡さない。
2. **Fix Rule レジャーの圧縮**: 各エントリは `{pattern_name}: seen_in=[{iteration_list}]` の1行形式で保持する。詳細テキストは破棄してよい。
3. **完了レポートの簡素化**: オーケストレーターへの報告は `status` + `residual_issues` + `fix_rule_ledger` のみ。詳細なレビュアーの発言ログは含めない。

### トークン予算

| 階層 | 入力上限 | 出力上限 |
| :--- | :--- | :--- |
| オーケストレーター → refine-loop | 1,000トークン (task_context: 400, checklist: 400, subject: 200) | — |
| refine-loop → レビュアー (各イテレーション) | 700トークン (subject: 200, checklist: 300, file paths: 200) | 500トークン (構造化レポート) |
| refine-loop → オーケストレーター | — | 600トークン (完了レポート) |

> **超過時の対応**: `task_context` を段階的に削減: 400 → 200 → ファイルパスのみ。requirements_checklist は常に完全版を渡す（削減不可）。

---

## 制約・注意事項

1. **レビュアーは必ず新規サブエージェント**: 前回の文脈を引き継いだ同一エージェントを再利用しない。
2. **[critical] タグは固定**: ループ開始後に追加・削除しない。
3. **1イテレーション = 1テーマ**: 無関係な複数修正を同時に行うと因果関係が不明になる。
4. **自己評価の代替不可**: 自分でレビュアー役を兼任しない（バイアスが入る）。
5. **ESCALATE の扱い**: 同一 Fix Rule 3回出現は「ループで解決できない」信号。easy-agent の Phase Gate に戻して Advisory または Parliament へ委譲する。
