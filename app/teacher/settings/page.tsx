import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { SettingsIndex } from '@/frontend/features/teacher-settings/settings-index';

export default async function Page() {
  await staffContext();
  return <SettingsIndex />;
}
