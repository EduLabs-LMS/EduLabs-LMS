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
 z.object({ action: z.literal('revoke') }).strict(),
 z.object({ action: z.literal('send-email'), expiresInDays: lifetime }).strict(),
]);
export type PortalAction = z.infer<typeof portalAction>;

export const acceptInvitationRequest = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
/** Closed vocabulary so the interface can localize failures without parsing database text. */
export type ProvisioningReason = 'invalid' | 'duplicate' | 'pending_exists' | 'not_found' | 'used' | 'gone' | 'forbidden' | 'conflict' | 'unavailable';

export type PortalSummary = {
 organizationId: string; teacherEmail: string; createdAt: string; expiresAt: string; acceptedAt: string | null; invitationStatus: InvitationStatus;
 course: { id: string; title: string; subject: string | null; grade: string | null; educationSystem: string | null; examinationBoard: string | null } | null;
};
export type PortalOverview = { items: PortalSummary[]; hasMore: boolean };
export type PortalDetail = {
 organizationId: string; status: string; createdAt: string; hasOwner: boolean;
 invitations: { id: string; teacherEmail: string; createdAt: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null; revokeReason: 'revoked' | 'superseded' | null; status: InvitationStatus }[];
 educationSystems: { id: string; name: string; examinationBoard: string | null; gradeLevels: { id: string; name: string }[] }[];
 subjects: { id: string; name: string }[];
 courses: { id: string; title: string; status: string; subject: string | null; gradeLevel: string | null; educationSystem: string | null }[];
 activity: { action: string; occurredAt: string; actor: 'administrator' | 'teacher' }[];
};
/** `delivery` is always 'not_sent': email delivery is a separate, unconnected workstream. */
export type ProvisionResult = { organizationId: string; invitationId: string; courseId: string; expiresAt: string; invitationSecret: string; delivery: 'not_sent' };
export type ReissueResult = { organizationId: string; invitationId: string; expiresAt: string; invitationSecret: string; delivery: 'not_sent' | 'sent' | 'failed' };
