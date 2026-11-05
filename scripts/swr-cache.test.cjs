// frontend/lib/swr-cache.ts, use-swr.ts and first-load.ts. The security rules under test: a kept copy belongs to one signed-in user, is gone when they
// sign out or another user signs in, is never written to browser storage, never decides access, and never holds a failure or an answer that was
// read for someone else.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, deps = {}, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Map, Set, Array, Date, Number, Boolean, ...globals, require(name) { assert.ok(name in deps, name); return deps[name]; } });
  return module.exports;
}
let clock = 1_000_000;
const fresh = () => { const realNow = Date.now; return load('frontend/lib/swr-cache.ts', {}, { Date: { now: () => clock } }); };

test('swr: with no signed-in user nothing is stored and nothing is returned', () => {
  const c = fresh();
  c.swrStore('groups:overview', { rows: [1] });
  assert.equal(c.swrPeek('groups:overview'), undefined);
  assert.equal(c.swrSize(), 0);
});

test('swr: a copy is returned only to the user it was stored for', () => {
  const c = fresh();
  c.setSwrOwner('teacher-a');
  c.swrStore('groups:overview', { rows: ['a'] });
  assert.deepEqual(c.swrPeek('groups:overview'), { rows: ['a'] });
  c.setSwrOwner('teacher-b');
  assert.equal(c.swrPeek('groups:overview'), undefined, 'another user never sees it');
  c.setSwrOwner('teacher-a');
  assert.equal(c.swrPeek('groups:overview'), undefined, 'and a change of user empties the cache for good, even when the first user returns');
});

test('swr: signing out clears everything and stops storing', () => {
  const c = fresh();
  c.setSwrOwner('teacher-a');
  c.swrStore('a', 1); c.swrStore('b', 2);
  let resets = 0;
  c.onSwrReset(() => { resets++; });
  c.clearSwr();
  assert.equal(c.swrSize(), 0);
  assert.equal(c.swrOwner(), null);
  assert.equal(resets, 1, 'mounted screens are told, so none keeps the previous user\'s data');
  c.swrStore('a', 3);
  assert.equal(c.swrPeek('a'), undefined);
});

test('swr: the same owner set again keeps the cache (token refreshes do not empty it); a different owner empties it and tells mounted screens', () => {
  const c = fresh();
  c.setSwrOwner('teacher-a');
  c.swrStore('a', 1);
  let resets = 0;
  c.onSwrReset(() => { resets++; });
  c.setSwrOwner('teacher-a');
  assert.equal(c.swrPeek('a'), 1); assert.equal(resets, 0);
  c.setSwrOwner('teacher-b');
  assert.equal(resets, 1);
});

test('swr: an answer read for someone who has since signed out or been replaced is never stored', () => {
  const c = fresh();
  c.setSwrOwner('teacher-a');
  const startedAs = c.swrOwner();
  c.setSwrOwner('teacher-b');
  c.swrStore('groups:overview', { rows: ['read for a'] }, startedAs);
  assert.equal(c.swrPeek('groups:overview'), undefined);
  c.swrStore('groups:overview', { rows: ['read for b'] }, c.swrOwner());
  assert.deepEqual(c.swrPeek('groups:overview'), { rows: ['read for b'] });
  const mid = c.swrOwner();
  c.clearSwr();
  c.swrStore('x', 1, mid);
  assert.equal(c.swrSize(), 0);
});

test('swr: a copy older than ten minutes is not shown', () => {
  const c = fresh();
  c.setSwrOwner('teacher-a');
  c.swrStore('a', 1);
  clock += c.MAX_AGE_MS - 1;
  assert.equal(c.swrPeek('a'), 1);
  clock += 2;
  assert.equal(c.swrPeek('a'), undefined);
  assert.equal(c.swrSize(), 0);
});

