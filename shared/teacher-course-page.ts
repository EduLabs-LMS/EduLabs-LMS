import type { CourseStatus } from '@/shared/teacher-home';

/** The course page (Settings > Courses > one course). Pure helpers; the database decides who may read or change anything. */
export type CoursePageData = {
  id: string; organizationId: string; spaceName: string;
  /** Only with more than one teaching space is the space named on the page. */
  showSpace: boolean;
  title: string; description: string | null; status: CourseStatus;
  /** The version this page read; a change sends it back, so a change made elsewhere is refused instead of overwritten. */
  updatedAt: string;
  /** Mirrors the server rule (owner or admin of the space, or course staff as owner, instructor or editor). The server checks again on save. */
  canEdit: boolean;
};
export type CourseLoad = { state: 'ready'; course: CoursePageData } | { state: 'missing' } | { state: 'error'; status: number | null };

/** Publishing moves between exactly these two states; an archived course is not changed from this page. */
export const nextStatus = (status: CourseStatus): 'draft' | 'published' | null => status === 'draft' ? 'published' : status === 'published' ? 'draft' : null;

export type CourseFailureKind = 'signin' | 'denied' | 'changed' | 'invalid' | 'unknown' | 'failed';
/** `status` is null when no reply arrived: the change may or may not have been saved. */
export function courseFailure(status: number | null): CourseFailureKind {
  if (status === null) return 'unknown';
  if (status === 401) return 'signin';
  if (status === 403 || status === 404) return 'denied';
  if (status === 409) return 'changed';
  if (status === 400 || status === 413 || status === 415) return 'invalid';
  return 'failed';
}

export const coursePagePath = (id: string) => `/teacher/settings/courses/${id}`;
export const coursePagePattern = /^\/teacher\/settings\/courses\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
