// Teacher Settings area and Groups & Classes in Chromium: the real components, the REAL middleware in front of every page and API request,
// the real built CSS and fonts, and a fictional /api/study-groups with synthetic data only. Not provider acceptance.
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME, a Firebase-mode `npm run build` (CSS, fonts) and optionally LMS_FRESH_CSS (a Tailwind compile of app/globals.css).
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const pick = async (select, value) => { await select.click(); await select.page().locator('[role="option"][data-value="' + value + '"]').click(); };
const optionsOf = async select => { await select.click(); await select.page().waitForFunction(() => document.activeElement?.getAttribute('role') === 'listbox'); const rows = await select.page().locator('[role="option"]').evaluateAll(os => os.map(o => [o.textContent, o.getAttribute('aria-disabled') === 'true'])); await select.page().keyboard.press('Escape'); await select.page().locator('[role="listbox"]').waitFor({ state: 'detached' }); return rows; };
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/teacher-settings-groups-browser'), shots = path.join(out, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the real CSS and fonts are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat([require('./harness-css.cjs')()]).join('\n');
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
import { TeacherFrame } from '@/frontend/features/teacher-frame/teacher-frame';
import { DesignSettings } from '@/frontend/features/teacher-settings/design-settings';
import { TeacherGroupsList } from '@/frontend/features/teacher-groups/list-view';
import { TeacherGroupView } from '@/frontend/features/teacher-groups/group-view';
import { CreateGroupView } from '@/frontend/features/teacher-groups/group-form';
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
 if (pathname === '/teacher/courses') return <TeacherCoursesView courses={courses} targets={targets} />;
 if (pathname === '/teacher/groups') return <TeacherGroupsList />;
 if (pathname === '/teacher/groups/new') { const c = new URLSearchParams(location.search).get('courses'); return <CreateGroupView courses={c === 'none' ? { ok: true, value: [] } : c === 'fail' ? { ok: false, status: 503 } : { ok: true, value: [{ courseId: uuid(10), title: 'Synthetic Physics', runId: uuid(101) }, { courseId: uuid(11), title: 'Synthetic Chemistry', runId: null }] }} />; }
 const m = /^\\/teacher\\/groups\\/([0-9a-f-]{36})$/.exec(pathname); if (m) return <TeacherGroupView groupId={m[1]} />;
 return <p>Harness page {pathname}</p>;
}
function Settings() {
 return <TeacherSettingsShell>
  {pathname === '/teacher/settings' ? <SettingsIndex />
   : section === 'account' ? <TeacherAccountSection />
   : section === 'language' ? <div data-settings-language className="space-y-6"><LanguageSettings /><AppearanceSettings /><DesignSettings /></div>
   : section === 'notifications' ? <TeacherNotificationsSection /> : <p>Harness page</p>}
 </TeacherSettingsShell>;
}
const isSettings = pathname === '/teacher/settings' || pathname.startsWith('/teacher/settings/');
document.documentElement.dataset.design = new URLSearchParams(location.search).get('design') === 'new' ? 'new' : 'classic';
createRoot(document.getElementById('root')).render(
 <LanguageProvider initialLanguage={lang}>
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
   <TeacherFrame>{isSettings ? <Settings /> : <Body />}</TeacherFrame>
  </ThemeProvider>
 </LanguageProvider>);
