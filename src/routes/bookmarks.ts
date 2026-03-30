import { Hono } from 'hono';
import type { Env } from '../index';
import { XClient } from '../services/x-client';
import { AIAnalyzer } from '../services/ai-analyzer';
import { resolveToken } from '../services/token-resolver';

export const bookmarksRouter = new Hono<{ Bindings: Env }>();

// ─── ブックマーク同期（X APIから取得 → D1保存） ───
bookmarksRouter.post('/sync', async (c) => {
  const token = await resolveToken(c.env);
  if (!token) return c.json({ error: 'Not authenticated. Visit /api/auth/authorize first.' }, 401);

  const client = new XClient(c.env);

  try {
    const result = await client.getBookmarks(token, 100);
    const tweets = result.data || [];
    const users = new Map<string, string>();

    // ユーザー情報マッピング
    if (result.includes?.users) {
      for (const u of result.includes.users) {
        users.set(u.id, u.username);
      }
    }

    let synced = 0;
    for (const tweet of tweets) {
      const username = users.get(tweet.author_id) || '';
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO bookmarks (tweet_id, author_id, author_username, text, synced_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(tweet.id, tweet.author_id, username, tweet.text, new Date().toISOString()).run();
      synced++;
    }

    return c.json({ success: true, synced, total: tweets.length });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── ブックマーク一覧 ───
bookmarksRouter.get('/', async (c) => {
  const folderId = c.req.query('folder_id');
  const limit = Math.min(Number(c.req.query('limit') || '50'), 200);
  const offset = Math.max(Number(c.req.query('offset') || '0'), 0);

  let query = `
    SELECT b.*, ba.keywords, ba.category, ba.summary, ba.skill_tags
    FROM bookmarks b
    LEFT JOIN bookmark_analysis ba ON ba.bookmark_id = b.id
  `;
  const params: any[] = [];

  if (folderId) {
    query += ' WHERE b.folder_id = ?';
    params.push(Number(folderId));
  }

  query += ' ORDER BY b.synced_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// ─── 単体 AI 分析 ───
bookmarksRouter.post('/:id/analyze', async (c) => {
  const id = Number(c.req.param('id'));
  const bookmark = await c.env.DB.prepare('SELECT * FROM bookmarks WHERE id = ?').bind(id).first();
  if (!bookmark) return c.json({ error: 'Bookmark not found' }, 404);

  const analyzer = new AIAnalyzer(c.env);
  const analysis = await analyzer.analyzeBookmark(
    bookmark.text as string,
    bookmark.author_username as string
  );

  // 分析結果保存
  await c.env.DB.prepare(`
    INSERT INTO bookmark_analysis (bookmark_id, keywords, category, summary, skill_tags, folder_suggestion, analyzed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bookmark_id) DO UPDATE SET
      keywords = excluded.keywords,
      category = excluded.category,
      summary = excluded.summary,
      skill_tags = excluded.skill_tags,
      folder_suggestion = excluded.folder_suggestion,
      analyzed_at = excluded.analyzed_at
  `).bind(
    id,
    JSON.stringify(analysis.keywords),
    analysis.category,
    analysis.summary,
    JSON.stringify(analysis.skill_tags),
    analysis.folder_suggestion,
    new Date().toISOString()
  ).run();

  // フォルダを自動更新（デフォルト「あとで読む」のままの場合）
  if (bookmark.folder_id === 5 && analysis.folder_suggestion !== 5) {
    await c.env.DB.prepare('UPDATE bookmarks SET folder_id = ? WHERE id = ?')
      .bind(analysis.folder_suggestion, id).run();
  }

  return c.json({ success: true, analysis });
});

// ─── 一括 AI 分析（最大100件） ───
bookmarksRouter.post('/analyze-batch', async (c) => {
  // 総未分析数を取得
  const countResult = await c.env.DB.prepare(`
    SELECT COUNT(*) as cnt FROM bookmarks b
    LEFT JOIN bookmark_analysis ba ON ba.bookmark_id = b.id
    WHERE ba.id IS NULL
  `).first<{ cnt: number }>();
  const totalUnanalyzed = countResult?.cnt || 0;

  const unanalyzed = await c.env.DB.prepare(`
    SELECT b.* FROM bookmarks b
    LEFT JOIN bookmark_analysis ba ON ba.bookmark_id = b.id
    WHERE ba.id IS NULL
    LIMIT 100
  `).all();

  const analyzer = new AIAnalyzer(c.env);
  let analyzed = 0;
  let failed = 0;

  for (const bookmark of unanalyzed.results) {
    try {
      const analysis = await analyzer.analyzeBookmark(
        bookmark.text as string,
        bookmark.author_username as string
      );

      await c.env.DB.prepare(`
        INSERT INTO bookmark_analysis (bookmark_id, keywords, category, summary, skill_tags, folder_suggestion, analyzed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bookmark_id) DO UPDATE SET
          keywords = excluded.keywords, category = excluded.category,
          summary = excluded.summary, skill_tags = excluded.skill_tags,
          folder_suggestion = excluded.folder_suggestion, analyzed_at = excluded.analyzed_at
      `).bind(
        bookmark.id,
        JSON.stringify(analysis.keywords),
        analysis.category,
        analysis.summary,
        JSON.stringify(analysis.skill_tags),
        analysis.folder_suggestion,
        new Date().toISOString()
      ).run();

      if ((bookmark.folder_id as number) === 5 && analysis.folder_suggestion !== 5) {
        await c.env.DB.prepare('UPDATE bookmarks SET folder_id = ? WHERE id = ?')
          .bind(analysis.folder_suggestion, bookmark.id).run();
      }

      analyzed++;
    } catch (e) {
      console.error(`Failed to analyze bookmark ${bookmark.id}:`, e);
      failed++;
    }
  }

  return c.json({
    success: true, analyzed, failed,
    total_unanalyzed: totalUnanalyzed,
    remaining: totalUnanalyzed - analyzed,
  });
});

// ─── フォルダ CRUD ───
bookmarksRouter.get('/folders', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT f.*, (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id) as count FROM bookmark_folders f ORDER BY sort_order'
  ).all();
  return c.json({ success: true, data: result.results });
});

bookmarksRouter.post('/folders', async (c) => {
  const body = await c.req.json<{ name: string; icon?: string; color?: string; auto_rule?: string }>();
  if (!body.name?.trim()) return c.json({ error: 'Folder name required' }, 400);

  const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) as m FROM bookmark_folders').first<{ m: number }>();
  await c.env.DB.prepare(
    'INSERT INTO bookmark_folders (name, icon, color, auto_rule, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).bind(body.name, body.icon || '📁', body.color || '#1d9bf0', body.auto_rule || null, (maxOrder?.m || 0) + 1).run();

  return c.json({ success: true });
});

bookmarksRouter.put('/folders/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ name?: string; icon?: string; color?: string; auto_rule?: string }>();

  const folder = await c.env.DB.prepare('SELECT * FROM bookmark_folders WHERE id = ?').bind(id).first();
  if (!folder) return c.json({ error: 'Folder not found' }, 404);

  await c.env.DB.prepare(
    'UPDATE bookmark_folders SET name = ?, icon = ?, color = ?, auto_rule = ? WHERE id = ?'
  ).bind(
    body.name || folder.name,
    body.icon || folder.icon,
    body.color || folder.color,
    body.auto_rule !== undefined ? body.auto_rule : folder.auto_rule,
    id
  ).run();

  return c.json({ success: true });
});

bookmarksRouter.delete('/folders/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const folder = await c.env.DB.prepare('SELECT * FROM bookmark_folders WHERE id = ?').bind(id).first();
  if (!folder) return c.json({ error: 'Folder not found' }, 404);
  if (folder.is_default) return c.json({ error: 'Cannot delete default folders' }, 400);

  // ブックマークを「あとで読む」に移動
  await c.env.DB.prepare('UPDATE bookmarks SET folder_id = 5 WHERE folder_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM bookmark_folders WHERE id = ?').bind(id).run();

  return c.json({ success: true });
});

// ─── ブックマークのフォルダ移動 ───
bookmarksRouter.put('/:id/move', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ folder_id: number }>();

  await c.env.DB.prepare('UPDATE bookmarks SET folder_id = ? WHERE id = ?')
    .bind(body.folder_id, id).run();

  return c.json({ success: true });
});

