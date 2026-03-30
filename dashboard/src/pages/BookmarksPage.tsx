import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api';

interface BookmarksPageProps {
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

interface Folder {
  id: number;
  name: string;
  icon: string;
  color: string;
  count: number;
  is_default: boolean;
}

interface Bookmark {
  id: number;
  tweet_id: string;
  author_username: string;
  text: string;
  folder_id: number;
  synced_at: string;
  keywords?: string;
  category?: string;
  summary?: string;
  skill_tags?: string;
}

interface Skill {
  id: number;
  name: string;
  category: string;
  description: string;
  confidence: number;
  related_tools: string;
  actionable: boolean;
}

interface Workflow {
  id: number;
  title: string;
  description: string;
  steps: string;
  required_skills: string;
  status: string;
}

// ─── Security: XSS-safe embed loader ────────────────────────
// Only allow numeric tweet IDs to prevent injection
function isValidTweetId(id: string): boolean {
  return /^\d{1,20}$/.test(id);
}

// ─── Tweet Embed Component ──────────────────────────────────
function TweetEmbed({ tweetId }: { tweetId: string }) {
  const embedRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isValidTweetId(tweetId) || !embedRef.current) {
      setError(true);
      setLoading(false);
      return;
    }

    // Ensure Twitter widgets.js is loaded (CSP-safe, single load)
    const loadWidgets = (): Promise<any> => {
      if ((window as any).twttr?.widgets) {
        return Promise.resolve((window as any).twttr);
      }
      return new Promise((resolve, reject) => {
        // Prevent duplicate script injection
        if (document.getElementById('twitter-wjs')) {
          const check = setInterval(() => {
            if ((window as any).twttr?.widgets) {
              clearInterval(check);
              resolve((window as any).twttr);
            }
          }, 100);
          setTimeout(() => { clearInterval(check); reject(new Error('timeout')); }, 10000);
          return;
        }
        const script = document.createElement('script');
        script.id = 'twitter-wjs';
        script.src = 'https://platform.twitter.com/widgets.js';
        script.async = true;
        script.charset = 'utf-8';
        // Security: SRI not available for widgets.js — rely on HTTPS + domain validation
        script.onload = () => {
          const check = setInterval(() => {
            if ((window as any).twttr?.widgets) {
              clearInterval(check);
              resolve((window as any).twttr);
            }
          }, 100);
          setTimeout(() => { clearInterval(check); reject(new Error('timeout')); }, 10000);
        };
        script.onerror = () => reject(new Error('Failed to load Twitter widgets'));
        document.head.appendChild(script);
      });
    };

    let cancelled = false;

