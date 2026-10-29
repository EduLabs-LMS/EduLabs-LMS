import { notFound } from 'next/navigation';
import { isFirebaseStaging } from '@/shared/auth-config';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherAttendanceView } from '@/frontend/features/teacher-attendance/attendance-view';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Take attendance for one Session. Access is decided by the database on every read and save; the address only has to be two ids. */
export default async function Page({ params }: { params: Promise<{ groupId: string; sessionId: string }> }) {
  const { groupId, sessionId } = await params;
  if (!uuid.test(groupId) || !uuid.test(sessionId)) notFound();
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Attendance" />;
  await staffContext();
  return <TeacherAttendanceView groupId={groupId} sessionId={sessionId} />;
}
