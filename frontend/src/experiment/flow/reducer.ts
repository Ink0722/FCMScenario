import type { Decision, DecisionStage, DialoguePolicy, ExperimentStage, Message, Session, StartedTask } from '../../integration/contracts';

export type Stage = ExperimentStage;
export type DialogueStatus = 'ready' | 'waiting' | 'probe' | 'confirm';
export interface ExperimentState {
  stage: Stage;
  session: Session | null;
  dialogueStatus: DialogueStatus;
  policy: DialoguePolicy;
  messages: Message[];
  decisions: Partial<Record<DecisionStage, Decision>>;
  receipt: string;
}
export const initialState: ExperimentState = {
  stage: 'pre', session: null, dialogueStatus: 'ready',
  policy: { canEnd: false, probeRequired: false }, messages: [], decisions: {}, receipt: '',
};
export function stateFromStartedTask(started: StartedTask): ExperimentState {
  return { ...structuredClone(started.progress), session: structuredClone(started.session), policy: { ...started.session.policy } };
}
export type Action =
  | { type: 'SESSION_READY'; session: Session }
  | { type: 'DECISION_SAVED'; stage: DecisionStage; decision: Decision; policy: DialoguePolicy }
  | { type: 'MESSAGE_SENT'; message: Message }
  | { type: 'MESSAGE_RECEIVED'; message: Message; policy: DialoguePolicy }
  | { type: 'MESSAGE_FAILED'; messageId: string }
  | { type: 'CONFIRM_END' }
  | { type: 'CANCEL_END' }
  | { type: 'DIALOGUE_ENDED' }
  | { type: 'COMPLETED'; receipt: string };
export function validDecision(decision: Decision): boolean {
  return ['A', 'B'].includes(decision.choice) && Number.isInteger(decision.confidence)
    && decision.confidence >= 0 && decision.confidence <= 100;
}
export function reducer(state: ExperimentState, action: Action): ExperimentState {
  switch (action.type) {
    case 'SESSION_READY': return { ...state, session: action.session, policy: action.session.policy };
    case 'DECISION_SAVED': {
      if (!state.session || !validDecision(action.decision)) return state;
      const permitted = (action.stage === 'pre' && state.stage === 'pre')
        || (action.stage === 'post' && state.stage === 'post')
        || (action.stage === 'probe' && state.stage === 'dialogue' && state.dialogueStatus === 'probe');
      if (!permitted) return state;
      return { ...state, decisions: { ...state.decisions, [action.stage]: action.decision }, policy: action.policy,
        stage: action.stage === 'pre' ? 'dialogue' : action.stage === 'post' ? 'finishing' : 'dialogue',
        messages: action.stage === 'pre' ? [state.session!.initialMessage] : state.messages,
        dialogueStatus: action.policy.probeRequired ? 'probe' : 'ready' };
    }
    case 'MESSAGE_SENT': return state.stage === 'dialogue' && state.dialogueStatus === 'ready'
      ? { ...state, messages: [...state.messages, action.message], dialogueStatus: 'waiting' } : state;
    case 'MESSAGE_RECEIVED': return state.stage === 'dialogue' && state.dialogueStatus === 'waiting'
      ? { ...state, messages: [...state.messages, action.message], policy: action.policy,
        dialogueStatus: action.policy.probeRequired ? 'probe' : 'ready' } : state;
    case 'MESSAGE_FAILED': return state.dialogueStatus === 'waiting' ? {
      ...state, messages: state.messages.filter(m => m.id !== action.messageId), dialogueStatus: 'ready',
    } : state;
    case 'CONFIRM_END': return state.stage === 'dialogue' && state.dialogueStatus === 'ready' && state.policy.canEnd
      ? { ...state, dialogueStatus: 'confirm' } : state;
    case 'CANCEL_END': return state.dialogueStatus === 'confirm' ? { ...state, dialogueStatus: 'ready' } : state;
    case 'DIALOGUE_ENDED': return state.stage === 'dialogue' && state.dialogueStatus === 'confirm'
      ? { ...state, stage: 'post', dialogueStatus: 'ready' } : state;
    case 'COMPLETED': return state.stage === 'finishing' && state.decisions.post ? { ...state, stage: 'complete', receipt: action.receipt } : state;
  }
}
