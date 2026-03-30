-- x-harness Phase 5 Migration
-- ライティングルール管理 + 同期メタデータ

-- ────────────────────────────────────────────────────
-- ライティングルール
-- ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS writing_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'neutral',          -- casual, professional, provocative, neutral
  persona TEXT,                                   -- ペルソナ説明
  constraints TEXT NOT NULL DEFAULT '{}',          -- JSON: { max_chars, forbidden_words, hashtag_rules, ... }
  templates TEXT NOT NULL DEFAULT '[]',            -- JSON: テンプレート配列
  examples TEXT NOT NULL DEFAULT '{"good":[],"bad":[]}', -- JSON: 良い例・悪い例
  is_default BOOLEAN DEFAULT false,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_writing_rules_default ON writing_rules(is_default);
CREATE INDEX IF NOT EXISTS idx_writing_rules_name ON writing_rules(name);

-- ────────────────────────────────────────────────────
-- 同期メタデータ（KV形式）
-- ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────────────
-- デフォルトライティングルール
-- ────────────────────────────────────────────────────
INSERT OR IGNORE INTO writing_rules (id, name, tone, persona, constraints, templates, examples, is_default)
VALUES (
  1,
  'X投稿・標準',
  'casual',
  'SNS運用担当者。フォロワーとの距離感を大切にしながら、価値ある情報を発信する。',
  '{"max_chars":280,"forbidden_words":[],"hashtag_rules":{"max":3,"position":"end"},"emoji_usage":"moderate"}',
  '["【{{topic}}】\n{{body}}\n\n{{cta}}","{{hook}}\n\n→ {{body}}\n\n#{{tag1}} #{{tag2}}"]',
  '{"good":["短い文で要点を伝え、最後にCTAを入れる"],"bad":["長すぎる文章、ハッシュタグの乱用"]}',
  true
);
