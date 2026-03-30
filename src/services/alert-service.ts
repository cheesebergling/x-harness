/**
 * Alert Service
 * API 使用量の閾値監視 + Discord Webhook 通知
 * X API 従量課金（Pay-per-use クレジット制）に対応
 */

import type { Env } from '../index';

interface AlertConfig {
  id: number;
  alert_type: string;
  threshold_percent: number;
  channel: string;
  webhook_url: string | null;
  enabled: boolean;
}

interface UsageSummary {
  total_calls: number;
  total_credits: number;
  monthly_limit: number;
}

// ─── X API Pay-per-use エンドポイント単位料金表 (USD) ───────────
// Source: X Developer Console (2026-03 時点)
// 24H UTC デデュプリケーション: 同一リソースへの重複リクエストは1回分課金
export const ENDPOINT_COSTS: Record<string, number> = {
  // ── Read 系 ──
  'GET /tweets':                      0.005,
  'GET /tweets/search/recent':        0.005,
  'GET /users/me':                    0.010,
  'GET /users/:id':                   0.010,
  'GET /users/:id/tweets':            0.005,
  'GET /users/:id/followers':         0.010,
  'GET /users/:id/following':         0.010,
  'GET /users/:id/liked_tweets':      0.005,
  'GET /tweets/:id/liking_users':     0.005,
  'GET /users/:id/mentions':          0.005,
  'GET /dm_events':                   0.010,
  'GET /dm_conversations':            0.010,
  'GET /users/me/bookmarks':          0.005,
  'GET /trends/personalized':         0.005,
  // ── Write 系 ──
  'POST /tweets':                     0.010,
  'DELETE /tweets/:id':               0.010,
  'POST /users/:id/likes':            0.015,
  'DELETE /users/:id/likes/:id':      0.015,
  'POST /users/:id/retweets':         0.015,
  'DELETE /users/:id/retweets/:id':   0.015,
  'POST /dm_conversations':           0.015,
  'POST /users/:id/bookmarks':        0.010,
  'DELETE /users/:id/bookmarks/:id':  0.010,
};

/**
 * Normalize an X API path to match ENDPOINT_COSTS keys.
 * e.g. "/users/12345/likes" → "users/:id/likes"
 */
