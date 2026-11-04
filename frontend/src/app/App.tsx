import { ui } from './copy';
import { useEffect, useRef, useState } from 'react';
import { createHttpGateway } from '../integration/http';
import type { ExperimentGateway, StartedTask } from '../integration/contracts';
import { useAccess } from '../access/useAccess';
import { useInstructions } from '../access/useInstructions';
import { CodeScreen } from '../access/CodeScreen';
import { TaskSelectionScreen } from '../access/TaskSelectionScreen';
import { ProfileScreen } from '../access/ProfileScreen';
import { useExperiment } from '../experiment/state/useExperiment';
import { DecisionScreen } from '../experiment/screens/DecisionScreen';
import { DialogueScreen } from '../experiment/screens/DialogueScreen';
import { ExperimentHeader, SiteHeader } from './ExperimentLayout';
import { ReturnHomeDialog } from './ReturnHomeDialog';
import { sessionDraftRevision } from './drafts';
import { StudyIllustration } from './StudyIllustration';

export function App() {
  const [gateway, setGateway] = useState<ExperimentGateway | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (import.meta.env.DEV && import.meta.env.VITE_GATEWAY_MODE !== 'http') {
        const { createMockGateway } = await import('../integration/mock');
        if (active) setGateway(createMockGateway());
      } else if (active) setGateway(createHttpGateway());
    };
    void load().catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to start the experiment.'); });
    return () => { active = false; };
  }, []);
  if (!gateway) return <><SiteHeader /><main className="load-screen" role={error ? 'alert' : 'status'}>{error || ui.preparing}</main></>;
  return <ConnectedApp gateway={gateway} />;
}
function ConnectedApp({ gateway }: { gateway: ExperimentGateway }) {
  const access = useAccess(gateway);
  const instructions = useInstructions(gateway);
  useEffect(() => { window.scrollTo(0, 0); }, [access.state.stage]);
  if (access.state.stage === 'loading') return <><SiteHeader /><main id="main-content" className="load-screen" role="status"><h1>{ui.preparing}</h1>{access.error && <><p role="alert">{access.error}</p><button className="button primary" onClick={access.retryRestore}>Reconnect</button></>}</main></>;
  if (access.state.stage === 'code') return <CodeScreen busy={access.busy} error={access.error} onSubmit={access.verifyCode} instructions={instructions} />;
  if (access.state.stage === 'profile') return <ProfileScreen profileId={access.state.grant.participantId} profile={access.state.profile} busy={access.busy} error={access.error} onSubmit={access.submitProfile} onReturnToTasks={access.returnFromProfile} />;
  if (access.state.stage === 'tasks') return <TaskSelectionScreen testCode={access.state.grant.codeDisplay} tasks={access.state.tasks} profileComplete={access.state.profile.answers !== null} onOpenProfile={access.openProfile} busy={access.busy} error={access.error} onStart={access.start} onChangeCode={access.changeCode} instructions={instructions} />;
  return <div className="app-shell"><Experiment key={access.state.started.session.id} started={access.state.started} gateway={gateway}
    entryBusy={access.busy} entryError={access.error} onReturnToTasks={access.returnToTasks} onReturnHome={access.returnHome} /></div>;
}
function Experiment({ started, gateway, entryBusy, entryError, onReturnToTasks, onReturnHome }: {
  started: StartedTask; gateway: ExperimentGateway; entryBusy: boolean; entryError: string; onReturnToTasks: () => void; onReturnHome: () => Promise<boolean>;
}) {
  const { scenario, shared, task } = started;
  const { state, dispatch, busy, error, saveDecision, send, reconnect, end, complete, recordEvent } = useExperiment(started, gateway);
  const heading = useRef<HTMLHeadingElement>(null);
  const [confirmReturn, setConfirmReturn] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); heading.current?.focus(); }, [state.stage]);
  const workspace = state.stage === 'pre' || state.stage === 'post' || state.stage === 'dialogue';
  const headerBusy = entryBusy || state.dialogueStatus === 'confirm' || (busy && !['queued','running','reconnecting'].includes(state.dialogueStatus));
  return <><ExperimentHeader stage={state.stage} busy={headerBusy}
    onReturnHome={() => { if (state.stage === 'complete') void onReturnHome(); else setConfirmReturn(true); }} />
    {(state.stage === 'pre' || state.stage === 'post') && <DecisionScreen key={state.stage} stage={state.stage} scenario={scenario} shared={shared} taskNumber={task.number}
      sessionId={started.session.id} draftRevision={sessionDraftRevision(started)}
      busy={busy} error={error} onSubmit={d => { void saveDecision(state.stage === 'pre' ? 'pre' : 'post', d); }} onEvent={recordEvent} />}
    {state.stage === 'dialogue' && <DialogueScreen scenario={scenario} shared={shared} taskNumber={task.number} state={state} busy={busy} error={error}
      sessionId={started.session.id} draftRevision={sessionDraftRevision(started)}
      send={send} reconnect={() => { void reconnect(); }} saveProbe={d => { void saveDecision('probe', d); }} end={() => { void end(); }}
      confirmEnd={() => dispatch({ type: 'CONFIRM_END' })} cancelEnd={() => dispatch({ type: 'CANCEL_END' })} onEvent={recordEvent} />}
    {!workspace && <main id="main-content" className="page-main focused-page">
      {state.stage === 'finishing' && <section className="surface completion" aria-live="polite">
        <span className="task-number">{ui.taskNumber} {task.number}</span><h1 ref={heading} tabIndex={-1}>{error ? ui.finishRetry : ui.finishing}</h1>
        {error && <><p>{ui.finishRetryText}</p><div className="error-message" role="alert">{error}</div><button className="button primary" disabled={busy} onClick={() => { void complete(); }}>{ui.retry}</button></>}
      </section>}
      {state.stage === 'complete' && <section className="surface completion"><StudyIllustration variant="reading" className="completion-illustration" /><div className="completion-symbol" aria-hidden="true">✓</div>
        <span className="task-number">{ui.taskNumber} {task.number}</span><h1 ref={heading} tabIndex={-1}>{ui.taskComplete}</h1><p>{ui.taskThanks}</p><p>{ui.completionNext}</p>
        <button className="button secondary completion-return" disabled={entryBusy} onClick={onReturnToTasks}>{entryBusy ? ui.returning : ui.back}</button>
        {entryError && <div className="error-message" role="alert">{entryError}</div>}
      </section>}
    </main>}
    {!workspace && <footer className="site-footer"><span>{ui.brand}</span></footer>}
    {confirmReturn && <ReturnHomeDialog busy={entryBusy} error={entryError} onCancel={() => setConfirmReturn(false)} onConfirm={() => { void onReturnHome(); }} />}
  </>;
}
