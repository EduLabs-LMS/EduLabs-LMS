// claude/ui-quick-fixes: the five owner items, at unit level. The browser harness (scripts/ui-quick-fixes-browser.cjs) shows them on screen.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const { load } = require('./localization-test-loader.cjs');
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
function loadWith(file, deps) {
  const m = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { module: m, exports: m.exports, Buffer, URL, require: n => n in deps ? deps[n] : n === 'zod' ? require('zod') : (() => { throw Error('Unexpected import ' + n); })() });
  return m.exports;
}
const plain = v => JSON.parse(JSON.stringify(v));
const en = load('frontend/locales/en.ts').en, ar = load('frontend/locales/ar.ts').ar;

test('item 1: the lesson card says Locked only when it has no link, and every status is translated', () => {
  const { getLessonCardStatus } = load('frontend/features/courses/lesson-card.tsx');
  assert.equal(getLessonCardStatus([], '/courses/c/lessons/l?offering=o', 'Locked'), 'Open Lesson');
  assert.equal(getLessonCardStatus([], undefined), 'Locked');
  assert.equal(getLessonCardStatus([{ isCompleted: true }], '/p', 'In Progress'), 'In Progress', 'a status the model gives is kept when there is a link');
  assert.equal(en['common.openLesson'], 'Open lesson');
  for (const k of ['common.completed', 'common.inProgressTitle', 'common.openLesson', 'common.notStartedTitle', 'common.locked']) assert.ok(ar[k] && ar[k] !== en[k], k);
});

test('item 2: the course page has no fake rating, no placeholder line and no empty Feedbacks in Firebase staging; Continue goes somewhere', () => {
  const detail = read('frontend/features/courses/course-detail.tsx');
  assert.doesNotMatch(detail, /đánh giá|4\/5|feedback_is_awaiting_integration|<Star\b/, 'no fake rating, no Vietnamese, no placeholder line');
  assert.match(detail, /\{!staging && \(\s*<div className="mt-12">/, 'the feedback list and form only in the older Clerk build');
  assert.match(detail, /continueHref && \(/, 'Continue is a link to a real part, or not shown');
  assert.doesNotMatch(detail, /'No description'/, 'no English-only text');
  const pages = read('app/(dashboard)/_components/website-pages.tsx');
  assert.doesNotMatch(pages, /Your enrollment:|delivery_mode\.replace|Offering data is incomplete|No accessible offerings yet/, 'the developer text is gone');
  assert.match(pages, /<Suspense fallback=\{null\}><StudentGroups /, 'the Groups box streams in and never holds the page');
  assert.match(pages, /\.slice\(0, 3\)/, 'at most three Groups read their sessions');
  assert.match(pages, /!courseCapability\(context, course\) && <Offerings/, 'staff do not get a student Groups box on a course page');
});

test('item 2: "Your Groups" shows the Group name and next session in the student\'s language, and nothing without a Group', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { YourGroups } = load('frontend/features/groups/your-groups.tsx'), { LanguageProvider } = load('frontend/components/language-provider.tsx');
  const draw = (lang, props) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLanguage: lang }, React.createElement(YourGroups, props)));
  const html = draw('en', { showCourse: true, groups: [{ id: 'g', name: 'Saturday Group', courseTitle: 'Physics', mode: 'online', nextStartsAt: '2026-11-28T15:00:00Z' }, { id: 'h', name: 'Centre B', courseTitle: 'Physics', mode: 'center', nextStartsAt: null }] });
  assert.match(html, /Your Groups/); assert.match(html, /Saturday Group/); assert.match(html, /Physics/); assert.match(html, /Next session: Saturday 28 Nov/); assert.match(html, /5:00\s?pm/i, 'Cairo time');
  assert.match(html, /No upcoming session/); assert.match(html, /At a centre/); assert.doesNotMatch(html, /enrollment|active|blended|offering/i);
  const arabic = draw('ar', { showCourse: false, groups: [{ id: 'g', name: 'Saturday Group', courseTitle: 'Physics', mode: 'online', nextStartsAt: '2026-11-28T15:00:00Z' }] });
  assert.match(arabic, /مجموعاتك/); assert.match(arabic, /الحصة القادمة: السبت/); assert.doesNotMatch(arabic, /Physics/, 'the course is not repeated on its own page');
  assert.equal(draw('en', { showCourse: true, groups: [] }).replace(/<script[\s\S]*<\/script>/, ''), '', 'no Group: no box');
});