function normalizePath(path: string): string {
  return path
    .replace(/^\/2\//, '/')        // strip /2/ prefix
    .replace(/\/\d+/g, '/:id')     // numeric segments → :id
    .replace(/\?.*$/, '');          // strip query params
}

function estimateCost(endpoint: string, method: string): number {
  const normalized = normalizePath(endpoint);
  const key = `${method.toUpperCase()} ${normalized}`;

  // Exact match first
  if (ENDPOINT_COSTS[key]) return ENDPOINT_COSTS[key];

  // Prefix match fallback
  for (const [pattern, cost] of Object.entries(ENDPOINT_COSTS)) {
    if (key.startsWith(pattern.slice(0, pattern.lastIndexOf('/')))) return cost;
  }

  // Category fallback
  if (method === 'GET') return 0.005;
  if (method === 'POST') return 0.010;
  if (method === 'DELETE') return 0.010;
  return 0.010;
}

// デフォルト月間支出上限 (USD) — ユーザーが変更可能
const DEFAULT_MONTHLY_LIMIT = 50;

export class AlertService {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * API コールを記録（エンドポイント単位の精密コスト推定）
   */
  async logApiCall(
    endpoint: string,
    method: string,
    statusCode: number,
    responseTimeMs: number
  ): Promise<void> {
    const credits = estimateCost(endpoint, method);
    const today = new Date().toISOString().slice(0, 10);

    // ログ記録
    await this.env.DB.prepare(
      'INSERT INTO api_usage_logs (endpoint, method, status_code, response_time_ms, estimated_credits) VALUES (?, ?, ?, ?, ?)'
    ).bind(endpoint, method, statusCode, responseTimeMs, credits).run();

    // 日次集計更新（UPSERT）
    const isRead = method === 'GET';
    await this.env.DB.prepare(`
      INSERT INTO api_usage_daily (date, total_calls, total_credits, read_calls, write_calls)
      VALUES (?, 1, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        total_calls = total_calls + 1,
        total_credits = total_credits + excluded.total_credits,
        read_calls = read_calls + excluded.read_calls,
        write_calls = write_calls + excluded.write_calls
    `).bind(today, credits, isRead ? 1 : 0, isRead ? 0 : 1).run();

    // アラートチェック（非同期でブロックしない）
    this.checkAlerts().catch(console.error);
  }

  /**
   * アラート条件チェック
   */
  async checkAlerts(): Promise<void> {
    const summary = await this.getMonthlyUsage();
    const alerts = await this.env.DB.prepare(
      'SELECT * FROM alert_settings WHERE enabled = 1'
    ).all<AlertConfig>();

    for (const alert of alerts.results) {
      const usagePercent = (summary.total_credits / summary.monthly_limit) * 100;

      if (usagePercent >= alert.threshold_percent) {
        // 同じ月に同じアラートを送信済みか確認
        const monthStart = new Date().toISOString().slice(0, 7);
        const existing = await this.env.DB.prepare(
          "SELECT id FROM alert_logs WHERE alert_type = ? AND sent_at >= ? || '-01'"
        ).bind(alert.alert_type, monthStart).first();

        if (existing) continue; // 既に送信済み

        const message = alert.threshold_percent >= 100
          ? `🚨 API 使用量が月間上限に達しました（${summary.total_credits.toFixed(2)} / ${summary.monthly_limit} クレジット）`
          : `⚠️ API 使用量が ${alert.threshold_percent}% に達しました（${summary.total_credits.toFixed(2)} / ${summary.monthly_limit} クレジット）`;

        // ダッシュボード通知ログ保存
        await this.env.DB.prepare(
          'INSERT INTO alert_logs (alert_type, message, channel) VALUES (?, ?, ?)'
        ).bind(alert.alert_type, message, 'dashboard').run();

        // Discord Webhook 送信
        if (alert.channel === 'discord' && alert.webhook_url) {
          await this.sendDiscordAlert(alert.webhook_url, {
            threshold: alert.threshold_percent,
            used: summary.total_credits,
            limit: summary.monthly_limit,
            remaining: summary.monthly_limit - summary.total_credits,
            message,
          });
        }
      }
    }
  }

  /**
   * 月間使用量取得
   */
  async getMonthlyUsage(): Promise<UsageSummary> {
    const monthStart = new Date().toISOString().slice(0, 7) + '-01';
    const result = await this.env.DB.prepare(
      'SELECT COALESCE(SUM(total_calls), 0) as calls, COALESCE(SUM(total_credits), 0) as credits FROM api_usage_daily WHERE date >= ?'
    ).bind(monthStart).first<{ calls: number; credits: number }>();

    return {
      total_calls: result?.calls || 0,
      total_credits: result?.credits || 0,
      monthly_limit: DEFAULT_MONTHLY_LIMIT,
    };
  }

  /**
   * Discord Webhook にアラート送信
   */
  async sendDiscordAlert(
    webhookUrl: string,
    alert: { threshold: number; used: number; limit: number; remaining: number; message: string }
  ): Promise<void> {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: alert.threshold >= 100 ? '@here' : undefined,
          embeds: [{
            title: '⚠️ x-harness API 使用量アラート',
            description: alert.message,
            color: alert.threshold >= 100 ? 0xff4444 : 0xf59e0b,
            fields: [
              { name: '使用量', value: `${alert.used.toFixed(2)} / ${alert.limit} クレジット`, inline: true },
              { name: '残り', value: `${alert.remaining.toFixed(2)} クレジット`, inline: true },
              { name: '使用率', value: `${((alert.used / alert.limit) * 100).toFixed(1)}%`, inline: true },
            ],
            footer: { text: 'x-harness Alert System' },
            timestamp: new Date().toISOString(),
          }],
        }),
      });

      // Discord 送信もログに記録
      await this.env.DB.prepare(
        'INSERT INTO alert_logs (alert_type, message, channel) VALUES (?, ?, ?)'
      ).bind(`discord_${alert.threshold}`, alert.message, 'discord').run();
    } catch (error) {
      console.error('Discord webhook failed:', error);
    }
  }

  /**
   * Discord Webhook テスト送信
   */
  async testWebhook(webhookUrl: string): Promise<boolean> {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: '✅ x-harness Webhook テスト',
            description: 'Discord Webhook 接続に成功しました！',
            color: 0x22c55e,
            footer: { text: 'x-harness Alert System' },
            timestamp: new Date().toISOString(),
          }],
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
