/**
 * AI Analyzer Service
 * Cloudflare Workers AI (Llama 3.1) を使ったブックマーク分析
 * - カテゴリ分類 + フォルダ自動振り分け
 * - キーワード・スキルタグ抽出
 * - サマリー生成
 * - Skills / Workflows 自動提案
 */

import type { Env } from '../index';

interface AnalysisResult {
  category: string;
  keywords: string[];
  summary: string;
  skill_tags: string[];
  folder_suggestion: number;
}

interface ExtractedSkill {
  name: string;
  category: string;
  description: string;
  related_tools: string[];
  actionable: boolean;
  confidence: number;
}

interface WorkflowStep {
  order: number;
  action: string;
  details: string;
}

interface WorkflowSuggestion {
  title: string;
  description: string;
  steps: WorkflowStep[];
  required_skills: string[];
}

// デフォルトフォルダ定義（ID ↔ ルール）
const FOLDER_RULES: { id: number; name: string; keywords: string[] }[] = [
  { id: 1, name: 'マーケティング', keywords: ['集客', '広告', 'SNS戦略', 'コピーライティング', 'マーケ', 'LP', 'CVR', 'SEO', 'コンバージョン', 'ブランディング'] },
  { id: 2, name: '技術・開発', keywords: ['プログラミング', 'API', 'インフラ', 'ツール', '開発', 'コード', 'TypeScript', 'React', 'Python', 'Docker', 'CI/CD', 'AWS', 'Cloudflare'] },
  { id: 3, name: 'ニュース・トレンド', keywords: ['速報', '業界動向', 'アップデート', 'リリース', '発表', '新機能', 'ニュース'] },
  { id: 4, name: 'アイデア', keywords: ['事例', '成功事例', '発想', 'インスピレーション', 'ヒント', 'アイデア', 'フレームワーク'] },
];

export class AIAnalyzer {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * 単一ブックマークを分析
   */
  async analyzeBookmark(text: string, authorUsername?: string): Promise<AnalysisResult> {
    // まずルールベースでフォルダ候補を判定
    const folderSuggestion = this.suggestFolderByRules(text);

    try {
      const prompt = `あなたはSNSコンテンツ分析AIです。以下のツイートを分析してください。

ツイート:
"""
${text}
"""
${authorUsername ? `投稿者: @${authorUsername}` : ''}

以下のJSON形式で応答してください（JSONのみ、説明不要）:
{
  "category": "marketing|tech|news|idea|other のいずれか",
  "keywords": ["キーワード1", "キーワード2", "キーワード3"],
  "summary": "30文字以内の要約",
  "skill_tags": ["このツイートから得られるスキルや知識タグ"]
}`;

      const response = await (this.env.AI as any).run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'JSON形式のみで応答してください。' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }) as { response: string };

      const parsed = this.parseJSON(response.response);

      // AI のカテゴリをフォルダID にマッピング
      const categoryFolderMap: Record<string, number> = {
        marketing: 1,
        tech: 2,
        news: 3,
        idea: 4,
        other: 5,
      };

