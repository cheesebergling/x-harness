/**
 * x-harness MCP Server v0.6.0
 * Claude Code / Antigravity / VS Code から x-harness API を操作するための MCP Server
 *
 * 環境変数:
 *   X_HARNESS_URL      — Worker の公開URL (例: https://x-harness.xxx.workers.dev)
 *   X_HARNESS_API_KEY  — HARNESS_API_KEY と同じ値
 *   X_HARNESS_SYNC_DIR — (optional) ローカル同期先ディレクトリ
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SyncEngine } from "./sync-engine.js";

const HARNESS_URL = process.env.X_HARNESS_URL || "http://localhost:8787";
const API_KEY = process.env.X_HARNESS_API_KEY || "";
const DEFAULT_SYNC_DIR = process.env.X_HARNESS_SYNC_DIR || "";

// ─── HTTP Client ───

async function api(path: string, options?: RequestInit): Promise<any> {
  const url = `${HARNESS_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...(options?.headers || {}),
    },
  });
  return res.json();
}

// ─── Sync Engine Instance ───

const syncEngine = new SyncEngine(HARNESS_URL, API_KEY);

// ─── MCP Server ───

const server = new McpServer({
  name: "x-harness",
  version: "0.6.0",
});

// ════════════════════════════════════════════════════
//  Auth Tools
// ════════════════════════════════════════════════════

server.tool(
  "get_auth_status",
  "X API の認証状態を確認する",
  {},
  async () => {
    const result = await api("/api/auth/status");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "get_auth_url",
  "OAuth 2.0 認証URLを取得する（初回セットアップ用）",
  {},
  async () => {
    const result = await api("/api/auth/authorize");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// ════════════════════════════════════════════════════
//  Tweet Tools
// ════════════════════════════════════════════════════

server.tool(
  "post_tweet",
  "ツイートを投稿する",
  { text: z.string().describe("ツイート本文（280文字以内）") },
  async ({ text }) => {
    const result = await api("/api/tweets", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "post_thread",
  "スレッド（複数ツイート）を投稿する",
  { tweets: z.array(z.string()).describe("各ツイートのテキスト配列") },
  async ({ tweets }) => {
    const result = await api("/api/tweets/thread", {
      method: "POST",
      body: JSON.stringify({ tweets: tweets.map((t) => ({ text: t })) }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "delete_tweet",
  "ツイートを削除する",
  { tweet_id: z.string().describe("削除するツイートID") },
  async ({ tweet_id }) => {
    const result = await api(`/api/tweets/${tweet_id}`, { method: "DELETE" });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "schedule_tweet",
  "ツイートを予約投稿する",
  {
    text: z.string().describe("ツイート本文"),
    scheduled_at: z.string().describe("投稿日時 (ISO 8601形式, 例: 2026-04-01T09:00:00Z)"),
  },
  async ({ text, scheduled_at }) => {
    const result = await api("/api/tweets/schedule", {
      method: "POST",
      body: JSON.stringify({ text, scheduled_at }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// ════════════════════════════════════════════════════
//  Analytics Tools
// ════════════════════════════════════════════════════

server.tool(
  "get_tweet_analytics",
  "特定ツイートの分析データ（インプレッション、エンゲージメント等）を取得する",
  { tweet_id: z.string().describe("ツイートID") },
  async ({ tweet_id }) => {
    const result = await api(`/api/analytics/tweets/${tweet_id}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "get_liking_users",
  "特定ツイートにいいねしたユーザー一覧を取得する",
  {
    tweet_id: z.string().describe("ツイートID"),
    max_results: z.number().optional().describe("取得件数（最大100）"),
  },
  async ({ tweet_id, max_results }) => {
    const q = max_results ? `?max_results=${max_results}` : "";
    const result = await api(`/api/analytics/tweets/${tweet_id}/liking-users${q}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "get_replies",
  "特定ツイートへの返信一覧を取得する",
  {
    tweet_id: z.string().describe("ツイートID"),
    max_results: z.number().optional().describe("取得件数（最大100）"),
  },
  async ({ tweet_id, max_results }) => {
    const q = max_results ? `?max_results=${max_results}` : "";
    const result = await api(`/api/analytics/tweets/${tweet_id}/replies${q}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "get_followers_trend",
  "フォロワー数の推移データを取得する",
  { days: z.number().optional().describe("過去N日分（デフォルト30）") },
  async ({ days }) => {
    const q = days ? `?days=${days}` : "";
    const result = await api(`/api/analytics/followers/trend${q}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// ════════════════════════════════════════════════════
//  Direct Message Tools
// ════════════════════════════════════════════════════

server.tool(
  "get_dm_events",
  "DM一覧を取得する",
  { max_results: z.number().optional().describe("取得件数（最大100）") },
  async ({ max_results }) => {
    const q = max_results ? `?max_results=${max_results}` : "";
    const result = await api(`/api/dm/events${q}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "send_dm",
  "特定ユーザーにDMを送信する（ステルス変換適用）",
  {
    participant_id: z.string().describe("送信先ユーザーID"),
    text: z.string().describe("DM本文"),
  },
  async ({ participant_id, text }) => {
    const result = await api(`/api/dm/send/${participant_id}`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "bulk_send_dm",
  "複数ユーザーにDMを一斉送信する（ステルスモード: ゴースト文字+文末変更+ランダム遅延）",
  {
    participant_ids: z.array(z.string()).describe("送信先ユーザーIDの配列（最大50件）"),
    text: z.string().describe("DM本文（各送信でステルス変換されるため、同一テキストでOK）"),
  },
  async ({ participant_ids, text }) => {
    const result = await api("/api/dm/bulk-send", {
      method: "POST",
      body: JSON.stringify({ participant_ids, text }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// ════════════════════════════════════════════════════
//  Usage & Cost Tools
// ════════════════════════════════════════════════════

server.tool(
  "get_usage_summary",
  "API使用量サマリーとコスト概算を取得する",
  {},
  async () => {
    const result = await api("/api/usage/summary");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// ════════════════════════════════════════════════════
//  Writing Rules Tools (NEW)
// ════════════════════════════════════════════════════

server.tool(
  "list_writing_rules",
  "ライティングルール一覧を取得する（トーン、ペルソナ、テンプレート等の投稿スタイル定義）",
  {},
  async () => {
    const result = await api("/api/writing-rules");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "get_writing_rule",
  "特定のライティングルールの詳細を取得する",
  { rule_id: z.number().describe("ルールID") },
  async ({ rule_id }) => {
    const result = await api(`/api/writing-rules/${rule_id}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "save_writing_rule",
  "ライティングルールを作成・更新する。tone/persona/constraints/templates/examples を定義してX投稿のスタイルを統一する",
  {
    name: z.string().describe("ルール名（例: 'X投稿・カジュアル'）"),
    tone: z.enum(["casual", "professional", "provocative", "neutral", "friendly", "authoritative"])
      .optional().describe("トーン"),
    persona: z.string().optional().describe("ペルソナ説明（例: '30代マーケター目線'）"),
    constraints: z.object({
      max_chars: z.number().optional(),
      forbidden_words: z.array(z.string()).optional(),
      hashtag_rules: z.object({
        max: z.number().optional(),
        position: z.string().optional(),
      }).optional(),
      emoji_usage: z.string().optional(),
    }).optional().describe("制約条件（文字数制限、禁止ワード、ハッシュタグルール等）"),
    templates: z.array(z.string()).optional().describe("テンプレート配列"),
    examples: z.object({
      good: z.array(z.string()).optional(),
      bad: z.array(z.string()).optional(),
    }).optional().describe("良い例・悪い例"),
    is_default: z.boolean().optional().describe("デフォルトルールに設定するか"),
    rule_id: z.number().optional().describe("更新時のルールID（省略で新規作成）"),
  },
  async ({ name, tone, persona, constraints, templates, examples, is_default, rule_id }) => {
    const body: any = { name, tone, persona, constraints, templates, examples, is_default };

    // Remove undefined values
    for (const key of Object.keys(body)) {
      if (body[key] === undefined) delete body[key];
    }

    let result;
    if (rule_id) {
      result = await api(`/api/writing-rules/${rule_id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    } else {
      result = await api("/api/writing-rules", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "delete_writing_rule",
  "ライティングルールを削除する",
  { rule_id: z.number().describe("削除するルールID") },
  async ({ rule_id }) => {
    const result = await api(`/api/writing-rules/${rule_id}`, { method: "DELETE" });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "set_default_writing_rule",
  "指定したルールをデフォルトのライティングルールに設定する",
  { rule_id: z.number().describe("デフォルトに設定するルールID") },
  async ({ rule_id }) => {
    const result = await api(`/api/writing-rules/${rule_id}/default`, { method: "PUT" });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// ════════════════════════════════════════════════════
//  Local Sync Tools (NEW)
// ════════════════════════════════════════════════════

server.tool(
  "configure_sync",
  "ローカル同期先フォルダを設定する。指定したディレクトリに tweets/analytics/writing-rules のデータを定期保存できるようになる",
  {
    sync_dir: z.string().describe("同期先フォルダの絶対パス（例: C:/Users/me/x-harness-data）"),
    auto_sync_minutes: z.number().optional().describe("自動同期間隔（分、デフォルト30）"),
    modules: z.array(z.string()).optional().describe("同期するモジュール: tweets, analytics, writing-rules, usage"),
  },
  async ({ sync_dir, auto_sync_minutes, modules }) => {
    try {
      const config = await syncEngine.initSync(sync_dir);

      if (auto_sync_minutes !== undefined) {
        config.autoSyncIntervalMinutes = Math.max(5, Math.min(1440, auto_sync_minutes));
      }
      if (modules) {
        const valid = ['tweets', 'analytics', 'writing-rules', 'usage'];
        config.enabledModules = modules.filter((m) => valid.includes(m));
      }

      // Re-init with updated config
      await syncEngine.initSync(config.syncDir);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message: `Sync configured: ${config.syncDir}`,
            config,
          }, null, 2),
        }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: e.message }, null, 2) }],
      };
    }
  },
);

server.tool(
  "sync_now",
  "ローカルフォルダにデータを即時同期する。Worker APIからtweets/analytics/writing-rules/usageを取得してローカル保存する",
  {
    sync_dir: z.string().optional()
      .describe("同期先フォルダ（configure_sync済みなら省略可、環境変数 X_HARNESS_SYNC_DIR も利用可）"),
  },
  async ({ sync_dir }) => {
    const dir = sync_dir || DEFAULT_SYNC_DIR;
    if (!dir) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ error: "sync_dir が未設定です。configure_sync を先に実行してください。" }),
        }],
      };
    }

    try {
      // Auto-initialize if needed
      if (!syncEngine.getSyncStatus(dir).configured) {
        await syncEngine.initSync(dir);
      }

      const result = await syncEngine.syncAll(dir);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: e.message }, null, 2) }],
      };
    }
  },
);

server.tool(
  "get_sync_status",
  "ローカル同期の状態を確認する（最終同期時刻、ファイル数、設定内容）",
  {
    sync_dir: z.string().optional()
      .describe("同期先フォルダ（環境変数 X_HARNESS_SYNC_DIR も利用可）"),
  },
  async ({ sync_dir }) => {
    const dir = sync_dir || DEFAULT_SYNC_DIR;
    if (!dir) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ configured: false, error: "sync_dir が未設定です" }),
        }],
      };
    }

    const status = syncEngine.getSyncStatus(dir);

    // Check if auto-sync is needed
    if (status.configured) {
      const needsSync = syncEngine.shouldAutoSync(dir);
      (status as any).auto_sync_needed = needsSync;

      // Auto-sync if overdue (Option A: passive auto-sync)
      if (needsSync) {
        try {
          const syncResult = await syncEngine.syncAll(dir);
          (status as any).auto_sync_result = syncResult;
        } catch (e: any) {
          (status as any).auto_sync_error = e.message;
        }
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
    };
  },
);

// ─── Start Server ───

const transport = new StdioServerTransport();
await server.connect(transport);
