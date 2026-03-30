import {
  KeyRound,
  Send,
  Bookmark,
  BarChart3,
  Activity,
  FilePen,
  FolderSync,
  BookOpen,
  MessageCircle,
} from 'lucide-react';
import type { Page } from '../App';

function GithubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
}

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  isAuthenticated: boolean;
}

const navItems: { id: Page; icon: typeof KeyRound; label: string; requiresAuth?: boolean }[] = [
  { id: 'auth', icon: KeyRound, label: '認証' },
  { id: 'posts', icon: Send, label: 'ポスト', requiresAuth: true },
  { id: 'bookmarks', icon: Bookmark, label: 'ブックマーク', requiresAuth: true },
  { id: 'analytics', icon: BarChart3, label: 'アナリティクス', requiresAuth: true },
  { id: 'usage', icon: Activity, label: '使用量', requiresAuth: true },
  { id: 'writing-rules', icon: FilePen, label: 'ライティングルール', requiresAuth: true },
  { id: 'dm', icon: MessageCircle, label: 'DM', requiresAuth: true },
  { id: 'sync', icon: FolderSync, label: 'ローカル同期', requiresAuth: true },
];

export function Sidebar({ activePage, onNavigate, isAuthenticated }: SidebarProps) {
  return (
    <aside className="sidebar">
      {/* ブランド */}
      <div className="sidebar__brand">
        <div className="sidebar__logo">
          <div className="sidebar__logo-icon">X</div>
          <div>
            <span className="sidebar__logo-text">x-harness</span>
            <span className="sidebar__logo-version">v0.6.0</span>
          </div>
        </div>
      </div>

      {/* ナビゲーション */}
      <nav className="sidebar__nav">
        <span className="sidebar__label">メニュー</span>
        {navItems.map((item) => {
          const disabled = item.requiresAuth && !isAuthenticated;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              id={`nav-${item.id}`}
              className={`sidebar__item ${activePage === item.id ? 'sidebar__item--active' : ''}`}
              onClick={() => !disabled && onNavigate(item.id)}
              disabled={disabled}
              title={disabled ? 'X アカウントを先に接続してください' : undefined}
              style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            >
              <span className="sidebar__item-icon">
                <Icon size={18} />
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}

        <span className="sidebar__label" style={{ marginTop: 'auto' }}>リンク</span>
        <a
          href="https://github.com/cheesebergling/x-harness"
          target="_blank"
          rel="noopener noreferrer"
          className="sidebar__item"
        >
          <span className="sidebar__item-icon">
            <GithubIcon size={18} />
          </span>
          <span>cheesebergling</span>
        </a>
        <a
          href="https://developer.x.com/en/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="sidebar__item"
        >
          <span className="sidebar__item-icon">
            <BookOpen size={18} />
          </span>
          <span>X API ドキュメント</span>
        </a>
      </nav>

      {/* フッター */}
      <div className="sidebar__footer">
        <div className="sidebar__status">
          <span
            className={`status-dot ${
              isAuthenticated ? 'status-dot--connected' : 'status-dot--disconnected'
            }`}
          />
          <span>{isAuthenticated ? '接続済み' : '未接続'}</span>
        </div>
      </div>
    </aside>
  );
}
