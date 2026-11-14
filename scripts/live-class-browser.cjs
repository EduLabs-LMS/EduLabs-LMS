// The class page (/class/<session>, the EduLabs class) in Chromium: the real LiveClassView inside the real teacher frame (staff) or the real
// student shell (students), the REAL middleware in front of every page and API request, the real provider building the meeting options and
// the "Open in a new tab" address (synthetic secret), the real built CSS and fonts, and a STUB of the meeting server's external_api.js (a
// synthetic meeting in an iframe; no Jitsi, no network). Synthetic loopback data only; not provider acceptance.
// Covers: Start (the button and ?start=1), Join (open, and waiting until the teacher starts), early, ended, cancelled, not allowed, not
// available, too many tries, a failed read with Retry, Leave and Join again, the meeting script failing (Retry, Open in a new tab), Open in a new
// tab (the meeting here closes, "Open it here instead"), phone and desktop, English and Arabic, dark; LMS_MATRIX=1 adds the screen matrix
// (staff screens in both looks; students' screens in Classic, the only look of the student shell).
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME and a Firebase-mode `npm run build` first (CSS, fonts). LMS_ONLY_STEPS runs matching steps.
const { shootMatrix } = require('./screen-matrix.cjs');
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), crypto = require('crypto'), assert = require('node:assert/strict'), ts = require('typescript');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME || path.resolve('node_modules');
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/live-class-browser'), shots = path.join(out, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the real CSS and fonts are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat([require('./harness-css.cjs')()]).join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

