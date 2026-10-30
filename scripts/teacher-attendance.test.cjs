// Teacher Take attendance: the pure model, the REAL middleware, the commands it may call, tour targets, wording and locales.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
const localization = require('./localization-test-loader.cjs');
const { messages } = localization.load('frontend/locales/messages.ts');
const read = f => fs.readFileSync(f, 'utf8');

function load(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { module: m, exports: m.exports, URL, console, require: n => n === 'zod' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const contracts = load('shared/contracts/groups.ts');
const model = load('shared/teacher-attendance.ts');
const groups = load('shared/teacher-groups.ts', { '@/shared/contracts/groups': contracts });
const T = s => Date.parse(s);
const sess = (id, start, end, extra = {}) => ({ id, group_id: 'g', title: id, starts_at: start, ends_at: end, cancelled: false, version: 1, attendance_state: 'draft', mode: 'online', location: '', join_url: '', instructions: '', state: 'upcoming', ...extra });
const NOW = T('2026-10-29T12:00:00Z');
const id = '1234abcd-0000-4000-8000-00000000000f';

// ------------------------------------------------------------------ model
test('attendance: marks are exactly attended / absent / not_marked; an unknown value reads as not marked, never as present', () => {
 const marks = model.marksOf([{ user_id: 'a', status: 'attended' }, { user_id: 'b', status: 'absent' }, { user_id: 'c', status: 'not_marked' }, { user_id: 'd' }, { user_id: 'e', status: 'late' }, { user_id: 'f', status: 'excused' }]);
 assert.deepEqual({ ...marks }, { a: 'attended', b: 'absent', c: 'not_marked', d: 'not_marked', e: 'not_marked', f: 'not_marked' });
 assert.deepEqual({ ...model.countMarks(marks) }, { attended: 1, absent: 1, not_marked: 4 });
});
test('attendance: only what changed is sent; pressing the same mark again takes it back to not marked; Mark everyone present marks all', () => {
 const saved = { a: 'attended', b: 'not_marked', c: 'absent' };
 assert.deepEqual(model.changedMarks(saved, { ...saved }).length, 0);
 assert.deepEqual([...model.changedMarks(saved, { a: 'attended', b: 'absent', c: 'attended' }).map(m => ({ ...m }))], [{ userId: 'b', status: 'absent' }, { userId: 'c', status: 'attended' }]);
 assert.equal(model.toggled('attended', 'attended'), 'not_marked'); assert.equal(model.toggled('absent', 'attended'), 'attended'); assert.equal(model.toggled('not_marked', 'absent'), 'absent');
 assert.deepEqual({ ...model.allPresent(saved) }, { a: 'attended', b: 'attended', c: 'attended' });
});
test('attendance: a save never carries more than the 100 marks the database accepts in one call', () => {
 assert.equal(model.MARKS_PER_SAVE, 100);
 const parts = model.chunk(Array.from({ length: 250 }, (_, i) => i), model.MARKS_PER_SAVE);
 assert.deepEqual([...parts.map(p => p.length)], [100, 100, 50]); assert.equal(model.chunk([], 100).length, 0);
});
test('attendance: Session N counts live Sessions in time order, and is left out when it cannot be known', () => {
 const rows = [sess('c', '2026-10-22T10:00:00Z', '2026-10-22T11:00:00Z'), sess('a', '2026-10-08T10:00:00Z', '2026-10-08T11:00:00Z'), sess('x', '2026-10-15T10:00:00Z', '2026-10-15T11:00:00Z', { cancelled: true }), sess('b', '2026-10-16T10:00:00Z', '2026-10-16T11:00:00Z')];
 assert.deepEqual(['a', 'b', 'c'].map(s => model.sessionNumber(rows, true, s)), [1, 2, 3]);
 assert.equal(model.sessionNumber(rows, true, 'x'), null, 'a cancelled Session has no number');
 assert.equal(model.sessionNumber(rows, false, 'b'), null, 'a partial read never invents a number');
 assert.equal(model.sessionNumber(rows, true, 'missing'), null);
});
test('attendance: it opens once a Session has started; a cancelled Session has none; the reason to reopen needs 3 characters', () => {
 assert.equal(model.canTakeAttendance(sess('a', '2026-10-29T11:00:00Z', '2026-10-29T13:00:00Z'), NOW), true);
 assert.equal(model.canTakeAttendance(sess('a', '2026-10-29T13:00:00Z', '2026-10-29T14:00:00Z'), NOW), false);
 assert.equal(model.canTakeAttendance(sess('a', '2026-10-28T11:00:00Z', '2026-10-28T12:00:00Z', { cancelled: true }), NOW), false);
 assert.deepEqual(['', ' ab ', 'abc', ' abc '].map(model.reasonValid), [false, false, true, true]);
 assert.equal(model.attendanceHref('g1', 's1'), '/teacher/groups/g1/attendance/s1');
});
test('attendance: the "not saved" flag names the session it is about, so it can link to it', () => {
 const done = sess('d', '2026-10-27T10:00:00Z', '2026-10-27T11:00:00Z');
 assert.equal(groups.lastUnsavedSession([done], NOW).id, 'd');
 assert.equal(groups.lastUnsavedSession([{ ...done, attendance_state: 'finalized' }], NOW), null);
 assert.equal(groups.lastUnsavedSession([], NOW), null);
 assert.equal(groups.lastAttendanceUnsaved([done], NOW), true);
});

// ------------------------------------------------------------------ real middleware
test('middleware: the attendance page passes with Firebase staging on; lookalikes stay behind the catch-all', () => {
 class NextResponse { constructor(kind, status) { this.kind = kind; this.status = status; } static next() { return new NextResponse('next', 200); } static json(_, o) { return new NextResponse('json', o.status); } static redirect(u) { return new NextResponse('redirect:' + u.pathname, 307); } }
 const middleware = load('middleware.ts', {
  '@/shared/public-website': load('shared/public-website.ts', { zod: require('zod') }), '@/shared/website-routes': load('shared/website-routes.ts'),
  '@clerk/nextjs/server': { clerkMiddleware: () => () => assert.fail('the legacy handler must not run in Firebase staging'), createRouteMatcher: () => () => false },
  '@/shared/auth-config': { isFirebaseStaging: () => true }, 'next/server': { NextResponse },
 }).default;
 const run = path => middleware({ nextUrl: new URL('https://platform.example' + path), url: 'https://platform.example' + path }, {});
 assert.equal(run(`/teacher/groups/${id}/attendance/${id}`).kind, 'next');
 const refused = [`/teacher/groups/${id}/attendance`, `/teacher/groups/${id}/attendance/`, `/teacher/groups/${id}/attendance/not-a-uuid`, `/teacher/groups/${id}/attendance/${id}/`, `/teacher/groups/${id}/attendance/${id}/extra`,
  `/teacher/groups/${id}/Attendance/${id}`, `/teacher/groups/${id}//attendance/${id}`, `/teacher/groups/${id}/attendance/${id}.json`, `/teacher/groups/attendance/${id}`, `/teacher/attendance/${id}`, `/teacher/groups/${id}/attendance/${id}/finalize`];
 for (const path of refused) assert.equal(run(path).kind, 'redirect:/unavailable', path);
 assert.equal(run('/api/study-groups').kind, 'next', 'the one existing endpoint');
 assert.equal(run('/api/teacher/attendance').status, 503);
});

// ------------------------------------------------------------------ what the screen may call
const view = read('frontend/features/teacher-attendance/attendance-view.tsx');
test('attendance: only the existing Groups endpoint and only the existing commands (view, attendance, finalize, reopen); no new route or migration', () => {
 const files = view + read('frontend/features/teacher-groups/api.ts');
 assert.deepEqual([...new Set([...files.matchAll(/['"`](\/api\/[^'"`]*)['"`]/g)].map(m => m[1]))], ['/api/study-groups']);
 assert.doesNotMatch(view, /\bfetch\(/, 'every call goes through groupCall');
 assert.deepEqual([...new Set([...view.matchAll(/groupCall(?:<[^>]*>(?:\([^)]*\))?)?\('([a-z-]+)'/g)].map(m => m[1]))].sort(), ['attendance', 'finalize', 'reopen', 'view']);
 assert.doesNotMatch(view, /'(late|excused)'/, 'only present and absent exist');
 assert.match(view, /sessionVersion: session\.version/, 'a save sends the Session version it read');
 assert.match(view, /MARKS_PER_SAVE/);
});
test('attendance: the page needs both ids to be UUIDs and repeats the staff check; the route sits under the Group', () => {
 const page = read('app/(dashboard)/(routes)/teacher/groups/[groupId]/attendance/[sessionId]/page.tsx');
 assert.match(page, /!uuid\.test\(groupId\) \|\| !uuid\.test\(sessionId\)\) notFound\(\)/); assert.match(page, /await staffContext\(\)/);
 assert.match(page, /isFirebaseStaging\(\)\) return <TeacherFoundationPage/);
});
test('attendance: the Group page and the "not saved" flag link to it', () => {
 const groupView = read('frontend/features/teacher-groups/group-view.tsx');
 assert.match(groupView, /const opens = canTakeAttendance\(s, now\)/);
 assert.match(groupView, /\? <Link href=\{attendanceHref\(group\.id, s\.id\)\} data-attendance-link/, 'a started, not cancelled Session row is itself the link');
 assert.doesNotMatch(groupView, /canTakeAttendance\(s, now\) && <Link/, 'no separate Attendance link under the row any more');
 assert.match(groupView, /\{canCancel && state === 'upcoming' && <CancelSession/, 'cancel stays on upcoming Sessions only');
 assert.match(read('frontend/features/teacher-groups/list-view.tsx'), /<Link href=\{attendanceHref\(group\.id, unsaved\.id\)\} data-attendance-unsaved/);
});
test('attendance: the tour targets exist (not the tour itself)', () => {
 const all = view + read('frontend/features/teacher-helper/help-button.tsx');
 for (const target of ['help', 'status-bar', 'mark-all', 'student-rows', 'save-actions']) assert.ok(all.includes(`data-tour="${target}"`), target);
 assert.doesNotMatch(all, /driver\.js|intro\.js|shepherd|spotlight/i, 'the tour is not built here');
});
test('attendance: the controls are at least 48px tall', () => {
 for (const m of view.matchAll(/data-(?:finalize|reopen|mark-button|confirm-[a-z-]+|save-retry)[^>]*className=\{`([^`]*)`\}/g)) assert.match(m[1], /\$\{bigButton\}|\$\{pill\}/);
 assert.match(view, /const bigButton = 'min-h-\[48px\]/); assert.match(view, /const pill = 'inline-flex min-h-\[48px\]/);
 assert.match(view, /data-mark-all[\s\S]*?className=\{cn\(linkClass, 'min-h-\[48px\]'\)\}/);
 assert.match(view, /data-save-retry[\s\S]*?className=\{cn\(linkClass, 'min-h-\[48px\]'\)\}/);
});

// ------------------------------------------------------------------ wording and locales
test('locales: every ta.* and helper.* string exists in English and Arabic with the same placeholders', () => {
 assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.ar).sort());
 const keys = Object.keys(messages.en).filter(k => k.startsWith('ta.') || k.startsWith('helper.'));
 assert.ok(keys.length >= 35);
 for (const k of keys) {
  assert.ok(messages.en[k].trim() && messages.ar[k].trim(), k);
  const holes = s => (s.match(/\{\w+\}/g) ?? []).sort().join();
  assert.equal(holes(messages.en[k]), holes(messages.ar[k]), k);
  assert.match(messages.ar[k], /[؀-ۿ]/, 'Arabic text is Arabic: ' + k);
 }
 const want = { 'ta.present': 'Present', 'ta.absent': 'Absent', 'ta.not_marked': 'Not marked', 'ta.all_present': 'All present', 'ta.finish': 'Finish attendance', 'ta.edit': 'Edit attendance',
  'ta.saved_as_you_tap': 'Saved as you tap', 'ta.edit_needs_reason': 'Editing asks for a short reason', 'ta.finished': 'Finished', 'ta.count.present': '{count} present', 'ta.count.absent': '{count} absent',
  'ta.count.not_marked': '{count} not marked', 'ta.title': 'Session {number} · {title}', 'ta.save_failed': "Couldn't save." };
 for (const [k, v] of Object.entries(want)) assert.equal(messages.en[k], v, k);
 for (const k of ['ta.save', 'ta.saved', 'ta.mark_all', 'ta.finalize', 'ta.reopen', 'ta.state.draft', 'ta.unsaved_changes', 'ta.sheet.label']) assert.ok(!(k in messages.en) && !(k in messages.ar), 'retired string ' + k);
});
test('wording: no tenant, program or studio vocabulary reaches a teacher on the attendance screen, in either language', () => {
 const forbidden = /organi[sz]ation|tenant|\bslug\b|program(me)?s?\b|\bstages?\b|\bmodules?\b|\boffering|\brosters?\b|\benrol|\bmembership|website studio|منظمة|مؤسسة|وحدة|برنامج|مرحلة/i;
 for (const k of Object.keys(messages.en).filter(k => k.startsWith('ta.') || k.startsWith('helper.'))) { assert.doesNotMatch(messages.en[k], forbidden, k); assert.doesNotMatch(messages.ar[k], forbidden, k); }
});

// ------------------------------------------------------------------ flat screen, saved as you tap
test('autosave: no Save draft; every tap goes through one queue that always uses the latest Session version and never drops a mark', () => {
 assert.doesNotMatch(view, /data-save-draft|ta\.save'|'ta\.saved'|Save draft/, 'there is no Save draft button');
 assert.match(view, /function mark\(next: Marks\) \{[\s\S]*?marksRef\.current = next;[\s\S]*?void drain\(\);/, 'a tap updates the screen at once and starts the queue');
 assert.match(view, /if \(running\.current\) return;/, 'only one save runs at a time; taps made meanwhile are picked up by the same loop');
 assert.match(view, /for \(;;\) \{\s*const part = changedMarks\(savedRef\.current, marksRef\.current\)\.slice\(0, MARKS_PER_SAVE\);\s*if \(part\.length === 0\) break;/);
 assert.match(view, /sessionVersion: session\.version/); assert.match(view, /sessionRef\.current = head\.session/, 'the version is re-read after every save');
 assert.match(view, /savedRef\.current = \{ \.\.\.savedRef\.current, \.\.\.Object\.fromEntries\(part\.map/, 'only what the database accepted counts as saved');
 assert.match(view, /catch \(e\) \{\s*failed = true;[\s\S]*?setSaving\('error'\)/, 'a failed save keeps the marks on screen and says so');
 assert.match(view, /async function retry\(\) \{[\s\S]*?await refreshSession\(\)[\s\S]*?void drain\(\)/, 'retry first takes the current version');
 assert.match(view, /const finishBlocked = Boolean\(busy\) \|\| pending \|\| saving === 'saving' \|\| saveFailed/, 'Finish waits for every save');
 assert.match(view, /data-finalize disabled=\{finishBlocked\}/);
 assert.match(view, /addEventListener\('beforeunload'/, 'leaving with an unsaved mark asks first');
 for (const k of ['ta.saved_as_you_tap', 'ta.saving', 'ta.saved_now', 'ta.save_failed', 'ta.save_retry']) assert.ok(view.includes('"' + k + '"') || view.includes("'" + k + "'"), k);
});
test('finished view: the same screen, read-only; Edit attendance keeps the reason rule and stays instructor-only', () => {
 assert.match(view, /<StudentRow [^>]*editable=\{editable\}/, 'the same rows; only the controls change');
 assert.match(view, /const editable = Boolean\(value\) && !locked && !cancelled/);
 assert.match(view, /mark === 'not_marked'\s*\? <p data-mark-text[^>]*><L id="ta\.not_marked" \/>/, '"Not marked" is plain text');
 assert.match(view, /\{locked && <><span data-finished>/, 'counts line starts with Finished');
 assert.match(view, /!confirming && locked && instructor && <button type="button" data-reopen/);
 assert.match(view, /groupCall\('reopen', groupId, \{ sessionId, sessionVersion: session\.version, reason: reason\.trim\(\) \}\)/);
 assert.match(view, /if \(kind === 'reopen' && !reasonValid\(reason\)\)/);
 assert.match(view, /data-confirm-finalize[\s\S]*?data-unmarked-warning/, 'Finish asks first and warns about unmarked students');
 assert.doesNotMatch(view, /bg-amber|border-\[2\.5px\]|shadow-hard|rounded-\[24px\]/, 'no boxed cards and no yellow status bar');
});
