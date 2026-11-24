import { notFound, redirect } from 'next/navigation';
import { StudentExamsList, type StudentListLoad } from '@/frontend/features/student-exams/exam-list';
import { StudentExamScreen } from '@/frontend/features/student-exams/exam-screen';
import { loadExamAccess } from '@/server/services/exams';
import { readStudentExams } from '@/server/services/exams-student';
import type { StudentList } from '@/shared/exams-student';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Firebase/Supabase-mode Exams for students. Staff are sent to the teacher screens; everything a student sees comes from the exam
 * functions (exam_student_list, exam_get), which decide again for the signed-in person. No Clerk, no Prisma.
 */
export async function WebsiteExams() {
  let staff: boolean | null = null, load: StudentListLoad, checked = true;
  try {
    const who = await loadExamAccess();
    staff = who ? who.isStaff : null;
  } catch {
    checked = false;
  }
  // When the check itself fails nobody is shown the student view: a teacher must never land on it, so it is an error state, not a guess.
  if (!checked) return <StudentExamsList load={{ state: 'error' }} />;
  if (staff === null) redirect('/sign-in'); // outside try/catch so the redirect signal is not swallowed
  if (staff) redirect('/teacher/exams');
  try {
    const read = await readStudentExams();
    load = read.status === 200 ? { state: 'ready', data: read.body as StudentList } : { state: 'error' };
  } catch {
    load = { state: 'error' };
  }
  return <StudentExamsList load={load} />;
}

export async function WebsiteExam({ examId }: { examId: string }) {
  if (!uuid.test(examId)) notFound();
  let staff: boolean | null = null, checked = true;
  try {
    const who = await loadExamAccess();
    staff = who ? who.isStaff : null;
  } catch {
    checked = false;
  }
  if (!checked) throw new Error('Unable to check access to this exam');
  if (staff === null) redirect('/sign-in');
  if (staff) redirect('/teacher/exams');
  return <StudentExamScreen examId={examId} />;
}
