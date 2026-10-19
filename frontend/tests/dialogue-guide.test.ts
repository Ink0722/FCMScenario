import assert from 'node:assert/strict';
import test from 'node:test';
import { ui } from '../src/app/copy';
import { dialogueEndGuide } from '../src/experiment/dialogueGuide';

test('dialogue guidance uses the supplied minimum and confirmed completed exchanges', () => {
  const policy = { canEnd: false, probeRequired: false, minTurnsBeforeEnd: 5, completedTurns: 0 };
  assert.equal(dialogueEndGuide(policy, 'ready'), ui.endMinimum(5));
  assert.equal(dialogueEndGuide({ ...policy, completedTurns: 2 }, 'ready'), ui.endRemaining(3));
  assert.equal(dialogueEndGuide({ ...policy, completedTurns: 4 }, 'waiting'), ui.endRemaining(1));
  assert.equal(dialogueEndGuide({ ...policy, probeRequired: true, completedTurns: 4 }, 'probe'), ui.endRemaining(1));
});

test('other blocking conditions do not announce an available final choice', () => {
  const policy = { canEnd: true, probeRequired: false, minTurnsBeforeEnd: 3, completedTurns: 3 };
  assert.equal(dialogueEndGuide(policy, 'ready'), ui.endGuide);
  assert.equal(dialogueEndGuide(policy, 'waiting'), ui.endWaitReply);
  assert.equal(dialogueEndGuide({ ...policy, probeRequired: true }, 'probe'), ui.finishProbe);
  assert.equal(dialogueEndGuide({ ...policy, canEnd: false }, 'ready'), ui.endLocked);
});

test('older policy payloads remain usable without inventing a minimum or remaining count', () => {
  assert.equal(dialogueEndGuide({ canEnd: false, probeRequired: false }, 'ready'), ui.endLocked);
  assert.equal(dialogueEndGuide({ canEnd: false, probeRequired: false, minTurnsBeforeEnd: 4 }, 'ready'), ui.endMinimum(4));
  assert.equal(dialogueEndGuide({ canEnd: true, probeRequired: false }, 'ready'), ui.endGuide);
});
