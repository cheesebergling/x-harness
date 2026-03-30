-- x-harness Phase 2 Migration
-- ブックマーク AI / 使用量管理 / 予約アクション

-- ブックマークフォルダ
CREATE TABLE IF NOT EXISTS bookmark_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#1d9bf0',
  icon TEXT DEFAULT '📁',
  auto_rule TEXT,
  sort_order INTEGER DEFAULT 0,
  is_default BOOLEAN DEFAULT false,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ブックマーク
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tweet_id TEXT UNIQUE NOT NULL,
  author_id TEXT,
  author_username TEXT,
  text TEXT NOT NULL,
  folder_id INTEGER DEFAULT 5,
  bookmarked_at TEXT,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (folder_id) REFERENCES bookmark_folders(id)
);

-- AI 分析結果
CREATE TABLE IF NOT EXISTS bookmark_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bookmark_id INTEGER NOT NULL UNIQUE,
  keywords TEXT,
  category TEXT,
  summary TEXT,
  skill_tags TEXT,
  folder_suggestion INTEGER,
  analyzed_at TEXT NOT NULL,
  FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id)
);

-- スキル定義（AI 自動抽出）
CREATE TABLE IF NOT EXISTS extracted_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  source_bookmarks TEXT,
  confidence REAL DEFAULT 0,
  related_tools TEXT,
  actionable BOOLEAN DEFAULT false,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

-- ワークフロー提案（AI 自動生成）
CREATE TABLE IF NOT EXISTS workflow_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  steps TEXT NOT NULL,
  required_skills TEXT,
  source_bookmarks TEXT,
  status TEXT DEFAULT 'suggested',
  created_at TEXT DEFAULT (datetime('now'))
);

-- API 使用量ログ
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  estimated_credits REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 日次使用量集計
CREATE TABLE IF NOT EXISTS api_usage_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT UNIQUE NOT NULL,
  total_calls INTEGER DEFAULT 0,
  total_credits REAL DEFAULT 0,
  read_calls INTEGER DEFAULT 0,
  write_calls INTEGER DEFAULT 0
);

-- 通知設定
CREATE TABLE IF NOT EXISTS alert_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_type TEXT NOT NULL,
  threshold_percent INTEGER,
  channel TEXT DEFAULT 'dashboard',
  webhook_url TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 通知ログ
CREATE TABLE IF NOT EXISTS alert_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  channel TEXT NOT NULL,
  sent_at TEXT DEFAULT (datetime('now')),
  acknowledged BOOLEAN DEFAULT false
);

-- 予約アクション（リポスト / 削除 / いいね）
CREATE TABLE IF NOT EXISTS scheduled_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  target_tweet_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  error TEXT,
  executed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_bookmarks_folder ON bookmarks(folder_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_tweet ON bookmarks(tweet_id);
CREATE INDEX IF NOT EXISTS idx_bookmark_analysis ON bookmark_analysis(bookmark_id);
CREATE INDEX IF NOT EXISTS idx_skills_category ON extracted_skills(category);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflow_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_daily_date ON api_usage_daily(date);
CREATE INDEX IF NOT EXISTS idx_scheduled_actions ON scheduled_actions(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_alert_logs_type ON alert_logs(alert_type);

-- デフォルトフォルダ
INSERT OR IGNORE INTO bookmark_folders (id, name, icon, color, auto_rule, sort_order, is_default) VALUES
  (1, 'マーケティング', '📈', '#f59e0b', '集客,広告,SNS戦略,コピーライティング,マーケ,LP,CVR', 1, 1),
  (2, '技術・開発', '💻', '#3b82f6', 'プログラミング,API,インフラ,ツール,開発,コード,TypeScript,React', 2, 1),
  (3, 'ニュース・トレンド', '📰', '#ef4444', '速報,業界動向,アップデート,リリース,発表', 3, 1),
  (4, 'アイデア', '💡', '#a855f7', '事例,成功事例,発想,インスピレーション,ヒント', 4, 1),
  (5, 'あとで読む', '📚', '#71767b', NULL, 5, 1);

-- デフォルトアラート設定
INSERT OR IGNORE INTO alert_settings (id, alert_type, threshold_percent, channel, enabled) VALUES
  (1, 'usage_warning', 80, 'dashboard', 1),
  (2, 'usage_limit', 100, 'dashboard', 1);
