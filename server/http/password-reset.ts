import 'server-only';
import { NextRequest, NextResponse, after } from 'next/server';
import { isFirebaseStaging } from '@/shared/auth-config';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getFirebaseAdminAuth } from '@/server/integrations/firebase-admin';
import { canonicalAppOrigin } from '@/server/services/invitation-delivery';
import { clientAddress, passwordResetLimiter } from '@/server/services/password-reset-limiter';
import { createResetMailer, requestPasswordReset, type ResetDeps, type ResetLogEvent } from '@/server/services/password-reset';

/** POST /api/auth/firebase/password-reset: {email, language?}. The reply is the same for every address that passes the checks; see the service. */

const maxBody = 1024;
const headers = { 'Cache-Control': 'no-store' };

/** Only a fixed event name is ever written: no address, code, link or error text. */
const log = (event: ResetLogEvent) => { console.info('password_reset', event); };

export const productionResetDeps = (): ResetDeps => ({
 origin: () => canonicalAppOrigin(),
 admin: () => getFirebaseAdminAuth(),
 mailer: createResetMailer(),
 limiter: passwordResetLimiter(),
 defer: (work) => after(work),
 log,
});

export async function handlePasswordResetRequest(request: NextRequest, deps: ResetDeps = productionResetDeps()) {
 if (!isFirebaseStaging()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
 if (!validFirebaseOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403, headers });
 if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return NextResponse.json({ error: 'invalid_request' }, { status: 415, headers });
 if (Number(request.headers.get('content-length')) > maxBody) return NextResponse.json({ error: 'invalid_request' }, { status: 413, headers });
 // Bounded even when Content-Length is missing.
 const reader = request.body?.getReader();
 if (!reader) return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers });
 let size = 0; const chunks: Uint8Array[] = [];
 while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  size += value.length;
  if (size > maxBody) { await reader.cancel(); return NextResponse.json({ error: 'invalid_request' }, { status: 413, headers }); }
  chunks.push(value);
 }
 let body: unknown;
 try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers }); }
 const reply = await requestPasswordReset(body, { address: clientAddress(request.headers) }, deps);
 return NextResponse.json(reply.body, { status: reply.status, headers: reply.status === 429 ? { ...headers, 'Retry-After': String(reply.body.retryAfterSeconds) } : headers });
}

/** The route's POST: production dependencies, one argument (Next passes the request). */
export const passwordResetPOST = (request: NextRequest) => handlePasswordResetRequest(request);
