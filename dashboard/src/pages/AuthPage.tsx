import { useState, useEffect, useCallback } from 'react';
import {
  getAuthUrl,
  refreshToken,
  storeToken,
  clearToken,
  getStoredToken,
  isAuthenticated,
  isTokenExpired,
  isWorkerMode,
  getApiKey,
  storeApiKey,
  clearApiKey,
} from '../api';

interface AuthPageProps {
  onAuthChange: () => void;
  showToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

export function AuthPage({ onAuthChange, showToast }: AuthPageProps) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');

  // OAuth コールバック後に URL からトークンを取得
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('access_token');
    const expiresIn = params.get('expires_in');

    if (token && expiresIn) {
      storeToken(token, parseInt(expiresIn, 10));
      window.history.replaceState({}, document.title, window.location.pathname);
      onAuthChange();
    }
  }, [onAuthChange]);

  const handleConnect = useCallback(async () => {
    setLoading(true);
    try {
      const { authorize_url } = await getAuthUrl();
      window.location.href = authorize_url;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '認証の開始に失敗しました';
      showToast('error', message);
      setLoading(false);
    }
  }, [showToast]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshToken();
      showToast('success', 'トークンを更新しました');
      onAuthChange();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'トークンの更新に失敗しました';
      showToast('error', message);
    } finally {
      setRefreshing(false);
    }
  }, [showToast, onAuthChange]);

  const handleDisconnect = useCallback(() => {
    clearToken();
    clearApiKey();
    onAuthChange();
    showToast('info', 'X から切断しました');
  }, [onAuthChange, showToast]);

  const handleDisconnectWorker = useCallback(() => {
    clearApiKey();
    onAuthChange();
    showToast('info', 'Worker API を切断しました');
  }, [onAuthChange, showToast]);

  const handleApiKeySubmit = useCallback(() => {
    const key = apiKeyInput.trim();
    if (!key) {
      showToast('error', 'API Key を入力してください');
      return;
    }
    storeApiKey(key);
    setApiKeyInput('');
    setShowApiKeyForm(false);
    onAuthChange();
    showToast('success', 'Worker API Key を保存しました');
  }, [apiKeyInput, onAuthChange, showToast]);

  const workerMode = isWorkerMode();
  const authenticated = isAuthenticated();
  const token = getStoredToken();
  const apiKey = getApiKey();
  const expired = isTokenExpired();

  // ── Worker Mode: 接続済み ──
  if (workerMode && apiKey) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <div className="auth-profile">
            <div
              className="auth-icon"
              style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', fontSize: 36 }}
            >
              ⚡
            </div>
            <h2 className="auth-profile__name">Worker API 経由で接続済み</h2>
            <p className="auth-profile__handle" style={{ color: 'var(--accent)' }}>
              ● API Key 認証 — 有効期限なし
            </p>
          </div>

          <div className="token-info">
            <div className="token-info__row">
              <span className="token-info__label">認証方式</span>
              <span className="token-info__value">Bearer Token (HARNESS_API_KEY)</span>
            </div>
            <div className="token-info__row">
              <span className="token-info__label">API Key</span>
              <span className="token-info__value">
                {`${apiKey.slice(0, 6)}${'•'.repeat(20)}`}
              </span>
            </div>
            <div className="token-info__row">
              <span className="token-info__label">保存先</span>
              <span className="token-info__value">localStorage（永続）</span>
            </div>
            <div className="token-info__row">
              <span className="token-info__label">有効期限</span>
              <span className="token-info__value" style={{ color: 'var(--success)' }}>なし（手動ローテーションのみ）</span>
            </div>
          </div>

          <div className="security-notice" style={{ marginTop: 24, textAlign: 'left' }}>
            <span className="security-notice__icon">⚡</span>
            <div>
              <strong>Worker モード</strong>: OAuth を経由せず、Cloudflare Worker API に直接接続。
              X API トークンは Worker 内部で管理され、ブラウザには露出しません。
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'center' }}>
            <button className="btn btn--danger" onClick={handleDisconnectWorker}>
              🔓 Worker 切断
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── OAuth: 接続済み ──
  if (authenticated && token && !expired) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <div className="auth-profile">
            <div
              className="auth-icon"
              style={{ background: 'var(--success-subtle)', fontSize: 36 }}
            >
              ✓
            </div>
            <h2 className="auth-profile__name">X に接続済み</h2>
            <p className="auth-profile__handle" style={{ color: 'var(--success)' }}>
              ● OAuth セッション
            </p>
          </div>

          <div className="token-info">
            <div className="token-info__row">
              <span className="token-info__label">トークン</span>
              <span className="token-info__value">
                {token ? `${token.slice(0, 8)}${'•'.repeat(24)}` : '—'}
              </span>
            </div>
            <div className="token-info__row">
              <span className="token-info__label">保存先</span>
              <span className="token-info__value">sessionStorage（タブ限定）</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'center' }}>
            <button
              className="btn btn--secondary"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? '更新中…' : '🔄 更新'}
            </button>
            <button className="btn btn--danger" onClick={handleDisconnect}>
              🔓 切断する
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── トークン期限切れ ──
  if (token && expired) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <div className="auth-icon" style={{ background: 'var(--warning-subtle)' }}>⚠️</div>
          <h2 className="auth-title">セッションが期限切れです</h2>
          <p className="auth-description">
            アクセストークンの有効期限が切れました。リフレッシュトークンで更新するか、再接続してください。
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              className="btn btn--primary btn--lg"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? '更新中…' : '🔄 トークンを更新'}
            </button>
            <button className="btn btn--secondary btn--lg" onClick={handleConnect} disabled={loading}>
              🔗 再接続
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 未接続 ──
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="auth-icon">𝕏</div>
        <h2 className="auth-title">X アカウントを接続</h2>
        <p className="auth-description">
          x-harness にツイート管理、アナリティクス閲覧、予約投稿の権限を付与します。
        </p>

        {/* Worker Mode: API Key 入力 */}
        <div style={{ marginBottom: 20 }}>
          {!showApiKeyForm ? (
            <button
              className="auth-connect-btn"
              style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}
              onClick={() => setShowApiKeyForm(true)}
            >
              ⚡ API Key で接続（Worker モード）
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 16px' }}>
              <input
                id="api-key-input"
                type="password"
                placeholder="HARNESS_API_KEY を入力"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApiKeySubmit()}
                style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: 14,
                  fontFamily: 'monospace',
                }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn--primary" onClick={handleApiKeySubmit}>
                  保存
                </button>
                <button className="btn btn--secondary" onClick={() => setShowApiKeyForm(false)}>
                  キャンセル
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, margin: '8px 0 16px' }}>
          — または —
        </div>

        {/* OAuth 接続 */}
        <button
          id="auth-connect-btn"
          className="auth-connect-btn"
          onClick={handleConnect}
          disabled={loading}
          style={{ opacity: 0.85 }}
        >
          {loading ? (
            <>
              <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2, display: 'inline-block', verticalAlign: 'middle' }} />
              &nbsp;X へリダイレクト中…
            </>
          ) : (
            '🔗 X で接続する（OAuth）'
          )}
        </button>

        <div className="security-notice" style={{ marginTop: 24, textAlign: 'left' }}>
          <span className="security-notice__icon">🛡️</span>
          <div>
            <strong>Worker モード</strong>: API Key は <code>localStorage</code> に保存。有効期限なし。
            OAuth は <code>sessionStorage</code> に保存され、タブを閉じると消去されます。
          </div>
        </div>
      </div>
    </div>
  );
}
