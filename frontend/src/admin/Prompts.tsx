import { useState, type FormEvent } from 'react';
import { AdminError, api, errorText } from './api';
import type { AdvisorPrompts, AdvisorText, PromptField } from './types';
import { date, Loading, Panel, useResource } from './shared';
import { confirmDiscard, useUnsavedChanges } from './unsaved';

const fields: { key: PromptField; label: string; hint: string }[] = [
  { key: 'instructions', label: '共同规则', hint: '每次模型请求都会收到：Advisor 身份、事实约束、保密和实验协议。' },
  { key: 'neutral', label: 'Neutral 条件', hint: '仅发送给 Neutral 任务，用于规定比较选项的方式。' },
  { key: 'goal', label: 'Goal 条件', hint: '仅发送给 Goal 任务。保留 {target}，运行时替换为该任务固定的目标选项。' },
  { key: 'prepare', label: '准备阶段', hint: '准备请求的阶段指令，指导查阅材料与提交策略；不写入长期对话历史。' },
  { key: 'reply', label: '正式回复', hint: '策略提交后的阶段指令。此时后端关闭全部工具。' },
  { key: 'opening', label: '开场白', hint: '开始新的真实模型任务时显示的固定消息，不调用模型。' },
  { key: 'resource_policy', label: '材料使用规则', hint: '每次请求都会收到的材料查阅指引。实际次数上限由执行器控制。' },
];
const toolLabels: Record<string, string> = { read_material: '读取材料', search_material: '检索材料', select_strategy: '提交策略' };
const PENDING_KEY = 'fcm-advisor-prompts-save-v1';
interface SaveRequest { requestId: string; revision: number; config: AdvisorText }
function pendingSave(): SaveRequest | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null');
    return value && typeof value.requestId === 'string' && Number.isInteger(value.revision) &&
      fields.every(field => typeof value.config?.prompt?.[field.key] === 'string') &&
      Array.isArray(value.config.strategies) && Array.isArray(value.config.tools) ? value : undefined;
  } catch { return undefined; }
}
function remember(request?: SaveRequest) {
  try { if (request) sessionStorage.setItem(PENDING_KEY, JSON.stringify(request)); else sessionStorage.removeItem(PENDING_KEY); }
  catch { /* The in-memory request still supports an idempotent retry. */ }
}
const copy = <T,>(value: T): T => structuredClone(value);

