export const BEIJING_TIME_ZONE = 'Asia/Shanghai';
export const date = (value?: string | null) => value ? new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(value)) : '—';

// datetime-local is a wall clock input. Its interpretation must not depend on the browser's timezone.
export function beijingInstant(value: string): string {
  return new Date(`${value}+08:00`).toISOString();
}
export function batchName(): string {
  const local = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `BJ-${local}-${crypto.randomUUID().slice(0, 4)}`;
}
