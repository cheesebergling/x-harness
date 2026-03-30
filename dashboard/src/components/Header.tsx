import { isWorkerMode } from '../api';

interface HeaderProps {
  title: string;
  isAuthenticated: boolean;
}

export function Header({ title, isAuthenticated }: HeaderProps) {
  const workerMode = isWorkerMode();

  return (
    <header className="header">
      <h1 className="header__title">{title}</h1>

      <div className="header__actions">
        <a
          href="https://u-hubz-net.com/go/x-oss"
          target="_blank"
          rel="noopener noreferrer"
          className="waitlist-cta"
        >
          🚀 無制限版ウェイトリスト
        </a>

        {isAuthenticated && (
          <div className="header__user">
            <span className="header__avatar">{workerMode ? '⚡' : '👤'}</span>
            <span>{workerMode ? 'Worker 接続' : '接続済み'}</span>
          </div>
        )}

        <div className="security-notice">
          <span className="security-notice__icon">{workerMode ? '⚡' : '🔒'}</span>
          <span>{workerMode ? 'API Key — 永続認証' : 'トークンはセッション内のみ保存'}</span>
        </div>
      </div>
    </header>
  );
}

