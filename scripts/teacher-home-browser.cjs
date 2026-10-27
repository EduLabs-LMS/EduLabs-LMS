// Teacher Home, Courses and navigation in Chromium: the real components, the real built CSS and fonts, synthetic loopback data only.
// Not provider acceptance. Needs a Firebase-mode `npm run build` first (CSS and fonts) and LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('node:assert/strict');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/teacher-home-browser'), shots = path.join(out, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the real CSS and fonts are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import Sidebar from '@/frontend/components/sidebar';
import MobileSidebar from '@/frontend/features/dashboard/mobile-sidebar';
import { TeacherHomeView } from '@/frontend/features/teacher-home/home-view';
import { TeacherCoursesView, TeacherCoursesLoading } from '@/frontend/features/teacher-home/courses-view';
import { buildTeacherHome, mapCourses, createTargets } from '@/shared/teacher-home';
const q = new URLSearchParams(location.search), view = q.get('view') || 'home', scenario = q.get('s') || 'full', staff = q.get('staff') !== '0';
window.__pathname = q.get('path') || (view === 'courses' ? '/teacher/courses' : '/home');
const NOW = Date.now(), at = m => new Date(NOW + m * 60000).toISOString();
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ok = value => ({ ok: true, value }), bad = status => ({ ok: false, status });
const group = (n, name) => ({ id: uuid(n), offering_id: uuid(100 + n), offering_name: 'Synthetic offering', name, description: '', mode: 'online', location: '', join_url: '', instructions: '', capacity: null, status: 'active', version: 1, staff: true, instructor: false });
const session = (n, g, name, start, extra = {}) => ({ id: uuid(200 + n), group_id: uuid(g), group_name: name, title: 'Synthetic lesson ' + n, starts_at: at(start), ends_at: at(start + 60), mode: 'online', location: '', join_url: '', instructions: '', cancelled: false, version: 1, attendance_state: 'draft', state: 'upcoming', ...extra });
const note = (n, event, m, extra = {}) => ({ id: uuid(300 + n), event_type: event, created_at: at(m), read_at: null, link: null, ...extra });
const names = ['Synthetic Physics A', 'Synthetic Chemistry', 'A very long synthetic course title that keeps going to prove that wrapping works on a phone', 'فيزياء — الصف العاشر', 'Synthetic Biology', 'Synthetic Maths', 'Synthetic Geography'];
const courses = names.map((title, i) => ({ id: uuid(10 + i), organization_id: uuid(50), title, status: ['published', 'draft', 'draft', 'published', 'archived', 'published', 'draft'][i] }));
const groupsFull = ok({ rows: [group(1, 'Synthetic Group Alpha'), group(2, 'مجموعة الصف العاشر')], page: 0, hasMore: false });
const upcomingFull = ok({ rows: [session(1, 1, 'Synthetic Group Alpha', 90), session(2, 2, 'مجموعة الصف العاشر', 1500), session(3, 1, 'Synthetic Group Alpha', 3000), session(4, 2, 'مجموعة الصف العاشر', 4400)], page: 0 });
const notesFull = ok({ rows: [note(1, 'support_reply', -30), note(2, 'session_details', -300, { link: '/groups' }), note(3, 'session_starting', -60)], page: 0, unread: 3 });
const scenarios = {
 full: { courses: ok(courses), groups: groupsFull, upcoming: upcomingFull, notifications: notesFull },
 quiet: { courses: ok(courses.slice(0, 2)), groups: ok({ rows: [group(1, 'Synthetic Group Alpha')], page: 0 }), upcoming: ok({ rows: [], page: 0 }), notifications: ok({ rows: [], page: 0, unread: 0 }) },
 first: { courses: ok([]), groups: ok({ rows: [], page: 0, hasMore: false }), upcoming: ok({ rows: [], page: 0 }), notifications: ok({ rows: [], page: 0, unread: 0 }) },
 errors: { courses: bad(503), groups: bad(503), upcoming: bad(503), notifications: bad(401) },
 forbidden: { courses: bad(403), groups: groupsFull, upcoming: upcomingFull, notifications: bad(403) },
 empty: { courses: ok([]), groups: groupsFull, upcoming: ok({ rows: [], page: 0 }), notifications: ok({ rows: [], page: 0, unread: 0 }) },
 many: { courses: ok(Array.from({ length: 130 }, (_, i) => ({ id: uuid(1000 + i), organization_id: uuid(50), title: 'Synthetic course ' + i, status: 'draft' }))), groups: groupsFull, upcoming: upcomingFull, notifications: notesFull },
};
const raw = { ...scenarios[scenario], now: NOW };
const targets = createTargets([{ id: uuid(50), name: 'Synthetic space', status: 'active' }, ...(q.get('spaces') === '2' ? [{ id: uuid(51), name: 'Second synthetic space', status: 'active' }] : [])], [{ organization_id: uuid(50), role: 'teacher', status: 'active' }, { organization_id: uuid(51), role: 'owner', status: 'active' }]);
const home = { ...buildTeacherHome(raw), createTargets: targets, demo: q.get('demo') === '1' };
function Body() {
 if (view === 'loading') return <TeacherCoursesLoading />;
 if (view === 'courses') return <TeacherCoursesView courses={mapCourses(raw.courses)} targets={targets} />;
 return <TeacherHomeView data={home} />;
}
const lang = q.get('lang') === 'ar' ? 'ar' : 'en';
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
createRoot(document.getElementById('root')).render(
 <LanguageProvider initialLanguage={lang}>
  <ThemeProvider attribute="class" defaultTheme={q.get('theme') === 'dark' ? 'dark' : 'light'} enableSystem={false} disableTransitionOnChange>
   <div data-lms-shell className="min-h-screen bg-slate-50 w-full relative">
    <MobileSidebar />
    <aside className="hidden md:block fixed start-4 top-4 bottom-4 w-64 z-50"><Sidebar /></aside>
    <main className="md:ps-72 pt-2 md:pt-4 min-h-screen bg-slate-50 flex flex-col justify-between"><div className="flex-1 w-full p-4 sm:p-6 md:p-8"><Body /></div></main>
   </div>
  </ThemeProvider>
 </LanguageProvider>);
