import { ui } from '../app/copy';
import { Markdown } from '../experiment/components/Markdown';
import type { InstructionsResource } from './useInstructions';

export function InstructionsPanel({ resource, compact = false }: { resource: InstructionsResource; compact?: boolean }) {
  const content = <>
    {resource.data ? <Markdown text={resource.data.welcome} /> : resource.loading && <p className="instructions-status" role="status">{ui.loadingInstructions}</p>}
    {resource.error && <div className="instructions-error"><p role="alert">{resource.error}</p><button type="button" className="button secondary" disabled={resource.loading} onClick={resource.reload}>{ui.reload}</button></div>}
  </>;
  return <section className={`surface entry-instructions${compact ? ' compact-instructions' : ''}`} aria-label={ui.instructions} aria-busy={resource.loading}>
    {compact ? <details open={resource.error || resource.loading ? true : undefined}><summary>{ui.instructions}<span aria-hidden="true">{ui.instructionsHint}</span></summary><div className="instructions-content">{content}</div></details>
      : <><span className="eyebrow">{ui.profileLabel}</span><h2>{ui.instructions}</h2>{content}</>}
  </section>;
}
