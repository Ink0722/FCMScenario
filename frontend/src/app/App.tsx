import { useEffect, useMemo, useRef, useState } from 'react';
import { createMockGateway } from '../integration/mock';
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

export function App() {
  const gateway = useMemo(() => createMockGateway(), []);
  const access = useAccess(gateway);
  const instructions = useInstructions(gateway);
  if (access.state.stage === 'loading') return <><SiteHeader /><main id="main-content" className="load-screen" role="status"><h1>正在准备测试…</h1></main></>;
  if (access.state.stage === 'code') return <CodeScreen busy={access.busy} error={access.error} onSubmit={access.verifyCode} instructions={instructions} />;
  if (access.state.stage === 'profile') return <ProfileScreen profile={access.state.profile} busy={access.busy} error={access.error} onSubmit={access.submitProfile} onReturnToTasks={access.returnFromProfile} />;
  if (access.state.stage === 'tasks') return <TaskSelectionScreen testCode={access.state.grant.testCode} tasks={access.state.tasks} profileComplete={access.state.profile.answers !== null} onOpenProfile={access.openProfile} busy={access.busy} error={access.error} onStart={access.start} onChangeCode={access.changeCode} instructions={instructions} />;
  return <div className="app-shell"><Experiment key={access.state.started.session.id} started={access.state.started} gateway={gateway}
    entryBusy={access.busy} entryError={access.error} onReturnToTasks={access.returnToTasks} onReturnHome={access.returnHome} /></div>;
}
function Experiment({ started, gateway, entryBusy, entryError, onReturnToTasks, onReturnHome }: {
  started: StartedTask; gateway: ExperimentGateway; entryBusy: boolean; entryError: string; onReturnToTasks: () => void; onReturnHome: () => Promise<boolean>;
}) {
  const { scenario, shared, task } = started;
  const { state, dispatch, busy, error, saveDecision, send, end, complete, recordEvent } = useExperiment(started, gateway);
  const heading = useRef<HTMLHeadingElement>(null);
  const [confirmReturn, setConfirmReturn] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); heading.current?.focus(); }, [state.stage]);
  const workspace = state.stage === 'pre' || state.stage === 'post' || state.stage === 'dialogue';
  return <><ExperimentHeader stage={state.stage} busy={busy || entryBusy || state.dialogueStatus === 'confirm'}
    onReturnHome={() => { if (state.stage === 'complete') void onReturnHome(); else setConfirmReturn(true); }} />
    {(state.stage === 'pre' || state.stage === 'post') && <DecisionScreen key={state.stage} stage={state.stage} scenario={scenario} shared={shared} taskNumber={task.number}
      busy={busy} error={error} onSubmit={d => { void saveDecision(state.stage === 'pre' ? 'pre' : 'post', d); }} onEvent={recordEvent} />}
    {state.stage === 'dialogue' && <DialogueScreen scenario={scenario} shared={shared} taskNumber={task.number} state={state} busy={busy} error={error}
      send={send} saveProbe={d => { void saveDecision('probe', d); }} end={() => { void end(); }}
      confirmEnd={() => dispatch({ type: 'CONFIRM_END' })} cancelEnd={() => dispatch({ type: 'CANCEL_END' })} onEvent={recordEvent} />}
    {!workspace && <main id="main-content" className="page-main focused-page">
      {state.stage === 'finishing' && <section className="surface completion" aria-live="polite">
        <span className="task-number">任务编号 {task.number}</span><h1 ref={heading} tabIndex={-1}>{error ? '还差最后一步' : '正在保存你的作答…'}</h1>
        {error && <><p>你的最终判断已提交，点击下方按钮再试一次即可，无需重新作答。</p><div className="error-message" role="alert">{error}</div><button className="button primary" disabled={busy} onClick={() => { void complete(); }}>再试一次</button></>}
      </section>}
      {state.stage === 'complete' && <section className="surface completion"><div className="completion-symbol" aria-hidden="true">✓</div>
        <span className="task-number">任务编号 {task.number}</span><h1 ref={heading} tabIndex={-1}>任务已完成</h1><p>谢谢你的认真作答，本次结果已保存。</p><p>返回任务列表，可以查看整体进度和其他任务。</p>
        <button className="button secondary completion-return" disabled={entryBusy} onClick={onReturnToTasks}>{entryBusy ? '正在返回…' : '返回任务列表'}</button>
        {entryError && <div className="error-message" role="alert">{entryError}</div>}
      </section>}
    </main>}
    {!workspace && <footer className="site-footer"><span>金融决策任务</span></footer>}
    {confirmReturn && <ReturnHomeDialog busy={entryBusy} error={entryError} onCancel={() => setConfirmReturn(false)} onConfirm={() => { void onReturnHome(); }} />}
  </>;
}
