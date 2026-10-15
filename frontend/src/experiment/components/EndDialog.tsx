import { useEffect, useRef } from 'react';

export function EndDialog({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="end-dialog" aria-labelledby="end-title" aria-describedby="end-description"
    onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="end-title">结束交流？</h2>
    <p id="end-description">如果还有想了解的内容，可以继续交流。确认结束后，我们会请你作出最终判断，之后不能再回到交流。</p>
    <div className="dialog-actions"><button className="button secondary" autoFocus disabled={busy} onClick={onCancel}>继续交流</button>
      <button className="button primary" disabled={busy} onClick={onConfirm}>{busy ? '正在继续…' : '结束并继续'}</button></div>
  </dialog>;
}
