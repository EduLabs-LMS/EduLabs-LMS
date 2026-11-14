// EduLabs' own password reset: the shared rules, the limiter, the request route (same reply for every address, limits, bad bodies, nothing sensitive in
// logs), the Brevo mailer, the email (HTML and text snapshots in English, Arabic and both), the page states and the middleware.
// Fictional addresses and codes only; no Firebase, Brevo or network.
// UPDATE_SNAPSHOTS=1 rewrites scripts/snapshots/password-reset-email/ (read the diff before committing it).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm'), ts = require('typescript');
const localization = require('./localization-test-loader.cjs');

const logs = [];
const capture = (...args) => { logs.push(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); };
const sandboxConsole = { log: capture, info: capture, warn: capture, error: capture, debug: capture };
function load(file, deps = {}) {
 const m = { exports: {} };
 const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
 vm.runInNewContext(code, { module: m, exports: m.exports, URL, URLSearchParams, Buffer, Promise, JSON, Date, Math, Set, Map, Number, String, Array, Object, Error, RegExp, Uint8Array, console: sandboxConsole, setTimeout, clearTimeout, process: { env: {} }, AbortSignal, fetch: (...a) => global.fetch(...a),
  require: (n) => n === 'zod' || n.startsWith('node:') ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n + ' in ' + file); })() });
 return m.exports;
}
const read = (f) => fs.readFileSync(f, 'utf8');
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');

const shared = load('shared/password-reset.ts');
const publicWebsite = load('shared/public-website.ts', { zod: require('zod') });
const delivery = load('server/services/invitation-delivery.ts', { 'server-only': {}, '@/shared/public-website': publicWebsite });
const emailModule = load('server/services/password-reset-email.ts', { 'server-only': {} });
const service = load('server/services/password-reset.ts', { 'server-only': {}, '@/shared/password-reset': shared, '@/server/services/password-reset-email': emailModule, '@/server/services/invitation-delivery': delivery });
const limiterModule = load('server/services/password-reset-limiter.ts', { 'server-only': {} });

const origin = 'https://app.example.test';
const CODE = 'AbCdEfGh1234_-xyzSECRETCODE';
const exampleLink = origin + '/reset-password?oobCode=EXAMPLE_CODE_0123456789';

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The shared rules
// ---------------------------------------------------------------------------------------------------------------------------------------------

