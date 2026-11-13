import { notFound } from 'next/navigation';
import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { ExamWizard } from '@/frontend/features/teacher-exams/exam-wizard';
import { loadExamPage } from '@/server/services/teacher-exams-page';
import { isFirebaseStaging } from '@/shared/auth-config';

/** One exam in the wizard. The wizard reads it through GET /api/teacher/exams/<id>, which exam_get authorizes. */
export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Exams" />;
  const { examId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(examId)) notFound();
  const load = loadExamPage(await staffContext());
  return <><ExamWizard load={load} examId={examId.toLowerCase()} initialCourse={null} initialKind="online" /><ServerTimingMarker /></>;
}
