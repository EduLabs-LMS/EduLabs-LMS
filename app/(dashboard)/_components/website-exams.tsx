import { notFound, redirect } from 'next/navigation';
import { ExamDetailView, ExamNotFoundView, ExamsErrorView } from '@/frontend/features/exams/exams-list';
import { loadExam, loadExamList } from '@/server/services/exams';
import { ExamRunner } from '@/frontend/features/exams/exam-runner';
import { TeacherFoundationNotice } from '@/frontend/components/teacher-foundation-notice';
import { ExamsListView } from '@/frontend/features/exams/exams-list';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Firebase/Supabase-mode Exams (Delivery 1, read-only). No Clerk, no Prisma:
 * identity and data access live in server/services/exams.ts.
 */
export async function WebsiteExams() {
  let data: Awaited<ReturnType<typeof loadExamList>>;
  try {
    data = await loadExamList();
  } catch {
    return <ExamsErrorView />;
  }
  if (!data) redirect('/sign-in'); // outside try/catch so the redirect signal is not swallowed
  return data.isStaff?<TeacherFoundationNotice title="Exam management"/>:<ExamsListView items={data.items} isStaff={false} truncated={data.truncated}/>;
}

export async function WebsiteExam({ examId }: { examId: string }) {
  if (!uuid.test(examId)) notFound();
  let data: Awaited<ReturnType<typeof loadExam>>;
  try {
    data = await loadExam(examId);
  } catch {
    return <ExamsErrorView />;
  }
  if (!data) redirect('/sign-in');
  if (!data.exam) return <ExamNotFoundView />;
  if (!data.isStaff) return <ExamRunner examId={examId} secure />;
  return <TeacherFoundationNotice title="Exam management"/>;
}
