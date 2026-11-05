/**
 * Stale-while-revalidate for the teacher screens: a revisit shows the last data at once and refreshes it in the background.
 *
 * Safety rules (do not relax; each has a test in scripts/swr-cache.test.cjs):
 *  - Memory only, in this tab. Nothing is written to localStorage, sessionStorage, cookies or IndexedDB, so a closed tab or a reload forgets it.
 *  - Scoped per signed-in user: every entry belongs to the owner (the Firebase uid) that was set when it was stored, and is read back only
 *    while that same owner is signed in. With no owner set nothing is stored and nothing is returned.
 *  - Cleared when the owner changes or the person signs out (the auth provider calls setSwrOwner(null) / clearSwr()).
 *  - It never decides anything about access. Every shown entry is read again from the API (which checks the caller afresh); if that
 *    answer is a refusal (401, 403, 404) the entry is removed and the refusal is shown instead.
 *  - Failures are never stored, and an entry is dropped after MAX_AGE_MS so very old data is not shown at all.
 */
export const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

type Entry = { value: unknown; at: number };
let owner: string | null = null;
let entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const now = () => Date.now();

const scoped = (key: string) => (owner === null ? null : `${owner}\u0000${key}`);

/** Called by the auth provider whenever the signed-in user changes. A different (or no) user starts with an empty cache. */
export function setSwrOwner(next: string | null) {
  if (next === owner) return;
  owner = next;
  entries = new Map();
  listeners.forEach(notify => notify());
}

/** Forgets everything now (sign-out). */
export function clearSwr() {
  entries = new Map();
  owner = null;
  listeners.forEach(notify => notify());
}

export function swrOwner() { return owner; }

/** The last stored value for this user, or undefined (nothing stored, expired, or no owner). */
export function swrPeek<T>(key: string): T | undefined {
  const k = scoped(key);
  if (k === null) return undefined;
  const hit = entries.get(k);
  if (!hit) return undefined;
  if (now() - hit.at > MAX_AGE_MS) { entries.delete(k); return undefined; }
  return hit.value as T;
}

/**
 * `startedAs` is the owner when the read began. An answer that arrives after the person changed (sign-out, another user) is never stored: it was read
 * for someone else and must not end up under the new owner.
 */
export function swrStore<T>(key: string, value: T, startedAs?: string | null) {
  if (startedAs !== undefined && startedAs !== owner) return;
  const k = scoped(key);
  if (k === null) return;
  entries.delete(k);
  entries.set(k, { value, at: now() });
  if (entries.size > MAX_ENTRIES) { const oldest = entries.keys().next().value; if (oldest !== undefined) entries.delete(oldest); }
}

export function swrDrop(key: string) {
  const k = scoped(key);
  if (k !== null) entries.delete(k);
}

/** Drops every entry whose key starts with the prefix (after a change that makes a whole family of reads stale). */
export function swrDropPrefix(prefix: string) {
  if (owner === null) return;
  const start = `${owner}\u0000${prefix}`;
  Array.from(entries.keys()).forEach(k => { if (k.startsWith(start)) entries.delete(k); });
}

export function swrSize() { return entries.size; }
export function onSwrReset(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** A refusal means the cached copy must not be shown any more. */
export const isRefusal = (status: unknown) => status === 401 || status === 403 || status === 404;
