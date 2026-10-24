import { redirect } from 'next/navigation';
import { requirePlatformAdmin } from '@/server/services/platform-admin';

export default async function PlatformAdminIndex() {
 await requirePlatformAdmin();
 redirect('/platform-admin/teachers');
}
