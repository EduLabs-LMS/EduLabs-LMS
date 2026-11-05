// Teacher Settings area and Groups & Classes: structure, the REAL middleware, wording, locales and what is deliberately left out.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript'), cp = require('node:child_process'), React = require('react');
const localization = require('./localization-test-loader.cjs');
const { messages } = localization.load('frontend/locales/messages.ts');
const settings = localization.load('shared/teacher-settings.ts');
const read = f => fs.readFileSync(f, 'utf8');
const exists = f => fs.existsSync(f);
const hasGit = (() => { try { cp.execFileSync('git', ['rev-parse', '--verify', '0c17a42441b42b18ed546e06b72a5f34efa40c08'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function load(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { module: m, exports: m.exports, URL, console, require: n => n === 'zod' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}

// ------------------------------------------------------------------ Settings area
test('settings: one array of sections; each has a page, a label and a hint in English and Arabic, and the root is not a section', () => {
 const sections = [...settings.teacherSettingsSections];
 assert.deepEqual(sections.map(s => s.key), ['account', 'courses', 'language', 'notifications']);
 assert.equal(new Set(sections.map(s => s.href)).size, sections.length);
 for (const s of sections) {
  assert.equal(s.href, settings.teacherSettingsRoot + '/' + s.key);
  assert.ok(exists(`app/teacher/settings/${s.key}/page.tsx`), s.key + ' has a page');
  for (const part of ['title', 'hint']) for (const lang of ['en', 'ar']) assert.ok(messages[lang][`ts.${s.key}.${part}`], `${lang} ts.${s.key}.${part}`);
 }
 assert.deepEqual([...settings.teacherSettingsPaths], ['/teacher/settings', ...sections.map(s => s.href)]);
 assert.equal(settings.settingsSectionFor('/teacher/settings'), null); assert.equal(settings.settingsSectionFor('/teacher/settings/account/'), null);
 // The shell and the phone list read the same array, so adding a section is one entry.
 const shell = read('frontend/features/teacher-settings/shell.tsx');
 assert.equal((shell.match(/teacherSettingsSections\.map/g) ?? []).length, 2, 'sidebar and phone list both map the one array');
 assert.doesNotMatch(shell, /href="\/teacher\/settings\//, 'no section address is written out in the shell');
});
test('settings: its own frame outside the main teacher layout, every page repeats the staff check', () => {
 assert.equal(exists('app/teacher/settings/layout.tsx'), true);
 assert.match(read('app/teacher/settings/layout.tsx'), /await staffContext\(\);\s*return <TeacherSettingsShell>/);
 for (const f of ['page', 'account/page', 'language/page', 'notifications/page']) assert.match(read(`app/teacher/settings/${f}.tsx`), /await staffContext\(\)/, f);
 assert.match(read('app/teacher/settings/courses/page.tsx'), /TeacherCoursesPage/);
 assert.match(read('app/(dashboard)/_components/teacher-home-pages.tsx'), /export async function TeacherCoursesPage\(\) \{\s*const \{ courses, createTargets \} = await loadTeacherCourses\(await staffContext\(\)\)/);
 assert.equal(exists('app/(dashboard)/(routes)/teacher/settings'), false, 'not inside the dashboard layout');
 assert.match(read('app/(dashboard)/(routes)/teacher/courses/page.tsx'), /redirect\('\/teacher\/settings\/courses'\)/, 'the old list route redirects');
 assert.ok(exists('app/(dashboard)/(routes)/teacher/courses/[courseId]/page.tsx'), 'course editors stay where they are');
});
test('settings: the desktop root goes to the first section, a phone gets the list', () => {
 const index = read('frontend/features/teacher-settings/settings-index.tsx');
 assert.match(index, /matchMedia\('\(min-width: 768px\)'\)/); assert.match(index, /router\.replace\(teacherSettingsSections\[0\]\.href\)/); assert.match(index, /return <SettingsList \/>/);
 assert.match(read('frontend/features/teacher-settings/shell.tsx'), /<ul data-settings-list className="[^"]*md:hidden"/);
});
test('settings: language and appearance reuse the existing components; student Settings is untouched', { skip: hasGit ? false : 'requires Git history' }, () => {
 const page = read('app/teacher/settings/language/page.tsx');
 assert.match(page, /import \{ AppearanceSettings \} from '@\/frontend\/features\/personalization\/appearance-settings'/); assert.match(page, /import \{ LanguageSettings \} from '@\/frontend\/features\/personalization\/language-settings'/);
 const changed = cp.execFileSync('git', ['diff', '--name-only', '0c17a42441b42b18ed546e06b72a5f34efa40c08', '--', 'frontend/features/personalization', 'app/(dashboard)/(routes)/settings', 'app/(dashboard)/(routes)/personalization'], { encoding: 'utf8' }).trim();
 assert.equal(changed, '', 'student Settings files are unchanged');
});
test('settings: notifications only links to the existing preferences screen; account changes nothing by itself', () => {
 const n = read('frontend/features/teacher-settings/notifications-section.tsx');
 assert.match(n, /href="\/notifications"/); assert.doesNotMatch(n, /fetch\(|communicate\(|api\./);
 const a = read('frontend/features/teacher-settings/account-section.tsx');
 assert.match(a, /openUserProfile/); assert.doesNotMatch(a, /fetch\(|api\.(post|put|patch|delete)|\/api\//, 'no new account endpoint');
});

// ------------------------------------------------------------------ Groups & Classes
const contracts = load('shared/contracts/groups.ts');
const model = load('shared/teacher-groups.ts', { '@/shared/contracts/groups': contracts });
const T = s => Date.parse(s);
const sess = (id, start, end, extra = {}) => ({ id, group_id: 'g', title: id, starts_at: start, ends_at: end, cancelled: false, version: 1, attendance_state: 'draft', mode: 'online', location: '', join_url: '', instructions: '', state: 'upcoming', ...extra });
const NOW = T('2026-10-29T12:00:00Z');
test('groups: Active/Archived counts, filter and search come from the rows alone', () => {
 const rows = [{ name: 'Algebra A', offering_name: 'Maths', status: 'active', staff: true }, { name: 'Algebra B', offering_name: 'Maths', status: 'archived', staff: true }, { name: 'Physics', offering_name: 'Science', status: 'active', staff: true }, { name: 'Other', offering_name: 'X', status: 'active', staff: false }];
 assert.deepEqual({ ...model.groupCounts(model.managed(rows)) }, { active: 2, archived: 1 });
 assert.equal(model.managed(rows).length, 3, 'only Groups the database says the teacher manages');
 assert.deepEqual(model.filterGroups(model.managed(rows), 'active', '').map(g => g.name), ['Algebra A', 'Physics']);
 assert.deepEqual(model.filterGroups(model.managed(rows), 'active', ' science ').map(g => g.name), ['Physics']);
 assert.deepEqual(model.filterGroups(model.managed(rows), 'archived', 'algebra').map(g => g.name), ['Algebra B']);
});
test('groups: students are current members only, and a partial read says so', () => {
 const rows = [{ user_id: 'a', display_name: 'A', ends_at: null }, { user_id: 'b', display_name: 'B', ends_at: '2026-01-01T00:00:00Z' }, { user_id: 'c', display_name: 'C' }];
 assert.deepEqual({ ...model.studentsCount(rows, false, 10) }, { count: 2, more: false, capacity: 10 });
 assert.equal(model.studentsCount(rows, true, null).more, true);
});
test('groups: sessions split into upcoming and earlier; a session in progress stays upcoming; cancelled ones are placed by their start', () => {
 const rows = [sess('past', '2026-10-27T10:00:00Z', '2026-10-27T11:00:00Z'), sess('live', '2026-10-29T11:30:00Z', '2026-10-29T12:30:00Z'), sess('soon', '2026-10-30T10:00:00Z', '2026-10-30T11:00:00Z'),
  sess('cancelled-future', '2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z', { cancelled: true }), sess('cancelled-past', '2026-10-20T10:00:00Z', '2026-10-20T11:00:00Z', { cancelled: true })];
 const { upcoming, earlier } = model.partitionSessions(rows, NOW);
 assert.deepEqual(upcoming.map(s => s.id), ['live', 'soon', 'cancelled-future']);
 assert.deepEqual(earlier.map(s => s.id), ['past', 'cancelled-past']);
});
test('groups: attendance summary and the "not saved" flag follow the saved state, never a guess', () => {
 const done = sess('d', '2026-10-27T10:00:00Z', '2026-10-27T11:00:00Z');
 assert.equal(model.attendanceSummary(done, NOW), 'unsaved');
 assert.equal(model.attendanceSummary({ ...done, attendance_state: 'finalized' }, NOW), 'saved');
 assert.equal(model.attendanceSummary({ ...done, attendance_state: 'reopened' }, NOW), 'reopened');
 assert.equal(model.attendanceSummary(sess('f', '2026-10-30T10:00:00Z', '2026-10-30T11:00:00Z'), NOW), 'opens');
 assert.equal(model.attendanceSummary({ ...done, cancelled: true }, NOW), 'none');
 assert.equal(model.lastAttendanceUnsaved([done], NOW), true);
 assert.equal(model.lastAttendanceUnsaved([{ ...done, attendance_state: 'finalized' }], NOW), false);
 assert.equal(model.lastAttendanceUnsaved([done, { ...sess('older', '2026-10-20T10:00:00Z', '2026-10-20T11:00:00Z'), attendance_state: 'draft' }, { ...done, id: 'x', cancelled: true, starts_at: '2026-10-28T10:00:00Z', ends_at: '2026-10-28T11:00:00Z' }], NOW), true, 'the most recent finished session decides; cancelled ones are ignored');
 assert.equal(model.lastAttendanceUnsaved([], NOW), false, 'a Group with no finished session raises no flag');
});
test('groups: a failed call is never shown as empty, and a lost reply is an unknown outcome', () => {
 assert.deepEqual([401, 403, 409, 400, 413, 500, null].map(model.failureKind), ['signin', 'denied', 'changed', 'invalid', 'invalid', 'unavailable', 'unavailable']);
});
test('groups: the screens use the Groups endpoint and the course-run route, and only commands that already exist', () => {
 const files = ['api.ts', 'list-view.tsx', 'group-view.tsx', 'group-form.tsx', 'parts.tsx'].map(f => read('frontend/features/teacher-groups/' + f)).join('\n');
 assert.deepEqual([...new Set([...files.matchAll(/['"`](\/api\/[^'"`]*)['"`]/g)].map(m => m[1]))], ['/api/study-groups', '/api/study-groups/course-run']);
 const commands = [...new Set([...files.matchAll(/groupCall(?:<[^>]*>)?\('([a-z-]+)'/g)].map(m => m[1]))].sort();
 assert.deepEqual(commands, ['add', 'archive', 'create', 'edit', 'one-off', 'remove', 'session', 'view']);
 for (const out of ['attendance', 'finalize', 'reopen', 'transfer']) assert.ok(!files.includes(`groupCall('${out.replace(/'/g, '')}'`), out + ' is not called');
 assert.match(files, /operation: 'cancel'/); assert.doesNotMatch(files, /operation: '(reschedule|restore)'/);
});
test('groups: changes ask first, send the version they read, and Archive is for the instructor only', () => {
 const view = read('frontend/features/teacher-groups/group-view.tsx');
 assert.match(view, /groupCall\('archive', group\.id, \{\}, group\.version\)/); assert.match(view, /groupCall\('one-off', group\.id, parsed\.data, group\.version\)/); assert.match(view, /sessionVersion: s\.version/);
 assert.match(view, /group\.instructor && <ArchiveGroup/); assert.match(view, /active && group\.staff/); assert.match(view, /canCancel && state === 'upcoming'/);
 assert.match(view, /setConfirm\(true\)/, 'cancel and archive both ask first'); assert.match(view, /cairoWallTime/);
});
test('groups: pages are staff-only, validate the id, and the list route sits next to the menu entry', () => {
 const list = read('app/(dashboard)/(routes)/teacher/groups/page.tsx'), one = read('app/(dashboard)/(routes)/teacher/groups/[groupId]/page.tsx');
 assert.match(list, /await staffContext\(\);\s*return <>\s*<TeacherGroupsList \/>/); assert.match(one, /notFound\(\)/); assert.match(one, /await staffContext\(\);\s*return <>\s*<TeacherGroupView/);
 assert.match(read('shared/teacher-home.ts'), /href: '\/teacher\/groups'/);
});

// ------------------------------------------------------------------ real middleware
test('middleware: with Firebase staging on, exactly the Settings and Group pages pass; lookalikes, legacy paths and APIs stay behind the catch-all', () => {
 class NextResponse { constructor(kind, status) { this.kind = kind; this.status = status; this.headers = new Map(); } static next() { return new NextResponse('next', 200); } static json(_, o) { return new NextResponse('json', o.status); } static redirect(u) { return new NextResponse('redirect:' + u.pathname, 307); } }
 const middleware = load('middleware.ts', {
  '@/shared/public-website': load('shared/public-website.ts', { zod: require('zod') }), '@/shared/website-routes': load('shared/website-routes.ts'),
  '@clerk/nextjs/server': { clerkMiddleware: () => () => assert.fail('the legacy handler must not run in Firebase staging'), createRouteMatcher: () => () => false },
  '@/shared/auth-config': { isFirebaseStaging: () => true }, 'next/server': { NextResponse },
 }).default;
 const run = path => middleware({ nextUrl: new URL('https://platform.example' + path), url: 'https://platform.example' + path }, {});
 const id = '1234abcd-0000-4000-8000-00000000000f';
 for (const ok of [...settings.teacherSettingsPaths, '/teacher/settings/courses/' + id, '/teacher/settings/courses/' + id.toUpperCase(), '/teacher/groups', '/teacher/groups/new', '/teacher/groups/' + id, '/teacher/groups/' + id + '/attendance/' + id]) assert.equal(run(ok).kind, 'next', ok + ' passes through');
 const refusedPages = ['/teacher/groups/new/', '/teacher/groups/new/x', '/teacher/groups/New', '/teacher/groups/news', '/teacher/settings/', '/teacher/settings/account/', '/teacher/settings/other', '/teacher/settings/account/extra', '/teacher/settings//account', '/teacher/settings/Account', '/teacher/settings/courses.json', '/teacher/groups/', '/teacher/groups/not-a-uuid', '/teacher/groups/' + id + '/', '/teacher/groups/' + id + '/sessions', '/teacher/groups/' + id.toUpperCase(), '/teacher/groups/' + id.slice(1), '/teacher/groups//' + id, '/teacher/analytics', '/teacher/settings/notifications/preferences', '/teacher/settings/courses/' + id + '/', '/teacher/settings/courses/' + id + '/lessons', '/teacher/settings/courses/not-a-uuid', '/teacher/settings/courses/' + id.slice(1), '/teacher/settings/courses//' + id, '/teacher/settings/courses/' + id + '.json', '/teacher/settings/account/' + id];
 for (const path of refusedPages) { const r = run(path); assert.equal(r.kind, 'redirect:/unavailable', path + ' is not reachable'); }
 for (const path of ['/api/teacher/settings', '/api/teacher/groups', '/api/teacher/groups/' + id, '/api/settings/teacher', '/api/groups']) { const r = run(path); assert.equal(r.kind, 'json', path); assert.equal(r.status, 503, path); }
 assert.equal(run('/api/study-groups').kind, 'next', 'the Groups endpoint'); assert.equal(run('/api/study-groups/course-run').kind, 'next', 'the course-run route');
 for (const path of ['/api/study-groups/', '/api/study-groups/course-run/', '/api/study-groups/course-run/x', '/api/study-groups/x']) assert.equal(run(path).status, 503, path);
});
test('middleware: the allowed page list in the source is exactly the Settings array plus the two Group pages and the attendance page', () => {
 const source = read('middleware.ts');
 const literal = [...source.matchAll(/path === '(\/teacher\/settings[^']*)'/g)].map(m => m[1]);
 assert.deepEqual(literal.sort(), [...settings.teacherSettingsPaths].sort());
 assert.match(source, /path === '\/teacher\/groups' \|\| path === '\/teacher\/groups\/new' \|\| \/\^\\\/teacher\\\/groups\\\/\[0-9a-f-\]\{36\}\(\\\/attendance\\\/\[0-9a-f-\]\{36\}\)\?\$\/\.test\(path\)/);
 assert.doesNotMatch(source + read('shared/website-routes.ts'), /teacher\/analytics/);
});

// ------------------------------------------------------------------ wording and locales
test('locales: every ts.* string exists in English and Arabic with the same placeholders', () => {
 assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.ar).sort());
 const keys = Object.keys(messages.en).filter(k => k.startsWith('ts.') || k.startsWith('tg.') || k.startsWith('tc.'));
 assert.ok(keys.length >= 15);
 for (const k of keys) {
  assert.ok(messages.en[k].trim() && messages.ar[k].trim(), k);
  const holes = s => (s.match(/\{\w+\}/g) ?? []).sort().join();
  assert.equal(holes(messages.en[k]), holes(messages.ar[k]), k);
  assert.match(messages.ar[k], /[؀-ۿ]/, 'Arabic text is Arabic: ' + k);
 }
});
test('wording: no tenant, program or studio vocabulary reaches a teacher on these screens, in either language', () => {
 const forbidden = /organi[sz]ation|tenant|\bslug\b|program(me)?s?\b|\bstages?\b|\bmodules?\b|\boffering|website studio|منظمة|مؤسسة|وحدة|برنامج|مرحلة/i;
 for (const k of Object.keys(messages.en).filter(k => k.startsWith('ts.') || k.startsWith('tg.') || k.startsWith('tc.'))) { assert.doesNotMatch(messages.en[k], forbidden, k); assert.doesNotMatch(messages.ar[k], forbidden, k); }
});
test('middleware: the Notifications page that Home and Settings > Notifications link to passes in Firebase staging, with its one API, and nothing underneath it', () => {
 class NextResponse { constructor(kind, status) { this.kind = kind; this.status = status; this.headers = new Map(); } static next() { return new NextResponse('next', 200); } static json(_, o) { return new NextResponse('json', o.status); } static redirect(u) { return new NextResponse('redirect:' + u.pathname, 307); } }
 const middleware = load('middleware.ts', {
  '@/shared/public-website': load('shared/public-website.ts', { zod: require('zod') }), '@/shared/website-routes': load('shared/website-routes.ts'),
  '@clerk/nextjs/server': { clerkMiddleware: () => () => assert.fail('the legacy handler must not run in Firebase staging'), createRouteMatcher: () => () => false },
  '@/shared/auth-config': { isFirebaseStaging: () => true }, 'next/server': { NextResponse },
 }).default;
 const run = path => middleware({ nextUrl: new URL('https://platform.example' + path), url: 'https://platform.example' + path }, {});
 assert.equal(run('/notifications').kind, 'next');
 assert.equal(run('/api/communications').kind, 'next', 'the list/read/preferences API');
 for (const path of ['/notifications/', '/notifications/x', '/notification']) assert.equal(run(path).kind, 'redirect:/unavailable', path);
 for (const file of ['frontend/features/teacher-home/home-view.tsx', 'frontend/features/teacher-settings/notifications-section.tsx']) assert.match(read(file), /href="\/notifications"/, file + ' links to it');
 assert.match(read('app/(dashboard)/(routes)/notifications/page.tsx'), /isFirebaseStaging\(\)[\s\S]*getApplicationViewer\(\)[\s\S]*NotificationsView/, 'the page needs a signed-in viewer, nothing else (a teacher is a viewer)');
});

// ------------------------------------------------------------------ Create a Group, Edit a Group, students in a Group
const groupsModel = () => load('shared/teacher-groups.ts', { '@/shared/contracts/groups': load('shared/contracts/groups.ts', { zod: require('zod') }) });
const goodForm = (over = {}) => ({ name: ' Group A ', mode: 'center', location: ' Room 4 ', joinUrl: 'https://left.example/over', capacity: '', times: [{ weekday: 0, time: '17:00', durationMinutes: 90 }], ...over });
test('group form: every problem is named, and a good form is exactly what the existing contract accepts', () => {
 const m = groupsModel(), contract = load('shared/contracts/groups.ts', { zod: require('zod') });
 const problems = over => [...m.checkGroupForm(goodForm(over)).problems];
 assert.deepEqual(problems(), []);
 assert.deepEqual(problems({ name: '   ' }), ['name']); assert.deepEqual(problems({ location: ' ' }), ['location']);
 assert.deepEqual(problems({ mode: 'online', joinUrl: 'http://not-secure.example' }), ['join']); assert.deepEqual(problems({ mode: 'online', joinUrl: '' }), [], 'the join link is optional');
 for (const capacity of ['0', '-1', '1.5', 'abc', '10001']) assert.deepEqual(problems({ capacity }), ['capacity'], capacity);
 assert.deepEqual(problems({ times: [] }), ['times_required']); assert.deepEqual(problems({ times: [{ weekday: 0, time: '', durationMinutes: 60 }] }), ['time']);
 assert.deepEqual(problems({ times: [{ weekday: 1, time: '10:00', durationMinutes: 60 }, { weekday: 1, time: '10:00', durationMinutes: 90 }] }), ['times_duplicate']);
 assert.deepEqual([...m.checkGroupForm(goodForm({ times: [] }), false).problems], [], 'a Group that already has no weekly times can stay that way');
 const center = m.checkGroupForm(goodForm({ capacity: '12' })).value;
 assert.equal(center.name, 'Group A'); assert.equal(center.location, 'Room 4'); assert.equal(center.joinUrl, '', 'a centre keeps no join link'); assert.equal(center.capacity, 12);
 assert.equal(contract.groupDefinition.safeParse({ ...center, description: '', instructions: '' }).success, true);
 const online = m.checkGroupForm(goodForm({ mode: 'online', joinUrl: 'https://meet.example.test/room' })).value;
 assert.equal(online.location, '', 'online keeps no location'); assert.equal(online.capacity, null);
 assert.equal(contract.groupDefinition.safeParse({ ...online, description: '', instructions: '' }).success, true);
});
test('group edit: weekly times are only sent when they changed, a changed place moves the upcoming Sessions, and the payload passes the contract', () => {
 const m = groupsModel(), contract = load('shared/contracts/groups.ts', { zod: require('zod') });
 const group = { name: 'G', mode: 'center', location: 'Room 4', join_url: '', capacity: 20 }, before = [{ weekday: 3, time: '17:00', durationMinutes: 90 }, { weekday: 0, time: '17:00', durationMinutes: 90 }];
 const form = m.formFromGroup(group, before);
 assert.equal(form.capacity, '20'); assert.deepEqual([...form.times.map(t => t.weekday)], [0, 3], 'sorted for reading');
 const same = m.editPayload(group, before, m.checkGroupForm(form).value);
 assert.equal('schedules' in same, false, 'unchanged times are left out, so the Sessions are not touched'); assert.equal('applyMeetingDefaults' in same, false);
 const moved = m.editPayload(group, before, m.checkGroupForm({ ...form, location: 'Room 5' }).value); assert.equal(moved.applyMeetingDefaults, true);
 const changed = m.editPayload(group, before, m.checkGroupForm({ ...form, times: [form.times[0]] }).value); assert.equal(changed.schedules.length, 1);
 assert.equal(contract.groupEdit.safeParse(changed).success, true); assert.equal(contract.groupEdit.safeParse(moved).success, true);
 assert.equal(m.timesRemoved(before, before), false); assert.equal(m.timesRemoved(before, [before[0]]), true); assert.equal(m.timesRemoved(before, before.map(t => ({ ...t, durationMinutes: 60 }))), true, 'a changed length replaces the old time');
 assert.equal(m.placeChanged(group, { mode: 'center', location: 'Room 4', joinUrl: '' }), false); assert.equal(m.placeChanged(group, { mode: 'online', location: '', joinUrl: '' }), true);
});
test('course choice: the current run is active and not ended, always the same one, and the rule for who may pick mirrors the database', () => {
 const m = groupsModel(), now = Date.parse('2026-11-04T00:00:00Z'), run = (id, status, extra = {}) => ({ id, course_id: 'c', status, ...extra });
 assert.equal(m.currentRun([run('a', 'draft'), run('b', 'completed'), run('d', 'archived')], 'c', now), null, 'only an active run counts');
 assert.equal(m.currentRun([run('a', 'active', { ends_at: '2026-01-01T00:00:00Z' })], 'c', now), null, 'an ended run is not current');
 assert.equal(m.currentRun([run('a', 'active', { starts_at: '2026-01-01T00:00:00Z' }), run('b', 'active', { starts_at: '2026-09-01T00:00:00Z' }), run('z', 'active')], 'c', now).id, 'b', 'the latest start wins');
 assert.equal(m.currentRun([run('b', 'active'), run('a', 'active')], 'c', now).id, 'a', 'a tie is still always the same one');
 assert.equal(m.currentRun([{ ...run('a', 'active'), course_id: 'other' }], 'c', now), null);
 const course = (id, organization_id = 'org', status = 'draft') => ({ id, organization_id, title: id, status }), none = { memberships: [], courseStaff: [], offeringStaff: [] };
 const ids = (courses, runs, access) => [...m.groupCourseChoices(courses, runs, access, now)].map(c => c.courseId);
 assert.deepEqual(ids([course('c')], [], none), [], 'no role, no choice');
 assert.deepEqual(ids([course('c')], [], { ...none, memberships: [{ organization_id: 'org', role: 'owner', status: 'active' }] }), ['c'], 'space owner');
 assert.deepEqual(ids([course('c')], [], { ...none, memberships: [{ organization_id: 'org', role: 'owner', status: 'suspended' }] }), [], 'a suspended owner is nobody');
 assert.deepEqual(ids([course('c')], [], { ...none, memberships: [{ organization_id: 'org', role: 'teacher', status: 'active' }] }), [], 'a teacher who does not teach this course');
 assert.deepEqual(ids([course('c')], [], { ...none, memberships: [{ organization_id: 'org', role: 'teacher', status: 'active' }], courseStaff: [{ course_id: 'c', role: 'owner' }] }), ['c'], 'the course owner');
 assert.deepEqual(ids([course('c')], [], { ...none, memberships: [{ organization_id: 'org', role: 'assistant', status: 'active' }], courseStaff: [{ course_id: 'c', role: 'editor' }] }), [], 'an editor');
 assert.deepEqual(ids([course('c')], [run('r', 'active')], { ...none, offeringStaff: [{ offering_id: 'r', role: 'instructor' }] }), ['c'], 'the instructor of the current run');
 assert.deepEqual(ids([course('c')], [run('r', 'active')], { ...none, offeringStaff: [{ offering_id: 'r', role: 'teaching_assistant' }] }), [], 'an assistant');
 assert.deepEqual(ids([course('c', 'org', 'archived')], [], { ...none, memberships: [{ organization_id: 'org', role: 'owner', status: 'active' }] }), [], 'an archived course');
 const picked = [...m.groupCourseChoices([course('c')], [], { ...none, memberships: [{ organization_id: 'org', role: 'owner', status: 'active' }] }, now)][0];
 assert.equal(picked.runId, null, 'a course with no run is still offered; saving gets it one');
});
test('course-run: same gates as Groups with strict input, leaves the pinned Groups files alone, runs as the caller with no privileged client, and adds only when no current run exists', () => {
 const http = read('server/http/group-course-run.ts'), service = read('server/services/group-course-run.ts');
 assert.match(http, /z\.object\(\{ courseId: z\.string\(\)\.uuid\(\) \}\)\.strict\(\)/);
 for (const gate of ['isFirebaseStaging()', 'validFirebaseOrigin(request)', "viewer.backend !== 'firebase'", 'content-type']) assert.ok(http.includes(gate), gate);
 for (const pinned of ['server/http/groups.ts', 'server/services/groups.ts']) assert.doesNotMatch(read(pinned), /course-?run/i, pinned);
 assert.match(service, /getSupabaseServerClient\(\)/); assert.doesNotMatch(service, /service.?role|createClient/i);
 const body = service;
 assert.ok(body.indexOf('currentRun(') < body.indexOf('.insert('), 'an existing current run is reused first');
 assert.match(body, /status: 'active'/); assert.doesNotMatch(body, /insert\([^)]*\)\s*\.select/, 'the read rule refuses reading the new run back in the same statement'); assert.doesNotMatch(body, /courses'\)\.(insert|update)/);
 assert.equal((read('supabase/tests/group-course-run.sql').match(/student cannot add a run|assistant cannot add a run/g) || []).length, 2);
 assert.match(read('scripts/exam-sql-local.cjs'), /'group-course-run'/);
});
test('group screens: Create, Edit, add and remove send what the contract and the database expect, and ask first where it matters', () => {
 const form = read('frontend/features/teacher-groups/group-form.tsx'), view = read('frontend/features/teacher-groups/group-view.tsx'), list = read('frontend/features/teacher-groups/list-view.tsx'), page = read('app/(dashboard)/(routes)/teacher/groups/new/page.tsx');
 assert.match(page, /staffContext\(\)/); assert.match(page, /isFirebaseStaging\(\)/);
 assert.match(form, /postJson<\{ offeringId: string \}>\('\/api\/study-groups\/course-run', \{ courseId: choice\.courseId \}\)/); assert.match(form, /choice\.runId \?\?/);
 assert.match(form, /groupCall<\{ id: string \}>\('create', null, \{ offeringId, definition: \{ \.\.\.value, description: '', instructions: '' \} \}\)/);
 assert.match(form, /groupCall\('edit', group\.id, editPayload\(group, schedules, value\), group\.version\)/);
 assert.match(view, /'add', group\.id, \{ userId: r\.user_id \}, group\.version/); assert.match(view, /'remove', group\.id, \{ userId: row\.user_id \}, group\.version/);
 assert.match(view, /section: 'eligible'/); assert.match(view, /data-confirm-remove/);
 assert.match(view, /group\.status === 'active' && group\.instructor && <button type="button" data-edit-group/, 'Edit is for the instructor of an active Group');
 assert.match(view, /const canChange = group\.status === 'active' && group\.staff/);
 assert.match(list, /href="\/teacher\/groups\/new" data-create-group data-tour="create-group"/); assert.match(list, /data-create-group-empty/);
 for (const target of ['group-course', 'group-name', 'group-place', 'weekly-times', 'group-capacity', 'save-group']) assert.match(form, new RegExp(`data-tour="${target}"`), target);
 for (const target of ['edit-group', 'add-student', 'student-rows', 'remove-student', 'eligible-students']) assert.match(view, new RegExp(`data-tour="${target}"`), target);
 assert.doesNotMatch(form, /offering_id|offering_name\}.*tg\.form/, 'the run never reaches a label');
 assert.deepEqual(view.match(/offering_id/g), ['offering_id'], 'the Group page uses the run only inside the Invite students address');
 assert.match(view, /href=\{`\/teacher\/students\?invite=\$\{group\.offering_id\}`\}/);
});
