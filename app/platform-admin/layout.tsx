import type { Metadata } from 'next';
import '@/frontend/design-system/tokens.css';
import '@/frontend/design-system/components.css';
import '@/frontend/styles/platform-admin.css';
import { requirePlatformAdmin } from '@/server/services/platform-admin';
import { PlatformAdminShell } from '@/frontend/features/platform-admin/shell';

export const metadata: Metadata = { title: 'Platform administration | EduLabs', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
 // Defense in depth: every page below repeats this check, because layouts are not re-run on client navigation.
 const { viewer } = await requirePlatformAdmin();
 return <PlatformAdminShell name={viewer.displayName}>{children}</PlatformAdminShell>;
}
