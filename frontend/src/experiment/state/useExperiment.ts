import { errors, UI_VERSION, UI_LOCALE } from '../../app/copy';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { Decision, DecisionStage, ExperimentEvent, ExperimentGateway, Message, StartedTask } from '../../integration/contracts';
import { reducer, stateFromStartedTask, validDecision } from '../flow/reducer';

export function useExperiment(started: StartedTask, gateway: ExperimentGateway) {
  const [state, dispatch] = useReducer(reducer, started, stateFromStartedTask);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const pendingMessage = useRef<Message | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const idFor = (key: string) => {
    if (!requestIds.current.has(key)) requestIds.current.set(key, crypto.randomUUID());
    return requestIds.current.get(key)!;
  };
  const attempt = async (operation: () => Promise<void>) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try { await operation(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : errors.operation); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const recordEvent = async (kind: ExperimentEvent['kind'], details: ExperimentEvent['details']) => {
    if (!state.session) return;
    try { await gateway.recordEvent(state.session.id, { kind, details, id: crypto.randomUUID(), timestamp: new Date().toISOString() }); }
    catch { setError(errors.eventSave); }
  };
  useEffect(() => {
    if (state.session) void recordEvent('stage_view', { stage: state.stage, ui_version: UI_VERSION, ui_locale: UI_LOCALE });
  }, [state.stage, state.session?.id]);
  const saveDecision = (stage: DecisionStage, decision: Decision) => attempt(async () => {
    if (!state.session || !validDecision(decision)) throw new Error(errors.decisionRequired);
    const policy = await gateway.submitDecision(state.session.id, {
      requestId: idFor(`decision-${stage}`), stage, decision, timestamp: new Date().toISOString(),
    });
    dispatch({ type: 'DECISION_SAVED', stage, decision, policy });
  });
  const send = (text: string) => attempt(async () => {
    if (!state.session || state.stage !== 'dialogue' || state.dialogueStatus !== 'ready' || !text.trim()) return;
    const message = pendingMessage.current?.text === text.trim() ? pendingMessage.current : {
      id: crypto.randomUUID(), role: 'user' as const, text: text.trim(), timestamp: new Date().toISOString(),
    };
    pendingMessage.current = message;
    dispatch({ type: 'MESSAGE_SENT', message });
    try {
      const result = await gateway.sendMessage(state.session.id, message);
      dispatch({ type: 'MESSAGE_RECEIVED', ...result });
      pendingMessage.current = null;
    } catch (e) { dispatch({ type: 'MESSAGE_FAILED', messageId: message.id }); throw e; }
  });
  const end = () => attempt(async () => {
    if (!state.session) return;
    await gateway.endDialogue(state.session.id, idFor('end'));
    await recordEvent('dialogue_end', { user_initiated: true });
    dispatch({ type: 'DIALOGUE_ENDED' });
  });
  const complete = () => attempt(async () => {
    if (!state.session || state.stage !== 'finishing') return;
    const result = await gateway.completeSession(state.session.id, idFor('complete'));
    dispatch({ type: 'COMPLETED', receipt: result.receipt });
  });
  useEffect(() => {
    if (state.stage === 'finishing') void complete();
  }, [state.stage, state.session?.id]);
  return { state, dispatch, busy, error, saveDecision, send, end, complete, recordEvent };
}
