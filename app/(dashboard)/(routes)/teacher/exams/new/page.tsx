import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { ExamWizard } from '@/frontend/features/teacher-exams/exam-wizard';
import { loadExamPage } from '@/server/services/teacher-exams-page';
import { isFirebaseStaging } from '@/shared/auth-config';

/** New exam. `?course=<id>` preselects a course the teacher may edit; `?kind=paper` starts a paper exam. Anything else is ignored. */
export default async function Page({ searchParams }: { searchParams: Promise<{ course?: string | string[]; kind?: string | string[] }> }) {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Exams" />;
  const load = loadExamPage(await staffContext());
  const { course, kind } = await searchParams;
  const initial = typeof course === 'string' && /^[0-9a-f-]{36}$/i.test(course) ? course : null;
  return <><ExamWizard load={load} examId={null} initialCourse={initial} initialKind={kind === 'paper' ? 'paper' : 'online'} /><ServerTimingMarker /></>;
}
