// The teacher website has no feature yet. Until it does, /teacher/website must not be reachable by teachers: the real middleware sends it to
// /unavailable with Firebase staging on, nothing lists it as a Phase One route, and no menu, link or tour points to it.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm'), ts = require('typescript');
function load(file, deps = {}) {
  const m = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { module: m, exports: m.exports, URL, require: n => n === 'zod' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
  return m.exports;
}
class NextResponse {
  constructor(kind, status) { this.kind = kind; this.status = status; this.headers = new Map(); }
  static next() { return new NextResponse('next', 200); }
  static json(_, o) { return new NextResponse('json', o.status); }
  static redirect(u) { return new NextResponse('redirect:' + new URL(u).pathname, 307); }
}
const middleware = staging => load('middleware.ts', {
  '@/shared/public-website': load('shared/public-website.ts', { zod: require('zod') }), '@/shared/website-routes': load('shared/website-routes.ts'),
  '@clerk/nextjs/server': { clerkMiddleware: () => () => new NextResponse('legacy', 200), createRouteMatcher: () => () => false },
  '@/shared/auth-config': { isFirebaseStaging: () => staging }, 'next/server': { NextResponse },
}).default;
const run = (staging, p) => middleware(staging)({ nextUrl: new URL('https://platform.example' + p), url: 'https://platform.example' + p }, {});

test('middleware: with Firebase staging on, /teacher/website and everything under it goes to /unavailable', () => {
  for (const p of ['/teacher/website', '/teacher/website/', '/teacher/website/domains', '/teacher/website/anything/else', '/teacher/Website'])
    assert.equal(run(true, p).kind, 'redirect:/unavailable', p);
});
test('middleware: the neighbours it must not disturb still behave', () => {
  assert.equal(run(true, '/teacher/groups').kind, 'next');
  assert.equal(run(true, '/teacher/students').kind, 'next');
  assert.equal(run(true, '/teacher/settings/account').kind, 'next');
  assert.equal(run(true, '/teacher/programs').kind, 'next', 'not part of this change');
  assert.equal(run(true, '/api/teacher/website').kind, 'next', 'the API is authorized in the database and is not this change');
  assert.equal(run(true, '/t/curiosity-classroom').kind, 'next', 'public pages are not teacher pages');
});
test('routes: no route helper lists the page', () => {
  const { isPhaseOneRoute } = load('shared/website-routes.ts');
  assert.equal(isPhaseOneRoute('/teacher/website'), false);
  assert.equal(isPhaseOneRoute('/teacher/website/x'), false);
  assert.doesNotMatch(fs.readFileSync('middleware.ts', 'utf8'), /(?<!\/api)\/teacher\/website/);
  assert.doesNotMatch(fs.readFileSync('shared/website-routes.ts', 'utf8'), /\/teacher\/website/);
});
test('the page is gone, and no menu, link, tour or screen points to it', () => {
  assert.equal(fs.existsSync('app/(dashboard)/(routes)/teacher/website/page.tsx'), false, 'the scaffold page is deleted');
  const seen = [];
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx|css)$/.test(e.name) && /(?<!\/api)\/teacher\/website(?![\w-])/.test(fs.readFileSync(p, 'utf8'))) seen.push(p.split(path.sep).join('/')); } };
  for (const dir of ['app', 'frontend', 'shared', 'server']) walk(dir);
  assert.deepEqual(seen, [], 'nothing links to /teacher/website');
  for (const file of ['shared/teacher-home.ts', 'frontend/features/teacher-home/teacher-nav.tsx', 'frontend/features/teacher-frame/teacher-frame.tsx']) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\/website|website\s*:/i, file + ' has no website entry');
});
