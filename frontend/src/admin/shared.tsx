import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errorText } from './api';
import type { WorkerState } from './types';
import { date } from './time';
export { date } from './time';

export const labels: Record<string, string> = {
  pending: '未开始', in_progress: '进行中', completed: '已完成', cancelled: '已取消', expired: '已过期',
  abandoned: '已退出', submitted: '已提交', queued: '排队中', running: '生成中', interrupted: '已中断',
  neutral: 'Neutral', goal: 'Goal', pre: '初始判断', dialogue: '对话', post: '最终判断',
  finishing: '待完成', complete: '已完成', user: '参与者', assistant: 'Advisor',
};
export const short = (value: string) => value.slice(0, 8).toUpperCase();
export function TestCode({ value }: { value: string | null }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  if (!value) return <span className="admin-caption">旧记录未保存原码</span>;
  return <span className="admin-code-cell"><code>{value}</code><button className="admin-link-button" aria-label={`复制测试码 ${value}`} onClick={async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setError(''); }
    catch { setError('请手动复制'); }
  }}>{copied ? '已复制' : error || '复制'}</button></span>;
}
export function Badge({ value }: { value: string }) {
  return <span className={`admin-badge admin-status-${value}`}>{labels[value] ?? value}</span>;
}
export function WorkerMonitor({ initial }: { initial: WorkerState }) {
  const [worker, setWorker] = useState(initial); const [error, setError] = useState(false);
  useEffect(() => { setWorker(initial); setError(false); }, [initial]);
  useEffect(() => {
    let current = true;
    const timer = setInterval(() => {
      api<WorkerState>('/worker').then(value => { if (current) { setWorker(value); setError(false); } })
        .catch(() => { if (current) setError(true); });
    }, 10_000);
    return () => { current = false; clearInterval(timer); };
  }, []);
  const warning = error || worker.status !== 'online' || worker.queueStalled;
  return <div className={`admin-worker-strip ${warning ? 'warning' : ''}`} role="status">
    <strong>{error ? 'Worker 状态读取失败' : worker.status === 'online' ? `Worker 在线 · ${worker.activeWorkers} 个` : 'Worker 未连接'}</strong>
    <span>排队 {worker.queued} · 处理中 {worker.running}{worker.queueStalled ? ` · 队列待处理 ${worker.oldestPendingSeconds} 秒` : ''}</span>
    <span>最近心跳 {date(worker.lastSeenAt)} · 最近处理 {date(worker.lastProcessedAt)}</span>
    {worker.status !== 'online' && <span>当前对话无法继续处理，请检查后台 Worker。</span>}
  </div>;
}
export function useResource<T>(path: string, revision = 0, keepPrevious = false) {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(''); if (!keepPrevious) setValue(undefined);
    api<T>(path).then(result => { if (current) setValue(result); })
      .catch(reason => { if (current) setError(errorText(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [path, revision, retry, keepPrevious]);
  return { value, error, loading, reload: () => setRetry(n => n + 1) };
}
export function Loading({ error, retry }: { error?: string; retry?: () => void }) {
  return error ? <div className="admin-error" role="alert">{error} {retry && <button className="admin-link-button" onClick={retry}>重试</button>}</div>
    : <div className="admin-loading" role="status"><span className="admin-loading-dot" />正在读取记录…</div>;
}
export function Panel({ title, subtitle, action, children, className = '' }: {
  title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={`admin-panel ${className}`}><div className="admin-panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="admin-empty">{children}</div>; }
export function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="admin-kv">{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>;
}
export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="admin-dialog" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="admin-dialog-heading"><h2>{title}</h2><button aria-label="关闭对话框" className="admin-icon-button" onClick={onClose}>×</button></div>{children}
  </dialog>;
}