`;

// ---- fictional Groups service (synthetic data, relative to now)
const H = 3600000, D = 24 * H;
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const iso = t => new Date(t).toISOString();
const G = { alg: uuid(1), phys: uuid(2), old: uuid(3), other: uuid(4) };
const groups = () => ({
 [G.alg]: { id: G.alg, offering_id: uuid(101), offering_name: 'Demo offering', name: 'Synthetic Algebra Group', description: '', mode: 'center', location: 'Synthetic Centre, Room 4', join_url: '', instructions: 'Bring the red notebook.', capacity: 20, status: 'active', version: 3, staff: true, instructor: true },
 [G.phys]: { id: G.phys, offering_id: uuid(102), offering_name: 'Demo offering', name: 'مجموعة الفيزياء', description: '', mode: 'online', location: '', join_url: 'https://meet.example.test/room', instructions: '', capacity: null, status: 'active', version: 1, staff: true, instructor: false },
 [G.old]: { id: G.old, offering_id: uuid(101), offering_name: 'Demo offering', name: 'Synthetic Archived Group', description: '', mode: 'center', location: 'Synthetic Centre', join_url: '', instructions: '', capacity: 12, status: 'archived', version: 2, staff: true, instructor: true },
 [G.other]: { id: G.other, offering_id: uuid(103), offering_name: 'Demo offering', name: 'Not managed by this teacher', description: '', mode: 'online', location: '', join_url: '', instructions: '', capacity: null, status: 'active', version: 1, staff: false, instructor: false },
});
const freshSchedules = () => ({ [G.alg]: [{ weekday: 3, time: '17:00', durationMinutes: 90 }, { weekday: 0, time: '17:00', durationMinutes: 90 }], [G.phys]: [{ weekday: 1, time: '18:30', durationMinutes: 60 }], [G.old]: [], [G.other]: [] });
let schedules = freshSchedules();
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
 const eligible = [...Array.from({ length: 30 }, (_, i) => ({ user_id: uuid(6000 + i), display_name: 'Synthetic student ' + (i + 1) }))];
 return { groups: groups(), sessions, members, eligible };
}
const S = { scenario: 'demo', fail: {}, cmd: 'ok', posts: [], data: seed() };
const reset = () => { S.scenario = 'demo'; S.fail = {}; S.cmd = 'ok'; S.posts = []; S.data = seed(); schedules = freshSchedules(); };
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
 if (section === 'eligible') {
  if (take('eligible:' + groupId)) throw new Fail(503);
  const q = (body.data.search || '').toLowerCase(), list = S.data.eligible.filter(r => r.display_name.toLowerCase().includes(q));
  return { rows: list.slice(page * PAGE, page * PAGE + PAGE), page, hasMore: list.length > (page + 1) * PAGE };
 }
 throw new Fail(400);
}
function command(body) {
 const { action, groupId, version, data } = body, g = S.data.groups[groupId];
 if (S.cmd === 'denied') throw new Fail(403);
 if (S.cmd === 'changed') throw new Fail(409);
 if (S.cmd === 'invalid') throw new Fail(400);
 if (action === 'course-run') return { offeringId: uuid(990) };
 if (action === 'create') {
  const id = uuid(900);
  S.data.groups[id] = { id, offering_id: data.offeringId, offering_name: 'Demo offering', name: data.definition.name, description: '', mode: data.definition.mode, location: data.definition.location, join_url: data.definition.joinUrl, instructions: '', capacity: data.definition.capacity, status: 'active', version: 1, staff: true, instructor: true };
  S.data.sessions[id] = []; S.data.members[id] = []; schedules[id] = data.definition.schedules;
  return { id, version: 1 };
 }
 if (!g) throw new Fail(403);
 if (action === 'edit') { if (version !== g.version) throw new Fail(409); Object.assign(g, 'name' in data ? { name: data.name } : {}, 'mode' in data ? { mode: data.mode } : {}, 'location' in data ? { location: data.location } : {}, 'joinUrl' in data ? { join_url: data.joinUrl } : {}, 'capacity' in data ? { capacity: data.capacity } : {}); if (data.schedules) schedules[groupId] = data.schedules; g.version++; return { id: g.id, version: g.version }; }
 if (action === 'add') { if (version !== g.version) throw new Fail(409); const who = S.data.eligible.find(r => r.user_id === data.userId); if (!who) throw new Fail(400); S.data.members[groupId].unshift({ id: uuid(40000 + S.data.members[groupId].length), user_id: who.user_id, display_name: who.display_name, starts_at: iso(Date.now()), ends_at: null, eligible: true }); g.version++; return { id: g.id, version: g.version }; }
 if (action === 'remove') { if (version !== g.version) throw new Fail(409); const m = S.data.members[groupId].find(r => r.user_id === data.userId && r.ends_at == null); if (!m) throw new Fail(409); m.ends_at = iso(Date.now()); g.version++; return { id: g.id, version: g.version }; }
 if (action === 'archive') { if (version !== g.version) throw new Fail(409); g.status = 'archived'; g.version++; for (const s of S.data.sessions[groupId]) if (Date.parse(s.starts_at) > Date.now()) s.cancelled = true; return { ok: true }; }
 if (action === 'one-off') { if (version !== g.version) throw new Fail(409); S.data.sessions[groupId].push({ id: uuid(9000 + S.data.sessions[groupId].length), group_id: groupId, title: data.title, starts_at: data.startsAt, ends_at: data.endsAt, mode: g.mode, location: '', join_url: '', instructions: '', cancelled: false, version: 1, attendance_state: 'draft' }); g.version++; return { ok: true }; }
 if (action === 'session') { const s = S.data.sessions[groupId].find(x => x.id === data.sessionId); if (!s || s.version !== data.sessionVersion || data.operation !== 'cancel') throw new Fail(409); s.cancelled = true; s.version++; return { ok: true }; }
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
  if (url.pathname === '/api/student-administration' && req.method === 'POST') { return send({ rows: [{ id: uuid(101), name: 'Demo offering', course_title: 'Synthetic Maths', organization_name: 'Synthetic space', manage: true }, { id: uuid(102), name: 'Demo offering', course_title: 'Synthetic Science', organization_name: 'Synthetic space', manage: true }] }); }
  if (url.pathname === '/api/study-groups/course-run' && req.method === 'POST') {
   const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => {
    const data = JSON.parse(Buffer.concat(parts)); S.posts.push({ action: 'course-run', groupId: null, data });
    if (S.cmd === 'lost') return req.socket.destroy();
    try { send(command({ action: 'course-run', groupId: null, data })); } catch (e) { if (e instanceof Fail) return send({ error: 'x' }, e.status); throw e; }
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
 const only = process.env.LMS_ONLY_STEPS ? new RegExp(process.env.LMS_ONLY_STEPS) : null;
 const step = async (name, fn) => { if (only && !only.test(name)) return; try { await ctl({ reset: true }); await fn(); results.push('PASS ' + name); console.log('PASS', name); } catch (e) { console.log('FAIL', name); throw e; } };
 const shot = (page, name, full = true) => page.screenshot({ path: path.join(shots, name + '.png'), fullPage: full });
 const lum = c => { const m = c.match(/\d+(\.\d+)?/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
 const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
 const contrast = page => page.evaluate(() => { const parse = c => { const m = c.match(/[0-9.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; }; const effective = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) layers.push(c); if (c.a === 1) break; } let base = { r: 255, g: 255, b: 255 }; for (const l of layers.reverse()) base = { r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a) }; return 'rgb(' + base.r + ', ' + base.g + ', ' + base.b + ')'; }; return [...document.querySelectorAll('main p, main h1, main h2, main a, main span, main button, main dt, main dd, main li, main label')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => ({ t: e.textContent.trim().slice(0, 24), color: getComputedStyle(e).color, back: effective(e) })); }).then(pairs => pairs.filter(p => ratio(p.color, p.back) < 4.5).map(p => `${p.t} ${p.color} on ${p.back}`));
 const smallText = page => page.evaluate(() => { const bad = []; const w = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.textContent.trim()) continue; const el = n.parentElement; if (el.closest('[data-teacher-footer]')) continue; const s = parseFloat(getComputedStyle(el).fontSize); if (s < 12 && !el.closest('[aria-hidden="true"]')) bad.push(n.textContent.trim().slice(0, 30) + ':' + s); } return bad; });
 // A Group's name link covers its whole card or row (::after), so the card is the target; the row's height has its own check.
 const tinyTargets = page => page.evaluate(() => [...document.querySelectorAll('main a:not(.d-group-link), main button, main input, main select')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 43.5 || r.width < 43.5) && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden'; }).map(e => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
 const forbidden = /organi[sz]ation|tenant|\bslug\b|program(me)?s?\b|\bstages?\b|\bmodules?\b|\boffering|website studio|منظمة|مؤسسة|وحدة|برنامج|مرحلة/i;
 const main = page => page.locator('main').innerText();

 // ------------------------------------------------------------------ the real middleware in front of the harness
 let probes = 0;
 await step('Middleware: Settings and Group pages are reachable, lookalikes and legacy paths are not, APIs behind the catch-all stay 503', async () => {
  const get = (p, init) => fetch(origin + p, { redirect: 'manual', ...init });
  for (const ok of ['/teacher/settings', '/teacher/settings/account', '/teacher/settings/courses', '/teacher/settings/language', '/teacher/settings/notifications', '/teacher/groups', '/teacher/groups/' + G.alg]) assert.equal((await get(ok)).status, 200, ok);
  for (const bad of ['/teacher/settings/', '/teacher/settings/other', '/teacher/settings/account/extra', '/teacher/analytics', '/teacher/groups/not-a-uuid', '/teacher/groups/' + G.alg + '/sessions']) { const r = await get(bad); assert.equal(r.status, 307, bad); assert.equal(r.headers.get('location'), '/unavailable', bad); }
  for (const api of ['/api/teacher/groups', '/api/teacher/settings', '/api/groups']) assert.equal((await get(api)).status, 503, api);
  assert.equal((await get('/api/study-groups', { method: 'POST', body: JSON.stringify({ action: 'view', groupId: null, data: {} }) })).status, 200);
  probes = requests.length;
 });

 // ------------------------------------------------------------------ Groups list
 await step('Groups list (filled demo), English desktop: cards with only real facts, counts, filter, search, menu entry current', async () => {
  const { page, context } = await open(desktop, '/teacher/groups');
  await page.locator('[data-group-card]').first().waitFor(); await page.locator('[data-group-card] [data-students-count]').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-group-card] [role="status"]').length === 0);
  assert.equal(await page.locator('h1').innerText(), 'Groups');
  await page.locator('[data-group-course]').first().waitFor();
  assert.equal(await page.locator('[data-filter="active"]').innerText(), 'Active · 2'); assert.equal(await page.locator('[data-filter="archived"]').innerText(), 'Archived · 1');
  assert.equal(await page.locator('[data-group-card]').count(), 2, 'the Group this teacher does not manage is not listed');
  const alg = page.locator(`[data-group-card="${G.alg}"]`), phys = page.locator(`[data-group-card="${G.phys}"]`);
  const a = await alg.innerText();
  assert.match(a, /Synthetic Algebra Group/); assert.match(a, /Synthetic Maths/); assert.match(a, /At a centre/); assert.match(a, /Sun[^\n]*5:00\s?PM[^\n]*Wed[^\n]*5:00\s?PM/); assert.match(a, /12 of 20 students/);
  assert.doesNotMatch(await page.locator('[data-teacher-groups]').innerText(), /Demo offering/, 'the run name never shows, on any card');
  assert.equal(await alg.locator('[data-group-course]').innerText(), 'Synthetic Maths', 'the course title'); assert.equal(await alg.locator('[data-group-mode]').getAttribute('data-group-mode'), 'center');
  assert.equal(await alg.locator('[data-attendance-unsaved]').count(), 1, 'the most recent finished Session has no saved attendance'); assert.match(await alg.locator('[data-attendance-unsaved]').innerText(), /Attendance not taken/); assert.ok((await alg.locator('[data-attendance-unsaved]').boundingBox()).height >= 44, 'a 44 px target');
  assert.ok(await alg.locator('[data-countdown]').count() >= 1, 'a countdown beside the next Session'); assert.equal(await alg.locator('.d-tile').count(), 1, 'a date tile'); assert.equal(await phys.locator('[data-attendance-unsaved]').count(), 0);
  const p = await phys.innerText(); assert.match(p, /مجموعة الفيزياء/); assert.match(p, /Online/); assert.match(p, /25\+ students/, 'a partial member read says so');
  assert.match(await alg.locator('[data-next-session]').innerText(), /\d/);
  assert.equal(await alg.locator('a').first().getAttribute('href'), '/teacher/groups/' + G.alg);
  assert.equal(await page.locator('[data-teacher-nav] a[aria-current="page"]').innerText(), 'Groups');
  assert.doesNotMatch(await main(page), forbidden);
  await shot(page, 'groups-list-en-1440');
  await page.locator('[data-groups-search]').fill('الفيزياء'); assert.equal(await page.locator('[data-group-card]').count(), 1);
  await page.locator('[data-groups-search]').fill('maths'); assert.equal(await page.locator('[data-group-card]').count(), 1, 'search also matches the course name');
  await page.locator('[data-groups-search]').fill('zzz'); assert.match(await page.locator('[data-state="empty"]').innerText(), /No Group matches your search/);
  await page.locator('[data-groups-search]').fill(''); await page.locator('[data-filter="archived"]').click();
  assert.equal(await page.locator('[data-filter="archived"]').getAttribute('aria-pressed'), 'true'); await page.locator('[data-group-card]').first().waitFor();
  assert.match(await page.locator('[data-group-card]').first().innerText(), /Synthetic Archived Group/);
  await shot(page, 'groups-list-archived-en-1440');
  await context.close();
 });
 await step('Groups list on a phone, English and Arabic: no horizontal scroll, 16px text, 44px targets, mirrored layout, Arabic copy', async () => {
  for (const lang of ['en', 'ar']) {
   const { page, context } = await open(phone, '/teacher/groups', { lang });
   await page.locator('[data-group-card] [data-students-count]').first().waitFor();
   const row = await page.locator('[data-group-card]').first().boundingBox(); assert.ok(row.height >= 72, 'a 72 px row: ' + row.height); assert.equal(await page.locator('[data-group-list]').evaluate(e => getComputedStyle(e).display), 'flex', 'rows, not a grid, on a phone');
   assert.equal(await page.locator('[data-sticky-primary] [data-create-group]').count(), 1, 'Create group in the sticky bar');
   assert.ok(await overflow(page), 'no horizontal scroll ' + lang); assert.deepEqual(await smallText(page), [], 'text at least 12px ' + lang); assert.deepEqual(await tinyTargets(page), [], 'targets at least 44px ' + lang);
   if (lang === 'ar') { assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); const t = await main(page); assert.match(t, /المجموعات/); assert.match(t, /النشطة · 2/); assert.match(t, /التالية:/); assert.match(t, /لم يُسجَّل الحضور/); assert.doesNotMatch(t, forbidden);
    const box = await page.locator('[data-groups-search]').boundingBox(), icon = await page.locator('.d-search .d-icon').boundingBox(); assert.ok(icon.x > box.x + box.width / 2, 'the magnifier sits at the start of the line in Arabic'); }
   await shot(page, `groups-list-${lang}-390`); await context.close();
  }
 });
 await step('Groups list, dark: readable on both widths', async () => {
  for (const [vp, tag] of [[desktop, '1440'], [phone, '390']]) {
   const { page, context } = await open(vp, '/teacher/groups', { theme: 'dark' });
   await page.locator('[data-group-card] [data-students-count]').first().waitFor(); await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
   assert.deepEqual(await contrast(page), [], 'contrast at least 4.5:1 ' + tag); await shot(page, `groups-list-dark-${tag}`); await context.close();
  }
 });
 await step('Groups list, cleared demo: an honest empty state (not an error), Archived (0)', async () => {
  await ctl({ scenario: 'cleared' });
  const { page, context } = await open(desktop, '/teacher/groups');
  await page.locator('[data-state="empty"]').waitFor(); assert.match(await page.locator('[data-state="empty"]').innerText(), /You have no active Groups yet/);
  assert.equal(await page.locator('[role="alert"]').count(), 0); assert.equal(await page.locator('[data-filter="archived"]').innerText(), 'Archived · 0');
  await page.locator('[data-filter="archived"]').click(); assert.match(await page.locator('[data-state="empty"]').innerText(), /no archived Groups/);
  await shot(page, 'groups-list-cleared-en-1440'); await context.close();
  const ar = await open(phone, '/teacher/groups', { lang: 'ar' }); await ar.page.locator('[data-state="empty"]').waitFor(); assert.match(await ar.page.locator('[data-state="empty"]').innerText(), /ليس لديك مجموعات نشطة بعد/); await shot(ar.page, 'groups-list-cleared-ar-390'); await ar.context.close();
 });
 await step('Groups list errors: a failed read is an error with Try again, never an empty list; one failing card does not hide the others; a 403 has no retry', async () => {
  await ctl({ fail: { overview: 1 } });
  const { page, context } = await open(desktop, '/teacher/groups');
  await page.locator('[role="alert"]').waitFor(); assert.equal(await page.locator('[data-state="empty"]').count(), 0); assert.match(await page.locator('[role="alert"]').innerText(), /could not load/);
  await shot(page, 'groups-list-error-en-1440');
  await page.getByRole('button', { name: 'Try again' }).click(); await page.locator('[data-group-card]').first().waitFor(); assert.equal(await page.locator('[data-group-card]').count(), 2);
  await context.close();
  await ctl({ fail: { ['detail:' + G.alg]: 1 } });
  const c = await open(desktop, '/teacher/groups'); await c.page.locator(`[data-group-card="${G.alg}"] [role="alert"]`).waitFor();
  await c.page.locator(`[data-group-card="${G.phys}"] [data-students-count]`).waitFor(); assert.equal(await c.page.locator(`[data-group-card="${G.phys}"] [role="alert"]`).count(), 0, 'the other card is fine');
  await shot(c.page, 'groups-list-card-error-en-1440');
  await c.page.locator(`[data-group-card="${G.alg}"]`).getByRole('button', { name: 'Try again' }).click(); await c.page.locator(`[data-group-card="${G.alg}"] [data-students-count]`).waitFor(); await c.context.close();
  await ctl({ fail: { overview: 1, overviewStatus: 403 } });
  const f = await open(desktop, '/teacher/groups'); await f.page.locator('[role="alert"]').waitFor(); assert.match(await f.page.locator('[role="alert"]').innerText(), /do not have access/); assert.equal(await f.page.locator('[role="alert"] button').count(), 0); await f.context.close();
 });

 // ------------------------------------------------------------------ one Group
 await step('One Group (filled), English desktop: header, tabs, Sessions upcoming/earlier with See older sessions, Students, Details, side panel', async () => {
  const { page, context } = await open(desktop, '/teacher/groups/' + G.alg);
  await page.locator('[data-group-sessions]').waitFor();
  assert.equal(await page.locator('h1').innerText(), 'Synthetic Algebra Group'); assert.match(await page.locator('[data-teacher-group]').innerText(), /Synthetic Maths/); assert.equal(await page.locator('[data-status]').innerText(), 'Active');
  assert.deepEqual(await page.locator('[role="tab"]').allInnerTexts(), ['Sessions', 'Students', 'Details']); assert.equal(await page.locator('[data-teacher-nav] a[aria-current="page"]').innerText(), 'Groups');
  assert.equal(await page.locator('[data-session][data-state="upcoming"]').count(), 3); assert.equal(await page.locator('[data-session][data-state="cancelled"]').count(), 1, 'a cancelled upcoming Session is shown as Cancelled');
  assert.equal(await page.locator('[data-session]').count(), 4 + 3, 'four upcoming/cancelled plus the three most recent earlier Sessions');
  const earlier = page.locator('[data-session][data-state="completed"]');
  assert.match(await earlier.nth(0).innerText(), /Attendance not saved/); assert.match(await earlier.nth(1).innerText(), /Attendance reopened/); assert.match(await earlier.nth(2).innerText(), /Attendance saved/);
  assert.match(await page.locator('[data-session][data-state="upcoming"]').first().innerText(), /Attendance opens when the Session starts/); assert.doesNotMatch(await page.locator('[data-session][data-state="cancelled"]').innerText(), /Attendance/);
  assert.ok(await page.locator('[data-group-panel]').isVisible(), 'desktop side panel'); assert.match(await page.locator('[data-group-panel]').innerText(), /Sun[^\n]*5:00/);
  await shot(page, 'group-sessions-en-1440');
  await page.locator('[data-see-older]').click(); assert.equal(await page.locator('[data-session][data-state="completed"]').count(), 21, 'the rest of the first page (the cancelled Session sorts into it but is listed with the upcoming ones)');
  await page.locator('[data-more-sessions]').click(); await page.waitForFunction(() => document.querySelectorAll('[data-session][data-state="completed"]').length === 40);
  assert.equal(await page.locator('[data-more-sessions]').count(), 0, 'no more to load');
  await page.locator('[data-tab="students"]').click(); await page.locator('[data-group-students]').waitFor();
  assert.equal(await page.locator('[data-group-students] li').count(), 12, 'only current students'); assert.match(await page.locator('[data-students-total]').innerText(), /12 of 20 students/);
  await shot(page, 'group-students-en-1440');
  await page.locator('[data-tab="details"]').click(); const d = await page.locator('[data-group-details]').innerText();
  assert.match(d, /Weekly times/); assert.match(d, /At a centre/); assert.match(d, /Synthetic Centre, Room 4/); assert.match(d, /Bring the red notebook\./); assert.match(d, /20/);
  await shot(page, 'group-details-en-1440');
  assert.doesNotMatch(await main(page), forbidden);
  await context.close();
  const o = await open(desktop, '/teacher/groups/' + G.phys); await o.page.locator('[data-group-sessions]').waitFor();
  await o.page.locator('[data-tab="students"]').click(); await o.page.locator('[data-group-students]').waitFor(); assert.equal(await o.page.locator('[data-group-students] li').count(), 25); assert.match(await o.page.locator('[data-students-total]').innerText(), /25\+/);
  await o.page.locator('[data-more-students]').click(); await o.page.waitForFunction(() => document.querySelectorAll('[data-group-students] li').length === 30); assert.equal(await o.page.locator('[data-more-students]').count(), 0);
  await o.page.locator('[data-tab="details"]').click(); assert.match(await o.page.locator('[data-group-details]').innerText(), /meet\.example\.test/); assert.equal(await o.page.locator('[data-group-details] a[target="_blank"]').getAttribute('rel'), 'noopener noreferrer');
  await o.context.close();
 });
 await step('One Group on a phone, English and Arabic: no overflow, 16px text, 44px targets, no side panel, mirrored back arrow', async () => {
  for (const lang of ['en', 'ar']) {
   const { page, context } = await open(phone, '/teacher/groups/' + G.alg, { lang });
   await page.locator('[data-group-sessions]').waitFor();
   assert.ok(await overflow(page), 'no overflow ' + lang); assert.deepEqual(await smallText(page), [], 'text ' + lang); assert.deepEqual(await tinyTargets(page), [], 'targets ' + lang);
   assert.equal(await page.locator('[data-group-panel]').isVisible(), false, 'no side panel on a phone');
   if (lang === 'ar') { assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.deepEqual(await page.locator('[role="tab"]').allInnerTexts(), ['الحصص', 'الطلاب', 'التفاصيل']); const t = await main(page); assert.match(t, /القادمة/); assert.match(t, /ملغاة/); assert.match(t, /عرض الحصص الأقدم/); assert.match(t, /لم يُحفظ الحضور/); assert.doesNotMatch(t, forbidden); assert.equal(await page.locator('[data-teacher-group] > a svg').evaluate(e => getComputedStyle(e).transform !== 'none'), true, 'the back arrow is mirrored'); }
   await shot(page, `group-sessions-${lang}-390`);
   await page.locator('[data-tab="details"]').click(); await shot(page, `group-details-${lang}-390`);
   await page.locator('[data-tab="students"]').click(); await page.locator('[data-group-students]').waitFor(); await shot(page, `group-students-${lang}-390`);
   await context.close();
  }
  const ar = await open(desktop, '/teacher/groups/' + G.phys, { lang: 'ar' }); await ar.page.locator('[data-group-sessions]').waitFor(); assert.ok(await overflow(ar.page));
  const side = await ar.page.locator('[data-group-panel]').evaluate(e => e.getBoundingClientRect()), tabs = await ar.page.locator('[role="tablist"]').evaluate(e => e.getBoundingClientRect()); assert.ok(side.left < tabs.left, 'the side panel is on the left in RTL');
  await shot(ar.page, 'group-sessions-ar-1440'); await ar.context.close();
  const dark = await open(desktop, '/teacher/groups/' + G.alg, { theme: 'dark' }); await dark.page.locator('[data-group-sessions]').waitFor(); await dark.page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  assert.deepEqual(await contrast(dark.page), [], 'dark contrast'); await shot(dark.page, 'group-sessions-dark-1440'); await dark.context.close();
 });
 await step('One Group: cleared demo shows honest empty Sessions and Students; failures show errors with retry; forbidden has no retry', async () => {
  await ctl({ scenario: 'cleared' });
  const { page, context } = await open(desktop, '/teacher/groups/' + G.alg); await page.locator('[data-state="empty"]:visible').waitFor(); assert.match(await page.locator('[data-state="empty"]:visible').innerText(), /No Sessions yet/);
  await page.locator('[data-tab="students"]').click(); await page.locator('[data-state="empty"]:visible').waitFor(); assert.match(await page.locator('[data-state="empty"]:visible').innerText(), /No students in this Group yet/); assert.equal(await page.locator('[role="alert"]').count(), 0);
  await shot(page, 'group-empty-en-1440'); await context.close();
  await ctl({ scenario: 'demo', fail: { ['sessions:' + G.alg]: 1, ['members:' + G.alg]: 1, ['detail:' + G.phys]: 1 } });
  const e = await open(desktop, '/teacher/groups/' + G.alg); await e.page.locator('[role="alert"]').waitFor(); assert.equal(await e.page.locator('[data-state="empty"]').count(), 0);
  await shot(e.page, 'group-sessions-error-en-1440');
  await e.page.getByRole('button', { name: 'Try again' }).click(); await e.page.locator('[data-group-sessions]').waitFor();
  await e.page.locator('[data-tab="students"]').click(); await e.page.locator('[role="alert"]').waitFor(); await e.page.getByRole('button', { name: 'Try again' }).click(); await e.page.locator('[data-group-students]').waitFor(); await e.context.close();
  const p = await open(desktop, '/teacher/groups/' + G.phys); await p.page.locator('[role="alert"]').waitFor(); assert.equal(await p.page.locator('h1').count(), 0, 'no header from a failed read'); await p.page.getByRole('button', { name: 'Try again' }).click(); await p.page.locator('h1').waitFor(); await p.context.close();
  await ctl({ fail: { ['forbidden:' + G.alg]: 1 } });
  const f = await open(desktop, '/teacher/groups/' + G.alg); await f.page.locator('[role="alert"]').waitFor(); assert.match(await f.page.locator('[role="alert"]').innerText(), /do not have access/); assert.equal(await f.page.locator('[role="alert"] button').count(), 0); await f.context.close();
 });
 await step('Group buttons: Cancel session, Archive and Add a Session ask first, send the version they read, and report conflicts and lost replies honestly', async () => {
  const { page, context } = await open(desktop, '/teacher/groups/' + G.alg); await page.locator('[data-group-sessions]').waitFor();
  const first = page.locator('[data-session][data-state="upcoming"]').first();
  await first.locator('[data-cancel-session]').click(); assert.match(await first.innerText(), /Cancel this Session\?/); await first.getByRole('button', { name: 'Keep Session' }).click(); assert.equal((await ctl({})).posts.length, 0, 'nothing sent until confirmed');
  await ctl({ cmd: 'changed' }); await first.locator('[data-cancel-session]').click(); await first.locator('[data-confirm-cancel]').click(); await first.locator('[role="alert"]').waitFor(); assert.match(await first.locator('[role="alert"]').innerText(), /changed while you were looking/);
  await ctl({ cmd: 'lost' }); await first.locator('[data-confirm-cancel]').click(); await first.locator('[role="alert"]').filter({ hasText: /did not get a reply/ }).waitFor();
  const posted = (await ctl({})).posts.length; await page.waitForTimeout(600); assert.equal((await ctl({})).posts.length, posted, 'a lost reply is never retried by itself');
  await ctl({ cmd: 'ok' });
  await page.getByRole('button', { name: 'Reload' }).first().click(); await page.locator('[data-group-sessions]').waitFor();
  const fresh = page.locator('[data-session][data-state="upcoming"]').first(); await fresh.locator('[data-cancel-session]').click(); await fresh.locator('[data-confirm-cancel]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-session][data-state="cancelled"]').length === 2);
  const sent = (await ctl({})).posts.filter(p => p.data.operation === 'cancel').pop(); assert.equal(sent.action, 'session'); assert.equal(sent.groupId, G.alg); assert.equal(sent.data.sessionVersion, 1); assert.equal(sent.version, null);
  await shot(page, 'group-cancelled-en-1440');
  // Add a Session: Cairo wall time in winter is UTC+2, whatever the browser's own time zone is.
  await ctl({ reset: true });
  const add = await open(desktop, '/teacher/groups/' + G.alg); await add.page.locator('[data-group-sessions]').waitFor(); await add.page.locator('[data-add-session]').click(); await add.page.locator('[data-add-session-form]').waitFor();
  await add.page.getByRole('button', { name: 'Add Session' }).click(); assert.match(await add.page.locator('[data-add-session-form] [role="alert"]').innerText(), /Check the date and times/);
  await add.page.getByLabel('Title').fill('Synthetic catch-up'); await add.page.getByLabel('Date (Cairo time)').fill('2027-03-01'); await add.page.getByLabel('Starts').fill('12:00'); await add.page.getByLabel('Ends').fill('11:00');
  await add.page.getByRole('button', { name: 'Add Session' }).click(); assert.match(await add.page.locator('[data-add-session-form] [role="alert"]').innerText(), /must end after it starts/); assert.equal((await ctl({})).posts.length, 0);
  await add.page.getByLabel('Ends').fill('13:30'); await shot(add.page, 'group-add-session-en-1440'); await add.page.getByRole('button', { name: 'Add Session' }).click(); await add.page.locator('[data-add-session-form]').waitFor({ state: 'detached' });
  const one = (await ctl({})).posts[0]; assert.deepEqual({ ...one.data }, { title: 'Synthetic catch-up', startsAt: '2027-03-01T10:00:00.000Z', endsAt: '2027-03-01T11:30:00.000Z' }); assert.equal(one.action, 'one-off'); assert.equal(one.version, 3, 'the Group version it read');
  await page.waitForTimeout(0); await add.context.close();
  // Archive: only the instructor of the course sees it; asks first; sends the version.
  await ctl({ reset: true });
  const arch = await open(desktop, '/teacher/groups/' + G.alg); await arch.page.locator('[data-group-sessions]').waitFor();
  await arch.page.locator('[data-archive]').click(); assert.match(await arch.page.locator('[role="group"]').innerText(), /upcoming Sessions will be cancelled/); await arch.page.getByRole('button', { name: 'Keep Group' }).click(); assert.equal((await ctl({})).posts.length, 0);
  await arch.page.locator('[data-archive]').click(); await arch.page.locator('[data-confirm-archive]').click(); await arch.page.locator('[data-status="archived"]').waitFor();
  const a = (await ctl({})).posts[0]; assert.equal(a.action, 'archive'); assert.equal(a.version, 3); assert.equal(await arch.page.locator('[data-archive]').count(), 0); assert.equal(await arch.page.locator('[data-add-session]').count(), 0, 'an archived Group takes no new Sessions');
  assert.equal(await arch.page.locator('[data-session][data-state="upcoming"] [data-cancel-session]').count(), 0); await shot(arch.page, 'group-archived-en-1440'); await arch.context.close();
  const ni = await open(desktop, '/teacher/groups/' + G.phys); await ni.page.locator('[data-group-sessions]').waitFor(); assert.equal(await ni.page.locator('[data-archive]').count(), 0, 'not the instructor: no Archive'); assert.equal(await ni.page.locator('[data-add-session]').count(), 1); await ni.context.close();
  await ctl({ reset: true, cmd: 'denied' });
  const den = await open(desktop, '/teacher/groups/' + G.alg); await den.page.locator('[data-group-sessions]').waitFor(); await den.page.locator('[data-archive]').click(); await den.page.locator('[data-confirm-archive]').click(); await den.page.locator('[role="alert"]').waitFor(); assert.match(await den.page.locator('[role="alert"]').innerText(), /do not have access/); await den.context.close();
 });
 await step('Group tabs follow the keyboard: arrow keys move between tabs (mirrored in RTL), Tab reaches every control', async () => {
  const { page, context } = await open(desktop, '/teacher/groups/' + G.alg); await page.locator('[data-group-sessions]').waitFor();
  await page.locator('[data-tab="sessions"]').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'students'); await page.keyboard.press('ArrowLeft'); assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'sessions');
  assert.equal(await page.locator('[data-tab="students"]').getAttribute('tabindex'), '-1');
  const seen = new Set(); await page.locator('body').click({ position: { x: 5, y: 5 } }); for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); seen.add(await page.evaluate(() => { const e = document.activeElement; return e && e !== document.body ? e.tagName + ':' + (e.getAttribute('data-tab') || e.getAttribute('data-nav') || (e.textContent || '').trim().slice(0, 16)) : ''; })); }
  assert.ok(seen.size > 12, 'focus moves through the page (' + seen.size + ' stops)'); await context.close();
  const ar = await open(desktop, '/teacher/groups/' + G.alg, { lang: 'ar' }); await ar.page.locator('[data-group-sessions]').waitFor(); await ar.page.locator('[data-tab="sessions"]').focus(); await ar.page.keyboard.press('ArrowLeft'); assert.equal(await ar.page.evaluate(() => document.activeElement.dataset.tab), 'students', 'ArrowLeft goes forward in RTL'); await ar.context.close();
  const l = await open(desktop, '/teacher/groups'); await l.page.locator('[data-group-card]').first().waitFor(); await l.page.locator(`[data-group-card="${G.alg}"] h2 a`).focus(); await l.page.keyboard.press('Enter'); await l.page.waitForURL('**/teacher/groups/' + G.alg); await l.page.locator('h1').waitFor(); await l.context.close();
 });

 // ------------------------------------------------------------------ Settings
 await step('Settings, English desktop: inside the main frame, the root goes to My account, three sections from the one list in underline tabs', async () => {
  const { page, context } = await open(desktop, '/teacher/settings');
  await page.waitForURL('**/teacher/settings/account'); await page.locator('[data-settings-account]').waitFor();
  assert.equal(await page.locator('[data-teacher-nav]').count(), 1, 'inside the main teacher frame'); assert.equal(await page.locator('[data-nav="settings"]').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('h1:visible').count(), 1, 'one visible page heading'); assert.equal(await page.locator('h1:visible').innerText(), 'Settings');
  assert.deepEqual(await page.locator('[data-settings-sidebar] [data-settings-section]').allInnerTexts(), ['My account', 'Language and appearance', 'Notifications']);
  assert.equal(await page.locator('[data-settings-section="account"]').getAttribute('aria-current'), 'page');
  const t = await main(page); assert.match(t, /Synthetic Teacher/); assert.match(t, /synthetic\.teacher@example\.test/);
  const w = await page.locator('main .d-settings').evaluate(e => e.getBoundingClientRect().width); assert.ok(w <= 880.5, 'content is at most 880px wide (' + w + ')');
  await shot(page, 'settings-account-en-1440');
  for (const [key, expect] of [['language', /Arabic|العربية/], ['notifications', /notifications/i]]) {
   await page.locator(`[data-settings-sidebar] [data-settings-section="${key}"]`).click(); await page.waitForURL('**/teacher/settings/' + key);
   await page.locator('main').waitFor(); assert.match(await main(page), expect); assert.equal(await page.locator(`[data-settings-section="${key}"]`).getAttribute('aria-current'), 'page');
   await shot(page, `settings-${key}-en-1440`);
  }
  assert.equal(await page.locator('main a[href="/notifications"]').count(), 1, 'Notifications opens the existing preferences screen');
  await page.locator('[data-teacher-nav] [data-nav="courses"]').click(); await page.waitForURL('**/teacher/courses'); assert.equal(await page.locator('[data-course]').count(), 2); assert.equal(await page.locator('main [data-create-course]').count(), 1);
  assert.equal(await page.locator('[data-nav="courses"]').getAttribute('aria-current'), 'page'); await shot(page, 'courses-en-1440');
  assert.doesNotMatch(await main(page), forbidden);
  await context.close();
 });
 await step('Settings on a phone, English and Arabic: the list, each section its own page with a back arrow, no overflow, 44px targets', async () => {
  for (const lang of ['en', 'ar']) {
   const { page, context } = await open(phone, '/teacher/settings', { lang });
   await page.locator('[data-settings-list]').waitFor(); assert.equal(await page.url().endsWith('/teacher/settings'), true, 'a phone stays on the list');
   assert.equal(await page.locator('h1:visible').count(), 1, 'one visible page heading on a phone');
   assert.equal(await page.locator('[data-settings-list] [data-settings-section]').count(), 3); assert.ok(await overflow(page)); assert.deepEqual(await tinyTargets(page), []);
   assert.equal(await page.locator('[data-settings-sidebar]').isVisible(), false);
   const heights = await page.locator('[data-settings-list] [data-settings-section]').evaluateAll(n => n.map(e => e.getBoundingClientRect().height)); assert.ok(heights.every(h => h >= 64), 'big rows');
   if (lang === 'ar') { assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.match(await page.locator('body').innerText(), /الإعدادات/); assert.match(await page.locator('[data-settings-list]').innerText(), /حسابي[\s\S]*اللغة والمظهر[\s\S]*الإشعارات/); }
   await shot(page, `settings-list-${lang}-390`);
   await page.locator('[data-settings-list] [data-settings-section="language"]').click(); await page.waitForURL('**/teacher/settings/language'); await page.locator('[data-settings-language]').waitFor();
   assert.ok(await overflow(page), 'no overflow on the section page'); const arrow = page.locator('[data-settings-phone-back]'); assert.equal(await arrow.getAttribute('href'), '/teacher/settings'); const b = await arrow.boundingBox(); assert.ok(b.width >= 44 && b.height >= 44);
   await shot(page, `settings-language-${lang}-390`);
   await arrow.click(); await page.waitForURL('**/teacher/settings'); await page.locator('[data-settings-list]').waitFor();
   await page.locator('[data-settings-list] [data-settings-section="account"]').click(); await page.locator('[data-settings-account]').waitFor(); await shot(page, `settings-account-${lang}-390`);
   await context.close();
  }
  const arD = await open(desktop, '/teacher/settings/account', { lang: 'ar' }); await arD.page.locator('[data-settings-account]').waitFor();
  const tabOne = await arD.page.locator('[data-settings-section="account"]').evaluate(e => e.getBoundingClientRect()), tabTwo = await arD.page.locator('[data-settings-section="language"]').evaluate(e => e.getBoundingClientRect()); assert.ok(tabOne.left > tabTwo.left, 'the Settings tabs read from the right in RTL'); await shot(arD.page, 'settings-account-ar-1440'); await arD.context.close();
  const dk = await open(desktop, '/teacher/settings/account', { theme: 'dark' }); await dk.page.locator('[data-settings-account]').waitFor(); await dk.page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await shot(dk.page, 'settings-account-dark-1440'); await dk.context.close();
 });
 await step('Settings keyboard: the section tabs are reachable with Tab and open with Enter', async () => {
  const { page, context } = await open(desktop, '/teacher/settings/account'); await page.locator('[data-settings-account]').waitFor();
  await page.locator('[data-settings-sidebar] [data-settings-section="account"]').focus(); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.dataset.settingsSection), 'language'); await page.keyboard.press('Enter');
  await page.waitForURL('**/teacher/settings/language'); await context.close();
 });
 await step('Teacher menu in the real frame: four links and the Soon items, Settings at the bottom opens Settings', async () => {
  const { page, context } = await open(desktop, '/teacher/groups'); await page.locator('[data-teacher-nav]').waitFor();
  assert.deepEqual(await page.locator('[data-teacher-nav] [data-nav]').evaluateAll(n => n.map(e => e.dataset.nav)), ['home', 'groups', 'students', 'courses', 'homework', 'exams', 'reports']);
  assert.equal(await page.locator('[data-teacher-nav] a[href*="settings"], [data-teacher-nav] a[href*="analytics"]').count(), 0);
  await page.locator('[data-nav="settings"]').click(); await page.waitForURL('**/teacher/settings/account'); await page.locator('[data-settings-account]').waitFor(); await context.close();
 });


 // ------------------------------------------------------------------ Create a Group, Edit a Group, students in a Group
 const NEW = '/teacher/groups/new', tall = page => page.evaluate(() => [...document.querySelectorAll('main form button, main form input, main form select, main [data-group-students] button, main [data-group-students] input, main [data-details-edit] button')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height < 47.5; }).map(e => e.outerHTML.slice(0, 90)));
 const posts = () => fetch(origin + '/__posts').then(r => r.json());
 const fillCentre = async page => { await page.locator('[data-group-name]').fill('Synthetic new Group'); await page.locator('[data-group-location]').fill('Synthetic Centre'); await page.locator('[data-time-start]').first().fill('17:00'); };
 await step('Create: the middleware lets exactly the new page through, and lookalikes stay out', async () => {
  const get = p => fetch(origin + p, { redirect: 'manual' });
  assert.equal((await get(NEW)).status, 200);
  for (const bad of [NEW + '/', NEW + '/x', '/teacher/groups/news', '/teacher/groups/New']) assert.equal((await get(bad)).status, 307, bad);
  for (const bad of ['/api/study-groups/course-run/', '/api/study-groups/course-run/x', '/api/study-groups/other']) assert.equal((await get(bad)).status, 503, bad);
 });
 await step('Create from the list, English desktop: names every problem, saves with the course run out of sight, opens the new Group', async () => {
  const { page, context } = await open(desktop, '/teacher/groups');
  await page.locator('[data-group-card]').first().waitFor(); await page.locator('[data-create-group]').click(); await page.waitForURL('**' + NEW); await page.locator('[data-create-group-form]').waitFor();
  assert.deepEqual((await optionsOf(page.locator('[data-group-course]'))).map(o => o[0]), ['Synthetic Physics', 'Synthetic Chemistry']);
  await page.locator('[data-save-group]').click();
  assert.deepEqual(await page.locator('[data-problem]').evaluateAll(n => n.map(e => e.dataset.problem)), ['name', 'location', 'time'], 'empty fields are named');
  assert.equal((await posts()).length, 0, 'nothing is sent');
  await fillCentre(page); await page.locator('[data-group-capacity]').fill('0'); await page.locator('[data-save-group]').click();
  assert.deepEqual(await page.locator('[data-problem]').evaluateAll(n => n.map(e => e.dataset.problem)), ['capacity']);
  await page.locator('[data-group-capacity]').fill('15'); await pick(page.locator('[data-time-length]').first(), '90');
  assert.doesNotMatch(await main(page), forbidden); await shot(page, 'group-create-en-1440');
  await page.locator('[data-save-group]').click(); await page.waitForURL('**/teacher/groups/' + uuid(900));
  const sent = await posts(); assert.equal(sent.length, 1, 'a course with a current run needs only one call'); assert.equal(sent[0].action, 'create'); assert.equal(sent[0].groupId, null);
  assert.deepEqual(sent[0].data, { offeringId: uuid(101), definition: { name: 'Synthetic new Group', mode: 'center', location: 'Synthetic Centre', joinUrl: '', capacity: 15, schedules: [{ weekday: 0, time: '17:00', durationMinutes: 90 }], description: '', instructions: '' } });
  await page.locator('[data-teacher-group] h1').waitFor(); assert.equal(await page.locator('[data-teacher-group] h1').innerText(), 'Synthetic new Group');
  await context.close();
 });
 await step('Create in a course with no current run: it gets one first; online Group with two weekly times; a bad link and a repeated time are named', async () => {
  const { page, context } = await open(phone, NEW); await page.locator('[data-create-group-form]').waitFor();
  await pick(page.locator('[data-group-course]'), uuid(11)); await page.locator('[data-mode="online"]').click();
  assert.equal(await page.locator('[data-mode="online"]').getAttribute('aria-pressed'), 'true'); assert.equal(await page.locator('[data-group-location]').count(), 0);
  await page.locator('[data-group-name]').fill('Synthetic online'); await page.locator('[data-group-join]').fill('http://meet.example.test/room');
  await page.locator('[data-time-start]').first().fill('18:00'); await page.locator('[data-time-add]').click(); await page.locator('[data-time-start]').nth(1).fill('18:00');
  await page.locator('[data-save-group]').click();
  assert.deepEqual(await page.locator('[data-problem]').evaluateAll(n => n.map(e => e.dataset.problem)), ['join', 'times_duplicate']);
  await page.locator('[data-group-join]').fill('https://meet.example.test/room'); await pick(page.locator('[data-time-day]').nth(1), '3');
  await page.locator('[data-save-group]').click(); await page.waitForURL('**/teacher/groups/' + uuid(900));
  const sent = await posts(); assert.deepEqual(sent.map(p => p.action), ['course-run', 'create']); assert.deepEqual(sent[0].data, { courseId: uuid(11) }); assert.equal(sent[1].data.offeringId, uuid(990));
  assert.equal(sent[1].data.definition.location, ''); assert.equal(sent[1].data.definition.capacity, null); assert.equal(sent[1].data.definition.schedules.length, 2);
  await context.close();
 });
 await step('Create on a phone, English and Arabic: no sideways scroll, 48px controls, mirrored, teacher words only', async () => {
  for (const lang of ['en', 'ar']) {
   const { page, context } = await open(phone, NEW, { lang }); await page.locator('[data-create-group-form]').waitFor();
   await page.locator('[data-time-add]').click();
   assert.ok(await overflow(page), 'no horizontal scroll ' + lang); assert.deepEqual(await tall(page), [], '48px targets ' + lang); assert.deepEqual(await smallText(page), [], '16px text ' + lang);
   assert.doesNotMatch(await main(page), forbidden);
   if (lang === 'ar') { assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.match(await main(page), /إنشاء مجموعة/); assert.match(await main(page), /المواعيد الأسبوعية/); }
   await shot(page, `group-create-${lang}-390`); await context.close();
  }
 });
 await step('Create, other states: no course, a failed course read with retry, a refused save, a lost reply that does not invite a blind retry', async () => {
  const none = await open(phone, NEW + '?courses=none'); await none.page.locator('[data-state="empty"]').waitFor(); assert.match(await none.page.locator('[data-state="empty"]').innerText(), /You need a course/); assert.equal(await none.page.locator('[data-state="empty"] a').getAttribute('href'), '/teacher/settings/courses'); await none.context.close();
  const fail = await open(phone, NEW + '?courses=fail'); await fail.page.locator('[data-state="error"]').waitFor(); assert.equal(await fail.page.locator('[data-create-group-form]').count(), 0); await fail.page.getByRole('button', { name: 'Try again' }).click(); await fail.context.close();
  for (const [cmd, text] of [['invalid', /We could not create this Group/], ['denied', /You do not have access/], ['lost', /cannot tell whether it went through/]]) {
   await ctl({ cmd }); const o = await open(desktop, NEW); await o.page.locator('[data-create-group-form]').waitFor(); await fillCentre(o.page); await o.page.locator('[data-save-group]').click();
   await o.page.locator('[data-state="error"]').waitFor(); assert.match(await o.page.locator('[data-state="error"]').innerText(), text);
   if (cmd === 'lost') assert.equal(await o.page.locator('[data-state="error"] button').innerText(), 'See your Groups');
   await o.context.close();
  }
  await ctl({ cmd: 'ok' });
  await ctl({ scenario: 'cleared' }); const empty = await open(phone, '/teacher/groups'); await empty.page.locator('[data-create-group-empty]').waitFor(); assert.equal(await empty.page.locator('[data-create-group-empty]').getAttribute('href'), NEW); await empty.context.close();
 });
 await step('Edit from Details, desktop: filled in from the Group, sends its version and only what changed, warns about removed times, shows the result', async () => {
  const { page, context } = await open(desktop, '/teacher/groups/' + G.alg); await page.locator('[data-tab="details"]').click();
  await page.locator('[data-edit-group]').click(); await page.locator('[data-edit-group-form]').waitFor();
  assert.equal(await page.locator('[data-group-name]').inputValue(), 'Synthetic Algebra Group'); assert.equal(await page.locator('[data-group-location]').inputValue(), 'Synthetic Centre, Room 4'); assert.equal(await page.locator('[data-group-capacity]').inputValue(), '20'); assert.equal(await page.locator('[data-time-row]').count(), 2);
  assert.equal(await page.locator('[data-times-warning]').count(), 0); assert.equal(await page.locator('[data-place-note]').count(), 0);
  await page.locator('[data-cancel-edit]').click(); await page.locator('[data-group-details]').waitFor(); assert.equal((await posts()).length, 0, 'Cancel sends nothing');
  await page.locator('[data-edit-group]').click(); await page.locator('[data-group-name]').fill('Synthetic renamed'); await page.locator('[data-group-capacity]').fill('25');
  await page.locator('[data-save-edit]').click(); await page.locator('[data-group-details]').waitFor(); await page.waitForFunction(() => document.querySelector('[data-teacher-group] h1').innerText === 'Synthetic renamed');
  let sent = await posts(); assert.deepEqual(sent[0].data, { name: 'Synthetic renamed', mode: 'center', location: 'Synthetic Centre, Room 4', joinUrl: '', capacity: 25 }, 'unchanged times and place are left out'); assert.equal(sent[0].action, 'edit'); assert.equal(sent[0].version, 3);
  await page.locator('[data-edit-group]').click(); await page.locator('[data-time-remove]').first().click(); assert.equal(await page.locator('[data-times-warning]').count(), 1);
  await page.locator('[data-group-location]').fill('Synthetic Centre, Room 9'); assert.equal(await page.locator('[data-place-note]').count(), 1); assert.doesNotMatch(await main(page), forbidden); await shot(page, 'group-edit-en-1440');
  await page.locator('[data-save-edit]').click(); await page.locator('[data-group-details]').waitFor();
  sent = await posts(); assert.equal(sent[1].version, 4, 'the next save uses the version read after the first'); assert.equal(sent[1].data.applyMeetingDefaults, true); assert.deepEqual(sent[1].data.schedules, [{ weekday: 3, time: '17:00', durationMinutes: 90 }]);
  await context.close();
 });
 await step('Edit, conflicts and limits: a stale version says so and reloads, a capacity below the students says so, only the instructor of an active Group sees it', async () => {
  await ctl({ cmd: 'changed' }); const { page, context } = await open(phone, '/teacher/groups/' + G.alg); await page.locator('[data-tab="details"]').click(); await page.locator('[data-edit-group]').click(); await page.locator('[data-group-name]').fill('Stale');
  await page.locator('[data-save-edit]').click(); await page.locator('[data-state="error"]').waitFor(); assert.match(await page.locator('[data-state="error"]').innerText(), /This changed while you were looking at it/);
  await ctl({ cmd: 'ok' }); await page.getByRole('button', { name: 'Reload' }).click(); await page.locator('[data-group-details]').waitFor(); assert.equal(await page.locator('[data-teacher-group] h1').innerText(), 'Synthetic Algebra Group', 'the unsaved change is gone and the Group reads again');
  await ctl({ cmd: 'invalid' }); await page.locator('[data-edit-group]').click(); await page.locator('[data-group-capacity]').fill('1'); await page.locator('[data-save-edit]').click(); await page.locator('[data-state="error"]').waitFor(); assert.match(await page.locator('[data-state="error"]').innerText(), /Capacity cannot be lower than the number of students/);
  assert.ok(await overflow(page), 'no horizontal scroll'); assert.deepEqual(await tall(page), [], '48px targets'); await shot(page, 'group-edit-en-390'); await context.close(); await ctl({ cmd: 'ok' });
  for (const [id, why] of [[G.phys, 'not the instructor'], [G.old, 'archived']]) { const o = await open(desktop, '/teacher/groups/' + id); await o.page.locator('[data-tab="details"]').click(); await o.page.locator('[data-group-details]').waitFor(); assert.equal(await o.page.locator('[data-edit-group]').count(), 0, why); await o.context.close(); }
  const ar = await open(phone, '/teacher/groups/' + G.alg, { lang: 'ar' }); await ar.page.locator('[data-tab="details"]').click(); await ar.page.locator('[data-edit-group]').click(); await ar.page.locator('[data-edit-group-form]').waitFor(); assert.ok(await overflow(ar.page), 'no horizontal scroll in Arabic'); assert.match(await main(ar.page), /حفظ التغييرات/); assert.doesNotMatch(await main(ar.page), forbidden); await shot(ar.page, 'group-edit-ar-390'); await ar.context.close();
 });
 await step('Students: add from those with access (never one already here), several in a row with no reload, remove asks first and the list follows', async () => {
  const { page, context } = await open(desktop, '/teacher/groups/' + G.alg); await page.locator('[data-tab="students"]').click(); await page.locator('[data-group-students]').waitFor();
  assert.match(await page.locator('[data-students-total]').innerText(), /12 of 20 students/); await page.locator('[data-add-student]').click(); await page.locator('[data-eligible]').first().waitFor();
  assert.equal(await page.locator(`[data-eligible="${uuid(6000)}"]`).count(), 0, 'someone already in the Group is not offered'); assert.equal(await page.locator(`[data-eligible="${uuid(6012)}"]`).count(), 1, 'a student who left can come back');
  await shot(page, 'group-students-add-en-1440');
  await page.locator('[data-student-search]').fill('student 15'); await page.waitForFunction(() => document.querySelectorAll('[data-eligible]').length === 1); await page.locator('[data-add-one]').click();
  await page.waitForFunction(id => !document.querySelector(`[data-eligible="${id}"]`) && !!document.querySelector(`[data-student="${id}"]`), uuid(6014));
  await page.locator('[data-student-search]').fill('student 16'); await page.waitForFunction(id => !!document.querySelector(`[data-eligible="${id}"]`), uuid(6015)); await page.locator('[data-add-one]').click();
  await page.waitForFunction(id => !!document.querySelector(`[data-student="${id}"]`), uuid(6015));
  let sent = await posts(); assert.deepEqual(sent.map(p => [p.action, p.version, p.data.userId]), [['add', 3, uuid(6014)], ['add', 4, uuid(6015)]], 'the second add uses the version the first returned');
  await page.waitForFunction(() => /14 of 20 students/.test(document.querySelector('[data-students-total]').innerText));
  await page.locator('[data-student-search]').fill('nobody at all'); await page.locator('[data-add-students] [data-state="empty"]').waitFor(); assert.match(await page.locator('[data-add-students] [data-state="empty"]').innerText(), /No student matches/);
  await page.locator('[data-close-add]').click(); assert.equal(await page.locator('[data-add-students]').count(), 0);
  const row = page.locator(`[data-student="${uuid(6000)}"]`); assert.equal(await row.locator('[data-remove-student]').getAttribute('aria-label'), 'Remove Synthetic student 1');
  await row.locator('[data-remove-student]').click(); assert.match(await row.innerText(), /keep their access to the course/); assert.equal((await posts()).length, 2, 'asks first');
  await row.getByRole('button', { name: 'Keep' }).click(); assert.equal((await posts()).length, 2); await row.locator('[data-remove-student]').click(); await row.locator('[data-confirm-remove]').click();
  await page.waitForFunction(id => !document.querySelector(`[data-student="${id}"]`), uuid(6000));
  sent = await posts(); assert.deepEqual([sent[2].action, sent[2].version, sent[2].data.userId], ['remove', 5, uuid(6000)]); assert.doesNotMatch(await main(page), forbidden); await context.close();
 });
 await step('Students, states: nobody with access, a full Group, an add the database refuses, a failed read with retry, a stale removal, an archived Group', async () => {
  S.data.eligible = []; const none = await open(phone, '/teacher/groups/' + G.old.replace(G.old, G.phys)); await none.page.locator('[data-tab="students"]').click(); await none.page.locator('[data-add-student]').click(); await none.page.locator('[data-add-students] [data-state="empty"]').waitFor(); assert.match(await none.page.locator('[data-add-students] [data-state="empty"]').innerText(), /Only students who already have access/); await none.context.close();
  await ctl({ reset: true }); S.data.groups[G.alg].capacity = 12; const full = await open(desktop, '/teacher/groups/' + G.alg); await full.page.locator('[data-tab="students"]').click(); await full.page.locator('[data-add-student]').click(); await full.page.locator('[data-group-full]').waitFor(); await full.page.locator('[data-add-one]').first().waitFor(); assert.equal(await full.page.locator('[data-add-one]').first().isDisabled(), true, 'a full Group offers no Add'); await full.context.close();
  await ctl({ reset: true, cmd: 'invalid' }); const refused = await open(desktop, '/teacher/groups/' + G.alg); await refused.page.locator('[data-tab="students"]').click(); await refused.page.locator('[data-add-student]').click(); await refused.page.locator('[data-add-one]').first().click(); await refused.page.locator('[data-add-students] [data-state="error"]').waitFor(); assert.match(await refused.page.locator('[data-add-students] [data-state="error"]').innerText(), /may already be in another Group/); await refused.context.close();
  await ctl({ reset: true, fail: { ['eligible:' + G.alg]: 1 } }); const failed = await open(desktop, '/teacher/groups/' + G.alg); await failed.page.locator('[data-tab="students"]').click(); await failed.page.locator('[data-add-student]').click(); await failed.page.locator('[data-add-students] [data-state="error"]').waitFor(); await failed.page.getByRole('button', { name: 'Try again' }).click(); await failed.page.locator('[data-eligible]').first().waitFor(); await failed.context.close();
  await ctl({ reset: true, cmd: 'changed' }); const stale = await open(desktop, '/teacher/groups/' + G.alg); await stale.page.locator('[data-tab="students"]').click(); await stale.page.locator('[data-remove-student]').first().click(); await stale.page.locator('[data-confirm-remove]').click(); await stale.page.locator('[data-group-students] [data-state="error"]').waitFor(); assert.match(await stale.page.locator('[data-group-students] [data-state="error"]').innerText(), /This changed while you were looking at it/); await stale.context.close();
  await ctl({ reset: true }); const old = await open(desktop, '/teacher/groups/' + G.old); await old.page.locator('[data-tab="students"]').click(); await old.page.locator('[data-group-students]').waitFor(); assert.equal(await old.page.locator('[data-add-student]').count(), 0, 'an archived Group cannot change'); await old.context.close();
 });
 await step('Students on a phone, English and Arabic: rows and buttons are 48px, no sideways scroll, mirrored, Arabic copy, a long name wraps', async () => {
  for (const lang of ['en', 'ar']) {
   const { page, context } = await open(phone, '/teacher/groups/' + G.alg, { lang }); await page.locator('[data-tab="students"]').click(); await page.locator('[data-group-students]').waitFor(); await page.locator('[data-add-student]').click(); await page.locator('[data-eligible]').first().waitFor(); await page.locator('[data-remove-student]').first().click();
   assert.ok(await overflow(page), 'no horizontal scroll ' + lang); assert.deepEqual(await tall(page), [], '48px targets ' + lang); assert.doesNotMatch(await main(page), forbidden);
   if (lang === 'ar') { assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.match(await main(page), /إضافة/); assert.match(await main(page), /هل تريد إزالة/); }
   await shot(page, `group-students-add-${lang}-390`); await context.close();
  }
 });

 await browser.close(); server.close();
 assert.deepEqual(errors, [], 'no uncaught or console errors');
 assert.deepEqual(external, [], 'no external requests');
 const apis = [...new Set(requests.slice(probes).filter(r => /\/api\//.test(r) && !/^GET \/api\/study-groups\//.test(r)))].sort(); // those GETs are the Create step's middleware probes
 assert.deepEqual(apis.filter(r => !/\/api\/(study-groups(\/course-run)?|student-administration|communications|user\/status)$/.test(r)), [], 'the screens call no other API: ' + apis.join(', '));
 console.log(`Teacher Settings and Groups browser checks passed: ${results.length} groups (real middleware, synthetic loopback data, not provider E2E). Screenshots: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
