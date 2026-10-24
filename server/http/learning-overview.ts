import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isFirebaseStaging } from '@/shared/auth-config';
import { resumeLearning } from '@/shared/continue-learning';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getWebsiteContext, loadWebsiteScope } from '@/server/services/website';

const selection = z.object({ organizationId: z.string().uuid().optional(), offeringId: z.string().uuid().optional() }).strict();
const headers = { 'Cache-Control': 'private, no-store' };

/** Awaitable, read-only projection. Identity and access come exclusively from the verified session and RLS. */
export async function learningOverviewPOST(request: NextRequest) {
  if (!isFirebaseStaging() || process.env.LMS_DATA_BACKEND !== 'supabase-staging') return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
  if (!validFirebaseOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403, headers });
  try {
    const context = await getWebsiteContext();
    if (!context) return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers });
    if (request.nextUrl.search) return NextResponse.json({ error: 'Invalid selection' }, { status: 400, headers });
    if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'JSON required' }, { status: 415, headers });
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: 'Body required' }, { status: 400, headers });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 1024) { await reader.cancel(); return NextResponse.json({ error: 'Request too large' }, { status: 413, headers }); }
      chunks.push(value);
    }
    const { organizationId, offeringId } = selection.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const scope = await loadWebsiteScope(context, organizationId);
    if (!scope || (offeringId && !scope.offerings.some(o => o.id === offeringId))) return NextResponse.json({ error: 'Learning unavailable' }, { status: 403, headers });
    return NextResponse.json(resumeLearning(scope, context.organizations, Date.now(), offeringId), { headers });
  } catch (error) {
    const status = error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503;
    return NextResponse.json({ error: status === 400 ? 'Invalid selection' : 'Learning progress is unavailable. Retry.' }, { status, headers });
  }
}
