import { useState, useEffect, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import {
  getFollowerTrend,
  getEngagementSummary,
  snapshotFollowers,
  refreshTweetMetrics,
  type FollowerSnapshot,
  type EngagementSummary,
} from '../api';

// Chart.js コンポーネント登録
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler
);

interface AnalyticsPageProps {
  showToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function AnalyticsPage({ showToast }: AnalyticsPageProps) {
  const [trend, setTrend] = useState<FollowerSnapshot[]>([]);
  const [engagement, setEngagement] = useState<EngagementSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [refreshingMetrics, setRefreshingMetrics] = useState(false);
  const [trendDays, setTrendDays] = useState(30);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        getFollowerTrend(trendDays),
        getEngagementSummary(),
      ]);
      if (results[0].status === 'fulfilled') {
        setTrend((results[0].value.data || []).reverse());
      }
      if (results[1].status === 'fulfilled') {
        setEngagement(results[1].value.data || null);
      }
      // 一部失敗した場合のみ通知
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0 && failed.length < results.length) {
        showToast('info', '一部のデータ取得に失敗しました');
      } else if (failed.length === results.length) {
        showToast('error', 'データの取得に失敗しました（Worker 未起動の可能性）');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'アナリティクスの読み込みに失敗しました';
      showToast('error', message);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [showToast, trendDays]);

  useEffect(() => {
    if (!loaded) loadData();
  }, [loaded, loadData]);

  const handleSnapshot = useCallback(async () => {
    setSnapshotting(true);
    try {
      const res = await snapshotFollowers();
      showToast(
        'success',
        `スナップショット保存: フォロワー ${formatNumber(res.data?.followers)} 人`
      );
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'スナップショットの取得に失敗しました';
      showToast('error', message);
    } finally {
      setSnapshotting(false);
    }
  }, [showToast, loadData]);

  // チャートデータ
  const chartData = {
    labels: trend.map((s) => {
      const d = new Date(s.snapshot_at);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }),
    datasets: [
      {
        label: 'フォロワー',
        data: trend.map((s) => s.followers),
        borderColor: '#1d9bf0',
        backgroundColor: 'rgba(29, 155, 240, 0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: trend.length > 30 ? 0 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: '#1d9bf0',
        borderWidth: 2,
      },
      {
        label: 'フォロー中',
        data: trend.map((s) => s.following),
        borderColor: '#71767b',
        backgroundColor: 'rgba(113, 118, 123, 0.05)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 1.5,
        borderDash: [4, 4],
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        backgroundColor: '#14141f',
        titleColor: '#e7e9ea',
        bodyColor: '#71767b',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12,
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#536471', font: { size: 11 } },
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#536471', font: { size: 11 } },
      },
    },
    interaction: {
      intersect: false,
      mode: 'index' as const,
    },
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <div className="spinner spinner--lg" />
      </div>
    );
  }

  const latestFollowers = trend.length > 0 ? trend[trend.length - 1].followers : 0;
  const prevFollowers = trend.length > 1 ? trend[trend.length - 2].followers : latestFollowers;
  const followerDiff = latestFollowers - prevFollowers;

  return (
    <>
      {/* ── 更新バー ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, gap: 8 }}>
        <button
          className="btn btn--primary btn--sm"
          onClick={async () => {
            setRefreshingMetrics(true);
            try {
              const res = await refreshTweetMetrics();
              showToast('success', `${(res as any).updated || 0} 件のメトリクスを更新しました`);
              setLoaded(false);
            } catch (err: any) {
              showToast('error', err.message || 'メトリクス更新に失敗');
            } finally {
              setRefreshingMetrics(false);
            }
          }}
          disabled={refreshingMetrics}
        >
          {refreshingMetrics ? '✨ 更新中…' : '📊 メトリクス更新'}
        </button>
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => { setLoaded(false); }}
          disabled={loading}
        >
          {loading ? '⏳ 取得中…' : '🔄 更新'}
        </button>
      </div>

      {/* ── 統計カード ── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--blue">📝</div>
          <div className="stat-card__value">
            {formatNumber(engagement?.total_tweets)}
          </div>
          <div className="stat-card__label">ツイート数（30日）</div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--green">👁️</div>
          <div className="stat-card__value">
            {formatNumber(engagement?.total_impressions)}
          </div>
          <div className="stat-card__label">インプレッション</div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--yellow">📈</div>
          <div className="stat-card__value">
            {engagement?.avg_engagement_rate != null
              ? `${engagement.avg_engagement_rate.toFixed(2)}%`
              : '—'}
          </div>
          <div className="stat-card__label">平均エンゲージメント率</div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--red">👥</div>
          <div className="stat-card__value">
            {formatNumber(latestFollowers)}
            {followerDiff !== 0 && (
              <span
                style={{
                  fontSize: 'var(--fs-sm)',
                  color: followerDiff > 0 ? 'var(--success)' : 'var(--error)',
                  marginLeft: 8,
                  fontWeight: 500,
                }}
              >
                {followerDiff > 0 ? '+' : ''}
                {followerDiff}
              </span>
            )}
          </div>
          <div className="stat-card__label">フォロワー</div>
        </div>
      </div>

      {/* ── フォロワー推移グラフ ── */}
      <div className="card card--glow">
        <div className="card__header">
          <div>
            <h3 className="card__title">フォロワー推移</h3>
            <p className="card__subtitle">
              {trend.length} データポイント · 直近 {trendDays} 日間
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="form-select"
              value={trendDays}
              onChange={(e) => setTrendDays(Number(e.target.value))}
              style={{ width: 'auto', padding: '6px 12px', fontSize: 'var(--fs-xs)' }}
            >
              <option value={7}>7日間</option>
              <option value={14}>14日間</option>
              <option value={30}>30日間</option>
              <option value={90}>90日間</option>
            </select>
            <button
              id="snapshot-btn"
              className="btn btn--primary btn--sm"
              onClick={handleSnapshot}
              disabled={snapshotting}
            >
              {snapshotting ? '…' : '📸 記録する'}
            </button>
          </div>
        </div>

        {trend.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">📊</div>
            <div className="empty-state__title">推移データがありません</div>
            <div className="empty-state__description">
              「記録する」をクリックして、フォロワー数のトラッキングを開始しましょう。
            </div>
          </div>
        ) : (
          <div className="chart-container">
            <Line data={chartData} options={chartOptions} />
          </div>
        )}
      </div>

      {/* ── エンゲージメント内訳 ── */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card__header">
          <h3 className="card__title">エンゲージメント内訳（30日間）</h3>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>指標</th>
                <th>合計</th>
                <th>1ツイート平均</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  label: '❤️ いいね',
                  value: engagement?.total_likes,
                  avg: engagement?.total_tweets
                    ? (engagement.total_likes || 0) / engagement.total_tweets
                    : 0,
                },
                {
                  label: '🔁 リポスト',
                  value: engagement?.total_retweets,
                  avg: engagement?.total_tweets
                    ? (engagement.total_retweets || 0) / engagement.total_tweets
                    : 0,
                },
                {
                  label: '💬 リプライ',
                  value: engagement?.total_replies,
                  avg: engagement?.total_tweets
                    ? (engagement.total_replies || 0) / engagement.total_tweets
                    : 0,
                },
                {
                  label: '👁️ インプレッション',
                  value: engagement?.total_impressions,
                  avg: engagement?.total_tweets
                    ? (engagement.total_impressions || 0) / engagement.total_tweets
                    : 0,
                },
              ].map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{formatNumber(row.value)}</td>
                  <td>{row.avg.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
