import { ui } from './copy';
import { useModalDialog } from './useModalDialog';

export function ReturnHomeDialog({ busy, error, onCancel, onConfirm, description = ui.returnDescription, cancelLabel = ui.keepWorking, confirmLabel = ui.confirmReturn }: {
  busy: boolean; error: string; onCancel: () => void; onConfirm: () => void;
  description?: string;
  cancelLabel?: string;
  confirmLabel?: string;
}) {
  const ref = useModalDialog();
  return <dialog ref={ref} className="end-dialog" aria-labelledby="return-home-title" aria-describedby="return-home-description"
    onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="return-home-title">{ui.returnTitle}</h2>
    <p id="return-home-description">{description}</p>
    {error && <div className="error-message" role="alert">{error}</div>}
    <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
      <button type="button" className="button secondary destructive" disabled={busy} onClick={onConfirm}>{busy ? ui.returning : confirmLabel}</button></div>
  </dialog>;
}
