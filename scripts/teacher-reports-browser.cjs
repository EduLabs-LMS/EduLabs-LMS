// Reports, spread into the Groups list, Group page, Students list, Student page and Course page, in Chromium (derived from teacher-students-browser.cjs)
// Teacher Students screen in Chromium: the real components, the REAL middleware in front of every page and API request, the real built CSS and fonts,
// and fictional /api/student-administration and /api/study-groups services with synthetic data only. Not provider acceptance.
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME, a Firebase-mode `npm run build` (CSS, fonts) and optionally LMS_FRESH_CSS (a Tailwind compile of app/globals.css).
const { shootMatrix } = require('./screen-matrix.cjs');
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const pick = async (select, value) => { await select.click(); await select.page().locator('[role="option"][data-value="' + value + '"]').click(); };
const optionsOf = async select => { await select.click(); await select.page().waitForFunction(() => document.activeElement?.getAttribute('role') === 'listbox'); const rows = await select.page().locator('[role="option"]').evaluateAll(os => os.map(o => [o.textContent, o.getAttribute('aria-disabled') === 'true'])); await select.page().evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await select.page().keyboard.press('Escape'); await select.page().locator('[role="listbox"]').waitFor({ state: 'detached' }); return rows; };
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME || path.resolve('node_modules');
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/teacher-reports-browser'), shots = path.join(out, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the real CSS and fonts are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat([require('./harness-css.cjs')()]).join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

