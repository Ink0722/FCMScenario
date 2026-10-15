import { Markdown } from './Markdown';

export function TaskPanel({ task }: { task: string }) {
  return <section className="task-panel" aria-label="决策任务"><h2>决策任务</h2><Markdown text={task} /></section>;
}
