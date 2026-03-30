/**
 * Writing Rules API
 * ライティングルールの CRUD エンドポイント
 *
 * Security:
 *  - 全フィールドの型・長さバリデーション
 *  - JSON フィールドのパース検証（不正JSON拒否）
 *  - SQLインジェクション防止（D1 パラメータバインド）
 *  - XSS 防止（保存時のサニタイズ — HTML タグストリップ）
 */

import { Hono } from 'hono';
import type { Env } from '../index';

export const writingRulesRouter = new Hono<{ Bindings: Env }>();

// ─── Input Validation Helpers ───

const MAX_NAME_LENGTH = 100;
const MAX_TONE_LENGTH = 50;
const MAX_PERSONA_LENGTH = 1000;
const MAX_JSON_LENGTH = 50000; // 50KB per JSON field
const VALID_TONES = ['casual', 'professional', 'provocative', 'neutral', 'friendly', 'authoritative'];

/** Strip HTML tags to prevent stored XSS */
function sanitizeText(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}

/** Validate and parse JSON string, returns null if invalid */
function safeParseJson(input: string, maxLength: number): object | null {
  if (input.length > maxLength) return null;
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface WritingRule {
  id: number;
  name: string;
  tone: string;
  persona: string | null;
  constraints: string;
  templates: string;
  examples: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// ─── GET /api/writing-rules — 全ルール取得 ───

writingRulesRouter.get('/', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM writing_rules ORDER BY is_default DESC, updated_at DESC'
  ).all<WritingRule>();

  return c.json({
    success: true,
    data: result.results.map((r) => ({
      ...r,
      constraints: JSON.parse(r.constraints),
      templates: JSON.parse(r.templates),
      examples: JSON.parse(r.examples),
    })),
  });
});

// ─── GET /api/writing-rules/:id — 個別取得 ───

writingRulesRouter.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: 'Invalid rule ID' }, 400);
  }

  const rule = await c.env.DB.prepare(
    'SELECT * FROM writing_rules WHERE id = ?'
  ).bind(id).first<WritingRule>();

  if (!rule) return c.json({ error: 'Rule not found' }, 404);

  return c.json({
    success: true,
    data: {
      ...rule,
      constraints: JSON.parse(rule.constraints),
      templates: JSON.parse(rule.templates),
      examples: JSON.parse(rule.examples),
    },
  });
});

// ─── POST /api/writing-rules — 新規作成 ───

