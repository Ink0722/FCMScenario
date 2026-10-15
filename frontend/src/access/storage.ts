import type { AccessGrant } from '../integration/contracts';

const key = 'fcm.access.v1';
export interface AccessCache { grant: AccessGrant; sessionId: string | null }
export function readAccessCache(): AccessCache | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    return value && typeof value.grant?.accessToken === 'string' && typeof value.grant?.expiresAt === 'string'
      && (value.sessionId === null || typeof value.sessionId === 'string') ? value : null;
  } catch { return null; }
}
export function saveAccessCache(cache: AccessCache) { sessionStorage.setItem(key, JSON.stringify(cache)); }
export function clearAccessCache() { sessionStorage.removeItem(key); }
