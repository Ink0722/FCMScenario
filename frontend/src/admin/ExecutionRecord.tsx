import { date } from './shared';

interface Call {
  callId?: string; stage?: string; status?: string; elapsedMs?: number; usage?: { inputTokens: number; outputTokens: number; reasoningTokens?: number };
  costUsd?: number; reservedUsd?: number; costStatus?: string; reasoningSummary?: string[]; reasoningSummaryStatus?: string;
}
interface Tool { callId?: string; name?: string; status?: string; arguments?: unknown; result?: unknown; error?: string; startedAt?: string }
const stage = (value?: string) => value === 'prepare' ? '准备' : value === 'reply' ? '正式回复' : value || '—';
export function ExecutionRecord({ calls, tools }: { calls: unknown[]; tools: unknown[] }) {
  return <div className="admin-stack">
    {calls.length > 0 && <div className="admin-table-scroll"><table><thead><tr><th>阶段 / 状态</th><th>耗时</th><th>Token 输入 / 输出</th><th>费用</th><th>供应商摘要</th></tr></thead><tbody>{(calls as Call[]).map((call, index) => <tr key={call.callId || index}>
      <td>{stage(call.stage)}<small className="admin-table-secondary">{call.status || '—'}</small></td>
      <td>{call.elapsedMs == null ? '—' : `${(call.elapsedMs / 1000).toFixed(1)} 秒`}</td>
      <td>{call.usage ? `${call.usage.inputTokens} / ${call.usage.outputTokens}` : '待确认'}{call.usage?.reasoningTokens != null && <small className="admin-table-secondary">其中推理 {call.usage.reasoningTokens}</small>}</td>
      <td>{call.costStatus === 'settled' ? '已结算' : '预占'} ${(call.costUsd ?? call.reservedUsd ?? 0).toFixed(6)}</td>
      <td>{call.reasoningSummary?.length ? <details><summary>{call.reasoningSummaryStatus === 'partial' ? '查看部分摘要' : '查看原生摘要'}</summary>{call.reasoningSummary.map((text, i) => <p key={i}>{text}</p>)}</details> : '未返回'}</td>
    </tr>)}</tbody></table></div>}
    {tools.length > 0 && <div className="admin-table-scroll"><table><thead><tr><th>工具 / 状态</th><th>参数</th><th>结果</th></tr></thead><tbody>{(tools as Tool[]).map((tool, index) => <tr key={tool.callId || index}>
      <td>{tool.name}<small className="admin-table-secondary">{tool.status} · {date(tool.startedAt)}</small></td>
      <td><code>{JSON.stringify(tool.arguments)}</code></td>
      <td><details><summary>{tool.error ? `失败：${tool.error}` : '查看实际结果'}</summary><pre>{JSON.stringify(tool.result ?? tool.error, null, 2)}</pre></details></td>
    </tr>)}</tbody></table></div>}
    <details className="admin-raw"><summary>原始执行 JSON</summary><pre>{JSON.stringify({ model_calls: calls, tool_calls: tools }, null, 2)}</pre></details>
  </div>;
}
