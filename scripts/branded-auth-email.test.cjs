const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function service(env = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('server/services/branded-auth-email.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, URL, process: { env: {
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://staging.edulabs-eg.com',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'diagonproduction',
      RESEND_API_KEY: 'synthetic-key',
      AUTH_EMAIL_FROM: 'EduLabs <no-reply@mail.edulabs-eg.com>',
      ...env,
    } },
    require(name) {
      if (name === 'server-only') return {};
      if (name === 'resend') return { Resend: class { constructor() {} } };
      if (name === '@/server/integrations/firebase-admin') return { getFirebaseAdminAuth: () => ({}) };
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
  assert.throws(() => service({ RESEND_API_KEY: '', AUTH_EMAIL_FROM: '' }).assertBrandedEmailConfigured());
});
