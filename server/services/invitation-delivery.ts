import 'server-only';
import { createHmac } from 'node:crypto';
import { Resend } from 'resend';
import { publicPlatformOrigin } from '@/shared/public-website';

/** The trusted origin comes only from configuration, never from a request header. */
export function canonicalAppOrigin(env: Record<string, string | undefined> = process.env): string | null {
 try { return publicPlatformOrigin(env.APP_ORIGIN, env.NODE_ENV === 'development'); } catch { return null; }
}

/**
 * The key that turns a stored, non-secret salt into the link secret. It lives only in server configuration, so a copy of the
 * database cannot reproduce any link. Short keys are treated as not configured.
 */
export function invitationLinkKey(env: Record<string, string | undefined> = process.env): string | null {
 const key = env.INVITATION_LINK_KEY?.trim();
 return key && key.length >= 32 ? key : null;
}
/** secret = base64url(HMAC-SHA256(key, salt)): 43 characters, the shape every link secret has. */
export const deriveInvitationSecret = (key: string, saltHex: string) => createHmac('sha256', key).update('teacher-invitation-link-v1:' + saltHex).digest('base64url');

export type MailOutcome = { outcome: 'sent'; providerRef: string | null } | { outcome: 'rejected' } | { outcome: 'unconfirmed' };
export type InvitationMessage = { to: string; link: string; expiresAt: string; idempotencyKey: string };
export type InvitationMailer = { configured(): boolean; send(message: InvitationMessage): Promise<MailOutcome> };

const sender = /^(?:[^<>\r\n@]{1,80} )?<[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>$|^[^@\s<>\r\n]+@[^@\s<>]+\.[^@\s<>]+$/;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Content is bilingual because the invited teacher's language is not known before they sign in. Only the link is sensitive. */
export function invitationEmailContent(message: Pick<InvitationMessage, 'link' | 'expiresAt'>) {
 const until = new Date(message.expiresAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
 const link = escapeHtml(message.link);
 const subject = 'You are invited to teach on EduLabs · دعوة للتدريس على EduLabs';
 const text = [
  'You have been invited to set up your teaching space on EduLabs.',
  `Open this link, sign in or create your account with this email address, and accept: ${message.link}`,
  `The link works once and expires on ${until}. If you were not expecting this, ignore this email.`,
  '',
  'تمت دعوتك لإعداد مساحة التدريس الخاصة بك على EduLabs.',
  `افتح هذا الرابط وسجّل الدخول أو أنشئ حسابك بهذا البريد الإلكتروني ثم اقبل الدعوة: ${message.link}`,
  `يعمل الرابط مرة واحدة وينتهي في ${until}. إذا لم تكن تتوقع هذه الرسالة فتجاهلها.`,
 ].join('\n');
 const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#14301a">
<h1 style="font-size:22px;margin:0 0 12px">EduLabs</h1>
<p style="font-size:16px;line-height:1.5">You have been invited to set up your teaching space on EduLabs. Sign in or create your account with this email address, then accept the invitation.</p>
<p style="margin:24px 0"><a href="${link}" style="background:#7ed957;color:#14301a;font-weight:bold;text-decoration:none;padding:12px 20px;border-radius:12px;display:inline-block">Accept invitation</a></p>
<p style="font-size:13px;color:#4a5d4e">The link works once and expires on ${until}. If you were not expecting this, ignore this email.</p>
<hr style="border:none;border-top:1px solid #d9e4d6;margin:24px 0" />
<div dir="rtl" style="text-align:right"><p style="font-size:16px;line-height:1.6">تمت دعوتك لإعداد مساحة التدريس الخاصة بك على EduLabs. سجّل الدخول أو أنشئ حسابك بهذا البريد الإلكتروني ثم اقبل الدعوة.</p>
<p style="margin:24px 0"><a href="${link}" style="background:#7ed957;color:#14301a;font-weight:bold;text-decoration:none;padding:12px 20px;border-radius:12px;display:inline-block">قبول الدعوة</a></p>
<p style="font-size:13px;color:#4a5d4e">يعمل الرابط مرة واحدة وينتهي في ${until}. إذا لم تكن تتوقع هذه الرسالة فتجاهلها.</p></div></div>`;
 return { subject, text, html };
}

type Transport = (payload: { from: string; to: string; subject: string; html: string; text: string }, idempotencyKey: string) => Promise<{ data?: { id?: string } | null; error?: { statusCode?: number | null } | null }>;

/** Resend is the provider already used by the application (support mail). A missing key or sender means "not configured": nothing is sent or claimed. */
export function createInvitationMailer(env: Record<string, string | undefined> = process.env, transport?: Transport, timeoutMs = 15000): InvitationMailer {
 const apiKey = env.RESEND_API_KEY?.trim(), from = env.INVITATION_EMAIL_FROM?.trim();
 const configured = () => Boolean(apiKey && from && sender.test(from));
 return {
  configured,
  async send(message) {
   if (!configured()) return { outcome: 'rejected' };
   const { subject, text, html } = invitationEmailContent(message);
   const send: Transport = transport ?? ((payload, key) => new Resend(apiKey).emails.send(payload, { idempotencyKey: key }));
   try {
    const verdict = await Promise.race([
     send({ from: from!, to: message.to, subject, html, text }, `teacher-invitation-${message.idempotencyKey}`),
     new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs).unref?.()),
    ]);
    // No verdict inside the deadline: the provider may still have accepted the message, so this is never reported as a failure.
    if (verdict === 'timeout') return { outcome: 'unconfirmed' };
    if (verdict.error) {
     const status = verdict.error.statusCode;
     return typeof status === 'number' && status >= 400 && status < 500 ? { outcome: 'rejected' } : { outcome: 'unconfirmed' };
    }
    const id = verdict.data?.id;
    return { outcome: 'sent', providerRef: typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(id) ? id : null };
   } catch { return { outcome: 'unconfirmed' }; }
  },
 };
}
export const productionInvitationDeps = () => ({ origin: () => canonicalAppOrigin(), mailer: createInvitationMailer(), linkKey: () => invitationLinkKey() });
export type InvitationDeps = ReturnType<typeof productionInvitationDeps>;
