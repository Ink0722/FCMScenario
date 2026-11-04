import { useEffect, useState } from 'react';
import { AdminError, api, errorText } from './api';
import type { AdvisorValidation as Result, ModelProfile } from './types';
import { announceBudget } from './ModelHistory';

interface Command { modelId: string; requestId: string; jobId?: string; taskCode?: string; condition?: string; targetOptionId?: string; turnCount?: number }
const pending = (value?: Result) => !!value && ['queued', 'running'].includes(value.status);
export function AdvisorValidation({ model, dirty, disabled, onVerified }: {
  model?: ModelProfile; dirty: boolean; disabled: boolean; onVerified: () => void;
}) {
  const storageKey = `fcm-advisor-validation:${model?.id ?? ''}`;
  const [command, setCommand] = useState<Command | undefined>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null') ?? undefined; } catch { return undefined; }
  });
  const [result, setResult] = useState<Result>();
  const [tasks, setTasks] = useState<{ taskCode: string; number: string }[]>([]);
  const [taskCode, setTaskCode] = useState(command?.taskCode || 'task-7k3m');
  const [condition, setCondition] = useState(command?.condition || 'neutral');
  const [target, setTarget] = useState(command?.targetOptionId || 'A');
  const [turnCount, setTurnCount] = useState(command?.turnCount || 1);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { api<{ tasks: { taskCode: string; number: string; enabled: boolean }[] }>('/catalog').then(value => setTasks(value.tasks.filter(task => task.enabled))).catch(() => {}); }, []);
  function save(value: Command) { setCommand(value); localStorage.setItem(storageKey, JSON.stringify(value)); }
  function received(value: Result) {
    setResult(value); announceBudget(value.budget);
    if (value.status === 'succeeded' && !model?.runtimeReady) onVerified();
  }
  useEffect(() => {
    if (!command?.jobId || (result && !pending(result))) return;
    let mounted = true;
    async function poll() {
      try {
        const value = await api<Result>(`/models/advisor-validations/${command!.jobId}`);
        if (mounted) { received(value); setError(''); }
      } catch (reason) { if (mounted) setError(errorText(reason)); }
    }
    void poll();
    const timer = setInterval(poll, 2000);
    return () => { mounted = false; clearInterval(timer); };
  }, [command?.jobId, result?.status]);
  if (!model?.probeSupported) return null;
  async function run() {
    if (!model) return;
    // Keep an uncertain submission's request ID across refreshes. A completed
    // validation can only be run again through an explicit button click.
    const request = command && (!result || pending(result)) ? command : { modelId: model.id, requestId: crypto.randomUUID(), taskCode, condition, targetOptionId: target, turnCount };
    save(request); setBusy(true); setError('');
    try {
      const { jobId, ...payload } = request;
      const value = await api<Result>('/models/validate-advisor', payload);
      save({ ...request, jobId: value.jobId }); received(value);
    } catch (reason) {
      setError(errorText(reason));
      if (reason instanceof AdminError && reason.status >= 400 && reason.status < 500) {
        setCommand(undefined); localStorage.removeItem(storageKey);
      }
    } finally { setBusy(false); }
  }
  return <div className="admin-settings-note admin-model-probe">
    <p><strong>真实 Advisor · 本地材料联调</strong>　{model.runtimeReady ? '已通过验证' : '尚未通过验证'}</p>
    <p>独立验收 PDF 读取、策略提交和流式回复。消耗累计 $1 额度；通过后须创建新预览。连接验证通过不代表所有案例已验收。</p>
    <fieldset className="admin-form-grid" disabled={disabled || dirty || busy || pending(result) || (!!command && !result)}>
      <label className="admin-field">验收案例<select value={taskCode} onChange={e => setTaskCode(e.target.value)}>{tasks.length ? tasks.map(task => <option key={task.taskCode} value={task.taskCode}>{task.number}</option>) : <option value="task-7k3m">01</option>}</select></label>
      <label className="admin-field">验收条件<select value={condition} onChange={e => setCondition(e.target.value)}><option value="neutral">Neutral</option><option value="goal">Goal</option></select></label>
      {condition === 'goal' && <label className="admin-field">验收目标<select value={target} onChange={e => setTarget(e.target.value)}><option>A</option><option>B</option></select></label>}
      <label className="admin-field">连续对话轮数<select value={turnCount} onChange={e => setTurnCount(Number(e.target.value))}><option value={1}>1 轮</option><option value={3}>3 轮</option></select></label>
    </fieldset>
    <button type="button" className="admin-button" disabled={disabled || dirty || busy || !model.hasApiKey || pending(result)} onClick={run}>
      {busy ? '正在提交…' : pending(result) ? '验证处理中…' : command && !result ? '查询同一次 Advisor 验证' : model.runtimeReady ? '重新验证 Advisor（消耗额度）' : '验证 Advisor（消耗额度）'}
    </button>
    {dirty && <p>请先保存模型配置。</p>}
    {result && <div role="status"><p>{result.message}</p>{result.caseId && <p>Case {result.caseId} · {result.condition}{result.targetOptionId ? ` → ${result.targetOptionId}` : ''} · 已完成 {result.completedTurns ?? 0} / {result.turnCount ?? 1} 轮</p>}<p>{result.modelCalls.length} 次模型调用 · {result.toolCalls.length} 次工具调用{result.selectedStrategy ? ` · 策略 ${result.selectedStrategy.strategy_id}` : ''}</p>
      {result.responseText && <details><summary>查看验证回复</summary><p>{result.responseText}</p></details>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
