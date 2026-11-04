import { useEffect } from 'react';

const LEAVE = 'fcm-admin-before-leave';
export function confirmDiscard() {
  const event = new Event(LEAVE, { cancelable: true });
  window.dispatchEvent(event);
  return !event.defaultPrevented || window.confirm('配置尚未保存。是否放弃这些修改并继续？');
}
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const leave = (event: Event) => event.preventDefault();
    window.addEventListener('beforeunload', unload);
    window.addEventListener(LEAVE, leave);
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener(LEAVE, leave); };
  }, [dirty]);
}
