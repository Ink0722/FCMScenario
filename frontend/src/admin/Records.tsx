import { ExecutionRecord } from './ExecutionRecord';
import { useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, errorText } from './api';
import type { SaveCodes } from './App';
import type { Attempt, Measurement, Overview, ParticipantDetail, ParticipantPage as Page, ParticipantRow, TaskDetail } from './types';
import { Badge, date, Dialog, Empty, KeyValues, labels, Loading, Panel, short, TestCode, useResource, WorkerMonitor } from './shared';

function ParticipantTable({ rows }: { rows: ParticipantRow[] }) {
  return <div className="admin-table-scroll"><table><thead><tr><th>参与者</th><th>测试码</th><th>实验条件</th><th>Profile</th><th>任务进度</th><th>状态</th><th>批次</th><th>发放时间</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{rows.map(row => <tr key={row.participantId}><td><a className="admin-record-link" href={`#participant/${row.participantId}`}>{row.codeDisplay}</a></td><td><TestCode value={row.testCode} /></td><td><Badge value={row.condition} /></td><td><span className={row.profileStatus === 'submitted' ? 'admin-text-success' : 'admin-muted'}>{row.profileStatus === 'submitted' ? '已提交' : '未填写'}</span></td><td><div className="admin-task-progress"><span>{row.completedTasks} <small>/ {row.taskCount}</small></span><progress value={row.completedTasks} max={row.taskCount || 1} aria-label={`${row.completedTasks} / ${row.taskCount} 项任务已完成`} /></div></td><td><Badge value={row.status} /></td><td className="admin-batch-cell">{row.batchId || '—'}</td><td className="admin-date-cell">{date(row.assignedAt)}</td><td><a href={`#participant/${row.participantId}`} aria-label={`查看 ${row.codeDisplay}`}>查看 ↗</a></td></tr>)}</tbody></table></div>;
}
export function OverviewPage({ revision }: { revision: number }) {
  const resource = useResource<Overview>('/overview', revision);
  const recent = useResource<Page>('/participants?pageSize=10', revision);
  if (!resource.value) return <Loading error={resource.error} retry={resource.reload} />;
  const data = resource.value; const total = Object.values(data.participants).reduce((sum, n) => sum + n, 0);
  const cards = [['已发放参与者', total, '包含取消与过期的全部记录'], ['待开始', data.participants.pending, '已发码，尚未兑换访问权限'], ['进行中', data.participants.in_progress, '已进入实验，尚未全部完成'], ['已完成', data.participants.completed, '已完成全部分配任务']] as const;
  return <div className="admin-stack"><WorkerMonitor initial={data.worker} />
    <div className="admin-stats">{cards.map(([label, value, note]) => <section key={label}><span>{label}</span><strong>{value.toLocaleString()}</strong><p>{note}</p></section>)}</div>
    <Panel title="最近参与记录" subtitle="按发放时间排列，查看当前进度。" action={<a className="admin-link-button" href="#participants">全部记录 →</a>}>{recent.value ? recent.value.items.length ? <ParticipantTable rows={recent.value.items} /> : <Empty>还没有参与记录。<a href="#issue">发放第一批测试码 →</a></Empty> : <Loading error={recent.error} retry={recent.reload} />}</Panel>
    <div className="admin-two-columns"><Panel title="运行状态"><KeyValues rows={[
      ['当前运行方式', '按批次选择 · 模型可选'], ['排队中的回复', data.jobs.queued ?? 0], ['正在生成的回复', data.jobs.running ?? 0],
      ['已完成任务', data.tasks.completed ?? 0], ['已取消 / 已过期参与者', `${data.participants.cancelled} / ${data.participants.expired}`],
    ]} /></Panel><Panel title="当前实验流程"><ol className="admin-flow-list"><li><b>01</b><div><strong>背景信息与初始判断</strong><p>填写 Profile，记录选择与信心度。</p></div></li><li><b>02</b><div><strong>与 Advisor 对话</strong><p>至少 3 轮，默认最多 20 轮。</p></div></li><li><b>03</b><div><strong>最终判断与完成</strong><p>保留 A/B 选择与信心度，无额外后测问卷。</p></div></li></ol></Panel></div>
  </div>;
}

