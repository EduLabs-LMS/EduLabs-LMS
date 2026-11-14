import { GroupCallError } from '@/frontend/features/teacher-groups/api';

/** One read of a report. A failure is never "nothing found": the status says why (no reply = null) and the screen shows it with Retry. */
export async function reportGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal }); } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new GroupCallError(null);
  }
  if (!response.ok) throw new GroupCallError(response.status);
  try { return await response.json() as T; } catch { throw new GroupCallError(null); }
}

/** A month of a report ('YYYY-MM' or 'all'); null is this month and sends nothing. */
export const monthQuery = (month: string | null) => month ? `?month=${month}` : '';
