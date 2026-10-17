import { ui } from '../../app/copy';
import { Markdown } from './Markdown';

export function TaskPanel({ task }: { task: string }) {
  return <section className="task-panel" aria-label={ui.task}><h2>{ui.task}</h2><div lang={/[\u3400-\u9fff]/.test(task) ? 'zh-CN' : undefined}><Markdown text={task} /></div></section>;
}
