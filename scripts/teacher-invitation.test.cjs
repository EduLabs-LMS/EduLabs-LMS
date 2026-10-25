const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

function load(file, deps = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => name in deps ? deps[name] : (() => { throw Error('Unexpected import ' + name); })() });
  return module.exports;
}

test('teacher invitation destination accepts only a single exact 43-character token', () => {
  const { safeFirebaseAuthDestination } = load('shared/contracts/auth-destination.ts');
  const token = 'A'.repeat(43);
  assert.equal(safeFirebaseAuthDestination('/teacher-invitation/' + token), '/teacher-invitation/' + token);
  for (const value of [
    '/teacher-invitation/short',
    '/teacher-invitation/' + 'A'.repeat(44),
    '/teacher-invitation/' + token + '?next=/platform-admin',
    '//evil.example/teacher-invitation/' + token,
    'https://evil.example/teacher-invitation/' + token,
  ]) assert.equal(safeFirebaseAuthDestination(value), '/home');
});

test('teacher invitation page is staging-only, private, no-referrer and returns through existing sign-in', () => {
  const source = fs.readFileSync('app/teacher-invitation/[token]/page.tsx', 'utf8');
  assert.ok(source.includes('const tokenPattern = /^[A-Za-z0-9_-]{43}$/;'));
  assert.match(source, /isFirebaseStaging\(\)/);
  assert.match(source, /index: false, follow: false/);
  assert.match(source, /referrer: 'no-referrer'/);
  assert.match(source, /getApplicationViewer\(\)/);
  assert.match(source, /\/sign-in\?next=/);
  assert.match(source, /TeacherInvitationAcceptance/);
});

test('acceptance UI posts only the invitation token and handles email mismatch, use and expiry', () => {
  const source = fs.readFileSync('frontend/features/teacher-invitation/acceptance-view.tsx', 'utf8');
  assert.match(source, /\/api\/teacher-invitations\/accept/);
  assert.match(source, /body: JSON\.stringify\(\{ token \}\)/);
  assert.match(source, /response\.status === 403 \? 'ti\.error\.email'/);
  assert.match(source, /response\.status === 409 \? 'ti\.error\.used'/);
  assert.match(source, /response\.status === 410 \? 'ti\.error\.gone'/);
  assert.doesNotMatch(source, /console\.(log|error|warn)/);
});

test('middleware allowlist is exact and protects invitation URLs from referrer leakage and indexing', () => {
  const source = fs.readFileSync('middleware.ts', 'utf8');
  assert.ok(source.includes('/(?:join|teacher-invitation)/[A-Za-z0-9_-]{43}'));
  assert.ok(source.includes("Referrer-Policy','no-referrer'"));
  assert.ok(source.includes("X-Robots-Tag','noindex, nofollow'"));
});
