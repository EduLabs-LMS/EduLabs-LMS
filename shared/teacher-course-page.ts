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
  /** Publish, unpublish, archive: the course owner or instructor, or the space owner or admin (public.course_update). An editor changes text only. */
  canChangeStatus: boolean;
  /** Restoring an archived course: the space owner or admin only (public.course_update). */
  canRestore: boolean;
};
export type CourseLoad = { state: 'ready'; course: CoursePageData } | { state: 'missing' } | { state: 'error'; status: number | null };

/** Publishing moves between exactly these two states; an archived course is only restored (below). */
export const nextStatus = (status: CourseStatus): 'draft' | 'published' | null => status === 'draft' ? 'published' : status === 'published' ? 'draft' : null;

type Role = { role: string; status: string } | null;
/** The same rules as public.course_update, for showing buttons only; the database decides again on every save. */
export function canChangeCourseStatus(membership: Role, staff: { role: string } | null) {
  return !!membership && membership.status === 'active' && (['owner', 'admin'].includes(membership.role) || !!staff && ['owner', 'instructor'].includes(staff.role));
}
export const canRestoreCourse = (membership: Role) => !!membership && membership.status === 'active' && ['owner', 'admin'].includes(membership.role);

/** The name and description a teacher may type: the limits of shared/teacher-course.ts (title 1 to 200 after trimming, description up to 20000). */
export const COURSE_TITLE_MAX = 200, COURSE_DESCRIPTION_MAX = 20000;
export type CourseTextProblem = 'empty_name' | 'name_long' | 'about_long';
export function courseTextProblem(title: string, description: string): CourseTextProblem | null {
  if (!title.trim()) return 'empty_name';
  if (title.trim().length > COURSE_TITLE_MAX) return 'name_long';
  if (description.length > COURSE_DESCRIPTION_MAX) return 'about_long';
  return null;
}
/** Only what changed is sent, with the version read. An emptied description is saved as no description. */
export function courseTextChanges(course: { title: string; description: string | null }, title: string, description: string) {
  const changes: { title?: string; description?: string | null } = {};
  if (title.trim() !== course.title) changes.title = title.trim();
  const about = description.trim() ? description : null;
  if (about !== (course.description ?? null) && !(about === null && !course.description)) changes.description = about;
  return changes;
}

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