test('item 3: one centred content column on wide screens for every teacher page; the phone is unchanged', () => {
  const css = read('frontend/styles/design-components.css'), tokens = read('frontend/styles/design-tokens.css');
  assert.match(tokens, /--d-content-max: 1040px;/);
  assert.match(css, /@media \(min-width: 768px\) \{ \.d-main-inner \{ max-width: calc\(var\(--d-content-max\) \+ 2 \* var\(--d-space-6\)\); margin-inline: auto; \} \}/);
  assert.match(css, /\.d-page \{ width: 100%; max-width: var\(--d-content-max\);/);
  assert.match(read('frontend/features/teacher-frame/teacher-frame.tsx'), /className="d-main-inner"/, 'the one frame every teacher page is drawn in');
});

test('item 4: the database\'s reason for refusing an Add reaches the screen, and only a known reason', async () => {
  const groups = load('shared/teacher-groups.ts');
  assert.equal(groups.groupRefusal('Already assigned; use transfer'), 'other_group'); assert.equal(groups.groupRefusal('Group is full'), 'full');
  assert.equal(groups.groupRefusal('Active eligible enrollment required'), 'no_access'); assert.equal(groups.groupRefusal('constructor'), undefined); assert.equal(groups.groupRefusal('something else'), undefined);
  let reply;
  const client = { rpc: async () => reply };
  const service = loadWith('server/services/groups.ts', { 'server-only': {}, '@/server/integrations/supabase': { getSupabaseServerClient: async () => client }, '@/shared/teacher-groups': groups });
  const s = await service.groupService();
  for (const [message, reason] of [['Group is full', 'full'], ['Already assigned; use transfer', 'other_group'], ['Active eligible enrollment required', 'no_access'], ['Capacity below membership', undefined]]) {
    reply = { data: null, error: { code: '23514', message } };
    await assert.rejects(s.command('g', 'add', 1, {}), e => e.status === 400 && e.reason === reason && e.message === 'Check membership, capacity, schedule and attendance state.');
  }
  reply = { data: null, error: { code: '42501', message: 'Group is full' } };
  await assert.rejects(s.command('g', 'add', 1, {}), e => e.status === 403 && e.reason === undefined, 'a reason only with a 400');
  const route = read('server/http/groups.ts');
  assert.match(route, /const reason=status===400\?\(e as \{reason\?:string\}\)\.reason:undefined;/);
  const api = read('frontend/features/teacher-groups/api.ts'); assert.match(api, /if \(isGroupRefusal\(body\.reason\)\) reason = body\.reason;/, 'the browser accepts only a known reason');
  const view = read('frontend/features/teacher-groups/group-view.tsx');
  assert.match(view, /\{error && failedId === r\.user_id && <div id=\{`add-error-\$\{r\.user_id\}`\}/, 'said on the row whose Add was pressed');
  assert.match(view, /aria-describedby=\{error && failedId === r\.user_id \? `add-error-\$\{r\.user_id\}` : undefined\}/);
  assert.match(view, /<div role="alert" data-state="error" className="d-alert">/, 'announced');
  assert.doesNotMatch(en['tg.students.add_failed'], /may/, 'no "may ... or may" list');
  for (const k of ['tg.students.add_failed.other_group', 'tg.students.add_failed.full', 'tg.students.add_failed.no_access']) { assert.ok(en[k] && ar[k], k); assert.equal((en[k].match(/\{name\}/g) || []).length, (ar[k].match(/\{name\}/g) || []).length, k); }
});

test('item 5: who sees which course buttons mirrors public.course_update; only changed text is sent', () => {
  const page = load('shared/teacher-course-page.ts');
  const m = role => ({ role, status: 'active' });
  assert.equal(page.canChangeCourseStatus(m('owner'), null), true); assert.equal(page.canChangeCourseStatus(m('admin'), null), true);
  assert.equal(page.canChangeCourseStatus(m('teacher'), { role: 'instructor' }), true); assert.equal(page.canChangeCourseStatus(m('teacher'), { role: 'owner' }), true);
  assert.equal(page.canChangeCourseStatus(m('teacher'), { role: 'editor' }), false, 'an editor changes text only'); assert.equal(page.canChangeCourseStatus(m('assistant'), null), false);
  assert.equal(page.canChangeCourseStatus({ role: 'owner', status: 'suspended' }, null), false); assert.equal(page.canChangeCourseStatus(null, { role: 'instructor' }), false);
  assert.equal(page.canRestoreCourse(m('owner')), true); assert.equal(page.canRestoreCourse(m('admin')), true); assert.equal(page.canRestoreCourse(m('teacher')), false);
  const sql = read('supabase/migrations/20261124120000_close_direct_table_access.sql');
  assert.match(sql, /s\.role in \('owner','instructor'\)\)\);\n  if not v_lead then raise exception 'Only the course owner/); assert.match(sql, /if c\.status='archived' and not v_admin then raise exception 'Only the space owner or admin can restore/);
  assert.deepEqual(plain(page.courseTextChanges({ title: 'Physics', description: null }, ' Physics ', '')), {}, 'nothing changed: nothing sent');
  assert.deepEqual(plain(page.courseTextChanges({ title: 'Physics', description: 'Old' }, 'Physics 9', 'Old')), { title: 'Physics 9' });
  assert.deepEqual(plain(page.courseTextChanges({ title: 'Physics', description: 'Old' }, 'Physics', '  ')), { description: null }, 'emptied: no description');
  assert.equal(page.courseTextProblem('  ', ''), 'empty_name'); assert.equal(page.courseTextProblem('x'.repeat(201), ''), 'name_long'); assert.equal(page.courseTextProblem('ok', 'x'.repeat(20001)), 'about_long'); assert.equal(page.courseTextProblem('ok', ''), null);
  const loader = read('server/services/teacher-course-page.ts'); assert.match(loader, /canChangeStatus: canChangeCourseStatus\(membership, staff\), canRestore: canRestoreCourse\(membership\),/);
  const view = read('frontend/features/teacher-course/course-view.tsx');
  assert.match(view, /archived \? \(course\.canRestore \? \['restore'\] : \[\]\) : course\.canChangeStatus && toggle \? \[toggle, 'archived'\] : \[\]/);
  assert.match(view, /status: what === 'restore' \? 'draft' : what/, 'restore brings the course back as a draft');
  assert.match(view, /body: JSON\.stringify\(\{ updated_at: course\.updatedAt, \.\.\.fields \}\)/, 'every change sends the version read (a change elsewhere is PT409, never overwritten)');
  for (const k of ['tc.settings', 'tc.settings.name', 'tc.settings.about', 'tc.settings.save', 'tc.archive', 'tc.restore', 'tc.confirm_archive', 'tc.confirm_restore', 'tc.cannot_status', 'tc.cannot_restore']) assert.ok(en[k] && ar[k], k);
  assert.match(en['tc.confirm_archive'], /\{title\}/); assert.match(ar['tc.confirm_archive'], /\{title\}/);
});
