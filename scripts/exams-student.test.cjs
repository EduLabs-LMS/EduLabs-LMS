// Student Exams (part 2): the four student routes with a stubbed viewer and database client, the reply mapper, the pure rules the screens use
// (clock, answered, sections, second try), the Home "Live now" mapping, the words in both languages, the exact middleware paths and the static
// screen rules. The database's own behaviour is in supabase/tests/exams-student.sql; the screens are photographed by exams-student-browser.cjs.
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
const teacherContract = load('shared/contracts/teacher-exams.ts', { zod: require('zod'), '@/shared/contracts/teacher-homework': hwContract });
const ex = load('shared/teacher-exams.ts', { '@/shared/teacher-homework': hw });
const st = load('shared/exams-student.ts', { '@/shared/teacher-exams': ex });
const contract = load('shared/contracts/exams-student.ts', { zod: require('zod') });
const home = load('shared/teacher-home.ts', { '@/shared/contracts/groups': {}, '@/shared/contracts/communications': {}, '@/shared/teacher-groups': { unsavedSessions: () => [] }, '@/shared/teacher-attendance': { canTakeAttendance: () => true } });
const { messages } = require('./localization-test-loader.cjs').load('frontend/locales/messages.ts');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

// ---------------------------------------------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------------------------------------------
const ORIGIN = 'https://lms.test';
function server({ viewer = { id: uuid(70), backend: 'firebase' }, rpc = {}, staging = true } = {}) {
 const calls = [];
 const client = { rpc: async (name, args) => { calls.push(['rpc', name, args]); const r = rpc[name]; return typeof r === 'function' ? r(args) : r ?? { data: null, error: null }; } };
 const service = load('server/services/exams-student.ts', {
  'server-only': {}, '@/server/integrations/supabase': { getSupabaseServerClient: async () => client },
  '@/server/services/teacher-exams': { examUpload: async (id, input) => { calls.push(['teacher-upload', id, input]); return { status: 200, body: { id: input.id } }; } },
  '@/shared/exams-student': st,
 });
 class NextResponse { constructor(body, init) { this.body = body; this.status = init.status; this.headers = new Map(Object.entries(init.headers ?? {})); } static json(body, init) { return new NextResponse(body, init); } }
 const firebase = { validFirebaseOrigin: r => r.headers.get('origin') === ORIGIN && r.headers.get('sec-fetch-site') !== 'cross-site' };
 const common = { 'server-only': {}, 'next/server': { NextResponse }, zod: require('zod'), '@/server/http/firebase/route': firebase, '@/shared/auth-config': { isFirebaseStaging: () => staging } };
 const teacherHttp = load('server/http/teacher-exams.ts', { ...common, '@/server/services/application-auth': { getApplicationViewer: async () => viewer }, '@/server/services/teacher-exams': {}, '@/shared/contracts/teacher-exams': teacherContract });
 const http = load('server/http/exams-student.ts', { ...common, '@/server/http/teacher-exams': teacherHttp, '@/server/services/exams-student': service, '@/shared/contracts/exams-student': contract });
 return { http, calls };
}
function request(path, { method = 'POST', body, headers = {}, raw } = {}) {
 const h = new Map(Object.entries({ origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers }).filter(([, v]) => v !== null));
 const bytes = raw ?? (body === undefined ? null : Buffer.from(JSON.stringify(body)));
 const url = new URL(ORIGIN + path);
 return { method, headers: { get: k => h.get(k.toLowerCase()) ?? null }, nextUrl: url,
  body: bytes && { getReader: () => { let sent = 0; return { read: async () => sent < bytes.length ? { done: false, value: bytes.subarray(sent, sent += 65536) } : { done: true }, cancel: async () => {} }; } } };
}
const EX = uuid(5), TRY = uuid(6), Q = uuid(31), O1 = uuid(41), O2 = uuid(42), UP = uuid(60);
const one = (examId = EX) => ({ params: Promise.resolve({ examId }) });
const get = (path, headers = { origin: null }) => request(path, { method: 'GET', headers });
const work = (http, body, opts = {}, ctx = one()) => http.studentExamWorkPOST(request(`/api/exams/${EX}/work`, { body, ...opts }), ctx);
const upload = (http, body, opts = {}, ctx = one()) => http.studentExamUploadPOST(request(`/api/exams/${EX}/upload`, { body, ...opts }), ctx);
const list = (http, q = '', headers) => http.studentExamsGET(get('/api/exams' + q, headers));
const view = (http, q = '', ctx = one(), headers) => http.studentExamGET(get(`/api/exams/${EX}${q}`, headers), ctx);
const save = (over = {}) => ({ action: 'save', attemptId: TRY, revision: 3, questionId: Q, optionIds: [O1], ...over });
const STUDENT_VIEW = { staff: false, id: EX, title: 'Quiz', tries: [], serverNow: '2026-11-14T10:00:00Z' };

