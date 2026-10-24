import 'server-only';
import { redirect, notFound } from 'next/navigation';
import { isFirebaseStaging } from '@/shared/auth-config';
import { getApplicationViewer } from '@/server/services/application-auth';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import type { ApplicationViewer } from '@/shared/contracts/application-auth';

export type PlatformAdminAccess =
 | { status: 'unavailable' }
 | { status: 'anonymous' }
 | { status: 'forbidden' }
 | { status: 'ok'; viewer: ApplicationViewer; client: Awaited<ReturnType<typeof getSupabaseServerClient>> };

/**
 * Platform administration is decided by PostgreSQL (private.is_platform_admin) from the verified
 * Firebase identity. A role badge, a membership or a client-supplied value never grants it.
 */
export async function getPlatformAdminAccess(): Promise<PlatformAdminAccess> {
 if (!isFirebaseStaging()) return { status: 'unavailable' };
 const viewer = await getApplicationViewer();
 if (!viewer || viewer.backend !== 'firebase') return { status: 'anonymous' };
 const client = await getSupabaseServerClient();
 const { data, error } = await client.rpc('is_platform_admin');
 // Before the reviewed migration is applied the function does not exist: behave like an unknown route, not a server error.
 if (error?.code === 'PGRST202' || error?.code === '42883') return { status: 'unavailable' };
 if (error) throw new Error('Unable to verify platform administration');
 return data === true ? { status: 'ok', viewer, client } : { status: 'forbidden' };
}

/** Page guard. Non-administrators receive the same 404 as an unknown route. */
export async function requirePlatformAdmin() {
 const access = await getPlatformAdminAccess();
 if (access.status === 'anonymous') redirect('/sign-in');
 if (access.status !== 'ok') notFound();
 return access;
}
