import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherNotificationsSection } from '@/frontend/features/teacher-settings/notifications-section';

export default async function Page() {
  await staffContext();
  return <TeacherNotificationsSection />;
}
