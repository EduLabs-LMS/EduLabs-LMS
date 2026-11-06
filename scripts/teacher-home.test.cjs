const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), React = require('react');
const localization = require('./localization-test-loader.cjs');
const home = localization.load('shared/teacher-home.ts');
const { messages } = localization.load('frontend/locales/messages.ts');
const { renderToStaticMarkup } = require('react-dom/server');
const read = f => fs.readFileSync(f, 'utf8');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const NOW = Date.parse('2030-03-04T10:00:00Z');
const at = minutes => new Date(NOW + minutes * 60000).toISOString();

const group = (n, extra = {}) => ({ id: uuid(n), offering_id: uuid(100 + n), offering_name: 'Synthetic offering', name: 'Synthetic Group ' + n, description: '', mode: 'online', location: '', join_url: '', instructions: '', capacity: null, status: 'active', version: 1, staff: true, instructor: false, ...extra });
const session = (n, groupN, startMin, extra = {}) => ({ id: uuid(200 + n), group_id: uuid(groupN), title: 'Synthetic session ' + n, starts_at: at(startMin), ends_at: at(startMin + 60), mode: 'online', location: '', join_url: '', instructions: '', cancelled: false, version: 1, attendance_state: 'draft', state: 'upcoming', ...extra });
const note = (n, event, createdMin, extra = {}) => ({ id: uuid(300 + n), event_type: event, created_at: at(createdMin), read_at: null, link: null, ...extra });
const ok = value => ({ ok: true, value });
const bad = status => ({ ok: false, status });
const inputs = (over = {}) => ({
 courses: ok([{ id: uuid(1), organization_id: uuid(50), title: 'Synthetic Physics', status: 'published' }, { id: uuid(2), organization_id: uuid(50), title: 'Synthetic Draft', status: 'draft' }]),
 groups: ok({ rows: [group(1), group(2)], page: 0, hasMore: false }),
 upcoming: ok({ rows: [session(2, 2, 120), session(1, 1, 30), session(3, 1, 600)], page: 0 }),
 notifications: ok({ rows: [note(1, 'support_reply', -5), note(2, 'session_details', -50)], page: 0, unread: 2 }),
 now: NOW, ...over,
});
const build = over => home.buildTeacherHome(inputs(over));