test('routes: signed out is 401 before any database call; a foreign origin is 403; reads must be same origin; staging only', async () => {
 const out = server({ viewer: null });
 for (const r of [list(out.http), view(out.http)]) assert.equal((await r).status, 401);
 for (const body of [{ action: 'start' }, save(), { action: 'submit', attemptId: TRY, revision: 1 }]) assert.equal((await work(out.http, body)).status, 401);
 assert.equal((await upload(out.http, { action: 'get', id: UP })).status, 401);
 assert.deepEqual(out.calls, []);
 const clerk = server({ viewer: { id: uuid(71), backend: 'clerk' } });
 assert.equal((await list(clerk.http)).status, 401, 'only a Firebase viewer');
 const off = server({ staging: false });
 for (const r of [list(off.http), view(off.http), work(off.http, { action: 'start' }), upload(off.http, { action: 'get', id: UP })]) assert.equal((await r).status, 404);
 const s = server();
 for (const headers of [{ origin: 'https://evil.test' }, { origin: null }]) {
  assert.equal((await work(s.http, save(), { headers })).status, 403, JSON.stringify(headers));
  assert.equal((await upload(s.http, { action: 'get', id: UP }, { headers })).status, 403);
 }
 assert.equal((await list(s.http, '', { origin: null, 'sec-fetch-site': 'cross-site' })).status, 403);
 assert.equal((await view(s.http, '', one(), { origin: 'https://evil.test', 'sec-fetch-site': null })).status, 403);
 assert.deepEqual(s.calls, []);
});

test('routes: bad, oversized, wrongly typed and repeated input is refused before the database', async () => {
 const { http, calls } = server();
 for (const q of ['?x=1', '?attempt=' + TRY + '&attempt=' + TRY]) assert.equal((await list(http, q)).status, 400, q);
 for (const q of ['?attempt=x', '?userId=' + uuid(1), '?attempt=' + TRY + '&attempt=' + TRY, '?attempt=']) assert.equal((await view(http, q)).status, 400, q);
 assert.equal((await view(http, '', one('not-a-uuid'))).status, 400);
 assert.equal((await work(http, { action: 'start' }, {}, one('x'))).status, 400);
 const bad = [
  {}, { action: 'grade' }, { action: 'start', userId: uuid(1) }, { action: 'start', attemptId: TRY }, { action: 'retry', revision: 1 },
  { action: 'submit' }, { action: 'submit', attemptId: TRY }, { action: 'submit', attemptId: 'x', revision: 1 }, { action: 'submit', attemptId: TRY, revision: -1 }, { action: 'submit', attemptId: TRY, revision: 1.5 },
  save({ userId: uuid(1) }), save({ questionId: 'x' }), save({ attemptId: 'x' }), save({ revision: '3' }), save({ revision: -1 }),
  save({ optionIds: [O1, O1] }), save({ optionIds: Array.from({ length: 9 }, (_, i) => uuid(100 + i)) }), save({ optionIds: ['x'] }),
  save({ optionIds: undefined }), save({ optionIds: [O1], numberValue: 1 }), save({ optionIds: [O1], text: 'a' }), save({ optionIds: undefined, numberValue: 1, text: 'a' }),
  save({ optionIds: undefined, numberValue: 'x' }), save({ optionIds: undefined, numberValue: null, uploadId: null }),
  save({ optionIds: undefined, text: 'x'.repeat(10001) }), save({ optionIds: undefined, text: 5 }), save({ optionIds: undefined, uploadId: 'x' }),
 ];
 for (const body of bad) assert.equal((await work(http, body)).status, 400, JSON.stringify(body).slice(0, 80));
 for (const body of [{}, { action: 'intent' }, { action: 'intent', attemptId: TRY, mime: 'application/pdf', name: 'a' }, { action: 'intent', attemptId: TRY, mime: 'image/png', name: 'x'.repeat(256) },
  { action: 'intent', attemptId: TRY, mime: 'image/png', name: 'a', purpose: 'question' }, { action: 'intent', attemptId: TRY, mime: 'image/png', name: 'a', userId: uuid(1) },
  { action: 'complete' }, { action: 'complete', id: 'x' }, { action: 'complete', id: UP, path: 'a/b' }, { action: 'get', id: UP, attemptId: TRY }, { action: 'delete', id: UP }]) assert.equal((await upload(http, body)).status, 400, JSON.stringify(body));
 assert.equal((await work(http, save(), { headers: { 'content-type': 'text/plain' } })).status, 415);
 assert.equal((await work(http, undefined, { raw: Buffer.from('{not json') })).status, 400);
 assert.equal((await work(http, undefined, { raw: Buffer.from('[]') })).status, 400);
 assert.equal((await work(http, undefined, { raw: Buffer.alloc(24001, 32) })).status, 413);
 assert.equal((await work(http, save({ optionIds: undefined, text: 'x'.repeat(10000) }))).status, 200, 'a 10 000 character answer is within the body cap');
 assert.equal((await upload(http, undefined, { raw: Buffer.alloc(2049, 32) })).status, 413);
 assert.deepEqual(calls.filter(c => c[1] !== 'exam_work').length, 0);
 assert.equal(calls.filter(c => c[1] === 'exam_work').length, 1, 'only the valid 10 000 character answer reached the database');
});

