import { TeacherCoursesPage } from '@/app/(dashboard)/_components/teacher-home-pages';

/** The course list lives here (it moved from /teacher/courses, which now redirects). Same server read, same create flow, same course editors. */
export default function Page() {
  return <TeacherCoursesPage />;
}
