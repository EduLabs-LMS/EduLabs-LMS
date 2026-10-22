const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);

test('sidebar hides Teacher courses only for teacher-side roles and keeps Self-learning active on the merged pages', () => {
  const s = read('frontend/components/sidebar.tsx');
  assert.match(s, /\{!teacherSide && \(\s*<Link\s+href="\/teacher\/courses"/);
  assert.match(s, /useIsTeacherSide\(\)/);
  assert.match(s, /pathname\.startsWith\('\/self-learning'\)/);
  assert.match(s, /teacherSide && pathname\.startsWith\('\/teacher'\)/);
  assert.match(s, /href="\/self-learning"/);
});

test('teacher dashboard simplification is gated to teacher-side so platform roles are unchanged', () => {
  const s = read('frontend/features/dashboard/admin-home.tsx');
  assert.match(s, /teacherSide\?: boolean/);
  assert.match(s, /\{!teacherSide && <div className="inline-flex[^]*?command_center/);
  assert.match(s, /\{!teacherSide && <p className="text-sm text-slate-500 max-w-2xl[^]*?here_is_an_overview_of/);
  assert.match(s, /teacherSide \? "w-full" : "relative overflow-hidden rounded-3xl border/);
  assert.match(s, /\{!teacherSide && \(\s*<>[^]*?quick_administrative_actions/);
  assert.match(s, /\{phase1&&!teacherSide&&<GroupSummaryPanel/);
  assert.match(s, /useGroupSummary\(phase1&&!teacherSide\)/);
  assert.match(s, /teacher\.manage_users_groups/);
  assert.match(s, /teacher\.review_homework/);
});

test('website home hides link row and assessments widget for teacher-side only', () => {
  const s = read('app/(dashboard)/_components/website-pages.tsx');
  assert.match(s, /\{staff && !teacherSide && <Localized as="nav"/);
  assert.match(s, /\{!teacherSide && <Assessments scope=\{scope\} \/>\}/);
  assert.match(s, /<AdminHome phase1 teacherSide=\{teacherSide\}/);
});

test('course management lives under Self-learning for teacher-side and the old route is dead for them', () => {
  const sl = read('app/(dashboard)/(routes)/self-learning/page.tsx');
  assert.match(sl, /await isTeacherSide\(\)\) return <TeacherCoursesPage/);
  assert.ok(fs.existsSync('app/(dashboard)/(routes)/self-learning/[courseId]/page.tsx'));
  assert.ok(fs.existsSync('app/(dashboard)/(routes)/self-learning/[courseId]/chapters/[chapterId]/page.tsx'));
  assert.match(read('app/(dashboard)/(routes)/self-learning/[courseId]/layout.tsx'), /if \(!\(await isTeacherSide\(\)\)\) notFound\(\)/);
  const old = read('app/(dashboard)/(routes)/teacher/courses/layout.tsx');
  assert.match(old, /if \(await isTeacherSide\(\)\) notFound\(\)/);
  assert.doesNotMatch(old, /redirect/);
  assert.match(read('shared/website-routes.ts'), /\\\/self-learning\\\/\[0-9a-f-\]\{36\}/);
});

test('no in-app link hardcodes the old course route outside the platform-only places', () => {
  const allowed = new Set(['shared/course-management-path.ts', 'shared/website-routes.ts', 'frontend/components/sidebar.tsx', 'frontend/features/dashboard/admin-home.tsx', 'frontend/features/dashboard/sidebar-routes.tsx', 'app/(dashboard)/(routes)/self-learning/[courseId]/page.tsx', 'app/(dashboard)/(routes)/self-learning/[courseId]/chapters/[chapterId]/page.tsx']);
  const hits = [];
  for (const dir of ['app', 'frontend', 'server', 'shared']) for (const f of walk(dir)) {
    if (!/\.(ts|tsx)$/.test(f)) continue;
    const rel = f.split(path.sep).join('/');
    if (allowed.has(rel)) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (/['"`]\/teacher\/courses/.test(src)) hits.push(rel);
  }
  assert.deepEqual(hits, []);
});
