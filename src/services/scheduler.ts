// =============================================================================
// Scheduler — Cron-triggered background processor
// Processes scheduled tweets and actions from D1
// Inspired by line-harness-oss step-delivery.ts + broadcast.ts
// =============================================================================

import type { Env } from '../index';
import { XClient } from './x-client';
import { fireEvent } from './event-bus';
import { addJitter, sleep, StealthRateLimiter } from './stealth';

const rateLimiter = new StealthRateLimiter(10, 900_000); // 10 calls per 15min for cron

/**
 * Main scheduled handler — called by Cron Triggers every 5 minutes.
 */
export async function processScheduled(env: Env, accessToken?: string): Promise<void> {
  // Get access token from DB (stored after OAuth)
  const tokenRow = await env.DB.prepare(
    "SELECT access_token, expires_at FROM tokens WHERE scope = 'default' LIMIT 1"
  ).first<{ access_token: string; expires_at: string }>();

  const token = accessToken || tokenRow?.access_token;
  if (!token) {
    console.log('[Scheduler] No access token available. Skipping.');
    return;
  }

  // Check if token is expired
  if (tokenRow && new Date(tokenRow.expires_at) <= new Date()) {
    console.log('[Scheduler] Access token expired. Skipping.');
    return;
  }

  const client = new XClient(env);

  await Promise.allSettled([
    processScheduledTweets(env.DB, client, token),
    processScheduledActions(env.DB, client, token),
    processMetricsRefresh(env.DB, client, token),
  ]);
}

// ─── Scheduled Tweets ──────────────────────────────────────────

async function processScheduledTweets(
  db: D1Database,
  client: XClient,
  token: string,
): Promise<void> {
  const now = new Date().toISOString();

  const pending = await db.prepare(`
    SELECT * FROM scheduled_tweets
    WHERE status = 'pending' AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
    LIMIT 5
  `).bind(now).all();

  if (pending.results.length === 0) return;
  console.log(`[Scheduler] Processing ${pending.results.length} scheduled tweets`);

  for (let i = 0; i < pending.results.length; i++) {
    const tweet = pending.results[i];

    try {
      await rateLimiter.waitForSlot();
      if (i > 0) await sleep(addJitter(500, 2000));

      // スレッド判定
      const threadTweets = tweet.thread_tweets ? JSON.parse(tweet.thread_tweets as string) as string[] : null;

      if (threadTweets && threadTweets.length >= 2) {
        // ─── スレッド投稿 ───
        const results = [];
        let replyToId: string | undefined;

        for (const text of threadTweets) {
          if (replyToId) await sleep(addJitter(300, 1000)); // ステルス間隔
          const result = await client.createTweet(token, {
            text,
            reply: replyToId ? { in_reply_to_tweet_id: replyToId } : undefined,
          });
          results.push(result.data);
          replyToId = result.data.id;
        }

        // 最初のツイートIDで記録
        await db.prepare(
          "UPDATE scheduled_tweets SET status = 'sent', tweet_id = ? WHERE id = ?"
        ).bind(results[0].id, tweet.id).run();

        // 全ツイートをログ
        for (const r of results) {
          await db.prepare(
            'INSERT INTO tweet_logs (tweet_id, text, created_at) VALUES (?, ?, ?)'
          ).bind(r.id, r.text || threadTweets[results.indexOf(r)], now).run();
        }

        await fireEvent(db, {
          type: 'thread_posted',
          data: { tweetIds: results.map(r => r.id), count: results.length, scheduled: true },
          meta: { source: 'cron', tweetId: results[0].id },
        });

        console.log(`[Scheduler] Thread sent: ${results.length} tweets, first: ${results[0].id}`);
      } else {
        // ─── 単体ツイート投稿 ───
        const mediaIds = tweet.media_ids ? JSON.parse(tweet.media_ids as string) : undefined;

        const result = await client.createTweet(token, {
          text: tweet.text as string,
          media: mediaIds ? { media_ids: mediaIds } : undefined,
        });

        await db.prepare(
          "UPDATE scheduled_tweets SET status = 'sent', tweet_id = ? WHERE id = ?"
        ).bind(result.data.id, tweet.id).run();

        await db.prepare(
          'INSERT INTO tweet_logs (tweet_id, text, created_at) VALUES (?, ?, ?)'
        ).bind(result.data.id, tweet.text, now).run();

        await fireEvent(db, {
          type: 'tweet_posted',
          data: { tweetId: result.data.id, text: tweet.text, scheduled: true },
          meta: { source: 'cron', tweetId: result.data.id },
        });

        console.log(`[Scheduler] Tweet sent: ${result.data.id}`);
      }
    } catch (err: any) {
      console.error(`[Scheduler] Tweet ${tweet.id} failed:`, err.message);

      await db.prepare(
        "UPDATE scheduled_tweets SET status = 'failed', error = ? WHERE id = ?"
      ).bind(err.message || 'Unknown error', tweet.id).run();

      await fireEvent(db, {
        type: 'action_failed',
        data: { scheduledTweetId: tweet.id, error: err.message },
        meta: { source: 'cron', error: err.message },
      });
    }
  }
}

