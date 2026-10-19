import { errors, ui } from '../app/copy';
import { useState } from 'react';
import { SiteHeader } from '../app/ExperimentLayout';
import { StudyIllustration } from '../app/StudyIllustration';
import { InstructionsPanel } from './InstructionsPanel';
import type { InstructionsResource } from './useInstructions';

export function CodeScreen({ busy, error, onSubmit, instructions }: { busy: boolean; error: string; onSubmit: (code: string) => void; instructions: InstructionsResource }) {
  const [code, setCode] = useState('');
  const [confirmedRevision, setConfirmedRevision] = useState<string | null>(null);
  const confirmed = instructions.data !== null && confirmedRevision === instructions.data.revision;
  const canBegin = Boolean(code.trim() && confirmed && !busy && instructions.data);
  const codeInvalid = [errors.codeUnknown, errors.codeExpired, errors.codeInactive].some(message => message === error);
  return <><SiteHeader /><main id="main-content" className="entry-page">
    <header className="entry-heading entry-hero"><div><h1>{ui.welcome}</h1><p>{ui.entryIntro}</p>
      <p className="entry-contact">{ui.entryReadReminder}{' '}<span className="entry-contact-details">{ui.entryHelp}{' '}<a href={`mailto:${ui.contactEmail}`}>{ui.contactEmail}</a>.</span></p>
    </div>
      <StudyIllustration variant="reading" className="entry-illustration" />
    </header>
    <div className="entry-layout"><InstructionsPanel resource={instructions} /><div className="entry-access">
    <form className="surface code-form" onSubmit={e => { e.preventDefault(); if (canBegin) onSubmit(code); }}>
      <h2>{ui.accessTitle}</h2><p className="code-form-note">{ui.accessNote}</p>
      <p className="code-form-contact">{ui.codeHelp}{' '}<a href={`mailto:${ui.contactEmail}`}>{ui.contactEmail}</a>.</p>
      <div className="entry-controls">
        <div className="entry-code-field">
          <label htmlFor="test-code">{ui.code}</label>
          <input id="test-code" type="text" value={code} onChange={e => setCode(e.target.value)} placeholder={ui.codePlaceholder} maxLength={80}
            autoComplete="off" autoCapitalize="characters" spellCheck={false} required disabled={busy} autoFocus aria-describedby={error ? 'code-error' : undefined} aria-invalid={codeInvalid || undefined} />
          {error && <div id="code-error" className="error-message" role="alert">{error}</div>}
        </div>
        <div className="entry-start">
          <label className="entry-confirmation"><input type="checkbox" required checked={confirmed} disabled={busy || !instructions.data}
            onChange={e => setConfirmedRevision(e.target.checked && instructions.data ? instructions.data.revision : null)} />
            <span>{ui.readConfirmation}</span>
          </label>
          <button className="button primary" type="submit" disabled={!canBegin}>{busy ? ui.verifying : ui.begin}</button>
        </div>
      </div>
    </form>
    </div></div>
    <ol className="entry-roadmap" aria-label={ui.stages}>{[
      { title: ui.read, description: ui.readDescription },
      { title: ui.discuss, description: ui.discussDescription },
      { title: ui.decide, description: ui.decideDescription },
    ].map((step, i) => <li key={step.title}>
      <div className="step-heading"><span className="step-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span><h3>{step.title}</h3></div>
      <ul className="step-points">{step.description.map(sentence => <li key={sentence}>{sentence}</li>)}</ul>
    </li>)}</ol>
  </main></>;
}
