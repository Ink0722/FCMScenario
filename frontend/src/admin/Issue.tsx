import { useEffect, useState, type FormEvent } from 'react';
import { AdminError, api, errorText } from './api';
import type { BatchPlan, BudgetCheck, Catalog, Codes, Preview } from './types';
import type { SaveCodes } from './App';
import { batchName, beijingInstant, date } from './time';
import { BudgetEstimate } from './BudgetEstimate';
import { KeyValues, Loading, Panel, useResource } from './shared';

type Mode = '' | 'neutral' | 'goal' | 'both';
interface Plan {
  requestId: string; configRef?: string; taskCodes: string[]; maxTurns: number; modelId: string | null;
  groups: { condition: 'neutral' | 'goal'; count: number }[]; batchId: string; expiresAt: string | null;
}
const PENDING = 'fcm-pending-issuance';
function pending(): Plan | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
    return value && typeof value.requestId === 'string' && Array.isArray(value.taskCodes) && Array.isArray(value.groups) ? value : undefined;
  } catch { return undefined; }
}
export function IssuePage({ revision, saveCodes, initialPlan, onPlanUsed }: { revision: number; saveCodes: SaveCodes; initialPlan: BatchPlan | null; onPlanUsed: () => void }) {
  const resource = useResource<Catalog>('/catalog', revision);
  const [restored] = useState(pending);
  const [source] = useState(restored ?? initialPlan);
  useEffect(() => { if (initialPlan) onPlanUsed(); }, [initialPlan, onPlanUsed]);
  const [selected, setSelected] = useState<string[]>(source?.taskCodes ?? []); const [maximum, setMaximum] = useState(source?.maxTurns ?? 20);
  const [modelId, setModelId] = useState(source?.modelId ?? '');
  const [preview, setPreview] = useState<Preview>();
  const [budgetCheck, setBudgetCheck] = useState<BudgetCheck>();
  const availableModels = resource.value?.models ?? [];
  const selectedModel = availableModels.find(model => model.id === modelId);
  const [mode, setMode] = useState<Mode>(source ? source.groups.length === 2 ? 'both' : source.groups[0].condition : '');
  const [neutral, setNeutral] = useState(source?.groups.find(group => group.condition === 'neutral')?.count ?? 1);
  const [goal, setGoal] = useState(source?.groups.find(group => group.condition === 'goal')?.count ?? 1);
  const [batch, setBatch] = useState(restored?.batchId ?? '');
  const [expiry, setExpiry] = useState(restored?.expiresAt ? new Date(new Date(restored.expiresAt).getTime() + 8 * 3600_000).toISOString().slice(0, 16) : '');
  const [command, updateCommand] = useState<Plan | undefined>(restored);
  function setCommand(value?: Plan) {
    updateCommand(value);
    try { if (value) sessionStorage.setItem(PENDING, JSON.stringify(value)); else sessionStorage.removeItem(PENDING); } catch { /* Memory still preserves an uncertain request. */ }
  }
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const groups: Plan['groups'] = [
    ...(mode === 'neutral' || mode === 'both' ? [{ condition: 'neutral' as const, count: neutral }] : []),
    ...(mode === 'goal' || mode === 'both' ? [{ condition: 'goal' as const, count: goal }] : []),
  ];
  const total = groups.reduce((sum, group) => sum + (Number.isFinite(group.count) ? group.count : 0), 0);
  const locked = busy || !!command;
  const tasksAvailable = selected.every(code => resource.value?.tasks.some(task => task.taskCode === code && task.enabled));
  const valid = tasksAvailable && (!modelId || !!selectedModel?.configured) && !!mode && !!selected.length && groups.every(g => Number.isInteger(g.count) && g.count > 0) && total <= 1000;
  useEffect(() => { setPreview(undefined); }, [modelId, maximum, selected.join(','), mode, neutral, goal, batch, expiry]);
  async function generate(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!command && expiry && new Date(beijingInstant(expiry)).getTime() <= Date.now()) {
      setError('访问到期时间需晚于当前北京时间。'); return;
    }
    let request: Plan = command ?? { requestId: crypto.randomUUID(), taskCodes: [...selected], maxTurns: maximum, modelId: modelId || null,
      groups, batchId: batch.trim() || batchName(), expiresAt: expiry ? beijingInstant(expiry) : null };
    setCommand(request); setBusy(true);
    try {
      if (!request.configRef) {
        const frozen = await api<Preview>('/code-preview', { taskCodes: request.taskCodes, maxTurns: request.maxTurns, modelId: request.modelId, participantCount: request.groups.reduce((n, group) => n + group.count, 0) });
        if (!frozen.canIssue) { setPreview(frozen); setCommand(undefined); return; }
        request = { ...request, configRef: frozen.configRef };
        setCommand(request);
      }
      const result = await api<Codes>('/codes', {
        requestId: request.requestId, configRef: request.configRef, groups: request.groups,
        batchId: request.batchId, expiresAt: request.expiresAt,
      });
      saveCodes(result.codes, `${result.replayed ? '已恢复生成结果' : '测试码已生成'} · ${request.batchId}`);
      setCommand(undefined);
      // Retain task/group settings for the next batch; generate a distinct name when left blank.
      setBatch('');
    } catch (reason) {
      setError(errorText(reason));
      if (reason instanceof AdminError && reason.status >= 400 && reason.status < 500) setCommand(undefined);
    } finally { setBusy(false); }
  }
  if (!resource.value) return <Loading error={resource.error} retry={resource.reload} />;
  return <form className="admin-issue-layout" onSubmit={generate}><div className="admin-issue-fields">
    {restored && command ? <div className="admin-info" role="status">已恢复上次未确认的发放请求，重试将使用首次冻结配置。</div> : !restored && source && <div className="admin-info admin-copy-notice" role="status">已复制 {'sourceBatch' in source && source.sourceBatch || '未命名批次'} 的任务、人数与轮数。新批次自动命名、到期时间留空；模型使用当前连接，请确认后生成。{total > 1000 && <p>原安排累计超过 1000 人，请调低本批数量。</p>}{!tasksAvailable && <p>部分原任务已停用，请重新选择任务。</p>}</div>}
    <Panel title="发放对象" subtitle="明确选择实验条件，可一次生成单组或两组测试码。">
      <fieldset className="admin-condition-picker" disabled={locked}><legend className="sr-only">选择实验条件</legend>{([
        ['neutral', 'Neutral', '不设劝服方向'], ['goal', 'Goal', '使用分配的劝服目标'], ['both', '两组分别配置', '自行指定每组人数'],
      ] as const).map(([value, title, note]) => <label key={value} className={mode === value ? 'selected' : ''}><input required type="radio" name="condition" value={value} checked={mode === value} onChange={() => setMode(value)} /><span><strong>{title}</strong><small>{note}</small></span></label>)}</fieldset>
      <fieldset className="admin-quantity-fields" disabled={locked}><legend className="sr-only">设置数量</legend>{groups.map(group => <label className="admin-field" key={group.condition}>{group.condition === 'neutral' ? 'Neutral' : 'Goal'} 测试码数量<input type="number" min={1} max={1000} step={1} required value={Number.isNaN(group.count) ? '' : group.count} onChange={e => group.condition === 'neutral' ? setNeutral(e.target.valueAsNumber) : setGoal(e.target.valueAsNumber)} /></label>)}{!mode && <p className="admin-caption">先选择实验条件，再设置数量。</p>}</fieldset>
      <div className="admin-quantity-presets"><span>每组选用</span>{[10, 20, 50, 100].map(n => <button type="button" className="admin-preset" key={n} disabled={locked || !mode} onClick={() => { setNeutral(n); setGoal(n); }}>{n} 个</button>)}<small>单批合计最多 1000 个</small></div>
    </Panel>
    <Panel title="模型选择" subtitle="可选；同批次的全部参与者和任务使用同一份模型配置。"><fieldset className="admin-settings-fields" disabled={locked}>
      <label className="admin-field">本批模型<select value={modelId} onChange={event => setModelId(event.target.value)}>
        <option value="">不使用模型 · 确定性开发回复</option>
        {modelId && !selectedModel && <option value={modelId}>所选模型已移除，请重新选择</option>}
        {availableModels.map(model => <option key={model.id} value={model.id} disabled={!model.configured}>{model.label} · {model.modelName || '未填写模型名'}{model.runtimeReady ? '（Advisor 已验证）' : model.configured ? '（待 Advisor 验证）' : '（配置未完整）'}</option>)}
      </select><small>{availableModels.length ? '模型连接在设置中维护；发放后使用冻结的配置版本。' : '尚无模型连接，可在设置中添加；不影响确定性发码。'}</small></label>
      <a className="admin-link-button" href="#settings">管理可选模型 →</a>
      {modelId && <div className="admin-info">仅使用现有案例与本地材料；通过 Advisor 验证后可发放新批次。累计模型费用上限 $1。</div>}
    </fieldset></Panel>
    <Panel title="任务安排" subtitle="每个测试码都包含所选任务。" action={<div className="admin-actions"><button className="admin-link-button" type="button" disabled={locked} onClick={() => setSelected(resource.value!.tasks.filter(t => t.enabled).map(t => t.taskCode))}>全选</button><button className="admin-link-button" type="button" disabled={locked || !selected.length} onClick={() => setSelected([])}>清空</button></div>}>
      <fieldset className="admin-task-picker" disabled={locked}><legend className="sr-only">选择发放任务</legend>{resource.value.tasks.filter(t => t.enabled).map(task => <label key={task.taskCode} className={selected.includes(task.taskCode) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(task.taskCode)} onChange={e => setSelected(prev => e.target.checked ? [...prev, task.taskCode] : prev.filter(id => id !== task.taskCode))} /><span>{task.caseId.padStart(2, '0')}</span></label>)}</fieldset>
      <div className="admin-panel-note">已选 {selected.length} 项 · 每人使用相同任务安排</div>
    </Panel>
    <Panel title="其他设置" subtitle="可保留默认值，直接生成。"><fieldset className="admin-form-grid" disabled={locked}>
      <label className="admin-field">批次名称<input maxLength={128} value={batch} placeholder="留空自动命名，便于整批检索" onChange={e => setBatch(e.target.value)} /></label>
      <label className="admin-field">对话最大轮数<input type="number" min={3} max={100} step={1} required value={Number.isNaN(maximum) ? '' : maximum} onChange={e => setMaximum(e.target.valueAsNumber)} /><small>最少 3 轮，默认上限 20 轮</small></label>
      <label className="admin-field">访问到期时间（北京时间）<input type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)} /><small>固定按北京时间 UTC+8；留空则不限期</small></label>
    </fieldset></Panel>
  </div><aside className="admin-issue-summary"><Panel title="本批发放汇总" subtitle="实时更新；确认下方内容后直接生成。">
    <div className="admin-total"><strong>{total}</strong><span>个测试码</span></div>
    <KeyValues rows={[
      ['实验条件', groups.length ? groups.map(g => `${g.condition === 'neutral' ? 'Neutral' : 'Goal'} ${Number.isFinite(g.count) ? g.count : 0} 人`).join(' / ') : '请选择'],
      ['本批模型', selectedModel?.label || (modelId ? '所选模型已移除' : '不使用模型')], ['运行方式', modelId ? '真实 Advisor · 本地材料' : '确定性开发回复'],
      ['每人任务', `${selected.length} 项`], ['任务分配总数', `${total * selected.length} 项`], ['对话轮数', `3–${Number.isFinite(maximum) ? maximum : '…'} 轮`],
      ['批次', batch.trim() || '生成时自动命名'], ['到期（北京时间）', expiry ? date(beijingInstant(expiry)) : '不限期'],
    ]} />
    <BudgetEstimate modelId={modelId} taskCount={total * selected.length} onResult={setBudgetCheck} />
    <button className="admin-button primary admin-full-width" type="submit" disabled={busy || (!command && (!valid || (!!selectedModel?.runtimeReady && budgetCheck?.canIssue === false)))}>{busy ? (modelId && !selectedModel?.runtimeReady ? '正在冻结预览…' : '正在生成…') : command ? (command.configRef ? '重试同一发放请求' : '重试预览') : modelId && !selectedModel?.runtimeReady ? '预览模型安排' : `生成 ${total} 个测试码`}</button>
    {preview && <div className="admin-preview-result" role="status"><strong>模型安排已冻结</strong><p>{preview.readinessMessage}</p><p>{preview.model?.label} · {preview.model?.modelName}</p><details className="admin-technical"><summary>配置版本</summary><code>{preview.configRef}</code></details></div>}
    {error && <div className="admin-error admin-issue-error" role="alert">{error}{command && <p>请求编号已保留，重试不会重复生成。</p>}</div>}
    <p className="admin-caption admin-after-button">{modelId && !selectedModel?.runtimeReady ? '尚未通过 Advisor 验证；当前仅生成预览。' : '生成后可随时查看、复制或导出，也可继续生成下一批。'}</p>
    <div className="admin-runtime-note">{modelId ? '真实 Advisor · 本地材料联调' : '确定性开发回复'}<br />中途 Probe 与额外后测问卷关闭</div>
  </Panel></aside></form>;
}
