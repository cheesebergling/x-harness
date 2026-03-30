-- x-harness D1 Schema
-- Migration: 0001_initial.sql

-- OAuth state storage (PKCE flow)
CREATE TABLE IF NOT EXISTS oauth_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT UNIQUE NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Token storage
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT UNIQUE NOT NULL DEFAULT 'default',
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Tweet logs
CREATE TABLE IF NOT EXISTS tweet_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tweet_id TEXT UNIQUE,
  text TEXT NOT NULL,
  media_ids TEXT,
  impressions INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  retweets INTEGER DEFAULT 0,
  replies INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

-- Scheduled tweets
CREATE TABLE IF NOT EXISTS scheduled_tweets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  media_ids TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, sent, failed
  tweet_id TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Follower snapshots (for trend tracking)
CREATE TABLE IF NOT EXISTS follower_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  followers INTEGER NOT NULL,
  following INTEGER NOT NULL,
  snapshot_at TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tweet_logs_created ON tweet_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_status ON scheduled_tweets(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_follower_snapshots ON follower_snapshots(user_id, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_oauth_states ON oauth_states(state);
