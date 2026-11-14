import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { query, readBody, sameOriginRead, signedIn } from '@/server/http/teacher-exams';
import { openLiveClass, readLiveClassJoined, type LiveClassResult } from '@/server/services/live-class';
import { liveClassConfigured } from '@/server/services/live-class-provider';
import { createLimiter, type Limiter } from '@/server/services/password-reset-limiter';
import { isFirebaseStaging } from '@/shared/auth-config';
import { liveClassJoinedQuery, liveClassOpenBody } from '@/shared/live-class';

/** A reply that carries a meeting token: never cached, never sent on as a referrer. */
const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
const send = (r: LiveClassResult) => reply(r.body, r.status);
/** In memory, per server process (like the password-reset limiter): enough to stop a loop pressing Join; the database authorizes every call anyway. */
let limiter: Limiter | undefined;
const limits = () => (limiter ??= createLimiter({ open: { limit: 30, windowMs: 60000 }, joined: { limit: 60, windowMs: 60000 } }));

/** POST /api/live-class/open {sessionId, start}: open the class page's meeting (staff with start=true start it). */
export async function liveClassOpenPOST(request: NextRequest) {
  if (!isFirebaseStaging() || !liveClassConfigured()) return reply({ kind: 'off' }, 404);
  if (!validFirebaseOrigin(request)) return reply({ kind: 'denied' }, 403);
  const body = await readBody(request, liveClassOpenBody, 512);
  if ('failure' in body) return body.failure;
  try {
    const viewer = await signedIn();
    if (!viewer) return reply({ kind: 'signin' }, 401);
    const verdict = limits().take('open', viewer.id);
    if (!verdict.allowed) return NextResponse.json({ kind: 'busy' }, { status: 429, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': String(verdict.retryAfterSeconds) } });
    return send(await openLiveClass(body.data.sessionId, body.data.start));
  } catch { return reply({ kind: 'failed' }, 503); }
}

/** GET /api/live-class/joined?sessionId= : who opened the class, for the Group's staff (Take attendance). */
export async function liveClassJoinedGET(request: NextRequest) {
  if (!isFirebaseStaging() || !liveClassConfigured()) return reply({ kind: 'off' }, 404);
  if (!sameOriginRead(request)) return reply({ kind: 'denied' }, 403);
  const q = query(request, liveClassJoinedQuery);
  if (!q) return reply({ kind: 'invalid' }, 400);
  try {
    const viewer = await signedIn();
    if (!viewer) return reply({ kind: 'signin' }, 401);
    const verdict = limits().take('joined', viewer.id);
    if (!verdict.allowed) return NextResponse.json({ kind: 'busy' }, { status: 429, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': String(verdict.retryAfterSeconds) } });
    return send(await readLiveClassJoined(q.sessionId));
  } catch { return reply({ kind: 'failed' }, 503); }
}
