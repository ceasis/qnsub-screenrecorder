import { useEffect, useRef, useState } from 'react';

/**
 * useState + localStorage. Persists the value across app restarts under a
 * stable key, and re-hydrates on mount. JSON-serializable values only.
 *
 * Writes are debounced by 150ms so slider drags — which can fire state
 * updates at 60Hz — don't hammer `localStorage.setItem` (a synchronous
 * main-thread call). The latest value still gets persisted reliably:
 * - any state change queues a pending write for 150ms later
 * - further changes within that window replace the pending value
 * - on component unmount we flush any pending write immediately
 * - on page `visibilitychange: hidden` / `beforeunload` we also flush,
 *   so closing the window never loses the last few ticks of a slider.
 *
 * Versioned prefix lets us reset everything with a single bump if the
 * shape of the stored data changes in a breaking way.
 */
const PREFIX = 'qnsub.v1.';
const DEBOUNCE_MS = 150;

export function usePersistedState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const storageKey = PREFIX + key;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  // Latest value + pending-flush timer tracked via refs so the effect
  // below can capture them without re-subscribing on every render.
  const latestRef = useRef<T>(value);
  latestRef.current = value;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Debounce the write.
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      try {
        localStorage.setItem(storageKey, JSON.stringify(latestRef.current));
      } catch {
        // quota exceeded or Safari private mode — silently ignore
      }
    }, DEBOUNCE_MS);
  }, [storageKey, value]);

  // Flush on unmount and on page-hide so a window close doesn't lose
  // the last few slider ticks. `visibilitychange` fires before the
  // main-process `before-quit`, which is the last chance to persist
  // synchronously.
  useEffect(() => {
    const flush = () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify(latestRef.current));
      } catch {}
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVis);
      flush();
    };
  }, [storageKey]);

  return [value, setValue];
}
