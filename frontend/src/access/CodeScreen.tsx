import { errors, ui } from '../app/copy';
import { useState } from 'react';
import { SiteHeader } from '../app/ExperimentLayout';
import { InstructionsPanel } from './InstructionsPanel';
import type { InstructionsResource } from './useInstructions';

export function CodeScreen({ busy, error, onSubmit, instructions }: { busy: boolean; error: string; onSubmit: (code: string) => void; instructions: InstructionsResource }) {
  const [code, setCode] = useState('');
  const codeInvalid = [errors.codeUnknown, errors.codeExpired, errors.codeInactive].some(message => message === error);
  return <><SiteHeader /><main id="main-content" className="entry-page">
    <header className="entry-heading"><span className="eyebrow">{ui.participantAccess}</span><h1>{ui.welcome}</h1><p>{ui.entryIntro}</p></header>
    <div className="entry-layout"><InstructionsPanel resource={instructions} /><div>
    <form className="surface code-form" onSubmit={e => { e.preventDefault(); if (code.trim() && !busy && instructions.data) onSubmit(code); }}>
      <h2>{ui.accessTitle}</h2><p className="code-form-note">{ui.accessNote}</p>
      <label htmlFor="test-code">{ui.code}</label>
      <input id="test-code" type="text" value={code} onChange={e => setCode(e.target.value)} placeholder={ui.codePlaceholder} maxLength={80}
        autoComplete="off" autoCapitalize="characters" spellCheck={false} required disabled={busy} autoFocus aria-describedby={error ? 'code-error' : undefined} aria-invalid={codeInvalid || undefined} />
      {error && <div id="code-error" className="error-message" role="alert">{error}</div>}
      <button className="button primary" type="submit" disabled={!code.trim() || busy || !instructions.data}>{busy ? ui.verifying : ui.continue}</button>
    </form>
    <p className="entry-help">{ui.entryHelp}</p>
    </div></div>
    <ol className="entry-roadmap" aria-label={ui.stages}>{[ui.read, ui.discuss, ui.decide].map((label, i) => <li key={label}><span aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>{label}</li>)}</ol>
  </main></>;
}
