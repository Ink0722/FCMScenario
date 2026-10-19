import { useRef, useState } from 'react';
import { clearDraft, readDraft, writeDraft } from './drafts';

export function useDraft<T>(key: string, revision: string, initial: T,
  valid: (value: unknown) => value is T, isEmpty: (value: T) => boolean) {
  const [loaded] = useState(() => readDraft(key, revision, valid));
  const [value, setValue] = useState<T>(() => loaded ?? initial);
  const current = useRef(value);
  const [restored, setRestored] = useState(loaded !== null);
  const [failed, setFailed] = useState(false);
  const update = (next: T | ((previous: T) => T)) => {
    const result = typeof next === 'function' ? (next as (previous: T) => T)(current.current) : next;
    current.current = result;
    // Synchronous persistence protects the last keystroke before a reload.
    setFailed(!(isEmpty(result) ? clearDraft(key) : writeDraft(key, revision, result)));
    setRestored(false);
    setValue(result);
  };
  return { value, update, restored, failed, hasValue: !isEmpty(value) };
}
