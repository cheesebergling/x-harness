import { useState, useEffect, useCallback } from 'react';
import {
  getDmConversation,
  sendDm,
  getDmTemplates,
  createDmTemplate,
  updateDmTemplate,
  deleteDmTemplate,
  getDmAutoReplies,
  createDmAutoReply,
  updateDmAutoReply,
  deleteDmAutoReply,
  syncDmEvents,
  getCachedDmEvents,
  getCachedDmUsers,
} from '../api';

interface DmPageProps {
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

type TabKey = 'inbox' | 'templates' | 'auto-reply';

export function DmPage({ showToast }: DmPageProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('inbox');
  const [loading, setLoading] = useState(false);

  // ─── Inbox State ───
  const [events, setEvents] = useState<any[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<any[]>([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  // ─── Templates State ───
  const [templates, setTemplates] = useState<any[]>([]);
  const [newTplName, setNewTplName] = useState('');
  const [newTplText, setNewTplText] = useState('');
  const [newTplCategory, setNewTplCategory] = useState('general');

  // ─── Auto-Reply State ───
  const [autoReplies, setAutoReplies] = useState<any[]>([]);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleTrigger, setNewRuleTrigger] = useState('');
  const [newRuleReply, setNewRuleReply] = useState('');

  // ─── User Profile Cache ───
  const [userProfiles, setUserProfiles] = useState<Record<string, { name: string; username: string; profile_image_url?: string }>>({});
  const [syncing, setSyncing] = useState(false);

  // ─── Load Data (D1 キャッシュから) ───
  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      // D1 キャッシュから読み出し（X API を叩かない）
      const res = await getCachedDmEvents(100);
      const evts = res.data || [];
      setEvents(evts);

      // キャッシュ済みユーザー情報を読み出し
      try {
        const usersRes = await getCachedDmUsers();
        const profiles: typeof userProfiles = {};
        for (const u of (usersRes.data || [])) {
          profiles[u.user_id] = { name: u.name, username: u.username, profile_image_url: u.profile_image_url };
        }
        setUserProfiles(prev => ({ ...prev, ...profiles }));
      } catch { /* silent */ }
    } catch (err: any) {
      showToast('error', err.message || 'DM取得に失敗');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // ─── 手動同期（X API → D1） ───
  const handleSyncDm = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await syncDmEvents(50);
      showToast('success', `✅ ${res.data?.synced || 0}件のDMを同期しました`);
      await loadInbox(); // キャッシュを再読み込み
    } catch (err: any) {
      showToast('error', err.message || 'DM同期に失敗');
    } finally {
      setSyncing(false);
    }
  }, [showToast, loadInbox]);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await getDmTemplates();
      setTemplates(res.data || []);
    } catch (err: any) {
      showToast('error', err.message || 'テンプレート取得に失敗');
    }
  }, [showToast]);

  const loadAutoReplies = useCallback(async () => {
    try {
      const res = await getDmAutoReplies();
      setAutoReplies(res.data || []);
    } catch (err: any) {
      showToast('error', err.message || '自動応答ルール取得に失敗');
    }
  }, [showToast]);

  useEffect(() => {
    if (activeTab === 'inbox') loadInbox();
    if (activeTab === 'templates') loadTemplates();
    if (activeTab === 'auto-reply') loadAutoReplies();
  }, [activeTab, loadInbox, loadTemplates, loadAutoReplies]);

  // ─── Handlers ───
  const handleSelectConversation = async (participantId: string) => {
    setSelectedConversation(participantId);
    try {
      const res = await getDmConversation(participantId, 30);
      setConversationMessages(res.data?.data || []);
    } catch (err: any) {
      showToast('error', err.message || '会話取得に失敗');
    }
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedConversation) return;
    setSending(true);
    try {
      await sendDm(selectedConversation, replyText);
      showToast('success', 'DMを送信しました');
      setReplyText('');
      handleSelectConversation(selectedConversation);
    } catch (err: any) {
      showToast('error', err.message || 'DM送信に失敗');
    } finally {
      setSending(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!newTplName.trim() || !newTplText.trim()) return;
    try {
      await createDmTemplate({ name: newTplName, text: newTplText, category: newTplCategory });
      showToast('success', 'テンプレートを作成しました');
      setNewTplName('');
      setNewTplText('');
      loadTemplates();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleCreateAutoReply = async () => {
    if (!newRuleName.trim() || !newRuleTrigger.trim() || !newRuleReply.trim()) return;
    try {
      await createDmAutoReply({ name: newRuleName, trigger_value: newRuleTrigger, reply_text: newRuleReply });
      showToast('success', '自動応答ルールを作成しました');
      setNewRuleName('');
      setNewRuleTrigger('');
      setNewRuleReply('');
      loadAutoReplies();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  // ─── Group events by sender ───
  const groupedEvents = events.reduce((acc: Record<string, any[]>, ev: any) => {
    const key = ev.sender_id || ev.participant_ids?.[0] || 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(ev);
    return acc;
  }, {});

  return (
    <div className="dm-page">
      {/* Tab Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div className="tab-bar" style={{ marginBottom: 0 }}>
          <button className={`tab-btn ${activeTab === 'inbox' ? 'tab-btn--active' : ''}`} onClick={() => setActiveTab('inbox')}>
            📩 受信箱
          </button>
          <button className={`tab-btn ${activeTab === 'templates' ? 'tab-btn--active' : ''}`} onClick={() => setActiveTab('templates')}>
            📋 テンプレート
          </button>
          <button className={`tab-btn ${activeTab === 'auto-reply' ? 'tab-btn--active' : ''}`} onClick={() => setActiveTab('auto-reply')}>
            🤖 自動応答
          </button>
        </div>
        {activeTab === 'inbox' && (
          <button className="btn btn--primary" onClick={handleSyncDm} disabled={syncing}>
            {syncing ? '⚙️ 同期中...' : '🔄 最新の会話を取得'}
          </button>
        )}
      </div>

      {/* ─── INBOX ─── */}
      {activeTab === 'inbox' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, minHeight: 400 }}>
          {/* Conversation List */}
          <div className="card" style={{ overflow: 'auto', maxHeight: 600 }}>
            <h3 className="card__title" style={{ padding: '12px 16px', margin: 0, borderBottom: '1px solid var(--border)' }}>
              会話一覧
            </h3>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
                <div className="spinner spinner--lg" />
              </div>
            ) : Object.keys(groupedEvents).length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state__icon">📭</div>
                <div className="empty-state__title">DMがありません</div>
                <div className="empty-state__description">新着DMがここに表示されます</div>
              </div>
            ) : (
              <div className="tweet-list">
                {Object.entries(groupedEvents).map(([senderId, msgs]) => {
                  const profile = userProfiles[senderId];
                  return (
                  <div
                    key={senderId}
                    className={`tweet-item ${selectedConversation === senderId ? 'tweet-item--active' : ''}`}
                    style={{ cursor: 'pointer', borderLeft: selectedConversation === senderId ? '3px solid var(--primary)' : '3px solid transparent' }}
                    onClick={() => handleSelectConversation(senderId)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {profile?.profile_image_url ? (
                        <img
                          src={profile.profile_image_url}
                          alt=""
                          style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }}
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>👤</div>
                      )}
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {profile ? `@${profile.username}` : `ID: ${senderId.slice(-8)}`}
                        {profile && <div style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', fontWeight: 400 }}>{profile.name}</div>}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(msgs[0] as any)?.text?.slice(0, 50) || 'メッセージ'}
                    </div>
                    <div style={{ fontSize: '0.625rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                      {msgs.length} 件
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Message Thread */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            {selectedConversation ? (
              <>
                <h3 className="card__title" style={{ padding: '12px 16px', margin: 0, borderBottom: '1px solid var(--border)' }}>
                  💬 {userProfiles[selectedConversation] ? `@${userProfiles[selectedConversation].username}` : `User ${selectedConversation.slice(-6)}`}
                </h3>
                <div style={{ flex: 1, overflow: 'auto', padding: 16, maxHeight: 400 }}>
                  {conversationMessages.length === 0 ? (
                    <div className="empty-state"><p>メッセージがありません</p></div>
                  ) : (
                    conversationMessages.map((msg: any, i: number) => (
                      <div
                        key={i}
                        style={{
                          marginBottom: 12,
                          padding: '8px 12px',
                          borderRadius: 12,
                          maxWidth: '80%',
                          background: msg.sender_id === selectedConversation ? 'var(--surface-hover)' : 'var(--primary)',
                          color: msg.sender_id === selectedConversation ? 'var(--text-primary)' : '#fff',
                          marginLeft: msg.sender_id === selectedConversation ? 0 : 'auto',
                        }}
                      >
                        <div style={{ fontSize: '0.875rem' }}>{msg.text || '(empty)'}</div>
                        <div style={{ fontSize: '0.625rem', opacity: 0.7, marginTop: 4 }}>
                          {msg.created_at ? new Date(msg.created_at).toLocaleString('ja-JP') : ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                  <input
                    className="form-input"
                    placeholder="返信を入力…"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendReply()}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn--primary"
                    onClick={handleSendReply}
                    disabled={sending || !replyText.trim()}
                  >
                    {sending ? '⏳' : '📤'} 送信
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-state" style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div>
                  <div className="empty-state__icon">💬</div>
                  <div className="empty-state__title">会話を選択</div>
                  <div className="empty-state__description">左からの会話をクリックしてメッセージを表示</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TEMPLATES ─── */}
      {activeTab === 'templates' && (
        <>
          {/* Create Template */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 className="card__title" style={{ marginBottom: 12 }}>📝 テンプレート作成</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ marginBottom: 0, flex: '1 1 200px' }}>
                <label className="form-label">名前</label>
                <input className="form-input" value={newTplName} onChange={(e) => setNewTplName(e.target.value)} placeholder="お礼メッセージ" />
              </div>
              <div className="form-group" style={{ marginBottom: 0, flex: '0 0 auto' }}>
                <label className="form-label">カテゴリ</label>
                <select className="form-select" value={newTplCategory} onChange={(e) => setNewTplCategory(e.target.value)}>
                  <option value="general">一般</option>
                  <option value="sales">営業</option>
                  <option value="support">サポート</option>
                  <option value="thanks">お礼</option>
                </select>
              </div>
              <button className="btn btn--primary" onClick={handleCreateTemplate} disabled={!newTplName.trim() || !newTplText.trim()}>
                ➕ 作成
              </button>
            </div>
            <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
              <textarea
                className="form-textarea"
                value={newTplText}
                onChange={(e) => setNewTplText(e.target.value)}
                placeholder="テンプレートの本文を入力…"
                style={{ minHeight: 80 }}
              />
            </div>
          </div>

          {/* Template List */}
          <div className="card">
            <h3 className="card__title" style={{ marginBottom: 12 }}>📋 テンプレート一覧</h3>
            {templates.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state__icon">📝</div>
                <div className="empty-state__title">テンプレートがありません</div>
                <div className="empty-state__description">上のフォームからテンプレートを作成してください</div>
              </div>
            ) : (
              <div className="tweet-list">
                {templates.map((tpl: any) => (
                  <div key={tpl.id} className="tweet-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>{tpl.name}</span>
                        <span className="badge badge--category" style={{ marginLeft: 8, fontSize: '0.625rem' }}>{tpl.category}</span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>使用: {tpl.use_count}回</span>
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{tpl.text}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={async () => {
                          const newText = prompt('テンプレート本文を編集:', tpl.text);
                          if (newText !== null && newText.trim()) {
                            try {
                              await updateDmTemplate(tpl.id, { text: newText.trim() });
                              showToast('success', '更新しました');
                              loadTemplates();
                            } catch (err: any) { showToast('error', err.message); }
                          }
                        }}
                      >
                        ✏️ 編集
                      </button>
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={async () => {
                          if (!confirm('このテンプレートを削除しますか？')) return;
                          try {
                            await deleteDmTemplate(tpl.id);
                            showToast('info', '削除しました');
                            loadTemplates();
                          } catch (err: any) { showToast('error', err.message); }
                        }}
                      >
                        🗑️ 削除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ─── AUTO-REPLY ─── */}
      {activeTab === 'auto-reply' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 className="card__title" style={{ marginBottom: 12 }}>🤖 自動応答ルール作成</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ marginBottom: 0, flex: '1 1 150px' }}>
                <label className="form-label">ルール名</label>
                <input className="form-input" value={newRuleName} onChange={(e) => setNewRuleName(e.target.value)} placeholder="不在時応答" />
              </div>
              <div className="form-group" style={{ marginBottom: 0, flex: '1 1 150px' }}>
                <label className="form-label">トリガーキーワード</label>
                <input className="form-input" value={newRuleTrigger} onChange={(e) => setNewRuleTrigger(e.target.value)} placeholder="こんにちは" />
              </div>
              <button className="btn btn--primary" onClick={handleCreateAutoReply} disabled={!newRuleName.trim() || !newRuleTrigger.trim() || !newRuleReply.trim()}>
                ➕ 作成
              </button>
            </div>
            <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
              <label className="form-label">自動返信テキスト</label>
              <textarea
                className="form-textarea"
                value={newRuleReply}
                onChange={(e) => setNewRuleReply(e.target.value)}
                placeholder="自動返信の内容を入力…"
                style={{ minHeight: 60 }}
              />
            </div>
          </div>

          <div className="card">
            <h3 className="card__title" style={{ marginBottom: 12 }}>📋 ルール一覧</h3>
            {autoReplies.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state__icon">🤖</div>
                <div className="empty-state__title">自動応答ルールがありません</div>
                <div className="empty-state__description">キーワードマッチで自動返信するルールを作成できます</div>
              </div>
            ) : (
              <div className="tweet-list">
                {autoReplies.map((rule: any) => (
                  <div key={rule.id} className="tweet-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>{rule.name}</span>
                        <span className={`schedule-badge schedule-badge--${rule.enabled ? 'sent' : 'failed'}`} style={{ marginLeft: 8 }}>
                          {rule.enabled ? '✅ 有効' : '⏸️ 無効'}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>マッチ: {rule.match_count}回</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 6 }}>
                      トリガー: 「<strong>{rule.trigger_value}</strong>」 → 返信: {rule.reply_text?.slice(0, 60) || '(テンプレート使用)'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={async () => {
                          try {
                            await updateDmAutoReply(rule.id, { enabled: !rule.enabled });
                            showToast('info', rule.enabled ? '無効化しました' : '有効化しました');
                            loadAutoReplies();
                          } catch (err: any) { showToast('error', err.message); }
                        }}
                      >
                        {rule.enabled ? '⏸️ 無効化' : '▶️ 有効化'}
                      </button>
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={async () => {
                          if (!confirm('このルールを削除しますか？')) return;
                          try {
                            await deleteDmAutoReply(rule.id);
                            showToast('info', '削除しました');
                            loadAutoReplies();
                          } catch (err: any) { showToast('error', err.message); }
                        }}
                      >
                        🗑️ 削除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
