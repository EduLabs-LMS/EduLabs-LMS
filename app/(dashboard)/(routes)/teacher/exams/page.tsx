import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { TeacherExamsPage } from '@/frontend/features/teacher-exams/exams-page';
import { loadExamPage } from '@/server/services/teacher-exams-page';
import { isFirebaseStaging } from '@/shared/auth-config';

/** The exact path is allow-listed in middleware.ts. The page reads exam_portal itself; the staff check only avoids rendering a teacher page for a student. */
export default async function Page() {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Exams" />;
  const load = loadExamPage(await staffContext());
  return <><TeacherExamsPage load={load} /><ServerTimingMarker /></>;
}
