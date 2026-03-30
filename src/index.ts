import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { apiKeyAuth } from './middleware/api-key-auth';
import { tweetsRouter } from './routes/tweets';
import { analyticsRouter } from './routes/analytics';
import { authRouter } from './routes/auth';
import { bookmarksRouter } from './routes/bookmarks';
import { usageRouter } from './routes/usage';
import { dmRouter } from './routes/dm';
import { writingRulesRouter } from './routes/writing-rules';
import { syncRouter } from './routes/sync';
import { processScheduled } from './services/scheduler';
import { resolveToken } from './services/token-resolver';

export interface Env {
  DB: D1Database;
  MEDIA?: R2Bucket;
  AI?: Ai;
  HARNESS_API_KEY: string;
  X_CLIENT_ID: string;
  X_CLIENT_SECRET: string;
  X_CALLBACK_URL: string;
  ENVIRONMENT: string;
}

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// API Key Authentication (LINE-harness pattern)
app.use('/api/*', apiKeyAuth);

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'x-harness',
    version: '0.6.0',
    pricing: 'pay-per-use',
    status: 'running',
    auth: 'Bearer HARNESS_API_KEY',
    features: ['tweets', 'analytics', 'bookmarks', 'usage', 'ai', 'scheduler', 'event-bus', 'dm', 'stealth', 'mcp', 'writing-rules', 'local-sync'],
    docs: '/docs',
  });
});

// API Routes
app.route('/api/auth', authRouter);
app.route('/api/tweets', tweetsRouter);
app.route('/api/analytics', analyticsRouter);
app.route('/api/bookmarks', bookmarksRouter);
app.route('/api/usage', usageRouter);
app.route('/api/dm', dmRouter);
app.route('/api/writing-rules', writingRulesRouter);
app.route('/api/sync', syncRouter);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found', path: c.req.path }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error(`Error: ${err.message}`);
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

// ─── Cron Triggers handler — runs every 5 minutes ──────────────
async function scheduled(
  _event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  console.log('[Cron] Triggered at', new Date().toISOString());

  // Resolve token (auto-refresh if needed)
  const token = await resolveToken(env);
  if (!token) {
    console.log('[Cron] No valid token. Skipping scheduled tasks.');
    return;
  }

  await processScheduled(env, token);
}

export default {
  fetch: app.fetch,
  scheduled,
};
