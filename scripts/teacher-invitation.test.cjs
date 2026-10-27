// Teacher invitation link onboarding: link building, e-mail delivery outcomes, ordering of side effects, preview/accept endpoints,
// browser-side token handling and copy. Uses fictional addresses and tokens only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript'), crypto = require('node:crypto');
const localization = require('./localization-test-loader.cjs');

function load(file, deps = {}, globals = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { module: m, exports: m.exports, URL, Buffer, setTimeout, clearTimeout, Promise, JSON, Date, ...globals, require: n => n === 'zod' || n === 'node:crypto' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const read = f => fs.readFileSync(f, 'utf8');
const code = f => read(f).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const contract = load('shared/contracts/platform-provisioning.ts');
const linkLib = load('shared/invitation-link.ts', { '@/shared/contracts/platform-provisioning': contract });
const origin = 'https://staging.example.test';
const token = () => crypto.randomBytes(32).toString('base64url');
const secretOf = link => link.slice(link.indexOf('#') + 1);

test('link: the secret lives in the URL fragment of the configured origin and nothing else is accepted', () => {
 const secret = token(), link = linkLib.buildInvitationLink(origin, secret);
 assert.equal(link, `${origin}/teacher-invitation#${secret}`);
 assert.equal(new URL(link).search, ''); assert.equal(new URL(link).hash, '#' + secret);
 for (const bad of ['', 'short', secret + 'x', secret.slice(1), secret.replace(/./, '+'), secret.replace(/./, '/')]) assert.throws(() => linkLib.buildInvitationLink(origin, bad), bad);
 assert.equal(linkLib.invitationFromHash('#' + secret), secret); assert.equal(linkLib.invitationFromHash(secret), secret);
 for (const bad of ['', '#', '#' + secret + '?x=1', '#a b', '#' + secret.slice(1), '?token=' + secret]) assert.equal(linkLib.invitationFromHash(bad), null, bad);
});

const publicWebsite = load('shared/public-website.ts', { zod: require('zod') });
function delivery(env, transport, timeoutMs) {
 const mod = load('server/services/invitation-delivery.ts', { 'server-only': {}, resend: { Resend: class { constructor() { throw Error('the real provider must not be reached in tests'); } } }, '@/shared/public-website': publicWebsite });
 return { ...mod, mailer: mod.createInvitationMailer(env, transport, timeoutMs) };
}
const goodEnv = { RESEND_API_KEY: 're_test_key', INVITATION_EMAIL_FROM: 'EduLabs <invitations@mail.example.test>' };
const message = (extra = {}) => ({ to: 'teacher@example.test', link: `${origin}/teacher-invitation#${token()}`, expiresAt: '2030-01-09T00:00:00Z', idempotencyKey: uuid(7), ...extra });

test('origin: only an exact configured HTTPS origin is trusted; there is no request-derived fallback', () => {
 const d = delivery({});
 assert.equal(d.canonicalAppOrigin({ APP_ORIGIN: origin }), origin);
 for (const bad of [undefined, '', 'staging.example.test', 'http://staging.example.test', origin + '/', origin + '/path', 'https://user:pw@staging.example.test', 'javascript:alert(1)']) assert.equal(d.canonicalAppOrigin({ APP_ORIGIN: bad }), null, String(bad));
 assert.equal(d.canonicalAppOrigin({ APP_ORIGIN: 'http://localhost:3000', NODE_ENV: 'development' }), 'http://localhost:3000');
 assert.equal(d.canonicalAppOrigin({ APP_ORIGIN: 'http://localhost:3000', NODE_ENV: 'production' }), null);
 assert.doesNotMatch(code('server/services/invitation-delivery.ts') + code('server/services/platform-provisioning.ts'), /headers|x-forwarded|request\.url|\bhost\b/i, 'no request-derived origin');
});
test('mailer: missing key or sender means not configured, and nothing is sent', async () => {
 for (const env of [{}, { RESEND_API_KEY: 'k' }, { INVITATION_EMAIL_FROM: goodEnv.INVITATION_EMAIL_FROM }, { ...goodEnv, INVITATION_EMAIL_FROM: 'not an address' }, { ...goodEnv, RESEND_API_KEY: '  ' }]) {
  let called = false; const d = delivery(env, async () => { called = true; return { data: { id: 'x' } }; });
  assert.equal(d.mailer.configured(), false); assert.deepEqual(JSON.parse(JSON.stringify(await d.mailer.send(message()))), { outcome: 'rejected' }); assert.equal(called, false);
 }
 assert.equal(delivery(goodEnv, async () => ({})).mailer.configured(), true);
 assert.equal(delivery({ ...goodEnv, INVITATION_EMAIL_FROM: 'invitations@mail.example.test' }, async () => ({})).mailer.configured(), true);
});
test('mailer: outcomes are classified honestly (sent, rejected, unconfirmed) and never retried', async () => {
 const sentPayloads = [];
 const ok = delivery(goodEnv, async (payload, key) => { sentPayloads.push({ payload, key }); return { data: { id: 'msg_123' }, error: null }; });
 const out = await ok.mailer.send(message({ idempotencyKey: uuid(9) }));
 assert.deepEqual(JSON.parse(JSON.stringify(out)), { outcome: 'sent', providerRef: 'msg_123' });
 assert.equal(sentPayloads.length, 1); assert.equal(sentPayloads[0].key, 'teacher-invitation-' + uuid(9)); assert.equal(sentPayloads[0].payload.to, 'teacher@example.test'); assert.equal(sentPayloads[0].payload.from, goodEnv.INVITATION_EMAIL_FROM);
 assert.deepEqual(JSON.parse(JSON.stringify(await delivery(goodEnv, async () => ({ data: { id: 'bad id with spaces' } })).mailer.send(message()))), { outcome: 'sent', providerRef: null });
 for (const statusCode of [400, 401, 403, 422, 429]) assert.equal((await delivery(goodEnv, async () => ({ error: { statusCode } })).mailer.send(message())).outcome, 'rejected', String(statusCode));
 for (const statusCode of [500, 502, 503, null, undefined]) assert.equal((await delivery(goodEnv, async () => ({ error: { statusCode } })).mailer.send(message())).outcome, 'unconfirmed', String(statusCode));
 let attempts = 0;
 assert.equal((await delivery(goodEnv, async () => { attempts++; throw Error('socket hang up'); }).mailer.send(message())).outcome, 'unconfirmed'); assert.equal(attempts, 1, 'a thrown call is not retried');
 assert.equal((await delivery(goodEnv, () => new Promise(() => {}), 20).mailer.send(message())).outcome, 'unconfirmed', 'no verdict inside the deadline');
});
test('mailer: the message carries the link only in the body, escapes it, and never leaves the secret in a subject', () => {
 const d = delivery(goodEnv); const secret = token(); const link = `${origin}/teacher-invitation#${secret}`;
 const { subject, text, html } = d.invitationEmailContent({ link, expiresAt: '2030-01-09T00:00:00Z' });
 assert.doesNotMatch(subject, new RegExp(secret)); assert.match(text, new RegExp(secret)); assert.match(html, new RegExp(secret));
 assert.match(subject, /EduLabs/); assert.match(html, /dir="rtl"/); assert.match(text, /2030-01-09 00:00 UTC/);
 const hostile = d.invitationEmailContent({ link: `${origin}/x#"><script>alert(1)</script>`, expiresAt: '2030-01-09T00:00:00Z' });
 assert.doesNotMatch(hostile.html, /<script>/);
});

// --- service orchestration ---------------------------------------------------------------------------------------------------
const linkKey = 'k'.repeat(40);
const rotatedKey = 'j'.repeat(40);
const sha = secret => crypto.createHash('sha256').update(secret).digest('hex');
/** A small stateful stand-in for the database functions, enough to prove token reuse, rotation and attempt numbering. */
function harness({ configured = true, originValue = origin, keyValue = linkKey, mail = { outcome: 'sent', providerRef: 'msg_1' }, failRecord = null, failSalt = false } = {}) {
 const calls = [], mailed = [];
 const delivery = require_delivery();
 const db = { invitations: [], next: 2, email: 'recipient@example.test' };
 const issue = (hash) => { const row = { id: uuid(db.next++), hash, salt: null, status: 'pending', expiresAt: '2030-01-09T00:00:00Z', status_d: 'not_sent', attempts: 0, attemptedAt: null }; db.invitations.forEach(i => { if (i.status === 'pending') i.status = 'superseded'; }); db.invitations.unshift(row); return row; };
 const active = () => db.invitations.find(i => i.status === 'pending');
 const client = { rpc: async (name, args) => {
  calls.push({ name, args });
  if (name === 'platform_reissue_teacher_invitation') { const r = issue(args.p_token_hash); return { data: { organizationId: args.p_organization_id, invitationId: r.id, expiresAt: r.expiresAt }, error: null }; }
  if (name === 'platform_provision_teacher') { const r = issue(args.p_token_hash); return { data: { organizationId: uuid(1), invitationId: r.id, courseId: uuid(3), expiresAt: r.expiresAt }, error: null }; }
  if (name === 'platform_store_invitation_salt') { if (failSalt) return { data: null, error: { code: 'XX000', message: 'boom' } }; db.invitations.find(i => i.id === args.p_invitation_id).salt = args.p_salt; return { data: { invitationId: args.p_invitation_id }, error: null }; }
  if (name === 'platform_invitation_link') { const i = active(); if (!i) return { data: null, error: { code: 'PT404', message: 'No active invitation' } }; return { data: { invitationId: i.id, expiresAt: i.expiresAt, salt: i.salt, tokenHash: i.hash, deliveryStatus: i.status_d, attempts: i.attempts }, error: null }; }
  if (name === 'platform_portal_detail') return { data: { organizationId: uuid(1), invitations: db.invitations.map(i => ({ id: i.id, teacherEmail: db.email, status: i.status === 'pending' ? 'pending' : 'revoked', expiresAt: i.expiresAt })), educationSystems: [], subjects: [], courses: [], activity: [] }, error: null };
  if (name === 'platform_invitation_delivery') return { data: db.invitations.map(i => ({ invitationId: i.id, status: i.status_d, attemptedAt: i.attemptedAt, failure: null, attempts: i.attempts })), error: null };
  if (name === 'platform_record_invitation_delivery') {
   if (failRecord === args.p_status) return { data: null, error: { code: 'XX000', message: 'boom' } };
   const i = db.invitations.find(x => x.id === args.p_invitation_id);
   if (args.p_status === 'sending') { i.attempts++; i.status_d = 'sending'; i.attemptedAt = 'now'; return { data: { invitationId: i.id, deliveryStatus: 'sending', attempt: i.attempts }, error: null }; }
   i.status_d = args.p_status; return { data: { invitationId: i.id, deliveryStatus: args.p_status }, error: null };
  }
  if (name === 'teacher_invitation_preview') return { data: { state: 'valid', emailVerified: true, emailMatches: true, acceptedByMe: false, maskedEmail: 'r***@example.test' }, error: null };
  return { data: null, error: { code: 'XX000' } };
 } };
 const keyBox = { v: keyValue };
 const deps = { origin: () => originValue, linkKey: () => keyBox.v, mailer: { configured: () => configured, send: async m => { calls.push({ name: 'MAIL' }); mailed.push(m); return typeof mail === 'function' ? mail(m) : mail; } } };
 const mod = load('server/services/platform-provisioning.ts', { 'server-only': {}, 'node:crypto': crypto, '@/server/services/invitation-delivery': { productionInvitationDeps: () => deps, deriveInvitationSecret: delivery.deriveInvitationSecret }, '@/shared/invitation-link': linkLib, '@/shared/contracts/platform-provisioning': contract });
 return { ...mod, client, calls, mailed, db, keyBox, svc: mod.platformProvisioningService(client, deps), names: () => calls.map(c => c.name) };
}
function require_delivery() { return load('server/services/invitation-delivery.ts', { 'server-only': {}, 'node:crypto': crypto, resend: { Resend: class {} }, '@/shared/public-website': publicWebsite }); }
const provisionInput = () => contract.provisionTeacherRequest.parse({ teacherEmail: 'a@example.test', expiresInDays: 7, systems: [{ label: 'S', grades: [{ key: 'g', label: 'G' }] }], subjects: [{ key: 's', label: 'Sub' }], course: { title: 'C', gradeKey: 'g', subjectKey: 's' } });

test('service: a missing origin, link key or mailer stops before any database change and names the reason', async () => {
 const noOrigin = harness({ originValue: null });
 for (const run of [() => noOrigin.svc.provision(provisionInput()), () => noOrigin.svc.reissue(uuid(1), 7), () => noOrigin.svc.sendEmail(uuid(1)), () => noOrigin.svc.copyLink(uuid(1))])
  await assert.rejects(run(), e => e.status === 503 && e.reason === 'origin_not_configured');
 assert.deepEqual(noOrigin.calls, [], 'nothing was written');
 const noKey = harness({ keyValue: null });
 for (const run of [() => noKey.svc.provision(provisionInput()), () => noKey.svc.reissue(uuid(1), 7), () => noKey.svc.sendEmail(uuid(1)), () => noKey.svc.copyLink(uuid(1))])
  await assert.rejects(run(), e => e.status === 503 && e.reason === 'link_key_not_configured');
 assert.deepEqual(noKey.calls, [], 'without the server key no link is created, rotated or recorded');
 const noMail = harness({ configured: false });
 await assert.rejects(noMail.svc.sendEmail(uuid(1)), e => e.status === 503 && e.reason === 'email_not_configured');
 assert.deepEqual(noMail.calls, [], 'no status was recorded');
 await noMail.svc.reissue(uuid(1), 7); const copied = await noMail.svc.copyLink(uuid(1));
 assert.match(copied.invitationLink, /^https:\/\/staging\.example\.test\/teacher-invitation#/, 'copying a link still works without e-mail');
});
test('link key: a short or missing key is "not configured"; the secret is a deterministic 43-character function of key and salt', () => {
 const d = require_delivery();
 assert.equal(d.invitationLinkKey({}), null); assert.equal(d.invitationLinkKey({ INVITATION_LINK_KEY: 'short' }), null); assert.equal(d.invitationLinkKey({ INVITATION_LINK_KEY: ' ' + linkKey + ' ' }), linkKey);
 const salt = crypto.randomBytes(16).toString('hex');
 assert.equal(d.deriveInvitationSecret(linkKey, salt), d.deriveInvitationSecret(linkKey, salt)); assert.match(d.deriveInvitationSecret(linkKey, salt), /^[A-Za-z0-9_-]{43}$/);
 assert.notEqual(d.deriveInvitationSecret(linkKey, salt), d.deriveInvitationSecret('j'.repeat(40), salt), 'a different key gives a different link');
 assert.notEqual(d.deriveInvitationSecret(linkKey, salt), d.deriveInvitationSecret(linkKey, crypto.randomBytes(16).toString('hex')), 'a different salt gives a different link');
});
test('service: Send then Copy use the SAME link, and neither rotates anything', async () => {
 const h = harness(); const issued = await h.svc.reissue(uuid(1), 7);
 const firstId = h.db.invitations[0].id; assert.equal(issued.reusable, true);
 const sent = await h.svc.sendEmail(uuid(1)); const copied = await h.svc.copyLink(uuid(1));
 assert.equal(h.mailed[0].link, copied.invitationLink, 'the e-mailed link and the copied link are identical');
 assert.equal(copied.invitationLink, issued.invitationLink, 'and identical to the link shown when it was created');
 assert.equal(sent.invitationId, firstId); assert.equal(copied.invitationId, firstId);
 assert.equal(h.calls.filter(c => c.name === 'platform_reissue_teacher_invitation').length, 1, 'only the explicit replacement ever rotated');
 const again = await h.svc.copyLink(uuid(1)); assert.equal(again.invitationLink, copied.invitationLink, 'copying twice, or after a reload, gives the same link');
 assert.equal(sha(secretOf(copied.invitationLink)), h.db.invitations[0].hash, 'the link still hashes to the only value the database holds');
});
test('service: an e-mail that timed out is not invalidated by Copy or by sending again', async () => {
 const h = harness({ mail: { outcome: 'unconfirmed' } }); await h.svc.reissue(uuid(1), 7);
 const out = await h.svc.sendEmail(uuid(1)); assert.equal(out.delivery, 'unconfirmed');
 const copied = await h.svc.copyLink(uuid(1)); assert.equal(copied.invitationLink, h.mailed[0].link, 'the unconfirmed e-mail may have arrived, and its link still works');
 const second = await h.svc.sendEmail(uuid(1)); assert.equal(h.mailed[1].link, h.mailed[0].link, 'sending again re-sends the same link');
 assert.equal(out.attempt, 1); assert.equal(second.attempt, 2); assert.notEqual(h.mailed[1].idempotencyKey, h.mailed[0].idempotencyKey, 'a deliberate second send is a new provider request');
 assert.equal(h.calls.filter(c => c.name === 'platform_reissue_teacher_invitation').length, 1);
});
test('service: only an explicit replacement invalidates the old link, and the old secret no longer matches anything the database holds', async () => {
 const h = harness(); const first = await h.svc.reissue(uuid(1), 7); await h.svc.sendEmail(uuid(1));
 const replacement = await h.svc.reissue(uuid(1), 7);
 assert.notEqual(replacement.invitationLink, first.invitationLink); assert.notEqual(replacement.invitationId, first.invitationId);
 assert.equal(h.db.invitations.find(i => i.hash === sha(secretOf(first.invitationLink))).status, 'superseded', 'the previous token is superseded');
 assert.equal(h.db.invitations.filter(i => i.status === 'pending').length, 1);
 const copied = await h.svc.copyLink(uuid(1)); assert.equal(copied.invitationLink, replacement.invitationLink, 'Copy now returns the replacement');
 assert.equal(h.db.invitations[0].attempts, 0, 'the replacement starts with no delivery attempts');
});
test('service: Copy refuses, without creating anything, when there is no stored link to reuse', async () => {
 const h = harness(); await assert.rejects(h.svc.copyLink(uuid(1)), e => e.status === 409 && e.reason === 'no_active_invitation');
 const lostSalt = harness({ failSalt: true }); const issued = await lostSalt.svc.reissue(uuid(1), 7); assert.equal(issued.reusable, false, 'the link is shown once but is honestly marked as not reusable');
 await assert.rejects(lostSalt.svc.copyLink(uuid(1)), e => e.reason === 'no_active_invitation');
 await assert.rejects(lostSalt.svc.sendEmail(uuid(1)), e => e.reason === 'no_active_invitation'); assert.equal(lostSalt.mailed.length, 0);
 assert.equal(lostSalt.calls.filter(c => c.name === 'platform_reissue_teacher_invitation').length, 1, 'nothing was rotated to compensate');
});
test('service: a changed link key is detected: Copy and Send refuse and send nothing instead of handing out a dead link', async () => {
 const h = harness(); await h.svc.reissue(uuid(1), 7); h.keyBox.v = rotatedKey; h.calls.length = 0;
 await assert.rejects(h.svc.copyLink(uuid(1)), e => e.status === 409 && e.reason === 'link_key_changed');
 await assert.rejects(h.svc.sendEmail(uuid(1)), e => e.reason === 'link_key_changed'); assert.equal(h.mailed.length, 0);
 assert.equal(h.calls.some(c => c.name === 'platform_record_invitation_delivery'), false, 'no attempt was recorded');
 assert.equal(h.calls.some(c => c.name === 'platform_reissue_teacher_invitation'), false, 'nothing was rotated to compensate');
 h.keyBox.v = linkKey; assert.match((await h.svc.copyLink(uuid(1))).invitationLink, /#[A-Za-z0-9_-]{43}$/, 'restoring the key restores Copy');
 const replaced = harness(); await replaced.svc.reissue(uuid(1), 7); replaced.keyBox.v = rotatedKey; const fresh = await replaced.svc.reissue(uuid(1), 7);
 assert.equal((await replaced.svc.copyLink(uuid(1))).invitationLink, fresh.invitationLink, 'Replace under the new key works and Copy follows it');
});
test('service: the database never receives a secret or a key, only the hash and a non-secret salt', async () => {
 const h = harness(); const out = await h.svc.provision(provisionInput()); const secret = secretOf(out.invitationLink); await h.svc.sendEmail(uuid(1)); await h.svc.copyLink(uuid(1));
 const seen = JSON.stringify(h.calls.filter(c => c.name !== 'MAIL'));
 assert.doesNotMatch(seen, new RegExp(secret)); assert.doesNotMatch(seen, new RegExp(linkKey));
 const stored = h.calls.find(c => c.name === 'platform_provision_teacher').args.p_token_hash; assert.equal(stored, sha(secret));
 const salt = h.calls.find(c => c.name === 'platform_store_invitation_salt').args.p_salt; assert.match(salt, /^[0-9a-f]{32}$/);
 assert.notEqual(salt, secret); assert.equal(require_delivery().deriveInvitationSecret(linkKey, salt), secret, 'salt + the server key reproduce the link');
});
test('service: sending records "sending" first, e-mails the address stored in the database, then records the provider verdict', async () => {
 const h = harness(); await h.svc.reissue(uuid(1), 7); h.calls.length = 0; const out = await h.svc.sendEmail(uuid(1));
 assert.deepEqual(JSON.parse(JSON.stringify(out)), { organizationId: uuid(1), invitationId: uuid(2), expiresAt: '2030-01-09T00:00:00Z', attempt: 1, delivery: 'sent', statusSaved: true });
 assert.deepEqual(h.names(), ['platform_invitation_delivery', 'platform_invitation_link', 'platform_portal_detail', 'platform_invitation_delivery', 'platform_record_invitation_delivery', 'MAIL', 'platform_record_invitation_delivery']);
 const records = h.calls.filter(c => c.name === 'platform_record_invitation_delivery').map(c => c.args);
 assert.deepEqual(records.map(r => r.p_status), ['sending', 'sent']); assert.equal(records[1].p_provider_ref, 'msg_1');
 assert.equal(h.mailed.length, 1); assert.equal(h.mailed[0].to, 'recipient@example.test', 'recipient comes from the stored invitation');
 assert.equal(h.mailed[0].idempotencyKey, uuid(2) + '-1'); assert.equal(h.calls.some(c => c.name === 'platform_reissue_teacher_invitation'), false, 'sending never replaces the invitation');
 assert.equal(Object.prototype.hasOwnProperty.call(out, 'invitationLink'), false, 'the link is not returned when it was e-mailed');
 assert.doesNotMatch(JSON.stringify(h.calls.filter(c => c.name !== 'MAIL')), new RegExp(secretOf(h.mailed[0].link)), 'the secret reaches only the mailer');
});
test('service: without the delivery migration sending is refused before anything is sent', async () => {
 const h = harness(); await h.svc.reissue(uuid(1), 7); const original = h.client.rpc; h.client.rpc = async (name, args) => name === 'platform_invitation_delivery' ? { data: null, error: { code: 'PGRST202' } } : original(name, args);
 await assert.rejects(h.svc.sendEmail(uuid(1)), e => e.status === 503 && e.reason === 'unavailable'); assert.equal(h.mailed.length, 0);
});
test('rollback: the delivery migration ships a data-guarded rollback and the migration is pinned like the other reviewed ones', () => {
 const rollback = read('supabase/manual/rollback_teacher_invitation_delivery.sql');
 assert.match(rollback, /refusing to discard/); assert.match(rollback, /link_salt is not null/); assert.match(rollback, /drop column link_salt/); assert.match(rollback, /platform_invitation_link/);
 assert.match(read('.gitattributes'), /20261025100000_teacher_invitation_delivery.sql -text/);
 const migration = read('supabase/migrations/20261025100000_teacher_invitation_delivery.sql');
 assert.doesNotMatch(migration, /\b(token|secret)\b\s+text/i, 'the migration adds no column that could hold a secret'); assert.match(migration, /link_salt bytea/);
});
test('service: a provider refusal is recorded as failed; no verdict stays unconfirmed and is not guessed or retried', async () => {
 const rejected = harness({ mail: { outcome: 'rejected' } }); await rejected.svc.reissue(uuid(1), 7); const r = await rejected.svc.sendEmail(uuid(1));
 assert.equal(r.delivery, 'failed'); assert.equal(r.statusSaved, true);
 const last = rejected.calls.at(-1).args; assert.equal(last.p_status, 'failed'); assert.equal(last.p_failure, 'rejected');
 const unknown = harness({ mail: { outcome: 'unconfirmed' } }); await unknown.svc.reissue(uuid(1), 7); const u = await unknown.svc.sendEmail(uuid(1));
 assert.equal(u.delivery, 'unconfirmed'); assert.equal(unknown.mailed.length, 1, 'sent once, never retried');
 assert.deepEqual(unknown.calls.filter(c => c.name === 'platform_record_invitation_delivery').map(c => c.args.p_status), ['sending'], 'left as sending (unconfirmed), not promoted to sent or failed');
});
test('service: if "sending" cannot be recorded nothing is mailed; if the verdict cannot be saved the verdict is still reported', async () => {
 const blocked = harness({ failRecord: 'sending' }); await blocked.svc.reissue(uuid(1), 7);
 await assert.rejects(blocked.svc.sendEmail(uuid(1)), e => e.status === 503); assert.equal(blocked.mailed.length, 0);
 const lost = harness({ failRecord: 'sent' }); await lost.svc.reissue(uuid(1), 7); const out = await lost.svc.sendEmail(uuid(1));
 assert.equal(out.delivery, 'sent'); assert.equal(out.statusSaved, false); assert.equal(lost.mailed.length, 1);
});
test('service: provision and reissue return a link on the configured origin and never a bare secret', async () => {
 const h = harness(); const r = await h.svc.reissue(uuid(1), 7, 'other@example.test');
 assert.equal(r.invitationSecret, undefined); assert.equal(r.delivery, 'not_sent'); assert.match(r.invitationLink, new RegExp('^' + origin.replace(/\./g, '\\.') + '/teacher-invitation#[A-Za-z0-9_-]{43}$'));
 assert.equal(h.calls[0].args.p_email, 'other@example.test'); assert.equal(h.mailed.length, 0, 'creating a link never mails');
});
test('service: detail carries per-invitation delivery status and tolerates a database without the delivery migration', async () => {
 const h = harness(); await h.svc.reissue(uuid(1), 7); const d = await h.svc.detail(uuid(1)); assert.deepEqual(JSON.parse(JSON.stringify(d.invitations[0].delivery)), { status: 'not_sent', attemptedAt: null, failure: null, attempts: 0 });
 const old = harness(); await old.svc.reissue(uuid(1), 7); const original = old.client.rpc; old.client.rpc = async (name, args) => name === 'platform_invitation_delivery' ? { data: null, error: { code: 'PGRST202' } } : original(name, args);
 const fallback = await old.svc.detail(uuid(1)); assert.equal(fallback.invitations[0].delivery.status, 'not_sent');
});
test('service: preview sends only the hash and returns what the database says', async () => {
 const h = harness(); const secret = token();
 const out = await h.previewTeacherInvitation(h.client, secret); assert.equal(out.state, 'valid');
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ name: 'teacher_invitation_preview', args: { p_token_hash: crypto.createHash('sha256').update(secret).digest('hex') } }]);
 const denied = harness(); denied.client.rpc = async () => ({ data: null, error: { code: '42501', message: 'Invitation unavailable' } });
 await assert.rejects(denied.previewTeacherInvitation(denied.client, secret), e => e.status === 403 && !/Invitation unavailable/.test(e.message));
});
test('no server or browser file for this feature logs, so secrets cannot reach logs', () => {
 for (const f of ['server/services/invitation-delivery.ts', 'server/services/platform-provisioning.ts', 'server/http/platform-admin-portals.ts', 'frontend/lib/teacher-invitation-storage.ts', 'frontend/features/teacher-invitation/invitation-view.tsx', 'frontend/features/platform-admin/portal-view.tsx'])
  assert.doesNotMatch(code(f), /console\.|logger\.|sentry|analytics|gtag|posthog/i, f);
});

// --- HTTP ---------------------------------------------------------------------------------------------------------------------
function http({ status = 'ok', originOk = true, staging = true, viewer = { backend: 'firebase' }, previewImpl, acceptImpl } = {}) {
 const calls = [];
 class Response { constructor(body, init) { this.body = body; this.status = init?.status ?? 200; this.headers = init?.headers ?? {}; } }
 const service = { sendEmail: async (...a) => { calls.push(['sendEmail', ...a]); return { delivery: 'sent', statusSaved: true }; }, copyLink: async (...a) => { calls.push(['copyLink', ...a]); return { invitationLink: 'x' }; }, reissue: async () => ({}), revoke: async () => ({}), detail: async () => ({}), overview: async () => ({}), provision: async () => ({}) };
 const mod = load('server/http/platform-admin-portals.ts', {
  'server-only': {}, 'next/server': { NextResponse: { json: (body, init) => new Response(body, init) }, NextRequest: class {} }, '@/shared/contracts/platform-provisioning': contract,
  '@/server/services/platform-admin': { getPlatformAdminAccess: async () => { calls.push(['access']); return status === 'ok' ? { status, client: {}, viewer: {} } : { status }; } },
  '@/server/services/platform-provisioning': { platformProvisioningService: () => service, acceptTeacherInvitation: async (_c, t) => { calls.push(['accept', t]); if (acceptImpl) throw acceptImpl; return { organizationId: uuid(9) }; },
   previewTeacherInvitation: async (_c, t) => { calls.push(['preview', t]); if (previewImpl) throw previewImpl; return { state: 'valid', emailVerified: true, emailMatches: true, acceptedByMe: false, maskedEmail: 'a***@example.test' }; } },
  '@/server/http/firebase/route': { validFirebaseOrigin: () => originOk }, '@/server/services/application-auth': { getApplicationViewer: async () => viewer },
  '@/server/integrations/supabase': { getSupabaseServerClient: async () => ({}) }, '@/shared/auth-config': { isFirebaseStaging: () => staging },
 });
 return { mod, calls };
}
const req = (method, body, { url = 'https://app.example.test/api/teacher-invitations/preview', type = 'application/json' } = {}) => ({ method, url, headers: { get: k => ({ 'content-type': type })[k.toLowerCase()] ?? null },
 body: body === undefined ? null : { getReader() { const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); let done = false; return { read: async () => done ? { done: true } : (done = true, { done: false, value: new Uint8Array(bytes) }), cancel: async () => {} }; } } });

