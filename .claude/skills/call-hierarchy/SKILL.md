---
name: call-hierarchy
description: "Hierarchy (階層型) を起動するスキル。大規模なタスクに対し、hierarchy-managerサブエージェントに委譲してPlanner/Implementer/Reviewerの役割で作業を行う。特にユーザーが「並列で実装して」「役割分担して進めて」「計画→実装→レビューの流れで」と言った場合。"
user-invocable: false
tools: [read, edit, search, execute, agent]
agents: [hierarchy-manager, hierarchy-member]
---

## Concept

大規模なタスクを分割し、各タスクを "hierarchy-manager" サブエージェントに委譲して Plan->Implement->Review サイクルで完遂する階層モデル。内部の Plan->Implement->Review は Generator-Verifier パターンで構成する。Implementer (作成者) が品質の責任を担い、Reviewer (検証者) が客観的な基準で検証する。

* **hierarchy-manager = マネージャー**: タスクごとに1名起動。メンバーを生成してサイクルを管理する。自ら実作業には参加しない。
* **hierarchy-member = メンバー**: マネージャーが生成。Planner / Implementer / Reviewer のロール以上。

## Prerequisites

VS Code で `chat.subagents.allowInvocationsFromSubagents: true` を有効にすること。`runSubagent` 使用時の Manager + Member ホスト呼び出しに必須。`task` ツール使用時は不要。

## How To Call

利用可能なツールに応じて呼び出しを切り替える。

### CLI パターン（'task' ツール利用時）

`task` ツールで `mode: "background"` を指定し、マネージャーを **別コンテキストウィンドウ** で起動する。

```bash
task(
  agent_type: "my-copilot:hierarchy-manager",
  mode: "background",
  name: "manager-{task_id}",
  description: "{task_description} (短期版)",
  prompt: "<下記テンプレートに従って構築>"
)
```

- 完了時に自動的に `read_agent` で結果の JSON (`manager_output.json` 形式) を取得
- マネージャーの思考プロセスは親コンテキストに蓄積しない（並列拡散防止）
- 最大 parallelism 件数を同時実行し、完了次第順次報告（ローリング方式）

### Context Isolation（コンテキスト分離）の意義

| 項目 | runSubagent (VS Code) | task (background) (CLI) |
| :--- | :--- | :--- |
| マネージャーのファイル読み込み | オーケストレーターのコンテキストを消費 | **別コンテキストで実行、消費しない** |
| メンバーの Plan/Implement/Review | 同上 | **同上** |
| 親への要約フィードバック | 必要最小限（マネージャーの出力） | **最新サマリーのみ** |
| 並列実行 | 可能だが出力がコンテキストに蓄積 | **完了通知 + read_agent で必要な分のみ取得** |

VS Code Copilot 環境では `runSubagent` を優先する。

```javascript
runSubagent(
  agentName: "hierarchy-manager",
  description: "{task_description} (短期版)",
  prompt: "<下記テンプレートに従って構築>"
)
```

- 各呼び出しはステートレス
- プロンプトに必要な情報を全て含めること

### Claude Code パターン (`agent` ツール利用時)

`agent` ツールでマネージャーを直接起動する。

```
Agent(
  subagent_type: "hierarchy-manager",
  description: "{task_description}",
  prompt: "<下記テンプレートに従って構築>"
)
```

- 結果はエージェントの返り値として直接受け取る（`read_agent` 不要）。
- 並列実行は依存関係のない `Agent` 呼び出しを同一メッセージで並べることで実現する。

## Parameters

| パラメータ | 説明 | デフォルト値 |
| :--- | :--- | :--- |
| `parallelism` | マネージャーの同時起動スロット数 | 5 |
| `max_rejections` | 1タスクあたりの差し戻し上限回数 | 3 |
| `member_count` | マネージャーが生成するメンバー数（最低3） | 3 |
| `checklist_path` | チェックリストファイルの保存パス | `docs/hierarchy-checklist.md` |

