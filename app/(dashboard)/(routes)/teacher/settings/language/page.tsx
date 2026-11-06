import { cookies } from 'next/headers';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { DesignSettings } from '@/frontend/features/teacher-settings/design-settings';
import { designCookieKey, designFromCookie } from '@/shared/design';
import { AppearanceSettings } from '@/frontend/features/personalization/appearance-settings';
import { LanguageSettings } from '@/frontend/features/personalization/language-settings';

/** The existing language/RTL and appearance controls, unchanged, and the temporary Classic / New switch. */
export default async function Page() {
  await staffContext();
  const cookieStore = await cookies();
  return <div data-settings-language className="d-stack-lg"><LanguageSettings /><AppearanceSettings /><DesignSettings initial={designFromCookie(cookieStore.get(designCookieKey)?.value)} /></div>;
}
