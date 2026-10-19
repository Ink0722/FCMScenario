import { ui } from './copy';

export function DraftStatus({ failed }: { failed: boolean }) {
  if (failed) return <p className="draft-status draft-error" role="alert">{ui.draftUnavailable}</p>;
  return null;
}
