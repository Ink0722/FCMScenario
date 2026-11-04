import { BudgetSummary } from './BudgetEstimate';
import { useEffect, useState, type FormEvent } from 'react';
import { AdminError, api, errorText } from './api';
import type { AllocationHistory, AllocationPlan, AllocationRequest, Catalog, Codes, QuotaCheck } from './types';
import { Badge, date, Empty, KeyValues, Loading, Panel, TestCode, useResource } from './shared';
import { beijingInstant } from './time';
import { useUnsavedChanges } from './unsaved';

function NewAllocation({ revision, onOpen, source }: { revision: number; onOpen: (ref: string) => void; source?: AllocationPlan }) {
  const resource = useResource<Catalog>('/catalog', revision);
  const [quotas, setQuotas] = useState<Record<string, { neutral: number; goal: number }>>(() => Object.fromEntries(source?.quotas.map(q => [q.caseId, { neutral: q.neutral, goal: q.goal }]) ?? []));
  const [perPerson, setPerPerson] = useState(source?.tasksPerPerson ?? 4); const [maxTurns, setMaxTurns] = useState(source?.maxTurns ?? 20);
  const [modelId, setModelId] = useState(source?.model ? '__confirm__' : ''); const [batch, setBatch] = useState(source ? `${source.batchId} 副本`.slice(0, 128) : ''); const [expiry, setExpiry] = useState(''); const [seed, setSeed] = useState('');
  const [fillNeutral, setFillNeutral] = useState(20); const [fillGoal, setFillGoal] = useState(20);
  const [busy, setBusy] = useState(false); const [command, setCommand] = useState<AllocationRequest>(); const [error, setError] = useState('');
  const [savedRef, setSavedRef] = useState('');
  const dirty = Object.values(quotas).some(value => value.neutral || value.goal) || perPerson !== 4 || maxTurns !== 20 || !!modelId || !!batch || !!expiry || !!seed;
  useUnsavedChanges(!!dirty && !savedRef);
  useEffect(() => { if (savedRef) onOpen(savedRef); }, [savedRef, onOpen]);
  const tasks = resource.value?.tasks.filter(task => task.enabled) ?? [];
  const active = tasks.map(task => ({ caseId: task.caseId.padStart(2, '0'), neutral: quotas[task.caseId]?.neutral ?? 0, goal: quotas[task.caseId]?.goal ?? 0 })).filter(value => value.neutral || value.goal);
  const totals = { neutral: active.reduce((sum, q) => sum + q.neutral, 0), goal: active.reduce((sum, q) => sum + q.goal, 0) };
  const people = { neutral: totals.neutral / perPerson, goal: totals.goal / perPerson };
  const messages: string[] = [];
  if (Object.entries(quotas).some(([caseId, quota]) => (quota.neutral || quota.goal) && !tasks.some(task => task.caseId === caseId))) messages.push('原方案包含当前不可用的 case，请清空配额后重新选择。');
  if (modelId === '__confirm__') messages.push('请重新选择本方案模型，或明确选择不使用模型。');
  if (!Number.isInteger(perPerson) || perPerson < 1 || perPerson > 20) messages.push('每人任务数须为 1–20 的整数。');
  for (const condition of ['neutral', 'goal'] as const) {
    if (!Number.isInteger(people[condition])) messages.push(`${condition === 'neutral' ? 'Neutral' : 'Goal'} 共 ${totals[condition]} 份任务，需调整为每人任务数的整数倍。`);
    else if (active.some(q => q[condition] > people[condition])) messages.push(`${condition === 'neutral' ? 'Neutral' : 'Goal'} 有 case 的配额超过该组人数；请降低该配额或增加其他 case 配额。`);
  }
  if (people.neutral + people.goal > 1000) messages.push('单个方案最多 1000 人，请减少配额。');
  const valid = !!active.length && !messages.length && active.every(q => Number.isInteger(q.neutral) && q.neutral >= 0 && q.neutral <= 1000 && Number.isInteger(q.goal) && q.goal >= 0 && q.goal <= 1000);
  const locked = busy || !!command;
  function patch(caseId: string, condition: 'neutral' | 'goal', value: number) {
    setQuotas(previous => ({ ...previous, [caseId]: { neutral: previous[caseId]?.neutral ?? 0, goal: previous[caseId]?.goal ?? 0, [condition]: value } }));
  }
  async function preview(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!command && expiry && new Date(beijingInstant(expiry)).getTime() <= Date.now()) { setError('访问到期时间须晚于当前北京时间。'); return; }
    const request = command ?? { requestId: crypto.randomUUID(), quotas: active, tasksPerPerson: perPerson, maxTurns,
      modelId: modelId || null, batchId: batch.trim() || null, expiresAt: expiry ? beijingInstant(expiry) : null, seed: seed.trim() || null };
    setCommand(request); setBusy(true);
    try { const plan = await api<AllocationPlan>('/allocation-plans', request); setSavedRef(plan.planRef); }
    catch (reason) {
      setError(errorText(reason));
      if (reason instanceof AdminError && reason.status >= 400 && reason.status < 500) setCommand(undefined);
    } finally { setBusy(false); }
  }
  if (!resource.value) return <Loading error={resource.error} retry={resource.reload} />;
  return <form className="admin-quota-layout" onSubmit={preview}><div className="admin-stack">
    {source && <div className="admin-info" role="status">已从“{source.batchId}”复制配额、每人任务数和对话轮数。到期时间与随机种子已清空，将生成独立的新安排。{source.model && `原模型：${source.model.label}，请重新选择。`}</div>}
    <Panel title="每个 case 的发放配额" subtitle="填写计划发放的任务份数；0 表示不分配。Neutral / Goal 分别计算，每人保持同一种条件。">
      <fieldset className="admin-quota-fill" disabled={locked}>
        <label className="admin-field">统一 Neutral<input type="number" min={0} max={1000} step={1} value={fillNeutral} onChange={event => setFillNeutral(event.target.value === '' ? 0 : event.target.valueAsNumber)} /></label>
        <label className="admin-field">统一 Goal<input type="number" min={0} max={1000} step={1} value={fillGoal} onChange={event => setFillGoal(event.target.value === '' ? 0 : event.target.valueAsNumber)} /></label>
        <button className="admin-button" type="button" disabled={locked || !Number.isInteger(fillNeutral) || !Number.isInteger(fillGoal) || fillNeutral < 0 || fillGoal < 0 || fillNeutral > 1000 || fillGoal > 1000} onClick={() => setQuotas(Object.fromEntries(tasks.map(task => [task.caseId, { neutral: fillNeutral, goal: fillGoal }])))}>应用到全部 case</button>
        <button className="admin-link-button" type="button" onClick={() => setQuotas({})}>清空配额</button>
      </fieldset>
      <fieldset className="admin-quota-table" disabled={locked}><legend className="sr-only">Case 配额表</legend><table><thead><tr><th>Case</th><th>Neutral 份数</th><th>Goal 份数</th><th>合计</th></tr></thead><tbody>{tasks.map(task => <tr key={task.caseId}><td>{task.number}</td><td><input aria-label={`Case ${task.number} Neutral 配额`} type="number" min={0} max={1000} step={1} value={quotas[task.caseId]?.neutral ?? 0} onChange={event => patch(task.caseId, 'neutral', event.target.value === '' ? 0 : event.target.valueAsNumber)} /></td><td><input aria-label={`Case ${task.number} Goal 配额`} type="number" min={0} max={1000} step={1} value={quotas[task.caseId]?.goal ?? 0} onChange={event => patch(task.caseId, 'goal', event.target.value === '' ? 0 : event.target.valueAsNumber)} /></td><td>{(quotas[task.caseId]?.neutral ?? 0) + (quotas[task.caseId]?.goal ?? 0)}</td></tr>)}</tbody></table></fieldset>
    </Panel>
  </div><aside className="admin-stack admin-quota-controls"><Panel title="分配设置" subtitle="生成预览会保存方案，不立即发放。"><fieldset className="admin-settings-fields" disabled={locked}>
    <label className="admin-field">每人任务数<input required type="number" min={1} max={20} step={1} value={Number.isNaN(perPerson) ? '' : perPerson} onChange={event => setPerPerson(event.target.valueAsNumber)} /></label>
    <label className="admin-field">本方案模型<select value={modelId} onChange={event => setModelId(event.target.value)}>{source?.model && <option value="__confirm__" disabled>请重新选择模型</option>}<option value="">不使用模型 · 确定性开发回复</option>{resource.value.models.map(model => <option key={model.id} value={model.id} disabled={!model.configured}>{model.label}（{model.runtimeReady ? 'Advisor 已验证' : '待 Advisor 验证'}）</option>)}</select></label>
    <label className="admin-field">批次名称<input maxLength={128} value={batch} onChange={event => setBatch(event.target.value)} placeholder="留空自动命名" /></label>
    <label className="admin-field">对话最大轮数<input required type="number" min={3} max={100} step={1} value={Number.isNaN(maxTurns) ? '' : maxTurns} onChange={event => setMaxTurns(event.target.valueAsNumber)} /></label>
    <label className="admin-field">访问到期时间（北京时间）<input type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)} /></label>
    <details className="admin-quota-advanced"><summary>随机种子（可选）</summary><label className="admin-field"><span className="sr-only">随机种子</span><input aria-label="随机种子" maxLength={64} pattern="[a-zA-Z0-9_-]+" value={seed} onChange={event => setSeed(event.target.value)} placeholder="留空自动生成" /><small>同算法版本、同配额、同种子可重现相同安排。</small></label></details>
  </fieldset></Panel><Panel title="预计安排"><KeyValues rows={[
    ['参与 case', `${active.length} 个`], ['总任务数', `${totals.neutral + totals.goal} 份`],
    ['Neutral 人数', Number.isInteger(people.neutral) ? people.neutral : '配额待调整'], ['Goal 人数', Number.isInteger(people.goal) ? people.goal : '配额待调整'],
    ['总人数', Number.isInteger(people.neutral + people.goal) ? people.neutral + people.goal : '配额待调整'],
  ]} /><div className="admin-quota-action">{messages.length > 0 && <div className="admin-info">{messages.map(message => <p key={message}>{message}</p>)}</div>}{error && <div className="admin-error" role="alert">{error}{command && <p>预览请求编号已保留，重试会恢复同一方案。</p>}</div>}
    <button className="admin-button primary admin-full-width" type="submit" disabled={busy || (!command && !valid)}>{busy ? '正在生成安排…' : command ? '恢复同一预览请求' : '生成随机分配预览'}</button>
    <p className="admin-caption">每人无重复 case，依次完成。各 case 在同条件下的序位、目标 A/B、展示 AB/BA 数量差均至多 1。生成方案不调用模型。</p>
  </div></Panel></aside></form>;
}

