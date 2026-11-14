import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockGateway } from '../src/integration/mock';
import { mockDatabaseKey, mockResetEpochKey } from '../src/integration/mock';
import { resetLocalCode } from '../src/dev/tools';
import type { MaterialBundle } from '../src/content/types';

const emptyBundle: MaterialBundle = {
  schema_version: '1.0', bundle_revision: 'empty-bundle',
  shared: { welcome: 'Welcome', choice_prompt: '', confidence_prompt: '', confidence_scale: '', pre_prompt: '', probe_prompt: '', post_prompt: '', revision: 'shared-empty' },
  scenarios: [],
};

function resetStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
}

test('the empty development study accepts its placeholder code and exposes no tasks', async () => {
  resetStorage();
  const gateway = createMockGateway(async () => emptyBundle);
  await assert.rejects(gateway.verifyTestCode('old-code', 'code-1'), /recognise/);
  const grant = await gateway.verifyTestCode(' fcm-empty ', 'code-2');
  assert.equal(grant.testCode, 'FCM-EMPTY');
  assert.deepEqual(await gateway.getTasks(grant.accessToken), []);
  const profile = await gateway.getParticipantProfile(grant.accessToken);
  await gateway.submitProfile(grant.accessToken, 'profile-1', Object.fromEntries(profile.questions.map(q => [q.id, q.options[0].value])));
  await assert.rejects(gateway.startTask(grant.accessToken, 'task-not-yet-added', 'start-1'), /not assigned/);
});

test('local reset remains safe when the active study has no task sessions', () => {
  const values = new Map<string, string>([
    [mockDatabaseKey, JSON.stringify({ grants: { token: { codeKey: 'FCM-EMPTY', expiresAt: '2099-01-01', activeSessionId: null } }, sessions: {}, starts: {}, abandoned: {}, profiles: {} })],
    [mockResetEpochKey, 'old-epoch'],
    ['fcm.access.v1', JSON.stringify({ grant: { accessToken: 'token', testCode: 'FCM-EMPTY', expiresAt: '2099-01-01' }, sessionId: null })],
  ]);
  const storage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  } as unknown as Storage;
  assert.deepEqual(resetLocalCode(storage), { code: 'FCM-EMPTY', sessionsRemoved: 0, draftsRemoved: 0, profileRemoved: false });
  assert.notEqual(values.get(mockResetEpochKey), 'old-epoch');
  assert.throws(() => resetLocalCode(storage, { code: 'FCM-EN' }), /Unknown local development code/);
});
