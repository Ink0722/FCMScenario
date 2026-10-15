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
  const statusLabels: Record<TestTask['status'], string> = { available: '可开始', in_progress: '进行中', completed: '已完成', unavailable: '暂时不能开始' };
  return <><SiteHeader /><main id="main-content" className="task-selection-page">
    <header className="entry-heading task-selection-heading"><div><h1>{allCompleted ? '本次测试已完成' : '选择测试任务'}</h1>
      <p>{allCompleted ? '感谢你抽出时间参与本次测试。' : !profileComplete ? '开始前，请先填写基本情况问卷，然后就可以选择测试任务。' : waiting ? '谢谢你的参与，下面可以查看各项任务的进度。' : completed.length ? `你已完成 ${completed.length} 个任务，可以继续选择下面的任务。` : '请选择一个任务开始，按自己的节奏认真作答。'}</p></div>
      <div className="task-overview"><dl className="current-test-code" aria-label="当前测试编码"><dt>测试编码</dt><dd>{testCode}</dd></dl>
        {tasks.length > 0 && <p className="task-progress">已完成 {completed.length} / {tasks.length} 项测试任务</p>}
      </div>
    </header>
    {!allCompleted && <InstructionsPanel resource={instructions} />}
    {allCompleted && <section className="task-summary finished" role="status"><span className="summary-symbol" aria-hidden="true">✓</span><div><h2>所有作答已保存</h2><p>你可以关闭页面了。谢谢你的时间和认真作答。</p></div></section>}
    {waiting && <section className="task-summary waiting" role="status"><div><h2>暂时没有可以开始的任务</h2><p>{completed.length ? '已完成的作答已经保存。其余任务暂时还不能开始，你可以稍后查看，或联系研究人员确认安排。' : '这些任务暂时还不能开始。你可以稍后查看，或联系研究人员确认安排。'}</p></div></section>}
    <section className="profile-task" aria-label="用户资料任务">
      <span className={`profile-task-icon ${profileComplete ? 'completed' : ''}`} aria-hidden="true">{profileComplete ? '✓' : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M9 10h6M9 15h6" /></svg>}</span>
      <div className="task-choice-content"><span className="task-number">用户资料</span><span className="task-title">基本情况问卷<span className="profile-task-note">每个测试编码填写一次</span></span></div>
      <div className="profile-task-actions"><span className={`task-status ${profileComplete ? 'completed' : ''}`}>{profileComplete ? '已完成' : '待填写'}</span>
        {!profileComplete && <button type="button" className="button primary" disabled={busy} onClick={onOpenProfile}>填写资料</button>}
      </div>
    </section>
    {error && <div className="error-message" role="alert">{error}</div>}
    {tasks.length > 0 ? <form onSubmit={e => { e.preventDefault(); if (profileComplete && selected && !busy && instructions.data) onStart(selected); }}>
      <fieldset disabled={busy} className="task-list"><legend className="sr-only">可选择的测试任务</legend>
        {tasks.map(task => { const Row = task.status === 'completed' ? 'div' : 'label'; return <Row key={task.id} className={`task-choice ${selected === task.id ? 'selected' : ''} ${task.status === 'completed' ? 'completed' : !profileComplete || task.status !== 'available' ? 'unavailable' : ''}`}>
          {task.status === 'completed' ? <span className="task-complete-check" aria-hidden="true">✓</span> : <input type="radio" name="test-task" value={task.id} disabled={!profileComplete || task.status !== 'available'} checked={selected === task.id} onChange={() => setSelected(task.id)} />}
          <span className="task-choice-content"><span className="task-number">{task.number}</span><span className="task-title">{task.title}</span></span>
          <span className={`task-status ${task.status === 'completed' ? 'completed' : ''}`}>{!profileComplete && task.status === 'available' ? '填写资料后开始' : statusLabels[task.status]}</span>
        </Row>; })}
      </fieldset>
      <div className="task-selection-actions"><button className="button secondary" type="button" disabled={busy} onClick={onChangeCode}>使用其他编码</button>
        {available.length > 0 && <div><span>开始后，请先完成这个任务，再选择其他任务。</span><button className="button primary" type="submit" disabled={!profileComplete || !selected || busy || !instructions.data}>{busy ? '正在进入…' : '开始测试'}</button></div>}
      </div>
    </form> : <div className="surface empty-tasks"><h2>还没有为你安排测试任务</h2><p>可以联系研究人员确认安排。感谢你的耐心。</p><button className="button secondary" disabled={busy} onClick={onChangeCode}>使用其他编码</button></div>}
  </main></>;
}
