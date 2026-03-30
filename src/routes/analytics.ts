import { Hono } from 'hono';
import type { Env } from '../index';
import { XClient, XApiError } from '../services/x-client';
import { resolveToken } from '../services/token-resolver';

export const analyticsRouter = new Hono<{ Bindings: Env }>();

// Get tweet analytics
analyticsRouter.get('/tweets/:tweetId', async (c) => {
  const tweetId = c.req.param('tweetId');
  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  try {
    const result = await client.getTweetAnalytics(token, tweetId);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Get follower count and store in D1 for trend tracking
analyticsRouter.post('/followers/snapshot', async (c) => {
  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  try {
    const me = await client.getMe(token);
    const followers = me.data.public_metrics?.followers_count || 0;
    const following = me.data.public_metrics?.following_count || 0;

    await c.env.DB.prepare(
      'INSERT INTO follower_snapshots (user_id, followers, following, snapshot_at) VALUES (?, ?, ?, ?)'
    ).bind(me.data.id, followers, following, new Date().toISOString()).run();

    return c.json({
      success: true,
      data: { user_id: me.data.id, followers, following },
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Get follower trend
analyticsRouter.get('/followers/trend', async (c) => {
  const days = Number(c.req.query('days') || '30');

  const result = await c.env.DB.prepare(
    'SELECT * FROM follower_snapshots ORDER BY snapshot_at DESC LIMIT ?'
  ).bind(days).all();

  return c.json({ success: true, data: result.results });
});

// Get engagement summary from logged tweets
analyticsRouter.get('/engagement/summary', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT 
      COUNT(*) as total_tweets,
      COALESCE(SUM(impressions), 0) as total_impressions,
      COALESCE(SUM(likes), 0) as total_likes,
      COALESCE(SUM(retweets), 0) as total_retweets,
      COALESCE(SUM(replies), 0) as total_replies,
      COALESCE(AVG(CASE WHEN impressions > 0 THEN (likes + retweets + replies) * 100.0 / impressions ELSE 0 END), 0) as avg_engagement_rate
    FROM tweet_logs
    WHERE created_at >= datetime('now', '-30 days')
  `).first();

  return c.json({ success: true, data: result });
});

// ─── いいねユーザー取得 (投稿ID指定) ───

analyticsRouter.get('/tweets/:tweetId/liking-users', async (c) => {
  const tweetId = c.req.param('tweetId');
  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  const maxResults = Math.min(Number(c.req.query('max_results') || '100'), 100);

  try {
    const result = await client.getLikingUsers(token, tweetId, maxResults);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── ユーザーのいいね一覧取得 ───

analyticsRouter.get('/users/:userId/liked-tweets', async (c) => {
  const userId = c.req.param('userId');
  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  const maxResults = Math.min(Number(c.req.query('max_results') || '20'), 100);

  try {
    const result = await client.getLikedTweets(token, userId, maxResults);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── 返信取得 (投稿ID指定) ───

analyticsRouter.get('/tweets/:tweetId/replies', async (c) => {
  const tweetId = c.req.param('tweetId');
  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  const maxResults = Math.min(Number(c.req.query('max_results') || '20'), 100);

  try {
    const result = await client.getReplies(token, tweetId, maxResults);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    const status = error instanceof XApiError ? (error.status >= 400 && error.status < 500 ? error.status as 400 : 500) : 500;
    return c.json({ error: error.message }, status);
  }
});
