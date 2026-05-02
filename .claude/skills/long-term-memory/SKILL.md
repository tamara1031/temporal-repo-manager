---
name: long-term-memory
description: >-
  Vector DB ベースの長期記憶管理スキル。知識の保存（自動分解）・検索・更新・削除を提供。
  ChromaDB を Docker で自動起動し、ナレッジをベクトル検索可能な形式で永続化する。
  Use when ユーザーが「覚えておいて」「後で思い出せるようにして」「この知識を保存して」
  「記憶を検索して」「保存した情報を更新/削除して」と言った場合。
user-invocable: true
tools: [execute]
---

ChromaDB (Docker) を利用したベクトル検索ベースの長期記憶管理スキルです。

## 前提条件

- Docker が起動していること (Docker Desktop / Docker Engine / Colima)
- Python 3.10+

ChromaDB コンテナは初回実行時に自動的に起動されます (`restart: unless-stopped`)。
`chromadb` Python パッケージも初回に自動インストールされます。

---

## Decision Protocol (判断基準)

### いつ検索すべきか

以下のいずれかに該当する場合、**まず `memory_search.py` で記憶を確認**すること：

- ユーザーが過去の文脈を前提とした質問をしている
- 「前に話した」「以前の」「覚えてる？」等の表現がある
- プロジェクト固有の知識・設定・規約に関する質問
- ユーザーの好み・パターンに関する判断が必要な場合

### いつ保存すべきか

以下のいずれかに該当する場合、**ユーザーに確認の上保存**すること：

- ユーザーが「覚えておいて」「保存して」と明示的に依頼
- 繰り返し参照される可能性の高いファクト・ルール・手順が出現
- プロジェクト固有の設定・規約・制約が判明した
- ユーザーの好み・コーディングスタイルが確認された

### いつ更新/削除すべきか

- 既存の記憶が古くなった・間違っていた → **更新** (search → update)
- ユーザーが「忘れて」「削除して」と依頼 → **削除** (search → delete)

---

## Score Interpretation (スコア解釈)

検索結果の `score` は cosine similarity (0.0 〜 1.0) :

| スコア範囲 | 解釈 | アクション |
| :--- | :--- | :--- |
| ≥ 0.85 | 非常に高い一致 (ほぼ同一) | そのまま回答に使用 |
| 0.60 - 0.84 | 関連性が高い | 回答に活用、必要に応じて補足 |
| 0.35 - 0.59 | 部分的に関連 | 参考程度、ユーザーに確認推奨 |
| < 0.35 | 関連性が低い | 無視して良い |

---

## Operations

### 1. Save (保存)

入力データをナレッジ単位に分解し、ベクトル DB に保存します。

#### 重要：ナレッジ分解ルール

ユーザーの入力を保存する際は、**必ず以下の手順でナレッジ単位に分解**してから保存すること。

1. ユーザーの入力を分析する
2. 独立した知識単位 (ファクト、ルール、手順、パターン等) に分解する
3. 各単位を `--items` で JSON 配列として渡す

**分解の指針**:

- **1ファクト = 1ナレッジ単位** (複数の事実を1つに混ぜない)
- 手順は個別のステップに分割
- 条件・ルール・例外は個別に分割
- 各単位は**単独で意味が通じる**ようにする (文脈情報を含める)
- タグは関連ドメイン・カテゴリを付与する (後述のタグ体系を参照)

**分解の例**:

入力：「ChromaDB はデフォルトでポート 8000 を使い、cosine 距離でベクトル検索する。Docker で簡単に起動でき、REST API を提供する。」

分解結果：

```json
[
  {"text": "ChromaDB のデフォルトポートは 8000", "tags": ["chromadb", "config"]},
  {"text": "ChromaDB はデフォルトで cosine 距離を使用してベクトル検索を行う", "tags": ["chromadb", "embedding"]},
  {"text": "ChromaDB は Docker で起動でき REST API を提供する", "tags": ["chromadb", "deployment"]}
]
```

#### LLM 分解による保存 (推奨)

