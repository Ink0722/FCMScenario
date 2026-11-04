import { useEffect, useState, type FormEvent } from 'react';
import { AdminError, api, errorText } from './api';
import type { ModelBudget, ModelProbeRecord, ModelProbeResult, ProbeHistory } from './types';
import { date, Dialog, Empty, Loading, Panel, useResource } from './shared';
import { useUnsavedChanges } from './unsaved';

export const BUDGET_CHANGED = 'fcm-model-budget-changed';
export const BUDGET_SNAPSHOT = 'fcm-model-budget-snapshot';
export function announceBudget(budget: ModelBudget) { window.dispatchEvent(new CustomEvent(BUDGET_CHANGED, { detail: budget })); }
const money = (value: number) => `$${value.toFixed(6)}`;
const states: Record<string, string> = { running: '结果待确认', succeeded: '调用成功', interrupted: '调用中断', failed: '调用未通过', uncertain: '结果 / 用量未确认', reconciled: '费用已人工核对' };
const failures: Record<string, string> = { authentication: '认证失败', rate_limit: '请求受限', provider_error: '供应商错误', timeout: '请求超时', transport: '连接失败', invalid_response: '响应格式异常' };
interface Reconciliation {
  requestId: string; inputTokens: number; outputTokens: number; providerReference: string; evidence: string; verifiedCompleted: true;
}
function ReconcileForm({ record, onClose, onSaved }: { record: ModelProbeRecord; onClose: () => void; onSaved: () => void }) {
  const [input, setInput] = useState(''); const [output, setOutput] = useState('');
  const [reference, setReference] = useState(''); const [evidence, setEvidence] = useState(''); const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [command, setCommand] = useState<Reconciliation>();
  const locked = busy || !!command;
  useUnsavedChanges(!!input || !!output || !!reference || !!evidence || !!command);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const request = command ?? { requestId: crypto.randomUUID(), inputTokens: Number(input), outputTokens: Number(output),
      providerReference: reference.trim(), evidence: evidence.trim(), verifiedCompleted: true as const };
    setCommand(request);
    try {
      const value = await api<ModelProbeResult>(`/models/probes/${record.jobId}/reconcile`, request);
      announceBudget(value.budget); onSaved();
    } catch (reason) {
      setError(errorText(reason));
      if (reason instanceof AdminError && reason.status >= 400 && reason.status < 500) setCommand(undefined);
    } finally { setBusy(false); }
  }
  return <Dialog title="核对请求费用" onClose={() => { if (!busy) onClose(); }}><form onSubmit={submit}>
    <p className="admin-caption">仅在供应商确认请求已经结束后，填写该请求的实际 Token 用量。核对会保留原始记录和依据；累计上限仍为 $1。</p>
    <p className="admin-caption">本次预占 {money(record.costUsd)} · 请求 {record.providerRequestId || record.jobId}</p>
    <fieldset className="admin-reconcile-fields" disabled={locked}>
      <label className="admin-field">输入 Token<input type="number" required min={0} max={400000} step={1} value={input} onChange={event => setInput(event.target.value)} /></label>
      <label className="admin-field">输出 Token（含推理）<input type="number" required min={0} max={record.outputTokenLimit ?? 128} step={1} value={output} onChange={event => setOutput(event.target.value)} /></label>
      <label className="admin-field admin-span-all">供应商记录 / 工单编号<input required minLength={6} maxLength={256} value={reference} onChange={event => setReference(event.target.value)} /></label>
      <label className="admin-field admin-span-all">核对依据<textarea required minLength={20} maxLength={2000} value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="填写供应商确认时间、结果与用量依据，至少 20 字。未计费也须有供应商确认。" /></label>
      <label className="admin-clear-key admin-span-all"><input type="checkbox" required checked={verified} onChange={event => setVerified(event.target.checked)} />我已确认请求结束，并核实以上用量。</label>
    </fieldset>
    {error && <div className="admin-error" role="alert">{error}{command && <p>重试将沿用原请求编号。</p>}</div>}
    <div className="admin-dialog-actions"><button className="admin-button" type="button" disabled={busy} onClick={onClose}>返回</button><button className="admin-button primary" type="submit" disabled={busy || (!command && !verified)}>{busy ? '正在核对…' : command ? '重试同一核对' : '确认核对并结算'}</button></div>
  </form></Dialog>;
}

