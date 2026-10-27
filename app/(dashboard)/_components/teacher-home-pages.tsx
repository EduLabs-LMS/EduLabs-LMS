import { redirect } from 'next/navigation';
import { getWebsiteContext } from '@/server/services/website';
import { loadTeacherCourses, loadTeacherHome } from '@/server/services/teacher-home';
import { TeacherHomeView } from '@/frontend/features/teacher-home/home-view';
import { TeacherCoursesView } from '@/frontend/features/teacher-home/courses-view';

/** Authorization stays with the server reads and RLS; the staff check here only avoids rendering a teacher page for a student. */
async function staffContext() {
  const context = await getWebsiteContext();
  if (!context) redirect('/sign-in');
  const active = context.memberships.some(m => m.status === 'active');
  const staff = active && (context.courseStaff.length || context.offeringStaff.length || context.memberships.some(m => m.status === 'active' && ['owner', 'admin', 'teacher', 'assistant'].includes(m.role)));
  if (!staff) redirect('/home');
  return context;
}

export async function TeacherHomePage() {
  return <TeacherHomeView data={await loadTeacherHome(await staffContext())} />;
}

export async function TeacherCoursesPage() {
  const { courses, createTargets } = await loadTeacherCourses(await staffContext());
  return <TeacherCoursesView courses={courses} targets={createTargets} />;
}
