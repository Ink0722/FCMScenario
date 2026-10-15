import type { Scenario } from '../../content/types';
import type { ExperimentEvent } from '../../integration/contracts';
import { Markdown } from './Markdown';

interface Props {
  scenario: Scenario;
  compact?: boolean;
  onEvent?: (kind: ExperimentEvent['kind'], details: ExperimentEvent['details']) => void;
}
export function ScenarioPanel({ scenario: s, compact = false, onEvent }: Props) {
  return <article className={`scenario-panel ${compact ? 'compact' : ''}`}>
    {compact && <header className="panel-scenario-heading"><h2>{s.title}</h2></header>}
    <section className="material-section" data-material-section="background"><h3 tabIndex={-1}>决策情境</h3><Markdown text={s.background} /></section>
    <section className="material-section" data-material-section="conditions"><h3 tabIndex={-1}>共同条件</h3>{s.common_facts.map((text, i) => <Markdown key={i} text={text} />)}</section>
    <section className="material-section" data-material-section="comparison"><h3 tabIndex={-1}>方案资料</h3>
      {s.template === 'table' ? <div className="table-scroll" tabIndex={0} role="region" aria-label="方案比较">
        <table className="comparison-table"><thead><tr><th scope="col">属性</th>{s.options.map(o => <th key={o.id} scope="col">方案{o.id}<span>{o.label}</span></th>)}</tr></thead>
          <tbody>{s.comparison.map(row => <tr key={row.attribute}><th scope="row">{row.attribute}</th><td><Markdown text={row.A} /></td><td><Markdown text={row.B} /></td></tr>)}</tbody>
        </table></div> : <div className="comparison-cards">{s.options.map(o => <section className="material-option" key={o.id}>
          <header><span className="option-letter">{o.id}</span><h4>{o.label}</h4></header>
          <dl>{s.comparison.map(row => <div key={row.attribute}><dt>{row.attribute}</dt><dd><Markdown text={row[o.id]} /></dd></div>)}</dl>
        </section>)}</div>}
    </section>
    {s.additional_information.length > 0 && <section className="material-section" data-material-section="additional"><h3 tabIndex={-1}>补充资料</h3>
      {s.additional_information.map((info, i) => <section className="supplement" key={i}><h4>{info.title}</h4><Markdown text={info.text} /></section>)}
    </section>}
    <section className="material-section" data-material-section="references"><h3 tabIndex={-1}>参考文件</h3><div className="reference-list">{s.references.map(ref =>
      <a className="reference-link" key={ref.document_id} href={`${import.meta.env.BASE_URL}${ref.url}`} target="_blank" rel="noopener noreferrer"
        onClick={() => onEvent?.('reference_open', { document_id: ref.document_id, revision: ref.revision })}>
        <span className="file-icon" aria-hidden="true">PDF</span><span>{ref.title}</span><span aria-hidden="true">↗</span>
      </a>)}</div></section>
    <section className="material-section" data-material-section="knowledge"><h3 tabIndex={-1}>背景知识</h3>{s.knowledge.map((term, i) => <details className="knowledge" key={i} open
      onToggle={e => onEvent?.('information_toggle', { section: term.title, open: e.currentTarget.open })}>
      <summary>{term.title}</summary><Markdown text={term.text} />
    </details>)}</section>
  </article>;
}
