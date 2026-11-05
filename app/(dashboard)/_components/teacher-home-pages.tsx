import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { redirect } from 'next/navigation';
import { getWebsiteContext } from '@/server/services/website';
import { loadTeacherCourses, loadTeacherHome } from '@/server/services/teacher-home';
import { TeacherHomeView } from '@/frontend/features/teacher-home/home-view';
import { TeacherCoursesView } from '@/frontend/features/teacher-home/courses-view';

/** Authorization stays with the server reads and RLS; the staff check here only avoids rendering a teacher page for a student. */
export async function staffContext() {
  const context = await getWebsiteContext();
  if (!context) redirect('/sign-in');
  const active = context.memberships.some(m => m.status === 'active');
  const staff = active && (context.courseStaff.length || context.offeringStaff.length || context.memberships.some(m => m.status === 'active' && ['owner', 'admin', 'teacher', 'assistant'].includes(m.role)));
  if (!staff) redirect('/home');
  return context;
}

export async function TeacherHomePage() {
  const data = await loadTeacherHome(await staffContext());
  return <><TeacherHomeView data={data} /><ServerTimingMarker /></>;
}

export async function TeacherCoursesPage() {
  const { courses, createTargets } = await loadTeacherCourses(await staffContext());
  return <><TeacherCoursesView courses={courses} targets={createTargets} /><ServerTimingMarker /></>;
}
