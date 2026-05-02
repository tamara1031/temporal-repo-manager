---
name: call-parliament
description: "Parliament (議会モデル) を起動するスキル。大目標を議題に分割し、parliament-chairpersonサブエージェントに委譲して多角的議論で合意形成する。Use when ユーザーが「議論して」「多角的に検討して」「設計をレビューして」「方針を決めて」と言った場合。"
user-invocable: false
tools: [read, edit, search, execute, agent]
agents: [parliament-chairperson, parliament-member]
---

## Concept

大目標を議題に分割し、各議題を `parliament-chairperson` サブエージェントに委譲して多角的議論で合意形成する議会モデル。

- **あなた (現在のエージェント) = オーケストレーター**: 議題分割・チェックリスト作成・検収・統合に徹する。**自ら議論には参加しない。**
- **parliament-chairperson = 議長**: 議題ごとに1体起動。メンバーを生成して議論をファシリテートする。
- **parliament-member = メンバー**: 議長が生成。Advocate / Reviewer / Compliance / Pragmatist の4ロール必須 + 追加ロール任意。

> **競合アプローチがある場合の Advocate 配置**: 議題に2つ以上の競合アプローチがある場合、各アプローチに1名ずつ Advocate を配置する (`member_count` を必要に応じて増加)。単一の Advocate が全候補を公平に分析することは期待しない。
> **member_count の調整責務**: オーケストレーターが競合案数を把握している場合、`member_count` を事前に設定する（最低構成：競合案数 + 3 (Reviewer + Compliance + Pragmatist) ）。把握していない場合、議長 (Chairperson) が議題分析時に検出し `member_count` を自ら増加させる。Chairperson は member_count 外でカウントされる。

## Prerequisites

VS Code で `chat.subagents.allowInvocationsFromSubagents: true` を有効にすること。`runSubagent` 使用時の Chairperson -> Member ネスト呼び出しに必須。`task` ツール使用時は不要。

## How To Call

利用可能なツールに応じて呼び出し方を切り替える。

### CLI パターン (`task` ツール利用時)

`task` ツールで `mode: "background"` を指定し、議長を **別コンテキストウィンドウ** で起動する。

```bash
task(
  agent_type: "my-copilot:parliament-chairperson",
  mode: "background",
  name: "chair-{topic_id}",
  description: "{topic_title} (短縮版)",
  prompt: "<下記テンプレートに従って構築>"
)
```

- 完了時に自動通知 → `read_agent` で結果の JSON (`chairperson_output.json` 形式) を取得
- 依存関係のない議題は **同時に複数起動** する（逐次起動禁止）
- 最大 `parallelism` 件を同時発火し、完了次第即座に補充（ローリング方式）

> **コンテキスト分離の効果**: 議会パターンは「メンバー数 × ラウンド数」で発言量が急増するため、Background Task パターンのメリットが特に大きい。議長とメンバーの全やり取りがオーケストレーターのコンテキストから隔離される。

### VS Code パターン (`runSubagent` ツール利用時)

VS Code Copilot 環境では `runSubagent` を使用する。

```javascript
runSubagent(
  agentName: "parliament-chairperson",
  description: "{topic_title} (短縮版)",
  prompt: "<下記テンプレートに従って構築>"
)
```

- 各呼び出しは **ステートレス**
- プロンプトに必要な情報を全て含めること

### Claude Code パターン (`agent` ツール利用時)

`agent` ツールで議長を直接起動する。

```
Agent(
  subagent_type: "parliament-chairperson",
  description: "{topic_title}",
  prompt: "<下記テンプレートに従って構築>"
)
```

- 結果はエージェントの返り値として直接受け取る（`read_agent` 不要）。
- 依存関係のない議題は複数の `Agent` 呼び出しを並列に実行できる。

## Parameters

| パラメータ | 説明 | デフォルト値 |
| :--- | :--- | :--- |
| `parallelism` | 議題の同時並列実行最大数 | 3 |
| `max_rejections` | 1議題あたりの差し戻し上限回数。**`[critical]` タグが存在する場合は `[critical]` 項目の FAIL に起因する CRITIQUE スタンスのみをカウントする** | 3 |
| `summary_interval` | 議長が要約を挟む発言数間隔 | 4 |
| `member_count` | 議論に参加するメンバー数 (最低4)。競合案が複数ある場合は **競合案数 + 3** を設定すること (例: 3案 → 6名)。議長は別カウント。 | 4 |
| `max_rounds` | 議論ラウンドの上限 | 5 |
| `convergence_threshold` | 新規論点が出ないラウンド数で早期終了 | 2 |

