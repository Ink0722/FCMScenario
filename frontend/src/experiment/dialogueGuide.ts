import { ui } from '../app/copy';
import type { DialoguePolicy } from '../integration/contracts';
import type { DialogueStatus } from './flow/reducer';

export function dialogueEndGuide(policy: DialoguePolicy, status: DialogueStatus): string {
  if (['queued', 'running', 'reconnecting', 'interrupted'].includes(status)) return ui.endWaitReply;
  if (policy.canEnd) {
    if (policy.probeRequired || status === 'probe') return ui.finishProbe;
    return status === 'waiting' ? ui.endWaitReply : ui.endGuide;
  }

  const minimum = policy.minTurnsBeforeEnd;
  const completed = policy.completedTurns;
  if (minimum !== undefined && Number.isInteger(minimum) && minimum > 0) {
    if (completed === undefined || completed === 0) return ui.endMinimum(minimum);
    if (Number.isInteger(completed) && completed > 0 && completed < minimum) return ui.endRemaining(minimum - completed);
  }
  return policy.probeRequired || status === 'probe' ? ui.finishProbe : ui.endLocked;
}