function PromptEditor({ initial, onSaved, reload }: {
  initial: AdvisorPrompts; onSaved: (value: AdvisorPrompts) => void; reload: () => void;
}) {
  const [saved, setSaved] = useState(initial);
  const [command, setCommand] = useState<SaveRequest | undefined>(pendingSave);
  const [draft, setDraft] = useState<AdvisorText>(() => copy(command?.config ?? initial.config));
  const [group, setGroup] = useState<'prompt' | 'strategies' | 'tools'>('prompt');
  const [field, setField] = useState<PromptField>('instructions');
  const [strategyId, setStrategyId] = useState(draft.strategies[0]?.id ?? 'S00');
  const [toolName, setToolName] = useState(draft.tools[0]?.name ?? 'read_material');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.config);
  useUnsavedChanges(dirty || !!command);
  const locked = busy || !!command;
  const activeField = fields.find(item => item.key === field)!;
  const strategy = draft.strategies.find(item => item.id === strategyId) ?? draft.strategies[0];
  const tool = draft.tools.find(item => item.name === toolName) ?? draft.tools[0];
  const changed = (key: PromptField) => draft.prompt[key] !== saved.config.prompt[key];
  function patchStrategy(changes: Partial<AdvisorText['strategies'][number]>) {
    setDraft(value => ({ ...value, strategies: value.strategies.map(item => item.id === strategy.id ? { ...item, ...changes } : item) }));
  }
  function patchTool(description: string) {
    setDraft(value => ({ ...value, tools: value.tools.map(item => item.name === tool.name ? { ...item, description } : item) }));
  }
  function restoreCurrent() {
    if (group === 'prompt') setDraft(value => ({ ...value, prompt: { ...value.prompt, [field]: saved.defaults.prompt[field] } }));
    if (group === 'strategies') {
      const original = saved.defaults.strategies.find(item => item.id === strategy.id)!;
      setDraft(value => ({ ...value, strategies: value.strategies.map(item => item.id === strategy.id ? copy(original) : item) }));
    }
    if (group === 'tools') patchTool(saved.defaults.tools.find(item => item.name === tool.name)!.description);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    if (fields.some(item => !draft.prompt[item.key].trim())) { setError('每项提示词都需要填写，不能仅包含空白。'); return; }
    if (!draft.prompt.goal.includes('{target}')) { setError('Goal 条件提示词必须保留 {target} 占位符。'); return; }
    if (draft.strategies.some(item => !item.name.trim() || !item.definition.trim()) || draft.tools.some(item => !item.description.trim())) {
      setError('请填写策略名称、定义和工具说明。'); return;
    }
    const request = command ?? { requestId: crypto.randomUUID(), revision: saved.revision, config: copy(draft) };
    setCommand(request); remember(request); setBusy(true);
    try {
      const value = await api<AdvisorPrompts>('/advisor-prompts', request);
      setSaved(value); setDraft(copy(value.config)); setCommand(undefined); remember(); onSaved(value);
    } catch (reason) {
      setError(errorText(reason));
      if (reason instanceof AdminError && reason.status >= 400 && reason.status < 500) { setCommand(undefined); remember(); }
    } finally { setBusy(false); }
  }
  function download() {
    const data = { revision: saved.revision, draft: dirty, savedRuntimeRef: saved.runtimeRef, config: draft };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `advisor-prompts-v${saved.revision}${dirty ? '-draft' : ''}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <form className="admin-stack admin-prompts" onSubmit={save}>
    <div className="admin-info">保存后用于新建的预览和批次；已有预览、已发放批次和正在进行的对话保留冻结版本。内容变化后，请到<a href="#settings">设置</a>重新验证 Advisor。保存本身不调用模型。</div>
    <Panel title="Advisor 提示词" action={<div className="admin-actions"><span className="admin-caption">v{saved.revision} · {saved.updatedAt ? date(saved.updatedAt) : '文件默认值'}</span><button type="button" className="admin-button" onClick={download}>导出 JSON</button></div>}>
      <div className="admin-prompt-tabs" aria-label="提示词分类">
        {([['prompt', '对话提示词', fields.length], ['strategies', '策略目录', draft.strategies.length], ['tools', '工具说明', draft.tools.length]] as const).map(([key, label, count]) =>
          <button key={key} type="button" aria-pressed={group === key} onClick={() => setGroup(key)}>{label}<span>{count}</span></button>)}
      </div>
      <div className="admin-prompt-layout"><nav className="admin-prompt-list" aria-label="编辑项目">
        {group === 'prompt' && fields.map(item => <button type="button" key={item.key} aria-pressed={field === item.key} onClick={() => setField(item.key)}><span>{item.label}</span><small>{item.key}{changed(item.key) ? ' ●' : ''}</small></button>)}
        {group === 'strategies' && draft.strategies.map(item => <button type="button" key={item.id} aria-pressed={strategy.id === item.id} onClick={() => setStrategyId(item.id)}><span><code>{item.id}</code> {item.name}</span>{JSON.stringify(item) !== JSON.stringify(saved.config.strategies.find(old => old.id === item.id)) && <small>● 已修改</small>}</button>)}
        {group === 'tools' && draft.tools.map(item => <button type="button" key={item.name} aria-pressed={tool.name === item.name} onClick={() => setToolName(item.name)}><span>{toolLabels[item.name]}</span><small>{item.name}{item.description !== saved.config.tools.find(old => old.name === item.name)?.description ? ' ●' : ''}</small></button>)}
      </nav><div className="admin-prompt-editor"><div className="admin-prompt-editor-heading"><div><h3>{group === 'prompt' ? activeField.label : group === 'strategies' ? `${strategy.id} · 策略卡` : toolLabels[tool.name]}</h3><p>{group === 'prompt' ? activeField.hint : group === 'strategies' ? '名称、定义、分类边界和执行提示词会随完整策略目录发送给模型。策略编号固定。' : '修改发送给模型的工具说明；名称、参数结构和后端执行权限保持固定。'}</p></div><button type="button" className="admin-link-button" disabled={locked} onClick={restoreCurrent}>此项恢复默认</button></div>
        <fieldset disabled={locked} className="admin-prompt-fields">
          {group === 'prompt' && <label className="admin-field"><span className="admin-prompt-field-meta">{activeField.key}<small>{draft.prompt[field].length.toLocaleString()} / 20,000 字符</small></span><textarea aria-label={`${activeField.label}提示词`} className="admin-prompt-text" spellCheck={false} rows={16} maxLength={20000} value={draft.prompt[field]} onChange={event => setDraft(value => ({ ...value, prompt: { ...value.prompt, [field]: event.target.value } }))} /></label>}
          {group === 'strategies' && <>
            <label className="admin-field">策略名称<input aria-label="策略名称" maxLength={200} value={strategy.name} onChange={event => patchStrategy({ name: event.target.value })} /></label>
            <label className="admin-field">策略定义<textarea aria-label="策略定义" rows={3} maxLength={8000} value={strategy.definition} onChange={event => patchStrategy({ definition: event.target.value })} /></label>
            <label className="admin-field">分类边界<textarea aria-label="分类边界" rows={3} maxLength={8000} value={strategy.boundary ?? ''} onChange={event => patchStrategy({ boundary: event.target.value })} /></label>
            <label className="admin-field">执行提示词<textarea aria-label="策略执行提示词" rows={5} maxLength={8000} value={strategy.execution_prompt ?? ''} onChange={event => patchStrategy({ execution_prompt: event.target.value })} /></label>
          </>}
          {group === 'tools' && <><label className="admin-field">工具说明<textarea aria-label="工具说明" className="admin-prompt-text" spellCheck={false} rows={8} maxLength={4000} value={tool.description} onChange={event => patchTool(event.target.value)} /></label><details className="admin-prompt-schema"><summary>参数结构（只读）</summary><pre>{JSON.stringify(saved.toolSchemas.find(item => item.name === tool.name)?.parameters, null, 2)}</pre></details></>}
        </fieldset>
      </div></div>
      <div className="admin-form-footer admin-prompt-footer"><span className={dirty || command ? 'admin-unsaved' : 'admin-caption'}>{command ? '上次保存尚未确认，请重试同一请求' : dirty ? '● 尚未保存' : '当前内容已保存'}</span><div className="admin-actions"><button type="button" className="admin-link-button" disabled={locked || !dirty} onClick={() => { setDraft(copy(saved.config)); setError(''); }}>撤销修改</button><button type="submit" className="admin-button primary" disabled={busy || (!dirty && !command)}>{busy ? '正在保存…' : command ? '重试同一保存请求' : '保存提示词'}</button></div></div>
    </Panel>
    {error && <div role="alert" className="admin-error">{error}{command ? <p>请求编号和原文已保留；重试不会重复保存。刷新后可继续查询同一次保存。</p> : <button type="button" className="admin-link-button" onClick={reload}>重新读取最新版本</button>}</div>}
    <div className="admin-prompt-runtime"><span>每轮最多 {saved.runtime.maxModelCallsPerTurn} 次生成 / {saved.runtime.maxMaterialCallsPerTurn} 次材料调用</span><span>每次输出上限 {saved.runtime.maxOutputTokens} tokens</span><span>推理 {saved.runtime.reasoning.effort}</span><code title={saved.runtimeRef}>版本摘要 {saved.runtimeRef.slice(0, 12)}</code></div>
    <details className="admin-panel admin-prompt-context"><summary>上下文如何组装</summary><p>共同规则 + 材料使用规则 + Neutral / Goal 条件 + 完整策略目录 + 当前公开案例 + 当前阶段指令；对话与工具历史单独随请求发送。准备阶段提交策略后，正式回复关闭工具。</p><p>问卷答案、前后测判断和研究者备注不进入模型。材料权限、策略提交顺序和费用上限由后端控制；修改文字不会改变这些执行限制。</p></details>
  </form>;
}

export function PromptsPage({ revision, onSaved }: { revision: number; onSaved: () => void }) {
  const resource = useResource<AdvisorPrompts>('/advisor-prompts', revision);
  const [notice, setNotice] = useState('');
  return <div className="admin-stack">{notice && <div className="admin-info" role="status">{notice}</div>}
    {resource.error && resource.value && <div className="admin-error" role="alert">{resource.error}</div>}
    {resource.value ? <PromptEditor key={resource.value.revision} initial={resource.value} reload={() => { if (confirmDiscard()) resource.reload(); }} onSaved={value => {
      setNotice(`提示词 v${value.revision} 已保存 · ${date(value.updatedAt)}（北京时间）。新配置按此版本冻结。`); onSaved();
    }} /> : <Loading error={resource.error} retry={resource.reload} />}
  </div>;
}
