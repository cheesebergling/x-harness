import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Star, Check, X as XIcon, Sparkles } from 'lucide-react';
import { getWritingRules, createWritingRule, updateWritingRule, deleteWritingRule, setDefaultWritingRule } from '../api';

interface WritingRule {
  id: number;
  name: string;
  tone: string;
  persona: string | null;
  constraints: Record<string, any>;
  templates: string[];
  examples: { good: string[]; bad: string[] };
  is_default: boolean | number;
  created_at: string;
  updated_at: string;
}

interface Props {
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

const TONES = [
  { value: 'casual', label: 'カジュアル', emoji: '😊' },
  { value: 'professional', label: 'プロフェッショナル', emoji: '💼' },
  { value: 'provocative', label: '挑発的', emoji: '🔥' },
  { value: 'neutral', label: 'ニュートラル', emoji: '⚖️' },
  { value: 'friendly', label: 'フレンドリー', emoji: '🤝' },
  { value: 'authoritative', label: '権威的', emoji: '🎓' },
];

export function WritingRulesPage({ showToast }: Props) {
  const [rules, setRules] = useState<WritingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<WritingRule | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formTone, setFormTone] = useState('neutral');
  const [formPersona, setFormPersona] = useState('');
  const [formMaxChars, setFormMaxChars] = useState(280);
  const [formHashtagMax, setFormHashtagMax] = useState(3);
  const [formTemplates, setFormTemplates] = useState('');
  const [formGoodExamples, setFormGoodExamples] = useState('');
  const [formBadExamples, setFormBadExamples] = useState('');
  const [formIsDefault, setFormIsDefault] = useState(false);

