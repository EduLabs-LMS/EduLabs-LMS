import 'server-only';
import { passwordResetRequestBody, buildResetLink, resetCodeFromFirebaseLink, type ResetLanguage } from '@/shared/password-reset';
import { googleAccountEmailContent, passwordResetEmailContent } from '@/server/services/password-reset-email';
import { brevoTransport, mailSender, type MailTransport } from '@/server/services/invitation-delivery';
import type { Limiter } from '@/server/services/password-reset-limiter';

/**
 * Asking for a password-reset email. The reply NEVER depends on whether an account exists:
 *   - the request is validated and counted against the limits first (the same for every address);
 *   - then the caller gets the same 202 at once, and the real work (look the account up, make the link, send the email) runs AFTER the reply
 *     (`defer`), so how long the reply takes cannot tell either;
 *   - what is refused is refused before the lookup and for every address alike (a malformed body, a limit, an unconfigured mailer).
 * Nothing here logs an email address, a code or a link: `log` takes only a fixed event name.
 */

export type ResetAdmin = {
 getUserByEmail(email: string): Promise<{ disabled: boolean; providerData: { providerId: string }[] }>;
 generatePasswordResetLink(email: string, settings: { url: string; handleCodeInApp: boolean }): Promise<string>;
};
export type ResetMailer = { configured(): boolean; send(message: { to: string; subject: string; html: string; text: string }): Promise<'sent' | 'rejected' | 'unconfirmed'> };
export type ResetLogEvent = 'sent' | 'no_account' | 'google_account_sent' | 'not_password_account' | 'disabled_account' | 'link_failed' | 'mail_rejected' | 'mail_unconfirmed' | 'lookup_failed' | 'unavailable' | 'limited';
export type ResetDeps = {
 origin(): string | null;
 admin(): ResetAdmin;
 mailer: ResetMailer;
 limiter: Limiter;
 defer(work: () => Promise<void>): void;
 log(event: ResetLogEvent): void;
};
export type ResetReply = { status: 202; body: { ok: true } } | { status: 400; body: { error: 'invalid_request' } } | { status: 429; body: { error: 'rate_limited'; retryAfterSeconds: number } } | { status: 503; body: { error: 'unavailable' } };

const noAccountCode = 'auth/user-not-found';

export async function requestPasswordReset(rawBody: unknown, client: { address: string | null }, deps: ResetDeps): Promise<ResetReply> {
 const parsed = passwordResetRequestBody.safeParse(rawBody);
 if (!parsed.success) return { status: 400, body: { error: 'invalid_request' } };
 const { email, language } = parsed.data;
 // Limits first, for every address the same way. The email bucket counts every request for an address, whether or not it has an account.
 const ip = deps.limiter.take(client.address ? 'ip' : 'shared', client.address ?? 'shared');
 const mail = deps.limiter.take('email', email);
 const refused = [ip, mail].find((v) => !v.allowed);
 if (refused && !refused.allowed) { deps.log('limited'); return { status: 429, body: { error: 'rate_limited', retryAfterSeconds: refused.retryAfterSeconds } }; }
 // Not configured means nobody can be sent anything: the same 503 for every address.
 const origin = deps.origin();
 if (!origin || !deps.mailer.configured()) { deps.log('unavailable'); return { status: 503, body: { error: 'unavailable' } }; }
 deps.defer(() => deliverResetEmail(email, language, origin, deps));
 return { status: 202, body: { ok: true } };
}

/** The part that differs by account. It runs after the reply and never throws. */
export async function deliverResetEmail(email: string, language: ResetLanguage | undefined, origin: string, deps: ResetDeps): Promise<void> {
 try {
  const admin = deps.admin();
  let account;
  try { account = await admin.getUserByEmail(email); }
  catch (failure) { deps.log((failure as { code?: string })?.code === noAccountCode ? 'no_account' : 'lookup_failed'); return; }
  if (account.disabled) { deps.log('disabled_account'); return; }
  // A Google-only account has no password, and a reset link would add one (which links by email: sign-in methods are never linked that way here).
  // It gets a short email saying so instead, in the same style. The requester's reply was already sent and is the same for every address.
  if (!account.providerData.some((p) => p.providerId === 'password')) {
   if (!account.providerData.some((p) => p.providerId === 'google.com')) { deps.log('not_password_account'); return; }
   const outcome = await deps.mailer.send({ to: email, ...googleAccountEmailContent({ origin, language }) });
   deps.log(outcome === 'sent' ? 'google_account_sent' : outcome === 'rejected' ? 'mail_rejected' : 'mail_unconfirmed');
   return;
  }
  let link: string;
  try {
   const code = resetCodeFromFirebaseLink(await admin.generatePasswordResetLink(email, { url: origin + '/sign-in', handleCodeInApp: false }));
   if (!code) { deps.log('link_failed'); return; }
   link = buildResetLink(origin, code);
  } catch { deps.log('link_failed'); return; }
  const outcome = await deps.mailer.send({ to: email, ...passwordResetEmailContent({ link, language }) });
  deps.log(outcome === 'sent' ? 'sent' : outcome === 'rejected' ? 'mail_rejected' : 'mail_unconfirmed');
 } catch { deps.log('lookup_failed'); }
}

/**
 * The same Brevo account, key and sender as the teacher invitation (BREVO_API_KEY, AUTH_EMAIL_FROM). Not configured means "not sent". A 4xx from
 * Brevo is `rejected`; a timeout, 5xx or network failure is `unconfirmed` (the provider may still have sent it), and nothing is retried.
 */
export function createResetMailer(env: Record<string, string | undefined> = process.env, transport?: MailTransport, timeoutMs = 15000): ResetMailer {
 const apiKey = env.BREVO_API_KEY?.trim(), from = env.AUTH_EMAIL_FROM?.trim();
 const configured = () => Boolean(apiKey && from && mailSender.test(from));
 return {
  configured,
  async send(message) {
   if (!configured()) return 'rejected';
   const send = transport ?? brevoTransport(apiKey!);
   try {
    const verdict = await Promise.race([
     send({ from: from!, to: message.to, subject: message.subject, html: message.html, text: message.text, tag: 'edulabs-password-reset' }, 'password-reset'),
     new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs).unref?.()),
    ]);
    if (verdict === 'timeout') return 'unconfirmed';
    if (verdict.error) { const status = verdict.error.statusCode; return typeof status === 'number' && status >= 400 && status < 500 ? 'rejected' : 'unconfirmed'; }
    return 'sent';
   } catch { return 'unconfirmed'; }
  },
 };
}
