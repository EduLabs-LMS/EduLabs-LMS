import 'server-only';
import { courseCapability, type WebsiteContext } from '@/server/services/website';
import { canEditTeacherCourse } from '@/shared/teacher-course';
import type { HomeworkCourse, HomeworkPageLoad } from '@/shared/teacher-homework';

/**
 * The courses the Homework page offers (course filter, the wizard's Course list) and whether the teacher seems able to write each one.
 * Read from the request's own context (the signed-in teacher's rows, already read under RLS). This only chooses which buttons to show:
 * the routes and the database decide every write again. An archived course is listed for reading but never offered for new homework.
 */
export function loadHomeworkPage(context: WebsiteContext): HomeworkPageLoad {
  try {
    const active = (organizationId: string) => context.memberships.find(m => m.organization_id === organizationId && m.status === 'active') ?? null;
    const runs = (courseId: string) => context.offerings.filter(o => o.course_id === courseId && o.status !== 'archived');
    const courses: HomeworkCourse[] = context.courses
      .filter(c => ['draft', 'published', 'archived'].includes(c.status))
      .filter(c => courseCapability(context, c) || runs(c.id).some(o => context.offeringStaff.some(s => s.offering_id === o.id)))
      .map(c => {
        const membership = active(c.organization_id), staff = context.courseStaff.find(s => s.course_id === c.id) ?? null;
        const manager = Boolean(membership && (['owner', 'admin'].includes(membership.role) || (staff && ['owner', 'instructor'].includes(staff.role))));
        return {
          id: c.id, title: c.title, status: c.status, canEdit: c.status !== 'archived' && canEditTeacherCourse(membership, staff),
          offerings: runs(c.id).map(o => ({ id: o.id, name: o.name ?? '', canManage: manager || context.offeringStaff.some(s => s.offering_id === o.id && s.role === 'instructor') })),
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
    return { state: 'ready', courses };
  } catch { return { state: 'error' }; }
}
