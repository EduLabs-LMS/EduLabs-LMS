import 'server-only';
import { cache } from 'react';
import { auth, currentUser } from '@clerk/nextjs/server';
import { isFirebaseStaging } from '@/shared/auth-config';
import { getFirebaseSession } from '@/server/services/firebase-auth';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { requestMemo, timePhase } from '@/server/request-scope';
import type { ApplicationViewer } from '@/shared/contracts/application-auth';

/**
 * Provider-neutral identity. Contextual permissions are loaded separately from PostgreSQL.
 * The Firebase lookup (profile id, then the profile row) runs once per request, also in route handlers where React's
 * cache() does not apply; it is tied to the verified token of that request and never kept longer.
 */
export const getApplicationViewer = cache(async (): Promise<ApplicationViewer | null> => {
  if (!isFirebaseStaging()) {
    const { userId } = await auth();
    if (!userId) return null;
    const user = await currentUser();
    return { id: userId, displayName: user?.fullName || user?.username || 'Learner',
      email: user?.primaryEmailAddress?.emailAddress || '', backend: 'clerk' };
  }
  const session = await getFirebaseSession();
  if (!session || session.identity.role !== 'authenticated' || !session.identity.email_verified) return null;
  if (process.env.LMS_DATA_BACKEND !== 'supabase-staging') throw new Error('Supabase staging is required');
  return requestMemo('viewer', session.token, () => timePhase('viewer_lookup', async () => {
    const client = await getSupabaseServerClient();
    const { data: id, error } = await client.rpc('current_profile_id');
    if (error) throw new Error('Unable to resolve LMS identity');
    if (!id) return null;
    const { data: profile, error: profileError } = await client.from('profiles').select('id,display_name,status').eq('id', id).maybeSingle();
    if (profileError) throw new Error('Unable to load LMS profile');
    if (!profile || profile.status !== 'active') return null;
    return { id: profile.id, displayName: profile.display_name || session.identity.name || 'Learner',
      email: session.identity.email || '', backend: 'firebase' } as ApplicationViewer;
  }));
});