// ─── メトリクス自動更新（1日1回 Cron で呼ばれる） ──────────────

async function processMetricsRefresh(
  db: D1Database,
  client: XClient,
  token: string,
): Promise<void> {
  // 最後の更新から6時間以上経過しているか確認
  const lastRefresh = await db.prepare(
    "SELECT MAX(snapshot_at) as last FROM follower_snapshots"
  ).first<{ last: string }>();

  const logs = await db.prepare(
    "SELECT tweet_id FROM tweet_logs WHERE tweet_id IS NOT NULL AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 30"
  ).all();

  if (logs.results.length === 0) return;

  const tweetIds = logs.results.map((r: any) => r.tweet_id).join(',');
  try {
    const result = await client.getTweetMetricsBatch(token, tweetIds);
    for (const tweet of (result.data || [])) {
      const pm = tweet.public_metrics || {};
      const npm = tweet.non_public_metrics || {};
      await db.prepare(
        `UPDATE tweet_logs SET
          impressions = ?, likes = ?, retweets = ?, replies = ?,
          quotes = ?, bookmarks = ?, url_clicks = ?, profile_clicks = ?
        WHERE tweet_id = ?`
      ).bind(
        pm.impression_count || npm.impression_count || 0,
        pm.like_count || 0,
        pm.retweet_count || 0,
        pm.reply_count || 0,
        pm.quote_count || 0,
        pm.bookmark_count || 0,
        npm.url_link_clicks || 0,
        npm.user_profile_clicks || 0,
        tweet.id
      ).run();
    }
    console.log(`[Scheduler] Metrics refreshed for ${result.data?.length || 0} tweets`);
  } catch (err: any) {
    console.error('[Scheduler] Metrics refresh failed:', err.message);
  }
}

// ─── Scheduled Actions (Repost / Like / Delete) ────────────────

async function processScheduledActions(
  db: D1Database,
  client: XClient,
  token: string,
): Promise<void> {
  const now = new Date().toISOString();

  const pending = await db.prepare(`
    SELECT * FROM scheduled_actions
    WHERE status = 'pending' AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
    LIMIT 10
  `).bind(now).all();

  if (pending.results.length === 0) return;
  console.log(`[Scheduler] Processing ${pending.results.length} scheduled actions`);

  // Get authenticated user ID (needed for like/retweet endpoints)
  let userId = '';
  try {
    const me = await client.getMe(token);
    userId = me.data.id;
  } catch (err: any) {
    console.error('[Scheduler] Failed to get user ID:', err.message);
    return;
  }

  for (let i = 0; i < pending.results.length; i++) {
    const action = pending.results[i];
    const actionType = action.action_type as string;
    const targetTweetId = action.target_tweet_id as string;

    try {
      await rateLimiter.waitForSlot();
      if (i > 0) await sleep(addJitter(300, 1500));

      switch (actionType) {
        case 'repost':
          // 冪等パターン: 既存 repost を削除（エラー無視）→ repost
          try { await client.unretweet(token, userId, targetTweetId); } catch { /* ignore */ }
          await client.retweet(token, userId, targetTweetId);
          break;
        case 'unrepost':
          await client.unretweet(token, userId, targetTweetId);
          break;
        case 'like':
          // 冪等パターン: 既存 like を削除（エラー無視）→ like
          try { await client.unlikeTweet(token, userId, targetTweetId); } catch { /* ignore */ }
          await client.likeTweet(token, userId, targetTweetId);
          break;
        case 'unlike':
          await client.unlikeTweet(token, userId, targetTweetId);
          break;
        case 'delete':
          await client.deleteTweet(token, targetTweetId);
          break;
        default:
          throw new Error(`Unknown action type: ${actionType}`);
      }

      // Mark as executed
      await db.prepare(
        "UPDATE scheduled_actions SET status = 'executed', executed_at = ? WHERE id = ?"
      ).bind(now, action.id).run();

      await fireEvent(db, {
        type: 'action_executed',
        data: { actionType, targetTweetId },
        meta: { source: 'cron', tweetId: targetTweetId, actionType },
      });

      console.log(`[Scheduler] Action ${actionType} on ${targetTweetId}: done`);
    } catch (err: any) {
      console.error(`[Scheduler] Action ${action.id} failed:`, err.message);

      await db.prepare(
        "UPDATE scheduled_actions SET status = 'failed', error = ? WHERE id = ?"
      ).bind(err.message || 'Unknown error', action.id).run();

      await fireEvent(db, {
        type: 'action_failed',
        data: { actionId: action.id, actionType, error: err.message },
        meta: { source: 'cron', error: err.message },
      });
    }
  }
}
