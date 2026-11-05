'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isRefusal, onSwrReset, swrDrop, swrOwner, swrPeek, swrStore } from './swr-cache';

export type Swr<T, E> = { state: 'loading' } | { state: 'error'; error: E } | { state: 'ready'; value: T; refreshing: boolean };

/**
 * One read with stale-while-revalidate (see swr-cache.ts for the safety rules).
 * - With a cached copy for this user the hook is `ready` on the first render and reads again in the background (`refreshing`).
 * - Without one it is `loading` until the first answer.
 * - A background read that fails keeps the cached copy on screen (it was valid moments ago) unless the answer is a refusal (401/403/404): then the
 *   copy is removed and the refusal is shown. A read with no cached copy that fails is an error, never an empty result.
 * `key` null reads nothing (the caller is waiting for something else).
 */
export function useSwr<T, E>(key: string | null, read: (signal: AbortSignal) => Promise<T>, toError: (e: unknown) => E): { data: Swr<T, E>; retry: () => void; mutate: (next: T) => void } {
  const initial = (): Swr<T, E> => {
    const hit = key === null ? undefined : swrPeek<T>(key);
    return hit !== undefined ? { state: 'ready', value: hit, refreshing: true } : { state: 'loading' };
  };
  const [data, setData] = useState<Swr<T, E>>(initial);
  const [revision, setRevision] = useState(0);
  const readRef = useRef(read);
  readRef.current = read;
  const errorRef = useRef(toError);
  errorRef.current = toError;
  const lastKey = useRef(key);

  // A different key (another course, another page) starts from what is cached for that key, not from the previous key's data.
  if (lastKey.current !== key) { lastKey.current = key; setData(initial()); }

  // Signing out or switching user empties the cache: nothing of the previous user may stay on a mounted screen.
  useEffect(() => onSwrReset(() => { setData({ state: 'loading' }); setRevision(v => v + 1); }), []);

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    const startedAs = swrOwner();
    setData(d => d.state === 'ready' ? (d.refreshing ? d : { ...d, refreshing: true }) : d.state === 'error' ? { state: 'loading' } : d);
    readRef.current(controller.signal).then(
      value => { if (controller.signal.aborted) return; swrStore(key, value, startedAs); setData({ state: 'ready', value, refreshing: false }); },
      failure => {
        if (controller.signal.aborted) return;
        const error = errorRef.current(failure);
        const status = (failure as { status?: unknown } | null)?.status ?? (error as { status?: unknown } | null)?.status;
        if (isRefusal(status)) { swrDrop(key); setData({ state: 'error', error }); return; }
        setData(d => d.state === 'ready' ? { ...d, refreshing: false } : { state: 'error', error });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);

  const retry = useCallback(() => { setData(d => d.state === 'error' ? { state: 'loading' } : d); setRevision(v => v + 1); }, []);
  const mutate = useCallback((next: T) => { if (key !== null) swrStore(key, next); setData({ state: 'ready', value: next, refreshing: false }); }, [key]);
  return { data, retry, mutate };
}
