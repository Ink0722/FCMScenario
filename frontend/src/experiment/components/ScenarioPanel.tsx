import { ui } from '../../app/copy';
import { useId } from 'react';
import type { Scenario } from '../../content/types';
import type { ExperimentEvent } from '../../integration/contracts';
import { Markdown } from './Markdown';

interface Props {
  scenario: Scenario;
  compact?: boolean;
  onEvent?: (kind: ExperimentEvent['kind'], details: ExperimentEvent['details']) => void;
}
export function ScenarioPanel({ scenario: s, compact = false, onEvent }: Props) {
  const referenceHeadingId = useId();
  return <article className={`scenario-panel ${compact ? 'compact' : ''}`} lang={s.locale ?? (/[\u3400-\u9fff]/.test(s.background) ? 'zh-CN' : 'en')}>
    {compact && <header className="panel-scenario-heading"><h2>{s.title}</h2></header>}
    <section className="material-section" data-material-section="background"><h3 tabIndex={-1}>{ui.background}</h3><Markdown text={s.background} /></section>
    <section className="decision-reference" aria-labelledby={referenceHeadingId}>
      <h3 className="reference-group-heading" id={referenceHeadingId}>{ui.decisionReference}</h3>
      <section className="material-section" data-material-section="comparison"><h4 tabIndex={-1}>{ui.comparison}</h4>
        {s.template === 'table' && s.comparison.length > 0 ? <div className="table-scroll" tabIndex={0} role="region" aria-label={ui.comparisonRegion}>
          <table className="comparison-table"><thead><tr><th scope="col">{ui.attribute}</th>{s.options.map(o => <th key={o.id} scope="col">{ui.option} {o.id}</th>)}</tr></thead>
            <tbody>{s.comparison.map(row => <tr key={row.attribute}><th scope="row">{row.attribute}</th>{s.options.map(option => <td key={option.id}><Markdown text={row[option.id]} /></td>)}</tr>)}</tbody>
          </table></div> : <div className="comparison-cards">{s.options.map(o => <section className="material-option" key={o.id}>
            <header><span className="option-letter">{o.id}</span><h5>{o.label}</h5></header>
            <dl>{s.comparison.map(row => <div key={row.attribute}><dt>{row.attribute}</dt><dd><Markdown text={row[o.id]} /></dd></div>)}</dl>
          </section>)}</div>}
      </section>
      {(s.references.length > 0 || s.common_facts.length > 0) && <section className="material-section" data-material-section="conditions"><h4 tabIndex={-1}>{ui.conditions}</h4>
        {s.references.length > 0 && <div className="condition-references" data-material-section="references">
          <div className="reference-list">{s.references.map(ref =>
            <a className="reference-link" data-material-anchor key={ref.document_id} href={ref.url.startsWith('/') || /^https?:\/\//.test(ref.url) ? ref.url : `${import.meta.env.BASE_URL}${ref.url}`} target="_blank" rel="noopener noreferrer" aria-label={`${ref.title} (${ui.openDocument})`}
              onClick={() => onEvent?.('reference_open', { document_id: ref.document_id, revision: ref.revision })}>
              <span className="file-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <path d="M5 2h6l5 5v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" fill="#fff5f5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M11 2v5h5M7 11h6M7 14h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span><span className="reference-title">{ref.title}<span className="reference-arrow" aria-hidden="true"> ↗</span></span>
            </a>)}</div>
        </div>}
        {s.common_facts.length > 0 && <ul className="condition-list">{s.common_facts.map((text, i) => <li key={i}><Markdown text={text} /></li>)}</ul>}
      </section>}
      {s.additional_information.length > 0 && <section className="material-section" data-material-section="additional"><h4 tabIndex={-1}>{ui.additional}</h4>
        {s.additional_information.map((info, i) => <section className="supplement" key={i}><h5>{info.title}</h5><Markdown text={info.text} /></section>)}
      </section>}
      {s.knowledge.length > 0 && <section className="material-section" data-material-section="knowledge"><h4 tabIndex={-1}>{ui.knowledge}</h4>{s.knowledge.map((term, i) => <details className="knowledge" key={i} open
        onToggle={e => onEvent?.('information_toggle', { section: term.title, open: e.currentTarget.open })}>
        <summary>{term.title}</summary><Markdown text={term.text} />
      </details>)}</section>}
    </section>
  </article>;
}
