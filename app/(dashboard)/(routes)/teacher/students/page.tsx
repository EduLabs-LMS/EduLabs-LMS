import { redirect } from 'next/navigation';
import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { isFirebaseStaging } from '@/shared/auth-config';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherStudentsView } from '@/frontend/features/teacher-students/students-view';
import { loadGroupCourses } from '@/server/services/teacher-home';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Students: everyone in the teacher's courses and join requests. The student lists are read in the browser through the existing student-administration endpoint; the database decides what is visible. */
export default async function Page({ searchParams }: { searchParams: Promise<{ invite?: string | string[] }> }) {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Students" />;
  const { invite } = await searchParams;
  // The address Invite students used to have, from a bookmark.
  if (typeof invite === 'string' && uuid.test(invite)) redirect(`/teacher/students/invite?invite=${invite}`);
  const context = await staffContext();
  const courses = await loadGroupCourses(context);
  return <><TeacherStudentsView canInvite={courses.ok && courses.value.length > 0} /><ServerTimingMarker /></>;
}
