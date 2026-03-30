import { Hono } from 'hono';
import type { Env } from '../index';

export const authRouter = new Hono<{ Bindings: Env }>();

// OAuth state の有効期限 (10分)
const STATE_TTL_MS = 10 * 60 * 1000;

// OAuth 2.0 PKCE Authorization URL generator
authRouter.get('/authorize', async (c) => {
  const clientId = c.env.X_CLIENT_ID;
  const callbackUrl = c.env.X_CALLBACK_URL;

  // Generate PKCE challenge
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = crypto.randomUUID();

  // Store verifier + state in D1 (expires in 10 min)
  await c.env.DB.prepare(
    'INSERT INTO oauth_states (state, code_verifier, created_at) VALUES (?, ?, ?)'
  ).bind(state, codeVerifier, new Date().toISOString()).run();

  // Cleanup expired states (older than 10 minutes)
  await c.env.DB.prepare(
    "DELETE FROM oauth_states WHERE created_at < datetime('now', '-10 minutes')"
  ).run();

  const scopes = [
    'tweet.read', 'tweet.write',
    'users.read',
    'follows.read', 'follows.write',
    'like.read', 'like.write',
    'dm.read', 'dm.write',
    'bookmark.read', 'bookmark.write',
    'offline.access',
  ].join(' ');

  const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', callbackUrl);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return c.json({ authorize_url: authUrl.toString(), state });
});

// OAuth 2.0 Callback handler
authRouter.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    return c.json({ error: 'Missing code or state' }, 400);
  }

  // Retrieve stored verifier with timestamp check
  const stored = await c.env.DB.prepare(
    'SELECT code_verifier, created_at FROM oauth_states WHERE state = ?'
  ).bind(state).first<{ code_verifier: string; created_at: string }>();

  if (!stored) {
    return c.json({ error: 'Invalid or expired state' }, 400);
  }

  // Enforce state TTL (10 minutes)
  const stateAge = Date.now() - new Date(stored.created_at).getTime();
  if (stateAge > STATE_TTL_MS) {
    await c.env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
    return c.json({ error: 'State expired. Please re-authorize.' }, 400);
  }

  // Exchange code for token
  const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${c.env.X_CLIENT_ID}:${c.env.X_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: c.env.X_CALLBACK_URL,
      code_verifier: stored.code_verifier,
    }),
  });

  const tokenData = await tokenResponse.json() as any;

  if (tokenData.error) {
    return c.json({ error: tokenData.error, description: tokenData.error_description }, 400);
  }

  // Cleanup used state
  await c.env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();

  // Store tokens in D1 (tokens never exposed to client after this)
  if (tokenData.refresh_token) {
    await c.env.DB.prepare(
      'INSERT OR REPLACE INTO tokens (scope, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(
      'default',
      tokenData.access_token,
      tokenData.refresh_token,
      new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    ).run();
  }

  // Do NOT return access_token to the client for security.
  // Client should use server-managed tokens via this API.
  return c.json({
    success: true,
    message: 'Authorization successful. Tokens stored securely.',
    expires_in: tokenData.expires_in,
    scope: tokenData.scope,
  });
});

// Refresh token (with rotation — old refresh token is invalidated by X API)
authRouter.post('/refresh', async (c) => {
  const stored = await c.env.DB.prepare(
    'SELECT access_token, refresh_token, expires_at FROM tokens WHERE scope = ?'
  ).bind('default').first<{ access_token: string; refresh_token: string; expires_at: string }>();

  if (!stored || !stored.refresh_token) {
    return c.json({ error: 'No refresh token stored. Please authorize first.' }, 400);
  }

  const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${c.env.X_CLIENT_ID}:${c.env.X_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
    }),
  });

  const tokenData = await tokenResponse.json() as any;

  if (tokenData.error) {
    // If refresh token is invalid, clear stored tokens to force re-auth
    if (tokenData.error === 'invalid_grant') {
      await c.env.DB.prepare('DELETE FROM tokens WHERE scope = ?').bind('default').run();
      return c.json({ error: 'Refresh token expired or revoked. Please re-authorize.', reauth_required: true }, 401);
    }
    return c.json({ error: tokenData.error }, 400);
  }

  // Token Rotation: X API issues a new refresh_token on each refresh.
  // Store the new pair and the old one is automatically invalidated.
  await c.env.DB.prepare(
    'UPDATE tokens SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ? WHERE scope = ?'
  ).bind(
    tokenData.access_token,
    tokenData.refresh_token,
    new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
    new Date().toISOString(),
    'default'
  ).run();

  return c.json({
    success: true,
    message: 'Token refreshed successfully.',
    expires_in: tokenData.expires_in,
  });
});

// Token status check (no sensitive data exposed)
authRouter.get('/status', async (c) => {
  const stored = await c.env.DB.prepare(
    'SELECT scope, expires_at, updated_at FROM tokens WHERE scope = ?'
  ).bind('default').first<{ scope: string; expires_at: string; updated_at: string }>();

  if (!stored) {
    return c.json({ authenticated: false, message: 'No tokens stored. Please authorize.' });
  }

  const expiresAt = new Date(stored.expires_at);
  const isExpired = expiresAt <= new Date();
  const expiresInMs = expiresAt.getTime() - Date.now();

  return c.json({
    authenticated: !isExpired,
    expires_at: stored.expires_at,
    expires_in_seconds: Math.max(0, Math.floor(expiresInMs / 1000)),
    needs_refresh: isExpired || expiresInMs < 5 * 60 * 1000, // <5min remaining
    updated_at: stored.updated_at,
  });
});

// --- PKCE Helpers ---
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64URLEncode(new Uint8Array(digest));
}

function base64URLEncode(buffer: Uint8Array): string {
  let str = '';
  buffer.forEach((byte) => (str += String.fromCharCode(byte)));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
