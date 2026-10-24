import { requirePlatformAdmin } from '@/server/services/platform-admin';
import { ProvisionForm } from '@/frontend/features/platform-admin/provision-form';

export const dynamic = 'force-dynamic';

export default async function NewTeacherPage() {
 await requirePlatformAdmin();
 return <ProvisionForm />;
}
