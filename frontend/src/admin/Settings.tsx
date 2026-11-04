import { useEffect, useState, type FormEvent } from 'react';
import { AdminError, api, errorText } from './api';
import type { EnvironmentConfig, ModelBudget, ModelProbeResult, ModelProfile } from './types';
import { date, KeyValues, Loading, Panel, useResource } from './shared';
import { WorkerMonitor } from './shared';
import { useUnsavedChanges } from './unsaved';
import { announceBudget, BUDGET_CHANGED, BUDGET_SNAPSHOT, ModelHistory } from './ModelHistory';
import { AdvisorValidation } from './AdvisorValidation';

interface SaveRequest {
  requestId: string; revision: number; environmentName: string; notes: string;
  models: { id: string; label: string; baseUrl: string; modelName: string; apiKey: string | null; clearApiKey: boolean }[];
}
interface ModelDraft extends ModelProfile { apiKey: string; clearApiKey: boolean; showKey: boolean }
const money = (value: number) => `$${value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.00')}`;
function ConnectionProbe({ model, dirty, disabled, budget, onBudget }: {
  model: ModelProfile | undefined; dirty: boolean; disabled: boolean; budget: ModelBudget; onBudget: (budget: ModelBudget) => void;
}) {
  const [command, setCommand] = useState<{ requestId: string; modelId: string }>();
  const [busy, setBusy] = useState(false); const [result, setResult] = useState<ModelProbeResult>(); const [error, setError] = useState('');
  if (!model?.probeSupported) return null;
  async function probe() {
    if (!model) return;
    const request = command ?? { requestId: crypto.randomUUID(), modelId: model.id };
    setCommand(request); setBusy(true); setError('');
    try {
      const value = await api<ModelProbeResult>('/models/probe', request);
      setResult(value); onBudget(value.budget); announceBudget(value.budget);
      if (value.status === 'succeeded' || value.status === 'failed') setCommand(undefined);
    } catch (reason) {
      setError(errorText(reason));
      if (reason instanceof AdminError && reason.status >= 400 && reason.status < 500) setCommand(undefined);
    } finally { setBusy(false); }
  }
  return <div className="admin-settings-note admin-model-probe">
    <p>保存 API Key 后可验证连接。仅发送固定测试短句，使用下方累计额度。</p>
    <button className="admin-button" type="button" disabled={disabled || busy || dirty || !model.hasApiKey || (!command && !budget.canRequest)} onClick={probe}>
      {busy ? '正在验证…' : command ? '查看本次验证结果' : '验证连接（消耗少量额度）'}
    </button>
    {dirty && <p>请先保存模型配置。</p>}
    {!model.hasApiKey && <p>请在上方 API Key 栏填写密钥并保存设置。</p>}
    {!budget.canRequest && !command && <p>剩余额度不足，已停止新调用。</p>}
    {result && <div role="status"><p>{result.message}</p>{result.responseText && <p>{result.responseText}</p>}<p>{result.costStatus === 'settled' ? '本次计费上界' : '本次预占'}：{money(result.costUsd)}</p></div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
function EnvironmentForm({ settings, onSaved, reload, initialModelId }: {
  settings: EnvironmentConfig; onSaved: (value: EnvironmentConfig, modelId: string) => void; reload: () => void; initialModelId: string;
}) {
  const [name, setName] = useState(settings.environmentName); const [notes, setNotes] = useState(settings.notes);
  const [models, setModels] = useState<ModelDraft[]>(() => (settings.models ?? []).map(model => ({ ...model, apiKey: '', clearApiKey: false, showKey: false })));
  const [activeId, setActiveId] = useState(initialModelId || settings.models?.[0]?.id || '');
  const active = models.find(model => model.id === activeId) ?? models[0];
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState(settings.modelBudget);
  useEffect(() => {
    const update = (event: Event) => setBudget((event as CustomEvent<ModelBudget>).detail);
    window.addEventListener(BUDGET_CHANGED, update);
    window.addEventListener(BUDGET_SNAPSHOT, update);
    return () => { window.removeEventListener(BUDGET_CHANGED, update); window.removeEventListener(BUDGET_SNAPSHOT, update); };
  }, []);
  const savedActive = settings.models.find(model => model.id === active?.id);
  const dirty = name !== settings.environmentName || notes !== settings.notes || models.length !== settings.models.length ||
    models.some(model => { const original = settings.models.find(value => value.id === model.id); return !original || !!model.apiKey || model.clearApiKey ||
      model.label !== original.label || model.baseUrl !== original.baseUrl || model.modelName !== original.modelName; });
  useUnsavedChanges(dirty);
  const modelDirty = !!active && (!savedActive || !!active.apiKey || active.clearApiKey ||
    ['label', 'baseUrl', 'modelName'].some(key => active[key as keyof ModelProfile] !== savedActive[key as keyof ModelProfile]));
  function patchModel(changes: Partial<ModelDraft>) {
    setModels(previous => previous.map(model => model.id === active?.id ? { ...model, ...changes } : model));
  }
  function addModel() {
    const id = crypto.randomUUID();
    setModels(previous => [...previous, { id, label: `模型 ${previous.length + 1}`, baseUrl: '', modelName: '', hasApiKey: false,
      configured: false, runtimeReady: false, probeSupported: false, apiKey: '', clearApiKey: false, showKey: false }]);
    setActiveId(id);
  }
  const [command, setCommand] = useState<SaveRequest>(); const [error, setError] = useState('');
  const locked = busy || !!command;
  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    if (models.some(model => !model.label.trim())) { setError('请填写每个模型的显示名称。'); return; }
    setBusy(true);
    const request = command ?? { requestId: crypto.randomUUID(), revision: settings.revision,
      environmentName: name, notes, models: models.map(model => ({ id: model.id, label: model.label, baseUrl: model.baseUrl, modelName: model.modelName, apiKey: model.apiKey.trim() || null, clearApiKey: model.clearApiKey })) };
    setCommand(request);
    try {
      const value = await api<EnvironmentConfig>('/settings', request);
      setModels(previous => previous.map(model => ({ ...model, apiKey: '', showKey: false }))); setCommand(undefined); onSaved(value, active?.id ?? '');
    } catch (reason) {
      setError(errorText(reason));
      if (reason instanceof AdminError && reason.status >= 400 && reason.status < 500) setCommand(undefined);
    } finally { setBusy(false); }
  }
  const runtime = settings.runtime;
  return <form className="admin-settings-layout" onSubmit={save}><div className="admin-stack">
    <Panel title="环境信息" subtitle="当前部署的名称与维护备注。"><fieldset className="admin-settings-fields admin-environment-fields" disabled={locked}>
      <label className="admin-field">环境名称<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="例如：本地测试、Pilot 环境" /></label>
      <label className="admin-field">环境备注<textarea aria-label="环境备注" rows={2} maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="用途、配置说明或其他维护信息" /></label>
    </fieldset></Panel>
    <Panel title="可选模型" subtitle="发码时可整批选择，也可不选模型。"><fieldset className="admin-settings-fields" disabled={locked}>
      <div className="admin-model-toolbar">{models.length > 0 && <label className="admin-field">当前编辑的模型<select value={active?.id ?? ''} onChange={event => setActiveId(event.target.value)}>{models.map(model => <option key={model.id} value={model.id}>{model.label || '未命名模型'}</option>)}</select></label>}<button className="admin-button" type="button" disabled={locked || models.length >= 50} onClick={addModel}>＋ 添加模型</button></div>
      {active ? <div className="admin-model-editor" key={active.id}>
        <div className="admin-model-editor-heading"><span>连接配置</span><button className="admin-link-button" type="button" disabled={locked} onClick={() => { setModels(previous => previous.filter(model => model.id !== active.id)); setActiveId(''); }}>移除此模型</button></div>
        <label className="admin-field">显示名称<input required maxLength={80} value={active.label} onChange={event => patchModel({ label: event.target.value })} placeholder="例如：主实验模型、对照模型" /></label>
        <label className="admin-field">接口地址（Base URL）<input type="url" maxLength={2048} value={active.baseUrl} onChange={event => patchModel({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" autoComplete="off" /></label>
        <label className="admin-field">模型名<input maxLength={128} value={active.modelName} onChange={event => patchModel({ modelName: event.target.value })} placeholder="填写服务提供方的模型标识" autoComplete="off" /></label>
        <label className="admin-field">API Key<span className="admin-key-input"><input aria-label="API Key" type={active.showKey ? 'text' : 'password'} maxLength={8192} value={active.apiKey} disabled={active.clearApiKey} onChange={event => patchModel({ apiKey: event.target.value })} autoComplete="new-password" placeholder={active.hasApiKey ? '已保存；留空保留，填写可替换' : '尚未设置'} /><button className="admin-link-button" type="button" disabled={locked || !active.apiKey} onClick={() => patchModel({ showKey: !active.showKey })}>{active.showKey ? '隐藏' : '显示'}</button></span><small>{active.hasApiKey ? '当前 API Key 已保存。页面不回显已保存的密钥。' : '当前未保存 API Key。'}</small></label>
        {active.hasApiKey && <label className="admin-clear-key"><input type="checkbox" checked={active.clearApiKey} onChange={event => patchModel({ clearApiKey: event.target.checked, ...(event.target.checked ? { apiKey: '' } : {}) })} />删除已保存的 API Key</label>}
      </div> : <div className="admin-model-empty">尚未添加模型。不使用模型时，可直接使用确定性开发回复。</div>}
    </fieldset><div className="admin-settings-note">保存配置不会发送模型请求。Advisor 验证通过后，可发放本地材料联调批次；不选模型仍使用确定性回复。</div>
    <AdvisorValidation key={`advisor-${active?.id ?? ''}`} model={savedActive} dirty={modelDirty} disabled={locked} onVerified={reload} />
    <ConnectionProbe key={active?.id ?? ''} model={savedActive} dirty={modelDirty} disabled={locked} budget={budget} onBudget={setBudget} />
    <div className="admin-form-footer"><span className={dirty ? 'admin-unsaved' : 'admin-caption'}>{dirty ? '● 尚未保存' : `最近保存：${date(settings.updatedAt)}`}</span><button className="admin-button primary" type="submit" disabled={busy}>{busy ? '正在保存…' : command ? '重试保存' : '保存设置'}</button></div></Panel>
    {error && <div className="admin-error" role="alert">{error}{command ? <p>请求编号已保留，重试不会重复修改设置。</p> : <button className="admin-link-button" type="button" onClick={reload}>重新读取最新配置</button>}</div>}
  </div><aside className="admin-stack"><Panel title="模型调用额度" subtitle="本部署累计上限，保存设置或重启均不重置。"><KeyValues rows={[
    ['累计上限', money(budget.limitUsd)], ['已结算（按未缓存价格）', money(budget.spentUsd)],
    ['预占 / 待核对', money(budget.reservedUsd)], ['可用额度', money(budget.remainingUsd)], ['已登记请求', budget.requestCount],
  ]} /><p className="admin-caption admin-budget-note">每次调用前预留费用上界，收到用量后结算。超时或结果不明时保留预占，不自动重发。此额度仅覆盖本部署发起的调用。</p></Panel><Panel title="当前运行环境" subtitle="以下信息来自正在运行的服务。"><KeyValues rows={[
    ['API 状态', runtime.apiStatus === 'ready' ? '可用' : runtime.apiStatus],
    ['数据库状态', runtime.databaseStatus === 'ready' ? '已连接' : runtime.databaseStatus],
    ['数据库类型', runtime.databaseEngine === 'sqlite' ? 'SQLite' : runtime.databaseEngine],
    ['运行方式', '按批次选择 · 模型可选'], ['当前模型', runtime.activeModel], ['时间', '北京时间（UTC+8）'],
    ['Python', runtime.pythonVersion], ['FastAPI', runtime.fastapiVersion], ['SQLAlchemy', runtime.sqlalchemyVersion],
  ]} /></Panel><Panel title="对话处理服务"><WorkerMonitor initial={runtime.worker} /></Panel><Panel title="路径与位置"><KeyValues rows={[
    ['数据库位置', <code>{runtime.databaseLocation}</code>], ['工件目录', <code>{runtime.artifactDirectory}</code>], ['研究配置', <code>{runtime.studyFile}</code>],
  ]} /></Panel></aside></form>;
}

export function SettingsPage({ revision, onSaved }: { revision: number; onSaved: () => void }) {
  const resource = useResource<EnvironmentConfig>('/settings', revision, true);
  const [notice, setNotice] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  return <div className="admin-stack">{notice && <div className="admin-info" role="status">{notice}</div>}
    {resource.value ? <EnvironmentForm key={resource.value.revision} settings={resource.value} reload={resource.reload} initialModelId={selectedModelId} onSaved={(value, modelId) => {
      setSelectedModelId(modelId);
      setNotice(`设置已保存 · ${date(value.updatedAt)}（北京时间）`); onSaved();
    }} /> : <Loading error={resource.error} retry={resource.reload} />}
    <ModelHistory revision={revision} />
  </div>;
}
