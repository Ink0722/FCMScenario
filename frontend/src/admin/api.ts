import type { ResearcherSession } from './types';

let csrf = '';
export class AdminError extends Error {
  constructor(message: string, public status = 0, public code = '') { super(message); }
}
export const setSession = (session: ResearcherSession | null) => { csrf = session?.csrfToken ?? ''; };
export async function api<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/admin${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AdminError('未能确认服务器响应。请检查连接；重试操作会使用同一请求编号。');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== '/login' && path !== '/session') {
      setSession(null);
      window.dispatchEvent(new Event('fcm-admin-session-expired'));
    }
    throw new AdminError(error.message ?? `请求失败（${response.status}）`, response.status, error.code);
  }
  return response.status === 204 ? undefined as T : response.json();
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请稍后重试。';
