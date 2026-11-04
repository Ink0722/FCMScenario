import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorText, setSession } from './api';
import type { BatchPlan, CodeRow, EnvironmentConfig, ResearcherSession } from './types';
import { Badge, Loading, TestCode } from './shared';
import { OverviewPage, ParticipantsPage, ParticipantPage, TaskPage } from './Records';
import { IssuePage } from './Issue';
import { SettingsPage } from './Settings';
import { BatchesPage } from './Batches';
import { confirmDiscard } from './unsaved';
import { AllocationPage } from './Allocation';

type Vault = { rows: CodeRow[]; title: string };
export type SaveCodes = (rows: CodeRow[], title: string) => void;
function CodeVault({ vault, onClear }: { vault: Vault; onClear: () => void }) {
  const [message, setMessage] = useState('');
  const csv = ['participant_id,test_code,condition', ...vault.rows.map(row => `${row.participantId},${row.code ?? ''},${row.condition ?? ''}`)].join('\r\n');
  function download() {
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `fcm-codes-${Date.now()}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage('已下载，也可随时在参与记录中重新导出。');
  }
  return <section className="admin-vault" aria-label="测试码生成结果">
    <div className="admin-panel-heading"><div><span className="admin-eyebrow">生成结果</span><h2>{vault.title} · {vault.rows.length} 个测试码</h2><p>测试码已保存，可随时在参与记录中查看、复制或导出。</p></div>
      <div className="admin-actions"><button className="admin-button primary" onClick={download}>下载 CSV</button><button className="admin-link-button" onClick={onClear}>收起本次结果</button></div></div>
    <div className="admin-vault-table"><table><thead><tr><th>测试码</th><th>实验条件</th><th>参与者</th><th>记录</th></tr></thead><tbody>{vault.rows.map(row => <tr key={row.participantId}><td><TestCode value={row.code} /></td><td>{row.condition ? <Badge value={row.condition} /> : '—'}</td><td className="admin-mono">{row.participantId}</td><td><a href={`#participant/${row.participantId}`}>查看记录 ↗</a></td></tr>)}</tbody></table></div>
    <div className="admin-vault-footer"><span role="status">{message || '可以继续生成下一批，无需先下载或收起本批结果。'}</span><a href="#participants">查看全部测试码 →</a></div>
  </section>;
}

function Login({ onLogin }: { onLogin: (session: ResearcherSession) => void }) {
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const session = await api<ResearcherSession>('/login', { password }); setPassword(''); setSession(session); onLogin(session); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  return <main className="admin-login"><div className="admin-login-intro"><div className="admin-brand-mark">fcm<span>↗</span></div><span className="admin-eyebrow">RESEARCH WORKSPACE</span><h1>研究控制台</h1><p>配置任务、发放测试码，<br />从原始记录理解每一次决策。</p><div className="admin-login-footnote">Financial Decision Study · 研究者专用</div></div>
    <form className="admin-login-form" onSubmit={submit}><span className="admin-eyebrow">研究者登录</span><h2>进入工作空间</h2><p>使用此部署的研究者口令登录。</p><label className="admin-field">研究者口令<input type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} autoFocus /></label>{error && <div role="alert" className="admin-error">{error}</div>}<button className="admin-button primary" type="submit" disabled={busy}>{busy ? '正在验证…' : '登录控制台 →'}</button><p className="admin-caption">登录有效期为 8 小时。口令不会保存在浏览器存储中。</p></form></main>;
}

