import { ui } from '../../app/copy';
import { useEffect, useRef, useState } from 'react';
import type { Scenario, SharedCopy } from '../../content/types';
import type { Decision, ExperimentEvent } from '../../integration/contracts';
import { DecisionPanel } from '../components/DecisionPanel';
import { MaterialColumn } from '../components/MaterialColumn';
import { TaskPanel } from '../components/TaskPanel';

interface Props {
  stage: 'pre' | 'post'; scenario: Scenario; shared: SharedCopy; taskNumber: string; busy: boolean; error: string;
  onSubmit: (decision: Decision) => void;
  onEvent: (kind: ExperimentEvent['kind'], details: ExperimentEvent['details']) => void;
}
export function DecisionScreen({ stage, scenario, shared, taskNumber, busy, error, onSubmit, onEvent }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <main id="main-content" className="experiment-workspace decision-workspace">
    <MaterialColumn scenario={scenario} taskNumber={taskNumber} onEvent={onEvent} />
    <section className="decision-column" aria-label={stage === 'pre' ? ui.initial : ui.final}>
      <div className="column-heading"><h1 ref={heading} tabIndex={-1}>{stage === 'pre' ? ui.initial : ui.final}</h1></div>
      <div className="decision-scroll"><div className="decision-content">
        <TaskPanel task={scenario.task} />
        <DecisionPanel scenario={scenario} shared={shared} prompt={stage === 'pre' ? shared.pre_prompt : shared.post_prompt}
          busy={busy} onSubmit={onSubmit} actionsTarget={actionsTarget} buttonLabel={stage === 'pre' ? ui.saveInitial : ui.saveFinal} />
        {error && <div className="error-message" role="alert">{error}</div>}
      </div></div>
      <div className="decision-action-area" ref={setActionsTarget} />
    </section>
  </main>;
}
