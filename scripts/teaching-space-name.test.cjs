// Teaching space name: the contract, the draft migration 20261105130000, the owner-rename route and the Settings / admin screens (static checks; the SQL behaviour is in supabase/tests/teaching-space-name.sql).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
function load(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { module: m, exports: m.exports, URL, require: n => n === 'zod' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const read = f => fs.readFileSync(f, 'utf8');
const strip = s => s.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const contract = load('shared/contracts/platform-provisioning.ts');
const space = load('shared/teacher-space.ts', { '@/shared/contracts/platform-provisioning': contract });
const mig = read('supabase/migrations/20261105130000_teaching_space_name.sql');

test('contract: one name rule for the admin form, the admin rename and the owner rename', () => {
 const ok = [["Mr Ahmed's Physics", "Mr Ahmed's Physics"], ['  Mr   Ahmed  ', 'Mr Ahmed'], ['فيزياء الأستاذ أحمد', 'فيزياء الأستاذ أحمد'], ['x'.repeat(200), 'x'.repeat(200)]];
 for (const [input, out] of ok) {
  assert.equal(contract.spaceName.parse(input), out);
  assert.equal(contract.portalAction.parse({ action: 'rename', name: input }).name, out);
  assert.equal(space.renameSpaceInput.parse({ organizationId: '00000000-0000-4000-8000-000000000001', name: input }).name, out);
 }
 for (const bad of ['', '   ', 'x'.repeat(201), 'Bell\u0007', 'line\nbreak', 42, null, undefined]) {
  assert.equal(contract.spaceName.safeParse(bad).success, false, String(bad));
  assert.equal(contract.portalAction.safeParse({ action: 'rename', name: bad }).success, false);
 }
 assert.equal(contract.portalAction.safeParse({ action: 'rename', name: 'ok', slug: 'x' }).success, false, 'only the name can be sent');
 assert.equal(space.renameSpaceInput.safeParse({ organizationId: 'not-a-uuid', name: 'ok' }).success, false);
 assert.equal(space.renameSpaceInput.safeParse({ organizationId: '00000000-0000-4000-8000-000000000001', name: 'ok', status: 'archived' }).success, false, 'no status, slug or role can ride along');
});
test('contract: provisioning requires the name', () => {
 const base = { teacherEmail: 'a@example.test', expiresInDays: 7, systems: [{ label: 'S', grades: [{ key: 'g', label: 'G' }] }], subjects: [{ key: 's', label: 'Sub' }], course: { title: 'C', gradeKey: 'g', subjectKey: 's' } };
 assert.equal(contract.provisionTeacherRequest.safeParse(base).success, false);
 assert.equal(contract.provisionTeacherRequest.safeParse({ ...base, spaceName: 'Mr Ahmed' }).success, true);
 assert.equal(contract.provisionTeacherRequest.safeParse({ ...base, spaceName: '  ' }).success, false);
});
test('migration: LF only, pinned as text, the last one, replaces only the provisioning and the two read models, never uses auth.uid()', () => {
 assert.ok(!mig.includes('\r')); assert.match(read('.gitattributes'), /20261105130000_teaching_space_name\.sql -text/);
 const names = fs.readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort();
 assert.equal(names.at(-8), '20261105130000_teaching_space_name.sql', 'only the listing-performance, course-content, homework rules, lesson publish, homework move, homework correct and exams migrations come after it');
 assert.doesNotMatch(strip(mig), /auth\.uid\(\)/);
 assert.deepEqual([...mig.matchAll(/create or replace function ([\w.]+)\(/g)].map(m => m[1]), ['private.platform_provision_teacher', 'private.platform_portal_overview', 'private.platform_portal_detail']);
 assert.equal((mig.match(/^create function /gm) ?? []).length, 4, 'two private functions and their two invoker wrappers');
 assert.match(mig, /private\.is_platform_admin\(\)/); assert.match(mig, /m\.role='owner' and m\.status='active'/); assert.match(mig, /o\.status='active'/);
 assert.match(mig, /revoke all on function public\.platform_rename_teaching_space\(uuid,text\),public\.rename_my_teaching_space\(uuid,text\) from public,anon;/);
 assert.doesNotMatch(strip(mig), /\b(drop table|create table|truncate|delete from)\b/i);
 assert.match(mig, /'portal\.rename'\)\);/);
});
test('migration: the provisioning function differs from the approved one in exactly the name handling', () => {
 const original = read('supabase/migrations/20261024120000_platform_admin_teacher_provisioning.sql').replace(/\r\n/g, '\n');
 const grab = (s, start) => { const a = s.indexOf(start); return s.slice(a, s.indexOf('end $$;', a)); };
 const before = grab(original, 'create function private.platform_provision_teacher(').split('\n'), after = grab(mig, 'create or replace function private.platform_provision_teacher(').split('\n');
 const removed = before.filter(l => !after.includes(l)), added = after.filter(l => !before.includes(l));
 assert.equal(removed.length, 5, removed.join('\n')); assert.equal(added.length, 6, added.join('\n'));
 assert.ok(added.some(l => l.includes("p_request->'spaceName',200")) && added.some(l => l.includes('values(v_space,')));
 assert.ok(removed.some(l => l.includes("values('Pending teacher portal'")));
});
test('route: the owner rename is its own PATCH route, the create route stays closed, nothing but the name is written', () => {
 assert.match(read('app/api/teacher/space/route.ts'), /export \{ renameSpacePATCH as PATCH \}/);
 const http = read('server/http/teacher-space.ts');
 assert.match(http, /validFirebaseOrigin/); assert.match(http, /backend !== 'firebase'/); assert.match(http, /renameMyTeachingSpace/); assert.doesNotMatch(http, /\.from\('organizations'\)/);
 assert.match(read('server/services/platform-provisioning.ts'), /rpc\('rename_my_teaching_space'/);
 assert.match(read('app/api/teacher/organizations/route.ts'), /managedOrganizationPOST as POST/);
});
test('screens: Rename only for an owner; the picker is hidden for one space; no forbidden word in what a teacher reads', () => {
 const names = read('frontend/features/teacher-settings/space-names.tsx');
 assert.match(names, /\{s\.owner && <Button/); assert.match(names, /\/api\/teacher\/space/); assert.match(names, /data-tour="space-name"/);
 assert.match(read('frontend/features/teacher-home/create-course.tsx'), /targets\.length > 1 && <div/);
 const en = read('frontend/locales/en.ts');
 for (const line of en.split('\n').filter(l => /^\s+"ts\.space\./.test(l))) assert.doesNotMatch(line.split('": ')[1], /organi[sz]ation|tenant|slug/i);
 const ar = read('frontend/locales/ar.ts');
 for (const k of [...en.matchAll(/"((?:ts\.space|pa\.(?:field\.space|draft\.space|review\.space|col\.space|portal\.space|activity\.rename))[\w.]*)"/g)].map(m => m[1])) assert.ok(ar.includes(`"${k}"`), 'Arabic text for ' + k);
 assert.match(read('app/(dashboard)/(routes)/teacher/settings/account/page.tsx'), /owner: m\.role === 'owner'/);
});
test('middleware: the rename route is reachable', () => {
 assert.match(read('middleware.ts'), /teacher\\\/\(website\|academics\|organizations\|space\|courses/);
});
