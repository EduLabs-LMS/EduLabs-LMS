// Student preview is display-only. These tests cover who can see the toggle, that the cookie is ignored for
// everyone who is not teacher-side, and that preview mode never lets a student-data write leave the browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, dependencies = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, React, Date, Set, Array, Promise, Error, URL, RegExp, document: dependencies.__document,
    require: name => { assert.ok(name in dependencies, 'unexpected import ' + name); return dependencies[name]; } });
  return module.exports;
}
const preview = load('shared/student-preview.ts');

test('only teacher-side memberships count: same condition as the teacher route guard', () => {
  const m = (role, status = 'active') => [{ role, status }];
  for (const role of ['owner', 'admin', 'teacher', 'assistant']) assert.equal(preview.isTeacherSide(m(role), [], []), true, role);
  assert.equal(preview.isTeacherSide(m('student'), [], []), false);
  assert.equal(preview.isTeacherSide([], [], []), false);
  assert.equal(preview.isTeacherSide(m('owner', 'suspended'), [], []), false);
  assert.equal(preview.isTeacherSide(m('owner', 'invited'), [{}], []), false);
  assert.equal(preview.isTeacherSide(m('student'), [{ role: 'instructor' }], []), true);
  assert.equal(preview.isTeacherSide(m('student'), [], [{ role: 'instructor' }]), true);
});

test('the preview cookie is ignored unless the user is teacher-side', () => {
  assert.equal(preview.studentPreviewActive(true, '1'), true);
  assert.equal(preview.studentPreviewActive(true, ''), false);
  assert.equal(preview.studentPreviewActive(true, undefined), false);
  assert.equal(preview.studentPreviewActive(false, '1'), false);
});

test('teacher tools and flows that record student data are hidden while previewing', () => {
  for (const path of ['/teacher/create', '/admin/users', '/exams', '/exams/1', '/group', '/groups', '/sessions-groups']) assert.equal(preview.previewHiddenRoute(path), true, path);
  for (const path of ['/home', '/self-learning', '/courses/c', '/courses/c/chapters/s', '/settings', '/support', '/teacherish']) assert.equal(preview.previewHiddenRoute(path), false, path);
});

test('student-data writes are blocked in preview; reads and media refresh are not', () => {
  const blocked = [
    ['POST', '/api/learning/20000000-0000-4000-8000-000000000001/progress'],
    ['post', '/api/progress/complete'],
    ['POST', '/api/homework/20000000-0000-4000-8000-000000000001/work'],
    ['POST', '/api/homework/20000000-0000-4000-8000-000000000001/upload-intent'],
    ['POST', '/api/homework/20000000-0000-4000-8000-000000000001/finish-upload'],
    ['POST', '/api/secure-exams/20000000-0000-4000-8000-000000000001/start'],
    ['POST', '/api/secure-exams/20000000-0000-4000-8000-000000000001/answers'],
    ['POST', '/api/secure-exams/20000000-0000-4000-8000-000000000001/submit'],
    ['PUT', '/api/exams/abc/answers'],
    ['POST', '/api/exams/abc/submit'],
    ['POST', 'https://portal.example/api/learning/20000000-0000-4000-8000-000000000001/progress?x=1'],
    ['POST', '/api/student-academics'],
    ['POST', '/api/courses/c/chapters/x/feedback'],
  ];
  for (const [method, url] of blocked) assert.equal(preview.isBlockedPreviewWrite(method, url), true, method + ' ' + url);
  const allowed = [
    ['GET', '/api/learning/20000000-0000-4000-8000-000000000001/progress'],
    ['GET', '/api/exams/abc'],
    ['POST', '/api/learning/20000000-0000-4000-8000-000000000001/media'],
    ['POST', '/api/auth/firebase/session'],
    ['POST', '/api/communications'],
  ];
  for (const [method, url] of allowed) assert.equal(preview.isBlockedPreviewWrite(method, url), false, method + ' ' + url);
});