export function ParticipantsPage({ revision, initialBatch = '', configRef = '', unnamed = false }: { revision: number; initialBatch?: string; configRef?: string; unnamed?: boolean }) {
  const [status, setStatus] = useState(''); const [condition, setCondition] = useState('');
  const [batch, setBatch] = useState(initialBatch); const [query, setQuery] = useState('');
  const scope = `${configRef ? `&configRef=${encodeURIComponent(configRef)}` : ''}${unnamed ? '&unnamed=true' : ''}`;
  const [filters, setFilters] = useState((initialBatch ? `&batch=${encodeURIComponent(initialBatch)}` : '') + scope); const [page, setPage] = useState(1);
  const resource = useResource<Page>(`/participants?page=${page}&pageSize=20${filters}`, revision);
  const overview = useResource<Overview>('/overview', revision);
  function filter(event: FormEvent) {
    event.preventDefault(); const params = new URLSearchParams();
    if (status) params.set('status', status); if (condition) params.set('condition', condition);
    if (batch) params.set('batch', batch); if (query.trim()) params.set('q', query.trim());
    setFilters((params.size ? '&' + params.toString() : '') + scope); setPage(1);
  }
  function reset() { setStatus(''); setCondition(''); setBatch(''); setQuery(''); setFilters(scope); setPage(1); }
  return <Panel title="全部参与者" subtitle="测试码可随时查看、复制；支持按批次筛选并整批导出。" action={<div className="admin-actions"><a className="admin-button" href={`/api/v1/admin/codes/export?${filters.replace(/^&/, '')}`} download>导出筛选结果</a><a className="admin-button" href={`/api/v1/admin/research/export?${filters.replace(/^&/, '')}`} download>导出研究数据 ZIP</a><a className="admin-button primary" href="#issue">＋ 发放测试码</a></div>}>
    {configRef && <div className="admin-scope-note">限定配置 {configRef.slice(0, 8)}{unnamed ? ' · 未命名批次' : ''}<a href="#participants">查看全部参与记录 →</a></div>}
    <form className="admin-filters" onSubmit={filter}><label className="admin-field">参与者编号或测试码<input placeholder="输入编号或完整测试码" value={query} onChange={e => setQuery(e.target.value)} maxLength={128} /></label><label className="admin-field">状态<select value={status} onChange={e => setStatus(e.target.value)}><option value="">全部状态</option>{['pending', 'in_progress', 'completed', 'cancelled', 'expired'].map(s => <option key={s} value={s}>{labels[s]}</option>)}</select></label><label className="admin-field">实验条件<select value={condition} onChange={e => setCondition(e.target.value)}><option value="">全部条件</option><option value="neutral">Neutral</option><option value="goal">Goal</option></select></label><label className="admin-field">批次<select value={batch} disabled={unnamed} onChange={e => setBatch(e.target.value)}><option value="">{unnamed ? '未命名批次' : '全部批次'}</option>{overview.value?.batches.map(b => <option key={b} value={b}>{b}</option>)}</select></label><button className="admin-button primary" type="submit">筛选</button><button className="admin-link-button" type="button" onClick={reset}>重置</button></form>
    {!resource.value ? <Loading error={resource.error} retry={resource.reload} /> : <>{resource.value.items.length ? <ParticipantTable rows={resource.value.items} /> : <Empty>没有符合条件的参与记录。</Empty>}<div className="admin-pagination"><span>共 {resource.value.total} 条记录 · 每页 20 条</span><div className="admin-actions"><button className="admin-button" disabled={page <= 1} onClick={() => setPage(n => n - 1)}>上一页</button><span>{page} / {Math.max(1, Math.ceil(resource.value.total / 20))}</span><button className="admin-button" disabled={page * 20 >= resource.value.total} onClick={() => setPage(n => n + 1)}>下一页</button></div></div></>}
  </Panel>;
}