## Manager Prompt Template

```markdown
# タスクの概要
{task_id}
{task_description}

# チェックリストファイル
{checklist_path}

# 承認条件チェックリスト
{checklist}

# メンバー数
{member_count}

# 差し戻し理由 (再試行の場合)
{rejection_reason}

# 補足コンテキスト
{context}
```

> **`{context}` の用途と解釈**: 主にフェーズ引き継ぎペイロード（easy-agent からの委譲情報）が注入される。上限500トークン。コード全文ではなく関連箇所の要約のみを含めること。

## Workflow

### Phase 1: 初期化

1. ユーザーの入力言語からタスク一覧を作成（タスク ID: `T001` 形式）
2. 各タスクに承認条件チェックリスト（客観的な判断条件）を設定する。
   - **重要度タグ**: 達成必須の条件には行頭に `[critical]` を付与する。タグなし項目はベストエフォートとして Reviewer が FAIL しても `risks` への記録にとどめ、REVISE を引き起こさない。
   - 例: `- [critical] ユーザー認証が機能すること` / `- ドキュメントのスタイルガイドに準拠すること`
3. `checklist_path` へチェックリストを書き出す。
4. ユーザーに提示して承諾を求める（承諾なしの起動は禁止）

#### Phase 1 スキップ条件

以下の **両方** を満たす場合、Phase 1 を省略して Phase 2 から開始する:

1. **タスク一覧が Phase 1 フォーマット準拠**: `{context}` に タスクID・チェックリスト・ステータスを含むタスク一覧が存在し、`checklist_path` へ書き出し済みである
2. **ユーザー承認が取得済み**: 上流エージェント (easy-agent 等) がユーザーに提示し、Confirmation Gate で承認を得ている

> **承認の委譲**: easy-agent の Confirmation Gate でユーザー承認を得た場合、call-hierarchy の Phase 1 承認は充足される。
> **前提条件**: `{context}` のタスク一覧は **全件承認済み** であること。再承認を求めない。

承認依頼の提示フォーマット：

> タスク分割計画の承認をお願いします
> [議題] {大まかな目標1行}
>
> | ID | タスク内容 | 担当ロール | 承認条件数 |
> | :--- | :--- | :--- | :--- |
> | T001 | {タスク概要1} | {N名(役割)} | {項目数} |
> | T002 | {タスク概要2} | TBD(内部で決定) | {項目数} |
>
> パラメータ: parallelism({n}), max_rejections({n}), member_count({n})
> この計画で進めてよろしいですか？

### タスク分割と設計の勘所：コンテキスト中心の分離

タスクは「作業の領域」ではなく「必要なコンテキスト」で分割する。

| 良い分割 | 悪い分割 |
| :--- | :--- |
| 「認証モジュールの実装。同一ファイルの対照が容易」 | 「コードを書く」「テストを書く」（同じコンテキストが必要） |
| 「API エンドポイント A」と「API エンドポイント B」（独立） | 「ルーティング」と「ビジネスロジック実装」（密結合） |
| タスクの分割が最小。小タスクで閲覧範囲が網羅可能 | 依存関係が複雑 |

> **エグゼキューターは信頼しすぎない**: 各タスクの `depends_on` の定義が不正確な場合、情報はオーケストレーター経由でしか伝わらない。
> **依存関係**: 設計時に前段のタスクが後続タスクに影響を与える場合、依存グラフを適切に定義し、完了次第後続タスクに展開（ローリング方式）

### タスク起動と並行実行手順

1. **依存関係の解決**: Phase 1 でタスク分割時に各タスクの `depends_on`（前提タスク ID リスト）を定義する
2. **スロット管理**: `parallelism` 件のタスクを並列に起動。`depends_on` が未完了のタスクはディスパッチ待機系とする。
3. **ループ実行**: 依存グラフからトポロジカルソートし、順次タスクを起動・完了させる。
4. **結果の統合**: 前段タスクが完了したら、その `output` フィールドを後続タスクの補足コンテキスト (`context`) に設定する。