test('HTTP preview: needs staging, exact origin, a signed-in Firebase viewer and a well-formed token; responses are never cached or indexed', async () => {
 const t = token();
 assert.equal((await http({ staging: false }).mod.previewTeacherInvitationHTTP(req('POST', { token: t }))).status, 404);
 const cross = http({ originOk: false }); assert.equal((await cross.mod.previewTeacherInvitationHTTP(req('POST', { token: t }))).status, 403); assert.deepEqual(cross.calls, []);
 assert.equal((await http().mod.previewTeacherInvitationHTTP(req('GET'))).status, 403);
 for (const viewer of [null, { backend: 'clerk' }]) { const h = http({ viewer }); assert.equal((await h.mod.previewTeacherInvitationHTTP(req('POST', { token: t }))).status, 401); assert.deepEqual(h.calls, []); }
 for (const bad of [{}, { token: 'short' }, { token: t, email: 'x@example.test' }, { token: t + 'x' }, { token: 5 }]) { const h = http(); assert.equal((await h.mod.previewTeacherInvitationHTTP(req('POST', bad))).status, 400); assert.equal(h.calls.length, 0); }
 assert.equal((await http().mod.previewTeacherInvitationHTTP(req('POST', { token: t }, { url: 'https://app.example.test/api/teacher-invitations/preview?token=' + t }))).status, 400, 'a secret in the query string is refused');
 assert.equal((await http().mod.previewTeacherInvitationHTTP(req('POST', { token: t }, { type: 'text/plain' }))).status, 415);
 const h = http(); const ok = await h.mod.previewTeacherInvitationHTTP(req('POST', { token: t }));
 assert.equal(ok.status, 200); assert.deepEqual(h.calls, [['preview', t]]);
 assert.equal(ok.headers['Cache-Control'], 'private, no-store'); assert.equal(ok.headers['X-Robots-Tag'], 'noindex, nofollow'); assert.equal(ok.headers['Referrer-Policy'], 'no-referrer');
 const failing = http({ previewImpl: Object.assign(new Error('Invitation unavailable'), { status: 403, reason: 'forbidden' }) });
 const f = await failing.mod.previewTeacherInvitationHTTP(req('POST', { token: t })); assert.equal(f.status, 403); assert.doesNotMatch(JSON.stringify(f.body), new RegExp(t));
 const odd = http({ previewImpl: new Error('connect ECONNREFUSED 10.0.0.1:5432 token=' + t) });
 const o = await odd.mod.previewTeacherInvitationHTTP(req('POST', { token: t })); assert.equal(o.status, 503); assert.doesNotMatch(JSON.stringify(o.body), /ECONNREFUSED|10\.0\.0\.1/);
});
test('HTTP accept: the same gates, the explicit POST is the only way to consume a token, and errors never echo it', async () => {
 const t = token(), url = 'https://app.example.test/api/teacher-invitations/accept';
 const h = http(); const ok = await h.mod.acceptTeacherInvitationHTTP(req('POST', { token: t }, { url })); assert.equal(ok.status, 200); assert.deepEqual(h.calls, [['accept', t]]);
 assert.equal(ok.headers['Cache-Control'], 'private, no-store');
 assert.equal((await http({ viewer: null }).mod.acceptTeacherInvitationHTTP(req('POST', { token: t }, { url }))).status, 401);
 assert.equal((await http({ originOk: false }).mod.acceptTeacherInvitationHTTP(req('POST', { token: t }, { url }))).status, 403);
 for (const [status, reason] of [[409, 'used'], [410, 'gone'], [403, 'forbidden']]) {
  const e = http({ acceptImpl: Object.assign(new Error('The invitation is no longer valid.'), { status, reason }) });
  const r = await e.mod.acceptTeacherInvitationHTTP(req('POST', { token: t }, { url })); assert.equal(r.status, status); assert.equal(r.body.reason, reason); assert.doesNotMatch(JSON.stringify(r.body), new RegExp(t));
 }
});
test('HTTP admin: send_email and copy_link are administrator POSTs with no body fields: no recipient, no lifetime, no rotation', async () => {
 const url = 'https://app.example.test/api/platform-admin/portals/' + uuid(1);
 for (const action of ['send_email', 'copy_link']) {
  for (const st of ['anonymous', 'forbidden', 'unavailable']) { const h = http({ status: st }); await h.mod.platformPortalHTTP(req('POST', { action }, { url }), uuid(1)); assert.deepEqual(h.calls.map(c => c[0]), ['access']); }
  const h = http(); const r = await h.mod.platformPortalHTTP(req('POST', { action }, { url }), uuid(1));
  assert.equal(r.status, 200); assert.deepEqual(h.calls.map(c => c[0]), ['access', action === 'send_email' ? 'sendEmail' : 'copyLink']); assert.deepEqual(h.calls[1].slice(1), [uuid(1)]);
  for (const bad of [{ action, expiresInDays: 7 }, { action, teacherEmail: 'other@example.test' }, { action, to: 'x@example.test' }]) {
   const e = http(); assert.equal((await e.mod.platformPortalHTTP(req('POST', bad, { url }), uuid(1))).status, 400, JSON.stringify(bad)); assert.equal(e.calls.some(c => c[0] === 'sendEmail' || c[0] === 'copyLink'), false);
  }
  const cross = http({ originOk: false }); assert.equal((await cross.mod.platformPortalHTTP(req('POST', { action }, { url }), uuid(1))).status, 403); assert.deepEqual(cross.calls, []);
 }
});
test('HTTP failures: configuration problems are reported by reason with their status, not as a generic outage', () => {
 const src = read('server/services/platform-provisioning.ts');
 assert.match(src, /email_not_configured/); assert.match(src, /origin_not_configured/); assert.match(src, /link_key_not_configured/); assert.match(src, /no_active_invitation/);
 assert.match(code('server/http/platform-admin-portals.ts'), /\[400, 403, 404, 409, 410, 503\]/);
});

