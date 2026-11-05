import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherCourseView } from '@/frontend/features/teacher-course/course-view';
import { loadCoursePage } from '@/server/services/teacher-course-page';

/** The exact path is allow-listed in middleware.ts. Authorization stays with row-level security; the staff check only avoids rendering a teacher page for a student. */
export default async function Page({ params }: { params: Promise<{ courseId: string }> }) {
  const context = await staffContext();
  const { courseId } = await params;
  return <TeacherCourseView load={await loadCoursePage(context, courseId)} />;
}
