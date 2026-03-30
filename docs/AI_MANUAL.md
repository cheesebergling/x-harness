# x-harness AI オペレーション・マニュアル

> このドキュメントは **AI エージェント (Claude Code / Antigravity)** が x-harness を操作する際の
> リファレンスです。MCP Server 経由で 21 のツールを使用できます。

---

## 🔧 セットアップ

### 前提条件
- x-harness Worker がデプロイ済み
- MCP Server が設定済み (`settings.json` に登録)
- OAuth 認証が完了している

### 環境変数
| 変数名 | 説明 |
|--------|------|
| `X_HARNESS_URL` | Worker の公開 URL |
| `X_HARNESS_API_KEY` | Worker への認証キー |
| `X_HARNESS_SYNC_DIR` | ローカル同期先ディレクトリ (オプション) |

---

## 🛠️ MCP ツール一覧 (21ツール)

### 🔐 認証 (2)

| ツール | 説明 | 使用場面 |
|--------|------|----------|
| `get_auth_status` | X API の認証状態を確認 | 操作前の事前チェック |
| `get_auth_url` | OAuth 認証 URL を生成 | 初回セットアップ時のみ |

### 📝 ツイート (5)

| ツール | パラメータ | 説明 |
|--------|-----------|------|
| `post_tweet` | `text` | ツイートを即時投稿 |
| `post_thread` | `tweets[]` | 複数ツイートのスレッドを投稿 |
| `delete_tweet` | `tweet_id` | 指定ツイートを削除 |
| `schedule_tweet` | `text`, `scheduled_at` | 予約投稿 (ISO 8601 形式) |
| `get_tweet_analytics` | `tweet_id` | 特定ツイートの分析データ取得 |

### 📊 分析 (3)

| ツール | パラメータ | 説明 |
|--------|-----------|------|
| `get_liking_users` | `tweet_id`, `max_results?` | いいねユーザー一覧 |
| `get_replies` | `tweet_id`, `max_results?` | 返信一覧 |
| `get_followers_trend` | `days?` | フォロワー推移 (デフォルト30日) |

### 📩 DM (3)

| ツール | パラメータ | 説明 |
|--------|-----------|------|
| `get_dm_events` | `max_results?` | DM 一覧取得 |
| `send_dm` | `participant_id`, `text` | DM 送信 (ステルス変換適用) |
| `bulk_send_dm` | `participant_ids[]`, `text` | 一斉 DM (最大50件、ステルスモード) |

### ✍️ ライティングルール (5)

| ツール | パラメータ | 説明 |
|--------|-----------|------|
| `list_writing_rules` | — | 全ルール取得 |
| `get_writing_rule` | `rule_id` | ルール詳細取得 |
| `save_writing_rule` | `name`, `tone?`, `persona?`, ... | ルール作成/更新 |
| `delete_writing_rule` | `rule_id` | ルール削除 |
| `set_default_writing_rule` | `rule_id` | デフォルトルール変更 |

### 🔄 ローカル同期 (3)

| ツール | パラメータ | 説明 |
|--------|-----------|------|
| `configure_sync` | `sync_dir`, `auto_sync_minutes?`, `modules?` | 同期先設定 |
| `sync_now` | `sync_dir?` | 即時同期実行 |
| `get_sync_status` | `sync_dir?` | 同期状態確認 (自動同期トリガー付き) |

---

## 📋 標準ワークフロー

### 1. ツイート投稿ワークフロー

```
1. get_auth_status          → 認証確認
2. list_writing_rules       → デフォルトルールを取得
3. (ルールに基づいてツイート文を生成)
4. post_tweet(text)         → 投稿
5. get_tweet_analytics(id)  → 数時間後にパフォーマンス確認
```

### 2. コンテンツ戦略ワークフロー

```
1. get_followers_trend(days=30)   → フォロワー推移の把握
2. sync_now()                     → 最新データをローカルに同期
3. (ローカルデータを分析して投稿戦略を立案)
4. list_writing_rules             → 現在のルール確認
5. save_writing_rule(...)         → 分析結果に基づきルール最適化
```

