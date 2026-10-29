import { redirect } from 'next/navigation';
import { isFirebaseStaging } from '@/shared/auth-config';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';

/** The course list moved to Settings, Courses. Course editors (/teacher/courses/<id>) stay where they are. */
export default function Page() {
  if (isFirebaseStaging()) redirect('/teacher/settings/courses');
  return <TeacherFoundationPage title="Courses" />;
}
