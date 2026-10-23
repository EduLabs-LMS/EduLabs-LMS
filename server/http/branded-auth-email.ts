import 'server-only';

import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isFirebaseStaging } from '@/shared/auth-config';
import { getFirebaseAdminAuth } from '@/server/integrations/firebase-admin';
import { verifyFirebaseToken } from '@/server/services/firebase-auth';
import { sendPasswordResetForAddress, sendVerificationEmailForUser } from '@/server/services/branded-auth-email';
import { validFirebaseOrigin } from '@/server/http/firebase/route';

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

async function limited(request: NextRequest, bucket: 'password-reset' | 'verification', identity: string) {
  const endpoint = process.env.AUTH_EMAIL_RATE_LIMIT_URL;
  const secret = process.env.AUTH_EMAIL_RATE_LIMIT_TOKEN;
  if (!endpoint || !secret) throw Object.assign(new Error('Authentication email rate limiting is not configured'), { status: 503 });
  let url: URL;
  try {
    url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
  } catch { throw Object.assign(new Error('Authentication email rate limiting is not configured'), { status: 503 }); }
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const emailHash = createHash('sha256').update(identity.trim().toLowerCase()).digest('hex');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket: `edulabs-auth-${bucket}`, identity: emailHash, ip: createHash('sha256').update(ip).digest('hex') }),
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(2500),
  }).catch(() => null);
  if (!response?.ok) throw Object.assign(new Error('Authentication email service is temporarily unavailable'), { status: 503 });
  const verdict = await response.json().catch(() => null);
  if (!verdict || typeof verdict.allowed !== 'boolean') throw Object.assign(new Error('Authentication email service is temporarily unavailable'), { status: 503 });
  if (!verdict.allowed) throw Object.assign(new Error('Too many requests. Try again later.'), { status: 429 });
}

async function boundedJson(request: NextRequest) {
  if (Number(request.headers.get('content-length')) > 5000) throw Object.assign(new Error('Request too large'), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('Request body required'), { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 5000) { await reader.cancel(); throw Object.assign(new Error('Request too large'), { status: 413 }); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid request'), { status: 400 }); }
}

export async function POST(request: NextRequest) {
  if (!isFirebaseStaging() || process.env.LMS_DATA_BACKEND !== 'supabase-staging') return json({ error: 'Not found' }, 404);
  if (!validFirebaseOrigin(request)) return json({ error: 'Invalid origin' }, 403);
  const action = new URL(request.url).pathname.split('/').pop();
  try {
    const body = await boundedJson(request);
    if (action === 'verification') {
      if (typeof body.idToken !== 'string' || body.idToken.length > 16000) return json({ error: 'Verified sign-in required' }, 401);
      const identity = await verifyFirebaseToken(body.idToken);
      if (!identity.email_verified) {
        const user = await getFirebaseAdminAuth().getUser(identity.uid);
        if (user.disabled || user.email?.toLowerCase() !== identity.email?.toLowerCase()) return json({ error: 'Verified sign-in required' }, 401);
        await limited(request, 'verification', user.email ?? identity.uid);
        await sendVerificationEmailForUser(user);
      }
      return json({ ok: true });
    }
    if (action === 'password-reset') {
      if (typeof body.email !== 'string' || body.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
        // Keep the same public response for malformed and unknown addresses.
        return json({ ok: true });
      }
      await limited(request, 'password-reset', body.email);
      try { await sendPasswordResetForAddress(body.email.trim()); }
      catch (failure) {
        if ((failure as { code?: string }).code === 'auth/user-not-found') { /* Avoid account enumeration. */ }
        else throw failure;
      }
      return json({ ok: true });
    }
    return json({ error: 'Not found' }, 404);
  } catch (failure) {
    const status = (failure as { status?: number }).status ?? 503;
    return json({ error: status === 429 ? 'Too many requests. Try again later.' :
      status === 503 ? 'Branded authentication email is not configured yet.' :
      status === 401 ? 'Please sign in again and retry.' : 'Unable to complete this request.' }, status);
  }
}
