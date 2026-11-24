import 'server-only';
import { getWebsiteContext } from '@/server/services/website';

/**
 * Who is looking at Exams: null when nobody is signed in (the page sends them to sign-in), otherwise whether they are staff.
 * Staff are the people with an active membership of a teaching space (owner, admin, teacher or assistant); a student never has one.
 * This is a plain staff check. It reads no exam table: the old list and detail reads went through the legacy exam tables, which
 * are closed to the browser role (fix-01-direct-access, A6b-02). What a student sees comes from the exam functions in exams-student.
 */
export async function loadExamAccess() {
  const context = await getWebsiteContext();
  if (!context) return null;
  return { isStaff: context.memberships.some(m => m.status === 'active') };
}
