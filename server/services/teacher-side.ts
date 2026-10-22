import 'server-only';
import { cache } from 'react';
import { auth } from '@clerk/nextjs/server';
import { isFirebaseStaging } from '@/shared/auth-config';
import { getWebsiteContext, type WebsiteContext } from '@/server/services/website';
import { getDbUser } from '@/server/services/user';
import { COURSE_MANAGEMENT_PATH, TEACHER_COURSES_PATH } from '@/shared/course-management-path';

/**
 * Teacher-side = teachers and the assistants who work for a teacher.
 * Platform/developer roles (legacy ADMIN, Firebase organization owner/admin) are NOT teacher-side
 * and keep their existing navigation and dashboard. Display grouping only: this never grants access.
 */
export function isTeacherSideContext(context: Pick<WebsiteContext, 'memberships' | 'courseStaff' | 'offeringStaff'>) {
  const active = context.memberships.filter(m => m.status === 'active');
  if (active.some(m => ['owner', 'admin'].includes(m.role))) return false;
  return active.some(m => ['teacher', 'assistant'].includes(m.role)) || context.courseStaff.length > 0 || context.offeringStaff.length > 0;
}

export const isTeacherSide = cache(async (): Promise<boolean> => {
  try {
    if (isFirebaseStaging()) {
      const context = await getWebsiteContext();
      return !!context && isTeacherSideContext(context);
    }
    const { userId } = await auth();
    if (!userId) return false;
    const user = await getDbUser(userId);
    if (user?.role === 'TEACHER') return true;
    return !!process.env.NEXT_PUBLIC_TEACHER_ID && userId === process.env.NEXT_PUBLIC_TEACHER_ID && user?.role !== 'ADMIN';
  } catch {
    return false;
  }
});

/** Where this viewer manages courses: Self-learning for teacher-side roles, the Teacher courses area otherwise. */
export const getCourseManagementPath = async () => (await isTeacherSide()) ? COURSE_MANAGEMENT_PATH : TEACHER_COURSES_PATH;
