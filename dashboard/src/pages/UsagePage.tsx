import { useState, useEffect, useCallback } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import * as api from '../api';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface UsagePageProps {
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

interface UsageSummary {
  total_calls: number;
  total_credits: number;
  monthly_limit: number;
  today: { total_calls: number; total_credits: number; read_calls: number; write_calls: number };
  unacknowledged_alerts: number;
}

interface DailyUsage {
  date: string;
  total_calls: number;
  total_credits: number;
  read_calls: number;
  write_calls: number;
}

interface EndpointUsage {
  endpoint: string;
  method: string;
  calls: number;
  credits: number;
  avg_response_time: number;
}

interface AlertSetting {
  id: number;
  alert_type: string;
  threshold_percent: number;
  channel: string;
  webhook_url: string | null;
  enabled: boolean;
}

interface AlertLog {
  id: number;
  alert_type: string;
  message: string;
  channel: string;
  sent_at: string;
  acknowledged: boolean;
}

export function UsagePage({ showToast }: UsagePageProps) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [daily, setDaily] = useState<DailyUsage[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointUsage[]>([]);
  const [alerts, setAlerts] = useState<AlertSetting[]>([]);
  const [alertLogs, setAlertLogs] = useState<AlertLog[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'alerts'>('overview');
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    const results = await Promise.allSettled([
      api.getUsageSummary(),
      api.getUsageDaily(30),
      api.getUsageByEndpoint(),
      api.getAlertSettings(),
      api.getAlertLogs(),
    ]);
    if (results[0].status === 'fulfilled') setSummary(results[0].value.data);
    if (results[1].status === 'fulfilled') setDaily(results[1].value.data || []);
    if (results[2].status === 'fulfilled') setEndpoints(results[2].value.data || []);
    if (results[3].status === 'fulfilled') setAlerts(results[3].value.data || []);
    if (results[4].status === 'fulfilled') setAlertLogs(results[4].value.data || []);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0 && failed.length < results.length) {
      showToast('info', '一部のデータ取得に失敗しました');
    } else if (failed.length === results.length) {
      showToast('error', 'データの取得に失敗しました');
    }
    setRefreshing(false);
  }, [showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleToggleAlert = async (alert: AlertSetting) => {
    try {
      await api.updateAlertSetting(alert.id, { enabled: !alert.enabled });
      showToast('success', `アラートを${alert.enabled ? '無効化' : '有効化'}しました`);
      loadData();
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleSetDiscord = async (alertId: number) => {
    if (!webhookUrl.trim()) return;
    try {
      await api.updateAlertSetting(alertId, { channel: 'discord', webhook_url: webhookUrl });
      showToast('success', 'Discord Webhook を設定しました');
      loadData();
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleTestWebhook = async () => {
    if (!webhookUrl.trim()) return;
    setTesting(true);
    try {
      const res = await api.testWebhook(webhookUrl);
      if (res.success) {
        showToast('success', 'Webhook テスト成功！Discord を確認してください');
      } else {
        showToast('error', 'Webhook テスト失敗');
      }
    } catch (e: any) {
      showToast('error', e.message);
    } finally {
      setTesting(false);
    }
  };

  const usagePercent = summary ? (summary.total_credits / summary.monthly_limit) * 100 : 0;

  const chartData = {
    labels: daily.map((d) => {
      const date = new Date(d.date);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    }),
    datasets: [
      {
        label: '読取',
        data: daily.map((d) => d.read_calls),
        backgroundColor: 'rgba(29, 155, 240, 0.7)',
        borderRadius: 4,
      },
      {
        label: '書込',
        data: daily.map((d) => d.write_calls),
        backgroundColor: 'rgba(249, 24, 128, 0.7)',
        borderRadius: 4,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#e7e9ea' } },
      title: { display: false },
    },
    scales: {
      x: { ticks: { color: '#71767b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      y: { ticks: { color: '#71767b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
    },
  };

  return (
    <div className="usage-page">
      {/* タブ + 更新 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div className="tab-bar" style={{ marginBottom: 0 }}>
          <button className={`tab-btn ${activeTab === 'overview' ? 'tab-btn--active' : ''}`} onClick={() => setActiveTab('overview')}>
            📊 概要
          </button>
          <button className={`tab-btn ${activeTab === 'alerts' ? 'tab-btn--active' : ''}`} onClick={() => setActiveTab('alerts')}>
            🔔 アラート設定 {summary && summary.unacknowledged_alerts > 0 && (
              <span className="badge badge--alert">{summary.unacknowledged_alerts}</span>
            )}
          </button>
        </div>
        <button className="btn btn--secondary btn--sm" onClick={loadData} disabled={refreshing}>
          {refreshing ? '⏳ 取得中…' : '🔄 更新'}
        </button>
      </div>

      {activeTab === 'overview' && (
        <>
          {/* 使用量サマリーカード */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-card__label">月間コール数</div>
              <div className="stat-card__value">{(summary?.total_calls ?? 0).toLocaleString('ja-JP')}</div>
              <div className="stat-card__sub">今日: {summary?.today?.total_calls ?? 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">推定クレジット</div>
              <div className="stat-card__value">{(summary?.total_credits ?? 0).toFixed(2)}</div>
              <div className="stat-card__sub">上限: {summary?.monthly_limit ?? 50}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">使用率</div>
              <div className={`stat-card__value ${usagePercent >= 80 ? 'text-warning' : ''} ${usagePercent >= 100 ? 'text-danger' : ''}`}>
                {usagePercent.toFixed(1)}%
              </div>
              <div className="usage-bar">
                <div
                  className={`usage-bar__fill ${usagePercent >= 80 ? 'usage-bar__fill--warning' : ''} ${usagePercent >= 100 ? 'usage-bar__fill--danger' : ''}`}
                  style={{ width: `${Math.min(usagePercent, 100)}%` }}
                />
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">読取 / 書込 比率</div>
              <div className="stat-card__value">
                {summary?.today?.read_calls ?? 0} / {summary?.today?.write_calls ?? 0}
              </div>
              <div className="stat-card__sub">今日の内訳</div>
            </div>
          </div>

          {!summary && (
            <div className="card" style={{ marginBottom: '1.5rem', textAlign: 'center', padding: '2rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>📭</div>
              <div style={{ color: 'var(--text-secondary)' }}>まだAPIコールがありません。ツイートを投稿するとここに使用量が表示されます。</div>
            </div>
          )}

          {/* 日別グラフ */}
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h3 className="card__title">📈 日別 API コール数（30日間）</h3>
            <div style={{ height: '300px' }}>
              {daily.length > 0 ? (
                <Bar data={chartData} options={chartOptions} />
              ) : (
                <div className="empty-state"><p>データがありません</p></div>
              )}
            </div>
          </div>

          {/* エンドポイント別テーブル */}
          <div className="card">
            <h3 className="card__title">🔍 エンドポイント別使用量</h3>
            {endpoints.length === 0 ? (
              <div className="empty-state"><p>データがありません</p></div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>エンドポイント</th>
                    <th>メソッド</th>
                    <th>コール数</th>
                    <th>クレジット</th>
                    <th>平均応答(ms)</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((ep, i) => (
                    <tr key={i}>
                      <td className="font-mono">{ep.endpoint}</td>
                      <td><span className={`badge badge--method-${ep.method.toLowerCase()}`}>{ep.method}</span></td>
                      <td>{ep.calls}</td>
                      <td>{Number(ep.credits).toFixed(3)}</td>
                      <td>{Number(ep.avg_response_time).toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {activeTab === 'alerts' && (
        <>
          {/* アラート設定 */}
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h3 className="card__title">🔔 アラート設定</h3>
            <div className="alert-settings">
              {alerts.map((alert) => (
                <div key={alert.id} className="alert-setting-row">
                  <div className="alert-setting-info">
                    <span className="alert-setting-icon">
                      {alert.threshold_percent >= 100 ? '🚨' : '⚠️'}
                    </span>
                    <div>
                      <strong>{alert.threshold_percent}% 到達時</strong>
                      <span className="alert-setting-channel">
                        通知先: {alert.channel === 'discord' ? 'Discord' : 'ダッシュボード'}
                      </span>
                    </div>
                  </div>
                  <div className="alert-setting-actions">
                    <button
                      className={`toggle-btn ${alert.enabled ? 'toggle-btn--on' : ''}`}
                      onClick={() => handleToggleAlert(alert)}
                    >
                      {alert.enabled ? 'ON' : 'OFF'}
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => handleSetDiscord(alert.id)}
                    >
                      Discord に変更
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Discord Webhook 設定 */}
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h3 className="card__title">💬 Discord Webhook 設定</h3>
            <div className="webhook-form">
              <input
                type="url"
                className="input"
                placeholder="https://discord.com/api/webhooks/..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <button className="btn btn--secondary" onClick={handleTestWebhook} disabled={testing || !webhookUrl.trim()}>
                {testing ? '⏳ テスト中...' : '🔔 テスト送信'}
              </button>
            </div>
            <p className="help-text">
              Discord サーバーの チャンネル設定 → 連携サービス → ウェブフック から URL を取得してください
            </p>
          </div>

          {/* 通知履歴 */}
          <div className="card">
            <h3 className="card__title">📋 通知履歴</h3>
            {alertLogs.length === 0 ? (
              <div className="empty-state"><p>通知履歴はありません</p></div>
            ) : (
              <div className="alert-log-list">
                {alertLogs.map((log) => (
                  <div key={log.id} className={`alert-log-item ${!log.acknowledged ? 'alert-log-item--unread' : ''}`}>
                    <div className="alert-log-item__icon">
                      {log.channel === 'discord' ? '💬' : '🔔'}
                    </div>
                    <div className="alert-log-item__content">
                      <p>{log.message}</p>
                      <span className="alert-log-item__time">
                        {new Date(log.sent_at).toLocaleString('ja-JP')}
                      </span>
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
