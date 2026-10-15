import { Markdown } from '../experiment/components/Markdown';
import type { InstructionsResource } from './useInstructions';

export function InstructionsPanel({ resource }: { resource: InstructionsResource }) {
  return <section className="surface entry-instructions" aria-label="实验说明" aria-busy={resource.loading}>
    <h2>实验说明</h2>
    {resource.data ? <Markdown text={resource.data.welcome} /> : resource.loading && <p className="instructions-status" role="status">正在加载实验说明…</p>}
    {resource.error && <div className="instructions-error"><p role="alert">{resource.error}</p><button type="button" className="button secondary" disabled={resource.loading} onClick={resource.reload}>重新加载</button></div>}
  </section>;
}