writingRulesRouter.post('/', async (c) => {
  const body = await c.req.json<{
    name: string;
    tone?: string;
    persona?: string;
    constraints?: object;
    templates?: string[];
    examples?: { good: string[]; bad: string[] };
    is_default?: boolean;
  }>();

  // ── Validation ──
  if (!body.name || typeof body.name !== 'string') {
    return c.json({ error: 'name is required (string)' }, 400);
  }

  const name = sanitizeText(body.name);
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    return c.json({ error: `name must be 1-${MAX_NAME_LENGTH} characters` }, 400);
  }

  const tone = body.tone ? sanitizeText(body.tone) : 'neutral';
  if (!VALID_TONES.includes(tone)) {
    return c.json({ error: `tone must be one of: ${VALID_TONES.join(', ')}` }, 400);
  }

  const persona = body.persona ? sanitizeText(body.persona) : null;
  if (persona && persona.length > MAX_PERSONA_LENGTH) {
    return c.json({ error: `persona must be at most ${MAX_PERSONA_LENGTH} characters` }, 400);
  }

  // Validate JSON fields
  const constraintsStr = body.constraints ? JSON.stringify(body.constraints) : '{}';
  if (constraintsStr.length > MAX_JSON_LENGTH) {
    return c.json({ error: 'constraints too large' }, 400);
  }

  const templatesStr = body.templates ? JSON.stringify(body.templates) : '[]';
  if (templatesStr.length > MAX_JSON_LENGTH) {
    return c.json({ error: 'templates too large' }, 400);
  }

  const examplesStr = body.examples ? JSON.stringify(body.examples) : '{"good":[],"bad":[]}';
  if (examplesStr.length > MAX_JSON_LENGTH) {
    return c.json({ error: 'examples too large' }, 400);
  }

  // Verify JSON roundtrip is safe
  if (!safeParseJson(constraintsStr, MAX_JSON_LENGTH)) {
    return c.json({ error: 'Invalid constraints JSON' }, 400);
  }
  if (!safeParseJson(templatesStr, MAX_JSON_LENGTH)) {
    return c.json({ error: 'Invalid templates JSON' }, 400);
  }
  if (!safeParseJson(examplesStr, MAX_JSON_LENGTH)) {
    return c.json({ error: 'Invalid examples JSON' }, 400);
  }

  // Duplicate name check
  const existing = await c.env.DB.prepare(
    'SELECT id FROM writing_rules WHERE name = ?'
  ).bind(name).first();
  if (existing) {
    return c.json({ error: 'A rule with this name already exists' }, 409);
  }

  // If setting as default, clear others first
  if (body.is_default) {
    await c.env.DB.prepare(
      'UPDATE writing_rules SET is_default = false WHERE is_default = true'
    ).run();
  }

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    'INSERT INTO writing_rules (name, tone, persona, constraints, templates, examples, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(name, tone, persona, constraintsStr, templatesStr, examplesStr, body.is_default ? 1 : 0, now, now).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

// ─── PUT /api/writing-rules/:id — 更新 ───

writingRulesRouter.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: 'Invalid rule ID' }, 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM writing_rules WHERE id = ?'
  ).bind(id).first();
  if (!existing) return c.json({ error: 'Rule not found' }, 404);

  const body = await c.req.json<{
    name?: string;
    tone?: string;
    persona?: string;
    constraints?: object;
    templates?: string[];
    examples?: { good: string[]; bad: string[] };
    is_default?: boolean;
  }>();

  const updates: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) {
    const name = sanitizeText(body.name);
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      return c.json({ error: `name must be 1-${MAX_NAME_LENGTH} characters` }, 400);
    }
    // Check uniqueness (excluding current)
    const dup = await c.env.DB.prepare(
      'SELECT id FROM writing_rules WHERE name = ? AND id != ?'
    ).bind(name, id).first();
    if (dup) return c.json({ error: 'A rule with this name already exists' }, 409);
    updates.push('name = ?');
    values.push(name);
  }

  if (body.tone !== undefined) {
    const tone = sanitizeText(body.tone);
    if (!VALID_TONES.includes(tone)) {
      return c.json({ error: `tone must be one of: ${VALID_TONES.join(', ')}` }, 400);
    }
    updates.push('tone = ?');
    values.push(tone);
  }

  if (body.persona !== undefined) {
    const persona = sanitizeText(body.persona);
    if (persona.length > MAX_PERSONA_LENGTH) {
      return c.json({ error: `persona must be at most ${MAX_PERSONA_LENGTH} characters` }, 400);
    }
    updates.push('persona = ?');
    values.push(persona || null);
  }

  if (body.constraints !== undefined) {
    const s = JSON.stringify(body.constraints);
    if (!safeParseJson(s, MAX_JSON_LENGTH)) {
      return c.json({ error: 'Invalid constraints JSON' }, 400);
    }
    updates.push('constraints = ?');
    values.push(s);
  }

  if (body.templates !== undefined) {
    const s = JSON.stringify(body.templates);
    if (!safeParseJson(s, MAX_JSON_LENGTH)) {
      return c.json({ error: 'Invalid templates JSON' }, 400);
    }
    updates.push('templates = ?');
    values.push(s);
  }

  if (body.examples !== undefined) {
    const s = JSON.stringify(body.examples);
    if (!safeParseJson(s, MAX_JSON_LENGTH)) {
      return c.json({ error: 'Invalid examples JSON' }, 400);
    }
    updates.push('examples = ?');
    values.push(s);
  }

  if (body.is_default !== undefined) {
    if (body.is_default) {
      await c.env.DB.prepare(
        'UPDATE writing_rules SET is_default = false WHERE is_default = true'
      ).run();
    }
    updates.push('is_default = ?');
    values.push(body.is_default ? 1 : 0);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await c.env.DB.prepare(
    `UPDATE writing_rules SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return c.json({ success: true, updated: id });
});

// ─── DELETE /api/writing-rules/:id — 削除 ───

writingRulesRouter.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: 'Invalid rule ID' }, 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM writing_rules WHERE id = ?'
  ).bind(id).first();
  if (!existing) return c.json({ error: 'Rule not found' }, 404);

  await c.env.DB.prepare(
    'DELETE FROM writing_rules WHERE id = ?'
  ).bind(id).run();

  return c.json({ success: true, deleted: id });
});

// ─── PUT /api/writing-rules/:id/default — デフォルト設定 ───

writingRulesRouter.put('/:id/default', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: 'Invalid rule ID' }, 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM writing_rules WHERE id = ?'
  ).bind(id).first();
  if (!existing) return c.json({ error: 'Rule not found' }, 404);

  // Atomic: clear all defaults, then set the new one
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE writing_rules SET is_default = false WHERE is_default = true'),
    c.env.DB.prepare('UPDATE writing_rules SET is_default = true, updated_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), id),
  ]);

  return c.json({ success: true, default_rule_id: id });
});
