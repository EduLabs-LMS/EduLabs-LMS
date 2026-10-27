import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { acceptInvitationRequest, portalAction, previewInvitationRequest, provisionTeacherRequest } from '@/shared/contracts/platform-provisioning';
import { getPlatformAdminAccess } from '@/server/services/platform-admin';
import { acceptTeacherInvitation, platformProvisioningService, previewTeacherInvitation } from '@/server/services/platform-provisioning';
import { validFirebaseOrigin } from '@/server/http/firebase/route';
import { getApplicationViewer } from '@/server/services/application-auth';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import { isFirebaseStaging } from '@/shared/auth-config';

// The response may carry a one-time invitation link: it must never be cached or indexed.
export const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' } });
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function readJson(request: NextRequest): Promise<{ body: unknown } | { response: NextResponse }> {
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

export function failure(error: unknown) {
 const { status, reason } = error as { status?: number; reason?: string };
 const known = status !== undefined && [400, 403, 404, 409, 410, 503].includes(status);
 return reply({ error: known ? (error as Error).message : 'Provisioning is unavailable. Please retry.', reason: known ? reason : 'unavailable' }, known ? status : 503);
}

/** Every handler authorizes on the server; the database re-checks inside each RPC. */
export async function adminAccess(request: NextRequest, writing: boolean) {
 if (writing && !validFirebaseOrigin(request)) return { response: reply({ error: 'Invalid origin' }, 403) };
 const access = await getPlatformAdminAccess();
 if (access.status === 'unavailable') return { response: reply({ error: 'Not found' }, 404) };
 if (access.status === 'anonymous') return { response: reply({ error: 'Sign in required' }, 401) };
 if (access.status === 'forbidden') return { response: reply({ error: 'Platform administration is not permitted.', reason: 'forbidden' }, 403) };
 if (new URL(request.url).search) return { response: reply({ error: 'Unexpected query' }, 400) };
 return { client: access.client };
}
async function adminGate(request: NextRequest, writing: boolean) {
 const access = await adminAccess(request, writing);
 if ('response' in access) return { response: access.response };
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
  if (input.data.action === 'send_email') return reply(await gate.service.sendEmail(portalId));
  if (input.data.action === 'copy_link') return reply(await gate.service.copyLink(portalId));
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

/** Read-only status of a link for the signed-in holder. It never consumes the invitation. */
export async function previewTeacherInvitationHTTP(request: NextRequest) {
 try {
  if (!isFirebaseStaging()) return reply({ error: 'Not found' }, 404);
  if (request.method !== 'POST' || !validFirebaseOrigin(request)) return reply({ error: 'Invalid origin' }, 403);
  if (new URL(request.url).search) return reply({ error: 'Unexpected query' }, 400);
  const viewer = await getApplicationViewer();
  if (!viewer || viewer.backend !== 'firebase') return reply({ error: 'Sign in required' }, 401);
  const parsed = await readJson(request);
  if ('response' in parsed) return parsed.response;
  const input = previewInvitationRequest.safeParse(parsed.body);
  if (!input.success) return reply({ error: 'This invitation link is not valid.', reason: 'invalid' }, 400);
  const client = await getSupabaseServerClient();
  return reply(await previewTeacherInvitation(client, input.data.token));
 } catch (error) { return failure(error); }
}

/** Next route-handler signature for /api/platform-admin/portals/[portalId]. */
export async function platformPortalRoute(request: NextRequest, context: { params: Promise<{ portalId: string }> }) {
 return platformPortalHTTP(request, (await context.params).portalId);
}