```bash
python skills/long-term-memory/scripts/memory_save.py \
  --items '[
    {"text": "ChromaDB のデフォルトポートは 8000", "tags": ["chromadb", "config"]},
    {"text": "ChromaDB は cosine 距離をデフォルトで使用する", "tags": ["chromadb", "embedding"]}
  ]' \
  --source "ユーザー入力"
```

#### 重複検出付き保存 (推奨)

`--dedup` を付けると、保存前に類似度チェックを行い重複を自動スキップします：

```bash
python skills/long-term-memory/scripts/memory_save.py \
  --items '[{"text": "...", "tags": ["..."]}]' \
  --dedup \
  --dedup-threshold 0.90
```

- 閾値 (デフォルト 0.90) 以上の類似度を持つ既存記憶がある場合スキップ
- **常に `--dedup` を付けることを推奨** (記憶の肥大化を防止)

#### テキスト自動分解 (簡易)

```bash
python skills/long-term-memory/scripts/memory_save.py \
  --text "ここに保存したいテキスト" \
  --tags "tag1,tag2" \
  --source "会話" \
  --dedup
```

#### ファイルから保存

```bash
python skills/long-term-memory/scripts/memory_save.py \
  --file /path/to/notes.md \
  --tags "notes" \
  --source "file:notes.md" \
  --dedup
```

### 2. Search (検索)

自然言語クエリでベクトル類似検索を行います。

```bash
python skills/long-term-memory/scripts/memory_search.py \
  --query "ChromaDB の設定方法" \
  --n-results 5
```

タグフィルタ付き：

```bash
python skills/long-term-memory/scripts/memory_search.py \
  --query "デプロイ手順" \
  --tags "deployment" \
  --n-results 10
```

JSON 出力 (プログラム的に処理する場合) :

```bash
python skills/long-term-memory/scripts/memory_search.py \
  --query "エラーハンドリング" \
  --json
```

#### 統計情報

```bash
# 全レコード数
python skills/long-term-memory/scripts/memory_search.py --count

# タグ一覧と使用頻度
python skills/long-term-memory/scripts/memory_search.py --list-tags
```

### 3. Update (更新)

ID を指定して既存のナレッジを更新します。まず Search で対象を特定してから実行します。

```bash
# テキスト更新
python skills/long-term-memory/scripts/memory_update.py \
  --id "uuid-of-memory" \
  --text "更新後のテキスト"

# タグのみ更新
python skills/long-term-memory/scripts/memory_update.py \
  --id "uuid-of-memory" \
  --tags "new-tag1,new-tag2"

# すべて更新
python skills/long-term-memory/scripts/memory_update.py \
  --id "uuid-of-memory" \
  --text "新しいテキスト" \
  --tags "tag1,tag2" \
  --source "updated-source"
```

### 4. Delete (削除)

ID またはタグを指定して削除します。

```bash
# 単一削除
python skills/long-term-memory/scripts/memory_delete.py \
  --id "uuid-of-memory"

# 複数削除
python skills/long-term-memory/scripts/memory_delete.py \
  --ids "uuid-1,uuid-2,uuid-3"

# タグ一括削除 (まず確認、次に --confirm で実行)
python skills/long-term-memory/scripts/memory_delete.py \
  --tag "obsolete"

python skills/long-term-memory/scripts/memory_delete.py \
  --tag "obsolete" --confirm
```

---

## Tag Taxonomy (タグ体系)

一貫したタグ付けにより検索精度が向上します。以下の体系を推奨：

| カテゴリ | タグ例 | 用途 |
| :--- | :--- | :--- |
| ドメイン | `java`, `python`, `docker`, `k8s` | 技術領域 |
| タスク | `config`, `debug`, `deploy`, `test` | 作業種別 |
| ソース | `user-pref`, `project-rule`, `lesson` | 知識の出自 |
| プロジェクト | `bridge`, `my-copilot` | 対象プロジェクト |
| 種別 | `fact`, `rule`, `pattern`, `procedure` | 知識の性質 |

### easy-agent Auto-Memory タグ (easy-agent の Auto-Memory Protocol が使用する予約タグ)

easy-agent の `long-term-memory` 自動保存プロトコルでは、以下のタグを使用します。他のタグと組み合わせて付与すること。