  const fetchRules = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getWritingRules();
      setRules(res.data || []);
    } catch (e: any) {
      showToast('error', e.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const resetForm = () => {
    setFormName(''); setFormTone('neutral'); setFormPersona('');
    setFormMaxChars(280); setFormHashtagMax(3);
    setFormTemplates(''); setFormGoodExamples(''); setFormBadExamples('');
    setFormIsDefault(false); setEditingRule(null);
  };

  const openEdit = (rule: WritingRule) => {
    setEditingRule(rule);
    setFormName(rule.name);
    setFormTone(rule.tone);
    setFormPersona(rule.persona || '');
    setFormMaxChars(rule.constraints?.max_chars || 280);
    setFormHashtagMax(rule.constraints?.hashtag_rules?.max || 3);
    setFormTemplates((rule.templates || []).join('\n---\n'));
    setFormGoodExamples((rule.examples?.good || []).join('\n'));
    setFormBadExamples((rule.examples?.bad || []).join('\n'));
    setFormIsDefault(!!rule.is_default);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    try {
      const body = {
        name: formName,
        tone: formTone,
        persona: formPersona || undefined,
        constraints: {
          max_chars: formMaxChars,
          hashtag_rules: { max: formHashtagMax, position: 'end' },
        },
        templates: formTemplates ? formTemplates.split('\n---\n').map(t => t.trim()) : [],
        examples: {
          good: formGoodExamples ? formGoodExamples.split('\n').filter(Boolean) : [],
          bad: formBadExamples ? formBadExamples.split('\n').filter(Boolean) : [],
        },
        is_default: formIsDefault,
      };

      if (editingRule) {
        await updateWritingRule(editingRule.id, body);
        showToast('success', 'ルールを更新しました');
      } else {
        await createWritingRule(body);
        showToast('success', 'ルールを作成しました');
      }

      resetForm();
      setShowForm(false);
      fetchRules();
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('このルールを削除しますか？')) return;
    try {
      await deleteWritingRule(id);
      showToast('success', 'ルールを削除しました');
      fetchRules();
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleSetDefault = async (id: number) => {
    try {
      await setDefaultWritingRule(id);
      showToast('success', 'デフォルトルールを変更しました');
      fetchRules();
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  if (loading) {
    return <div className="page-loading">読み込み中...</div>;
  }

  return (
    <div className="wr-page">
      {/* ヘッダー */}
      <div className="wr-page__header">
        <div>
          <h2 className="wr-page__title">
            <Sparkles size={20} style={{ color: 'var(--accent)' }} />
            ライティングルール
          </h2>
          <p className="wr-page__subtitle">ツイートのトーン・ペルソナ・テンプレートを定義して、投稿スタイルを統一</p>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => { resetForm(); setShowForm(true); }}
        >
          <Plus size={16} />
          新規ルール
        </button>
      </div>

      {/* ルール一覧 */}
      <div className="wr-grid">
        {rules.map((rule) => {
          const tone = TONES.find(t => t.value === rule.tone);
          return (
            <div key={rule.id} className={`wr-card ${rule.is_default ? 'wr-card--default' : ''}`}>
              <div className="wr-card__header">
                <div className="wr-card__title-row">
                  <h3 className="wr-card__name">{rule.name}</h3>
                  {rule.is_default && (
                    <span className="wr-card__badge">
                      <Star size={12} /> デフォルト
                    </span>
                  )}
                </div>
                <div className="wr-card__actions">
                  <button className="btn btn--ghost btn--sm" onClick={() => openEdit(rule)} title="編集">
                    <Pencil size={14} />
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => handleDelete(rule.id)} title="削除">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="wr-card__body">
                <div className="wr-card__tone">
                  <span className="wr-card__tone-emoji">{tone?.emoji || '⚖️'}</span>
                  <span className="wr-card__tone-label">{tone?.label || rule.tone}</span>
                </div>

                {rule.persona && (
                  <p className="wr-card__persona">{rule.persona}</p>
                )}

                <div className="wr-card__meta">
                  {rule.constraints?.max_chars && (
                    <span className="wr-card__meta-item">最大 {rule.constraints.max_chars} 文字</span>
                  )}
                  {rule.templates?.length > 0 && (
                    <span className="wr-card__meta-item">{rule.templates.length} テンプレート</span>
                  )}
                  {rule.constraints?.hashtag_rules?.max && (
                    <span className="wr-card__meta-item"># 最大 {rule.constraints.hashtag_rules.max}</span>
                  )}
                </div>
              </div>

              {!rule.is_default && (
                <div className="wr-card__footer">
                  <button
                    className="btn btn--secondary btn--sm"
                    onClick={() => handleSetDefault(rule.id)}
                  >
                    <Star size={12} /> デフォルトに設定
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {rules.length === 0 && (
          <div className="wr-empty">
            <Sparkles size={48} style={{ color: 'var(--text-tertiary)', marginBottom: 16 }} />
            <p>ルールがまだありません</p>
            <p className="wr-empty__sub">「新規ルール」ボタンからルールを作成してください</p>
          </div>
        )}
      </div>

      {/* フォームモーダル */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h3>{editingRule ? 'ルールを編集' : '新規ルール作成'}</h3>
              <button className="btn btn--ghost btn--icon" onClick={() => setShowForm(false)}>
                <XIcon size={18} />
              </button>
            </div>

            <div className="modal__body">
              <div className="form-group">
                <label className="form-label">ルール名 *</label>
                <input
                  className="form-input"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="例: X投稿・カジュアル"
                />
              </div>

              <div className="form-group">
                <label className="form-label">トーン</label>
                <div className="wr-tone-grid">
                  {TONES.map((t) => (
                    <button
                      key={t.value}
                      className={`wr-tone-btn ${formTone === t.value ? 'wr-tone-btn--active' : ''}`}
                      onClick={() => setFormTone(t.value)}
                    >
                      <span>{t.emoji}</span>
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">ペルソナ</label>
                <textarea
                  className="form-textarea"
                  value={formPersona}
                  onChange={(e) => setFormPersona(e.target.value)}
                  placeholder="例: 30代マーケター目線。フォロワーとの距離感を大切に。"
                  rows={2}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">最大文字数</label>
                  <input
                    className="form-input"
                    type="number"
                    value={formMaxChars}
                    onChange={(e) => setFormMaxChars(Number(e.target.value))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">ハッシュタグ上限</label>
                  <input
                    className="form-input"
                    type="number"
                    value={formHashtagMax}
                    onChange={(e) => setFormHashtagMax(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">テンプレート（---で区切り）</label>
                <textarea
                  className="form-textarea"
                  value={formTemplates}
                  onChange={(e) => setFormTemplates(e.target.value)}
                  placeholder={"【{{topic}}】\n{{body}}\n\n{{cta}}\n---\n{{hook}}\n\n→ {{body}}"}
                  rows={4}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">良い例（改行区切り）</label>
                  <textarea
                    className="form-textarea"
                    value={formGoodExamples}
                    onChange={(e) => setFormGoodExamples(e.target.value)}
                    rows={2}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">悪い例（改行区切り）</label>
                  <textarea
                    className="form-textarea"
                    value={formBadExamples}
                    onChange={(e) => setFormBadExamples(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>

              <label className="toggle">
                <input
                  type="checkbox"
                  className="toggle__input"
                  checked={formIsDefault}
                  onChange={(e) => setFormIsDefault(e.target.checked)}
                />
                <span className="toggle__track"><span className="toggle__thumb" /></span>
                <span className="toggle__label">デフォルトルールに設定</span>
              </label>
            </div>

            <div className="modal__footer">
              <button className="btn btn--secondary" onClick={() => setShowForm(false)}>
                キャンセル
              </button>
              <button className="btn btn--primary" onClick={handleSubmit} disabled={!formName.trim()}>
                <Check size={16} />
                {editingRule ? '更新' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