### Phase 2: ローリングタスク実行（内部ループ）

以下のサイクルを `parallelism` スロットが空くごとに繰り返す。

1. TODO / REJECTED のタスクのうち、`depends_on` の全タスクが 'APPROVED' / 'SKIPPED' に到達した時点でキューに追加。
2. キューから最大 `parallelism` 件を切り出し `task` ツール or `runSubagent` で **バックグラウンド** 起動。
3. 5分ごとに進捗報告（バッチ完了待機ではない）
4. 完了報告を受けた場合：
   - 完了情報を `checklist_path` に追記
   - 成功（APPROVED）ならば、後続タスクをキューから実行可能系へ
   - レビュー却下（REJECTED）ならば、前回修正案をキューから再実行
5. 全件 APPROVED まで繰り返す

### Phase 3: ゲートキーパーレビュー

1. Reviewer は Generator-Verifier パターン の Verifier として機能する。
2. チェックリストの全項目を客観的に審査し、各項目の `is_critical` を `[critical]` タグの有無から判定して記録する。
3. **[critical] 2段階合否判定** (ADR-018):
   - `[critical]` 項目が **全て PASS** → `verdict: APPROVE`。non-critical FAIL は `risks` に記録する。
   - `[critical]` 項目が **1つでも FAIL** → `verdict: REVISE`。critical FAIL のみを `rejection_instructions` に列挙する。
4. 差し戻し → Implementer が critical 項目を修正 → 再レビュー
5. 差し戻し "max_rejections" 回数（critical 項目の FAIL 基準）→ ユーザーエスカレーション

以下のパターンを検出した場合は "REJECTED" とする：

| 検出パターン | 説明 |
| :--- | :--- |
| 単一ファイルハック | テストを通すためだけの条件分岐・マジックナンバー・ハードコーディング |
| 不要コードの削除 | 要求されていない独自なレイヤー、ユーティリティクラス、既存コードの変更の履歴 |
| 存在しない API 参照 | コードベースに実在しないクラス・メソッド・定数の参照 |
| 一時ファイル残存 | 成果物に含まれるべきでない一時ファイル・スクラッチパッドの残存 |

#### フォールバック戦略 (max_rejections 超過時)

`max_rejections` に到達した場合は以下を実行：

1. 現在の進捗状況（APPROVED/FAILED リスト）を報告
2. 失敗時のチェックリスト項目と差し戻し履歴を要約
3. ユーザーに選択肢を提示：(a) 手動介入 (b) 差し戻し回数リセット (c) 別アプローチで再試行

> 選択肢 (c) では差し戻しカウントをリセットし、補足コンテキストに失敗の根本原因と新しい設計方針を明記して再考させる。

### Phase 4: 最終集計

1. 最終成果ゲートを1回実行
2. 全体成果物を集計してグラウンドサマリーを作成

## Status Report

スロット補充のたびにユーザーへ報告：

| 進捗レポート (コンパクト版) | |
| :--- | :--- |
| APPROVED: | {n}件 ( {IDリスト} ) |
| REJECTED: | {n}件 ( {IDリスト} \| 差し戻し理由要約 ) |
| IN_PROGRESS: | {n}件 ( 実行中... ) |
| 残キュー: | {n}件 |

長文の進捗レポートは避け、上記のワンライナー形式を使用する。

## Verification Criteria（検証基準）

### Phase 1 構築：タスク分割の品質

- [ ] 各タスクが「コンテキスト中心の分離」原則に従っているか
- [ ] タスクの依存関係が適切に定義されているか
- [ ] チェックリストの各項目が客観的に検証可能か

### Phase 3 検証：ゲートキーパーレビュー

