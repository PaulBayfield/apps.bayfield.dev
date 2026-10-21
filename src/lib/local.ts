// Favorites and recently opened apps, kept on this device (by app id).

import { useCallback, useEffect, useState } from "react";

const FAVORITES = "apps.favorites";
const RECENT = "apps.recent";
const RECENT_MAX = 30;

export interface RecentEntry {
  id: string;
  at: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not critical.
  }
  window.dispatchEvent(new CustomEvent("apps:local", { detail: key }));
}

/** Re-renders when another component (or tab) changes `key`. */
function useStored<T>(key: string, fallback: T): T {
  const [value, setValue] = useState(() => read(key, fallback));
  useEffect(() => {
    const onLocal = (e: Event) => (e as CustomEvent).detail === key && setValue(read(key, fallback));
    const onStorage = (e: StorageEvent) => e.key === key && setValue(read(key, fallback));
    window.addEventListener("apps:local", onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("apps:local", onLocal);
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return value;
}

/** Favorite app ids, in the order they were starred. */
export function useFavorites() {
  const ids = useStored<string[]>(FAVORITES, []);
  const toggle = useCallback((id: string) => {
    const cur = read<string[]>(FAVORITES, []);
    write(FAVORITES, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }, []);
  return { ids, toggle, has: (id: string) => ids.includes(id) };
}

/** Most recent first. */
export function useRecent() {
  const entries = useStored<RecentEntry[]>(RECENT, []);
  const clear = useCallback(() => write(RECENT, []), []);
  return { entries, clear };
}

export function recordOpened(id: string) {
  const cur = read<RecentEntry[]>(RECENT, []).filter((e) => e.id !== id);
  write(RECENT, [{ id, at: Date.now() }, ...cur].slice(0, RECENT_MAX));
}