function PlanHistory({ revision }: { revision: number }) {
  const [page, setPage] = useState(1);
  const [archived, setArchived] = useState(false);
  const resource = useResource<AllocationHistory>(`/allocation-plans?page=${page}&archived=${archived}`, revision);
  return <Panel title="配额方案历史" subtitle="未发放的预览也会保留，可重新打开核对。">
    <label className="admin-field admin-quota-history-filter">方案范围<select value={archived ? 'archived' : 'active'} onChange={event => { setArchived(event.target.value === 'archived'); setPage(1); }}><option value="active">当前方案</option><option value="archived">已归档方案</option></select></label>
    {!resource.value ? <Loading error={resource.error} retry={resource.reload} /> : <>{resource.value.items.length ? <div className="admin-table-scroll"><table><thead><tr><th>批次</th><th>人数</th><th>Case / 每人任务</th><th>状态</th><th>创建时间（北京时间）</th><th /></tr></thead><tbody>{resource.value.items.map(plan => <tr key={plan.planRef}><td>{plan.batchId}</td><td>{plan.participantCount}<small className="admin-table-secondary">Neutral {plan.counts.neutral} / Goal {plan.counts.goal}</small></td><td>{plan.caseCount} / {plan.tasksPerPerson}</td><td>{plan.status === 'archived' ? '已归档' : plan.status === 'issued' ? '已发放' : '已保存预览'}</td><td className="admin-date-cell">{date(plan.createdAt)}</td><td><div className="admin-actions"><a href={`#allocation/${plan.planRef}`}>打开方案 →</a><a href={`#allocation?copy=${plan.planRef}`}>复制为新方案</a></div></td></tr>)}</tbody></table></div> : <Empty>{archived ? '尚无归档方案。' : '尚无配额方案，原来的测试码发放不计入此列表。'}</Empty>}
      <div className="admin-pagination"><span>共 {resource.value.total} 个方案</span><div className="admin-actions"><button className="admin-button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page} / {Math.max(1, Math.ceil(resource.value.total / 20))}</span><button className="admin-button" disabled={page * 20 >= resource.value.total} onClick={() => setPage(value => value + 1)}>下一页</button></div></div></>}
  </Panel>;
}

type PlanAction = 'issue' | 'archive' | 'restore' | 'delete';
const actionNames: Record<PlanAction, string> = { issue: '发放', archive: '归档', restore: '恢复', delete: '删除' };

function BalanceCounts({ check }: { check: QuotaCheck }) {
  return <><p>目标 A / B：{check.targets.A} / {check.targets.B}</p><p>展示 AB / BA：{check.optionOrders.AB} / {check.optionOrders.BA}</p><p>目标 A × 展示 AB / BA：{check.combinations.A_AB} / {check.combinations.A_BA}</p><p>目标 B × 展示 AB / BA：{check.combinations.B_AB} / {check.combinations.B_BA}</p></>;
}

function AllocationDistribution({ plan }: { plan: AllocationPlan }) {
  const [condition, setCondition] = useState<'neutral' | 'goal'>('neutral');
  const caseIds = plan.quotas.map(quota => quota.caseId);
  const pairs = new Map(plan.cooccurrence.map(pair => [pair.cases.join(':'), pair[condition]]));
  const maximum = Math.max(1, ...pairs.values());
  return <Panel title="随机分布检查" subtitle="按每个 case、每种条件核对；旧方案展示原始分布，不会重新抽签。">
    <details className="admin-allocation-distribution"><summary>A/B 目标与展示顺序</summary><p className="admin-caption">新版算法的目标 A/B、展示 AB/BA 数量差分别至多 1，四种交叉组合数量差至多 1。奇数配额的多出项随机决定。</p><div className="admin-table-scroll"><table><thead><tr><th>Case</th><th>Neutral</th><th>Goal</th></tr></thead><tbody>{plan.checks.map(check => <tr key={check.caseId}><th scope="row">{check.caseId}</th><td><BalanceCounts check={check.neutral} /></td><td><BalanceCounts check={check.goal} /></td></tr>)}</tbody></table></div></details>
    <details className="admin-allocation-distribution"><summary>Case 组合共现次数</summary><p className="admin-caption">数值表示同一人同时分到两个 case 的人数。配额不同时，各组合次数可以不同；当前展示分布，不要求各组合等量。</p><label className="admin-field admin-quota-history-filter">共现实验条件<select value={condition} onChange={event => setCondition(event.target.value as 'neutral' | 'goal')}><option value="neutral">Neutral</option><option value="goal">Goal</option></select></label>{caseIds.length < 2 ? <Empty>仅一个 case，没有 case 对。</Empty> : <div className="admin-table-scroll"><table className="admin-cooccurrence-table"><thead><tr><th scope="col">Case</th>{caseIds.map(caseId => <th scope="col" key={caseId}>{caseId}</th>)}</tr></thead><tbody>{caseIds.map(a => <tr key={a}><th scope="row">{a}</th>{caseIds.map(b => {
      const count = pairs.get([a, b].sort().join(':')) ?? 0;
      return <td key={b} aria-label={`Case ${a} 与 ${b} 共现`} style={a === b ? undefined : { backgroundColor: `rgba(43, 91, 79, ${0.03 + count / maximum * 0.2})` }}>{a === b ? '—' : count}</td>;
    })}</tr>)}</tbody></table></div>}</details>
  </Panel>;
}

function AllocationDetails({ revision, planRef, onOpen }: { revision: number; planRef: string; onOpen: (ref: string) => void }) {
  const resource = useResource<AllocationPlan>(`/allocation-plans/${planRef}`, revision);
  const [page, setPage] = useState(1); const [busy, setBusy] = useState(false); const [command, setCommand] = useState<{ requestId: string; action: PlanAction }>();
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [deleted, setDeleted] = useState(false);
  useUnsavedChanges(!!command);
  useEffect(() => { if (deleted) onOpen(''); }, [deleted, onOpen]);
  async function mutate(action: PlanAction) {
    if (busy || (command && command.action !== action)) return;
    if (!command && action === 'delete' && !window.confirm('删除这个尚未发放的方案？删除后将从方案列表移除，不能再发放。')) return;
    const request = command ?? { requestId: crypto.randomUUID(), action };
    setCommand(request); setBusy(true); setError('');
    try {
      let message: string;
      if (action === 'issue') {
        const result = await api<Codes>(`/allocation-plans/${planRef}/issue`, { requestId: request.requestId });
        message = `${result.replayed ? '已恢复发放结果' : '方案已发放'} · ${result.participants.length} 个测试码，任务安排与预览一致。`;
      } else {
        await api(`/allocation-plans/${planRef}/${action}`, { requestId: request.requestId });
        message = action === 'archive' ? '方案已归档；已发测试码仍可使用，参与记录和统计继续保留。' : '方案已恢复至当前列表。';
      }
      setCommand(undefined);
      if (action === 'delete') { setDeleted(true); return; }
      setNotice(message); resource.reload();
    } catch (reason) {
      setError(errorText(reason));
      if (reason instanceof AdminError && reason.status >= 400 && reason.status < 500) setCommand(undefined);
    } finally { setBusy(false); }
  }
  if (!resource.value) return <Loading error={resource.error} retry={resource.reload} />;
  const plan = resource.value;
  const blocked = (action: PlanAction) => busy || (!!command && command.action !== action);
  const label = (action: PlanAction, normal: string) => command?.action === action ? `${busy ? '正在' : '重试'}${actionNames[action]}${busy ? '…' : '请求'}` : normal;
  return <div className="admin-stack"><div className="admin-actions"><a className="admin-back-link" href="#allocation">← 新建配额方案 / 历史</a><a className="admin-button" href={`#allocation?copy=${planRef}`}>复制为新方案</a><a className="admin-button" href={`/api/v1/admin/allocation-plans/${planRef}/export`} download>{plan.issued ? '导出任务与当前测试码 CSV' : '导出预览 CSV'}</a></div>
    {notice && <div className="admin-info" role="status">{notice}</div>}
    {plan.archived && <div className="admin-info" role="status">已归档：仅从当前方案列表收起，测试码仍有效，参与记录继续更新。</div>}
    <div className="admin-quota-layout"><div className="admin-stack"><Panel title={plan.batchId} subtitle={plan.issued ? '已发放 · 原始分配已固定，完成数据单独统计。' : '方案已保存，尚未创建参与者或测试码。'}>
      <KeyValues rows={[
        ['人数', `${plan.participantCount} 人 · Neutral ${plan.counts.neutral} / Goal ${plan.counts.goal}`], ['任务', `每人 ${plan.tasksPerPerson} 项 · 共 ${plan.taskCount} 项`],
        ['模型', plan.model?.label || '确定性开发回复'], ['到期（北京时间）', plan.expiresAt ? date(plan.expiresAt) : '不限期'],
      ]} /><details className="admin-technical"><summary>复现信息</summary><p>随机种子：<code>{plan.seed}</code></p><p>算法：{plan.algorithm}</p><p>方案：<code>{plan.planRef}</code></p></details>
    </Panel><Panel title="Case 配额核对" subtitle="配额是计划发放数；已完成仅计任务完成记录，中途退出不计完成。"><div className="admin-table-scroll"><table><thead><tr><th>Case</th><th>Neutral 计划 / 分配</th><th>Goal 计划 / 分配</th><th>Neutral 已发 / 完成</th><th>Goal 已发 / 完成</th><th>序位</th></tr></thead><tbody>{plan.checks.map(check => <tr key={check.caseId}><td>{check.caseId}</td><td>{check.neutral.requested} / {check.neutral.planned}</td><td>{check.goal.requested} / {check.goal.planned}</td><td>{check.neutral.issued} / {check.neutral.completed}</td><td>{check.goal.issued} / {check.goal.completed}</td><td><details className="admin-history-details"><summary>分布</summary><p>Neutral：{check.neutral.positions.join(' / ')}</p><p>Goal：{check.goal.positions.join(' / ')}</p></details></td></tr>)}</tbody></table></div></Panel></div>
    <aside className="admin-quota-controls"><Panel title="确认方案"><div className="admin-quota-action"><p className="admin-caption">每人保持同一实验条件，无重复 case，按已排定的顺序依次完成。发放后不重新抽签，同一方案仅生成一批测试码。</p>
      <BudgetSummary value={plan.budgetCheck} />
      {plan.readinessMessage && <div className="admin-info" role="status">{plan.readinessMessage}</div>}{error && <div className="admin-error" role="alert">{error}{command && <p>{command.action === 'issue' ? '请求编号已保留，重试不会再次发放。' : '请求编号已保留，重试可恢复操作结果。'}</p>}</div>}
      <button className="admin-button primary admin-full-width" type="button" disabled={blocked('issue') || (command?.action !== 'issue' && !plan.canIssue)} onClick={() => mutate('issue')}>{command?.action === 'issue' ? busy ? '正在发放…' : '恢复同一发放请求' : plan.issued ? '方案已发放' : `确认发放 ${plan.participantCount} 个测试码`}</button>
      {plan.issued && <a className="admin-button admin-full-width" href={`#participants?configRef=${plan.configRef}&batch=${encodeURIComponent(plan.batchId)}`}>查看本方案参与记录</a>}
      {plan.issued ? <><button className="admin-button admin-full-width" type="button" disabled={blocked(plan.archived ? 'restore' : 'archive')} onClick={() => mutate(plan.archived ? 'restore' : 'archive')}>{plan.archived ? label('restore', '恢复到当前方案') : label('archive', '归档方案')}</button><p className="admin-caption">归档只整理列表，不撤销测试码，也不停止参与。</p></> : <button className="admin-link-button" type="button" disabled={blocked('delete')} onClick={() => mutate('delete')}>{label('delete', '删除未发放方案')}</button>}
    </div></Panel></aside></div>
    <AllocationDistribution plan={plan} />
    <Panel title="逐人任务安排" subtitle="按箭头顺序执行；预览、刷新、重试和换码均不会改变任务安排。"><div className="admin-table-scroll"><table><thead><tr><th>分配位</th><th>条件</th><th>任务顺序</th><th>测试码</th><th>详情</th></tr></thead><tbody>{plan.members.slice((page - 1) * 20, page * 20).map(member => <tr key={member.slot}><td>{member.slot}{member.participantId && <small className="admin-table-secondary"><a href={`#participant/${member.participantId}`}>查看参与者</a></small>}</td><td><Badge value={member.condition} /></td><td>{member.tasks.map(task => task.caseId).join(' → ')}</td><td>{member.code ? <TestCode value={member.code} /> : <span className="admin-caption">尚未发放</span>}</td><td><details className="admin-history-details"><summary>随机结果</summary>{member.tasks.map(task => <p key={task.caseId}>{task.position}. Case {task.caseId} · 目标 {task.targetOptionId} · 选项 {task.optionOrder.join(' → ')}</p>)}</details></td></tr>)}</tbody></table></div>
      <div className="admin-pagination"><span>共 {plan.participantCount} 人 · 每页 20 人</span><div className="admin-actions"><button className="admin-button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page} / {Math.ceil(plan.participantCount / 20)}</span><button className="admin-button" disabled={page * 20 >= plan.participantCount} onClick={() => setPage(value => value + 1)}>下一页</button></div></div>
    </Panel>
  </div>;
}

function CopyAllocation({ copyRef, revision, onOpen }: { copyRef: string; revision: number; onOpen: (ref: string) => void }) {
  const resource = useResource<AllocationPlan>(`/allocation-plans/${copyRef}`, revision);
  if (!resource.value) return <Loading error={resource.error} retry={resource.reload} />;
  return <><a className="admin-back-link" href="#allocation">← 新建空白方案 / 历史</a><NewAllocation key={`${copyRef}-${revision}`} revision={revision} source={resource.value} onOpen={onOpen} /></>;
}

export function AllocationPage({ revision, planRef, copyRef, onOpen }: { revision: number; planRef: string; copyRef: string; onOpen: (ref: string) => void }) {
  return planRef ? <AllocationDetails key={planRef} revision={revision} planRef={planRef} onOpen={onOpen} /> : copyRef ? <div className="admin-stack"><CopyAllocation key={copyRef} copyRef={copyRef} revision={revision} onOpen={onOpen} /></div> : <div className="admin-stack"><NewAllocation key={revision} revision={revision} onOpen={onOpen} /><PlanHistory revision={revision} /></div>;
}
