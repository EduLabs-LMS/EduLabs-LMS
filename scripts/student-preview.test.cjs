const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const preview = require('../shared/student-preview.ts');
const model = require('../shared/v2-learning-model.ts');
const routes = require('../shared/website-routes.ts');
const U = '11111111-1111-4111-8111-111111111111';
const P = '/preview';

// ---- 1. Nothing that records student data can leave the browser in preview ----
test('state-changing requests that would record student data are refused', () => {
  const writes = [
    ['POST', `/api/learning/${U}/progress`], ['POST', `/api/homework/${U}/work`], ['POST', `/api/homework/new/list`],
    ['POST', `/api/secure-exams/${U}/answers`], ['POST', `/api/secure-exams/${U}/start`], ['POST', `/api/secure-exams/${U}/submit`],
    ['POST', '/api/study-groups'], ['POST', '/api/student-academics'], ['POST', '/api/progress'], ['PUT', `/api/learning/${U}/progress`],
    ['PATCH', `/api/learning/${U}/progress`], ['DELETE', `/api/homework/${U}/work`], ['POST', `/api/learning/${U}/upload`],
    ['POST', 'https://evil.example/api/learning/x/progress'], ['POST', 'https://project.supabase.co/storage/v1/object/lms-homework/a'],
    ['POST', `/api/learning/${U}/media/../progress`], ['POST', `/api/learning/${U}/media?x=1/../../progress`.replace('?x=1/../../progress', '/x')],
  ];
  for (const [m, u] of writes) assert.equal(preview.previewAllowsRequest(m, u), false, m + ' ' + u);
});
test('only read-style requests are allowed in preview', () => {
  assert.equal(preview.previewAllowsRequest('GET', '/preview'), true);
  assert.equal(preview.previewAllowsRequest(undefined, '/anything'), true);
  assert.equal(preview.previewAllowsRequest('HEAD', '/x'), true);
  assert.equal(preview.previewAllowsRequest('POST', `/api/learning/${U}/media`), true); // signs a view URL, records nothing
  assert.equal(preview.previewAllowsRequest('post', `/api/learning/${U}/media`), true);
  assert.equal(preview.previewAllowsRequest('PUT', `/api/learning/${U}/media`), false);
});
test('guardFetch never calls the network for a blocked write and does not fake success', async () => {
  const calls = [];
  const guarded = preview.guardFetch(async (input, init) => { calls.push([String(input), init?.method ?? 'GET']); return new Response('{}'); });
  for (const [m, u] of [['POST', `/api/learning/${U}/progress`], ['POST', `/api/homework/${U}/upload-intent`], ['POST', `/api/secure-exams/${U}/submit`], ['DELETE', '/api/x']]) {
    const r = await guarded(u, { method: m, body: '{}' });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /look-only/);
  }
  await guarded(`/api/learning/${U}/media`, { method: 'POST', body: '{}' });
  await guarded('/preview');
  assert.deepEqual(calls, [[`/api/learning/${U}/media`, 'POST'], ['/preview', 'GET']]);
  const req = await guarded(new Request('https://preview.invalid/api/learning/' + U + '/progress', { method: 'POST' }));
  assert.equal(req.status, 403);
});

