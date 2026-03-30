import { Hono } from 'hono';
import type { Env } from '../index';
import { XClient, XApiError } from '../services/x-client';
import { resolveToken } from '../services/token-resolver';

export const tweetsRouter = new Hono<{ Bindings: Env }>();

// Create a tweet
tweetsRouter.post('/', async (c) => {
  const body = await c.req.json<{ text: string; media_ids?: string[] }>();

  if (!body.text || body.text.trim().length === 0) {
    return c.json({ error: 'Tweet text is required' }, 400);
  }

  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  try {
    const result = await client.createTweet(token, {
      text: body.text,
      media: body.media_ids ? { media_ids: body.media_ids } : undefined,
    });

    // Log to D1
    await c.env.DB.prepare(
      'INSERT INTO tweet_logs (tweet_id, text, created_at) VALUES (?, ?, ?)'
    ).bind(result.data.id, body.text, new Date().toISOString()).run();

    return c.json({ success: true, data: result.data });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Create a thread
tweetsRouter.post('/thread', async (c) => {
  const body = await c.req.json<{ tweets: string[] }>();

  if (!body.tweets || body.tweets.length < 2) {
    return c.json({ error: 'At least 2 tweets required for a thread' }, 400);
  }

  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  try {
    const results = [];
    let replyToId: string | undefined;

    for (const text of body.tweets) {
      const result = await client.createTweet(token, {
        text,
        reply: replyToId ? { in_reply_to_tweet_id: replyToId } : undefined,
      });
      results.push(result.data);
      replyToId = result.data.id;
    }

    return c.json({ success: true, thread: results });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Delete a tweet
tweetsRouter.delete('/:id', async (c) => {
  const tweetId = c.req.param('id');
  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  try {
    await client.deleteTweet(token, tweetId);

    await c.env.DB.prepare(
      'UPDATE tweet_logs SET deleted_at = ? WHERE tweet_id = ?'
    ).bind(new Date().toISOString(), tweetId).run();

    return c.json({ success: true, deleted: tweetId });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Get user's tweets
tweetsRouter.get('/user/:userId', async (c) => {
  const userId = c.req.param('userId');
  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  try {
    const result = await client.getUserTweets(token, userId);
    return c.json({ success: true, data: result.data });
  } catch (error: any) {
    const status = error instanceof XApiError ? (error.status >= 400 && error.status < 500 ? error.status as 400 : 500) : 500;
    return c.json({ error: error.message }, status);
  }
});

// Get tweet logs from D1
tweetsRouter.get('/logs', async (c) => {
  const limit = Number(c.req.query('limit') || '50');
  const offset = Number(c.req.query('offset') || '0');

  const result = await c.env.DB.prepare(
    'SELECT * FROM tweet_logs ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(limit, offset).all();

  return c.json({ success: true, data: result.results, meta: result.meta });
});

// Schedule a tweet or thread (stores in D1 for queue processing)
tweetsRouter.post('/schedule', async (c) => {
  const body = await c.req.json<{ text?: string; tweets?: string[]; scheduled_at: string; media_ids?: string[] }>();

  if (!body.scheduled_at) {
    return c.json({ error: 'scheduled_at is required' }, 400);
  }

  // スレッド or 単体の判定
  const isThread = body.tweets && body.tweets.length >= 2;
  if (!isThread && (!body.text || body.text.trim().length === 0)) {
    return c.json({ error: 'text or tweets[] is required' }, 400);
  }

  const scheduledAt = new Date(body.scheduled_at);
  if (isNaN(scheduledAt.getTime())) {
    return c.json({ error: 'Invalid date format' }, 400);
  }
  if (scheduledAt <= new Date()) {
    return c.json({ error: 'scheduled_at must be in the future' }, 400);
  }

  // Normalize to UTC ISO string so Cron scheduler (which uses UTC) can compare correctly
  const scheduledAtUtc = scheduledAt.toISOString();

  const text = isThread ? body.tweets![0] : body.text!;
  const tweetsJson = isThread ? JSON.stringify(body.tweets) : null;

  await c.env.DB.prepare(
    'INSERT INTO scheduled_tweets (text, media_ids, scheduled_at, status, thread_tweets) VALUES (?, ?, ?, ?, ?)'
  ).bind(
    text,
    body.media_ids ? JSON.stringify(body.media_ids) : null,
    scheduledAtUtc,
    'pending',
    tweetsJson
  ).run();

  return c.json({ success: true, scheduled_at: body.scheduled_at, is_thread: !!isThread });
});

// Get scheduled tweets
tweetsRouter.get('/scheduled', async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM scheduled_tweets WHERE status IN ('pending', 'sent', 'failed') ORDER BY scheduled_at ASC"
  ).all();

  return c.json({ success: true, data: result.results });
});

// Edit a scheduled tweet
tweetsRouter.put('/scheduled/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ text?: string; scheduled_at?: string; tweets?: string[] }>();

  const existing = await c.env.DB.prepare(
    'SELECT * FROM scheduled_tweets WHERE id = ?'
  ).bind(id).first();

  if (!existing) return c.json({ error: 'Scheduled tweet not found' }, 404);
  if (existing.status !== 'pending') return c.json({ error: 'Can only edit pending tweets' }, 400);

  const updates: string[] = [];
  const values: any[] = [];

  if (body.text !== undefined) {
    updates.push('text = ?');
    values.push(body.text.trim());
  }
  if (body.scheduled_at !== undefined) {
    const d = new Date(body.scheduled_at);
    if (isNaN(d.getTime()) || d <= new Date()) {
      return c.json({ error: 'scheduled_at must be a valid future date' }, 400);
    }
    updates.push('scheduled_at = ?');
    values.push(d.toISOString()); // Normalize to UTC
  }
  if (body.tweets !== undefined) {
    updates.push('thread_tweets = ?');
    values.push(JSON.stringify(body.tweets));
    if (!body.text && body.tweets.length > 0) {
      updates.push('text = ?');
      values.push(body.tweets[0]);
    }
  }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
  values.push(id);

  await c.env.DB.prepare(
    `UPDATE scheduled_tweets SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return c.json({ success: true, updated: id });
});

// Cancel a scheduled tweet
tweetsRouter.delete('/scheduled/:id', async (c) => {
  const id = Number(c.req.param('id'));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM scheduled_tweets WHERE id = ?'
  ).bind(id).first();

  if (!existing) return c.json({ error: 'Scheduled tweet not found' }, 404);
  if (existing.status !== 'pending') return c.json({ error: 'Can only cancel pending tweets' }, 400);

  await c.env.DB.prepare(
    "UPDATE scheduled_tweets SET status = 'cancelled' WHERE id = ?"
  ).bind(id).run();

  return c.json({ success: true, cancelled: id });
});

// ─── メトリクス一括更新 ───
tweetsRouter.post('/refresh-metrics', async (c) => {
  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated' }, 401);

  // 直近の tweet_id を取得（最大30件）
  const logs = await c.env.DB.prepare(
    "SELECT id, tweet_id FROM tweet_logs WHERE tweet_id IS NOT NULL AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 30"
  ).all();

  if (logs.results.length === 0) {
    return c.json({ success: true, updated: 0, message: 'No tweets to refresh' });
  }

  // X API: 最大100件を1リクエストで取得
  const tweetIds = logs.results.map((r: any) => r.tweet_id).join(',');
  try {
    const result = await client.getTweetMetricsBatch(token, tweetIds);
    let updated = 0;

    for (const tweet of (result.data || [])) {
      const pm = tweet.public_metrics || {};
      const npm = tweet.non_public_metrics || {};
      await c.env.DB.prepare(
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
      updated++;
    }

    return c.json({ success: true, updated });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── 予約アクション（リポスト / 削除 / いいね） ───

// 予約アクション作成
tweetsRouter.post('/schedule-action', async (c) => {
  const body = await c.req.json<{
    action_type: string;
    target_tweet_id: string;
    scheduled_at: string;
  }>();

  const validActions = ['repost', 'unrepost', 'delete', 'like', 'unlike'];
  if (!validActions.includes(body.action_type)) {
    return c.json({ error: `action_type must be one of: ${validActions.join(', ')}` }, 400);
  }

  if (!body.target_tweet_id || !/^\d+$/.test(body.target_tweet_id)) {
    return c.json({ error: 'Valid target_tweet_id required' }, 400);
  }

  if (!body.scheduled_at) {
    return c.json({ error: 'scheduled_at is required' }, 400);
  }

  const scheduledAt = new Date(body.scheduled_at);
  if (isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
    return c.json({ error: 'scheduled_at must be a valid future date' }, 400);
  }

  // Normalize to UTC ISO string so Cron scheduler can compare correctly
  const scheduledAtUtc = scheduledAt.toISOString();

  await c.env.DB.prepare(
    'INSERT INTO scheduled_actions (action_type, target_tweet_id, scheduled_at) VALUES (?, ?, ?)'
  ).bind(body.action_type, body.target_tweet_id, scheduledAtUtc).run();

  return c.json({ success: true, scheduled_at: body.scheduled_at, action_type: body.action_type });
});

// 予約アクション一覧
tweetsRouter.get('/scheduled-actions', async (c) => {
  const status = c.req.query('status') || 'pending';

  const result = await c.env.DB.prepare(
    'SELECT * FROM scheduled_actions WHERE status = ? ORDER BY scheduled_at ASC'
  ).bind(status).all();

  return c.json({ success: true, data: result.results });
});

// 予約アクションキャンセル
tweetsRouter.delete('/scheduled-actions/:id', async (c) => {
  const id = Number(c.req.param('id'));

  const action = await c.env.DB.prepare(
    'SELECT * FROM scheduled_actions WHERE id = ?'
  ).bind(id).first();

  if (!action) return c.json({ error: 'Action not found' }, 404);
  if (action.status !== 'pending') return c.json({ error: 'Can only cancel pending actions' }, 400);

  await c.env.DB.prepare(
    "UPDATE scheduled_actions SET status = 'cancelled' WHERE id = ?"
  ).bind(id).run();

  return c.json({ success: true, cancelled: id });
});
