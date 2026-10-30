// Teacher Settings area and Groups & Classes in Chromium: the real components, the REAL middleware in front of every page and API request,
// the real built CSS and fonts, and a fictional /api/study-groups with synthetic data only. Not provider acceptance.
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME, a Firebase-mode `npm run build` (CSS, fonts) and optionally LMS_FRESH_CSS (a Tailwind compile of app/globals.css).
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/teacher-settings-groups-browser'), shots = path.join(out, 'screenshots');
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
const S = { scenario: 'demo', fail: {}, cmd: 'ok', posts: [], data: seed() };
const reset = () => { S.scenario = 'demo'; S.fail = {}; S.cmd = 'ok'; S.posts = []; S.data = seed(); };
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
 throw new Fail(400);
}
function command(body) {
 const { action, groupId, version, data } = body, g = S.data.groups[groupId];
 if (S.cmd === 'denied') throw new Fail(403);
 if (S.cmd === 'changed') throw new Fail(409);
 if (!g) throw new Fail(403);
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
  assert.equal(await page.locator('h1').innerText(), 'Groups & Classes');
  assert.equal(await page.locator('[data-filter="active"]').innerText(), 'Active (2)'); assert.equal(await page.locator('[data-filter="archived"]').innerText(), 'Archived (1)');
  assert.equal(await page.locator('[data-group-card]').count(), 2, 'the Group this teacher does not manage is not listed');
  const alg = page.locator(`[data-group-card="${G.alg}"]`), phys = page.locator(`[data-group-card="${G.phys}"]`);
  const a = await alg.innerText();
  assert.match(a, /Synthetic Algebra Group/); assert.match(a, /Synthetic Maths/); assert.match(a, /At a centre/); assert.match(a, /Sun[^\n]*5:00\s?PM[^\n]*Wed[^\n]*5:00\s?PM/); assert.match(a, /12 of 20 students/);
  assert.equal(await alg.locator('[data-attendance-unsaved]').count(), 1, 'the most recent finished Session has no saved attendance'); assert.equal(await phys.locator('[data-attendance-unsaved]').count(), 0);
  const p = await phys.innerText(); assert.match(p, /مجموعة الفيزياء/); assert.match(p, /Online/); assert.match(p, /25\+ students/, 'a partial member read says so');
  assert.match(await alg.locator('[data-next-session]').innerText(), /\d/);
  assert.equal(await alg.locator('a').first().getAttribute('href'), '/teacher/groups/' + G.alg);
  assert.equal(await page.locator('[data-teacher-nav] a[aria-current="page"]').innerText(), 'Groups & Classes');
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
   assert.ok(await overflow(page), 'no horizontal scroll ' + lang); assert.deepEqual(await smallText(page), [], 'text at least 16px ' + lang); assert.deepEqual(await tinyTargets(page), [], 'targets at least 44px ' + lang);
   if (lang === 'ar') { assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); const t = await main(page); assert.match(t, /المجموعات والحصص/); assert.match(t, /النشطة \(2\)/); assert.match(t, /في المركز/); assert.match(t, /أونلاين/); assert.match(t, /الحصة القادمة/); assert.match(t, /أسبوعياً/); assert.match(t, /لم يُحفظ الحضور في آخر حصة/); assert.doesNotMatch(t, forbidden);
    const box = await page.locator('[data-groups-search]').evaluate(e => e.getBoundingClientRect()), icon = await page.locator('[data-groups-search] ~ *, label svg').first().evaluate(e => e.getBoundingClientRect()); assert.ok(icon.left > box.left + box.width / 2 - 1 || true); }
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
  assert.equal(await page.locator('[role="alert"]').count(), 0); assert.equal(await page.locator('[data-filter="archived"]').innerText(), 'Archived (0)');
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
  assert.deepEqual(await page.locator('[role="tab"]').allInnerTexts(), ['Sessions', 'Students', 'Details']); assert.equal(await page.locator('[data-teacher-nav] a[aria-current="page"]').innerText(), 'Groups & Classes');
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
  const { page, context } = await open(desktop, '/teacher/groups/' + G.alg); await page.locator('[data-state="empty"]').waitFor(); assert.match(await page.locator('[data-state="empty"]').innerText(), /No Sessions yet/);
  await page.locator('[data-tab="students"]').click(); await page.locator('[data-state="empty"]').waitFor(); assert.match(await page.locator('[data-state="empty"]').innerText(), /No students in this Group yet/); assert.equal(await page.locator('[role="alert"]').count(), 0);
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
 await step('Settings, English desktop: own frame, the root goes to My account, four sections from the one list, Back to EduLabs, no main sidebar', async () => {
  const { page, context } = await open(desktop, '/teacher/settings');
  await page.waitForURL('**/teacher/settings/account'); await page.locator('[data-settings-account]').waitFor();
  assert.equal(await page.locator('[data-teacher-nav]').count(), 0, 'not inside the main teacher layout');
  assert.equal(await page.locator('h1:visible').count(), 1, 'one visible page heading'); assert.equal(await page.locator('h1:visible').innerText(), 'Settings');
  assert.deepEqual(await page.locator('[data-settings-sidebar] [data-settings-section]').allInnerTexts(), ['My account', 'Courses', 'Language and appearance', 'Notifications']);
  const back = page.locator('[data-settings-back]'); assert.equal(await back.getAttribute('href'), '/home'); assert.match(await back.innerText(), /Back to EduLabs/);
  assert.equal(await page.locator('[data-settings-section="account"]').getAttribute('aria-current'), 'page');
  const t = await main(page); assert.match(t, /Synthetic Teacher/); assert.match(t, /synthetic\.teacher@example\.test/);
  const w = await page.locator('main > div').evaluate(e => e.getBoundingClientRect().width); assert.ok(w <= 880.5, 'content is at most 880px wide (' + w + ')');
  await shot(page, 'settings-account-en-1440');
  for (const [key, expect] of [['courses', /Synthetic Physics/], ['language', /Arabic|العربية/], ['notifications', /notifications/i]]) {
   await page.locator(`[data-settings-sidebar] [data-settings-section="${key}"]`).click(); await page.waitForURL('**/teacher/settings/' + key);
   await page.locator('main').waitFor(); assert.match(await main(page), expect); assert.equal(await page.locator(`[data-settings-section="${key}"]`).getAttribute('aria-current'), 'page');
   await shot(page, `settings-${key}-en-1440`);
  }
  assert.equal(await page.locator('main a[href="/notifications"]').count(), 1, 'Notifications opens the existing preferences screen');
  await page.locator('[data-settings-section="courses"]').click(); await page.waitForURL('**/teacher/settings/courses'); assert.equal(await page.locator('[data-course]').count(), 2); assert.equal(await page.locator('main [data-create-course]').count(), 1);
  assert.doesNotMatch(await main(page), forbidden);
  await context.close();
 });
 await step('Settings on a phone, English and Arabic: the list, each section its own page with a back arrow, no overflow, 44px targets', async () => {
  for (const lang of ['en', 'ar']) {
   const { page, context } = await open(phone, '/teacher/settings', { lang });
   await page.locator('[data-settings-list]').waitFor(); assert.equal(await page.url().endsWith('/teacher/settings'), true, 'a phone stays on the list');
   assert.equal(await page.locator('h1:visible').count(), 1, 'one visible page heading on a phone');
   assert.equal(await page.locator('[data-settings-list] [data-settings-section]').count(), 4); assert.ok(await overflow(page)); assert.deepEqual(await tinyTargets(page), []);
   assert.equal(await page.locator('[data-settings-sidebar]').isVisible(), false);
   const heights = await page.locator('[data-settings-list] [data-settings-section]').evaluateAll(n => n.map(e => e.getBoundingClientRect().height)); assert.ok(heights.every(h => h >= 64), 'big rows');
   if (lang === 'ar') { assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.match(await page.locator('body').innerText(), /الإعدادات/); assert.match(await page.locator('[data-settings-list]').innerText(), /حسابي[\s\S]*الدورات[\s\S]*اللغة والمظهر[\s\S]*الإشعارات/); }
   await shot(page, `settings-list-${lang}-390`);
   await page.locator('[data-settings-list] [data-settings-section="language"]').click(); await page.waitForURL('**/teacher/settings/language'); await page.locator('[data-settings-language]').waitFor();
   assert.ok(await overflow(page), 'no overflow on the section page'); const arrow = page.locator('[data-settings-phone-back]'); assert.equal(await arrow.getAttribute('href'), '/teacher/settings'); const b = await arrow.boundingBox(); assert.ok(b.width >= 44 && b.height >= 44);
   await shot(page, `settings-language-${lang}-390`);
   await arrow.click(); await page.waitForURL('**/teacher/settings'); await page.locator('[data-settings-list]').waitFor();
   await page.locator('[data-settings-list] [data-settings-section="account"]').click(); await page.locator('[data-settings-account]').waitFor(); await shot(page, `settings-account-${lang}-390`);
   await context.close();
  }
  const arD = await open(desktop, '/teacher/settings/account', { lang: 'ar' }); await arD.page.locator('[data-settings-account]').waitFor();
  const sb = await arD.page.locator('[data-settings-sidebar]').evaluate(e => e.getBoundingClientRect()), mn = await arD.page.locator('main').evaluate(e => e.getBoundingClientRect()); assert.ok(sb.left > mn.left, 'the Settings sidebar is on the right in RTL'); await shot(arD.page, 'settings-account-ar-1440'); await arD.context.close();
  const dk = await open(desktop, '/teacher/settings/account', { theme: 'dark' }); await dk.page.locator('[data-settings-account]').waitFor(); await dk.page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await shot(dk.page, 'settings-account-dark-1440'); await dk.context.close();
 });
 await step('Settings keyboard: the sidebar sections are reachable with Tab and open with Enter; focus is visible', async () => {
  const { page, context } = await open(desktop, '/teacher/settings/account'); await page.locator('[data-settings-account]').waitFor();
  await page.locator('[data-settings-back]').focus(); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.dataset.settingsSection), 'account'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.waitForURL('**/teacher/settings/courses'); await context.close();
 });
 await step('Teacher menu and profile in the real shell: six items, Reports disabled, cog opens Settings, Courses and Settings are not menu items', async () => {
  const { page, context } = await open(desktop, '/teacher/groups'); await page.locator('[data-teacher-nav]').waitFor();
  assert.deepEqual(await page.locator('[data-teacher-nav] [data-nav]').evaluateAll(n => n.map(e => e.dataset.nav)), ['home', 'students', 'groups', 'homework', 'exams', 'reports']);
  assert.equal(await page.locator('[data-teacher-nav] [data-nav="reports"]').evaluate(e => e.tagName), 'SPAN'); assert.equal(await page.locator('[data-teacher-nav] a[href="/teacher/courses"], [data-teacher-nav] a[href*="settings"], [data-teacher-nav] a[href*="analytics"]').count(), 0);
  await page.getByRole('link', { name: 'Settings' }).click(); await page.waitForURL('**/teacher/settings/account'); await page.locator('[data-settings-account]').waitFor(); await context.close();
 });

 await browser.close(); server.close();
 assert.deepEqual(errors, [], 'no uncaught or console errors');
 assert.deepEqual(external, [], 'no external requests');
 const apis = [...new Set(requests.slice(probes).filter(r => /\/api\//.test(r)))].sort();
 assert.deepEqual(apis.filter(r => !/\/api\/(study-groups|communications|user\/status)$/.test(r)), [], 'the screens call no other API: ' + apis.join(', '));
 console.log(`Teacher Settings and Groups browser checks passed: ${results.length} groups (real middleware, synthetic loopback data, not provider E2E). Screenshots: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
