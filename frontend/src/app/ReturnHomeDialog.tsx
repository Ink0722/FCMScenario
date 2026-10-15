import { useEffect, useRef } from 'react';

export function ReturnHomeDialog({ busy, error, onCancel, onConfirm, description = '现在返回的话，这次任务的进度不会保存，作答和交流记录也会清除。已提交的用户资料会保留；再次选择这个任务时，需要从头开始。', cancelLabel = '继续测试' }: {
  busy: boolean; error: string; onCancel: () => void; onConfirm: () => void;
  description?: string;
  cancelLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="end-dialog" aria-labelledby="return-home-title" aria-describedby="return-home-description"
    onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="return-home-title">返回主界面？</h2>
    <p id="return-home-description">{description}</p>
    {error && <div className="error-message" role="alert">{error}</div>}
    <div className="dialog-actions"><button type="button" className="button secondary" autoFocus disabled={busy} onClick={onCancel}>{cancelLabel}</button>
      <button type="button" className="button primary" disabled={busy} onClick={onConfirm}>{busy ? '正在返回…' : '确认返回'}</button></div>
  </dialog>;
}
