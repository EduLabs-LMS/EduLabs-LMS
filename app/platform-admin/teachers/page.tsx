import { requirePlatformAdmin } from '@/server/services/platform-admin';
import { platformProvisioningService } from '@/server/services/platform-provisioning';
import { TeachersView } from '@/frontend/features/platform-admin/teachers-view';

export const dynamic = 'force-dynamic';

export default async function TeachersPage() {
 const { client } = await requirePlatformAdmin();
 // A failed read renders the retry banner; it must not look like an empty list.
 const overview = await platformProvisioningService(client).overview().catch(() => null);
 return <TeachersView initial={overview} />;
}