### チェックリストの `[critical]` タグ

チェックリスト項目の行頭に `[critical]` を付与することで、必達条件と努力目標を区別できる。

```markdown
- [critical] 提案する API は既存の呼び出し規約と後方互換であること
- [critical] セキュリティ上の脆弱性（OWASP Top 10）が導入されないこと
- コード例のスタイルガイドに準拠すること
- 代替アプローチのトレードオフがドキュメント化されていること
```

**`[critical]` セマンティクス（Parliament 版）**:

| レイヤー | 影響 |
| :--- | :--- |
| **Member** | `[critical]` 項目が未達の場合のみ `CRITIQUE` スタンスを使用する。non-critical 項目の懸念は `REVISE` で示す |
| **Chairperson** | `[critical]` 項目が全員 satisfied → AGREED を宣言可能。non-critical の未解決は `residual_risks` に記録 |
| **max_rejections** | `[critical]` 項目への `CRITIQUE` ブロックのみカウント。non-critical への `REVISE` はカウントしない |
| **`[critical]` タグなし** | 従来どおり全項目を均等扱い（後退しない） |

## Chairperson Prompt Template

```markdown
## 議題ID
{topic_id}

## 議題タイトル
{topic_title}

## 承認条件チェックリスト
{checklist}

## サマリー間隔
{summary_interval}

## メンバー数
{member_count}

## 最大ラウンド数
{max_rounds}

## 収束閾値 (新規論点なしで早期終了するラウンド数)
{convergence_threshold}

## 補足コンテキスト
{context}
```

> **`{context}` の用途と制約**: 主にフェーズ引き継ぎペイロード（easy-agent からの委譲情報）が注入される。上限500トークン。コード全文ではなく関連箇所の抜粋のみを含めること。

## Workflow

### Phase 1: 初期化

1. 大目標を独立した「議題」に分割（議題ID: `T001` 形式）
2. 各議題に承認条件チェックリストを作成
   - **重要度タグ**: 合意必達の条件には行頭に `[critical]` を付与する。タグなし項目はベストエフォートとして Chairperson が FAIL しても `unresolved_issues` への記録にとどめ、REJECTED を引き起こさない（ADR-019）。
   - 例: `- [critical] 競合アプローチから1つの設計方針に絞り込まれていること` / `- API ドキュメントのサンプルが含まれていること`
3. 全議題のステータスを `TODO` に設定
4. **ユーザーに議題一覧を提示して承認を求める**

#### Phase 1 スキップ条件

以下の **両方** を満たす場合、Phase 1 を省略して Phase 2 から開始する：

1. **議題一覧が Phase 1 フォーマット準拠**: `{context}` に議題ID・チェックリスト・ステータスを含む議題一覧が存在する
2. **ユーザー承認が取得済み**: 上流エージェントがユーザーに提示し、承認を得ている

> **承認の委譲**: easy-agent の Confirmation Gate でユーザー承認を得た場合、call-parliament の Phase 1 承認は充足される。
> **前提条件**: `{context}` の議題一覧は **全件承認済み** であること。

### Phase 2: 議論の実行

1. キューから最大 `parallelism` 件を取り出し `task` ツールで **同時にバックグラウンド起動**
2. 議題のステータスを `IN_PROGRESS` に更新

#### 収束検出と早期終了

- `convergence_threshold` ラウンド連続で新規論点が登場しなければ収束と判定
- 議長が各ラウンドの要約時に「新規論点の有無」を判定
- **「新規論点」の操作的定義**: 過去ラウンドの要約に含まれない主張・根拠・反論を指す。
- 収束時は `max_rounds` 未達でも合意形成に移行
- `max_rounds` 到達時は現時点の最善案をまとめて提出

> `max_rounds` 到達時の検収基準：対立が残存していても、対立点が明示されていれば検収可。対立の隠蔽のみ REJECTED。

### Phase 3: 個別検収

1. 成果物のチェックリスト各項目を審査し、`[critical]` タグの有無から `is_critical` を判定して記録する。
2. **[critical] 2段階合否判定** (ADR-019):
   - `[critical]` 項目が **全て PASS** → `APPROVED`。non-critical FAIL は `residual_risks` として受理する。
   - `[critical]` 項目が **1つでも FAIL** → `REJECTED`（差し戻し理由に critical 項目のみ明記して再生成）。non-critical FAIL は差し戻し理由に含めない。
