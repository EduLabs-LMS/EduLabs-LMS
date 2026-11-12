// Homework part 2: correcting (the queue, one try, grade and release, Release N grades), the Home card's mapping, the student lesson
// page by lesson id, Try again and the student refusals in plain words. Routes run with a stubbed viewer and database client; the
// database's own behaviour is in supabase/tests/homework-correct.sql; the screens are in homework-correct-browser.cjs.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
function load(file, deps = {}, extra = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { module: m, exports: m.exports, URL, Array, Map, Set, JSON, Number, Date, Intl, Math, Object, String, Buffer, Uint8Array, Error, console, ...extra,
   require: n => n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const read = f => fs.readFileSync(f, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const hw = load('shared/teacher-homework.ts');
const correct = load('shared/teacher-homework-correct.ts', { '@/shared/teacher-homework': hw });
const contract = load('shared/contracts/teacher-homework.ts', { zod: require('zod') });
const lessons = load('shared/contracts/lessons.ts', { zod: require('zod') });
const studentLesson = load('shared/student-lesson.ts', { '@/shared/contracts/lessons': lessons });
const student = load('shared/student-homework.ts');
const { messages } = require('./localization-test-loader.cjs').load('frontend/locales/messages.ts');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const MAX = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------------------------------------------
const ORIGIN = 'https://lms.test';
function server({ viewer = { id: uuid(70), backend: 'firebase' }, rpc = {} } = {}) {
 const calls = [];
 const client = { rpc: async (name, args) => { calls.push(['rpc', name, args]); const r = rpc[name]; return typeof r === 'function' ? r(args) : r ?? { data: null, error: null }; } };
 const service = load('server/services/teacher-homework.ts', {
  'server-only': {}, '@/server/integrations/supabase': { getSupabaseServerClient: async () => client },
  '@/server/services/homework': { homeworkService: async () => ({ client }) }, '@/server/services/teacher-course': { editableTeacherCourse: async () => true },
  '@/shared/teacher-homework': hw,
 });
 class NextResponse { constructor(body, init) { this.body = body; this.status = init.status; this.headers = new Map(Object.entries(init.headers ?? {})); } static json(body, init) { return new NextResponse(body, init); } }
 const http = load('server/http/teacher-homework.ts', {
  'server-only': {}, 'next/server': { NextResponse }, zod: require('zod'),
  '@/server/http/firebase/route': { validFirebaseOrigin: r => r.headers.get('origin') === ORIGIN && r.headers.get('sec-fetch-site') !== 'cross-site' },
  '@/server/services/application-auth': { getApplicationViewer: async () => viewer },
  '@/server/services/teacher-homework': service, '@/shared/auth-config': { isFirebaseStaging: () => true }, '@/shared/contracts/teacher-homework': contract,
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
const HW = uuid(5), TRY = uuid(6);
const one = (homeworkId = HW) => ({ params: Promise.resolve({ homeworkId }) });
const two = (homeworkId = HW, submissionId = TRY) => ({ params: Promise.resolve({ homeworkId, submissionId }) });
const get = (path, headers = { origin: null }) => request(path, { method: 'GET', headers });
const queue = (http, q = '', ctx = one()) => http.homeworkQueueGET(get(`/api/teacher/homework/${HW}/queue${q}`), ctx);
const tryGet = (http, ctx = two(), q = '') => http.homeworkTryGET(get(`/api/teacher/homework/${HW}/tries/${TRY}${q}`), ctx);
const tryPost = (http, body, opts = {}, ctx = two()) => http.homeworkTryPOST(request(`/api/teacher/homework/${HW}/tries/${TRY}`, { body, ...opts }), ctx);
const many = (http, body, opts = {}, ctx = one()) => http.homeworkReleaseManyPOST(request(`/api/teacher/homework/${HW}/release-many`, { body, ...opts }), ctx);
const grade = (over = {}) => ({ action: 'grade', revision: 3, feedback: 'Good work.', reason: '', marks: [{ questionId: uuid(31), points: 4, feedback: 'Write the unit.' }], ...over });

test('routes: signed out is 401 before any database call; a foreign origin is 403; reads must be same origin', async () => {
 const { http, calls } = server({ viewer: null });
 assert.equal((await queue(http)).status, 401);
 assert.equal((await tryGet(http)).status, 401);
 assert.equal((await tryPost(http, grade())).status, 401);
 assert.equal((await many(http, { items: [{ submissionId: TRY, revision: 1 }] })).status, 401);
 assert.deepEqual(calls, []);
 const student = server({ viewer: { id: uuid(71), backend: 'clerk' } });
 assert.equal((await queue(student.http)).status, 401, 'only a Firebase viewer');
 const s = server();
 assert.equal((await tryPost(s.http, grade(), { headers: { origin: 'https://evil.test' } })).status, 403);
 assert.equal((await tryPost(s.http, grade(), { headers: { origin: null } })).status, 403, 'a write must say where it came from');
 assert.equal((await many(s.http, { items: [{ submissionId: TRY, revision: 1 }] }, { headers: { origin: 'https://evil.test' } })).status, 403);
 assert.equal((await s.http.homeworkQueueGET(get(`/api/teacher/homework/${HW}/queue`, { origin: null, 'sec-fetch-site': 'cross-site' }), one())).status, 403);
 assert.equal((await s.http.homeworkTryGET(get(`/api/teacher/homework/${HW}/tries/${TRY}`, { origin: 'https://evil.test', 'sec-fetch-site': null }), two())).status, 403);
 assert.deepEqual(s.calls, []);
});

test('routes: bad, oversized, wrongly typed and repeated input is refused before the database', async () => {
 const { http, calls } = server();
 for (const q of ['?tab=to_correct&tab=done', '?tab=all', '?page=-1', '?page=1.5', '?userId=' + uuid(1), '?tab=open']) assert.equal((await queue(http, q)).status, 400, q);
 assert.equal((await queue(http, '', one('new'))).status, 400, 'new is only for saving');
 assert.equal((await tryGet(http, two(HW, 'x'))).status, 400);
 assert.equal((await tryGet(http, two('x', TRY))).status, 400);
 assert.equal((await tryGet(http, two(), '?user=' + uuid(1))).status, 400, 'a try read takes no query');
 for (const body of [
  grade({ userId: uuid(70) }), grade({ status: 'approved' }), grade({ revision: '3' }), grade({ revision: -1 }), grade({ marks: [{ questionId: uuid(31), points: 101, feedback: '' }] }),
  grade({ marks: [{ questionId: uuid(31), points: 1.5, feedback: '' }] }), grade({ marks: [{ questionId: uuid(31), points: 1, feedback: '' }, { questionId: uuid(31), points: 2, feedback: '' }] }),
  grade({ marks: [{ questionId: 'x', points: 1, feedback: '' }] }), grade({ marks: [{ questionId: uuid(31), points: 1, feedback: '', userId: uuid(70) }] }), grade({ feedback: 'x'.repeat(10001) }),
  grade({ reason: 'x'.repeat(4001) }), { action: 'release', revision: 3, reason: '', status: 'resubmit_required' }, { action: 'release', revision: 3 }, { action: 'annotate', revision: 3 }, { action: 'grade' },
 ]) assert.equal((await tryPost(http, body)).status, 400, JSON.stringify(body).slice(0, 120));
 assert.equal((await tryPost(http, grade(), { headers: { 'content-type': 'text/plain' } })).status, 415);
 assert.equal((await tryPost(http, undefined, { raw: Buffer.from('{not json') })).status, 400);
 assert.equal((await tryPost(http, undefined, { raw: Buffer.alloc(600001, 32) })).status, 413);
 assert.equal((await tryPost(http, grade(), {}, two(HW, 'x'))).status, 400);
 const items = n => Array.from({ length: n }, (_, i) => ({ submissionId: uuid(1000 + i), revision: i }));
 for (const body of [{ items: [] }, { items: items(501) }, { items: [{ submissionId: TRY, revision: 1 }, { submissionId: TRY, revision: 2 }] }, { items: items(2), homeworkId: HW },
  { items: [{ submissionId: TRY, revision: 1, userId: uuid(70) }] }, { items: [{ submissionId: TRY, revision: '1' }] }, { items: [{ submissionId: 'x', revision: 1 }] }])
  assert.equal((await many(http, body)).status, 400, JSON.stringify(body).slice(0, 80));
 assert.equal((await many(http, undefined, { raw: Buffer.alloc(64001, 32) })).status, 413);
 assert.equal((await many(http, { items: [{ submissionId: TRY, revision: 1 }] }, {}, one('new'))).status, 400);
 assert.deepEqual(calls, [], 'nothing reached the database');
});

test('routes: the user is the signed-in one, never sent; arguments go exactly as the database takes them; revisions round-trip', async () => {
 const view = { id: HW, revision: MAX, staff: true, canGrade: true, canRelease: false, submissions: [{ id: TRY, revision: MAX - 1, correction: { revision: MAX - 2 } }] };
 const queueBody = { tab: 'done', page: 2, readyToRelease: 1, releasable: [{ submissionId: TRY, revision: MAX }], rows: [] };
 const s = server({ rpc: {
  homework_queue: { data: queueBody, error: null }, get_homework: { data: view, error: null },
  homework_work: args => ({ data: { id: TRY, correction: { revision: args.p_revision + 1 } }, error: null }),
  homework_release_many: { data: { released: 1, items: [{ submissionId: TRY, revision: MAX }] }, error: null },
 } });
 const q = await queue(s.http, '?tab=done&page=2');
 assert.equal(q.status, 200); assert.deepEqual(plain(q.body), queueBody); assert.equal(q.headers.get('Cache-Control'), 'private, no-store');
 assert.deepEqual(plain(s.calls.at(-1)), ['rpc', 'homework_queue', { p_assignment: HW, p_tab: 'done', p_page: 2 }]);
 await queue(s.http); assert.deepEqual(plain(s.calls.at(-1)[2]), { p_assignment: HW, p_tab: 'to_correct', p_page: 0 }, 'the defaults');
 const t = await tryGet(s.http);
 assert.equal(t.status, 200); assert.equal(t.body.revision, MAX); assert.equal(t.body.submissions[0].correction.revision, MAX - 2);
 assert.deepEqual(plain(s.calls.at(-1)), ['rpc', 'get_homework', { p_assignment: HW, p_submission: TRY }]);
 const g = await tryPost(s.http, grade({ revision: MAX - 2 }));
 assert.equal(g.status, 200); assert.equal(g.body.correction.revision, MAX - 1);
 assert.deepEqual(plain(s.calls.at(-1)), ['rpc', 'homework_work', { p_assignment: HW, p_action: 'grade', p_submission: TRY, p_revision: MAX - 2,
  p_data: { score: null, feedback: 'Good work.', reason: '', marks: [{ questionId: uuid(31), points: 4, feedback: 'Write the unit.' }] } }]);
 await tryPost(s.http, { action: 'release', revision: 7, reason: '' });
 assert.deepEqual(plain(s.calls.at(-1)[2]), { p_assignment: HW, p_action: 'release', p_submission: TRY, p_revision: 7, p_data: { status: 'approved', reason: '' } }, 'a release is always approved');
 await tryPost(s.http, grade({ reason: 'Marked the unit' }));
 assert.equal(s.calls.at(-1)[2].p_data.reason, 'Marked the unit', 'the reason for a released grade travels to the audit');
 const m = await many(s.http, { items: [{ submissionId: TRY, revision: MAX }] });
 assert.equal(m.status, 200); assert.deepEqual(plain(m.body), { released: 1, items: [{ submissionId: TRY, revision: MAX }] });
 assert.deepEqual(plain(s.calls.at(-1)), ['rpc', 'homework_release_many', { p_assignment: HW, p_items: [{ submissionId: TRY, revision: MAX }] }]);
 assert.ok(!JSON.stringify(s.calls).includes(uuid(70)), 'no user id is sent: the database reads it from the signed-in identity');
});

test('routes: every refusal the database can give is mapped to a code and a reason', async () => {
 const cases = [
  [{ code: '42501', message: 'Homework unavailable' }, 403, { kind: 'denied' }, 'another space\'s teacher'],
  [{ code: '42501', message: 'Correction denied' }, 403, { kind: 'denied' }, 'an assistant whose correct or release right is off'],
  [{ code: 'PGRST116', message: 'no rows' }, 403, { kind: 'denied' }],
  [{ code: 'PT409', message: 'Correction changed; reload' }, 409, { kind: 'changed' }, 'stale'],
  [{ code: 'PT409', message: 'Grades changed; reload', details: '{"reason":"stale","submissionId":"' + TRY + '"}' }, 409, { kind: 'changed' }, 'bulk stale'],
  [{ code: '23514', message: 'Released correction requires an audit reason' }, 400, { kind: 'invalid', reason: 'reason_required' }],
  [{ code: '23514', message: 'Invalid written marks' }, 400, { kind: 'invalid', reason: 'marks' }],
  [{ code: '23514', message: 'Finish correction before release' }, 400, { kind: 'invalid', reason: 'unfinished' }],
  [{ code: '23514', message: 'Some grades cannot be released', details: '{"reason":"already_released","submissionId":"' + TRY + '"}' }, 400, { kind: 'invalid', reason: 'already_released' }],
  [{ code: '23514', message: 'Some grades cannot be released', details: '{"reason":"unfinished"}' }, 400, { kind: 'invalid', reason: 'unfinished' }],
  [{ code: '23514', message: 'At most 500 grades at a time' }, 400, { kind: 'invalid', reason: 'too_many' }],
  [{ code: '23514', message: 'A grade is listed twice' }, 400, { kind: 'invalid', reason: 'duplicate' }],
  [{ code: '23514', message: 'Choose the grades to release' }, 400, { kind: 'invalid', reason: 'empty' }],
  [{ code: '23514', message: 'Tries replace the resubmit request for this homework' }, 400, { kind: 'invalid' }],
  [{ code: '23514', message: 'x', details: '{"reason":"Not A Reason!"}' }, 400, { kind: 'invalid' }, 'a malformed detail reason is not passed on'],
  [{ code: 'XX000', message: 'boom' }, 503, { kind: 'failed' }],
 ];
 for (const [error, status, body, note] of cases) {
  const s = server({ rpc: { homework_work: { data: null, error }, homework_release_many: { data: null, error }, homework_queue: { data: null, error }, get_homework: { data: null, error } } });
  for (const r of [await tryPost(s.http, grade()), await many(s.http, { items: [{ submissionId: TRY, revision: 1 }] }), await queue(s.http), await tryGet(s.http)]) {
   assert.equal(r.status, status, error.message + (note ? ' (' + note + ')' : '')); assert.deepEqual(plain(r.body), body, error.message);
  }
 }
 const thrown = server({ rpc: { homework_work: () => { throw Error('network'); }, homework_queue: () => { throw Error('network'); } } });
 assert.equal((await tryPost(thrown.http, grade())).status, 503); assert.equal((await queue(thrown.http)).status, 503);
 for (const view of [{ staff: false, submissions: [{}] }, { staff: true, submissions: [] }, { staff: true, submissions: [{}, {}] }, null]) {
  const s = server({ rpc: { get_homework: { data: view, error: null } } });
  assert.equal((await tryGet(s.http)).status, 404, 'a try is read by staff only, exactly one: ' + JSON.stringify(view));
 }
});

test('the screen reads a refusal back into words: every reason the routes send has a sentence in both languages', () => {
 const words = read('frontend/features/teacher-homework/homework-words.ts');
 for (const reason of ['reason_required', 'marks', 'unfinished', 'too_many', 'duplicate', 'empty', 'already_released']) {
  assert.match(words, new RegExp(`${reason}: 'hw\\.fail\\.${reason}'`), reason);
  assert.ok(messages.en[`hw.fail.${reason}`] && messages.ar[`hw.fail.${reason}`], reason);
 }
 assert.deepEqual(plain(hw.homeworkFailure(409, { kind: 'changed' })), { kind: 'changed' });
 assert.deepEqual(plain(hw.homeworkFailure(400, { kind: 'invalid', reason: 'already_released' })), { kind: 'invalid', reason: 'already_released' });
 assert.deepEqual(plain(hw.homeworkFailure(403, { kind: 'denied' })), { kind: 'denied' });
});

test('middleware: the correcting endpoints and page pass by exact path; the student lesson page too; nothing next to them does', () => {
 const source = read('middleware.ts');
 const pattern = line => { const start = line.indexOf('/^'), end = line.indexOf('$/.test', start); return new RegExp(line.slice(start + 1, end + 1)); };
 const api = pattern(source.split('\n').find(l => l.includes("path === '/api/teacher/homework'")));
 const pageLine = source.split('\n').find(l => l.includes("path === '/teacher/homework'")), page = pattern(pageLine);
 const lessonLine = source.split('\n').find(l => l.includes('\\/lessons\\/')), lesson = pattern(lessonLine);
 const id = uuid(1), sub = uuid(2);
 for (const good of [`/api/teacher/homework/${id}/queue`, `/api/teacher/homework/${id}/release-many`, `/api/teacher/homework/${id}/tries/${sub}`]) assert.ok(api.test(good), good);
 for (const bad of [`/api/teacher/homework/${id}/tries`, `/api/teacher/homework/${id}/tries/x`, `/api/teacher/homework/${id}/tries/${sub}/release`, `/api/teacher/homework/new/queue`,
  `/api/teacher/homework/${id}/queue/x`, `/api/teacher/homework/${id}/release`, `/api/teacher/homework/${id}/tries/ABCDEF00-0000-4000-8000-000000000002`]) assert.ok(!api.test(bad), bad);
 assert.ok(page.test(`/teacher/homework/${id}/correct`)); assert.ok(!page.test(`/teacher/homework/${id}/correct/x`)); assert.ok(!page.test('/teacher/homework/new/correct'));
 assert.match(pageLine, /no-referrer/); assert.match(pageLine, /private, no-store/);
 assert.ok(lesson.test(`/courses/${id}/lessons/${sub}`)); for (const bad of [`/courses/${id}/lessons`, `/courses/${id}/lessons/x`, `/courses/x/lessons/${sub}`, `/courses/${id}/lessons/${sub}/edit`]) assert.ok(!lesson.test(bad), bad);
 for (const f of ['app/api/teacher/homework/[homeworkId]/queue/route.ts', 'app/api/teacher/homework/[homeworkId]/release-many/route.ts', 'app/api/teacher/homework/[homeworkId]/tries/[submissionId]/route.ts']) {
  const code = read(f); assert.ok(code.split(/\r?\n/).filter(Boolean).length === 1, f + ' is a one-line adapter'); assert.match(code, /from '@\/server\/http\/timed'/);
 }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Correcting logic
// ---------------------------------------------------------------------------------------------------------------------------------
const Q = n => uuid(30 + n), O = n => uuid(200 + n);
const view = { definition: { title: 'Ohm', mode: 'PLATFORM_QUESTIONS', rules: { maxTries: 2 }, questions: [
 { id: Q(1), type: 'single_choice', text: '', imageId: null, points: 1, responseMode: 'text', options: [O(1), O(2), O(3), O(4)].map(id => ({ id, text: '' })), correctIds: [O(2)], modelAnswer: '' },
 { id: Q(2), type: 'multiple_choice', text: 'Which?', imageId: null, points: 2, responseMode: 'text', options: [O(5), O(6), O(7)].map(id => ({ id, text: '' })), correctIds: [O(5), O(7)], modelAnswer: '' },
 { id: Q(3), type: 'essay', text: 'Explain', imageId: null, points: 4, responseMode: 'both', options: [], correctIds: [], modelAnswer: 'V = IR' },
 { id: Q(4), type: 'essay', text: 'Kept one', imageId: null, points: 3, responseMode: 'text', options: [], correctIds: [], modelAnswer: '' },
] } };
const attempt = {
 answers: [{ questionId: Q(1), optionIds: [O(2)], text: '', fileIds: [] }, { questionId: Q(2), optionIds: [O(6)], text: '', fileIds: [] },
  { questionId: Q(3), optionIds: [], text: 'V is 6', fileIds: [uuid(90)] }, { questionId: Q(4), optionIds: [], text: 'Kept', fileIds: [], kept: true }],
 files: [{ id: uuid(90), name: 'photo.jpg', mime: 'image/jpeg', deleted: true }],
 correction: { status: 'under_correction', revision: 4, released: false, score: null, feedback: '', marks: [{ questionId: Q(1), points: 1, feedback: '' }, { questionId: Q(2), points: 0, feedback: '' }, { questionId: Q(3), points: null, feedback: '' }, { questionId: Q(4), points: 2, feedback: 'ok' }] },
};
test('choice summary: right or wrong per question with letters (Arabic letters in Arabic), the points the database gave', () => {
 const en = plain(correct.choiceSummary(view, attempt, 'en'));
 assert.deepEqual(en.map(c => [c.n, c.picked, c.right, c.correct, c.points, c.max]), [[1, ['B'], ['B'], true, 1, 1], [2, ['B'], ['A', 'C'], false, 0, 2]]);
 const ar = plain(correct.choiceSummary(view, attempt, 'ar'));
 assert.deepEqual(ar[1].right, ['أ', 'ج']); assert.deepEqual(ar[0].picked, ['ب']);
 const blank = plain(correct.choiceSummary(view, { answers: [], correction: undefined }, 'en'));
 assert.equal(blank[0].answered, false); assert.equal(blank[0].correct, false); assert.equal(blank[0].points, 0);
});
test('essays: text and photo exactly as sent, a deleted photo says so, kept essays are not editable and keep their mark', () => {
 const e = correct.essayLines(view, attempt);
 assert.equal(e.length, 2); assert.equal(e[0].text, 'V is 6'); assert.equal(e[0].photo.deleted, true); assert.equal(e[0].n, 3);
 assert.equal(e[1].kept, true); assert.equal(e[1].points, 2);
 const d = correct.draftOf(view, attempt);
 assert.deepEqual(Object.keys(d.marks), [Q(3)], 'only editable essays are in the draft');
 assert.equal(correct.draftComplete(d), false);
 const done = { ...d, marks: { [Q(3)]: { points: 3, feedback: 'Units' } } };
 assert.ok(correct.draftComplete(done)); assert.ok(correct.draftChanged(d, done)); assert.ok(!correct.draftChanged(done, plain(done)));
 assert.deepEqual(plain(correct.totals(view, attempt, done)), { got: 1 + 0 + 3 + 2, max: 1 + 2 + 4 + 3 });
 assert.deepEqual(plain(correct.gradeBody(d, 4, '')), { action: 'grade', revision: 4, feedback: '', reason: '', marks: [] }, 'a blank mark is not sent');
 assert.deepEqual(plain(correct.gradeBody(done, 4, 'x')).marks, [{ questionId: Q(3), points: 3, feedback: 'Units' }]);
 assert.equal(correct.clampPoints(9, 4), 4); assert.equal(correct.clampPoints(-1, 4), 0);
 assert.ok(contract.tryWrite.safeParse(correct.gradeBody(done, 4, '')).success, 'the screen\'s body passes the route contract');
 assert.ok(contract.tryWrite.safeParse(correct.releaseBody(4)).success);
 assert.ok(!correct.reasonOk('no')); assert.ok(correct.reasonOk(' Marked '));
});
test('states, next student and Release N grades', () => {
 assert.equal(correct.tryState({ correction: { status: 'under_correction', score: null, released: false } }), 'waiting');
 assert.equal(correct.tryState({ correction: { status: 'corrected', score: 5, released: false } }), 'corrected');
 assert.equal(correct.tryState({ correction: { status: 'approved', score: 5, released: true } }), 'released');
 const rows = [{ userId: 'a', submissionId: 's1' }, { userId: 'b', submissionId: 's2' }, { userId: 'c' }, { userId: 'd', submissionId: 's3' }];
 assert.equal(correct.nextStudent(rows, 's1').submissionId, 's2'); assert.equal(correct.nextStudent(rows, 's2').submissionId, 's3');
 assert.equal(correct.nextStudent(rows, 's3').submissionId, 's1', 'wraps to the first other one'); assert.equal(correct.nextStudent([{ userId: 'a', submissionId: 's1' }], 's1'), null);
 const body = correct.releaseManyBody({ releasable: [{ submissionId: uuid(1), revision: MAX }, { submissionId: uuid(2), revision: 0 }] });
 assert.deepEqual(plain(body), { items: [{ submissionId: uuid(1), revision: MAX }, { submissionId: uuid(2), revision: 0 }] });
 assert.ok(contract.releaseMany.safeParse(body).success);
});
test('the correcting screen: custom controls, aria-disabled with a reason, the signed-media flow for photos, the teacher routes only', () => {
 const screen = read('frontend/features/teacher-homework/correct-screen.tsx');
 assert.doesNotMatch(screen, /type=["'](checkbox|radio)["']|<select\b/);
 assert.doesNotMatch(screen, /<(button|input|textarea|select)\b[^>]*\sdisabled[\s=>]/);
 assert.match(screen, /aria-describedby=\{canGrade \? undefined : gradeReason\}/); assert.match(screen, /aria-describedby=\{canRelease \? undefined : releaseReason\}/);
 assert.match(screen, /homeworkApi<\{ url: string \}>\(homeworkId, 'media', \{ id \}\)/, 'photos through the existing signed-media route');
 assert.match(screen, /hw\.c\.photo_deleted/); assert.match(screen, /readTry\(a\.id, true\)/, 'Reload after a change elsewhere keeps the typing');
 assert.match(screen, /releaseManyBody\(queue\)/, 'Release N grades sends exactly the queue\'s list');
 const routes = [...new Set([...screen.matchAll(/`(\/api\/[^`$?]*)/g)].map(m => m[1]))];
 for (const r of routes) assert.match(r, /^\/api\/teacher\/homework/, r);
 assert.doesNotMatch(screen, /isTeacher|role ===|viewer\.role|service[_-]?role|userId:/);
 const homeworkPage = read('frontend/features/teacher-homework/homework-page.tsx');
 assert.match(homeworkPage, /href=\{`\/teacher\/homework\/\$\{row\.id\}\/correct`\}/); assert.doesNotMatch(homeworkPage, /correct_later/);
 const page = read('app/(dashboard)/(routes)/teacher/homework/[homeworkId]/correct/page.tsx');
 assert.match(page, /await staffContext\(\)/); assert.match(page, /notFound\(\)/);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Student side
// ---------------------------------------------------------------------------------------------------------------------------------
test('the student lesson page: a draft lesson is unavailable, a lesson with a part opens that part, a lesson without one shows its homework', () => {
 const tree = { modules: [{ id: 'm', title: 'Magnetism' }], lessons: [{ id: 'l1', module_id: 'm', title: 'Review', status: 'published' }, { id: 'l2', module_id: 'm', title: 'Parts', status: 'published' }, { id: 'l3', module_id: 'm', title: 'Draft', status: 'draft' }],
  segments: [{ id: 's1', lesson_id: 'l2', position: 0, status: 'published' }, { id: 's2', lesson_id: 'l2', position: 1, status: 'published' }, { id: 's3', lesson_id: 'l1', position: 0, status: 'draft' }] };
 const progress = [{ offering_id: 'o', segment_id: 's1', status: 'completed' }];
 assert.deepEqual(plain(studentLesson.lessonOverview(tree, progress, 'c', 'l1', 'o')), { kind: 'lesson', title: 'Review', module: 'Magnetism' }, 'a draft part does not count');
 assert.deepEqual(plain(studentLesson.lessonOverview(tree, progress, 'c', 'l2', 'o')), { kind: 'part', href: '/courses/c/chapters/s2?offering=o' }, 'the part Continue Learning would open');
 assert.deepEqual(plain(studentLesson.lessonOverview(tree, progress, 'c', 'l3', 'o')), { kind: 'unavailable' });
 assert.deepEqual(plain(studentLesson.lessonOverview(tree, progress, 'c', 'nope', 'o')), { kind: 'unavailable' });
 assert.equal(studentLesson.lessonHref('c', 'l1', 'o'), '/courses/c/lessons/l1?offering=o');
 const page = read('app/(dashboard)/_components/secure-lesson-overview.tsx');
 assert.ok(page.indexOf('await service.offering(offeringId!)') < page.indexOf('service.tree()'), 'the group and enrollment check first (draft course, inactive group, ended enrollment)');
 assert.match(page, /redirect\('\/sign-in'\)/); assert.match(read('frontend/features/courses/lesson/lesson-overview.tsx'), /segmentId=\{null\}/); assert.match(page, /if \(view\.kind === 'part'\) redirect\(view\.href\)/);
 assert.match(read('shared/v2-learning-model.ts'), /:offeringId\?`\/courses\/\$\{module\.course_id\}\/lessons\/\$\{lesson\.id\}\?offering=\$\{offeringId\}`:null/, 'the Locked card links to it');
 assert.doesNotMatch(read('shared/continue-learning.ts'), /\/lessons\//, 'Continue Learning keeps linking parts');
});
test('student refusals: the database reason becomes a reason the screen says in English and Arabic', () => {
 const cases = [
  [{ code: 'PT409', message: 'Deadline passed', details: '{"reason":"deadline_passed"}' }, 'deadline_passed'],
  [{ code: 'PT409', message: 'No tries left', details: '{"reason":"no_tries_left"}' }, 'no_tries_left'],
  [{ code: 'PT409', message: 'Answers changed; reload' }, 'stale'], [{ code: 'PT409', message: 'Homework changed; reload' }, 'stale'],
  [{ code: 'PT409', message: 'Submitted work is immutable' }, 'submitted'],
  [{ code: '42501', message: 'Active enrollment required' }, 'unavailable'], [{ code: '42501', message: 'Homework unavailable' }, 'unavailable'],
  [{ code: '23514', message: 'Invalid answers' }, null], [{ code: 'PT409', message: 'x', details: '{"reason":"evil<script>"}' }, null], [null, null],
 ];
 for (const [error, reason] of cases) assert.equal(student.studentHomeworkReason(error), reason, JSON.stringify(error));
 assert.equal(student.studentReasonText.deadline_passed, 'The deadline has passed'); assert.equal(student.studentReasonText.no_tries_left, 'No tries left');
 for (const r of student.STUDENT_REASONS) { assert.ok(messages.en[`homework.err.${r}`] && /[؀-ۿ]/.test(messages.ar[`homework.err.${r}`]), r); }
 assert.equal(messages.en['homework.err.deadline_passed'], 'The deadline has passed'); assert.equal(messages.en['homework.err.no_tries_left'], 'No tries left');
 // The server: homeworkChecked keeps the reason on the error, and the work route sends it (never for a 503).
 const failures = load('server/services/homework.ts', { 'server-only': {}, 'node:crypto': require('node:crypto'), '@supabase/supabase-js': {}, '@/server/integrations/supabase': {},
  '@/server/integrations/firebase-admin': {}, '@/server/services/firebase-auth': {}, '@/shared/supabase-config': {}, '@/server/services/homework-file-validation': {},
  '@/server/services/homework-clone-media': {}, '@/shared/student-homework': student }, { process, setTimeout });
 const quiet = console.error; console.error = () => {};
 const caught = async error => { try { await failures.homeworkChecked(Promise.resolve({ data: null, error })); } catch (e) { return e; } };
 return (async () => {
  try {
   const late = await caught({ code: 'PT409', message: 'Deadline passed', details: '{"reason":"deadline_passed"}' });
   assert.equal(late.status, 409); assert.equal(late.reason, 'deadline_passed'); assert.equal(late.message, 'The deadline has passed');
   const none = await caught({ code: 'PT409', message: 'No tries left', details: '{"reason":"no_tries_left"}' }); assert.equal(none.reason, 'no_tries_left'); assert.equal(none.message, 'No tries left');
   const other = await caught({ code: '23514', message: 'x' }); assert.equal(other.reason, undefined); assert.equal(other.message, 'Check the homework structure, files and correction state.');
  } finally { console.error = quiet; }
  const route = read('server/http/homework.ts');
  assert.match(route, /action:z\.enum\(\['start','retry','save','submit','grade','release','annotate'\]\)/, 'retry, with no data (the else branch)');
  assert.match(route, /const reason=status===503\?undefined:\(e as \{reason\?:string\}\)\.reason;/);
  assert.match(read('frontend/lib/homework.ts'), /reason:typeof v\.reason==='string'\?v\.reason:undefined/);
 })();
});
test('the student homework screen: deadline (Cairo), tries left, Missed the deadline, Try again, kept answers locked, the tries-ended line', () => {
 const facts = v => plain(student.studentFacts(v, v.sub ?? null));
 const base = { workflow: 'questions', deadline: '2026-11-11T18:00:00Z', triesLeft: 1, canRetry: true, triesEnded: false };
 assert.deepEqual(facts({ ...base, sub: { status: 'submitted', missedDeadline: true } }), { deadline: base.deadline, triesLeft: 1, missed: true, canRetry: true, triesEnded: false });
 assert.equal(facts({ ...base, sub: { status: 'draft' } }).canRetry, false, 'Try again only after a hand-in');
 assert.deepEqual(facts({ workflow: 'legacy', deadline: null, triesLeft: null }), { deadline: null, triesLeft: null, missed: false, canRetry: false, triesEnded: false }, 'an older homework shows none of it');
 assert.equal(facts({ ...base, triesEnded: true }).triesEnded, true);
 assert.ok(student.answerKept({ kept: true })); assert.ok(!student.answerKept(undefined));
 const screen = read('frontend/features/courses/lesson/homework-student.tsx');
 assert.doesNotMatch(screen, /setError\(\(e as Error\)\.message\)/, 'every refusal goes through errorText');
 assert.match(screen, /await work\('retry'\);await refresh\(\)/); assert.match(screen, /data-try-again/); assert.match(screen, /data-missed-deadline/);
 assert.match(screen, /answerKept\(answers\.find\(a=>a\.questionId===q\.id\)\)/, 'a kept answer is locked');
 assert.match(screen, /cairoDay\(facts\.deadline,lang\)/, 'Cairo time');
 assert.equal(messages.en['homework.tries_ended'], 'Your tries ended when the deadline changed');
 assert.equal(messages.en['homework.try_again'], 'Try again'); assert.equal(messages.en['homework.missed'], 'Missed the deadline');
});

test('locales: every new text in both languages, same holes, Arabic, plural forms, none of the ruled-out words', () => {
 const keys = Object.keys(messages.en).filter(k => /^(hw\.c\.|th\.homework\.|homework\.(err\.|deadline|tries_|missed|try_again|retry_started|kept)|lesson_page\.)/.test(k));
 assert.ok(keys.length >= 90, String(keys.length));
 const holes = s => (s.match(/\{\w+\}/g) ?? []).sort().join();
 for (const k of keys) {
  assert.ok(messages.ar[k]?.trim(), k); assert.equal(holes(messages.en[k]), holes(messages.ar[k]), k);
  if (/[a-z]/i.test(messages.en[k].replace(/\{\w+\}/g, ''))) assert.match(messages.ar[k], /[؀-ۿ]/, k);
  assert.doesNotMatch(messages.en[k] + ' ' + messages.ar[k], /\bblocks?\b|\bmodules?\b|\bofferings?\b|\bsegments?\b|organi[sz]ation|منظمة|مؤسسة|وحدة/i, k);
 }
 for (const stem of ['hw.c.ready', 'hw.c.release_many', 'hw.c.live.released_many']) for (const form of ['one', 'two', 'few', 'many']) assert.ok(messages.en[`${stem}.${form}`] && messages.ar[`${stem}.${form}`], stem + form);
 assert.equal(messages.en['hw.c.photo_deleted'], 'Image deleted to free space'); assert.equal(messages.en['hw.c.missed'], 'Missed the deadline');
 assert.equal(messages.en['hw.c.next'], 'Save and next student'); assert.equal(messages.en['th.homework.title'], 'Homework to correct'); assert.equal(messages.en['th.homework.all'], 'All homework');
 assert.ok(!('hw.correct_later' in messages.en) && !('hw.correct_later' in messages.ar));
});