- [ ] 各タスクの成果物ファイルが実際に生成されているか
- [ ] 各テスト項目がパスしているか
- [ ] `rejection_reason` のような客観的な証跡に基づいて合否判定を行っているか
- [ ] チェックリストの各項目が最終的に承認状態（PASS）で完遂したか

### Phase 4 検遂：最終集計

- [ ] 全成果物の整合性チェック
- [ ] 全承認ステータスを網羅した最終レポートを作成
- [ ] 大局的な矛盾（全成果物がカバーされているか）

## Context Window Management (コンテキスト管理)

### オーケストレーター → マネージャーへの委譲時

1. **コンテキストの最小化**: マネージャープロンプトにはタスク固有の情報のみを含める。
2. **チェックリストは完全に渡す**: マネージャーがメンバーに正確に伝達できるよう、チェックリストは省略しない。
3. **補足コンテキストの要約**: `{context}` は関連コードの抜粋 (5-20行) と要約のみ。上限500トークン。

### タスク実行中のコンテキスト爆発防止

1. **フェーズ出力の圧縮**: Planner の出力を Implementer へ渡す際は実装計画の箇条書きのみ（中間調査メモや議論経緯は除外）。
2. **Reviewer への入力制限**: Reviewer に渡す「これまでの実装」は最新 Implementer 出力のみ。前フェーズの全履歴は渡さない。
3. **マネージャーへの報告簡素化**: オーケストレーターへの最終報告は `deliverable_path` + `checklist_validation` + `residual_risks` の3点のみ。

### ユーザーへの報告

タスク完了状況は Status Report のワンライナー形式を使用し、詳細ログは含めない。

### トークン予算

| 階層 | 入力上限 | 出力上限 |
| :--- | :--- | :--- |
| オーケストレーター → マネージャー | 1,000トークン (context: 500, checklist: 300, task description: 200) | — |
| マネージャー → Planner | 800トークン (checklist: 300, task description: 200, context要約: 300) | 500トークン (実装計画の箇条書き) |
| マネージャー → Implementer | 800トークン (plan要約: 400, checklist: 300, task description: 100) | 400トークン (COVERED記録 + 成果物パス) |
| マネージャー → Reviewer | 600トークン (checklist: 300, 最新Implementer出力: 300) | 400トークン (PASS/FAIL + rejection_instructions) |
| マネージャー → オーケストレーター | — | 500トークン (manager_output.json) |

> **超過時の対応**: 補足コンテキスト (`context`) を段階的に削減: 500 → 300 → 100トークン。それでも超過する場合は `context` を「チェックリスト達成に直結するコード断片のみ」に絞り込む。チェックリスト自体は常に完全版を渡す。

---

## When NOT to use（使わないケース）

以下の場合は Hierarchy を使わず、通常実行を選択する：

| 状況 | 判定基準 |
| :--- | :--- |
| 変更対象が 1〜2ファイル | サブエージェントのオーバーヘッドが成果を上回る |
| タスクの目的が明快な小タスク | サブエージェントのオーバーヘッドが不釣り合い |
| タスクが 15分以内に完了する見込み | 調査コストが高い |
| 戦略的な変更が必要な `designExecute` | `Parliament` (複数エージェント会議) への委譲を優先 |

---

## 呼び出し元の応答コントラクト (Caller Response Contract)

call-hierarchy を呼び出したエージェント（通常 easy-agent の Implement フェーズ）が、各返却ステータスを受け取った際に取るべきアクションを定義する。返却の単位は **タスクごとの `manager_output.status`**（schemas/manager_output.json）と、**オーケストレーター集約後の最終状態**（Phase 4 の `grand_summary` または Phase 3 のフォールバック発動）の2層に分かれる。

### タスク単位 (Per-task) の返却ステータス