// --- browser-side invitation storage -----------------------------------------------------------------------------------------
function storage({ localBroken = false, sessionBroken = false } = {}) {
 const make = (broken) => { const map = new Map(); return { getItem: k => { if (broken) throw Error('blocked'); return map.has(k) ? map.get(k) : null; }, setItem: (k, v) => { if (broken) throw Error('blocked'); map.set(k, String(v)); }, removeItem: k => { if (broken) throw Error('blocked'); map.delete(k); }, map }; };
 const local = make(localBroken), session = make(sessionBroken);
 const mod = load('frontend/lib/teacher-invitation-storage.ts', { '@/shared/invitation-link': linkLib }, { window: { localStorage: local, sessionStorage: session } });
 return { mod, local, session };
}
test('storage: the invitation survives sign-in for a short time, is validated on read, and can be cleared', () => {
 const { mod, local } = storage(); const t = token(), now = 1_000_000;
 assert.equal(mod.readInvitationToken(now), null); assert.equal(mod.saveInvitationToken(t, now), true);
 assert.equal(mod.readInvitationToken(now + 60_000), t); assert.equal(mod.hasPendingInvitation(), false, 'real clock is far past the fixed test time');
 assert.equal(mod.readInvitationToken(now + 2 * 60 * 60 * 1000), null, 'expired after two hours'); assert.equal(local.map.size, 0, 'expired entries are removed');
 mod.saveInvitationToken(t, now); mod.clearInvitationToken(); assert.equal(mod.readInvitationToken(now), null);
 local.map.set('edulabs-teacher-invitation', JSON.stringify({ token: 'not-a-token', savedAt: now })); assert.equal(mod.readInvitationToken(now), null);
 local.map.set('edulabs-teacher-invitation', '{broken'); assert.equal(mod.readInvitationToken(now), null);
 local.map.set('edulabs-teacher-invitation', JSON.stringify({ token: t, savedAt: now + 10_000 })); assert.equal(mod.readInvitationToken(now), null, 'a timestamp from the future is rejected');
});
test('storage: a blocked store degrades to the other one, and to "not saved" rather than throwing', () => {
 const t = token();
 const a = storage({ localBroken: true }); assert.equal(a.mod.saveInvitationToken(t, 5), true); assert.equal(a.mod.readInvitationToken(6), t);
 const b = storage({ localBroken: true, sessionBroken: true }); assert.equal(b.mod.saveInvitationToken(t, 5), false); assert.equal(b.mod.readInvitationToken(6), null); b.mod.clearInvitationToken();
});

