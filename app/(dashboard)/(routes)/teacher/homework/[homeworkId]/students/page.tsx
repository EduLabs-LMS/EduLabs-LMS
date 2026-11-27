import { notFound } from 'next/navigation';
import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { HomeworkStudentsScreen } from '@/frontend/features/teacher-homework/students-screen';
import { isFirebaseStaging } from '@/shared/auth-config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One homework's students, read only. The screen reads homework_students through the teacher Homework route, which the database authorizes. */
export default async function Page({ params }: { params: Promise<{ homeworkId: string }> }) {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Homework" />;
  const { homeworkId } = await params;
  if (!UUID.test(homeworkId)) notFound();
  await staffContext();
  return <><HomeworkStudentsScreen homeworkId={homeworkId.toLowerCase()} /><ServerTimingMarker /></>;
}