| タグ | 発火タイミング | 意味 |
| :--- | :--- | :--- |
| `user` | ユーザーの役割・専門性・ドメインが初めて言及されたとき | ユーザーの現在の役割・スキルレベル・経験事実 |
| `user-pref` | ユーザーの行動傾向・好み・将来の意向が確認されたとき | プロジェクト成果物に紐付かない個人の傾向 |
| `feedback` | Phase Gate で APPROVED かつ明示的フィードバックがあったとき | エージェントの行動選択に対する是認・訂正ルール |
| `rule` | `feedback` と同時に付与 | ルール化すべき判断基準 (Why→How to apply 形式で記述) |
| `project` | Phase Gate で APPROVED かつプロジェクト状態が変化したとき | 変更対象ファイル・フェーズ状態・主要成果物の変化記録 |
| `project-rule` | `project` と同時に付与 | プロジェクト固有の規約・制約 |
| `reference` | 外部システムの URL・ボード・チャンネルが言及されたとき | 参照先リンク・外部リソース |

**タグ命名規則**:

- 小文字のみ、英数字とハイフンのみ使用
- 一般的な技術用語は英語で統一
- 2〜3 個のタグが目安 (多すぎると検索ノイズになる)

---

## Recommended Workflow

### 保存時 (Save Flow)

1. ユーザーの入力を分析
2. 独立した知識単位に分解 (1 ファクト = 1 単位)
3. タグ体系に沿ったタグとソースを付与
4. `memory_save.py --items --dedup` で重複チェック付き保存
5. 保存結果 (ID 一覧・スキップ一覧) をユーザーに提示

### 検索時 (Search Flow)

1. ユーザーの質問からキーワード/意図を抽出
2. `memory_search.py --query` で類似検索
3. score >= 0.60 の結果をユーザーに提示
4. 必要に応じてタグフィルタで絞り込み

### プロアクティブリコール (Proactive Recall)

ユーザーが記憶を明示的に要求していなくても、以下の場合は**先に検索**すること：

```
IF ユーザーの質問がドメイン固有 THEN
  memory_search.py --query "<質問のキーワード>"
  IF score >= 0.60 の結果あり THEN
    結果を踏まえて回答
  END
END
```

### 更新時 (Update Flow)

1. `memory_search.py` で対象を特定
2. ID を確認
3. `memory_update.py --id` で更新

### 削除時 (Delete Flow)

1. `memory_search.py` で対象を特定
2. ID を確認してから `memory_delete.py --id` で削除
3. タグ一括削除は `--tag` + `--confirm` の 2 ステップ

### 記憶の健全性チェック (定期メンテナンス)

```bash
# まず全体像を把握
python skills/long-term-memory/scripts/memory_search.py --count
python skills/long-term-memory/scripts/memory_search.py --list-tags

# 不要なタグの記憶を確認・削除
python skills/long-term-memory/scripts/memory_delete.py --tag "obsolete"
```

---

## Infrastructure

| 項目 | 値 |
| :--- | :--- |
| Vector DB | ChromaDB 0.6.3 (Docker) |
| Container | `copilot-memory-chromadb` |
| Port | `18000` |
| Volume | `~/.local/share/copilot-memory/chroma-data` |
| Embedding | all-MiniLM-L6-v2 (chromadb client-side, ONNX) |
| Distance | cosine |
| Collection | `long_term_memory` |
| Health Check | `/api/v2/heartbeat` (fallback: `/api/v1/heartbeat`) |

## Notes

- 初回実行時に `chromadb` Python パッケージを自動インストール (エンベディング計算用、`onnxruntime` 含む)
- エンベディングモデル (all-MiniLM-L6-v2) は初回実行時に自動ダウンロード (`~/.cache/chroma/`)
- ボリュームはシステム共通パス (`~/.local/share/copilot-memory/`) で永続化 — ワークスペースが変わっても同じ DB を使用
- コンテナは `restart: unless-stopped` + `healthcheck` により Docker 再起動後も自動復帰
- タグはメタデータとして保存され、検索・削除時にフィルタとして使用可能
- テキスト自動分解は段落・文単位で動作。精密な分解には `--items` で LLM 分解を推奨
- `--dedup` オプションで保存前の重複チェックが可能 (デフォルト閾値 0.90)
