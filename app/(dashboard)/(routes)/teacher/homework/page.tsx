import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { TeacherHomeworkPage } from '@/frontend/features/teacher-homework/homework-page';
import { loadHomeworkPage } from '@/server/services/teacher-homework-page';
import { isFirebaseStaging } from '@/shared/auth-config';

/** The exact path is allow-listed in middleware.ts. The page reads homework_portal itself; the staff check only avoids rendering a teacher page for a student. */
export default async function Page() {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Homework" />;
  const load = loadHomeworkPage(await staffContext());
  return <><TeacherHomeworkPage load={load} /><ServerTimingMarker /></>;
}
