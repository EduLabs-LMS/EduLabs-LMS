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

// ------------------------------------------------------------------ real middleware
test('middleware: with Firebase staging on, exactly the Settings and Group pages pass; lookalikes, legacy paths and APIs stay behind the catch-all', () => {
 class NextResponse { constructor(kind, status) { this.kind = kind; this.status = status; } static next() { return new NextResponse('next', 200); } static json(_, o) { return new NextResponse('json', o.status); } static redirect(u) { return new NextResponse('redirect:' + u.pathname, 307); } }
 const middleware = load('middleware.ts', {
  '@/shared/public-website': load('shared/public-website.ts', { zod: require('zod') }), '@/shared/website-routes': load('shared/website-routes.ts'),
  '@clerk/nextjs/server': { clerkMiddleware: () => () => assert.fail('the legacy handler must not run in Firebase staging'), createRouteMatcher: () => () => false },
  '@/shared/auth-config': { isFirebaseStaging: () => true }, 'next/server': { NextResponse },
 }).default;
 const run = path => middleware({ nextUrl: new URL('https://platform.example' + path), url: 'https://platform.example' + path }, {});
 const id = '1234abcd-0000-4000-8000-00000000000f';
 for (const ok of [...settings.teacherSettingsPaths, '/teacher/groups', '/teacher/groups/' + id]) assert.equal(run(ok).kind, 'next', ok + ' passes through');
 const refusedPages = ['/teacher/settings/', '/teacher/settings/account/', '/teacher/settings/other', '/teacher/settings/account/extra', '/teacher/settings//account', '/teacher/settings/Account', '/teacher/settings/courses.json', '/teacher/groups/', '/teacher/groups/not-a-uuid', '/teacher/groups/' + id + '/', '/teacher/groups/' + id + '/sessions', '/teacher/groups/' + id.toUpperCase(), '/teacher/groups/' + id.slice(1), '/teacher/groups//' + id, '/teacher/analytics', '/teacher/settings/notifications/preferences'];
 for (const path of refusedPages) { const r = run(path); assert.equal(r.kind, 'redirect:/unavailable', path + ' is not reachable'); }
 for (const path of ['/api/teacher/settings', '/api/teacher/groups', '/api/teacher/groups/' + id, '/api/settings/teacher', '/api/groups']) { const r = run(path); assert.equal(r.kind, 'json', path); assert.equal(r.status, 503, path); }
 assert.equal(run('/api/study-groups').kind, 'next', 'the one existing Groups endpoint is the only API these screens use');
});
test('middleware: the allowed page list in the source is exactly the Settings array plus the two Group pages', () => {
 const source = read('middleware.ts');
 const literal = [...source.matchAll(/path === '(\/teacher\/settings[^']*)'/g)].map(m => m[1]);
 assert.deepEqual(literal.sort(), [...settings.teacherSettingsPaths].sort());
 assert.match(source, /path === '\/teacher\/groups' \|\| \/\^\\\/teacher\\\/groups\\\/\[0-9a-f-\]\{36\}\$\/\.test\(path\)/);
 assert.doesNotMatch(source + read('shared/website-routes.ts'), /teacher\/analytics/);
});

// ------------------------------------------------------------------ wording and locales
test('locales: every ts.* string exists in English and Arabic with the same placeholders', () => {
 assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.ar).sort());
 const keys = Object.keys(messages.en).filter(k => k.startsWith('ts.') || k.startsWith('tg.'));
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
 for (const k of Object.keys(messages.en).filter(k => k.startsWith('ts.') || k.startsWith('tg.'))) { assert.doesNotMatch(messages.en[k], forbidden, k); assert.doesNotMatch(messages.ar[k], forbidden, k); }
});