// ─── スキル抽出 ───
bookmarksRouter.get('/skills', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM extracted_skills ORDER BY confidence DESC'
  ).all();
  return c.json({ success: true, data: result.results });
});

bookmarksRouter.post('/extract-skills', async (c) => {
  // 分析済みブックマークを取得
  const analyzed = await c.env.DB.prepare(`
    SELECT b.id, b.text, ba.skill_tags
    FROM bookmarks b
    JOIN bookmark_analysis ba ON ba.bookmark_id = b.id
    LIMIT 50
  `).all();

  if (analyzed.results.length === 0) {
    return c.json({ error: 'No analyzed bookmarks found. Run analysis first.' }, 400);
  }

  const analyzer = new AIAnalyzer(c.env);
  const skills = await analyzer.extractSkills(
    analyzed.results as { id: number; text: string; skill_tags?: string }[]
  );

  // スキルを保存
  for (const skill of skills) {
    await c.env.DB.prepare(`
      INSERT INTO extracted_skills (name, category, description, source_bookmarks, confidence, related_tools, actionable)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      skill.name,
      skill.category,
      skill.description,
      JSON.stringify(analyzed.results.map((r) => r.id).slice(0, 10)),
      skill.confidence,
      JSON.stringify(skill.related_tools),
      skill.actionable ? 1 : 0
    ).run();
  }

  return c.json({ success: true, extracted: skills.length, skills });
});

// ─── ワークフロー生成 ───
bookmarksRouter.get('/workflows', async (c) => {
  const status = c.req.query('status');
  let query = 'SELECT * FROM workflow_suggestions';
  const params: any[] = [];

  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY created_at DESC';

  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

bookmarksRouter.post('/generate-workflows', async (c) => {
  const skills = await c.env.DB.prepare('SELECT * FROM extracted_skills WHERE actionable = 1 LIMIT 10').all();
  const bookmarks = await c.env.DB.prepare('SELECT text FROM bookmarks LIMIT 10').all();

  if (skills.results.length === 0) {
    return c.json({ error: 'No actionable skills found. Extract skills first.' }, 400);
  }

  const analyzer = new AIAnalyzer(c.env);
  const workflows = await analyzer.generateWorkflows(
    skills.results as { name: string; category: string; description: string }[],
    bookmarks.results.map((b) => b.text as string)
  );

  for (const wf of workflows) {
    await c.env.DB.prepare(`
      INSERT INTO workflow_suggestions (title, description, steps, required_skills, source_bookmarks)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      wf.title,
      wf.description,
      JSON.stringify(wf.steps),
      JSON.stringify(wf.required_skills),
      '[]'
    ).run();
  }

  return c.json({ success: true, generated: workflows.length, workflows });
});

