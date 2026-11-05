/**
 * "First load after sign-in": the one moment the EduLabs logo overlay plays (owner decision, DECISIONS.md). Everything after it is the app frame
 * with a skeleton of the page in the content area.
 *
 * The sign-in code marks the moment; the loading provider plays the overlay once and clears the mark. The mark lives in sessionStorage only so a
 * full page load in the middle of signing in (the Google redirect) still counts; a later reload, a new tab or a restored session never replays it,
 * and signing out removes it. It carries no user data.
 */
const KEY = 'edulabs-first-load';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; } };

export function markFirstLoad(storage: Store | null = store()) {
  try { storage?.setItem(KEY, 'pending'); } catch { /* private mode: the overlay is then simply skipped */ }
}
export function firstLoadPending(storage: Store | null = store()) {
  try { return storage?.getItem(KEY) === 'pending'; } catch { return false; }
}
export function clearFirstLoad(storage: Store | null = store()) {
  try { storage?.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** Longest the overlay stays up after sign-in, from its first frame (400 + 200 + the 250 ms fade: gone in about 0.85 s, always under one second). */
export const FIRST_LOAD_CAP_MS = 400;
/** Shortest it stays, so a fast page does not make it flash. */
export const FIRST_LOAD_MIN_MS = 250;
/** The word completes and the overlay fades. */
export const FIRST_LOAD_FINISH_MS = 200;
