-- x-harness Phase 4 Migration
-- DM ログ / コスト料金表 / デデュプリケーション

-- DM ログ
CREATE TABLE IF NOT EXISTS dm_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,
  participant_id TEXT,
  direction TEXT NOT NULL, -- 'sent' | 'received'
  text TEXT,
  dm_event_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dm_logs_participant ON dm_logs(participant_id);
CREATE INDEX IF NOT EXISTS idx_dm_logs_direction ON dm_logs(direction);
CREATE INDEX IF NOT EXISTS idx_dm_logs_created ON dm_logs(created_at);

-- API コスト料金表（リアルタイム料金参照用）
CREATE TABLE IF NOT EXISTS api_cost_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_pattern TEXT UNIQUE NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  cost_usd REAL NOT NULL,
  description TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- デフォルト料金データ投入
INSERT OR IGNORE INTO api_cost_rates (endpoint_pattern, method, cost_usd, description) VALUES
  ('/tweets', 'GET', 0.005, 'ポスト取得'),
  ('/tweets/search/recent', 'GET', 0.005, 'ツイート検索'),
  ('/tweets', 'POST', 0.010, 'ツイート投稿'),
  ('/tweets/:id', 'DELETE', 0.010, 'ツイート削除'),
  ('/users/me', 'GET', 0.010, 'プロフィール取得'),
  ('/users/:id', 'GET', 0.010, 'ユーザー情報取得'),
  ('/users/:id/followers', 'GET', 0.010, 'フォロワー一覧'),
  ('/users/:id/following', 'GET', 0.010, 'フォロー一覧'),
  ('/users/:id/liked_tweets', 'GET', 0.005, 'いいねツイート一覧'),
  ('/tweets/:id/liking_users', 'GET', 0.005, 'いいねユーザー一覧'),
  ('/users/:id/mentions', 'GET', 0.005, 'メンション一覧'),
  ('/users/:id/likes', 'POST', 0.015, 'いいね実行'),
  ('/users/:id/likes/:id', 'DELETE', 0.015, 'いいね解除'),
  ('/users/:id/retweets', 'POST', 0.015, 'リポスト'),
  ('/users/:id/retweets/:id', 'DELETE', 0.015, 'リポスト取消'),
  ('/dm_events', 'GET', 0.010, 'DM一覧取得'),
  ('/dm_conversations', 'GET', 0.010, 'DM会話取得'),
  ('/dm_conversations', 'POST', 0.015, 'DM送信'),
  ('/users/me/bookmarks', 'GET', 0.005, 'ブックマーク取得'),
  ('/users/:id/bookmarks', 'POST', 0.010, 'ブックマーク追加'),
  ('/users/:id/bookmarks/:id', 'DELETE', 0.010, 'ブックマーク削除'),
  ('/trends/personalized', 'GET', 0.005, 'トレンド取得');

-- 24H UTC デデュプリケーション追跡
CREATE TABLE IF NOT EXISTS api_dedup_cache (
  resource_key TEXT PRIMARY KEY,
  first_request_at TEXT NOT NULL,
  request_count INTEGER DEFAULT 1
);