// ---- 2. Preview data shape: published only, no student progress, links stay in preview ----
const scope = {
  courses: [{ id: 'c', title: 'Physics' }],
  modules: [{ id: 'm', course_id: 'c', title: 'Mod', position: 1 }],
  lessons: [{ id: 'l1', module_id: 'm', title: 'Live', status: 'published' }, { id: 'l2', module_id: 'm', title: 'Draft lesson', status: 'draft' }],
  offerings: [{ id: 'o', course_id: 'c', name: 'G' }], progress: [],
  segments: [{ id: 's1', lesson_id: 'l1', title: 'A', position: 1, status: 'published' }, { id: 's2', lesson_id: 'l1', title: 'Draft part', position: 2, status: 'draft' }, { id: 's3', lesson_id: 'l2', title: 'In draft lesson', position: 1, status: 'published' }],
  segmentProgress: [{ offering_id: 'o', segment_id: 's1', status: 'completed' }],
};
test('preview chapters drop drafts, ignore any progress and link only into /preview', () => {
  const chapters = model.v2Chapters(scope, undefined, P);
  const lessons = chapters.flatMap(c => c.lessons);
  assert.deepEqual(lessons.map(l => l.title), ['Live']);
  assert.deepEqual(lessons[0].chapters.map(c => c.title), ['A']);
  assert.equal(lessons[0].href, '/preview/c/chapters/s1');
  assert.equal(lessons[0].status, 'Not Started');
  assert.equal(lessons[0].chapters[0].isCompleted, false);
  assert.equal(chapters[0].progressAvailable, false);
  // even if a progress row somehow reaches the preview, it is not shown
  assert.equal(model.v2Chapters(scope, 'o', P)[0].lessons[0].status, 'Not Started');
  // student rendering is unchanged
  const student = model.v2Chapters(scope, 'o')[0].lessons[0];
  assert.equal(student.href, '/courses/c/chapters/s1?offering=o');
  assert.equal(student.status, 'Completed');
});

