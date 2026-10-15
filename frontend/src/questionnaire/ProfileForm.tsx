import { useState } from 'react';
import type { Question } from './config';

export function ProfileForm({ questions, busy, onSubmit, initialAnswers = {} }: { questions: Question[]; busy: boolean; onSubmit: (answers: Record<string, string>) => void; initialAnswers?: Record<string, string> }) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({ ...initialAnswers }));
  const valid = questions.every(q => !q.required || q.options.some(o => o.value === answers[q.id]));
  return <form className="profile-form" onSubmit={e => { e.preventDefault(); if (valid && !busy) onSubmit(answers); }}>
    {questions.map((q, index) => <fieldset key={q.id} disabled={busy}><legend><span className="question-number">{String(index + 1).padStart(2, '0')}</span>{q.title}{q.required && <small>必填</small>}</legend>
      <div className="question-options">{q.options.map(o => <label key={o.value} className={answers[q.id] === o.value ? 'selected' : ''}>
        <input type="radio" name={q.id} value={o.value} required={q.required} checked={answers[q.id] === o.value} onChange={() => setAnswers(a => ({ ...a, [q.id]: o.value }))} />{o.label}
      </label>)}</div>
    </fieldset>)}
    <div className="decision-actions"><button className="button primary" type="submit" disabled={!valid || busy}>{busy ? '正在提交…' : '提交并返回任务列表'}</button></div>
  </form>;
}
