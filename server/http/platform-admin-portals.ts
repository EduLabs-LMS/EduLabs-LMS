import 'server-only';
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { acceptInvitationRequest, portalAction, provisionTeacherRequest } from '@/shared/contracts/platform-provisioning';
import { getPlatformAdminAccess } from '@/server/services/platform-admin';
import { acceptTeacherInvitation, platformProvisioningService } from '@/server/services/platform-provisioning';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getApplicationViewer } from '@/server/services/application-auth';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { isFirebaseStaging } from '@/shared/auth-config';
import { sendTeacherInvitationEmail } from '@/server/services/branded-auth-email';
import { isLanguage, languageCookieKey, type Language } from '@/shared/language';

// The response may carry a one-time invitation secret: it must never be cached or indexed.
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function requestedLanguage(request: NextRequest): Language {
 const value = request.cookies.get(languageCookieKey)?.value;
 return isLanguage(value) ? value : 'en';
}

async function limitInvitationEmail(request: NextRequest, email: string) {
 const endpoint = process.env.AUTH_EMAIL_RATE_LIMIT_URL;
 const secret = process.env.AUTH_EMAIL_RATE_LIMIT_TOKEN;
 if (!endpoint || !secret) throw new Error('Invitation email rate limiting is not configured');
 let url: URL;
 try {
  url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
 } catch { throw new Error('Invitation email rate limiting is not configured'); }
 const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
 const identity = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
 const ipHash = createHash('sha256').update(ip).digest('hex');
 const response = await fetch(url, {
  method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
  body: JSON.stringify({ bucket: 'teacher-invitation', identity, ip: ipHash }),
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(2500),
 }).catch(() => null);
 if (!response?.ok) throw new Error('Invitation email rate limiter is unavailable');
 const verdict = await response.json().catch(() => null);
 if (!verdict || typeof verdict.allowed !== 'boolean') throw new Error('Invitation email rate limiter is unavailable');
 if (!verdict.allowed) throw new Error('Invitation email rate limit exceeded');
}

async function readJson(request: NextRequest): Promise<{ body: unknown } | { response: NextResponse }> {
 if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return { response: reply({ error: 'JSON required' }, 415) };
 const reader = request.body?.getReader();
 if (!reader) return { response: reply({ error: 'Missing body' }, 400) };
 const chunks: Uint8Array[] = []; let size = 0;
 while (true) {
  const { done, value } = await reader.read(); if (done) break;
  size += value.byteLength;
  if (size > 32000) { await reader.cancel(); return { response: reply({ error: 'Request too large' }, 413) }; }
  chunks.push(value);
 }
 try { return { body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }; } catch { return { response: reply({ error: 'Invalid JSON' }, 400) }; }
}

function failure(error: unknown) {
 const { status, reason } = error as { status?: number; reason?: string };
 const known = status !== undefined && [400, 403, 404, 409, 410, 503].includes(status);
 return reply({ error: known ? (error as Error).message : 'Provisioning is unavailable. Please retry.', reason: known ? reason : 'unavailable' }, known ? status : 503);
}

/** Every handler authorizes on the server; the database re-checks inside each RPC. */
async function adminGate(request: NextRequest, writing: boolean) {
 if (writing && !validFirebaseOrigin(request)) return { response: reply({ error: 'Invalid origin' }, 403) };
 const access = await getPlatformAdminAccess();
 if (access.status === 'unavailable') return { response: reply({ error: 'Not found' }, 404) };
 if (access.status === 'anonymous') return { response: reply({ error: 'Sign in required' }, 401) };
 if (access.status === 'forbidden') return { response: reply({ error: 'Platform administration is not permitted.', reason: 'forbidden' }, 403) };
 if (new URL(request.url).search) return { response: reply({ error: 'Unexpected query' }, 400) };
 return { service: platformProvisioningService(access.client) };
}

/** GET lists provisioned portals; POST provisions one portal and returns its one-time invitation secret. */
export async function platformPortalsHTTP(request: NextRequest) {
 try {
  const writing = request.method === 'POST';
  const gate = await adminGate(request, writing);
  if ('response' in gate) return gate.response;
  if (!writing) return reply(await gate.service.overview());
  const parsed = await readJson(request);
  if ('response' in parsed) return parsed.response;
  const input = provisionTeacherRequest.safeParse(parsed.body);
  if (!input.success) return reply({ error: 'Some details are not valid.', reason: 'invalid' }, 400);
  return reply(await gate.service.provision(input.data), 201);
 } catch (error) { return failure(error); }
}

/** GET inspects a portal; POST reissues or revokes its invitation. */
export async function platformPortalHTTP(request: NextRequest, portalId: string) {
 try {
  const writing = request.method === 'POST';
  if (!uuid.test(portalId)) return reply({ error: 'Not found' }, 404);
  const gate = await adminGate(request, writing);
  if ('response' in gate) return gate.response;
  if (!writing) return reply(await gate.service.detail(portalId));
  const parsed = await readJson(request);
  if ('response' in parsed) return parsed.response;
  const input = portalAction.safeParse(parsed.body);
  if (!input.success) return reply({ error: 'Some details are not valid.', reason: 'invalid' }, 400);
  if (input.data.action === 'revoke') return reply(await gate.service.revoke(portalId));
  if (input.data.action === 'send-email') {
   const current = await gate.service.detail(portalId);
   const recipient = current.invitations[0]?.teacherEmail;
   if (!recipient) return reply({ error: 'Invitation not found.', reason: 'not_found' }, 404);
   // Check the durable rate limit before replacing the current link.
   await limitInvitationEmail(request, recipient);
   const renewed = await gate.service.reissue(portalId, input.data.expiresInDays);
   let delivery: 'sent' | 'failed' = 'failed';
   try {
    await sendTeacherInvitationEmail(recipient, renewed.invitationSecret, requestedLanguage(request));
    delivery = 'sent';
   } catch {
    // The invitation remains valid and is returned once for manual sharing. Never claim delivery.
   }
   return reply({ ...renewed, delivery }, 200);
  }
  return reply(await gate.service.reissue(portalId, input.data.expiresInDays, input.data.teacherEmail));
 } catch (error) { return failure(error); }
}

/** Acceptance is done by the invited teacher (any verified Firebase user), never by an administrator on their behalf. */
export async function acceptTeacherInvitationHTTP(request: NextRequest) {
 try {
  if (!isFirebaseStaging()) return reply({ error: 'Not found' }, 404);
  if (request.method !== 'POST' || !validFirebaseOrigin(request)) return reply({ error: 'Invalid origin' }, 403);
  if (new URL(request.url).search) return reply({ error: 'Unexpected query' }, 400);
  const viewer = await getApplicationViewer();
  if (!viewer || viewer.backend !== 'firebase') return reply({ error: 'Sign in required' }, 401);
  const parsed = await readJson(request);
  if ('response' in parsed) return parsed.response;
  const input = acceptInvitationRequest.safeParse(parsed.body);
  if (!input.success) return reply({ error: 'This invitation link is not valid.', reason: 'invalid' }, 400);
  const client = await getSupabaseServerClient();
  return reply(await acceptTeacherInvitation(client, input.data.token));
 } catch (error) { return failure(error); }
}

/** Next route-handler signature for /api/platform-admin/portals/[portalId]. */
export async function platformPortalRoute(request: NextRequest, context: { params: Promise<{ portalId: string }> }) {
 return platformPortalHTTP(request, (await context.params).portalId);
}
