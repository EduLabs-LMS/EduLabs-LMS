const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function service(env = {}, options = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('server/services/branded-auth-email.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, URL, AbortSignal, fetch: options.fetch, process: { env: {
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://staging.edulabs-eg.com',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'diagonproduction',
      BREVO_API_KEY: 'synthetic-key',
      AUTH_EMAIL_FROM: 'EduLabs <no-reply@mail.edulabs-eg.com>',
      ...env,
    } },
    require(name) {
      if (name === 'server-only') return {};
      if (name === '@/server/integrations/firebase-admin') return { getFirebaseAdminAuth: () => options.firebaseAuth ?? {} };
      throw new Error('Unexpected import: ' + name);
    },
  });
  return module.exports;
}

test('branded Firebase action URL accepts only generated same-project HTTPS action links', () => {
  const api = service();
  const result = api.buildBrandedActionUrl(
    'https://diagonproduction.firebaseapp.com/__/auth/action?apiKey=public&mode=verifyEmail&oobCode=synthetic-one-time-code',
    'verifyEmail',
  );
  const parsed = new URL(result);
  assert.equal(parsed.origin, 'https://staging.edulabs-eg.com');
  assert.equal(parsed.pathname, '/auth/action');
  assert.equal(parsed.searchParams.get('mode'), 'verifyEmail');
  assert.equal(parsed.searchParams.get('oobCode'), 'synthetic-one-time-code');
  const arabic = new URL(api.buildBrandedActionUrl(
    'https://diagonproduction.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=synthetic-one-time-code',
    'verifyEmail',
    'ar',
  ));
  assert.equal(arabic.searchParams.get('lang'), 'ar');
  for (const bad of [
    'https://evil.example/__/auth/action?mode=verifyEmail&oobCode=x',
    'http://diagonproduction.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=x',
    'https://diagonproduction.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=x',
    'https://diagonproduction.firebaseapp.com/__/auth/action?mode=verifyEmail',
    'https://diagonproduction.firebaseapp.com/other?mode=verifyEmail&oobCode=x',
  ]) assert.throws(() => api.buildBrandedActionUrl(bad, 'verifyEmail'));
});

test('branded HTML and text escape untrusted content and use only the configured origin', () => {
  const api = service();
  const rendered = api.renderBrandedEmail({
    preheader: 'Hello <script>',
    headline: 'Verify <your> email',
    greeting: "Hi O'Reilly & Co",
    paragraphs: ['Do not trust <img src=x>'],
    buttonLabel: 'Verify & continue',
    actionUrl: 'https://staging.edulabs-eg.com/auth/action?mode=verifyEmail&oobCode=opaque',
    footer: 'Ignore this if it was not you.',
  });
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.match(rendered.html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /Verify &amp; continue/);
  assert.match(rendered.text, /https:\/\/staging\.edulabs-eg\.com\/auth\/action/);
  assert.throws(() => api.renderBrandedEmail({
    preheader: 'x', headline: 'x', paragraphs: [], buttonLabel: 'x',
    actionUrl: 'https://evil.example/auth/action?x=1', footer: 'x',
  }));
});

test('branded delivery fails closed without configured provider credentials', () => {
  assert.throws(() => service({ BREVO_API_KEY: '', AUTH_EMAIL_FROM: '' }).assertBrandedEmailConfigured());
});