### 3. エンゲージメント分析ワークフロー

```
1. get_tweet_analytics(tweet_id)  → 対象ツイートの分析
2. get_liking_users(tweet_id)     → いいねユーザーの属性確認
3. get_replies(tweet_id)          → 返信の内容分析
4. (分析結果を元にフォローアップ戦略)
```

### 4. 予約投稿ワークフロー

```
1. list_writing_rules             → ルール取得
2. (ルールに基づいて1週間分のツイートを生成)
3. schedule_tweet(text, "2026-04-01T09:00:00Z")
4. schedule_tweet(text, "2026-04-02T12:00:00Z")
5. schedule_tweet(text, "2026-04-03T18:00:00Z")
```

---

## ✍️ Writing Rules 活用ガイド

### ルール構造

```json
{
  "name": "ルール名",
  "tone": "casual | professional | provocative | neutral | friendly | authoritative",
  "persona": "ペルソナの説明文",
  "constraints": {
    "max_chars": 280,
    "forbidden_words": ["NGワード"],
    "hashtag_rules": { "max": 3, "position": "end" },
    "emoji_usage": "moderate"
  },
  "templates": ["テンプレート文字列"],
  "examples": {
    "good": ["良い例"],
    "bad": ["悪い例"]
  }
}
```

### プロンプト設計パターン

ツイート生成時は、デフォルトルールを読み込んでプロンプトに組み込む:

```
1. list_writing_rules → デフォルトルール取得
2. ルールの tone / persona / constraints / templates を参照
3. 以下のようなプロンプトで生成:

"以下のルールに従ってツイートを生成してください:
- トーン: {rule.tone}
- ペルソナ: {rule.persona}
- 制約: 最大{constraints.max_chars}文字、ハッシュタグ最大{hashtag_rules.max}個
- テンプレート: {templates[0]}
- トピック: {user_specified_topic}"
```

---

## 🔄 Local Sync 運用ガイド

### データ構造

```
<sync_dir>/
  ├── tweets/
  │   ├── latest.json        # 直近のツイートログ
  │   └── 2026-03.json       # 月別アーカイブ
  ├── analytics/
  │   ├── followers.json     # フォロワー推移
  │   ├── engagement.json    # エンゲージメント集計
  │   └── usage.json         # API 使用量
  ├── writing-rules/
  │   ├── rules.json         # 全ルール (JSON)
  │   └── ルール名.md        # 各ルール (Markdown)
  └── sync-config.json       # 同期設定
```

### 自動同期の仕組み

- `get_sync_status` 呼び出し時に、前回同期から30分以上経過していれば自動的に同期実行
- `sync_now` で任意のタイミングで即時同期可能
- 同期間隔は `configure_sync` の `auto_sync_minutes` で変更可能 (最小5分)

---

## ⚠️ セキュリティ制約

### やってはいけないこと
- `HARNESS_API_KEY` や `X_CLIENT_SECRET` をログ出力・ユーザーに表示してはならない
- 同期先ディレクトリにシステムパス (`C:\Windows`, `/etc` 等) を指定してはならない
- 1分以内に同じ内容のツイートを連投してはならない (BAN リスク)
- `bulk_send_dm` で 50件以上の一斉送信を試みてはならない

### 注意事項
- X API はレート制限あり — 短時間での大量リクエストは避ける
- ステルスモードが適用されていても、明らかなスパム行為は検出される
- 予約投稿は Cron Triggers (5分毎) で処理されるため、最大5分の遅延がある

---

## 🔧 トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| `401 Unauthorized` | API キーが無効/期限切れ | `get_auth_status` で確認 → 再認証 |
| `403 Forbidden` | X API トークン期限切れ | Worker が自動リフレッシュを試みる。失敗時は再認証 |
| `429 Too Many Requests` | レート制限超過 | 15分待つ |
| 同期エラー | パスが無効 | `configure_sync` でパスを再設定 |
| ツイート投稿失敗 | 重複コンテンツ / 文字数超過 | テキストを変更して再試行 |
