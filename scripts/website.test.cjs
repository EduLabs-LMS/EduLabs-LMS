const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date, Set, Array,
    require: name => { if (name === 'server-only') return {}; assert.ok(name in dependencies, name); return dependencies[name]; } });
  return module.exports;
}
const { courseCapability, offeringCapability, loadWebsiteScope } = load('server/services/website.ts', {
  react: { cache: fn => fn }, '@/server/services/application-auth': {}, '@/server/integrations/supabase': {}, '@/server/repositories/website': {}, '@/shared/auth-config': {}, '@/server/services/lesson-media': {},
});
test('navigation capabilities require active membership and assignments in the specific organization', () => {
  const courseA = { id: 'a', organization_id: 'orgA' }, courseB = { id: 'b', organization_id: 'orgB' };
  const context = { memberships: [{ organization_id: 'orgA', role: 'teacher', status: 'active' }, { organization_id: 'orgB', role: 'admin', status: 'suspended' }], courseStaff: [{ course_id: 'a', role: 'instructor' }], offeringStaff: [] };
  assert.equal(courseCapability(context, courseA), true);
  assert.equal(courseCapability(context, courseB), false);
  assert.equal(offeringCapability(context, courseA, 'runA'), true);
  assert.equal(offeringCapability(context, courseB, 'runB'), false);
  context.courseStaff[0].role = 'editor';
  assert.equal(courseCapability(context, courseA), true);
  assert.equal(offeringCapability(context, courseA, 'runA'), false);
  context.offeringStaff.push({ offering_id: 'runA', role: 'teaching_assistant' });
  assert.equal(offeringCapability(context, courseA, 'runA'), true);
  assert.equal(offeringCapability(context, courseA, 'otherRun'), false);
  context.memberships[0].status = 'suspended';
  assert.equal(offeringCapability(context, courseA, 'runA'), false);
});
test('owner in organization A does not become an owner of organization B', () => {
  const context = { memberships: [{ organization_id: 'orgA', role: 'owner', status: 'active' }, { organization_id: 'orgB', role: 'teacher', status: 'active' }], courseStaff: [], offeringStaff: [] };
  assert.equal(courseCapability(context, { id: 'a', organization_id: 'orgA' }), true);
  assert.equal(courseCapability(context, { id: 'b', organization_id: 'orgB' }), false);
});
test('progress belongs to an offering and is not copied into another run of a course', () => {
  const { studentLessons } = load('shared/website-model.ts');
  const lessons = studentLessons({ courses: [{ id: 'c', title: 'Physics' }], offerings: [{ id: 'a', course_id: 'c', name: 'A' }, { id: 'b', course_id: 'c', name: 'B' }], modules: [{ id: 'm', course_id: 'c' }], lessons: [{ id: 'l', module_id: 'm', title: 'Lesson' }], progress: [{ offering_id: 'a', lesson_id: 'l', status: 'completed' }] });
  assert.equal(lessons[0].chapters[0].isCompleted, true);
  assert.equal(lessons[1].chapters[0].isCompleted, false);
  assert.equal(lessons[1].href, '/courses/c?offering=b');
});
test('unmigrated routes never enter legacy handlers in Firebase staging', () => {
  const { isPhaseOneRoute } = load('shared/website-routes.ts');
  for (const route of ['/home', '/self-learning', '/group', '/teacher/create', '/onboarding/organization', '/courses/c', '/courses/c/detail', '/offerings/o']) assert.equal(isPhaseOneRoute(route), true);
  for (const route of ['/settings','/personalization']) assert.equal(isPhaseOneRoute(route), true);
  for (const route of ['/self-learning/20000000-0000-0000-0000-000000000001', '/self-learning/20000000-0000-0000-0000-000000000001/chapters/30000000-0000-0000-0000-000000000001']) assert.equal(isPhaseOneRoute(route), true);
  for (const route of ['/teacher/courses', '/teacher/courses/20000000-0000-0000-0000-000000000001', '/self-learning/not-a-uuid', '/self-learning/20000000-0000-0000-0000-000000000001/other']) assert.equal(isPhaseOneRoute(route), false);
  for (const route of ['/api/courses', '/api/uploadthing', '/courses/c/chapters/l', '/channel']) assert.equal(isPhaseOneRoute(route), false);
  assert.equal(isPhaseOneRoute('/admin/users'),true);
});
test('roster pagination is bounded and rejects malformed or excessive offsets', () => {
  const { validRosterPage } = load('shared/website-model.ts');
  assert.equal(validRosterPage(), 0); assert.equal(validRosterPage('2'), 2);
  for (const bad of ['-1', '1.5', 'NaN', '1001', '1e5', '']) assert.throws(() => validRosterPage(bad));
});
test('website reads are allowlisted, bounded, and pinned to the verified profile', async () => {
  const calls = [];
  const query = new Proxy({}, { get: (_, method) => method === 'then' ? (resolve => resolve({ data: [], error: null })) : (...args) => { calls.push([method, ...args]); return query; } });
  const repository = load('server/repositories/website.ts').createWebsiteRepository({ from: table => { calls.push(['from', table]); return query; } }, 'trusted-profile');
  await repository.myEnrollments(); await repository.progress(['o']); await repository.lessons(['m']); await repository.roster('o', 2);
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'user_id' && c[2] === 'trusted-profile'));
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'status' && c[2] === 'published'));
  assert.ok(calls.some(c => c[0] === 'range' && c[1] === 100 && c[2] === 150));
  assert.ok(!calls.some(c => c[0] === 'select' && /is_correct|\*/.test(c[1])));
  assert.ok(!calls.some(c => ['insert', 'update', 'upsert', 'delete'].includes(c[0])));
});
test('invalid organization selection fails before any course queries', async () => {
  assert.equal(await loadWebsiteScope({ organizations: [], repository: { courses: () => assert.fail('Unauthorized scope queried') } }, 'other-tenant'), null);
});
