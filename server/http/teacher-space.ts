import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { isFirebaseStaging } from '@/shared/auth-config';
import { renameSpaceInput } from '@/shared/teacher-space';
import { getApplicationViewer } from '@/server/services/application-auth';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { renameMyTeachingSpace } from '@/server/services/platform-provisioning';
import { failure, readJson } from '@/server/http/platform-admin-portals';
import { validFirebaseOrigin } from '@/server/http/firebase/route';

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' } });

/**
 * PATCH /api/teacher/space: the owner renames their own teaching space. Only the name can change. Whether the caller is the owner is decided by the
 * database function rename_my_teaching_space, which answers 42501 (HTTP 403) to anyone else; nothing here is an authorization decision.
 * (POST /api/teacher/organizations, "create a space", stays closed: spaces are provisioned by EduLabs staff.)
 */
export async function renameSpacePATCH(request: NextRequest) {
  try {
    if (!isFirebaseStaging()) return reply({ error: 'Not found' }, 404);
    if (!validFirebaseOrigin(request)) return reply({ error: 'Invalid origin' }, 403);
    if (new URL(request.url).search) return reply({ error: 'Unexpected query' }, 400);
    const viewer = await getApplicationViewer();
    if (!viewer || viewer.backend !== 'firebase') return reply({ error: 'Sign in required' }, 401);
    const parsed = await readJson(request);
    if ('response' in parsed) return parsed.response;
    const input = renameSpaceInput.safeParse(parsed.body);
    if (!input.success) return reply({ error: 'Some details are not valid.', reason: 'invalid' }, 400);
    return reply(await renameMyTeachingSpace(await getSupabaseServerClient(), input.data.organizationId, input.data.name));
  } catch (error) { return failure(error); }
}
