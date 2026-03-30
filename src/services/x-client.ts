import type { Env } from '../index';
import { AlertService } from './alert-service';

const X_API_BASE = 'https://api.x.com/2';

interface TweetPayload {
  text: string;
  media?: { media_ids: string[] };
  reply?: { in_reply_to_tweet_id: string };
}

/** Custom error that carries the X API HTTP status code */
export class XApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'XApiError';
    this.status = status;
  }
}

export class XClient {
  private env: Env;
  private alertService: AlertService;

  constructor(env: Env) {
    this.env = env;
    this.alertService = new AlertService(env);
  }

  private async request(token: string, path: string, options: RequestInit = {}): Promise<any> {
    const url = `${X_API_BASE}${path}`;
    const method = (options.method || 'GET').toUpperCase();
    const startTime = Date.now();

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const elapsed = Date.now() - startTime;

    // 使用量を非同期で記録（レスポンスをブロックしない）
    this.alertService.logApiCall(path, method, response.status, elapsed).catch(console.error);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ detail: response.statusText })) as any;

      // X API returns errors in multiple formats:
      // 1. { detail: "...", title: "..." }
      // 2. { errors: [{ message: "...", parameters: {...} }] }
      let message: string;
      if (errorBody.errors && Array.isArray(errorBody.errors)) {
        const msgs = errorBody.errors.map((e: any) => {
          const params = e.parameters ? ` (params: ${JSON.stringify(e.parameters)})` : '';
          return `${e.message}${params}`;
        });
        message = msgs.join('; ');
      } else {
        message = errorBody.detail || errorBody.title || `X API Error: ${response.status}`;
      }

      console.error(`[XClient] ${method} ${path} → ${response.status}: ${message}`);
      throw new XApiError(message, response.status);
    }

    return response.json();
  }

  // --- Tweets ---

  async createTweet(token: string, payload: TweetPayload) {
    return this.request(token, '/tweets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async deleteTweet(token: string, tweetId: string) {
    return this.request(token, `/tweets/${tweetId}`, { method: 'DELETE' });
  }

  async getUserTweets(token: string, userId: string, maxResults = 10) {
    return this.request(
      token,
      `/users/${userId}/tweets?max_results=${maxResults}&tweet.fields=created_at,public_metrics,attachments`
    );
  }

  async searchTweets(token: string, query: string, maxResults = 10) {
    return this.request(
      token,
      `/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${maxResults}&tweet.fields=created_at,public_metrics`
    );
  }

  // --- Analytics ---

  async getTweetAnalytics(token: string, tweetId: string) {
    return this.request(
      token,
      `/tweets?ids=${tweetId}&tweet.fields=public_metrics,created_at,non_public_metrics,organic_metrics`
    );
  }

  /** Batch fetch metrics for multiple tweets (max 100 IDs comma-separated) */
  async getTweetMetricsBatch(token: string, tweetIds: string) {
    return this.request(
      token,
      `/tweets?ids=${tweetIds}&tweet.fields=public_metrics,non_public_metrics,organic_metrics,created_at`
    );
  }

  // --- Users ---

  async getMe(token: string) {
    return this.request(token, '/users/me?user.fields=public_metrics,created_at,description');
  }

  async getUser(token: string, userId: string) {
    return this.request(token, `/users/${userId}?user.fields=public_metrics,created_at`);
  }

  async getFollowers(token: string, userId: string, maxResults = 100) {
    return this.request(
      token,
      `/users/${userId}/followers?max_results=${maxResults}&user.fields=public_metrics`
    );
  }

  async getFollowing(token: string, userId: string, maxResults = 100) {
    return this.request(
      token,
      `/users/${userId}/following?max_results=${maxResults}&user.fields=public_metrics`
    );
  }

  // --- Engagement ---

  async likeTweet(token: string, userId: string, tweetId: string) {
    return this.request(token, `/users/${userId}/likes`, {
      method: 'POST',
      body: JSON.stringify({ tweet_id: tweetId }),
    });
  }

  async unlikeTweet(token: string, userId: string, tweetId: string) {
    return this.request(token, `/users/${userId}/likes/${tweetId}`, { method: 'DELETE' });
  }

  async retweet(token: string, userId: string, tweetId: string) {
    return this.request(token, `/users/${userId}/retweets`, {
      method: 'POST',
      body: JSON.stringify({ tweet_id: tweetId }),
    });
  }

  async unretweet(token: string, userId: string, tweetId: string) {
    return this.request(token, `/users/${userId}/retweets/${tweetId}`, { method: 'DELETE' });
  }

  async getMentions(token: string, userId: string, maxResults = 10) {
    return this.request(
      token,
      `/users/${userId}/mentions?max_results=${maxResults}&tweet.fields=created_at,public_metrics`
    );
  }

  // --- Bookmarks ---

  async getBookmarks(token: string, maxResults = 20) {
    // X API v2: 先にユーザーID取得
    const me = await this.getMe(token);
    const userId = me.data.id;
    // X API Bookmarks: max_results range is 1-100
    const clampedMax = Math.max(1, Math.min(maxResults, 100));

    // Try with expansions first (Pro/Enterprise), fall back to minimal params (Free/Basic)
    try {
      return await this.request(
        token,
        `/users/${userId}/bookmarks?max_results=${clampedMax}&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username`
      );
    } catch (err: any) {
      // If parameter error, retry without expansions
      if (err.message?.includes('parameter') || err.status === 400) {
        console.log('[XClient] Bookmarks: falling back to minimal params');
        return this.request(
          token,
          `/users/${userId}/bookmarks?max_results=${clampedMax}&tweet.fields=created_at,public_metrics,author_id`
        );
      }
      throw err;
    }
  }

  async addBookmark(token: string, userId: string, tweetId: string) {
    return this.request(token, `/users/${userId}/bookmarks`, {
      method: 'POST',
      body: JSON.stringify({ tweet_id: tweetId }),
    });
  }

  async removeBookmark(token: string, userId: string, tweetId: string) {
    return this.request(token, `/users/${userId}/bookmarks/${tweetId}`, { method: 'DELETE' });
  }

  // --- Trends ---

  async getTrends(token: string) {
    return this.request(token, '/trends/personalized');
  }

  // --- Direct Messages ---

  /** Get all DM events for the authenticated user */
  async getDmEvents(token: string, maxResults = 20) {
    return this.request(
      token,
      `/dm_events?max_results=${maxResults}&dm_event.fields=id,text,event_type,created_at,sender_id,dm_conversation_id&expansions=sender_id&user.fields=username,name`
    );
  }

  /** Get DM events for a 1-on-1 conversation with a specific user */
  async getDmConversationWith(token: string, participantId: string, maxResults = 20) {
    return this.request(
      token,
      `/dm_conversations/with/${participantId}/dm_events?max_results=${maxResults}&dm_event.fields=id,text,event_type,created_at,sender_id`
    );
  }

  /** Get DM events for a specific conversation ID */
  async getDmConversationById(token: string, conversationId: string, maxResults = 20) {
    return this.request(
      token,
      `/dm_conversations/${conversationId}/dm_events?max_results=${maxResults}&dm_event.fields=id,text,event_type,created_at,sender_id`
    );
  }

  /** Send a DM to a specific user (1-on-1 conversation) */
  async sendDm(token: string, participantId: string, text: string) {
    return this.request(token, `/dm_conversations/with/${participantId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  // --- Likes Retrieval (per tweet ID) ---

  /** Get users who liked a specific tweet */
  async getLikingUsers(token: string, tweetId: string, maxResults = 100) {
    return this.request(
      token,
      `/tweets/${tweetId}/liking_users?max_results=${maxResults}&user.fields=public_metrics,username,name,profile_image_url`
    );
  }

  /** Get tweets liked by a specific user */
  async getLikedTweets(token: string, userId: string, maxResults = 20) {
    return this.request(
      token,
      `/users/${userId}/liked_tweets?max_results=${maxResults}&tweet.fields=created_at,public_metrics,author_id`
    );
  }

  // --- Replies Retrieval (per tweet ID) ---

  /** Get replies to a specific tweet via conversation_id search */
  async getReplies(token: string, tweetId: string, maxResults = 20) {
    // X API search/recent: max_results minimum is 10, maximum is 100
    const clampedMax = Math.max(10, Math.min(maxResults, 100));
    return this.request(
      token,
      `/tweets/search/recent?query=conversation_id:${tweetId}&max_results=${clampedMax}&tweet.fields=created_at,public_metrics,author_id,in_reply_to_user_id&expansions=author_id&user.fields=username,name`
    );
  }

  // --- User Lookup ---

  /** Batch lookup users by IDs (max 100) */
  async getUsersByIds(token: string, userIds: string[]) {
    if (!userIds.length) return { data: [] };
    // Security: validate all IDs are numeric
    const validIds = userIds.filter(id => /^\d+$/.test(id)).slice(0, 100);
    if (!validIds.length) return { data: [] };
    return this.request(
      token,
      `/users?ids=${validIds.join(',')}&user.fields=username,name,profile_image_url`
    );
  }
}
