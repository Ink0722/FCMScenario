import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Choice, Scenario, SharedCopy } from '../../content/types';
import type { Decision } from '../../integration/contracts';
import { ui } from '../../app/copy';
import { Markdown } from './Markdown';

interface Props { scenario: Scenario; shared: SharedCopy; prompt: string; busy: boolean; onSubmit: (decision: Decision) => void; buttonLabel: string; actionsTarget?: HTMLElement | null }
export function DecisionPanel({ scenario, shared, prompt, busy, onSubmit, buttonLabel, actionsTarget }: Props) {
  const formId = useId();
  const helpId = useId();
  const errorId = useId();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [confidenceText, setConfidenceText] = useState('');
  const confidence = confidenceText.trim() === '' ? null : Number(confidenceText);
  const confidenceValid = confidence !== null && Number.isInteger(confidence) && confidence >= 0 && confidence <= 100;
  const invalid = confidenceText !== '' && !confidenceValid;
  const valid = choice !== null && confidenceValid;
  const actions = <div className="decision-actions"><button className="button primary" disabled={!valid || busy} type="submit" form={formId}>{busy ? ui.saving : buttonLabel}<span aria-hidden="true"> →</span></button></div>;
  return <form id={formId} className="decision-panel" onSubmit={e => { e.preventDefault(); if (valid && !busy) onSubmit({ choice: choice!, confidence: confidence! }); }}>
    <Markdown text={prompt} />
    <fieldset disabled={busy}><legend>{shared.choice_prompt}</legend><div className="choice-grid">{scenario.options.map(option =>
      <label key={option.id} className={`choice-card ${choice === option.id ? 'selected' : ''}`}>
        <input type="radio" name={`decision-${formId}`} value={option.id} checked={choice === option.id} onChange={() => setChoice(option.id)} required />
        <span className="option-letter">{option.id}</span><span className="choice-label">{option.label}</span><span className="radio-mark" aria-hidden="true" />
      </label>)}</div>
    </fieldset>
    <fieldset className="confidence-field" disabled={busy}><legend>{shared.confidence_prompt}</legend>
      <div className="confidence-controls">
        <label className="confidence-number"><span className="sr-only">{ui.confidenceInput}</span>
          <input type="number" min="0" max="100" step="1" inputMode="numeric" placeholder={ui.confidencePlaceholder}
            required value={confidenceText} aria-invalid={invalid || undefined} aria-describedby={`${helpId}${invalid ? ` ${errorId}` : ''}`}
            onChange={e => setConfidenceText(e.target.value)} /><span aria-hidden="true">/ 100</span>
        </label>
        <div className="scale-labels"><span>{ui.confidenceMin}</span><span>{ui.confidenceMax}</span></div>
      </div>
      {invalid && <p className="field-error" id={errorId} role="alert">{ui.confidenceInvalid}</p>}
      <div className="confidence-explanation" id={helpId}><Markdown text={shared.confidence_scale} /></div>
    </fieldset>
    {actionsTarget ? createPortal(actions, actionsTarget) : actions}
  </form>;
}