test('request body: one email and an optional language, nothing else; the email is trimmed and lower-cased', () => {
 const ok = shared.passwordResetRequestBody.safeParse({ email: '  Student@Example.TEST ', language: 'ar' });
 assert.ok(ok.success); assert.deepEqual({ ...ok.data }, { email: 'student@example.test', language: 'ar' });
 assert.ok(shared.passwordResetRequestBody.safeParse({ email: 'a@b.co' }).success);
 for (const bad of [{}, { email: '' }, { email: 'nope' }, { email: 'a@b' }, { email: 'a b@example.test' }, { email: 'a@@example.test' }, { email: 'a@example.test, b@example.test' }, { email: '<a@example.test>' },
  { email: 'a@example.test', language: 'fr' }, { email: 'a@example.test', extra: 1 }, { email: 5 }, { email: 'a@example.test', language: null }, { email: 'x'.repeat(250) + '@example.test' }, [], null, 'a@example.test'])
  assert.equal(shared.passwordResetRequestBody.safeParse(bad).success, false, JSON.stringify(bad));
});
test('codes: the code is taken from the Firebase link and the link points at EduLabs, never at Firebase', () => {
 const firebaseLink = 'https://project.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=' + CODE + '&apiKey=PUBLICKEY&continueUrl=' + encodeURIComponent(origin + '/sign-in') + '&lang=en';
 assert.equal(shared.resetCodeFromFirebaseLink(firebaseLink), CODE);
 for (const bad of ['', 'not a url', 'http://x.test/?oobCode=' + CODE, 'https://x.test/?oobCode=', 'https://x.test/?oobCode=short', 'https://x.test/?oobCode=' + 'a'.repeat(600), 'https://x.test/?oobCode=a b c d e f g h', 'https://x.test/'])
  assert.equal(shared.resetCodeFromFirebaseLink(bad), null, bad);
 const link = shared.buildResetLink(origin + '/', CODE);
 assert.equal(link, origin + '/reset-password?oobCode=' + CODE);
 assert.doesNotMatch(link, /firebase|apiKey|continueUrl/i);
 assert.throws(() => shared.buildResetLink(origin, 'bad code'));
 assert.equal(shared.resetCodeFromSearch('?oobCode=' + CODE + '&mode=resetPassword'), CODE);
 assert.equal(shared.resetCodeFromSearch(''), null); assert.equal(shared.resetCodeFromSearch('?oobCode=x'), null);
});
test('password: the app rule is 12 characters typed twice; the strength is a hint that never refuses', () => {
 assert.equal(shared.passwordMinLength, 12);
 assert.equal(shared.passwordProblem('short', 'short'), 'too_short');
 assert.equal(shared.passwordProblem('a'.repeat(11), 'a'.repeat(11)), 'too_short');
 assert.equal(shared.passwordProblem('a'.repeat(12), 'a'.repeat(12)), null);
 assert.equal(shared.passwordProblem('a'.repeat(12), 'a'.repeat(11)), 'mismatch');
 assert.equal(shared.passwordProblem('a'.repeat(12), ''), 'mismatch');
 assert.equal(shared.passwordProblem('a'.repeat(5000), 'a'.repeat(5000)), 'too_long');
 assert.equal(shared.passwordStrength(''), 0); assert.equal(shared.passwordStrength('a1B!'), 0);
 assert.equal(shared.passwordStrength('aaaaaaaaaaaa'), 1, 'one repeated character');
 assert.equal(shared.passwordStrength('abcdefghijkl'), 1, 'one plain run');
 assert.equal(shared.passwordStrength('123456789012'), 1);
 assert.equal(shared.passwordStrength('kdhfjrutyeoq'), 2, 'twelve letters, one class');
 assert.equal(shared.passwordStrength('kdhfjrutyeoqpwmz'), 3, 'sixteen letters');
 assert.equal(shared.passwordStrength('Kdhfjr7tyeo!'), 3, 'twelve with three classes');
 assert.equal(shared.passwordStrength('Kdhfjr7tyeo!pwmzx'), 4);
 for (const p of ['', 'x', 'aaaaaaaaaaaa', 'Correct horse battery staple 7!']) assert.ok([0, 1, 2, 3, 4].includes(shared.passwordStrength(p)));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The page's states
// ---------------------------------------------------------------------------------------------------------------------------------------------

test('page states: Firebase errors become exactly one state each, and an unknown error is never success', () => {
 const f = shared.resetFailure;
 assert.equal(f('auth/expired-action-code'), 'expired'); assert.equal(f('auth/invalid-action-code'), 'invalid'); assert.equal(f('auth/user-disabled'), 'disabled');
 assert.equal(f('auth/network-request-failed'), 'network'); assert.equal(f('auth/too-many-requests'), 'network'); assert.equal(f('auth/weak-password'), 'weak');
 for (const other of [undefined, '', 'auth/user-not-found', 'something/else']) assert.equal(f(other), 'invalid');
});
test('page states: the reducer walks checking, ready, saving, done and every dead end', () => {
 const r = shared.resetReducer, start = shared.initialResetState(true);
 assert.equal(start.status, 'checking'); assert.equal(shared.initialResetState(false).status, 'invalid');
 const ready = r(start, { type: 'checked', email: 'a@example.test' });
 assert.deepEqual({ ...ready }, { status: 'ready', email: 'a@example.test', notice: null });
 const saving = r(ready, { type: 'submit' }); assert.equal(saving.status, 'saving');
 assert.equal(r(saving, { type: 'saved' }).status, 'done');
 assert.equal(r(saving, { type: 'save_failed', code: 'auth/expired-action-code' }).status, 'expired');
 assert.equal(r(saving, { type: 'save_failed', code: 'auth/invalid-action-code' }).status, 'invalid', 'a code used in another tab');
 assert.equal(r(saving, { type: 'save_failed', code: 'auth/user-disabled' }).status, 'disabled');
 for (const code of ['auth/weak-password', 'auth/network-request-failed']) { const back = r(saving, { type: 'save_failed', code }); assert.equal(back.status, 'ready'); assert.equal(back.email, 'a@example.test'); assert.equal(back.notice, code === 'auth/weak-password' ? 'weak' : 'network'); }
 for (const [code, status] of [['auth/expired-action-code', 'expired'], ['auth/invalid-action-code', 'invalid'], ['auth/user-disabled', 'disabled'], ['auth/network-request-failed', 'network'], [undefined, 'invalid'], ['auth/weak-password', 'invalid']])
  assert.equal(r(start, { type: 'check_failed', code }).status, status, String(code));
 const net = r(start, { type: 'check_failed', code: 'auth/network-request-failed' });
 assert.equal(r(net, { type: 'retry' }).status, 'checking');
 // Events out of order change nothing.
 assert.equal(r(ready, { type: 'saved' }), ready); assert.equal(r(start, { type: 'submit' }), start); assert.equal(r(saving, { type: 'submit' }), saving);
 assert.equal(r(r(saving, { type: 'saved' }), { type: 'check_failed', code: 'auth/invalid-action-code' }).status, 'done');
 assert.equal(r(ready, { type: 'retry' }), ready);
 for (const dead of shared.resetDeadEnds) assert.ok(['expired', 'invalid', 'disabled'].includes(dead));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The limiter
// ---------------------------------------------------------------------------------------------------------------------------------------------

test('limiter: a fixed window per key, a refusal says when to come back, keys are hashed, and the table is bounded', () => {
 let now = 1_000_000; const lim = limiterModule.createLimiter({ a: { limit: 2, windowMs: 10_000 } }, () => now, 3);
 assert.deepEqual({ ...lim.take('a', 'k1') }, { allowed: true }); assert.deepEqual({ ...lim.take('a', 'k1') }, { allowed: true });
 const refused = lim.take('a', 'k1'); assert.equal(refused.allowed, false); assert.equal(refused.retryAfterSeconds, 10);
 now += 4_000; assert.equal(lim.take('a', 'k1').retryAfterSeconds, 6);
 assert.equal(lim.take('a', 'k2').allowed, true, 'another key is separate');
 now += 6_000; assert.equal(lim.take('a', 'k1').allowed, true, 'a new window');
 // Bounded: with room for 3 keys the oldest is dropped, nothing grows and nothing throws.
 for (const k of ['k3', 'k4', 'k5', 'k6']) lim.take('a', k);
 assert.throws(() => lim.take('missing', 'k'));
 assert.doesNotMatch(code('server/services/password-reset-limiter.ts'), /console\./);
});
test('limiter: the rules are 3 an address and 20 a client per 15 minutes, with one bigger shared bucket', () => {
 const r = limiterModule.passwordResetRules;
 assert.deepEqual({ ...r.email }, { limit: 3, windowMs: 900000 }); assert.deepEqual({ ...r.ip }, { limit: 20, windowMs: 900000 }); assert.deepEqual({ ...r.shared }, { limit: 200, windowMs: 900000 });
});
test('client address: only the header the operator names, the last entry of a list, and only a real IP address', () => {
 const h = (o) => ({ get: (n) => o[n.toLowerCase()] ?? null });
 const env = { PASSWORD_RESET_CLIENT_IP_HEADER: 'X-Real-IP' };
 assert.equal(limiterModule.clientAddress(h({ 'x-real-ip': '203.0.113.9' }), env), '203.0.113.9');
 assert.equal(limiterModule.clientAddress(h({ 'x-real-ip': '203.0.113.9:5521' }), env), '203.0.113.9');
 assert.equal(limiterModule.clientAddress(h({ 'x-real-ip': '2001:DB8::1' }), env), '2001:db8::1');
 assert.equal(limiterModule.clientAddress(h({ 'x-real-ip': '[2001:db8::1]' }), env), '2001:db8::1');
 assert.equal(limiterModule.clientAddress(h({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.9' }), { PASSWORD_RESET_CLIENT_IP_HEADER: 'x-forwarded-for' }), '203.0.113.9', 'the one the operator\'s proxy added');
 assert.equal(limiterModule.clientAddress(h({ 'x-real-ip': 'not-an-ip' }), env), null);
 assert.equal(limiterModule.clientAddress(h({ 'x-real-ip': '999.1.1.1' }), env), null);
 assert.equal(limiterModule.clientAddress(h({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '9.9.9.9' }), {}), null, 'no header is trusted unless named');
 assert.equal(limiterModule.clientAddress(h({ 'x-real-ip': '203.0.113.9' }), { PASSWORD_RESET_CLIENT_IP_HEADER: 'bad header name!' }), null);
 assert.equal(limiterModule.clientAddress(h({}), env), null);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The service and the route
// ---------------------------------------------------------------------------------------------------------------------------------------------

const pw = { disabled: false, providerData: [{ providerId: 'password' }] };
const accounts = {
 'exists@example.test': pw,
 'google@example.test': { disabled: false, providerData: [{ providerId: 'google.com' }] },
 'disabled@example.test': { disabled: true, providerData: [{ providerId: 'password' }] },
 'both@example.test': { disabled: false, providerData: [{ providerId: 'google.com' }, { providerId: 'password' }] },
};
function world({ now = { t: 1_000_000 }, mailerConfigured = true, originValue = origin, adminGate } = {}) {
 const calls = { lookups: [], links: [], mails: [], events: [] }, pending = [];
 const admin = {
  async getUserByEmail(email) { calls.lookups.push(email); if (adminGate) await adminGate; if (accounts[email]) return accounts[email]; throw Object.assign(new Error('There is no user record'), { code: 'auth/user-not-found' }); },
  async generatePasswordResetLink(email, settings) { calls.links.push({ email, settings }); return 'https://project.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=' + CODE + '&apiKey=PUBLICKEY&continueUrl=' + encodeURIComponent(settings.url) + '&lang=en'; },
 };
 const mailer = { configured: () => mailerConfigured, async send(message) { calls.mails.push(message); return 'sent'; } };
 const deps = { origin: () => originValue, admin: () => admin, mailer, limiter: limiterModule.createLimiter(limiterModule.passwordResetRules, () => now.t), defer: (work) => pending.push(work()), log: (e) => calls.events.push(e) };
 return { deps, calls, now, drain: () => Promise.all(pending.splice(0)) };
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test('request: the same reply for an account, an unknown address, a Google-only account and a disabled one', async () => {
 const replies = [], w = world();
 for (const email of ['exists@example.test', 'nobody@example.test', 'google@example.test', 'disabled@example.test', 'both@example.test'])
  replies.push(plain(await service.requestPasswordReset({ email }, { address: '203.0.113.' + replies.length }, w.deps)));
 for (const r of replies) assert.deepEqual(r, { status: 202, body: { ok: true } });
 await w.drain();
 assert.deepEqual(w.calls.mails.map((m) => m.to).sort(), ['both@example.test', 'exists@example.test'], 'only password accounts get an email');
 assert.deepEqual(w.calls.links.map((l) => l.email).sort(), ['both@example.test', 'exists@example.test']);
 assert.deepEqual(w.calls.events.sort(), ['disabled_account', 'no_account', 'not_password_account', 'sent', 'sent']);
});
test('request: the reply does not wait for the lookup, so how long it takes cannot tell either', async () => {
 let release; const gate = new Promise((r) => { release = r; });
 const w = world({ adminGate: gate });
 const reply = await service.requestPasswordReset({ email: 'exists@example.test' }, { address: null }, w.deps);
 assert.deepEqual(plain(reply), { status: 202, body: { ok: true } });
 assert.equal(w.calls.mails.length, 0, 'the reply came back while the lookup was still waiting');
 release(); await w.drain();
 assert.equal(w.calls.mails.length, 1);
 // The work before the reply is identical for every address: no account lookup happens there.
 const w2 = world({ adminGate: gate });
 await service.requestPasswordReset({ email: 'nobody@example.test' }, { address: null }, w2.deps);
 assert.equal(w2.calls.links.length, 0);
});
test('request: the link in the email is EduLabs\' own page with Firebase\'s code, and the action settings name only the sign-in page', async () => {
 const w = world();
 await service.requestPasswordReset({ email: 'exists@example.test', language: 'ar' }, { address: null }, w.deps); await w.drain();
 const [mail] = w.calls.mails;
 assert.equal(mail.to, 'exists@example.test');
 const link = origin + '/reset-password?oobCode=' + CODE;
 assert.ok(mail.html.includes('href="' + link + '"')); assert.ok(mail.text.includes(link));
 for (const part of [mail.html, mail.text, mail.subject]) assert.doesNotMatch(part, /firebaseapp|PUBLICKEY|apiKey|continueUrl/);
 assert.deepEqual(plain(w.calls.links[0].settings), { url: origin + '/sign-in', handleCodeInApp: false });
 assert.match(mail.subject, /EduLabs/); assert.doesNotMatch(mail.subject, /Reset your EduLabs password/, 'Arabic only');
});
test('request: the language is the one the browser chose, and both languages when it never chose', async () => {
 const w = world();
 await service.requestPasswordReset({ email: 'exists@example.test' }, { address: null }, w.deps);
 await service.requestPasswordReset({ email: 'both@example.test', language: 'en' }, { address: null }, w.deps); await w.drain();
 const [none, en] = w.calls.mails;
 assert.match(none.subject, /Reset your EduLabs password · /); assert.ok(none.html.includes('dir="rtl"') && none.html.includes('Reset your password'));
 assert.equal(en.subject, 'Reset your EduLabs password'); assert.ok(!en.html.includes('dir="rtl"'));
});
test('request: limits count every address alike, per address and per client, and say when to retry', async () => {
 const w = world();
 const ask = (email, address) => service.requestPasswordReset({ email }, { address }, w.deps);
 for (const email of ['exists@example.test', 'nobody@example.test']) {
  for (let i = 0; i < 3; i++) assert.equal((await ask(email, '198.51.100.' + (i + (email[0] === 'e' ? 0 : 50)))).status, 202, email + ' ' + i);
  const refused = plain(await ask(email.toUpperCase(), '198.51.100.99'));
  assert.equal(refused.status, 429, email); assert.equal(refused.body.error, 'rate_limited'); assert.ok(refused.body.retryAfterSeconds > 0 && refused.body.retryAfterSeconds <= 900);
 }
 w.now.t += 15 * 60 * 1000 + 1;
 assert.equal((await ask('exists@example.test', '198.51.100.1')).status, 202, 'a new window');
 // Per client: 20 different addresses from one client, the 21st is refused.
 const w2 = world();
 for (let i = 0; i < 20; i++) assert.equal((await service.requestPasswordReset({ email: `u${i}@example.test` }, { address: '192.0.2.7' }, w2.deps)).status, 202);
 assert.equal((await service.requestPasswordReset({ email: 'u99@example.test' }, { address: '192.0.2.7' }, w2.deps)).status, 429);
 assert.equal((await service.requestPasswordReset({ email: 'u99@example.test' }, { address: '192.0.2.8' }, w2.deps)).status, 202, 'another client is not affected');
 // No trusted address: one shared bucket of 200.
 const w3 = world(); let last;
 for (let i = 0; i < 201; i++) last = await service.requestPasswordReset({ email: `s${i}@example.test` }, { address: null }, w3.deps);
 assert.equal(last.status, 429);
});
test('request: bad bodies are 400 and cost nothing; unconfigured mail or origin is the same 503 for every address', async () => {
 const w = world();
 for (const bad of [null, [], 'x', 7, {}, { email: 'nope' }, { email: 'a@example.test', admin: true }, { email: 'a@example.test', language: 'de' }])
  assert.deepEqual(plain(await service.requestPasswordReset(bad, { address: null }, w.deps)), { status: 400, body: { error: 'invalid_request' } }, JSON.stringify(bad));
 assert.equal(w.calls.lookups.length, 0);
 for (const cfg of [{ mailerConfigured: false }, { originValue: null }]) {
  const u = world(cfg);
  const a = plain(await service.requestPasswordReset({ email: 'exists@example.test' }, { address: null }, u.deps)), b = plain(await service.requestPasswordReset({ email: 'nobody@example.test' }, { address: null }, u.deps));
  assert.deepEqual(a, { status: 503, body: { error: 'unavailable' } }); assert.deepEqual(b, a);
  await u.drain(); assert.equal(u.calls.lookups.length, 0);
 }
});
test('request: a failing lookup, link or mail never changes the reply and never throws', async () => {
 const make = (overrides) => { const w = world(); Object.assign(w.deps, overrides); return w; };
 const cases = {
  'lookup fails': { admin: () => ({ getUserByEmail: async () => { throw new Error('boom'); }, generatePasswordResetLink: async () => '' }) },
  'admin cannot start': { admin: () => { throw new Error('credentials'); } },
  'link has no code': { admin: () => ({ getUserByEmail: async () => pw, generatePasswordResetLink: async () => 'https://x.test/nothing' }) },
  'link fails': { admin: () => ({ getUserByEmail: async () => pw, generatePasswordResetLink: async () => { throw new Error('boom'); } }) },
  'mail rejected': { mailer: { configured: () => true, send: async () => 'rejected' } },
  'mail unconfirmed': { mailer: { configured: () => true, send: async () => 'unconfirmed' } },
 };
 for (const [name, overrides] of Object.entries(cases)) {
  const w = make(overrides);
  assert.deepEqual(plain(await service.requestPasswordReset({ email: 'exists@example.test' }, { address: null }, w.deps)), { status: 202, body: { ok: true } }, name);
  await w.drain(); assert.equal(w.calls.events.length, 1, name); assert.ok(!w.calls.events[0].includes('@'), name);
 }
});

// The HTTP handler, with the real Request and a stand-in for NextResponse.
class FakeNextResponse { constructor(body, status, headers) { this.body = body; this.status = status; this.headers = headers; } static json(body, init = {}) { return new FakeNextResponse(body, init.status ?? 200, init.headers ?? {}); } }
function handler({ staging = true, deps } = {}) {
 const mod = load('server/http/password-reset.ts', {
  'server-only': {}, 'next/server': { NextRequest: Request, NextResponse: FakeNextResponse, after: (work) => work() },
  '@/shared/auth-config': { isFirebaseStaging: () => staging },
  '@/server/http/firebase/route': { validFirebaseOrigin: (r) => r.headers.get('origin') === origin && r.headers.get('sec-fetch-site') !== 'cross-site' },
  '@/server/integrations/firebase-admin': { getFirebaseAdminAuth: () => { throw Error('not used in this test'); } },
  '@/server/services/invitation-delivery': delivery, '@/server/services/password-reset-limiter': { ...limiterModule, passwordResetLimiter: () => deps.limiter }, '@/server/services/password-reset': service,
 });
 return (request) => mod.handlePasswordResetRequest(request, deps);
}
const post = (body, { headers = {}, raw } = {}) => new Request(origin + '/api/auth/firebase/password-reset', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers }, body: raw ?? JSON.stringify(body) });

test('route: the same status, body and headers for an existing and an unknown address', async () => {
 const w = world(), call = handler({ deps: w.deps });
 const a = await call(post({ email: 'exists@example.test', language: 'en' })), b = await call(post({ email: 'nobody@example.test', language: 'en' }));
 assert.equal(a.status, 202); assert.deepEqual(plain(a.body), { ok: true });
 assert.equal(b.status, a.status); assert.deepEqual(plain(b.body), plain(a.body)); assert.deepEqual(plain(b.headers), plain(a.headers));
 assert.equal(a.headers['Cache-Control'], 'no-store');
 await w.drain(); assert.equal(w.calls.mails.length, 1);
});
test('route: refusals before any lookup: wrong origin, cross-site, content type, size, JSON, shape, staging off', async () => {
 const w = world(), call = handler({ deps: w.deps });
 const status = async (request) => (await call(request)).status;
 assert.equal(await status(post({ email: 'a@example.test' }, { headers: { origin: 'https://evil.example' } })), 403);
 assert.equal(await status(post({ email: 'a@example.test' }, { headers: { origin: '' } })), 403);
 assert.equal(await status(post({ email: 'a@example.test' }, { headers: { 'sec-fetch-site': 'cross-site' } })), 403);
 assert.equal(await status(post({ email: 'a@example.test' }, { headers: { 'content-type': 'text/plain' } })), 415);
 assert.equal(await status(post({ email: 'a@example.test' }, { headers: { 'content-type': '' } })), 415);
 assert.equal(await status(post(null, { raw: '{"email":"a@example.test","pad":"' + 'x'.repeat(2000) + '"}' })), 413);
 assert.equal(await status(post(null, { raw: 'not json' })), 400);
 assert.equal(await status(post(null, { raw: '' })), 400);
 assert.equal(await status(post({ email: 'nope' })), 400);
 assert.equal(await status(post({ email: 'a@example.test', surprise: true })), 400);
 assert.equal(await status(post(null, { raw: '["a@example.test"]' })), 400);
 assert.equal((await handler({ staging: false, deps: w.deps })(post({ email: 'a@example.test' }))).status, 404);
 assert.equal(w.calls.lookups.length, 0);
 await w.drain();
});
test('route: a refused request for too many asks carries Retry-After, the same for any address', async () => {
 const w = world(), call = handler({ deps: w.deps });
 for (let i = 0; i < 3; i++) await call(post({ email: 'nobody@example.test' }));
 const refused = await call(post({ email: 'nobody@example.test' }));
 assert.equal(refused.status, 429); assert.equal(refused.body.error, 'rate_limited'); assert.match(refused.headers['Retry-After'], /^[1-9]\d*$/); assert.equal(refused.headers['Cache-Control'], 'no-store');
});
test('logs: no email, code, link or error text is ever written, in any outcome', async () => {
 logs.length = 0;
 const emails = ['exists@example.test', 'nobody@example.test', 'google@example.test', 'disabled@example.test'];
 const w = world(), call = handler({ deps: w.deps });
 for (const email of emails) await call(post({ email }));
 for (let i = 0; i < 4; i++) await call(post({ email: 'nobody@example.test' }));
 await call(post({ email: 'bad address' })); await call(post(null, { raw: 'not json' }));
 await w.drain();
 const broken = world(); broken.deps.admin = () => { throw new Error('secret failure for exists@example.test code ' + CODE); };
 await service.requestPasswordReset({ email: 'exists@example.test' }, { address: null }, broken.deps); await broken.drain();
 const mailFails = world(); mailFails.deps.mailer = { configured: () => true, send: async () => { throw new Error('exists@example.test ' + CODE); } };
 await service.requestPasswordReset({ email: 'exists@example.test' }, { address: null }, mailFails.deps); await mailFails.drain();
 const all = logs.join('\n') + '\n' + [w, broken, mailFails].flatMap((x) => x.calls.events).join('\n');
 assert.ok(all.length > 0, 'something is logged: the fixed event names');
 for (const secret of [...emails, '@', CODE, 'oobCode', 'reset-password', 'firebaseapp', 'secret failure', 'example.test']) assert.ok(!all.includes(secret), 'a log line contains ' + secret);
 const events = new Set(['sent', 'no_account', 'not_password_account', 'disabled_account', 'link_failed', 'mail_rejected', 'mail_unconfirmed', 'lookup_failed', 'unavailable', 'limited']);
 for (const e of [...w.calls.events, ...broken.calls.events, ...mailFails.calls.events]) assert.ok(events.has(e), e);
 for (const line of logs) assert.match(line, /^password_reset (sent|no_account|not_password_account|disabled_account|link_failed|mail_rejected|mail_unconfirmed|lookup_failed|unavailable|limited)$/);
});
test('source: the new server and client files write only fixed event names and handle no secret', () => {
 const server = ['server/http/password-reset.ts', 'server/services/password-reset.ts', 'server/services/password-reset-email.ts', 'server/services/password-reset-limiter.ts'];
 const client = ['frontend/features/auth/forgot-password.tsx', 'frontend/features/auth/reset-password.tsx', 'frontend/features/auth/password-reset-views.tsx', 'shared/password-reset.ts'];
 const calls = server.flatMap((f) => [...code(f).matchAll(/console\.\w+\([^;]*\);/g)].map((m) => f + ': ' + m[0]));
 assert.deepEqual(calls, ["server/http/password-reset.ts: console.info('password_reset', event);"]);
 for (const f of client) assert.doesNotMatch(code(f), /console\./, f);
 for (const f of [...server, ...client]) assert.doesNotMatch(code(f), /SERVICE_ROLE|service_role|BREVO_API_KEY\b(?![\s\S]{0,10}trim)|sessionStorage|localStorage\.setItem|document\.cookie|alert\(/, f);
 assert.doesNotMatch(code('frontend/features/auth/reset-password.tsx') + code('frontend/features/auth/forgot-password.tsx'), /BREVO|FIREBASE_PRIVATE|process\.env/);
 assert.match(code('server/http/password-reset.ts'), /validFirebaseOrigin/);
 assert.doesNotMatch(code('server/http/password-reset.ts') + code('server/services/password-reset.ts'), /request\.headers\.get\('(host|x-forwarded)/i, 'no request-derived origin');
 // Firebase's own email and hosted page are gone from the app.
 const app = ['frontend', 'server', 'app', 'shared'].flatMap((d) => (function walk(p) { return fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap((n) => walk(path.join(p, n))) : /\.(ts|tsx)$/.test(p) ? [p] : []; })(d));
 for (const f of app) assert.doesNotMatch(code(f), /sendPasswordResetEmail|__\/auth\/action/, f);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The mailer (Brevo, the same key and sender as the teacher invitation)
// ---------------------------------------------------------------------------------------------------------------------------------------------

const goodEnv = { BREVO_API_KEY: 'brevo_test_key', AUTH_EMAIL_FROM: 'EduLabs <accounts@mail.example.test>' };
test('mailer: not configured sends nothing; outcomes are sent, rejected (4xx) or unconfirmed (5xx, timeout, throw) and never retried', async () => {
 for (const env of [{}, { BREVO_API_KEY: 'k' }, { AUTH_EMAIL_FROM: goodEnv.AUTH_EMAIL_FROM }, { ...goodEnv, AUTH_EMAIL_FROM: 'not an address' }]) {
  let called = false; const m = service.createResetMailer(env, async () => { called = true; return {}; });
  assert.equal(m.configured(), false); assert.equal(await m.send({ to: 'a@example.test', subject: 's', html: 'h', text: 't' }), 'rejected'); assert.equal(called, false);
 }
 const sent = []; const ok = service.createResetMailer(goodEnv, async (payload, key) => { sent.push({ payload, key }); return { data: { id: 'm1' } }; });
 assert.equal(ok.configured(), true); assert.equal(await ok.send({ to: 'a@example.test', subject: 'S', html: '<p>h</p>', text: 't' }), 'sent');
 assert.equal(sent.length, 1); assert.equal(sent[0].payload.from, goodEnv.AUTH_EMAIL_FROM); assert.equal(sent[0].payload.to, 'a@example.test'); assert.equal(sent[0].payload.tag, 'edulabs-password-reset');
 const status = (code) => service.createResetMailer(goodEnv, async () => ({ error: { statusCode: code } })).send({ to: 'a@example.test', subject: 's', html: 'h', text: 't' });
 assert.equal(await status(400), 'rejected'); assert.equal(await status(401), 'rejected'); assert.equal(await status(429), 'rejected'); assert.equal(await status(500), 'unconfirmed'); assert.equal(await status(503), 'unconfirmed');
 assert.equal(await service.createResetMailer(goodEnv, async () => { throw new Error('network'); }).send({ to: 'a@example.test', subject: 's', html: 'h', text: 't' }), 'unconfirmed');
 assert.equal(await service.createResetMailer(goodEnv, () => new Promise(() => {}), 20).send({ to: 'a@example.test', subject: 's', html: 'h', text: 't' }), 'unconfirmed');
 let attempts = 0; await service.createResetMailer(goodEnv, async () => { attempts++; return { error: { statusCode: 503 } }; }).send({ to: 'a@example.test', subject: 's', html: 'h', text: 't' }); assert.equal(attempts, 1, 'never retried');
});
test('mailer: Brevo\'s request carries the sender, the recipient, both parts and a tag with no personal data', async () => {
 const requests = []; const realFetch = global.fetch;
 global.fetch = async (url, init) => { requests.push({ url: String(url), init }); return { ok: true, json: async () => ({ messageId: '<id@brevo>' }) }; };
 try {
  const transport = delivery.brevoTransport('brevo_test_key');
  const out = await transport({ from: goodEnv.AUTH_EMAIL_FROM, to: 'a@example.test', subject: 'S', html: '<p>h</p>', text: 't', tag: 'edulabs-password-reset' }, 'k');
  assert.equal(out.data.id, '<id@brevo>');
  const body = JSON.parse(requests[0].init.body);
  assert.equal(requests[0].url, 'https://api.brevo.com/v3/smtp/email'); assert.equal(requests[0].init.headers['api-key'], 'brevo_test_key');
  assert.deepEqual(body.sender, { name: 'EduLabs', email: 'accounts@mail.example.test' }); assert.deepEqual(body.to, [{ email: 'a@example.test' }]);
  assert.equal(body.htmlContent, '<p>h</p>'); assert.equal(body.textContent, 't'); assert.deepEqual(body.tags, ['edulabs-password-reset']);
  await transport({ from: goodEnv.AUTH_EMAIL_FROM, to: 'a@example.test', subject: 'S', html: 'h', text: 't' }, 'k');
  assert.deepEqual(JSON.parse(requests[1].init.body).tags, ['edulabs-teacher-invitation'], 'the invitation keeps its tag');
 } finally { global.fetch = realFetch; }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------------------------------------------------------------------------

const snapshotDir = 'scripts/snapshots/password-reset-email';
function snapshot(name, actual) {
 const file = path.join(snapshotDir, name);
 if (process.env.UPDATE_SNAPSHOTS === '1') { fs.mkdirSync(snapshotDir, { recursive: true }); fs.writeFileSync(file, actual); return; }
 assert.ok(fs.existsSync(file), 'missing snapshot ' + file + ' (run with UPDATE_SNAPSHOTS=1)');
 assert.equal(actual, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), name + ' changed: read the diff, then UPDATE_SNAPSHOTS=1');
}
for (const [name, language] of [['en', 'en'], ['ar', 'ar'], ['both', undefined]]) {
 test(`email: the ${name} HTML and text parts match their snapshots`, () => {
  const mail = emailModule.passwordResetEmailContent({ link: exampleLink, language });
  snapshot(name + '.html', mail.html); snapshot(name + '.txt', mail.text); snapshot(name + '.subject.txt', mail.subject + '\n');
 });
}
test('email: what the owner asked for is in it, in each language, and nothing else varies', () => {
 for (const language of ['en', 'ar', undefined]) {
  const { html, text, subject } = emailModule.passwordResetEmailContent({ link: exampleLink, language });
  assert.ok(html.includes('#7ED957'), 'brand green'); assert.ok(html.includes(origin + '/email/edulabs-mark.png'), 'logo'); assert.match(html, /alt="EduLabs"/);
  assert.ok(html.includes('href="' + exampleLink + '"'), 'the button'); assert.ok(html.includes('>' + exampleLink + '</a>'), 'the link as text'); assert.ok(text.includes(exampleLink));
  assert.ok(html.indexOf('>' + exampleLink + '</a>') > html.indexOf('class="button-link"'), 'the link text sits below the button');
  assert.match(html, /<meta name="viewport"/); assert.match(html, /role="presentation"/); assert.doesNotMatch(html, /<script|javascript:|<form|<iframe|<link /i);
  assert.doesNotMatch(html + text + subject, /undefined|\[object|\$\{/);
  assert.ok(text.endsWith('\n')); assert.doesNotMatch(text, /<[a-z]/i, 'the text part has no markup');
  if (language !== 'ar') { assert.ok(html.includes('This link expires in 1 hour.') && text.includes('This link expires in 1 hour.')); assert.ok(html.includes('If you didn&#39;t ask, ignore this email.') && text.includes("If you didn't ask, ignore this email.")); }
  if (language !== 'en') { assert.ok(html.includes('ينتهي هذا الرابط خلال ساعة واحدة.') && text.includes('ينتهي هذا الرابط خلال ساعة واحدة.')); assert.match(html, /dir="rtl" lang="ar"/); }
 }
 assert.match(emailModule.passwordResetEmailContent({ link: exampleLink, language: 'ar' }).html, /<html lang="ar" dir="rtl"/);
 assert.match(emailModule.passwordResetEmailContent({ link: exampleLink, language: 'en' }).html, /<html lang="en" dir="ltr"/);
 // The link is the only variable part and it is escaped where it enters HTML.
 const tricky = emailModule.passwordResetEmailContent({ link: origin + '/reset-password?oobCode=a"b<c>&d' });
 assert.doesNotMatch(tricky.html, /oobCode=a"b<c>/); assert.ok(tricky.html.includes('oobCode=a&quot;b&lt;c&gt;&amp;d'));
});
test('email: Outlook and phone support is built in (tables, an Outlook button, a phone width rule, dark mode as an extra)', () => {
 const { html } = emailModule.passwordResetEmailContent({ link: exampleLink, language: 'en' });
 assert.match(html, /<!--\[if mso\]><v:roundrect/); assert.match(html, /max-width:620px/); assert.match(html, /prefers-color-scheme:dark/); assert.match(html, /name="color-scheme"/);
 assert.match(html, /width="600"/); assert.doesNotMatch(html, /display:flex|display:grid|position:|float:|calc\(|var\(--/);
 assert.ok(html.length < 16000, 'under Gmail\'s clipping size (102 KB) by a wide margin');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------------------------------------------------------------------------

const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { LanguageProvider } = localization.language();
const views = localization.load('frontend/features/auth/password-reset-views.tsx');
const { messages } = require('./localization-test-loader.cjs').load('frontend/locales/messages.ts');
const decode = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const render = (element, language) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLanguage: language }, element));
const noop = () => {};
const forgot = (o = {}) => React.createElement(views.ForgotPasswordView, { phase: 'form', email: '', onEmail: noop, error: null, cooldown: 0, onSubmit: noop, onResend: noop, signInHref: '/sign-in', ...o });
const resetView = (state, o = {}) => React.createElement(views.ResetPasswordView, { state, password: '', confirm: '', show: false, onPassword: noop, onConfirm: noop, onToggle: noop, problem: null, showProblem: false, onSubmit: noop, onRetry: noop, forgotHref: '/forgot-password', signInHref: '/sign-in', ...o });
const S = (status, extra = {}) => ({ status, email: 'student@example.test', notice: null, ...extra });

test('screens: every state shows its own words in English and in Arabic, never a raw key', () => {
 const cases = [
  ['forgot form', () => forgot(), ['pr.forgot.title', 'pr.forgot.intro', 'pr.forgot.email', 'pr.forgot.send', 'pr.forgot.back']],
  ['forgot sending', () => forgot({ phase: 'sending', email: 'a@example.test' }), ['pr.forgot.sending']],
  ['forgot sent', () => forgot({ phase: 'sent', email: 'a@example.test', cooldown: 42 }), ['pr.forgot.sent_title', 'pr.forgot.sent', 'pr.forgot.sent_more', 'pr.forgot.back']],
  ['forgot rate limited', () => forgot({ error: 'wait' }), ['pr.forgot.wait']],
  ['forgot bad email', () => forgot({ error: 'bad_email', email: 'x' }), ['pr.forgot.bad_email']],
  ['reset checking', () => resetView(S('checking')), ['pr.reset.title', 'pr.reset.checking']],
  ['reset ready', () => resetView(S('ready'), { password: 'a-long-enough-password', confirm: 'a-long-enough-password' }), ['pr.reset.new', 'pr.reset.confirm', 'pr.reset.save', 'pr.reset.rule', 'pr.reset.match', 'pr.reset.strength_tip']],
  ['reset saving', () => resetView(S('saving')), ['pr.reset.saving']],
  ['reset done', () => resetView(S('done')), ['pr.reset.done_title', 'pr.reset.done', 'pr.reset.signin']],
  ['reset expired', () => resetView(S('expired')), ['pr.reset.expired_title', 'pr.reset.expired', 'pr.reset.new_link']],
  ['reset invalid', () => resetView(S('invalid')), ['pr.reset.invalid_title', 'pr.reset.invalid', 'pr.reset.new_link']],
  ['reset disabled', () => resetView(S('disabled')), ['pr.reset.disabled_title', 'pr.reset.disabled']],
  ['reset network', () => resetView(S('network')), ['pr.reset.network_title', 'pr.reset.network', 'pr.reset.retry']],
  ['reset weak notice', () => resetView(S('ready', { notice: 'weak' })), ['pr.reset.weak_server']],
 ];
 for (const language of ['en', 'ar']) for (const [name, make, keys] of cases) {
  const text = decode(render(make(), language));
  for (const key of keys) assert.ok(text.includes(messages[language][key].replace(/\{\w+\}/g, '').trim().split('  ')[0]), `${language} ${name}: ${key}`);
  assert.doesNotMatch(text, /\bpr\.(reset|forgot|signin|aside)\b/, `${language} ${name}: a raw key`);
 }
});
test('screens: the dead ends offer a new link, the others do not; the sent state names no account', () => {
 const html = (state, o) => render(resetView(state, o), 'en');
 for (const status of ['expired', 'invalid']) assert.ok(html(S(status)).includes('href="/forgot-password"'), status);
 for (const status of ['disabled', 'done', 'checking', 'network']) assert.ok(!html(S(status)).includes('href="/forgot-password"'), status);
 assert.ok(html(S('done')).includes('href="/sign-in"') && decode(html(S('done'))).includes('Sign in'));
 assert.ok(html(S('network')).includes('Try again'));
 const sent = render(forgot({ phase: 'sent', email: 'private@example.test', cooldown: 0 }), 'en');
 assert.ok(!sent.includes('private@example.test'), 'the sent state does not repeat the address');
 assert.ok(decode(sent).includes("If an account exists for this email, we've sent a link."));
 assert.match(render(forgot({ phase: 'sent', cooldown: 30 }), 'en'), /disabled=""[^>]*>Send again in 30s/);
 assert.doesNotMatch(render(forgot({ phase: 'sent', cooldown: 0 }), 'en'), /disabled=""[^>]*>Send again</);
});
test('screens: the reset form shows the email it is for, a show/hide control, the length rule and a strength hint', () => {
 const ready = (o) => render(resetView(S('ready'), o), 'en');
 assert.ok(decode(ready({})).includes('For') && ready({}).includes('student@example.test'));
 assert.match(ready({}), /aria-label="Show passwords"[^>]*aria-pressed="false"/); assert.match(ready({ show: true }), /aria-label="Hide passwords"[^>]*aria-pressed="true"/);
 assert.match(ready({}), /type="password"[^>]*autoComplete|autoComplete="new-password"/i); assert.equal((ready({}).match(/type="password"/g) || []).length, 2);
 assert.equal((ready({ show: true }).match(/type="password"/g) || []).length, 0);
 assert.ok(!ready({}).includes('d-strength"'), 'no strength line before typing');
 assert.match(ready({ password: 'short' }), /data-level="0"/); assert.ok(decode(ready({ password: 'short' })).includes('Strength: too short') && decode(ready({ password: 'short' })).includes('(5/12)'));
 assert.match(ready({ password: 'Kdhfjr7tyeo!pwmzx' }), /data-level="4"/);
 assert.ok(decode(ready({ password: 'a'.repeat(12), confirm: 'b' })).includes('The passwords do not match.'));
 assert.ok(decode(ready({ password: 'short', confirm: 'short', problem: 'too_short', showProblem: true })).includes('Use at least 12 characters.'));
 assert.ok(decode(ready({ password: 'a'.repeat(12), confirm: 'b'.repeat(12), problem: 'mismatch', showProblem: true })).includes('The two passwords must match.'));
 assert.ok(!decode(ready({ password: 'short', problem: 'too_short', showProblem: false })).includes('Use at least 12 characters.'), 'no error before the first try');
 assert.match(render(resetView(S('saving')), 'en'), /<fieldset disabled=""/);
});
test('locales: every password-reset string exists in both languages with the same placeholders, and Arabic is Arabic', () => {
 const keys = Object.keys(messages.en).filter((k) => k.startsWith('pr.'));
 assert.ok(keys.length >= 50);
 for (const k of keys) {
  assert.ok(messages.ar[k], 'missing Arabic: ' + k);
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  assert.equal(ph(messages.ar[k]), ph(messages.en[k]), k);
  assert.match(messages.ar[k], /[؀-ۿ]/, 'Arabic text: ' + k);
  assert.doesNotMatch(messages.en[k], /[؀-ۿ]/, k);
 }
 assert.ok(!Object.keys(messages.ar).some((k) => k.startsWith('pr.') && !(k in messages.en)));
 assert.equal(messages.en['pr.forgot.sent'], "If an account exists for this email, we've sent a link.");
 assert.equal(messages.en['pr.signin_link'], 'Forgot your password?');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Where the pages live
// ---------------------------------------------------------------------------------------------------------------------------------------------

class NextResponse {
 constructor(kind, status) { this.kind = kind; this.status = status; this.headers = new Map(); }
 static next() { return new NextResponse('next', 200); }
 static json(_, o) { return new NextResponse('json', o.status); }
 static redirect(u) { return new NextResponse('redirect:' + new URL(u).pathname, 307); }
}
const middleware = (staging) => load('middleware.ts', {
 '@/shared/public-website': publicWebsite, '@/shared/website-routes': load('shared/website-routes.ts'),
 '@clerk/nextjs/server': { clerkMiddleware: () => () => new NextResponse('legacy', 200), createRouteMatcher: () => () => false },
 '@/shared/auth-config': { isFirebaseStaging: () => staging }, 'next/server': { NextResponse },
}).default;
const run = (staging, p) => middleware(staging)({ nextUrl: new URL('https://platform.example' + p), url: 'https://platform.example' + p }, {});
test('middleware: the two pages and the one route are reachable, the pages with no referrer, no cache and no index; lookalikes are not', () => {
 for (const p of ['/forgot-password', '/reset-password']) {
  const r = run(true, p); assert.equal(r.kind, 'next', p);
  assert.equal(r.headers.get('Referrer-Policy'), 'no-referrer'); assert.equal(r.headers.get('Cache-Control'), 'private, no-store'); assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
 }
 assert.equal(run(true, '/api/auth/firebase/password-reset').kind, 'next');
 for (const p of ['/reset-password/', '/reset-password/x', '/reset-passwords', '/forgot-password/x', '/Reset-Password', '/api/auth/password-reset', '/api/forgot-password']) assert.notEqual(run(true, p).kind, 'next', p);
 assert.equal(run(true, '/sign-in').kind, 'next');
});
test('pages: only with Firebase on (otherwise not found), with no index; the sign-in page links to the new page and no longer asks Firebase to send mail', () => {
 for (const f of ['app/(auth)/(routes)/forgot-password/page.tsx', 'app/(auth)/(routes)/reset-password/page.tsx']) { const s = read(f); assert.match(s, /isFirebaseStaging\(\)\) notFound\(\)/); assert.match(s, /index: false/); }
 assert.match(read('app/(auth)/(routes)/reset-password/page.tsx'), /referrer: 'no-referrer'/);
 const form = read('frontend/features/auth/firebase-form.tsx');
 assert.match(form, /href="\/forgot-password"[^>]*>\{t\('pr\.signin_link'\)\}/); assert.doesNotMatch(form, /sendPasswordResetEmail/);
 const resetPage = code('frontend/features/auth/reset-password.tsx');
 assert.match(resetPage, /verifyPasswordResetCode/); assert.match(resetPage, /confirmPasswordReset/);
 assert.match(resetPage, /history\.replaceState/, 'the spent code leaves the address bar');
});
