/**
 * x-harness API Client
 *
 * Dual Authentication:
 * 1. Worker Mode — API Key in localStorage (injected by AI agent via MCP)
 *    - No expiration, persistent across sessions
 *    - Uses Authorization: Bearer <HARNESS_API_KEY>
 * 2. OAuth Mode  — Access token in sessionStorage (manual browser auth)
 *    - Expires ~2h, cleared on tab close
 *    - Uses X-Access-Token header
 *
 * Security practices:
 * - Token masked in logs (dev mode only)
 * - Auto token refresh before expiry (OAuth mode)
 * - Input validation before API calls
 */

// ─── Types ───────────────────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface EngagementSummary {
  total_tweets: number;
  total_impressions: number;
  total_likes: number;
  total_retweets: number;
  total_replies: number;
  avg_engagement_rate: number;
}

export interface FollowerSnapshot {
  id: number;
  user_id: string;
  followers: number;
  following: number;
  snapshot_at: string;
}

export interface TweetLog {
  id: number;
  tweet_id: string;
  text: string;
  media_ids: string | null;
  impressions: number;
  likes: number;
  retweets: number;
  replies: number;
  created_at: string;
  deleted_at: string | null;
}

export interface ScheduledTweet {
  id: number;
  text: string;
  media_ids: string | null;
  scheduled_at: string;
  status: string;
  tweet_id: string | null;
  error: string | null;
  created_at: string;
}

export interface XUserProfile {
  id: string;
  name: string;
  username: string;
  description?: string;
  created_at?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
}

// ─── Constants ───────────────────────────────────────────────
const TOKEN_KEY = 'xh_access_token';
const TOKEN_EXPIRY_KEY = 'xh_token_expires';
const API_KEY_STORAGE = 'xh_api_key';
const WORKER_URL_STORAGE = 'xh_worker_url';
const MAX_TWEET_LENGTH = 280;

// ─── Helpers ─────────────────────────────────────────────────
function sanitizeInput(text: string): string {
  // Trim whitespace and remove null bytes (security measure)
  return text.trim().replace(/\0/g, '');
}

function validateTweetText(text: string): string | null {
  if (!text || text.trim().length === 0) return 'Tweet text cannot be empty';
  if (text.length > MAX_TWEET_LENGTH) return `Tweet exceeds ${MAX_TWEET_LENGTH} character limit`;
  return null;
}

// ─── Worker Mode (API Key) Management ────────────────────────
export function getApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function getWorkerUrl(): string | null {
  try {
    return localStorage.getItem(WORKER_URL_STORAGE);
  } catch {
    return null;
  }
}

export function storeApiKey(apiKey: string, workerUrl?: string): void {
  try {
    localStorage.setItem(API_KEY_STORAGE, apiKey);
    if (workerUrl) {
      localStorage.setItem(WORKER_URL_STORAGE, workerUrl);
    }
  } catch {
    console.error('Failed to store API key in localStorage');
  }
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE);
    localStorage.removeItem(WORKER_URL_STORAGE);
  } catch {
    // Silently fail
  }
}

export function isWorkerMode(): boolean {
  return !!getApiKey();
}

// ─── OAuth Token Management ─────────────────────────────────
export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(accessToken: string, expiresIn: number): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, accessToken);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    sessionStorage.setItem(TOKEN_EXPIRY_KEY, expiresAt);
  } catch {
    console.error('Failed to store token in sessionStorage');
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch {
    // Silently fail
  }
}

export function isTokenExpired(): boolean {
  try {
    const expiresAt = sessionStorage.getItem(TOKEN_EXPIRY_KEY);
    if (!expiresAt) return true;
    return new Date(expiresAt) <= new Date();
  } catch {
    return true;
  }
}

// ─── Unified Auth Check ──────────────────────────────────────
export function isAuthenticated(): boolean {
  // Worker mode: API Key exists (no expiration)
  if (isWorkerMode()) return true;
  // OAuth mode: token exists and not expired
  return !!getStoredToken() && !isTokenExpired();
}

// ─── API Client ──────────────────────────────────────────────
async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  requireAuth = true
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (requireAuth) {
    const apiKey = getApiKey();

    if (apiKey) {
      // ── Worker Mode: Bearer Token ──
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      // ── OAuth Mode: X-Access-Token ──
      const token = getStoredToken();
      if (!token) {
        throw new Error('Not authenticated. Please connect your X account first.');
      }
      if (isTokenExpired()) {
        try {
          await refreshToken();
        } catch {
          clearToken();
          throw new Error('Session expired. Please re-authenticate.');
        }
      }
      headers['X-Access-Token'] = getStoredToken()!;
    }
  }

  const response = await fetch(path, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers as Record<string, string>),
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({
      error: `HTTP ${response.status}: ${response.statusText}`,
    })) as { error?: string };
    throw new Error(errorBody.error || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// ─── Auth Endpoints ──────────────────────────────────────────
export async function getAuthUrl(): Promise<{ authorize_url: string; state: string }> {
  const res = await apiRequest<ApiResponse<never> & { authorize_url: string; state: string }>(
    '/api/auth/authorize',
    {},
    false
  );
  return { authorize_url: res.authorize_url, state: res.state };
}

export async function refreshToken(): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const res = await apiRequest<
    ApiResponse<never> & { access_token: string; expires_in: number }
  >('/api/auth/refresh', { method: 'POST' }, false);

  if (res.access_token) {
    storeToken(res.access_token, res.expires_in);
  }

  return { access_token: res.access_token, expires_in: res.expires_in };
}

