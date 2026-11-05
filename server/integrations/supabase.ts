import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { isFirebaseStaging } from '@/shared/auth-config';
import { getFirebaseSession } from '@/server/services/firebase-auth';
import { cookies } from 'next/headers';
import type { Database } from '@/shared/contracts/database.types';
import { getSupabaseConfig } from '@/shared/supabase-config';
import { addMark, requestMemo, requestScope, serverTimingEnabled } from '@/server/request-scope';

/** Phase name for Server-Timing: the table or function only. Never the query string, body, ids or tokens. */
export function supabasePhaseName(input: RequestInfo | URL) {
  try {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const rest = /^\/rest\/v1\/(rpc\/)?([A-Za-z0-9_]+)/.exec(url.pathname);
    return rest ? `${rest[1] ? 'rpc' : 'rest'}_${rest[2]}` : 'supabase_other';
  } catch { return 'supabase_other'; }
}

/** Times each Supabase round trip when LMS_SERVER_TIMING=1; otherwise the plain global fetch. */
function timedFetch(): typeof fetch | undefined {
  if (!serverTimingEnabled()) return undefined;
  return async (input, init) => {
    const scope = await requestScope();
    const started = performance.now();
    try { return await fetch(input, init); }
    finally { if (scope) addMark(scope, supabasePhaseName(input), performance.now() - started); }
  };
}

/** Request-scoped client: uses the caller's Supabase session and respects RLS. */
export async function getSupabaseServerClient() {
  if (isFirebaseStaging()) {
    const session = await getFirebaseSession();
    if (!session || session.identity.role !== 'authenticated' || !session.identity.email_verified) throw new Error('Verified Firebase identity required');
    const { url, publishableKey } = getSupabaseConfig();
    // The client holds this caller's token, so it is reused only inside the same request and for the same token.
    return requestMemo('supabase-client', session.token, async () => {
      const customFetch = timedFetch();
      return createClient<Database>(url, publishableKey, { accessToken: async () => session.token,
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        ...(customFetch ? { global: { fetch: customFetch } } : {}) });
    });
  }
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseConfig();
  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        for (const { name, value, options } of values) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
