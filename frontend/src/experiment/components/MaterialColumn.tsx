import { ui } from '../../app/copy';
import { useRef, useState } from 'react';
import type { Scenario } from '../../content/types';
import type { ExperimentEvent } from '../../integration/contracts';
import { ScenarioPanel } from './ScenarioPanel';

export function MaterialColumn({ scenario, taskNumber, onEvent }: {
  scenario: Scenario; taskNumber: string;
  onEvent: (kind: ExperimentEvent['kind'], details: ExperimentEvent['details']) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState('background');
  const sections = [
    { key: 'background', label: ui.backgroundNav }, { key: 'conditions', label: ui.conditionsNav }, { key: 'comparison', label: ui.comparisonNav },
    ...(scenario.additional_information.length ? [{ key: 'additional', label: ui.additionalNav }] : []),
    { key: 'references', label: 'PDF' }, { key: 'knowledge', label: ui.knowledgeNav },
  ];
  const navigate = (key: string) => {
    const section = scroll.current?.querySelector<HTMLElement>(`[data-material-section="${key}"]`);
    if (!section || !scroll.current) return;
    scroll.current.scrollTop += section.getBoundingClientRect().top - scroll.current.getBoundingClientRect().top - 12;
    section.querySelector<HTMLElement>('h2, h3')?.focus({ preventScroll: true });
  };
  const updateActive = () => {
    if (!scroll.current) return;
    const top = scroll.current.getBoundingClientRect().top;
    const nodes = [...scroll.current.querySelectorAll<HTMLElement>('[data-material-section]')];
    const current = nodes.filter(node => node.getBoundingClientRect().top <= top + 32).at(-1) ?? nodes[0];
    if (current) setActive(current.dataset.materialSection!);
  };
  return <aside className="scenario-column" aria-label={ui.materials}>
    <div className="column-heading"><span className="material-task-number">{ui.taskNumber} <strong>{taskNumber}</strong></span><nav className="material-nav" aria-label={ui.materialSections}>{sections.map(section =>
      <button key={section.key} type="button" aria-current={active === section.key ? 'location' : undefined} onClick={() => navigate(section.key)}>{section.label}</button>
    )}</nav></div>
    <div className="scenario-scroll" ref={scroll} onScroll={updateActive}>
      <ScenarioPanel scenario={scenario} compact onEvent={onEvent} />
    </div>
  </aside>;
}
