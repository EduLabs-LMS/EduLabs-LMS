import 'server-only';
import { cookies } from 'next/headers';

/**
 * Per-request scope: timing marks and request-local memoization.
 *
 * Security rule (do not relax): nothing in here outlives one HTTP request or is shared between requests or users.
 * The scope is keyed on the request's own cookie store object, which Next creates once per request. A memoized
 * value is also tied to the exact credential it was computed for (`proof`), expires after 30 s, and is never read
 * when the request has no cookie store. A verification result is therefore reused only by later code in the SAME
 * request that holds the SAME token; the next request always verifies again (including the revocation check).
 */
type Mark = { name: string; ms: number; count: number };
type Memo = { proof: string; at: number; value: Promise<unknown> };
export type RequestScope = { startedAt: number; marks: Map<string, Mark>; memo: Map<string, Memo> };

const scopes = new WeakMap<object, RequestScope>();
const MEMO_MAX_AGE_MS = 30_000;

/** Measurement switch only: LMS_DISABLE_REQUEST_MEMO=1 turns the per-request reuse off, to compare before and after. Never set in staging or production. */
const memoDisabled = () => process.env.LMS_DISABLE_REQUEST_MEMO === '1';

export function serverTimingEnabled() {
  return process.env.LMS_SERVER_TIMING === '1';
}

/** The scope of the current request, or null outside a request (scripts, tests): callers then simply do not memoize. */
export async function requestScope(): Promise<RequestScope | null> {
  let key: object;
  try { key = await cookies(); } catch { return null; }
  let scope = scopes.get(key);
  if (!scope) { scope = { startedAt: performance.now(), marks: new Map(), memo: new Map() }; scopes.set(key, scope); }
  return scope;
}

/** Runs `compute` once per request for this key and credential proof; a different proof or an old entry recomputes. */
export async function requestMemo<T>(key: string, proof: string, compute: () => Promise<T>): Promise<T> {
  const scope = await requestScope();
  if (!scope || memoDisabled()) return compute();
  const now = performance.now();
  const hit = scope.memo.get(key);
  if (hit && hit.proof === proof && now - hit.at < MEMO_MAX_AGE_MS) return hit.value as Promise<T>;
  const value = compute();
  scope.memo.set(key, { proof, at: now, value });
  // A failure must not be remembered as an answer.
  value.catch(() => { if (scope.memo.get(key)?.value === value) scope.memo.delete(key); });
  return value;
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 48);

export function addMark(scope: RequestScope, name: string, ms: number) {
  const key = safeName(name);
  const mark = scope.marks.get(key);
  if (mark) { mark.ms += ms; mark.count += 1; } else scope.marks.set(key, { name: key, ms, count: 1 });
}

/** Times one phase. When timing is off this is a plain call. Names are fixed phase names; never put ids, tokens or user data in them. */
export async function timePhase<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (!serverTimingEnabled()) return run();
  const scope = await requestScope();
  if (!scope) return run();
  const started = performance.now();
  try { return await run(); } finally { addMark(scope, name, performance.now() - started); }
}

/** `name;dur=ms;desc="xN"`: phase names, durations and counts only. */
export function serverTimingValue(scope: RequestScope, total = true) {
  const parts = Array.from(scope.marks.values()).map(m => `${m.name};dur=${m.ms.toFixed(1)};desc="x${m.count}"`);
  if (total) parts.push(`total;dur=${(performance.now() - scope.startedAt).toFixed(1)}`);
  return parts.join(', ');
}
