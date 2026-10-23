import 'server-only';

import { Resend } from 'resend';
import { getFirebaseAdminAuth } from '@/server/integrations/firebase-admin';

export type FirebaseEmailActionMode = 'verifyEmail' | 'resetPassword';

type BrandedEmailContent = {
  preheader: string;
  headline: string;
  greeting?: string;
  paragraphs: string[];
  buttonLabel: string;
  actionUrl: string;
  footer: string;
};

function appOrigin() {
  const raw = process.env.APP_ORIGIN;
  if (!raw) throw new Error('Branded email action origin is not configured');
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error('Branded email action origin is invalid'); }
  if (parsed.origin !== raw || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('Branded email action origin must be an exact origin');
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('Branded email action origin must use HTTPS');
  }
  return parsed.origin;
}

export function assertBrandedEmailConfigured() {
  if (!process.env.RESEND_API_KEY?.trim() || !process.env.AUTH_EMAIL_FROM?.trim()) {
    throw new Error('Branded email delivery is not configured');
  }
  appOrigin();
}

/**
 * Firebase generates the one-time action code. We keep that code intact and
 * place it in our own action-handler URL so Firebase Hosting is never the
 * user-facing destination. Never invent or sign an action code ourselves.
 */
export function buildBrandedActionUrl(firebaseActionLink: string, expectedMode: FirebaseEmailActionMode) {
  let generated: URL;
  try { generated = new URL(firebaseActionLink); } catch { throw new Error('Firebase generated an invalid action link'); }
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const allowedHosts = new Set(projectId ? [`${projectId}.firebaseapp.com`, `${projectId}.web.app`] : []);
  if (generated.protocol !== 'https:' || !allowedHosts.has(generated.hostname) ||
      !['/__/auth/action', '/__/auth/handler'].includes(generated.pathname) ||
      generated.username || generated.password || generated.hash) {
    throw new Error('Firebase generated an unexpected action-link destination');
  }
  const mode = generated.searchParams.get('mode');
  const code = generated.searchParams.get('oobCode');
  if (mode !== expectedMode || !code || code.length > 4096) {
    throw new Error('Firebase generated an unexpected action-link payload');
  }
  const actionUrl = new URL('/auth/action', appOrigin());
  actionUrl.searchParams.set('mode', mode);
  actionUrl.searchParams.set('oobCode', code);
  const language = generated.searchParams.get('lang');
  if (language && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) {
    actionUrl.searchParams.set('lang', language);
  }
  return actionUrl.toString();
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeActionUrl(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('Email action URL is invalid'); }
  if (parsed.origin !== appOrigin() || parsed.protocol !== 'https:' && process.env.NODE_ENV === 'production' ||
      parsed.username || parsed.password || parsed.hash) {
    throw new Error('Email action URL must stay on the EduLabs website');
  }
  return parsed.toString();
}

