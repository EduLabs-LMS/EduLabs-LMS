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
test('homework to correct is never filled from the per-Group summary (that count is the viewer\'s own unsubmitted homework)', () => {
 assert.deepEqual(JSON.parse(JSON.stringify(build().homework)), { state: 'unavailable' });
 assert.deepEqual(JSON.parse(JSON.stringify(build({ groups: bad(503) }).homework)), { state: 'unavailable' });
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
test('navigation: exactly six destinations in order, for active staff of the Firebase build only', () => {
 assert.deepEqual([...home.teacherNav.map(n => n.key)], ['home', 'students', 'groups', 'homework', 'exams', 'reports']);
 assert.equal(home.showTeacherNav(true, [uuid(50)]), true);
 assert.equal(home.showTeacherNav(true, []), false, 'a student has no staff organizations');
 assert.equal(home.showTeacherNav(true, undefined), false); assert.equal(home.showTeacherNav(true, null), false);
 assert.equal(home.showTeacherNav(false, [uuid(50)]), false, 'the Clerk fallback keeps its own navigation');
 const active = path => [...home.teacherNav.filter(n => n.match(path)).map(n => n.key)];
 assert.deepEqual(active('/home'), ['home']); assert.deepEqual(active('/'), ['home']); assert.deepEqual(active('/teacher/groups'), ['groups']); assert.deepEqual(active('/teacher/groups/abc'), ['groups']);
 assert.deepEqual(active('/teacher/courses/abc'), [], 'Courses is not a main menu item any more'); assert.deepEqual(active('/teacher/settings/courses'), []); assert.deepEqual(active('/self-learning'), []);
 const sidebar = read('frontend/components/sidebar.tsx');
 assert.match(sidebar, /showTeacherNav\(isFirebaseStaging\(\), navigation\?\.staffOrganizationIds\)/); assert.match(sidebar, /teacherMode \? <TeacherNav/);
 assert.match(sidebar, /teacherMode \? <div data-teacher-footer[^>]*><TeacherProfile/, 'the teacher footer is the profile with the Settings cog');
 assert.equal((read('frontend/features/teacher-home/teacher-nav.tsx').match(/NotificationBell/g) ?? []).length, 0, 'no notification entry in the teacher menu');
 for (const n of home.teacherNav) assert.ok(messages.en['th.nav.' + n.key] && messages.ar['th.nav.' + n.key], n.key);
 assert.ok(messages.en['th.nav.soon'] && messages.ar['th.nav.soon']);
});
test('navigation: destinations without a new screen reach the existing neutral scaffold or existing page; a missing screen is a disabled Coming soon item, never a link', () => {
 const byKey = Object.fromEntries(home.teacherNav.map(n => [n.key, n.href]));
 for (const key of ['students', 'homework']) { const route = 'app/(dashboard)/(routes)' + byKey[key] + '/page.tsx'; assert.match(read(route), /TeacherFoundationPage/, key); }
 assert.equal(byKey.home, '/home'); assert.equal(byKey.groups, '/teacher/groups'); assert.equal(byKey.exams, '/exams');
 assert.equal(byKey.reports, null, 'Reports has no screen yet'); assert.deepEqual([...home.teacherNav.filter(n => n.href === null).map(n => n.key)], ['reports']);
 const nav = read('frontend/features/teacher-home/teacher-nav.tsx');
 assert.match(nav, /item\.href === null\) return <span[^>]*aria-disabled="true"[^>]*data-soon/); assert.match(nav, /<L id="th\.nav\.soon" \/>/);
 assert.doesNotMatch(read('middleware.ts') + read('shared/website-routes.ts'), /teacher\/analytics/, 'no legacy path is allow-listed for the disabled item');
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
 const shown = ['home-view', 'courses-view', 'parts', 'create-course', 'teacher-nav', 'teacher-profile'].map(f => read('frontend/features/teacher-home/' + f + '.tsx')).join('\n')
  .replace(/organization_id|slug|courseSlug|Slug/g, '');
 assert.doesNotMatch(shown.replace(/\b(className|class)=("[^"]*"|\{[^}]*\})/g, ''), /Organization|Tenant|Website Studio|>\s*Program|Module/);
});
test('layout contract: desktop has a day column and an inbox column; phone order is next session, homework, updates, coming up; no courses on Home', () => {
 const view = read('frontend/features/teacher-home/home-view.tsx');
 const home = view.slice(view.indexOf('export function TeacherHomeView'));
 assert.deepEqual([...home.matchAll(/^\s+<(NextSession|Homework|Updates|ComingUp|CoursesLink)\b/gm)].map(m => m[1]), ['NextSession', 'ComingUp', 'Homework', 'Updates'], 'desktop columns: day (next session, coming up), inbox (homework, updates)');
 const phone = [...home.matchAll(/<(NextSession|Homework|Updates|ComingUp|CoursesLink)\b[^>]*?\border-(\d) lg:order-none/g)].sort((x, y) => x[2] - y[2]).map(m => m[1]);
 assert.deepEqual(phone, ['NextSession', 'Homework', 'Updates', 'ComingUp']);
 assert.doesNotMatch(view, /function Courses\(|<Courses|CourseCards/, 'a returning teacher has no big Courses card on Home');
 assert.doesNotMatch(view, /CoursesLink|data-home-courses-link|th\.courses\.title/, 'Home has no courses block and no Courses link');
 assert.match(view, /href=\{`\/teacher\/groups\/\$\{next\.groupId\}`\}/, 'Open this Group opens the teacher Group page'); assert.match(view, /<Link href="\/teacher\/groups"/);
 assert.doesNotMatch(home, /CreateCourse/, 'no Create a course button in the Home header');
 assert.match(view, /<CreateCourse targets=\{data\.createTargets\} ink className="min-h-\[48px\]" \/>/, 'the first-visit card keeps its Create a course step');
 assert.match(view, /data\.firstVisit\) return <FirstVisit/);
 assert.doesNotMatch(view, /EduLabsMark/, 'the mark belongs to the shell, not to the page');
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

test('sidebar: Support stays reachable for staff through the existing /support route, in both languages', () => {
 const sidebar = read('frontend/components/sidebar.tsx');
 assert.match(sidebar, /teacherMode && <div data-teacher-support[\s\S]*?href="\/support"[\s\S]*?<L id="navigation\.support" \/>/);
 assert.equal(home.teacherNav.length, 6, 'six teacher links');
 assert.ok(messages.en['navigation.support'] && messages.ar['navigation.support'], 'Support label exists in en and ar');
 assert.equal(home.teacherNav.some(n => n.href === '/support'), false, 'Support is the footer entry, not one of the six');
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
const plain = v => JSON.parse(JSON.stringify(v));
const past = (n, groupN, endedMinAgo, state = 'draft', extra = {}) => session(n, groupN, -endedMinAgo - 60, { attendance_state: state, ...extra });
test('unsaved attendance: the latest finished session of a Group the teacher manages, unless finalized; newest first; at most three', () => {
 const rows = (g, list) => ({ groupId: uuid(g), rows: list });
 const out = build({ unsaved: ok([rows(1, [past(10, 1, 3000), past(11, 1, 600)]), rows(2, [past(12, 2, 120, 'finalized')]), rows(3, [past(13, 3, 90)])]),
  groups: ok({ rows: [group(1), group(2), group(3), group(4)], page: 0, hasMore: false }) }).unsaved;
 assert.equal(out.state, 'ready');
 assert.deepEqual(out.data.map(u => u.id), [uuid(211), uuid(213)].sort((a, b) => b === uuid(213) ? 1 : -1), 'only the latest finished session per Group; a finalized one is not listed');
 assert.deepEqual(Object.keys(out.data[0]).sort(), ['endsAt', 'groupId', 'groupName', 'id', 'startsAt', 'title']);
 assert.equal(out.data[0].groupName, 'Synthetic Group 3', 'newest first (ended 90 minutes ago, before the other one ended 600 ago)');
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
test('Home view: Take attendance and the unsaved rows, with their tour targets and 48px buttons', () => {
 const view = read('frontend/features/teacher-home/home-view.tsx');
 assert.match(view, /\{now && <Link href=\{attendanceHref\(next\.groupId, next\.id\)\} data-tour="take-attendance"/);
 assert.match(view, /const now = Boolean\(next\?\.happening\)/); assert.match(view, /id=\{now \? 'th\.next\.now' : 'th\.next\.title'\}/);
 assert.match(view, /data-tour="next-session"/); assert.match(view, /data-tour="unsaved-attendance"/);
 assert.match(view, /<Link href=\{attendanceHref\(s\.groupId, s\.id\)\} data-unsaved-finish className="[^"]*min-h-\[48px\][^"]*bg-amber-300/);
 assert.match(view, /<ul data-tour="unsaved-attendance"[^>]*>\{rows\.map/, 'at the top of Coming up, before the upcoming sessions');
 assert.ok(view.indexOf('data-unsaved-list') < view.indexOf('data.data.comingUp.map'));
 for (const k of ['th.next.now', 'th.next.attendance', 'th.coming.unsaved', 'th.coming.finish']) { assert.ok(messages.en[k] && messages.ar[k], k); assert.match(messages.ar[k], /[؀-ۿ]/); }
 assert.equal(messages.en['th.next.attendance'], 'Take attendance'); assert.equal(messages.en['th.coming.finish'], 'Finish');
 const server = read('server/services/teacher-home.ts');
 assert.match(server, /service\.view<GroupSession>\(groupId, 'sessions'\)/, 'the existing per-Group sessions read, like a Group card');
 assert.match(server, /UNSAVED_GROUP_LIMIT/);
});