test('sessions: the earliest upcoming, non-cancelled session across the teacher\'s Groups is next; the rest follow in order', () => {
 const s = build().sessions;
 assert.equal(s.state, 'ready'); assert.equal(s.data.next.id, uuid(201)); assert.equal(s.data.next.groupName, 'Synthetic Group 1');
 assert.deepEqual(s.data.comingUp.map(x => x.id), [uuid(202), uuid(203)]);
 const cancelled = build({ upcoming: ok({ rows: [session(1, 1, 30, { cancelled: true }), session(2, 2, 120)], page: 0 }) }).sessions;
 assert.equal(cancelled.data.next.id, uuid(202), 'a cancelled session is never next');
 const over = build({ upcoming: ok({ rows: [session(1, 1, -120)], page: 0 }) }).sessions;
 assert.equal(over.data.next, null, 'a session that has already ended is not upcoming');
 const ongoing = build({ upcoming: ok({ rows: [session(1, 1, -30)], page: 0 }) }).sessions;
 assert.equal(ongoing.data.next.id, uuid(201), 'a session in progress is still next');
});
test('sessions: only Groups the viewer teaches and that are active count; student memberships and archived Groups are ignored', () => {
 const out = build({ groups: ok({ rows: [group(1, { staff: false }), group(2, { status: 'archived' }), group(3)], page: 0 }), upcoming: ok({ rows: [session(1, 1, 10), session(2, 2, 20), session(3, 3, 30)], page: 0 }) });
 assert.equal(out.groups.data.count, 1); assert.deepEqual(out.sessions.data.comingUp, []); assert.equal(out.sessions.data.next.groupId, uuid(3));
});
test('sessions: coming up is capped and flags a partial view when more Groups or sessions exist', () => {
 const many = Array.from({ length: 12 }, (_, i) => session(i + 1, 1, 10 + i));
 const out = build({ upcoming: ok({ rows: many, page: 0, hasMore: true }), groups: ok({ rows: [group(1)], page: 0, hasMore: true }) });
 assert.equal(out.sessions.data.comingUp.length, home.COMING_UP_LIMIT); assert.equal(out.sessions.data.partial, true);
});
test('there is no Homework to correct card or data on Home until the Homework screen is built, and nothing is filled from the per-Group summary', () => {
 assert.equal('homework' in build(), false, 'no homework section in the Home data');
 assert.doesNotMatch(read('frontend/features/teacher-home/home-view.tsx') + read('frontend/features/teacher-home/parts.tsx'), /<Homework|function Homework|th-homework|th\.hw\.|\/admin\/submissions|SectionUnavailable/, 'no card, no link to /admin/submissions');
 assert.doesNotMatch(read('frontend/locales/en.ts') + read('frontend/locales/ar.ts'), /"th\.hw\.|"th\.next\.all"/, 'its wording is removed too');
 assert.match(read('docs/ai/V1.md'), /Homework card returns on Home with the Homework build/);
 assert.doesNotMatch(read('server/services/teacher-home.ts') + read('shared/teacher-home.ts').replace(/\/\*\*[^]*?\*\//g, ''), /group_summary|'summary'|pendingHomework/);
});
test('updates: unread only, session changes first, then newest; links must be same-site paths', () => {
 const out = build({ notifications: ok({ rows: [note(1, 'support_reply', -5), note(2, 'session_details', -500), note(3, 'session_starting', -20, { link: '/groups' }), note(4, 'support_reply', -1, { read_at: at(0) }), note(5, 'lesson_published', -2, { link: 'https://evil.example/x' }), note(6, 'lesson_published', -3, { link: '//evil.example' })], page: 0, unread: 5 }) }).updates;
 assert.deepEqual(out.data.items.slice(0, 2).map(i => i.id), [uuid(303), uuid(302)], 'session changes come first, newest first');
 assert.ok(!out.data.items.some(i => i.id === uuid(304)), 'a read update is not listed');
 assert.equal(out.data.items.find(i => i.id === uuid(303)).link, '/groups'); assert.equal(out.data.items.find(i => i.id === uuid(305)).link, null); assert.equal(out.data.items.find(i => i.id === uuid(306)).link, null);
 assert.equal(out.data.unread, 5);
 assert.equal(build({ notifications: ok({ rows: Array.from({ length: 9 }, (_, i) => note(i + 1, 'support_reply', -i)), page: 0, unread: 9 }) }).updates.data.items.length, home.UPDATE_LIMIT);
});
test('courses: only known statuses are listed, titles are kept, and a long list is truncated honestly', () => {
 const raw = Array.from({ length: 103 }, (_, i) => ({ id: uuid(1000 + i), organization_id: uuid(50), title: 'C' + i, status: i % 2 ? 'draft' : 'published' })).concat([{ id: uuid(2000), organization_id: uuid(50), title: 'Odd', status: 'mystery' }]);
 const out = home.mapCourses(ok(raw));
 assert.equal(out.data.items.length, home.COURSE_LIMIT); assert.equal(out.data.truncated, true); assert.ok(!out.data.items.some(c => c.title === 'Odd'));
 assert.deepEqual(Object.keys(out.data.items[0]).sort(), ['id', 'status', 'title'], 'no organization or internal field leaves the server');
});
test('states: a failed read is an error with its status, never empty; sessions depend on both Group reads', () => {
 const failed = build({ courses: bad(503), groups: bad(403), upcoming: bad(401), notifications: bad(null) });
 assert.deepEqual(JSON.parse(JSON.stringify(failed.courses)), { state: 'error', status: 503 });
 assert.deepEqual(JSON.parse(JSON.stringify(failed.groups)), { state: 'error', status: 403 });
 assert.deepEqual(JSON.parse(JSON.stringify(failed.sessions)), { state: 'error', status: 403 }, 'no Groups list means the sessions cannot be trusted');
 assert.deepEqual(JSON.parse(JSON.stringify(failed.updates)), { state: 'error', status: null });
 assert.deepEqual(JSON.parse(JSON.stringify(build({ upcoming: bad(401) }).sessions)), { state: 'error', status: 401 });
 const empty = build({ upcoming: ok({ rows: [], page: 0 }), notifications: ok({ rows: [], page: 0, unread: 0 }), courses: ok([]) });
 assert.equal(empty.sessions.data.next, null); assert.equal(empty.updates.data.items.length, 0); assert.equal(empty.courses.data.items.length, 0);
});
test('first visit: only when courses and Groups were both read successfully and are both empty', () => {
 const none = { courses: ok([]), groups: ok({ rows: [], page: 0, hasMore: false }) };
 assert.equal(build(none).firstVisit, true);
 assert.equal(build({ ...none, courses: bad(503) }).firstVisit, false, 'an unknown course list is not "no courses"');
 assert.equal(build({ ...none, groups: bad(503) }).firstVisit, false);
 assert.equal(build({ ...none, groups: ok({ rows: [], page: 0, hasMore: true }) }).firstVisit, false);
 assert.equal(build({ courses: ok([]) }).firstVisit, false, 'a teacher with Groups is not on a first visit');
 assert.equal(build({ groups: ok({ rows: [group(1, { staff: false })], page: 0 }), courses: ok([]) }).firstVisit, true, 'a student-only membership is not teaching');
});
test('create targets and course names: owners, admins and teachers may create; names become valid server-side slugs', () => {
 const orgs = [{ id: uuid(50), name: 'A', status: 'active' }, { id: uuid(51), name: 'B', status: 'active' }, { id: uuid(52), name: 'C', status: 'suspended' }];
 const t = home.createTargets(orgs, [{ organization_id: uuid(50), role: 'teacher', status: 'active' }, { organization_id: uuid(51), role: 'student', status: 'active' }, { organization_id: uuid(52), role: 'owner', status: 'active' }]);
 assert.deepEqual(t.map(x => x.id), [uuid(50)]);
 const rule = /^[a-z0-9]+(-[a-z0-9]+)*$/;
 for (const title of ['Physics 10', '  Chemistry & Lab!! ', 'فيزياء الصف العاشر', 'Café Élève', '---', 'x'.repeat(300)]) { const slug = home.courseSlug(title, () => 'AbC123-zzz'); assert.match(slug, rule, title); assert.ok(slug.length <= 100); }
 assert.match(home.courseSlug('فيزياء', () => 'abc123'), /^course-abc123$/);
});
test('navigation: Home, Groups, Students, Courses in that order, for active staff of the Firebase build only; Homework, Exams and Reports stay hidden until they are built', () => {
 assert.deepEqual([...home.teacherNav.map(n => n.key)], ['home', 'groups', 'students', 'courses']);
 assert.equal(home.showTeacherNav(true, [uuid(50)]), true);
 assert.equal(home.showTeacherNav(true, []), false, 'a student has no staff organizations');
 assert.equal(home.showTeacherNav(true, undefined), false); assert.equal(home.showTeacherNav(true, null), false);
 assert.equal(home.showTeacherNav(false, [uuid(50)]), false, 'the Clerk fallback keeps its own navigation');
 const active = path => [...home.teacherNav.filter(n => n.match(path)).map(n => n.key)];
 assert.deepEqual(active('/home'), ['home']); assert.deepEqual(active('/'), ['home']); assert.deepEqual(active('/teacher/groups'), ['groups']); assert.deepEqual(active('/teacher/groups/abc'), ['groups']);
 assert.deepEqual(active('/teacher/courses'), ['courses']); assert.deepEqual(active('/teacher/courses/abc'), ['courses']); assert.deepEqual(active('/teacher/settings/courses/abc'), ['courses'], 'a course page keeps its address and belongs to Courses');
 assert.deepEqual(active('/teacher/settings'), []); assert.deepEqual(active('/self-learning'), []);
 assert.equal(home.teacherSettingsActive('/teacher/settings/account'), true); assert.equal(home.teacherSettingsActive('/teacher/settings/courses/abc'), false);
 const layout = read('app/(dashboard)/layout.tsx'), sidebar = read('frontend/components/sidebar.tsx'), mobile = read('frontend/features/dashboard/mobile-sidebar.tsx');
 assert.match(layout, /staffOrganizationIds\.length \? <TeacherFrame>\{children\}<\/TeacherFrame> : <div data-lms-shell/, 'staff get the teacher frame, a student keeps the student shell');
 assert.doesNotMatch(sidebar + mobile, /teacherMode|TeacherNav|TeacherProfile/, 'the student shell has no teacher branch left');
 assert.equal((read('frontend/features/teacher-home/teacher-nav.tsx').match(/NotificationBell/g) ?? []).length, 0, 'no notification entry in the main menu');
 for (const n of home.teacherNav) assert.ok(messages.en['th.nav.' + n.key] && messages.ar['th.nav.' + n.key], n.key);
});
test('navigation: every link is a real page; what is not built yet is shown as Soon and is not a link', () => {
 const byKey = Object.fromEntries(home.teacherNav.map(n => [n.key, n.href]));
 assert.equal(byKey.home, '/home'); assert.equal(byKey.groups, '/teacher/groups'); assert.equal(byKey.students, '/teacher/students'); assert.equal(byKey.courses, '/teacher/courses');
 for (const key of ['groups', 'students', 'courses']) assert.ok(fs.existsSync('app/(dashboard)/(routes)' + byKey[key] + '/page.tsx'), key);
 assert.equal(home.teacherNav.some(n => n.href === null), false);
 // Owner decision (DECISIONS.md, "Owner feedback on the New look"): this replaces hiding them. V1 needs them gone, each one by becoming a real link (V1.md).
 assert.deepEqual([...home.teacherNavSoon], ['homework', 'exams', 'reports']);
 assert.equal(home.teacherNav.some(n => home.teacherNavSoon.includes(n.key)), false, 'never both a link and Soon');
 assert.match(read('frontend/features/teacher-home/teacher-nav.tsx'), /teacherNavSoon\.map\(key => <span key=\{key\} role="link" aria-disabled="true"/);
 assert.doesNotMatch(read('middleware.ts') + read('shared/website-routes.ts'), /teacher\/analytics/, 'no legacy path is allow-listed');
});
test('locales: every teacher Home string exists in English and Arabic with the same placeholders, and the keys stay in sync', () => {
 assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.ar).sort());
 const keys = Object.keys(messages.en).filter(k => k.startsWith('th.'));
 assert.ok(keys.length >= 50);
 for (const k of keys) {
  assert.ok(messages.en[k].trim() && messages.ar[k].trim(), k);
  const holes = s => (s.match(/\{\w+\}/g) ?? []).sort().join();
  assert.equal(holes(messages.en[k]), holes(messages.ar[k]), k);
  assert.match(messages.ar[k], /[؀-ۿ]/, 'Arabic text is Arabic: ' + k);
 }
});
test('wording: no tenant, program or studio vocabulary reaches a teacher on these screens, in either language', () => {
 const forbidden = /organi[sz]ation|tenant|\bslug\b|program(me)?s?\b|\bstages?\b|\bmodules?\b|website studio|منظمة|مؤسسة|وحدة|برنامج|مرحلة/i;
 for (const k of Object.keys(messages.en).filter(k => k.startsWith('th.'))) { assert.doesNotMatch(messages.en[k], forbidden, k); assert.doesNotMatch(messages.ar[k], forbidden, k); }
 const shown = [...['home-view', 'courses-view', 'parts', 'create-course', 'teacher-nav'].map(f => read('frontend/features/teacher-home/' + f + '.tsx')), read('frontend/features/teacher-frame/teacher-frame.tsx')].join('\n')
  .replace(/organization_id|slug|courseSlug|Slug|staffOrganizationIds/g, '');
 assert.doesNotMatch(shown.replace(/\b(className|class)=("[^"]*"|\{[^}]*\})/g, ''), /Organization|Tenant|Website Studio|>\s*Program|Module/);
});
test('layout contract: greeting, numbers and hero, then a column for what needs you and what is coming beside a column of updates; a phone stacks that order; no courses and no homework card on Home', () => {
 const view = read('frontend/features/teacher-home/home-view.tsx');
 const home = view.slice(view.indexOf('export function TeacherHomeView'));
 assert.deepEqual([...home.matchAll(/<(PageHeader|Summary|NextSession|NeedsAttention|Homework|Updates|ComingUp|CoursesLink)\b/g)].map(m => m[1]), ['PageHeader', 'Summary', 'NextSession', 'NeedsAttention', 'ComingUp', 'Updates']);
 assert.doesNotMatch(view, /function Courses\(|<Courses|CourseCards/, 'a returning teacher has no big Courses card on Home');
 assert.doesNotMatch(view, /CoursesLink|data-home-courses-link|th\.courses\.title/, 'Home has no courses block and no Courses link');
 assert.match(view, /href=\{`\/teacher\/groups\/\$\{next\.groupId\}`\}/, 'Open group opens the teacher Group page'); assert.doesNotMatch(view, /<Link href="\/teacher\/groups"/, 'no All sessions button on the Next session card');
 assert.doesNotMatch(home, /CreateCourse/, 'no Create a course button in the Home header');
 assert.match(view, /<CreateCourse targets=\{data\.createTargets\} \/>/, 'the first-visit card keeps its Create a course step');
 assert.match(view, /data\.firstVisit\) return <FirstVisit/);
 assert.doesNotMatch(view, /EduLabsMark/, 'the mark belongs to the shell, not to the page');
 assert.doesNotMatch(view, /attendance.{0,20}month|th\.summary\.attendance/i, 'the attendance-this-month tile is left out: no existing read scopes attendance by month');
});
test('no new endpoint, migration or permission change was needed: only existing services are called', () => {
 const server = read('server/services/teacher-home.ts');
 assert.match(server, /groupService/); assert.match(server, /communicationService/); assert.match(server, /courseCapability/);
 assert.doesNotMatch(server, /\.rpc\(|\.from\(/, 'no new database access');
 assert.match(read('frontend/features/teacher-home/create-course.tsx'), /api\.post<[^>]*>\('\/api\/teacher\/courses'/);
});
test('render: the Courses page states and the section errors render accessible, honest markup', () => {
 const { LanguageProvider } = localization.language();
 const parts = localization.load('frontend/features/teacher-home/parts.tsx');
 const wrap = (language, el) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLanguage: language }, el));
 for (const language of ['en', 'ar']) {
  for (const status of [401, 403, 503, null]) {
   const html = wrap(language, React.createElement(parts.SectionError, { status, onRetry() {}, pending: false }));
   assert.match(html, /role="alert"/); assert.doesNotMatch(html, /undefined|\[object/);
   if (status === 401) assert.match(html, /href="\/sign-in"/); else if (status === 403) assert.doesNotMatch(html, /<button/); else assert.match(html, /<button/);
  }
  assert.match(wrap(language, React.createElement(parts.Empty, { id: 'th.courses.empty' })), /data-state="empty"/);
  assert.match(wrap(language, React.createElement(parts.StatusBadge, { status: 'draft' })), new RegExp(messages[language]['th.courses.draft']));
 }
});

test('frame: Help stays reachable for staff through the existing /support route, in both languages', () => {
 const frame = read('frontend/features/teacher-frame/teacher-frame.tsx');
 assert.match(frame, /const HELP = '\/support'/); assert.match(frame, /data-teacher-support/); assert.match(frame, /data-more-item="help"/);
 assert.equal(home.teacherNav.length, 4, 'four main links');
 assert.ok(messages.en['th.nav.help'] && messages.ar['th.nav.help'], 'Help label exists in en and ar');
 assert.equal(home.teacherNav.some(n => n.href === '/support'), false, 'Help is in the profile menu and in More, not in the main menu');
});

// ------------------------------------------------------------------ attendance on Home
test('happening now: only a started, not cancelled next session can take attendance; an upcoming one changes nothing', () => {
 const before = build({ upcoming: ok({ rows: [session(1, 1, 30)], page: 0 }) }).sessions.data.next;
 assert.equal(before.happening, false, 'before it starts nothing changes');
 const started = build({ upcoming: ok({ rows: [session(1, 1, -10)], page: 0 }) }).sessions.data.next;
 assert.equal(started.happening, true); assert.equal(started.id, uuid(201));
 const edge = build({ upcoming: ok({ rows: [session(1, 1, 0)], page: 0 }) }).sessions.data.next;
 assert.equal(edge.happening, true, 'now >= starts_at');
 assert.equal(build({ upcoming: ok({ rows: [session(1, 1, -10, { cancelled: true })], page: 0 }) }).sessions.data.next, null, 'a cancelled session is never next, so never happening now');
 assert.equal(build().sessions.data.comingUp.every(s => s.happening === false), true);
});
test('happening now: a finalized sheet is "taken" (edit link instead of Take attendance); a draft, even with marks, or a reopened one keeps Take attendance', () => {
 const state = attendance_state => build({ upcoming: ok({ rows: [session(1, 1, -10, { attendance_state })], page: 0 }) }).sessions.data.next;
 assert.equal(state('finalized').attendance, 'finalized'); assert.equal(state('finalized').happening, true);
 assert.equal(state('draft').attendance, 'draft'); assert.equal(state('reopened').attendance, 'reopened');
 const view = read('frontend/features/teacher-home/home-view.tsx');
 assert.ok(view.includes("const taken = now && next.attendance === 'finalized'"));
 assert.ok(view.includes('{now && !taken && <Link href={attendanceHref(next.groupId, next.id)} data-tour="take-attendance"'));
 assert.ok(view.includes('{taken && <p data-attendance-taken') && view.includes('<L id="th.next.taken" />'));
 assert.ok(view.includes('{taken && <Link href={attendanceHref(next.groupId, next.id)} data-edit-attendance') && view.includes('<L id="ta.edit" />'));
 assert.equal(messages.en['th.next.taken'], 'Attendance taken'); assert.equal(messages.ar['th.next.taken'], 'تم تسجيل الحضور'); assert.equal(messages.en['ta.edit'], 'Edit attendance'); assert.equal(messages.ar['ta.edit'], 'تعديل الحضور');
});
test('attendance changes ask the server-rendered pages again: finishing or reopening refreshes at once, saves are grouped into one refresh', () => {
 const code = read('frontend/features/teacher-attendance/attendance-view.tsx').replace(/\r\n/g, '\n');
 assert.ok(code.includes('router.refresh()'));
 assert.ok(/refreshServerViews\(true\);\n\s+setConfirming\(null\)/.test(code), 'finishing / reopening refreshes at once');
 assert.ok(/if \(!dirty\) refreshServerViews\(\);\n\s+if \(!alive\.current\) return;/.test(code), 'a finished save refreshes, even when the screen was left');
});
const plain = v => JSON.parse(JSON.stringify(v));
const past = (n, groupN, endedMinAgo, state = 'draft', extra = {}) => session(n, groupN, -endedMinAgo - 60, { attendance_state: state, ...extra });
test('unsaved attendance: every finished session of a Group the teacher manages that is not finalized (not only the latest one); newest first; at most three', () => {
 const rows = (g, list) => ({ groupId: uuid(g), rows: list });
 const out = build({ unsaved: ok([rows(1, [past(10, 1, 3000), past(11, 1, 600)]), rows(2, [past(12, 2, 120, 'finalized')]), rows(3, [past(13, 3, 90)])]),
  groups: ok({ rows: [group(1), group(2), group(3), group(4)], page: 0, hasMore: false }) }).unsaved;
 assert.equal(out.state, 'ready');
 assert.deepEqual(out.data.map(u => u.id), [uuid(213), uuid(211), uuid(210)], 'both unsaved classes of Group 1 are listed (the reviewer saw one of two), a finalized one is not, newest first');
 assert.deepEqual(Object.keys(out.data[0]).sort(), ['endsAt', 'groupId', 'groupName', 'id', 'startsAt', 'title']);
 assert.equal(out.data[0].groupName, 'Synthetic Group 3', 'newest first (ended 90 minutes ago, before the others ended 600 and 3000 ago)');
 assert.deepEqual(plain(out.data.filter(u => u.groupId === uuid(1)).map(u => u.id)), [uuid(211), uuid(210)]);
 const many = build({ unsaved: ok([1, 2, 3, 4].map(g => rows(g, [past(20 + g, g, 100 * g)]))), groups: ok({ rows: [group(1), group(2), group(3), group(4)], page: 0, hasMore: false }) }).unsaved;
 assert.equal(many.data.length, home.UNSAVED_LIMIT); assert.equal(home.UNSAVED_LIMIT, 3);
 assert.deepEqual(many.data.map(u => u.groupId), [uuid(1), uuid(2), uuid(3)], 'the three most recent');
 const reopened = build({ unsaved: ok([rows(1, [past(30, 1, 60, 'reopened')])]) }).unsaved;
 assert.equal(reopened.data.length, 1, 'a reopened list is not finalized');
 const cancelledOnly = build({ unsaved: ok([rows(1, [past(31, 1, 60, 'draft', { cancelled: true })])]) }).unsaved;
 assert.deepEqual(plain(cancelledOnly.data), [], 'a cancelled session has no attendance');
 const other = build({ unsaved: ok([rows(9, [past(32, 9, 60)])]) }).unsaved;
 assert.deepEqual(plain(other.data), [], 'a Group the teacher does not manage is never listed');
 const empty = build({ unsaved: ok([]) }).unsaved;
 assert.deepEqual(plain(empty), { state: 'ready', data: [] }, 'none: Home looks as today');
});
test('unsaved attendance: a failed read is an error, never "all clear"; without the read it is unavailable', () => {
 assert.deepEqual(plain(build({ unsaved: bad(503) }).unsaved), { state: 'error', status: 503 });
 assert.deepEqual(plain(build({ unsaved: undefined }).unsaved), { state: 'unavailable' });
 assert.equal(build({ groups: bad(500), unsaved: ok([]) }).unsaved.state, 'error');
 assert.equal(build({ unsaved: bad(503) }).sessions.state, 'ready', 'the rest of Home is unaffected');
});
test('Home view: Take attendance and the unsaved rows, with their tour targets and 44px or larger buttons', () => {
 const view = read('frontend/features/teacher-home/home-view.tsx');
 assert.match(view, /\{now && !taken && <Link href=\{attendanceHref\(next\.groupId, next\.id\)\} data-tour="take-attendance" data-take-attendance className=\{buttonClass\('primary'/, 'during a live class Take attendance is the primary button');
 assert.match(view, /data-open-group className=\{buttonClass\(now \? 'secondary' : 'primary'/, 'and Open group is the secondary one');
 assert.ok(view.indexOf('data-take-attendance') < view.indexOf('data-open-group'), 'Take attendance comes first');
 assert.match(view, /const now = next\.happening/); assert.match(view, /id=\{now \? 'th\.next\.now' : 'th\.next\.title'\}/);
 assert.match(view, /data-tour="next-session"/); assert.match(view, /data-tour="unsaved-attendance"/);
 assert.match(view, /<Link href=\{attendanceHref\(s\.groupId, s\.id\)\} data-unsaved-finish aria-label=\{t\([^\n]*?\)\} className=\{buttonClass\('attention', \{ size: 'lg' \}\)\}/);
 assert.match(view, /<ul className="d-list" data-tour="unsaved-attendance"[^>]*>/, 'the unsaved rows are in Needs attention');
 for (const k of ['th.next.now', 'th.next.attendance', 'th.coming.unsaved', 'th.coming.take_for']) { assert.ok(messages.en[k] && messages.ar[k], k); assert.match(messages.ar[k], /[؀-ۿ]/); }
 assert.equal(messages.en['th.next.attendance'], 'Take attendance'); assert.ok(!('th.coming.finish' in messages.en), 'a past class with unsaved attendance says Take attendance, not Finish');
 assert.match(view, /data-unsaved-finish aria-label=\{t\('th\.coming\.take_for', \{ group: s\.groupName \}\)\}[^>]*><L id="th\.next\.attendance" \/>/);
 const server = read('server/services/teacher-home.ts');
 assert.match(server, /service\.view<GroupSession>\(groupId, 'sessions'\)/, 'the existing per-Group sessions read, like a Group card');
 assert.match(server, /UNSAVED_GROUP_LIMIT/);
});
test('logo: one BrandLogo; the student shell keeps its plain logo, and in the teacher frame it is one link to the teacher Home on desktop and phone', () => {
 const logo = read('frontend/components/brand-logo.tsx'), sidebar = read('frontend/components/sidebar.tsx'), mobile = read('frontend/features/dashboard/mobile-sidebar.tsx'), frame = read('frontend/features/teacher-frame/teacher-frame.tsx');
 assert.match(logo, /font-display/); assert.doesNotMatch(logo + sidebar + mobile, /Times New Roman/);
 assert.match(logo, /aria-label=\{t\('navigation\.logo_home'\)\}/); assert.match(logo, /d-logo/);
 assert.equal((logo.match(/<Link\b/g) || []).length, 1, 'mark and wordmark sit inside ONE link');
 assert.match(sidebar, /<BrandLogo \/>/); assert.match(mobile, /<BrandLogo size="phone" \/>/);
 assert.equal((frame.match(/<BrandLogo href=\{teacherHomeHref\}/g) || []).length, 2, 'the sidebar and the phone header');
 assert.equal(home.teacherHomeHref, '/home'); assert.equal(home.teacherNav.find(n => n.key === 'home').href, home.teacherHomeHref, 'the logo and the Home menu item share one href');
 for (const id of ['en', 'ar']) assert.match(read(`frontend/locales/${id}.ts`), /"navigation\.logo_home":/);
});

// ------------------------------------------------------------------ Home numbers
test('summary: active Groups come from the Group read and students from the existing staff counts; a number that is not known is null, so its tile is left out', () => {
 const metrics = ok({ totalStudents: 41, pendingWaitlistCount: 3 });
 const full = build({ metrics });
 assert.equal(full.summary.activeGroups, 2); assert.equal(full.summary.students, 41); assert.equal(full.waiting.state, 'ready'); assert.equal(full.waiting.data.count, 3);
 assert.equal(build({ metrics: bad(503) }).summary.students, null); assert.equal(build({ metrics: bad(403) }).waiting.status, 403);
 assert.equal(build().waiting.state, 'unavailable');
 assert.equal(build({ groups: ok({ rows: [group(1)], page: 0, hasMore: true }) }).summary.activeGroups, null, 'a cut-off Group list is not a count');
 assert.equal(build({ groups: bad(500) }).summary.activeGroups, null);
 const server = read('server/services/teacher-home.ts');
 assert.match(server, /studentAdministration<HomeMetrics>\('metrics', \{\}\)/, 'the existing read');
 assert.doesNotMatch(server, /pendingHomework/, 'homework counts stay off Home');
});

test('sessions today: on the Cairo date, finished ones included, cancelled and other Groups out; any incomplete read means no number', () => {
 // 2030-03-04 10:00 UTC is 12:00 in Cairo (UTC+2)
 const rows = [session(1, 1, 30), session(2, 2, 120), session(3, 1, 13 * 60), session(4, 1, 60, { cancelled: true }), session(5, 9, 60)];
 const past = session(6, 1, -120), older = session(7, 1, -3 * 1440);
 const base = { upcoming: ok({ rows, page: 0 }), unsaved: ok([{ groupId: uuid(1), rows: [past, session(1, 1, 30), older], more: false }, { groupId: uuid(2), rows: [], more: false }]) };
 assert.equal(build(base).sessionsToday, 3, 'two coming, one finished; the 23:00-UTC one is tomorrow in Cairo');
 assert.equal(build({ ...base, upcoming: ok({ rows, page: 0, hasMore: true }) }).sessionsToday, null);
 assert.equal(build({ ...base, unsaved: bad(500) }).sessionsToday, null);
 assert.equal(build({ ...base, unsaved: undefined }).sessionsToday, null);
 assert.equal(build({ ...base, groups: ok({ rows: [group(1), group(2)], page: 0, hasMore: true }) }).sessionsToday, null);
 assert.equal(build({ ...base, unsaved: ok([{ groupId: uuid(1), rows: [past], more: true }]) }).sessionsToday, null, 'a cut-off page that did not reach before today');
 assert.equal(build({ ...base, unsaved: ok([{ groupId: uuid(1), rows: [past, older], more: true }]) }).sessionsToday, 3, 'one that did still answers for today');
 assert.equal(home.greetingKey(9), 'morning'); assert.equal(home.greetingKey(14), 'afternoon'); assert.equal(home.greetingKey(20), 'evening');
 assert.equal(home.cairoHour(NOW), 12);
 assert.equal(home.sessionsTodayKey(0), 'th.home.sessions_none'); assert.equal(home.sessionsTodayKey(1), 'th.home.sessions_one'); assert.equal(home.sessionsTodayKey(4), 'th.home.sessions_many');
});