test('Brevo sends branded HTML and text without exposing the API key to the message', async () => {
  const calls = [];
  const firebaseAuth = {
    generateEmailVerificationLink: async () =>
      'https://diagonproduction.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=synthetic-code',
  };
  const api = service({}, {
    firebaseAuth,
    fetch: async (url, request) => {
      calls.push({ url, request });
      return { ok: true, status: 201 };
    },
  });
  await api.sendVerificationEmailForUser({ email: 'student@example.com', displayName: 'Student Example' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(calls[0].request.method, 'POST');
  assert.equal(calls[0].request.headers['api-key'], 'synthetic-key');
  const body = JSON.parse(calls[0].request.body);
  assert.deepEqual(JSON.parse(JSON.stringify(body.sender)), { name: 'EduLabs', email: 'no-reply@mail.edulabs-eg.com' });
  assert.equal(body.to.length, 1);
  assert.equal(body.to[0].email, 'student@example.com');
  assert.match(body.htmlContent, /staging\.edulabs-eg\.com\/auth\/action/);
  assert.match(body.textContent, /staging\.edulabs-eg\.com\/auth\/action/);
  assert.match(body.htmlContent, /src="https:\/\/staging\.edulabs-eg\.com\/header-logo-tight\.png"/);
  assert.match(body.htmlContent, /alt="EduLabs tree mark"/);
  assert.match(body.htmlContent, /EMAIL VERIFICATION/);
  assert.match(body.htmlContent, /One quick step to activate your account/);
  assert.match(body.htmlContent, /Verify my email/);
  assert.match(body.htmlContent, /Button not working\?/);
  assert.match(body.htmlContent, /<html lang="en" dir="ltr">/);
  assert.match(body.htmlContent, /text-align:left/);
  assert.doesNotMatch(body.htmlContent, /box-shadow/);
  assert.doesNotMatch(body.htmlContent, /Firebase/);
  assert.doesNotMatch(calls[0].request.body, /synthetic-key/);
});

test('Brevo errors fail closed and do not disclose provider responses', async () => {
  const firebaseAuth = {
    generateEmailVerificationLink: async () =>
      'https://diagonproduction.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=synthetic-code',
  };
  const badHttp = service({}, { firebaseAuth, fetch: async () => ({ ok: false, status: 429, body: 'private Brevo detail' }) });
  await assert.rejects(badHttp.sendVerificationEmailForUser({ email: 'test@example.com' }),
    error => /Branded email provider rejected/.test(error.message) && !/private Brevo detail/.test(error.message));
  const networkError = service({}, { firebaseAuth, fetch: async () => { throw new Error('network failure with private details'); } });
  await assert.rejects(networkError.sendVerificationEmailForUser({ email: 'test@example.com' }),
    error => /Branded email provider is unavailable/.test(error.message) && !/private details/.test(error.message));
  assert.throws(() => service({ AUTH_EMAIL_FROM: 'Evil\r\nBcc: bad@example.com' }).assertBrandedEmailConfigured());
});


test('password-reset email uses the matching security variant and real EduLabs branding', async () => {
  const calls = [];
  const firebaseAuth = {
    getUserByEmail: async email => ({
      email,
      displayName: 'Student Example',
      disabled: false,
      providerData: [{ providerId: 'password' }],
    }),
    generatePasswordResetLink: async () =>
      'https://diagonproduction.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=synthetic-reset-code',
  };
  const api = service({}, {
    firebaseAuth,
    fetch: async (url, request) => {
      calls.push({ url, request });
      return { ok: true, status: 201 };
    },
  });
  await api.sendPasswordResetForAddress('student@example.com');
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].request.body);
  assert.equal(body.subject, 'Reset your EduLabs password');
  assert.match(body.htmlContent, /PASSWORD SECURITY/);
  assert.match(body.htmlContent, /Choose a new password/);
  assert.match(body.htmlContent, /Reset password/);
  assert.match(body.htmlContent, /header-logo-tight\.png/);
  assert.match(body.htmlContent, /This secure link is single-use and expires/);
  assert.match(body.textContent, /If the button does not work, copy this link/);
});


test('Arabic verification and password-reset emails use natural Arabic copy, RTL layout and Arabic action links', async () => {
  const calls = [];
  const firebaseAuth = {
    generateEmailVerificationLink: async () =>
      'https://diagonproduction.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=synthetic-ar-verification',
    getUserByEmail: async email => ({
      email,
      displayName: 'محمد Example',
      disabled: false,
      providerData: [{ providerId: 'password' }],
    }),
    generatePasswordResetLink: async () =>
      'https://diagonproduction.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=synthetic-ar-reset',
  };
  const api = service({}, {
    firebaseAuth,
    fetch: async (url, request) => {
      calls.push({ url, request });
      return { ok: true, status: 201 };
    },
  });

  await api.sendVerificationEmailForUser({ email: 'student@example.com', displayName: 'محمد Example' }, 'ar');
  await api.sendPasswordResetForAddress('student@example.com', 'ar');

  assert.equal(calls.length, 2);
  const verification = JSON.parse(calls[0].request.body);
  assert.equal(verification.subject, 'تأكيد بريدك الإلكتروني في EduLabs');
  assert.match(verification.htmlContent, /<html lang="ar" dir="rtl">/);
  assert.match(verification.htmlContent, /<body dir="rtl"/);
  assert.match(verification.htmlContent, /تأكيد البريد الإلكتروني/);
  assert.match(verification.htmlContent, /خطوة واحدة لتفعيل حسابك/);
  assert.match(verification.htmlContent, /<a[^>]*>تأكيد البريد الإلكتروني<\/a>/);
  assert.match(verification.htmlContent, /الزر لا يعمل؟/);
  assert.match(verification.htmlContent, /dir="ltr".*header-logo-tight\.png|header-logo-tight\.png/);
  assert.match(verification.htmlContent, /text-align:right/);
  assert.match(verification.htmlContent, /<table role="presentation" dir="rtl" align="right"/);
  assert.doesNotMatch(verification.htmlContent, /box-shadow/);
  assert.match(verification.htmlContent, /lang=ar/);
  assert.match(verification.textContent, /إذا لم يعمل الزر/);
  assert.doesNotMatch(verification.htmlContent, /BUTTON NOT WORKING\?/);

  const reset = JSON.parse(calls[1].request.body);
  assert.equal(reset.subject, 'إعادة تعيين كلمة مرور EduLabs');
  assert.match(reset.htmlContent, /<html lang="ar" dir="rtl">/);
  assert.match(reset.htmlContent, /اختر كلمة مرور جديدة/);
  assert.match(reset.htmlContent, /إعادة تعيين كلمة المرور/);
  assert.match(reset.htmlContent, /ستظل كلمة مرورك الحالية كما هي/);
  assert.match(reset.htmlContent, /lang=ar/);
  assert.match(reset.textContent, /إذا لم يعمل الزر/);
});


