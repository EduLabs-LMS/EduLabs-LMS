import 'server-only';
import type { getSupabaseServerClient } from '@/server/integrations/supabase';

type Client = Awaited<ReturnType<typeof getSupabaseServerClient>>;

/**
 * Teacher Home label. Runs as the signed-in teacher; the database answers true only for a demo space the caller is an active member of.
 * Any failure resolves to "no label": a teacher never sees an error or a guess here.
 */
export async function spaceIsDemo(client: Client, organizationId: string): Promise<boolean> {
  try {
    const { data, error } = await client.rpc('space_is_demo', { p_org: organizationId });
    return !error && data === true;
  } catch { return false; }
}