`;

(async () => {
 const stubs = {
  'next/navigation': 'window.__refreshes = window.__refreshes || 0; window.__pushes = window.__pushes || []; export const usePathname = () => window.__pathname; export const useRouter = () => ({ push(p) { window.__pushes.push(p); }, replace() {}, refresh() { window.__refreshes++; } });',
  'next/link': 'import React from "react"; export default function Link({ href, children, onClick, ...rest }) { return React.createElement("a", { ...rest, href, onClick: e => { e.preventDefault(); (window.__clicks = window.__clicks || []).push(href); onClick && onClick(e); } }, children); }',
  '@/shared/auth-config': 'export const isFirebaseStaging = () => true;',
  '@/frontend/components/providers/application-auth-provider': 'const staff = new URLSearchParams(location.search).get("staff") !== "0"; export const useWebsiteNavigation = () => ({ viewer: { id: "v" }, organizations: [], staffOrganizationIds: staff ? ["00000000-0000-4000-8000-000000000050"] : [] }); export const WebsiteNavigationProvider = ({ children }) => children;',
  '@/frontend/components/providers/v2-identity': 'import React from "react"; export const useUser = () => ({ user: { fullName: "Synthetic Teacher" } }); export const useClerk = () => ({ signOut() {} }); export const UserButton = () => React.createElement("span", { className: "h-9 w-9 rounded-full border-2 border-black" });',
 };
 const resolveAlias = p => { for (const c of [p + '.tsx', p + '.ts', path.join(p, 'index.tsx'), path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return p; };
 await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: path.join(out, 'app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'boundary', setup(b) {
   b.onResolve({ filter: /.*/ }, a => { if (stubs[a.path]) return { path: a.path, namespace: 'stub' }; if (a.path.startsWith('@/')) return { path: resolveAlias(path.resolve(a.path.slice(2))) }; });
   b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'jsx', resolveDir: process.cwd() }));
  } }] });

 let createPosts, createMode;
 const reset = () => { createPosts = []; createMode = 'ok'; };
 reset();
 const external = [];
 const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
  if (url.pathname === '/api/communications') return send({ rows: [], page: 0, unread: 3 });
  if (url.pathname === '/api/user/status') return send({ user: { role: 'teacher' } });
  if (url.pathname === '/api/teacher/courses' && req.method === 'POST') {
   const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => {
    createPosts.push(JSON.parse(Buffer.concat(parts)));
    if (createMode === 'denied') return send({ error: 'no' }, 403);
    if (createMode === 'down') return send({ error: 'down' }, 503);
    if (createMode === 'signedout') return send({ error: 'in' }, 401);
    send({ id: '00000000-0000-4000-8000-0000000000aa' });
   }); return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
   res.setHeader('Content-Type', 'text/html; charset=utf-8');
   return res.end(`<!doctype html><html lang="en" data-lms-appearance><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="${fontVars} font-sans"><div id="root"></div><script src="/app.js"></script></body></html>`);
  }
  res.statusCode = 404; res.end();
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
 const errors = [], results = [];
 const open = async (viewport, query) => {
  const context = await browser.newContext({ viewport, locale: /lang=ar/.test(query) ? 'ar' : 'en' });
  const page = await context.newPage();
  await page.addInitScript(l => { try { localStorage.setItem('edulabs-lms-language', l); } catch {} }, /lang=ar/.test(query) ? 'ar' : 'en');
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', r => { if (r.request().url().startsWith(origin)) return r.continue(); external.push(r.request().url()); return r.abort(); });
  await page.goto(origin + '/?' + query);
  await page.locator('[data-lms-shell]').waitFor();
  return { page, context };
 };
 const overflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
 const text = page => page.locator('main').innerText();
 const step = async (name, fn) => { try { await fn(); results.push('PASS ' + name); console.log('PASS', name); } catch (e) { console.log('FAIL', name); throw e; } };
 const phone = { width: 390, height: 844 }, desktop = { width: 1440, height: 900 };
 const sections = ['th-next', 'th-homework', 'th-updates', 'th-coming', 'th-courses'];

 await step('Home with data, English desktop: five sections, real data, honest homework state, real tree mark, sidebar navigation', async () => {
  const { page, context } = await open(desktop, 'view=home&s=full');
  await page.locator('[data-teacher-home]').waitFor();
  assert.deepEqual((await page.locator('[data-section]').evaluateAll(n => n.map(e => e.dataset.section))).sort(), [...sections].sort());
  const col = id => page.locator(`[data-section="${id}"]`).evaluate(e => e.getBoundingClientRect().left);
  assert.ok(Math.abs(await col('th-next') - await col('th-coming')) < 2, 'next session and coming up share the day column'); assert.ok(Math.abs(await col('th-homework') - await col('th-updates')) < 2 && Math.abs(await col('th-updates') - await col('th-courses')) < 2, 'homework, updates and courses share the inbox column'); assert.ok(await col('th-homework') > await col('th-next'), 'inbox column beside the day column');
  const next = page.locator('[data-next-session]'); assert.match(await next.innerText(), /Synthetic Group Alpha/); assert.match(await next.innerText(), /Synthetic lesson 1/);
  assert.match(await page.locator('[data-section="th-coming"]').innerText(), /مجموعة الصف العاشر/);
  assert.equal(await page.locator('[data-section="th-coming"] [data-session]').count(), 3);
  const hw = page.locator('[data-section="th-homework"] [data-state="unavailable"]'); await hw.waitFor(); assert.match(await hw.innerText(), /not available yet/);
  assert.doesNotMatch(await page.locator('[data-section="th-homework"]').innerText(), /\b\d+\b/, 'no invented number in the homework card');
  const updates = await page.locator('[data-update]').allInnerTexts(); assert.equal(updates.length, 3); assert.match(updates[0], /Session change/); assert.match(updates[1], /Session change/); assert.doesNotMatch(updates[2], /Session change/);
  assert.equal(await page.locator('header [data-create-course]').isVisible(), true, 'Create a course sits in the page header on a desktop'); assert.equal(await page.locator('[data-section="th-courses"] [data-create-course]').isVisible(), false);
  assert.equal(await page.locator('[data-course]').count(), 6);
  assert.ok(await page.locator('header svg').first().isVisible(), 'the real tree mark is shown');
  const nav = page.locator('[data-teacher-nav] a'); assert.deepEqual(await nav.allInnerTexts(), ['Home', 'Courses', 'Students', 'Groups & Classes', 'Homework', 'Exams', 'Reports', 'Settings']);
  assert.equal(await page.locator('[data-teacher-nav] a[aria-current="page"]').innerText(), 'Home');
  assert.equal(await page.locator('[aria-label="Notifications"], button[aria-label*="otification"]').count(), 1, 'a single notification entry');
  assert.ok(await overflow(page));
  await page.screenshot({ path: path.join(shots, 'home-en-1440.png'), fullPage: true });
  const visible = await page.evaluate(() => [...document.querySelectorAll('main h1, main h2')].map(h => h.textContent));
  assert.doesNotMatch(visible.join(' '), /organization|tenant|slug|program|stage|module|studio/i);
  await context.close();
 });
 await step('Home on a phone: sections in the required order, no horizontal scroll, text and targets large enough', async () => {
  const { page, context } = await open(phone, 'view=home&s=full');
  await page.locator('[data-teacher-home]').waitFor();
  const boxes = await page.locator('[data-section]').evaluateAll(n => n.map(e => ({ id: e.dataset.section, top: e.getBoundingClientRect().top + scrollY, left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right })));
  assert.deepEqual([...boxes].sort((a, b) => a.top - b.top).map(b => b.id), sections); boxes.sort((a, b) => a.top - b.top); for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].top > boxes[i - 1].top, 'stacked in order ' + boxes[i].id);
  assert.ok(boxes.every(b => b.left >= 0 && b.right <= 390 + 1), 'every card fits the screen');
  assert.ok(await overflow(page), 'no horizontal scroll at 390px');
  const small = await page.evaluate(() => { const bad = []; const w = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.textContent.trim()) continue; const s = parseFloat(getComputedStyle(n.parentElement).fontSize); if (s < 16) bad.push(n.textContent.trim().slice(0, 30) + ':' + s); } return bad; });
  assert.deepEqual(small, [], 'body text is at least 16px on a phone');
  const tiny = await page.evaluate(() => [...document.querySelectorAll('main a, main button, main input, main select')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 43.5 || r.width < 43.5); }).map(e => (e.textContent || e.tagName).trim().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().height)));
  assert.deepEqual(tiny, [], 'touch targets are at least 44px');
  const create = page.locator('[data-section="th-courses"] [data-create-course]'); const last = await page.locator('[data-section="th-courses"] > *').last().evaluate(e => e.hasAttribute('data-create-course')); assert.ok(last, '"Create a course" is the last thing in the courses card');
  await page.screenshot({ path: path.join(shots, 'home-en-390.png'), fullPage: true });
  await context.close();
 });
 await step('Mobile menu: one menu button opens the drawer with the teacher navigation and the single notification entry', async () => {
  const { page, context } = await open(phone, 'view=home&s=full');
  await page.locator('[data-teacher-home]').waitFor();
  assert.equal(await page.locator('[data-teacher-nav]:visible').count(), 0, 'closed drawer shows no navigation');
  const menu = page.getByRole('button', { name: /navigation menu/i }); assert.equal(await menu.count(), 1);
  await menu.click(); await page.locator('[role="dialog"] [data-teacher-nav]').waitFor();
  assert.deepEqual(await page.locator('[role="dialog"] [data-teacher-nav] a').allInnerTexts(), ['Home', 'Courses', 'Students', 'Groups & Classes', 'Homework', 'Exams', 'Reports', 'Settings']);
  assert.equal(await page.locator('[role="dialog"] button[aria-label*="otification"]').count(), 1);
  const rows = await page.locator('[role="dialog"] [data-teacher-nav] a').evaluateAll(n => n.map(e => e.getBoundingClientRect().height)); assert.ok(rows.every(h => h >= 44));
  const sup = page.locator('[role="dialog"] [data-teacher-support] a[href="/support"]'); await sup.waitFor(); assert.equal((await sup.innerText()).trim(), 'Support'); assert.ok((await sup.evaluate(e => e.getBoundingClientRect().height)) >= 44, 'Support is a full-size touch target'); assert.equal(await page.locator('[role="dialog"] [data-teacher-nav] a[href="/support"]').count(), 0, 'Support is not one of the eight');
  await page.screenshot({ path: path.join(shots, 'menu-en-390.png') });
  await page.locator('[role="dialog"] [data-teacher-nav] a[data-nav="courses"]').click(); await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => window.__clicks), ['/teacher/courses']);
  await context.close();
 });
 await step('Navigation is for active staff only: a student sees the student navigation and no teacher links', async () => {
  const { page, context } = await open(desktop, 'view=home&s=full&staff=0');
  await page.locator('[data-teacher-home]').waitFor();
  assert.equal(await page.locator('[data-teacher-nav]').count(), 0);
  const links = await page.locator('aside a').allInnerTexts(); assert.ok(links.some(t => /Exams/.test(t))); assert.ok(!links.some(t => /Groups & Classes|Reports|Students/.test(t)), links.join('|'));
  await page.screenshot({ path: path.join(shots, 'nav-student-1440.png') });
  await context.close();
 });
 await step('Arabic (RTL) desktop and phone: layout mirrors, Arabic copy, no overflow', async () => {
  for (const [name, viewport] of [['1440', desktop], ['390', phone]]) {
   const { page, context } = await open(viewport, 'view=home&s=full&lang=ar');
   await page.locator('[data-teacher-home]').waitFor();
   assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
   const body = await text(page); assert.match(body, /الحصة القادمة/); assert.match(body, /واجبات تنتظر التصحيح/); assert.match(body, /تحديثات مهمة/); assert.match(body, /قريبًا/); assert.match(body, /الدورات/); assert.match(body, /أنشئ دورة/);
   assert.ok(await overflow(page));
   if (viewport === desktop) { assert.match(await page.locator('[data-teacher-support]').first().innerText(), /الدعم/); }
   else { await page.getByRole('button', { name: /قائمة|navigation menu/i }).click(); await page.locator('[role="dialog"] [data-teacher-support]').waitFor(); assert.match(await page.locator('[role="dialog"] [data-teacher-support]').innerText(), /الدعم/); await page.keyboard.press('Escape'); }
   if (viewport === desktop) {
    const side = await page.locator('aside').first().evaluate(e => e.getBoundingClientRect()), main = await page.locator('[data-teacher-home]').evaluate(e => e.getBoundingClientRect());
    assert.ok(side.left > main.left, 'the sidebar sits on the right in RTL');
    const next = await page.locator('[data-section="th-next"]').evaluate(e => e.getBoundingClientRect()), upd = await page.locator('[data-section="th-updates"]').evaluate(e => e.getBoundingClientRect());
    assert.ok(next.left > upd.left, 'the main column is on the right, updates on the left, in RTL');
   }
   await page.screenshot({ path: path.join(shots, `home-ar-${name}.png`), fullPage: true });
   await context.close();
  }
 });
 await step('Dark appearance: Home is readable (light text on dark surfaces, no white islands)', async () => {
  const { page, context } = await open(desktop, 'view=home&s=full&theme=dark');
  await page.locator('[data-teacher-home]').waitFor(); await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  const lum = c => { const m = c.match(/\d+(\.\d+)?/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  const pairs = await page.evaluate(() => { const parse = c => { const m = c.match(/[0-9.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; }; const effective = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) layers.push(c); if (c.a === 1) break; } let base = { r: 255, g: 255, b: 255 }; for (const l of layers.reverse()) base = { r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a) }; return 'rgb(' + base.r + ', ' + base.g + ', ' + base.b + ')'; }; return [...document.querySelectorAll('main p, main h1, main h2, main a, main span')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => ({ t: e.textContent.trim().slice(0, 24), color: getComputedStyle(e).color, back: effective(e) })); });
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const low = pairs.filter(p => p.back !== 'rgba(0, 0, 0, 0)' && ratio(p.color, p.back) < 4.5).map(p => `${p.t} ${p.color} on ${p.back}`);
  assert.deepEqual(low, [], 'contrast is at least 4.5:1');
  await page.screenshot({ path: path.join(shots, 'home-dark-1440.png'), fullPage: true });
  const light = await open(desktop, 'view=home&s=full'); await light.page.locator('[data-teacher-home]').waitFor();
  const lightLow = await light.page.evaluate(() => 0); await light.context.close();
  await context.close();
 });
 await step('Quiet Home: honest empty cards for no session, no updates and no further sessions; courses still shown', async () => {
  const { page, context } = await open(desktop, 'view=home&s=quiet');
  await page.locator('[data-teacher-home]').waitFor();
  assert.equal(await page.locator('[data-section="th-next"] [data-state="empty"]').count(), 1);
  assert.equal(await page.locator('[data-section="th-updates"] [data-state="empty"]').count(), 1);
  assert.equal(await page.locator('[data-section="th-coming"] [data-state="empty"]').count(), 1);
  assert.equal(await page.locator('[data-course]').count(), 2); assert.equal(await page.locator('[data-first-visit]').count(), 0);
  await page.screenshot({ path: path.join(shots, 'home-quiet-1440.png'), fullPage: true });
  await context.close();
 });
 await step('First visit: calm welcome with one optional action, no tour, no steps, no numbers', async () => {
  for (const [lang, viewport, tag] of [['en', desktop, 'en-1440'], ['en', phone, 'en-390'], ['ar', phone, 'ar-390']]) {
   const { page, context } = await open(viewport, `view=home&s=first&lang=${lang}`);
   await page.locator('[data-first-visit]').waitFor();
   assert.deepEqual((await page.locator('[data-section]').evaluateAll(n => n.map(e => e.dataset.section))).sort(), ['th-homework', 'th-next', 'th-updates'], 'only the three quiet cards, no courses or coming-up lists'); assert.equal(await page.locator('[data-course]').count(), 0);
   assert.equal(await page.getByRole('button', { name: /Create a course|أنشئ دورة/ }).count(), 1);
   assert.doesNotMatch(await page.locator('[data-first-visit]').innerText(), /\d/, 'no numbers');
   assert.match(await page.locator('[data-first-visit]').innerText(), /Welcome to your teaching space|أهلًا بك في مساحة التدريس/); assert.equal(await page.locator('[data-first-visit] a[href="/support"]').count(), 1);
   const how = page.getByRole('button', { name: /How does this work|كيف يعمل هذا/ }); assert.equal(await how.getAttribute('aria-expanded'), 'false'); await how.click(); assert.equal(await how.getAttribute('aria-expanded'), 'true'); await page.locator('#th-first-how').waitFor();
   assert.ok(await overflow(page));
   await page.screenshot({ path: path.join(shots, `first-visit-${tag}.png`), fullPage: true });
   await context.close();
  }
 });
 await step('Errors: failed reads show an error with retry, never an empty or all-clear state; 401 offers sign-in; 403 has no retry', async () => {
  const { page, context } = await open(desktop, 'view=home&s=errors');
  await page.locator('[data-teacher-home]').waitFor();
  assert.equal(await page.locator('[data-state="empty"]').count(), 0, 'nothing is presented as empty');
  assert.equal(await page.locator('[data-section="th-next"] [role="alert"]').count(), 1); assert.equal(await page.locator('[data-section="th-coming"] [role="alert"]').count(), 1); assert.equal(await page.locator('[data-section="th-courses"] [role="alert"]').count(), 1);
  assert.match(await page.locator('[data-section="th-updates"]').innerText(), /sign-in has ended/); assert.equal(await page.locator('[data-section="th-updates"] a[href="/sign-in"]').count(), 1);
  assert.equal(await page.locator('[data-first-visit]').count(), 0, 'unknown data is not a first visit');
  await page.screenshot({ path: path.join(shots, 'home-errors-1440.png'), fullPage: true });
  const before = await page.evaluate(() => window.__refreshes || 0);
  await page.locator('[data-section="th-next"]').getByRole('button', { name: 'Try again' }).click();
  await page.waitForFunction(b => (window.__refreshes || 0) > b, before);
  await context.close();
  const f = await open(desktop, 'view=home&s=forbidden'); await f.page.locator('[data-teacher-home]').waitFor();
  assert.match(await f.page.locator('[data-section="th-courses"]').innerText(), /do not have permission/); assert.equal(await f.page.locator('[data-section="th-courses"] [role="alert"] button').count(), 0);
  assert.match(await f.page.locator('[data-section="th-updates"]').innerText(), /do not have permission/);
  assert.equal(await f.page.locator('[data-section="th-next"] [data-next-session]').count(), 1, 'one failed section does not hide the others');
  await f.context.close();
 });
 await step('Courses page: cards with Draft/Published, empty, error with retry, loading, truncation notice; English and Arabic, phone and desktop', async () => {
  for (const [s, tag] of [['full', 'full'], ['empty', 'empty'], ['errors', 'error'], ['many', 'many']]) {
   const { page, context } = await open(desktop, `view=courses&s=${s}`);
   await page.locator('[data-teacher-courses]').waitFor();
   if (s === 'full') { const t = await text(page); assert.match(t, /Draft/); assert.match(t, /Published/); assert.match(t, /Archived/); assert.equal(await page.locator('[data-course]').count(), 7); assert.equal(await page.locator('[data-teacher-nav] a[aria-current="page"]').innerText(), 'Courses'); }
   if (s === 'empty') assert.equal(await page.locator('[data-state="empty"]').count(), 1);
   if (s === 'errors') { assert.equal(await page.locator('[role="alert"]').count(), 1); assert.equal(await page.locator('[data-state="empty"]').count(), 0); await page.getByRole('button', { name: 'Try again' }).click(); await page.waitForFunction(() => window.__refreshes > 0); }
   if (s === 'many') { assert.equal(await page.locator('[data-course]').count(), 100); assert.match(await text(page), /first 100 courses/); }
   await page.screenshot({ path: path.join(shots, `courses-${tag}-en-1440.png`), fullPage: true });
   await context.close();
  }
  for (const [lang, viewport, tag] of [['en', phone, 'en-390'], ['ar', phone, 'ar-390'], ['ar', desktop, 'ar-1440']]) {
   const { page, context } = await open(viewport, `view=courses&s=full&lang=${lang}`);
   await page.locator('[data-teacher-courses]').waitFor(); assert.ok(await overflow(page), 'no overflow ' + tag);
   if (lang === 'ar') assert.match(await text(page), /مسودة/);
   await page.screenshot({ path: path.join(shots, `courses-${tag}.png`), fullPage: true }); await context.close();
  }
  const l = await open(phone, 'view=loading'); await l.page.locator('[data-state="loading"]').waitFor(); await l.page.screenshot({ path: path.join(shots, 'courses-loading-en-390.png') }); await l.context.close();
 });
 await step('Create a course: posts one request to the existing endpoint, shows failures, never double-submits, opens the new course', async () => {
  const { page, context } = await open(desktop, 'view=courses&s=empty');
  await page.locator('[data-teacher-courses]').waitFor();
  const dialog = async () => { await page.locator('header [data-create-course]').click(); await page.getByRole('dialog').waitFor(); };
  await dialog();
  await page.getByRole('button', { name: 'Create course' }).click(); await page.getByText('Enter a course title.').waitFor(); assert.equal(createPosts.length, 0);
  assert.equal(await page.getByLabel('Teaching space').count(), 0, 'a single place needs no picker');
  for (const [mode, expect] of [['denied', /not allowed to create/], ['down', /could not be created/], ['signedout', /sign-in has ended/]]) {
   createMode = mode; await page.getByLabel('Course title').fill('Synthetic Physics 11'); await page.getByRole('button', { name: 'Create course' }).click(); await page.getByRole('alert').filter({ hasText: expect }).waitFor();
  }
  assert.equal(createPosts.length, 3); createMode = 'ok';
  await page.getByRole('button', { name: 'Create course' }).click(); await page.waitForFunction(() => window.__pushes && window.__pushes.length);
  assert.equal(createPosts.length, 4); const body = createPosts[3];
  assert.deepEqual(Object.keys(body).sort(), ['organization_id', 'slug', 'title']); assert.equal(body.title, 'Synthetic Physics 11'); assert.match(body.slug, /^synthetic-physics-11-[a-z0-9]{1,6}$/); assert.equal(body.organization_id, '00000000-0000-4000-8000-000000000050');
  assert.deepEqual(await page.evaluate(() => window.__pushes), ['/teacher/courses/00000000-0000-4000-8000-0000000000aa']);
  await context.close();
  const two = await open(phone, 'view=home&s=empty&spaces=2'); await two.page.locator('[data-teacher-home]').waitFor();
  await two.page.locator('[data-section="th-courses"] [data-create-course]').click(); await two.page.getByLabel('Teaching space').waitFor();
  assert.equal(await two.page.getByLabel('Teaching space').locator('option').count(), 2);
  await two.page.screenshot({ path: path.join(shots, 'create-dialog-en-390.png') }); await two.context.close();
  const ar = await open(phone, 'view=courses&s=empty&lang=ar'); await ar.page.locator('[data-teacher-courses]').waitFor(); await ar.page.locator('header [data-create-course]').click(); await ar.page.getByRole('dialog').waitFor();
  await ar.page.screenshot({ path: path.join(shots, 'create-dialog-ar-390.png') }); await ar.context.close();
 });
 await step('Demo label: shown only when the server said demo, on Home and on first visit, in English and Arabic, light and dark, phone and desktop', async () => {
  for (const [query, viewport, tag] of [['view=home&s=full', desktop, 'en-1440'], ['view=home&s=full', phone, 'en-390'], ['view=home&s=full&lang=ar', desktop, 'ar-1440'], ['view=home&s=full&lang=ar', phone, 'ar-390'], ['view=home&s=full&theme=dark', desktop, 'dark-1440']]) {
   const off = await open(viewport, query); await off.page.locator('[data-teacher-home]').waitFor();
   assert.equal(await off.page.locator('[data-demo-label]').count(), 0, 'no label for a non-demo space (' + tag + ')'); await off.context.close();
   const on = await open(viewport, query + '&demo=1'); await on.page.locator('[data-teacher-home]').waitFor();
   const label = on.page.locator('[data-demo-label]'); assert.equal(await label.count(), 1, 'one label (' + tag + ')'); assert.equal(await label.isVisible(), true);
   assert.match((await label.innerText()).trim(), /^(Demo space|مساحة تجريبية)$/);
   assert.ok(await overflow(on.page), 'no horizontal scroll (' + tag + ')'); assert.ok((await label.evaluate(e => parseFloat(getComputedStyle(e).fontSize))) >= 16, 'at least 16px');
   assert.equal(await on.page.locator('[data-section="th-courses"] [data-demo-label]').count(), 0, 'the label is a page label, not a course label');
   await on.page.screenshot({ path: path.join(shots, 'demo-label-home-' + tag + '.png'), fullPage: true }); await on.context.close();
  }
  const first = await open(desktop, 'view=home&s=first&demo=1'); await first.page.locator('[data-first-visit]').waitFor(); assert.equal(await first.page.locator('[data-demo-label]').count(), 1);
  await first.page.screenshot({ path: path.join(shots, 'demo-label-first-visit-en-1440.png'), fullPage: true }); await first.context.close();
  const none = await open(desktop, 'view=home&s=first'); await none.page.locator('[data-first-visit]').waitFor(); assert.equal(await none.page.locator('[data-demo-label]').count(), 0); await none.context.close();
  const err = await open(desktop, 'view=home&s=errors'); await err.page.locator('[data-teacher-home]').waitFor(); assert.equal(await err.page.locator('[data-demo-label]').count(), 0, 'a failed check shows no label and no error'); await err.context.close();
 });
 await step('Keyboard: nothing on Home traps focus, every control shows a visible focus ring, and the dialog closes with Escape', async () => {
  const { page, context } = await open(desktop, 'view=home&s=full');
  await page.locator('[data-teacher-home]').waitFor();
  const seen = new Set(); for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); seen.add(await page.evaluate(() => { const e = document.activeElement; return e && e !== document.body ? (e.getAttribute('data-nav') || e.getAttribute('data-course') || e.tagName + ':' + (e.textContent || '').trim().slice(0, 20)) : ''; })); }
  assert.ok(seen.size > 15, 'focus moves through the page');
  await page.locator('header [data-create-course]').click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
  await context.close();
 });
 await browser.close(); server.close();
 assert.deepEqual(errors, [], 'no uncaught or console errors');
 assert.deepEqual(external, [], 'no external requests');
 console.log(`Teacher Home browser checks passed: ${results.length} groups (synthetic loopback data, not provider E2E). Screenshots: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