// --- wiring checks -----------------------------------------------------------------------------------------------------------
test('wiring: the page is public to the middleware only for the exact path, with no-store, noindex and no referrer; the endpoints are allow-listed', () => {
 const mw = read('middleware.ts');
 assert.match(mw, /path === '\/teacher-invitation'\) \{[^}]*Referrer-Policy','no-referrer'[^}]*Cache-Control','private, no-store'[^}]*X-Robots-Tag','noindex, nofollow'/);
 assert.match(mw, /path === '\/api\/teacher-invitations\/accept' \|\| path === '\/api\/teacher-invitations\/preview'/);
 assert.equal(read('app/api/teacher-invitations/preview/route.ts').trim(), "export { previewTeacherInvitationHTTP as POST } from '@/server/http/platform-admin-portals';");
 const layout = read('app/teacher-invitation/layout.tsx'); assert.match(layout, /robots: \{ index: false, follow: false \}/); assert.match(layout, /referrer: 'no-referrer'/);
 assert.match(read('app/teacher-invitation/page.tsx'), /isFirebaseStaging\(\)\) notFound\(\)/);
});
test('wiring: the existing sign-in flow returns to the invitation page and nowhere new; the shared student contract is untouched', () => {
 const form = read('frontend/features/auth/firebase-form.tsx');
 assert.match(form, /if\(raw===invitationPagePath\)return invitationPagePath;/);
 assert.match(form, /destination==='\/home'&&hasPendingInvitation\(\)\?invitationPagePath:destination/);
 assert.match(form, /router\.replace\(destination\)/); assert.doesNotMatch(form, /teacher-invitation#|\.hash/, 'the form never handles the secret');
 const git = require('node:child_process');
 try { git.execFileSync('git', ['cat-file', '-e', 'fa67875fdab88f0fc640804e2f96b6aa7c44b0c1^{commit}'], { stdio: 'ignore' }); } catch { return; }
 assert.equal(git.execFileSync('git', ['diff', 'fa67875fdab88f0fc640804e2f96b6aa7c44b0c1', '--', 'shared/contracts/student-administration.ts'], { encoding: 'utf8' }), '');
});
test('wiring: the invitation view puts the secret away from the URL, accepts only on an explicit click, and never resends after an unknown outcome', () => {
 const view = read('frontend/features/teacher-invitation/invitation-view.tsx');
 assert.match(view, /history\.replaceState\(null, '', window\.location\.pathname\)/);
 assert.match(view, /onClick=\{\(\) => void accept\(\)\}/); assert.equal((view.match(/'\/api\/teacher-invitations\/accept'/g) || []).length, 1);
 assert.match(view, /result\.status === 0 \|\| result\.status >= 500\) \{ setPhase\(\{ name: 'unknown' \}\)/);
 assert.match(view, /if \(!token \|\| accepting\.current\) return;/);
 assert.doesNotMatch(view, /localStorage|sessionStorage|document\.cookie|navigator\.sendBeacon|console\./, 'storage goes through the reviewed helper');
 assert.doesNotMatch(view, /\?token=|\?invitation=/);
});
test('copy: the teacher-facing page exists in English and Arabic, says "teaching space", and never uses portal or ownership wording', () => {
 const { messages } = localization.load('frontend/locales/messages.ts');
 const keys = Object.keys(messages.en).filter(k => k.startsWith('ti.'));
 assert.ok(keys.length >= 43, 'teacher page strings exist'); assert.deepEqual(Object.keys(messages.ar).filter(k => k.startsWith('ti.')).sort(), keys.sort());
 for (const k of keys) { assert.ok(messages.en[k] && messages.ar[k], k); assert.doesNotMatch(messages.en[k], /portal|owner|organi[sz]ation/i, k); assert.equal((messages.en[k].match(/\{[a-z]+\}/g) || []).join(), (messages.ar[k].match(/\{[a-z]+\}/g) || []).join(), 'placeholders match: ' + k); }
 const view = read('frontend/features/teacher-invitation/invitation-view.tsx');
 for (const used of new Set([...view.matchAll(/'(ti\.[a-z_.]+)'/g)].map(m => m[1]))) assert.ok(messages.en[used], 'defined: ' + used);
 for (const k of ['pa.err.link_key_changed', 'pa.err.email_not_configured', 'pa.err.origin_not_configured', 'pa.portal.send_email', 'pa.portal.copy_link', 'pa.delivery.sent_note', 'pa.delivery.sending_note']) assert.ok(messages.en[k] && messages.ar[k], k);
 assert.equal(messages.en['ti.valid.text'], 'Accepting gives you your own teaching space on EduLabs, where you can set up your courses. Accept only if you expected this invitation.');
 assert.doesNotMatch(Object.entries(messages.en).filter(([k]) => k.startsWith('ti.')).map(([, v]) => v).join(' '), /you become the owner/i);
 assert.match(messages.en['pa.err.link_key_not_configured'], /INVITATION_LINK_KEY/); assert.match(messages.en['pa.portal.share_hint'], /Only .Replace invitation. creates a new link/);
 assert.match(messages.en['pa.err.email_not_configured'], /RESEND_API_KEY/); assert.match(messages.en['pa.err.email_not_configured'], /INVITATION_EMAIL_FROM/); assert.match(messages.en['pa.err.origin_not_configured'], /APP_ORIGIN/);
 assert.match(messages.en['pa.delivery.sent_note'], /not proof/i, 'sent is never presented as delivered to the inbox');
});