test('routes: the user is the signed-in one, never sent; arguments go exactly as the database takes them', async () => {
 const rpc = { exam_student_list: { data: { serverNow: 'x', rows: [] }, error: null }, exam_get: { data: STUDENT_VIEW, error: null }, exam_work: { data: { ok: true }, error: null }, exam_upload: { data: { id: UP, path: `${EX}/${UP}/file` }, error: null } };
 const { http, calls } = server({ rpc });
 let r = await list(http); assert.equal(r.status, 200); assert.deepEqual(plain(r.body), { serverNow: 'x', rows: [] });
 assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
 r = await view(http); assert.equal(r.status, 200);
 r = await view(http, '?attempt=' + TRY); assert.equal(r.status, 200);
 await work(http, { action: 'start' }); await work(http, { action: 'retry' });
 await work(http, { action: 'submit', attemptId: TRY, revision: 7 });
 await work(http, save()); await work(http, save({ optionIds: [] })); await work(http, save({ optionIds: undefined, numberValue: 2.5 })); await work(http, save({ optionIds: undefined, numberValue: null }));
 await work(http, save({ optionIds: undefined, text: 'Because.', uploadId: UP })); await work(http, save({ optionIds: undefined, uploadId: null }));
 await upload(http, { action: 'intent', attemptId: TRY, mime: 'image/png', name: 'a.png' });
 await upload(http, { action: 'complete', id: UP });
 const sent = calls.filter(c => c[0] === 'rpc').map(c => [c[1], c[2]]);
 assert.deepEqual(plain(sent), [
  ['exam_student_list', {}], ['exam_get', { p_exam: EX, p_attempt: null }], ['exam_get', { p_exam: EX, p_attempt: TRY }],
  ['exam_work', { p_exam: EX, p_action: 'start', p_revision: null, p_data: {} }], ['exam_work', { p_exam: EX, p_action: 'retry', p_revision: null, p_data: {} }],
  ['exam_work', { p_exam: EX, p_action: 'submit', p_revision: 7, p_data: { attemptId: TRY } }],
  ['exam_work', { p_exam: EX, p_action: 'save', p_revision: 3, p_data: { attemptId: TRY, questionId: Q, optionIds: [O1] } }],
  ['exam_work', { p_exam: EX, p_action: 'save', p_revision: 3, p_data: { attemptId: TRY, questionId: Q, optionIds: [] } }],
  ['exam_work', { p_exam: EX, p_action: 'save', p_revision: 3, p_data: { attemptId: TRY, questionId: Q, numberValue: 2.5 } }],
  ['exam_work', { p_exam: EX, p_action: 'save', p_revision: 3, p_data: { attemptId: TRY, questionId: Q, numberValue: null } }],
  ['exam_work', { p_exam: EX, p_action: 'save', p_revision: 3, p_data: { attemptId: TRY, questionId: Q, text: 'Because.', uploadId: UP } }],
  ['exam_work', { p_exam: EX, p_action: 'save', p_revision: 3, p_data: { attemptId: TRY, questionId: Q, uploadId: null } }],
  ['exam_upload', { p_exam: EX, p_action: 'intent', p_id: null, p_data: { purpose: 'answer', attemptId: TRY, mime: 'image/png', name: 'a.png' } }],
 ]);
 assert.deepEqual(plain(calls.at(-1)), ['teacher-upload', EX, { action: 'complete', id: UP }], 'the byte check is the shared one');
 assert.ok(!JSON.stringify(sent).includes(uuid(70)), 'the viewer id is never sent');
});

