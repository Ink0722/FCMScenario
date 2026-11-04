import { useState, type FormEvent } from 'react';
import type { BatchPage, BatchPlan } from './types';
import { date, Empty, Loading, Panel, useResource } from './shared';

export function BatchesPage({ revision, onCopy }: { revision: number; onCopy: (plan: BatchPlan) => void }) {
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState(''); const [page, setPage] = useState(1);
  const resource = useResource<BatchPage>(`/batches?page=${page}&q=${encodeURIComponent(filter)}`, revision);
  function search(event: FormEvent) { event.preventDefault(); setFilter(query.trim()); setPage(1); }
  return <Panel title="批次与安排" subtitle="同名批次按冻结配置分别统计；复制配置会重新生成批次，不改动原记录。" action={<a className="admin-button primary" href="#issue">＋ 新建发放</a>}>
    <form className="admin-filters" onSubmit={search}><label className="admin-field">批次名称<input maxLength={128} value={query} onChange={event => setQuery(event.target.value)} placeholder="按批次名称检索" /></label><button className="admin-button" type="submit">查找批次</button></form>
    {!resource.value ? <Loading error={resource.error} retry={resource.reload} /> : <>{resource.value.items.length ? <div className="admin-table-scroll"><table><thead><tr><th>批次 / 配置</th><th>人数与条件</th><th>模型</th><th>任务安排</th><th>进度</th><th>最近发放（北京时间）</th><th>操作</th></tr></thead><tbody>{resource.value.items.map(batch => <tr key={batch.key}>
      <td><strong>{batch.batchId || '未命名批次'}</strong><small className="admin-table-secondary" title={batch.configRef}>配置 {batch.configRef.slice(0, 8)}</small></td>
      <td>{batch.participantCount} 人<small className="admin-table-secondary">{batch.groups.map(group => `${group.condition === 'neutral' ? 'Neutral' : 'Goal'} ${group.count}`).join(' / ')}</small></td>
      <td>{batch.modelLabel}</td><td><span className="admin-batch-tasks">{batch.taskNumbers.join(' · ')}</span></td>
      <td>{batch.statuses.completed} / {batch.participantCount} 人完成<small className="admin-table-secondary">进行中 {batch.statuses.in_progress} · 待开始 {batch.statuses.pending}</small><small className="admin-table-secondary">取消 {batch.statuses.cancelled} · 过期 {batch.statuses.expired} · 任务 {batch.tasksCompleted}/{batch.taskTotal}</small></td>
      <td className="admin-date-cell">{date(batch.lastAssignedAt)}</td><td><div className="admin-actions">{batch.allocationPlanRef ? <a href={`#allocation/${batch.allocationPlanRef}`}>查看配额方案</a> : <button className="admin-link-button" type="button" onClick={() => onCopy(batch.copyPlan)}>复制配置</button>}<a href={`#participants?configRef=${batch.configRef}${batch.batchId !== null ? `&batch=${encodeURIComponent(batch.batchId)}` : '&unnamed=true'}`}>参与记录</a><a href={`/api/v1/admin/codes/export?configRef=${batch.configRef}${batch.batchId !== null ? `&batch=${encodeURIComponent(batch.batchId)}` : '&unnamed=true'}`} download>导出测试码</a></div></td>
    </tr>)}</tbody></table></div> : <Empty>暂无符合条件的批次。</Empty>}
    <div className="admin-pagination"><span>共 {resource.value.total} 项安排 · 每页 20 项</span><div className="admin-actions"><button className="admin-button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page} / {Math.max(1, Math.ceil(resource.value.total / 20))}</span><button className="admin-button" disabled={page * 20 >= resource.value.total} onClick={() => setPage(value => value + 1)}>下一页</button></div></div></>}
  </Panel>;
}
