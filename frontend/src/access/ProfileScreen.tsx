import { useState } from 'react';
import { SiteHeader } from '../app/ExperimentLayout';
import { ReturnHomeDialog } from '../app/ReturnHomeDialog';
import type { ParticipantProfile } from '../integration/contracts';
import { ProfileForm } from '../questionnaire/ProfileForm';

export function ProfileScreen({ profile, busy, error, onSubmit, onReturnToTasks }: {
  profile: ParticipantProfile; busy: boolean; error: string;
  onSubmit: (answers: Record<string, string>) => void; onReturnToTasks: () => void;
}) {
  const [confirmReturn, setConfirmReturn] = useState(false);
  return <><SiteHeader busy={busy} onReturnHome={() => setConfirmReturn(true)} /><main id="main-content" className="page-main focused-page">
    <header className="page-heading"><h1>用户资料</h1><p>开始前，我们想了解一些你的基本情况。请按实际情况填写，这份问卷只需完成一次。</p></header>
    <section className="surface" aria-label="用户资料问卷">
      <ProfileForm questions={profile.questions} busy={busy} onSubmit={onSubmit} />
      {error && <div className="error-message" role="alert">{error}</div>}
    </section>
    <button type="button" className="button secondary profile-change-code" disabled={busy} onClick={() => setConfirmReturn(true)}>返回任务列表</button>
  </main>{confirmReturn && <ReturnHomeDialog busy={busy} error={error} onCancel={() => setConfirmReturn(false)} onConfirm={onReturnToTasks}
    description="你填写的用户资料还未提交，返回后不会保存。如果想稍后填写，可以先回到任务列表。" cancelLabel="继续填写" />}</>;
}