// ---- server-side modules, loaded as they are (the real middleware and the real provider)
function loadTs(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { module: m, exports: m.exports, URL, Buffer, Date, require: n => n === 'zod' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
class NextResponse { constructor(kind, status, location) { this.kind = kind; this.status = status; this.location = location; this.headers = new Map(); } static next() { return new NextResponse('next', 200); } static json(_, o) { return new NextResponse('json', o.status); } static redirect(u) { return new NextResponse('redirect', 307, u.pathname); } }
const middleware = loadTs('middleware.ts', {
 '@/shared/public-website': loadTs('shared/public-website.ts', { zod: require('zod') }), '@/shared/website-routes': loadTs('shared/website-routes.ts'),
 '@clerk/nextjs/server': { clerkMiddleware: () => () => { throw Error('the legacy handler must not run in Firebase staging'); }, createRouteMatcher: () => () => false },
 '@/shared/auth-config': { isFirebaseStaging: () => true }, 'next/server': { NextResponse },
}).default;
const gate = p => middleware({ nextUrl: new URL('https://platform.example' + p), url: 'https://platform.example' + p }, {});
const provider = loadTs('server/services/live-class-provider.ts', { 'server-only': {}, 'node:crypto': crypto });
const MEET = 'https://meet.example.test';
const config = provider.liveClassConfig({ LIVE_CLASS_PROVIDER: 'jitsi', LIVE_CLASS_URL: MEET, LIVE_CLASS_APP_ID: 'synthetic', LIVE_CLASS_SECRET: crypto.randomBytes(48).toString('hex') });
assert.ok(config, 'the synthetic provider settings are valid');

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { TeacherFrame } from '@/frontend/features/teacher-frame/teacher-frame';
import Sidebar from '@/frontend/components/sidebar';
import MobileSidebar from '@/frontend/features/dashboard/mobile-sidebar';
import Footer from '@/frontend/components/footer';
import { LiveClassView } from '@/frontend/features/live-class/class-view';
const sessionId = location.pathname.split('/')[2];
const query = new URLSearchParams(location.search);
let lang = 'en', role = 'student';
try { lang = localStorage.getItem('edulabs-lms-language') === 'ar' ? 'ar' : 'en'; role = localStorage.getItem('lms-harness-role') === 'staff' ? 'staff' : 'student'; } catch {}
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
document.documentElement.dataset.design = query.get('design') === 'new' ? 'new' : 'classic';
// As the page does: app/(dashboard)/(routes)/class/[sessionId]/page.tsx passes start=true for ?start=1.
const view = <LiveClassView sessionId={sessionId} start={query.get('start') === '1'} />;
// As app/(dashboard)/layout.tsx does: staff of a space get the teacher frame, everyone else the student shell.
const body = role === 'staff' ? <TeacherFrame>{view}</TeacherFrame> : <div data-lms-shell className="min-h-screen bg-slate-50 w-full relative">
 <MobileSidebar />
 <aside className="hidden md:block fixed start-4 top-4 bottom-4 w-64 z-50"><Sidebar /></aside>
 <main className="md:ps-72 pt-2 md:pt-4 min-h-screen bg-slate-50 flex flex-col justify-between">
  <div className="flex-1 w-full p-4 sm:p-6 md:p-8">{view}</div><Footer />
 </main>
</div>;
createRoot(document.getElementById('root')).render(
 <LanguageProvider initialLanguage={lang}>
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>{body}</ThemeProvider>
 </LanguageProvider>);
`;

// ---- the stub of the meeting server's IFrame API: the same constructor and the three things the page uses (addListener, dispose, the iframe
// in parentNode). It records what it was given, and window.__hangup() is the meeting's own Leave (readyToClose).
const stubApi = `(function () {
 window.__meetings = window.__meetings || []; window.__disposed = window.__disposed || 0;
 window.JitsiMeetExternalAPI = function (domain, options) {
  var listeners = {}, frame = document.createElement('iframe');
  var emit = function (e) { (listeners[e] || []).forEach(function (fn) { fn(); }); };
  frame.src = 'https://' + domain + '/' + options.roomName; frame.title = 'Synthetic meeting';
  frame.setAttribute('allow', 'camera; microphone; display-capture; fullscreen'); frame.style.width = '100%'; frame.style.height = '100%';
  options.parentNode.appendChild(frame);
  var o = options.configOverwrite || {};
  window.__meetings.push({ domain: domain, roomName: options.roomName, jwt: options.jwt, lang: options.lang, name: options.userInfo && options.userInfo.displayName,
   toolbarButtons: o.toolbarButtons, startWithAudioMuted: o.startWithAudioMuted, startWithVideoMuted: o.startWithVideoMuted, disableDeepLinking: o.disableDeepLinking, inPage: !!options.parentNode });
  window.__hangup = function () { emit('readyToClose'); };
  this.addListener = function (e, fn) { (listeners[e] = listeners[e] || []).push(fn); };
  this.dispose = function () { frame.remove(); window.__disposed++; };
  setTimeout(function () { emit('videoConferenceJoined'); }, 30);
 };
})();`;
const meetingPage = '<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#1d1f24;color:#f4f4f4;font:600 18px system-ui">Synthetic meeting</body></html>';

// ---- the fictional class service (what private.live_class_open returns, through the real provider for "open")
const H = 3600000, M = 60000;
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const iso = t => new Date(t).toISOString();
const GROUP = uuid(900);
const C = { ready: uuid(1), start: uuid(2), waiting: uuid(3), open: uuid(4), early: uuid(5), ended: uuid(6), cancelled: uuid(7), denied: uuid(8), off: uuid(9), busy: uuid(10), flaky: uuid(11), staffOpen: uuid(12), broken: uuid(13), arabic: uuid(14) };
const staffOf = new Set([C.ready, C.start, C.staffOpen]);
const S = { posts: [], started: new Set(), flaky: 0, scriptFail: false };
const reset = () => { S.posts = []; S.started = new Set([C.open, C.staffOpen, C.broken, C.arabic]); S.flaky = 0; S.scriptFail = false; };
reset();
function openClass(body) {
 const { sessionId: id, start } = body, now = Date.now();
 if (id === C.denied) return [403, { kind: 'denied' }];
 if (id === C.off) return [404, { kind: 'off' }];
 if (id === C.busy) return [429, { kind: 'busy' }];
 if (id === C.flaky && S.flaky++ === 0) return [503, { kind: 'failed' }];
 if (!Object.values(C).includes(id)) return [403, { kind: 'denied' }];
 const staff = staffOf.has(id);
 const startsAt = id === C.early ? now + 35 * M : id === C.ended ? now - 3 * H : now - 5 * M;
 const endsAt = startsAt + H, opensAt = startsAt - 15 * M, closesAt = endsAt + 30 * M;
 const title = id === C.arabic ? 'مراجعة الفيزياء' : 'Synthetic Physics revision';
 const base = { sessionId: id, groupId: GROUP, title, groupName: id === C.arabic ? 'مجموعة الفيزياء' : 'Synthetic Physics Group', startsAt: iso(startsAt), endsAt: iso(endsAt), opensAt: iso(opensAt), closesAt: iso(closesAt), serverNow: iso(now), staff };
 if (id === C.cancelled) return [200, { ...base, state: 'cancelled' }];
 if (now < opensAt) return [200, { ...base, state: 'early' }];
 if (now >= closesAt) return [200, { ...base, state: 'ended' }];
 if (!S.started.has(id)) {
  if (!staff) return [200, { ...base, state: 'waiting' }];
  if (!start) return [200, { ...base, state: 'ready' }];
  S.started.add(id);
 }
 const room = crypto.createHash('sha256').update(id).digest('hex');
 const join = provider.classJoin(config, { room, name: staff ? 'Synthetic Teacher' : 'Synthetic Student', moderator: staff, title, closesAt, now });
 return [200, { ...base, state: 'open', startedNow: Boolean(start && staff), join: JSON.parse(JSON.stringify(join)) }];
}

(async () => {
 const stubs = {
  '@/frontend/components/providers/use-loading-router': 'export const useLoadingRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() {} });',
  'next/navigation': 'export const usePathname = () => location.pathname; export const useRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() {} }); export const useSearchParams = () => new URLSearchParams(location.search);',
  'next/link': 'import React from "react"; export default function Link({ href, children, onClick, prefetch, ...rest }) { return React.createElement("a", { ...rest, href, onClick: e => { onClick && onClick(e); if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); location.assign(href); } }, children); }',
  'next/image': 'import React from "react"; export default function Image({ unoptimized, fill, priority, ...p }) { return React.createElement("img", p); }',
  '@/shared/auth-config': 'export const isFirebaseStaging = () => true;',
  '@/frontend/components/providers/application-auth-provider': 'const staff = (() => { try { return localStorage.getItem("lms-harness-role") === "staff"; } catch { return false; } })(); export const useApplicationAuth = () => ({ user: { fullName: staff ? "Synthetic Teacher" : "Synthetic Student", email: "synthetic@example.test", imageUrl: null, id: "u" }, openUserProfile() {}, signOut: async () => {}, accountStatus: { loading: false } }); export const useWebsiteNavigation = () => ({ viewer: { id: "v", displayName: staff ? "Synthetic Teacher" : "Synthetic Student" }, organizations: [{ id: "00000000-0000-4000-8000-000000000050", name: "Synthetic space" }], staffOrganizationIds: staff ? ["00000000-0000-4000-8000-000000000050"] : [] }); export const WebsiteNavigationProvider = ({ children }) => children;',
  '@/frontend/components/providers/v2-identity': 'import React from "react"; export const useUser = () => ({ user: { fullName: "Synthetic Student" } }); export const useClerk = () => ({ signOut() {} }); export const UserButton = () => React.createElement("span", { className: "h-9 w-9 rounded-full border-2 border-black" });',
 };
 const resolveAlias = p => { for (const c of [p + '.tsx', p + '.ts', path.join(p, 'index.tsx'), path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return p; };
 await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: path.join(out, 'app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'boundary', setup(b) {
   b.onResolve({ filter: /.*/ }, a => { if (stubs[a.path]) return { path: a.path, namespace: 'stub' }; if (a.path.startsWith('@/')) return { path: resolveAlias(path.resolve(a.path.slice(2))) }; });
   b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'jsx', resolveDir: process.cwd() }));
  } }] });

 const requests = [], pageHeaders = {};
 const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/__app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
  if (url.pathname === '/__style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
  if (url.pathname === '/__ctl') { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => { const b = JSON.parse(Buffer.concat(parts) || '{}'); if (b.reset) reset(); if (b.start) S.started.add(b.start); if ('scriptFail' in b) S.scriptFail = b.scriptFail; send({ posts: S.posts, scriptFail: S.scriptFail }); }); return; }
  // Everything else goes through the real middleware first.
  requests.push(req.method + ' ' + url.pathname);
  const decision = gate(url.pathname);
  if (decision.kind === 'json') return send({ error: 'This legacy workflow is unavailable in Firebase staging.' }, decision.status);
  if (decision.kind === 'redirect') { res.statusCode = 307; res.setHeader('Location', decision.location); return res.end(); }
  if (url.pathname === '/api/live-class/open') {
   if (req.method !== 'POST') return send({ kind: 'invalid' }, 405);
   const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => {
    const body = JSON.parse(Buffer.concat(parts));
    // The route's own check (liveClassOpenBody, strict): exactly a session id and start.
    if (Object.keys(body).sort().join() !== 'sessionId,start' || typeof body.start !== 'boolean') return send({ kind: 'invalid' }, 400);
    S.posts.push(body);
    const [status, value] = openClass(body); send(value, status);
   }); return;
  }
  if (url.pathname.startsWith('/api/')) { if (url.pathname === '/api/communications') return send({ rows: [], page: 0, unread: 0 }); if (url.pathname === '/api/user/status') return send({ user: { role: 'student' } }); return send({ error: 'harness: not served' }, 404); }
  for (const [k, v] of decision.headers ?? []) res.setHeader(k, v);
  pageHeaders[url.pathname] = Object.fromEntries(decision.headers ?? []);
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><html lang="en" data-lms-appearance><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Harness</title><link rel="stylesheet" href="/__style.css"></head><body class="${fontVars} font-sans"><div id="root"></div><script src="/__app.js"></script></body></html>`);
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 const ctl = body => fetch(origin + '/__ctl', { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
 const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
 const errors = [], results = [], external = [], meetRequests = [];
 const phone = { width: 390, height: 844 }, desktop = { width: 1440, height: 900 };
 const open = async (viewport, pathAndQuery, { lang = 'en', theme = 'light', role = 'student' } = {}) => {
  const context = await browser.newContext({ viewport, locale: lang });
  await context.addInitScript(([l, t, r]) => { try { localStorage.setItem('edulabs-lms-language', l); localStorage.setItem('edulabs-lms-appearance', t); localStorage.setItem('lms-harness-role', r); } catch {} }, [lang, theme, role]);
  // The meeting server is the stub: its IFrame API script and a synthetic meeting page (in the frame, or in a new tab). Nothing else leaves the machine.
  await context.route('**/*', async r => {
   const u = r.request().url();
   if (u.startsWith(origin)) return r.continue();
   if (u.startsWith(MEET + '/')) {
    meetRequests.push(u);
    if (new URL(u).pathname === '/external_api.js') {
     const broken = S.scriptFail || r.request().frame().url().includes(C.broken);
     return broken ? r.fulfill({ status: 404, body: 'not found' }) : r.fulfill({ status: 200, contentType: 'application/javascript', body: stubApi });
    }
    return r.fulfill({ status: 200, contentType: 'text/html', body: meetingPage });
   }
   external.push(u); return r.abort();
  });
  const page = await context.newPage();
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message.slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(origin + pathAndQuery);
  return { page, context };
 };
 const only = process.env.LMS_ONLY_STEPS ? new RegExp(process.env.LMS_ONLY_STEPS) : null;
 const step = async (name, fn) => { if (only && !only.test(name)) return; try { await ctl({ reset: true }); await fn(); results.push('PASS ' + name); console.log('PASS', name); } catch (e) { console.log('FAIL', name); throw e; } };
 const shot = async (page, name) => { await page.evaluate(() => document.getAnimations().forEach(a => { try { a.finish(); } catch { /* endless */ } })); await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true }); };
 const overflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
 const tinyTargets = page => page.evaluate(() => [...document.querySelectorAll('[data-live-class-page] a, [data-live-class-page] button')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 43.5 || r.width < 43.5) && getComputedStyle(e).visibility !== 'hidden'; }).map(e => e.textContent.trim().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
 const state = page => page.locator('[data-live-class-page]').getAttribute('data-state');
 const waitState = (page, s, timeout = 8000) => page.locator(`[data-live-class-page][data-state="${s}"]`).waitFor({ timeout });
 const shown = async (page, timeout = 8000) => { await waitState(page, 'open', timeout); await page.locator('[data-live-class-stage] iframe').waitFor(); };
 const meetings = page => page.evaluate(() => window.__meetings || []);
 // Phone: the whole meeting is on screen, below the sticky header and above the teacher frame's bottom tabs (its controls are at its bottom).
 const fitsPhone = async page => {
  const r = await page.evaluate(() => new Promise(done => requestAnimationFrame(() => {
   const s = document.querySelector('[data-live-class-stage]').getBoundingClientRect();
   const header = document.querySelector('.d-phone-header, [data-lms-shell] > .sticky'), tabs = document.querySelector('.d-bottom-tabs');
   const top = header ? header.getBoundingClientRect().bottom : 0, bottom = tabs && getComputedStyle(tabs).display !== 'none' ? tabs.getBoundingClientRect().top : innerHeight;
   done({ stage: [Math.round(s.top), Math.round(s.bottom), Math.round(s.width)], top: Math.round(top), bottom: Math.round(bottom), width: innerWidth });
  })));
  assert.ok(r.stage[0] >= r.top - 1 && r.stage[1] <= r.bottom + 1 && r.stage[2] >= r.width - 1 && r.stage[1] - r.stage[0] >= 320, 'the meeting fits the phone screen: ' + JSON.stringify(r));
 };
 const posts = async () => (await ctl({})).posts;
 const text = page => page.locator('[data-live-class-page]').innerText().then(t => t.replace(/\s+/g, ' ').trim());
 const page = id => '/class/' + id;
 // On a phone "Open in a new tab" is under the meeting: scroll to it, then let the meeting's frame finish loading and two frames pass. Chromium
 // places a tap by where the cross-site meeting frame WAS for a frame after a scroll, so an instant tap can land in the meeting (a harness
 // timing, not something a person can do).
 const settleForTap = async p => {
  await (p.frames().find(f => f.url().startsWith(MEET)) ?? p.mainFrame()).waitForLoadState();
  await p.locator('[data-new-tab]').evaluate(a => a.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))));
 };

 // ------------------------------------------------------------------ the real middleware in front of the harness
 let probes = 0;
 await step('Middleware: /class/<uuid> is reachable with no-referrer and no-store; lookalikes are not; the API takes only its two exact paths', async () => {
  const get = (p, init) => fetch(origin + p, { redirect: 'manual', ...init });
  const r = await get(page(C.open)); assert.equal(r.status, 200);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer'); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  for (const bad of ['/class', '/class/', '/class/not-a-uuid', page(C.open) + '/', page(C.open) + '/x', '/classes/' + C.open]) {
   const x = await get(bad); assert.equal(x.status, 307, bad); assert.equal(x.headers.get('location'), '/unavailable', bad);
  }
  for (const bad of ['/api/live-class', '/api/live-class/start', '/api/live-class/open/x', '/api/livekit']) assert.equal((await get(bad)).status, 503, bad);
  assert.equal((await get('/api/live-class/open', { method: 'POST', body: JSON.stringify({ sessionId: C.open, start: false, extra: 1 }) })).status, 400, 'a strict body');
  probes = requests.length;
 });

 // ------------------------------------------------------------------ staff
 await step('Start: a teacher sees "not started", the recording note and Start class; Start opens the meeting on the page as moderator with the staff buttons', async () => {
  const { page: p, context } = await open(desktop, page(C.ready), { role: 'staff' });
  await waitState(p, 'ready');
  const t = await text(p);
  for (const words of ['Synthetic Physics revision', 'Synthetic Physics Group', 'The class has not started yet.', 'If you record, everyone in the class is told.', 'Start class']) assert.ok(t.includes(words), words);
  assert.equal(await p.locator('[data-back]').getAttribute('href'), '/teacher/groups/' + GROUP, 'back to the Group');
  assert.deepEqual(await posts(), [{ sessionId: C.ready, start: false }], 'opening the page starts nothing');
  assert.equal(await p.locator('[data-live-class-stage]').count(), 0);
  await shot(p, 'staff-ready-1440');
  await p.locator('[data-live-class-start]').click();
  await shown(p);
  assert.deepEqual(await posts(), [{ sessionId: C.ready, start: false }, { sessionId: C.ready, start: true }]);
  const [m] = await meetings(p);
  assert.equal(m.domain, 'meet.example.test'); assert.match(m.roomName, /^[0-9a-f]{64}$/); assert.equal(m.inPage, true); assert.equal(m.lang, 'en');
  for (const b of ['desktop', 'whiteboard', 'recording', 'microphone', 'hangup']) assert.ok(m.toolbarButtons.includes(b), b);
  assert.equal(m.startWithAudioMuted, false); assert.equal(m.disableDeepLinking, true);
  const claims = JSON.parse(Buffer.from(m.jwt.split('.')[1], 'base64url'));
  assert.equal(claims.context.user.moderator, true); assert.equal(claims.room, m.roomName); assert.equal(claims.sub, 'meet.example.test');
  assert.ok(!p.url().includes('jwt') && !p.url().includes(m.roomName), 'neither the token nor the room is in the page address');
  assert.deepEqual(await tinyTargets(p), []); assert.ok(await overflow(p));
  await shot(p, 'staff-open-1440');
  await context.close();
 });

 await step('Start from Home or the Group page (?start=1): the class starts on arrival and the address loses ?start=1, so a reload only opens it', async () => {
  const { page: p, context } = await open(phone, page(C.start) + '?start=1', { role: 'staff' });
  await shown(p);
  assert.equal(new URL(p.url()).search, '', 'the address is cleaned');
  assert.deepEqual(await posts(), [{ sessionId: C.start, start: true }]);
  await p.reload(); await shown(p);
  assert.deepEqual((await posts()).at(-1), { sessionId: C.start, start: false }, 'a reload does not start again');
  assert.ok(await overflow(p)); assert.deepEqual(await tinyTargets(p), []);
  await fitsPhone(p);
  await p.screenshot({ path: path.join(shots, 'staff-open-390-screen.png') });
  await shot(p, 'staff-open-390');
  await context.close();
 });

 // ------------------------------------------------------------------ students
 await step('Join: a student opens a started class: the meeting on the page, muted, camera off, no screen share, whiteboard or recording, not a moderator', async () => {
  const { page: p, context } = await open(desktop, page(C.open));
  await shown(p);
  const [m] = await meetings(p);
  for (const b of ['desktop', 'whiteboard', 'recording']) assert.ok(!m.toolbarButtons.includes(b), b);
  assert.equal(m.startWithAudioMuted, true); assert.equal(m.startWithVideoMuted, true); assert.equal(m.name, 'Synthetic Student');
  assert.equal(JSON.parse(Buffer.from(m.jwt.split('.')[1], 'base64url')).context.user.moderator, false);
  assert.equal(await p.locator('[data-back]').getAttribute('href'), '/groups');
  assert.ok((await text(p)).includes('Open in a new tab'), 'the fallback is offered');
  assert.deepEqual(await posts(), [{ sessionId: C.open, start: false }], 'a student never asks to start');
  assert.deepEqual(await tinyTargets(p), []); assert.ok(await overflow(p));
  await shot(p, 'student-open-1440');
  await context.close();
 });

 await step('Waiting: before the teacher starts, the student waits (no meeting, no token) and the page opens the class by itself once it starts', async () => {
  const before = meetRequests.length;
  const { page: p, context } = await open(phone, page(C.waiting));
  await waitState(p, 'waiting');
  assert.ok((await text(p)).includes('Waiting for your teacher to start the class'));
  assert.equal(await p.locator('[data-live-class-stage]').count(), 0);
  assert.equal(meetRequests.length, before, 'nothing is loaded from the meeting server while waiting');
  assert.ok(await overflow(p)); assert.deepEqual(await tinyTargets(p), []);
  await shot(p, 'student-waiting-390');
  await ctl({ start: C.waiting });
  await shown(p, 15000); // the page asks again every WAIT_POLL_MS (10 s)
  await fitsPhone(p);
  await p.screenshot({ path: path.join(shots, 'student-open-390-screen.png') });
  const all = await posts();
  assert.ok(all.length >= 2 && all.every(x => x.sessionId === C.waiting && x.start === false), 'asked again, never to start: ' + JSON.stringify(all));
  await context.close();
 });

 await step('Early, ended, cancelled: each says so, offers no meeting and no Start, and keeps the way back', async () => {
  for (const [id, words, name] of [[C.early, 'The class opens at', 'early'], [C.ended, 'This class has ended.', 'ended'], [C.cancelled, 'This class was cancelled.', 'cancelled']]) {
   const { page: p, context } = await open(phone, page(id));
   await waitState(p, name);
   const t = await text(p);
   assert.ok(t.includes(words), name + ': ' + t);
   if (name === 'early') assert.ok(t.includes('Keep this page open'), 'it opens by itself');
   assert.equal(await p.locator('[data-live-class-stage], [data-live-class-start], [data-new-tab]').count(), 0, name);
   assert.equal(await p.locator('[data-back]').getAttribute('href'), '/groups');
   assert.ok(await overflow(p)); assert.deepEqual(await tinyTargets(p), []);
   await shot(p, `student-${name}-390`);
   await context.close();
  }
 });

 await step('Refusals: not allowed and not available say so with no Retry; too many tries and a failed read offer Retry, and Retry works', async () => {
  for (const [id, failure, words, retry] of [[C.denied, 'denied', "You can't open this class.", false], [C.off, 'off', "Online classes aren't available right now.", false], [C.busy, 'busy', 'Too many tries.', true]]) {
   const { page: p, context } = await open(phone, page(id));
   await p.locator(`[role="alert"][data-failure="${failure}"]`).waitFor();
   assert.ok((await text(p)).includes(words), failure);
   assert.equal(await p.locator('[data-retry]').count(), retry ? 1 : 0, failure);
   await shot(p, `student-${failure}-390`);
   await context.close();
  }
  const { page: p, context } = await open(desktop, page(C.flaky));
  await p.locator('[role="alert"][data-failure="failed"]').waitFor();
  await p.locator('[data-retry]').click();
  await waitState(p, 'waiting');
  await context.close();
 });

 await step('Leave: the meeting\'s own Leave closes it on the page and offers Join again (a fresh open) and the way back', async () => {
  const { page: p, context } = await open(desktop, page(C.open));
  await shown(p);
  await p.evaluate(() => window.__hangup());
  await waitState(p, 'left');
  assert.equal(await p.locator('[data-live-class-stage] iframe').count(), 0, 'the meeting is gone from the page');
  assert.equal(await p.evaluate(() => window.__disposed), 1);
  assert.ok((await text(p)).includes('You left the class.'));
  assert.deepEqual(await tinyTargets(p), []);
  await shot(p, 'student-left-1440');
  await p.locator('[data-rejoin]').click();
  await shown(p);
  await p.waitForTimeout(300);
  assert.equal((await posts()).length, 2, 'Join again asks again');
  const all = await meetings(p);
  assert.equal(all.length, 2, 'one new meeting, made from the new reply only (never the old one first)');
  await context.close();
 });

 await step('Open in a new tab: the same meeting opens in a new tab with this visit\'s token, the meeting here closes, and "Open it here instead" brings it back', async () => {
  const { page: p, context } = await open(phone, page(C.open));
  await shown(p);
  const [m] = await meetings(p);
  const link = p.locator('[data-new-tab]');
  assert.equal(await link.getAttribute('target'), '_blank'); assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
  await settleForTap(p);
  const [tab] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await tab.waitForLoadState();
  const u = new URL(tab.url());
  assert.equal(u.origin + u.pathname, MEET + '/' + m.roomName);
  assert.equal(u.searchParams.get('jwt'), m.jwt, 'the same short-lived token');
  assert.match(u.hash, /config\.disableDeepLinking=true/); assert.match(u.hash, /config\.startWithAudioMuted=true/);
  assert.equal(await tab.locator('body').innerText(), 'Synthetic meeting');
  await waitState(p, 'elsewhere');
  assert.equal(await p.locator('[data-live-class-stage] iframe').count(), 0, 'nobody is in the class twice');
  assert.ok((await text(p)).includes('The class is open in another tab.'));
  assert.ok(await overflow(p)); assert.deepEqual(await tinyTargets(p), []);
  await shot(p, 'student-elsewhere-390');
  await p.locator('[data-back-here]').click();
  await shown(p);
  assert.equal((await posts()).length, 2, 'a fresh open');
  await p.waitForTimeout(300);
  assert.equal((await meetings(p)).length, 2, 'one new meeting, made from the new reply only');
  await context.close();
 });

 await step('The meeting script fails: the page says so with Retry and Open in a new tab; Retry loads it once the server answers', async () => {
  await ctl({ scriptFail: true });
  const { page: p, context } = await open(desktop, page(C.open));
  await p.locator('[data-stage-failed]').waitFor();
  assert.ok((await text(p)).includes("The class couldn't be opened."));
  assert.equal(await p.locator('[data-stage-failed] [data-retry]').count(), 1);
  assert.match(await p.locator('[data-stage-failed] [data-new-tab]').getAttribute('href'), /^https:\/\/meet\.example\.test\/[0-9a-f]{64}\?jwt=/);
  assert.deepEqual(await tinyTargets(p), []);
  await shot(p, 'student-script-failed-1440');
  await ctl({ scriptFail: false });
  await p.locator('[data-stage-failed] [data-retry]').click();
  await shown(p);
  await context.close();
 });

 await step('Arabic: right-to-left, translated, the meeting gets the language; dark theme keeps the page readable', async () => {
  const { page: p, context } = await open(phone, page(C.arabic), { lang: 'ar', theme: 'dark' });
  await shown(p);
  assert.equal(await p.evaluate(() => document.documentElement.dir), 'rtl');
  assert.equal(await p.evaluate(() => document.documentElement.classList.contains('dark')), true);
  const t = await text(p);
  assert.ok(t.includes('مراجعة الفيزياء') && t.includes('افتح في علامة تبويب جديدة'), t);
  assert.doesNotMatch(t, /Open in a new tab|Back to Groups/);
  assert.equal((await meetings(p))[0].lang, 'ar');
  assert.ok(await overflow(p)); assert.deepEqual(await tinyTargets(p), []);
  await shot(p, 'student-open-ar-dark-390');
  await context.close();
  const staff = await open(desktop, page(C.ready), { lang: 'ar', theme: 'dark', role: 'staff' });
  await waitState(staff.page, 'ready');
  assert.ok((await text(staff.page)).includes('ابدأ'), 'Start class in Arabic');
  await shot(staff.page, 'staff-ready-ar-dark-1440');
  await staff.context.close();
 });

 if (process.env.LMS_MATRIX) await step('Screen matrix: staff screens in both looks, students\' in Classic; both themes, both languages, both widths, measured', async () => {
  const withLook = (p, look) => p + (p.includes('?') ? '&' : '?') + 'design=' + look;
  const roleOf = target => target.startsWith('staff:') ? 'staff' : 'student', at = target => target.replace(/^(staff|student):/, '');
  const classic = ['classic'];
  const findings = await shootMatrix({ label: 'live-class', open: ({ viewport, lang, theme, look, target }) => open(viewport, withLook(at(target), look), { lang, theme, role: roleOf(target) }), screens: [
   { name: 'class-staff-ready', target: 'staff:' + page(C.ready), ready: '[data-state="ready"]' },
   { name: 'class-staff-open', target: 'staff:' + page(C.staffOpen), ready: '[data-live-class-stage] iframe' },
   { name: 'class-student-open', target: 'student:' + page(C.open), ready: '[data-live-class-stage] iframe', looks: classic },
   { name: 'class-student-waiting', target: 'student:' + page(C.waiting), ready: '[data-state="waiting"]', looks: classic },
   { name: 'class-student-early', target: 'student:' + page(C.early), ready: '[data-state="early"]', looks: classic },
   { name: 'class-student-ended', target: 'student:' + page(C.ended), ready: '[data-state="ended"]', looks: classic },
   { name: 'class-student-cancelled', target: 'student:' + page(C.cancelled), ready: '[data-state="cancelled"]', looks: classic },
   { name: 'class-student-denied', target: 'student:' + page(C.denied), ready: '[data-failure="denied"]', looks: classic },
   { name: 'class-student-left', target: 'student:' + page(C.open), ready: '[data-live-class-stage] iframe', looks: classic, act: async p => { await p.evaluate(() => window.__hangup()); await p.locator('[data-state="left"]').waitFor(); } },
   { name: 'class-student-elsewhere', target: 'student:' + page(C.open), ready: '[data-live-class-stage] iframe', looks: classic, act: async p => { await settleForTap(p); const tab = p.context().waitForEvent('page'); await p.locator('[data-new-tab]').click(); await (await tab).close(); await p.locator('[data-state="elsewhere"]').waitFor(); } },
   { name: 'class-student-script-failed', target: 'student:' + page(C.broken), ready: '[data-stage-failed]', looks: classic },
  ] });
  assert.deepEqual(findings, []);
 });

 await browser.close(); server.close();
 assert.deepEqual(errors, [], 'no uncaught or console errors');
 assert.deepEqual(external, [], 'no request leaves the machine except to the stub meeting server');
 const apis = [...new Set(requests.slice(probes).filter(r => /\/api\//.test(r)))].sort();
 assert.deepEqual(apis.filter(r => !/^POST \/api\/(live-class\/open|communications)$|\/api\/user\/status$/.test(r)), [], 'the class page calls no other API: ' + apis.join(', '));
 console.log(`Live class browser checks passed: ${results.length} groups (real middleware, real provider, stub meeting script, synthetic loopback data, not provider E2E). Screenshots: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