// ─── Tweet Endpoints ─────────────────────────────────────────
export async function createTweet(
  text: string,
  mediaIds?: string[]
): Promise<ApiResponse<{ id: string; text: string }>> {
  const sanitized = sanitizeInput(text);
  const error = validateTweetText(sanitized);
  if (error) throw new Error(error);

  return apiRequest('/api/tweets', {
    method: 'POST',
    body: JSON.stringify({
      text: sanitized,
      media_ids: mediaIds,
    }),
  });
}

export async function createThread(
  tweets: string[]
): Promise<ApiResponse<{ id: string; text: string }[]>> {
  if (tweets.length < 2) throw new Error('Threads need at least 2 tweets');
  
  const sanitized = tweets.map(sanitizeInput);
  for (const t of sanitized) {
    const error = validateTweetText(t);
    if (error) throw new Error(`Thread tweet error: ${error}`);
  }

  return apiRequest('/api/tweets/thread', {
    method: 'POST',
    body: JSON.stringify({ tweets: sanitized }),
  });
}

export async function deleteTweet(tweetId: string): Promise<ApiResponse<never>> {
  if (!tweetId || !/^\d+$/.test(tweetId)) throw new Error('Invalid tweet ID');
  return apiRequest(`/api/tweets/${encodeURIComponent(tweetId)}`, {
    method: 'DELETE',
  });
}

export async function scheduleTweet(
  text: string,
  scheduledAt: string,
  mediaIds?: string[],
  tweets?: string[]
): Promise<ApiResponse<never>> {
  const sanitized = sanitizeInput(text);
  const error = validateTweetText(sanitized);
  if (error) throw new Error(error);

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) throw new Error('Invalid date format');
  if (scheduledDate <= new Date()) throw new Error('Scheduled time must be in the future');

  return apiRequest('/api/tweets/schedule', {
    method: 'POST',
    body: JSON.stringify({
      text: sanitized,
      scheduled_at: scheduledAt,
      media_ids: mediaIds,
      tweets: tweets?.map(t => sanitizeInput(t)),
    }),
  });
}

export async function getScheduledTweets(): Promise<
  ApiResponse<ScheduledTweet[]>
> {
  return apiRequest('/api/tweets/scheduled');
}

export async function getTweetLogs(
  limit = 50,
  offset = 0
): Promise<ApiResponse<TweetLog[]>> {
  return apiRequest(
    `/api/tweets/logs?limit=${Math.min(limit, 200)}&offset=${Math.max(offset, 0)}`
  );
}

// ─── Analytics Endpoints ─────────────────────────────────────
export async function getTweetAnalytics(
  tweetId: string
): Promise<ApiResponse<unknown>> {
  if (!tweetId) throw new Error('Tweet ID required');
  return apiRequest(`/api/analytics/tweets/${encodeURIComponent(tweetId)}`);
}

export async function snapshotFollowers(): Promise<
  ApiResponse<{ user_id: string; followers: number; following: number }>
> {
  return apiRequest('/api/analytics/followers/snapshot', { method: 'POST' });
}

export async function getFollowerTrend(
  days = 30
): Promise<ApiResponse<FollowerSnapshot[]>> {
  return apiRequest(
    `/api/analytics/followers/trend?days=${Math.min(Math.max(days, 1), 365)}`
  );
}

export async function getEngagementSummary(): Promise<
  ApiResponse<EngagementSummary>
> {
  return apiRequest('/api/analytics/engagement/summary');
}

// ─── Bookmark Endpoints ──────────────────────────────────────
export async function syncBookmarks(): Promise<ApiResponse<never> & { synced: number }> {
  return apiRequest('/api/bookmarks/sync', { method: 'POST' });
}

export async function getBookmarks(folderId?: number): Promise<ApiResponse<any[]>> {
  const query = folderId ? `?folder_id=${folderId}` : '';
  return apiRequest(`/api/bookmarks${query}`);
}

export async function getBookmarkFolders(): Promise<ApiResponse<any[]>> {
  return apiRequest('/api/bookmarks/folders');
}

