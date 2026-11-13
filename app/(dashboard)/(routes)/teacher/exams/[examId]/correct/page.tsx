import { notFound } from 'next/navigation';
import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { ExamCorrectScreen } from '@/frontend/features/teacher-exams/exam-correct';
import { isFirebaseStaging } from '@/shared/auth-config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Correcting one online exam. The screen reads exam_queue and each try through the teacher Exams routes, which the database authorizes. ?try=<attempt> opens that try. */
export default async function Page({ params, searchParams }: { params: Promise<{ examId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Exams" />;
  const { examId } = await params;
  if (!UUID.test(examId)) notFound();
  await staffContext();
  const asked = (await searchParams).try;
  const start = typeof asked === 'string' && UUID.test(asked) ? asked.toLowerCase() : null;
  return <><ExamCorrectScreen examId={examId.toLowerCase()} start={start} /><ServerTimingMarker /></>;
}
