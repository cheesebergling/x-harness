# x-harness ユーザーセットアップガイド

> このドキュメントは **非エンジニアユーザー** 向けの x-harness 初回セットアップ &
> 基本操作マニュアルです。

---

## 📋 必要なもの

| 必要なもの | 入手先 | 費用 |
|-----------|--------|------|
| **Node.js** (v18以上) | [nodejs.org](https://nodejs.org/) | 無料 |
| **Cloudflare アカウント** | [cloudflare.com](https://www.cloudflare.com/) | 無料 |
| **X Developer アカウント** | [developer.x.com](https://developer.x.com/) | 従量課金 |
| **Git** | [git-scm.com](https://git-scm.com/) | 無料 |

---

## 🚀 セットアップ手順

### Step 1: リポジトリのダウンロード

ターミナル (PowerShell / コマンドプロンプト) を開いて:

```bash
git clone https://github.com/cheesebergling/x-harness.git
cd x-harness
npm install
```

### Step 2: Cloudflare アカウント作成 & ログイン

1. [cloudflare.com](https://www.cloudflare.com/) でアカウントを作成
2. ターミナルで以下を実行:

```bash
npx wrangler login
```

3. ブラウザが開くので、Cloudflare にログインして「Allow」をクリック

### Step 3: データベース作成

```bash
# D1 データベースを作成
npx wrangler d1 create x-harness-db
```

**表示される `database_id` をメモしてください。** 例:
```
database_id = "48cfb0b9-13a4-4fb7-..."
```

`wrangler.toml` ファイルを開いて、`database_id` の行を書き換えます:
```toml
database_id = "ここにコピーした ID を貼り付け"
```

次にデータベースのテーブルを作成:
```bash
npx wrangler d1 migrations apply x-harness-db --remote
```

確認メッセージが出たら `Y` を入力。

### Step 4: X Developer Portal 設定

> ⚠️ これが最も重要なステップです。

#### 4-1. アプリ作成

1. [developer.x.com](https://developer.x.com/) にログイン
2. **Dashboard** → **「+ Create App」** をクリック
3. **アプリ名**: `x-harness` (任意の名前でOK)
4. **Environment**: `Development`
5. **「Create」** をクリック

#### 4-2. OAuth 2.0 設定

1. 作成したアプリの設定画面を開く
2. **「User authentication settings」** の **「Edit」** をクリック
3. 以下を設定:

| 設定項目 | 値 |
|---------|-----|
| **App permissions** | `Read and write and Direct message` |
| **Type of App** | `Web App, Automated App or Bot` |
| **Callback URI** | `https://x-harness.あなたのサブドメイン.workers.dev/api/auth/callback` |
| **Website URL** | `https://x-harness.あなたのサブドメイン.workers.dev` |

4. **「Save」** をクリック

#### 4-3. キーの確認

アプリ設定の **「Keys and tokens」** タブで以下を確認:
- **Client ID** (OAuth 2.0)
- **Client Secret** (OAuth 2.0)

> 💡 Consumer Keys (API Key/Secret) ではなく、**OAuth 2.0 の Client ID / Client Secret** を使います。

### Step 5: シークレット設定

まず API キーを生成:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

表示される文字列をメモ (これが `HARNESS_API_KEY` になります)。

次にシークレットを設定:
```bash
# 各コマンドで値の入力を求められます
npx wrangler secret put HARNESS_API_KEY
# → 先ほど生成した文字列を入力

npx wrangler secret put X_CLIENT_ID
# → X Developer Portal の Client ID を入力

npx wrangler secret put X_CLIENT_SECRET
# → X Developer Portal の Client Secret を入力

npx wrangler secret put X_CALLBACK_URL
# → https://x-harness.あなたのサブドメイン.workers.dev/api/auth/callback
```

### Step 6: デプロイ

```bash
npm run deploy
```

初回は workers.dev のサブドメイン登録を求められます。好きな名前を入力。

デプロイ成功すると URL が表示されます:
```
https://x-harness.あなたのサブドメイン.workers.dev
```

### Step 7: OAuth 認証 (1回だけ)

1. ブラウザで以下の URL にアクセス:
```
https://x-harness.あなたのサブドメイン.workers.dev/api/auth/authorize
```

2. JSON レスポンスに表示される `authorize_url` をコピー

3. **同じブラウザで** その URL を開く

4. X のログイン画面が表示されたらログイン

5. **「アプリにアクセスを許可」** をクリック

6. 以下のようなメッセージが表示されたら成功:
```json
{ "success": true, "message": "Authorization successful. Tokens stored securely." }
```

---

## 🤖 AI エージェント (MCP) の設定

### Claude Code の場合

```bash
claude mcp add x-harness --type stdio \
  -e X_HARNESS_URL=https://x-harness.あなたのサブドメイン.workers.dev \
  -e X_HARNESS_API_KEY=あなたのHARNESS_API_KEY \
  -- node ./mcp/dist/index.js
```

### Antigravity / VS Code の場合

`settings.json` に以下を追加:
```json
{
  "mcpServers": {
    "x-harness": {
      "command": "node",
      "args": ["x-harnessフォルダへのパス/mcp/dist/index.js"],
      "env": {
        "X_HARNESS_URL": "https://x-harness.あなたのサブドメイン.workers.dev",
        "X_HARNESS_API_KEY": "あなたのHARNESS_API_KEY"
      }
    }
  }
}
```

---

## 🖥️ ダッシュボードの使い方

### 起動

```bash
cd dashboard
npm install
npm run dev
```

ブラウザで `http://localhost:5173` にアクセス。

### ページ説明

| ページ | 機能 |
|--------|------|
| **認証** | X アカウントの接続設定 |
| **ツイート** | ツイートの作成・予約・削除・スレッド投稿 |
| **ブックマーク** | ブックマークの同期・AI 分析 |
| **アナリティクス** | フォロワー推移・エンゲージメント分析 |
| **使用量** | API コスト・使用量の確認 |
| **ライティングルール** | 投稿スタイルの定義・テンプレート管理 |
| **ローカル同期** | データの自動バックアップ設定 |

---

## ❓ よくある質問

### Q: デプロイ時に「R2 を有効化してください」と出た
**A**: `wrangler.toml` の R2 セクションがコメントアウトされているか確認。
メディアアップロード機能を使わない場合はコメントアウトのままで OK。

### Q: OAuth 認証で「Invalid callback URL」と出た
**A**: X Developer Portal の Callback URI が Worker の URL と完全に一致しているか確認。
末尾の `/api/auth/callback` を含めて完全一致が必要です。

### Q: ダッシュボードに接続できない
**A**: ダッシュボードはローカルサーバー (`localhost:5173`) で動作します。
`npm run dev` が動いているか確認してください。

### Q: API コストが心配
**A**: x-harness は従量課金です。使用量ページでリアルタイムにコストを確認できます。
月額 $1.50〜$12 程度が一般的です。

### Q: トークンが期限切れになった
**A**: Worker が自動的にトークンをリフレッシュします。
それでも失敗する場合は、Step 7 の OAuth 認証をもう一度実行してください。
