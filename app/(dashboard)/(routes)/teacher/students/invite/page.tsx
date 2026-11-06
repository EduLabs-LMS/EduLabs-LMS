import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { isFirebaseStaging } from '@/shared/auth-config';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { InvitePage } from '@/frontend/features/teacher-students/invite';
import { loadGroupCourses } from '@/server/services/teacher-home';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Invite students, on its own page. The join link is made in the browser and shown once; this address only ever names the course to preselect, never a link. */
export default async function Page({ searchParams }: { searchParams: Promise<{ invite?: string | string[] }> }) {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Invite students" />;
  const context = await staffContext();
  const { invite } = await searchParams;
  const courses = await loadGroupCourses(context);
  return <><InvitePage courses={courses} initialOffering={typeof invite === 'string' && uuid.test(invite) ? invite : null} /><ServerTimingMarker /></>;
}
