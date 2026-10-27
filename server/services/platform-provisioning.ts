import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { getSupabaseServerClient } from '@/server/integrations/supabase';
import { deriveInvitationSecret, productionInvitationDeps, type InvitationDeps } from '@/server/services/invitation-delivery';
import type { CopyLinkResult, InvitationDelivery, InvitationPreview, PortalDetail, PortalOverview, ProvisionResult, ProvisionTeacherRequest, ProvisioningReason, ReissueResult, SendEmailResult } from '@/shared/contracts/platform-provisioning';
import { buildInvitationLink } from '@/shared/invitation-link';

type Client = Awaited<ReturnType<typeof getSupabaseServerClient>>;
type DbError = { code?: string; message?: string };
export const provisioningFailure = (message: string, status: number, reason: ProvisioningReason) => Object.assign(new Error(message), { status, reason });

/**
 * The link secret is derived, not stored: base64url(HMAC(server key, random salt)). The database keeps the secret's SHA-256 (what
 * acceptance checks) and the non-secret salt, so the same link can be shown again without ever being readable from the database.
 */
export function newInvitationSecret(key: string) {
 const salt = randomBytes(16).toString('hex');
 const secret = deriveInvitationSecret(key, salt);
 return { secret, salt, hash: createHash('sha256').update(secret).digest('hex') };
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
const needKey = (deps: InvitationDeps) => {
 const key = deps.linkKey();
 if (!key) throw provisioningFailure('Invitation links are not configured, so no invitation link can be created.', 503, 'link_key_not_configured');
 return key;
};
const keyChanged = () => provisioningFailure('The invitation link key changed, so this link can no longer be reproduced.', 409, 'link_key_changed');
const noActiveLink = () => provisioningFailure('There is no active invitation link to reuse.', 409, 'no_active_invitation');

const notSent: InvitationDelivery = { status: 'not_sent', attemptedAt: null, failure: null, attempts: 0 };
const needOrigin = (deps: InvitationDeps) => {
 const origin = deps.origin();
 if (!origin) throw provisioningFailure('The application address is not configured, so no invitation link can be created.', 503, 'origin_not_configured');
 return origin;
};

/** The caller must already have passed getPlatformAdminAccess(); the RPCs re-check in the database. */
export function platformProvisioningService(client: Client, deps: InvitationDeps = productionInvitationDeps()) {
 async function detail(organizationId: string): Promise<PortalDetail> {
  const { data, error } = await client.rpc('platform_portal_detail', { p_organization_id: organizationId });
  if (error || !data) throw provisioningError(error ?? {});
  const base = data as unknown as Omit<PortalDetail, 'invitations'> & { invitations: Omit<PortalDetail['invitations'][number], 'delivery'>[] };
  // Delivery status is a separate read so the detail page still works if only the earlier migration is installed.
  const delivery = await client.rpc('platform_invitation_delivery', { p_organization_id: organizationId });
  const byId = new Map<string, InvitationDelivery>();
  if (!delivery.error && Array.isArray(delivery.data)) for (const row of delivery.data as { invitationId: string; status: InvitationDelivery['status']; attemptedAt: string | null; failure: 'rejected' | null; attempts?: number }[]) byId.set(row.invitationId, { status: row.status, attemptedAt: row.attemptedAt, failure: row.failure, attempts: row.attempts ?? 0 });
  return { ...base, invitations: base.invitations.map((i) => ({ ...i, delivery: byId.get(i.id) ?? notSent })) };
 }
 /** Stores the non-secret salt that lets Send and Copy re-derive this exact link. A failure leaves a valid link that cannot be shown again. */
 async function keepSalt(invitationId: string, salt: string) {
  const { error } = await client.rpc('platform_store_invitation_salt', { p_invitation_id: invitationId, p_salt: salt });
  return !error;
 }
 async function reissueRaw(key: string, organizationId: string, expiresInDays: number, teacherEmail?: string) {
  const { secret, salt, hash } = newInvitationSecret(key);
  const { data, error } = await client.rpc('platform_reissue_teacher_invitation', { p_organization_id: organizationId, p_token_hash: hash, p_expires_in_days: expiresInDays, ...(teacherEmail ? { p_email: teacherEmail } : {}) });
  if (error || !data) throw provisioningError(error ?? {});
  const issued = data as { organizationId: string; invitationId: string; expiresAt: string };
  return { secret, reusable: await keepSalt(issued.invitationId, salt), ...issued };
 }
 /** Never rotates: reads the active invitation's salt and derives the same secret again. */
 async function activeLink(key: string, origin: string, organizationId: string) {
  const { data, error } = await client.rpc('platform_invitation_link', { p_organization_id: organizationId });
  if (error) throw error.code === 'PT404' || error.code === 'PT410' ? noActiveLink() : provisioningError(error);
  const row = data as { invitationId: string; expiresAt: string; salt: string | null; tokenHash: string } | null;
  if (!row?.salt) throw noActiveLink(); // issued without a stored salt: it cannot be shown again, only replaced
  const secret = deriveInvitationSecret(key, row.salt);
  // A changed or wrong server key would derive a link the database no longer recognises: refuse instead of handing out a dead link.
  if (hashInvitationSecret(secret) !== row.tokenHash) throw keyChanged();
  return { invitationId: row.invitationId, expiresAt: row.expiresAt, invitationLink: buildInvitationLink(origin, secret) };
 }
 async function record(invitationId: string, status: 'sending' | 'sent' | 'failed', providerRef?: string | null, failure?: 'rejected') {
  const { data, error } = await client.rpc('platform_record_invitation_delivery', { p_invitation_id: invitationId, p_status: status, ...(providerRef ? { p_provider_ref: providerRef } : {}), ...(failure ? { p_failure: failure } : {}) });
  if (error) throw provisioningError(error);
  return Number((data as { attempt?: number } | null)?.attempt ?? 0);
 }
 return {
  detail,
  async provision(input: ProvisionTeacherRequest): Promise<ProvisionResult> {
   const origin = needOrigin(deps); // before any write: a missing origin or key must not leave an invitation nobody can open
   const key = needKey(deps);
   const { secret, salt, hash } = newInvitationSecret(key);
   const { data, error } = await client.rpc('platform_provision_teacher', { p_request: input as never, p_token_hash: hash });
   if (error || !data) throw provisioningError(error ?? {});
   const created = data as { organizationId: string; invitationId: string; courseId: string; expiresAt: string };
   return { ...created, invitationLink: buildInvitationLink(origin, secret), delivery: 'not_sent', reusable: await keepSalt(created.invitationId, salt) };
  },
  /** The ONLY action that rotates a link: the previous link, and any e-mail that carried it, stops working. */
  async reissue(organizationId: string, expiresInDays: number, teacherEmail?: string): Promise<ReissueResult> {
   const origin = needOrigin(deps);
   const key = needKey(deps);
   const { secret, ...reissued } = await reissueRaw(key, organizationId, expiresInDays, teacherEmail);
   return { ...reissued, invitationLink: buildInvitationLink(origin, secret), delivery: 'not_sent' };
  },
  /** "Copy invitation link": the active link again. Nothing is created, rotated or recorded. */
  async copyLink(organizationId: string): Promise<CopyLinkResult> {
   const origin = needOrigin(deps);
   const key = needKey(deps);
   const link = await activeLink(key, origin, organizationId);
   return { organizationId, ...link };
  },
  /**
   * E-mails the ACTIVE link (never a new one) to the address stored with the invitation, never one supplied by the caller, and
   * records what actually happened. Sending again is deliberate and re-sends the same link. A provider call that returns no
   * verdict is reported as unconfirmed and is never retried here, because the e-mail may already have been accepted.
   */
  async sendEmail(organizationId: string): Promise<SendEmailResult> {
   const origin = needOrigin(deps);
   const key = needKey(deps);
   if (!deps.mailer.configured()) throw provisioningFailure('E-mail delivery is not configured.', 503, 'email_not_configured'); // nothing was changed
   // Without the delivery migration the status could not be recorded, so refuse before anything is sent.
   const ready = await client.rpc('platform_invitation_delivery', { p_organization_id: organizationId });
   if (ready.error) throw provisioningError(ready.error);
   const link = await activeLink(key, origin, organizationId);
   const current = (await detail(organizationId)).invitations.find((i) => i.id === link.invitationId);
   if (!current) throw provisioningFailure('Provisioning is unavailable. Please retry.', 503, 'unavailable');
   const attempt = await record(link.invitationId, 'sending'); // if this fails nothing has been sent
   const out = await deps.mailer.send({ to: current.teacherEmail, link: link.invitationLink, expiresAt: link.expiresAt, idempotencyKey: `${link.invitationId}-${attempt}` });
   const base = { organizationId, invitationId: link.invitationId, expiresAt: link.expiresAt, attempt };
   if (out.outcome === 'unconfirmed') return { ...base, delivery: 'unconfirmed', statusSaved: true };
   try {
    if (out.outcome === 'sent') await record(link.invitationId, 'sent', out.providerRef);
    else await record(link.invitationId, 'failed', null, 'rejected');
   } catch { return { ...base, delivery: out.outcome === 'sent' ? 'sent' : 'failed', statusSaved: false }; }
   return { ...base, delivery: out.outcome === 'sent' ? 'sent' : 'failed', statusSaved: true };
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
 };
}

/** Acceptance runs as the signed-in teacher (not an administrator) and needs only the hash. */
export async function acceptTeacherInvitation(client: Client, secret: string) {
 const { data, error } = await client.rpc('accept_teacher_invitation', { p_token_hash: hashInvitationSecret(secret) });
 if (error || !data) throw provisioningError(error ?? {});
 return data as { organizationId: string };
}

/** Read-only: tells the signed-in caller what state their link is in. It never consumes or changes the invitation. */
export async function previewTeacherInvitation(client: Client, secret: string): Promise<InvitationPreview> {
 const { data, error } = await client.rpc('teacher_invitation_preview', { p_token_hash: hashInvitationSecret(secret) });
 if (error || !data) throw provisioningError(error ?? {});
 return data as unknown as InvitationPreview;
}