// ---- the real middleware.ts, run with Firebase staging on (same loader approach as scripts/teacher-settings-groups.test.cjs)
class NextResponse { constructor(kind, status, location) { this.kind = kind; this.status = status; this.location = location; this.headers = new Map(); } static next() { return new NextResponse('next', 200); } static json(_, o) { return new NextResponse('json', o.status); } static redirect(u) { return new NextResponse('redirect', 307, u.pathname); } }
function loadTs(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { module: m, exports: m.exports, URL, require: n => n === 'zod' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const middleware = loadTs('middleware.ts', {
 '@/shared/public-website': loadTs('shared/public-website.ts', { zod: require('zod') }), '@/shared/website-routes': loadTs('shared/website-routes.ts'),
 '@clerk/nextjs/server': { clerkMiddleware: () => () => { throw Error('the legacy handler must not run in Firebase staging'); }, createRouteMatcher: () => () => false },
 '@/shared/auth-config': { isFirebaseStaging: () => true }, 'next/server': { NextResponse },
}).default;
const gate = p => middleware({ nextUrl: new URL('https://platform.example' + p), url: 'https://platform.example' + p }, {});


const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { TeacherFrame } from '@/frontend/features/teacher-frame/teacher-frame';
import { TeacherStudentsView } from '@/frontend/features/teacher-students/students-view';
import { InvitePage } from '@/frontend/features/teacher-students/invite';
import { StudentDetailView } from '@/frontend/features/teacher-students/student-view';
import { StudentAccess } from '@/frontend/features/admin/users/student-access';
import { TeacherGroupsList } from '@/frontend/features/teacher-groups/list-view';
import { TeacherGroupView } from '@/frontend/features/teacher-groups/group-view';
import { TeacherCourseView } from '@/frontend/features/teacher-course/course-view';
const pathname = location.pathname, query = new URLSearchParams(location.search);
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
let lang = 'en'; try { lang = localStorage.getItem('edulabs-lms-language') === 'ar' ? 'ar' : 'en'; } catch {}
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
const choices = {
  normal: [{ courseId: uuid(10), title: 'Synthetic Maths', runId: uuid(101), published: true }, { courseId: uuid(12), title: 'Synthetic History', runId: null, published: false }, { courseId: uuid(13), title: 'Synthetic Physics', runId: null, published: true }],
  drafts: [{ courseId: uuid(12), title: 'Synthetic History', runId: null, published: false }],
  none: [],
};
function Body() {
  if (pathname === '/teacher/students') {
    const c = query.get('courses');
    return <TeacherStudentsView canInvite={c !== 'fail' && c !== 'none'} />;
  }
  if (pathname === '/teacher/students/invite') {
    const c = query.get('courses');
    return <InvitePage courses={c === 'fail' ? { ok: false, status: 503 } : { ok: true, value: choices[c === 'none' ? 'none' : c === 'drafts' ? 'drafts' : 'normal'] }} initialOffering={query.get('invite')} />;
  }
  const m = /^\\/teacher\\/students\\/([0-9a-f-]{36})$/.exec(pathname);
  if (m) return <StudentDetailView studentId={m[1]} offeringId={query.get('course')} />;
  if (pathname === '/teacher/groups') return <TeacherGroupsList />;
  const gm = /^\\/teacher\\/groups\\/([0-9a-f-]{36})$/.exec(pathname); if (gm) return <TeacherGroupView groupId={gm[1]} />;
  const cm = /^\\/teacher\\/courses\\/([0-9a-f-]{36})$/.exec(pathname);
  if (cm) { const [load, setLoad] = React.useState(null); React.useEffect(() => { fetch('/__course').then(r => r.json()).then(setLoad); }, []); return load ? <TeacherCourseView load={load} /> : null; }
  const j = /^\\/join\\/([A-Za-z0-9_-]{43})$/.exec(pathname); if (j) return <StudentAccess token={j[1]} />;
  return <p>Harness page {pathname}</p>;
}
document.documentElement.dataset.design = new URLSearchParams(location.search).get('design') === 'new' ? 'new' : 'classic';
createRoot(document.getElementById('root')).render(
 <LanguageProvider initialLanguage={lang}>
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
   <TeacherFrame><Body /></TeacherFrame>
  </ThemeProvider>
 </LanguageProvider>);
`;

// ---- fictional student-administration and Groups services (synthetic data only, relative to now)
const H = 3600000, D = 24 * H;
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const iso = t => new Date(t).toISOString();
const O = { maths: uuid(101), science: uuid(102), history: uuid(990) };
const G = { alg: uuid(1), eve: uuid(2), old: uuid(3), sci: uuid(4) };
const stu = i => uuid(2000 + i);
const offerings = () => [
  { id: O.maths, name: 'Synthetic Maths run', course_title: 'Synthetic Maths', organization_name: 'Synthetic space', manage: true },
  { id: O.science, name: 'Synthetic Science run', course_title: 'Synthetic Science', organization_name: 'Synthetic space', manage: false },
];
function seed() {
  const now = Date.now();
  const roster = { [O.maths]: [], [O.science]: [] };
  for (let i = 1; i <= 30; i++) {
    const row = { id: uuid(4000 + i), user_id: stu(i), display_name: i === 7 ? 'طالب تجريبي' : 'Synthetic student ' + String(i).padStart(2, '0'), status: 'active', version: i, expires_at: null };
    if (i === 3) row.status = 'suspended';
    if (i === 4) row.expires_at = iso(now - 5 * D);
    roster[O.maths].push(row);
  }
  for (let i = 1; i <= 5; i++) roster[O.science].push({ id: uuid(4500 + i), user_id: stu(100 + i), display_name: 'Synthetic pupil ' + i, status: 'active', version: 0, expires_at: null });
  const requests = {
    [O.maths]: [{ id: uuid(3101), user_id: uuid(3001), display_name: 'Synthetic applicant One', status: 'pending', version: 1, created_at: iso(now - 3 * D) }, { id: uuid(3102), user_id: uuid(3002), display_name: 'طالب جديد', status: 'pending', version: 1, created_at: iso(now - 2 * D) }],
    [O.science]: [{ id: uuid(3103), user_id: uuid(3003), display_name: 'Synthetic applicant Three', status: 'pending', version: 1, created_at: iso(now - D) }],
  };
  const groups = {
    [G.alg]: { id: G.alg, offering_id: O.maths, offering_name: 'Synthetic Maths run', name: 'Synthetic Algebra Group', description: '', mode: 'center', location: 'Room 4', join_url: '', instructions: '', capacity: 20, status: 'active', version: 3, staff: true, instructor: true },
    [G.eve]: { id: G.eve, offering_id: O.maths, offering_name: 'Synthetic Maths run', name: 'Synthetic Evening Group', description: '', mode: 'online', location: '', join_url: 'https://meet.example.test/r', instructions: '', capacity: null, status: 'active', version: 1, staff: true, instructor: true },
    [G.old]: { id: G.old, offering_id: O.maths, offering_name: 'Synthetic Maths run', name: 'Synthetic Archived Group', description: '', mode: 'center', location: 'Room 1', join_url: '', instructions: '', capacity: 10, status: 'archived', version: 2, staff: true, instructor: true },
    [G.sci]: { id: G.sci, offering_id: O.science, offering_name: 'Synthetic Science run', name: 'Synthetic Science Group', description: '', mode: 'online', location: '', join_url: 'https://meet.example.test/s', instructions: '', capacity: null, status: 'active', version: 1, staff: true, instructor: false },
  };
  const members = { [G.alg]: [], [G.eve]: [], [G.old]: [], [G.sci]: [] };
  for (let i = 1; i <= 10; i++) members[G.alg].push({ id: uuid(5000 + i), user_id: stu(i), display_name: roster[O.maths][i - 1].display_name, starts_at: iso(now - 30 * D), ends_at: null, eligible: true });
  members[G.alg].push({ id: uuid(5100), user_id: stu(11), display_name: 'Synthetic student 11', starts_at: iso(now - 60 * D), ends_at: iso(now - 20 * D), eligible: true });
  for (let i = 101; i <= 105; i++) members[G.sci].push({ id: uuid(5200 + i), user_id: stu(i), display_name: roster[O.science][i - 101].display_name, starts_at: iso(now - 30 * D), ends_at: null, eligible: true });
  const history = [
    { user_id: stu(1), status: 'attended', session_id: uuid(7001), title: 'Lesson A', starts_at: iso(now - 9 * D) },
    { user_id: stu(1), status: 'absent', session_id: uuid(7002), title: 'Lesson B', starts_at: iso(now - 6 * D) },
    { user_id: stu(1), status: 'not_marked', session_id: uuid(7003), title: 'Lesson C', starts_at: iso(now - 3 * D) },
    { user_id: stu(1), status: 'attended', session_id: uuid(7004), title: 'Lesson D', starts_at: iso(now - 12 * D) },
    { user_id: stu(2), status: 'absent', session_id: uuid(7001), title: 'Lesson A', starts_at: iso(now - 9 * D) },
  ];
  const links = { [O.maths]: [{ id: uuid(6001), kind: 'request', expires_at: iso(now + 4 * D), revoked_at: null, claimed_at: null }, { id: uuid(6002), kind: 'request', expires_at: iso(now - D), revoked_at: null, claimed_at: null }], [O.science]: [], [O.history]: [] };
  return { roster, requests, groups, members, history, links };
}
const R = { mode: 'normal', delay: 0 };
const S = { inspect: 'ok', fail: {}, groupAdd: 'ok', suspend: 'ok', lost: false, posts: [], admin: [], tokens: [], saved: new Map(), data: seed(), offeringsEmpty: false, emptyRoster: false };
const reset = () => { Object.assign(S, { inspect: 'ok', fail: {}, groupAdd: 'ok', suspend: 'ok', lost: false, posts: [], admin: [], tokens: [], saved: new Map(), data: seed(), offeringsEmpty: false, emptyRoster: false }); };
const take = key => { if ((S.fail[key] || 0) > 0) { S.fail[key]--; return true; } return false; };
const PAGE = 25;
class Fail { constructor(status) { this.status = status; } }
const keyOf = r => (r.display_name || '').toLowerCase() + '\u0000' + r.id;

function administration(body) {
  const { action, offeringId, subjectId, version, requestId, data } = body, now = Date.now();
  const known = offerings().find(o => o.id === offeringId);
  if (!/^(offerings|roster|requests|links|approve|reject|suspend|reactivate|link|revoke-link|inspect)$/.test(action)) throw new Fail(400);
  if (action === 'inspect') { if (S.inspect !== 'ok') throw new Fail(S.inspect); return { name: 'Synthetic Maths', organization: 'Synthetic space', kind: 'request', expiresAt: iso(now + D), enrolled: false, requestStatus: null }; }
  if (action === 'offerings') { if (take('offerings')) throw new Fail(503); return { page: 0, rows: S.offeringsEmpty ? [] : offerings() }; }
  const writes = ['approve', 'reject', 'suspend', 'reactivate', 'link', 'revoke-link'];
  if (writes.includes(action)) {
    if (!requestId) throw new Fail(400);
    if (S.saved.has(requestId)) return S.saved.get(requestId);
    S.admin.push({ action, offeringId, subjectId, version, requestId, data });
    if (!known && !(action === 'link' || action === 'revoke-link')) throw new Fail(403);
    if (known && !known.manage) throw new Fail(403);
  } else if (!known && action !== 'links') throw new Fail(403);
  const done = value => { if (requestId) S.saved.set(requestId, value); if (S.lost && writes.includes(action)) { S.lost = false; throw new Fail('lost'); } return value; };
  if (action === 'roster') {
    if (take('roster:' + offeringId)) throw new Fail(503);
    const q = (data.search || '').toLowerCase(), filter = data.filter || 'all';
    let rows = S.emptyRoster ? [] : S.data.roster[offeringId].filter(r => !q || (r.display_name || '').toLowerCase().includes(q));
    rows = rows.filter(r => filter === 'all' || (filter === 'active' ? r.status === 'active' && !(r.expires_at && Date.parse(r.expires_at) <= now) : filter === 'expired' ? r.expires_at && Date.parse(r.expires_at) <= now : r.status === filter));
    rows = [...rows].sort((a, b) => keyOf(a) < keyOf(b) ? -1 : 1);
    return { manage: known.manage, page: data.page, rows: rows.slice(data.page * PAGE, data.page * PAGE + PAGE) };
  }
  if (action === 'requests') {
    if (take('requests:' + offeringId)) throw new Fail(503);
    return { manage: known.manage, page: 0, rows: S.data.requests[offeringId].filter(r => data.filter === 'all' || r.status === data.filter) };
  }
  if (action === 'links') { if (take('links')) throw new Fail(503); if (known && !known.manage) throw new Fail(403); return S.data.links[offeringId] || []; }
  if (action === 'approve' || action === 'reject') {
    const r = S.data.requests[offeringId].find(x => x.user_id === subjectId && x.status === 'pending');
    if (!r || r.version !== version) throw new Fail(409);
    if (action === 'reject' && !String(data.reason || '').trim()) throw new Fail(400);
    r.status = action === 'approve' ? 'approved' : 'rejected'; r.version++;
    if (action === 'approve') S.data.roster[offeringId].push({ id: uuid(9000 + S.data.roster[offeringId].length), user_id: subjectId, display_name: r.display_name, status: 'active', version: 0, expires_at: null });
    return done({ id: r.id, status: r.status, version: r.version });
  }
  if (action === 'suspend' || action === 'reactivate') {
    if (S.suspend === 'changed') throw new Fail(409);
    const row = S.data.roster[offeringId].find(x => x.user_id === subjectId);
    if (!row || row.version !== version) throw new Fail(409);
    row.status = action === 'suspend' ? 'suspended' : 'active'; row.version++; if (action === 'reactivate') row.expires_at = null;
    return done({ id: row.id, status: row.status, version: row.version });
  }
  if (action === 'link') {
    if (!/^[A-Za-z0-9_-]{43}$/.test(data.token)) throw new Fail(400);
    if (data.kind !== 'request' || data.recipientId !== null) throw new Fail(400);
    const days = (Date.parse(data.expiresAt) - now) / D; if (days > 30.01 || days < 0) throw new Fail(400);
    S.tokens.push(data.token);
    (S.data.links[offeringId] ||= []).unshift({ id: uuid(6100 + S.tokens.length), kind: 'request', expires_at: data.expiresAt, revoked_at: null, claimed_at: null });
    return done({ id: uuid(6100 + S.tokens.length), expires_at: data.expiresAt });
  }
  if (action === 'revoke-link') {
    const l = (S.data.links[offeringId] || []).find(x => x.id === data.linkId); if (!l) throw new Fail(409);
    l.revoked_at = iso(now); return done({ ok: true });
  }
  throw new Fail(400);
}
function groupsView(body) {
  const { groupId, data: { section, page = 0, search = '' } } = body, now = Date.now();
  if (!groupId) {
    if (take('overview')) throw new Fail(503);
    const all = Object.values(S.data.groups);
    return { rows: all, page, hasMore: false, serverNow: iso(now) };
  }
  const g = S.data.groups[groupId]; if (!g) throw new Fail(403);
  if (section === 'detail') return { group: g, schedules: [{ weekday: 0, time: '17:00', durationMinutes: 90 }], serverNow: iso(now) };
  if (section === 'sessions') return { rows: [], page, hasMore: false, serverNow: iso(now) };
  if (section === 'history' && !search) { const first = (S.data.members[groupId] ?? []).find(m => m.ends_at == null); return { rows: first ? [{ user_id: first.user_id, status: 'attended' }, { user_id: first.user_id, status: 'attended' }, { user_id: first.user_id, status: 'absent' }, { user_id: first.user_id, status: 'not_marked' }] : [], page, hasMore: false }; }
  if (section === 'members') { if (take('members:' + groupId)) throw new Fail(503); return { rows: S.data.members[groupId], page, hasMore: false }; }
  if (section === 'history') { if (take('history')) throw new Fail(503); return { rows: groupId === G.alg ? S.data.history.filter(r => !search || r.user_id === search) : [], page, hasMore: false }; }
  throw new Fail(400);
}
function groupsCommand(body) {
  const { action, groupId, version, data } = body, g = S.data.groups[groupId];
  if (action === 'course-run') return { offeringId: O.history };
  if (!g) throw new Fail(403);
  if (action === 'add') {
    if (S.groupAdd === 'fail') throw new Fail(503);
    if (version !== g.version) throw new Fail(409);
    S.data.members[groupId].unshift({ id: uuid(8000 + S.data.members[groupId].length), user_id: data.userId, display_name: 'added', starts_at: iso(Date.now()), ends_at: null, eligible: true }); g.version++;
    return { id: g.id, version: g.version };
  }
  throw new Fail(404);
}

(async () => {
 const stubs = {
  '@/frontend/components/providers/use-loading-router': 'export const useLoadingRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() { window.__refreshes = (window.__refreshes || 0) + 1; } });',
  'next/navigation': 'window.__refreshes = window.__refreshes || 0; export const usePathname = () => location.pathname; export const useRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() { window.__refreshes++; } });',
  'next/link': 'import React from "react"; export default function Link({ href, children, onClick, ...rest }) { return React.createElement("a", { ...rest, href, onClick: e => { onClick && onClick(e); if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); location.assign(href); } }, children); }',
  'next/image': 'import React from "react"; export default function Image({ unoptimized, fill, priority, ...p }) { return React.createElement("img", p); }',
  '@/shared/auth-config': 'export const isFirebaseStaging = () => true;',
  '@/frontend/components/providers/application-auth-provider': 'export const useApplicationAuth = () => ({ user: { fullName: "Synthetic Teacher", email: "synthetic.teacher@example.test", imageUrl: null, id: "u" }, openUserProfile() { window.__profileOpened = true; }, signOut: async () => { window.__signedOut = true; }, accountStatus: { loading: false } }); export const useWebsiteNavigation = () => ({ viewer: { id: "v", displayName: "Synthetic Viewer" }, organizations: [{ id: "00000000-0000-4000-8000-000000000050", name: "Synthetic space" }], staffOrganizationIds: ["00000000-0000-4000-8000-000000000050"] }); export const WebsiteNavigationProvider = ({ children }) => children;',
  '@/frontend/components/providers/v2-identity': 'import React from "react"; export const useUser = () => ({ user: { fullName: "Synthetic Teacher" } }); export const useClerk = () => ({ signOut() {} }); export const UserButton = () => React.createElement("span", { className: "h-9 w-9 rounded-full border-2 border-black" });',
 };
 const resolveAlias = p => { for (const c of [p + '.tsx', p + '.ts', path.join(p, 'index.tsx'), path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return p; };
 await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: path.join(out, 'app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'boundary', setup(b) {
   b.onResolve({ filter: /.*/ }, a => { if (stubs[a.path]) return { path: a.path, namespace: 'stub' }; if (a.path.startsWith('@/')) return { path: resolveAlias(path.resolve(a.path.slice(2))) }; });
   b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'jsx', resolveDir: process.cwd() }));
  } }] });


 const requests = [], tokenSeen = [];
 const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (value, status = 200, headers = {}) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); for (const [k, v] of Object.entries(headers)) res.setHeader(k, v); res.end(JSON.stringify(value)); };
  if (url.pathname === '/__app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
  if (url.pathname === '/__style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
  if (url.pathname === '/__ctl') { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => { const b = JSON.parse(Buffer.concat(parts) || '{}'); if (b.reset) { reset(); R.mode = 'normal'; R.delay = 0; require('./reports-fixture.cjs').reset(); } if ('reports' in b) R.mode = b.reports; if ('delay' in b) R.delay = b.delay; for (const k of ['groupAdd', 'suspend', 'lost', 'offeringsEmpty', 'emptyRoster', 'inspect']) if (k in b) S[k] = b[k]; Object.assign(S.fail, b.fail || {}); send({}); }); return; }
  if (url.pathname === '/__course') return send({ state: 'ready', course: { id: uuid(10), organizationId: uuid(50), spaceName: 'Synthetic space', showSpace: false, title: 'Synthetic Maths', description: 'A synthetic course.', status: 'published', updatedAt: '2026-11-05T09:00:00.000000+00:00', canEdit: true } });
  if (url.pathname === '/__state') return send({ posts: S.posts, admin: S.admin, tokens: S.tokens, requests, roster: S.data.roster, links: S.data.links });
  requests.push(req.method + ' ' + req.url);
  const decision = gate(url.pathname);
  if (decision.kind === 'json') return send({ error: 'This legacy workflow is unavailable in Firebase staging.' }, decision.status);
  if (decision.kind === 'redirect') { res.statusCode = 307; res.setHeader('Location', decision.location); return res.end(); }
  const readBody = cb => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => cb(JSON.parse(Buffer.concat(parts) || '{}'))); };
  const run = (fn, body) => { try { send(fn(body)); } catch (e) { if (e instanceof Fail) { if (e.status === 'lost') return req.socket.destroy(); return send({ error: 'x' }, e.status); } throw e; } };
  if (url.pathname === '/api/student-administration' && req.method === 'POST') return readBody(b => run(administration, b));
  if (url.pathname === '/api/study-groups' && req.method === 'POST') return readBody(b => { if (b.action !== 'view') S.posts.push(b); run(b.action === 'view' ? groupsView : groupsCommand, b); });
  if (url.pathname === '/api/study-groups/course-run' && req.method === 'POST') return readBody(b => { S.posts.push({ action: 'course-run', data: b }); run(groupsCommand, { action: 'course-run', groupId: null, data: b }); });
  if (url.pathname === '/api/teacher/academics') return send({ selected: [] });
  if (url.pathname === '/api/teacher/courses/' + uuid(10) + '/content') return send({ archived: false, canEdit: true, chapters: [], lessons: [] });
  { const report = require('./reports-fixture.cjs')(url, R); if (report) { if (R.delay) return setTimeout(() => send(report.body, report.status), R.delay); return send(report.body, report.status); } }
  if (url.pathname.startsWith('/api/')) { if (url.pathname === '/api/communications') return send({ rows: [], page: 0, unread: 0 }); if (url.pathname === '/api/user/status') return send({ user: { role: 'teacher' } }); return send({ error: 'harness: not served' }, 404); }
  // The page itself: the middleware's headers are the ones the browser sees.
  const h = decision.headers || new Map();
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); for (const [k, v] of h) res.setHeader(k, v);
  if (!h.has('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><html lang="en" data-lms-appearance><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Harness</title><link rel="stylesheet" href="/__style.css"></head><body class="${fontVars} font-sans"><div id="root"></div><script src="/__app.js"></script></body></html>`);
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 const ctl = body => fetch(origin + '/__ctl', { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
 const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
 const errors = [], results = [], external = [];
 const phone = { width: 390, height: 844 }, desktop = { width: 1440, height: 900 };
 const open = async (viewport, pathAndQuery, { lang = 'en', theme = 'light' } = {}) => {
  const context = await browser.newContext({ viewport, locale: lang });
  await context.addInitScript(([l, t]) => { try { localStorage.setItem('edulabs-lms-language', l); localStorage.setItem('edulabs-lms-appearance', t); } catch {} }, [lang, theme]);
  const page = await context.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message.slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', r => { if (r.request().url().startsWith(origin)) return r.continue(); external.push(r.request().url()); return r.abort(); });
  await page.goto(origin + pathAndQuery);
  return { page, context };
 };
 const overflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
 const only = process.env.LMS_ONLY_STEPS ? new RegExp(process.env.LMS_ONLY_STEPS) : null;
 const step = async (name, fn) => { if (only && !only.test(name)) return; try { await ctl({ reset: true }); await fn(); results.push('PASS ' + name); console.log('PASS', name); } catch (e) { console.log('FAIL', name); throw e; } };
 const shot = (page, name, full = true) => page.screenshot({ path: path.join(shots, name + '.png'), fullPage: full });
 const lum = c => { const m = c.match(/\d+(\.\d+)?/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
 const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
 const contrast = page => page.evaluate(() => { const parse = c => { const m = c.match(/[0-9.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; }; const effective = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) layers.push(c); if (c.a === 1) break; } let base = { r: 255, g: 255, b: 255 }; for (const l of layers.reverse()) base = { r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a) }; return 'rgb(' + base.r + ', ' + base.g + ', ' + base.b + ')'; }; return [...document.querySelectorAll('main p, main h1, main h2, main a, main span, main button, main dt, main dd, main li, main label')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => ({ t: e.textContent.trim().slice(0, 24), color: getComputedStyle(e).color, back: effective(e) })); }).then(pairs => pairs.filter(p => ratio(p.color, p.back) < 4.5).map(p => `${p.t} ${p.color} on ${p.back}`));
 const smallText = page => page.evaluate(() => { const bad = []; const w = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.textContent.trim()) continue; const el = n.parentElement; if (el.closest('[data-teacher-footer]')) continue; const s = parseFloat(getComputedStyle(el).fontSize); if (s < 16) bad.push(n.textContent.trim().slice(0, 30) + ':' + s); } return bad; });
 const tinyTargets = page => page.evaluate(() => [...document.querySelectorAll('main a, main button, main input, main select')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 43.5 || r.width < 43.5) && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden'; }).map(e => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
 const forbidden = /organi[sz]ation|tenant|\bslug\b|program(me)?s?\b|\bstages?\b|\bmodules?\b|\boffering|website studio|منظمة|مؤسسة|وحدة|برنامج|مرحلة/i;
 const main = page => page.locator('main').innerText();
 const tall = page => tinyTargets(page);
 const posts = () => fetch(origin + '/__state').then(r => r.json());
 const names = page => page.locator('[data-student] >> nth=0').waitFor().then(() => page.locator('[data-student]').evaluateAll(els => els.map(e => e.querySelector('a span span').textContent.trim())));
 const waitSettled = async page => { await page.waitForFunction(() => !document.querySelector('[data-state="loading"],[data-skeleton]') && ![...document.querySelectorAll('[data-student-groups]')].some(e => /Loading Groups/i.test(e.textContent))); };
 const checkClean = async (page, label, { skipSmall = false } = {}) => {
  assert.ok(await overflow(page), 'no horizontal scroll ' + label); assert.deepEqual(await tall(page), [], '48px targets ' + label); assert.doesNotMatch(await main(page), forbidden, 'wording ' + label);
 };

 // ------------------------------------------------------------------ helpers of this harness
 let probes = 0;
 const AR = lang => lang === 'ar';
 const monthPick = async page => { const select = page.locator('[data-month-picker] [role="combobox"]').first(); await select.waitFor(); return select; };
 // Layout shift while the numbers load: the sum of the browser's own layout-shift entries (input-free), read after the page settles.
 const watchShift = page => page.addInitScript(() => { window.__cls = 0; try { new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; (window.__shifts ||= []).push([Math.round(e.startTime), e.value.toFixed(3), (e.sources || []).map(x => (x.node && (x.node.nodeName + '.' + (x.node.className || '').toString().slice(0, 30) + ' ' + (x.node.textContent || '').slice(0, 20))) + ' ' + Math.round(x.previousRect.y) + '>' + Math.round(x.currentRect.y)).join(' | ')]); } }).observe({ type: 'layout-shift', buffered: true }); } catch {} });
 const shiftOf = page => page.evaluate(() => window.__cls || 0);
 const gl = (lang, theme, size) => `${lang}-${theme}-${size}`;
 // A Group's name link is the title of a card that is itself the target (the same exception the screen matrix makes).
 const tiny = page => page.evaluate(() => [...document.querySelectorAll('main a, main button, main input, main select, main [role="combobox"], main [role="radio"], main [role="tab"]')].filter(e => { const r = e.getBoundingClientRect(); return r.width && !e.matches('.d-group-link') && (r.height < 43.5 || r.width < 43.5) && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden'; }).map(e => (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
 const under12 = page => page.evaluate(() => { const bad = []; const w = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const words = n.textContent.trim(); const el = n.parentElement; if (!words || el.closest('.sr-only, [hidden]')) continue; const r = el.getBoundingClientRect(); if (!r.width || getComputedStyle(el).visibility === 'hidden') continue; const size = parseFloat(getComputedStyle(el).fontSize); if (size < 12) bad.push(words.slice(0, 30) + ':' + size); } return bad; });
 const clean = async (page, label) => { assert.ok(await overflow(page), 'no horizontal scroll ' + label); assert.deepEqual(await tiny(page), [], '44px targets ' + label); assert.doesNotMatch(await main(page), forbidden, 'wording ' + label); assert.deepEqual(await under12(page), [], '12px text ' + label); };
 const reportRequests = () => requests.filter(r => /\/api\/teacher\/reports\//.test(r));

 // ------------------------------------------------------------------ the route and the middleware
 await step('Middleware: the five report routes are reachable (no other lookalike is), and the report reads are the only new API', async () => {
  const get = p => fetch(origin + p, { redirect: 'manual' });
  assert.equal(gate('/api/teacher/reports/groups').kind, 'next'); assert.equal(gate('/api/teacher/reports/attention').kind, 'next');
  for (const p of ['groups', 'students', 'courses']) assert.equal(gate(`/api/teacher/reports/${p}/${uuid(5)}`).kind, 'next', p);
  for (const bad of ['/api/teacher/reports', '/api/teacher/reports/', '/api/teacher/reports/groups/x', '/api/teacher/reports/other', `/api/teacher/reports/students/${uuid(5)}/x`]) assert.notEqual(gate(bad).kind, 'next', bad);
  assert.equal((await get('/api/teacher/reports/groups?groups=' + G.alg)).status, 200);
  assert.equal((await get('/teacher/reports')).status, 307, 'there is no Reports page');
  probes = requests.length;
 });

 // ------------------------------------------------------------------ 1. the Groups list
 await step('Groups list: each Group shows this month\'s three numbers and a "N need attention" pill; a Group with nothing says "No numbers yet"; one read for the whole list', async () => {
  const before = reportRequests().length;
  const { page, context } = await open(desktop, '/teacher/groups'); await page.locator('[data-group-card]').first().waitFor(); await page.locator('[data-report-line]').first().waitFor();
  await waitSettled(page);
  const lines = await page.locator('[data-report-line]').allInnerTexts();
  assert.equal(lines.length, 3, 'one line per active Group');
  assert.match(lines[0], /Attendance 91% · Homework 84% · Exams 72%/); assert.match(lines[0], /2 need attention/);
  assert.doesNotMatch(lines[1], /need attention/); assert.match(lines[2], /No numbers yet/);
  assert.equal(reportRequests().length - before, 1, 'one read for the whole list, not one per card');
  assert.match(reportRequests().at(-1), /^GET \/api\/teacher\/reports\/groups\?groups=/);
  assert.doesNotMatch(await main(page), forbidden, 'wording');
  await shot(page, 'reports-groups-list-en-light-1440'); await context.close();
 });
 await step('Groups list on a phone, English and Arabic, light and dark: no sideways scroll, 44px targets, 12px text, contrast, mirrored', async () => {
  for (const [lang, theme] of [['en', 'light'], ['ar', 'light'], ['en', 'dark'], ['ar', 'dark']]) {
   const { page, context } = await open(phone, '/teacher/groups', { lang, theme }); await page.locator('[data-report-line]').first().waitFor(); await waitSettled(page);
   await clean(page, 'groups list phone ' + gl(lang, theme, 390));
   if (lang === 'ar') { assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.match(await main(page), /الحضور/); assert.match(await main(page), /لا توجد أرقام بعد/); }
   if (theme === 'dark') await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
   assert.deepEqual(await contrast(page), [], 'contrast ' + lang + ' ' + theme);
   await shot(page, `reports-groups-list-${gl(lang, theme, 390)}`); await context.close();
  }
 });
 await step('Groups list, error: the numbers failing say so on each card with Retry, the rest of the card stays, and Retry reads again (never "No numbers yet")', async () => {
  await ctl({ reports: 'fail' });
  const { page, context } = await open(phone, '/teacher/groups'); await page.locator('[data-group-card]').first().waitFor(); await waitSettled(page);
  const alerts = page.locator('[data-group-card] [role="alert"]'); await alerts.first().waitFor();
  assert.ok(await alerts.count() >= 1); assert.doesNotMatch(await main(page), /No numbers yet/);
  assert.ok(await page.locator('[data-group-card] [data-students-count]').count() >= 1, 'the rest of the card is still there');
  await clean(page, 'groups list failed'); await shot(page, 'reports-groups-list-error-en-light-390');
  await ctl({ reports: 'normal' }); await alerts.first().getByRole('button', { name: 'Try again' }).click();
  await page.locator('[data-report-line]').first().waitFor(); assert.equal(await page.locator('[data-group-card] [role="alert"]').count(), 0); await context.close();
 });
 await step('Groups list, loading: nothing jumps while the numbers arrive', async () => {
  await ctl({ delay: 700 });
  const context = await browser.newContext({ viewport: phone }); const page = await context.newPage(); await watchShift(page); await page.route('**/*', r => r.request().url().startsWith(origin) ? r.continue() : r.abort());
  await page.goto(origin + '/teacher/groups'); await page.locator('[data-group-card]').first().waitFor(); await page.locator('[data-report-line]').first().waitFor(); await page.waitForTimeout(300);
  const cls = await shiftOf(page); assert.ok(cls < 0.1, 'layout shift ' + cls); await context.close();
 });

 // ------------------------------------------------------------------ 2. the Group page, Report tab
 await step('Group page: the Report tab (after Students, before Details) shows three numbers with counts, Needs attention (plain-word reasons, worst first), Everyone else; rows open the Student page', async () => {
  const { page, context } = await open(desktop, '/teacher/groups/' + G.alg); await page.locator('[role="tab"]').first().waitFor();
  assert.deepEqual(await page.locator('[role="tab"]').allInnerTexts(), ['Sessions', 'Students · 10', 'Report', 'Details']);
  assert.equal(await page.locator('[data-tab="report"]').getAttribute('data-tour'), 'group-report-tab');
  await page.locator('[data-tab="report"]').click(); await page.locator('[data-report-numbers]').waitFor(); await waitSettled(page);
  const stats = await page.locator('[data-stat]').allInnerTexts();
  assert.match(stats[0], /Attendance[\s\S]*91%[\s\S]*8 sessions/); assert.match(stats[1], /Homework[\s\S]*84%[\s\S]*6 given/); assert.match(stats[2], /Exams[\s\S]*72%[\s\S]*2 exams/);
  assert.match(await page.locator('[data-attention-list]').innerText(), /Needs attention · 2/i); assert.match(await page.locator('[data-everyone-list]').innerText(), /Everyone else · 3/i);
  const first = await page.locator('[data-attention-list] [data-report-student]').first().innerText();
  assert.match(first, /Layla Synthetic/); assert.match(first, /Missed 2 sessions/); assert.match(first, /3 homework missing/); assert.match(first, /Exams 40%/);
  assert.match(await page.locator('[data-attention-list]').innerText(), /Absent from Chapter 1 exam/);
  assert.match(await page.locator('[data-everyone-list]').innerText(), /Attendance 100% · HW 4\/4 · Exams 90%/);
  assert.doesNotMatch(await main(page), /\bpace\b/i, 'no Pace line');
  assert.doesNotMatch(await main(page), forbidden, 'wording');
  assert.match(await page.locator('[data-report-student]').first().getAttribute('href'), new RegExp('^/teacher/students/' + stu(7001).slice(0, 24) + '[0-9a-f-]{12}\\?course=' + O.maths + '$'));
  await shot(page, 'reports-group-report-en-light-1440'); await context.close();
 });
 await step('Group Report, range picker: Last 4 weeks first (the default), then this month and earlier months, Whole course last; the zone is named; choosing one reads that month', async () => {
  const { page, context } = await open(desktop, '/teacher/groups/' + G.alg); await page.locator('[data-tab="report"]').click(); await page.locator('[data-report-numbers]').waitFor();
  assert.match(await page.locator('[data-month-picker]').innerText(), /Cairo/);
  const select = await monthPick(page); await select.click(); await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'listbox');
  const options = await page.locator('[role="option"]').allInnerTexts(); assert.equal(options[0], 'Last 4 weeks'); assert.equal(options.at(-1), 'Whole course'); assert.equal(options.length, 6, options.join('|')); assert.match(await select.innerText(), /Last 4 weeks/, 'the default');
  await page.locator('[role="option"]').nth(1).click(); await page.waitForFunction(() => /month=\d{4}-\d{2}/.test(performance.getEntriesByType('resource').map(e => e.name).join(' ')));
  await select.click(); await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'listbox'); await page.locator('[role="option"]').last().click();
  await page.waitForFunction(() => /month=all/.test(performance.getEntriesByType('resource').map(e => e.name).join(' '))); await page.locator('[data-report-numbers]').waitFor(); await context.close();
 });
 await step('Group Report on a phone, English and Arabic, light and dark: no sideways scroll, 44px, 12px, contrast, mirrored', async () => {
  for (const [lang, theme] of [['en', 'light'], ['ar', 'light'], ['en', 'dark'], ['ar', 'dark']]) {
   const { page, context } = await open(phone, '/teacher/groups/' + G.alg, { lang, theme }); await page.locator('[data-tab="report"]').click(); await page.locator('[data-report-numbers]').waitFor(); await waitSettled(page);
   await clean(page, 'group report phone ' + gl(lang, theme, 390));
   if (lang === 'ar') { assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.match(await main(page), /يحتاجون|تحتاج انتباهًا/); assert.match(await main(page), /باقي الطلاب/); }
   if (theme === 'dark') await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
   assert.deepEqual(await contrast(page), [], 'contrast ' + lang + ' ' + theme);
   await shot(page, `reports-group-report-${gl(lang, theme, 390)}`); await context.close();
  }
 });
 await step('Group Report: an empty Group says so; a failed read says so with Retry; loading does not shift the page', async () => {
  await ctl({ reports: 'empty' });
  let { page, context } = await open(phone, '/teacher/groups/' + G.alg); await page.locator('[data-tab="report"]').click(); await page.locator('[data-group-report] [data-state="empty"]').waitFor();
  assert.match(await main(page), /No students in this period|no students/i); await clean(page, 'group report empty'); await context.close();
  await ctl({ reports: 'fail' });
  ({ page, context } = await open(phone, '/teacher/groups/' + G.alg)); await page.locator('[data-tab="report"]').click(); await page.locator('[data-group-report] [role="alert"]').waitFor();
  assert.equal(await page.locator('[data-report-numbers]').count(), 0); await clean(page, 'group report failed'); await shot(page, 'reports-group-report-error-en-light-390');
  await ctl({ reports: 'normal' }); await page.locator('[data-group-report] [role="alert"] button').click(); await page.locator('[data-report-numbers]').waitFor(); await context.close();
  await ctl({ delay: 700 });
  const c = await browser.newContext({ viewport: phone }); const p = await c.newPage(); await watchShift(p); await p.route('**/*', r => r.request().url().startsWith(origin) ? r.continue() : r.abort());
  await p.goto(origin + '/teacher/groups/' + G.alg); await p.locator('[data-tab="report"]').click(); await p.locator('[data-report-numbers]').waitFor(); await p.waitForTimeout(300);
  const cls = await shiftOf(p); assert.ok(cls < 0.1, 'layout shift ' + cls); await c.close();
 });

 // ------------------------------------------------------------------ 3. the Students list
 await step('Students list: a "Needs attention · N" chip beside the filters lists who needs attention (all Groups and No Group, this month), worst first, with Group and reasons; the chip toggles back', async () => {
  const { page, context } = await open(desktop, '/teacher/students'); await page.locator('[data-student]').first().waitFor(); await waitSettled(page);
  const chip = page.locator('[data-needs-attention-filter]'); await chip.waitFor(); assert.equal(await chip.getAttribute('data-tour'), 'needs-attention-filter');
  await page.waitForFunction(() => /Needs attention · 2/.test(document.querySelector('[data-needs-attention-filter]').textContent));
  assert.equal(await chip.getAttribute('aria-pressed'), 'false');
  await chip.click(); await page.locator('[data-attention-student]').first().waitFor(); assert.equal(await chip.getAttribute('aria-pressed'), 'true');
  const rows = await page.locator('[data-attention-student]').allInnerTexts(); assert.equal(rows.length, 2);
  assert.match(rows[0], /Layla Synthetic/); assert.match(rows[0], /Synthetic group/); assert.match(rows[0], /Missed 2 sessions/); assert.match(rows[1], /No Group/); assert.match(rows[1], /Absent from Chapter 1 exam/);
  assert.equal(await page.locator('[data-student]').count(), 0, 'the roster is replaced while the chip is on');
  assert.match(await main(page), /Last 4 weeks, all Groups/);
  assert.doesNotMatch(await main(page), forbidden, 'wording'); await shot(page, 'reports-students-attention-en-light-1440');
  await chip.click(); await page.locator('[data-student]').first().waitFor(); assert.equal(await page.locator('[data-attention-student]').count(), 0); await context.close();
 });
 await step('Students list on a phone, English and Arabic, light and dark: the chip and the attention list keep 44px, 12px, contrast, no sideways scroll', async () => {
  for (const [lang, theme] of [['en', 'light'], ['ar', 'light'], ['en', 'dark'], ['ar', 'dark']]) {
   const { page, context } = await open(phone, '/teacher/students', { lang, theme }); await page.locator('[data-student]').first().waitFor(); await waitSettled(page);
   await page.locator('[data-needs-attention-filter]').click(); await page.locator('[data-attention-student]').first().waitFor();
   await clean(page, 'students attention phone ' + gl(lang, theme, 390));
   if (lang === 'ar') { assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.match(await main(page), /يحتاجون انتباهًا/); }
   if (theme === 'dark') await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
   assert.deepEqual(await contrast(page), [], 'contrast ' + lang + ' ' + theme);
   await shot(page, `reports-students-attention-${gl(lang, theme, 390)}`); await context.close();
  }
 });
 await step('Students list: nobody needing attention says so; a failed read says so with Retry', async () => {
  await ctl({ reports: 'empty' });
  let { page, context } = await open(phone, '/teacher/students'); await page.locator('[data-student]').first().waitFor(); await page.locator('[data-needs-attention-filter]').click();
  await page.locator('[data-attention-students] [data-state="empty"]').waitFor(); assert.match(await main(page), /Nobody needs attention in the last 4 weeks/); await context.close();
  await ctl({ reports: 'fail' });
  ({ page, context } = await open(phone, '/teacher/students')); await page.locator('[data-student]').first().waitFor(); await page.locator('[data-needs-attention-filter]').click();
  await page.locator('[data-attention-students] [role="alert"]').waitFor(); assert.ok(await page.locator('[data-student]').count() === 0); await clean(page, 'attention failed'); await shot(page, 'reports-students-attention-error-en-light-390');
  await ctl({ reports: 'normal' }); await page.locator('[data-attention-students] [role="alert"] button').click(); await page.locator('[data-attention-student]').first().waitFor(); await context.close();
 });

 // ------------------------------------------------------------------ 4. the Student page
 await step('Student page: status, Groups and Suspend stay; three numbers, the month\'s sessions as P/A boxes with the day under each, Homework (mark / Missing / Open / Waiting) and Exams (score, online or paper, Absent)', async () => {
  const { page, context } = await open(desktop, `/teacher/students/${stu(1)}?course=${O.maths}`); await page.locator('[data-student-marks]').waitFor(); await page.locator('[data-student-sessions] .d-rp-mark').first().waitFor(); await waitSettled(page);
  assert.equal(await page.locator('[data-student-marks]').getAttribute('data-tour'), 'student-marks');
  assert.match(await main(page), /Synthetic Algebra Group/); assert.ok(await page.getByRole('button', { name: /Suspend/ }).count() >= 1);
  const boxes = await page.locator('[data-student-sessions] .d-rp-mark').evaluateAll(els => els.map(e => e.textContent.trim() + ':' + e.getAttribute('data-state')));
  assert.deepEqual(boxes, ['P2:present', 'A5:absent', 'P9:present', 'P12:present', 'A16:absent', 'P19:present']);
  const hw = await page.locator('[data-student-homework] [data-homework-state]').allInnerTexts();
  assert.match(hw[0], /9\/10/); assert.match(hw[1], /Missing/); assert.match(hw[2], /Waiting for marks/); assert.match(hw[3], /Open/);
  const ex = await page.locator('[data-student-exams] [data-exam-state]').allInnerTexts();
  assert.match(ex[0], /36\/40/); assert.match(ex[0], /paper/); assert.match(ex[1], /11\/20/); assert.match(ex[1], /online/); assert.match(ex[2], /Absent/);
  assert.match(await page.locator('[data-student-marks] [data-stat="homework"]').innerText(), /2\/3/);
  assert.doesNotMatch(await main(page), forbidden, 'wording');
  await shot(page, 'reports-student-marks-en-light-1440'); await context.close();
 });
 await step('Student page on a phone, English and Arabic, light and dark: no sideways scroll, 44px, 12px, contrast, mirrored, letters not colour alone', async () => {
  for (const [lang, theme] of [['en', 'light'], ['ar', 'light'], ['en', 'dark'], ['ar', 'dark']]) {
   const { page, context } = await open(phone, `/teacher/students/${stu(1)}?course=${O.maths}`, { lang, theme }); await page.locator('[data-student-sessions] .d-rp-mark').first().waitFor(); await waitSettled(page);
   await clean(page, 'student marks phone ' + gl(lang, theme, 390));
   if (lang === 'ar') { assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.match(await main(page), /الحصص/); assert.match(await main(page), /مفتوح/); assert.match(await main(page), /غائب/); }
   if (theme === 'dark') await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
   assert.deepEqual(await contrast(page), [], 'contrast ' + lang + ' ' + theme);
   assert.ok((await page.locator('[data-student-sessions] .d-rp-mark b').allInnerTexts()).every(t => t.trim().length === 1), 'a letter in every box');
   await shot(page, `reports-student-marks-${gl(lang, theme, 390)}`); await context.close();
  }
 });
 await step('Student page: nothing in the month says so; a failed read says so with Retry on its own; loading does not shift the page', async () => {
  await ctl({ reports: 'empty' });
  let { page, context } = await open(phone, `/teacher/students/${stu(1)}?course=${O.maths}`); await page.locator('[data-student-marks]').waitFor(); await waitSettled(page);
  assert.ok((await page.locator('[data-student-marks] .d-body').allInnerTexts()).filter(t => /Nothing in this period/.test(t)).length >= 3); await context.close();
  await ctl({ reports: 'fail' });
  ({ page, context } = await open(phone, `/teacher/students/${stu(1)}?course=${O.maths}`)); await page.locator('[data-student-marks] [role="alert"]').waitFor();
  await page.waitForFunction(() => /Synthetic Algebra Group/.test(document.querySelector('main').innerText)); assert.match(await main(page), /Synthetic Algebra Group/, 'the rest of the page stays'); await clean(page, 'marks failed'); await shot(page, 'reports-student-marks-error-en-light-390');
  await ctl({ reports: 'normal' }); await page.locator('[data-student-marks] [role="alert"] button').click(); await page.locator('[data-student-sessions] .d-rp-mark').first().waitFor(); await context.close();
  await ctl({ delay: 700 });
  const c = await browser.newContext({ viewport: phone }); const p = await c.newPage(); await watchShift(p); await p.route('**/*', r => r.request().url().startsWith(origin) ? r.continue() : r.abort());
  await p.goto(origin + `/teacher/students/${stu(1)}?course=${O.maths}`); await p.locator('[data-student-marks]').waitFor(); await p.waitForTimeout(250); await p.evaluate(() => { window.__cls = 0; }); /* the page's own first draw is not this section's */ await p.locator('[data-student-sessions] .d-rp-mark').first().waitFor(); await p.waitForTimeout(300);
  const cls = await shiftOf(p); if (cls >= 0.1) console.log(JSON.stringify(await p.evaluate(() => window.__shifts), null, 1)); assert.ok(cls < 0.1, 'layout shift ' + cls); await c.close();
 });

 // ------------------------------------------------------------------ 5. the Course page
 await step('Course page: a Content / Results switch; Results is one card per chapter with a bar and % per Group, "N exams · M homework", the weakest flagged, and "No marks yet" for an empty chapter', async () => {
  const { page, context } = await open(desktop, '/teacher/courses/' + uuid(10)); await page.locator('[data-course-switch]').waitFor();
  assert.equal(await page.locator('[data-course-switch]').getAttribute('data-tour'), 'course-results-switch');
  assert.ok(await page.locator('[data-course]').count() === 1 && await page.locator('[data-view="content"][aria-checked="true"]').count() === 1);
  await page.locator('[data-view="results"]').click(); await page.locator('[data-chapter]').first().waitFor(); await waitSettled(page);
  assert.equal(await page.locator('[data-chapter]').count(), 3); assert.equal(await page.locator('[data-chapter][data-weakest="true"]').count(), 1);
  const chapters = await page.locator('[data-chapter]').allInnerTexts();
  assert.match(chapters[0], /1 · Electric current/); assert.match(chapters[0], /2 exams · 3 homework/); assert.match(chapters[0], /Synthetic group[\s\S]*88%/); assert.match(chapters[0], /Online group[\s\S]*74%/);
  assert.match(chapters[1], /Weakest/); assert.match(chapters[1], /48%|52%/); assert.match(chapters[2], /No marks yet/);
  assert.doesNotMatch(await main(page), forbidden, 'wording'); await shot(page, 'reports-course-results-en-light-1440');
  await page.locator('[data-view="content"]').click(); await page.locator('[data-chapter]').waitFor({ state: 'detached' }); await context.close();
 });
 await step('Course Results on a phone, English and Arabic, light and dark: no sideways scroll, 44px, 12px, contrast, mirrored; the month picker works', async () => {
  for (const [lang, theme] of [['en', 'light'], ['ar', 'light'], ['en', 'dark'], ['ar', 'dark']]) {
   const { page, context } = await open(phone, '/teacher/courses/' + uuid(10), { lang, theme }); await page.locator('[data-view="results"]').click(); await page.locator('[data-chapter]').first().waitFor(); await waitSettled(page);
   await clean(page, 'course results phone ' + gl(lang, theme, 390));
   if (lang === 'ar') { assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.match(await main(page), /الأضعف/); assert.match(await main(page), /لا توجد درجات بعد/); }
   if (theme === 'dark') await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
   assert.deepEqual(await contrast(page), [], 'contrast ' + lang + ' ' + theme);
   await shot(page, `reports-course-results-${gl(lang, theme, 390)}`); await context.close();
  }
 });
 await step('Course Results: a course with no chapters says so; a failed read says so with Retry; loading does not shift the page', async () => {
  await ctl({ reports: 'empty' });
  let { page, context } = await open(phone, '/teacher/courses/' + uuid(10)); await page.locator('[data-view="results"]').click(); await page.locator('[data-course-results] [data-state="empty"]').waitFor(); await context.close();
  await ctl({ reports: 'fail' });
  ({ page, context } = await open(phone, '/teacher/courses/' + uuid(10))); await page.locator('[data-view="results"]').click(); await page.locator('[data-course-results] [role="alert"]').waitFor();
  await clean(page, 'course results failed'); await shot(page, 'reports-course-results-error-en-light-390');
  await ctl({ reports: 'normal' }); await page.locator('[data-course-results] [role="alert"] button').click(); await page.locator('[data-chapter]').first().waitFor(); await context.close();
  await ctl({ delay: 700 });
  const c = await browser.newContext({ viewport: phone }); const p = await c.newPage(); await watchShift(p); await p.route('**/*', r => r.request().url().startsWith(origin) ? r.continue() : r.abort());
  await p.goto(origin + '/teacher/courses/' + uuid(10)); await p.locator('[data-view="results"]').click(); await p.locator('[data-chapter]').first().waitFor(); await p.waitForTimeout(300);
  const cls = await shiftOf(p); assert.ok(cls < 0.1, 'layout shift ' + cls); await c.close();
 });
 await step('Retry after one failed read: each route fails once, then the screens recover (fail-once)', async () => {
  await ctl({ reports: 'fail-once' });
  const { page, context } = await open(phone, '/teacher/groups/' + G.alg); await page.locator('[data-tab="report"]').click(); await page.locator('[data-group-report] [role="alert"]').waitFor();
  await page.locator('[data-group-report] [role="alert"] button').click(); await page.locator('[data-report-numbers]').waitFor(); await context.close();
 });

 if (process.env.LMS_MATRIX) await step('Screen matrix: every look, theme, language and width, measured', async () => {
  const withLook = (p, look) => p + (p.includes('?') ? '&' : '?') + 'design=' + look;
  const findings = await shootMatrix({ label: 'reports', open: ({ viewport, lang, theme, look, target }) => open(viewport, withLook(target, look), { lang, theme }), screens: [
   { name: 'reports-groups-list', target: '/teacher/groups', ready: '[data-report-line]' },
   { name: 'reports-group-report', target: '/teacher/groups/' + G.alg + '?tab=report', ready: '[data-tab="report"]', act: async page => { await page.locator('[data-tab="report"]').click(); await page.locator('[data-report-numbers]').waitFor(); } },
   { name: 'reports-students-attention', target: '/teacher/students', ready: '[data-needs-attention-filter]', act: async page => { await page.locator('[data-needs-attention-filter]').click(); await page.locator('[data-attention-student]').first().waitFor(); } },
   { name: 'reports-student-marks', target: `/teacher/students/${stu(1)}?course=${O.maths}`, ready: '[data-student-sessions] .d-rp-mark' },
   { name: 'reports-course-results', target: '/teacher/courses/' + uuid(10), ready: '[data-view="results"]', act: async page => { await page.locator('[data-view="results"]').click(); await page.locator('[data-chapter]').first().waitFor(); } },
  ] });
  assert.deepEqual(findings, []);
 });

 await browser.close(); server.close();
 assert.deepEqual(errors, [], 'no uncaught or console errors');
 assert.deepEqual(external, [], 'no external requests');
 const apis = [...new Set(requests.slice(probes).filter(r => /\/api\//.test(r)).map(r => r.replace(/^(\w+) (\/[^?]*).*/, '$1 $2').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>')))].sort();
 assert.deepEqual(apis.filter(r => !/\/api\/(student-administration|study-groups(\/course-run)?|communications|user\/status|teacher\/academics|teacher\/courses\/<id>\/content|teacher\/reports\/(groups|attention|groups\/<id>|students\/<id>|courses\/<id>))$/.test(r)), [], 'the screens call no other API: ' + apis.join(', '));
 console.log(`Teacher Reports browser checks passed: ${results.length} groups (real components, real stylesheet, synthetic loopback data, not provider E2E). Screenshots: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
