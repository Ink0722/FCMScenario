import { ui } from '../app/copy';
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
    <header className="page-heading"><h1>{ui.profile}</h1><p>{ui.profileIntro}</p></header>
    <section className="surface" aria-label={ui.profile}>
      <ProfileForm questions={profile.questions} busy={busy} onSubmit={onSubmit} />
      {error && <div className="error-message" role="alert">{error}</div>}
    </section>
  </main>{confirmReturn && <ReturnHomeDialog busy={busy} error={error} onCancel={() => setConfirmReturn(false)} onConfirm={onReturnToTasks}
    description={ui.profileReturn} cancelLabel={ui.keepFilling} confirmLabel={ui.profileConfirmReturn} />}</>;
}
