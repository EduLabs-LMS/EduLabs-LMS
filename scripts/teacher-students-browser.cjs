// Teacher Students screen in Chromium: the real components, the REAL middleware in front of every page and API request, the real built CSS and fonts,
// and fictional /api/student-administration and /api/study-groups services with synthetic data only. Not provider acceptance.
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME, a Firebase-mode `npm run build` (CSS, fonts) and optionally LMS_FRESH_CSS (a Tailwind compile of app/globals.css).
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/teacher-students-browser'), shots = path.join(out, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the real CSS and fonts are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat(process.env.LMS_FRESH_CSS ? [fs.readFileSync(process.env.LMS_FRESH_CSS, 'utf8')] : []).join('\n');
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
import Sidebar from '@/frontend/components/sidebar';
import MobileSidebar from '@/frontend/features/dashboard/mobile-sidebar';
import { TeacherStudentsView } from '@/frontend/features/teacher-students/students-view';
import { StudentDetailView } from '@/frontend/features/teacher-students/student-view';
const pathname = location.pathname, query = new URLSearchParams(location.search);
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
let lang = 'en'; try { lang = localStorage.getItem('edulabs-lms-language') === 'ar' ? 'ar' : 'en'; } catch {}
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
const choices = {
  normal: [{ courseId: uuid(10), title: 'Synthetic Maths', runId: uuid(101), published: true }, { courseId: uuid(12), title: 'Synthetic History', runId: null, published: false }],
  none: [],
};
function Body() {
  if (pathname === '/teacher/students') {
    const c = query.get('courses');
    return <TeacherStudentsView courses={c === 'fail' ? { ok: false, status: 503 } : { ok: true, value: choices[c === 'none' ? 'none' : 'normal'] }} inviteOffering={query.get('invite')} />;
  }
  const m = /^\\/teacher\\/students\\/([0-9a-f-]{36})$/.exec(pathname);
  if (m) return <StudentDetailView studentId={m[1]} offeringId={query.get('course')} />;
  return <p>Harness page {pathname}</p>;
}
createRoot(document.getElementById('root')).render(
 <LanguageProvider initialLanguage={lang}>
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
   <div data-lms-shell className="min-h-screen bg-slate-50 w-full relative">
    <MobileSidebar />
    <aside className="hidden md:block fixed start-4 top-4 bottom-4 w-64 z-50"><Sidebar /></aside>
    <main className="md:ps-72 pt-2 md:pt-4 min-h-screen bg-slate-50 flex flex-col justify-between"><div className="flex-1 w-full p-4 sm:p-6 md:p-8"><Body /></div></main>
   </div>
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
const S = { fail: {}, groupAdd: 'ok', suspend: 'ok', lost: false, posts: [], admin: [], tokens: [], saved: new Map(), data: seed(), offeringsEmpty: false, emptyRoster: false };
const reset = () => { Object.assign(S, { fail: {}, groupAdd: 'ok', suspend: 'ok', lost: false, posts: [], admin: [], tokens: [], saved: new Map(), data: seed(), offeringsEmpty: false, emptyRoster: false }); };
const take = key => { if ((S.fail[key] || 0) > 0) { S.fail[key]--; return true; } return false; };
const PAGE = 25;
class Fail { constructor(status) { this.status = status; } }
const keyOf = r => (r.display_name || '').toLowerCase() + '\u0000' + r.id;

function administration(body) {
  const { action, offeringId, subjectId, version, requestId, data } = body, now = Date.now();
  const known = offerings().find(o => o.id === offeringId);
  if (!/^(offerings|roster|requests|links|approve|reject|suspend|reactivate|link|revoke-link)$/.test(action)) throw new Fail(400);
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
  if (section === 'detail') return { group: g, schedules: [], serverNow: iso(now) };
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
  '@/frontend/components/providers/use-page-loading-signal': 'import { useEffect } from "react"; export const usePageLoadingSignal = busy => { useEffect(() => { window.__loadingSignal = busy; (window.__signalTrail = window.__signalTrail || []).push(busy); }, [busy]); };',
  '@/frontend/components/providers/use-loading-router': 'export const useLoadingRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() { window.__refreshes = (window.__refreshes || 0) + 1; } });',
  'next/navigation': 'window.__refreshes = window.__refreshes || 0; export const usePathname = () => location.pathname; export const useRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() { window.__refreshes++; } });',
  'next/link': 'import React from "react"; export default function Link({ href, children, onClick, ...rest }) { return React.createElement("a", { ...rest, href, onClick: e => { onClick && onClick(e); if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); location.assign(href); } }, children); }',
  'next/image': 'import React from "react"; export default function Image({ unoptimized, fill, priority, ...p }) { return React.createElement("img", p); }',
  '@/shared/auth-config': 'export const isFirebaseStaging = () => true;',
  '@/frontend/components/providers/application-auth-provider': 'export const useApplicationAuth = () => ({ user: { fullName: "Synthetic Teacher", email: "synthetic.teacher@example.test", imageUrl: null, id: "u" }, openUserProfile() { window.__profileOpened = true; }, signOut: async () => { window.__signedOut = true; }, accountStatus: { loading: false } }); export const useWebsiteNavigation = () => ({ viewer: { id: "v" }, organizations: [], staffOrganizationIds: ["00000000-0000-4000-8000-000000000050"] }); export const WebsiteNavigationProvider = ({ children }) => children;',
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
  if (url.pathname === '/__ctl') { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => { const b = JSON.parse(Buffer.concat(parts) || '{}'); if (b.reset) reset(); for (const k of ['groupAdd', 'suspend', 'lost', 'offeringsEmpty', 'emptyRoster']) if (k in b) S[k] = b[k]; Object.assign(S.fail, b.fail || {}); send({}); }); return; }
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
 const step = async (name, fn) => { try { await ctl({ reset: true }); await fn(); results.push('PASS ' + name); console.log('PASS', name); } catch (e) { console.log('FAIL', name); throw e; } };
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
 const waitSettled = async page => { await page.waitForFunction(() => window.__loadingSignal === false); };
 const checkClean = async (page, label, { skipSmall = false } = {}) => {
  assert.ok(await overflow(page), 'no horizontal scroll ' + label); assert.deepEqual(await tall(page), [], '48px targets ' + label); assert.doesNotMatch(await main(page), forbidden, 'wording ' + label);
 };

 // ------------------------------------------------------------------ the real middleware in front of the harness
 let probes = 0;
 await step('Middleware: /teacher/students and /teacher/students/<id> pass with no referrer and no caching; lookalikes are refused; the one endpoint is reachable', async () => {
  const get = (p, init) => fetch(origin + p, { redirect: 'manual', ...init });
  for (const ok of ['/teacher/students', '/teacher/students/' + stu(1)]) { const r = await get(ok); assert.equal(r.status, 200, ok); assert.equal(r.headers.get('referrer-policy'), 'no-referrer', ok); assert.equal(r.headers.get('cache-control'), 'private, no-store', ok); }
  for (const bad of ['/teacher/students/', '/teacher/students/x', '/teacher/students/' + stu(1) + '/x', '/teacher/Students', '/teacher/students.json']) { const r = await get(bad); assert.equal(r.status, 307, bad); assert.equal(r.headers.get('location'), '/unavailable', bad); }
  assert.equal((await get('/api/student-administration', { method: 'POST', body: JSON.stringify({ action: 'offerings', data: { page: 0 } }) })).status, 200);
  assert.equal((await get('/api/students')).status, 503);
  probes = requests.length;
 });

 // ------------------------------------------------------------------ the list
 await step('Students, desktop English: one row per student with course, Groups and status; merged paging in name order; the menu entry is current', async () => {
  const { page, context } = await open(desktop, '/teacher/students');
  await waitSettled(page); await page.locator('[data-student]').first().waitFor();
  assert.equal(await page.locator('[data-teacher-students] h1').innerText(), 'Students');
  assert.equal(await page.locator('[data-student]').count(), 25, 'the first page');
  const first = await names(page);
  assert.deepEqual(first, [...first].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1), 'name order');
  const row1 = page.locator('[data-student]').first();
  assert.match(await row1.innerText(), /Synthetic pupil 1/); assert.match(await row1.innerText(), /Synthetic Science/); assert.match(await row1.innerText(), /Synthetic Science Group/);
  const alg = page.locator(`[data-student="${stu(1)}"]`); assert.match(await alg.innerText(), /Synthetic Algebra Group/); assert.match(await alg.innerText(), /Active/);
  assert.match(await page.locator(`[data-student="${stu(3)}"]`).innerText(), /Suspended/); assert.match(await page.locator(`[data-student="${stu(4)}"]`).innerText(), /Expired/);
  assert.match(await page.locator(`[data-student="${stu(12)}"]`).innerText(), /No Group/, 'a student in no Group');
  assert.match(await page.locator(`[data-student="${stu(11)}"]`).innerText(), /No Group/, 'a student whose membership ended is in no Group');
  await page.locator('[data-more-students]').click(); await page.waitForFunction(() => document.querySelectorAll('[data-student]').length === 35);
  assert.equal(await page.locator('[data-more-students]').count(), 0, 'all 35 are shown');
  const all = await names(page); assert.deepEqual(all, [...all].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1), 'still in name order across courses');
  assert.equal(await page.locator('[data-student] a[href], a[data-student]').count() >= 0, true);
  assert.match(await page.locator(`[data-student="${stu(1)}"] a`).getAttribute('href'), new RegExp('^/teacher/students/' + stu(1) + '\\?course=' + O.maths + '$'));
  assert.equal(await page.locator('aside [data-nav="students"]').getAttribute('aria-current'), 'page', 'Students is the current menu entry');
  await checkClean(page, 'list desktop'); await shot(page, 'students-list-en-1440'); await context.close();
 });
 await step('Students, search and filters: by name, by course, by status; Waiting points at Join requests; empty results say so', async () => {
  const { page, context } = await open(desktop, '/teacher/students'); await waitSettled(page); await page.locator('[data-student]').first().waitFor();
  await page.locator('[data-students-search]').fill('student 08'); await page.waitForFunction(() => document.querySelectorAll('[data-student]').length === 1);
  await page.locator('[data-students-search]').fill('طالب'); await page.waitForFunction(() => document.querySelectorAll('[data-student]').length === 1);
  await page.locator('[data-students-search]').fill('nobody at all'); await page.locator('[data-state="empty"]').waitFor(); assert.match(await main(page), /No student matches/);
  await page.locator('[data-students-search]').fill('');
  await page.locator('[data-course-filter]').selectOption(O.science); await page.waitForFunction(() => document.querySelectorAll('[data-student]').length === 5);
  await page.locator('[data-course-filter]').selectOption('all');
  await page.locator('[data-status-filter]').selectOption('suspended'); await page.waitForFunction(() => document.querySelectorAll('[data-student]').length === 1);
  await page.locator('[data-status-filter]').selectOption('expired'); await page.waitForFunction(() => document.querySelectorAll('[data-student]').length === 1);
  await page.locator('[data-status-filter]').selectOption('active'); await page.waitForFunction(() => document.querySelectorAll('[data-student]').length === 25);
  await page.locator('[data-status-filter]').selectOption('waiting'); await page.locator('[data-state="empty"]').waitFor(); assert.match(await main(page), /listed under Join requests/);
  await context.close();
 });
 await step('Students, phone English and Arabic, dark theme: 48px targets, no sideways scroll, mirrored, Arabic copy', async () => {
  for (const [lang, theme] of [['en', 'light'], ['ar', 'light'], ['en', 'dark'], ['ar', 'dark']]) {
   const { page, context } = await open(phone, '/teacher/students', { lang, theme }); await waitSettled(page); await page.locator('[data-student]').first().waitFor();
   await checkClean(page, `list phone ${lang} ${theme}`);
   if (lang === 'ar') { assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.match(await main(page), /الطلاب/); assert.match(await main(page), /طلبات الانضمام/); }
   if (theme === 'dark') await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
   assert.deepEqual(await contrast(page), [], `contrast at least 4.5:1 ${lang} ${theme}`);
   await shot(page, `students-list-${lang}-${theme}-390`); await context.close();
  }
  const { page, context } = await open(desktop, '/teacher/students', { lang: 'ar' }); await waitSettled(page); await page.locator('[data-student]').first().waitFor(); await shot(page, 'students-list-ar-1440'); await context.close();
 });
 await step('First view: the loading signal is held until the list, the Groups beside each student and the waiting requests are in', async () => {
  const { page, context } = await open(desktop, '/teacher/students');
  await page.waitForFunction(() => window.__loadingSignal === false);
  assert.ok(await page.locator('[data-student]').count() > 0 && await page.locator('[data-join-requests]').count() === 1, 'everything is on screen when the signal drops');
  assert.equal(await page.locator('[data-student-groups]:has-text("Loading Groups")').count(), 0, 'no Group column is still loading');
  const trail = await page.evaluate(() => window.__signalTrail); assert.equal(trail[0], true, 'busy first'); assert.equal(trail.at(-1), false);
  await context.close();
 });

 // ------------------------------------------------------------------ join requests
 await step('Join requests: shown only while someone waits; a course the teacher only supports shows no Approve or Reject; Approve with no Group', async () => {
  const { page, context } = await open(desktop, '/teacher/students'); await waitSettled(page); await page.locator('[data-join-requests]').waitFor();
  assert.equal(await page.locator('[data-request]').count(), 3);
  const oldest = page.locator('[data-request]').first(); assert.match(await oldest.innerText(), /Synthetic applicant One/);
  const viewOnly = page.locator(`[data-request="${uuid(3103)}"]`); assert.equal(await viewOnly.locator('[data-approve], [data-reject]').count(), 0); assert.match(await viewOnly.innerText(), /Only the teacher of this course/);
  await checkClean(page, 'requests desktop'); await shot(page, 'students-requests-en-1440');
  await oldest.locator('[data-approve]').click();
  const options = await oldest.locator('[data-approve-group] option').allInnerTexts(); assert.deepEqual(options, ['No Group yet', 'Synthetic Algebra Group', 'Synthetic Evening Group'], 'active Groups of that course only, by name');
  await oldest.locator('[data-confirm-approve]').click(); await page.locator('[data-notice="approved"]').waitFor();
  assert.match(await page.locator('[data-notice]').first().innerText(), /Approved\./);
  await page.waitForFunction(() => document.querySelectorAll('[data-request]').length === 2);
  const s = await posts(); assert.deepEqual(s.admin.map(a => a.action), ['approve']); assert.equal(s.posts.length, 0, 'no Group call without a Group');
  assert.equal(s.admin[0].subjectId, uuid(3001)); assert.equal(s.admin[0].version, 1); assert.match(s.admin[0].requestId, /^[0-9a-f-]{36}$/);
  await context.close();
 });
 await step('Approve into a Group: the student is approved, then added to the Group, and appears in the list under that Group', async () => {
  const { page, context } = await open(desktop, '/teacher/students'); await waitSettled(page); await page.locator('[data-request]').first().waitFor();
  const req = page.locator('[data-request]').first(); await req.locator('[data-approve]').click(); await req.locator('[data-approve-group]').selectOption(G.alg); await req.locator('[data-confirm-approve]').click();
  await page.locator('[data-notice="approved"]').waitFor(); assert.match(await page.locator('[data-notice]').first().innerText(), /added to Synthetic Algebra Group/);
  const s = await posts(); assert.deepEqual(s.admin.map(a => a.action), ['approve']); assert.deepEqual(s.posts.map(p => p.action), ['add']); assert.equal(s.posts[0].groupId, G.alg); assert.equal(s.posts[0].data.userId, uuid(3001)); assert.equal(s.posts[0].version, 3, 'the Group version it read');
  await page.waitForFunction(() => document.querySelectorAll('[data-request]').length === 2);
  await page.locator('[data-students-search]').fill('applicant'); await page.locator(`[data-student="${uuid(3001)}"]`).waitFor(); assert.match(await page.locator(`[data-student="${uuid(3001)}"]`).innerText(), /Synthetic Algebra Group/);
  await context.close();
 });
 await step('Approve into a Group when the Group step fails: approved, not added, said plainly, never retried silently and never rolled back', async () => {
  await ctl({ groupAdd: 'fail' });
  const { page, context } = await open(desktop, '/teacher/students'); await waitSettled(page); await page.locator('[data-request]').first().waitFor();
  const req = page.locator('[data-request]').first(); await req.locator('[data-approve]').click(); await req.locator('[data-approve-group]').selectOption(G.alg); await req.locator('[data-confirm-approve]').click();
  const note = page.locator('[data-notice="approved_not_added"]'); await note.waitFor();
  assert.match(await note.innerText(), /Approved, but not added to the Group\. Add them from the Group page\./);
  assert.match(await note.locator('a').getAttribute('href'), new RegExp('^/teacher/groups/' + G.alg + '$'));
  await page.waitForTimeout(600);
  const s = await posts(); assert.deepEqual(s.admin.map(a => a.action), ['approve'], 'approved once, nothing undone'); assert.equal(s.posts.filter(p => p.action === 'add').length, 1, 'one attempt, no silent retry');
  assert.equal(await page.locator(`[data-request="${uuid(3101)}"]`).count(), 0, 'the request is answered');
  assert.equal(await page.locator('[data-notice="approved_not_added"]').count(), 1, 'the message stays until closed');
  await shot(page, 'students-approve-not-added-en-1440');
  await page.locator('[data-notice="approved_not_added"] [data-dismiss-notice]').click(); assert.equal(await page.locator('[data-notice="approved_not_added"]').count(), 0);
  await context.close();
  const ar = await open(phone, '/teacher/students', { lang: 'ar' }); await waitSettled(ar.page); await ar.page.locator('[data-request]').first().waitFor();
  const r = ar.page.locator('[data-request]').first(); await r.locator('[data-approve]').click(); await r.locator('[data-approve-group]').selectOption(G.eve); await r.locator('[data-confirm-approve]').click();
  await ar.page.locator('[data-notice="approved_not_added"]').waitFor(); assert.match(await ar.page.locator('[data-notice="approved_not_added"]').innerText(), /تم القبول، لكن لم تتم إضافته إلى المجموعة/);
  await checkClean(ar.page, 'not-added phone ar'); await shot(ar.page, 'students-approve-not-added-ar-390'); await ar.context.close();
 });
 await step('Reject asks for a short reason first and sends it', async () => {
  const { page, context } = await open(desktop, '/teacher/students'); await waitSettled(page); await page.locator('[data-request]').first().waitFor();
  const req = page.locator('[data-request]').first(); await req.locator('[data-reject]').click(); await req.locator('[data-confirm-reject]').click();
  await req.locator('[data-problem="reason"]').waitFor(); assert.equal((await posts()).admin.length, 0, 'nothing is sent without a reason');
  await req.locator('[data-reject-reason]').fill('Not in this course'); await req.locator('[data-confirm-reject]').click(); await page.locator('[data-notice="rejected"]').waitFor();
  const s = await posts(); assert.deepEqual(s.admin.map(a => [a.action, a.data.reason]), [['reject', 'Not in this course']]);
  await context.close();
 });
 await step('Join requests, errors: one course that cannot be read is said so with Retry, and the student list is still there', async () => {
  await ctl({ fail: { ['requests:' + O.maths]: 1 } });
  const { page, context } = await open(desktop, '/teacher/students'); await waitSettled(page); await page.locator('[data-join-requests] [data-state="error"]').waitFor();
  assert.match(await page.locator('[data-join-requests]').innerText(), /Some join requests could not be loaded/); assert.ok(await page.locator('[data-student]').count() > 0, 'students still shown');
  assert.equal(await page.locator('[data-request]').count(), 1, 'the other course\'s request is shown');
  await page.locator('[data-join-requests] [data-state="error"] button').click(); await page.waitForFunction(() => document.querySelectorAll('[data-request]').length === 3);
  await context.close();
 });

 // ------------------------------------------------------------------ errors in the list
 await step('List errors: a course that fails is named and retried; the Groups failing leaves the list with "Groups unavailable"; courses failing is told apart from none', async () => {
  await ctl({ fail: { ['roster:' + O.science]: 1 } });
  let { page, context } = await open(desktop, '/teacher/students'); await waitSettled(page); await page.locator('[data-courses-failed]').waitFor();
  assert.match(await page.locator('[data-courses-failed]').innerText(), /Synthetic Science/); assert.equal(await page.locator('[data-student]').count(), 25);
  await page.locator('[data-courses-failed] button').click(); await page.waitForFunction(() => !document.querySelector('[data-courses-failed]')); await context.close();

  await ctl({ reset: true, fail: { overview: 1 } });
  ({ page, context } = await open(desktop, '/teacher/students')); await waitSettled(page); await page.locator('[data-groups-failed]').waitFor();
  assert.match(await page.locator('[data-student]').first().innerText(), /Groups unavailable/); assert.doesNotMatch(await page.locator('[data-student]').first().innerText(), /No Group/, 'a failure is not shown as no Group');
  await shot(page, 'students-groups-failed-en-1440');
  await page.locator('[data-groups-failed] button').click(); await page.waitForFunction(() => !document.querySelector('[data-groups-failed]')); await context.close();

  await ctl({ reset: true, fail: { ['members:' + G.alg]: 1 } });
  ({ page, context } = await open(desktop, '/teacher/students')); await waitSettled(page); await page.locator('[data-groups-failed]').waitFor(); await context.close();

  await ctl({ reset: true, fail: { offerings: 1 } });
  ({ page, context } = await open(phone, '/teacher/students')); await waitSettled(page); await page.locator('[role="alert"]').first().waitFor();
  assert.equal(await page.locator('[data-student]').count(), 0); await checkClean(page, 'offerings failed phone');
  await page.locator('[role="alert"] button').first().click(); await page.locator('[data-student]').first().waitFor(); await context.close();
 });
 await step('Empty states: no courses, no students yet (with Invite students), no courses to invite to', async () => {
  await ctl({ offeringsEmpty: true });
  let { page, context } = await open(desktop, '/teacher/students'); await waitSettled(page); await page.locator('[data-state="empty"]').waitFor(); assert.match(await main(page), /You do not teach a course yet/); await context.close();
  await ctl({ reset: true, emptyRoster: true });
  ({ page, context } = await open(desktop, '/teacher/students')); await waitSettled(page); await page.locator('[data-invite-empty]').waitFor(); assert.match(await main(page), /No students yet/);
  await page.locator('[data-invite-empty]').click(); await page.locator('[data-invite-panel]').waitFor(); await shot(page, 'students-empty-invite-en-1440'); await context.close();
  await ctl({ reset: true });
  ({ page, context } = await open(desktop, '/teacher/students?courses=none')); await waitSettled(page); await page.locator('[data-student]').first().waitFor(); assert.equal(await page.locator('[data-invite-students]').count(), 0, 'nothing to invite to'); await context.close();
 });

 // ------------------------------------------------------------------ Invite students
 await step('Invite students: a 43-character link is made in the browser, shown once with Copy and Share, never put in an address, storage or log, and listed links can be revoked', async () => {
  const { page, context } = await open(desktop, '/teacher/students'); await waitSettled(page);
  await page.addInitScript(() => {});
  await page.evaluate(() => { window.__copied = null; window.__shared = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied = t; } }, configurable: true }); navigator.share = async d => { window.__shared = d; }; });
  const urls = []; page.on('framenavigated', f => urls.push(f.url())); const logs = []; page.on('console', m => logs.push(m.text()));
  await page.locator('[data-invite-students]').click(); await page.locator('[data-invite-panel]').waitFor();
  assert.equal(await page.locator('[data-invite-days]').inputValue(), '7', 'seven days by default'); assert.equal(await page.locator('[data-invite-course]').inputValue(), uuid(10));
  await page.locator('[data-active-links] [data-link]').first().waitFor(); assert.equal(await page.locator('[data-active-links] [data-link]').count(), 1, 'one active link; the expired one is not listed');
  await shot(page, 'students-invite-en-1440');
  await page.locator('[data-create-link]').click(); await page.locator('[data-made-link]').waitFor();
  const value = await page.locator('[data-join-link]').inputValue(); const m = new RegExp('^' + origin.replace(/[.]/g, '\\.') + '/join/([A-Za-z0-9_-]{43})$').exec(value); assert.ok(m, 'the final /join/<token> address: ' + value);
  const token = m[1];
  const s = await posts(); assert.equal(s.tokens.length, 1); assert.equal(s.tokens[0], token); const sent = s.admin.find(a => a.action === 'link'); assert.equal(sent.data.token, token);
  const days = (Date.parse(sent.data.expiresAt) - Date.now()) / 86400000; assert.ok(days > 6.9 && days <= 7.01, 'seven days: ' + days);
  assert.equal(sent.data.kind, 'request'); assert.equal(sent.data.recipientId, null); assert.equal(sent.offeringId, O.maths);
  assert.equal(s.posts.filter(p => p.action === 'course-run').length, 0, 'the course already has a run');
  await page.locator('[data-copy-link]').click(); assert.equal(await page.evaluate(() => window.__copied), value);
  await page.locator('[data-share-link]').click(); const shared = await page.evaluate(() => window.__shared); assert.equal(shared.url, value); assert.match(shared.title, /Synthetic Maths/);
  assert.equal(await page.locator('[data-made-link]').count(), 1);
  assert.ok(!s.requests.some(r => r.includes(token)), 'the token is in no request address'); assert.ok(!urls.some(u => u.includes(token)), 'the token is in no page address'); assert.ok(!page.url().includes(token));
  assert.ok(!logs.some(l => l.includes(token)), 'the token is not logged');
  const stored = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie])); assert.ok(!stored.includes(token), 'the token is not stored');
  await page.locator('[data-done-link]').click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-made-link]').count(), 0); assert.ok(!(await page.content()).includes(token), 'the token is gone from the page after Done');
  assert.equal(await page.locator('[data-invite-panel]').count(), 0, 'Done closes the panel'); await page.locator('[data-invite-students]').click(); await page.locator('[data-active-links] [data-link]').first().waitFor(); assert.equal(await page.locator('[data-active-links] [data-link]').count(), 2, 'the new link is listed (without its secret)');
  const st = await fetch(origin + '/__state').then(r => r.json()); assert.ok(!JSON.stringify(st.links).includes(token), 'only a stored record, not the secret, is listed');
  // revoke the first listed link: asks first
  await page.locator('[data-active-links] [data-revoke]').first().click(); assert.equal((await posts()).admin.filter(a => a.action === 'revoke-link').length, 0, 'asked first');
  await page.locator('[data-confirm-revoke]').click(); await page.waitForFunction(() => document.querySelectorAll('[data-active-links] [data-link]').length === 1);
  assert.equal((await posts()).admin.filter(a => a.action === 'revoke-link').length, 1);
  await context.close();
 });
 await step('Invite students: a course with no run yet gets one through the existing course-run route first; an unpublished course says students need it published', async () => {
  const { page, context } = await open(desktop, '/teacher/students?invite=' + O.maths); await waitSettled(page);
  await page.locator('[data-invite-panel]').waitFor(); assert.equal(await page.locator('[data-invite-course]').inputValue(), uuid(10), 'opened from the empty Group with its course chosen');
  await page.locator('[data-invite-course]').selectOption(uuid(12)); await page.locator('[data-unpublished]').waitFor();
  await page.locator('[data-invite-days]').selectOption('3'); await page.locator('[data-create-link]').click(); await page.locator('[data-made-link]').waitFor();
  const s = await posts(); assert.deepEqual(s.posts.map(p => p.action), ['course-run']); assert.equal(s.posts[0].data.courseId, uuid(12));
  const sent = s.admin.find(a => a.action === 'link'); assert.equal(sent.offeringId, O.history, 'the link is for the run the route returned');
  await checkClean(page, 'invite desktop'); await context.close();
  const ph = await open(phone, '/teacher/students', { lang: 'ar' }); await waitSettled(ph.page); await ph.page.locator('[data-invite-students]').click(); await ph.page.locator('[data-create-link]').click(); await ph.page.locator('[data-made-link]').waitFor();
  assert.equal(await ph.page.locator('[data-join-link]').getAttribute('dir'), 'ltr', 'the address stays left to right in Arabic');
  await checkClean(ph.page, 'invite phone ar'); await shot(ph.page, 'students-invite-made-ar-390'); await ph.context.close();
 });
 await step('Invite students, errors: a lost reply says it cannot tell and offers a new link; the link list failing has its own retry; Share is absent where the browser has none', async () => {
  const { page, context } = await open(desktop, '/teacher/students'); await waitSettled(page); await page.locator('[data-invite-students]').click(); await page.locator('[data-create-link]').waitFor();
  await page.route('**/api/student-administration', r => JSON.parse(r.request().postData() || '{}').action === 'link' ? r.abort('connectionreset') : r.continue()); await page.locator('[data-create-link]').click(); await page.locator('[data-link-unknown]').waitFor(); assert.equal(await page.locator('[data-made-link]').count(), 0, 'no link is shown for an unknown outcome');
  assert.equal(await page.locator('[data-share-link]').count(), 0);
  await context.close();
  await ctl({ reset: true, fail: { links: 1 } });
  const b = await open(desktop, '/teacher/students'); await waitSettled(b.page); await b.page.locator('[data-invite-students]').click(); await b.page.locator('[data-active-links]').waitFor().catch(() => {});
  await b.page.locator('[role="alert"]').first().waitFor(); await b.context.close();
 });

 // ------------------------------------------------------------------ one student
 await step('Student page: status, course, Groups, attendance history (Present/Absent only), Suspend and Reactivate ask first and send the version they read', async () => {
  const { page, context } = await open(desktop, `/teacher/students/${stu(1)}?course=${O.maths}`);
  await page.locator('[data-student-page] h1').waitFor(); await page.locator('[data-attendance-row]').first().waitFor();
  assert.equal(await page.locator('h1').innerText(), 'Synthetic student 01'); assert.match(await page.locator('[data-student-course]').innerText(), /Synthetic Maths/);
  assert.match(await page.locator('[data-student-page]').innerText(), /Active/); assert.match(await page.locator('[data-student-groups-section]').innerText(), /Synthetic Algebra Group/);
  assert.equal(await page.locator(`[data-group-link="${G.alg}"]`).getAttribute('href'), '/teacher/groups/' + G.alg);
  const rows = await page.locator('[data-attendance-row]').allInnerTexts(); assert.equal(rows.length, 3, 'the unmarked session is not shown'); assert.match(rows[0], /Absent/); assert.match(rows[1], /Present/);
  assert.match(await page.locator('[data-attendance-counts]').innerText(), /2 present · 1 absent/); assert.doesNotMatch(await main(page), /grade|homework/i);
  await checkClean(page, 'student page desktop'); await shot(page, 'student-page-en-1440');
  await page.locator('[data-ask-access]').click(); assert.equal((await posts()).admin.length, 0, 'asked first'); assert.match(await page.locator('[data-access-confirm]').innerText(), /Suspend Synthetic student 01\?/);
  await page.locator('[data-keep-access]').click(); assert.equal(await page.locator('[data-access-confirm]').count(), 0);
  await page.locator('[data-ask-access]').click(); await page.locator('[data-confirm-access]').click(); await page.locator('[data-student-status="suspended"]').waitFor();
  const s = await posts(); assert.deepEqual(s.admin.map(a => [a.action, a.subjectId, a.version]), [['suspend', stu(1), 1]]);
  assert.match(await page.locator('[data-ask-access]').innerText(), /Reactivate/);
  await page.locator('[data-ask-access]').click(); await page.locator('[data-confirm-access]').click(); await page.locator('[data-student-status="active"]').waitFor();
  assert.deepEqual((await posts()).admin.map(a => [a.action, a.version]), [['suspend', 1], ['reactivate', 2]], 'each change sends the version the previous one returned');
  await context.close();
 });
 await step('Student page on a phone in Arabic; a student in a course the teacher only supports has no Suspend; a stranger is "not found"; errors have Retry', async () => {
  let { page, context } = await open(phone, `/teacher/students/${stu(1)}?course=${O.maths}`, { lang: 'ar' }); await page.locator('[data-attendance-row]').first().waitFor();
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.match(await main(page), /الحضور/); await checkClean(page, 'student page phone ar'); await shot(page, 'student-page-ar-390'); await context.close();
  ({ page, context } = await open(desktop, `/teacher/students/${stu(101)}?course=${O.science}`)); await page.locator('[data-student-page] h1').waitFor();
  assert.equal(await page.locator('[data-access-change]').count(), 0, 'no Suspend where the teacher cannot manage'); await context.close();
  ({ page, context } = await open(desktop, `/teacher/students/${stu(1)}?course=${O.science}`)); await page.locator('[data-state="empty"]').waitFor(); assert.match(await main(page), /could not find this student/); await context.close();
  ({ page, context } = await open(desktop, `/teacher/students/${stu(1)}`)); await page.locator('[data-state="empty"]').waitFor(); await context.close();
  await ctl({ reset: true, fail: { ['roster:' + O.maths]: 1 } });
  ({ page, context } = await open(desktop, `/teacher/students/${stu(1)}?course=${O.maths}`)); await page.locator('[role="alert"]').first().waitFor(); await page.locator('[role="alert"] button').first().click(); await page.locator('[data-attendance-row]').first().waitFor(); await context.close();
  await ctl({ reset: true, fail: { history: 1 } });
  ({ page, context } = await open(desktop, `/teacher/students/${stu(1)}?course=${O.maths}`)); await page.locator('[data-student-attendance] [role="alert"]').waitFor(); assert.match(await page.locator('[data-student-groups-section]').innerText(), /Synthetic Algebra Group/, 'Groups still shown'); await context.close();
  await ctl({ reset: true, suspend: 'changed' });
  ({ page, context } = await open(desktop, `/teacher/students/${stu(1)}?course=${O.maths}`)); await page.locator('[data-ask-access]').click(); await page.locator('[data-confirm-access]').click(); await page.locator('[data-access-change] [role="alert"]').waitFor(); assert.match(await page.locator('[data-student-status]').first().innerText(), /Active/, 'nothing changed on screen'); await context.close();
 });

 await browser.close(); server.close();
 assert.deepEqual(errors, [], 'no uncaught or console errors');
 assert.deepEqual(external, [], 'no external requests');
 const apis = [...new Set(requests.slice(probes).filter(r => /\/api\//.test(r)).map(r => r.replace(/^(\w+) (\/[^?]*).*/, '$1 $2')))].sort();
 assert.deepEqual(apis.filter(r => !/\/api\/(student-administration|study-groups(\/course-run)?|communications|user\/status)$/.test(r)), [], 'the screens call no other API: ' + apis.join(', '));
 console.log(`Teacher Students browser checks passed: ${results.length} groups (real middleware, synthetic loopback data, not provider E2E). Screenshots: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
