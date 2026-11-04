import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isFirebaseStaging } from '@/shared/auth-config';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getApplicationViewer } from '@/server/services/application-auth';
import { groupFailure } from '@/server/services/groups';
import { groupCourseRun } from '@/server/services/group-course-run';

/** Same gates and error shape as the Groups endpoint; a separate file because that one is pinned byte-for-byte to the baseline. */
export async function groupCourseRunPOST(request: NextRequest) {
  if (!isFirebaseStaging() || process.env.LMS_DATA_BACKEND !== 'supabase-staging') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!validFirebaseOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const viewer = await getApplicationViewer();
    if (!viewer || viewer.backend !== 'firebase') throw groupFailure('Sign in required', 401);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw groupFailure('JSON required', 415);
    const text = await request.text();
    if (text.length > 1024) throw groupFailure('Request too large', 413);
    const { courseId } = z.object({ courseId: z.string().uuid() }).strict().parse(JSON.parse(text));
    return NextResponse.json(await groupCourseRun(courseId), { headers });
  } catch (e) {
    const status = e instanceof z.ZodError || e instanceof SyntaxError ? 400 : (e as { status?: number }).status ?? 503;
    return NextResponse.json({ error: status === 400 ? 'Check the entered details.' : status === 503 ? 'Groups are temporarily unavailable or require their approved database update.' : (e as Error).message }, { status, headers });
  }
}
