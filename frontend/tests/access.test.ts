import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockGateway } from '../src/integration/mock';
import type { MaterialBundle, Scenario } from '../src/content/types';
import type { ExperimentGateway } from '../src/integration/contracts';

async function fillProfile(gateway: ExperimentGateway, token: string) {
  const { questions } = await gateway.getParticipantProfile(token);
  await gateway.submitProfile(token, 'profile-1', Object.fromEntries(questions.map(q => [q.id, q.options[0].value])));
}

function resetStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
}
const bundle: MaterialBundle = {
  schema_version: '1', bundle_revision: 'bundle-original',
  shared: { welcome: '', choice_prompt: '', confidence_prompt: '', confidence_scale: '', pre_prompt: '', probe_prompt: '', post_prompt: '', revision: 'shared-original' },
  scenarios: Array.from({ length: 20 }, (_, i): Scenario => ({
    case_id: String(i + 1).padStart(2, '0'), scenario_id: `case-${i + 1}`, title: `Task ${i + 1}`, template: 'table',
    background: 'Original material', common_facts: [], comparison: [], additional_information: [], references: [], task: 'Choose independently', knowledge: [],
    options: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }], revision: 'scenario-original',
  })),
};

test('invalid codes and unassigned tasks cannot enter a test', async () => {
  resetStorage();
  let materialLoads = 0;
  const gateway = createMockGateway(async () => { materialLoads++; return bundle; });
  await assert.rejects(gateway.verifyTestCode('invalid', 'code-1'), /recognise/);
  assert.equal(materialLoads, 0);
  await assert.rejects(gateway.getTasks('invalid-token'), /no longer active/);
  await assert.rejects(gateway.getAccessGrant('invalid-token'), /no longer active/);
  assert.equal(materialLoads, 0);
  const grant = await gateway.verifyTestCode(' fcm-single ', 'code-2');
  assert.equal(grant.testCode, 'FCM-SINGLE');
  assert.deepEqual(await gateway.getAccessGrant(grant.accessToken), grant);
  const tasks = await gateway.getTasks(grant.accessToken);
  assert.equal(tasks.length, 1);
  await assert.rejects(gateway.startTask(grant.accessToken, 'task-7k3m', 'start-1'), /not assigned/);
});

test('starting a task locks its identity and repeated start requests keep one session', async () => {
  resetStorage();
  const gateway = createMockGateway(async () => bundle);
  const grant = await gateway.verifyTestCode('FCM-2026', 'code-1');
  await fillProfile(gateway, grant.accessToken);
  const tasks = await gateway.getTasks(grant.accessToken);
  const started = await gateway.startTask(grant.accessToken, tasks[0].id, 'start-1');
  const retry = await gateway.startTask(grant.accessToken, tasks[0].id, 'start-1');
  assert.equal(retry.session.id, started.session.id);
  assert.equal((await gateway.startTask(grant.accessToken, tasks[0].id, 'start-2')).session.id, started.session.id);
  await assert.rejects(gateway.startTask(grant.accessToken, tasks[1].id, 'start-3'), /cannot switch/);
  await assert.rejects(gateway.startTask(grant.accessToken, tasks[1].id, 'start-1'), /original task/);
  assert.equal((await gateway.getTasks(grant.accessToken))[0].status, 'in_progress');
  const other = await gateway.verifyTestCode('FCM-SINGLE', 'code-2');
  await assert.rejects(gateway.resumeTask(other.accessToken, started.session.id), /cannot access/);
});

test('refresh restores saved decisions, messages and frozen material versions', async () => {
  resetStorage();
  const gateway = createMockGateway(async () => bundle);
  const grant = await gateway.verifyTestCode('FCM-2026', 'code-1');
  await fillProfile(gateway, grant.accessToken);
  const started = await gateway.startTask(grant.accessToken, 'task-7k3m', 'start-1');
  const decision = { choice: 'A' as const, confidence: 42 };
  await gateway.submitDecision(started.session.id, { requestId: 'decision-1', stage: 'pre', decision, timestamp: new Date().toISOString() });
  const message = { id: 'message-1', role: 'user' as const, text: 'Check the fees', timestamp: new Date().toISOString() };
  await gateway.sendMessage(started.session.id, message);
  const refreshed = createMockGateway(async () => { throw new Error('A resume should not load new material'); });
  const restored = await refreshed.resumeTask(grant.accessToken, started.session.id);
  assert.equal(restored.progress.stage, 'dialogue');
  assert.deepEqual(restored.progress.decisions.pre, decision);
  assert.equal(restored.progress.messages.length, 3);
  assert.deepEqual(restored.progress.messages[1], message);
  assert.equal(restored.bundleRevision, 'bundle-original');
  assert.equal(restored.scenario.background, 'Original material');
});

