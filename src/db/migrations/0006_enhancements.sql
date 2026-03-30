-- x-harness Enhancement Migration
-- スレッド予約 + 拡張メトリクス + DMテンプレート + DM自動応答

-- スレッド予約カラム
ALTER TABLE scheduled_tweets ADD COLUMN thread_tweets TEXT;

-- 拡張メトリクス（tweet_logs）
ALTER TABLE tweet_logs ADD COLUMN quotes INTEGER DEFAULT 0;
ALTER TABLE tweet_logs ADD COLUMN bookmarks INTEGER DEFAULT 0;
ALTER TABLE tweet_logs ADD COLUMN url_clicks INTEGER DEFAULT 0;
ALTER TABLE tweet_logs ADD COLUMN profile_clicks INTEGER DEFAULT 0;

-- DMテンプレート
CREATE TABLE IF NOT EXISTS dm_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  text TEXT NOT NULL,
  variables TEXT DEFAULT '[]',
  use_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- DM自動応答ルール
CREATE TABLE IF NOT EXISTS dm_auto_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'keyword',
  trigger_value TEXT NOT NULL,
  reply_template_id INTEGER,
  reply_text TEXT,
  enabled BOOLEAN DEFAULT true,
  match_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (reply_template_id) REFERENCES dm_templates(id)
);

-- DMログ
CREATE TABLE IF NOT EXISTS dm_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dm_event_id TEXT,
  conversation_id TEXT,
  sender_id TEXT,
  sender_username TEXT,
  text TEXT,
  direction TEXT DEFAULT 'received',
  auto_replied BOOLEAN DEFAULT false,
  created_at TEXT DEFAULT (datetime('now'))
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_dm_templates_category ON dm_templates(category);
CREATE INDEX IF NOT EXISTS idx_dm_auto_replies_trigger ON dm_auto_replies(trigger_type, enabled);
CREATE INDEX IF NOT EXISTS idx_dm_logs_conversation ON dm_logs(conversation_id);