export function ParticipantPage({ id, revision, saveCodes, onChanged }: {
  id: string; revision: number; saveCodes: SaveCodes; onChanged: () => void;
}) {
  const resource = useResource<ParticipantDetail>(`/participants/${encodeURIComponent(id)}`, revision);
  const [action, setAction] = useState<{ kind: 'rotate' | 'cancel'; requestId: string }>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  async function confirm() {
    if (!action) return; setBusy(true); setError('');
    try {
      const result = await api<{ participantId: string; code?: string; replayed: boolean }>(`/participants/${encodeURIComponent(id)}/${action.kind}`, { requestId: action.requestId });
      if (result.code) saveCodes([{ participantId: result.participantId, code: result.code, condition: resource.value?.condition, batchId: resource.value?.batchId }], '换码已完成');
      else { setNotice(action.kind === 'cancel' ? '该参与者的访问已取消，原始记录已保留。' : '该换码请求此前已执行，当前测试码可在访问管理中查看。'); onChanged(); }
      setAction(undefined);
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  if (!resource.value) return <Loading error={resource.error} retry={resource.reload} />;
  const data = resource.value;
  return <div className="admin-stack"><a className="admin-back-link" href="#participants">← 返回参与记录</a>{notice && <div className="admin-info" role="status">{notice}</div>}
    <Panel title={data.codeDisplay} subtitle={data.participantId} action={<Badge value={data.status} />}><div className="admin-detail-overview"><KeyValues rows={[
      ['实验条件', <Badge value={data.condition} />], ['所属批次', data.batchId || '—'], ['发放时间', date(data.assignedAt)], ['首次进入', date(data.startedAt)], ['完成时间', date(data.completedAt)], ['访问到期', date(data.expiresAt)],
    ]} /><div className="admin-access-actions"><h3>访问管理</h3><div className="admin-current-code"><TestCode value={data.testCode} /></div><p>换码保留任务进度和历史记录。旧测试码与已签发的访问凭据会立即失效。</p><div className="admin-actions"><button className="admin-button" disabled={['cancelled', 'expired'].includes(data.status)} onClick={() => { setAction({ kind: 'rotate', requestId: crypto.randomUUID() }); setError(''); }}>换发测试码</button><button className="admin-button danger" disabled={['completed', 'cancelled'].includes(data.status)} onClick={() => { setAction({ kind: 'cancel', requestId: crypto.randomUUID() }); setError(''); }}>取消访问</button></div></div></div></Panel>
    <div className="admin-two-columns"><Panel title="背景问卷 / Profile" subtitle={`${data.profile.submission_status === 'submitted' ? '已提交' : '尚未提交'} · ${date(data.profile.submitted_at)}`}><dl className="admin-profile-answers">{data.questions.map(question => <div key={question.id}><dt>{question.title}</dt><dd>{question.options.find(o => o.value === data.profile.answers?.[question.id])?.label ?? data.profile.answers?.[question.id] ?? '未填写'}</dd></div>)}</dl><details className="admin-technical"><summary>问卷版本</summary><code>{data.profile.instrument_ref}</code></details></Panel>
    <Panel title="冻结配置"><KeyValues rows={[
      ['研究', data.studyId], ['运行方式', data.runtimeMode === 'agent' ? '真实 Advisor · 本地材料' : '确定性开发回复'], ['任务进度', `${data.completedTasks} / ${data.taskCount}`], ['对话策略', `最少 ${data.policy.minimum} 轮，最多 ${data.policy.maximum} 轮`], ['中途 Probe / 额外后测', '关闭'],
    ]} /><details className="admin-technical"><summary>配置版本</summary><code>{data.configRef}</code></details></Panel></div>
    <Panel title="任务与历史尝试" subtitle="退出或取消的尝试同样保留，可进入任务逐一回放。"><div className="admin-table-scroll"><table><thead><tr><th>任务</th><th>状态</th><th>尝试次数</th><th>选项顺序</th><th>开始时间</th><th>完成时间</th><th /></tr></thead><tbody>{data.tasks.map(task => <tr key={task.id}><td><a className="admin-record-link" href={`#task/${task.id}`}>{task.number}</a><span className="admin-task-title">{task.title}</span></td><td><Badge value={task.status} /></td><td>{task.attemptCount}</td><td>{task.optionOrder.join(' → ')}</td><td className="admin-date-cell">{date(task.startedAt)}</td><td className="admin-date-cell">{date(task.completedAt)}</td><td><a href={`#task/${task.id}`}>查看回放 ↗</a></td></tr>)}</tbody></table></div></Panel>
    {action && <Dialog title={action.kind === 'rotate' ? '换发测试码' : '取消参与者访问'} onClose={() => !busy && setAction(undefined)}><p>{action.kind === 'rotate' ? '确认换码后，旧测试码和现有访问凭据将失效。任务进度与历史记录保留，新码会保存在后台，可随时查看。' : '确认取消后，参与者将无法继续实验；未完成的任务及正在进行的尝试会被取消。已保存的数据保留。'}</p>{error && <div className="admin-error" role="alert">{error}<p>重试将使用同一请求编号。</p></div>}<div className="admin-dialog-actions"><button className="admin-button" disabled={busy} onClick={() => setAction(undefined)}>返回</button><button className={`admin-button ${action.kind === 'cancel' ? 'danger' : 'primary'}`} disabled={busy} onClick={confirm}>{busy ? '正在处理…' : action.kind === 'rotate' ? '确认换码' : '确认取消访问'}</button></div></Dialog>}
  </div>;
}

function Text({ text }: { text: string }) {
  return <div className="admin-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt }) => <span>[图片：{alt || '未加载'}]</span>,
  }}>{text}</ReactMarkdown></div>;
}
function Measure({ title, value }: { title: string; value: Measurement }) {
  return <div className="admin-measure"><span className="admin-eyebrow">{title}</span><div>{value.answers ? <><strong>{value.answers.choice}</strong><span>信心度 <b>{value.answers.confidence}</b><small> / 100</small></span></> : <p className="admin-muted">尚未提交</p>}</div><small>{date(value.submitted_at)}</small></div>;
}
function strategyLabel(value: unknown, catalog: { id: string; name: string }[]) {
  const id = value && typeof value === 'object' && 'strategy_id' in value ? String(value.strategy_id) : '';
  return id ? `${id} · ${catalog.find(item => item.id === id)?.name ?? '已记录'}` : '未产生策略选择';
}
function AttemptReplay({ attempt, taskId, catalog }: { attempt: Attempt; taskId: string; catalog: { id: string; name: string }[] }) {
  return <div className="admin-stack"><div className="admin-measure-pair"><Measure title="初始判断" value={attempt.measurements.pre} /><span aria-hidden="true">→</span><Measure title="最终判断" value={attempt.measurements.post} /></div>
    <Panel title="对话记录" subtitle={`${attempt.turns.filter(t => t.status === 'completed').length} 轮已完成 · 保留队列、中断和取消状态`}>
      {!attempt.measurements.pre.answers && <div className="admin-info">该尝试尚未提交初始判断，未进入对话。</div>}
      {attempt.measurements.pre.answers && <div className="admin-message admin-message-assistant"><div className="admin-message-heading"><strong>Advisor</strong><span>预置开场 · {date(attempt.opening.timestamp)}</span></div><Text text={attempt.opening.text} /></div>}
      {attempt.turns.map(turn => <section className="admin-turn" key={turn.turn_id}><div className="admin-turn-heading"><span>第 {turn.turn_no} 轮</span><Badge value={turn.status} /><small>{date(turn.started_at)}</small></div>{turn.messages.map(message => <div className={`admin-message admin-message-${message.role}`} key={message.id}><div className="admin-message-heading"><strong>{labels[message.role] ?? message.role}</strong><span>{date(message.timestamp)}{message.status === 'partial' ? ' · 部分回复' : message.status === 'interrupted' ? ' · 已中断' : ''}</span></div><Text text={message.text || '（尚未生成文本）'} />{message.citations?.length ? <div className="admin-actions">{message.citations.filter(c => c.documentId).map((citation, index) => <a key={index} href={`/api/v1/admin/tasks/${encodeURIComponent(taskId)}/documents/${encodeURIComponent(citation.documentId!)}#page=${citation.page ?? 1}`} target="_blank" rel="noopener noreferrer">{citation.title}</a>)}</div> : null}</div>)}
        <details className="admin-turn-details"><summary>本轮执行记录 · {turn.model_calls.length} 次模型调用 / {turn.tool_calls.length} 次工具调用</summary><KeyValues rows={[
          ['轮次编号', <code>{turn.turn_id}</code>], ['运行方式', turn.execution.runtime_mode], ['策略选择', strategyLabel(turn.selected_strategy, catalog)], ['结束时间', date(turn.finished_at)],
        ]} />{!turn.model_calls.length && !turn.tool_calls.length ? <p className="admin-caption">当前使用确定性开发回复，未调用真实模型或工具。</p> : <ExecutionRecord calls={turn.model_calls} tools={turn.tool_calls} />}</details></section>)}
      {attempt.measurements.pre.answers && !attempt.turns.length && <Empty>尚无对话轮次。</Empty>}
    </Panel>
    <div className="admin-two-columns"><Panel title="尝试信息"><KeyValues rows={[
      ['尝试编号', <code>{attempt.attempt_id}</code>], ['状态 / 阶段', `${labels[attempt.status] ?? attempt.status} / ${labels[attempt.phase] ?? attempt.phase}`], ['开始时间', date(attempt.started_at)], ['结束时间', date(attempt.ended_at)], ['停止原因', attempt.stop_reason ?? '—'], ['事件数量', attempt.events.length], ['完成回执', attempt.receipt || '—'],
    ]} /></Panel><Panel title="原始记录"><p className="admin-muted">保留测量版本、消息、事件与执行轨迹。只读查看当前尝试的已保存数据。</p><details className="admin-raw"><summary>展开当前尝试 JSON</summary><pre>{JSON.stringify(attempt, null, 2)}</pre></details></Panel></div>
  </div>;
}

