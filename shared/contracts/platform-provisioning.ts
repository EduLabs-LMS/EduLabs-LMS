import { z } from 'zod';

/** Mirrors private.platform_provision_teacher. The database re-validates every field. */
export const invitationLifetimes = [1, 3, 7, 14, 30] as const;
export const provisioningLimits = { systems: 5, grades: 20, subjects: 20 } as const;

const noControl = /^[^\u0000-\u001f\u007f]*$/;
const label = (max: number) => z.string().trim().min(1).max(max).regex(noControl);
const key = z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/);
const email = z.string().trim().toLowerCase().min(3).max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
const lifetime = z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(30)]);

const grade = z.object({ key, label: label(160) }).strict();
const system = z.object({
 label: label(160),
 examinationBoard: label(120).nullish().transform((v) => v ?? null),
 grades: z.array(grade).min(1).max(provisioningLimits.grades),
}).strict();
const subject = z.object({ key, label: label(160) }).strict();

export const provisionTeacherRequest = z.object({
 teacherEmail: email,
 expiresInDays: lifetime,
 systems: z.array(system).min(1).max(provisioningLimits.systems),
 subjects: z.array(subject).min(1).max(provisioningLimits.subjects),
 course: z.object({ title: label(160), gradeKey: key, subjectKey: key }).strict(),
}).strict().superRefine((value, ctx) => {
 const unique = (items: string[], path: (string | number)[], message: string) => {
  const seen = new Set<string>();
  items.forEach((item, index) => { const k = item.toLowerCase(); if (seen.has(k)) ctx.addIssue({ code: 'custom', path: [...path, index], message }); seen.add(k); });
 };
 unique(value.systems.map((s) => s.label), ['systems'], 'duplicate_system');
 unique(value.subjects.map((s) => s.label), ['subjects'], 'duplicate_subject');
 unique(value.subjects.map((s) => s.key), ['subjects'], 'duplicate_key');
 const gradeKeys = value.systems.flatMap((s) => s.grades.map((g) => g.key));
 unique(gradeKeys, ['systems'], 'duplicate_key');
 value.systems.forEach((s, i) => unique(s.grades.map((g) => g.label), ['systems', i, 'grades'], 'duplicate_grade'));
 if (!gradeKeys.includes(value.course.gradeKey)) ctx.addIssue({ code: 'custom', path: ['course', 'gradeKey'], message: 'unknown_grade' });
 if (!value.subjects.some((s) => s.key === value.course.subjectKey)) ctx.addIssue({ code: 'custom', path: ['course', 'subjectKey'], message: 'unknown_subject' });
});
export type ProvisionTeacherRequest = z.infer<typeof provisionTeacherRequest>;

export const portalAction = z.discriminatedUnion('action', [
 z.object({ action: z.literal('reissue'), expiresInDays: lifetime, teacherEmail: email.optional() }).strict(),
 z.object({ action: z.literal('send_email') }).strict(),
 z.object({ action: z.literal('copy_link') }).strict(),
 z.object({ action: z.literal('revoke') }).strict(),
]);
export type PortalAction = z.infer<typeof portalAction>;

/** 32 random bytes, base64url: the only shape a link secret can have. */
export const invitationTokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const acceptInvitationRequest = z.object({ token: z.string().regex(invitationTokenPattern) }).strict();
export const previewInvitationRequest = acceptInvitationRequest;

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
/** Closed vocabulary so the interface can localize failures without parsing database text. */
export type ProvisioningReason = 'invalid' | 'duplicate' | 'pending_exists' | 'not_found' | 'used' | 'gone' | 'forbidden' | 'conflict' | 'unavailable' | 'email_not_configured' | 'origin_not_configured' | 'link_key_not_configured' | 'no_active_invitation';

export type PortalSummary = {
 organizationId: string; teacherEmail: string; createdAt: string; expiresAt: string; acceptedAt: string | null; invitationStatus: InvitationStatus;
 course: { id: string; title: string; subject: string | null; grade: string | null; educationSystem: string | null; examinationBoard: string | null } | null;
};
export type PortalOverview = { items: PortalSummary[]; hasMore: boolean };
/** sent = accepted by the e-mail provider (not proof of inbox delivery); sending = an attempt whose outcome was never recorded (unconfirmed). */
export type DeliveryStatus = 'not_sent' | 'sending' | 'sent' | 'failed';
export type InvitationDelivery = { status: DeliveryStatus; attemptedAt: string | null; failure: 'rejected' | null; attempts: number };
export type PortalDetail = {
 organizationId: string; status: string; createdAt: string; hasOwner: boolean;
 invitations: { id: string; teacherEmail: string; createdAt: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null; revokeReason: 'revoked' | 'superseded' | null; status: InvitationStatus; delivery: InvitationDelivery }[];
 educationSystems: { id: string; name: string; examinationBoard: string | null; gradeLevels: { id: string; name: string }[] }[];
 subjects: { id: string; name: string }[];
 courses: { id: string; title: string; status: string; subject: string | null; gradeLevel: string | null; educationSystem: string | null }[];
 activity: { action: string; occurredAt: string; actor: 'administrator' | 'teacher' }[];
};
/** The link is built on the server from the configured canonical origin; its secret exists only in this response. */
export type ProvisionResult = { organizationId: string; invitationId: string; courseId: string; expiresAt: string; invitationLink: string; delivery: 'not_sent'; reusable: boolean };
/** A replacement: every earlier link and e-mail for this teaching space stops working. */
export type ReissueResult = { organizationId: string; invitationId: string; expiresAt: string; invitationLink: string; delivery: 'not_sent'; reusable: boolean };
/** The same active link again. Nothing was rotated, so an e-mail already sent keeps working. */
export type CopyLinkResult = { organizationId: string; invitationId: string; expiresAt: string; invitationLink: string };
/** 'unconfirmed': the provider call did not return a verdict; the invitation stays in "sending" until an administrator checks. */
export type SendEmailResult = { organizationId: string; invitationId: string; expiresAt: string; delivery: 'sent' | 'failed' | 'unconfirmed'; statusSaved: boolean; attempt: number };

export type InvitationPreviewState = 'valid' | 'expired' | 'revoked' | 'used' | 'unavailable';
export type InvitationPreview = { state: InvitationPreviewState; emailVerified: boolean; emailMatches?: boolean; acceptedByMe?: boolean; maskedEmail?: string };
