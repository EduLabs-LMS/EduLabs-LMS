// Teacher Exams (part 1): the routes with a stubbed viewer, database client, Storage and Firebase; the pure rules of the page, the wizard,
// correcting and the mark sheet; the words in both languages; the exact middleware paths and the static screen rules. The database's own
// behaviour is in supabase/tests/exams*.sql; the screens are photographed by exams-ui-browser.cjs.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
function load(file, deps = {}, extra = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { module: m, exports: m.exports, URL, Array, Map, Set, JSON, Number, Date, Intl, Math, Object, String, Buffer, Uint8Array, Error, RegExp, Promise, console, encodeURIComponent, process, ...extra,
   require: n => n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const read = f => fs.readFileSync(f, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const hw = load('shared/teacher-homework.ts');
const hwContract = load('shared/contracts/teacher-homework.ts', { zod: require('zod') });
const contract = load('shared/contracts/teacher-exams.ts', { zod: require('zod'), '@/shared/contracts/teacher-homework': hwContract });
const ex = load('shared/teacher-exams.ts', { '@/shared/teacher-homework': hw });
const { messages } = require('./localization-test-loader.cjs').load('frontend/locales/messages.ts');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const MAX = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------------------------------------------
const ORIGIN = 'https://lms.test';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
function server({ viewer = { id: uuid(70), backend: 'firebase' }, rpc = {}, courseOf = uuid(80), editable = true, stored = PNG, signed = 'https://storage.test/signed', valid = true,
 session = { identity: { uid: 'firebase-70', email_verified: true } }, exchange = { ok: true, status: 200, body: { idToken: 'scoped-token' } }, verifiedRpc = { data: { id: uuid(60), name: 'q.png' }, error: null } } = {}) {
 const calls = [];
 const storage = { from: bucket => ({
  createSignedUrl: async (path, seconds) => { calls.push(['sign', bucket, path, seconds]); return signed ? { data: { signedUrl: signed }, error: null } : { data: null, error: { message: 'no' } }; },
  download: async path => { calls.push(['download', bucket, path]); return stored ? { data: { arrayBuffer: async () => Uint8Array.from(stored).buffer }, error: null } : { data: null, error: { message: 'no' } }; },
 }) };
 const client = {
  rpc: async (name, args) => { calls.push(['rpc', name, args]); const r = rpc[name]; return typeof r === 'function' ? r(args) : r ?? { data: null, error: null }; },
  from: table => ({ select: () => ({ eq: (col, value) => ({ maybeSingle: async () => { calls.push(['from', table, col, value]); return { data: courseOf ? { course_id: courseOf } : null, error: null }; } }) }) }),
  storage,
 };
 const service = load('server/services/teacher-exams.ts', {
  'server-only': {}, 'node:crypto': require('crypto'),
  '@supabase/supabase-js': { createClient: (url, key, opts) => ({ rpc: async (name, args) => { calls.push(['verified', name, args, await opts.accessToken()]); return verifiedRpc; } }) },
  '@/server/integrations/supabase': { getSupabaseServerClient: async () => client },
  '@/server/integrations/firebase-admin': { getFirebaseAdminAuth: () => ({ createCustomToken: async (uid, claims) => { calls.push(['token', uid, claims]); return 'custom-token'; } }) },
  '@/server/services/firebase-auth': { getFirebaseSession: async () => session },
  '@/server/services/homework-file-validation': { validateHomeworkBytes: async () => { if (!valid) throw Error('bad'); } },
  '@/server/services/teacher-course': { editableTeacherCourse: async (userId, courseId) => { calls.push(['editable', userId, courseId]); return editable; } },
  '@/shared/supabase-config': { getSupabaseConfig: () => ({ url: 'https://db.test', publishableKey: 'publishable' }) },
  '@/shared/teacher-exams': ex,
 }, { fetch: async (url, init) => { calls.push(['fetch', String(url).replace(/key=.*/, 'key='), JSON.parse(init.body)]); return { ok: exchange.ok, status: exchange.status, json: async () => exchange.body }; } });
 class NextResponse { constructor(body, init) { this.body = body; this.status = init.status; this.headers = new Map(Object.entries(init.headers ?? {})); } static json(body, init) { return new NextResponse(body, init); } }
 const http = load('server/http/teacher-exams.ts', {
  'server-only': {}, 'next/server': { NextResponse }, zod: require('zod'),
  '@/server/http/firebase/route': { validFirebaseOrigin: r => r.headers.get('origin') === ORIGIN && r.headers.get('sec-fetch-site') !== 'cross-site' },
  '@/server/services/application-auth': { getApplicationViewer: async () => viewer },
  '@/server/services/teacher-exams': service, '@/shared/auth-config': { isFirebaseStaging: () => true }, '@/shared/contracts/teacher-exams': contract,
 });
 return { http, calls };
}
function request(path, { method = 'POST', body, headers = {}, raw } = {}) {
 const h = new Map(Object.entries({ origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers }).filter(([, v]) => v !== null));
 const bytes = raw ?? (body === undefined ? null : Buffer.from(JSON.stringify(body)));
 const url = new URL(ORIGIN + path);
 return { method, headers: { get: k => h.get(k.toLowerCase()) ?? null }, nextUrl: url,
  body: bytes && { getReader: () => { let sent = 0; return { read: async () => sent < bytes.length ? { done: false, value: bytes.subarray(sent, sent += 65536) } : { done: true }, cancel: async () => {} }; } } };
}
const EX = uuid(5), TRY = uuid(6), GROUP = uuid(7), RUN = uuid(8), RESULT = uuid(9), STUDENT = uuid(10), Q = uuid(31);
const one = (examId = EX) => ({ params: Promise.resolve({ examId }) });
const two = (examId = EX, attemptId = TRY) => ({ params: Promise.resolve({ examId, attemptId }) });
const get = (path, headers = { origin: null }) => request(path, { method: 'GET', headers });
const post = (http, name, part, body, opts = {}, ctx = one()) => http[name](request(`/api/teacher/exams/${EX}/${part}`, { body, ...opts }), ctx);
const W = {
 save: (h, b, o, c) => post(h, 'examSavePOST', 'save', b, o, c), life: (h, b, o, c) => post(h, 'examLifecyclePOST', 'lifecycle', b, o, c),
 window: (h, b, o, c) => post(h, 'examWindowPOST', 'window', b, o, c), upload: (h, b, o, c) => post(h, 'examUploadPOST', 'upload', b, o, c),
 work: (h, b, o, c) => post(h, 'examWorkPOST', 'work', b, o, c), many: (h, b, o, c) => post(h, 'examReleaseManyPOST', 'release-many', b, o, c),
 marks: (h, b, o, c) => post(h, 'examMarksPOST', 'marks', b, o, c),
};
const R = {
 portal: (h, q = '') => h.examPortalGET(get(`/api/teacher/exams${q}`)), exam: (h, ctx = one(), q = '') => h.examGET(get(`/api/teacher/exams/${EX}${q}`), ctx),
 queue: (h, q = '', ctx = one()) => h.examQueueGET(get(`/api/teacher/exams/${EX}/queue${q}`), ctx), try: (h, ctx = two(), q = '') => h.examTryGET(get(`/api/teacher/exams/${EX}/tries/${TRY}${q}`), ctx),
 sheet: (h, q = '', ctx = one()) => h.examSheetGET(get(`/api/teacher/exams/${EX}/sheet${q}`), ctx),
};
const grade = (over = {}) => ({ action: 'grade', attemptId: TRY, revision: 3, reason: '', marks: [{ questionId: Q, points: 2.5, note: 'Show the steps.' }], ...over });
const mark = (over = {}) => ({ userId: STUDENT, mark: 17.5, absent: false, revision: null, reason: '', ...over });
const saveNew = (over = {}) => ({ offeringId: RUN, revision: null, definition: { kind: 'online', title: 'Unit test' }, ...over });

test('routes: signed out is 401 before any database call; a foreign origin is 403; reads must be same origin', async () => {
 const { http, calls } = server({ viewer: null });
 for (const r of [R.portal(http), R.exam(http), R.queue(http), R.try(http), R.sheet(http)]) assert.equal((await r).status, 401);
 assert.equal((await W.save(http, saveNew(), {}, one('new'))).status, 401);
 for (const [w, b] of [[W.life, { action: 'publish', revision: 1 }], [W.window, { source: 'auto', groupId: GROUP, revision: 1 }], [W.upload, { action: 'get', id: uuid(60) }], [W.work, grade()],
  [W.many, { items: [{ resultId: RESULT, revision: 1 }] }], [W.marks, { items: [mark()] }]]) assert.equal((await w(http, b)).status, 401);
 assert.deepEqual(calls, []);
 const other = server({ viewer: { id: uuid(71), backend: 'clerk' } });
 assert.equal((await R.portal(other.http)).status, 401, 'only a Firebase viewer');
 const s = server();
 for (const headers of [{ origin: 'https://evil.test' }, { origin: null }]) {
  assert.equal((await W.work(s.http, grade(), { headers })).status, 403, JSON.stringify(headers));
  assert.equal((await W.marks(s.http, { items: [mark()] }, { headers })).status, 403);
  assert.equal((await W.save(s.http, saveNew(), { headers }, one('new'))).status, 403);
 }
 assert.equal((await s.http.examPortalGET(get('/api/teacher/exams', { origin: null, 'sec-fetch-site': 'cross-site' }))).status, 403);
 assert.equal((await s.http.examSheetGET(get(`/api/teacher/exams/${EX}/sheet`, { origin: 'https://evil.test', 'sec-fetch-site': null }), one())).status, 403);
 assert.deepEqual(s.calls, []);
});

test('routes: bad, oversized, wrongly typed and repeated input is refused before the database', async () => {
 const { http, calls } = server();
 for (const q of ['?tab=open&tab=closed', '?tab=all', '?page=-1', '?page=1.5', '?course=x', '?userId=' + uuid(1)]) assert.equal((await R.portal(http, q)).status, 400, q);
 for (const q of ['?tab=done', '?tab=missing&tab=corrected', '?page=x', '?exam=' + EX]) assert.equal((await R.queue(http, q)).status, 400, q);
 for (const q of ['?group=x', '?group=none&group=none', '?group=all']) assert.equal((await R.sheet(http, q)).status, 400, q);
 assert.equal((await R.exam(http, one('new'))).status, 400, 'new is only for saving');
 assert.equal((await R.exam(http, one(), '?attempt=' + TRY)).status, 400, 'an exam read takes no query');
 assert.equal((await R.try(http, two(EX, 'x'))).status, 400); assert.equal((await R.try(http, two('x', TRY))).status, 400); assert.equal((await R.try(http, two(), '?user=' + uuid(1))).status, 400);
 // saving
 for (const body of [saveNew({ revision: 0 }), saveNew({ offeringId: null }), saveNew({ definition: { title: 'x' } }), saveNew({ userId: uuid(70) }), saveNew({ definition: { kind: 'online', status: 'published' } }),
  saveNew({ definition: { kind: 'online', title: 'x'.repeat(201) } }), saveNew({ definition: { kind: 'online', chapterIds: [uuid(1), uuid(1)] } }),
  saveNew({ definition: { kind: 'online', opensAt: '2026-11-20T10:00:00+02:00', closesAt: '2026-11-20T09:00:00+02:00' } }), saveNew({ definition: { kind: 'online', opensAt: '2026-11-20T10:00:00' } }),
  saveNew({ definition: { kind: 'online', questions: [{ type: 'essay', text: 'x', imageId: null, points: 1, modelText: '', modelImageId: null, options: ['a', 'b'], correct: [0] }] } }),
  saveNew({ definition: { kind: 'online', questions: [{ type: 'choice', text: 'x', imageId: null, points: 1, modelText: '', modelImageId: null, options: ['a', 'b'], correct: [2] }] } }),
  saveNew({ definition: { kind: 'online', questions: [{ type: 'number', text: 'x', imageId: null, points: 1, modelText: '', modelImageId: null }] } }),
  saveNew({ definition: { kind: 'online', questions: [{ type: 'choice', text: 'x', imageId: null, points: 1, modelText: '', modelImageId: null, options: ['a', 'b'], correct: [0], responseMode: 'photo' }] } }),
  saveNew({ definition: { kind: 'paper', maxMarks: 1001 } }), saveNew({ definition: { kind: 'online', timeLimitMinutes: 0 } }),
 ]) assert.equal((await W.save(http, body, {}, one('new'))).status, 400, JSON.stringify(body).slice(0, 160));
 assert.equal((await W.save(http, saveNew({ revision: null, offeringId: null }))).status, 400, 'an existing exam sends the revision it read');
 assert.equal((await W.save(http, saveNew(), {}, one('x'))).status, 400);
 assert.equal((await W.save(http, saveNew(), { headers: { 'content-type': 'text/plain' } }, one('new'))).status, 415);
 assert.equal((await W.save(http, undefined, { raw: Buffer.from('{not json') }, one('new'))).status, 400);
 assert.equal((await W.save(http, undefined, { raw: Buffer.alloc(600001, 32) }, one('new'))).status, 413);
 // the rest
 for (const [w, body] of [
  [W.life, { action: 'publish' }], [W.life, { action: 'delete', revision: 1 }], [W.life, { action: 'publish', revision: '1' }], [W.life, { action: 'clone', revision: 1, offeringId: 'x' }],
  [W.life, { action: 'reschedule', revision: 1, times: { opensAt: '2026-11-20T10:00:00+02:00', groupId: GROUP } }], [W.life, { action: 'publish', revision: -1 }], [W.life, { action: 'publish', revision: MAX + 1 }],
  [W.window, { source: 'custom', groupId: GROUP, revision: 1, opensAt: '2026-11-20T10:00:00+02:00', closesAt: '2026-11-20T10:00:00+02:00' }], [W.window, { source: 'picked', groupId: GROUP, revision: 1 }],
  [W.window, { source: 'auto', groupId: GROUP, revision: 1, sessionId: uuid(2) }], [W.window, { source: 'manual', groupId: GROUP, revision: 1 }],
  [W.upload, { action: 'intent', purpose: 'answer', mime: 'image/png', name: 'a.png' }], [W.upload, { action: 'intent', purpose: 'question', mime: 'image/gif', name: 'a.gif' }],
  [W.upload, { action: 'intent', purpose: 'question', mime: 'image/png', name: 'x'.repeat(256) }], [W.upload, { action: 'complete', id: 'x' }], [W.upload, { action: 'complete', id: uuid(60), path: 'a/b' }],
  [W.work, grade({ marks: [] })], [W.work, grade({ marks: [{ questionId: Q, points: 1.25, note: '' }] })], [W.work, grade({ marks: [{ questionId: Q, points: 1, note: '' }, { questionId: Q, points: 2, note: '' }] })],
  [W.work, grade({ marks: [{ questionId: Q, points: 1, note: 'x'.repeat(2001) }] })], [W.work, grade({ userId: uuid(70) })], [W.work, grade({ reason: 'x'.repeat(4001) })],
  [W.work, { action: 'release', resultId: RESULT }], [W.work, { action: 'release', resultId: RESULT, revision: 1, status: 'released' }],
  [W.many, { items: [] }], [W.many, { items: Array.from({ length: 501 }, (_, i) => ({ resultId: uuid(1000 + i), revision: i })) }], [W.many, { items: [{ resultId: RESULT, revision: 1 }, { resultId: RESULT, revision: 2 }] }],
  [W.many, { items: [{ resultId: RESULT, revision: 1 }], examId: EX }],
  [W.marks, { items: [mark({ absent: true })] }], [W.marks, { items: [mark({ mark: 1.3 })] }], [W.marks, { items: [mark({ mark: -1 })] }], [W.marks, { items: [mark(), mark()] }], [W.marks, { items: [] }],
  [W.marks, { items: [mark({ name: 'A student' })] }],
 ]) assert.equal((await w(http, body)).status, 400, JSON.stringify(body).slice(0, 140));
 assert.equal((await W.work(http, undefined, { raw: Buffer.alloc(400001, 32) })).status, 413);
 assert.equal((await W.many(http, undefined, { raw: Buffer.alloc(64001, 32) })).status, 413);
 assert.equal((await W.life(http, undefined, { raw: Buffer.alloc(4097, 32) })).status, 413);
 assert.equal((await W.life(http, { action: 'publish', revision: 1 }, {}, one('new'))).status, 400, 'new is only for saving');
 assert.deepEqual(calls, [], 'nothing reached the database');
});

test('routes: the user is the signed-in one, never sent; arguments go exactly as the database takes them; revisions round-trip', async () => {
 const view = { id: EX, revision: MAX, staff: true, kind: 'online', attempt: { id: TRY, revision: MAX - 1 } };
 const s = server({ rpc: {
  exam_portal: { data: { tab: 'closed', rows: [] }, error: null }, exam_get: { data: view, error: null }, exam_queue: { data: { releasable: [{ resultId: RESULT, revision: MAX }] }, error: null },
  exam_paper_sheet: { data: { rows: [] }, error: null }, exam_save: args => ({ data: { id: EX, revision: (args.p_revision ?? 0) + 1 }, error: null }),
  exam_lifecycle: { data: { id: EX, revision: MAX }, error: null }, exam_set_window: { data: { revision: MAX }, error: null }, exam_work: { data: { id: RESULT, revision: MAX }, error: null },
  exam_release_many: { data: { released: 1 }, error: null }, exam_paper_mark: { data: { saved: 1 }, error: null },
 } });
 const at = () => plain(s.calls.at(-1));
 let r = await R.portal(s.http, `?course=${uuid(80)}&tab=closed&page=2`);
 assert.equal(r.status, 200); assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
 assert.deepEqual(at(), ['rpc', 'exam_portal', { p_course: uuid(80), p_tab: 'closed', p_page: 2 }]);
 await R.portal(s.http); assert.deepEqual(at()[2], { p_course: null, p_tab: 'open', p_page: 0 }, 'the defaults');
 r = await R.exam(s.http); assert.equal(r.body.revision, MAX); assert.deepEqual(at(), ['rpc', 'exam_get', { p_exam: EX, p_attempt: null }]);
 r = await R.try(s.http); assert.equal(r.body.attempt.revision, MAX - 1); assert.deepEqual(at(), ['rpc', 'exam_get', { p_exam: EX, p_attempt: TRY }]);
 r = await R.queue(s.http, '?tab=missing&page=1'); assert.equal(r.body.releasable[0].revision, MAX); assert.deepEqual(at(), ['rpc', 'exam_queue', { p_exam: EX, p_tab: 'missing', p_page: 1 }]);
 await R.queue(s.http); assert.deepEqual(at()[2], { p_exam: EX, p_tab: 'to_correct', p_page: 0 });
 await R.sheet(s.http, '?group=none'); assert.deepEqual(at(), ['rpc', 'exam_paper_sheet', { p_exam: EX, p_group: 'none', p_page: 0 }]);
 await R.sheet(s.http, `?group=${GROUP}&page=3`); assert.deepEqual(at()[2], { p_exam: EX, p_group: GROUP, p_page: 3 });
 await R.sheet(s.http); assert.deepEqual(at()[2], { p_exam: EX, p_group: null, p_page: 0 }, 'every student');
 // a new exam: the course of its run is checked first, as the signed-in teacher
 r = await W.save(s.http, saveNew(), {}, one('new'));
 assert.equal(r.status, 200); assert.deepEqual(plain(r.body), { id: EX, revision: 1 });
 assert.deepEqual(plain(s.calls.slice(-3)), [['from', 'course_offerings', 'id', RUN], ['editable', uuid(70), uuid(80)], ['rpc', 'exam_save', { p_exam: null, p_offering: RUN, p_revision: null, p_definition: { kind: 'online', title: 'Unit test' } }]]);
 r = await W.save(s.http, { offeringId: null, revision: MAX - 1, definition: { title: 'Again' } });
 assert.equal(r.body.revision, MAX); assert.deepEqual(at(), ['rpc', 'exam_save', { p_exam: EX, p_offering: null, p_revision: MAX - 1, p_definition: { title: 'Again' } }]);
 // lifecycle
 for (const [body, action, data] of [[{ action: 'publish', revision: MAX }, 'publish', {}], [{ action: 'unpublish', revision: 4 }, 'unpublish', {}], [{ action: 'archive', revision: 4 }, 'archive', {}],
  [{ action: 'clone', revision: 4 }, 'clone', {}], [{ action: 'clone', revision: 4, offeringId: RUN }, 'clone', { offeringId: RUN }],
  [{ action: 'reschedule', revision: 4, times: { timing: 'same_time', opensAt: '2026-11-20T10:00:00+02:00', closesAt: '2026-11-20T11:00:00+02:00' } }, 'reschedule', { timing: 'same_time', opensAt: '2026-11-20T10:00:00+02:00', closesAt: '2026-11-20T11:00:00+02:00' }]]) {
  assert.equal((await W.life(s.http, body)).status, 200);
  assert.deepEqual(at(), ['rpc', 'exam_lifecycle', { p_exam: EX, p_action: action, p_revision: body.revision, p_data: data }], action);
 }
 // windows
 await W.window(s.http, { source: 'auto', groupId: GROUP, revision: MAX }); assert.deepEqual(at(), ['rpc', 'exam_set_window', { p_exam: EX, p_group: GROUP, p_revision: MAX, p_data: { source: 'auto' } }]);
 await W.window(s.http, { source: 'picked', groupId: GROUP, revision: 2, sessionId: uuid(3) }); assert.deepEqual(at()[2].p_data, { source: 'picked', sessionId: uuid(3) });
 await W.window(s.http, { source: 'custom', groupId: GROUP, revision: 2, opensAt: '2026-11-20T10:00:00+02:00', closesAt: '2026-11-20T11:30:00+02:00' });
 assert.deepEqual(at()[2].p_data, { source: 'custom', opensAt: '2026-11-20T10:00:00+02:00', closesAt: '2026-11-20T11:30:00+02:00' });
 // correcting and marks
 await W.work(s.http, grade({ revision: MAX })); assert.deepEqual(at(), ['rpc', 'exam_work', { p_exam: EX, p_action: 'grade', p_revision: MAX, p_data: { attemptId: TRY, marks: [{ questionId: Q, points: 2.5, note: 'Show the steps.' }], reason: '' } }]);
 await W.work(s.http, { action: 'release', resultId: RESULT, revision: 7 }); assert.deepEqual(at(), ['rpc', 'exam_work', { p_exam: EX, p_action: 'release', p_revision: 7, p_data: { resultId: RESULT } }]);
 await W.many(s.http, { items: [{ resultId: RESULT, revision: MAX }] }); assert.deepEqual(at(), ['rpc', 'exam_release_many', { p_exam: EX, p_items: [{ resultId: RESULT, revision: MAX }] }]);
 await W.marks(s.http, { items: [mark(), mark({ userId: uuid(11), mark: null, absent: true, revision: MAX, reason: 'Was ill, entered late.' })] });
 assert.deepEqual(at(), ['rpc', 'exam_paper_mark', { p_exam: EX, p_items: [mark(), mark({ userId: uuid(11), mark: null, absent: true, revision: MAX, reason: 'Was ill, entered late.' })] }]);
 assert.ok(s.calls.filter(c => c[0] === 'rpc').every(c => !JSON.stringify(c[2]).includes(uuid(70))), 'the teacher is never sent: the database knows who is signed in');
});

test('routes: a create is checked against the run\'s course; staff-only reads; the database\'s no comes back as plain refusals', async () => {
 for (const opts of [{ courseOf: null }, { editable: false }]) {
  const s = server(opts);
  assert.equal((await W.save(s.http, saveNew(), {}, one('new'))).status, 404, JSON.stringify(opts));
  assert.equal(s.calls.some(c => c[1] === 'exam_save'), false, 'the save never ran');
 }
 const student = server({ rpc: { exam_get: { data: { id: EX, staff: false }, error: null } } });
 assert.equal((await R.exam(student.http)).status, 404, 'these routes are for staff');
 const noTry = server({ rpc: { exam_get: { data: { id: EX, staff: true }, error: null } } });
 assert.equal((await R.try(noTry.http)).status, 404, 'a try that is not there');
 assert.equal((await R.exam(server({ rpc: { exam_get: { data: null, error: null } } }).http)).status, 404);
 // another teaching space's teacher, an assistant whose correct or release right is off: the database says 42501
 const no = server({ rpc: Object.fromEntries(['exam_portal', 'exam_get', 'exam_queue', 'exam_paper_sheet', 'exam_save', 'exam_lifecycle', 'exam_set_window', 'exam_work', 'exam_release_many', 'exam_paper_mark', 'exam_upload']
  .map(n => [n, { data: null, error: { code: '42501', message: 'Not allowed' } }])) });
 for (const r of [R.portal(no.http), R.exam(no.http), R.queue(no.http), R.sheet(no.http), W.save(no.http, { offeringId: null, revision: 1, definition: { title: 'x' } }),
  W.life(no.http, { action: 'publish', revision: 1 }), W.window(no.http, { source: 'auto', groupId: GROUP, revision: 1 }), W.work(no.http, grade()), W.work(no.http, { action: 'release', resultId: RESULT, revision: 1 }),
  W.many(no.http, { items: [{ resultId: RESULT, revision: 1 }] }), W.marks(no.http, { items: [mark()] }), W.upload(no.http, { action: 'intent', purpose: 'question', mime: 'image/png', name: 'a.png' })])
  assert.deepEqual([(await r).status, plain((await r).body)], [403, { kind: 'denied' }]);
 const thrown = server({ rpc: { exam_portal: () => { throw Error('network'); } } });
 assert.deepEqual([(await R.portal(thrown.http)).status, plain((await R.portal(thrown.http)).body)], [503, { kind: 'failed' }]);
 const stale = server({ rpc: { exam_save: { data: null, error: { code: 'PT409', message: 'Changed', details: '{"reason":"stale"}' } } } });
 const reply = await W.save(stale.http, { offeringId: null, revision: 3, definition: { title: 'x' } });
 assert.deepEqual([reply.status, plain(reply.body)], [409, { kind: 'changed' }]);
});

test('examReply: every database code and reason becomes one plain status and reason', () => {
 const cases = [
  [{ code: 'PT409', details: '{"reason":"stale"}' }, 409, { kind: 'changed' }], [{ code: 'PT409' }, 409, { kind: 'changed' }],
  [{ code: 'PT409', details: '{"reason":"started"}' }, 409, { kind: 'refused', reason: 'started' }], [{ code: 'PT409', details: '{"reason":"window_open"}' }, 409, { kind: 'refused', reason: 'window_open' }],
  [{ code: 'PT409', details: '{"reason":"DROP TABLE"}' }, 409, { kind: 'changed' }], [{ code: 'PT409', details: 'not json' }, 409, { kind: 'changed' }],
  [{ code: '23503', message: 'Question picture unavailable' }, 409, { kind: 'refused', reason: 'picture' }], [{ code: '23503', message: 'Model answer picture unavailable' }, 409, { kind: 'refused', reason: 'model_picture' }],
  [{ code: '23503', message: 'x' }, 409, { kind: 'refused', reason: 'in_use' }],
  [{ code: '42501' }, 403, { kind: 'denied' }], [{ code: 'PGRST116' }, 403, { kind: 'denied' }],
  [{ code: '23514', message: 'Add a question first', details: '{"reason":"reason_required"}' }, 400, { kind: 'invalid', reason: 'reason_required' }],
  [{ code: '23514', message: 'Some questions are unfinished', details: '{"reason":"unfinished_questions","questions":[1,2,3]}' }, 400, { kind: 'invalid', reason: 'unfinished_questions', questions: [1, 2, 3] }],
  [{ code: '23514', message: 'Some questions are unfinished', details: '{"reason":"unfinished_questions","questions":["x",0]}' }, 400, { kind: 'invalid', reason: 'unfinished_questions' }],
  [{ code: '23514', message: 'Auto-release needs an exam without essays' }, 400, { kind: 'invalid', reason: 'auto_release' }], [{ code: '23514', message: 'Something else' }, 400, { kind: 'invalid' }],
  [{ code: '22P02', message: 'Invalid exam' }, 400, { kind: 'invalid', reason: 'shape' }], [{ code: '23505', message: 'A student is listed twice' }, 400, { kind: 'invalid', reason: 'duplicate' }],
  [{ code: '22007', message: 'Times need an explicit offset' }, 400, { kind: 'invalid', reason: 'times' }], [{ code: '22008', message: 'Invalid time' }, 400, { kind: 'invalid', reason: 'times' }],
  [{ code: 'PT413' }, 413, { kind: 'too_large' }], [{ code: 'XX000', message: 'internal' }, 503, { kind: 'failed' }], [{}, 503, { kind: 'failed' }],
 ];
 for (const [error, status, body] of cases) assert.deepEqual(plain(ex.examReply(error)), { status, body }, JSON.stringify(error));
 for (const reason of ['started', 'reason_required', 'still_open', 'already_released', 'unfinished', 'in_use', 'picture', 'model_picture', 'auto_release', 'no_questions', 'unfinished_questions', 'times', 'mark_range', 'cannot_clear', 'session'])
  assert.ok(ex.EXAM_REASONS.includes(reason), reason);
});

test('uploads: intent from the database, the server reads and checks the bytes, proves them with a scoped token, links are five minutes', async () => {
 const s = server({ rpc: { exam_upload: args => ({ data: args.p_action === 'intent' ? { id: uuid(60), path: `${EX}/${uuid(60)}/file` } : { path: `${EX}/${uuid(61)}/file`, name: 'q.png', mime: 'image/png' }, error: null }) } });
 let r = await W.upload(s.http, { action: 'intent', purpose: 'model', mime: 'image/webp', name: 'model.webp' });
 assert.equal(r.status, 200); assert.deepEqual(plain(s.calls.at(-1)), ['rpc', 'exam_upload', { p_exam: EX, p_action: 'intent', p_id: null, p_data: { purpose: 'model', mime: 'image/webp', name: 'model.webp' } }]);
 r = await W.upload(s.http, { action: 'get', id: uuid(61) });
 assert.deepEqual(plain(r.body), { id: uuid(61), name: 'q.png', mime: 'image/png', url: 'https://storage.test/signed' });
 assert.deepEqual(plain(s.calls.at(-1)), ['sign', 'lms-exams', `${EX}/${uuid(61)}/file`, 300]);
 r = await W.upload(s.http, { action: 'complete', id: uuid(60) });
 assert.equal(r.status, 200); assert.deepEqual(plain(r.body), { id: uuid(60), name: 'q.png', mime: 'image/png' });
 const download = s.calls.find(c => c[0] === 'download'); assert.deepEqual(download, ['download', 'lms-exams', `${EX}/${uuid(60)}/file`], 'only this exam\'s path is read');
 const token = s.calls.find(c => c[0] === 'token');
 assert.deepEqual(plain(token), ['token', 'firebase-70', { role: 'authenticated', exam_upload: { id: uuid(60), size: PNG.length, sha256: require('crypto').createHash('sha256').update(PNG).digest('hex') } }]);
 assert.deepEqual(plain(s.calls.find(c => c[0] === 'fetch')), ['fetch', 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=', { token: 'custom-token', returnSecureToken: true }]);
 assert.deepEqual(plain(s.calls.at(-1)), ['verified', 'exam_upload', { p_exam: EX, p_action: 'complete', p_id: uuid(60), p_data: {} }, 'scoped-token']);
 assert.ok(!JSON.stringify(r.body).includes('token'), 'the scoped token never reaches the browser');
 const status = async (opts, body = { action: 'complete', id: uuid(60) }) => { const t = server({ rpc: { exam_upload: { data: {}, error: null } }, ...opts }); const x = await W.upload(t.http, body); return [x.status, plain(x.body)]; };
 assert.deepEqual(await status({ stored: null }), [403, { kind: 'denied' }], 'nothing stored there');
 assert.deepEqual(await status({ stored: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]) }), [413, { kind: 'too_large' }]);
 assert.deepEqual(await status({ stored: Buffer.from('GIF89a' + 'x'.repeat(40)) }), [400, { kind: 'invalid', reason: 'file_type' }], 'not one of the three picture types');
 assert.deepEqual(await status({ valid: false }), [400, { kind: 'invalid', reason: 'file_type' }], 'bytes that do not decode');
 assert.deepEqual(await status({ session: null }), [401, { kind: 'signin' }]);
 assert.deepEqual(await status({ session: { identity: { uid: 'u', email_verified: false } } }), [401, { kind: 'signin' }]);
 assert.deepEqual(await status({ exchange: { ok: false, status: 400, body: {} } }), [503, { kind: 'failed' }]);
 assert.deepEqual(await status({ verifiedRpc: { data: null, error: { code: '23514', message: 'Unsupported upload type' } } }), [400, { kind: 'invalid', reason: 'file_type' }]);
 assert.deepEqual(await status({ signed: null, rpc: { exam_upload: { data: { path: 'x' }, error: null } } }, { action: 'get', id: uuid(61) }), [403, { kind: 'denied' }]);
 assert.deepEqual(await status({ rpc: { exam_upload: { data: { name: 'x' }, error: null } } }, { action: 'get', id: uuid(61) }), [404, { kind: 'denied' }], 'no path, no link');
 const client = read('frontend/lib/exam-upload.ts');
 assert.match(client, /intent\.path\.startsWith\(`\$\{examId\}\/`\)/); assert.match(client, /lms-exams/); assert.doesNotMatch(client, /service[_-]?role/i);
});

test('routes: one-line adapters, the timed handlers, signed-in client only, no service role', () => {
 const adapters = {
  'route.ts': ['ExamPortalGET', 'GET'], '[examId]/route.ts': ['ExamGET', 'GET'], '[examId]/save/route.ts': ['ExamSavePOST', 'POST'], '[examId]/lifecycle/route.ts': ['ExamLifecyclePOST', 'POST'],
  '[examId]/window/route.ts': ['ExamWindowPOST', 'POST'], '[examId]/upload/route.ts': ['ExamUploadPOST', 'POST'], '[examId]/queue/route.ts': ['ExamQueueGET', 'GET'],
  '[examId]/tries/[attemptId]/route.ts': ['ExamTryGET', 'GET'], '[examId]/work/route.ts': ['ExamWorkPOST', 'POST'], '[examId]/release-many/route.ts': ['ExamReleaseManyPOST', 'POST'],
  '[examId]/sheet/route.ts': ['ExamSheetGET', 'GET'], '[examId]/marks/route.ts': ['ExamMarksPOST', 'POST'],
 };
 for (const [file, [name, verb]] of Object.entries(adapters)) assert.equal(read('app/api/teacher/exams/' + file).trim(), `export { timed${name} as ${verb} } from '@/server/http/timed';`, file);
 const timed = read('server/http/timed.ts');
 for (const [name] of Object.values(adapters)) assert.match(timed, new RegExp(`export const timed${name} = withServerTiming\\(${name[0].toLowerCase() + name.slice(1)}\\)`), name);
 const code = read('server/http/teacher-exams.ts') + read('server/services/teacher-exams.ts');
 assert.doesNotMatch(code, /service[_-]?role|supabaseAdmin|SERVICE_ROLE/i);
 assert.doesNotMatch(code, /body\.data\.userId|userId:\s*body|auth\.uid/, 'no user from the client');
});

test('middleware: the exam endpoints and pages pass by exact path, nothing next to them does', () => {
 const source = read('middleware.ts');
 const pattern = line => { const start = line.indexOf('/^'), end = line.indexOf('$/.test', start); return new RegExp(line.slice(start + 1, end + 1)); };
 const apiLine = source.split('\n').find(l => l.includes("path === '/api/teacher/exams'")), pageLine = source.split('\n').find(l => l.includes("path === '/teacher/exams'"));
 const api = pattern(apiLine), page = pattern(pageLine), id = uuid(1);
 for (const good of ['/api/teacher/exams/new/save', `/api/teacher/exams/${id}`, ...['save', 'lifecycle', 'window', 'upload', 'queue', 'work', 'release-many', 'sheet', 'marks', `tries/${uuid(2)}`].map(p => `/api/teacher/exams/${id}/${p}`)])
  assert.ok(api.test(good), good);
 for (const bad of ['/api/teacher/exams/new', '/api/teacher/exams/new/lifecycle', `/api/teacher/exams/${id}/`, `/api/teacher/exams/${id}/grade`, `/api/teacher/exams/${id}/save/x`, `/api/teacher/exams/${id}/tries`,
  `/api/teacher/exams/${id}/tries/x`, '/api/teacher/exams/not-a-uuid/save', '/api/teacher/exams/ABCDEF00-0000-4000-8000-000000000001', '/api/teacher/examsx']) assert.ok(!api.test(bad), bad);
 for (const good of [`/teacher/exams/${id}`, `/teacher/exams/${id}/correct`, `/teacher/exams/${id}/marks`]) assert.ok(page.test(good), good);
 for (const bad of [`/teacher/exams/${id}/edit`, '/teacher/exams/x', `/teacher/exams/${id}/marks/x`]) assert.ok(!page.test(bad), bad);
 assert.match(pageLine, /path === '\/teacher\/exams\/new'/); assert.match(pageLine, /no-referrer/); assert.match(pageLine, /private, no-store/);
 for (const p of ['', '/new', `/${id}`, `/${id}/correct`, `/${id}/marks`]) assert.ok(fs.existsSync(`app/(dashboard)/(routes)/teacher/exams${p.replace(id, '[examId]')}/page.tsx`), p);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The rules on screen
// ---------------------------------------------------------------------------------------------------------------------------------
let n = 0; const ids = () => uuid(500 + n++);
test('numbers and marks: Arabic and Persian digits, a comma or the Arabic decimal sign; marks in halves, within the maximum', () => {
 for (const [raw, value] of [['12', 12], ['١٢', 12], ['۱۲', 12], ['2.5', 2.5], ['2,5', 2.5], ['٢٫٥', 2.5], [' -3 ', -3], ['−3', -3], ['.5', 0.5], ['7.', 7]]) assert.equal(ex.parseNumber(raw), value, raw);
 for (const raw of ['', 'a', '1.2.3', '1,000.5', '--1', '1e3', 'Infinity']) assert.equal(ex.parseNumber(raw), null, raw);
 assert.equal(ex.parseMark('17.5', 20), 17.5); assert.equal(ex.parseMark('١٧٫٥', 20), 17.5); assert.equal(ex.parseMark('17.3', 20), null); assert.equal(ex.parseMark('21', 20), null); assert.equal(ex.parseMark('-1', 20), null);
 assert.equal(ex.clampHalves(3.3, 10), 3.5); assert.equal(ex.clampHalves(-2, 10), 0); assert.equal(ex.clampHalves(12, 10), 10);
 assert.deepEqual(plain(ex.timeLeft(3601)), { hours: 1, minutes: 1 }); assert.deepEqual(plain(ex.timeLeft(-5)), { hours: 0, minutes: 0 });
});

test('wizard: a new exam, chapters, kinds of question, what is saved for paper and online, and what a started exam still saves', () => {
 const online = ex.newExam(ids, 'online', { courseId: uuid(80), offeringId: RUN });
 assert.equal(online.questions.length, 1); assert.equal(online.questions[0].kind, 'choice'); assert.equal(online.questions[0].options.length, 4);
 assert.deepEqual(plain(ex.stepsOf('online')), ['details', 'questions', 'when', 'rules', 'review']); assert.deepEqual(plain(ex.stepsOf('paper')), ['details', 'review']);
 assert.deepEqual(plain(ex.newExam(ids, 'paper').questions), []);
 let chapters = ex.toggleChapter({ chapterIds: [], coversAllChapters: true }, uuid(1)); assert.deepEqual(plain(chapters), { coversAllChapters: false, chapterIds: [uuid(1)] });
 chapters = ex.toggleChapter(chapters, uuid(1)); assert.deepEqual(plain(chapters), { coversAllChapters: true, chapterIds: [] }, 'none picked is All again');
 assert.deepEqual(plain(ex.toggleChapter({ chapterIds: [uuid(1)], coversAllChapters: false }, 'all')), { coversAllChapters: true, chapterIds: [] });
 const q = { ...online.questions[0], text: 'Pick', points: 3, modelAnswer: 'Because' };
 const asNumber = ex.setExamKind(q, 'number', ids);
 assert.deepEqual([asNumber.id, asNumber.text, asNumber.points, asNumber.modelAnswer, asNumber.options.length, asNumber.numberValue], [q.id, 'Pick', 3, 'Because', 0, '']);
 assert.equal(ex.setExamKind(q, 'choice', ids), q);
 // paper: details and the maximum only
 const paper = { ...ex.newExam(ids, 'paper', { courseId: uuid(80), offeringId: RUN }), title: ' Midterm ', heldOn: '2026-11-20', maxMarks: 40.4 };
 assert.deepEqual(plain(ex.toExamDefinition(paper, { create: true })), { title: 'Midterm', description: '', chapterIds: [], coversAllChapters: true, kind: 'paper', heldOn: '2026-11-20', maxMarks: 40 });
 // online, same time: Cairo's offset; every question is always sent, even one still without its right answer (a draft keeps it)
 const s = { ...online, title: 'Quiz', timing: 'same_time', opensDate: '2026-11-20', opensTime: '10:00', closesDate: '2026-11-20', closesTime: '11:00', limitOn: true, timeLimitMinutes: 45 };
 let d = ex.toExamDefinition(s);
 assert.equal(d.opensAt, '2026-11-20T10:00:00+02:00'); assert.equal(d.closesAt, '2026-11-20T11:00:00+02:00'); assert.equal(d.timeLimitMinutes, 45);
 assert.equal(d.questions.length, 1, 'the unfinished question is sent, never left out'); assert.deepEqual(plain(d.questions[0].correct), [], 'no right answer yet');
 assert.equal(contract.examDefinition.safeParse(d).success, true, 'a draft with an unfinished choice is a valid save');
 const gaps = { ...s, questions: [s.questions[0], { ...ex.newExamQuestion('number', ids), text: 'No value' }, { ...ex.newExamQuestion('choice', ids), text: 'Second' }] };
 d = ex.toExamDefinition(gaps);
 assert.equal(d.questions.length, 3, 'three questions typed, nothing ticked: all three are sent'); assert.equal(d.questions[1].numberValue, null, 'a number without a value is sent as null');
 assert.equal(contract.examDefinition.safeParse(d).success, true); assert.equal(ex.questionsComplete(gaps), false);
 assert.equal(ex.questionsSavable, undefined, 'the leave-them-out rule is gone');
 assert.equal('kind' in d, false, 'kind only when creating');
 const ready = { ...s, questions: [{ ...s.questions[0], text: 'Pick', options: s.questions[0].options.map((o, i) => ({ ...o, text: 'abcd'[i] })), correctIds: [s.questions[0].options[2].id] },
  { ...ex.newExamQuestion('number', ids), text: 'How many?', numberValue: '٣٫٥', tolerance: '0,5' }, { ...ex.newExamQuestion('essay', ids), text: 'Explain' }], autoRelease: true, photos: false };
 d = ex.toExamDefinition(ready);
 assert.deepEqual(plain(d.questions.map(x => [x.type, x.correct ?? x.numberValue ?? x.responseMode, x.tolerance])), [['choice', [2], null], ['number', 3.5, 0.5], ['essay', 'text', null]]);
 assert.equal(d.autoRelease, false, 'auto-release is off while there are essays');
 assert.equal(contract.examDefinition.safeParse(d).success, true, 'what the wizard sends, the route takes');
 assert.equal(ex.toExamDefinition({ ...ready, timing: 'per_group', startingFrom: '2026-11-21' }).startingFrom, '2026-11-21');
 assert.deepEqual(Object.keys(ex.detailsOnly(d)).sort(), ['chapterIds', 'coversAllChapters', 'description', 'title'], 'a started exam saves its details only');
 assert.notEqual(ex.coreOf(ready), ex.coreOf({ ...ready, timeLimitMinutes: 50 })); assert.equal(ex.coreOf(ready), ex.coreOf({ ...ready, title: 'Renamed' }), 'a new title needs no new version');
 assert.equal(ex.examTotal(ready), 1 + 1 + 2); assert.equal(ex.hasEssays(ready), true);
});

test('wizard: what still stops each step, the time limit never past a window, and when a draft can be saved', () => {
 const now = Date.parse('2026-11-13T10:00:00Z');
 const base = { ...ex.newExam(ids, 'online'), title: '' };
 assert.deepEqual(plain(ex.examStepIssues(base, 'details', now).map(i => i.key)), ['title', 'course']);
 assert.deepEqual(plain(ex.examStepIssues(ex.newExam(ids, 'paper', { offeringId: RUN, courseId: uuid(80) }), 'details', now).map(i => i.key)), ['title']);
 assert.deepEqual(plain(ex.examStepIssues({ ...ex.newExam(ids, 'paper'), title: 'x', courseId: 'c', offeringId: 'o', maxMarks: 0 }, 'details', now).map(i => i.key)), ['max_marks']);
 const qs = { ...base, questions: [ex.newExamQuestion('choice', ids), { ...ex.newExamQuestion('number', ids), numberValue: 'x', tolerance: '-1' }, ex.newExamQuestion('essay', ids)] };
 assert.deepEqual(plain(ex.examStepIssues(qs, 'questions', now)), [{ step: 'questions', key: 'correct', question: 0 }, { step: 'questions', key: 'number_value', question: 1 }, { step: 'questions', key: 'tolerance', question: 1 }, { step: 'questions', key: 'question_text', question: 2 }]);
 assert.deepEqual(plain(ex.examStepIssues({ ...base, questions: [] }, 'questions', now).map(i => i.key)), ['no_questions']);
 assert.deepEqual(plain(ex.examStepIssues(base, 'when', now).map(i => i.key)), ['starting_from']);
 const same = { ...base, timing: 'same_time' };
 assert.deepEqual(plain(ex.examStepIssues(same, 'when', now).map(i => i.key)), ['times']);
 assert.deepEqual(plain(ex.examStepIssues({ ...same, opensDate: '2026-11-20', closesDate: '2026-11-20', opensTime: '11:00', closesTime: '10:00' }, 'when', now).map(i => i.key)), ['closes_before']);
 assert.deepEqual(plain(ex.examStepIssues({ ...same, opensDate: '2026-11-10', closesDate: '2026-11-10' }, 'when', now).map(i => i.key)), ['times_past']);
 assert.deepEqual(plain(ex.examStepIssues({ ...same, opensDate: '2026-11-10', closesDate: '2026-11-10', status: 'published' }, 'when', now)), [], 'a published exam keeps its past window');
 const timed = { ...same, opensDate: '2026-11-20', closesDate: '2026-11-20', opensTime: '10:00', closesTime: '10:30', limitOn: true, timeLimitMinutes: 45 };
 assert.equal(ex.limitCap(timed, []), 30); assert.deepEqual(plain(ex.examStepIssues(timed, 'when', now, 30).map(i => i.key)), ['limit_long']);
 assert.equal(ex.clampLimit(45, 30), 30); assert.equal(ex.clampLimit(0, null), 1); assert.equal(ex.clampLimit(5000, null), 1440);
 const windows = [{ state: 'ok', opensAt: '2026-11-20T10:00:00+02:00', closesAt: '2026-11-20T12:00:00+02:00' }, { state: 'ok', opensAt: '2026-11-21T10:00:00+02:00', closesAt: '2026-11-21T11:30:00+02:00' }, { state: 'needs_time', opensAt: null, closesAt: null }];
 assert.equal(ex.limitCap(base, windows), 90, 'the shortest Group window'); assert.equal(ex.limitCap(base, []), null, 'nothing capped before the windows are read');
 assert.deepEqual(plain(ex.examStepIssues({ ...base, autoRelease: true, questions: [ex.newExamQuestion('essay', ids)] }, 'rules', now).map(i => i.key)), ['auto_release']);
 assert.equal(ex.examSavable(base), false, 'a new exam needs its run'); assert.equal(ex.examSavable({ ...base, offeringId: RUN }), true);
 assert.equal(ex.examSavable({ ...same, offeringId: RUN, opensDate: '2026-11-20', closesDate: '2026-11-20', opensTime: '11:00', closesTime: '10:00' }), false);
 assert.equal(ex.examSavable({ ...ex.newExam(ids, 'paper'), offeringId: RUN, maxMarks: 1001 }), false);
 for (const key of ['title', 'course', 'max_marks', 'no_questions', 'question_text', 'correct', 'number_value', 'tolerance', 'starting_from', 'times', 'times_invalid', 'closes_before', 'times_past', 'limit_long', 'auto_release'])
  assert.ok(messages.en[`ex.w.issue.${key}`] && messages.ar[`ex.w.issue.${key}`], 'words for ' + key);
});

const row = (over = {}) => ({ id: EX, title: 'Quiz', kind: 'online', status: 'published', courseId: uuid(80), courseTitle: 'Physics', offeringId: RUN, version: 1, timing: 'per_group', startingFrom: null, opensAt: null, closesAt: null,
 heldOn: null, timeLimitMinutes: null, updatedAt: '2026-11-13T08:00:00Z', lastClose: null, held: false, questionCount: 3, totalMarks: 5, hasEssays: true, total: 30, handedIn: 0, waiting: 0, toRelease: 0, released: 0,
 groups: [], noGroup: null, ...over });
test('the Exams page: row actions by status and right, Unpublish said to be blocked, Live now and To correct', () => {
 assert.deepEqual(plain(ex.examRowActions(row({ status: 'draft' }), true)), ['edit', 'publish', 'archive', 'duplicate']);
 assert.deepEqual(plain(ex.examRowActions(row(), true)), ['correct', 'edit', 'unpublish', 'archive', 'duplicate']);
 assert.deepEqual(plain(ex.examRowActions(row({ kind: 'paper' }), true)), ['marks', 'edit', 'unpublish', 'archive', 'duplicate']);
 assert.deepEqual(plain(ex.examRowActions(row({ status: 'archived' }), true)), ['correct', 'duplicate']);
 assert.deepEqual(plain(ex.examRowActions(row(), false)), ['correct'], 'an assistant corrects, never edits');
 assert.deepEqual(plain(ex.examRowActions(row({ status: 'draft' }), false)), []);
 assert.equal(ex.unpublishBlocked(row()), false); assert.equal(ex.unpublishBlocked(row({ handedIn: 1 })), true);
 assert.equal(ex.unpublishBlocked(row({ groups: [{ started: 1 }] })), true); assert.equal(ex.unpublishBlocked(row({ noGroup: { total: 3, started: 1 } })), true);
 const g = (name, window, secondsLeft) => ({ groupId: uuid(name.length), name, state: 'ok', opensAt: null, closesAt: null, window, secondsLeft, total: 10, started: 4 });
 const live = ex.liveNow([row({ groups: [g('Sat A', 'open', 900), g('Sun', 'upcoming', null), g('Mon B', 'open', 300)] }), row({ kind: 'paper', groups: [g('X', 'open', 1)] }), row({ status: 'draft', groups: [g('Y', 'open', 1)] })]);
 assert.deepEqual(plain(live.map(c => [c.name, c.secondsLeft])), [['Mon B', 300], ['Sat A', 900]], 'open windows only, the soonest to close first');
 const cards = ex.toCorrect([row({ waiting: 4, handedIn: 12 }), row({ waiting: 4 }), row({ id: uuid(2), kind: 'paper', handedIn: 20 }), row({ id: uuid(3), waiting: 0 }), row({ id: uuid(4), total: null, waiting: 3 })]);
 assert.deepEqual(plain(cards.map(c => [c.examId, c.kind, c.waiting, c.entered, c.total])), [[EX, 'online', 4, 12, 30], [uuid(2), 'paper', 10, 20, 30]]);
});

const item = (over = {}) => ({ id: Q, position: 0, type: 'essay', text: 'Explain', imageId: null, points: 4, responseMode: 'both', options: [], correctOptionIds: [], numberValue: null, tolerance: 0, modelText: '', modelImageId: null,
 answer: { optionIds: null, numberValue: null, text: 'Because', uploadId: null, kept: false, savedAt: '2026-11-13T08:00:00Z' }, mark: null, ...over });
test('correcting: the automatic lines, the essay marks typed, the total, the body sent, Release and the next student', () => {
 const opts = [{ id: uuid(41), text: 'a' }, { id: uuid(42), text: 'b' }, { id: uuid(43), text: 'c' }];
 const attempt = { items: [
  item({ id: uuid(32), type: 'single_choice', points: 1, options: opts, correctOptionIds: [uuid(42)], answer: { optionIds: [uuid(42)], kept: false }, mark: { points: 1, auto: true, note: '' } }),
  item({ id: uuid(33), type: 'multiple_choice', points: 2, options: opts, correctOptionIds: [uuid(41), uuid(43)], answer: { optionIds: [uuid(43)], kept: true }, mark: { points: 0, auto: true, note: '' } }),
  item({ id: uuid(34), type: 'number', points: 2, numberValue: 3.5, tolerance: 0.5, answer: { numberValue: 3.2, kept: false }, mark: { points: 2, auto: true, note: '' } }),
  item(), item({ id: uuid(35), answer: null, mark: { points: 1, auto: false, note: 'Partly' } }),
 ] };
 const lines = ex.autoLines(attempt);
 assert.deepEqual(plain(lines.map(l => [l.n, l.type, l.picked.join(''), l.right.join(''), l.given, l.correct, l.points, l.kept])),
  [[1, 'choice', 'B', 'B', null, true, 1, false], [2, 'choice', 'C', 'AC', null, false, 0, true], [3, 'number', '', '3.5 ± 0.5', '3.2', true, 2, false]]);
 assert.deepEqual(plain(ex.autoLines(attempt, 'ar').map(l => l.right.join(''))), ['ب', 'أج', '3.5 ± 0.5']);
 assert.deepEqual(plain(ex.examEssays(attempt).map(e => [e.n, e.text, e.points, e.note])), [[4, 'Because', null, ''], [5, '', 1, 'Partly']]);
 const draft = ex.examDraftOf(attempt);
 assert.equal(ex.examDraftComplete(draft), false); assert.equal(ex.examDraftChanged(draft, ex.examDraftOf(attempt)), false);
 const typed = { ...draft, [Q]: { points: 2.5, note: 'Good' } };
 assert.equal(ex.examDraftComplete(typed), true); assert.equal(ex.examDraftChanged(draft, typed), true);
 assert.deepEqual(plain(ex.examTotals(attempt, typed)), { got: 1 + 0 + 2 + 2.5 + 1, max: 13 });
 const body = ex.examGradeBody(typed, TRY, MAX, '');
 assert.deepEqual(plain(body), { action: 'grade', attemptId: TRY, revision: MAX, reason: '', marks: [{ questionId: Q, points: 2.5, note: 'Good' }, { questionId: uuid(35), points: 1, note: 'Partly' }] });
 assert.equal(contract.examWork.safeParse(body).success, true);
 const q = (over = {}) => ({ status: 'corrected', released: false, windowClosed: true, inProgress: false, resultId: RESULT, ...over });
 assert.equal(ex.releaseBlock(q(), true), null); assert.equal(ex.releaseBlock(q(), false), 'no_right'); assert.equal(ex.releaseBlock(q({ released: true }), true), 'released');
 assert.equal(ex.releaseBlock(q({ status: 'waiting' }), true), 'unfinished'); assert.equal(ex.releaseBlock(q({ windowClosed: false }), true), 'still_open'); assert.equal(ex.releaseBlock(q({ inProgress: true }), true), 'still_open');
 assert.equal(ex.releaseBlock(null, true), 'unfinished');
 const rows = [{ attemptId: uuid(1) }, { attemptId: null }, { attemptId: uuid(2) }, { attemptId: uuid(3) }];
 assert.equal(ex.nextInQueue(rows, uuid(2)).attemptId, uuid(3)); assert.equal(ex.nextInQueue(rows, uuid(3)).attemptId, uuid(1), 'back to the top'); assert.equal(ex.nextInQueue([{ attemptId: uuid(1) }], uuid(1)), null);
});

const sheet = (over = {}) => ({ userId: STUDENT, name: 'Student A', groupIds: [GROUP], resultId: RESULT, mark: null, absent: false, released: false, releasedAt: null, revision: 4, ...over });
test('paper marks: what was typed against what is stored, the item sent, a reason for a released mark, the Group filter and Release marks', () => {
 const r = sheet();
 assert.equal(ex.entryState(r, ex.entryOf(r), 20), 'same');
 assert.equal(ex.entryState(r, { text: '١٧٫٥', absent: false, reason: '' }, 20), 'ready'); assert.equal(ex.entryState(r, { text: '17.3', absent: false, reason: '' }, 20), 'invalid');
 assert.equal(ex.entryState(r, { text: '21', absent: false, reason: '' }, 20), 'invalid'); assert.equal(ex.entryState(r, { text: '', absent: true, reason: '' }, 20), 'ready');
 const released = sheet({ mark: 15, released: true });
 assert.equal(ex.entryState(released, { text: '', absent: false, reason: 'Wrong row' }, 20), 'cannot_clear');
 assert.equal(ex.entryState(released, { text: '16', absent: false, reason: 'ok' }, 20), 'needs_reason'); assert.equal(ex.entryState(released, { text: '16', absent: false, reason: 'Re-added page 2' }, 20), 'ready');
 assert.deepEqual(plain(ex.markItem(r, { text: '2,5', absent: false, reason: 'ignored' }, 20)), { userId: STUDENT, mark: 2.5, absent: false, revision: 4, reason: '' });
 assert.deepEqual(plain(ex.markItem(released, { text: '16', absent: false, reason: '  Re-added page 2 ' }, 20)), { userId: STUDENT, mark: 16, absent: false, revision: 4, reason: 'Re-added page 2' });
 assert.equal(contract.examPaperMarks.safeParse({ items: [ex.markItem(r, { text: '', absent: true, reason: '' }, 20)] }).success, true);
 const rows = [r, sheet({ userId: uuid(11), groupIds: [], mark: 3, resultId: uuid(21), revision: 1 }), sheet({ userId: uuid(12), groupIds: [uuid(99)], absent: true, resultId: uuid(22), revision: MAX }), sheet({ userId: uuid(13), mark: 9, released: true, resultId: uuid(23) })];
 assert.equal(ex.sheetRows(rows, 'all').length, 4); assert.deepEqual(plain(ex.sheetRows(rows, 'none').map(x => x.userId)), [uuid(11)]); assert.deepEqual(plain(ex.sheetRows(rows, GROUP).map(x => x.userId)), [STUDENT, uuid(13)]);
 assert.equal(ex.enteredCount(rows), 3);
 assert.deepEqual(plain(ex.sheetReleasable(rows)), [{ resultId: uuid(21), revision: 1 }, { resultId: uuid(22), revision: MAX }], 'entered, not yet released, revisions as held');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Screens and words
// ---------------------------------------------------------------------------------------------------------------------------------
const featureFiles = fs.readdirSync('frontend/features/teacher-exams').map(f => 'frontend/features/teacher-exams/' + f);
const screens = featureFiles.map(read).join('\n');
test('screens: no native checkbox, no disabled attribute, only the exam, course and Group routes, nothing decided by a role', () => {
 assert.doesNotMatch(screens, /type=["']checkbox["']/);
 assert.doesNotMatch(screens, /<(button|input|textarea|select)\b[^>]*\sdisabled[\s=>]/, 'aria-disabled with a reason instead');
 const routes = [...new Set([...(screens + read('frontend/lib/exam-upload.ts').replace("'/api/exams'", "'/api/teacher/exams'")).matchAll(/['"`](\/api\/[^'"`?$]*)/g)].map(m => m[1]))].sort();
 assert.ok(routes.length > 0);
 for (const r of routes) assert.match(r, /^\/api\/(teacher\/exams|teacher\/courses\/|teacher\/study-groups)/, r);
 assert.doesNotMatch(screens, /isTeacher|role ===|viewer\.role|service[_-]?role/);
 assert.doesNotMatch(screens, /new Date\([^)]*\)\.toISOString\(\)/, 'times go out with Cairo\'s offset, not as UTC');
 for (const page of ['page.tsx', 'new/page.tsx', '[examId]/page.tsx', '[examId]/correct/page.tsx', '[examId]/marks/page.tsx'])
  assert.match(read('app/(dashboard)/(routes)/teacher/exams/' + page), /loadExamPage|staffContext/, page);
});

test('menu: Exams is a real page on the desktop menu and the phone More sheet; only Reports is Soon', () => {
 const nav = load('shared/teacher-home.ts', { '@/shared/teacher-groups': { unsavedSessions: () => [] }, '@/shared/teacher-attendance': { canTakeAttendance: () => false } });
 assert.ok(nav.teacherNav.some(i => i.key === 'exams' && i.href === '/teacher/exams'));
 assert.deepEqual(plain(nav.teacherNavSoon), []);
 assert.ok(nav.teacherExamsActive('/teacher/exams')); assert.ok(nav.teacherExamsActive(`/teacher/exams/${EX}/marks`)); assert.ok(!nav.teacherExamsActive('/teacher/examsx'));
 assert.match(read('frontend/features/teacher-frame/teacher-frame.tsx'), /data-more-item="exams"|data-more-item=\{?['"]exams|'exams'/);
});

test('locales: every Exams text in both languages, same holes, Arabic, none of the ruled-out words; every reason and key on screen has words', () => {
 const keys = Object.keys(messages.en).filter(k => k.startsWith('ex.'));
 assert.ok(keys.length >= 300, String(keys.length));
 for (const k of [...keys, ...Object.keys(messages.ar).filter(k => k.startsWith('ex.'))]) assert.ok(messages.en[k]?.trim() && messages.ar[k]?.trim(), k);
 const holes = s => (s.match(/\{\w+\}/g) ?? []).sort().join();
 for (const k of keys) {
  assert.equal(holes(messages.en[k]), holes(messages.ar[k]), k);
  if (/[a-z]/i.test(messages.en[k].replace(/\{\w+\}/g, ''))) assert.match(messages.ar[k], /[؀-ۿ]/, k);
  assert.doesNotMatch(messages.en[k] + ' ' + messages.ar[k], /\bblocks?\b|\bmodules?\b|\bofferings?\b|\bsegments?\b|\btenants?\b|\bslugs?\b|organi[sz]ation|enrol(l)?ment|\bsubmissions?\b|منظمة|مؤسسة|وحدة|كتل/i, k);
 }
 for (const reason of ex.EXAM_REASONS) assert.ok(messages.en[`ex.fail.${reason}`] && messages.ar[`ex.fail.${reason}`], 'words for ' + reason);
 const used = new Set();
 for (const m of screens.matchAll(/(?:\bt\(|id=|key:\s*|\?\s*|:\s*)['"](ex\.[a-z0-9_.]+)['"]/g)) used.add(m[1]);
 assert.ok(used.size > 50, String(used.size));
 for (const k of used) if (!k.endsWith('.')) assert.ok(k in messages.en && k in messages.ar, 'missing words for ' + k);
 for (const m of screens.matchAll(/`(ex\.[a-z0-9_.]+)\$\{/g)) assert.ok(keys.some(k => k.startsWith(m[1])), 'a family of keys for ' + m[1]);
});
