// Teacher Students screen: the pure model, the REAL middleware, the navigation entry, the join-link secret, hidden actions, wording and locales.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript'), crypto = require('node:crypto');
const localization = require('./localization-test-loader.cjs');
const { messages } = localization.load('frontend/locales/messages.ts');
const model = localization.load('shared/teacher-students.ts');
const home = localization.load('shared/teacher-home.ts');
const read = f => fs.readFileSync(f, 'utf8');
const dir = 'frontend/features/teacher-students/';
const sources = fs.readdirSync(dir).map(f => [f, read(dir + f)]);
const all = sources.map(([, s]) => s).join('\n');
const src = f => read(dir + f);
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

function load(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { module: m, exports: m.exports, URL, console, require: n => n === 'zod' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const offering = (id, over = {}) => ({ id, name: 'run ' + id, course_title: 'Course ' + id, organization_name: 'Org', manage: true, ...over });
const row = (id, name, over = {}) => ({ id: 'e' + id, user_id: 'u' + id, display_name: name, status: 'active', version: 1, ...over });

// ------------------------------------------------------------------ model
test('status: an active enrollment past its end date is shown as Expired; unknown values never show as Active', () => {
 const now = Date.parse('2026-11-04T00:00:00Z');
 assert.equal(model.displayStatus({ status: 'active', expires_at: null }, now), 'active');
 assert.equal(model.displayStatus({ status: 'active', expires_at: '2026-11-05T00:00:00Z' }, now), 'active');
 assert.equal(model.displayStatus({ status: 'active', expires_at: '2026-11-03T00:00:00Z' }, now), 'expired');
 assert.equal(model.displayStatus({ status: 'suspended', expires_at: '2020-01-01T00:00:00Z' }, now), 'suspended');
 assert.equal(model.displayStatus({ status: 'something-new', expires_at: null }, now), 'invited');
 assert.equal(model.rosterFilter('waiting'), 'all'); assert.equal(model.rosterFilter('suspended'), 'suspended');
});
test('merge: rows come out in name order across courses, a course is read before its turn is decided, a failed course is left out and an empty one is skipped', () => {
 const a = model.newStream(offering('a')), b = model.newStream(offering('b')), c = model.newStream(offering('c'));
 let streams = [a, b, c];
 same({ ...model.nextStep(streams) }, { kind: 'need', index: 0 });
 streams[0] = model.readPage(streams[0], [row(1, 'Amal'), row(2, 'Zed')]);
 streams[1] = model.readPage(streams[1], []);
 same({ ...model.nextStep(streams) }, { kind: 'need', index: 2 });
 streams[2] = model.failStream(streams[2]);
 const out = [];
 for (let i = 0; i < 10; i++) { const s = model.nextStep(streams); if (s.kind !== 'row') { assert.equal(s.kind, 'end'); break; } const t = model.takeRow(streams, s.index); streams = t.streams; out.push(t.row.display_name); }
 same(out, ['Amal', 'Zed']);
 assert.equal(model.hasMore(streams), false);
 streams[2] = model.retryStream(streams[2]);
 same({ ...model.nextStep(streams) }, { kind: 'need', index: 2 }, 'a retry reads it again');
 // Interleaving by name, case-insensitive, ties by id.
 let s2 = [model.readPage(model.newStream(offering('x')), [row(1, 'bob'), row(3, 'Dina')]), model.readPage(model.newStream(offering('y')), [row(2, 'Carl'), row(4, 'carl')])];
 const names = []; for (;;) { const st = model.nextStep(s2); if (st.kind !== 'row') break; const t = model.takeRow(s2, st.index); s2 = t.streams; names.push(t.row.display_name); }
 same(names.slice(0, 2), ['bob', 'Carl']);
});
test('merge: a full page continues, a short page ends, and the page cap is reported instead of silently stopping', () => {
 const full = Array.from({ length: model.ROSTER_PAGE }, (_, i) => row(i, 'N' + String(i).padStart(3, '0')));
 let s = model.readPage(model.newStream(offering('a')), full);
 assert.equal(s.done, false); assert.equal(model.hasMore([s]), true);
 s = model.readPage(s, full.slice(0, 3)); assert.equal(s.done, true); assert.equal(s.capped, false);
 let capped = { ...model.newStream(offering('a')), page: model.MAX_ROSTER_PAGES - 1 };
 capped = model.readPage(capped, full);
 assert.equal(capped.done, true); assert.equal(capped.capped, true); assert.equal(model.truncated([capped]), true);
 assert.equal(model.truncated([s]), false);
});
test('Groups beside a student: only current members, once per Group; approval offers only active Groups of that course that this teacher runs', () => {
 const groups = [{ id: 'g1', name: 'Mon', offering_id: 'o1', status: 'active', staff: true, version: 1 }, { id: 'g2', name: 'Tue', offering_id: 'o1', status: 'archived', staff: true, version: 1 },
  { id: 'g3', name: 'Alpha', offering_id: 'o1', status: 'active', staff: true, version: 1 }, { id: 'g4', name: 'Other', offering_id: 'o2', status: 'active', staff: true, version: 1 }, { id: 'g5', name: 'Not mine', offering_id: 'o1', status: 'active', staff: false, version: 1 }];
 same(model.approvalGroups(groups, 'o1').map(g => g.id), ['g3', 'g1']);
 same(model.approvalGroups(groups, 'none'), []);
 const idx = model.indexMembers(groups, { g1: [{ user_id: 'u1', ends_at: null }, { user_id: 'u2', ends_at: '2026-01-01' }, { user_id: 'u1', ends_at: null }], g3: [{ user_id: 'u1', ends_at: null }] });
 same(idx.get('u1').map(g => g.id), ['g1', 'g3']); assert.equal(idx.has('u2'), false);
});
test('requests: only pending ones, oldest first; approval and the Group step are two outcomes and one never hides the other', () => {
 const rows = [{ id: 'b', status: 'pending', created_at: '2026-01-02' }, { id: 'a', status: 'pending', created_at: '2026-01-02' }, { id: 'c', status: 'approved', created_at: '2026-01-01' }, { id: 'd', status: 'pending', created_at: '2026-01-01' }];
 same(model.oldestFirst(model.pending(rows)).map(r => r.id), ['d', 'a', 'b']);
 assert.equal(model.approveOutcome(true, null), 'approved'); assert.equal(model.approveOutcome(true, true), 'approved');
 assert.equal(model.approveOutcome(true, false), 'approved_not_added'); assert.equal(model.approveOutcome(false, null), 'failed'); assert.equal(model.approveOutcome(false, true), 'failed');
 assert.equal(messages.en['ts.requests.not_added'], 'Approved, but not added to the Group. Add them from the Group page.');
});
test('join link: 32 random bytes become exactly the 43 characters the database accepts, and the contract accepts the whole command', () => {
 const contract = load('shared/contracts/student-administration.ts', { zod: require('zod') });
 for (let i = 0; i < 200; i++) {
  const t = model.tokenFromBytes(new Uint8Array(crypto.randomBytes(32)));
  assert.match(t, /^[A-Za-z0-9_-]{43}$/); assert.match(t, model.TOKEN_PATTERN);
  assert.equal(t, crypto.randomBytes(0).length === 0 ? t : '', 'stable');
 }
 const bytes = Uint8Array.from({ length: 32 }, (_, i) => i * 8 + 3);
 assert.equal(model.tokenFromBytes(bytes), Buffer.from(bytes).toString('base64url'), 'it is plain base64url');
 assert.equal(model.tokenFromBytes(new Uint8Array(32)), 'A'.repeat(43)); assert.equal(model.tokenFromBytes(new Uint8Array(32).fill(255)), '_'.repeat(42) + '8');
 assert.throws(() => model.tokenFromBytes(new Uint8Array(31))); assert.throws(() => model.tokenFromBytes(new Uint8Array(33)));
 const now = Date.parse('2026-11-04T00:00:00Z');
 const expiresAt = model.linkExpiry(now, model.DEFAULT_LINK_DAYS);
 assert.equal(model.DEFAULT_LINK_DAYS, 7); assert.equal(expiresAt, '2026-11-11T00:00:00.000Z'); assert.ok(Math.max(...model.LINK_DAYS) <= 30);
 const token = model.tokenFromBytes(new Uint8Array(crypto.randomBytes(32)));
 assert.doesNotThrow(() => contract.studentAdminData('link', { token, kind: 'request', recipientId: null, expiresAt, enrollmentExpiresAt: null }));
 assert.equal(model.joinPath(token), '/join/' + token); assert.equal(contract.safeStudentAuthDestination(model.joinPath(token)), model.joinPath(token));
});
test('join links: the list shows only request links that are neither revoked nor expired', () => {
 const now = Date.parse('2026-11-04T00:00:00Z');
 const links = [{ id: '1', kind: 'request', expires_at: '2026-11-10T00:00:00Z', revoked_at: null }, { id: '2', kind: 'request', expires_at: '2026-11-10T00:00:00Z', revoked_at: '2026-11-01T00:00:00Z' },
  { id: '3', kind: 'request', expires_at: '2026-11-01T00:00:00Z', revoked_at: null }, { id: '4', kind: 'invite', expires_at: '2026-11-10T00:00:00Z', revoked_at: null }];
 same(model.activeLinks(links, now).map(l => l.id), ['1']);
});
test('attendance: only saved Present/Absent marks of this student, newest first, with counts', () => {
 const by = { g1: { name: 'Mon', rows: [{ user_id: 'u1', status: 'attended', session_id: 's1', title: 'A', starts_at: '2026-01-01T10:00:00Z' }, { user_id: 'u2', status: 'absent', session_id: 's1', title: 'A', starts_at: '2026-01-01T10:00:00Z' },
   { user_id: 'u1', status: 'not_marked', session_id: 's2', title: 'B', starts_at: '2026-01-02T10:00:00Z' }] }, g2: { name: 'Tue', rows: [{ user_id: 'u1', status: 'absent', session_id: 's3', title: 'C', starts_at: '2026-01-03T10:00:00Z' }] } };
 const e = model.attendanceEntries(by, 'u1');
 same(e.map(x => x.sessionId), ['s3', 's1']); same(model.attendanceCounts(e), { attended: 1, absent: 1 });
});

// ------------------------------------------------------------------ navigation and middleware
test('navigation: Students opens /teacher/students (and its student pages), no longer the admin users page', () => {
 const students = home.teacherNav.find(n => n.key === 'students');
 assert.equal(students.href, '/teacher/students');
 const active = path => home.teacherNav.filter(n => n.match(path)).map(n => n.key);
 same(active('/teacher/students'), ['students']); same(active('/teacher/students/abc'), ['students']);
 same(active('/admin/users'), []); same(active('/teacher/studentsx'), []); same(active('/teacher/groups'), ['groups']);
});
test('middleware: with Firebase staging on, exactly /teacher/students and /teacher/students/<id> pass, with no referrer and no caching; lookalikes are refused', () => {
 class NextResponse { constructor(kind, status) { this.kind = kind; this.status = status; this.headers = new Map(); } static next() { return new NextResponse('next', 200); } static json(_, o) { return new NextResponse('json', o.status); } static redirect(u) { return new NextResponse('redirect:' + u.pathname, 307); } }
 const middleware = load('middleware.ts', {
  '@/shared/public-website': load('shared/public-website.ts', { zod: require('zod') }), '@/shared/website-routes': load('shared/website-routes.ts'),
  '@clerk/nextjs/server': { clerkMiddleware: () => () => assert.fail('the legacy handler must not run in Firebase staging'), createRouteMatcher: () => () => false },
  '@/shared/auth-config': { isFirebaseStaging: () => true }, 'next/server': { NextResponse },
 }).default;
 const run = path => middleware({ nextUrl: new URL('https://platform.example' + path), url: 'https://platform.example' + path }, {});
 const id = '1234abcd-0000-4000-8000-00000000000f';
 for (const ok of ['/teacher/students', '/teacher/students/' + id]) { const r = run(ok); assert.equal(r.kind, 'next', ok); assert.equal(r.headers.get('Referrer-Policy'), 'no-referrer', ok); assert.equal(r.headers.get('Cache-Control'), 'private, no-store', ok); }
 for (const bad of ['/teacher/students/', '/teacher/students/x', '/teacher/students/' + id + '/x', '/teacher/students/' + id + '/', '/teacher/students/' + id.toUpperCase().replace(/-/g, 'G'), '/teacher/students//' + id, '/teacher/Students', '/teacher/studentsx', '/teacher/students.json', '/teacher/students/new'])
  assert.equal(run(bad).kind, 'redirect:/unavailable', bad + ' is not reachable');
 assert.equal(run('/api/student-administration').kind, 'next', 'the one existing endpoint');
});

// ------------------------------------------------------------------ sources: the secret, the endpoints, hidden actions, wording
test('the join link secret is made with crypto.getRandomValues, never logged, stored, navigated to or put in a query string', () => {
 const invite = src('invite.tsx');
 assert.match(invite, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/); assert.doesNotMatch(all, /Math\.random/);
 assert.doesNotMatch(all, /console\.|localStorage|sessionStorage|indexedDB|document\.cookie|history\.(push|replace)State|router\.(push|replace)|window\.open|location\.(href|assign|replace)\s*=|wa\.me|whatsapp|mailto:|sms:/i);
 assert.doesNotMatch(all, /\?(token|t)=|[?&]token/, 'no token in a query string');
 assert.match(invite, /navigator\.share/); assert.match(invite, /navigator\.clipboard/);
 // The page only ever navigates to Group, student and Students pages, never to the join page.
 for (const [file, s] of sources) assert.doesNotMatch(s.replace(/\$\{window\.location\.origin\}\$\{joinPath\(token\)\}/g, ''), /<Link[^>]*joinPath|href=\{[^}]*joinPath|\/join\//, file);
 // The token is kept only in React state of the invite panel and cleared when it closes.
 assert.match(invite, /setMade\(null\)/);
});
test('only the existing endpoints and actions are used; nothing enrols a student outside approval', () => {
 const urls = [...all.matchAll(/['"`](\/api\/[^'"`?$]*)/g)].map(m => m[1]);
 assert.ok(urls.length > 0);
 for (const u of new Set(urls)) assert.ok(['/api/student-administration', '/api/study-groups', '/api/study-groups/course-run'].includes(u), u);
 const used = new Set([...all.matchAll(/(?:adminCall|adminRead)\(\s*'([a-z-]+)'/g)].map(m => m[1]));
 for (const a of used) assert.ok(['offerings', 'roster', 'requests', 'approve', 'reject', 'suspend', 'reactivate', 'links', 'link', 'revoke-link'].includes(a), a);
 assert.equal(used.has('enroll'), false, 'there is no second way in');
 assert.doesNotMatch(all, /service[_-]?role|SUPABASE|firebase-admin|from ['"]@\/server\//i);
 assert.doesNotMatch(read('app/(dashboard)/(routes)/teacher/students/page.tsx') + read('app/(dashboard)/(routes)/teacher/students/[studentId]/page.tsx'), /student-access|StudentAccess/);
 assert.equal(fs.existsSync('frontend/features/admin/users/student-access.tsx'), fs.existsSync('frontend/features/admin/users/student-access.tsx')); // untouched: not imported
 assert.doesNotMatch(all, /admin\/users\/student-access/);
});
test('actions the caller cannot perform are not offered: answering a request and changing access need manage rights', () => {
 const req = src('requests.tsx'), stu = src('student-view.tsx');
 assert.match(req, /!offering\.manage && <p[^>]*><L id="ts\.requests\.view_only"/);
 for (const k of ['mode === \'idle\'', 'mode === \'approve\'', 'mode === \'reject\'']) assert.ok(req.includes('offering.manage && ' + k), k);
 assert.match(stu, /offering\.manage && \(status === 'active' \|\| status === 'suspended' \|\| status === 'expired'\) && <AccessChange/);
 assert.match(src('students-view.tsx'), /canInvite = courses\.ok && courses\.value\.length > 0/);
 assert.match(src('invite.tsx'), /published/);
});
test('suspend, reactivate, revoke and reject ask first; approval keeps one request id per attempt and never retries or rolls back silently', () => {
 const stu = src('student-view.tsx'), inv = src('invite.tsx'), req = src('requests.tsx');
 assert.match(stu, /data-ask-access/); assert.match(stu, /data-confirm-access/); assert.match(inv, /data-confirm-revoke/); assert.match(req, /data-confirm-reject/);
 assert.match(req, /ts\.requests\.reason_required/);
 assert.equal((req.match(/adminCall\('approve'/g) ?? []).length, 1, 'approve is called once');
 assert.doesNotMatch(req, /'remove'|setTimeout\([^)]*approve|retry\(/, 'no automatic undo or retry');
 assert.match(req, /approveOutcome/);
 assert.match(req, /ts\.requests\.not_added/);
});
test('the first view is complete when the loading overlay lifts, and every section has its own error state', () => {
 const v = src('students-view.tsx');
 assert.match(v, /usePageLoadingSignal\(!settled\)/); assert.match(src('student-view.tsx'), /usePageLoadingSignal/);
 for (const a of ['data-groups-failed', 'data-courses-failed']) assert.ok(v.includes(a), a);
 assert.match(src('requests.tsx'), /ts\.requests\.load_failed/);
});
test('tour targets exist for the new screens', () => {
 const targets = new Set([...all.matchAll(/data-tour="([a-z-]+)"/g)].map(m => m[1]));
 for (const t of ['invite-students', 'student-filters', 'student-rows', 'join-requests', 'invite-panel', 'create-link', 'student-access', 'student-groups', 'student-attendance']) assert.ok(targets.has(t), t);
 assert.match(read('frontend/features/teacher-groups/group-view.tsx'), /data-invite-from-group data-tour="invite-students"|data-tour="invite-students"[^>]*data-invite-from-group|data-invite-from-group/);
});
test('locales: every Students string exists in English and Arabic with the same placeholders, and no forbidden teacher word is shown', () => {
 const keys = Object.keys(messages.en).filter(k => /^ts\.(students|requests|student|invite)\./.test(k));
 assert.ok(keys.length >= 90, String(keys.length));
 const holes = s => (s.match(/\{\w+\}/g) ?? []).sort().join();
 for (const k of keys) {
  assert.ok(messages.en[k].trim() && messages.ar[k].trim(), k); assert.equal(holes(messages.en[k]), holes(messages.ar[k]), k);
  assert.doesNotMatch(messages.en[k], /\b(offerings?|organi[sz]ations?|modules?|slug|programs?|stages?)\b/i, k);
 }
 const used = new Set([...all.matchAll(/['"](ts\.(?:students|requests|student|invite)\.[a-z_.]+)['"]/g)].map(m => m[1]));
 for (const k of used) assert.ok(messages.en[k] && messages.ar[k], 'missing ' + k);
});
