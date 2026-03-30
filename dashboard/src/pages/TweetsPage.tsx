import { useState, useEffect, useCallback } from 'react';
import {
  createTweet,
  createThread,
  deleteTweet,
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

interface TweetsPageProps {
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

const MAX_CHARS = 280;

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
        <circle
          className={className}
          cx="16"
          cy="16"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待機中',
  sent: '送信済み',
  failed: '失敗',
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

export function TweetsPage({ showToast }: TweetsPageProps) {
  // 作成状態
  const [text, setText] = useState('');
  const [isThread, setIsThread] = useState(false);
  const [threadTexts, setThreadTexts] = useState(['', '']);
  const [isSchedule, setIsSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [posting, setPosting] = useState(false);

  // 予約アクション状態
  const [actionType, setActionType] = useState('repost');
  const [actionTweetId, setActionTweetId] = useState('');
  const [actionDate, setActionDate] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [scheduledActions, setScheduledActions] = useState<any[]>([]);

  // データ状態
  const [logs, setLogs] = useState<TweetLog[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledTweet[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  // データ読み込み
  const loadData = useCallback(async () => {
    setLogsLoading(true);
    try {
      const [logsRes, schedRes, actionsRes] = await Promise.all([
        getTweetLogs(30),
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

  // 送信
  const handleSubmit = useCallback(async () => {
    setPosting(true);
    try {
      if (isThread && isSchedule) {
        // スレッド予約
        const validTweets = threadTexts.filter((t) => t.trim().length > 0);
        if (validTweets.length < 2) {
          showToast('error', 'スレッドには2つ以上のツイートが必要です');
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
        const validTweets = threadTexts.filter((t) => t.trim().length > 0);
        if (validTweets.length < 2) {
          showToast('error', 'スレッドには2つ以上のツイートが必要です');
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
        showToast('success', 'ツイートを予約しました！');
        setScheduleDate('');
      } else {
        await createTweet(text);
        showToast('success', 'ツイートを投稿しました！');
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

  // 削除（ダブルチェック確認）
  const handleDelete = useCallback(
    async (tweetId: string) => {
      const confirmed = confirm(
        '⚠️ Xから完全に削除されます。この操作は取り消せません。\n\n本当にこのツイートを削除しますか？'
      );
      if (!confirmed) return;
      try {
        await deleteTweet(tweetId);
        showToast('success', 'ツイートを削除しました');
        await loadData();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '削除に失敗しました';
        showToast('error', message);
      }
    },
    [showToast, loadData]
  );

  // 予約ツイート編集
  const handleEditScheduled = useCallback(
    async (id: number, newText: string, newDate?: string) => {
      try {
        await updateScheduledTweet(id, { text: newText, scheduled_at: newDate });
        showToast('success', '予約ツイートを更新しました');
        await loadData();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '更新に失敗しました';
        showToast('error', message);
      }
    },
    [showToast, loadData]
  );

  // 予約ツイートキャンセル
  const handleCancelScheduled = useCallback(
    async (id: number) => {
      if (!confirm('この予約ツイートをキャンセルしますか？')) return;
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

  // 最小予約日時（5分後）
  const minDate = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16);

  return (
    <>
      {/* ── 作成セクション ── */}
      <div className="compose">
        <div className="compose__main">
          <div className="card card--glow">
            <div className="card__header">
              <h3 className="card__title">
                {isThread ? '🧵 スレッド作成' : '📝 ツイート作成'}
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
                        placeholder={`ツイート ${i + 1}…`}
                        value={t}
                        onChange={(e) => updateThreadTweet(i, e.target.value)}
                        maxLength={MAX_CHARS}
                        style={{ minHeight: 80 }}
                      />
                      {threadTexts.length > 2 && (
                        <button
                          className="btn btn--ghost btn--icon"
                          onClick={() => removeThreadTweet(i)}
                          title="削除"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <button className="btn btn--secondary btn--sm" onClick={addThreadTweet}>
                  + ツイートを追加
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

            {/* 予約日時 */}
            {isSchedule && (
              <div className="form-group" style={{ marginTop: 12 }}>
                <label className="form-label">予約日時：</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  min={minDate}
                />
              </div>
            )}

            <div className="compose__footer" style={{ marginTop: 16 }}>
              <div className="compose__options">
                <label className="toggle">
                  <input
                    className="toggle__input"
                    type="checkbox"
                    checked={isThread}
                    onChange={(e) => setIsThread(e.target.checked)}
                  />
                  <span className="toggle__track">
                    <span className="toggle__thumb" />
                  </span>
                  <span className="toggle__label">スレッド</span>
                </label>

                <label className="toggle">
                  <input
                    className="toggle__input"
                    type="checkbox"
                    checked={isSchedule}
                    onChange={(e) => setIsSchedule(e.target.checked)}
                  />
                  <span className="toggle__track">
                    <span className="toggle__thumb" />
                  </span>
                  <span className="toggle__label">予約投稿</span>
                </label>
              </div>

              <button
                id="submit-tweet-btn"
                className="btn btn--primary"
                onClick={handleSubmit}
                disabled={
                  posting ||
                  (!isThread && text.trim().length === 0) ||
                  (isThread && threadTexts.filter((t) => t.trim()).length < 2)
                }
              >
                {posting ? (
                  <>
                    <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, display: 'inline-block' }} />
                    投稿中…
                  </>
                ) : isSchedule ? (
                  '⏰ 予約する'
                ) : (
                  '🚀 投稿する'
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── サイドバー: 予約投稿 ── */}
        <div className="compose__aside">
          <div className="card">
            <div className="card__header">
              <h3 className="card__title">⏰ 予約投稿</h3>
              <span className="schedule-badge schedule-badge--pending">
                {scheduled.length}
              </span>
            </div>

            {scheduled.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 0' }}>
                <div className="empty-state__icon">📭</div>
                <div className="empty-state__title">予約ツイートはありません</div>
                <div className="empty-state__description">
                  「予約投稿」をオンにして日時を選択すると、ツイートをキューに追加できます。
                </div>
              </div>
            ) : (
              <div className="tweet-list">
                {scheduled.map((s) => (
                  <div key={s.id} className="tweet-item">
                    <div className="tweet-item__text">
                      {s.text}
                      {(s as any).thread_tweets && (
                        <span className="badge badge--category" style={{ marginLeft: 8, fontSize: '0.625rem' }}>🧵 スレッド</span>
                      )}
                    </div>
                    <div className="tweet-item__meta">
                      <span>
                        {new Date(s.scheduled_at).toLocaleString('ja-JP')}
                      </span>
                      <span
                        className={`schedule-badge schedule-badge--${s.status}`}
                      >
                        {STATUS_LABELS[s.status] || s.status}
                      </span>
                    </div>
                    {s.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button
                          className="btn btn--ghost btn--sm"
                          style={{ flex: 1 }}
                          onClick={() => {
                            const newText = prompt('テキストを編集:', s.text);
                            if (newText !== null && newText.trim()) {
                              handleEditScheduled(s.id, newText.trim());
                            }
                          }}
                        >
                          ✏️ 編集
                        </button>
                        <button
                          className="btn btn--danger btn--sm"
                          style={{ flex: 1 }}
                          onClick={() => handleCancelScheduled(s.id)}
                        >
                          🚫 キャンセル
                        </button>
                      </div>
                    )}
                    {s.status === 'failed' && (s as any).error && (
                      <div style={{ fontSize: '0.6875rem', color: 'var(--error)', marginTop: 4 }}>
                        エラー: {(s as any).error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 予約アクション ── */}
      <div className="section-divider" style={{ marginTop: 32 }}>🔄 予約アクション</div>

      <div className="compose" style={{ marginBottom: 32 }}>
        <div className="compose__main">
          <div className="card">
            <h3 className="card__title" style={{ marginBottom: 16 }}>アクションを予約</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ marginBottom: 0, flex: '0 0 auto' }}>
                <label className="form-label">アクション</label>
                <select
                  className="form-select"
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value)}
                >
                  <option value="repost">🔁 リポスト</option>
                  <option value="unrepost">↩️ リポスト解除</option>
                  <option value="delete">🗑️ 削除</option>
                  <option value="like">❤️ いいね</option>
                  <option value="unlike">💔 いいね解除</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
                <label className="form-label">ツイート ID</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="1234567890123456789"
                  value={actionTweetId}
                  onChange={(e) => setActionTweetId(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">実行日時</label>
                <input
                  className="form-input"
                  type="datetime-local"
                  value={actionDate}
                  onChange={(e) => setActionDate(e.target.value)}
                  min={minDate}
                />
              </div>
              <button
                className="btn btn--primary"
                disabled={actionSubmitting || !actionTweetId.trim() || !actionDate}
                onClick={async () => {
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
                }}
              >
                {actionSubmitting ? '⏳' : '⏰'} 予約
              </button>
            </div>
          </div>
        </div>

        <div className="compose__aside">
          <div className="card">
            <div className="card__header">
              <h3 className="card__title">📋 予約済み</h3>
              <span className="schedule-badge schedule-badge--pending">{scheduledActions.length}</span>
            </div>
            {scheduledActions.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 0' }}>
                <p>予約アクションはありません</p>
              </div>
            ) : (
              <div className="tweet-list">
                {scheduledActions.map((a: any) => (
                  <div key={a.id} className="tweet-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>{ACTION_LABELS[a.action_type] || a.action_type}</span>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                          ID: {a.target_tweet_id}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className={`schedule-badge schedule-badge--${a.status === 'executed' ? 'sent' : a.status}`}>
                          {ACTION_STATUS_LABELS[a.status] || a.status}
                        </span>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                          {new Date(a.scheduled_at).toLocaleString('ja-JP')}
                        </div>
                      </div>
                    </div>
                    {a.status === 'pending' && (
                      <button
                        className="btn btn--ghost btn--sm"
                        style={{ marginTop: 8, width: '100%' }}
                        onClick={async () => {
                          try {
                            await cancelScheduledAction(a.id);
                            showToast('info', 'アクションをキャンセルしました');
                            loadData();
                          } catch (err: any) {
                            showToast('error', err.message);
                          }
                        }}
                      >
                        🚫 キャンセル
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── ツイート履歴 ── */}
      <div className="section-divider" style={{ marginTop: 32 }}>投稿履歴</div>

      <div className="card">
        {logsLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <div className="spinner spinner--lg" />
          </div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <p>📝 まだツイートがありません</p>
            <p>投稿したツイートがエンゲージメント指標とともにここに表示されます。</p>
          </div>
        ) : (
          <div className="tweet-list">
            {logs.map((log) => (
              <div key={log.id} className="tweet-item">
                <div className="tweet-item__text">{log.text}</div>
                <div className="tweet-item__meta">
                  <div className="tweet-item__stats">
                    <span className="tweet-item__stat">
                      👁️ {(log.impressions || 0).toLocaleString()}
                    </span>
                    <span className="tweet-item__stat">
                      ❤️ {(log.likes || 0).toLocaleString()}
                    </span>
                    <span className="tweet-item__stat">
                      🔁 {(log.retweets || 0).toLocaleString()}
                    </span>
                    <span className="tweet-item__stat">
                      💬 {(log.replies || 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="tweet-item__actions">
                    <span style={{ color: 'var(--text-tertiary)', marginRight: 8 }}>
                      {new Date(log.created_at).toLocaleDateString('ja-JP')}
                    </span>
                    {log.tweet_id && !log.deleted_at && (
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={() => handleDelete(log.tweet_id)}
                      >
                        削除
                      </button>
                    )}
                    {log.deleted_at && (
                      <span
                        className="schedule-badge schedule-badge--failed"
                        style={{ fontSize: '0.6875rem' }}
                      >
                        削除済み
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
