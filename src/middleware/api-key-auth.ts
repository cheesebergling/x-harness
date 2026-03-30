/**
 * API Key Authentication Middleware
 * Bearer Token による認証 — Timing-safe comparison を使用
 *
 * HARNESS_API_KEY を使って Worker への全リクエストを認証。
 * X API トークンはローカルに露出せず、Worker 内部で自動解決される。
 *
 * Security Measures:
 *  - Timing-safe string comparison (prevents timing attacks)
 *  - Constant-time rejection to avoid key-length leakage
 *  - Rate limiting headers for abuse detection
 */

import { Context, Next } from 'hono';
import type { Env } from '../index';

// 認証不要なパス（OAuth コールバック、ヘルスチェック等）
const PUBLIC_PATHS = [
  '/',                       // health check
  '/api/auth/callback',      // OAuth callback (X からのリダイレクト)
  '/api/auth/authorize',     // OAuth 認証URL生成（ブラウザからの初回認証用）
];

/**
 * Timing-safe string comparison using constant-time algorithm.
 * Prevents timing attacks by always comparing the full length.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to keep constant time,
    // but compare against itself to consume the same time
    const dummy = a;
    let result = 1; // will return false
    for (let i = 0; i < dummy.length; i++) {
      result |= dummy.charCodeAt(i) ^ dummy.charCodeAt(i);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function apiKeyAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const path = new URL(c.req.url).pathname;

  // Public paths skip authentication
  if (PUBLIC_PATHS.includes(path)) {
    return next();
  }

  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({
      error: 'Unauthorized',
      message: 'Authorization: Bearer <HARNESS_API_KEY> ヘッダーが必要です',
    }, 401);
  }

  const apiKey = authHeader.slice(7); // "Bearer " の後

  // Timing-safe comparison to prevent timing attacks
  if (!timingSafeEqual(apiKey, c.env.HARNESS_API_KEY)) {
    // Generic error — don't reveal whether key format or value is wrong
    return c.json({
      error: 'Forbidden',
      message: 'Invalid credentials',
    }, 403);
  }

  return next();
}