test('swr: drop and drop-by-prefix remove only that user\'s matching copies', () => {
  const c = fresh();
  c.setSwrOwner('teacher-a');
  c.swrStore('group:1:detail', 1); c.swrStore('group:2:detail', 2); c.swrStore('groups:overview', 3); c.swrStore('students:offerings', 4);
  c.swrDrop('students:offerings');
  assert.equal(c.swrPeek('students:offerings'), undefined);
  c.swrDropPrefix('group');
  assert.equal(c.swrSize(), 0, 'a change to a Group makes every copy of the Groups screens stale');
});

test('swr: the cache is bounded', () => {
  const c = fresh();
  c.setSwrOwner('teacher-a');
  for (let i = 0; i < 260; i++) c.swrStore(`k${i}`, i);
  assert.ok(c.swrSize() <= 200);
  assert.equal(c.swrPeek('k259'), 259);
  assert.equal(c.swrPeek('k0'), undefined);
});

test('swr: only 401, 403 and 404 count as a refusal', () => {
  const c = fresh();
  for (const s of [401, 403, 404]) assert.equal(c.isRefusal(s), true);
  for (const s of [null, 0, 400, 409, 429, 500, 503, undefined]) assert.equal(c.isRefusal(s), false);
});

test('swr: nothing is ever written to browser storage, and no cookie or request is made, by the cache or the hook', () => {
  for (const file of ['frontend/lib/swr-cache.ts', 'frontend/lib/use-swr.ts']) {
    const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|caches\./, file);
  }
});

test('use-swr: a refusal drops the copy and shows the error; other failures keep the copy; a reset aborts the read and starts empty', () => {
  const code = fs.readFileSync('frontend/lib/use-swr.ts', 'utf8');
  assert.match(code, /if \(isRefusal\(status\)\) \{ swrDrop\(key\); setData\(\{ state: 'error', error \}\); return; \}/);
  assert.match(code, /setData\(d => d\.state === 'ready' \? \{ \.\.\.d, refreshing: false \} : \{ state: 'error', error \}\)/);
  assert.match(code, /useEffect\(\(\) => onSwrReset\(\(\) => \{ setData\(\{ state: 'loading' \}\); setRevision\(v => v \+ 1\); \}\), \[\]\)/);
  assert.match(code, /swrStore\(key, value, startedAs\)/);
  assert.match(code, /if \(controller\.signal\.aborted\) return;/);
});

test('every kept read in the teacher screens is stored with the owner it started under', () => {
  for (const file of ['frontend/features/teacher-students/data.ts', 'frontend/lib/use-swr.ts']) {
    const code = fs.readFileSync(file, 'utf8');
    // `mutate` stores what this very screen was just given for its own current owner; every read that completes later must name the owner it began under.
    const reads = (code.match(/swrStore(<[^>(]*>)?\([^;]*\);/g) ?? []).filter(call => !/\bnext\)/.test(call));
    assert.ok(reads.length > 0, file);
    for (const call of reads) assert.match(call, /startedAs\)/, `${file}: ${call}`);
  }
});

test('the attendance sheet is never served from a copy: it always shows what the database holds', () => {
  for (const file of fs.readdirSync('frontend/features/teacher-attendance').map(f => `frontend/features/teacher-attendance/${f}`)) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /swr/i, file);
  }
});

test('changes drop the copies they make stale (Groups and student administration)', () => {
  const groups = fs.readFileSync('frontend/features/teacher-groups/api.ts', 'utf8');
  assert.match(groups, /finally \{ if \(action !== 'view'\) swrDropPrefix\('group'\); \}/);
  assert.match(groups, /finally \{ swrDropPrefix\('group'\); \}/);
  const students = fs.readFileSync('frontend/features/teacher-students/api.ts', 'utf8');
  assert.match(students, /const READS = new Set\(\['offerings', 'roster', 'requests'\]\)/);
  assert.match(students, /if \(!READS\.has\(action\)\) \{ swrDropPrefix\('students'\); swrDropPrefix\('group'\); \}/);
});

