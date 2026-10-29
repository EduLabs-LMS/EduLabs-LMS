// Teacher Take attendance in Chromium: the real components, the REAL middleware in front of every page and API request,
// the real built CSS and fonts, and a fictional /api/study-groups with synthetic data only. Not provider acceptance.
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME, a Firebase-mode `npm run build` (CSS, fonts) and optionally LMS_FRESH_CSS (a Tailwind compile of app/globals.css).
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/teacher-attendance-browser'), shots = path.join(out, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the real CSS and fonts are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat(process.env.LMS_FRESH_CSS ? [fs.readFileSync(process.env.LMS_FRESH_CSS, 'utf8')] : []).join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

// ---- the real middleware.ts, run with Firebase staging on (same loader approach as scripts/teacher-settings-groups.test.cjs)
class NextResponse { constructor(kind, status, location) { this.kind = kind; this.status = status; this.location = location; } static next() { return new NextResponse('next', 200); } static json(_, o) { return new NextResponse('json', o.status); } static redirect(u) { return new NextResponse('redirect', 307, u.pathname); } }
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
import { TeacherGroupsList } from '@/frontend/features/teacher-groups/list-view';
import { TeacherGroupView } from '@/frontend/features/teacher-groups/group-view';
import { TeacherAttendanceView } from '@/frontend/features/teacher-attendance/attendance-view';
import { TeacherSettingsShell } from '@/frontend/features/teacher-settings/shell';
import { SettingsIndex } from '@/frontend/features/teacher-settings/settings-index';
import { TeacherAccountSection } from '@/frontend/features/teacher-settings/account-section';
import { TeacherNotificationsSection } from '@/frontend/features/teacher-settings/notifications-section';
import { TeacherCoursesView } from '@/frontend/features/teacher-home/courses-view';
import { AppearanceSettings } from '@/frontend/features/personalization/appearance-settings';
import { LanguageSettings } from '@/frontend/features/personalization/language-settings';
import { mapCourses, createTargets } from '@/shared/teacher-home';
const pathname = location.pathname;
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const courses = mapCourses({ ok: true, value: [{ id: uuid(10), organization_id: uuid(50), title: 'Synthetic Physics', status: 'published' }, { id: uuid(11), organization_id: uuid(50), title: 'Synthetic Chemistry', status: 'draft' }] });
const targets = createTargets([{ id: uuid(50), name: 'Synthetic space', status: 'active' }], [{ organization_id: uuid(50), role: 'teacher', status: 'active' }]);
let lang = 'en'; try { lang = localStorage.getItem('edulabs-lms-language') === 'ar' ? 'ar' : 'en'; } catch {}
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
const section = pathname.split('/')[3] || '';
function Body() {
 if (pathname === '/teacher/groups') return <TeacherGroupsList />;
 const at = /^\\/teacher\\/groups\\/([0-9a-f-]{36})\\/attendance\\/([0-9a-f-]{36})$/.exec(pathname); if (at) return <TeacherAttendanceView groupId={at[1]} sessionId={at[2]} />;
 const m = /^\\/teacher\\/groups\\/([0-9a-f-]{36})$/.exec(pathname); if (m) return <TeacherGroupView groupId={m[1]} />;
 return <p>Harness page {pathname}</p>;
}
function Settings() {
 return <TeacherSettingsShell>
  {pathname === '/teacher/settings' ? <SettingsIndex />
   : section === 'account' ? <TeacherAccountSection />
   : section === 'courses' ? <TeacherCoursesView courses={courses} targets={targets} />
   : section === 'language' ? <div data-settings-language className="space-y-6"><LanguageSettings /><AppearanceSettings /></div>
   : section === 'notifications' ? <TeacherNotificationsSection /> : <p>Harness page</p>}
 </TeacherSettingsShell>;
}
const isSettings = pathname === '/teacher/settings' || pathname.startsWith('/teacher/settings/');
createRoot(document.getElementById('root')).render(
 <LanguageProvider initialLanguage={lang}>
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
   {isSettings ? <Settings /> : <div data-lms-shell className="min-h-screen bg-slate-50 w-full relative">
    <MobileSidebar />
    <aside className="hidden md:block fixed start-4 top-4 bottom-4 w-64 z-50"><Sidebar /></aside>
    <main className="md:ps-72 pt-2 md:pt-4 min-h-screen bg-slate-50 flex flex-col justify-between"><div className="flex-1 w-full p-4 sm:p-6 md:p-8"><Body /></div></main>
   </div>}
  </ThemeProvider>
 </LanguageProvider>);
