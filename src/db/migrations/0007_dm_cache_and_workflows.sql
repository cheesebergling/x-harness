-- x-harness DM Cache + Workflow Templates Migration

-- DM イベントキャッシュ（X API結果をD1に保存）
CREATE TABLE IF NOT EXISTS dm_events_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dm_event_id TEXT UNIQUE NOT NULL,
  sender_id TEXT NOT NULL,
  text TEXT,
  event_type TEXT DEFAULT 'MessageCreate',
  created_at TEXT,
  synced_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dm_cache_sender ON dm_events_cache(sender_id);
CREATE INDEX IF NOT EXISTS idx_dm_cache_created ON dm_events_cache(created_at DESC);

-- DM ユーザー情報キャッシュ
CREATE TABLE IF NOT EXISTS dm_users_cache (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  name TEXT,
  profile_image_url TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ワークフローテンプレート（プリセット + ON/OFF管理）
CREATE TABLE IF NOT EXISTS workflow_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  source_folder_id INTEGER,
  writing_rule_id INTEGER,
  steps TEXT NOT NULL DEFAULT '[]',
  enabled BOOLEAN DEFAULT 0,
  is_preset BOOLEAN DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (writing_rule_id) REFERENCES writing_rules(id)
);

-- プリセットワークフロー挿入
INSERT OR IGNORE INTO workflow_templates (id, name, description, category, source_folder_id, steps, is_preset) VALUES
(1, 'ニュース → 引用投稿作成', 'ニュースフォルダのブックマークを元に、引用ポストの下書きを自動生成', 'news_to_quote', 3,
 '[{"order":1,"action":"ブックマーク取得","details":"ニュースフォルダから最新の未処理ブックマークを取得"},{"order":2,"action":"要約生成","details":"AI分析で記事の要点を抽出"},{"order":3,"action":"引用ポスト下書き","details":"ライティングルールに基づいて引用コメントを生成"},{"order":4,"action":"投稿確認","details":"下書きを確認して投稿 or 予約投稿"}]', 1),
(2, 'リポジトリ → Skills抽出', '技術ブックマークのGitHubリポジトリからAI活用スキルを抽出', 'repo_to_skills', 2,
 '[{"order":1,"action":"GitHub URL抽出","details":"技術フォルダからGitHubリンクを含むブックマークを収集"},{"order":2,"action":"リポジトリ分析","details":"READMEやdescriptionからスキル要素を抽出"},{"order":3,"action":"スキル登録","details":"抽出したスキルをx-harnessのスキルDBに保存"},{"order":4,"action":"ワークフロー提案","details":"関連スキルを組み合わせた実行可能ワークフローを提案"}]', 1),
(3, 'マーケティング → スレッド投稿作成', 'マーケティングフォルダのブックマーク群からまとめスレッドの下書きを生成', 'marketing_to_thread', 1,
 '[{"order":1,"action":"ブックマーク収集","details":"マーケティングフォルダから関連ブックマークをグルーピング"},{"order":2,"action":"テーマ抽出","details":"共通テーマやトレンドをAIが特定"},{"order":3,"action":"スレッド構成","details":"5-7ツイートのスレッド構成を自動生成"},{"order":4,"action":"ライティングルール適用","details":"指定ルールでトーン・スタイルを調整"},{"order":5,"action":"投稿確認","details":"スレッド下書きを確認して投稿"}]', 1),
(4, 'トレンド分析 → レポート生成', 'ニュース/トレンドフォルダからサマリーレポートを自動生成', 'trend_to_report', 3,
 '[{"order":1,"action":"トレンド収集","details":"直近のニュース・トレンドブックマークを時系列で収集"},{"order":2,"action":"分類・グルーピング","details":"AIがテーマ別にグルーピング"},{"order":3,"action":"レポート生成","details":"サマリー + インサイトのレポートを生成"},{"order":4,"action":"エクスポート","details":"Markdown形式でローカルに保存"}]', 1);