      return {
        category: parsed.category || 'other',
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        summary: parsed.summary || '',
        skill_tags: Array.isArray(parsed.skill_tags) ? parsed.skill_tags : [],
        folder_suggestion: categoryFolderMap[parsed.category] || folderSuggestion,
      };
    } catch (error) {
      // AI 分析失敗時はルールベースにフォールバック
      console.error('AI analysis failed, using rule-based fallback:', error);
      return {
        category: 'other',
        keywords: [],
        summary: text.slice(0, 30),
        skill_tags: [],
        folder_suggestion: folderSuggestion,
      };
    }
  }

  /**
   * 複数ブックマークからスキルを抽出（GitHub/ClaudeCode/AIツール対応）
   */
  async extractSkills(bookmarks: { id: number; text: string; skill_tags?: string }[]): Promise<ExtractedSkill[]> {
    const allTags: string[] = [];
    for (const b of bookmarks) {
      if (b.skill_tags) {
        try {
          const tags = JSON.parse(b.skill_tags);
          if (Array.isArray(tags)) allTags.push(...tags);
        } catch { /* ignore */ }
      }
    }

    // GitHub URL を抽出
    const githubUrls: string[] = [];
    const ghRegex = /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/g;
    for (const b of bookmarks) {
      const m = b.text.match(ghRegex);
      if (m) githubUrls.push(...m);
    }

    if (allTags.length === 0 && githubUrls.length === 0) return [];

    const tagCounts = new Map<string, number>();
    for (const tag of allTags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }

    const sampleTexts = bookmarks.slice(0, 15).map((b) => b.text).join('\n---\n');
    const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    const uniqueGhUrls = [...new Set(githubUrls)].slice(0, 10);

    try {
      const prompt = `あなたはAIワークフロー構築の専門家です。以下のブックマーク群から、AIエージェント（ClaudeCode, Cursor, Antigravity等）のskills/ワークフロー構築に活用できるスキルを抽出してください。

特に以下を重視:
1. GitHubリポジトリ: ツール、ライブラリ、テンプレートとして活用可能なもの
2. AIツール活用パターン: ClaudeCode, Cursor, MCP等のスキル化パターン
3. ワークフロー構築素材: 自動化、API連携、データ処理パターン
4. マーケティング/コンテンツ制作: SNS運用に直結するスキル

${uniqueGhUrls.length > 0 ? `検出されたGitHubリポジトリ:\n${uniqueGhUrls.map(u => `- ${u}`).join('\n')}\n` : ''}
頻出キーワード:
${topTags.map(([tag, count]) => `- ${tag} (${count}回)`).join('\n')}

ブックマークサンプル:
"""
${sampleTexts}
"""

以下のJSON配列で応答（JSONのみ、最大8つ、actionable=trueを優先）:
[{"name":"スキル名","category":"marketing|tech|content|analytics|ai_tools","description":"具体的説明","related_tools":["ツール名やURL"],"actionable":true,"confidence":0.8}]`;

      const response = await (this.env.AI as any).run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'JSON配列のみで応答してください。' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1200,
        temperature: 0.4,
      }) as { response: string };

      const parsed = this.parseJSON(response.response);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Skill extraction failed:', error);
      const fallback: ExtractedSkill[] = topTags.slice(0, 5).map(([tag, count]) => ({
        name: tag,
        category: 'other',
        description: `${count}件のブックマークで言及されたスキル`,
        related_tools: [],
        actionable: false,
        confidence: Math.min(count / bookmarks.length, 1),
      }));
      for (const url of uniqueGhUrls.slice(0, 3)) {
        const repoName = url.split('/').slice(-2).join('/');
        fallback.push({
          name: `GitHub: ${repoName}`,
          category: 'tech',
          description: `GitHubリポジトリ ${repoName} の活用`,
          related_tools: [url],
          actionable: true,
          confidence: 0.7,
        });
      }
      return fallback;
    }
  }

  /**
   * ブックマーク群からワークフロー提案を生成
   */
  async generateWorkflows(
    skills: { name: string; category: string; description: string }[],
    bookmarkSamples: string[]
  ): Promise<WorkflowSuggestion[]> {
    if (skills.length === 0) return [];

    try {
      const prompt = `あなたはワークフロー設計AIです。
以下のスキルセットとブックマークから、x-harness（X/Twitter API管理ツール）で実行可能なワークフローを提案してください。

x-harnessの機能: ツイート投稿/削除/予約、スレッド作成、フォロワー分析、エンゲージメント分析、ブックマーク管理

利用可能なスキル:
${skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}

ブックマークの傾向:
"""
${bookmarkSamples.slice(0, 5).join('\n---\n')}
"""

以下のJSON配列で応答してください（JSONのみ、最大3つ）:
[
  {
    "title": "ワークフロー名",
    "description": "ワークフローの説明",
    "steps": [
      {"order": 1, "action": "アクション名", "details": "具体的な手順"}
    ],
    "required_skills": ["必要スキル名"]
  }
]`;

      const response = await (this.env.AI as any).run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'JSON配列のみで応答してください。' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1000,
        temperature: 0.5,
      }) as { response: string };

      const parsed = this.parseJSON(response.response);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Workflow generation failed:', error);
      return [];
    }
  }

  // ──── Private helpers ────

  private suggestFolderByRules(text: string): number {
    const lower = text.toLowerCase();
    for (const rule of FOLDER_RULES) {
      for (const keyword of rule.keywords) {
        if (lower.includes(keyword.toLowerCase())) {
          return rule.id;
        }
      }
    }
    return 5; // デフォルト: あとで読む
  }

  private parseJSON(text: string): any {
    // AI レスポンスから JSON 部分を抽出
    const jsonMatch = text.match(/[\[{][\s\S]*[\]}]/);
    if (!jsonMatch) return {};
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return {};
    }
  }
}
