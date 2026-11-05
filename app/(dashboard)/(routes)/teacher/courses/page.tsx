import { isFirebaseStaging } from '@/shared/auth-config';
import { TeacherCoursesPage } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';

/** The course list has its own menu item (it was Settings, Courses, which now redirects here). Same server read, same create flow, same course editors. */
export default function Page() {
  if (isFirebaseStaging()) return <TeacherCoursesPage />;
  return <TeacherFoundationPage title="Courses" />;
}