    loadWidgets()
      .then((twttr) => {
        if (cancelled || !embedRef.current) return;
        // Clear any previous content
        embedRef.current.innerHTML = '';
        return twttr.widgets.createTweet(tweetId, embedRef.current, {
          theme: 'dark',
          dnt: true, // Do Not Track for privacy
          align: 'center',
          conversation: 'none',
        });
      })
      .then((el: any) => {
        if (cancelled) return;
        if (!el) setError(true);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [tweetId]);

  if (error) {
    return (
      <div className="tweet-embed tweet-embed--error">
        <span>⚠️ プレビューを読み込めませんでした</span>
        <a href={`https://x.com/i/status/${tweetId}`} target="_blank" rel="noopener noreferrer"
          className="btn btn--ghost btn--sm" style={{ marginLeft: 8 }}>
          X で開く ↗
        </a>
      </div>
    );
  }

  return (
    <div className="tweet-embed">
      {loading && (
        <div className="tweet-embed__loading">
          <div className="spinner" style={{ width: 20, height: 20 }} />
          <span>プレビュー読み込み中…</span>
        </div>
      )}
      <div ref={embedRef} />
    </div>
  );
}

// ─── Folder Creator ─────────────────────────────────────────
const FOLDER_COLORS = ['#f59e0b', '#3b82f6', '#ef4444', '#a855f7', '#10b981', '#f97316', '#ec4899', '#06b6d4'];
const FOLDER_ICONS = ['📁', '🏷️', '⭐', '🔖', '📌', '💡', '🎯', '📊', '🔬', '💼'];

function FolderCreator({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const [color, setColor] = useState('#3b82f6');
  const [autoRule, setAutoRule] = useState('');
  const [creating, setCreating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  // Security: sanitize folder name
  const sanitizeName = (text: string) => text.replace(/[<>"'&]/g, '').trim().slice(0, 50);

  const handleCreate = async () => {
    const cleanName = sanitizeName(name);
    if (!cleanName) return;

    setCreating(true);
    try {
      await api.createBookmarkFolder({
        name: cleanName,
        icon,
        color,
        auto_rule: autoRule.trim() || undefined,
      });
      onCreated();
    } catch (err: any) {
      // Error handled by parent via showToast
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="folder-creator">
      <div className="folder-creator__header">
        <span style={{ fontWeight: 600 }}>📁 新規フォルダ</span>
      </div>
      <input
        ref={nameRef}
        className="form-input form-input--sm"
        placeholder="フォルダ名"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={50}
      />
      <div className="folder-creator__icons">
        {FOLDER_ICONS.map((ic) => (
          <button
            key={ic}
            className={`icon-btn ${icon === ic ? 'icon-btn--active' : ''}`}
            onClick={() => setIcon(ic)}
          >
            {ic}
          </button>
        ))}
      </div>
      <div className="folder-creator__colors">
        {FOLDER_COLORS.map((c) => (
          <button
            key={c}
            className={`color-btn ${color === c ? 'color-btn--active' : ''}`}
            style={{ backgroundColor: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <input
        className="form-input form-input--sm"
        placeholder="自動振り分けルール（カンマ区切りキーワード）"
        value={autoRule}
        onChange={(e) => setAutoRule(e.target.value)}
        maxLength={200}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn btn--primary btn--sm" style={{ flex: 1 }}
          onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? '⏳' : '✅'} 作成
        </button>
        <button className="btn btn--ghost btn--sm" onClick={onCancel} disabled={creating}>
          キャンセル
        </button>
      </div>
    </div>
  );
}

// ─── Main BookmarksPage ─────────────────────────────────────
export function BookmarksPage({ showToast }: BookmarksPageProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [activeFolder, setActiveFolder] = useState<number | null>(null);
  const [tab, setTab] = useState<'bookmarks' | 'skills' | 'workflows'>('bookmarks');
  const [syncing, setSyncing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showFolderCreator, setShowFolderCreator] = useState(false);
  const [expandedEmbeds, setExpandedEmbeds] = useState<Set<number>>(new Set());
  const [wfTemplates, setWfTemplates] = useState<any[]>([]);
  const [writingRules, setWritingRules] = useState<any[]>([]);

  const toggleEmbed = (id: number) => {
    setExpandedEmbeds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadAll = useCallback(async (folderId?: number) => {
    setRefreshing(true);
    const results = await Promise.allSettled([
      api.getBookmarkFolders(),
      api.getBookmarks(folderId),
      api.getSkills(),
      api.getWorkflows(),
      api.getWorkflowTemplates(),
      api.getWritingRules(),
    ]);
    if (results[0].status === 'fulfilled') setFolders(results[0].value.data || []);
    if (results[1].status === 'fulfilled') setBookmarks(results[1].value.data || []);
    if (results[2].status === 'fulfilled') setSkills(results[2].value.data || []);
    if (results[3].status === 'fulfilled') setWorkflows(results[3].value.data || []);
    if (results[4].status === 'fulfilled') setWfTemplates(results[4].value.data || []);
    if (results[5].status === 'fulfilled') setWritingRules(results[5].value.data || []);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0 && failed.length < results.length) {
      showToast('info', '一部のデータ取得に失敗しました');
    } else if (failed.length === results.length) {
      showToast('error', 'データの取得に失敗しました');
    }
    setRefreshing(false);
  }, [showToast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.syncBookmarks();
      showToast('success', `${res.synced} 件のブックマークを同期しました`);
      loadAll(activeFolder ?? undefined);
    } catch (e: any) {
      showToast('error', e.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleAnalyzeBatch = async () => {
    setAnalyzing(true);
    try {
      const res = await api.analyzeBatch();
      showToast('success', `${res.analyzed} 件を AI 分析しました`);
      loadAll(activeFolder ?? undefined);
    } catch (e: any) {
      showToast('error', e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleExtractSkills = async () => {
    setExtracting(true);
    try {
      const res = await api.extractSkills();
      showToast('success', `${res.extracted} 件のスキルを抽出しました`);
      loadAll(activeFolder ?? undefined);
    } catch (e: any) {
      showToast('error', e.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleGenerateWorkflows = async () => {
    setGenerating(true);
    try {
      const res = await api.generateWorkflows();
      showToast('success', `${res.generated} 件のワークフローを生成しました`);
      loadAll(activeFolder ?? undefined);
    } catch (e: any) {
      showToast('error', e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleWorkflowAction = async (id: number, status: 'approved' | 'rejected') => {
    try {
      await api.updateWorkflowStatus(id, status);
      showToast('success', status === 'approved' ? 'ワークフローを承認しました' : 'ワークフローを却下しました');
      loadAll(activeFolder ?? undefined);
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleExport = () => {
    window.open('/api/bookmarks/export', '_blank');
  };

  const handleFolderCreated = () => {
    setShowFolderCreator(false);
    showToast('success', 'フォルダを作成しました');
    loadAll(activeFolder ?? undefined);
  };

  const parseTags = (json?: string): string[] => {
    if (!json) return [];
    try { return JSON.parse(json); } catch { return []; }
  };

  const parseSteps = (json: string): { order: number; action: string; details: string }[] => {
    try { return JSON.parse(json); } catch { return []; }
  };

  const totalBookmarks = folders.reduce((sum, f) => sum + f.count, 0);

  return (
    <div className="bookmarks-page">
      {/* アクションバー */}
      <div className="action-bar">
        <div className="action-bar__left">
          <button className="btn btn--primary" onClick={handleSync} disabled={syncing}>
            {syncing ? '⏳ 同期中...' : '🔄 ブックマーク同期'}
          </button>
          <button className="btn btn--secondary" onClick={handleAnalyzeBatch} disabled={analyzing}>
            {analyzing ? '⏳ 分析中...' : '🧠 AI 一括分析'}
          </button>
          <button className="btn btn--secondary btn--sm" onClick={() => loadAll(activeFolder ?? undefined)} disabled={refreshing}>
            {refreshing ? '⏳ 取得中…' : '🔄 更新'}
          </button>
          <button className="btn btn--ghost" onClick={handleExport}>
            📥 CSV エクスポート
          </button>
        </div>
        <span className="action-bar__count">{totalBookmarks} 件</span>
      </div>

      {/* タブ切替 */}
      <div className="tab-bar">
        <button className={`tab-btn ${tab === 'bookmarks' ? 'tab-btn--active' : ''}`} onClick={() => setTab('bookmarks')}>
          📑 ブックマーク
        </button>
        <button className={`tab-btn ${tab === 'skills' ? 'tab-btn--active' : ''}`} onClick={() => setTab('skills')}>
          🧠 スキル ({skills.length})
        </button>
        <button className={`tab-btn ${tab === 'workflows' ? 'tab-btn--active' : ''}`} onClick={() => setTab('workflows')}>
          ⚙️ ワークフロー ({workflows.length})
        </button>
      </div>

      {tab === 'bookmarks' && (
        <div className="bookmarks-layout">
          {/* フォルダサイドバー */}
          <div className="folder-sidebar">
            <button
              className={`folder-item ${activeFolder === null ? 'folder-item--active' : ''}`}
              onClick={() => { setActiveFolder(null); loadAll(); }}
            >
              <span>📋</span>
              <span>すべて</span>
              <span className="folder-count">{totalBookmarks}</span>
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                className={`folder-item ${activeFolder === f.id ? 'folder-item--active' : ''}`}
                onClick={() => { setActiveFolder(f.id); loadAll(f.id); }}
                style={{ borderLeft: `3px solid ${f.color}` }}
              >
                <span>{f.icon}</span>
                <span>{f.name}</span>
                <span className="folder-count">{f.count}</span>
              </button>
            ))}

            {/* フォルダ追加 */}
            {showFolderCreator ? (
              <FolderCreator
                onCreated={handleFolderCreated}
                onCancel={() => setShowFolderCreator(false)}
              />
            ) : (
              <button
                className="folder-item folder-item--add"
                onClick={() => setShowFolderCreator(true)}
              >
                <span>➕</span>
                <span>フォルダ追加</span>
              </button>
            )}
          </div>

          {/* ブックマーク一覧 */}
          <div className="bookmark-list">
            {bookmarks.length === 0 ? (
              <div className="empty-state">
                <p>📑 ブックマークがありません</p>
                <p>「ブックマーク同期」ボタンで X からインポートしてください</p>
              </div>
            ) : (
              bookmarks.map((bm) => (
                <div key={bm.id} className="bookmark-card">
                  <div className="bookmark-card__header">
                    <span className="bookmark-card__author">@{bm.author_username}</span>
                    <div className="bookmark-card__actions">
                      <button
                        className={`btn btn--ghost btn--sm ${expandedEmbeds.has(bm.id) ? 'btn--active' : ''}`}
                        onClick={() => toggleEmbed(bm.id)}
                        title="埋め込みプレビュー"
                      >
                        {expandedEmbeds.has(bm.id) ? '🔽 閉じる' : '🔗 プレビュー'}
                      </button>
                      <a
                        href={`https://x.com/i/status/${bm.tweet_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn--ghost btn--sm"
                        title="X で開く"
                      >
                        ↗
                      </a>
                      <span className="bookmark-card__date">
                        {new Date(bm.synced_at).toLocaleDateString('ja-JP')}
                      </span>
                    </div>
                  </div>
                  <p className="bookmark-card__text">{bm.text}</p>

                  {/* Embed preview (lazy loaded on toggle) */}
                  {expandedEmbeds.has(bm.id) && isValidTweetId(bm.tweet_id) && (
                    <TweetEmbed tweetId={bm.tweet_id} />
                  )}

                  {bm.summary && (
                    <div className="bookmark-card__summary">
                      <span className="badge badge--ai">🧠 AI</span>
                      {bm.summary}
                    </div>
                  )}
                  <div className="bookmark-card__tags">
                    {bm.category && (
                      <span className="badge badge--category">{bm.category}</span>
                    )}
                    {parseTags(bm.skill_tags).map((tag, i) => (
                      <span key={i} className="badge badge--skill">{tag}</span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'skills' && (
        <div className="skills-section">
          <div className="action-bar" style={{ marginBottom: '1rem' }}>
            <button className="btn btn--primary" onClick={handleExtractSkills} disabled={extracting}>
              {extracting ? '⏳ 抽出中...' : '🧠 スキル抽出実行'}
            </button>
          </div>
          {skills.length === 0 ? (
            <div className="empty-state">
              <p>🧠 抽出されたスキルはありません</p>
              <p>ブックマークを AI 分析してからスキル抽出を実行してください</p>
            </div>
          ) : (
            <div className="skills-grid">
              {skills.map((skill) => (
                <div key={skill.id} className="skill-card">
                  <div className="skill-card__header">
                    <h4>{skill.name}</h4>
                    {skill.actionable && <span className="badge badge--actionable">実行可能</span>}
                  </div>
                  <p className="skill-card__desc">{skill.description}</p>
                  <div className="skill-card__meta">
                    <span className="badge badge--category">{skill.category}</span>
                    <div className="confidence-bar">
                      <div className="confidence-bar__fill" style={{ width: `${skill.confidence * 100}%` }} />
                    </div>
                    <span className="confidence-label">{(skill.confidence * 100).toFixed(0)}%</span>
                  </div>
                  {parseTags(skill.related_tools).length > 0 && (
                    <div className="skill-card__tools">
                      {parseTags(skill.related_tools).map((tool, i) => {
                        const isUrl = tool.startsWith('http');
                        return isUrl ? (
                          <a key={i} href={tool} target="_blank" rel="noopener noreferrer" className="badge badge--tool" style={{ textDecoration: 'none' }}>{tool.includes('github.com') ? '🔗 ' + tool.split('/').slice(-2).join('/') : '🔗 Link'}</a>
                        ) : (
                          <span key={i} className="badge badge--tool">{tool}</span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'workflows' && (
        <div className="workflows-section">
          {/* Template Cards */}
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            📋 ワークフローテンプレート
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 400 }}>
              ON/OFF で有効化
            </span>
          </h3>
          {wfTemplates.length > 0 ? (
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', marginBottom: 32 }}>
              {wfTemplates.map((tpl: any) => {
                const steps = parseSteps(tpl.steps);
                const isPostCreation = ['news_to_quote', 'marketing_to_thread'].includes(tpl.category);
                return (
                  <div key={tpl.id} className={`wf-template-card ${tpl.enabled ? 'wf-template-card--enabled' : ''}`}>
                    <div className="wf-template-card__header">
                      <span className="wf-template-card__title">{tpl.name}</span>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={!!tpl.enabled}
                          onChange={async () => {
                            try {
                              await api.updateWorkflowTemplate(tpl.id, { enabled: !tpl.enabled });
                              setWfTemplates(prev => prev.map(t => t.id === tpl.id ? { ...t, enabled: !t.enabled } : t));
                              showToast('success', tpl.enabled ? '無効化しました' : '有効化しました');
                            } catch (e: any) { showToast('error', e.message); }
                          }}
                        />
                        <span className="toggle-switch__slider" />
                      </label>
                    </div>
                    <div className="wf-template-card__desc">{tpl.description}</div>
                    <ul className="wf-template-card__steps">
                      {steps.map((s) => (
                        <li key={s.order} className="wf-template-card__step">
                          <span className="wf-template-card__step-num">{s.order}</span>
                          <div><strong>{s.action}</strong> — {s.details}</div>
                        </li>
                      ))}
                    </ul>
                    {isPostCreation && (
                      <div className="wf-template-card__footer">
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>✍️ ライティングルール:</span>
                        <select
                          className="form-select form-input--sm"
                          style={{ flex: 1, maxWidth: 200 }}
                          value={tpl.writing_rule_id || ''}
                          onChange={async (e) => {
                            const ruleId = e.target.value ? Number(e.target.value) : null;
                            try {
                              await api.updateWorkflowTemplate(tpl.id, { writing_rule_id: ruleId });
                              setWfTemplates(prev => prev.map(t => t.id === tpl.id ? { ...t, writing_rule_id: ruleId } : t));
                            } catch (er: any) { showToast('error', er.message); }
                          }}
                        >
                          <option value="">指定なし</option>
                          {writingRules.map((r: any) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state" style={{ marginBottom: 32 }}>
              <p>📋 テンプレートがありません（マイグレーション適用後に表示されます）</p>
            </div>
          )}

          {/* AI-Generated Workflows */}
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            🤖 AI生成ワークフロー
          </h3>
          <div className="action-bar" style={{ marginBottom: '1rem' }}>
            <button className="btn btn--primary" onClick={handleGenerateWorkflows} disabled={generating}>
              {generating ? '⏳ 生成中...' : '⚙️ ワークフロー生成'}
            </button>
          </div>
          {workflows.length === 0 ? (
            <div className="empty-state">
              <p>⚙️ AI生成ワークフローはありません</p>
              <p>スキルを抽出してからワークフロー生成を実行してください</p>
            </div>
          ) : (
            workflows.map((wf) => (
              <div key={wf.id} className={`workflow-card workflow-card--${wf.status}`}>
                <div className="workflow-card__header">
                  <h4>{wf.title}</h4>
                  <span className={`badge badge--wf-${wf.status}`}>
                    {wf.status === 'suggested' ? '🔔 提案' : wf.status === 'approved' ? '✅ 承認済み' : '❌ 却下'}
                  </span>
                </div>
                <p className="workflow-card__desc">{wf.description}</p>
                <div className="workflow-card__steps">
                  {parseSteps(wf.steps).map((step) => (
                    <div key={step.order} className="workflow-step">
                      <span className="workflow-step__number">{step.order}</span>
                      <div>
                        <strong>{step.action}</strong>
                        <p>{step.details}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {wf.status === 'suggested' && (
                  <div className="workflow-card__actions">
                    <button className="btn btn--primary btn--sm" onClick={() => handleWorkflowAction(wf.id, 'approved')}>
                      ✅ 承認
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => handleWorkflowAction(wf.id, 'rejected')}>
                      ❌ 却下
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
