# Advisor Prompt Template - 具体例

各エージェントの `prompt` フィールドは `call-advisor/SKILL.md` の Prompt Template セクションに従い、
本ファイルはプロンプト構築の具体例を蓄積します。

## 具体例

### 例 1: 実作業開始前の前提確認 (concise)

```xml
<task_summary>
ユーザー認証 API を OAuth2 から OIDC に移行する。既存の REST エンドポイント (/api/auth/*) は後方互換を維持する。
</task_summary>

<current_state>
- 既存実装は Spring Security の OAuth2 実装 (3ファイル: client.ts, middleware.ts, routes.ts)
- src/config/auth.ts に環境変数ベースの設定
- 既存テスト src/_tests_/auth/* は12件、全パス
- DB に refresh_token テーブルあり (users.id と FK)
</current_state>

<actions_taken>
- ソースコード変換完了 (auth モジュール全体 + 依存箇所3ファイル)
- OIDC ライブラリ新規導入2つ検証 (openid-client, oidc-provider)
- 既存テストの網羅範囲を確認
</actions_taken>

<consultation_reason>
実作業開始前。移行戦略の妥当性を確認したい。
</consultation_reason>

<question>
段階的移行 (OAuth2 と OIDC を並行稼働) と一括切替のどちらが適正か？ refresh_token テーブルのスキーマ変更は必要か？
</question>

<response_style>
100語以内で、説明ではなく番号付きステップで回答してください。
</response_style>
```

### 例 2: 行き詰まり時の相談 (detailed)

```xml
<task_summary>
バッチ処理のパフォーマンス改善。現在の処理時間 45分 を 10分 以内に。
</task_summary>

<current_state>
- BatchProcessor.java の processAll() が N+1 クエリを発生させている
- メモリ上でバルク処理を試みたが、N+1 は解消されていない
- DB は PostgreSQL 14。インデックスは user_id のみ
</current_state>

<actions_taken>
- IN 句によるバルク取得に変更 -> SQL エラー 'too many parameters'
- JPA の @BatchSize アノテーション追加 -> 変化なし
</actions_taken>

<consultation_reason>
N+1 問題の解決アプローチとして、他に近いような選択肢があるか？ 現在のアプローチの何が間違っているか？
</consultation_reason>

<question>
詳細な分析と性能値を含めて回答してください。
</question>

<response_style>
日本語で、可能な限り完全な回答をしてください。
</response_style>
```

### 例 3: 完了確認の相談 (concise)

```xml
<task_summary>
ログイン画面に「パスワードを忘れた」リンクを追加。メール送信機能を統合。
</task_summary>

<current_state>
- loginForm.tsx にリンクを追加済み
- /forgot-password ルートとページコンポーネント作成済み
- メール送信 API (POST /api/auth/forgot-password) 実装済み
- 既存テスト全パス、新規テスト3件追加
</current_state>

<actions_taken>
1. UI 実装 (リンク + フォーム + バリデーション)
2. API 実装 (トークン生成 + メール送信)
3. テスト完了 (UI 2件 + API 1件)
</actions_taken>

<consultation_reason>
タスク完了と判断した。見落としがないか最終確認したい。
</consultation_reason>

<question>
セキュリティ観点（レート制限、トークン有効期限）で不足はないか？
</question>

<response_style>
100語以内で、説明ではなく番号付きステップで回答してください。
</response_style>
```

### 例 4: スコア最大拡張時の on-demand 相談 (concise)

```xml
<task_summary>
検索エンジンのキャッシュシステムを改善する。目標: 平均 200ms 以下。
</task_summary>

<current_state>
- 現在の検索システムは3つのマイクロサービス (search-api, indexer, query-engine) にまたがることが判明
- search-api のクエリ変換部分だけでは目標達成不可能（現在: 平均 850ms）
- indexer のインデックス再構築と query-engine のキャッシュ層追加が必要と推定
- 変更ファイル数は推定 18ファイル以上、3サービスにまたがる
</current_state>

<actions_taken>
- search-api のプロファイリング実施 (N+1 クエリ特定)
- indexer の クエリ engine のコード把握完了
- 各サービスの変更範囲を見積もり
</actions_taken>

<consultation_reason>
スコープ肥大化。当初は search-api の単一サービス修正と見積もっていたが、3サービスにまたがる並列実作業が必要と判断。
</consultation_reason>

<question>
この継続の実装は Hierarchy にエスカレーションすべきか？ それとも逐次的に自力で実装可能か？
</question>

<response_style>
100語以内で、説明ではなく番号付きステップで回答してください。
</response_style>
```

### 例 5: Phase Gate 相談 (Explore->Plan 遷移時)

```xml
<task_summary>
決済モジュールのエラーハンドリングを改善する。タイムアウト時のリトライ戦略を導入する。
</task_summary>

<current_state>
- Explore フェーズ完了。PaymentService.java, RetryConfig.java, PaymentGatewayClient.java を調査
- 既存のリトライ実装は単純な for ループ、リトライなし
- 外部決済 API は 冪等性キーをサポート
- 開発テスト 8件、カバレッジ 62%
</current_state>

<actions_taken>
- 決済モジュール全体のコード把握完了
- 共通 API の 冪等性サポートを確認
- 既存エラーハンドリングパターンを分析
</actions_taken>

<consultation_reason>
フェーズ遷移。Explore->Plan への遷移で、リトライ戦略の設計判断が必要。
</consultation_reason>

<phase_context>
<current_phase>explore</current_phase>
<next_phase>plan</next_phase>
<task_type>hybrid</task_type>
<transition_reason>リトライ戦略に Exponential Backoff / Circuit Breaker / 固定リトライの3つの選択肢があり、設計判断が必要</transition_reason>
<consult_budget_remaining>2</consult_budget_remaining>
</phase_context>

<question>
冪等性が保証されている前提で、Exponential Backoff with Jitter と Circuit Breaker のどちらが適正か？ 両方を組み合わせるべきか？
</question>

<response_style>
100語以内で、説明ではなく番号付きステップで回答してください。
</response_style>
```
