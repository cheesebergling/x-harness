import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createTweet,
  createThread,
  scheduleTweet,
  getTweetLogs,
  getScheduledTweets,
  scheduleAction,
  getScheduledActions,
  cancelScheduledAction,
  updateScheduledTweet,
  cancelScheduledTweet,
  type TweetLog,
  type ScheduledTweet,
} from '../api';

interface PostsPageProps {
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

type PostTab = 'compose' | 'scheduled' | 'history';

const MAX_CHARS = 280;

// ─── Security: Input sanitization ───────────────────────────
function sanitize(text: string): string {
  return text
    .replace(/\0/g, '')           // null bytes
    .replace(/<script[^>]*>.*?<\/script>/gi, '') // script tags
    .trim();
}

function validatePostText(text: string): string | null {
  const clean = sanitize(text);
  if (!clean) return 'ポストのテキストを入力してください';
  if (clean.length > MAX_CHARS) return `${MAX_CHARS}文字を超えています`;
  return null;
}

// ─── CharCounter ────────────────────────────────────────────
function CharCounter({ count }: { count: number }) {
  const radius = 12;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.min(count / MAX_CHARS, 1);
  const offset = circumference * (1 - ratio);

  let className = 'char-counter__fill';
  if (count > MAX_CHARS) className += ' char-counter__fill--danger';
  else if (count > MAX_CHARS * 0.9) className += ' char-counter__fill--warning';

  return (
    <div className="char-counter" title={`${count} / ${MAX_CHARS}`}>
      <svg className="char-counter__ring" viewBox="0 0 32 32" width="32" height="32">
        <circle className="char-counter__bg" cx="16" cy="16" r={radius} />
        <circle className={className} cx="16" cy="16" r={radius}
          strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
    </div>
  );
}

// ─── Labels ─────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  pending: '⏳ 待機中',
  sent: '✅ 送信済み',
  failed: '❌ 失敗',
  cancelled: '🚫 キャンセル',
};

const ACTION_LABELS: Record<string, string> = {
  repost: '🔁 リポスト',
  unrepost: '↩️ リポスト解除',
  delete: '🗑️ 削除',
  like: '❤️ いいね',
  unlike: '💔 いいね解除',
};

const ACTION_STATUS_LABELS: Record<string, string> = {
  pending: '⏳ 待機中',
  executed: '✅ 実行済み',
  failed: '❌ 失敗',
  cancelled: '🚫 キャンセル',
};

