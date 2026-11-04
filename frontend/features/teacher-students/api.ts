import { administer } from '@/frontend/lib/student-administration';
import { GroupCallError, groupCall, limited } from '@/frontend/features/teacher-groups/api';
import type { GroupPage, StudyGroup } from '@/shared/contracts/groups';
import { LIST_PAGES } from '@/shared/teacher-groups';
import type { AdminOffering } from '@/shared/contracts/student-administration';

/** The existing student-administration endpoint. `status` is null when no reply arrived: for a change the outcome is then unknown and the same request id is reused. */
export async function adminCall<T>(action: string, data: object = {}, extra: { offeringId?: string | null; subjectId?: string | null; version?: number | null; requestId?: string } = {}): Promise<T> {
  try { return await administer<T>(action, data, extra); } catch (e) {
    const status = (e as { status?: unknown }).status;
    throw new GroupCallError(typeof status === 'number' ? status : null);
  }
}
/** Reads go through the shared limiter, so a long list never opens a connection per course. Changes are sent at once. */
export const adminRead = <T>(action: string, data: object, offeringId: string | null = null) => limited(() => adminCall<T>(action, data, { offeringId }));

export const newRequestId = () => crypto.randomUUID();

export const asCallError = (e: unknown) => e instanceof GroupCallError ? e : new GroupCallError(null);

/** Every course the teacher can look at, a page at a time. */
export async function readOfferings(): Promise<AdminOffering[]> {
  const rows: AdminOffering[] = [];
  for (let page = 0; page < 8; page++) {
    const result = await adminRead<{ rows: AdminOffering[] }>('offerings', { page });
    rows.push(...result.rows);
    if (result.rows.length < 25) break;
  }
  return rows;
}

/** The Groups this teacher can see, with the same read the Groups list uses. */
export async function readGroups(): Promise<StudyGroup[]> {
  const rows: StudyGroup[] = [];
  for (let page = 0; page < LIST_PAGES; page++) {
    const result = await limited(() => groupCall<GroupPage<StudyGroup>>('view', null, { section: 'sessions', page, search: '' }));
    rows.push(...result.rows);
    if (!result.hasMore) break;
  }
  return rows;
}

export { GroupCallError, groupCall, limited };