| ステータス | 意味 | 呼び出し元が取るべきアクション |
| :--- | :--- | :--- |
| `IN_REVIEW` | Manager が成果物をオーケストレーターへ提出（Reviewer 検証は完了） | `checklist_validation` を確認。**`[critical]` 項目が全て PASS**（`is_critical: true` かつ `result: "PASS"`）かつ Phase 3 検証パターン（単一ファイルハック等）に該当しなければ当該タスクを `APPROVED` に遷移。`[critical]` 項目の FAIL が 1 つでもあれば `REJECTED` で差し戻し。non-critical (`is_critical: false`) の FAIL は `APPROVED` を妨げず `residual_risks` に転記する（ADR-018）。 |
| `ERROR` | Manager 内部ループ上限超過などマネージャーが自力で回復不能な失敗 | 当該タスクのステータスを `ERROR` に固定し、`error_reason` を要約。**自律的な再投入は行わない**。タスク全体への影響を評価し、Advisory 相談か Phase Gate で STOP を選択 |

> **REJECTED は差し戻しカウント (`rejection_count`) を 1 加算してから再キューする**。`max_rejections` を超過した時点でオーケストレーター集約レベルのフォールバックへ遷移する（下表参照）。`max_rejections` カウントの対象は `[critical]` 項目の FAIL に基づく REJECTED のみ。

### オーケストレーター集約レベルの返却ステータス

| ステータス | 根本原因 | 呼び出し元が取るべきアクション |
| :--- | :--- | :--- |
| 全タスク APPROVED | Phase 3 で全タスクがチェックリストを充足し、Phase 4 で `grand_summary` が生成された | `Verify` フェーズへ進む。成果物リスト（各タスクの `deliverable_path`）を refine-loop の `task_context` に含める。**`residual_risks` は refine-loop の `requirements_checklist` へ non-critical 項目（`[critical]` タグなし）として追記して引き継ぐ**（ADR-020）。 |
| `max_rejections` 超過 | 1つ以上のタスクで差し戻し回数が上限を超過（チェックリスト未達のまま） | call-hierarchy の **フォールバック戦略 (Phase 3)** で提示される選択肢（手動介入 / 差し戻しリセット / 別アプローチで再試行）を **そのままユーザーへ転送** する。ユーザー選択後に再実行、または Phase Gate で STOP |
| タスク `ERROR` の連鎖 | 単一タスクの `ERROR` が `depends_on` で連結されたタスクへ波及 | 影響範囲（依存先タスク群）を特定して未着手のものは `TODO` のまま保留し、進捗レポートにまとめてユーザーへ報告。**自動継続せずユーザー判断を仰ぐ**（`status` enum を逸脱した独自ラベルは導入しない） |
| `DISPATCH_FAILURE` | `hierarchy-manager` サブエージェントの起動失敗・タイムアウト・`agent` / `task` / `runSubagent` ツール不可 | **Skip-and-Report**: 当該タスクを `ERROR (error_reason: "dispatch failure")` 扱いでスキップし、`depends_on` で連結されたタスクを `TODO` で保留する。全タスクが `DISPATCH_FAILURE` になった場合（= `agent` ツール全体不可）は Phase Gate で STOP（ADR-015）。 |

> **転送原則 (Relay Principle)**: easy-agent は `max_rejections` 超過時に独自の選択肢を作らず、call-hierarchy が提示した3択をそのままユーザーに渡す。これによりサブエージェントのフォールバック戦略とオーケストレーターの応答が矛盾しない（ADR-008 参照）。

> **ERROR と max_rejections 超過の違い**: `ERROR` は「マネージャー内部の致命的失敗（再投入で改善する見込みが薄い）」。`max_rejections` 超過は「チェックリスト基準と成果物の乖離（要件・アプローチの再検討で解決可能）」。前者は STOP 寄り、後者はユーザー選択肢提示が標準対応。

> **部分完了の取り扱い**: 一部タスクが APPROVED で残りが `max_rejections` 超過の場合も同様にユーザーへ転送する。APPROVED 済みタスクの成果物は保全した上で、失敗タスクのみを対象に選択肢を提示する。
