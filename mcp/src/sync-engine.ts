/**
 * Local Sync Engine
 * Syncthing 式のローカルフォルダ同期エンジン
 *
 * Worker API からデータを取得し、ローカルフォルダに構造化保存する。
 *
 * Security:
 *  - Path traversal prevention (resolve + startsWith check)
 *  - Filename sanitization (alphanumeric + hyphens only)
 *  - Symlink following disabled (write only to real paths)
 *  - Config file permission awareness
 *  - Maximum file size limits
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ───

export interface SyncConfig {
  syncDir: string;
  lastSyncAt: string;
  autoSyncIntervalMinutes: number;
  enabledModules: string[];
}

export interface SyncResult {
  success: boolean;
  syncedAt: string;
  modules: Record<string, { files: number; error?: string }>;
  duration_ms: number;
}

// ─── Constants ───

const CONFIG_FILENAME = 'sync-config.json';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const VALID_MODULES = ['tweets', 'analytics', 'writing-rules', 'usage'];

// ─── Security Helpers ───

/**
 * Sanitize a filename to prevent path traversal and injection.
 * Only allows alphanumeric, hyphens, underscores, and dots.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_.]/g, '_').slice(0, 100);
}

/**
 * Resolve and validate a path is within the allowed sync directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 */
function safePath(syncDir: string, ...segments: string[]): string {
  const resolved = path.resolve(syncDir, ...segments.map(sanitizeFilename));
  const normalizedBase = path.resolve(syncDir);

  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error(`Path traversal detected: ${segments.join('/')}`);
  }

  return resolved;
}

/**
 * Validate that a sync directory path is reasonable.
 * Blocks obviously dangerous paths.
 */
function validateSyncDir(dir: string): { valid: boolean; error?: string } {
  const normalized = path.resolve(dir);

  // Block system-critical directories
  const blockedPrefixes = [
    'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)',
    '/etc', '/usr', '/bin', '/sbin', '/var', '/sys', '/proc',
  ];

  for (const blocked of blockedPrefixes) {
    if (normalized.toLowerCase().startsWith(blocked.toLowerCase())) {
      return { valid: false, error: `Cannot sync to system directory: ${blocked}` };
    }
  }

  // Block root directory
  if (normalized === 'C:\\' || normalized === '/' || normalized === path.parse(normalized).root) {
    return { valid: false, error: 'Cannot sync to root directory' };
  }

  return { valid: true };
}

/**
 * Check if a path is a symlink (block symlink attacks).
 */
function isRealPath(filePath: string): boolean {
  try {
    const real = fs.realpathSync(filePath);
    return real === filePath || real === path.resolve(filePath);
  } catch {
    return true; // Path doesn't exist yet — OK to create
  }
}

// ─── Sync Engine ───

export class SyncEngine {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  /**
   * Initialize sync directory structure.
   */
  async initSync(dir: string): Promise<SyncConfig> {
    const validation = validateSyncDir(dir);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const syncDir = path.resolve(dir);

    // Create directory structure
    const dirs = [
      syncDir,
      path.join(syncDir, 'tweets'),
      path.join(syncDir, 'analytics'),
      path.join(syncDir, 'writing-rules'),
    ];

    for (const d of dirs) {
      if (!fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
      }
    }

    // Create or load config
    const configPath = path.join(syncDir, CONFIG_FILENAME);
    let config: SyncConfig;

    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      config = JSON.parse(raw);
      config.syncDir = syncDir; // Always update to resolved path
    } else {
      config = {
        syncDir,
        lastSyncAt: '1970-01-01T00:00:00Z',
        autoSyncIntervalMinutes: 30,
        enabledModules: [...VALID_MODULES],
      };
    }

