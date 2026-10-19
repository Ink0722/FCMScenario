import study from '../generated/study.json';
import { mockDatabaseKey, mockResetEpochKey, type MockDatabase } from '../integration/mock';
import { profileDraftKey, sessionDraftKey } from '../app/drafts';

const accessKey = 'fcm.access.v1';
export interface ResetCodeOptions { code?: string; includeProfile?: boolean }
export interface ResetCodeResult { code: string; sessionsRemoved: number; draftsRemoved: number; profileRemoved: boolean }
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

// Local mock storage only. This module is dynamically imported by the DEV branch
// in main.tsx; it has no participant-facing UI or backend reset capability.
export function resetLocalCode(storage: Storage, options: ResetCodeOptions = {}): ResetCodeResult {
  if (!isObject(options) || (options.code !== undefined && typeof options.code !== 'string')
    || (options.includeProfile !== undefined && typeof options.includeProfile !== 'boolean'))
    throw new Error('Use resetCode({ code: "FCM-EN", includeProfile: true }) or resetCode().');

  const rawDatabase = storage.getItem(mockDatabaseKey);
  const parsed: unknown = JSON.parse(rawDatabase ?? 'null');
  if (!isObject(parsed) || !['grants', 'sessions', 'starts', 'abandoned', 'profiles'].every(key => isObject(parsed[key])))
    throw new Error('Local test storage is missing or invalid. No data was changed.');
  const database = parsed as unknown as MockDatabase;
  const rawAccess = storage.getItem(accessKey);
  const cache: unknown = JSON.parse(rawAccess ?? 'null');
  const cachedGrant = isObject(cache) && isObject(cache.grant) ? cache.grant : null;
  const cachedToken = typeof cachedGrant?.accessToken === 'string' ? cachedGrant.accessToken : null;
  const currentCode = cachedToken ? database.grants[cachedToken]?.codeKey : undefined;
  const code = (options.code ?? currentCode ?? '').trim().toUpperCase();
  if (!code) throw new Error('Enter a participant code first, or specify resetCode({ code: "FCM-EN" }).');
  if (!Object.hasOwn(study.codes, code)) throw new Error(`Unknown local development code: ${code}. No data was changed.`);

  const tokens = new Set(Object.keys(database.grants).filter(token => database.grants[token].codeKey === code));
  const sessionIds = new Set<string>();
  let sessionsRemoved = 0;
  for (const [id, session] of Object.entries(database.sessions)) {
    if (!tokens.has(session.accessToken)) continue;
    sessionIds.add(id); delete database.sessions[id]; sessionsRemoved++;
  }
  for (const [id, token] of Object.entries(database.abandoned)) {
    if (!tokens.has(token)) continue;
    sessionIds.add(id); delete database.abandoned[id];
  }
  for (const token of tokens) {
    const grant = database.grants[token];
    if (grant.activeSessionId) sessionIds.add(grant.activeSessionId);
    grant.activeSessionId = null;
  }
  for (const [key, id] of Object.entries(database.starts)) {
    if ([...tokens].some(token => key.startsWith(`${token}:`)) || sessionIds.has(id)) {
      sessionIds.add(id); delete database.starts[key];
    }
  }
  const profileRemoved = options.includeProfile === true && Object.hasOwn(database.profiles, code);
  if (options.includeProfile) delete database.profiles[code];

  const scopes = [...sessionIds].map(id => sessionDraftKey(id, ''));
  const draftKeys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string =>
    key !== null && (scopes.some(scope => key.startsWith(scope)) || (options.includeProfile === true && key === profileDraftKey(code))));

  const updates = new Map<string, string | null>([
    [mockResetEpochKey, crypto.randomUUID()],
    [mockDatabaseKey, JSON.stringify(database)],
  ]);
  for (const key of draftKeys) updates.set(key, null);
  if (cachedGrant && currentCode === code) updates.set(accessKey, JSON.stringify({ grant: cachedGrant, sessionId: null }));
  const before = new Map([...updates.keys()].map(key => [key, storage.getItem(key)]));
  try {
    for (const [key, value] of updates) {
      if (value === null) storage.removeItem(key); else storage.setItem(key, value);
    }
  } catch (error) {
    // Restore the epoch last, so older gateway instances remain invalidated until
    // the original records are back. Never report a partially applied reset.
    const entries = [...before].reverse();
    for (const [key, value] of entries) {
      try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { /* Keep the original failure. */ }
    }
    throw error;
  }
  return { code, sessionsRemoved, draftsRemoved: draftKeys.length, profileRemoved };
}

declare global {
  interface Window { fcmDev?: { resetCode: (options?: ResetCodeOptions) => ResetCodeResult } }
}

export function installDevTools() {
  Object.defineProperty(window, 'fcmDev', { configurable: true, value: Object.freeze({
    resetCode(options?: ResetCodeOptions) {
      const result = resetLocalCode(sessionStorage, options);
      console.info(`Reset ${result.code}: removed ${result.sessionsRemoved} task session(s); ${options?.includeProfile ? 'Profile reset' : 'Profile retained'}.`);
      window.location.reload();
      return result;
    },
  }) });
}