export function TaskPage({ id, revision }: { id: string; revision: number }) {
  const resource = useResource<TaskDetail>(`/tasks/${encodeURIComponent(id)}`, revision);
  const [selected, setSelected] = useState('');
  if (!resource.value) return <Loading error={resource.error} retry={resource.reload} />;
  const data = resource.value;
  const attempt = data.attempts.find(a => a.attempt_id === selected) ?? data.attempts.at(-1);
  return <div className="admin-stack"><a className="admin-back-link" href={`#participant/${data.participantId}`}>← {data.codeDisplay} / 参与者详情</a>
    <Panel title={`${data.number} · ${data.title}`} subtitle={data.id} action={<Badge value={data.status} />}><div className="admin-task-metadata"><KeyValues rows={[
      ['实验条件', <Badge value={data.condition} />], ['固定选项顺序', data.optionOrder.join(' → ')], ['分配目标', `${data.targetOptionId}${data.condition === 'neutral' ? '（Neutral 条件不使用）' : ''}`], ['对话轮数', `${data.policy.minimum}–${data.policy.maximum} 轮`], ['模型配置', data.modelRef], ['历史尝试', `${data.attempts.length} 次`],
    ]} /></div><details className="admin-technical"><summary>冻结场景与配置</summary><p>配置：<code>{data.configRef}</code></p><p>目标规则：{data.targetRule}</p><pre>{JSON.stringify(data.scenario, null, 2)}</pre></details></Panel>
    <div className="admin-notice"><span className="admin-notice-icon">i</span><p>{data.runtimeMode === 'agent' ? '真实 Advisor · 本地材料联调。' : '确定性开发回复。'}下方仅回放已保存的记录，查看回放不调用模型。</p></div>
    {!attempt ? <Panel title="历史尝试"><Empty>该任务尚未开始，没有可回放的记录。</Empty></Panel> : <><div className="admin-attempt-bar"><div><h2>历史尝试</h2><p>切换查看退出、取消和完成的记录。</p></div><label className="admin-field"><span className="sr-only">选择历史尝试</span><select value={attempt.attempt_id} onChange={e => setSelected(e.target.value)}>{data.attempts.map(a => <option key={a.attempt_id} value={a.attempt_id}>第 {a.attempt_no} 次尝试 · {labels[a.status] ?? a.status} · {short(a.attempt_id)}</option>)}</select></label></div><AttemptReplay key={attempt.attempt_id} attempt={attempt} taskId={data.id} catalog={data.strategyCatalog ?? []} /></>}
  </div>;
}