test('the auth provider sets the owner on every token change and clears everything on sign-out', () => {
  const code = fs.readFileSync('frontend/components/providers/firebase-auth-provider.tsx', 'utf8');
  assert.match(code, /setSwrOwner\(current\?\.uid \?\? null\)/);
  assert.match(code, /clearSwr\(\);\s*clearFirstLoad\(\);/);
});

// ---- first load ----
const storage = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), size: () => m.size }; };

test('first-load: marked at sign-in, cleared once played or on sign-out; a missing or broken storage never throws', () => {
  const f = load('frontend/lib/first-load.ts', {}, { window: undefined });
  const s = storage();
  assert.equal(f.firstLoadPending(s), false);
  f.markFirstLoad(s);
  assert.equal(f.firstLoadPending(s), true);
  f.clearFirstLoad(s);
  assert.equal(f.firstLoadPending(s), false);
  assert.equal(f.firstLoadPending(null), false);
  f.markFirstLoad(null); f.clearFirstLoad(null);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(f.firstLoadPending(broken), false);
  f.markFirstLoad(broken); f.clearFirstLoad(broken);
});

test('first-load: the logo plays to its end, a slow page or a silent browser can never hold it for long, and only the sign-in pages wait for the address to change', () => {
  const f = load('frontend/lib/first-load.ts', {}, { window: undefined });
  assert.ok(f.FIRST_LOAD_PLAY_FALLBACK_MS >= 2000 && f.FIRST_LOAD_PLAY_FALLBACK_MS <= 4000, 'a fallback longer than the animation');
  assert.ok(f.FIRST_LOAD_ARRIVAL_CAP_MS <= 6000, 'a slow page gets its skeleton');
  assert.ok(f.FIRST_LOAD_REDUCED_MS <= 1000);
  for (const path of ['/', '/sign-in', '/sign-in/sso-callback', '/sign-up']) assert.equal(f.firstLoadWaitsForAddress(path), true, path);
  for (const path of ['/home', '/teacher/groups', '/sign-inside']) assert.equal(f.firstLoadWaitsForAddress(path), false, path);
});

test('loading provider: only sign-in starts the overlay on its own; no link click, route change or page signal can bring it back', () => {
  const code = fs.readFileSync('frontend/components/providers/loading-provider.tsx', 'utf8');
  assert.doesNotMatch(code, /acquireLoading|startNavigation|addEventListener\(\s*['"]click/);
  assert.match(code, /beginFirstLoad/);
  assert.match(code, /FIRST_LOAD_ARRIVAL_CAP_MS/);
  const router = fs.readFileSync('frontend/components/providers/use-loading-router.ts', 'utf8');
  assert.match(router, /export const useLoadingRouter = \(\) => useRouter\(\);/);
  assert.equal(fs.existsSync('frontend/components/providers/use-page-loading-signal.ts'), false);
  assert.equal(fs.existsSync('frontend/components/route-loading-signal.tsx'), false);
});

test('every teacher route has its own loading.tsx that draws the page\'s layout and carries no overlay signal', () => {
  const routes = [
    'app/(dashboard)/(routes)/home', 'app/(dashboard)/(routes)/teacher/groups', 'app/(dashboard)/(routes)/teacher/groups/[groupId]',
    'app/(dashboard)/(routes)/teacher/groups/[groupId]/attendance/[sessionId]', 'app/(dashboard)/(routes)/teacher/groups/new',
    'app/(dashboard)/(routes)/teacher/students', 'app/(dashboard)/(routes)/teacher/students/[studentId]', 'app/(dashboard)/(routes)/teacher/courses',
    'app/(dashboard)/(routes)/teacher/settings', 'app/(dashboard)/(routes)/teacher/settings/courses/[courseId]',
  ];
  for (const dir of routes) {
    const file = `${dir}/loading.tsx`;
    assert.ok(fs.existsSync(file), file);
    const code = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(code, /RouteLoadingSignal|usePageLoadingSignal|LoadingOverlay/, file);
    assert.match(code, /Skeleton|CourseLoading|HomeLoading|PageSkeleton|Loading/, file);
  }
});
