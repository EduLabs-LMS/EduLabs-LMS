const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Map, Date, Error,
    require: name => { assert.ok(name in dependencies, name); return dependencies[name]; },
  });
  return module.exports;
}
const jsx = (type, props) => ({ type, props });
function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const helpers = load('shared/lesson-card-model.ts');
const courseId = '10000000-0000-0000-0000-000000000001';
function fixture() {
  return {
    courses: [{ id: courseId, title: 'Physics', status: 'published', organization_id: 'org' }],
    modules: [{ id: 'm1', title: 'Same title' }, { id: 'm2', title: 'Same title' }],
    lessons: [
      { id: 'a1', module_id: 'm1', title: 'A1', status: 'published', estimated_duration_seconds: 120 },
      { id: 'b1', module_id: 'm2', title: 'B1', status: 'published', estimated_duration_seconds: null },
      { id: 'a2', module_id: 'm1', title: 'A2', status: 'published', estimated_duration_seconds: null },
      { id: 'b2', module_id: 'm2', title: 'B2', status: 'published', estimated_duration_seconds: null },
      { id: 'draft', module_id: 'm1', title: 'Draft', status: 'draft' },
      { id: 'outside', module_id: 'unavailable', title: 'Outside', status: 'published' },
    ],
    offerings: [{ id: 'runA', name: 'A' }, { id: 'runB', name: 'B' }],
    progress: [
      { offering_id: 'runB', lesson_id: 'a1', status: 'not_started' },
      { offering_id: 'runA', lesson_id: 'a1', status: 'completed' },
      { offering_id: 'runA', lesson_id: 'a2', status: 'in_progress' },
      { offering_id: 'runB', lesson_id: 'a2', status: 'completed' },
    ],
    limited: false, enrollments: [], scheduled: [], assessments: [],
  };
}
function website(scope, anonymous = false) {
  return load('app/(dashboard)/_components/website-pages.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/link': { default: 'Link' },
    'next/navigation': { redirect: () => { throw Error('redirect-sign-in'); }, notFound: () => { throw Error('not-found'); } },
    'lucide-react': {},
    '@/frontend/design/course-search': {}, '@/frontend/components/preview': {},
    '@/frontend/design/preferences': { T: 'T' },
    '@/frontend/features/dashboard/student-home': {}, '@/frontend/features/dashboard/admin-home': {},
    '@/frontend/components/course-card': {}, '@/frontend/features/groups/group-roster-view': {},
    '@/server/services/website': {
      getWebsiteContext: async () => anonymous ? null : { organizations: [{ id: 'org', name: 'Organization' }] },
      loadWebsiteScope: async () => scope,
    },
    '@/shared/website-model': {}, '@/shared/teacher-course': {},
    '@/frontend/features/courses/lesson-card': { LessonCard: 'LessonCard' },
    '@/frontend/features/courses/lesson-cards.module.css': { default: { cards: 'isolated-v2' } },
    '@/shared/lesson-card-model': helpers,
  });
}
async function cards(scope, offering) {
  const tree = await website(scope).WebsiteCourse({ courseId, search: offering ? { offering } : {} });
  return nodes(tree, n => n.type === 'LessonCard').map(n => n.props);
}

test('course presentation numbers identical-titled modules independently and excludes non-display lessons', async () => {
  const result = await cards(fixture(), 'runA');
  assert.deepEqual(result.map(c => [c.title, c.moduleLabel, c.lessonNumber]), [
    ['A1', 'Same title', 1], ['A2', 'Same title', 2], ['B1', 'Same title', 1], ['B2', 'Same title', 2],
  ]);
  for (const card of result) {
    assert.equal(card.partsCount, null);
    for (const unavailable of ['href', 'imageUrl', 'description']) assert.equal(unavailable in card, false);
  }
});
test('course presentation selects progress by both offering ID and lesson ID', async () => {
  assert.deepEqual((await cards(fixture(), 'runA')).map(c => c.status), ['Completed', 'In Progress', 'Not Started', 'Not Started']);
  assert.deepEqual((await cards(fixture(), 'runB')).map(c => c.status), ['Not Started', 'Completed', 'Not Started', 'Not Started']);
  assert.deepEqual((await cards(fixture())).map(c => c.status), ['Published', 'Published', 'Published', 'Published']);
});
test('course presentation preserves authentication, inaccessible course and offering guards', async () => {
  await assert.rejects(website(fixture(), true).WebsiteCourse({ courseId }), /redirect-sign-in/);
  await assert.rejects(website({ ...fixture(), courses: [] }).WebsiteCourse({ courseId }), /not-found/);
  await assert.rejects(website(fixture()).WebsiteCourse({ courseId, search: { offering: 'foreign-run' } }), /not-found/);
});
test('missing titles use the supplied module label and empty courses render no fabricated cards', async () => {
  const scope = fixture(); scope.modules[0].title = '  ';
  assert.equal((await cards(scope))[0].moduleLabel, 'Module 1');
  assert.equal((await cards({ ...scope, lessons: [] })).length, 0);
});

function component() {
  let failed = false;
  return load('frontend/features/courses/lesson-card.tsx', {
    react: { useState: () => [failed, value => { failed = value; }], useEffect: () => {} },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': { default: 'Link' },
    'lucide-react': { CheckCircle2: 'Check', Layers: 'Layers', LockKeyhole: 'Lock', PlayCircle: 'Play' },
    '@/shared/utils': { cn: (...args) => args.filter(Boolean).join(' ') },
  }).LessonCard;
}
const props = { moduleLabel: 'Module', lessonNumber: 1, title: 'Lesson', status: 'Published' };
test('supplied card without media, count or destination stays a plain article', () => {
  const tree = component()(props);
  assert.equal(tree.type, 'article');
  assert.equal(nodes(tree, n => ['img', 'Link', 'Layers'].includes(n.type)).length, 0);
});
test('supplied optional image error falls back to the normal card; real optional link/count are retained', () => {
  const Card = component();
  const options = { ...props, imageUrl: '/authorized-test-image', href: '/authorized-test-destination', partsCount: 2 };
  const tree = Card(options);
  assert.equal(tree.type, 'Link');
  assert.equal(nodes(tree, n => n.type === 'Layers').length, 1);
  nodes(tree, n => n.type === 'img')[0].props.onError();
  const fallback = Card(options);
  assert.equal(nodes(fallback, n => n.type === 'img').length, 0);
  assert.match(nodes(fallback, n => n.type === 'article')[0].props.className, /bg-white/);
});
