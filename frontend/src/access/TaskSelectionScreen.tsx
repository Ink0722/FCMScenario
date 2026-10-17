import { ui } from '../app/copy';
import { useState } from 'react';
import type { TestTask } from '../integration/contracts';
import { SiteHeader } from '../app/ExperimentLayout';
import { InstructionsPanel } from './InstructionsPanel';
import type { InstructionsResource } from './useInstructions';

export function TaskSelectionScreen({ testCode, tasks, profileComplete, onOpenProfile, busy, error, onStart, onChangeCode, instructions }: {
  tasks: TestTask[]; busy: boolean; error: string; onStart: (taskId: string) => void; onChangeCode: () => void; instructions: InstructionsResource;
  profileComplete: boolean; onOpenProfile: () => void;
  testCode: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const available = tasks.filter(t => t.status === 'available');
  const completed = tasks.filter(t => t.status === 'completed');
  const allCompleted = profileComplete && tasks.length > 0 && completed.length === tasks.length;
  const waiting = profileComplete && tasks.length > 0 && !allCompleted && available.length === 0;
  const statusLabels: Record<TestTask['status'], string> = { available: ui.available, in_progress: ui.inProgress, completed: ui.completed, unavailable: ui.unavailable };
  return <><SiteHeader /><main id="main-content" className="task-selection-page">
    <header className="entry-heading task-selection-heading"><div><span className="eyebrow">{ui.brand}</span><h1>{allCompleted ? ui.allComplete : ui.tasks}</h1>
      <p>{allCompleted ? ui.allCompleteIntro : !profileComplete ? ui.profileFirst : waiting ? ui.tasksWaiting : completed.length ? ui.continueTasks(completed.length) : ui.tasksIntro}</p></div>
      <div className="task-overview"><dl className="current-test-code" aria-label={ui.currentCode}><dt>{ui.code}</dt><dd>{testCode}</dd></dl>
        {tasks.length > 0 && <p className="task-progress">{ui.progress(completed.length, tasks.length)}</p>}
      </div>
    </header>
    {!allCompleted && <InstructionsPanel resource={instructions} compact />}
    {allCompleted && <section className="task-summary finished" role="status"><span className="summary-symbol" aria-hidden="true">✓</span><div><h2>{ui.responsesSaved}</h2><p>{ui.allCompleteThanks}</p></div></section>}
    {waiting && <section className="task-summary waiting" role="status"><div><h2>{ui.waitingTitle}</h2><p>{completed.length ? ui.waitingSaved : ui.waitingText}</p></div></section>}
    <section className="profile-task" aria-label={ui.profileTask}>
      <span className={`profile-task-icon ${profileComplete ? 'completed' : ''}`} aria-hidden="true">{profileComplete ? '✓' : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M9 10h6M9 15h6" /></svg>}</span>
      <div className="task-choice-content"><span className="task-number">{ui.profileLabel}</span><span className="task-title">{ui.profile}<span className="profile-task-note">{ui.profileNote}</span></span></div>
      <div className="profile-task-actions"><span className={`task-status ${profileComplete ? 'completed' : ''}`}>{profileComplete ? ui.completed : ui.pending}</span>
        {!profileComplete && <button type="button" className="button primary" disabled={busy} onClick={onOpenProfile}>{ui.fillProfile}</button>}
      </div>
    </section>
    {error && <div className="error-message" role="alert">{error}</div>}
    {tasks.length > 0 ? <form onSubmit={e => { e.preventDefault(); if (profileComplete && selected && !busy && instructions.data) onStart(selected); }}>
      <div className="task-list-heading"><h2>{ui.taskList}<span>{ui.taskCount(tasks.length)}</span></h2><span>{ui.status}</span></div>
      <fieldset disabled={busy} className="task-list"><legend className="sr-only">{ui.selectTask}</legend>
        {tasks.map(task => { const Row = task.status === 'completed' ? 'div' : 'label'; return <Row key={task.id} className={`task-choice ${selected === task.id ? 'selected' : ''} ${task.status === 'completed' ? 'completed' : !profileComplete || task.status !== 'available' ? 'unavailable' : ''}`}>
          {task.status === 'completed' ? <span className="task-complete-check" aria-hidden="true">✓</span> : <input type="radio" name="test-task" value={task.id} disabled={!profileComplete || task.status !== 'available'} checked={selected === task.id} onChange={() => setSelected(task.id)} />}
          <span className="task-choice-content"><span className="task-number">{task.number}</span><span className="task-title">{task.title}</span></span>
          <span className={`task-status ${task.status === 'completed' ? 'completed' : ''}`}>{!profileComplete && task.status === 'available' ? ui.needsProfile : statusLabels[task.status]}</span>
        </Row>; })}
      </fieldset>
      <div className="task-selection-actions"><button className="button secondary" type="button" disabled={busy} onClick={onChangeCode}>{ui.changeCode}</button>
        {available.length > 0 && <div><span>{ui.taskLock}</span><button className="button primary" type="submit" disabled={!profileComplete || !selected || busy || !instructions.data}>{busy ? ui.entering : ui.start}</button></div>}
      </div>
    </form> : <div className="surface empty-tasks"><h2>{ui.emptyTitle}</h2><p>{ui.emptyText}</p><button className="button secondary" disabled={busy} onClick={onChangeCode}>{ui.changeCode}</button></div>}
  </main></>;
}