export function renderBrandedEmail(content: BrandedEmailContent) {
  const origin = appOrigin();
  const actionUrl = safeActionUrl(content.actionUrl);
  const preheader = escapeHtml(content.preheader);
  const headline = escapeHtml(content.headline);
  const greeting = content.greeting ? `<p style="margin:0 0 16px;color:#1b2819;font-size:16px;line-height:1.65;">${escapeHtml(content.greeting)}</p>` : '';
  const paragraphs = content.paragraphs.map(value =>
    `<p style="margin:0 0 16px;color:#354333;font-size:15px;line-height:1.75;">${escapeHtml(value)}</p>`).join('');
  const buttonLabel = escapeHtml(content.buttonLabel);
  const footer = escapeHtml(content.footer);
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#e9eee5;font-family:Arial,Helvetica,sans-serif;color:#142011;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#e9eee5;width:100%;">
    <tr><td align="center" style="padding:32px 14px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
        <tr><td style="padding:0 0 18px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
            <td valign="middle" style="width:42px;height:42px;background:#7ed957;border:2px solid #111;border-radius:12px;text-align:center;font-size:22px;font-weight:800;color:#142011;">E</td>
            <td valign="middle" style="padding-left:12px;font-size:25px;font-weight:800;letter-spacing:-0.6px;color:#142011;">EduLabs</td>
          </tr></table>
        </td></tr>
        <tr><td style="background:#f7f8f3;border:2px solid #111;border-radius:22px;padding:34px 32px;box-shadow:5px 5px 0 #111;">
          <p style="margin:0 0 12px;color:#276b39;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">EDULABS ACCOUNT</p>
          <h1 style="margin:0 0 20px;color:#142011;font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-0.5px;">${headline}</h1>
          ${greeting}${paragraphs}
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 22px;">
            <tr><td bgcolor="#7ed957" style="border:2px solid #111;border-radius:13px;box-shadow:3px 3px 0 #111;">
              <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:14px 22px;color:#142011;text-decoration:none;font-size:15px;font-weight:800;">${buttonLabel} &rarr;</a>
            </td></tr>
          </table>
          <p style="margin:0 0 10px;color:#5c6a58;font-size:12px;line-height:1.7;">If the button does not work, copy this link into your browser:</p>
          <p style="margin:0 0 22px;overflow-wrap:anywhere;font-size:12px;line-height:1.7;"><a href="${escapeHtml(actionUrl)}" style="color:#276b39;">${escapeHtml(actionUrl)}</a></p>
          <div style="border-top:1px solid #d7dfd0;padding-top:18px;color:#5c6a58;font-size:12px;line-height:1.7;">${footer}</div>
        </td></tr>
        <tr><td style="padding:22px 8px 0;color:#5c6a58;text-align:center;font-size:11px;line-height:1.7;">EduLabs · Learning, organized around you.<br><a href="${escapeHtml(origin)}" style="color:#276b39;text-decoration:underline;">Visit EduLabs</a></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [
    'EduLabs',
    content.headline,
    content.greeting ?? '',
    ...content.paragraphs,
    `${content.buttonLabel}: ${actionUrl}`,
    actionUrl,
    content.footer,
    `EduLabs · ${origin}`,
  ].filter(Boolean).join('\n\n');
  return { html, text };
}

async function sendEmail(to: string, subject: string, content: BrandedEmailContent) {
  assertBrandedEmailConfigured();
  const resend = new Resend(process.env.RESEND_API_KEY!.trim());
  const { html, text } = renderBrandedEmail(content);
  const result = await resend.emails.send({
    from: process.env.AUTH_EMAIL_FROM!.trim(),
    to,
    subject,
    html,
    text,
  });
  if (result.error) {
    // Do not log recipient addresses, action codes, full provider responses, or email bodies.
    throw new Error('Branded email provider rejected the message');
  }
}

export async function sendVerificationEmailForUser(user: { email?: string | null; displayName?: string | null }) {
  assertBrandedEmailConfigured();
  if (!user.email) throw new Error('Firebase user has no email address');
  const link = await getFirebaseAdminAuth().generateEmailVerificationLink(user.email);
  const actionUrl = buildBrandedActionUrl(link, 'verifyEmail');
  const name = user.displayName?.trim().split(/\s+/)[0];
  await sendEmail(user.email, 'Verify your EduLabs email address', {
    preheader: 'Confirm your email to finish setting up your EduLabs account.',
    headline: 'Verify your email address',
    greeting: name ? `Hello ${name},` : 'Hello,',
    paragraphs: [
      'Please confirm that this email address belongs to you so we can keep your EduLabs account secure.',
      'Use the button below to verify your email address. If you did not create an EduLabs account, you can safely ignore this message.',
    ],
    buttonLabel: 'Verify email address',
    actionUrl,
    footer: 'For your security, this link is single-use and expires. EduLabs will never ask you to share your password or verification link.',
  });
}

export async function sendPasswordResetForAddress(email: string) {
  assertBrandedEmailConfigured();
  const auth = getFirebaseAdminAuth();
  let user;
  try { user = await auth.getUserByEmail(email); }
  catch (failure) {
    if ((failure as { code?: string }).code === 'auth/user-not-found') return;
    throw failure;
  }
  if (user.disabled || !user.providerData.some(provider => provider.providerId === 'password')) return;
  const link = await auth.generatePasswordResetLink(email);
  const actionUrl = buildBrandedActionUrl(link, 'resetPassword');
  const name = user.displayName?.trim().split(/\s+/)[0];
  await sendEmail(email, 'Reset your EduLabs password', {
    preheader: 'Choose a new password for your EduLabs account.',
    headline: 'Reset your password',
    greeting: name ? `Hello ${name},` : 'Hello,',
    paragraphs: [
      'We received a request to reset the password for your EduLabs account.',
      'Choose a new password using the button below. If you did not request this, you can safely ignore this message; your password will not change.',
    ],
    buttonLabel: 'Choose a new password',
    actionUrl,
    footer: 'For your security, this link is single-use and expires. Never share password-reset links with anyone.',
  });
}
