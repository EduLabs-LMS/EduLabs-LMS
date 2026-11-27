import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getApplicationViewer } from '@/server/services/application-auth';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { isFirebaseStaging } from '@/shared/auth-config';

const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const body = z.object({ offeringId: z.string().uuid(), lessonId: z.string().uuid() }).strict();

/**
 * POST /api/learning/opened {offeringId, lessonId}: the student opened a lesson with no published part (owner, 2026-11-27, rule C).
 * public.lesson_opened records the visit once for the caller's own active enrollment; a lesson with parts records nothing. Same origin,
 * signed in, a small strict body; the database authorizes (42501 becomes 403).
 */
export async function lessonOpenedPOST(request: NextRequest) {
  if (!isFirebaseStaging()) return reply({ kind: 'denied' }, 404);
  if (!validFirebaseOrigin(request)) return reply({ kind: 'denied' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ kind: 'invalid' }, 415);
  const text = await request.text().catch(() => '');
  if (text.length > 512) return reply({ kind: 'too_large' }, 413);
  let parsed: z.infer<typeof body>;
  try { const r = body.safeParse(JSON.parse(text)); if (!r.success) return reply({ kind: 'invalid' }, 400); parsed = r.data; } catch { return reply({ kind: 'invalid' }, 400); }
  try {
    const viewer = await getApplicationViewer();
    if (!viewer || viewer.backend !== 'firebase') return reply({ kind: 'signin' }, 401);
    const { data, error } = await (await getSupabaseServerClient()).rpc('lesson_opened', { p_offering: parsed.offeringId, p_lesson: parsed.lessonId });
    if (error) return reply({ kind: error.code === '42501' ? 'denied' : 'failed' }, error.code === '42501' ? 403 : 503);
    return reply(data, 200);
  } catch { return reply({ kind: 'failed' }, 503); }
}
