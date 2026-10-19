import assert from 'node:assert/strict';
import test from 'node:test';
import { resetLocalCode } from '../src/dev/tools';
import { mockDatabaseKey, mockResetEpochKey } from '../src/integration/mock';
import { profileDraftKey, sessionDraftKey } from '../src/app/drafts';

function fixture() {
  const database = {
    grants: {
      current: { codeKey: 'FCM-EN', expiresAt: '2099-01-01', activeSessionId: 'session-one' },
      expired: { codeKey: 'FCM-EN', expiresAt: '2000-01-01', activeSessionId: null },
      other: { codeKey: 'FCM-2026', expiresAt: '2099-01-01', activeSessionId: 'other-session' },
    },
    sessions: {
      'session-one': { accessToken: 'current', started: { task: { id: 'task-7k3m' }, progress: { stage: 'dialogue', decisions: { pre: { choice: 'A', confidence: 70 } } } } },
      'session-two': { accessToken: 'expired', started: { task: { id: 'task-7k3m' }, progress: { stage: 'complete' } } },
      'other-session': { accessToken: 'other', started: { task: { id: 'task-7k3m' }, progress: { stage: 'complete' } } },
    },
    starts: { 'current:request-one': 'session-one', 'expired:request-two': 'session-two', 'current:old-request': 'abandoned-session', 'other:request-three': 'other-session' },
    abandoned: { 'abandoned-session': 'current', 'other-abandoned': 'other' },
    profiles: { 'FCM-EN': { answers: { q1: 'a' }, submittedAt: '2026-10-18' }, 'FCM-2026': { answers: { q1: 'b' }, submittedAt: '2026-10-18' } },
  };
  const values = new Map<string, string>([
    [mockDatabaseKey, JSON.stringify(database)],
    [mockResetEpochKey, 'previous-epoch'],
    ['fcm.access.v1', JSON.stringify({ grant: { accessToken: 'current', testCode: 'FCM-EN', expiresAt: '2099-01-01' }, sessionId: 'session-one' })],
    [sessionDraftKey('session-one', 'pre'), 'choice'],
    [sessionDraftKey('session-one', 'message-request'), 'pending request'],
    [sessionDraftKey('session-two', 'post'), 'final choice'],
    [sessionDraftKey('abandoned-session', 'message'), 'abandoned message'],
    [sessionDraftKey('other-session', 'post'), 'other final choice'],
    [sessionDraftKey('session-one-suffix', 'pre'), 'unrelated prefix'],
    [profileDraftKey('FCM-EN'), 'profile draft'],
    [profileDraftKey('FCM-2026'), 'other profile draft'],
    ['unrelated-note', 'keep this'],
  ]);
  const storage: Storage = {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
    clear: () => { values.clear(); },
  };
  return { storage, database, values, read: () => JSON.parse(storage.getItem(mockDatabaseKey)!) as typeof database };
}

test('reset current code clears its tasks, drafts and locks while preserving Profile and other codes', () => {
  const { storage, database, read } = fixture();
  const result = resetLocalCode(storage);
  assert.deepEqual(result, { code: 'FCM-EN', sessionsRemoved: 2, draftsRemoved: 4, profileRemoved: false });
  const saved = read();
  assert.deepEqual(saved.sessions, { 'other-session': database.sessions['other-session'] });
  assert.deepEqual(saved.starts, { 'other:request-three': 'other-session' });
  assert.deepEqual(saved.abandoned, { 'other-abandoned': 'other' });
  assert.equal(saved.grants.current.activeSessionId, null);
  assert.equal(saved.grants.other.activeSessionId, 'other-session');
  assert.deepEqual(saved.profiles, database.profiles);
  assert.deepEqual(JSON.parse(storage.getItem('fcm.access.v1')!), {
    grant: { accessToken: 'current', testCode: 'FCM-EN', expiresAt: '2099-01-01' }, sessionId: null,
  });
  assert.equal(storage.getItem(profileDraftKey('FCM-EN')), 'profile draft');
  assert.equal(storage.getItem(sessionDraftKey('other-session', 'post')), 'other final choice');
  assert.equal(storage.getItem(sessionDraftKey('session-one-suffix', 'pre')), 'unrelated prefix');
  assert.equal(storage.getItem('unrelated-note'), 'keep this');
  assert.notEqual(storage.getItem(mockResetEpochKey), 'previous-epoch');
  assert.deepEqual(resetLocalCode(storage), { code: 'FCM-EN', sessionsRemoved: 0, draftsRemoved: 0, profileRemoved: false });
});

test('explicit full reset normalizes the code and preserves the other current code and its cache', () => {
  const { storage, read, database } = fixture();
  const cache = JSON.stringify({ grant: { accessToken: 'other', testCode: 'FCM-2026', expiresAt: '2099-01-01' }, sessionId: 'other-session' });
  storage.setItem('fcm.access.v1', cache);
  const result = resetLocalCode(storage, { code: '  fcm-en  ', includeProfile: true });
  assert.equal(result.profileRemoved, true);
  assert.equal(result.draftsRemoved, 5);
  assert.deepEqual(read().profiles, { 'FCM-2026': database.profiles['FCM-2026'] });
  assert.equal(storage.getItem(profileDraftKey('FCM-EN')), null);
  assert.equal(storage.getItem(profileDraftKey('FCM-2026')), 'other profile draft');
  assert.equal(storage.getItem('fcm.access.v1'), cache);
});

test('missing, unknown or malformed reset options make no changes', () => {
  const { storage, values } = fixture();
  const original = new Map(values);
  assert.throws(() => resetLocalCode(storage, { code: 'unknown' }), /Unknown local development code/);
  assert.throws(() => resetLocalCode(storage, { includeProfile: 'yes' } as never), /Use resetCode/);
  assert.throws(() => resetLocalCode(storage, 'FCM-EN' as never), /Use resetCode/);
  assert.deepEqual(values, original);
  storage.removeItem('fcm.access.v1');
  const withoutCache = new Map(values);
  assert.throws(() => resetLocalCode(storage), /Enter a participant code first/);
  assert.deepEqual(values, withoutCache);
  assert.equal(resetLocalCode(storage, { code: 'FCM-EN' }).sessionsRemoved, 2);
});

test('invalid stored data is not overwritten by a reset', () => {
  for (const invalid of ['{broken', '{}', 'null']) {
    const { storage, values } = fixture();
    storage.setItem(mockDatabaseKey, invalid);
    const original = new Map(values);
    assert.throws(() => resetLocalCode(storage));
    assert.deepEqual(values, original);
  }
});

test('a failed write or draft removal restores records and the reset epoch', () => {
  for (const failAt of ['database', 'draft']) {
    const { storage, values } = fixture();
    const original = new Map(values);
    const write = storage.setItem;
    const remove = storage.removeItem;
    let failed = false;
    storage.setItem = (key, value) => {
      if (failAt === 'database' && key === mockDatabaseKey && !failed) { failed = true; throw new Error('write blocked'); }
      write(key, value);
    };
    storage.removeItem = key => {
      if (failAt === 'draft' && key === sessionDraftKey('session-two', 'post') && !failed) { failed = true; throw new Error('removal blocked'); }
      remove(key);
    };
    assert.throws(() => resetLocalCode(storage, { includeProfile: true }), /blocked/);
    assert.deepEqual(values, original);
  }
});
