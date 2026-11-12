import { notFound } from 'next/navigation';
import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { CorrectScreen } from '@/frontend/features/teacher-homework/correct-screen';
import { isFirebaseStaging } from '@/shared/auth-config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Correcting one homework. The screen reads homework_queue and each try through the teacher Homework routes, which the database authorizes;
 * the staff check only avoids rendering a teacher page for a student. ?try=<id> opens that student's try.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ homeworkId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Homework" />;
  const { homeworkId } = await params;
  if (!UUID.test(homeworkId)) notFound();
  await staffContext();
  const asked = (await searchParams).try;
  const start = typeof asked === 'string' && UUID.test(asked) ? asked.toLowerCase() : null;
  return <><CorrectScreen homeworkId={homeworkId.toLowerCase()} start={start} /><ServerTimingMarker /></>;
}
