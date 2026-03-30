/**
 * Token Resolver Service
 * DB からアクセストークンを取得し、期限切れなら自動リフレッシュ。
 * 全ルートから共通で呼び出し、X-Access-Token ヘッダーに依存しない設計。
 */

import type { Env } from '../index';

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

/**
 * Resolve a valid access token from DB.
 * If expired, automatically refresh using the stored refresh token.
 * Returns null if no token is stored or refresh fails.
 */
export async function resolveToken(env: Env): Promise<string | null> {
  const stored = await env.DB.prepare(
    "SELECT access_token, refresh_token, expires_at FROM tokens WHERE scope = 'default' LIMIT 1"
  ).first<StoredToken>();

  if (!stored) return null;

  // Check if token is still valid (with 60s buffer)
  const expiresAt = new Date(stored.expires_at);
  const bufferMs = 60 * 1000;

  if (expiresAt.getTime() - Date.now() > bufferMs) {
    // Token is still valid
    return stored.access_token;
  }

  // Token expired or expiring soon — refresh
  if (!stored.refresh_token) return null;

  try {
    const res = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: stored.refresh_token,
      }),
    });

    const data = await res.json() as any;

    if (data.error) {
      console.error('[TokenResolver] Refresh failed:', data.error);
      // If refresh token is revoked, clear stored tokens
      if (data.error === 'invalid_grant') {
        await env.DB.prepare("DELETE FROM tokens WHERE scope = 'default'").run();
      }
      return null;
    }

    // Store rotated tokens
    await env.DB.prepare(
      'UPDATE tokens SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ? WHERE scope = ?'
    ).bind(
      data.access_token,
      data.refresh_token,
      new Date(Date.now() + data.expires_in * 1000).toISOString(),
      new Date().toISOString(),
      'default'
    ).run();

    console.log('[TokenResolver] Token refreshed successfully');
    return data.access_token;
  } catch (err: any) {
    console.error('[TokenResolver] Refresh error:', err.message);
    return null;
  }
}
