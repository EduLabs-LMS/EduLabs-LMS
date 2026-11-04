import { failureKind, type FailureKind } from '@/shared/teacher-groups';

/** `status` is null when no reply arrived: for a change, the outcome is then unknown and must not be retried blindly. */
export class GroupCallError extends Error {
  constructor(readonly status: number | null) { super(String(status)); }
  get kind(): FailureKind { return failureKind(this.status); }
}

export async function postJson<T>(url: string, body: object, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new GroupCallError(null);
  }
  if (!response.ok) throw new GroupCallError(response.status);
  try { return await response.json() as T; } catch { throw new GroupCallError(null); }
}

/** The one existing Groups endpoint. The database decides who may read or change what. */
export const groupCall = <T>(action: string, groupId: string | null, data: object = {}, version: number | null = null, signal?: AbortSignal) =>
  postJson<T>('/api/study-groups', { action, groupId, version, data }, signal);

export const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

/** A few reads at a time, so a list of many Groups does not open one connection per card. */
let running = 0;
const waiting: (() => void)[] = [];
export async function limited<T>(job: () => Promise<T>, max = 3): Promise<T> {
  if (running >= max) await new Promise<void>(resolve => waiting.push(resolve));
  running++;
  try { return await job(); } finally { running--; waiting.shift()?.(); }
}
