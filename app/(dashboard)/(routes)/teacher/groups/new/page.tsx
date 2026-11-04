import { isFirebaseStaging } from '@/shared/auth-config';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { CreateGroupView } from '@/frontend/features/teacher-groups/group-form';
import { loadGroupCourses } from '@/server/services/teacher-home';

/** Create a Group: the course list is read on the server, the Group is saved through the existing Groups endpoint. The database decides who may. */
export default async function Page() {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Groups & Classes" />;
  return <CreateGroupView courses={await loadGroupCourses(await staffContext())} />;
}
