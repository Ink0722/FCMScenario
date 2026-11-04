import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpGateway } from '../src/integration/http';
import { GatewayError } from '../src/integration/errors';
import { initialState, reducer } from '../src/experiment/flow/reducer';
import type { Message, TurnSnapshot } from '../src/integration/contracts';

const message: Message = { id: 'message-1', role: 'user', text: 'Check the fees', timestamp: '2026-10-19T12:00:00Z' };
const snapshot = (status: TurnSnapshot['status'], revision: number): TurnSnapshot => ({
  turnId: message.id, status, revision, stage: status === 'completed' ? 'post' : 'dialogue',
  messages: [message, ...(status === 'queued' ? [] : [{ id: 'reply-1', role: 'assistant' as const, text: status === 'completed' ? '完成 reply' : '完成', timestamp: message.timestamp, status: status === 'completed' ? 'complete' as const : 'partial' as const }])],
  policy: { canEnd: false, probeRequired: false, completedTurns: status === 'completed' ? 20 : 19, maxTurns: 20, stage: status === 'completed' ? 'post' : 'dialogue' },
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('HTTP transport submits once, decodes split Unicode SSE and returns the saved final reply', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const updates: TurnSnapshot[] = [];
  const transport = (async (input, init) => {
    const url = String(input); calls.push({ url, method: init?.method ?? 'GET' });
    if (url.endsWith('/access/exchange')) return response({ accessToken: 'secret', expiresAt: 'later', participantId: 'participant', codeDisplay: 'FCM · visible' });
    assert.equal((init?.headers as Record<string,string>).Authorization, 'Bearer secret');
    if (url.endsWith('/events')) {
      const bytes = new TextEncoder().encode([snapshot('running', 2), snapshot('completed', 3)].map(item => `event: turn.snapshot\ndata: ${JSON.stringify(item)}\n\n`).join(''));
      return new Response(new ReadableStream({ start(controller) { for (let i=0;i<bytes.length;i+=7) controller.enqueue(bytes.slice(i,i+7)); controller.close(); } }));
    }
    return response(snapshot('queued', 1), init?.method === 'POST' ? 202 : 200);
  }) as typeof fetch;
  const gateway = createHttpGateway({ fetch: transport });
  await gateway.verifyTestCode('code', 'entry');
  const result = await gateway.sendMessage('attempt', message, item => updates.push(item));
  assert.equal(result.message.text, '完成 reply');
  assert.equal(result.policy.stage, 'post');
  assert.equal(calls.filter(call => call.url.endsWith('/turns') && call.method === 'POST').length, 1);
  assert.equal(updates.at(-1)?.status, 'completed');
});

test('a lost acceptance acknowledgement queries the original turn instead of creating another', async () => {
  let posts = 0;
  const gateway = createHttpGateway({ fetch: (async (_input, init) => {
    if (init?.method === 'POST') { posts++; throw new TypeError('offline after acceptance'); }
    return response(snapshot('completed', 3));
  }) as typeof fetch });
  assert.equal((await gateway.sendMessage('attempt', message)).message.id, 'reply-1');
  assert.equal(posts, 1);
});

test('HTTP errors distinguish credential revocation from temporary service failure', async () => {
  for (const status of [401,503]) {
    const gateway = createHttpGateway({ fetch: (async () => response({ code: 'test_error', message: 'Server message' }, status)) as typeof fetch });
    await assert.rejects(gateway.getTasks('token'), (error: unknown) => error instanceof GatewayError && error.invalidAccess === (status === 401) && error.message === 'Server message');
  }
});

test('turn snapshots merge by ID, ignore older revisions and accept the authoritative post stage', () => {
  let state = { ...initialState, stage: 'dialogue' as const, dialogueStatus: 'waiting' as const, messages: [message] };
  let updated = reducer(state, { type: 'TURN_SNAPSHOT', snapshot: snapshot('running', 2) });
  assert.equal(updated.messages.length, 2);
  assert.equal(updated.dialogueStatus, 'running');
  updated = reducer(updated, { type: 'TURN_SNAPSHOT', snapshot: snapshot('completed', 3) });
  assert.equal(updated.messages.length, 2);
  assert.equal(updated.stage, 'post');
  assert.equal(updated.activeTurn, null);
  assert.equal(reducer(updated, { type: 'TURN_SNAPSHOT', snapshot: snapshot('queued', 1) }), updated);
});