test('abandoning an unfinished task discards saved progress and permits a fresh start', async () => {
  resetStorage();
  const gateway = createMockGateway(async () => bundle);
  const grant = await gateway.verifyTestCode('FCM-2026', 'code-1');
  await fillProfile(gateway, grant.accessToken);
  const started = await gateway.startTask(grant.accessToken, 'task-7k3m', 'start-1');
  await gateway.submitDecision(started.session.id, { requestId: 'decision-1', stage: 'pre', decision: { choice: 'A', confidence: 42 }, timestamp: new Date().toISOString() });
  await gateway.sendMessage(started.session.id, { id: 'message-1', role: 'user', text: 'Question', timestamp: new Date().toISOString() });
  const other = await gateway.verifyTestCode('FCM-SINGLE', 'code-2');
  await assert.rejects(gateway.abandonTask(other.accessToken, started.session.id, 'abandon-foreign'), /cannot clear/);
  await gateway.abandonTask(grant.accessToken, started.session.id, 'abandon-1');
  const refreshed = createMockGateway(async () => bundle);
  await refreshed.abandonTask(grant.accessToken, started.session.id, 'abandon-1');
  await assert.rejects(refreshed.resumeTask(grant.accessToken, started.session.id), /could not find/);
  assert.equal((await refreshed.getTasks(grant.accessToken))[0].status, 'available');
  await assert.rejects(refreshed.startTask(grant.accessToken, 'task-7k3m', 'start-1'), /has been cleared/);
  const restarted = await refreshed.startTask(grant.accessToken, 'task-7k3m', 'start-2');
  assert.notEqual(restarted.session.id, started.session.id);
  assert.equal(restarted.progress.stage, 'pre');
  assert.deepEqual(restarted.progress.decisions, {});
  assert.deepEqual(restarted.progress.messages, []);
});

test('profiles belong to the code, survive task abandonment and new grants, and are submitted once', async () => {
  resetStorage();
  const gateway = createMockGateway(async () => bundle);
  const grant = await gateway.verifyTestCode('FCM-2026', 'code-1');
  assert.equal((await gateway.getParticipantProfile(grant.accessToken)).answers, null);
  await assert.rejects(gateway.startTask(grant.accessToken, 'task-7k3m', 'start-1'), /background questionnaire/);
  await assert.rejects(gateway.submitProfile(grant.accessToken, 'profile-invalid', {}), /required/);
  await fillProfile(gateway, grant.accessToken);
  const profile = await gateway.getParticipantProfile(grant.accessToken);
  assert.ok(profile.answers);
  await gateway.submitProfile(grant.accessToken, 'profile-retry', {});
  assert.deepEqual((await gateway.getParticipantProfile(grant.accessToken)).answers, profile.answers);
  const first = await gateway.startTask(grant.accessToken, 'task-7k3m', 'start-1');
  assert.equal('profileAnswers' in first.progress, false);
  await gateway.abandonTask(grant.accessToken, first.session.id, 'abandon-1');
  assert.deepEqual((await gateway.getParticipantProfile(grant.accessToken)).answers, profile.answers);
  const second = await gateway.startTask(grant.accessToken, 'task-4p8r', 'start-2');
  assert.equal(second.progress.stage, 'pre');
  await gateway.abandonTask(grant.accessToken, second.session.id, 'abandon-2');
  const other = await gateway.verifyTestCode('FCM-SINGLE', 'code-2');
  assert.equal((await gateway.getParticipantProfile(other.accessToken)).answers, null);
  await assert.rejects(gateway.getParticipantProfile('invalid'), /no longer active/);
  const stored = JSON.parse(sessionStorage.getItem('fcm.mock-service.v2')!);
  stored.grants[grant.accessToken].expiresAt = '2000-01-01T00:00:00Z';
  sessionStorage.setItem('fcm.mock-service.v2', JSON.stringify(stored));
  const refreshed = createMockGateway(async () => bundle);
  const newGrant = await refreshed.verifyTestCode(' fcm-2026 ', 'code-3');
  assert.notEqual(newGrant.accessToken, grant.accessToken);
  assert.deepEqual((await refreshed.getParticipantProfile(newGrant.accessToken)).answers, profile.answers);
});

test('returning home after completion preserves the result and completed task status', async () => {
  resetStorage();
  const gateway = createMockGateway(async () => bundle);
  const grant = await gateway.verifyTestCode('FCM-2026', 'code-1');
  await fillProfile(gateway, grant.accessToken);
  const started = await gateway.startTask(grant.accessToken, 'task-7k3m', 'start-1');
  const id = started.session.id;
  const decision = { choice: 'A' as const, confidence: 42 };
  await gateway.submitDecision(id, { requestId: 'pre-1', stage: 'pre', decision, timestamp: new Date().toISOString() });
  for (let i = 0; i < 3; i++) await gateway.sendMessage(id, { id: `message-${i}`, role: 'user', text: 'Question', timestamp: new Date().toISOString() });
  await gateway.endDialogue(id, 'end-1');
  await gateway.submitDecision(id, { requestId: 'post-1', stage: 'post', decision, timestamp: new Date().toISOString() });
  const result = await gateway.completeSession(id, 'complete-1');
  await gateway.abandonTask(grant.accessToken, id, 'return-1');
  const restored = await createMockGateway(async () => bundle).resumeTask(grant.accessToken, id);
  assert.equal(restored.progress.stage, 'complete');
  assert.equal(restored.progress.receipt, result.receipt);
  assert.deepEqual(restored.progress.decisions.post, decision);
  assert.equal((await gateway.getTasks(grant.accessToken))[0].status, 'completed');
});
