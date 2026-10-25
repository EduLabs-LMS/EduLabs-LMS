const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript'), React = require('react'), crypto = require('node:crypto');
const { renderToStaticMarkup } = require('react-dom/server');
const localization = require('./localization-test-loader.cjs');
function load(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { module: m, exports: m.exports, URL, Buffer, console, require: n => n === 'react/jsx-runtime' || n === 'zod' || n === 'node:crypto' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const read = f => fs.readFileSync(f, 'utf8');
const code = f => read(f).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const contract = load('shared/contracts/platform-provisioning.ts');
const draftLib = load('frontend/lib/provisioning-draft.ts', { '@/shared/contracts/platform-provisioning': contract });

const request = () => ({
 teacherEmail: 'Teacher@Example.Test', expiresInDays: 7,
 systems: [{ label: 'IGCSE', examinationBoard: 'Cambridge', grades: [{ key: 'g1', label: 'Grade 10' }, { key: 'g2', label: 'Grade 11' }] }, { label: 'American Diploma', grades: [{ key: 'g3', label: 'Grade 12' }] }],
 subjects: [{ key: 's1', label: 'Physics' }, { key: 's2', label: 'Chemistry' }],
 course: { title: 'Physics 10', gradeKey: 'g1', subjectKey: 's1' },
});
const parse = value => contract.provisionTeacherRequest.safeParse(value);

test('contract: a complete request is accepted and normalized; the board stays optional', () => {
 const out = parse(request()); assert.ok(out.success);
 assert.equal(out.data.teacherEmail, 'teacher@example.test'); assert.equal(out.data.systems[1].examinationBoard, null);
 assert.ok(parse({ ...request(), expiresInDays: 30 }).success);
});
test('contract: rejects mass assignment, tenant selection, owner grants and malformed values', () => {
 const base = request();
 const bad = [
  { ...base, organizationId: uuid(1) }, { ...base, role: 'owner' }, { ...base, ownerUserId: uuid(2) }, { ...base, displayName: 'Mr X' }, { ...base, domain: 'x.example' },
  { ...base, teacherEmail: 'nope' }, { ...base, teacherEmail: '' }, { ...base, teacherEmail: 'a@b' }, { ...base, expiresInDays: 2 }, { ...base, expiresInDays: '7' }, { ...base, expiresInDays: 365 },
  { ...base, systems: [] }, { ...base, subjects: [] }, { ...base, systems: [{ label: 'X', grades: [] }] },
  { ...base, systems: Array.from({ length: 6 }, (_, n) => ({ label: 'S' + n, grades: [{ key: 'k' + n, label: 'G' }] })) },
  { ...base, subjects: Array.from({ length: 21 }, (_, n) => ({ key: 's' + n, label: 'Sub' + n })) },
  { ...base, systems: [{ label: 'IGCSE', grades: [{ key: 'g1', label: 'A' }] }, { label: 'igcse', grades: [{ key: 'g2', label: 'B' }] }], course: { title: 'x', gradeKey: 'g1', subjectKey: 's1' } },
  { ...base, subjects: [{ key: 's1', label: 'Physics' }, { key: 's2', label: 'physics' }] },
  { ...base, subjects: [{ key: 's1', label: 'Physics' }, { key: 's1', label: 'Maths' }] },
  { ...base, systems: [{ label: 'IGCSE', grades: [{ key: 'g1', label: 'Grade 10' }, { key: 'g2', label: 'grade 10' }] }] },
  { ...base, course: { title: 'Physics', gradeKey: 'zz', subjectKey: 's1' } }, { ...base, course: { title: 'Physics', gradeKey: 'g1', subjectKey: 'zz' } },
  { ...base, course: { title: '', gradeKey: 'g1', subjectKey: 's1' } }, { ...base, course: { ...base.course, chapters: [] } }, { ...base, course: { ...base.course, students: [] } },
  { ...base, systems: [{ label: 'x'.repeat(161), grades: [{ key: 'g1', label: 'A' }] }] }, { ...base, systems: [{ label: 'Bell\u0007', grades: [{ key: 'g1', label: 'A' }] }] },
  { ...base, systems: [{ label: 'IGCSE', examinationBoard: 'x'.repeat(121), grades: [{ key: 'g1', label: 'A' }] }] },
  { ...base, systems: [{ label: 'IGCSE', grades: [{ key: 'Bad Key', label: 'A' }] }] }, { ...base, systems: [{ label: 'IGCSE', grades: [{ key: 'g1', label: 'A', status: 'archived' }] }] },
 ];
 for (const value of bad) assert.equal(parse(value).success, false, JSON.stringify(value).slice(0, 140));
});
test('contract: portal actions and acceptance accept only their own closed shapes', () => {
 assert.ok(contract.portalAction.safeParse({ action: 'revoke' }).success);
 assert.ok(contract.portalAction.safeParse({ action: 'reissue', expiresInDays: 3 }).success);
 assert.ok(contract.portalAction.safeParse({ action: 'reissue', expiresInDays: 3, teacherEmail: 'T@Example.test' }).success);
 for (const bad of [{ action: 'delete' }, { action: 'revoke', organizationId: uuid(1) }, { action: 'reissue' }, { action: 'reissue', expiresInDays: 9 }, { action: 'accept', token: 'x' }]) assert.equal(contract.portalAction.safeParse(bad).success, false);
 const token = crypto.randomBytes(32).toString('base64url');
 assert.ok(contract.acceptInvitationRequest.safeParse({ token }).success);
 for (const bad of [{ token: 'short' }, { token: token + 'x' }, { token, organizationId: uuid(1) }, { token, role: 'owner' }, {}, { token: token.slice(0, 42) + '!' }]) assert.equal(contract.acceptInvitationRequest.safeParse(bad).success, false);
});

test('draft: inline creation never discards earlier entries and selects the new item', () => {
 const lib = draftLib;
 let d = lib.emptyDraft();
 d = lib.updateSystem(d, 'sys-1', { label: 'IGCSE', board: 'Cambridge' }); d = { ...d, email: 'a@b.test' };
 let out = lib.addGrade(d, 'sys-1', '  Grade   10 '); d = out.draft; assert.ok(out.key);
 assert.equal(d.systems[0].grades[0].label, 'Grade 10');
 out = lib.addSubject(d, 'Physics'); d = out.draft; const subjectKey = out.key; d = { ...d, courseTitle: 'Physics 10', courseTitleTouched: true, courseGradeKey: d.systems[0].grades[0].key, courseSubjectKey: subjectKey };
 const before = JSON.stringify(d);
 // a missing grade level is added from the course section: all earlier values survive and the new one is chosen
 const late = lib.addGrade(d, 'sys-1', 'Grade 11'); d = { ...late.draft, courseGradeKey: late.key };
 assert.equal(d.email, 'a@b.test'); assert.equal(d.systems[0].board, 'Cambridge'); assert.equal(d.courseTitle, 'Physics 10'); assert.equal(d.courseSubjectKey, subjectKey);
 assert.deepEqual([...d.systems[0].grades.map(g => g.label)], ['Grade 10', 'Grade 11']); assert.equal(d.courseGradeKey, late.key);
 assert.notEqual(JSON.stringify(d), before);
 const system = lib.addSystem(d); assert.equal(system.systems.length, 2); assert.equal(system.systems[0].grades.length, 2);
 assert.equal(new Set(system.systems.map(s => s.id)).size, 2);
 assert.equal(lib.addSubject(d, 'physics').key, null, 'duplicate subject (case-insensitive) is refused'); assert.equal(lib.addGrade(d, 'sys-1', 'grade 10').key, null); assert.equal(lib.addGrade(d, 'sys-1', '   ').key, null);
 assert.equal(lib.addGrade(d, 'missing-system', 'X').key, null);
});
test('draft: the course title is suggested from subject and grade with a plain hyphen and never overwrites a customised title', () => {
 const lib = draftLib;
 let d = lib.updateSystem(lib.emptyDraft(), 'sys-1', { label: 'IGCSE' });
 const g = lib.addGrade(d, 'sys-1', 'Grade 10'); d = g.draft; const sub = lib.addSubject(d, 'Physics'); d = sub.draft;
 assert.equal(d.courseTitle, '', 'nothing is suggested until both are chosen');
 d = lib.chooseCourse(d, { courseSubjectKey: sub.key }); assert.equal(d.courseTitle, '');
 d = lib.chooseCourse(d, { courseGradeKey: g.key }); assert.equal(d.courseTitle, 'Physics - Grade 10'); assert.doesNotMatch(d.courseTitle, /[\u2013\u2014]/);
 const g2 = lib.addGrade(d, 'sys-1', 'Grade 11'); d = lib.chooseCourse(g2.draft, { courseGradeKey: g2.key }); assert.equal(d.courseTitle, 'Physics - Grade 11', 'an untouched suggestion follows later choices');
 const sub2 = lib.addSubject(d, 'Chemistry'); d = lib.chooseCourse(sub2.draft, { courseSubjectKey: sub2.key }); assert.equal(d.courseTitle, 'Chemistry - Grade 11');
 // a customised title is kept through every later change
 d = lib.setCourseTitle(d, 'Year 11 Chemistry Lab'); assert.equal(d.courseTitleTouched, true);
 d = lib.chooseCourse(d, { courseSubjectKey: sub.key }); assert.equal(d.courseTitle, 'Year 11 Chemistry Lab');
 d = lib.chooseCourse(d, { courseGradeKey: g.key }); assert.equal(d.courseTitle, 'Year 11 Chemistry Lab');
 d = lib.removeSubject(d, sub2.key); d = lib.addGrade(d, 'sys-1', 'Grade 12').draft; assert.equal(d.courseTitle, 'Year 11 Chemistry Lab');
 // clearing the field hands control back to the suggestion
 d = lib.setCourseTitle(d, ''); assert.equal(d.courseTitleTouched, false); assert.equal(d.courseTitle, 'Physics - Grade 10');
 // removing the selected item empties an untouched suggestion rather than leaving a stale one
 assert.equal(lib.removeGrade(d, g.key).courseTitle, '');
 assert.equal(lib.suggestCourseTitle(lib.emptyDraft()), '');
 // the suggestion satisfies validation like a typed title
 const typed = lib.updateSystem(d, 'sys-1', { label: 'IGCSE' }); assert.equal(lib.validateDraft({ ...typed, email: 'a@b.test' })['course.title'], undefined);
});
test('draft: advanced options keep their values and errors even when collapsed', () => {
 const lib = draftLib;
 let d = lib.updateSystem(lib.emptyDraft(), 'sys-1', { label: 'A', board: 'x'.repeat(130) }); d = { ...d, email: 'a@b.test' };
 assert.equal(lib.validateDraft(d)['system.0.board'], 'board_long', 'a hidden board value is still validated');
 const src = read('frontend/features/platform-admin/provision-form.tsx');
 assert.match(src, /system\.board\.trim\(\) !== '' \|\| Boolean\(boardError\)/, 'the board section re-opens for a value or an error');
 assert.match(src, /settingsOpen \|\| Boolean\(errors\.lifetime\)/, 'the invitation settings re-open for an error');
 assert.equal(lib.updateSystem(d, 'sys-1', { board: '' }).email, 'a@b.test');
});
test('wizard: every error belongs to one step; a step opens only when every earlier step is valid', () => {
 const lib = draftLib; let d = lib.emptyDraft();
 assert.deepEqual([...lib.wizardStepIds], ['teacher', 'education', 'subjects', 'course']);
 const all = lib.validateDraft(d); for (const key of Object.keys(all)) assert.ok([0, 1, 2, 3].includes(lib.stepOfError(key)), key);
 assert.deepEqual(Object.keys(lib.validateStep(d, 0)), ['email']); assert.ok(Object.keys(lib.validateStep(d, 1)).every(k => k.startsWith('system')));
 assert.deepEqual(Object.keys(lib.validateStep(d, 2)), ['subjects']); assert.deepEqual(Object.keys(lib.validateStep(d, 3)).sort(), ['course.grade', 'course.subject', 'course.title']);
 assert.deepEqual([...lib.stepValidity(d)], [false, false, false, false]);
 assert.equal(lib.canVisitStep(d, 0, 0), true); assert.equal(lib.canVisitStep(d, 0, 1), false, 'cannot skip an invalid teacher step'); assert.equal(lib.canVisitStep(d, 0, 3), false);
 d = { ...d, email: 'a@b.test' }; assert.equal(lib.canVisitStep(d, 0, 1), true); assert.equal(lib.canVisitStep(d, 0, 2), false, 'education is still invalid');
 d = lib.updateSystem(d, 'sys-1', { label: 'IGCSE' }); const g = lib.addGrade(d, 'sys-1', 'Grade 10'); d = g.draft; assert.equal(lib.canVisitStep(d, 0, 2), true); assert.equal(lib.canVisitStep(d, 0, 3), false, 'subjects missing');
 const s = lib.addSubject(d, 'Physics'); d = lib.chooseCourse(s.draft, { courseGradeKey: g.key, courseSubjectKey: s.key });
 assert.deepEqual([...lib.stepValidity(d)], [true, true, true, true]); assert.equal(lib.canVisitStep(d, 0, 3), true);
 // going back never loses anything, and an earlier step may always be reopened
 assert.equal(lib.canVisitStep(lib.emptyDraft(), 3, 0), true);
 // breaking an earlier step later closes the door to the later ones again
 assert.equal(lib.canVisitStep(lib.removeGrade(d, g.key), 1, 3), false);
});
test('stepper: a reusable design-system component with text-free points, named steps and a current marker', () => {
 const { Stepper } = localization.load('frontend/design-system/index.tsx');
 const props = { label: 'Progress', steps: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }, { id: 'c', label: 'Three' }], current: 1, completed: [true, false, false], canVisit: i => i <= 1, onSelect() {}, stateLabels: { completed: 'done', current: 'now', upcoming: 'later' } };
 const html = render(React.createElement(Stepper, props));
 assert.match(html, /<nav[^>]*aria-label="Progress"/); assert.equal((html.match(/<li /g) || []).length, 3);
 assert.equal((html.match(/aria-current="step"/g) || []).length, 1); assert.match(html, /data-state="completed"/); assert.match(html, /data-state="upcoming"/);
 assert.equal((html.match(/aria-disabled/g) || []).length, 1, 'only the blocked step is aria-disabled');
 assert.match(html, /One<span class="eds-sr">, done/); assert.match(html, /Three<span class="eds-sr">, later/);
 assert.match(html, /<span class="eds-stepper-point" aria-hidden="true"><\/span>/, 'points contain no text or numbers');
 assert.doesNotMatch(render(React.createElement(Stepper, { ...props, current: null })), /aria-current/, 'no current step during a review');
 const css = read('frontend/design-system/components.css'); assert.match(css, /inset-inline-start: -50%/, 'the connector is direction-agnostic'); assert.match(css, /prefers-reduced-motion: reduce\) \{ \.eds-step-panel \{ animation: none/);
});
test('layout: screens choose a Page variant instead of hard-coding width; the shell neither narrows nor centers content', () => {
 const { Page, Segmented } = localization.load('frontend/design-system/index.tsx');
 for (const layout of ['focused', 'regular', 'wide', 'fluid']) assert.match(render(React.createElement(Page, { layout }, 'x')), new RegExp('<div class="eds-page" data-layout="' + layout + '">x</div>'));
 const css = read('frontend/design-system/components.css'), tokens = read('frontend/design-system/tokens.css'), admin = read('frontend/styles/platform-admin.css');
 assert.match(css, /\.eds-page \{[^}]*margin-inline: auto/, 'the container centers itself'); for (const v of ['focused', 'regular', 'wide']) assert.match(tokens, new RegExp('--eds-page-' + v + ':'));
 assert.doesNotMatch(admin, /max-width: var\(--eds-(content|form)-width\)|\.pa-narrow/, 'no per-screen widths in the admin stylesheet'); assert.doesNotMatch(admin, /margin-(left|inline-start)\s*:\s*[1-9]/);
 const expected = { 'provision-form': 'focused', 'teachers-view': 'wide', 'portal-view': 'wide', 'settings-view': 'regular' };
 for (const [file, layout] of Object.entries(expected)) assert.match(read('frontend/features/platform-admin/' + file + '.tsx'), new RegExp('<Page layout="' + layout + '">'), file);
 const html = render(React.createElement(Segmented, { label: 'Pick', value: 'b', onChange() {}, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }));
 assert.match(html, /role="radiogroup"/); assert.equal((html.match(/role="radio"/g) || []).length, 2); assert.equal((html.match(/tabindex="0"/g) || []).length, 1, 'one tab stop'); assert.match(html, /aria-checked="true"[^>]*>B</);
});
test('settings: language and appearance live on a Settings page; the shell header carries no preference controls', () => {
 const shell = read('frontend/features/platform-admin/shell.tsx');
 assert.doesNotMatch(shell, /setLanguage|setTheme|useTheme|pa-segment/, 'no language or theme controls in the shell'); assert.match(shell, /\/platform-admin\/settings/);
 const sidebar = shell.slice(shell.indexOf('pa-sidebar-foot')); assert.match(sidebar, /pa\.nav\.settings/, 'Settings is in the sidebar footer, near the bottom');
 const settings = read('frontend/features/platform-admin/settings-view.tsx');
 assert.match(settings, /setLanguage/); assert.match(settings, /setTheme|onChange=\{setTheme\}/); assert.doesNotMatch(settings, /supabase|fetch\(|\/api\//i, 'preferences use the existing browser-local infrastructure, no server table');
 assert.match(settings, /pa\.settings\.local_note/, 'does not claim cross-device sync');
 const { messages } = localization.load('frontend/locales/messages.ts'); assert.doesNotMatch(messages.en['pa.settings.local_note'], /sync(?!hronized)/i); assert.match(messages.en['pa.settings.local_note'], /not synchronized/);
 const { SettingsView } = view('settings-view');
 const html = render(React.createElement(SettingsView));
 assert.match(html, /role="radiogroup"[^>]*aria-label="Language"/); assert.match(html, /aria-label="Appearance"/); assert.match(html, />العربية</); assert.match(html, />English</);
 assert.match(render(React.createElement(SettingsView), 'ar'), /الإعدادات/);
 assert.doesNotMatch(html, /coming soon|placeholder|notifications/i, 'no fake future sections');
});
test('draft: removing a grade, subject or system clears only a dependent course choice', () => {
 const lib = draftLib;
 let d = lib.updateSystem(lib.emptyDraft(), 'sys-1', { label: 'A' }); const g = lib.addGrade(d, 'sys-1', 'G1'); d = g.draft; const s = lib.addSubject(d, 'S1'); d = { ...s.draft, courseGradeKey: g.key, courseSubjectKey: s.key, courseTitle: 'T' };
 assert.equal(lib.removeGrade(d, g.key).courseGradeKey, ''); assert.equal(lib.removeGrade(d, g.key).courseSubjectKey, s.key);
 assert.equal(lib.removeSubject(d, s.key).courseSubjectKey, ''); assert.equal(lib.removeSubject(d, s.key).courseGradeKey, g.key);
 assert.equal(lib.removeSystem(d, 'sys-1').systems.length, 1, 'the last system cannot be removed');
 const two = lib.addSystem(d); assert.equal(lib.removeSystem(two, 'sys-1').courseGradeKey, ''); assert.equal(lib.removeSystem(two, 'sys-1').systems.length, 1);
});
test('draft: validation reports each problem by field; a valid draft becomes the exact request', () => {
 const lib = draftLib;
 const empty = lib.validateDraft(lib.emptyDraft());
 for (const key of ['email', 'system.0', 'system.0.grades', 'subjects', 'course.title', 'course.grade', 'course.subject']) assert.ok(empty[key], key);
 assert.equal(lib.toRequest(lib.emptyDraft()), null);
 assert.equal(lib.validateDraft({ ...lib.emptyDraft(), email: 'bad' }).email, 'email_invalid');
 let d = lib.updateSystem(lib.emptyDraft(), 'sys-1', { label: 'IGCSE', board: 'x'.repeat(121) }); assert.equal(lib.validateDraft(d)['system.0.board'], 'board_long');
 d = lib.addSystem(lib.updateSystem(lib.emptyDraft(), 'sys-1', { label: 'IGCSE' })); d = lib.updateSystem(d, 'sys-2', { label: ' igcse ' }); assert.equal(lib.validateDraft(d)['system.1'], 'duplicate');
 const g = lib.addGrade(lib.updateSystem(lib.emptyDraft(), 'sys-1', { label: 'IGCSE', board: ' Cambridge ' }), 'sys-1', 'Grade 10'); const s = lib.addSubject(g.draft, 'Physics');
 const ok = { ...s.draft, email: ' Teacher@Example.test ', courseTitle: ' Physics 10 ', courseGradeKey: g.key, courseSubjectKey: s.key };
 assert.deepEqual(JSON.parse(JSON.stringify(lib.validateDraft(ok))), {});
 const req = lib.toRequest(ok); assert.ok(req); assert.equal(req.teacherEmail, 'teacher@example.test'); assert.equal(req.systems[0].examinationBoard, 'Cambridge'); assert.equal(req.course.title, 'Physics 10');
 assert.deepEqual(Object.keys(req).sort(), ['course', 'expiresInDays', 'subjects', 'systems', 'teacherEmail']);
 assert.equal(lib.isDirty(lib.emptyDraft()), false); assert.equal(lib.isDirty(ok), true);
});

function service(rpc = async () => ({ data: { organizationId: uuid(1), invitationId: uuid(2), courseId: uuid(3), expiresAt: '2030-01-01T00:00:00Z' }, error: null })) {
 const calls = [];
 const client = { rpc: async (name, args) => { calls.push({ name, args }); return rpc(name, args); } };
 return { ...load('server/services/platform-provisioning.ts', { 'server-only': {}, 'node:crypto': crypto }), client, calls };
}
test('service: the secret is generated on the server, only its SHA-256 reaches the database, and it is returned once', async () => {
 const s = service(); const svc = s.platformProvisioningService(s.client);
 const out = await svc.provision(parse(request()).data);
 assert.match(out.invitationSecret, /^[A-Za-z0-9_-]{43}$/); assert.equal(out.delivery, 'not_sent');
 assert.equal(s.calls.length, 1); assert.equal(s.calls[0].name, 'platform_provision_teacher');
 assert.equal(s.calls[0].args.p_token_hash, crypto.createHash('sha256').update(out.invitationSecret).digest('hex'));
 assert.doesNotMatch(JSON.stringify(s.calls), new RegExp(out.invitationSecret), 'the raw secret never reaches the database call');
 const next = await svc.provision(parse(request()).data); assert.notEqual(next.invitationSecret, out.invitationSecret);
 const re = await svc.reissue(uuid(1), 3); assert.equal(re.delivery, 'not_sent');
 assert.deepEqual(Object.keys(s.calls.at(-1).args).sort(), ['p_expires_in_days', 'p_organization_id', 'p_token_hash']);
 await svc.reissue(uuid(1), 3, 'new@example.test'); assert.equal(s.calls.at(-1).args.p_email, 'new@example.test');
 assert.doesNotMatch(JSON.stringify(s.calls.at(-1).args), new RegExp(re.invitationSecret));
});
test('service and HTTP code never log, so the secret cannot leak into logs', () => {
 assert.doesNotMatch(code('server/services/platform-provisioning.ts') + code('server/http/platform-admin-portals.ts'), /console\./);
});
test('service: database failures become safe, localizable outcomes', async () => {
 for (const [errCode, message, status, reason] of [
  ['42501', 'Platform administration denied', 403, 'forbidden'], ['PT404', 'Portal not found', 404, 'not_found'], ['PT409', 'Invitation already used', 409, 'used'], ['PT410', 'Invitation expired', 410, 'gone'],
  ['23505', 'A pending invitation already exists for this email', 409, 'pending_exists'], ['23505', 'Duplicate subject', 409, 'duplicate'], ['22023', 'Course title is invalid', 400, 'invalid'],
  ['XX000', 'relation "private.teacher_invitations" does not exist', 503, 'unavailable'],
 ]) {
  const s = service(async () => ({ data: null, error: { code: errCode, message } }));
  await assert.rejects(s.platformProvisioningService(s.client).provision(parse(request()).data), e => e.status === status && e.reason === reason && !/relation|private\.|Course title/.test(e.message), errCode + ' ' + message);
 }
 const s = service(async () => ({ data: null, error: null }));
 await assert.rejects(s.platformProvisioningService(s.client).overview(), e => e.status === 503);
 await assert.rejects(s.platformProvisioningService(s.client).detail(uuid(1)), e => e.status === 503);
});
test('service: acceptance hashes the presented secret and sends nothing else', async () => {
 const s = service(async () => ({ data: { organizationId: uuid(5) }, error: null }));
 const token = crypto.randomBytes(32).toString('base64url');
 assert.deepEqual(JSON.parse(JSON.stringify(await s.acceptTeacherInvitation(s.client, token))), { organizationId: uuid(5) });
 assert.deepEqual(JSON.parse(JSON.stringify(s.calls)), [{ name: 'accept_teacher_invitation', args: { p_token_hash: crypto.createHash('sha256').update(token).digest('hex') } }]);
});

function access(options = {}) {
 const { mode = true, viewer = { id: uuid(1), backend: 'firebase' }, rpc = { data: true, error: null } } = options, calls = [];
 const client = { rpc: async name => { calls.push(name); return rpc; } };
 const mod = load('server/services/platform-admin.ts', {
  'server-only': {}, 'next/navigation': { redirect: p => { throw Error('redirect:' + p); }, notFound: () => { throw Error('notFound'); } },
  '@/shared/auth-config': { isFirebaseStaging: () => mode }, '@/server/services/application-auth': { getApplicationViewer: async () => viewer },
  '@/server/integrations/supabase': { getSupabaseServerClient: async () => client },
 });
 return { ...mod, calls };
}
test('platform-admin access fails closed for every non-administrator and asks only the database', async () => {
 assert.equal((await access({ mode: false }).getPlatformAdminAccess()).status, 'unavailable');
 assert.equal((await access({ viewer: null }).getPlatformAdminAccess()).status, 'anonymous');
 assert.equal((await access({ viewer: { id: 'u', backend: 'clerk' } }).getPlatformAdminAccess()).status, 'anonymous');
 for (const data of [false, null, 'true', 1, undefined]) assert.equal((await access({ rpc: { data, error: null } }).getPlatformAdminAccess()).status, 'forbidden', String(data));
 await assert.rejects(access({ rpc: { data: null, error: { code: 'XX000' } } }).getPlatformAdminAccess(), /Unable to verify/);
 for (const code of ['PGRST202', '42883']) assert.equal((await access({ rpc: { data: null, error: { code } } }).getPlatformAdminAccess()).status, 'unavailable', 'migration not applied yet: ' + code);
 const ok = access(); assert.equal((await ok.getPlatformAdminAccess()).status, 'ok'); assert.deepEqual(ok.calls, ['is_platform_admin']);
 await assert.rejects(access({ viewer: null }).requirePlatformAdmin(), /redirect:\/sign-in/);
 await assert.rejects(access({ rpc: { data: false, error: null } }).requirePlatformAdmin(), /notFound/);
});

function handlers({ status = 'ok', origin = true, staging = true, viewer = { backend: 'firebase' }, svc = {}, accept } = {}) {
 const calls = [];
 class Response { constructor(body, init) { this.body = body; this.status = init?.status ?? 200; this.headers = init?.headers ?? {}; } }
 const service = {
  provision: async input => { calls.push(['provision', input]); return { organizationId: uuid(1), invitationSecret: 'S'.repeat(43), delivery: 'not_sent' }; },
  reissue: async (...a) => { calls.push(['reissue', ...a]); return { invitationSecret: 'R'.repeat(43) }; },
  revoke: async id => { calls.push(['revoke', id]); return { organizationId: id }; },
  overview: async () => { calls.push(['overview']); return { items: [], hasMore: false }; },
  detail: async id => { calls.push(['detail', id]); return { organizationId: id }; }, ...svc,
 };
 const mod = load('server/http/platform-admin-portals.ts', {
  'server-only': {}, 'next/server': { NextResponse: { json: (body, init) => new Response(body, init) }, NextRequest: class {} }, '@/shared/contracts/platform-provisioning': contract,
  '@/server/services/platform-admin': { getPlatformAdminAccess: async () => { calls.push(['access']); return status === 'ok' ? { status, client: {}, viewer: {} } : { status }; } },
  '@/server/services/platform-provisioning': { platformProvisioningService: () => service, acceptTeacherInvitation: async (client, token) => { calls.push(['accept', token]); if (accept) throw accept; return { organizationId: uuid(9) }; } },
  '@/server/http/firebase/route': { validFirebaseOrigin: () => origin }, '@/server/services/application-auth': { getApplicationViewer: async () => viewer },
  '@/server/integrations/supabase': { getSupabaseServerClient: async () => ({}) }, '@/shared/auth-config': { isFirebaseStaging: () => staging },
 });
 return { mod, calls };
}
const req = (method, body, { url = 'https://admin.example/api/platform-admin/portals', type = 'application/json' } = {}) => ({ method, url, headers: { get: k => ({ 'content-type': type })[k.toLowerCase()] ?? null },
 body: body === undefined ? null : { getReader() { const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); let done = false; return { read: async () => done ? { done: true } : (done = true, { done: false, value: new Uint8Array(bytes) }), cancel: async () => {} }; } } });

test('HTTP: anonymous, unavailable and non-administrators never reach any provisioning operation', async () => {
 for (const [status, expected] of [['anonymous', 401], ['forbidden', 403], ['unavailable', 404]]) {
  for (const request_ of [req('GET'), req('POST', request())]) {
   const h = handlers({ status }); const r = await h.mod.platformPortalsHTTP(request_); assert.equal(r.status, expected, status);
   assert.deepEqual(h.calls.map(c => c[0]), ['access']);
  }
  for (const body of [{ action: 'revoke' }, { action: 'reissue', expiresInDays: 7 }]) {
   const h = handlers({ status }); const r = await h.mod.platformPortalHTTP(req('POST', body), uuid(1)); assert.equal(r.status, expected); assert.deepEqual(h.calls.map(c => c[0]), ['access']);
  }
  const h = handlers({ status }); assert.equal((await h.mod.platformPortalHTTP(req('GET'), uuid(1))).status, expected); assert.deepEqual(h.calls.map(c => c[0]), ['access']);
 }
});
test('HTTP: writes need an exact origin before authorization work, JSON, a bounded size and a strict body', async () => {
 const cross = handlers({ origin: false }); assert.equal((await cross.mod.platformPortalsHTTP(req('POST', request()))).status, 403); assert.deepEqual(cross.calls, []);
 assert.equal((await handlers().mod.platformPortalsHTTP(req('POST', request(), { type: 'text/plain' }))).status, 415);
 assert.equal((await handlers().mod.platformPortalsHTTP(req('POST', 'x'.repeat(32001)))).status, 413);
 assert.equal((await handlers().mod.platformPortalsHTTP(req('POST', '{'))).status, 400);
 for (const bad of [{ ...request(), organizationId: uuid(1) }, { ...request(), role: 'owner' }, { teacherEmail: 'x' }, {}]) {
  const h = handlers(); const r = await h.mod.platformPortalsHTTP(req('POST', bad)); assert.equal(r.status, 400); assert.equal(h.calls.some(c => c[0] === 'provision'), false);
 }
 assert.equal((await handlers().mod.platformPortalsHTTP(req('POST', request(), { url: 'https://admin.example/api/platform-admin/portals?x=1' }))).status, 400);
 assert.equal((await handlers().mod.platformPortalsHTTP(req('GET', undefined, { url: 'https://admin.example/api/platform-admin/portals?x=1' }))).status, 400);
 for (const id of ['x', '../1', uuid(1) + '0', uuid(1).toUpperCase().replace(/-/g, '_')]) assert.equal((await handlers().mod.platformPortalHTTP(req('GET'), id)).status, 404, id);
 const h = handlers(); assert.equal((await h.mod.platformPortalHTTP(req('POST', { action: 'revoke', organizationId: uuid(2) }), uuid(1))).status, 400);
 assert.equal((await h.mod.platformPortalHTTP(req('POST', { action: 'delete' }), uuid(1))).status, 400); assert.equal(h.calls.some(c => c[0] === 'revoke'), false);
});
test('HTTP: success is uncached and unindexable; failures are sanitized with explicit reasons', async () => {
 const h = handlers(), r = await h.mod.platformPortalsHTTP(req('POST', request())); assert.equal(r.status, 201);
 assert.match(r.headers['Cache-Control'], /no-store/); assert.match(r.headers['X-Robots-Tag'], /noindex/); assert.equal(r.headers['Referrer-Policy'], 'no-referrer');
 assert.equal(h.calls.find(c => c[0] === 'provision')[1].teacherEmail, 'teacher@example.test');
 assert.equal((await h.mod.platformPortalsHTTP(req('GET'))).status, 200);
 const ok = await h.mod.platformPortalHTTP(req('POST', { action: 'reissue', expiresInDays: 14, teacherEmail: 'N@Example.test' }), uuid(1)); assert.equal(ok.status, 200);
 assert.deepEqual(h.calls.find(c => c[0] === 'reissue'), ['reissue', uuid(1), 14, 'n@example.test']);
 assert.equal((await h.mod.platformPortalHTTP(req('POST', { action: 'revoke' }), uuid(1))).status, 200);
 const dup = handlers({ svc: { provision: async () => { throw Object.assign(new Error('A pending invitation already exists for this email.'), { status: 409, reason: 'pending_exists' }); } } });
 const conflict = await dup.mod.platformPortalsHTTP(req('POST', request())); assert.equal(conflict.status, 409); assert.equal(conflict.body.reason, 'pending_exists');
 const crash = handlers({ svc: { provision: async () => { throw Object.assign(new Error('relation private.x does not exist'), { status: 500 }); } } });
 const failed = await crash.mod.platformPortalsHTTP(req('POST', request())); assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed.body), /relation|private/);
});
test('HTTP: acceptance needs Firebase staging, exact origin, a signed-in user and a well-formed secret, and never an administrator', async () => {
 const token = crypto.randomBytes(32).toString('base64url');
 const url = 'https://admin.example/api/teacher-invitations/accept';
 assert.equal((await handlers({ staging: false }).mod.acceptTeacherInvitationHTTP(req('POST', { token }, { url }))).status, 404);
 assert.equal((await handlers({ origin: false }).mod.acceptTeacherInvitationHTTP(req('POST', { token }, { url }))).status, 403);
 assert.equal((await handlers({ viewer: null }).mod.acceptTeacherInvitationHTTP(req('POST', { token }, { url }))).status, 401);
 assert.equal((await handlers({ viewer: { backend: 'clerk' } }).mod.acceptTeacherInvitationHTTP(req('POST', { token }, { url }))).status, 401);
 const strict = handlers(); for (const bad of [{ token: 'short' }, { token, organizationId: uuid(1) }, { token, role: 'owner' }]) assert.equal((await strict.mod.acceptTeacherInvitationHTTP(req('POST', bad, { url }))).status, 400);
 assert.equal(strict.calls.some(c => c[0] === 'accept'), false);
 const ok = handlers(); const r = await ok.mod.acceptTeacherInvitationHTTP(req('POST', { token }, { url })); assert.equal(r.status, 200); assert.deepEqual(ok.calls.find(c => c[0] === 'accept'), ['accept', token]);
 assert.equal(ok.calls.some(c => c[0] === 'access'), false, 'acceptance does not depend on platform administration');
 assert.deepEqual(JSON.parse(JSON.stringify(r.body)), { organizationId: uuid(9) });
 const gone = await handlers({ accept: Object.assign(new Error('The invitation is no longer valid.'), { status: 410, reason: 'gone' }) }).mod.acceptTeacherInvitationHTTP(req('POST', { token }, { url })); assert.equal(gone.status, 410);
 assert.equal((await handlers().mod.acceptTeacherInvitationHTTP(req('GET', undefined, { url }))).status, 403);
});

