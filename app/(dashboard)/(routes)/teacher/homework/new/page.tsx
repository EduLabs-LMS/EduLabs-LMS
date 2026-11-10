import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { HomeworkWizard } from '@/frontend/features/teacher-homework/homework-wizard';
import { loadHomeworkPage } from '@/server/services/teacher-homework-page';
import { isFirebaseStaging } from '@/shared/auth-config';

/** New homework. `?course=<id>` preselects a course the teacher may edit; anything else is ignored. */
export default async function Page({ searchParams }: { searchParams: Promise<{ course?: string | string[] }> }) {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Homework" />;
  const load = loadHomeworkPage(await staffContext());
  const course = (await searchParams).course;
  const initial = typeof course === 'string' && /^[0-9a-f-]{36}$/i.test(course) ? course : null;
  return <><HomeworkWizard load={load} homeworkId={null} initialCourse={initial} /><ServerTimingMarker /></>;
}