export function ModelHistory({ revision }: { revision: number }) {
  const [page, setPage] = useState(1); const [refresh, setRefresh] = useState(0); const [selected, setSelected] = useState<ModelProbeRecord>();
  const [notice, setNotice] = useState('');
  const resource = useResource<ProbeHistory>(`/models/probes?page=${page}&pageSize=10`, revision + refresh, true);
  useEffect(() => {
    if (resource.value) window.dispatchEvent(new CustomEvent(BUDGET_SNAPSHOT, { detail: resource.value.budget }));
  }, [resource.value]);
  useEffect(() => {
    const update = () => setRefresh(value => value + 1);
    window.addEventListener(BUDGET_CHANGED, update);
    const timer = setInterval(update, 15_000);
    return () => { window.removeEventListener(BUDGET_CHANGED, update); clearInterval(timer); };
  }, []);
  return <Panel title="模型调用与验证记录" subtitle="刷新页面后仍可查询。用量不明的请求保留预占；登记满 5 分钟后可凭供应商记录核对。" action={<button className="admin-link-button" type="button" onClick={resource.reload}>刷新验证记录</button>}>
    {notice && <div className="admin-info" role="status">{notice}</div>}
    {resource.error && resource.value && <div className="admin-error" role="alert">最新验证记录读取失败：{resource.error}<button className="admin-link-button" type="button" onClick={resource.reload}>重试读取</button></div>}
    {!resource.value ? <Loading error={resource.error} retry={resource.reload} /> : <>{resource.value.items.length ? <div className="admin-table-scroll"><table><thead><tr><th>时间（北京时间）</th><th>模型</th><th>结果</th><th>用量 / 费用</th><th>详情与核对</th></tr></thead><tbody>{resource.value.items.map(record => <tr key={record.jobId}>
      <td className="admin-date-cell">{date(record.createdAt)}</td><td>{record.modelLabel}<small className="admin-table-secondary">{record.modelName}</small></td>
      <td>{states[record.status] || record.status}<small className="admin-table-secondary">{record.failureKind ? failures[record.failureKind] || record.failureKind : ''}{record.httpStatus ? ` HTTP ${record.httpStatus}` : ''}</small></td>
      <td>{record.costStatus === 'settled' ? '已结算' : '预占'} {money(record.costUsd)}<small className="admin-table-secondary">{record.usage ? `输入 ${record.usage.inputTokens} / 输出 ${record.usage.outputTokens}` : '用量待供应商确认'}</small></td>
      <td><details className="admin-history-details"><summary>查看记录</summary><p>{record.message}</p><p>本地请求：<code>{record.jobId}</code></p><p>供应商请求：<code>{record.providerRequestId || '未收到'}</code></p><p>响应：<code>{record.providerResponseId || '未收到'}</code></p>{record.reconciliation && <><p>核对编号：{record.reconciliation.providerReference}</p><p>{record.reconciliation.evidence}</p><p>核对时间：{date(record.reconciliation.reconciledAt)}</p></>}</details>{record.canReconcile && <button className="admin-link-button" type="button" onClick={() => setSelected(record)}>核对费用</button>}</td>
    </tr>)}</tbody></table></div> : <Empty>尚无模型调用。保存配置不会产生请求记录或费用。</Empty>}
      <div className="admin-pagination"><span>累计 {resource.value.total} 次请求 · 预占 {money(resource.value.budget.reservedUsd)} · 已结算 {money(resource.value.budget.spentUsd)}</span><div className="admin-actions"><button className="admin-button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page} / {Math.max(1, Math.ceil(resource.value.total / 10))}</span><button className="admin-button" disabled={page * 10 >= resource.value.total} onClick={() => setPage(value => value + 1)}>下一页</button></div></div>
    </>}
    {selected && <ReconcileForm record={selected} onClose={() => setSelected(undefined)} onSaved={() => { setSelected(undefined); setNotice('该请求的费用已核对，原始请求和核对依据均已保留。'); resource.reload(); }} />}
  </Panel>;
}