test('the installed guard stops fetch and XMLHttpRequest writes before they reach the network, and uninstalls cleanly', async () => {
  const sent = [];
  const win = {
    fetch: async (input, init) => { sent.push(['fetch', String(typeof input === 'string' ? input : input.url), init?.method ?? 'GET']); return { ok: true }; },
    XMLHttpRequest: { prototype: { open(method, url) { this.method = method; this.url = url; }, send() { sent.push(['xhr', this.url, this.method]); }, abort() {} } },
  };
  const originalFetch = win.fetch, originalSend = win.XMLHttpRequest.prototype.send;
  let notices = 0;
  const uninstall = preview.installPreviewWriteGuard(win, () => notices++);
  await assert.rejects(win.fetch('/api/learning/20000000-0000-4000-8000-000000000001/progress', { method: 'POST' }), /Not saved in preview/);
  await assert.rejects(win.fetch('/api/secure-exams/20000000-0000-4000-8000-000000000001/submit', { method: 'POST' }));
  const blockedXhr = Object.create(win.XMLHttpRequest.prototype); blockedXhr.open('POST', '/api/progress/complete'); blockedXhr.send();
  const okXhr = Object.create(win.XMLHttpRequest.prototype); okXhr.open('GET', '/api/exams/abc'); okXhr.send();
  await win.fetch('/api/learning/20000000-0000-4000-8000-000000000001/media', { method: 'POST' });
  assert.deepEqual(sent.map(x => x[0] + ' ' + x[2] + ' ' + x[1]), ['xhr GET /api/exams/abc', 'fetch POST /api/learning/20000000-0000-4000-8000-000000000001/media']);
  assert.equal(notices, 3);
  uninstall();
  assert.equal(win.fetch, originalFetch);
  assert.equal(win.XMLHttpRequest.prototype.send, originalSend);
});

function components(navigation, calls = { pathname: '/home' }) {
  const stubs = {
    react: React,
    'next/navigation': { usePathname: () => calls.pathname, useRouter: () => ({ push() {}, replace() {}, refresh() {} }) },
    'react-hot-toast': { default: () => {} },
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '@/frontend/components/language-provider': { L: ({ id }) => React.createElement('span', null, id), useLanguage: () => ({ t: key => key }) },
    '@/frontend/components/providers/application-auth-provider': { useWebsiteNavigation: () => navigation },
    '@/shared/student-preview': preview,
    '@/shared/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  };
  return load('frontend/features/dashboard/student-preview.tsx', stubs);
}
const html = (element) => renderToStaticMarkup(element);
const viewer = { id: 'v', displayName: 'T', email: 't@example.com', backend: 'firebase' };

test('the toggle and preview bar are absent for students and other roles, even if the preview flag is forced on', () => {
  for (const navigation of [null, undefined, { viewer, organizations: [], staffOrganizationIds: [] }, { viewer, organizations: [], staffOrganizationIds: [], teacherSide: false, studentPreview: false }, { viewer, organizations: [], staffOrganizationIds: [], teacherSide: false, studentPreview: true }]) {
    const { StudentPreviewToggle, StudentPreviewBar } = components(navigation);
    assert.equal(html(React.createElement(StudentPreviewToggle)), '');
    assert.equal(html(React.createElement(StudentPreviewBar)), '');
  }
});

test('teacher-side users get the toggle, and a clear indicator with an exit while previewing', () => {
  const base = { viewer, organizations: [], staffOrganizationIds: [], teacherSide: true };
  let c = components({ ...base, studentPreview: false });
  assert.match(html(React.createElement(c.StudentPreviewToggle)), /preview\.view_as_student/);
  assert.equal(html(React.createElement(c.StudentPreviewBar)), '');
  c = components({ ...base, studentPreview: true });
  assert.match(html(React.createElement(c.StudentPreviewToggle)), /preview\.back_to_teacher/);
  const bar = html(React.createElement(c.StudentPreviewBar));
  assert.match(bar, /preview\.banner/);
  assert.match(bar, /preview\.exit/);
  assert.match(bar, /role="status"/);
});

test('preview pages and the player never record student data', () => {
  const lesson = fs.readFileSync('app/(dashboard)/_components/student-preview-lesson.tsx', 'utf8');
  assert.doesNotMatch(lesson, /\.progress\(|saveProgress|\.offering\(|HomeworkAssignments/);
  assert.match(lesson, /preview:true/);
  assert.match(lesson, /course\.status!=='published'/);
  const player = fs.readFileSync('frontend/features/courses/lesson/secure-player.tsx', 'utf8');
  assert.match(player, /if\(data\.preview\)return;/);
  const pages = fs.readFileSync('app/(dashboard)/_components/website-pages.tsx', 'utf8');
  assert.match(pages, /o\.status === 'active' && scope\.courses\.some\(c => c\.id === o\.course_id && c\.status === 'published'\)/);
  const route = fs.readFileSync('app/(dashboard)/(routes)/courses/[courseId]/chapters/[chapterId]/page.tsx', 'utf8');
  assert.match(route, /previewFor\(context\)\) return <StudentPreviewLessonPage/);
});
