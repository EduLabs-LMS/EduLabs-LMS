import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { AppearanceSettings } from '@/frontend/features/personalization/appearance-settings';
import { LanguageSettings } from '@/frontend/features/personalization/language-settings';

/** The existing language/RTL and appearance controls, unchanged. */
export default async function Page() {
  await staffContext();
  return <div data-settings-language className="space-y-6"><LanguageSettings /><AppearanceSettings /></div>;
}
