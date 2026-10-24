import { requirePlatformAdmin } from '@/server/services/platform-admin';
import { SettingsView } from '@/frontend/features/platform-admin/settings-view';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
 await requirePlatformAdmin();
 return <SettingsView />;
}
