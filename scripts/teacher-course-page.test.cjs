// Teacher course page (Settings > Courses > one course): the pure helpers, the loader, the route, the links and the wording (static checks; behaviour is in teacher-course-page-browser.cjs).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
function load(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { module: m, exports: m.exports, URL, require: n => n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const read = f => fs.readFileSync(f, 'utf8');
const page = load('shared/teacher-course-page.ts');
const localization = require('./localization-test-loader.cjs');
const { messages } = localization.load('frontend/locales/messages.ts');
const id = '1234abcd-0000-4000-8000-00000000000f';

test('helpers: Publish and Unpublish are the only moves; an archived course is not changed here', () => {
 assert.equal(page.nextStatus('draft'), 'published'); assert.equal(page.nextStatus('published'), 'draft'); assert.equal(page.nextStatus('archived'), null);
});
test('helpers: every failure is told apart; a missing reply is an unknown outcome, never a plain failure', () => {
 assert.deepEqual([null, 401, 403, 404, 409, 400, 413, 415, 500, 503].map(page.courseFailure), ['unknown', 'signin', 'denied', 'denied', 'changed', 'invalid', 'invalid', 'invalid', 'failed', 'failed']);
});
test('helpers: the course page path is exact and only a UUID matches', () => {
 assert.equal(page.coursePagePath(id), '/teacher/settings/courses/' + id);
 assert.ok(page.coursePagePattern.test(page.coursePagePath(id)));
 for (const bad of ['/teacher/settings/courses', '/teacher/settings/courses/', '/teacher/settings/courses/x', page.coursePagePath(id) + '/', page.coursePagePath(id) + '/lessons', '/teacher/settings/courses/' + id.slice(1)]) assert.ok(!page.coursePagePattern.test(bad), bad);
});
test('loader: reads one course as the signed-in teacher, decides canEdit with the same rule as the PATCH route, names the space only when there are several', () => {
 const src = read('server/services/teacher-course-page.ts');
 assert.match(src, /from\('courses'\)\.select\('id,organization_id,title,description,status,updated_at'\)\.eq\('id', courseId\)\.maybeSingle\(\)/);
 assert.match(src, /canEditTeacherCourse\(membership, staff\)/); assert.match(src, /\.length > 1/); assert.doesNotMatch(src, /service[_-]?role|supabaseAdmin/i);
 assert.match(src, /state: 'missing'/); assert.match(src, /state: 'error'/);
});
test('page: staff only, the id comes from the route, nothing is decided on the client', () => {
 const p = read('app/teacher/settings/courses/[courseId]/page.tsx');
 assert.match(p, /await staffContext\(\)/); assert.match(p, /loadCoursePage\(context, courseId\)/);
 assert.match(read('app/teacher/settings/courses/[courseId]/loading.tsx'), /RouteLoadingSignal/);
});
test('view: publishing uses the existing PATCH with the version it read; it asks first; it calls no other write endpoint', () => {
 const v = read('frontend/features/teacher-course/course-view.tsx');
 assert.match(v, /fetch\(`\/api\/teacher\/courses\/\$\{course\.id\}`, \{ method: 'PATCH'/); assert.match(v, /JSON\.stringify\(\{ updated_at: course\.updatedAt, status: target \}\)/);
 assert.match(v, /setAsking\(true\)/); assert.match(v, /sent\.current/); assert.match(v, /key=\{load\.course\.updatedAt\}/);
 assert.deepEqual([...new Set([...v.matchAll(/['"`](\/api\/[^'"`?$]*)/g)].map(m => m[1]))].sort(), ['/api/teacher/academics', '/api/teacher/courses/']);
 assert.match(v, /usePageLoadingSignal\(grades\.state === 'loading'\)/); assert.doesNotMatch(v.replace(/organizationId/g, ''), /organization/i);
});
test('links: course rows, the Invite panel and the Settings shell all lead to the course page', () => {
 assert.equal((read('frontend/features/teacher-home/parts.tsx').match(/coursePagePath\(c\.id\)/g) ?? []).length, 2);
 assert.match(read('frontend/features/teacher-students/invite.tsx'), /<Link href=\{coursePagePath\(c\.courseId\)\} data-draft-link/);
 const shell = read('frontend/features/teacher-settings/shell.tsx'); assert.match(shell, /coursePagePattern\.test\(pathname\)/); assert.match(shell, /onCourse && s\.key === 'courses'/);
 assert.match(read('middleware.ts'), /teacher\\\/settings\\\/courses\\\/\[0-9a-f\]\{8\}/);
});
test('locales: every tc.* text exists in English and Arabic with the same placeholders; the course page names no tenant vocabulary', () => {
 const keys = Object.keys(messages.en).filter(k => k.startsWith('tc.')); assert.ok(keys.length >= 25);
 for (const k of keys) {
  assert.ok(messages.en[k].trim() && messages.ar[k]?.trim(), k);
  const holes = s => (s.match(/\{\w+\}/g) ?? []).sort().join(); assert.equal(holes(messages.en[k]), holes(messages.ar[k]), k);
  assert.match(messages.ar[k], /[؀-ۿ]/, k); assert.doesNotMatch(messages.en[k] + messages.ar[k], /organi[sz]ation|tenant|\bslug\b|منظمة|مؤسسة/i, k);
 }
 assert.match(messages.en['tc.lessons_soon'], /lesson editor is coming/);
});
