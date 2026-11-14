import 'server-only';
import type { ResetLanguage } from '@/shared/password-reset';

/**
 * The password-reset email: an EduLabs-designed HTML part and a plain-text part, in English, Arabic (right to left) or both (when the person never
 * chose a language in their browser). Table layout with inline styles, so Gmail and Outlook on a phone and on a desktop draw it the same; a
 * dark-mode block is added for the clients that read it (Apple Mail, Outlook apps, Gmail on some accounts) and the light version stands without it.
 * The only variable parts are the link (built by the server from APP_ORIGIN and a Firebase code) and the language. Nothing else is interpolated.
 */

export const brandGreen = '#7ED957';
/** The one public, cacheable path the logo is served from (a 2x PNG: 80x94 shown at 40x47). Nothing else lives under /email-assets. */
export const emailLogoPath = '/email-assets/edulabs-logo.png';
const ink = '#14301A';

type Copy = {
 lang: ResetLanguage; dir: 'ltr' | 'rtl'; subject: string; preheader: string; heading: string; intro: string; button: string; fallback: string;
 introText: string; expires: string; ignore: string; reason: string; signature: string; logoAlt: string;
};
const copy: Record<ResetLanguage, Copy> = {
 en: {
  lang: 'en', dir: 'ltr', subject: 'Reset your EduLabs password',
  preheader: 'Choose a new password. This link expires in 1 hour.',
  heading: 'Reset your password',
  intro: 'Someone asked to reset the password for your EduLabs account. Choose a new one with the button below.',
  introText: 'Someone asked to reset the password for your EduLabs account. Open this link to choose a new one:',
  button: 'Choose a new password',
  fallback: 'Or copy this link into your browser:',
  expires: 'This link expires in 1 hour.',
  ignore: "If you didn't ask, ignore this email. Your password won't change.",
  reason: 'You are getting this because a password reset was requested for your email address.',
  signature: 'The EduLabs team', logoAlt: 'EduLabs',
 },
 ar: {
  lang: 'ar', dir: 'rtl', subject: 'إعادة تعيين كلمة مرور EduLabs',
  preheader: 'اختر كلمة مرور جديدة. ينتهي هذا الرابط خلال ساعة واحدة.',
  heading: 'إعادة تعيين كلمة المرور',
  intro: 'طلب أحدهم إعادة تعيين كلمة المرور لحسابك على EduLabs. اختر كلمة مرور جديدة بالزر أدناه.',
  introText: 'طلب أحدهم إعادة تعيين كلمة المرور لحسابك على EduLabs. افتح هذا الرابط لاختيار كلمة مرور جديدة:',
  button: 'اختيار كلمة مرور جديدة',
  fallback: 'أو انسخ هذا الرابط إلى متصفحك:',
  expires: 'ينتهي هذا الرابط خلال ساعة واحدة.',
  ignore: 'إذا لم تطلب ذلك، تجاهل هذه الرسالة. لن تتغير كلمة مرورك.',
  reason: 'وصلتك هذه الرسالة لأنه طُلب إعادة تعيين كلمة المرور لبريدك الإلكتروني.',
  signature: 'فريق EduLabs', logoAlt: 'EduLabs',
 },
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const latinFont = "Arial,Helvetica,'Segoe UI',sans-serif";
const arabicFont = "Tahoma,'Segoe UI',Arial,sans-serif";

/** One language's block: heading, text, button, the link as text, the expiry and the ignore line. */
function block(c: Copy, link: string, first: boolean) {
 const font = c.lang === 'ar' ? arabicFont : latinFont, align = c.dir === 'rtl' ? 'right' : 'left';
 const href = escapeHtml(link);
 return `<tr><td class="body" dir="${c.dir}" lang="${c.lang}" align="${align}" style="padding:${first ? '32px' : '8px'} 32px 8px 32px;font-family:${font};text-align:${align};">
<div lang="${c.lang}" dir="${c.dir}">
<h1 class="ink" style="margin:0 0 12px 0;font-family:${font};font-size:24px;line-height:32px;font-weight:700;color:${ink};">${escapeHtml(c.heading)}</h1>
<p class="text" style="margin:0 0 24px 0;font-family:${font};font-size:16px;line-height:26px;color:#2B4630;">${escapeHtml(c.intro)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px 0;"><tr><td align="center" bgcolor="${brandGreen}" class="button" style="border-radius:12px;background-color:${brandGreen};">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="23%" stroke="f" fillcolor="${brandGreen}"><w:anchorlock/><center style="color:${ink};font-family:${font};font-size:16px;font-weight:bold;">${escapeHtml(c.button)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${href}" target="_blank" class="button-link" style="display:inline-block;padding:15px 28px;font-family:${font};font-size:16px;line-height:22px;font-weight:700;color:${ink};text-decoration:none;border-radius:12px;">${escapeHtml(c.button)}</a><!--<![endif]-->
</td></tr></table>
<p class="muted" style="margin:0 0 4px 0;font-family:${font};font-size:13px;line-height:20px;color:#4B6150;">${escapeHtml(c.fallback)}</p>
<p style="margin:0 0 24px 0;font-family:${latinFont};font-size:13px;line-height:20px;word-break:break-all;overflow-wrap:anywhere;direction:ltr;text-align:left;"><a href="${href}" target="_blank" class="link" style="color:#1F6B2E;text-decoration:underline;">${href}</a></p>
<p class="ink" style="margin:0 0 8px 0;font-family:${font};font-size:15px;line-height:24px;font-weight:700;color:${ink};">${escapeHtml(c.expires)}</p>
<p class="text" style="margin:0 0 8px 0;font-family:${font};font-size:15px;line-height:24px;color:#2B4630;">${escapeHtml(c.ignore)}</p>
</div>
</td></tr>`;
}

const textRule = '----------------------------------------';

/** The page: logo band, one block per language, the reason line and the signature. Shared by every email here. */
function frame({ origin, langs, subject, rows, reasons }: { origin: string; langs: Copy[]; subject: string; rows: string[]; reasons: string[] }) {
 const head = langs[0];
 const logo = origin + emailLogoPath;
 const divider = `<tr><td style="padding:16px 32px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td class="rule" height="1" style="height:1px;line-height:1px;font-size:1px;background-color:#DDE8D8;">&nbsp;</td></tr></table></td></tr>`;
 const blocks = rows.join('\n' + divider + '\n');
 const footer = langs.map((c, i) => `<p dir="${c.dir}" lang="${c.lang}" style="margin:0 0 4px 0;font-family:${c.lang === 'ar' ? arabicFont : latinFont};font-size:12px;line-height:18px;color:#5C7160;text-align:${c.dir === 'rtl' ? 'right' : 'left'};" class="muted">${escapeHtml(reasons[i])}</p>`).join('\n');
 const html = `<!DOCTYPE html>
<html lang="${head.lang}" dir="${head.dir}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none;}
@media only screen and (max-width:620px){.card{width:100%!important;border-radius:0!important;}.body{padding-left:20px!important;padding-right:20px!important;}.button-link{display:block!important;}.button{width:100%!important;}}
@media (prefers-color-scheme:dark){.page{background-color:#0E1A11!important;}.card{background-color:#17261B!important;}.ink{color:#F1F7EE!important;}.text{color:#D3E2CF!important;}.muted{color:#A4B8A0!important;}.link{color:#9BE07A!important;}.rule{background-color:#2C4132!important;}}
</style>
</head>
<body class="page" style="margin:0;padding:0;background-color:#F2F7EF;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all;">${escapeHtml(head.preheader)}${'&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" class="page" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#F2F7EF" style="background-color:#F2F7EF;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="card" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#FFFFFF" style="width:600px;max-width:600px;background-color:#FFFFFF;border-radius:16px;overflow:hidden;">
<tr><td bgcolor="${ink}" dir="ltr" align="left" style="background-color:${ink};padding:20px 32px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
<td valign="middle" style="padding-right:12px;"><img src="${escapeHtml(logo)}" width="40" height="47" alt="${escapeHtml(head.logoAlt)}" style="display:block;width:40px;height:47px;"></td>
<td valign="middle" style="font-family:${latinFont};font-size:22px;line-height:28px;font-weight:700;color:#FFFFFF;letter-spacing:0.2px;">EduLabs</td>
</tr></table>
</td></tr>
${blocks}
<tr><td style="padding:16px 32px 28px 32px;">
${footer}
<p style="margin:12px 0 0 0;font-family:${latinFont};font-size:12px;line-height:18px;color:#5C7160;" class="muted">${langs.map((c) => escapeHtml(c.signature)).join(' · ')}</p>
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
 return html;
}

/** The email for `link` (an EduLabs address). `language` undefined means both languages, English first. */
export function passwordResetEmailContent({ link, language }: { link: string; language?: ResetLanguage }) {
 const origin = new URL(link).origin;
 const langs: Copy[] = language ? [copy[language]] : [copy.en, copy.ar];
 const subject = language ? copy[language].subject : `${copy.en.subject} · ${copy.ar.subject}`;
 const html = frame({ origin, langs, subject, rows: langs.map((c, k) => block(c, link, k === 0)), reasons: langs.map((c) => c.reason) });
 const text = langs.map((c) => [
  c.heading, '', c.introText, '', link, '', c.expires, c.ignore, '', '— ' + c.signature,
 ].join('\n')).join('\n\n' + textRule + '\n\n') + '\n';
 return { subject, html, text };
}

type GoogleCopy = { lang: ResetLanguage; dir: 'ltr' | 'rtl'; subject: string; preheader: string; heading: string; intro: string; button: string; ignore: string; reason: string; signature: string; logoAlt: string };
const googleCopy: Record<ResetLanguage, GoogleCopy> = {
 en: {
  lang: 'en', dir: 'ltr', subject: 'Sign in to EduLabs with Google', preheader: 'There is no password to reset. Use Continue with Google.',
  heading: 'You sign in with Google',
  intro: "You sign in to EduLabs with Google. Use \"Continue with Google\" on the sign-in page; there's no password to reset.",
  button: 'Go to sign in', ignore: "If you didn't ask, ignore this email. Nothing has changed.",
  reason: 'You are getting this because a password reset was requested for your email address.', signature: 'The EduLabs team', logoAlt: 'EduLabs',
 },
 ar: {
  lang: 'ar', dir: 'rtl', subject: 'سجّل الدخول إلى EduLabs عبر Google', preheader: 'لا توجد كلمة مرور لإعادة تعيينها. استخدم المتابعة عبر Google.',
  heading: 'تسجّل الدخول عبر Google',
  intro: 'تسجّل الدخول إلى EduLabs عبر Google. استخدم «Continue with Google» في صفحة تسجيل الدخول؛ لا توجد كلمة مرور لإعادة تعيينها.',
  button: 'الانتقال إلى تسجيل الدخول', ignore: 'إذا لم تطلب ذلك، تجاهل هذه الرسالة. لم يتغير شيء.',
  reason: 'وصلتك هذه الرسالة لأنه طُلب إعادة تعيين كلمة المرور لبريدك الإلكتروني.', signature: 'فريق EduLabs', logoAlt: 'EduLabs',
 },
};

/** One language's block of the Google-account email: a heading, the explanation and a button to the sign-in page. No link carries a secret. */
function googleBlock(c: GoogleCopy, signInUrl: string, first: boolean) {
 const font = c.lang === 'ar' ? arabicFont : latinFont, align = c.dir === 'rtl' ? 'right' : 'left', href = escapeHtml(signInUrl);
 return `<tr><td class="body" dir="${c.dir}" lang="${c.lang}" align="${align}" style="padding:${first ? '32px' : '8px'} 32px 8px 32px;font-family:${font};text-align:${align};">
<div lang="${c.lang}" dir="${c.dir}">
<h1 class="ink" style="margin:0 0 12px 0;font-family:${font};font-size:24px;line-height:32px;font-weight:700;color:${ink};">${escapeHtml(c.heading)}</h1>
<p class="text" style="margin:0 0 24px 0;font-family:${font};font-size:16px;line-height:26px;color:#2B4630;">${escapeHtml(c.intro)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px 0;"><tr><td align="center" bgcolor="${brandGreen}" class="button" style="border-radius:12px;background-color:${brandGreen};">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="23%" stroke="f" fillcolor="${brandGreen}"><w:anchorlock/><center style="color:${ink};font-family:${font};font-size:16px;font-weight:bold;">${escapeHtml(c.button)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${href}" target="_blank" class="button-link" style="display:inline-block;padding:15px 28px;font-family:${font};font-size:16px;line-height:22px;font-weight:700;color:${ink};text-decoration:none;border-radius:12px;">${escapeHtml(c.button)}</a><!--<![endif]-->
</td></tr></table>
<p class="text" style="margin:0 0 8px 0;font-family:${font};font-size:15px;line-height:24px;color:#2B4630;">${escapeHtml(c.ignore)}</p>
</div>
</td></tr>`;
}

/** For an account that signs in with Google only: no reset link exists, so the email says so and points at the sign-in page. */
export function googleAccountEmailContent({ origin, language }: { origin: string; language?: ResetLanguage }) {
 const signInUrl = origin + '/sign-in';
 const langs = language ? [googleCopy[language]] : [googleCopy.en, googleCopy.ar];
 const subject = language ? googleCopy[language].subject : `${googleCopy.en.subject} · ${googleCopy.ar.subject}`;
 // frame() reads only lang, dir, preheader, logoAlt and signature, which both copies have.
 const html = frame({ origin, langs: langs as unknown as Copy[], subject, rows: langs.map((c, k) => googleBlock(c, signInUrl, k === 0)), reasons: langs.map((c) => c.reason) });
 const text = langs.map((c) => [c.heading, '', c.intro, '', signInUrl, '', c.ignore, '', '— ' + c.signature].join('\n')).join('\n\n' + textRule + '\n\n') + '\n';
 return { subject, html, text };
}
