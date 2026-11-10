import { notFound } from 'next/navigation';
import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { HomeworkWizard } from '@/frontend/features/teacher-homework/homework-wizard';
import { loadHomeworkPage } from '@/server/services/teacher-homework-page';
import { isFirebaseStaging } from '@/shared/auth-config';

/** One homework in the wizard. The wizard reads it through GET /api/teacher/homework/<id>, which get_homework authorizes. */
export default async function Page({ params }: { params: Promise<{ homeworkId: string }> }) {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Homework" />;
  const { homeworkId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(homeworkId)) notFound();
  const load = loadHomeworkPage(await staffContext());
  return <><HomeworkWizard load={load} homeworkId={homeworkId} initialCourse={null} /><ServerTimingMarker /></>;
}