export async function createBookmarkFolder(data: {
  name: string;
  icon?: string;
  color?: string;
  auto_rule?: string;
}): Promise<ApiResponse<never>> {
  // Security: validate folder name
  if (!data.name || data.name.trim().length === 0) throw new Error('フォルダ名を入力してください');
  if (data.name.length > 50) throw new Error('フォルダ名は50文字以内にしてください');

  return apiRequest('/api/bookmarks/folders', {
    method: 'POST',
    body: JSON.stringify({
      name: data.name.trim(),
      icon: data.icon || '📁',
      color: data.color || '#3b82f6',
      auto_rule: data.auto_rule?.trim() || null,
    }),
  });
}

export async function analyzeBatch(): Promise<ApiResponse<never> & { analyzed: number }> {
  return apiRequest('/api/bookmarks/analyze-batch', { method: 'POST' });
}

export async function getSkills(): Promise<ApiResponse<any[]>> {
  return apiRequest('/api/bookmarks/skills');
}

export async function extractSkills(): Promise<ApiResponse<never> & { extracted: number }> {
  return apiRequest('/api/bookmarks/extract-skills', { method: 'POST' });
}

export async function getWorkflows(): Promise<ApiResponse<any[]>> {
  return apiRequest('/api/bookmarks/workflows');
}

export async function generateWorkflows(): Promise<ApiResponse<never> & { generated: number }> {
  return apiRequest('/api/bookmarks/generate-workflows', { method: 'POST' });
}

