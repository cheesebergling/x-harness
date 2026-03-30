// =============================================================================
// Event Bus — Centralized event handling for x-harness
// Inspired by line-harness-oss event-bus.ts
// =============================================================================

export type EventType =
  | 'tweet_posted'
  | 'tweet_deleted'
  | 'tweet_scheduled'
  | 'thread_posted'
  | 'action_executed'
  | 'action_failed'
  | 'follower_snapshot'
  | 'bookmark_synced'
  | 'api_limit_warning';

export interface EventPayload {
  /** Event type identifier */
  type: EventType;
  /** Related resource data */
  data?: Record<string, unknown>;
  /** Additional metadata */
  meta?: {
    source?: 'cron' | 'api' | 'dashboard';
    tweetId?: string;
    actionType?: string;
    error?: string;
  };
}

/**
 * Fire an event and execute all registered handlers in parallel.
 * Uses Promise.allSettled to ensure no single handler failure blocks others.
 */
export async function fireEvent(
  db: D1Database,
  event: EventPayload,
): Promise<void> {
  const jobs: Promise<unknown>[] = [
    logEvent(db, event),
    notifyWebhookSubscribers(db, event),
  ];

  await Promise.allSettled(jobs);
}

// ─── Event Logging ─────────────────────────────────────────────

async function logEvent(
  db: D1Database,
  event: EventPayload,
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO event_logs (event_type, payload, source, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(
      event.type,
      JSON.stringify(event.data ?? {}),
      event.meta?.source ?? 'api',
      new Date().toISOString(),
    ).run();
  } catch (err) {
    console.error('Event log failed:', err);
  }
}

// ─── Webhook Notification ──────────────────────────────────────

async function notifyWebhookSubscribers(
  db: D1Database,
  event: EventPayload,
): Promise<void> {
  try {
    const subscribers = await db.prepare(`
      SELECT * FROM webhook_subscribers
      WHERE is_active = 1
        AND (event_types LIKE '%' || ? || '%' OR event_types = '*')
    `).bind(event.type).all();

    for (const sub of subscribers.results) {
      try {
        const body = JSON.stringify({
          event: event.type,
          timestamp: new Date().toISOString(),
          data: event.data ?? {},
          meta: event.meta ?? {},
        });

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        // HMAC signature if secret is configured
        if (sub.secret) {
          const encoder = new TextEncoder();
          const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(sub.secret as string),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign'],
          );
          const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
          const hexSignature = Array.from(new Uint8Array(signature))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          headers['X-Webhook-Signature'] = hexSignature;
        }

        await fetch(sub.url as string, { method: 'POST', headers, body });
      } catch (err) {
        console.error(`Webhook ${sub.id} notification failed:`, err);
      }
    }
  } catch (err) {
    console.error('notifyWebhookSubscribers error:', err);
  }
}
