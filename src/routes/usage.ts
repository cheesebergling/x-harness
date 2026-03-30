import { Hono } from 'hono';
import type { Env } from '../index';
import { AlertService } from '../services/alert-service';

export const usageRouter = new Hono<{ Bindings: Env }>();

// ─── 月間サマリー ───
usageRouter.get('/summary', async (c) => {
  const alertService = new AlertService(c.env);
  const summary = await alertService.getMonthlyUsage();

  // 今日の使用量
  const today = new Date().toISOString().slice(0, 10);
  const todayRow = await c.env.DB.prepare(
    'SELECT * FROM api_usage_daily WHERE date = ?'
  ).bind(today).first();

  // 未確認アラート数
  const unacknowledged = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM alert_logs WHERE acknowledged = 0'
  ).first<{ count: number }>();

  return c.json({
    success: true,
    data: {
      ...summary,
      today: todayRow || { total_calls: 0, total_credits: 0, read_calls: 0, write_calls: 0 },
      unacknowledged_alerts: unacknowledged?.count || 0,
    },
  });
});

// ─── 日別使用量（グラフ用） ───
usageRouter.get('/daily', async (c) => {
  const days = Math.min(Number(c.req.query('days') || '30'), 90);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const result = await c.env.DB.prepare(
    'SELECT * FROM api_usage_daily WHERE date >= ? ORDER BY date ASC'
  ).bind(since).all();

  return c.json({ success: true, data: result.results });
});

// ─── エンドポイント別内訳 ───
usageRouter.get('/by-endpoint', async (c) => {
  const monthStart = new Date().toISOString().slice(0, 7) + '-01';

  const result = await c.env.DB.prepare(`
    SELECT endpoint, method,
      COUNT(*) as calls,
      SUM(estimated_credits) as credits,
      AVG(response_time_ms) as avg_response_time
    FROM api_usage_logs
    WHERE created_at >= ?
    GROUP BY endpoint, method
    ORDER BY calls DESC
    LIMIT 50
  `).bind(monthStart).all();

  return c.json({ success: true, data: result.results });
});

// ─── アラート設定取得 ───
usageRouter.get('/alerts', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM alert_settings ORDER BY threshold_percent ASC'
  ).all();
  return c.json({ success: true, data: result.results });
});

// ─── アラート設定更新 ───
usageRouter.put('/alerts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{
    enabled?: boolean;
    channel?: string;
    webhook_url?: string;
    threshold_percent?: number;
  }>();

  const current = await c.env.DB.prepare(
    'SELECT * FROM alert_settings WHERE id = ?'
  ).bind(id).first();

  if (!current) return c.json({ error: 'Alert setting not found' }, 404);

  // Webhook URL のバリデーション
  if (body.webhook_url) {
    try {
      const url = new URL(body.webhook_url);
      if (!url.hostname.includes('discord.com') && !url.hostname.includes('discordapp.com')) {
        return c.json({ error: 'Only Discord webhook URLs are supported' }, 400);
      }
    } catch {
      return c.json({ error: 'Invalid webhook URL' }, 400);
    }
  }

  await c.env.DB.prepare(`
    UPDATE alert_settings SET
      enabled = ?,
      channel = ?,
      webhook_url = ?,
      threshold_percent = ?
    WHERE id = ?
  `).bind(
    body.enabled !== undefined ? (body.enabled ? 1 : 0) : current.enabled,
    body.channel || current.channel,
    body.webhook_url !== undefined ? body.webhook_url : current.webhook_url,
    body.threshold_percent || current.threshold_percent,
    id
  ).run();

  return c.json({ success: true });
});

// ─── 通知履歴 ───
usageRouter.get('/alert-logs', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') || '20'), 100);

  const result = await c.env.DB.prepare(
    'SELECT * FROM alert_logs ORDER BY sent_at DESC LIMIT ?'
  ).bind(limit).all();

  return c.json({ success: true, data: result.results });
});

// ─── 通知確認済み ───
usageRouter.put('/alert-logs/:id/acknowledge', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('UPDATE alert_logs SET acknowledged = 1 WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ─── Discord Webhook テスト ───
usageRouter.post('/test-webhook', async (c) => {
  const body = await c.req.json<{ webhook_url: string }>();
  if (!body.webhook_url) return c.json({ error: 'webhook_url required' }, 400);

  const alertService = new AlertService(c.env);
  const success = await alertService.testWebhook(body.webhook_url);

  return c.json({ success, message: success ? 'Webhook テスト成功！' : 'Webhook 送信に失敗しました' });
});
