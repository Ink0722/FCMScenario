import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  clearSessionDrafts, isDecisionDraft, isMessageDraft, profileDraftKey, readDraft,
  reconcileSessionDrafts, sessionDraftKey, sessionDraftRevision, writeDraft,
} from '../src/app/drafts';
import type { StartedTask } from '../src/integration/contracts';

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
});
function started(): StartedTask {
  // Only the authoritative session fields used by reconciliation are needed.
  return { session: { id: 'session-1' }, scenario: { revision: 'case-1' }, shared: { revision: 'copy-1' },
    progress: { stage: 'dialogue', dialogueStatus: 'ready', messages: [], decisions: {}, receipt: '' } } as StartedTask;
}

test('drafts stay isolated by session, decision stage and material revision', () => {
  const pre = sessionDraftKey('one', 'pre');
  const post = sessionDraftKey('one', 'post');
  const other = sessionDraftKey('two', 'pre');
  const value = { choice: 'B' as const, confidenceText: '63' };
  assert.equal(writeDraft(pre, 'r1', value), true);
  assert.deepEqual(readDraft(pre, 'r1', isDecisionDraft), value);
  assert.equal(readDraft(post, 'r1', isDecisionDraft), null);
  assert.equal(readDraft(other, 'r1', isDecisionDraft), null);
  assert.equal(readDraft(pre, 'r2', isDecisionDraft), null);
  assert.equal(values.has(pre), false);
  assert.equal(profileDraftKey(' fcm-2026 '), profileDraftKey('FCM-2026'));
});

test('incomplete and invalid confidence text is restored without coercion or submission', () => {
  const key = sessionDraftKey('one', 'pre');
  for (const confidenceText of ['', '-1', '2.5', '101', '0']) {
    const value = { choice: null, confidenceText };
    writeDraft(key, 'r1', value);
    assert.deepEqual(readDraft(key, 'r1', isDecisionDraft), value);
  }
  writeDraft(key, 'r1', { choice: 'C', confidenceText: '50' });
  assert.equal(readDraft(key, 'r1', isDecisionDraft), null);
});

test('expired, corrupt, future-dated and wrong-version drafts are safely discarded', () => {
  const key = sessionDraftKey('one', 'message');
  for (const data of [
    '{broken',
    JSON.stringify({ version: 1, revision: 'r', value: 'old', updatedAt: Date.now() - 25 * 60 * 60 * 1000 }),
    JSON.stringify({ version: 1, revision: 'r', value: 'future', updatedAt: Date.now() + 60_000 }),
    JSON.stringify({ version: 2, revision: 'r', value: 'other', updatedAt: Date.now() }),
  ]) {
    values.set(key, data);
    assert.equal(readDraft(key, 'r', isMessageDraft), null);
    assert.equal(values.has(key), false);
  }
});

test('discarding a task clears its drafts while preserving other tasks and the profile', () => {
  const profile = profileDraftKey('FCM-2026');
  const other = sessionDraftKey('one:other', 'pre');
  for (const field of ['pre', 'probe', 'post', 'message', 'message-request']) writeDraft(sessionDraftKey('one', field), 'r', 'draft');
  writeDraft(profile, 'r', { device: 'computer' });
  writeDraft(other, 'r', 'another task');
  values.set('fcm.mock-service.v2', 'submitted responses');
  clearSessionDrafts('one');
  assert.deepEqual([...values.keys()].sort(), [profile, other, 'fcm.mock-service.v2'].sort());
});

test('accepted decisions are reconciled without copying them into another stage', () => {
  const task = started();
  const revision = sessionDraftRevision(task);
  writeDraft(sessionDraftKey(task.session.id, 'pre'), revision, { choice: 'A', confidenceText: '42' });
  task.progress.decisions.pre = { choice: 'A', confidence: 42 };
  reconcileSessionDrafts(task);
  assert.equal(readDraft(sessionDraftKey(task.session.id, 'pre'), revision, isDecisionDraft), null);
  assert.equal(readDraft(sessionDraftKey(task.session.id, 'post'), revision, isDecisionDraft), null);
});

test('message recovery matches the request ID and preserves an intentionally repeated message', () => {
  const task = started();
  const revision = sessionDraftRevision(task);
  const request = { id: 'request-1', role: 'user' as const, text: 'Same question', timestamp: '2026-10-18T00:00:00Z' };
  writeDraft(sessionDraftKey(task.session.id, 'message'), revision, request.text);
  writeDraft(sessionDraftKey(task.session.id, 'message-request'), revision, request);
  task.progress.messages = [{ ...request, id: 'another-request' }];
  reconcileSessionDrafts(task);
  assert.equal(readDraft(sessionDraftKey(task.session.id, 'message'), revision, isMessageDraft), request.text);
  task.progress.messages.push(request);
  reconcileSessionDrafts(task);
  assert.equal(readDraft(sessionDraftKey(task.session.id, 'message'), revision, isMessageDraft), null);
  assert.equal(values.has(sessionDraftKey(task.session.id, 'message-request')), false);
});

test('completion removes session drafts without changing submitted results', () => {
  const task = started();
  writeDraft(sessionDraftKey(task.session.id, 'post'), sessionDraftRevision(task), { choice: 'B', confidenceText: '0' });
  task.progress.stage = 'complete';
  task.progress.decisions.post = { choice: 'B', confidence: 0 };
  reconcileSessionDrafts(task);
  assert.equal(values.size, 0);
  assert.deepEqual(task.progress.decisions.post, { choice: 'B', confidence: 0 });
});

test('blocked or full storage never throws or reports a successful draft write', () => {
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
  assert.equal(writeDraft('key', 'r', 'text'), false);
  assert.equal(readDraft('key', 'r', isMessageDraft), null);
  assert.doesNotThrow(() => clearSessionDrafts('one'));
});
