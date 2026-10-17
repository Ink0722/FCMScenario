import { ui } from '../../app/copy';
import { useModalDialog } from '../../app/useModalDialog';

export function EndDialog({ busy, error, onCancel, onConfirm }: { busy: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  const ref = useModalDialog();
  return <dialog ref={ref} className="end-dialog" aria-labelledby="end-title" aria-describedby="end-description"
    onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="end-title">{ui.endTitle}</h2>
    <p id="end-description">{ui.endDescription}</p>
    {error && <div className="error-message" role="alert">{error}</div>}
    <div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={onCancel}>{ui.keepTalking}</button>
      <button className="button primary" disabled={busy} onClick={onConfirm}>{busy ? ui.continuing : ui.endConfirm}</button></div>
  </dialog>;
}