test('wiring: every platform-admin page repeats the guard; routes and middleware are allowlisted; legacy admin routes are untouched', () => {
 for (const page of ['app/platform-admin/layout.tsx', 'app/platform-admin/page.tsx', 'app/platform-admin/teachers/page.tsx', 'app/platform-admin/teachers/new/page.tsx', 'app/platform-admin/teachers/[portalId]/page.tsx', 'app/platform-admin/settings/page.tsx']) assert.match(read(page), /requirePlatformAdmin\(\)/, page);
 assert.match(read('app/api/platform-admin/portals/route.ts'), /platformPortalsHTTP as GET, platformPortalsHTTP as POST/);
 assert.match(read('app/api/platform-admin/portals/[portalId]/route.ts'), /platformPortalRoute as GET, platformPortalRoute as POST/);
 assert.match(read('app/api/teacher-invitations/accept/route.ts'), /acceptTeacherInvitationHTTP as POST/);
 const middleware = read('middleware.ts');
 assert.match(middleware, /path === '\/platform-admin' \|\| path\.startsWith\('\/platform-admin\/'\)/);
 assert.match(middleware, /path === '\/api\/platform-admin\/portals'/); assert.match(middleware, /path === '\/api\/teacher-invitations\/accept'/);
 assert.ok(middleware.indexOf('/api/platform-admin/portals') < middleware.indexOf('This legacy workflow is unavailable'), 'allowlisted before the Firebase catch-all');
 assert.doesNotMatch(middleware, /platform-admin\/catalog/);
 assert.match(read('app/(dashboard)/(routes)/admin/users/page.tsx'), /TeacherFoundationPage/); assert.match(read('app/(dashboard)/(routes)/admin/submissions/page.tsx'), /TeacherFoundationPage/);
 for (const file of ['server/services/platform-admin.ts', 'server/services/platform-provisioning.ts', 'server/http/platform-admin-portals.ts', 'app/platform-admin/layout.tsx'])
  assert.doesNotMatch(code(file), /clerk|isTeacher|support_operators|service_role|SERVICE_ROLE/i, file);
 assert.doesNotMatch(code('server/services/platform-admin.ts'), /\.email|customClaims|membership/i);
 for (const gone of ['app/api/platform-admin/catalog', 'app/platform-admin/catalog', 'shared/contracts/platform-catalog.ts', 'server/services/platform-catalog.ts', 'frontend/lib/platform-catalog.ts', 'supabase/tests/platform-admin-catalog.sql', 'supabase/migrations/20261024120000_platform_admin_education_catalog.sql'])
  assert.equal(fs.existsSync(gone), false, gone + ' (the disconnected global catalog is removed)');
 assert.doesNotMatch(code('shared/contracts/database.types.ts'), /education_systems|grade_level_subjects|platform_catalog_command/);
});
test('no sample teachers, names, domains or fabricated content ship in the product code', () => {
 for (const file of ['frontend/features/platform-admin/provision-form.tsx', 'frontend/features/platform-admin/teachers-view.tsx', 'frontend/features/platform-admin/portal-view.tsx', 'frontend/lib/provisioning-draft.ts'])
  assert.doesNotMatch(code(file), /@[a-z0-9-]+\.(com|org|net)|lorem|placeholder=|defaultValue=|Mr |Mrs /i, file);
 assert.doesNotMatch(code('frontend/features/platform-admin/provision-form.tsx'), /displayName|websiteName|website|domain/i, 'the administrator is never asked for a display name or website');
});
test('migration: additive only, RLS everywhere, no secrets stored, no implicit tenant access, fixed search paths', () => {
 const sql = read('supabase/migrations/20261024120000_platform_admin_teacher_provisioning.sql'), bare = sql.replace(/^\s*--.*$/gm, '');
 for (const table of ['private.platform_admins', 'public.academic_subjects', 'private.teacher_invitations', 'private.platform_audit']) assert.match(sql, new RegExp('alter table ' + table + ' enable row level security'), table);
 assert.doesNotMatch(bare, /grant\s+(insert|update|delete|all)[^;]*public\.academic_subjects/i);
 assert.doesNotMatch(bare, /grant[^;]*private\.(platform_admins|teacher_invitations|platform_audit)/i);
 assert.doesNotMatch(bare, /auth\.uid\(\)/, 'the profile UUID is never assumed to equal auth.uid()');
 assert.doesNotMatch(bare, /\bdrop\s+(table|column|policy|function|constraint)|delete from|truncate\s+table|alter table public\.(organizations|profiles)\s+(drop|alter)/i, 'additive and backward compatible');
 assert.doesNotMatch(bare, /insert into private\.platform_admins/i, 'no migration seeds an administrator');
 assert.match(read('.gitattributes'), /^supabase\/migrations\/20261024120000_platform_admin_teacher_provisioning\.sql -text$/m, 'the staging manager hashes the exact blob; no line-ending conversion');
 assert.doesNotMatch(sql, /\r/, 'LF only');
 assert.match(read('supabase/manual/rollback_platform_admin_provisioning.sql'), /refusing|exist/, 'a data-guarded rollback procedure ships beside the manual bootstrap');
 assert.doesNotMatch(bare, /update public\.(courses|academic_programs|academic_stages|organizations)\b/i, 'existing records are never rewritten');
 assert.match(bare, /token_hash bytea/); assert.doesNotMatch(bare, /\btoken\s+text|raw_token|secret\s+text/i);
 for (const definition of bare.split(/create (?:or replace )?function /).slice(1)) assert.match(definition, /set search_path=''/, definition.slice(0, 70));
 assert.match(bare, /current_app_user_id\(\)/); assert.match(bare, /email_verified/);
 assert.match(bare, /status='pending'/); assert.match(bare, /for update/);
});
test('bootstrap procedure is trusted-operator only, UID based and refuses placeholders', () => {
 const sql = read('supabase/manual/bootstrap_platform_admin.sql');
 assert.match(sql, /current_user <> 'postgres'/); assert.match(sql, /e\.provider='firebase' and e\.issuer=v_issuer and e\.subject=v_subject/);
 assert.match(sql, /like '%REPLACE%'/); assert.doesNotMatch(sql, /email\s*=|auth\.users|values\s*\(\s*'[0-9a-f-]{36}'/i);
 assert.equal(fs.existsSync('supabase/manual/revoke_platform_admin.sql'), true);
});
test('design system: tokens are centralised, both schemes are defined, and screens use tokens only', () => {
 const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
 const tokens = strip(read('frontend/design-system/tokens.css')), components = strip(read('frontend/design-system/components.css')), admin = strip(read('frontend/styles/platform-admin.css'));
 for (const file of [components, admin]) {
  const selectors = Array.from(file.matchAll(/(^|\})\s*([^{}@]+)\{/g), m => m[2].trim()).filter(Boolean).flatMap(x => x.split(/,(?![^(]*\))/));
  for (const selector of selectors.filter(x => !/^(from|to|\d+%)$/.test(x.trim()))) assert.match(selector.trim(), /\.eds-|\.pa-/, selector);
 }
 assert.match(tokens, /\.eds-root\s*\{/); assert.match(tokens, /html\.dark \.eds-root/); assert.match(tokens, /html\[lang='ar'\]/);
 for (const name of ['--eds-font-body', '--eds-font-display', '--eds-radius-md', '--eds-shadow-accent', '--eds-bg', '--eds-surface', '--eds-border', '--eds-border-strong', '--eds-brand', '--eds-text', '--eds-text-muted']) assert.match(tokens, new RegExp(name + ':'), name);
 // the original brand fonts and green are referenced through the app's own font variables and palette
 assert.match(tokens, /var\(--font-body,\s*'Figtree'\)/); assert.match(tokens, /var\(--font-display,\s*'Caprasimo'\)/); assert.match(tokens, /var\(--font-arabic-body/); assert.match(tokens, /#7ed957/i);
 // components and screens never hard-code colors or fonts: that belongs to the tokens
 for (const [name, css] of [['components', components], ['platform-admin', admin]]) {
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, name + ' has a literal color');
  assert.doesNotMatch(css, /\b(rgb|rgba|hsl|hsla)\(/i, name + ' has a literal color function');
  assert.doesNotMatch(css, /font-family:\s*(?!\s|var\()/i, name + ' sets a literal font family');
 }
 assert.match(components, /prefers-reduced-motion/); assert.match(admin, /\[dir='rtl'\]|:dir\(rtl\)|\[dir=rtl\]|inline-start|inset-inline/);
 // screens use the shared kit rather than ad-hoc inline styles
 for (const f of ['shell', 'common', 'provision-form', 'teachers-view', 'portal-view']) assert.doesNotMatch(read(`frontend/features/platform-admin/${f}.tsx`), /style=\{\{/, f);
 assert.match(read('app/platform-admin/layout.tsx'), /design-system\/tokens\.css/); assert.match(read('app/platform-admin/layout.tsx'), /design-system\/components\.css/);
});
test('portal: a dropped connection during reissue or revoke is an unknown outcome, never a failure or a blind retry', () => {
 const src = read('frontend/features/platform-admin/portal-view.tsx');
 // both write actions route a network error to the unknown state before any failure message is chosen
 assert.equal((src.match(/out\.reason === 'network'/g) || []).length >= 2, true);
 assert.match(src, /action: 'revoke', baselineId/); assert.match(src, /action: 'reissue', baselineId/); assert.equal((src.match(/setUnknown\(baseline\)/g) || []).length, 2);
 assert.match(src, /const locked = /); assert.match(src, /async function checkStatus/);
 const { PortalView } = view('portal-view');
 const detail = { organizationId: uuid(1), status: 'active', createdAt: '2030-01-02T00:00:00Z', hasOwner: false,
  invitations: [{ id: uuid(2), teacherEmail: 'owner@example.test', createdAt: '2030-01-02T00:00:00Z', expiresAt: '2030-01-09T00:00:00Z', acceptedAt: null, revokedAt: null, revokeReason: null, status: 'pending' }],
  educationSystems: [], subjects: [], courses: [], activity: [] };
 const html = render(React.createElement(PortalView, { initial: detail, portalId: uuid(1) }));
 assert.doesNotMatch(html, /The outcome is unknown/, 'normal state shows no unknown banner');
 const { messages } = localization.load('frontend/locales/messages.ts');
 for (const key of ['pa.portal.unknown_title', 'pa.portal.unknown_reissue', 'pa.portal.unknown_revoke', 'pa.portal.refresh_status', 'pa.portal.outcome_reissue_lost', 'pa.portal.outcome_reissue_none', 'pa.portal.outcome_revoke_done', 'pa.portal.outcome_revoke_none', 'pa.portal.issue_replacement', 'pa.portal.replacement_hint']) assert.ok(messages.en[key] && messages.ar[key], key);
 assert.match(messages.en['pa.portal.unknown_revoke'], /Do not retry/); assert.match(messages.en['pa.portal.unknown_reissue'], /Do not retry/);
});
test('locales: every platform-admin string exists in English and Arabic and every used key is defined', () => {
 const { messages } = localization.load('frontend/locales/messages.ts');
 const english = Object.keys(messages.en).filter(k => k.startsWith('pa.')), arabic = Object.keys(messages.ar).filter(k => k.startsWith('pa.'));
 assert.deepEqual(english.sort(), arabic.sort()); assert.ok(english.length > 100);
 for (const key of english) { assert.notEqual(messages.ar[key], '', key); assert.deepEqual((messages.en[key].match(/\{\w+\}/g) || []).sort(), (messages.ar[key].match(/\{\w+\}/g) || []).sort(), key); }
 const used = new Set();
 for (const file of ['shell', 'common', 'provision-form', 'teachers-view', 'portal-view']) for (const m of read(`frontend/features/platform-admin/${file}.tsx`).matchAll(/'(pa\.[a-z_.]+)'/g)) used.add(m[1]);
 for (const key of used) assert.ok(key in messages.en, 'missing ' + key);
 const codes = ['email_required', 'email_invalid', 'name_required', 'name_long', 'board_long', 'duplicate', 'system_required', 'grade_required', 'subject_required', 'course_title', 'course_grade', 'course_subject', 'limit', 'unsafe', 'grade_duplicate', 'subject_duplicate'];
 for (const c of codes) assert.ok('pa.draft.' + c in messages.en, 'pa.draft.' + c);
 for (const reason of ['invalid', 'duplicate', 'pending_exists', 'not_found', 'used', 'gone', 'forbidden', 'unavailable']) assert.ok('pa.err.' + reason in messages.en, reason);
 assert.doesNotMatch(Object.entries(messages.en).filter(([k]) => k.startsWith('pa.')).map(([, v]) => v).join(' '), /organization|tenant|slug|stage|uuid|RLS|database/i, 'no internal terminology reaches the interface');
});

function render(element, language = 'en') {
 const { LanguageProvider } = localization.language();
 return renderToStaticMarkup(React.createElement(LanguageProvider, { initialLanguage: language }, element)).replace(/<script[\s\S]*?<\/script>/g, '');
}
const view = f => localization.load(`frontend/features/platform-admin/${f}.tsx`);
test('view: an empty portal list is honest; a failed read shows retry rather than an empty list', () => {
 const { TeachersView } = view('teachers-view');
 const empty = render(React.createElement(TeachersView, { initial: { items: [], hasMore: false } })); assert.match(empty, /No teacher portals yet/); assert.doesNotMatch(empty, /<table/); assert.match(empty, /Create teacher portal/);
 const failed = render(React.createElement(TeachersView, { initial: null })); assert.match(failed, /role="alert"/); assert.match(failed, /Retry/); assert.doesNotMatch(failed, /No teacher portals yet/);
 assert.match(render(React.createElement(TeachersView, { initial: { items: [], hasMore: false } }), 'ar'), /لا توجد بوابات معلمين بعد/);
});
test('view: the list shows email, first-course path and status only from supplied data', () => {
 const { TeachersView } = view('teachers-view');
 const item = { organizationId: uuid(1), teacherEmail: 'owner@example.test', createdAt: '2030-01-02T03:04:05Z', expiresAt: '2030-01-09T03:04:05Z', acceptedAt: null, invitationStatus: 'pending', course: { id: uuid(2), title: 'Physics 10', subject: 'Physics', grade: 'Grade 10', educationSystem: 'IGCSE', examinationBoard: 'Cambridge' } };
 const html = render(React.createElement(TeachersView, { initial: { items: [item, { ...item, organizationId: uuid(3), invitationStatus: 'expired' }], hasMore: true } }));
 assert.match(html, /owner@example\.test/); assert.match(html, /IGCSE · Cambridge · Grade 10 · Physics/); assert.match(html, /Invitation pending/); assert.match(html, /Invitation expired/); assert.match(html, /2030-01-02 03:04 UTC/);
 assert.match(html, new RegExp(`/platform-admin/teachers/${uuid(1)}`)); assert.match(html, /Only the most recent portals are shown/);
});
test('view: the creation form starts blank, asks for no display name or website, and offers inline creation', () => {
 const { ProvisionForm } = view('provision-form'); const html = render(React.createElement(ProvisionForm));
 assert.match(html, /Teacher email/); assert.match(html, /Invitation settings/); assert.match(html, /Setup progress/); assert.match(html, />Next</);
 // one step at a time: later steps are not rendered at all
 for (const hidden of [/Add grade level/, /Add subject/, /Examination board/, /Grade level missing/, /Course title/]) assert.doesNotMatch(html, hidden);
 assert.equal((html.match(/eds-stepper-point/g) || []).length, 4, 'four progress points'); assert.match(html, /aria-current="step"/);
 assert.doesNotMatch(html, /Create portal|Review setup/);
 assert.doesNotMatch(html, /Website|domain|Organization|Stage/i); assert.match(html, /chooses their own display name/);
 assert.doesNotMatch(html, /role="alert"/, 'no validation noise before the first attempt');
 const ar = render(React.createElement(ProvisionForm), 'ar'); assert.match(ar, /إنشاء بوابة معلم/);
});
test('view: the portal page reports owner state, honest delivery and the audit trail', () => {
 const { PortalView } = view('portal-view');
 const detail = { organizationId: uuid(1), status: 'active', createdAt: '2030-01-02T00:00:00Z', hasOwner: false,
  invitations: [{ id: uuid(2), teacherEmail: 'owner@example.test', createdAt: '2030-01-02T00:00:00Z', expiresAt: '2030-01-09T00:00:00Z', acceptedAt: null, revokedAt: null, revokeReason: null, status: 'pending' }],
  educationSystems: [{ id: uuid(3), name: 'IGCSE', examinationBoard: 'Cambridge', gradeLevels: [{ id: uuid(4), name: 'Grade 10' }] }], subjects: [{ id: uuid(5), name: 'Physics' }],
  courses: [{ id: uuid(6), title: 'Physics 10', status: 'draft', subject: 'Physics', gradeLevel: 'Grade 10', educationSystem: 'IGCSE' }],
  activity: [{ action: 'portal.provision', occurredAt: '2030-01-02T00:00:00Z', actor: 'administrator' }] };
 const html = render(React.createElement(PortalView, { initial: detail, portalId: uuid(1) }));
 assert.match(html, /Owner pending/); assert.match(html, /Not sent by email/); assert.match(html, /Revoke invitation/); assert.match(html, /Issue a new code/); assert.match(html, /Portal created/); assert.match(html, /Administrator/);
 assert.match(html, /Draft, no content yet/); assert.doesNotMatch(html, /data-invitation-secret/, 'a secret is never rendered from stored data');
 const accepted = render(React.createElement(PortalView, { initial: { ...detail, hasOwner: true, invitations: [{ ...detail.invitations[0], status: 'accepted', acceptedAt: '2030-01-03T00:00:00Z' }] }, portalId: uuid(1) }));
 assert.match(accepted, /owns this portal/); assert.doesNotMatch(accepted, /Revoke invitation|Issue a new code/); assert.match(accepted, /can no longer be changed/);
});
test('view: the one-time secret card states plainly that no email was sent', () => {
 const { SecretCard } = view('common'); const html = render(React.createElement(SecretCard, { secret: 'A'.repeat(43), expiresAt: '2030-01-09T00:00:00Z' }));
 assert.match(html, /data-invitation-secret/); assert.match(html, /shown once/); assert.match(html, /No email was sent/); assert.match(html, /not connected yet/);
 assert.match(html, /accept-teacher-invitation/); assert.match(html, /Copy teacher page link/);
});


test('teacher invitation acceptance is staging-only, localized, and uses the existing safe API flow', () => {
 const page = read('app/accept-teacher-invitation/page.tsx');
 assert.match(page, /isFirebaseStaging\(\)/);
 assert.match(page, /notFound\(\)/);
 assert.match(page, /index:\s*false/);
 assert.match(page, /no-referrer/);
 const layout = read('app/accept-teacher-invitation/layout.tsx');
 assert.match(layout, /design-system\/tokens\.css/);
 assert.match(layout, /design-system\/components\.css/);
 const client = read('frontend/features/teacher-invitation/acceptance-form.tsx');
 assert.match(client, /\/api\/teacher-invitations\/accept/);
 assert.match(client, /credentials:\s*'same-origin'/);
 assert.match(client, /cache:\s*'no-store'/);
 assert.match(client, /edulabs-teacher-invitation-code/);
 assert.match(client, /outcomeUnknown/);
 assert.match(client, /emailVerified/);
 assert.match(client, /switchAccount/);
 assert.match(client, /edulabs-auth-next/);
 assert.doesNotMatch(client, /[?&]token=|encodeURIComponent\(\s*token/i, 'the secret must never be put in the URL');
 const middleware = read('middleware.ts');
 assert.match(middleware, /path === '\/accept-teacher-invitation'/);
 assert.match(middleware, /Referrer-Policy', 'no-referrer'/);
 const locale = load('frontend/locales/teacher-invitation.ts');
 const enKeys = Object.keys(locale.teacherInvitationMessages.en).sort();
 assert.deepEqual(Object.keys(locale.teacherInvitationMessages.ar).sort(), enKeys);
 for (const key of enKeys) assert.ok(locale.teacherInvitationMessages.ar[key], 'Arabic copy missing: ' + key);
 assert.ok(enKeys.length >= 20);
});
