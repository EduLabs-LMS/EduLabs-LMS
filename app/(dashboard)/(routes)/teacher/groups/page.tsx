import { isFirebaseStaging } from '@/shared/auth-config';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherGroupsList } from '@/frontend/features/teacher-groups/list-view';

/** Groups & Classes: the teacher's own Groups. The list reads the existing Groups endpoint in the browser; the database decides which Groups are visible. */
export default async function Page() {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Groups & Classes" />;
  await staffContext();
  return <TeacherGroupsList />;
}
