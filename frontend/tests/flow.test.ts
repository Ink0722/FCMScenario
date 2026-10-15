import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer, validDecision } from '../src/experiment/flow/reducer';
import type { Session, Message } from '../src/integration/contracts';

const greeting: Message = { id: 'hello', role: 'assistant', text: 'hello', timestamp: '2026-10-07T00:00:00Z' };
const session: Session = { id: 'session', taskId: 'task-7k3m', taskNumber: 'TASK-7K3M', scenarioRevision: '1', sharedRevision: '2', uiVersion: '0.2.0', initialMessage: greeting, policy: { canEnd: false, probeRequired: false } };
function startDialogue() {
  let state = reducer(initialState, { type: 'SESSION_READY', session });
  return reducer(state, { type: 'DECISION_SAVED', stage: 'pre', decision: { choice: 'A', confidence: 0 }, policy: session.policy });
}
test('decisions accept endpoints, reject fractions and missing values', () => {
  assert.equal(validDecision({ choice: 'A', confidence: 0 }), true);
  assert.equal(validDecision({ choice: 'B', confidence: 100 }), true);
  for (const confidence of [-1, 101, 1.5, NaN, null as unknown as number])
    assert.equal(validDecision({ choice: 'A', confidence }), false);
});
test('initial judgment requires a session and illegal transitions cannot skip final judgment', () => {
  assert.equal(reducer(initialState, { type: 'DECISION_SAVED', stage: 'pre', decision: { choice: 'A', confidence: 0 }, policy: session.policy }).stage, 'pre');
  assert.equal(reducer(startDialogue(), { type: 'COMPLETED', receipt: 'x' }).stage, 'dialogue');
  assert.equal(reducer(startDialogue(), { type: 'DIALOGUE_ENDED' }).stage, 'dialogue');
});
test('waiting and probe block sending; probe results stay outside message history', () => {
  const user: Message = { ...greeting, id: 'user', role: 'user', text: 'question' };
  let state = startDialogue();
  state = reducer(state, { type: 'MESSAGE_SENT', message: user });
  const duplicate = reducer(state, { type: 'MESSAGE_SENT', message: user });
  assert.equal(duplicate.messages.length, 2);
  state = reducer(state, { type: 'MESSAGE_RECEIVED', message: greeting, policy: { canEnd: true, probeRequired: true } });
  assert.equal(state.dialogueStatus, 'probe');
  assert.equal(reducer(state, { type: 'CONFIRM_END' }).dialogueStatus, 'probe');
  const saved = reducer(state, { type: 'DECISION_SAVED', stage: 'probe', decision: { choice: 'B', confidence: 73 }, policy: { canEnd: true, probeRequired: false } });
  assert.equal(saved.dialogueStatus, 'ready');
  assert.deepEqual(saved.messages, state.messages);
  assert.equal(saved.decisions.probe?.confidence, 73);
});
test('failed messages recover and ending requires eligible policy and confirmation', () => {
  let state = startDialogue();
  assert.equal(reducer(state, { type: 'CONFIRM_END' }).dialogueStatus, 'ready');
  state = reducer(state, { type: 'MESSAGE_SENT', message: { ...greeting, id: 'pending', role: 'user' } });
  state = reducer(state, { type: 'MESSAGE_FAILED', messageId: 'pending' });
  assert.equal(state.dialogueStatus, 'ready');
  assert.equal(state.messages.some(m => m.id === 'pending'), false);
  state = reducer({ ...state, policy: { canEnd: true, probeRequired: false } }, { type: 'CONFIRM_END' });
  assert.equal(state.dialogueStatus, 'confirm');
  assert.equal(reducer(state, { type: 'CANCEL_END' }).stage, 'dialogue');
  assert.equal(reducer(state, { type: 'DIALOGUE_ENDED' }).stage, 'post');
  state = reducer(state, { type: 'DIALOGUE_ENDED' });
  state = reducer(state, { type: 'DECISION_SAVED', stage: 'post', decision: { choice: 'B', confidence: 80 }, policy: state.policy });
  assert.equal(state.stage, 'finishing');
  assert.equal(reducer(state, { type: 'COMPLETED', receipt: 'saved' }).stage, 'complete');
});
