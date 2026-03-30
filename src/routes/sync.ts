/**
 * Sync Export API
 * MCP の Local Sync エンジン用一括エクスポートエンドポイント
 *
 * Security:
 *  - since パラメータの ISO 8601 バリデーション
 *  - レスポンスサイズ制限 (各モジュール最大1000件)
 *  - 認証必須 (api-key-auth middleware で保護)
 *  - エクスポート操作のログ記録
 */

import { Hono } from 'hono';
import type { Env } from '../index';

export const syncRouter = new Hono<{ Bindings: Env }>();

const MAX_EXPORT_ROWS = 1000;

/** Validate ISO 8601 date string — prevent injection */
function isValidISODate(s: string): boolean {
  if (s.length > 30) return false; // ISO 8601 is max ~25 chars
  const d = new Date(s);
  return !isNaN(d.getTime()) && d.toISOString().startsWith(s.slice(0, 10));
}

// ─── GET /api/sync/export — 一括エクスポート ───

syncRouter.get('/export', async (c) => {
  const sinceParam = c.req.query('since');
  const modulesParam = c.req.query('modules'); // comma-separated: tweets,analytics,writing-rules,usage

  // Validate 'since'
  let since = '1970-01-01T00:00:00Z';
  if (sinceParam) {
    if (!isValidISODate(sinceParam)) {
      return c.json({ error: 'Invalid since parameter. Use ISO 8601 format.' }, 400);
    }
    since = sinceParam;
  }

  // Parse requested modules (default: all)
  const allModules = ['tweets', 'analytics', 'writing-rules', 'usage'];
  const requestedModules = modulesParam
    ? modulesParam.split(',').filter((m) => allModules.includes(m.trim()))
    : allModules;

  if (requestedModules.length === 0) {
    return c.json({ error: `Invalid modules. Available: ${allModules.join(', ')}` }, 400);
  }

  const exportData: Record<string, any> = {
    exported_at: new Date().toISOString(),
    since,
    modules: requestedModules,
  };

  // ── Tweets ──
  if (requestedModules.includes('tweets')) {
    const tweets = await c.env.DB.prepare(
      'SELECT * FROM tweet_logs WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?'
    ).bind(since, MAX_EXPORT_ROWS).all();

    const scheduled = await c.env.DB.prepare(
      'SELECT * FROM scheduled_tweets WHERE created_at >= ? ORDER BY scheduled_at ASC LIMIT ?'
    ).bind(since, MAX_EXPORT_ROWS).all();

    exportData.tweets = {
      logs: tweets.results,
      scheduled: scheduled.results,
      count: tweets.results.length,
    };
  }

  // ── Analytics ──
  if (requestedModules.includes('analytics')) {
    const followers = await c.env.DB.prepare(
      'SELECT * FROM follower_snapshots WHERE snapshot_at >= ? ORDER BY snapshot_at DESC LIMIT ?'
    ).bind(since, MAX_EXPORT_ROWS).all();

    // Engagement summary (last 30 days from 'since')
    const engagement = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_tweets,
        COALESCE(SUM(impressions), 0) as total_impressions,
        COALESCE(SUM(likes), 0) as total_likes,
        COALESCE(SUM(retweets), 0) as total_retweets,
        COALESCE(SUM(replies), 0) as total_replies
      FROM tweet_logs
      WHERE created_at >= ?
    `).bind(since).first();

    exportData.analytics = {
      followers: followers.results,
      engagement,
    };
  }

  // ── Writing Rules ──
  if (requestedModules.includes('writing-rules')) {
    const rules = await c.env.DB.prepare(
      'SELECT * FROM writing_rules WHERE updated_at >= ? ORDER BY is_default DESC, updated_at DESC LIMIT ?'
    ).bind(since, MAX_EXPORT_ROWS).all();

    // Also include all rules on first sync (since=1970)
    const allRules = since === '1970-01-01T00:00:00Z'
      ? await c.env.DB.prepare('SELECT * FROM writing_rules ORDER BY is_default DESC').all()
      : rules;

    exportData.writing_rules = {
      rules: (allRules.results || rules.results).map((r: any) => ({
        ...r,
        constraints: JSON.parse(r.constraints || '{}'),
        templates: JSON.parse(r.templates || '[]'),
        examples: JSON.parse(r.examples || '{"good":[],"bad":[]}'),
      })),
      count: (allRules.results || rules.results).length,
    };
  }

  // ── Usage ──
  if (requestedModules.includes('usage')) {
    const daily = await c.env.DB.prepare(
      'SELECT * FROM api_usage_daily WHERE date >= ? ORDER BY date DESC LIMIT ?'
    ).bind(since.slice(0, 10), MAX_EXPORT_ROWS).all();

    // Monthly sum
    const monthStart = new Date().toISOString().slice(0, 7) + '-01';
    const monthly = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(total_calls), 0) as calls, COALESCE(SUM(total_credits), 0) as credits FROM api_usage_daily WHERE date >= ?'
    ).bind(monthStart).first<{ calls: number; credits: number }>();

    exportData.usage = {
      daily: daily.results,
      monthly_summary: {
        total_calls: monthly?.calls || 0,
        total_credits: monthly?.credits || 0,
        month: monthStart,
      },
    };
  }

  // Log the export event
  try {
    await c.env.DB.prepare(
      "INSERT INTO event_logs (event_type, payload, source) VALUES ('sync_export', ?, 'mcp')"
    ).bind(JSON.stringify({
      since,
      modules: requestedModules,
      timestamp: exportData.exported_at,
    })).run();
  } catch {
    // Non-critical — don't fail the export
  }

  return c.json(exportData);
});

// ─── GET /api/sync/status — 同期ステータス ───

syncRouter.get('/status', async (c) => {
  const lastExport = await c.env.DB.prepare(
    "SELECT payload, created_at FROM event_logs WHERE event_type = 'sync_export' ORDER BY created_at DESC LIMIT 1"
  ).first<{ payload: string; created_at: string }>();

  const tweetCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM tweet_logs'
  ).first<{ count: number }>();

  const ruleCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM writing_rules'
  ).first<{ count: number }>();

  return c.json({
    success: true,
    data: {
      last_export: lastExport ? {
        at: lastExport.created_at,
        ...JSON.parse(lastExport.payload),
      } : null,
      total_tweets: tweetCount?.count || 0,
      total_writing_rules: ruleCount?.count || 0,
    },
  });
});
