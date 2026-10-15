import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Choice, Scenario, SharedCopy } from '../../content/types';
import type { Decision } from '../../integration/contracts';
import { Markdown } from './Markdown';

interface Props { scenario: Scenario; shared: SharedCopy; prompt: string; busy: boolean; onSubmit: (decision: Decision) => void; buttonLabel: string; actionsTarget?: HTMLElement | null }
export function DecisionPanel({ scenario, shared, prompt, busy, onSubmit, buttonLabel, actionsTarget }: Props) {
  const formId = useId();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const valid = choice !== null && confidence !== null && Number.isInteger(confidence) && confidence >= 0 && confidence <= 100;
  const actions = <div className="decision-actions"><button className="button primary" disabled={!valid || busy} type="submit" form={formId}>{busy ? '正在记录…' : buttonLabel}</button></div>;
  return <form id={formId} className="decision-panel" onSubmit={e => { e.preventDefault(); if (valid && !busy) onSubmit({ choice: choice!, confidence: confidence! }); }}>
    <Markdown text={prompt} />
    <fieldset disabled={busy}><legend>{shared.choice_prompt}</legend><div className="choice-grid">{scenario.options.map(option =>
      <label key={option.id} className={`choice-card ${choice === option.id ? 'selected' : ''}`}>
        <input type="radio" name="decision" value={option.id} checked={choice === option.id} onChange={() => setChoice(option.id)} required />
        <span className="option-letter">{option.id}</span><span className="choice-label">{option.label}</span><span className="radio-mark" aria-hidden="true" />
      </label>)}</div>
    </fieldset>
    <fieldset className="confidence-field" disabled={busy}><legend>{shared.confidence_prompt}</legend>
      <div className="confidence-controls"><div className="confidence-range"><input className={`confidence-slider ${confidence === null ? 'untouched' : ''}`} type="range" aria-label="置信度滑杆" min="0" max="100" step="1" value={confidence ?? 0}
        aria-valuetext={confidence === null ? '尚未选择置信度' : `${confidence} 分`}
        onChange={e => setConfidence(Number(e.target.value))}
        onPointerDown={e => { if (confidence === null) setConfidence(Number(e.currentTarget.value)); }}
        onKeyDown={e => {
          const current = confidence ?? 0;
          const next: Record<string, number> = { Home: 0, End: 100, ArrowRight: current + 1, ArrowUp: current + 1, ArrowLeft: current - 1, ArrowDown: current - 1, PageUp: current + 10, PageDown: current - 10 };
          if (e.key in next) { e.preventDefault(); setConfidence(Math.max(0, Math.min(100, next[e.key]))); }
        }} />
      <div className="scale-labels"><span>0 · 完全没有把握</span><span>100 · 非常确定</span></div></div>
      <label className="confidence-number"><input type="number" aria-label="置信度数值" min="0" max="100" step="1" inputMode="numeric" placeholder="未填写" value={confidence ?? ''}
        onChange={e => setConfidence(e.target.value === '' ? null : Number(e.target.value))} /><span>分</span></label></div>
      <div className="confidence-explanation"><Markdown text={shared.confidence_scale} /></div>
    </fieldset>
    {actionsTarget ? createPortal(actions, actionsTarget) : actions}
  </form>;
}
