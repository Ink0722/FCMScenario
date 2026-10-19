import { ui } from '../app/copy';
import type { Question } from './config';
import { useDraft } from '../app/useDraft';
import { DraftStatus } from '../app/DraftStatus';

export function ProfileForm({ questions, draftKey, busy, onSubmit }: { questions: Question[]; draftKey: string; busy: boolean; onSubmit: (answers: Record<string, string>) => void }) {
  const validDraft = (value: unknown): value is Record<string, string> => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([id, answer]) => questions.some(q => q.id === id && q.options.some(o => o.value === answer)));
  const draft = useDraft<Record<string, string>>(draftKey, JSON.stringify(questions), {}, validDraft, value => Object.keys(value).length === 0);
  const answers = draft.value;
  const valid = questions.every(q => !q.required || q.options.some(o => o.value === answers[q.id]));
  return <form className="profile-form" onSubmit={e => { e.preventDefault(); if (valid && !busy) onSubmit(answers); }}>
    {questions.map((q, index) => <fieldset key={q.id} disabled={busy}><legend><span className="question-number">{String(index + 1).padStart(2, '0')}</span>{q.title}{q.required && <small>{ui.required}</small>}</legend>
      <div className="question-options">{q.options.map(o => <label key={o.value} className={answers[q.id] === o.value ? 'selected' : ''}>
        <input type="radio" name={q.id} value={o.value} required={q.required} checked={answers[q.id] === o.value} onChange={() => draft.update(a => ({ ...a, [q.id]: o.value }))} />{o.label}
      </label>)}</div>
    </fieldset>)}
    <DraftStatus {...draft} />
    <div className="decision-actions"><button className="button primary" type="submit" disabled={!valid || busy}>{busy ? ui.submitting : ui.submitProfile}</button></div>
  </form>;
}
