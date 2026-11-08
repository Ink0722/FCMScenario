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
    { key: 'background', label: ui.backgroundNav }, { key: 'comparison', label: ui.comparisonNav },
    ...(scenario.references.length || scenario.common_facts.length ? [{ key: 'conditions', label: ui.conditionsNav }] : []),
    ...(scenario.references.length ? [{ key: 'references', label: 'PDF' }] : []),
    ...(scenario.additional_information.length ? [{ key: 'additional', label: ui.additionalNav }] : []),
    ...(scenario.knowledge.length ? [{ key: 'knowledge', label: ui.knowledgeNav }] : []),
  ];
  const navigate = (key: string) => {
    const section = scroll.current?.querySelector<HTMLElement>(`[data-material-section="${key}"]`);
    if (!section || !scroll.current) return;
    scroll.current.scrollTop += section.getBoundingClientRect().top - scroll.current.getBoundingClientRect().top - 12;
    setActive(key);
    section.querySelector<HTMLElement>('h2, h3, h4, [data-material-anchor]')?.focus({ preventScroll: true });
  };
  const updateActive = () => {
    if (!scroll.current) return;
    const top = scroll.current.getBoundingClientRect().top;
    const nodes = [...scroll.current.querySelectorAll<HTMLElement>('[data-material-section]')];
    const passed = nodes.filter(node => node.getBoundingClientRect().top <= top + 32);
    const atBottom = scroll.current.scrollHeight > scroll.current.clientHeight
      && scroll.current.scrollTop + scroll.current.clientHeight >= scroll.current.scrollHeight - 2;
    const current = atBottom ? nodes.at(-1)
      : passed.filter(node => node.getBoundingClientRect().bottom > top + 32).at(-1) ?? passed.at(-1) ?? nodes[0];
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
