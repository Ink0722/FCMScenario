import type { Choice, Message, StartedTask } from '../integration/contracts';

// Drafts are tab-local UI state, never submitted responses or Agent context.
const prefix = 'fcm.draft.v1:';
const lifetime = 24 * 60 * 60 * 1000;
export const sessionDraftKey = (id: string, field: string) => `${prefix}session:${encodeURIComponent(id)}:${field}`;
export const profileDraftKey = (code: string) => `${prefix}profile:${encodeURIComponent(code.trim().toUpperCase())}:answers`;
export const sessionDraftRevision = (started: StartedTask) => `${started.scenario.revision}:${started.shared.revision}`;

export interface DecisionDraft { choice: Choice | null; confidenceText: string }
export const emptyDecisionDraft: DecisionDraft = { choice: null, confidenceText: '' };
export function isDecisionDraft(value: unknown): value is DecisionDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<DecisionDraft>;
  return (draft.choice === null || draft.choice === 'A' || draft.choice === 'B') && typeof draft.confidenceText === 'string';
}
export const isMessageDraft = (value: unknown): value is string => typeof value === 'string';
export function isMessageAttempt(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<Message>;
  return message.role === 'user' && typeof message.id === 'string' && typeof message.text === 'string' && typeof message.timestamp === 'string';
}

export function readDraft<T>(key: string, revision: string, valid: (value: unknown) => value is T): T | null {
  try {
    const record = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (record?.version === 1 && record.revision === revision && Number.isFinite(record.updatedAt)
      && Date.now() - record.updatedAt >= 0 && Date.now() - record.updatedAt < lifetime && valid(record.value)) return record.value;
    clearDraft(key);
  } catch { clearDraft(key); }
  return null;
}
export function writeDraft<T>(key: string, revision: string, value: T): boolean {
  try {
    sessionStorage.setItem(key, JSON.stringify({ version: 1, revision, updatedAt: Date.now(), value }));
    return true;
  } catch { return false; }
}
export function clearDraft(key: string): boolean {
  try { sessionStorage.removeItem(key); return true; } catch { return false; }
}
export function clearSessionDrafts(id: string) {
  const scope = sessionDraftKey(id, '');
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i));
    for (const key of keys) if (key?.startsWith(scope)) clearDraft(key);
  } catch { /* A blocked storage area must not prevent leaving a task. */ }
}

// Use authoritative progress to resolve a reload after acceptance but before
// the UI received the response. Match message IDs, never repeated message text.
export function reconcileSessionDrafts(started: StartedTask) {
  const id = started.session.id;
  if (started.progress.stage === 'complete') { clearSessionDrafts(id); return; }
  for (const stage of ['pre', 'probe', 'post'] as const) {
    if (started.progress.decisions[stage]) clearDraft(sessionDraftKey(id, stage));
  }
  const attempt = readDraft(sessionDraftKey(id, 'message-request'), sessionDraftRevision(started), isMessageAttempt);
  if (started.progress.stage !== 'dialogue' || (attempt && started.progress.messages.some(message => message.id === attempt.id))) {
    clearDraft(sessionDraftKey(id, 'message'));
    clearDraft(sessionDraftKey(id, 'message-request'));
  }
}