bookmarksRouter.put('/workflows/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ status: 'approved' | 'rejected' }>();

  if (!['approved', 'rejected'].includes(body.status)) {
    return c.json({ error: 'Status must be approved or rejected' }, 400);
  }

  await c.env.DB.prepare('UPDATE workflow_suggestions SET status = ? WHERE id = ?')
    .bind(body.status, id).run();

  return c.json({ success: true });
});

// ─── ワークフローテンプレート CRUD ───

bookmarksRouter.get('/workflow-templates', async (c) => {
  try {
    const result = await c.env.DB.prepare(
      'SELECT wt.*, wr.name as writing_rule_name FROM workflow_templates wt LEFT JOIN writing_rules wr ON wr.id = wt.writing_rule_id ORDER BY wt.id'
    ).all();
    return c.json({ success: true, data: result.results });
  } catch {
    // テーブル未作成のフォールバック
    return c.json({ success: true, data: [] });
  }
});

bookmarksRouter.put('/workflow-templates/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ enabled?: boolean; writing_rule_id?: number | null }>();

  const updates: string[] = [];
  const values: any[] = [];
  if (body.enabled !== undefined) { updates.push('enabled = ?'); values.push(body.enabled ? 1 : 0); }
  if (body.writing_rule_id !== undefined) { updates.push('writing_rule_id = ?'); values.push(body.writing_rule_id); }
  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
  values.push(id);

  await c.env.DB.prepare(`UPDATE workflow_templates SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return c.json({ success: true });
});

// ─── CSV エクスポート ───
bookmarksRouter.get('/export', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT b.tweet_id, b.author_username, b.text, bf.name as folder,
           ba.category, ba.summary, ba.skill_tags, b.synced_at
    FROM bookmarks b
    LEFT JOIN bookmark_folders bf ON bf.id = b.folder_id
    LEFT JOIN bookmark_analysis ba ON ba.bookmark_id = b.id
    ORDER BY b.synced_at DESC
  `).all();

  const header = 'tweet_id,author,text,folder,category,summary,skill_tags,synced_at\n';
  const rows = result.results.map((r: any) => {
    const text = `"${(r.text || '').replace(/"/g, '""')}"`;
    const summary = `"${(r.summary || '').replace(/"/g, '""')}"`;
    return `${r.tweet_id},@${r.author_username},${text},${r.folder},${r.category || ''},${summary},${r.skill_tags || ''},${r.synced_at}`;
  }).join('\n');

  return new Response(header + rows, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bookmarks_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});
