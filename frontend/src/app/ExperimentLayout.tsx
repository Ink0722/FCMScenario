import type { ReactNode } from 'react';
import type { Stage } from '../experiment/flow/reducer';

const stages: { key: Stage; label: string }[] = [
  { key: 'pre', label: '阅读与初始判断' }, { key: 'dialogue', label: '交流' },
  { key: 'post', label: '最终判断' }, { key: 'complete', label: '完成' },
];
export function SiteHeader({ children, onReturnHome, busy = false }: { children?: ReactNode; onReturnHome?: () => void; busy?: boolean }) {
  return <><a className="skip-link" href="#main-content">跳到主要内容</a><header className="site-header"><div className="header-inner">
    <div className="header-brand"><div className="site-title"><img className="site-symbol" src={`${import.meta.env.BASE_URL}decision-mark.svg`} alt="" width="26" height="26" />金融决策任务</div>
      {onReturnHome && <button type="button" className="home-button" disabled={busy} onClick={onReturnHome}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m10 5-7 7 7 7M3 12h18" /></svg>返回主界面</button>}
    </div>{children}
  </div></header></>;
}
export function ExperimentHeader({ stage, busy, onReturnHome }: { stage: Stage; busy: boolean; onReturnHome: () => void }) {
  const current = stages.findIndex(s => s.key === (stage === 'finishing' ? 'post' : stage));
  return <SiteHeader busy={busy} onReturnHome={onReturnHome}><nav className="stage-nav" aria-label="实验阶段"><ol>{stages.map((s, i) => <li key={s.key} className={i === current ? `current${stage === 'complete' ? ' finished' : ''}` : i < current ? 'done' : ''} aria-current={i === current ? 'step' : undefined}>
    <span className="stage-number" aria-hidden="true">{i < current ? '✓' : String(i + 1).padStart(2, '0')}</span><span>{s.label}</span>
  </li>)}</ol></nav></SiteHeader>;
}
