import { Hono } from 'hono';
import type { Env } from '../index';
import { XClient } from '../services/x-client';
import { fireEvent } from '../services/event-bus';
import { stealthTransform, calculateDmDelay, sleep, StealthRateLimiter } from '../services/stealth';
import { resolveToken } from '../services/token-resolver';

export const dmRouter = new Hono<{ Bindings: Env }>();

const dmRateLimiter = new StealthRateLimiter(5, 900_000); // 5 DMs per 15min (conservative)

// ─── DM Events (全DM取得) ───

dmRouter.get('/events', async (c) => {
  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  const maxResults = Math.min(Number(c.req.query('max_results') || '20'), 100);

  try {
    const result = await client.getDmEvents(token, maxResults);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── DM キャッシュ: 同期（X API → D1） ───

dmRouter.post('/sync', async (c) => {
  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated' }, 401);

  const maxResults = Math.min(Number(c.req.query('max_results') || '50'), 100);

  try {
    // 1. X API からDMイベントを取得
    const result = await client.getDmEvents(token, maxResults);
    const events = result.data || [];
    let synced = 0;

    // 2. D1 に保存（upsert）
    for (const ev of events) {
      await c.env.DB.prepare(`
        INSERT INTO dm_events_cache (dm_event_id, sender_id, text, event_type, created_at, synced_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(dm_event_id) DO UPDATE SET
          text = excluded.text, synced_at = datetime('now')
      `).bind(
        ev.id,
        ev.sender_id || '',
        ev.text || '',
        ev.event_type || 'MessageCreate',
        ev.created_at || new Date().toISOString()
      ).run();
      synced++;
    }

    // 3. ユーザー情報もキャッシュ
    const senderIds = [...new Set(events.map((e: any) => e.sender_id).filter(Boolean))] as string[];
    if (senderIds.length > 0) {
      try {
        const validIds = senderIds.filter(id => /^\d+$/.test(id)).slice(0, 100);
        if (validIds.length > 0) {
          const usersResult = await client.getUsersByIds(token, validIds);
          for (const u of (usersResult.data || [])) {
            await c.env.DB.prepare(`
              INSERT INTO dm_users_cache (user_id, username, name, profile_image_url, updated_at)
              VALUES (?, ?, ?, ?, datetime('now'))
              ON CONFLICT(user_id) DO UPDATE SET
                username = excluded.username, name = excluded.name,
                profile_image_url = excluded.profile_image_url, updated_at = datetime('now')
            `).bind(u.id, u.username, u.name, u.profile_image_url || '').run();
          }
        }
      } catch (e) {
        console.error('Failed to cache user profiles:', e);
      }
    }

    return c.json({ success: true, synced, total: events.length });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── DM キャッシュ: D1から読み出し ───

dmRouter.get('/cached-events', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') || '100'), 500);
  const result = await c.env.DB.prepare(
    'SELECT * FROM dm_events_cache ORDER BY created_at DESC LIMIT ?'
  ).bind(limit).all();
  return c.json({ success: true, data: result.results });
});

// ─── DM キャッシュ: キャッシュ済みユーザー情報 ───

dmRouter.get('/cached-users', async (c) => {
  const result = await c.env.DB.prepare('SELECT * FROM dm_users_cache').all();
  return c.json({ success: true, data: result.results });
});

// ─── ユーザー情報バッチ取得 ───

dmRouter.post('/resolve-users', async (c) => {
  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated' }, 401);

  const body = await c.req.json<{ user_ids: string[] }>();
  if (!body.user_ids || !Array.isArray(body.user_ids)) {
    return c.json({ error: 'user_ids array required' }, 400);
  }
  // Security: only allow numeric IDs, max 100
  const validIds = body.user_ids.filter((id: string) => /^\d+$/.test(id)).slice(0, 100);
  if (validIds.length === 0) return c.json({ success: true, data: [] });

  try {
    const result = await client.getUsersByIds(token, validIds);
    return c.json({ success: true, data: result.data || [] });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── 特定ユーザーとの1対1 DM取得 ───

dmRouter.get('/conversations/:participantId', async (c) => {
  const participantId = c.req.param('participantId');
  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  const maxResults = Math.min(Number(c.req.query('max_results') || '20'), 100);

  try {
    const result = await client.getDmConversationWith(token, participantId, maxResults);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── 会話ID指定でDM取得 ───

dmRouter.get('/conversations/:conversationId/events', async (c) => {
  const conversationId = c.req.param('conversationId');
  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  const maxResults = Math.min(Number(c.req.query('max_results') || '20'), 100);

  try {
    const result = await client.getDmConversationById(token, conversationId, maxResults);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── DM 送信 (1対1) ───

dmRouter.post('/send/:participantId', async (c) => {
  const participantId = c.req.param('participantId');
  const body = await c.req.json<{ text: string }>();

  if (!body.text || body.text.trim().length === 0) {
    return c.json({ error: 'DM text is required' }, 400);
  }

  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  try {
    await dmRateLimiter.waitForSlot();

    // Stealth transform: ghost text + tail variation
    const stealthText = stealthTransform(body.text);

    const result = await client.sendDm(token, participantId, stealthText);

    // Log to D1
    await c.env.DB.prepare(
      'INSERT INTO dm_logs (conversation_id, participant_id, direction, text, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(null, participantId, 'sent', body.text, new Date().toISOString()).run();

    // Fire event
    await fireEvent(c.env.DB, {
      type: 'action_executed',
      data: { actionType: 'dm_sent', participantId },
      meta: { source: 'api', actionType: 'dm_sent' },
    });

    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── DM 一斉送信 (ステルスモード) ───
// LINE-harness パターン: ゴースト文字 + 文末変更 + ランダムタイミング

dmRouter.post('/bulk-send', async (c) => {
  const body = await c.req.json<{
    participant_ids: string[];
    text: string;
  }>();

  if (!body.text || body.text.trim().length === 0) {
    return c.json({ error: 'DM text is required' }, 400);
  }
  if (!body.participant_ids || body.participant_ids.length === 0) {
    return c.json({ error: 'At least one participant_id required' }, 400);
  }
  if (body.participant_ids.length > 50) {
    return c.json({ error: 'Maximum 50 recipients per bulk send' }, 400);
  }

  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  const results: { participantId: string; status: 'sent' | 'failed'; error?: string }[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < body.participant_ids.length; i++) {
    const participantId = body.participant_ids[i];

    try {
      // Rate limit check
      await dmRateLimiter.waitForSlot();

      // Randomized delay between DMs (3-15s, progressive slowdown)
      if (i > 0) {
        const delay = calculateDmDelay(i);
        console.log(`[DM Bulk] Waiting ${delay}ms before message ${i + 1}/${body.participant_ids.length}`);
        await sleep(delay);
      }

      // Each message gets unique stealth transformation
      const stealthText = stealthTransform(body.text);

      await client.sendDm(token, participantId, stealthText);

      // Log
      await c.env.DB.prepare(
        'INSERT INTO dm_logs (participant_id, direction, text, created_at) VALUES (?, ?, ?, ?)'
      ).bind(participantId, 'sent', body.text, now).run();

      results.push({ participantId, status: 'sent' });
    } catch (error: any) {
      console.error(`[DM Bulk] Failed for ${participantId}:`, error.message);
      results.push({ participantId, status: 'failed', error: error.message });

      // If we hit a 429 or 403, stop the entire batch
      if (error.message.includes('429') || error.message.includes('403')) {
        console.error('[DM Bulk] Rate limit or auth error — aborting batch');
        break;
      }
    }
  }

  const sent = results.filter((r) => r.status === 'sent').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  await fireEvent(c.env.DB, {
    type: 'action_executed',
    data: { actionType: 'dm_bulk_sent', total: body.participant_ids.length, sent, failed },
    meta: { source: 'api', actionType: 'dm_bulk_sent' },
  });

  return c.json({ success: true, summary: { total: body.participant_ids.length, sent, failed }, results });
});

// ─── DMテンプレート CRUD ───

dmRouter.get('/templates', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM dm_templates ORDER BY use_count DESC'
  ).all();
  return c.json({ success: true, data: result.results });
});

dmRouter.post('/templates', async (c) => {
  const body = await c.req.json<{ name: string; text: string; category?: string; variables?: string[] }>();
  if (!body.name || !body.text) return c.json({ error: 'name and text required' }, 400);

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    'INSERT INTO dm_templates (name, text, category, variables, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(body.name, body.text, body.category || 'general', JSON.stringify(body.variables || []), now, now).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

dmRouter.put('/templates/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ name?: string; text?: string; category?: string; variables?: string[] }>();

  const existing = await c.env.DB.prepare('SELECT id FROM dm_templates WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Template not found' }, 404);

  const updates: string[] = [];
  const values: any[] = [];
  if (body.name) { updates.push('name = ?'); values.push(body.name); }
  if (body.text) { updates.push('text = ?'); values.push(body.text); }
  if (body.category) { updates.push('category = ?'); values.push(body.category); }
  if (body.variables) { updates.push('variables = ?'); values.push(JSON.stringify(body.variables)); }
  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await c.env.DB.prepare(`UPDATE dm_templates SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return c.json({ success: true, updated: id });
});

dmRouter.delete('/templates/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await c.env.DB.prepare('SELECT id FROM dm_templates WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Template not found' }, 404);

  await c.env.DB.prepare('DELETE FROM dm_templates WHERE id = ?').bind(id).run();
  return c.json({ success: true, deleted: id });
});

// テンプレートで DM 送信
dmRouter.post('/templates/:id/send/:participantId', async (c) => {
  const templateId = Number(c.req.param('id'));
  const participantId = c.req.param('participantId');

  const template = await c.env.DB.prepare('SELECT * FROM dm_templates WHERE id = ?').bind(templateId).first<{ text: string }>();
  if (!template) return c.json({ error: 'Template not found' }, 404);

  const client = new XClient(c.env);
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated' }, 401);

  try {
    await dmRateLimiter.waitForSlot();
    const stealthText = stealthTransform(template.text);
    const result = await client.sendDm(token, participantId, stealthText);

    // use_count 更新
    await c.env.DB.prepare('UPDATE dm_templates SET use_count = use_count + 1 WHERE id = ?').bind(templateId).run();

    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── DM自動応答ルール CRUD ───

dmRouter.get('/auto-replies', async (c) => {
  const result = await c.env.DB.prepare('SELECT * FROM dm_auto_replies ORDER BY created_at DESC').all();
  return c.json({ success: true, data: result.results });
});

dmRouter.post('/auto-replies', async (c) => {
  const body = await c.req.json<{
    name: string;
    trigger_type?: string;
    trigger_value: string;
    reply_template_id?: number;
    reply_text?: string;
    enabled?: boolean;
  }>();
  if (!body.name || !body.trigger_value) return c.json({ error: 'name and trigger_value required' }, 400);
  if (!body.reply_template_id && !body.reply_text) return c.json({ error: 'reply_template_id or reply_text required' }, 400);

  const result = await c.env.DB.prepare(
    'INSERT INTO dm_auto_replies (name, trigger_type, trigger_value, reply_template_id, reply_text, enabled) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(body.name, body.trigger_type || 'keyword', body.trigger_value, body.reply_template_id || null, body.reply_text || null, body.enabled !== false ? 1 : 0).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

dmRouter.put('/auto-replies/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ name?: string; trigger_value?: string; reply_text?: string; enabled?: boolean }>();

  const existing = await c.env.DB.prepare('SELECT id FROM dm_auto_replies WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Auto-reply rule not found' }, 404);

  const updates: string[] = [];
  const values: any[] = [];
  if (body.name) { updates.push('name = ?'); values.push(body.name); }
  if (body.trigger_value) { updates.push('trigger_value = ?'); values.push(body.trigger_value); }
  if (body.reply_text) { updates.push('reply_text = ?'); values.push(body.reply_text); }
  if (body.enabled !== undefined) { updates.push('enabled = ?'); values.push(body.enabled ? 1 : 0); }
  if (updates.length === 0) return c.json({ error: 'No fields' }, 400);
  values.push(id);

  await c.env.DB.prepare(`UPDATE dm_auto_replies SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return c.json({ success: true, updated: id });
});

dmRouter.delete('/auto-replies/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM dm_auto_replies WHERE id = ?').bind(id).run();
  return c.json({ success: true, deleted: id });
});