const titles: Record<string, [string, string]> = {
  overview: ['研究总览', '查看参与进度与当前运行状态。'],
  issue: ['测试码与发放', '选择任务与实验条件，批量生成并管理测试码。'],
  participants: ['参与记录', '按批次与进度检索，查看每位参与者的完整历程。'],
  batches: ['批次管理', '查看各批次的配置、人数与进度，复制安排生成下一批。'],
  allocation: ['配额随机分配', '指定各 case 的条件配额与每人任务数，预览后统一发放。'],
  participant: ['参与者详情', '背景问卷、任务分配与访问管理。'],
  task: ['任务回放', '按历史尝试查看判断、对话与执行记录。'],
  settings: ['设置', '维护环境信息、模型连接与运行配置。'],
};
export function AdminApp() {
  const [session, updateSession] = useState<ResearcherSession | null>();
  const [bootstrapError, setBootstrapError] = useState('');
  const [route, setRoute] = useState(() => location.hash.slice(1) || 'overview');
  const currentRoute = useRef(route); currentRoute.current = route;
  const approvedHash = useRef('');
  const [issueTemplate, setIssueTemplate] = useState<BatchPlan | null>(null);
  const [revision, setRevision] = useState(0); const [vault, setVault] = useState<Vault | null>(null);
  const [logoutError, setLogoutError] = useState(''); const [logoutBusy, setLogoutBusy] = useState(false);
  const [environmentName, setEnvironmentName] = useState('当前环境');
  useEffect(() => {
    if (!session) return;
    let current = true;
    api<EnvironmentConfig>('/settings').then(value => { if (current) setEnvironmentName(value.environmentName); }).catch(() => {});
    return () => { current = false; };
  }, [session, revision]);
  function bootstrap() {
    setBootstrapError('');
    api<ResearcherSession>('/session').then(value => { setSession(value); updateSession(value); }).catch(reason => {
      if (reason.status === 401) updateSession(null); else setBootstrapError(errorText(reason));
    });
  }
  useEffect(bootstrap, []);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.('a');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, location.href);
      if (destination.origin !== location.origin || destination.pathname !== location.pathname || destination.search !== location.search ||
          !destination.hash || destination.hash === '#admin-main' || destination.hash === location.hash) return;
      if (!confirmDiscard()) { event.preventDefault(); event.stopPropagation(); }
      else approvedHash.current = destination.hash;
    };
    const navigate = () => {
      if (!(approvedHash.current && approvedHash.current === location.hash) && !confirmDiscard()) {
        history.replaceState(null, '', `${location.pathname}${location.search}#${currentRoute.current}`); return;
      }
      approvedHash.current = ''; setRoute(location.hash.slice(1) || 'overview'); window.scrollTo(0, 0);
    };
    const expired = () => { updateSession(null); setVault(null); };
    window.addEventListener('hashchange', navigate); window.addEventListener('fcm-admin-session-expired', expired);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('hashchange', navigate); window.removeEventListener('fcm-admin-session-expired', expired); document.removeEventListener('click', click, true); };
  }, []);
  async function logout() {
    if (!confirmDiscard()) return;
    setLogoutBusy(true); setLogoutError('');
    try { await api('/logout', {}); setSession(null); updateSession(null); setVault(null); }
    catch (reason) { setLogoutError(errorText(reason)); } finally { setLogoutBusy(false); }
  }
  if (session === undefined) return <main className="admin-bootstrap"><Loading error={bootstrapError} retry={bootstrap} /></main>;
  if (!session) return <Login onLogin={updateSession} />;
  const [routePath, routeQuery = ''] = route.split('?');
  const [page, id = ''] = routePath.split('/'); const [title, subtitle] = titles[page] ?? titles.overview;
  const initialFilter = new URLSearchParams(routeQuery);
  const initialBatch = initialFilter.get('batch') ?? '';
  const active = ['participant', 'task'].includes(page) ? 'participants' : page;
  const saveCodes: SaveCodes = (rows, heading) => { setVault({ rows, title: heading }); setRevision(n => n + 1); window.scrollTo(0, 0); };
  const shared = { revision, saveCodes };
  return <div className="admin-shell"><a className="skip-link" href="#admin-main" onClick={event => { event.preventDefault(); document.getElementById('admin-main')?.focus(); }}>跳至主要内容</a><aside className="admin-sidebar"><a className="admin-brand" href="#overview"><div className="admin-brand-mark">fcm<span>↗</span></div><span>研究控制台</span></a><div className="admin-sidebar-label">工作空间</div><nav aria-label="研究管理导航">{[['overview', '◫', '研究总览'], ['issue', '＋', '测试码与发放'], ['allocation', '⤨', '配额随机分配'], ['batches', '▤', '批次管理'], ['participants', '☷', '参与记录'], ['settings', '⚙', '设置']].map(([key, icon, label]) => <a key={key} href={`#${key}`} aria-current={active === key ? 'page' : undefined}><span aria-hidden="true">{icon}</span>{label}</a>)}</nav><div className="admin-sidebar-bottom"><span className="admin-live-dot" />{environmentName}<p>模型可选 · 按批次冻结</p><span className="admin-caption">Research console / v0.1</span></div></aside>
    <div className="admin-workspace"><header className="admin-topbar"><div>FCM <span>/</span> 研究管理</div><div className="admin-actions"><span className="admin-user"><span>R</span>研究者</span><button className="admin-link-button" disabled={logoutBusy} onClick={logout}>{logoutBusy ? '正在退出…' : '退出登录'}</button></div></header>
      <main id="admin-main" tabIndex={-1} className="admin-main"><div className="admin-page-heading"><div className="admin-page-title"><h1>{title}</h1><p>{subtitle}</p></div><div className="admin-actions">{page === 'overview' && <a className="admin-button primary" href="#issue">＋ 发放测试码</a>}<button className="admin-button" onClick={() => { if (confirmDiscard()) setRevision(n => n + 1); }}>↻ 刷新数据</button></div></div>
        {logoutError && <div className="admin-error" role="alert">{logoutError}</div>}{vault && <CodeVault vault={vault} onClear={() => setVault(null)} />}
        {page === 'settings' ? <SettingsPage revision={revision} onSaved={() => setRevision(n => n + 1)} /> : page === 'allocation' ? <AllocationPage revision={revision} planRef={id} copyRef={initialFilter.get('copy') ?? ''} onOpen={ref => { location.hash = ref ? `allocation/${ref}` : 'allocation'; }} /> : page === 'issue' ? <IssuePage {...shared} initialPlan={issueTemplate} onPlanUsed={() => setIssueTemplate(null)} /> : page === 'batches' ? <BatchesPage revision={revision} onCopy={plan => { setIssueTemplate(plan); location.hash = 'issue'; }} /> : page === 'participants' ? <ParticipantsPage key={routeQuery} revision={revision} initialBatch={initialBatch} configRef={initialFilter.get('configRef') ?? ''} unnamed={initialFilter.get('unnamed') === 'true'} /> : page === 'participant' ? <ParticipantPage key={id} id={id} {...shared} onChanged={() => setRevision(n => n + 1)} /> : page === 'task' ? <TaskPage key={id} id={id} revision={revision} /> : <OverviewPage revision={revision} />}
        <footer className="admin-footer">FCM Research Workspace<span>北京时间（UTC+8） · 原始记录只读</span></footer>
      </main></div>

  </div>;
}
