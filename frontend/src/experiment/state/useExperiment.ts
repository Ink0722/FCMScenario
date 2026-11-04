import { errors, UI_VERSION, UI_LOCALE } from '../../app/copy';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { Decision, DecisionStage, ExperimentEvent, ExperimentGateway, Message, StartedTask, TurnGateway, TurnSnapshot } from '../../integration/contracts';
import { GatewayError } from '../../integration/errors';
import { reducer, stateFromStartedTask, validDecision } from '../flow/reducer';
import { clearDraft, clearSessionDrafts, isMessageAttempt, readDraft, sessionDraftKey, sessionDraftRevision, writeDraft } from '../../app/drafts';

export function useExperiment(started: StartedTask, gateway: ExperimentGateway) {
  const [state, dispatch] = useReducer(reducer, started, stateFromStartedTask);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const draftRevision = sessionDraftRevision(started);
  const keyFor = (field: string) => sessionDraftKey(started.session.id, field);
  const [initialAttempt] = useState(() => readDraft(keyFor('message-request'), draftRevision, isMessageAttempt));
  const pendingMessage = useRef<Message | null>(initialAttempt);
  const stream = useRef<AbortController | null>(null);
  useEffect(() => () => stream.current?.abort(), []);
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
    clearDraft(keyFor(stage));
    dispatch({ type: 'DECISION_SAVED', stage, decision, policy });
  });
  const send = (text: string) => attempt(async () => {
    if (!state.session || state.stage !== 'dialogue' || state.dialogueStatus !== 'ready' || state.policy.canSend === false || !text.trim()) return;
    const message = pendingMessage.current?.text === text.trim() ? pendingMessage.current : {
      id: crypto.randomUUID(), role: 'user' as const, text: text.trim(), timestamp: new Date().toISOString(),
    };
    pendingMessage.current = message;
    writeDraft(keyFor('message-request'), draftRevision, message);
    dispatch({ type: 'MESSAGE_SENT', message });
    try {
      stream.current?.abort();
      const controller = new AbortController(); stream.current = controller;
      const result = await gateway.sendMessage(state.session.id, message, snapshot => {
        if (!controller.signal.aborted) dispatch({ type: 'TURN_SNAPSHOT', snapshot });
      }, controller.signal);
      clearDraft(keyFor('message'));
      clearDraft(keyFor('message-request'));
      dispatch({ type: 'MESSAGE_RECEIVED', ...result });
      pendingMessage.current = null;
    } catch (e) {
      if (stream.current?.signal.aborted) return;
      if (e instanceof GatewayError && (e.status === 0 || e.code === 'turn_interrupted')) dispatch({ type: 'CONNECTION_LOST' });
      else dispatch({ type: 'MESSAGE_FAILED', messageId: message.id });
      throw e;
    }
  });
  const reconnect = () => attempt(async () => {
    const transport = gateway as ExperimentGateway & Partial<TurnGateway>;
    const active = state.activeTurn ?? started.progress.activeTurn;
    stream.current?.abort();
    const controller = new AbortController(); stream.current = controller;
    const update = (snapshot: TurnSnapshot) => { if (!controller.signal.aborted) dispatch({ type: 'TURN_SNAPSHOT', snapshot }); };
    try {
      if (active && transport.observeTurn) {
        const result = await transport.observeTurn(started.session.id, active.turnId, update, controller.signal);
        if (result.status !== 'completed') throw new Error(result.error ?? 'This reply was interrupted. Return to the task list to start a new attempt.');
      } else if (pendingMessage.current) {
        await gateway.sendMessage(started.session.id, pendingMessage.current, update, controller.signal);
      } else throw new Error('Reload the page to restore the latest saved progress.');
      clearDraft(keyFor('message')); clearDraft(keyFor('message-request')); pendingMessage.current = null;
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof GatewayError && error.status === 0) dispatch({ type: 'CONNECTION_LOST' });
        throw error;
      }
    }
  });
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active && started.progress.activeTurn) void reconnect(); });
    return () => { active = false; stream.current?.abort(); };
  }, [gateway, started.session.id]);
  const end = () => attempt(async () => {
    if (!state.session) return;
    await gateway.endDialogue(state.session.id, idFor('end'));
    clearDraft(keyFor('message'));
    clearDraft(keyFor('message-request'));
    await recordEvent('dialogue_end', { user_initiated: true });
    dispatch({ type: 'DIALOGUE_ENDED' });
  });
  const complete = () => attempt(async () => {
    if (!state.session || state.stage !== 'finishing') return;
    const result = await gateway.completeSession(state.session.id, idFor('complete'));
    clearSessionDrafts(state.session.id);
    dispatch({ type: 'COMPLETED', receipt: result.receipt });
  });
  useEffect(() => {
    if (state.stage === 'finishing') void complete();
  }, [state.stage, state.session?.id]);
  return { state, dispatch, busy, error, saveDecision, send, reconnect, end, complete, recordEvent };
}