// ─── InlineEditor ───────────────────────────────────────────
function InlineEditor({
  item,
  onSave,
  onCancel,
}: {
  item: ScheduledTweet;
  onSave: (id: number, text: string, date?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [editText, setEditText] = useState(item.text);
  const [editDate, setEditDate] = useState(item.scheduled_at.slice(0, 16));
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSave = async () => {
    const clean = sanitize(editText);
    const err = validatePostText(clean);
    if (err) return;
    setSaving(true);
    try {
      await onSave(item.id, clean, editDate || undefined);
    } finally {
      setSaving(false);
    }
  };

  const minDate = new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16);

  return (
    <div className="inline-editor">
      <textarea
        ref={textareaRef}
        className="form-textarea"
        value={editText}
        onChange={(e) => setEditText(e.target.value)}
        maxLength={MAX_CHARS}
        style={{ minHeight: 80 }}
      />
      <div className="inline-editor__row">
        <CharCounter count={editText.length} />
        <input
          type="datetime-local"
          className="form-input form-input--sm"
          value={editDate}
          onChange={(e) => setEditDate(e.target.value)}
          min={minDate}
          style={{ flex: 1, maxWidth: 220 }}
        />
        <button className="btn btn--primary btn--sm" onClick={handleSave} disabled={saving || !editText.trim()}>
          {saving ? '⏳' : '💾'} 保存
        </button>
        <button className="btn btn--ghost btn--sm" onClick={onCancel} disabled={saving}>
          キャンセル
        </button>
      </div>
    </div>
  );
}

// ─── Main PostsPage ─────────────────────────────────────────
export function PostsPage({ showToast }: PostsPageProps) {
  const [tab, setTab] = useState<PostTab>('compose');

  // 作成状態
  const [text, setText] = useState('');
  const [isThread, setIsThread] = useState(false);
  const [threadTexts, setThreadTexts] = useState(['', '']);
  const [isSchedule, setIsSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [posting, setPosting] = useState(false);

  // 予約アクション
  const [actionType, setActionType] = useState('repost');
  const [actionTweetId, setActionTweetId] = useState('');
  const [actionDate, setActionDate] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [scheduledActions, setScheduledActions] = useState<any[]>([]);

  // データ
  const [logs, setLogs] = useState<TweetLog[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledTweet[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  // 編集中
  const [editingId, setEditingId] = useState<number | null>(null);

  // ─── データ読み込み ───
  const loadData = useCallback(async () => {
    setLogsLoading(true);
    try {
      const [logsRes, schedRes, actionsRes] = await Promise.all([
        getTweetLogs(50),
        getScheduledTweets(),
        getScheduledActions(),
      ]);
      setLogs(logsRes.data || []);
      setScheduled(schedRes.data || []);
      setScheduledActions(actionsRes.data || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'データの読み込みに失敗しました';
      showToast('error', message);
    } finally {
      setLogsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ─── 送信 ───
  const handleSubmit = useCallback(async () => {
    setPosting(true);
    try {
      if (isThread && isSchedule) {
        const validTweets = threadTexts.filter((t) => sanitize(t).length > 0);
        if (validTweets.length < 2) {
          showToast('error', 'スレッドには2つ以上のポストが必要です');
          return;
        }
        if (!scheduleDate) {
          showToast('error', '予約日時を選択してください');
          return;
        }
        await scheduleTweet(validTweets[0], scheduleDate, undefined, validTweets);
        showToast('success', `${validTweets.length}件のスレッドを予約しました！`);
        setThreadTexts(['', '']);
        setScheduleDate('');
      } else if (isThread) {
        const validTweets = threadTexts.filter((t) => sanitize(t).length > 0);
        if (validTweets.length < 2) {
          showToast('error', 'スレッドには2つ以上のポストが必要です');
          return;
        }
        await createThread(validTweets);
        showToast('success', `${validTweets.length}件のスレッドを投稿しました！`);
        setThreadTexts(['', '']);
      } else if (isSchedule) {
        if (!scheduleDate) {
          showToast('error', '予約日時を選択してください');
          return;
        }
        await scheduleTweet(text, scheduleDate);
        showToast('success', 'ポストを予約しました！');
        setScheduleDate('');
      } else {
        await createTweet(text);
        showToast('success', 'ポストを投稿しました！');
      }
      setText('');
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '投稿に失敗しました';
      showToast('error', message);
    } finally {
      setPosting(false);
    }
  }, [text, isThread, threadTexts, isSchedule, scheduleDate, showToast, loadData]);


  // ─── 予約ポスト編集 ───
  const handleEditScheduled = useCallback(
    async (id: number, newText: string, newDate?: string) => {
      const clean = sanitize(newText);
      const err = validatePostText(clean);
      if (err) {
        showToast('error', err);
        return;
      }
      try {
        await updateScheduledTweet(id, { text: clean, scheduled_at: newDate });
        showToast('success', '予約ポストを更新しました');
        setEditingId(null);
        await loadData();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '更新に失敗しました';
        showToast('error', message);
      }
    },
    [showToast, loadData]
  );

  // ─── 予約ポストキャンセル ───
  const handleCancelScheduled = useCallback(
    async (id: number) => {
      try {
        await cancelScheduledTweet(id);
        showToast('info', '予約をキャンセルしました');
        await loadData();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'キャンセルに失敗しました';
        showToast('error', message);
      }
    },
    [showToast, loadData]
  );

  // スレッドヘルパー
  const addThreadTweet = () => setThreadTexts((prev) => [...prev, '']);
  const removeThreadTweet = (idx: number) =>
    setThreadTexts((prev) => prev.filter((_, i) => i !== idx));
  const updateThreadTweet = (idx: number, val: string) =>
    setThreadTexts((prev) => prev.map((t, i) => (i === idx ? val : t)));

  const activeText = isThread ? threadTexts[0] : text;
  const minDate = new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16);

  // ─── 予約中フィルター：pending のみ ───
  const pendingScheduled = scheduled.filter((s) => s.status === 'pending');
  const pendingActions = scheduledActions.filter((a: any) => a.status === 'pending');

  // ─── 投稿履歴：sent + failed + cancelled (予約含む) ───
  const historyScheduled = scheduled.filter((s) => s.status !== 'pending');
  const historyActions = scheduledActions.filter((a: any) => a.status !== 'pending');

  return (
    <>
      {/* ── タブバー ── */}
      <div className="tab-bar">
        <button className={`tab-btn ${tab === 'compose' ? 'tab-btn--active' : ''}`} onClick={() => setTab('compose')}>
          📝 ポスト作成
        </button>
        <button className={`tab-btn ${tab === 'scheduled' ? 'tab-btn--active' : ''}`} onClick={() => setTab('scheduled')}>
          ⏰ 予約中
          {(pendingScheduled.length + pendingActions.length) > 0 && (
            <span className="tab-badge">{pendingScheduled.length + pendingActions.length}</span>
          )}
        </button>
        <button className={`tab-btn ${tab === 'history' ? 'tab-btn--active' : ''}`} onClick={() => setTab('history')}>
          📋 投稿履歴
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════
           TAB 1: ポスト作成
         ════════════════════════════════════════════════════════════ */}
      {tab === 'compose' && (
        <>
          <div className="compose">
            <div className="compose__main">
              <div className="card card--glow">
                <div className="card__header">
                  <h3 className="card__title">
                    {isThread ? '🧵 スレッド作成' : '📝 ポスト作成'}
                  </h3>
                  <CharCounter count={activeText.length} />
                </div>

                {isThread ? (
                  <div className="thread-builder">
                    {threadTexts.map((t, i) => (
                      <div className="thread-item" key={i}>
                        <div className="thread-item__dot">{i + 1}</div>
                        {i < threadTexts.length - 1 && <div className="thread-item__line" />}
                        <div className="thread-item__input" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <textarea
                            className="form-textarea"
                            placeholder={`ポスト ${i + 1}…`}
                            value={t}
                            onChange={(e) => updateThreadTweet(i, e.target.value)}
                            maxLength={MAX_CHARS}
                            style={{ minHeight: 80 }}
                          />
                          {threadTexts.length > 2 && (
                            <button className="btn btn--ghost btn--icon" onClick={() => removeThreadTweet(i)} title="削除">✕</button>
                          )}
                        </div>
                      </div>
                    ))}
                    <button className="btn btn--secondary btn--sm" onClick={addThreadTweet}>
                      + ポストを追加
                    </button>
                  </div>
                ) : (
                  <textarea
                    id="compose-textarea"
                    className="form-textarea"
                    placeholder="いまなにしてる？"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={isSchedule ? MAX_CHARS : undefined}
                  />
                )}

                {isSchedule && (
                  <div className="form-group" style={{ marginTop: 12 }}>
                    <label className="form-label">予約日時：</label>
                    <input type="datetime-local" className="form-input" value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)} min={minDate} />
                  </div>
                )}

                <div className="compose__footer" style={{ marginTop: 16 }}>
                  <div className="compose__options">
                    <label className="toggle">
                      <input className="toggle__input" type="checkbox" checked={isThread}
                        onChange={(e) => setIsThread(e.target.checked)} />
                      <span className="toggle__track"><span className="toggle__thumb" /></span>
                      <span className="toggle__label">スレッド</span>
                    </label>
                    <label className="toggle">
                      <input className="toggle__input" type="checkbox" checked={isSchedule}
                        onChange={(e) => setIsSchedule(e.target.checked)} />
                      <span className="toggle__track"><span className="toggle__thumb" /></span>
                      <span className="toggle__label">予約投稿</span>
                    </label>
                  </div>
                  <button id="submit-tweet-btn" className="btn btn--primary" onClick={handleSubmit}
                    disabled={posting || (!isThread && text.trim().length === 0) || (isThread && threadTexts.filter((t) => t.trim()).length < 2)}>
                    {posting ? (<><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, display: 'inline-block' }} /> 投稿中…</>) :
                      isSchedule ? '⏰ 予約する' : '🚀 投稿する'}
                  </button>
                </div>
              </div>
            </div>

            {/* サイドカード: 予約アクション */}
            <div className="compose__aside">
              <div className="card">
                <h3 className="card__title" style={{ marginBottom: 16 }}>🔄 予約アクション</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">アクション</label>
                    <select className="form-select" value={actionType} onChange={(e) => setActionType(e.target.value)}>
                      <option value="repost">🔁 リポスト</option>
                      <option value="unrepost">↩️ リポスト解除</option>
                      <option value="delete">🗑️ 削除</option>
                      <option value="like">❤️ いいね</option>
                      <option value="unlike">💔 いいね解除</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">ポスト ID</label>
                    <input className="form-input" type="text" placeholder="1234567890123456789"
                      value={actionTweetId}
                      onChange={(e) => setActionTweetId(e.target.value.replace(/\D/g, ''))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">実行日時</label>
                    <input className="form-input" type="datetime-local" value={actionDate}
                      onChange={(e) => setActionDate(e.target.value)} min={minDate} />
                  </div>
                  <button className="btn btn--primary" disabled={actionSubmitting || !actionTweetId.trim() || !actionDate}
                    onClick={async () => {
                      if (!/^\d+$/.test(actionTweetId)) {
                        showToast('error', '不正なポストIDです');
                        return;
                      }
                      setActionSubmitting(true);
                      try {
                        await scheduleAction(actionType, actionTweetId, actionDate);
                        showToast('success', `${ACTION_LABELS[actionType]} を予約しました`);
                        setActionTweetId('');
                        setActionDate('');
                        loadData();
                      } catch (err: any) {
                        showToast('error', err.message);
                      } finally {
                        setActionSubmitting(false);
                      }
                    }}>
                    {actionSubmitting ? '⏳' : '⏰'} 予約
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════
           TAB 2: 予約中
         ════════════════════════════════════════════════════════════ */}
      {tab === 'scheduled' && (
        <>
          {/* 予約ポスト */}
          <div className="section-divider">📝 予約ポスト</div>
          <div className="card">
            {pendingScheduled.length === 0 ? (
              <div className="empty-state" style={{ padding: '32px 0' }}>
                <div className="empty-state__icon">📭</div>
                <div className="empty-state__title">予約ポストはありません</div>
                <div className="empty-state__description">
                  「ポスト作成」タブで予約投稿をオンにして作成できます。
                </div>
              </div>
            ) : (
              <div className="tweet-list">
                {pendingScheduled.map((s) => (
                  <div key={s.id} className="tweet-item">
                    {editingId === s.id ? (
                      <InlineEditor item={s} onSave={handleEditScheduled} onCancel={() => setEditingId(null)} />
                    ) : (
                      <>
                        <div className="tweet-item__text">
                          {s.text}
                          {(s as any).thread_tweets && (
                            <span className="badge badge--category" style={{ marginLeft: 8, fontSize: '0.625rem' }}>🧵 スレッド</span>
                          )}
                        </div>
                        <div className="tweet-item__meta">
                          <span>📅 {new Date(s.scheduled_at).toLocaleString('ja-JP')}</span>
                          <span className="schedule-badge schedule-badge--pending">{STATUS_LABELS[s.status]}</span>
                        </div>
                        <div className="scheduled-actions-row">
                          <button className="btn btn--secondary btn--sm" onClick={() => setEditingId(s.id)}>
                            ✏️ 編集
                          </button>
                          <button className="btn btn--danger btn--sm" onClick={() => handleCancelScheduled(s.id)}>
                            🚫 キャンセル
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 予約アクション */}
          <div className="section-divider" style={{ marginTop: 24 }}>🔄 予約アクション</div>
          <div className="card">
            {pendingActions.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 0' }}>
                <p>予約アクションはありません</p>
              </div>
            ) : (
              <div className="tweet-list">
                {pendingActions.map((a: any) => (
                  <div key={a.id} className="tweet-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>{ACTION_LABELS[a.action_type] || a.action_type}</span>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                          ID: {a.target_tweet_id}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          📅 {new Date(a.scheduled_at).toLocaleString('ja-JP')}
                        </div>
                      </div>
                    </div>
                    <button className="btn btn--danger btn--sm" style={{ marginTop: 8, width: '100%' }}
                      onClick={async () => {
                        try {
                          await cancelScheduledAction(a.id);
                          showToast('info', 'アクションをキャンセルしました');
                          loadData();
                        } catch (err: any) {
                          showToast('error', err.message);
                        }
                      }}>
                      🚫 キャンセル
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════
           TAB 3: 投稿履歴
         ════════════════════════════════════════════════════════════ */}
      {tab === 'history' && (
        <>
          {/* 投稿ログ */}
          <div className="card">
            <div className="card__header">
              <h3 className="card__title">📋 投稿ログ</h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{logs.length} 件</span>
            </div>
            {logsLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
                <div className="spinner spinner--lg" />
              </div>
            ) : logs.length === 0 ? (
              <div className="empty-state">
                <p>📝 まだポストがありません</p>
                <p>投稿したポストがここに表示されます。</p>
              </div>
            ) : (
              <div className="tweet-list">
                {logs.map((log) => (
                  <div key={log.id} className="tweet-item">
                    <div className="tweet-item__text">{log.text}</div>
                    <div className="tweet-item__meta">
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        {new Date(log.created_at).toLocaleString('ja-JP')}
                      </span>
                      <div className="tweet-item__actions">
                        {log.tweet_id ? (
                          <a
                            href={`https://x.com/i/account_analytics/content/${log.tweet_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn--secondary btn--sm"
                            title="X Premium アナリティクスで確認"
                          >
                            📊 アナリティクス
                          </a>
                        ) : (
                          <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)' }}>ID未保持</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 予約の実行済み/失敗/キャンセル履歴 */}
          {(historyScheduled.length > 0 || historyActions.length > 0) && (
            <>
              <div className="section-divider" style={{ marginTop: 24 }}>📦 予約実行履歴</div>
              <div className="card">
                <div className="tweet-list">
                  {historyScheduled.map((s) => (
                    <div key={`s-${s.id}`} className="tweet-item">
                      <div className="tweet-item__text">
                        {s.text}
                        {(s as any).thread_tweets && (
                          <span className="badge badge--category" style={{ marginLeft: 8, fontSize: '0.625rem' }}>🧵</span>
                        )}
                      </div>
                      <div className="tweet-item__meta">
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          📅 {new Date(s.scheduled_at).toLocaleString('ja-JP')}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className={`schedule-badge schedule-badge--${s.status === 'sent' ? 'sent' : 'failed'}`}>
                            {STATUS_LABELS[s.status] || s.status}
                          </span>
                          {s.status === 'sent' && s.tweet_id && (
                            <a
                              href={`https://x.com/i/account_analytics/content/${s.tweet_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn--secondary btn--sm"
                            >
                              📊
                            </a>
                          )}
                        </div>
                      </div>
                      {s.status === 'failed' && (s as any).error && (
                        <div className="error-detail">
                          ⚠️ {(s as any).error}
                        </div>
                      )}
                    </div>
                  ))}
                  {historyActions.map((a: any) => (
                    <div key={`a-${a.id}`} className="tweet-item">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 600 }}>{ACTION_LABELS[a.action_type] || a.action_type}</span>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                            ID: {a.target_tweet_id}
                          </div>
                        </div>
                        <span className={`schedule-badge schedule-badge--${a.status === 'executed' ? 'sent' : 'failed'}`}>
                          {ACTION_STATUS_LABELS[a.status] || a.status}
                        </span>
                      </div>
                      {a.status === 'failed' && a.error && (
                        <div className="error-detail">
                          ⚠️ {a.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
