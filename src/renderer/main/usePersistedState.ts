import { useEffect, useState } from 'react';

/**
 * useState + localStorage. Persists the value across app restarts under a
 * stable key, and re-hydrates on mount. JSON-serializable values only.
 *
 * Versioned prefix lets us reset everything with a single bump if the shape
 * of the stored data changes in a breaking way.
 */
const PREFIX = 'qnsub.v1.';

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

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // quota exceeded or Safari private mode — silently ignore
    }
  }, [storageKey, value]);

  return [value, setValue];
}
