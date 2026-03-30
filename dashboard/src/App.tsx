import { useState, useCallback, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { AuthPage } from './pages/AuthPage';
import { PostsPage } from './pages/PostsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { BookmarksPage } from './pages/BookmarksPage';
import { UsagePage } from './pages/UsagePage';
import { WritingRulesPage } from './pages/WritingRulesPage';
import { SyncPage } from './pages/SyncPage';
import { DmPage } from './pages/DmPage';
import { isAuthenticated, isWorkerMode, triggerSync } from './api';

export type Page = 'auth' | 'posts' | 'analytics' | 'bookmarks' | 'usage' | 'writing-rules' | 'sync' | 'dm';

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

let toastId = 0;

export default function App() {
  const [page, setPage] = useState<Page>(isAuthenticated() ? 'posts' : 'auth');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authKey, setAuthKey] = useState(0);
  const syncTriggered = useRef(false);

  const showToast = useCallback((type: Toast['type'], message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // ── ダッシュボード起動時にローカル同期を実行 ──
  useEffect(() => {
    if (syncTriggered.current) return;
    if (!isAuthenticated() || !isWorkerMode()) return;
    syncTriggered.current = true;
    triggerSync()
      .then(() => showToast('info', '📂 ローカル同期完了'))
      .catch(() => { /* sync not configured yet — silent */ });
  }, [showToast]);

  const handleAuthChange = useCallback(() => {
    setAuthKey((k) => k + 1);
    if (isAuthenticated()) {
      setPage('posts');
      showToast('success', 'X アカウントに接続しました！');
    } else {
      setPage('auth');
    }
  }, [showToast]);

  const pageTitle: Record<Page, string> = {
    auth: '認証',
    posts: 'ポスト管理',
    analytics: 'アナリティクス',
    bookmarks: 'ブックマーク AI',
    usage: '使用量',
    'writing-rules': 'ライティングルール',
    sync: 'ローカル同期',
    dm: 'ダイレクトメッセージ',
  };

  return (
    <div className="app-layout">
      <Sidebar
        activePage={page}
        onNavigate={setPage}
        isAuthenticated={isAuthenticated()}
        key={authKey}
      />

      <main className="main-content">
        <Header title={pageTitle[page]} isAuthenticated={isAuthenticated()} />

        <div className="page-content" key={page}>
          {page === 'auth' && (
            <AuthPage onAuthChange={handleAuthChange} showToast={showToast} />
          )}
          {page === 'posts' && (
            <PostsPage showToast={showToast} />
          )}
          {page === 'analytics' && (
            <AnalyticsPage showToast={showToast} />
          )}
          {page === 'bookmarks' && (
            <BookmarksPage showToast={showToast} />
          )}
          {page === 'usage' && (
            <UsagePage showToast={showToast} />
          )}
          {page === 'writing-rules' && (
            <WritingRulesPage showToast={showToast} />
          )}
          {page === 'sync' && (
            <SyncPage showToast={showToast} />
          )}
          {page === 'dm' && (
            <DmPage showToast={showToast} />
          )}
        </div>
      </main>

      {/* トースト通知 */}
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.type}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
