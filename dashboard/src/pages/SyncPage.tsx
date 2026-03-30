import { useState, useEffect, useCallback } from 'react';
import { FolderSync, RefreshCw, ChevronRight, ChevronDown, FileText, Folder, CheckCircle2, AlertCircle, FolderOpen } from 'lucide-react';
import { triggerSync } from '../api';

// ─── Types ───

interface TreeNode {
  name: string;
  kind: 'directory' | 'file';
  children?: TreeNode[];
  size?: number;
}


interface Props {
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

// ─── File System Access API Check ───
const isFileSystemAccessSupported = () =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// ─── Tree Node Component ───
function TreeNodeView({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isDir = node.kind === 'directory';
  const hasChildren = isDir && node.children && node.children.length > 0;

  return (
    <div>
      <div
        className={`tree-node ${isDir ? 'tree-node--dir' : 'tree-node--file'}`}
        style={{ paddingLeft: depth * 20 + 8 }}
        onClick={() => isDir && setExpanded(!expanded)}
      >
        {isDir ? (
          <>
            {hasChildren ? (
              expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            ) : <span style={{ width: 14, display: 'inline-block' }} />}
            {expanded ? <FolderOpen size={16} className="tree-icon tree-icon--dir" /> : <Folder size={16} className="tree-icon tree-icon--dir" />}
          </>
        ) : (
          <>
            <span style={{ width: 14, display: 'inline-block' }} />
            <FileText size={14} className="tree-icon tree-icon--file" />
          </>
        )}
        <span className="tree-node__name">{node.name}</span>
        {node.size !== undefined && (
          <span className="tree-node__size">{formatBytes(node.size)}</span>
        )}
      </div>
      {isDir && expanded && node.children?.map((child, i) => (
        <TreeNodeView key={`${child.name}-${i}`} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ─── Read Directory Recursively ───
async function readDirectoryTree(
  dirHandle: FileSystemDirectoryHandle,
  maxDepth = 4,
  currentDepth = 0
): Promise<TreeNode> {
  const children: TreeNode[] = [];

  if (currentDepth < maxDepth) {
    for await (const entry of (dirHandle as any).values()) {
      if (entry.kind === 'directory') {
        const child = await readDirectoryTree(entry, maxDepth, currentDepth + 1);
        children.push(child);
      } else {
        let size: number | undefined;
        try {
          const file = await (entry as FileSystemFileHandle).getFile();
          size = file.size;
        } catch { /* permission denied */ }
        children.push({ name: entry.name, kind: 'file', size });
      }
    }
  }

  // Sort: directories first, then alphabetical
  children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { name: dirHandle.name, kind: 'directory', children };
}

// ─── Write Sync Data to Directory ───
async function writeSyncData(
  dirHandle: FileSystemDirectoryHandle,
  data: any
): Promise<number> {
  let filesWritten = 0;

  // Write each module's data to separate files
  for (const [module, content] of Object.entries(data)) {
    if (module === 'exported_at' || module === 'sync_id') continue;
    try {
      const fileName = `${module}.json`;
      const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
      const writable = await (fileHandle as any).createWritable();
      await writable.write(JSON.stringify(content, null, 2));
      await writable.close();
      filesWritten++;
    } catch (e) {
      console.error(`Failed to write ${module}:`, e);
    }
  }

  // Write metadata
  try {
    const metaHandle = await dirHandle.getFileHandle('_sync_metadata.json', { create: true });
    const writable = await (metaHandle as any).createWritable();
    await writable.write(JSON.stringify({
      last_sync: new Date().toISOString(),
      exported_at: data.exported_at,
      files_written: filesWritten,
    }, null, 2));
    await writable.close();
  } catch { /* ignore */ }

  return filesWritten;
}

// ─── Main Component ───

export function SyncPage({ showToast }: Props) {
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [dirName, setDirName] = useState<string>('');

  // Restore saved handle reference (name only, handle requires re-pick)
  useEffect(() => {
    const saved = localStorage.getItem('xh_sync_dir_name');
    if (saved) setDirName(saved);
    const savedSync = localStorage.getItem('xh_last_sync');
    if (savedSync) setLastSync(savedSync);
    const savedCount = localStorage.getItem('xh_sync_file_count');
    if (savedCount) setFileCount(Number(savedCount));
  }, []);

  // ─── Pick Directory ───
  const handlePickDirectory = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      showToast('error', 'このブラウザは File System Access API に対応していません。Chrome/Edge をお使いください。');
      return;
    }

    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      setDirHandle(handle);
      setDirName(handle.name);
      localStorage.setItem('xh_sync_dir_name', handle.name);

      // Read tree
      setLoading(true);
      const treeData = await readDirectoryTree(handle);
      setTree(treeData);
      setLoading(false);

      showToast('success', `📁 ${handle.name} を同期フォルダに設定しました`);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        showToast('error', 'フォルダの選択に失敗しました');
      }
      setLoading(false);
    }
  }, [showToast]);

  // ─── Refresh Tree ───
  const handleRefreshTree = useCallback(async () => {
    if (!dirHandle) return;
    setLoading(true);
    try {
      const treeData = await readDirectoryTree(dirHandle);
      setTree(treeData);
    } catch {
      showToast('error', 'フォルダの読み取りに失敗しました。再度フォルダを選択してください。');
      setDirHandle(null);
      setTree(null);
    }
    setLoading(false);
  }, [dirHandle, showToast]);

  // ─── Sync: Worker Export → Local Write ───
  const handleSync = useCallback(async () => {
    if (!dirHandle) {
      showToast('warning', 'まず同期フォルダを選択してください');
      return;
    }

    setSyncing(true);
    try {
      // 1. Worker API からエクスポートデータを取得
      const res = await triggerSync();

      // 2. ローカルフォルダに書き出し
      const written = await writeSyncData(dirHandle, res);

      const now = new Date().toISOString();
      setLastSync(now);
      setFileCount(written);
      localStorage.setItem('xh_last_sync', now);
      localStorage.setItem('xh_sync_file_count', String(written));

      // 3. ツリーを更新
      const treeData = await readDirectoryTree(dirHandle);
      setTree(treeData);

      showToast('success', `✅ ${written}ファイルを同期しました`);
    } catch (e: any) {
      showToast('error', e.message || '同期に失敗しました');
    } finally {
      setSyncing(false);
    }
  }, [dirHandle, showToast]);

  const timeSince = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}分前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}時間前`;
    return `${Math.floor(hours / 24)}日前`;
  };

  const isSupported = isFileSystemAccessSupported();

  return (
    <div className="sync-page">
      {/* Header */}
      <div className="sync-page__header">
        <div>
          <h2 className="sync-page__title">
            <FolderSync size={20} style={{ color: 'var(--accent)' }} />
            ローカル同期
          </h2>
          <p className="sync-page__subtitle">
            ダッシュボードのデータをPCのフォルダに同期します
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--secondary" onClick={handlePickDirectory}>
            📁 {dirHandle ? 'フォルダ変更' : '同期フォルダを選択'}
          </button>
          <button
            className="btn btn--primary"
            onClick={handleSync}
            disabled={syncing || !dirHandle}
          >
            <RefreshCw size={16} className={syncing ? 'spin' : ''} />
            {syncing ? '同期中...' : '今すぐ同期'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className={`stat-card__icon ${dirHandle ? 'stat-card__icon--green' : 'stat-card__icon--red'}`}>
            {dirHandle ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          </div>
          <div className="stat-card__value">{dirHandle ? '接続中' : dirName || '未設定'}</div>
          <div className="stat-card__label">同期フォルダ</div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--blue">
            <Folder size={20} />
          </div>
          <div className="stat-card__value">{dirHandle?.name || dirName || '---'}</div>
          <div className="stat-card__label">フォルダ名</div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--yellow">
            <RefreshCw size={20} />
          </div>
          <div className="stat-card__value">{lastSync ? timeSince(lastSync) : '---'}</div>
          <div className="stat-card__label">最終同期</div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--green">
            <FileText size={20} />
          </div>
          <div className="stat-card__value">{fileCount}</div>
          <div className="stat-card__label">同期ファイル数</div>
        </div>
      </div>

      {/* Browser Compatibility Warning */}
      {!isSupported && (
        <div className="card card--elevated" style={{ borderLeft: '4px solid var(--warning)', padding: 24 }}>
          <h3 style={{ color: 'var(--warning)', marginBottom: 8 }}>⚠️ ブラウザ非対応</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            File System Access API は <strong>Chrome</strong> または <strong>Edge</strong> でのみ動作します。
            お使いのブラウザでは利用できません。
          </p>
        </div>
      )}

      {/* No folder selected */}
      {isSupported && !dirHandle && (
        <div className="card card--elevated" style={{ textAlign: 'center', padding: 48 }}>
          <FolderSync size={48} style={{ color: 'var(--text-tertiary)', marginBottom: 16 }} />
          <h3 style={{ marginBottom: 8 }}>同期フォルダを選択してください</h3>
          <p style={{ color: 'var(--text-secondary)', maxWidth: 480, margin: '0 auto 24px' }}>
            「📁 同期フォルダを選択」ボタンをクリックして、データを保存するフォルダを選んでください。
            フォルダ内のファイル構造が下に表示されます。
          </p>
          <button className="btn btn--primary btn--lg" onClick={handlePickDirectory}>
            📁 フォルダを選択
          </button>
        </div>
      )}

      {/* Folder Tree View */}
      {dirHandle && (
        <div className="card card--elevated">
          <div className="card__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card__title">
              <Folder size={16} style={{ marginRight: 8 }} />
              {dirHandle.name} の構造
            </h3>
            <button className="btn btn--ghost btn--sm" onClick={handleRefreshTree} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> 更新
            </button>
          </div>

          <div className="tree-container">
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
                <div className="spinner spinner--lg" />
              </div>
            ) : tree ? (
              <TreeNodeView node={tree} />
            ) : (
              <div className="empty-state" style={{ padding: 32 }}>
                <p>フォルダを読み込んでいます…</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
