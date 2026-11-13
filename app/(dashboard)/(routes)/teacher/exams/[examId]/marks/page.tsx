import { notFound } from 'next/navigation';
import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { PaperMarks } from '@/frontend/features/teacher-exams/paper-marks';
import { isFirebaseStaging } from '@/shared/auth-config';

/** The mark sheet of one paper exam. It reads exam_paper_sheet through the teacher Exams routes, which the database authorizes. */
export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Exams" />;
  const { examId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(examId)) notFound();
  await staffContext();
  return <><PaperMarks examId={examId.toLowerCase()} /><ServerTimingMarker /></>;
}