3. 差し戻し → 議長が critical 項目を revisit → 再検収
4. 差し戻し `max_rejections` 超過 → フォールバック戦略を実行

> **`[critical]` タグなしのチェックリスト**: 全項目を均等に扱う従来動作にフォールバックする（後退しない）。
> **収束検出・max_rounds 到達による終了時の検収基準 (緩和)**: 合意判定条件を満たしていない場合でも、`unresolved_issues` に対立点が明示されていれば `APPROVED` とする。

#### フォールバック戦略 (max_rejections 到達時)

`max_rejections` に到達した場合：

1. 現時点の最善の合意案を保全
2. 未解決の対立点・チェックリスト未達成項目を要約
3. ユーザーに選択肢を提示：
   - a) 対立する複数案を併記して手動選択
   - b) 要件緩和 (チェックリスト条件の修正)
   - c) Advisory 相談で追加情報を収集後に再議論

### Phase 4: 全体統合

1. 全成果物を集約し矛盾・トレードオフを確認
2. 大目標に対する最終レポートを作成
3. ユーザーに出力

## Constraints

1. オーケストレーター (あなた) は議論に参加しない。管理・検収・統合に徹する。
2. ステータス遷移はオーケストレーターのみ。
3. ローリング方式厳守 (バッチ全完了待ち禁止)。
4. 差し戻し時は具体的な不足ポイントを含める。
5. 収束検出を積極的に行う。同じ論点の繰り返しはトークンの浪費。
6. 議長の要約時に過去の議論ログを「要約+最新発言」に圧縮し、コンテキストウィンドウを管理する。

## Context Window Management (コンテキスト管理)

### 議長への委譲時

1. **コンテキストの最小化**: 議長プロンプトには議題固有の情報のみを含める。
2. **チェックリストは完全に渡す**: 議長がメンバーに正確に伝達できるよう、チェックリストは省略しない。
3. **補足コンテキストの要約**: `{context}` は関連コードの抜粋 (5-20行) と要約のみ。上限500トークン。

### 議論中のコンテキスト爆発防止

1. **要約時のログ切り捨て**: 要約済みラウンドの個別発言は破棄
2. **メンバーへの入力制限**: 各メンバーに渡す「これまでの議論」は要約版のみ
3. **最終報告の簡素化**: オーケストレーターへの報告は 合意案 + チェックリスト検証 + 残存リスクのみ

### ユーザーへの報告

議論の全文ではなく要約を報告する：

```markdown
[ ] 議題 {topic_id}: {title}
合意: {合意内容の1行要約}
残存課題: {あれば1行、なければ「なし」}
```

### トークン予算

| 階層 | 入力上限 | 出力上限 |
| :--- | :--- | :--- |
| オーケストレーター → 議長 | 1,000トークン (context: 500, checklist: 300, topic: 200) | — |
| 議長 → メンバー (各ラウンド) | 700トークン (topic要約: 200, 議論要約: 300, 直前の発言: 200) | 300トークン (stance JSON) |
| 議長 → オーケストレーター | — | 600トークン (chairperson_output.json) |

> **超過時の対応**: 補足コンテキスト (`context`) を段階的に削減: 500 → 300 → 100トークン。それでも超過する場合は `context` を「チェックリスト達成に直結する情報のみ」に絞り込む。議長要約 (`summary_interval` 到達時) は個別発言を破棄し要約のみ保持してメンバーへの入力を 700トークン以内に抑える。

## Verification Criteria (検証基準)

### Phase 3 検証: 個別検収

1. **具体性チェック**: 合意案が抽象的な方針ではなく、実行可能な具体的提案か
2. **[critical] カバーチェック**: `[critical]` 項目が全て PASS か（ADR-019 2段階合否判定）
3. **全員カバーチェック**: チェックリストの全項目に対する回答が含まれているか（non-critical FAIL は `unresolved_issues` に記録）
4. **対立解決チェック**: 残存する対立点が明示されているか（隠蔽されていないか）

### Phase 4 検証: 全体統合

1. 議題間の矛盾チェック
2. 大目標との照合
3. 実行可能性の最終確認

## When NOT to Use (使わない場合)

| 状況 | 代替 |
| :--- | :--- |
| 仕様が確定済みで設計判断が不要 | Hierarchy で直接実装 |
| 明確なベストプラクティスが存在する | 直接実行 |
| 1つの視点だけで判断可能 | Advisory で確認後に実行 |
| ユーザーが既に方針を明示している | 方針に従って Hierarchy で実装 |