test('secure auth action page follows the email language and preserves bidirectional fields', () => {
  const page = fs.readFileSync('frontend/features/auth/branded-auth-action.tsx', 'utf8');
  const pageShell = fs.readFileSync('app/auth/action/page.tsx', 'utf8');
  const handler = fs.readFileSync('server/http/branded-auth-email.ts', 'utf8');
  assert.match(page, /current\.searchParams\.get\('lang'\)/);
  assert.match(page, /document\.documentElement\.dir = selectedLocale === 'ar' \? 'rtl' : 'ltr'/);
  assert.match(page, /lang=\{locale\} dir=\{direction\}/);
  assert.match(page, /تأكيد بريدك الإلكتروني/);
  assert.match(page, /dir="ltr"/);
  assert.match(pageShell, /generateMetadata/);
  assert.match(pageShell, /initialLocale=\{locale\}/);
  assert.match(pageShell, /lang=\{locale\} dir=\{direction\}/);
  assert.match(handler, /request\.cookies\.get\(languageCookieKey\)/);
  assert.match(handler, /sendVerificationEmailForUser\(user, requestedLanguage\(request\)\)/);
  assert.match(handler, /sendPasswordResetForAddress\(body\.email\.trim\(\), requestedLanguage\(request\)\)/);
});


test('teacher invitation email uses a same-origin one-time EduLabs invitation link and its own delivery tag', async () => {
  const calls = [];
  const api = service({}, { fetch: async (url, request) => { calls.push({ url, request }); return { ok: true, status: 201 }; } });
  const token = 'A'.repeat(43);
  assert.equal(api.buildTeacherInvitationUrl(token), 'https://staging.edulabs-eg.com/teacher-invitation/' + token);
  await api.sendTeacherInvitationEmail('teacher@example.com', token, 'en');
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].request.body);
  assert.equal(body.subject, 'Your invitation to teach with EduLabs');
  assert.deepEqual(JSON.parse(JSON.stringify(body.tags)), ['edulabs-teacher-invitation']);
  assert.equal(body.to[0].email, 'teacher@example.com');
  assert.match(body.htmlContent, /TEACHER INVITATION/);
  assert.match(body.htmlContent, /Accept invitation/);
  assert.match(body.htmlContent, new RegExp('/teacher-invitation/' + token));
  assert.match(body.textContent, new RegExp('/teacher-invitation/' + token));
  assert.throws(() => api.buildTeacherInvitationUrl('short'));
});

test('Arabic teacher invitation email is RTL and localized', async () => {
  const calls = [];
  const api = service({}, { fetch: async (url, request) => { calls.push({ url, request }); return { ok: true, status: 201 }; } });
  const token = 'B'.repeat(43);
  await api.sendTeacherInvitationEmail('teacher@example.com', token, 'ar');
  const body = JSON.parse(calls[0].request.body);
  assert.equal(body.subject, 'دعوة للانضمام إلى EduLabs');
  assert.match(body.htmlContent, /<html lang="ar" dir="rtl">/);
  assert.match(body.htmlContent, /قبول الدعوة/);
  assert.match(body.textContent, new RegExp('/teacher-invitation/' + token));
});
