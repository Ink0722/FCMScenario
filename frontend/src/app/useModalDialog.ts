import { useEffect, useRef } from 'react';

// Capture focus before showModal moves it; React autoFocus would run earlier
// and lose the opener. Native showModal focuses the first (cancel) button.
export function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}
