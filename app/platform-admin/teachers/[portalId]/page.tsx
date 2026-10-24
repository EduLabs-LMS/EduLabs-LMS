import { notFound } from 'next/navigation';
import { requirePlatformAdmin } from '@/server/services/platform-admin';
import { platformProvisioningService } from '@/server/services/platform-provisioning';
import { PortalView } from '@/frontend/features/platform-admin/portal-view';

export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function PortalPage({ params }: { params: Promise<{ portalId: string }> }) {
 const { portalId } = await params;
 const { client } = await requirePlatformAdmin();
 if (!uuid.test(portalId)) notFound();
 const detail = await platformProvisioningService(client).detail(portalId).catch((error: { status?: number }) => {
  if (error.status === 404) notFound();
  throw error;
 });
 return <PortalView initial={detail} portalId={portalId} />;
}
