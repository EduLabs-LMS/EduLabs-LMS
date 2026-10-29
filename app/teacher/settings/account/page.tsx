import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherAccountSection } from '@/frontend/features/teacher-settings/account-section';

export default async function Page() {
  await staffContext();
  return <TeacherAccountSection />;
}
