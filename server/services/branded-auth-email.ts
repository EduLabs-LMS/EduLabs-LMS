import 'server-only';

import { getFirebaseAdminAuth } from '@/server/integrations/firebase-admin';
import type { Language } from '@/shared/language';

export type FirebaseEmailActionMode = 'verifyEmail' | 'resetPassword';

type BrandedEmailContent = {
  preheader: string;
  headline: string;
  greeting?: string;
  paragraphs: string[];
  buttonLabel: string;
  actionUrl: string;
  footer: string;
  eyebrow?: string;
  locale?: Language;
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
  if (!process.env.BREVO_API_KEY?.trim()) {
    throw new Error('Branded email delivery is not configured');
  }
  brevoSender();
  appOrigin();
}

/**
 * Firebase generates the one-time action code. We keep that code intact and
 * place it in our own action-handler URL so Firebase Hosting is never the
 * user-facing destination. Never invent or sign an action code ourselves.
 */
export function buildBrandedActionUrl(firebaseActionLink: string, expectedMode: FirebaseEmailActionMode, preferredLanguage?: Language) {
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
  if (preferredLanguage) {
    actionUrl.searchParams.set('lang', preferredLanguage);
  } else if (language && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) {
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
  const locale = content.locale ?? 'en';
  const isArabic = locale === 'ar';
  const direction = isArabic ? 'rtl' : 'ltr';
  const textAlign = isArabic ? 'right' : 'left';
  const headerCellPadding = isArabic ? '0 14px 0 0' : '0 0 0 14px';
  const letterSpacing = isArabic ? '0' : '1.2px';
  const logoAlt = isArabic ? 'علامة شجرة EduLabs' : 'EduLabs tree mark';
  const fallbackHeading = isArabic ? 'الزر لا يعمل؟' : 'BUTTON NOT WORKING?';
  const fallbackIntro = isArabic ? 'انسخ هذا الرابط الآمن والصقه في المتصفح:' : 'Copy and paste this secure link into your browser:';
  const fallbackText = isArabic ? `إذا لم يعمل الزر، انسخ الرابط التالي والصقه في المتصفح: ${actionUrl}` : `If the button does not work, copy this link into your browser: ${actionUrl}`;
  const footerTagline = isArabic ? 'التعلّم، منظّم حول احتياجاتك.' : 'Learning, organized around you.';
  const visitLabel = isArabic ? 'زيارة EduLabs' : 'Visit EduLabs';
  const automatedLabel = isArabic ? 'رسالة آلية خاصة بالحساب' : 'Automated account email';
  const buttonArrow = isArabic ? '&#8592;' : '&#8594;';
  const logoUrl = escapeHtml(origin + '/header-logo-tight.png');
  const preheader = escapeHtml(content.preheader);
  const eyebrow = escapeHtml(content.eyebrow ?? 'ACCOUNT SECURITY');
  const headline = escapeHtml(content.headline);
  const greeting = content.greeting ? `<p dir="auto" style="margin:0 0 16px;color:#1b2819;font-size:16px;line-height:1.85;text-align:${textAlign};">${escapeHtml(content.greeting)}</p>` : '';
  const paragraphs = content.paragraphs.map(value =>
    `<p dir="${direction}" style="margin:0 0 16px;color:#354333;font-size:15px;line-height:1.85;text-align:${textAlign};">${escapeHtml(value)}</p>`).join('');
  const buttonLabel = escapeHtml(content.buttonLabel);
  const footer = escapeHtml(content.footer);
  const html = `<!doctype html>
<html lang="${locale}" dir="${direction}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${headline} · EduLabs</title>
</head>
<body dir="${direction}" style="margin:0;padding:0;background:#e9eee5;color:#142011;font-family:Tahoma,Arial,Helvetica,sans-serif;direction:${direction};text-align:${textAlign};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${preheader} &#847; &zwnj;&nbsp;&#847; &zwnj;&nbsp;&#847;</div>
  <table role="presentation" dir="${direction}" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#e9eee5" style="width:100%;background:#e9eee5;border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:32px 14px 36px;">
        <table role="presentation" dir="${direction}" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;">
          <tr>
            <td style="padding:0 2px 20px;">
              <table role="presentation" dir="${direction}" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;">
                <tr>
                  <td width="48" height="48" align="center" valign="middle" bgcolor="#f8faf5" style="width:48px;height:48px;background:#f8faf5;border:2px solid #111;border-radius:13px;box-shadow:3px 3px 0 #111;">
                    <img src="${logoUrl}" width="34" height="40" alt="${logoAlt}" style="display:block;width:34px;height:40px;border:0;outline:none;text-decoration:none;">
                  </td>
                  <td valign="middle" style="padding:${headerCellPadding};">
                    <div style="font-size:25px;line-height:1.1;font-weight:800;letter-spacing:-0.7px;color:#142011;"><span dir="ltr">EduLabs</span></div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td>
              <table role="presentation" dir="${direction}" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8faf5" style="width:100%;background:#f8faf5;border:2px solid #111;border-radius:22px;box-shadow:5px 5px 0 #111;border-collapse:separate;">
                <tr>
                  <td height="7" bgcolor="#7ed957" style="height:7px;background:#7ed957;border-radius:18px 18px 0 0;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding:30px 30px 28px;">
                    <table role="presentation" dir="${direction}" align="${isArabic ? 'right' : 'left'}" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 17px;border-collapse:separate;">
                      <tr>
                        <td bgcolor="#e4f6d9" style="padding:7px 10px;background:#e4f6d9;border:1.5px solid #111;border-radius:7px;font-size:10px;line-height:1.1;font-weight:800;letter-spacing:${letterSpacing};color:#245b2d;">${eyebrow}</td>
                      </tr>
                    </table>
                    <h1 style="margin:0 0 18px;color:#142011;font-family:Tahoma,Arial,Helvetica,sans-serif;font-size:29px;line-height:1.2;font-weight:800;letter-spacing:-0.7px;">${headline}</h1>
                    ${greeting}
                    ${paragraphs}
                    <table role="presentation" dir="${direction}" align="${isArabic ? 'right' : 'left'}" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 25px;border-collapse:separate;">
                      <tr>
                        <td align="center" bgcolor="#7ed957" style="background:#7ed957;border:2px solid #111;border-radius:12px;box-shadow:3px 3px 0 #111;">
                          <a href="${escapeHtml(actionUrl)}" target="_blank" style="display:inline-block;padding:14px 22px;color:#142011;text-decoration:none;font-size:15px;line-height:1.25;font-weight:800;border-radius:10px;" dir="${direction}">${buttonLabel}&nbsp; ${buttonArrow}</a>
                        </td>
                      </tr>
                    </table>
                    <table role="presentation" dir="${direction}" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef2e9" style="width:100%;background:#eef2e9;border:1px solid #d7dfd0;border-radius:12px;border-collapse:separate;">
                      <tr>
                        <td style="padding:14px 15px;">
                          <p style="margin:0 0 7px;color:#52634b;font-size:11px;line-height:1.4;font-weight:800;letter-spacing:${letterSpacing};">${fallbackHeading}</p>
                          <p style="margin:0 0 7px;color:#52634b;font-size:12px;line-height:1.6;">${fallbackIntro}</p>
                          <p dir="ltr" style="margin:0;overflow-wrap:anywhere;word-break:break-all;font-size:12px;line-height:1.7;text-align:left;"><a href="${escapeHtml(actionUrl)}" dir="ltr" style="color:#245b2d;text-decoration:underline;overflow-wrap:anywhere;word-break:break-all;"><bdi dir="ltr">${escapeHtml(actionUrl)}</bdi></a></p>
                        </td>
                      </tr>
                    </table>
                    <table role="presentation" dir="${direction}" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:23px;border-collapse:collapse;">
                      <tr><td style="border-top:1px solid #d7dfd0;padding-top:17px;">
                        <p dir="${direction}" style="margin:0;color:#52634b;font-size:12px;line-height:1.85;text-align:${textAlign};">${footer}</p>
                      </td></tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:23px 8px 0;color:#52634b;text-align:center;font-size:11px;line-height:1.8;">
              <p style="margin:0 0 5px;font-weight:700;color:#354333;"><span dir="ltr">EduLabs</span> · ${footerTagline}</p>
              <a href="${escapeHtml(origin)}" style="color:#245b2d;text-decoration:underline;">${visitLabel}</a>
              <span style="padding:0 7px;color:#a1ad9b;">·</span>
              <span>${automatedLabel}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  const text = [
    'EduLabs',
    content.headline,
    content.greeting ?? '',
    ...content.paragraphs,
    `${content.buttonLabel}: ${actionUrl}`,
    fallbackText,
    content.footer,
    `EduLabs · ${footerTagline} ${origin}`,
  ].filter(Boolean).join('\n\n');
  return { html, text };
}

function brevoSender() {
  const from = process.env.AUTH_EMAIL_FROM?.trim() ?? '';
  const parsed = /^([^<>\r\n]+?)\s*<([^\s<>@]+@[^\s<>@]+)>$/.exec(from);
  if (!parsed || !parsed[1].trim()) throw new Error('Branded email sender is not configured');
  return { name: parsed[1].trim(), email: parsed[2].toLowerCase() };
}

async function sendEmail(to: string, subject: string, content: BrandedEmailContent) {
  assertBrandedEmailConfigured();
  const { html, text } = renderBrandedEmail(content);
  const sender = brevoSender();
  let response: Response;
  try {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY!.trim(),
        'accept': 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
        tags: ['edulabs-auth'],
      }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Never reveal API keys, recipients, Firebase action codes or provider bodies.
    throw new Error('Branded email provider is unavailable');
  }
  if (!response.ok) {
    throw new Error('Branded email provider rejected the message');
  }
}

export async function sendVerificationEmailForUser(user: { email?: string | null; displayName?: string | null }, locale: Language = 'en') {
  assertBrandedEmailConfigured();
  if (!user.email) throw new Error('Firebase user has no email address');
  const link = await getFirebaseAdminAuth().generateEmailVerificationLink(user.email);
  const actionUrl = buildBrandedActionUrl(link, 'verifyEmail', locale);
  const name = user.displayName?.trim().split(/\s+/)[0];
  const arabic = locale === 'ar';
  await sendEmail(user.email, arabic ? 'تأكيد بريدك الإلكتروني في EduLabs' : 'Verify your EduLabs email address', {
    locale,
    preheader: arabic ? 'خطوة أخيرة لإكمال إعداد حسابك على EduLabs.' : 'One quick step to finish setting up your EduLabs account.',
    eyebrow: arabic ? 'تأكيد البريد الإلكتروني' : 'EMAIL VERIFICATION',
    headline: arabic ? 'خطوة واحدة لتفعيل حسابك' : 'One quick step to activate your account',
    greeting: name ? (arabic ? `مرحبًا ${name}،` : `Hello ${name},`) : (arabic ? 'مرحبًا،' : 'Hello,'),
    paragraphs: arabic ? [
      'شكرًا لانضمامك إلى EduLabs. أكّد عنوان بريدك الإلكتروني لإكمال إعداد حسابك.',
      'إذا لم تنشئ حسابًا على EduLabs، يمكنك تجاهل هذه الرسالة. لن يحدث أي تغيير.',
    ] : [
      'Thanks for joining EduLabs. Confirm your email address to finish setting up your account.',
      'If you did not create an EduLabs account, you can ignore this message. No changes will be made.',
    ],
    buttonLabel: arabic ? 'تأكيد البريد الإلكتروني' : 'Verify my email',
    actionUrl,
    footer: arabic ? 'هذا الرابط آمن ويُستخدم مرة واحدة وتنتهي صلاحيته. حفاظًا على أمانك، لا تُعِد توجيهه ولا تشاركه مع أي شخص.' : 'This secure link is single-use and expires. For your safety, do not forward it or share it with anyone.',
  });
}

export async function sendPasswordResetForAddress(email: string, locale: Language = 'en') {
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
  const actionUrl = buildBrandedActionUrl(link, 'resetPassword', locale);
  const name = user.displayName?.trim().split(/\s+/)[0];
  const arabic = locale === 'ar';
  await sendEmail(email, arabic ? 'إعادة تعيين كلمة مرور EduLabs' : 'Reset your EduLabs password', {
    locale,
    preheader: arabic ? 'اختر كلمة مرور جديدة لحسابك على EduLabs.' : 'Choose a new password for your EduLabs account.',
    eyebrow: arabic ? 'أمان كلمة المرور' : 'PASSWORD SECURITY',
    headline: arabic ? 'اختر كلمة مرور جديدة' : 'Choose a new password',
    greeting: name ? (arabic ? `مرحبًا ${name}،` : `Hello ${name},`) : (arabic ? 'مرحبًا،' : 'Hello,'),
    paragraphs: arabic ? [
      'تلقّينا طلبًا لإعادة تعيين كلمة المرور لحسابك على EduLabs.',
      'إذا كنت أنت من طلب ذلك، فاستخدم الزر أدناه لاختيار كلمة مرور جديدة. أما إذا لم تطلبه، فتجاهل الرسالة؛ ستظل كلمة مرورك الحالية كما هي.',
    ] : [
      'We received a request to reset the password for your EduLabs account.',
      'If you requested this, use the button below to set a new password. If not, ignore this email—your current password will stay unchanged.',
    ],
    buttonLabel: arabic ? 'إعادة تعيين كلمة المرور' : 'Reset password',
    actionUrl,
    footer: arabic ? 'هذا الرابط آمن ويُستخدم مرة واحدة وتنتهي صلاحيته. لن تطلب منك EduLabs إرسال كلمة مرورك أبدًا.' : 'This secure link is single-use and expires. EduLabs will never ask you to send us your password.',
  });
}