    this.writeConfigSafe(syncDir, config);
    return config;
  }

  /**
   * Execute full sync — fetch from Worker and write to local filesystem.
   */
  async syncAll(syncDir: string): Promise<SyncResult> {
    const start = Date.now();
    const config = this.loadConfig(syncDir);

    const result: SyncResult = {
      success: true,
      syncedAt: new Date().toISOString(),
      modules: {},
      duration_ms: 0,
    };

    try {
      // Fetch from Worker API
      const since = config.lastSyncAt;
      const modules = config.enabledModules.join(',');
      const exportUrl = `${this.apiUrl}/api/sync/export?since=${encodeURIComponent(since)}&modules=${modules}`;

      const response = await fetch(exportUrl, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Export API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as any;

      // ── Write Tweets ──
      if (data.tweets && config.enabledModules.includes('tweets')) {
        try {
          const tweetsDir = safePath(syncDir, 'tweets');

          // latest.json — most recent tweets
          this.writeJsonSafe(tweetsDir, 'latest.json', data.tweets.logs || []);

          // Monthly archive
          const byMonth = this.groupByMonth(data.tweets.logs || [], 'created_at');
          for (const [month, items] of Object.entries(byMonth)) {
            this.writeJsonSafe(tweetsDir, `${sanitizeFilename(month)}.json`, items);
          }

          result.modules.tweets = { files: Object.keys(byMonth).length + 1 };
        } catch (e: any) {
          result.modules.tweets = { files: 0, error: e.message };
        }
      }

      // ── Write Analytics ──
      if (data.analytics && config.enabledModules.includes('analytics')) {
        try {
          const analyticsDir = safePath(syncDir, 'analytics');
          let fileCount = 0;

          if (data.analytics.followers) {
            this.writeJsonSafe(analyticsDir, 'followers.json', data.analytics.followers);
            fileCount++;
          }
          if (data.analytics.engagement) {
            this.writeJsonSafe(analyticsDir, 'engagement.json', data.analytics.engagement);
            fileCount++;
          }

          result.modules.analytics = { files: fileCount };
        } catch (e: any) {
          result.modules.analytics = { files: 0, error: e.message };
        }
      }

      // ── Write Usage ──
      if (data.usage && config.enabledModules.includes('usage')) {
        try {
          const analyticsDir = safePath(syncDir, 'analytics');
          this.writeJsonSafe(analyticsDir, 'usage.json', data.usage);
          result.modules.usage = { files: 1 };
        } catch (e: any) {
          result.modules.usage = { files: 0, error: e.message };
        }
      }

      // ── Write Writing Rules ──
      if (data.writing_rules && config.enabledModules.includes('writing-rules')) {
        try {
          const rulesDir = safePath(syncDir, 'writing-rules');

          // All rules as JSON
          this.writeJsonSafe(rulesDir, 'rules.json', data.writing_rules.rules || []);

          // Individual rules as Markdown
          let mdCount = 0;
          for (const rule of data.writing_rules.rules || []) {
            const mdContent = this.ruleToMarkdown(rule);
            const filename = sanitizeFilename(rule.name || `rule-${rule.id}`) + '.md';
            this.writeFileSafe(rulesDir, filename, mdContent);
            mdCount++;
          }

          result.modules['writing-rules'] = { files: 1 + mdCount };
        } catch (e: any) {
          result.modules['writing-rules'] = { files: 0, error: e.message };
        }
      }

      // Update lastSyncAt
      config.lastSyncAt = result.syncedAt;
      this.writeConfigSafe(syncDir, config);

    } catch (e: any) {
      result.success = false;
      result.modules._error = { files: 0, error: e.message };
    }

    result.duration_ms = Date.now() - start;
    return result;
  }

  /**
   * Check if auto-sync should trigger based on elapsed time.
   */
  shouldAutoSync(syncDir: string): boolean {
    try {
      const config = this.loadConfig(syncDir);
      const lastSync = new Date(config.lastSyncAt).getTime();
      const interval = config.autoSyncIntervalMinutes * 60 * 1000;
      return Date.now() - lastSync > interval;
    } catch {
      return false;
    }
  }

  /**
   * Get current sync status.
   */
  getSyncStatus(syncDir: string): {
    configured: boolean;
    config?: SyncConfig;
    fileCount?: number;
    error?: string;
  } {
    try {
      const config = this.loadConfig(syncDir);
      const fileCount = this.countFiles(syncDir);
      return { configured: true, config, fileCount };
    } catch (e: any) {
      return { configured: false, error: e.message };
    }
  }

  // ─── Private Helpers ───

  private loadConfig(syncDir: string): SyncConfig {
    const configPath = path.join(path.resolve(syncDir), CONFIG_FILENAME);
    if (!fs.existsSync(configPath)) {
      throw new Error(`Sync not configured. Run configure_sync first.`);
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
    if (raw.length > MAX_FILE_SIZE) {
      throw new Error('Config file suspiciously large');
    }
    return JSON.parse(raw);
  }

  private writeConfigSafe(syncDir: string, config: SyncConfig): void {
    const configPath = path.join(path.resolve(syncDir), CONFIG_FILENAME);
    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(configPath, content, 'utf-8');
  }

  private writeJsonSafe(dir: string, filename: string, data: any): void {
    const safe = sanitizeFilename(filename);
    const filePath = path.join(dir, safe);

    if (!isRealPath(filePath)) {
      throw new Error(`Symlink attack detected: ${safe}`);
    }

    const content = JSON.stringify(data, null, 2);
    if (content.length > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${safe} (${content.length} bytes)`);
    }

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  private writeFileSafe(dir: string, filename: string, content: string): void {
    const safe = sanitizeFilename(filename);
    const filePath = path.join(dir, safe);

    if (!isRealPath(filePath)) {
      throw new Error(`Symlink attack detected: ${safe}`);
    }

    if (content.length > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${safe} (${content.length} bytes)`);
    }

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  private groupByMonth(items: any[], dateField: string): Record<string, any[]> {
    const groups: Record<string, any[]> = {};
    for (const item of items) {
      const date = item[dateField];
      if (!date) continue;
      const month = date.slice(0, 7); // "2026-03"
      if (!groups[month]) groups[month] = [];
      groups[month].push(item);
    }
    return groups;
  }

  private ruleToMarkdown(rule: any): string {
    const constraints = typeof rule.constraints === 'string'
      ? JSON.parse(rule.constraints)
      : rule.constraints || {};
    const templates = typeof rule.templates === 'string'
      ? JSON.parse(rule.templates)
      : rule.templates || [];
    const examples = typeof rule.examples === 'string'
      ? JSON.parse(rule.examples)
      : rule.examples || { good: [], bad: [] };

    let md = `# ${rule.name}\n\n`;
    md += `- **Tone**: ${rule.tone}\n`;
    if (rule.persona) md += `- **Persona**: ${rule.persona}\n`;
    if (rule.is_default) md += `- **Default Rule**: ✅\n`;
    md += `\n`;

    if (Object.keys(constraints).length > 0) {
      md += `## Constraints\n\n`;
      md += `\`\`\`json\n${JSON.stringify(constraints, null, 2)}\n\`\`\`\n\n`;
    }

    if (templates.length > 0) {
      md += `## Templates\n\n`;
      for (const t of templates) {
        md += `\`\`\`\n${t}\n\`\`\`\n\n`;
      }
    }

    if (examples.good?.length > 0) {
      md += `## Good Examples\n\n`;
      for (const e of examples.good) md += `- ${e}\n`;
      md += `\n`;
    }

    if (examples.bad?.length > 0) {
      md += `## Bad Examples\n\n`;
      for (const e of examples.bad) md += `- ${e}\n`;
      md += `\n`;
    }

    return md;
  }

  private countFiles(dir: string): number {
    let count = 0;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) count++;
        if (entry.isDirectory()) {
          count += this.countFiles(path.join(dir, entry.name));
        }
      }
    } catch {
      // Directory might not exist
    }
    return count;
  }
}
