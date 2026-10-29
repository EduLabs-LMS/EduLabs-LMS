import { notFound } from 'next/navigation';
import { isFirebaseStaging } from '@/shared/auth-config';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherGroupView } from '@/frontend/features/teacher-groups/group-view';

/** One Group: Sessions, Students, Details. Access is decided by the database on every read; the address only has to be an id. */
export default async function Page({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(groupId)) notFound();
  if (!isFirebaseStaging()) return <TeacherFoundationPage title="Groups & Classes" />;
  await staffContext();
  return <TeacherGroupView groupId={groupId} />;
}
