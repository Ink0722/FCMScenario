import { useEffect, useRef, useState } from 'react';
import type { Scenario, SharedCopy } from '../../content/types';
import type { Decision, ExperimentEvent } from '../../integration/contracts';
import type { ExperimentState } from '../flow/reducer';
import { DecisionPanel } from '../components/DecisionPanel';
import { MaterialColumn } from '../components/MaterialColumn';
import { TaskPanel } from '../components/TaskPanel';
import { Markdown } from '../components/Markdown';
import { EndDialog } from '../components/EndDialog';

interface Props {
  scenario: Scenario; shared: SharedCopy; taskNumber: string; state: ExperimentState; busy: boolean; error: string;
  send: (text: string) => Promise<boolean>; saveProbe: (decision: Decision) => void;
  confirmEnd: () => void; cancelEnd: () => void; end: () => void;
  onEvent: (kind: ExperimentEvent['kind'], details: ExperimentEvent['details']) => void;
}
export function DialogueScreen({ scenario, shared, taskNumber, state, busy, error, send, saveProbe, confirmEnd, cancelEnd, end, onEvent }: Props) {
  const [draft, setDraft] = useState('');
  const history = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const priorStatus = useRef(state.dialogueStatus);
  const blocked = state.dialogueStatus !== 'ready' || busy;
  useEffect(() => {
    if (follow.current && history.current) history.current.scrollTop = history.current.scrollHeight;
    if (state.dialogueStatus === 'probe' && probe.current && history.current) {
      probe.current.focus({ preventScroll: true });
      history.current.scrollTop += probe.current.getBoundingClientRect().top - history.current.getBoundingClientRect().top - 16;
    }
    if (priorStatus.current === 'probe' && state.dialogueStatus === 'ready') input.current?.focus();
    priorStatus.current = state.dialogueStatus;
  }, [state.messages.length, state.dialogueStatus]);
  const submit = async () => { if (blocked || !draft.trim()) return; follow.current = true; if (await send(draft)) setDraft(''); };
  return <main id="main-content" className="experiment-workspace dialogue-workspace">
    <MaterialColumn scenario={scenario} taskNumber={taskNumber} onEvent={onEvent} />
    <section className="dialogue-column" aria-label="与 AI 助手交流"><div className="column-heading"><h1>交流</h1><small>AI 助手</small></div>
      <div className="dialogue-task"><TaskPanel task={scenario.task} /></div>
      <div className="message-history" ref={history} onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
        {state.messages.map(message => <article className={`message ${message.role}`} key={message.id}>
          <span className="message-author">{message.role === 'assistant' ? 'AI 助手' : '你'}</span>
          {message.role === 'assistant' ? <Markdown text={message.text} /> : <p className="user-text">{message.text}</p>}
        </article>)}
        {state.dialogueStatus === 'waiting' && <p className="reply-status" role="status"><span className="waiting-dot" />正在回复…</p>}
        {state.dialogueStatus === 'probe' && <div className="probe-card" ref={probe} tabIndex={-1} aria-labelledby="probe-title">
          <h2 id="probe-title">当前判断</h2>
          <DecisionPanel scenario={scenario} shared={shared} prompt={shared.probe_prompt} busy={busy} onSubmit={saveProbe} buttonLabel="确认并继续交流" />
        </div>}
      </div>
      <div className="composer-area">
        {error && <div className="error-message" role="alert">{error}</div>}
        {state.dialogueStatus === 'probe' && <p className="composer-note" role="status">请先完成当前判断，再继续交流。</p>}
        <form onSubmit={e => { e.preventDefault(); void submit(); }}>
          <label className="sr-only" htmlFor="message-input">你的问题或想法</label>
          <textarea ref={input} id="message-input" placeholder="输入问题或想法" value={draft} disabled={blocked} rows={2}
            onChange={e => setDraft(e.target.value)} onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
            }} />
          <div className="composer-actions"><span className="composer-hint">Enter 发送 · Shift + Enter 换行</span><div>
            {state.policy.canEnd && state.dialogueStatus === 'ready' && <button type="button" className="button secondary" disabled={busy} onClick={confirmEnd}>结束交流</button>}
            <button className="button primary" type="submit" disabled={blocked || !draft.trim()}>发送</button>
          </div></div>
        </form>
      </div>
    </section>
    {state.dialogueStatus === 'confirm' && <EndDialog busy={busy} onCancel={cancelEnd} onConfirm={end} />}
  </main>;
}
