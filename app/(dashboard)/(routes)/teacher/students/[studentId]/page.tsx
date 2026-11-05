import { notFound } from 'next/navigation';
import { ServerTimingMarker } from '@/app/(dashboard)/_components/server-timing-marker';
import { isFirebaseStaging } from '@/shared/auth-config';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { StudentDetailView } from '@/frontend/features/teacher-students/student-view';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One student in one course (the course is in the address because a student can be in several). Access is decided by the database on every read. */
export default async function Page({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<{ course?: string | string[] }> }) {
  const { studentId } = await params;
  if (!uuid.test(studentId)) notFound();
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Students" />;
  await staffContext();
  const { course } = await searchParams;
  return <><StudentDetailView studentId={studentId} offeringId={typeof course === 'string' && uuid.test(course) ? course : null} /><ServerTimingMarker /></>;
}