`;

// ---- fictional Groups service (synthetic data, relative to now)
const H = 3600000, D = 24 * H;
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const iso = t => new Date(t).toISOString();
const G = { alg: uuid(1), phys: uuid(2), old: uuid(3), other: uuid(4) };
const groups = () => ({
 [G.alg]: { id: G.alg, offering_id: uuid(101), offering_name: 'Synthetic Maths', name: 'Synthetic Algebra Group', description: '', mode: 'center', location: 'Synthetic Centre, Room 4', join_url: '', instructions: 'Bring the red notebook.', capacity: 20, status: 'active', version: 3, staff: true, instructor: true },
 [G.phys]: { id: G.phys, offering_id: uuid(102), offering_name: 'Synthetic Science', name: 'مجموعة الفيزياء', description: '', mode: 'online', location: '', join_url: 'https://meet.example.test/room', instructions: '', capacity: null, status: 'active', version: 1, staff: true, instructor: false },
 [G.old]: { id: G.old, offering_id: uuid(101), offering_name: 'Synthetic Maths', name: 'Synthetic Archived Group', description: '', mode: 'center', location: 'Synthetic Centre', join_url: '', instructions: '', capacity: 12, status: 'archived', version: 2, staff: true, instructor: true },
 [G.other]: { id: G.other, offering_id: uuid(103), offering_name: 'Synthetic Other', name: 'Not managed by this teacher', description: '', mode: 'online', location: '', join_url: '', instructions: '', capacity: null, status: 'active', version: 1, staff: false, instructor: false },
});
const schedules = { [G.alg]: [{ weekday: 3, time: '17:00', durationMinutes: 90 }, { weekday: 0, time: '17:00', durationMinutes: 90 }], [G.phys]: [{ weekday: 1, time: '18:30', durationMinutes: 60 }], [G.old]: [], [G.other]: [] };
function seed() {
 const now = Date.now(), sessions = {}, members = {}, mk = (g, n, start, extra = {}) => ({ id: uuid(1000 + g * 100 + n), group_id: uuid(g), title: 'Synthetic lesson ' + n, starts_at: iso(start), ends_at: iso(start + H), mode: 'online', location: '', join_url: '', instructions: '', cancelled: false, version: 1, attendance_state: start > now ? 'draft' : 'finalized', ...extra });
 sessions[G.alg] = [mk(1, 1, now + 2 * D), mk(1, 2, now + 5 * D), mk(1, 3, now + 9 * D), mk(1, 4, now + 12 * D, { cancelled: true })];
 for (let i = 0; i < 40; i++) sessions[G.alg].push(mk(1, 10 + i, now - (i + 1) * 3 * D, { attendance_state: i === 0 ? 'draft' : i === 1 ? 'reopened' : 'finalized' }));
 sessions[G.phys] = [mk(2, 1, now + D), mk(2, 2, now + 8 * D), mk(2, 3, now - 6 * D), mk(2, 4, now - 13 * D)];
 sessions[G.old] = [mk(3, 1, now - 60 * D), mk(3, 2, now - 67 * D)];
 sessions[G.other] = [];
 members[G.alg] = Array.from({ length: 14 }, (_, i) => ({ id: uuid(5000 + i), user_id: uuid(6000 + i), display_name: 'Synthetic student ' + (i + 1), starts_at: iso(now - 90 * D), ends_at: i >= 12 ? iso(now - 10 * D) : null, eligible: true }));
 members[G.phys] = Array.from({ length: 30 }, (_, i) => ({ id: uuid(7000 + i), user_id: uuid(8000 + i), display_name: i === 0 ? 'طالب تجريبي' : 'Synthetic pupil ' + (i + 1), starts_at: iso(now - 90 * D), ends_at: null, eligible: true }));
 members[G.old] = []; members[G.other] = [];
 return { groups: groups(), sessions, members };
}
const att = {};
const S = { scenario: 'demo', fail: {}, cmd: 'ok', posts: [], data: seed() };
S.data.sessions[G.phys].find(s => s.id === uuid(1203)).attendance_state = 'draft';
const reset = () => { S.scenario = 'demo'; S.fail = {}; S.cmd = 'ok'; S.posts = []; S.data = seed(); S.data.sessions[G.phys].find(s => s.id === uuid(1203)).attendance_state = 'draft'; for (const k of Object.keys(att)) delete att[k]; };
const take = key => { if ((S.fail[key] || 0) > 0) { S.fail[key]--; return true; } return false; };
const PAGE = 25;
class Fail { constructor(status) { this.status = status; } }
function view(body) {
 const { groupId, data: { section, page = 0 } } = body, now = Date.now();
 if (!groupId) {
  if (take('overview')) throw new Fail(S.fail.overviewStatus || 503);
  const all = S.scenario === 'cleared' ? [] : Object.values(S.data.groups);
  return { rows: all.slice(page * PAGE, page * PAGE + PAGE), page, hasMore: all.length > (page + 1) * PAGE, serverNow: iso(now) };
 }
 const g = S.data.groups[groupId]; if (!g) throw new Fail(403);
 if (S.fail['forbidden:' + groupId]) throw new Fail(403);
 if (section === 'detail') { if (take('detail:' + groupId)) throw new Fail(503); return { group: g, schedules: schedules[groupId], serverNow: iso(now) }; }
 if (section === 'sessions') {
  if (take('sessions:' + groupId)) throw new Fail(503);
  const list = S.scenario === 'cleared' ? [] : S.data.sessions[groupId], live = s => !s.cancelled && Date.parse(s.ends_at) > now;
  const sorted = [...list].sort((a, b) => (live(b) ? 1 : 0) - (live(a) ? 1 : 0) || (live(a) ? Date.parse(a.starts_at) - Date.parse(b.starts_at) : Date.parse(b.starts_at) - Date.parse(a.starts_at)));
  const rows = sorted.slice(page * PAGE, page * PAGE + PAGE).map(s => ({ ...s, state: s.cancelled ? 'cancelled' : Date.parse(s.ends_at) <= now ? 'completed' : Date.parse(s.starts_at) <= now ? 'ongoing' : 'upcoming' }));
  return { rows, page, serverNow: iso(now), nextSession: sorted.find(live) ?? null, catchingUp: false, hasMore: sorted.length > (page + 1) * PAGE };
 }
 if (section === 'members') {
  if (take('members:' + groupId)) throw new Fail(503);
  const list = S.scenario === 'cleared' ? [] : S.data.members[groupId];
  return { rows: list.slice(page * PAGE, page * PAGE + PAGE), page, hasMore: list.length > (page + 1) * PAGE };
 }
 if (/^[0-9a-f-]{36}$/.test(section)) {
  const s = S.data.sessions[groupId].find(x => x.id === section); if (!s) throw new Fail(403);
  if (take('roster:' + section)) throw new Fail(503);
  const all = roster(groupId, s);
  return { rows: all.slice(page * PAGE, page * PAGE + PAGE), page, hasMore: all.length > (page + 1) * PAGE, session: s, counts: { attended: all.filter(r => r.status === 'attended').length, absent: all.filter(r => r.status === 'absent').length, not_marked: all.filter(r => r.status === 'not_marked').length } };
 }
 throw new Fail(400);
}
function roster(groupId, session) {
 if (!att[session.id]) {
  const base = S.scenario === 'big' ? Array.from({ length: 130 }, (_, i) => ({ user_id: uuid(20000 + i), display_name: 'Synthetic big ' + (i + 1) })) : S.data.members[groupId].filter(m => m.ends_at == null).map(m => ({ user_id: m.user_id, display_name: m.display_name }));
  att[session.id] = base.map((b, i) => ({ ...b, status: session.attendance_state === 'finalized' ? (i % 3 === 0 ? 'absent' : 'attended') : 'not_marked' }));
 }
 return att[session.id];
}
function command(body) {
 const { action, groupId, version, data } = body, g = S.data.groups[groupId];
 if (S.cmd === 'denied') throw new Fail(403);
 if (S.cmd === 'changed') throw new Fail(409);
 if (!g) throw new Fail(403);
 if (action === 'archive') { if (version !== g.version) throw new Fail(409); g.status = 'archived'; g.version++; for (const s of S.data.sessions[groupId]) if (Date.parse(s.starts_at) > Date.now()) s.cancelled = true; return { ok: true }; }
 if (action === 'one-off') { if (version !== g.version) throw new Fail(409); S.data.sessions[groupId].push({ id: uuid(9000 + S.data.sessions[groupId].length), group_id: groupId, title: data.title, starts_at: data.startsAt, ends_at: data.endsAt, mode: g.mode, location: '', join_url: '', instructions: '', cancelled: false, version: 1, attendance_state: 'draft' }); g.version++; return { ok: true }; }
 if (action === 'session') { const s = S.data.sessions[groupId].find(x => x.id === data.sessionId); if (!s || s.version !== data.sessionVersion || data.operation !== 'cancel') throw new Fail(409); s.cancelled = true; s.version++; return { ok: true }; }
 if (['attendance', 'finalize', 'reopen'].includes(action)) {
  const s = S.data.sessions[groupId].find(x => x.id === data.sessionId); if (!s) throw new Fail(403);
  if (data.sessionVersion !== s.version) throw new Fail(409);
  const all = roster(groupId, s);
  if (action === 'attendance') {
   if (s.attendance_state === 'finalized') throw new Fail(409);
   if (!Array.isArray(data.marks) || data.marks.length > 100) throw new Fail(400);
   for (const m of data.marks) { const r = all.find(x => x.user_id === m.userId); if (!r || !['attended', 'absent', 'not_marked'].includes(m.status)) throw new Fail(400); r.status = m.status; }
  } else if (action === 'finalize') {
   if (!g.instructor) throw new Fail(403);
   if (s.attendance_state === 'finalized') throw new Fail(409); s.attendance_state = 'finalized';
  } else {
   if (!g.instructor) throw new Fail(403);
   if (s.attendance_state !== 'finalized' || !data.reason || data.reason.trim().length < 3) throw new Fail(400); s.attendance_state = 'reopened';
  }
  s.version++; g.version++; return { id: groupId, version: g.version, sessionId: s.id };
 }
 throw new Fail(404);
}

(async () => {
 const stubs = {
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

 const requests = [];
 const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
  // Harness-only assets and controls: not part of the application, so they are not behind the middleware.
  if (url.pathname === '/__app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
  if (url.pathname === '/__style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
  if (url.pathname === '/__ctl') { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => { const b = JSON.parse(Buffer.concat(parts) || '{}'); if (b.reset) reset(); if (b.scenario) S.scenario = b.scenario; if (b.cmd) S.cmd = b.cmd; Object.assign(S.fail, b.fail || {}); send({ posts: S.posts }); }); return; }
  if (url.pathname === '/__posts') return send(S.posts);
  // Everything else goes through the real middleware first.
  requests.push(req.method + ' ' + url.pathname);
  const decision = gate(url.pathname);
  if (decision.kind === 'json') return send({ error: 'This legacy workflow is unavailable in Firebase staging.' }, decision.status);
  if (decision.kind === 'redirect') { res.statusCode = 307; res.setHeader('Location', decision.location); return res.end(); }
  if (url.pathname === '/api/study-groups' && req.method === 'POST') {
   const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => {
    const body = JSON.parse(Buffer.concat(parts)), lost = body.action !== 'view' && S.cmd === 'lost';
    if (body.action !== 'view') S.posts.push(body);
    if (lost) return req.socket.destroy();
    try { send(body.action === 'view' ? view(body) : command(body)); } catch (e) { if (e instanceof Fail) return send({ error: 'x' }, e.status); throw e; }
   }); return;
  }
  if (url.pathname.startsWith('/api/')) { if (url.pathname === '/api/communications') return send({ rows: [], page: 0, unread: 0 }); if (url.pathname === '/api/user/status') return send({ user: { role: 'teacher' } }); return send({ error: 'harness: not served' }, 404); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
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

 const sid = { draft: uuid(1110), reopened: uuid(1111), finalized: uuid(1112), phys: uuid(1203), cancelled: uuid(1104), future: uuid(1101) };
 const at = (g, s) => `/teacher/groups/${g}/attendance/${s}`;
 const posts = async () => (await ctl({})).posts;
 const rows = page => page.locator('[data-student]');
 const counts = page => page.locator('[data-counts]').innerText().then(t => t.replace(/\s+/g, ' ').trim());
 const ready = async page => { await page.locator('[data-status-wait], [data-student]').first().waitFor(); };

 // ------------------------------------------------------------------ the real middleware in front of the harness
 let probes = 0;
 await step('Middleware: the attendance page is reachable; lookalikes are not; the API behind the catch-all stays 503', async () => {
  const get = (p, init) => fetch(origin + p, { redirect: 'manual', ...init });
  assert.equal((await get(at(G.alg, sid.draft))).status, 200);
  for (const bad of [`/teacher/groups/${G.alg}/attendance`, `/teacher/groups/${G.alg}/attendance/`, `/teacher/groups/${G.alg}/attendance/not-a-uuid`, `/teacher/groups/${G.alg}/attendance/${sid.draft}/`, `/teacher/groups/${G.alg}/attendance/${sid.draft}/finalize`, `/teacher/attendance/${sid.draft}`]) {
   const r = await get(bad); assert.equal(r.status, 307, bad); assert.equal(r.headers.get('location'), '/unavailable', bad);
  }
  assert.equal((await get('/api/teacher/attendance')).status, 503);
  probes = requests.length;
 });

 // ------------------------------------------------------------------ the main flow
 await step('Desktop English: header, status bar, mark, Mark everyone present, Save draft (only changes, only present/absent), Finalize, locked list, Reopen with a reason', async () => {
  const { page, context } = await open(desktop, at(G.alg, sid.draft)); await rows(page).first().waitFor();
  assert.equal(await page.locator('h1').innerText(), 'Attendance · Session 40');
  assert.equal(await page.locator('[data-back]').getAttribute('href'), '/teacher/groups/' + G.alg); assert.match(await page.locator('[data-back]').innerText(), /Back to Synthetic Algebra Group/);
  assert.match(await page.locator('[data-session-subtitle]').innerText(), /\d[\s\S]*Online/);
  const help = page.locator('[data-tour="help"]'); assert.equal(await help.getAttribute('aria-disabled'), 'true'); assert.equal(await help.getAttribute('aria-label'), 'Help');
  const hb = await help.boundingBox(), tb = await page.locator('h1').boundingBox(); assert.ok(hb.y < tb.y + tb.height && hb.x > tb.x, 'the "?" is in the title row, at the far side');
  for (const t of ['status-bar', 'mark-all', 'student-rows', 'save-actions']) assert.equal(await page.locator(`[data-tour="${t}"]`).count(), 1, t);
  assert.equal(await page.locator('[data-sheet-badge]').innerText(), 'Not saved yet'); assert.equal(await counts(page), 'Present 0 · Absent 0 · Not marked 12');
  assert.equal(await rows(page).count(), 12); assert.equal(await page.locator('[data-mark-button]').count(), 24, 'Present and Absent only');
  assert.equal(await page.locator('[data-save-draft]').isDisabled(), true, 'nothing to save yet');
  await rows(page).nth(0).locator('[data-mark-button="attended"]').click(); await rows(page).nth(1).locator('[data-mark-button="absent"]').click();
  assert.equal(await counts(page), 'Present 1 · Absent 1 · Not marked 10'); assert.equal(await rows(page).nth(0).locator('[data-mark-button="attended"]').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('[data-unsaved-changes]').innerText(), /not saved yet/);
  await rows(page).nth(0).locator('[data-mark-button="attended"]').click(); assert.equal(await rows(page).nth(0).getAttribute('data-mark'), 'not_marked', 'pressing it again clears it');
  await page.locator('[data-mark-all]').click(); assert.equal(await counts(page), 'Present 12 · Absent 0 · Not marked 0');
  await rows(page).nth(2).locator('[data-mark-button="absent"]').click(); assert.equal(await counts(page), 'Present 11 · Absent 1 · Not marked 0');
  await shot(page, 'attendance-draft-en-1440');
  await page.locator('[data-save-draft]').click(); await page.locator('[data-notice="saved"]').waitFor(); assert.equal(await page.locator('[data-notice="saved"]').innerText(), 'Draft saved.');
  let p = (await posts()).filter(x => x.action === 'attendance'); assert.equal(p.length, 1);
  assert.deepEqual(Object.keys(p[0].data).sort(), ['marks', 'sessionId', 'sessionVersion']); assert.equal(p[0].data.sessionVersion, 1); assert.equal(p[0].data.sessionId, sid.draft); assert.equal(p[0].data.marks.length, 12);
  assert.deepEqual([...new Set(p[0].data.marks.map(m => m.status))].sort(), ['absent', 'attended']);
  assert.equal(await page.locator('[data-sheet-badge]').innerText(), 'Not saved yet', 'a saved draft is still a draft'); assert.equal(await page.locator('[data-save-draft]').isDisabled(), true);
  // Finalize: asks first, then sends the version the save produced.
  await page.locator('[data-finalize]').click(); await page.locator('[data-confirm-finalize]').waitFor(); assert.match(await page.locator('[data-confirm-finalize]').innerText(), /Finalize attendance\? The list is locked until you reopen it\./);
  assert.equal(await page.locator('[data-confirm-finalize]').getByText(/not marked yet/).count(), 0, 'nothing unmarked, nothing to warn about');
  await page.locator('[data-confirm-finalize-yes]').click(); await page.locator('[data-notice="finalized"]').waitFor();
  p = (await posts()).filter(x => x.action === 'finalize'); assert.equal(p.length, 1); assert.equal(p[0].data.sessionVersion, 2);
  assert.equal(await page.locator('[data-sheet-badge]').innerText(), 'Finalized'); assert.equal(await page.locator('[data-mark-button]').count(), 0, 'the list is locked'); assert.equal(await page.locator('[data-mark-all]').count(), 0);
  assert.equal(await rows(page).nth(2).locator('[data-mark-text]').innerText(), 'Absent'); assert.equal(await page.locator('[data-save-draft]').count(), 0); assert.equal(await page.locator('[data-finalize]').count(), 0);
  await shot(page, 'attendance-finalized-en-1440');
  // Reopen needs a reason.
  await page.locator('[data-reopen]').click(); await page.locator('[data-reopen-reason]').waitFor();
  await page.locator('[data-confirm-reopen-yes]').click(); assert.match(await page.locator('[data-confirm-reopen] [role="alert"]').innerText(), /at least 3 characters/); assert.equal((await posts()).filter(x => x.action === 'reopen').length, 0, 'nothing is sent without a reason');
  await page.locator('[data-reopen-reason]').fill('Wrong list'); await page.locator('[data-confirm-reopen-yes]').click(); await page.locator('[data-notice="reopened"]').waitFor();
  p = (await posts()).filter(x => x.action === 'reopen'); assert.equal(p.length, 1); assert.equal(p[0].data.reason, 'Wrong list'); assert.equal(p[0].data.sessionVersion, 3);
  assert.equal(await page.locator('[data-sheet-badge]').innerText(), 'Reopened'); assert.equal(await page.locator('[data-mark-button]').count(), 24, 'reopened behaves as a draft');
  assert.doesNotMatch(await main(page), forbidden);
  await context.close();
 });
 await step('Finalize warns about students who are not marked, and a reopened sheet starts as reopened', async () => {
  const { page, context } = await open(desktop, at(G.alg, sid.reopened)); await rows(page).first().waitFor();
  assert.equal(await page.locator('[data-sheet-badge]').innerText(), 'Reopened'); await page.locator('[data-finalize]').click();
  assert.match(await page.locator('[data-confirm-finalize]').innerText(), /12 students are not marked yet/);
  await page.getByRole('button', { name: 'Keep editing' }).click(); assert.equal(await page.locator('[data-confirm-finalize]').count(), 0); assert.equal((await posts()).filter(x => x.action === 'finalize').length, 0);
  await context.close();
 });
 await step('A finalized sheet opens locked; only the course instructor can finalize or reopen; a teaching assistant can still save a draft', async () => {
  const fin = await open(desktop, at(G.alg, sid.finalized)); await rows(fin.page).first().waitFor();
  assert.equal(await fin.page.locator('[data-sheet-badge]').innerText(), 'Finalized'); assert.equal(await fin.page.locator('[data-mark-button]').count(), 0); assert.equal(await fin.page.locator('[data-reopen]').count(), 1);
  assert.match(await counts(fin.page), /^Present \d+ · Absent \d+ · Not marked 0$/); await fin.context.close();
  const { page, context } = await open(desktop, at(G.phys, sid.phys)); await rows(page).first().waitFor();
  assert.equal(await page.locator('[data-save-draft]').count(), 1); assert.equal(await page.locator('[data-finalize]').count(), 0); assert.match(await page.locator('[data-only-instructor]').innerText(), /Only the course instructor/);
  assert.equal(await rows(page).count(), 30);
  await page.locator('[data-mark-all]').click(); await page.locator('[data-save-draft]').click(); await page.locator('[data-notice="saved"]').waitFor();
  assert.equal((await posts()).filter(x => x.action === 'attendance').length, 1); await context.close();
 });
 await step('A long list is read in full and saved in parts of at most 100 marks, each with the version the database holds now', async () => {
  await ctl({ scenario: 'big' });
  const { page, context } = await open(desktop, at(G.alg, sid.draft)); await page.locator('[data-student]').first().waitFor(); await page.waitForFunction(() => document.querySelectorAll('[data-student]').length === 130);
  assert.equal(await counts(page), 'Present 0 · Absent 0 · Not marked 130');
  await page.locator('[data-mark-all]').click(); await page.locator('[data-save-draft]').click(); await page.locator('[data-notice="saved"]').waitFor();
  const p = (await posts()).filter(x => x.action === 'attendance'); assert.deepEqual(p.map(x => x.data.marks.length), [100, 30]); assert.deepEqual(p.map(x => x.data.sessionVersion), [1, 2]);
  await page.locator('[data-finalize]').click(); await page.locator('[data-confirm-finalize-yes]').click(); await page.locator('[data-notice="finalized"]').waitFor(); assert.equal(await counts(page), 'Present 130 · Absent 0 · Not marked 0');
  await context.close();
 });

 // ------------------------------------------------------------------ errors, per section
 await step('Failures are shown where they happen: roster, group details, save, finalize; nothing is reported as empty or as saved', async () => {
  await ctl({ fail: { ['roster:' + sid.draft]: 1 } });
  let { page, context } = await open(desktop, at(G.alg, sid.draft)); await page.locator('[data-state="error"]').first().waitFor();
  assert.match(await page.locator('[data-state="error"]').first().innerText(), /could not load this/); assert.equal(await page.locator('[data-state="empty"]').count(), 0); assert.equal(await rows(page).count(), 0);
  await page.getByRole('button', { name: 'Try again' }).click(); await rows(page).first().waitFor(); await context.close();
  await ctl({ fail: { ['detail:' + G.alg]: 1 } });
  ({ page, context } = await open(desktop, at(G.alg, sid.draft))); await rows(page).first().waitFor(); await page.locator('[data-detail-error]').waitFor();
  assert.match(await page.locator('[data-detail-error]').innerText(), /finalizing is not available yet/); assert.equal(await page.locator('[data-finalize]').count(), 0); assert.equal(await page.locator('[data-save-draft]').count(), 1);
  await page.locator('[data-detail-error]').getByRole('button', { name: 'Try again' }).click(); await page.locator('[data-finalize]').waitFor(); await context.close();
  // 409: the sheet changed. The marks stay on screen, the message says reload.
  ({ page, context } = await open(desktop, at(G.alg, sid.draft))); await rows(page).first().waitFor();
  await page.locator('[data-mark-all]').click(); await ctl({ cmd: 'changed' }); await page.locator('[data-save-draft]').click();
  await page.locator('[data-actions] [role="alert"]').waitFor(); assert.match(await page.locator('[data-actions] [role="alert"]').innerText(), /changed while you were looking at it/); assert.equal(await counts(page), 'Present 12 · Absent 0 · Not marked 0', 'the marks are still there');
  assert.equal(await page.locator('[data-notice]').count(), 0, 'not reported as saved');
  // Lost reply: the outcome is unknown and says so.
  await ctl({ cmd: 'lost' }); await page.locator('[data-save-draft]').click(); await page.locator('[data-actions] [role="alert"]').getByText(/did not get a reply/).waitFor();
  // Denied: no retry offered.
  await ctl({ cmd: 'denied' }); await page.locator('[data-save-draft]').click(); await page.locator('[data-actions] [role="alert"]').getByText(/do not have access/).waitFor(); assert.equal(await page.locator('[data-actions] [role="alert"] button').count(), 0);
  await context.close();
  await ctl({ cmd: 'ok' });
  ({ page, context } = await open(desktop, at(G.alg, sid.cancelled))); await page.locator('[data-state="cancelled"]').waitFor(); assert.match(await page.locator('[data-state="cancelled"]').innerText(), /cancelled/); assert.equal(await page.locator('[data-save-draft]').count(), 0); await context.close();
  ({ page, context } = await open(desktop, at(G.other, sid.draft))); await page.locator('[data-state="error"]').first().waitFor(); assert.match(await page.locator('[data-state="error"]').first().innerText(), /do not have access/); await context.close();
 });
 await step('Links: each started Session on the Group page has an Attendance link, upcoming and cancelled ones do not; the "not saved" flag opens that Session', async () => {
  const { page, context } = await open(desktop, '/teacher/groups/' + G.alg); await page.locator('[data-group-sessions]').waitFor();
  assert.equal(await page.locator(`[data-session="${sid.future}"] [data-attendance-link]`).count(), 0); assert.equal(await page.locator(`[data-session="${sid.cancelled}"] [data-attendance-link]`).count(), 0);
  await page.locator('[data-see-older]').click();
  assert.equal(await page.locator(`[data-session="${sid.draft}"] [data-attendance-link]`).getAttribute('href'), at(G.alg, sid.draft));
  await page.locator(`[data-session="${sid.draft}"] [data-attendance-link]`).click(); await page.waitForURL('**' + at(G.alg, sid.draft)); await page.locator('h1').waitFor(); await context.close();
  const list = await open(desktop, '/teacher/groups'); await list.page.locator(`[data-group-card="${G.alg}"] [data-attendance-unsaved]`).waitFor();
  assert.equal(await list.page.locator(`[data-group-card="${G.alg}"] [data-attendance-unsaved]`).getAttribute('href'), at(G.alg, sid.draft)); assert.equal(await list.page.locator(`[data-group-card="${G.alg}"] [data-attendance-unsaved]`).evaluate(e => e.tagName), 'A');
  await list.page.locator(`[data-group-card="${G.alg}"] [data-attendance-unsaved]`).click(); await list.page.waitForURL('**' + at(G.alg, sid.draft)); await list.context.close();
 });
 await step('Keyboard: Present and Absent are real buttons that toggle with Enter and Space, and Escape does nothing harmful', async () => {
  const { page, context } = await open(desktop, at(G.alg, sid.draft)); await rows(page).first().waitFor();
  const present = rows(page).nth(0).locator('[data-mark-button="attended"]'); await present.focus(); await page.keyboard.press('Enter'); assert.equal(await present.getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Space'); assert.equal(await present.getAttribute('aria-pressed'), 'false'); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.dataset.markButton), 'absent');
  const outline = await present.evaluate(e => { e.focus(); return getComputedStyle(e).outlineStyle; }); assert.notEqual(outline, 'none', 'focus is visible');
  assert.equal(await page.locator('[data-student] [role="group"]').first().getAttribute('aria-label'), 'Synthetic student 1', 'each pair of buttons is named by the student');
  await context.close();
 });

 // ------------------------------------------------------------------ phone and Arabic
 await step('Phone English: rows not boxed cards, full-width Save draft and Finalize fixed at the bottom, 48px targets, nothing hidden behind the bar, no sideways scroll', async () => {
  const { page, context } = await open(phone, at(G.alg, sid.draft)); await rows(page).first().waitFor();
  assert.ok(await overflow(page), 'no horizontal scroll'); assert.deepEqual(await smallText(page), [], 'text at least 16px');
  const bar = await page.locator('[data-actions]').boundingBox(); assert.ok(Math.abs(bar.y + bar.height - 844) <= 1, 'the bar sits at the bottom of the screen'); assert.ok(bar.width >= 389);
  const save = await page.locator('[data-save-draft]').boundingBox(), fin = await page.locator('[data-finalize]').boundingBox(); assert.ok(save.height >= 47.5 && fin.height >= 47.5, 'Save draft and Finalize are 48px+'); assert.ok(save.width > 140 && fin.width > 140, 'wide buttons');
  for (const sel of ['[data-mark-all]', '[data-mark-button]', '[data-tour="help"]']) for (const box of await page.locator(sel).evaluateAll(n => n.map(e => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }))) assert.ok(box[0] >= 47.5 && box[1] >= 47.5, sel + ' is 48px+: ' + box);
  const list = await page.locator('[data-student-list]').evaluate(e => { const s = getComputedStyle(e.parentElement); return { radius: s.borderRadius, width: s.borderTopWidth, shadow: s.boxShadow }; }); assert.equal(list.width, '0px', 'no box around the list on a phone'); assert.equal(list.shadow, 'none');
  const help = await page.locator('[data-tour="help"]').boundingBox(), h1 = await page.locator('h1').boundingBox(); assert.ok(help.x + help.width <= 390 && help.y < h1.y + h1.height);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); const last = await rows(page).last().boundingBox(), bar2 = await page.locator('[data-actions]').boundingBox(); assert.ok(last.y + last.height <= bar2.y + 1, 'the last student is not hidden behind the bar');
  await shot(page, 'attendance-draft-en-390', false);
  await page.locator('[data-finalize]').click(); await page.locator('[data-confirm-finalize]').waitFor(); assert.ok(await overflow(page)); await shot(page, 'attendance-confirm-en-390', false);
  await context.close();
 });
 await step('Arabic: right-to-left, translated, no forbidden words, mirrored back arrow, desktop and phone', async () => {
  for (const [name, viewport] of [['1440', desktop], ['390', phone]]) {
   const { page, context } = await open(viewport, at(G.alg, sid.draft), { lang: 'ar' }); await rows(page).first().waitFor();
   assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl'); assert.equal(await page.locator('h1').innerText(), 'الحضور · الحصة 40');
   assert.equal(await page.locator('[data-sheet-badge]').innerText(), 'لم يُحفظ بعد'); assert.equal(await counts(page), 'حاضر 0 · غائب 0 · بلا تحديد 12');
   assert.equal(await page.locator('[data-mark-all]').innerText(), 'تحديد الجميع حاضرين'); assert.equal(await page.locator('[data-save-draft]').innerText(), 'حفظ المسودة');
   assert.match(await page.locator('[data-back]').innerText(), /العودة إلى/); assert.notEqual(await page.locator('[data-back] svg').evaluate(e => getComputedStyle(e).transform), 'none', 'the arrow is mirrored');
   const hb = await page.locator('[data-tour="help"]').boundingBox(), tb = await page.locator('h1').boundingBox(); assert.ok(hb.x < tb.x, 'the "?" moves to the other side in Arabic');
   assert.ok(await overflow(page), 'no sideways scroll ' + name); assert.deepEqual(await smallText(page), [], 'text ' + name);
   assert.doesNotMatch(await main(page), forbidden);
   if (name === '1440') { const sa = await page.locator('[data-save-draft]').boundingBox(), fa = await page.locator('[data-finalize]').boundingBox(); assert.ok(fa.x < sa.x, 'Finalize sits before Save draft in RTL'); }
   await rows(page).nth(0).locator('[data-mark-button="attended"]').click(); await page.locator('[data-finalize]').click(); await page.locator('[data-confirm-finalize]').waitFor();
   assert.match(await page.locator('[data-confirm-finalize]').innerText(), /اعتماد الحضور|هل تعتمد/); assert.match(await page.locator('[data-confirm-finalize]').innerText(), /11/);
   await shot(page, `attendance-draft-ar-${name}`, false); await context.close();
  }
 });
 await step('Dark theme: text and controls keep at least 4.5:1 contrast', async () => {
  const { page, context } = await open(desktop, at(G.alg, sid.draft), { theme: 'dark' }); await rows(page).first().waitFor(); await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await rows(page).nth(0).locator('[data-mark-button="attended"]').click(); await rows(page).nth(1).locator('[data-mark-button="absent"]').click();
  assert.deepEqual(await contrast(page), [], 'contrast'); await shot(page, 'attendance-dark-1440'); await context.close();
 });

 await browser.close(); server.close();
 assert.deepEqual(errors, [], 'no uncaught or console errors');
 assert.deepEqual(external, [], 'no external requests');
 const apis = [...new Set(requests.slice(probes).filter(r => /\/api\//.test(r)))].sort();
 assert.deepEqual(apis.filter(r => !/\/api\/(study-groups|communications|user\/status)$/.test(r)), [], 'the screens call no other API: ' + apis.join(', '));
 console.log(`Teacher attendance browser checks passed: ${results.length} groups (real middleware, synthetic loopback data, not provider E2E). Screenshots: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