export async function updateWorkflowStatus(
  id: number,
  status: 'approved' | 'rejected'
): Promise<ApiResponse<never>> {
  return apiRequest(`/api/bookmarks/workflows/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

// ─── Usage Endpoints ─────────────────────────────────────────
export async function getUsageSummary(): Promise<ApiResponse<any>> {
  return apiRequest('/api/usage/summary');
}

export async function getUsageDaily(days = 30): Promise<ApiResponse<any[]>> {
  return apiRequest(`/api/usage/daily?days=${days}`);
}

export async function getUsageByEndpoint(): Promise<ApiResponse<any[]>> {
  return apiRequest('/api/usage/by-endpoint');
}

export async function getAlertSettings(): Promise<ApiResponse<any[]>> {
  return apiRequest('/api/usage/alerts');
}

export async function updateAlertSetting(
  id: number,
  data: { enabled?: boolean; channel?: string; webhook_url?: string }
): Promise<ApiResponse<never>> {
  return apiRequest(`/api/usage/alerts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function getAlertLogs(): Promise<ApiResponse<any[]>> {
  return apiRequest('/api/usage/alert-logs');
}

export async function testWebhook(webhookUrl: string): Promise<ApiResponse<never>> {
  return apiRequest('/api/usage/test-webhook', {
    method: 'POST',
    body: JSON.stringify({ webhook_url: webhookUrl }),
  });
}

// ─── Scheduled Actions ───────────────────────────────────────
export async function scheduleAction(
  actionType: string,
  targetTweetId: string,
  scheduledAt: string
): Promise<ApiResponse<never>> {
  if (!targetTweetId || !/^\d+$/.test(targetTweetId)) throw new Error('Invalid tweet ID');
  const d = new Date(scheduledAt);
  if (isNaN(d.getTime()) || d <= new Date()) throw new Error('日時は未来を指定してください');

  return apiRequest('/api/tweets/schedule-action', {
    method: 'POST',
    body: JSON.stringify({
      action_type: actionType,
      target_tweet_id: targetTweetId,
      scheduled_at: scheduledAt,
    }),
  });
}

export async function getScheduledActions(): Promise<ApiResponse<any[]>> {
  return apiRequest('/api/tweets/scheduled-actions');
}

export async function cancelScheduledAction(id: number): Promise<ApiResponse<never>> {
  return apiRequest(`/api/tweets/scheduled-actions/${id}`, { method: 'DELETE' });
}

// ─── Writing Rules Endpoints ─────────────────────────────────
export async function getWritingRules(): Promise<ApiResponse<any[]>> {
  return apiRequest('/api/writing-rules');
}

export async function getWritingRule(id: number): Promise<ApiResponse<any>> {
  return apiRequest(`/api/writing-rules/${id}`);
}

export async function createWritingRule(data: any): Promise<ApiResponse<never>> {
  return apiRequest('/api/writing-rules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateWritingRule(id: number, data: any): Promise<ApiResponse<never>> {
  return apiRequest(`/api/writing-rules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteWritingRule(id: number): Promise<ApiResponse<never>> {
  return apiRequest(`/api/writing-rules/${id}`, { method: 'DELETE' });
}

export async function setDefaultWritingRule(id: number): Promise<ApiResponse<never>> {
  return apiRequest(`/api/writing-rules/${id}/default`, { method: 'PUT' });
}

// ─── Sync Endpoints ──────────────────────────────────────────
export async function getSyncStatus(): Promise<any> {
  return apiRequest('/api/sync/status');
}

export async function triggerSync(): Promise<any> {
  return apiRequest('/api/sync/export?modules=tweets,analytics,writing-rules,usage');
}

// ─── Scheduled Tweet Edit/Cancel ─────────────────────────────
export async function updateScheduledTweet(id: number, data: { text?: string; scheduled_at?: string; tweets?: string[] }): Promise<ApiResponse<never>> {
  return apiRequest(`/api/tweets/scheduled/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function cancelScheduledTweet(id: number): Promise<ApiResponse<never>> {
  return apiRequest(`/api/tweets/scheduled/${id}`, { method: 'DELETE' });
}

// ─── Metrics Refresh ─────────────────────────────────────────
export async function refreshTweetMetrics(): Promise<ApiResponse<{ updated: number }>> {
  return apiRequest('/api/tweets/refresh-metrics', { method: 'POST' });
}

// ─── DM Endpoints ────────────────────────────────────────────
export async function getDmEvents(maxResults = 20): Promise<ApiResponse<any>> {
  return apiRequest(`/api/dm/events?max_results=${maxResults}`);
}

export async function resolveUsers(userIds: string[]): Promise<ApiResponse<any[]>> {
  if (!userIds.length) return { success: true, data: [] };
  // Security: validate IDs are numeric
  const validIds = userIds.filter(id => /^\d+$/.test(id));
  if (!validIds.length) return { success: true, data: [] };
  return apiRequest('/api/dm/resolve-users', {
    method: 'POST',
    body: JSON.stringify({ user_ids: validIds }),
  });
}

export async function getDmConversation(participantId: string, maxResults = 20): Promise<ApiResponse<any>> {
  return apiRequest(`/api/dm/conversations/${participantId}?max_results=${maxResults}`);
}

export async function sendDm(participantId: string, text: string): Promise<ApiResponse<any>> {
  return apiRequest(`/api/dm/send/${participantId}`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

// ─── DM Templates ────────────────────────────────────────────
export async function getDmTemplates(): Promise<ApiResponse<any[]>> {
  return apiRequest('/api/dm/templates');
}

export async function createDmTemplate(data: { name: string; text: string; category?: string }): Promise<ApiResponse<never>> {
  return apiRequest('/api/dm/templates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateDmTemplate(id: number, data: { name?: string; text?: string; category?: string }): Promise<ApiResponse<never>> {
  return apiRequest(`/api/dm/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteDmTemplate(id: number): Promise<ApiResponse<never>> {
  return apiRequest(`/api/dm/templates/${id}`, { method: 'DELETE' });
}

export async function sendDmWithTemplate(templateId: number, participantId: string): Promise<ApiResponse<any>> {
  return apiRequest(`/api/dm/templates/${templateId}/send/${participantId}`, { method: 'POST' });
}

// ─── DM Auto-Reply ───────────────────────────────────────────
export async function getDmAutoReplies(): Promise<ApiResponse<any[]>> {
  return apiRequest('/api/dm/auto-replies');
}

export async function createDmAutoReply(data: { name: string; trigger_value: string; reply_text?: string; reply_template_id?: number }): Promise<ApiResponse<never>> {
  return apiRequest('/api/dm/auto-replies', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateDmAutoReply(id: number, data: { name?: string; trigger_value?: string; reply_text?: string; enabled?: boolean }): Promise<ApiResponse<never>> {
  return apiRequest(`/api/dm/auto-replies/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteDmAutoReply(id: number): Promise<ApiResponse<never>> {
  return apiRequest(`/api/dm/auto-replies/${id}`, { method: 'DELETE' });
}

// ─── DM Cache ─────────────────────────────────────────────────
export async function syncDmEvents(maxResults = 50): Promise<ApiResponse<{ synced: number; total: number }>> {
  return apiRequest(`/api/dm/sync?max_results=${maxResults}`, { method: 'POST' });
}

export async function getCachedDmEvents(limit = 100): Promise<ApiResponse<any[]>> {
  return apiRequest(`/api/dm/cached-events?limit=${limit}`);
}

export async function getCachedDmUsers(): Promise<ApiResponse<any[]>> {
  return apiRequest('/api/dm/cached-users');
}

// ─── Workflow Templates ───────────────────────────────────────
export async function getWorkflowTemplates(): Promise<ApiResponse<any[]>> {
  return apiRequest('/api/bookmarks/workflow-templates');
}

export async function updateWorkflowTemplate(id: number, data: { enabled?: boolean; writing_rule_id?: number | null }): Promise<ApiResponse<never>> {
  return apiRequest(`/api/bookmarks/workflow-templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
