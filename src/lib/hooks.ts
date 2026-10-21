import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Phone-sized layout: drawer sidebar, stacked panels. */
export const MOBILE_QUERY = "(max-width: 760px)";

/** Responses by path, so going back to a page shows it at once while it refreshes. */
const cache = new Map<string, unknown>();

export interface Loaded<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** GETs `path` (null: nothing to load), keeping the previous data on screen while the next loads. */
export function useApi<T>(path: string | null): Loaded<T> {
  const [data, setData] = useState<T | undefined>(() => (path ? (cache.get(path) as T | undefined) : undefined));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [nonce, setNonce] = useState(0);
  const current = useRef(path);
  current.current = path;

  useEffect(() => {
    if (!path) return;
    let live = true;
    const hit = cache.get(path) as T | undefined;
    if (hit !== undefined) setData(hit);
    setLoading(true);
    api<T>(path).then(
      (value) => {
        cache.set(path, value);
        if (live) {
          setData(value);
          setError(null);
          setLoading(false);
        }
      },
      (e: Error) => {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

/** Drops cached responses (after a change that affects stats). */
export function invalidate(prefix = "") {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

/** Keeps a text field's value until submitted, with a "saved" flash. */
export function useFlash(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number>(undefined);
  const flash = useCallback((m: string) => {
    setMessage(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 4000);
  }, []);
  return [message, flash];
}