test('routes: a staff view is refused; the database\'s no, and every reason, come back as plain refusals', async () => {
 const staff = server({ rpc: { exam_get: { data: { ...STUDENT_VIEW, staff: true, questions: [{ correctOptionIds: [O1] }] }, error: null } } });
 let r = await view(staff.http); assert.equal(r.status, 404); assert.deepEqual(plain(r.body), { kind: 'denied' });
 for (const data of [null, {}, { staff: 'false' }]) { r = await view(server({ rpc: { exam_get: { data, error: null } } }).http); assert.equal(r.status, 404); }
 // A student of another course, a teacher of this one and a person who is not enrolled all get the database's no.
 for (const code of ['42501', 'PGRST116']) {
  const denied = server({ rpc: { exam_student_list: { data: null, error: { code } }, exam_get: { data: null, error: { code } }, exam_work: { data: null, error: { code } }, exam_upload: { data: null, error: { code } } } });
  for (const run of [list(denied.http), view(denied.http), work(denied.http, { action: 'start' }), work(denied.http, save()), upload(denied.http, { action: 'intent', attemptId: TRY, mime: 'image/png', name: 'a' })]) {
   r = await run; assert.equal(r.status, 403, code); assert.deepEqual(plain(r.body), { kind: 'denied' });
  }
 }
 const cases = [
  [{ code: 'PT409', details: '{"reason":"stale"}' }, 409, { kind: 'changed' }], [{ code: 'PT409', details: '{"reason":"deadline_passed"}' }, 409, { kind: 'refused', reason: 'deadline_passed' }],
  [{ code: 'PT409', details: '{"reason":"no_tries_left"}' }, 409, { kind: 'refused', reason: 'no_tries_left' }], [{ code: 'PT409', details: '{"reason":"not_open"}' }, 409, { kind: 'refused', reason: 'not_open' }],
  [{ code: 'PT409', details: '{"reason":"no_window"}' }, 409, { kind: 'refused', reason: 'no_window' }], [{ code: 'PT409', details: '{"reason":"needs_time"}' }, 409, { kind: 'refused', reason: 'needs_time' }],
  [{ code: 'PT409', details: '{"reason":"started"}' }, 409, { kind: 'refused', reason: 'started' }], [{ code: 'PT409', details: '{"reason":"DROP"}' }, 409, { kind: 'changed' }],
  [{ code: '23514', message: 'This answer is kept from your first try' }, 400, { kind: 'invalid', reason: 'answer_kept' }],
  [{ code: '23514', message: 'This question takes a photo' }, 400, { kind: 'invalid', reason: 'takes_photo' }], [{ code: '23514', message: 'This question takes text only' }, 400, { kind: 'invalid', reason: 'takes_text' }],
  [{ code: '23514', message: 'Invalid choice' }, 400, { kind: 'invalid', reason: 'bad_choice' }], [{ code: '22P02', message: 'Invalid answer' }, 400, { kind: 'invalid', reason: 'bad_answer' }],
  [{ code: '23514', message: 'Start the exam first' }, 400, { kind: 'invalid', reason: 'start_first' }], [{ code: '23514', message: 'Invalid start' }, 400, { kind: 'invalid', reason: 'bad_answer' }],
  [{ code: '23514', message: 'Photo answers are off' }, 400, { kind: 'invalid', reason: 'photos_off' }], [{ code: '23514', message: 'Finish the pending uploads first' }, 400, { kind: 'invalid', reason: 'uploads_pending' }],
  [{ code: '23503', message: 'Photo unavailable' }, 409, { kind: 'refused', reason: 'photo_unavailable' }], [{ code: '23503', message: 'x' }, 409, { kind: 'refused', reason: 'in_use' }],
  [{ code: '22P02', message: 'Invalid exam' }, 400, { kind: 'invalid', reason: 'shape' }], [{ code: '23514', message: 'Something else' }, 400, { kind: 'invalid' }],
  [{ code: 'PT413' }, 413, { kind: 'too_large' }], [{ code: 'XX000', message: 'internal' }, 503, { kind: 'failed' }], [{}, 503, { kind: 'failed' }],
 ];
 for (const [error, status, body] of cases) {
  assert.deepEqual(plain(st.studentReply(error)), { status, body }, JSON.stringify(error));
  const s = server({ rpc: { exam_work: { data: null, error } } });
  r = await work(s.http, save()); assert.equal(r.status, status, JSON.stringify(error)); assert.deepEqual(plain(r.body), body);
 }
 const thrown = server({ rpc: { exam_student_list: () => { throw Error('boom'); } } });
 r = await list(thrown.http); assert.equal(r.status, 503); assert.deepEqual(plain(r.body), { kind: 'failed' });
 for (const reason of st.STUDENT_REASONS) assert.ok(messages.en[`se.fail.${reason}`] && messages.ar[`se.fail.${reason}`], 'words for ' + reason);
});

