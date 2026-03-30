<div align="center">

# 🔧 x-harness

**Open-source X (Twitter) API toolkit powered by Cloudflare Workers**

X API 従量課金制対応のサーバーレス SNS 自動化ツール — 5分でデプロイ。

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020?logo=cloudflare)](https://workers.cloudflare.com/)
[![X API v2](https://img.shields.io/badge/API-X%20v2-000000?logo=x)](https://developer.x.com/)

[Getting Started](#-getting-started) · [Features](#-features) · [MCP (Claude / Antigravity)](#-mcp-server) · [API Reference](#-api-reference)

</div>

---

## ✨ Features

| Feature | Description |
| ------- | ----------- |
| 📝 **Tweet Management** | Create, delete, and manage tweets via API |
| 🧵 **Thread Creation** | Post multi-tweet threads in a single call |
| ⏰ **Scheduled Posting** | Cron Triggers (5分毎) で予約投稿を自動実行 |
| 📊 **Analytics** | Track impressions, engagement rate, and follower trends |
| ❤️ **いいね・返信取得** | 投稿ID指定でいいねユーザー・返信を取得 |
| 📩 **DM 管理** | DM取得 / 送信 / ステルス一斉送信 (BAN回避) |
| 🔐 **OAuth 2.0 PKCE** | トークン非露出 + Refresh Token Rotation |
| 🥷 **Stealth Mode** | ゴースト文字 + 文末変更 + ランダム遅延でBAN回避 |
| ✍️ **Writing Rules** | ライティングルール定義 — トーン・ペルソナ・テンプレートを保存 |
| 🔄 **Local Sync** | Syncthing 式ローカル同期 — 投稿・分析データをローカルに自動保存 |
| 🤖 **MCP Server** | Claude Code / Antigravity / VS Code から直接操作 (21ツール) |
| 💰 **API コスト管理** | エンドポイント単位の精密料金トラッキング + Discord通知 |
| 💰 **Pay-per-use** | Cloudflare 無料インフラ + X API 従量課金 |
| 🛡️ **Security** | Timing-safe 認証 + パストラバーサル防止 + 入力検証 |

## 🏗️ Architecture

```text
┌─────────────────────────────────────────────────────┐
│         Cloudflare Workers (無料枠)                   │
│  https://x-harness.YOUR_SUB.workers.dev              │
│                                                       │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────┐  │
│  │ OAuth   │  │ X API    │  │ Cron     │  │ D1   │  │
│  │ PKCE    │  │ Proxy    │  │ Triggers │  │ (DB) │  │
│  └─────────┘  └──────────┘  └──────────┘  └──────┘  │
│         ↑ HARNESS_API_KEY (Bearer Token)              │
└─────────┼─────────────────────────────────────────────┘
          │ HTTPS
┌─────────▼──────────────────────────────────────┐
│  ローカル環境                                    │
│                                                  │
│  ┌──────────────┐  ┌───────────┐  ┌──────────┐  │
│  │ MCP Server   │  │ Local     │  │ CLI      │  │
│  │ (Claude Code │  │ Sync Dir  │  │ (curl)   │  │
│  │  Antigravity │  │ ┌tweets/  │  │          │  │
│  │  VS Code)    │  │ ├analytics│  │          │  │
│  │  21 tools    │  │ └rules/   │  │          │  │
│  └──────────────┘  └───────────┘  └──────────┘  │
└──────────────────────────────────────────────────┘
```

> **セキュリティ**: X API トークンは Workers の D1 に保存されローカルには降りてきません。
> ローカルからは `HARNESS_API_KEY` で Worker に接続し、Worker が内部でトークンを自動解決します。
> API キー認証は timing-safe comparison でタイミング攻撃を防止しています。

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) v4+
- [X Developer Account](https://developer.x.com/) (Pay-per-use クレジット制)
- Cloudflare アカウント (無料枠で OK)

### Step 1. Clone & Install

```bash
git clone https://github.com/cheesebergling/x-harness.git
cd x-harness
npm install
```

### Step 2. 環境変数設定

```bash
# テンプレートをコピー
cp .dev.vars.example .dev.vars

# .dev.vars を編集して各値を設定
# 安全な API キー生成:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 3. Cloudflare リソース作成

```bash
# Cloudflare にログイン
wrangler login

# D1 データベース作成
wrangler d1 create x-harness-db
# → 出力される database_id を wrangler.toml に設定

# マイグレーション実行（リモート）
wrangler d1 migrations apply x-harness-db --remote
```

### Step 4. X Developer Portal 設定

1. [developer.x.com](https://developer.x.com/en/portal/dashboard) でアプリ作成
2. **User authentication settings** → OAuth 2.0 を有効化
3. **Type of App** → `Web App`
4. **Callback URI** → `https://x-harness.YOUR_SUB.workers.dev/api/auth/callback`
5. **全スコープ有効化**: `tweet.read/write`, `users.read`, `dm.read/write`, `like.read/write`, `follows.read/write`, `bookmark.read/write`, `offline.access`

### Step 5. シークレット設定 & デプロイ

```bash
# シークレットを設定
wrangler secret put HARNESS_API_KEY       # 任意の安全な文字列
wrangler secret put X_CLIENT_ID           # X Developer Portal から
wrangler secret put X_CLIENT_SECRET       # X Developer Portal から
wrangler secret put X_CALLBACK_URL        # https://x-harness.YOUR_SUB.workers.dev/api/auth/callback

# デプロイ
npm run deploy
```

### Step 6. OAuth 認証（1回だけ）

```bash
# 認証URLを取得
curl -H "Authorization: Bearer YOUR_HARNESS_API_KEY" \
  https://x-harness.YOUR_SUB.workers.dev/api/auth/authorize

# → 返されたURLをブラウザで開いて X アカウントを認可
# → callback で自動的にトークンが D1 に保存される
```

### Step 7. 動作確認

```bash
# 認証状態を確認
curl -H "Authorization: Bearer YOUR_HARNESS_API_KEY" \
  https://x-harness.YOUR_SUB.workers.dev/api/auth/status
```

---

## 🤖 MCP Server

Claude Code / Antigravity / VS Code から x-harness を直接操作できます。

### セットアップ

```bash
cd mcp
npm install
npm run build
```

### Claude Code に登録

```bash
claude mcp add x-harness --type stdio \
  -e X_HARNESS_URL=https://x-harness.YOUR_SUB.workers.dev \
  -e X_HARNESS_API_KEY=YOUR_HARNESS_API_KEY \
  -e X_HARNESS_SYNC_DIR=/path/to/your/sync/dir \
  -- node ./mcp/dist/index.js
```

### Antigravity / VS Code MCP 設定

`settings.json` に追加:
```json
{
  "mcpServers": {
    "x-harness": {
      "command": "node",
      "args": ["./mcp/dist/index.js"],
      "env": {
        "X_HARNESS_URL": "https://x-harness.YOUR_SUB.workers.dev",
        "X_HARNESS_API_KEY": "YOUR_HARNESS_API_KEY",
        "X_HARNESS_SYNC_DIR": "C:\\Users\\YOU\\x-harness-data"
      }
    }
  }
}
```

> **Note**: `args` のパスはリポジトリのクローン先に合わせて絶対パスに変更してください。
> 例: `["C:\\path\\to\\x-harness\\mcp\\dist\\index.js"]`

### 利用可能なツール (21種)

#### 📝 Tweet (5)

| ツール | 説明 |
| ------ | ---- |
| `post_tweet` | ツイート投稿 |
| `post_thread` | スレッド投稿 |
| `delete_tweet` | ツイート削除 |
| `schedule_tweet` | 予約投稿 |
| `get_tweet_analytics` | ツイート分析 |

#### 📊 Analytics (3)

| ツール | 説明 |
| ------ | ---- |
| `get_liking_users` | いいねユーザー取得 |
| `get_replies` | 返信取得 |
| `get_followers_trend` | フォロワー推移 |

#### 📩 DM (3)

| ツール | 説明 |
| ------ | ---- |
| `get_dm_events` | DM一覧取得 |
| `send_dm` | DM送信 (ステルス) |
| `bulk_send_dm` | DM一斉送信 (ステルス) |

#### ✍️ Writing Rules (5)

| ツール | 説明 |
| ------ | ---- |
| `list_writing_rules` | ルール一覧取得 |
| `get_writing_rule` | ルール詳細取得 |
| `save_writing_rule` | ルール作成/更新 |
| `delete_writing_rule` | ルール削除 |
| `set_default_writing_rule` | デフォルトルール設定 |

#### 🔄 Local Sync (3)

| ツール | 説明 |
| ------ | ---- |
| `configure_sync` | 同期先フォルダ設定 |
| `sync_now` | 即時同期実行 |
| `get_sync_status` | 同期状態確認 (自動同期トリガー付き) |

#### 🔐 Auth & Usage (3)

| ツール | 説明 |
| ------ | ---- |
| `get_auth_status` | 認証状態確認 |
| `get_auth_url` | OAuth 認証URL取得 |
| `get_usage_summary` | API使用量確認 |

---

## 🔄 Local Sync

Syncthing のように、Worker上の投稿・分析データをローカルフォルダに自動同期します。

### フォルダ構造

```
<sync_dir>/
  ├── tweets/                # ツイートログ
  │   ├── 2026-03.json       # 月別アーカイブ
  │   └── latest.json        # 直近データ
  ├── analytics/
  │   ├── followers.json     # フォロワー推移
  │   ├── engagement.json    # エンゲージメント集計
  │   └── usage.json         # API使用量
  ├── writing-rules/
  │   ├── rules.json         # 全ルール (JSON)
  │   └── X投稿_標準.md      # 各ルールの Markdown
  └── sync-config.json       # 同期設定
```

### MCP から使う

```
# 1. 同期先を設定
configure_sync(sync_dir="/path/to/data", auto_sync_minutes=30)

# 2. 即時同期
sync_now()

# 3. 状態確認（30分経過していれば自動同期も実行）
get_sync_status()
```

---

## ✍️ Writing Rules

X 投稿のライティングスタイルを定義・保存・管理できます。

```json
{
  "name": "X投稿・カジュアル",
  "tone": "casual",
  "persona": "30代マーケター目線。フォロワーとの距離感を大切に。",
  "constraints": {
    "max_chars": 280,
    "forbidden_words": ["PR", "案件"],
    "hashtag_rules": { "max": 3, "position": "end" },
    "emoji_usage": "moderate"
  },
  "templates": [
    "【{{topic}}】\n{{body}}\n\n{{cta}}",
    "{{hook}}\n\n→ {{body}}\n\n#{{tag1}} #{{tag2}}"
  ],
  "examples": {
    "good": ["短い文で要点を伝え、最後にCTAを入れる"],
    "bad": ["長すぎる文章、ハッシュタグの乱用"]
  }
}
```

---

## 📡 API Reference

全エンドポイントは `Authorization: Bearer <HARNESS_API_KEY>` が必要です。

### Authentication

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/api/auth/authorize` | OAuth 2.0 認証URLを取得 |
| `GET` | `/api/auth/callback` | OAuth コールバック (認証不要) |
| `POST` | `/api/auth/refresh` | トークンリフレッシュ |
| `GET` | `/api/auth/status` | 認証状態確認 |

### Tweets

| Method | Endpoint | Description | コスト |
| ------ | -------- | ----------- | ------ |
| `POST` | `/api/tweets` | ツイート投稿 | $0.010 |
| `POST` | `/api/tweets/thread` | スレッド投稿 | $0.010×N |
| `DELETE` | `/api/tweets/:id` | ツイート削除 | $0.010 |
| `GET` | `/api/tweets/user/:userId` | ツイート一覧 | $0.005 |
| `POST` | `/api/tweets/schedule` | 予約投稿 | — |
| `POST` | `/api/tweets/schedule-action` | 予約アクション | — |

### Analytics

| Method | Endpoint | Description | コスト |
| ------ | -------- | ----------- | ------ |
| `GET` | `/api/analytics/tweets/:id` | ツイート分析 | $0.005 |
| `GET` | `/api/analytics/tweets/:id/liking-users` | いいねユーザー (投稿ID指定) | $0.005 |
| `GET` | `/api/analytics/tweets/:id/replies` | 返信取得 (投稿ID指定) | $0.005 |
| `GET` | `/api/analytics/users/:id/liked-tweets` | いいね一覧 | $0.005 |
| `POST` | `/api/analytics/followers/snapshot` | フォロワー記録 | $0.010 |
| `GET` | `/api/analytics/followers/trend` | フォロワー推移 | — |

### Writing Rules

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/api/writing-rules` | 全ルール取得 |
| `GET` | `/api/writing-rules/:id` | 個別取得 |
| `POST` | `/api/writing-rules` | 新規作成 |
| `PUT` | `/api/writing-rules/:id` | 更新 |
| `DELETE` | `/api/writing-rules/:id` | 削除 |
| `PUT` | `/api/writing-rules/:id/default` | デフォルト設定 |

### Sync

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/api/sync/export` | 一括エクスポート (`?since=ISO8601&modules=...`) |
| `GET` | `/api/sync/status` | 同期ステータス |

### Direct Messages

| Method | Endpoint | Description | コスト |
| ------ | -------- | ----------- | ------ |
| `GET` | `/api/dm/events` | 全DM取得 | $0.010 |
| `GET` | `/api/dm/conversations/:participantId` | 1対1 DM取得 | $0.010 |
| `POST` | `/api/dm/send/:participantId` | DM送信 (ステルス) | $0.015 |
| `POST` | `/api/dm/bulk-send` | 一斉送信 (最大50件) | $0.015×N |

### Usage & Cost

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/api/usage/summary` | API使用量サマリー |
| `GET` | `/api/usage/daily` | 日別使用量 |
| `GET` | `/api/usage/by-endpoint` | エンドポイント別 |

---

## 🛡️ Security

| 対策 | 詳細 |
| ---- | ---- |
| **Timing-safe auth** | API キー比較にタイミング攻撃耐性のある定数時間比較を使用 |
| **トークン非露出** | X API トークンは D1 に格納、ローカルには降りない |
| **入力検証** | 全 API エンドポイントで型・長さ・形式をバリデーション |
| **HTML サニタイズ** | Writing Rules の保存時に HTML タグを除去 (XSS 防止) |
| **JSON 検証** | 構造化データの保存前に JSON パース検証 |
| **パストラバーサル防止** | Local Sync でファイルパスを正規化 + ベースディレクトリチェック |
| **シンボリックリンク検出** | 同期先のシンボリックリンク攻撃を検出・拒否 |
| **システムディレクトリ保護** | Windows/Linux のシステムパスへの同期を禁止 |
| **ファイルサイズ制限** | 同期ファイルの最大サイズを 10MB に制限 |
| **パラメータバインド** | 全 SQL クエリでパラメータバインドを使用 (SQLi 防止) |

---

## 💰 API 料金試算 (Pay-per-use)

| シナリオ | 日次操作内訳 | 月額概算 |
| -------- | ------------ | -------- |
| **ミニマル** | 投稿×3 + プロフィール×1 + フォロワー×1 | **~$1.50** |
| **標準** | 投稿×5 + 取得×20 + DM確認×5 + いいね×10 | **~$12.00** |
| **ヘビー** | 投稿×20 + 取得×100 + DM×20 + いいね×50 + 検索×30 | **~$60.00** |

> 24時間UTCデデュプリケーション: 同一リソースへの重複リクエストは1回分の課金

---

## 🛠️ Tech Stack

- **Runtime**: [Cloudflare Workers](https://workers.cloudflare.com/) (Hono v4)
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite)
- **Storage**: [Cloudflare R2](https://developers.cloudflare.com/r2/) (Media)
- **Cron**: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) (5分毎)
- **MCP**: [@modelcontextprotocol/sdk](https://npmjs.com/package/@modelcontextprotocol/sdk) (Claude Code / Antigravity)
- **Language**: TypeScript

## 📄 License

This project is licensed under the MIT License.

---

<div align="center">

**Built with ❤️ by the x-harness community**

[⭐ Star on GitHub](https://github.com/cheesebergling/x-harness) · [🐛 Report Bug](https://github.com/cheesebergling/x-harness/issues) · [💡 Request Feature](https://github.com/cheesebergling/x-harness/issues)

</div>