// ---- 3. Access: teacher-side only, role and tenant untouched ----
test('preview is gated on the server to teacher-side roles and never changes identity', () => {
  const s = read('server/services/student-preview.ts');
  assert.match(s, /if \(!isFirebaseStaging\(\)\) notFound\(\)/);
  assert.match(s, /if \(!isTeacherSideContext\(context\)\) notFound\(\)/);
  assert.match(s, /courseCapability\(context, course\)/);
  assert.match(read('app/(dashboard)/(routes)/preview/layout.tsx'), /await requireStudentPreview\(\)/);
  for (const f of walk('app/(dashboard)/(routes)/preview').filter(f => /page\.tsx$/.test(f))) assert.match(read(f.split(path.sep).join('/')), /loadPreviewCourses?\(/, f);
  // no role/tenant switching, cookies, impersonation or privileged clients
  const touched = ['server/services/student-preview.ts', ...walk('app/(dashboard)/(routes)/preview'), ...walk('frontend/features/preview'), 'shared/student-preview.ts'].map(f => read(f.split(path.sep).join('/'))).join('\n');
  assert.doesNotMatch(touched, /cookies\(|setCookie|document\.cookie|localStorage|sessionStorage|impersonat|service_role|getSupabaseAdmin|serviceRole|organization_id\s*[:=]/i);
});
test('preview never touches a student write path', () => {
  const files = ['server/services/student-preview.ts', ...walk('app/(dashboard)/(routes)/preview'), ...walk('frontend/features/preview')].map(f => f.split(path.sep).join('/'));
  for (const f of files) assert.doesNotMatch(read(f), /recordCourseView|course-statistics|homeworkApi|\.progress\(|\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|attendance|enroll(?!ment)/i, f);
  const lesson = read('app/(dashboard)/_components/secure-lesson-page.tsx');
  assert.match(lesson, /if\(!preview\)await service\.offering/);
  assert.match(lesson, /preview\?Promise\.resolve\(\[\][^)]*\):service\.progress/);
  assert.match(lesson, /status:preview\?'preview'[^}]*,preview\}/);
  assert.match(lesson, /\{preview\?<section[^]*?preview\.homework_note[^]*?:<HomeworkAssignments/);
  const player = read('frontend/features/courses/lesson/secure-player.tsx');
  assert.match(player, /if\(data\.preview\)return;/);
  assert.match(player, /\{!data\.preview&&<div className="flex flex-wrap gap-3 items-center"><Button/);
  const guard = read('frontend/features/preview/preview-guard.tsx');
  assert.match(guard, /window\.fetch = guardFetch/);
  assert.match(guard, /navigator\.sendBeacon = \(\) => false/);
  assert.match(guard, /window\.fetch = realFetch/);
  assert.match(read('app/(dashboard)/(routes)/preview/layout.tsx'), /<PreviewGuard \/>/);
});
test('the student rendering path used by real students is unchanged', () => {
  const lesson = read('app/(dashboard)/_components/secure-lesson-page.tsx');
  assert.match(lesson, /lessonPartHref\(courseId,part\.id,offeringId\)/);
  assert.match(lesson, /<HomeworkAssignments key=\{`hw:\$\{segment\.id\}`\}/);
  assert.match(read('app/(dashboard)/(routes)/courses/[courseId]/chapters/[chapterId]/page.tsx'), /<SecureLessonPage courseId=\{params\.courseId\} segmentId=\{params\.chapterId\} offeringId=/);
  assert.doesNotMatch(read('app/(dashboard)/(routes)/courses/[courseId]/chapters/[chapterId]/page.tsx'), /preview/);
});

// ---- 4. Toggle visibility and routing ----
test('toggle is shown only to teacher-side roles', () => {
  const sidebar = read('frontend/components/sidebar.tsx');
  assert.match(sidebar, /\{teacherSide && \(\s*<Link\s+href=\{inPreview \? COURSE_MANAGEMENT_PATH : PREVIEW_PATH\}/);
  assert.match(sidebar, /navigation\.back_to_teacher_view/);
  assert.match(sidebar, /navigation\.view_as_student/);
  // course list is only rendered for teacher-side and platform staff; the link target 404s for platform roles
  assert.match(read('frontend/features/teacher/courses/course-list.tsx'), /href=\{PREVIEW_PATH\}/);
  assert.match(read('frontend/components/providers/course-management-path.tsx'), /useIsTeacherSide/);
});
test('middleware allowlist admits only the three preview page shapes', () => {
  for (const ok of ['/preview', `/preview/${U}`, `/preview/${U}/chapters/${U}`]) assert.equal(routes.isPhaseOneRoute(ok), true, ok);
  for (const bad of ['/preview/', '/preview/abc', `/preview/${U}/chapters`, `/preview/${U}/x`, `/preview/${U}/chapters/abc`, '/previews', '/api/preview', `/preview/${U}/chapters/${U}/extra`]) assert.equal(routes.isPhaseOneRoute(bad), false, bad);
  assert.equal(routes.isPhaseOneRoute('/exams'), true); // pre-existing behaviour unchanged
});
test('preview is look-only: no exam routes are linked and no new API route exists', () => {
  assert.equal(fs.existsSync('app/api/preview'), false);
  assert.doesNotMatch(read('middleware.ts'), /preview/);
  for (const f of [...walk('app/(dashboard)/(routes)/preview'), ...walk('frontend/features/preview')]) assert.doesNotMatch(read(f.split(path.sep).join('/')), /\/exams|\/api\//, f);
});

// ---- 5. Language, RTL and visual identity ----
test('preview strings exist in English and Arabic with matching placeholders', () => {
  const keys = ['navigation.view_as_student', 'navigation.back_to_teacher_view', 'preview.title', 'preview.banner_title', 'preview.banner_text', 'preview.pick_course', 'preview.no_courses', 'preview.course_unpublished', 'preview.drafts_hidden', 'preview.homework_note', 'preview.back_to_courses'];
  const en = read('frontend/locales/en.ts'), ar = read('frontend/locales/ar.ts');
  for (const k of keys) { const re = new RegExp(`"${k.replace('.', '\\.')}": "([^"]+)"`); const a = en.match(re), b = ar.match(re); assert.ok(a && b, k); assert.deepEqual([...a[1].matchAll(/\{(\w+)\}/g)].map(x => x[1]), [...b[1].matchAll(/\{(\w+)\}/g)].map(x => x[1]), k); }
  assert.match(ar, /"navigation\.view_as_student": "عرض كطالب"/);
});
test('preview bar is persistent, announced, touch-sized and RTL/theme safe', () => {
  const bar = read('frontend/features/preview/preview-bar.tsx');
  assert.match(bar, /role="status"/); assert.match(bar, /sticky top-2/); assert.match(bar, /min-h-\[44px\]/);
  assert.match(bar, /rtl:rotate-180/); assert.match(bar, /bg-primary/); assert.match(bar, /border-black/);
  assert.doesNotMatch(bar, /\b(?:ml|mr|pl|pr|left|right)-\d|text-(?:left|right)\b/);
});