test('routes: one-line adapters, the timed handlers, signed-in client only, no service role, exact middleware paths', () => {
 const adapters = { 'route.ts': ['StudentExamsGET', 'GET'], '[examId]/route.ts': ['StudentExamGET', 'GET'], '[examId]/work/route.ts': ['StudentExamWorkPOST', 'POST'], '[examId]/upload/route.ts': ['StudentExamUploadPOST', 'POST'] };
 for (const [file, [name, verb]] of Object.entries(adapters)) assert.equal(read('app/api/exams/' + file).trim(), `export { timed${name} as ${verb} } from '@/server/http/timed';`, file);
 const timed = read('server/http/timed.ts');
 for (const [name] of Object.values(adapters)) assert.match(timed, new RegExp(`export const timed${name} = withServerTiming\\(${name[0].toLowerCase() + name.slice(1)}\\)`), name);
 const code = read('server/http/exams-student.ts') + read('server/services/exams-student.ts');
 assert.doesNotMatch(code, /service[_-]?role|supabaseAdmin|SERVICE_ROLE/i);
 assert.doesNotMatch(code, /body\.data\.userId|userId:\s*body|auth\.uid|\bp_user\b/, 'no user from the client');
 const source = read('middleware.ts');
 const pattern = line => { const start = line.indexOf('/^'), end = line.indexOf('$/.test', start); return new RegExp(line.slice(start + 1, end + 1)); };
 const apiLine = source.split('\n').find(l => l.includes("path === '/api/exams'")), pageLine = source.split('\n').find(l => l.includes("path === '/exams'"));
 const api = pattern(apiLine), page = pattern(pageLine), id = uuid(1);
 for (const good of [`/api/exams/${id}`, `/api/exams/${id}/work`, `/api/exams/${id}/upload`]) assert.ok(api.test(good), good);
 for (const bad of ['/api/exams/new', `/api/exams/${id}/`, `/api/exams/${id}/save`, `/api/exams/${id}/work/x`, `/api/exams/${id}/tries/${uuid(2)}`, '/api/exams/x/work', '/api/examsx', '/api/exams/ABCDEF00-0000-4000-8000-000000000001']) assert.ok(!api.test(bad), bad);
 assert.ok(page.test(`/exams/${id}`)); for (const bad of [`/exams/${id}/x`, '/exams/x', `/exams/${id}/`]) assert.ok(!page.test(bad), bad);
 assert.match(pageLine, /no-referrer/); assert.match(pageLine, /private, no-store/);
 for (const p of ['', '/[examId]']) assert.ok(fs.existsSync(`app/(dashboard)/(routes)/exams${p}/page.tsx`), p);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The rules on screen
// ---------------------------------------------------------------------------------------------------------------------------------
test('the clock: the server\'s time carried forward, never negative, readable', () => {
 const offset = st.clockOffset('2026-11-14T10:00:00Z', Date.parse('2026-11-14T10:05:00Z'));
 assert.equal(offset, -5 * 60000, 'a device clock five minutes fast');
 assert.equal(st.secondsLeft('2026-11-14T10:30:00Z', offset, Date.parse('2026-11-14T10:05:00Z')), 1800);
 assert.equal(st.secondsLeft('2026-11-14T10:30:00Z', offset, Date.parse('2026-11-14T10:05:00Z') + 1500000), 300);
 assert.equal(st.secondsLeft('2026-11-14T10:00:00Z', 0, Date.parse('2026-11-14T10:00:00Z') + 5000), 0);
 assert.equal(st.clockOffset('garbage', 5), 0);
 assert.equal(st.clockText(0), '00:00'); assert.equal(st.clockText(65), '01:05'); assert.equal(st.clockText(3661), '1:01:01'); assert.equal(st.clockText(-5), '00:00');
});

const item = (over = {}) => ({ id: uuid(200), position: 1, type: 'single_choice', text: 'Q', imageId: null, points: 2, responseMode: 'text', options: [{ id: O1, text: 'a' }, { id: O2, text: 'b' }], answer: null, mark: null, ...over });
test('answers: what counts as answered (Arabic digits too), the question numbers left blank, the draft of a saved answer', () => {
 const num = item({ id: uuid(201), type: 'number' }), essay = item({ id: uuid(202), type: 'essay', options: [] }), many = item({ id: uuid(203), type: 'multiple_choice' });
 const items = [item(), num, essay, many];
 const drafts = { [items[0].id]: { optionIds: [O1], number: '', text: '', uploadId: null }, [num.id]: { optionIds: [], number: '٣٫٥', text: '', uploadId: null }, [essay.id]: { optionIds: [], number: '', text: '  ', uploadId: null }, [many.id]: { optionIds: [], number: '', text: '', uploadId: null } };
 assert.deepEqual(plain(st.unanswered(items, drafts, ex.parseNumber)), [3, 4]);
 drafts[essay.id].uploadId = uuid(9); assert.deepEqual(plain(st.unanswered(items, drafts, ex.parseNumber)), [4]);
 drafts[num.id].number = 'abc'; assert.deepEqual(plain(st.unanswered(items, drafts, ex.parseNumber)), [2, 4]);
 assert.equal(st.isAnswered(items[0], undefined, ex.parseNumber), false);
 assert.deepEqual(plain(st.draftOf(item({ answer: { optionIds: [O2], numberValue: null, text: null, uploadId: null, kept: false, savedAt: null } }))), { optionIds: [O2], number: '', text: '', uploadId: null });
 assert.deepEqual(plain(st.draftOf(num)), { optionIds: [], number: '', text: '', uploadId: null });
 assert.equal(st.draftOf(item({ type: 'number', answer: { optionIds: null, numberValue: 0, text: null, uploadId: null, kept: true, savedAt: null } })).number, '0', 'zero is an answer');
});

const NOW = Date.parse('2026-11-14T12:00:00Z');
const row = (over = {}) => ({ id: EX, title: 'Quiz', kind: 'online', status: 'published', courseId: uuid(80), courseTitle: 'Physics', offeringId: uuid(8), heldOn: null, timeLimitMinutes: 30, tries: 'one_time',
 window: { opensAt: '2026-11-14T11:00:00Z', closesAt: '2026-11-14T14:00:00Z', state: 'ok' }, tryState: 'not_started', result: null, ...over });
test('the list: open now, coming up with the student\'s own window, handed in, results, closed', () => {
 assert.equal(st.sectionOf(row(), NOW), 'open');
 assert.equal(st.sectionOf(row({ window: { opensAt: '2026-11-15T11:00:00Z', closesAt: '2026-11-15T14:00:00Z', state: 'ok' } }), NOW), 'upcoming');
 assert.equal(st.sectionOf(row({ window: { opensAt: '2026-11-13T11:00:00Z', closesAt: '2026-11-13T14:00:00Z', state: 'ok' } }), NOW), 'closed');
 assert.equal(st.sectionOf(row({ window: { opensAt: null, closesAt: null, state: 'needs_time' } }), NOW), 'closed');
 assert.equal(st.sectionOf(row({ window: null }), NOW), 'closed');
 assert.equal(st.sectionOf(row({ tryState: 'in_progress' }), NOW), 'open');
 assert.equal(st.sectionOf(row({ tryState: 'submitted' }), NOW), 'waiting');
 assert.equal(st.sectionOf(row({ tryState: 'submitted', result: { score: 4, maxScore: 5, absent: false } }), NOW), 'results');
 assert.equal(st.sectionOf(row({ kind: 'paper', window: null }), NOW), 'waiting');
 assert.equal(st.sectionOf(row({ kind: 'paper', window: null, result: { score: null, maxScore: 50, absent: true } }), NOW), 'results');
 assert.deepEqual(plain(st.SECTIONS), ['open', 'upcoming', 'waiting', 'results', 'closed']);
});

const v = (over = {}) => ({ kind: 'online', status: 'published', rule: 'fix_mistakes', tries: [], window: row().window, ...over });
const tried = (status = 'submitted', n = 1) => ({ id: uuid(300 + n), number: n, status, startedAt: '2026-11-14T11:10:00Z', deadlineAt: '2026-11-14T11:40:00Z', submittedAt: null, autoSubmitted: false, revision: 1 });
test('start and second try: only inside the student\'s own window, by the rule, once', () => {
 assert.equal(st.canStart(v(), NOW), true);
 assert.equal(st.canStart(v({ tries: [tried()] }), NOW), false);
 assert.equal(st.canStart(v({ window: { opensAt: '2026-11-14T12:30:00Z', closesAt: '2026-11-14T14:00:00Z', state: 'ok' } }), NOW), false);
 assert.equal(st.canStart(v({ window: { opensAt: '2026-11-14T10:00:00Z', closesAt: '2026-11-14T11:59:59Z', state: 'ok' } }), NOW), false);
 assert.equal(st.canStart(v({ window: { opensAt: null, closesAt: null, state: 'needs_time' } }), NOW), false);
 assert.equal(st.canStart(v({ status: 'archived' }), NOW), false); assert.equal(st.canStart(v({ kind: 'paper' }), NOW), false);
 assert.equal(st.canRetry(v({ tries: [tried()] }), NOW), true);
 assert.equal(st.canRetry(v({ rule: 'from_zero', tries: [tried()] }), NOW), true);
 assert.equal(st.canRetry(v({ rule: 'one_time', tries: [tried()] }), NOW), false);
 assert.equal(st.canRetry(v({ rule: null, tries: [tried()] }), NOW), false);
 assert.equal(st.canRetry(v({ tries: [tried('in_progress')] }), NOW), false);
 assert.equal(st.canRetry(v({ tries: [tried(), tried('submitted', 2)] }), NOW), false, 'never a third try');
 assert.equal(st.canRetry(v({ tries: [tried()], window: { opensAt: '2026-11-14T08:00:00Z', closesAt: '2026-11-14T11:00:00Z', state: 'ok' } }), NOW), false, 'not after the window');
});

test('Home "Live now": one row per open Group with that Group\'s started / total, soonest close first, five at most, hidden when nothing is open', () => {
 const group = (id, name, started, total, closesAt, window = 'open') => ({ groupId: id, name, state: 'ok', opensAt: '2026-11-14T11:00:00Z', closesAt, window, secondsLeft: 100, total, started });
 const exam = (id, title, groups, over = {}) => ({ id, title, kind: 'online', status: 'published', courseTitle: 'Physics', groups, noGroup: null, ...over });
 const rows = [
  exam(uuid(1), 'Quiz', [group(uuid(11), 'Group 1', 3, 5, '2026-11-14T15:00:00Z'), group(uuid(12), 'Group 2', 0, 4, '2026-11-14T13:00:00Z'), group(uuid(13), 'Group 3', 1, 1, '2026-11-14T10:00:00Z', 'closed'), group(uuid(14), 'Group 4', 0, 2, '2026-11-15T10:00:00Z', 'upcoming')]),
  exam(uuid(2), 'Paper', [group(uuid(21), 'Group 1', 0, 5, '2026-11-14T15:00:00Z')], { kind: 'paper' }), exam(uuid(3), 'Draft', [group(uuid(31), 'Group 1', 0, 5, '2026-11-14T15:00:00Z')], { status: 'draft' }),
  exam(uuid(4), 'No groups', null), { id: 5 }, null,
 ];
 const out = home.mapExams({ ok: true, value: { rows } });
 assert.equal(out.state, 'ready');
 assert.deepEqual(plain(out.data.items.map(x => [x.title, x.groupName, x.started, x.total])), [['Quiz', 'Group 2', 0, 4], ['Quiz', 'Group 1', 3, 5]]);
 assert.equal(out.data.more, 0);
 assert.deepEqual(plain(home.mapExams({ ok: true, value: { rows: [] } })), { state: 'ready', data: { items: [], more: 0 } });
 assert.deepEqual(plain(home.mapExams({ ok: true, value: {} })), { state: 'ready', data: { items: [], more: 0 } });
 assert.deepEqual(plain(home.mapExams({ ok: false, status: 503 })), { state: 'error', status: 503 });
 const many = Array.from({ length: 8 }, (_, i) => exam(uuid(100 + i), 'E' + i, [group(uuid(200 + i), 'G', i, 9, `2026-11-14T1${i}:00:00Z`)]));
 const big = home.mapExams({ ok: true, value: { rows: many } });
 assert.equal(big.data.items.length, 5); assert.equal(big.data.more, 3); assert.equal(big.data.items[0].title, 'E0');
 const service = read('server/services/teacher-home.ts');
 assert.match(service, /readExamPortal\(null, 'open', 0\)/); assert.match(service, /isFirebaseStaging\(\) \? settle/);
 const homeView = read('frontend/features/teacher-home/home-view.tsx');
 assert.match(homeView, /data-section="th-live-exams"/); assert.match(homeView, /href="\/teacher\/exams"/);
});

const featureFiles = fs.readdirSync('frontend/features/student-exams').map(f => 'frontend/features/student-exams/' + f);
const screens = featureFiles.map(read).join('\n');
test('screens: no native alert or confirm, no client user id, only the exam routes, the order of a try is never changed, nothing decided by a role', () => {
 assert.doesNotMatch(screens, /\b(window\.)?(alert|confirm|prompt)\(/);
 assert.doesNotMatch(screens, /userId|user_id|\bisStaff|\.sort\(|\.reverse\(\)\.map|localStorage/);
 for (const m of screens.matchAll(/['"`](\/api\/[^'"`$]*)/g)) assert.match(m[1], /^\/api\/exams/, m[1]);
 assert.match(screens, /data-timer=/); assert.match(screens, /inputMode="decimal"/); assert.match(screens, /role="timer"/);
 assert.match(read('frontend/features/student-exams/question-card.tsx'), /item\.options\.map/);
});

test('locales: every student Exams text and the Home card in both languages, same holes, Arabic, none of the ruled-out words, every key on screen has words', () => {
 const keys = Object.keys(messages.en).filter(k => k.startsWith('se.') || k.startsWith('th.live.'));
 assert.ok(keys.length >= 120, String(keys.length));
 for (const k of [...keys, ...Object.keys(messages.ar).filter(k => k.startsWith('se.') || k.startsWith('th.live.'))]) assert.ok(messages.en[k]?.trim() && messages.ar[k]?.trim(), k);
 const holes = s => (s.match(/\{\w+\}/g) ?? []).sort().join();
 for (const k of keys) {
  assert.equal(holes(messages.en[k]), holes(messages.ar[k]), k);
  if (/[a-z]/i.test(messages.en[k].replace(/\{\w+\}/g, ''))) assert.match(messages.ar[k], /[؀-ۿ]/, k);
  assert.doesNotMatch(messages.en[k] + ' ' + messages.ar[k], /\bblocks?\b|\bmodules?\b|\bofferings?\b|\bsegments?\b|\btenants?\b|\bslugs?\b|organi[sz]ation|enrol(l)?ment|\bsubmissions?\b|منظمة|مؤسسة|وحدة|كتل/i, k);
 }
 const used = new Set();
 for (const m of (screens + read('frontend/features/teacher-home/home-view.tsx')).matchAll(/['"](se\.[a-z0-9_.]+|th\.live\.[a-z_]+)['"]/g)) used.add(m[1]);
 assert.ok(used.size > 80, String(used.size));
 for (const k of used) assert.ok(k in messages.en && k in messages.ar, 'missing words for ' + k);
 for (const k of ['denied', 'stale', 'too_large', 'failed', 'unknown', 'invalid']) assert.ok(messages.en[`se.fail.${k}`], k);
});
