import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { getSupabaseServerClient } from '@/server/integrations/supabase';
import type { PortalDetail, PortalOverview, ProvisionResult, ProvisionTeacherRequest, ProvisioningReason, ReissueResult } from '@/shared/contracts/platform-provisioning';

type Client = Awaited<ReturnType<typeof getSupabaseServerClient>>;
type DbError = { code?: string; message?: string };
export const provisioningFailure = (message: string, status: number, reason: ProvisioningReason) => Object.assign(new Error(message), { status, reason });

/** The secret exists only in memory: the database receives its SHA-256 and the caller sees it once. */
export function newInvitationSecret() {
 const secret = randomBytes(32).toString('base64url');
 return { secret, hash: createHash('sha256').update(secret).digest('hex') };
}
export const hashInvitationSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

export function provisioningError(error: DbError) {
 const pending = /pending invitation/i.test(error.message ?? '');
 switch (error.code) {
  case '42501': return provisioningFailure('This action is not permitted.', 403, 'forbidden');
  case 'PT404': return provisioningFailure('That portal or invitation was not found.', 404, 'not_found');
  case 'PT409': return provisioningFailure('The invitation was already used or has nothing left to change.', 409, 'used');
  case 'PT410': return provisioningFailure('The invitation is no longer valid.', 410, 'gone');
  case '23505': return provisioningFailure(pending ? 'A pending invitation already exists for this email.' : 'Two entries share the same name.', 409, pending ? 'pending_exists' : 'duplicate');
  case '22023': return provisioningFailure('Some details are not valid.', 400, 'invalid');
  default: return provisioningFailure('Provisioning is unavailable. Please retry.', 503, 'unavailable');
 }
}

/** The caller must already have passed getPlatformAdminAccess(); the RPCs re-check in the database. */
export function platformProvisioningService(client: Client) {
 return {
  async provision(input: ProvisionTeacherRequest): Promise<ProvisionResult> {
   const { secret, hash } = newInvitationSecret();
   const { data, error } = await client.rpc('platform_provision_teacher', { p_request: input as never, p_token_hash: hash });
   if (error || !data) throw provisioningError(error ?? {});
   const created = data as { organizationId: string; invitationId: string; courseId: string; expiresAt: string };
   return { ...created, invitationSecret: secret, delivery: 'not_sent' };
  },
  async reissue(organizationId: string, expiresInDays: number, teacherEmail?: string): Promise<ReissueResult> {
   const { secret, hash } = newInvitationSecret();
   const { data, error } = await client.rpc('platform_reissue_teacher_invitation', { p_organization_id: organizationId, p_token_hash: hash, p_expires_in_days: expiresInDays, ...(teacherEmail ? { p_email: teacherEmail } : {}) });
   if (error || !data) throw provisioningError(error ?? {});
   const reissued = data as { organizationId: string; invitationId: string; expiresAt: string };
   return { ...reissued, invitationSecret: secret, delivery: 'not_sent' };
  },
  async revoke(organizationId: string) {
   const { data, error } = await client.rpc('platform_revoke_teacher_invitation', { p_organization_id: organizationId });
   if (error || !data) throw provisioningError(error ?? {});
   return data as { organizationId: string; invitationId: string };
  },
  async overview(): Promise<PortalOverview> {
   const { data, error } = await client.rpc('platform_portal_overview', { p_limit: 50 });
   if (error || !data) throw provisioningError(error ?? {});
   return data as unknown as PortalOverview;
  },
  async detail(organizationId: string): Promise<PortalDetail> {
   const { data, error } = await client.rpc('platform_portal_detail', { p_organization_id: organizationId });
   if (error || !data) throw provisioningError(error ?? {});
   return data as unknown as PortalDetail;
  },
 };
}

/** Acceptance runs as the signed-in teacher (not an administrator) and needs only the hash. */
export async function acceptTeacherInvitation(client: Client, secret: string) {
 const { data, error } = await client.rpc('accept_teacher_invitation', { p_token_hash: hashInvitationSecret(secret) });
 if (error || !data) throw provisioningError(error ?? {});
 return data as { organizationId: string };
}
