// Reports, spread into existing pages: the contract, the Cairo month choices, the reason words, the failure mapping, the menu, the routes, the middleware and the texts.
// The numbers themselves are checked against PostgreSQL in supabase/tests/reports*.sql.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
function load(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { module: m, exports: m.exports, URL, Array, Map, Set, JSON, Number, Date, Intl, Math, Object, String, console,
   require: n => n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const read = f => fs.readFileSync(f, 'utf8');
const contract = load('shared/contracts/teacher-reports.ts', { zod: require('zod') });
const rules = load('shared/teacher-reports.ts');
const { messages } = require('./localization-test-loader.cjs').load('frontend/locales/messages.ts');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

test('month choices: this month first, earlier months newest first back to the first one, the whole course last', () => {
 const now = Date.parse('2026-11-14T10:00:00Z');
 assert.deepEqual(Array.from(rules.monthChoices('2026-09', now)), ['2026-11', '2026-10', '2026-09', 'all']);
 assert.deepEqual(Array.from(rules.monthChoices(null, now)), ['2026-11', 'all']);
 assert.deepEqual(Array.from(rules.monthChoices('2025-12', now)).slice(0, 3), ['2026-11', '2026-10', '2026-09']);
 assert.equal(rules.monthChoices('2020-01', now).length, rules.MAX_MONTHS + 1);
});
test('the month is the Cairo month: the last evening in UTC is already next month in Cairo', () => {
 assert.equal(rules.cairoMonth(Date.parse('2026-10-31T22:30:00Z')), '2026-11');
 assert.equal(rules.cairoMonth(Date.parse('2026-10-31T10:00:00Z')), '2026-10');
 assert.equal(rules.REPORT_TIME_ZONE, 'Africa/Cairo');
});
test('queries are strict: unknown parameters, bad months and duplicate or malformed Group ids are refused', () => {
 assert.equal(contract.groupReportQuery.safeParse({ month: '2026-11' }).success, true);
 assert.equal(contract.groupReportQuery.safeParse({ month: 'all' }).success, true);
 assert.equal(contract.groupReportQuery.safeParse({ month: '2026-13' }).success, false);
 assert.equal(contract.groupReportQuery.safeParse({ user: uuid(1) }).success, false);
 assert.equal(contract.groupsQuery.safeParse({ groups: `${uuid(1)},${uuid(2)}` }).success, true);
 assert.equal(contract.groupsQuery.safeParse({ groups: `${uuid(1)},${uuid(1)}` }).success, false);
 assert.equal(contract.groupsQuery.safeParse({ groups: 'x' }).success, false);
 assert.equal(contract.studentReportQuery.safeParse({ month: '2026-11' }).success, false, 'the course is required');
 assert.equal(contract.attentionQuery.parse({}).page, 0);
});
test('reasons become plain words, singular and plural, in both languages', () => {
 const keys = [rules.reasonWords({ code: 'missed_sessions', n: 1 }), rules.reasonWords({ code: 'missed_sessions', n: 3 }), rules.reasonWords({ code: 'homework_missing', n: 1 }),
  rules.reasonWords({ code: 'homework_missing', n: 4 }), rules.reasonWords({ code: 'exams_low', pct: 40 }), rules.reasonWords({ code: 'exam_absent', title: 'Quiz' })];
 assert.deepEqual(keys.map(k => k.id), ['rp.reason.missed_one', 'rp.reason.missed', 'rp.reason.homework_one', 'rp.reason.homework', 'rp.reason.exams', 'rp.reason.absent']);
 for (const k of keys) for (const lang of ['en', 'ar']) assert.ok(messages[lang][k.id], `${lang} ${k.id}`);
});
test('failures: the database error is never shown, only its kind', () => {
 assert.deepEqual(JSON.parse(JSON.stringify(rules.reportReply({ code: '42501' }))), { status: 403, body: { kind: 'denied' } });
 assert.equal(rules.reportReply({ code: '23514' }).status, 400);
 assert.equal(rules.reportReply({ code: 'XX000' }).status, 503);
 assert.equal(rules.reportFailure(401), 'signin');
 assert.equal(rules.reportFailure(null), 'unavailable');
 assert.equal(rules.barWidth(130), 100); assert.equal(rules.barWidth(null), 0);
});
test('the menu has no Reports and no Soon item', () => {
 const nav = load('shared/teacher-home.ts', { '@/shared/teacher-groups': {}, '@/shared/teacher-attendance': {} });
 assert.equal(nav.teacherNavSoon.length, 0);
 assert.equal(messages.en['th.nav.reports'], undefined);
});
test('English and Arabic have every report text, and no internal word reaches the screen', () => {
 const keys = Object.keys(messages.en).filter(k => k.startsWith('rp.') || k === 'tg.tab.report');
 assert.ok(keys.length >= 70);
 for (const k of keys) {
  assert.ok(messages.ar[k], `ar ${k}`);
  assert.deepEqual((messages.en[k].match(/\{\w+\}/g) || []).sort(), (messages.ar[k].match(/\{\w+\}/g) || []).sort(), `placeholders ${k}`);
  assert.ok(!/offering|organization|\brun\b|\bspace\b/i.test(messages.en[k]), `internal word in ${k}`);
 }
});
test('the five routes exist, are one-line re-exports, and are in the middleware allow-list', () => {
 for (const p of ['groups', 'groups/[groupId]', 'attention', 'students/[studentId]', 'courses/[courseId]']) {
  const route = read(`app/api/teacher/reports/${p}/route.ts`);
  assert.match(route, /export const GET\b|export \{ ?timed\w+ as GET/, p);
  assert.ok(route.split('\n').filter(Boolean).length <= 3, p);
 }
 assert.match(read('middleware.ts'), /teacher\/reports/);
});
test('the screens carry their tour targets and no screen reads with a service key', () => {
 assert.match(read('frontend/features/teacher-groups/group-view.tsx'), /group-report-tab/);
 assert.match(read('frontend/features/teacher-students/students-view.tsx'), /needs-attention-filter/);
 assert.match(read('frontend/features/teacher-course/course-view.tsx'), /course-results-switch/);
 assert.match(read('frontend/features/teacher-reports/student-marks.tsx'), /student-marks/);
 for (const f of fs.readdirSync('frontend/features/teacher-reports')) assert.doesNotMatch(read('frontend/features/teacher-reports/' + f), /service_role|SERVICE_ROLE/);
});