---

## 呼び出し元の応答コントラクト (Caller Response Contract)

call-parliament を呼び出したエージェント（通常 easy-agent の Deliberate フェーズ）が、各返却ステータスを受け取った際に取るべきアクションを定義する。返却の単位は **議題ごとの `chairperson_output.status`**（schemas/chairperson_output.json）と、**オーケストレーター集約後の最終状態**（Phase 4 の `grand_synthesis` または Phase 3 のフォールバック発動）の2層に分かれる。

### 議題単位 (Per-topic) の返却ステータス

| ステータス | 意味 | 呼び出し元が取るべきアクション |
| :--- | :--- | :--- |
| `AGREED` | 全メンバーが APPROVE または軽微な REVISE で議論が完了 | `checklist_validation` の **`[critical]` 項目（`is_critical: true`）が全 PASS** であることを確認した上で当該議題を `APPROVED` とし、Phase 4 の集約待ちへ進める。`is_critical: false` の FAIL は `APPROVED` を妨げず `residual_risks` として後続フェーズへ引き継ぐ（ADR-019） |
| `CONVERGED` | `convergence_threshold` 連続で新規論点なし（議論停滞による収束） | `unresolved_issues` に対立点が明示されていることを確認の上 `APPROVED` 扱い。残存リスクは `residual_risks` として後続フェーズへ引き継ぐ。`[critical]` タグを使用していた場合は `is_critical: true` 項目が全 PASS であることを追加確認すること |
| `MAX_ROUNDS` | `max_rounds` 到達で強制終了（部分合意） | 残存課題を明記した最善合意案を採用して `APPROVED` 扱いとし、**ユーザーに残存課題と選択肢（続行 / 要件緩和 / Advisory 追加収集）を通知する**。自動で次フェーズへ進めない |

> **AGREED と CONVERGED の違い**: `AGREED` はチェックリストの `[critical]` 項目を満たした能動的合意。`CONVERGED` は新規論点が枯渇したことによる受動的合意（残存対立を明示した上での「現時点の最善案」）。後者は `unresolved_issues` の有無を必ず確認すること。

### オーケストレーター集約レベルの返却ステータス

| ステータス | 根本原因 | 呼び出し元が取るべきアクション |
| :--- | :--- | :--- |
| 全議題 APPROVED | Phase 3 で全議題がチェックリストを充足し、Phase 4 で `grand_synthesis` が生成された | `Plan` フェーズへ進む。合意案（`final_deliverable` または `deliverable_path`）を Hierarchy への入力として渡す |
| `max_rejections` 超過 | 1つ以上の議題で差し戻し回数が上限を超過（チェックリスト未達のまま） | call-parliament の **フォールバック戦略 (Phase 3)** で提示される選択肢（手動選択 / 要件緩和 / Advisory 追加収集）を **そのままユーザーへ転送** する。ユーザー選択後に再実行、または Phase Gate で STOP |
| 議題 `ERROR` | `topics[].status = ERROR`（議長サブエージェント自体の失敗、ツール不可、致命的内部エラー） | 残存議題の処理を停止し、`error_reason` をユーザーへ報告。**自律的な再試行は行わない**。Advisory 相談または Phase Gate で STOP を選択 |
| `DISPATCH_FAILURE` | `parliament-chairperson` サブエージェントの起動失敗・タイムアウト・`agent` / `task` / `runSubagent` ツール不可 | **Skip-and-Report**: 当該議題を `ERROR (error_reason: "dispatch failure")` 扱いでスキップし、残存議題の処理を継続する。全議題が `DISPATCH_FAILURE` になった場合（= `agent` ツール全体不可）は Phase Gate で STOP（ADR-015）。 |

> **転送原則 (Relay Principle)**: easy-agent は `max_rejections` 超過時に独自の選択肢を作らず、call-parliament が提示した選択肢をそのままユーザーに渡す。これによりサブエージェントのフォールバック戦略とオーケストレーターの応答が矛盾しない（ADR-008 参照）。

> **MAX_ROUNDS と max_rejections 超過の違い**: 前者は「議論ラウンドの時間切れ（合意の質は問えるが議論は完結）」で部分的に進行可能。後者は「検収サイクルの破綻（チェックリスト自体を満たせない）」でユーザー判断必須。前者は自動で APPROVED 扱いに昇格できるが、後者は決して昇格させない。
