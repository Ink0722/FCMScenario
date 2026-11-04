import { ui } from '../../app/copy';
import { useEffect, useId, useRef } from 'react';
import type { Scenario, SharedCopy } from '../../content/types';
import type { Decision, ExperimentEvent } from '../../integration/contracts';
import type { ExperimentState } from '../flow/reducer';
import { DecisionPanel } from '../components/DecisionPanel';
import { MaterialColumn } from '../components/MaterialColumn';
import { TaskPanel } from '../components/TaskPanel';
import { Markdown } from '../components/Markdown';
import { EndDialog } from '../components/EndDialog';
import { isMessageDraft, sessionDraftKey } from '../../app/drafts';
import { useDraft } from '../../app/useDraft';
import { DraftStatus } from '../../app/DraftStatus';
import { dialogueEndGuide } from '../dialogueGuide';

interface Props {
  sessionId: string; draftRevision: string; scenario: Scenario; shared: SharedCopy; taskNumber: string; state: ExperimentState; busy: boolean; error: string;
  send: (text: string) => Promise<boolean>; saveProbe: (decision: Decision) => void;
  reconnect: () => void;
  confirmEnd: () => void; cancelEnd: () => void; end: () => void;
  onEvent: (kind: ExperimentEvent['kind'], details: ExperimentEvent['details']) => void;
}
export function DialogueScreen({ sessionId, draftRevision, scenario, shared, taskNumber, state, busy, error, send, reconnect, saveProbe, confirmEnd, cancelEnd, end, onEvent }: Props) {
  const messageDraft = useDraft(sessionDraftKey(sessionId, 'message'), draftRevision, '', isMessageDraft, value => value === '');
  const draft = messageDraft.value;
  const endGuideId = useId();
  const history = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const priorStatus = useRef(state.dialogueStatus);
  const blocked = state.dialogueStatus !== 'ready' || busy || state.policy.canSend === false;
  const endGuide = dialogueEndGuide(state.policy, state.dialogueStatus);
  useEffect(() => {
    if (follow.current && history.current) history.current.scrollTop = history.current.scrollHeight;
    if (state.dialogueStatus === 'probe' && probe.current && history.current) {
      probe.current.focus({ preventScroll: true });
      history.current.scrollTop += probe.current.getBoundingClientRect().top - history.current.getBoundingClientRect().top - 16;
    }
    if (priorStatus.current === 'probe' && state.dialogueStatus === 'ready') input.current?.focus();
    priorStatus.current = state.dialogueStatus;
  }, [state.messages, state.dialogueStatus]);
  const submit = async () => { if (blocked || !draft.trim()) return; follow.current = true; if (await send(draft)) messageDraft.update(''); };
  return <main id="main-content" className="experiment-workspace dialogue-workspace">
    <MaterialColumn scenario={scenario} taskNumber={taskNumber} onEvent={onEvent} />
    <section className="dialogue-column" aria-label={ui.dialogueRegion}><div className="column-heading"><h1>{ui.conversation}</h1><small>{ui.assistant}</small></div>
      <div className="dialogue-task"><TaskPanel task={scenario.task} /></div>
      <div className="message-history" ref={history} onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
        {state.messages.map(message => <article className={`message ${message.role}`} key={message.id}>
          <span className="message-author">{message.role === 'assistant' ? ui.assistant : ui.you}</span>
          {message.role === 'assistant' ? <Markdown text={message.text} /> : <p className="user-text">{message.text}</p>}
          {message.citations && message.citations.length > 0 && <ul className="message-sources" aria-label="Sources">{message.citations.filter(source => /^(https?:\/\/|\/api\/)/i.test(source.url)).map((source, i) => <li key={`${source.url}-${i}`}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}</ul>}
          {message.status === 'interrupted' && <small role="status">Reply interrupted</small>}
        </article>)}
        {['waiting','queued','running'].includes(state.dialogueStatus) && <p className="reply-status" role="status"><span className="waiting-dot" />{state.dialogueStatus === 'queued' ? 'Your message is saved and queued. Waiting for a reply…' : ui.replying}</p>}
        {state.dialogueStatus === 'probe' && <div className="probe-card" ref={probe} tabIndex={-1} aria-labelledby="probe-title">
          <h2 id="probe-title">{ui.currentChoice}</h2>
          <DecisionPanel scenario={scenario} shared={shared} draftKey={sessionDraftKey(sessionId, 'probe')} draftRevision={draftRevision}
            prompt={shared.probe_prompt} busy={busy} onSubmit={saveProbe} buttonLabel={ui.saveProbe} />
        </div>}
      </div>
      <div className="composer-area">
        {error && <div className="error-message" role="alert">{error}</div>}
        {state.dialogueStatus === 'reconnecting' && <div role="status"><p>Connection interrupted. Your message is retained.</p><button type="button" className="button secondary" disabled={busy} onClick={reconnect}>Reconnect</button></div>}
        {state.dialogueStatus === 'interrupted' && <p role="status">This reply was interrupted. Return to tasks to start a new attempt.</p>}
        {state.dialogueStatus === 'probe' && <p className="composer-note" role="status">{ui.finishProbe}</p>}
        <form onSubmit={e => { e.preventDefault(); void submit(); }}>
          <label className="sr-only" htmlFor="message-input">{ui.messageLabel}</label>
          <textarea ref={input} id="message-input" placeholder={ui.messagePlaceholder} value={draft} disabled={blocked} rows={2}
            onChange={e => messageDraft.update(e.target.value)} onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
            }} />
          <DraftStatus {...messageDraft} />
          <div className="composer-actions"><div className="composer-meta">
            <span className="composer-hint"><span>{ui.keyboardHint}</span><span>{ui.newLineHint}</span></span>
            <p className="conversation-guide" id={endGuideId} aria-live="polite" aria-atomic="true">{endGuide}</p>
          </div><div className="composer-buttons">
            <button type="button" className="button secondary" disabled={blocked || !state.policy.canEnd} aria-describedby={endGuideId}
              title={blocked || !state.policy.canEnd ? endGuide : undefined} onClick={confirmEnd}>{ui.end}</button>
            <button className="button primary" type="submit" disabled={blocked || !draft.trim()}>{ui.send}</button>
          </div></div>
        </form>
      </div>
    </section>
    {state.dialogueStatus === 'confirm' && <EndDialog busy={busy} error={error} hasUnsentMessage={draft !== ''} onCancel={cancelEnd} onConfirm={end} />}
  </main>;
}
