// Teacher course page (Settings > Courses > one course) in Chromium: the real components inside the real Settings shell, the REAL middleware in front of every
// page and API request, the real built CSS and fonts, and fictional /api/teacher/courses and /api/teacher/academics services with synthetic data only. Not provider acceptance.
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME, a Firebase-mode `npm run build` (CSS, fonts) and optionally LMS_FRESH_CSS.
const { shootMatrix } = require('./screen-matrix.cjs');
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/teacher-course-page-browser'), shots = path.join(out, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the real CSS and fonts are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat([require('./harness-css.cjs')()]).join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

// ---- the real middleware.ts, run with Firebase staging on
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
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { TeacherSettingsShell } from '@/frontend/features/teacher-settings/shell';
import { TeacherCourseView } from '@/frontend/features/teacher-course/course-view';
let lang = 'en'; try { lang = localStorage.getItem('edulabs-lms-language') === 'ar' ? 'ar' : 'en'; } catch {}
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
// What the server component does: read the course, hand it to the view. A refresh reads it again.
function Page() {
  const [load, setLoad] = useState(null);
  const read = () => fetch('/__load/' + location.pathname.split('/').pop()).then(r => r.json()).then(setLoad);
  useEffect(() => { read(); window.addEventListener('harness-refresh', read); return () => window.removeEventListener('harness-refresh', read); }, []);
  return load ? <main><TeacherSettingsShell><TeacherCourseView load={load} /></TeacherSettingsShell></main> : null;
}
createRoot(document.getElementById('root')).render(
 <LanguageProvider initialLanguage={lang}>
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange><Page /></ThemeProvider>
 </LanguageProvider>);
`;

const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const COURSE = uuid(10), ORG = uuid(50);
const fresh = () => ({ load: 'ready', canEdit: true, showSpace: false, description: 'A synthetic course about motion and energy.', status: 'draft', updatedAt: '2026-11-05T09:00:00.000000+00:00', title: 'Synthetic Physics 9', grades: 'ok', patch: 'ok', failGrades: 0, failPatch: 0, patches: [], gradeReads: 0 });
const S = fresh();
let tick = 0;
const reset = () => { tick = 0; Object.assign(S, fresh()); };
const bump = () => { tick++; S.updatedAt = `2026-11-05T09:00:${String(tick).padStart(2, '0')}.000000+00:00`; };

(async () => {
 const stubs = {
  '@/frontend/components/providers/use-loading-router': 'export const useLoadingRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() { window.__refreshes = (window.__refreshes || 0) + 1; window.dispatchEvent(new Event("harness-refresh")); } });',
  'next/navigation': 'export const usePathname = () => location.pathname; export const useRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() { window.__refreshes = (window.__refreshes || 0) + 1; window.dispatchEvent(new Event("harness-refresh")); } });',
  'next/image': 'import React from "react"; export default function Image({ unoptimized, fill, priority, ...p }) { return React.createElement("img", p); }',
  'next/link': 'import React from "react"; export default function Link({ href, children, onClick, ...rest }) { return React.createElement("a", { ...rest, href, onClick: e => { onClick && onClick(e); if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); location.assign(href); } }, children); }',
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
  const send = (value, status = 200, headers = {}) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); for (const [k, v] of Object.entries(headers)) res.setHeader(k, v); res.end(JSON.stringify(value)); };
  const body = cb => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => cb(JSON.parse(Buffer.concat(parts) || '{}'))); };
  if (url.pathname === '/__app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
  if (url.pathname === '/__style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
  if (url.pathname === '/__ctl') return body(b => { if (b.reset) reset(); if (b.touch) bump(); for (const k of ['load', 'canEdit', 'showSpace', 'description', 'status', 'grades', 'patch', 'failGrades', 'failPatch', 'title']) if (k in b) S[k] = b[k]; send({}); });
  if (url.pathname === '/__state') return send({ patches: S.patches, requests, status: S.status, updatedAt: S.updatedAt, gradeReads: S.gradeReads });
  if (url.pathname.startsWith('/__load/')) { // the server component's read
   if (S.load === 'missing') return send({ state: 'missing' });
   if (S.load === 'error') return send({ state: 'error', status: null });
   return send({ state: 'ready', course: { id: COURSE, organizationId: ORG, spaceName: 'Synthetic Space', showSpace: S.showSpace, title: S.title, description: S.description, status: S.status, updatedAt: S.updatedAt, canEdit: S.canEdit } });
  }
  requests.push(req.method + ' ' + req.url);
  const decision = gate(url.pathname);
  if (decision.kind === 'json') return send({ error: 'This legacy workflow is unavailable in Firebase staging.' }, decision.status);
  if (decision.kind === 'redirect') { res.statusCode = 307; res.setHeader('Location', decision.location); return res.end(); }
  if (url.pathname === '/api/teacher/academics' && req.method === 'GET') {
   S.gradeReads++;
   if (url.searchParams.get('kind') !== 'classification' || url.searchParams.get('courseId') !== COURSE || url.searchParams.get('organizationId') !== ORG) return send({ error: 'bad query' }, 400);
   if (S.failGrades > 0) { S.failGrades--; return send({ error: 'x' }, 503); }
   if (S.grades === '403') return send({ error: 'no' }, 403);
   if (S.grades === '500') return send({ error: 'x' }, 503);
   if (S.grades === 'lost') return req.socket.destroy();
   return send({ courseId: COURSE, revision: 1, stageIds: S.grades === 'empty' ? [] : [uuid(70)], selected: S.grades === 'empty' ? [] : [{ id: uuid(70), label: 'Grade 9', status: 'active', programLabel: 'American Diploma', programStatus: 'active' }] });
  }
  if (url.pathname === '/api/teacher/courses/' + COURSE && req.method === 'PATCH') return body(b => {
   S.patches.push(b);
   if (S.failPatch > 0) { S.failPatch--; return send({ error: 'x' }, 503); }
   if (S.patch === 'lost') return req.socket.destroy();
   if (S.patch === '403') return send({ error: 'Course not found or editing not permitted' }, 404);
   if (S.patch === '500') return send({ error: 'x' }, 503);
   if (b.updated_at !== S.updatedAt) return send({ error: 'Course changed. Reload before saving.' }, 409);
   S.status = b.status; bump(); return send({ id: COURSE });
  });
  if (url.pathname.startsWith('/api/')) { if (url.pathname === '/api/communications') return send({ rows: [], page: 0, unread: 0 }); if (url.pathname === '/api/user/status') return send({ user: { role: 'teacher' } }); return send({ error: 'harness: not served' }, 404); }
  const h = decision.headers || new Map();
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); for (const [k, v] of h) res.setHeader(k, v);
  if (!h.has('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><html lang="en" data-lms-appearance><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Harness</title><link rel="stylesheet" href="/__style.css"></head><body class="${fontVars} font-sans"><div id="root"></div><script src="/__app.js"></script></body></html>`);
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 const ctl = body => fetch(origin + '/__ctl', { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
 const state = () => fetch(origin + '/__state').then(r => r.json());
 const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
 const errors = [], results = [], external = [];
 const phone = { width: 390, height: 844 }, desktop = { width: 1440, height: 900 };
 const PAGE = '/teacher/settings/courses/' + COURSE;
 const open = async (viewport, p = PAGE, { lang = 'en', theme = 'light' } = {}) => {
  const context = await browser.newContext({ viewport, locale: lang });
  await context.addInitScript(([l, t]) => { try { localStorage.setItem('edulabs-lms-language', l); localStorage.setItem('edulabs-lms-appearance', t); } catch {} }, [lang, theme]);
  const page = await context.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message.slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', r => { if (r.request().url().startsWith(origin)) return r.continue(); external.push(r.request().url()); return r.abort(); });
  await page.goto(origin + p);
  return { page, context };
 };
 const overflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
 const only = process.env.LMS_ONLY_STEPS ? new RegExp(process.env.LMS_ONLY_STEPS) : null;
 const step = async (name, fn) => { if (only && !only.test(name)) return; try { await ctl({ reset: true }); await fn(); results.push('PASS ' + name); console.log('PASS', name); } catch (e) { console.log('FAIL', name); throw e; } };
 const shot = (page, name) => page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
 const tinyTargets = page => page.evaluate(() => [...document.querySelectorAll('main a, main button, main input, main select')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 43.5 || r.width < 43.5) && getComputedStyle(e).visibility !== 'hidden'; }).map(e => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
 const smallText = page => page.evaluate(() => { const bad = []; const w = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.textContent.trim()) continue; const s = parseFloat(getComputedStyle(n.parentElement).fontSize); if (s < 12) bad.push(n.textContent.trim().slice(0, 30) + ':' + s); } return bad; });
 const forbidden = /organi[sz]ation|tenant|\bslug\b|program(me)?s?\b|\bstages?\b|\bmodules?\b|\boffering|website studio|منظمة|مؤسسة|وحدة|برنامج|مرحلة/i;
 const main = page => page.locator('main').innerText();
 const settled = page => page.waitForFunction(() => !document.querySelector('[data-state="loading"],[data-skeleton]') && !document.querySelector('main').innerText.includes('…'));
 const clean = async (page, label) => {
  assert.ok(await overflow(page), 'no horizontal scroll ' + label); assert.deepEqual(await tinyTargets(page), [], '44px targets ' + label);
  assert.deepEqual(await smallText(page), [], 'text of 12px or more ' + label); assert.doesNotMatch(await main(page), forbidden, 'wording ' + label);
 };
 let probes = 0;

 await step('Middleware: only the exact course page passes, with no referrer and no caching; lookalikes are refused; the endpoints are reachable', async () => {
  const get = (p, init) => fetch(origin + p, { redirect: 'manual', ...init });
  const ok = await get(PAGE); assert.equal(ok.status, 200); assert.equal(ok.headers.get('referrer-policy'), 'no-referrer'); assert.equal(ok.headers.get('cache-control'), 'private, no-store');
  for (const bad of [PAGE + '/', PAGE + '/lessons', '/teacher/settings/courses/not-a-uuid', '/teacher/settings/courses/' + COURSE.slice(1), PAGE + '.json', '/teacher/settings/account/' + COURSE]) { const r = await get(bad); assert.equal(r.status, 307, bad + ' is refused'); assert.match(r.headers.get('location'), /unavailable/, bad); }
  probes = requests.length;
 });

 await step('Desktop: a draft course shows title, system, grade, description, Draft, Publish and a calm Lessons note (no fake list)', async () => {
  const { page, context } = await open(desktop);
  await page.locator('[data-teacher-course]').waitFor(); await settled(page);
  assert.equal((await page.locator('[data-course-title]').innerText()).trim(), 'Synthetic Physics 9');
  const text = await main(page);
  assert.match(text, /Education system\s+American Diploma/); assert.match(text, /Grade\s+Grade 9/); assert.match(text, /A synthetic course about motion and energy\./);
  assert.equal(await page.locator('[data-status="draft"]').count(), 1); assert.match(await page.locator('[data-status-note]').innerText(), /Students cannot see this course yet/);
  assert.equal(await page.locator('[data-course-publish]').innerText(), 'Publish');
  assert.match(await page.locator('[data-lessons-soon]').innerText(), /lesson editor is coming/i);
  assert.equal(await page.locator('[data-section="lessons"] li, [data-section="lessons"] ul').count(), 0, 'no list of lessons');
  assert.equal(await page.locator('[data-course-space]').count(), 0, 'one space: the space is not named');
  assert.equal(await page.locator('[data-settings-section]').count(), 0, 'a course page has no Settings sub-navigation: it belongs to Courses');
  assert.equal(await page.locator('[data-course-back]').getAttribute('href'), '/teacher/courses');
  for (const t of ['course-system', 'course-grade', 'course-status', 'course-publish', 'course-lessons']) assert.equal(await page.locator(`[data-tour="${t}"]`).count(), 1, t);
  await clean(page, 'desktop'); await shot(page, 'desktop-draft'); await context.close();
 });

 await step('Publish asks first, cancels cleanly, then sends exactly the version it read and the new status once, and the page shows Published', async () => {
  const { page, context } = await open(desktop); await page.locator('[data-course-publish]').waitFor();
  await page.locator('[data-course-publish]').click(); await page.locator('[data-confirm]').waitFor();
  assert.match(await page.locator('[data-confirm]').innerText(), /Publish "Synthetic Physics 9"\? Students you invite will be able to see it\./); assert.equal((await state()).patches.length, 0, 'asking changes nothing');
  await page.locator('[data-confirm-no]').click(); assert.equal(await page.locator('[data-confirm]').count(), 0); assert.equal((await state()).patches.length, 0);
  await page.locator('[data-course-publish]').click(); await shot(page, 'desktop-confirm');
  await page.locator('[data-confirm-yes]').dblclick();
  await page.locator('[data-status="published"]').waitFor();
  const s = await state(); assert.equal(s.patches.length, 1, 'one request even for a double click'); assert.deepEqual(s.patches[0], { updated_at: '2026-11-05T09:00:00.000000+00:00', status: 'published' });
  assert.equal(await page.locator('[data-course-publish]').innerText(), 'Unpublish'); assert.match(await page.locator('[data-status-note]').innerText(), /Students you invite can see this course/);
  assert.equal(await page.locator('[data-confirm]').count(), 0);
  // and back: the new version is the one sent
  await page.locator('[data-course-publish]').click(); await page.locator('[data-confirm]').waitFor(); assert.match(await page.locator('[data-confirm]').innerText(), /Unpublish "Synthetic Physics 9"\? Students will no longer see it\./);
  await page.locator('[data-confirm-yes]').click(); await page.locator('[data-status="draft"]').waitFor();
  const t = await state(); assert.equal(t.patches.length, 2); assert.equal(t.patches[1].status, 'draft'); assert.equal(t.patches[1].updated_at, '2026-11-05T09:00:01.000000+00:00');
  await context.close();
 });

 await step('Phone: one calm column, large targets, readable text, the back link goes to the course list', async () => {
  const { page, context } = await open(phone); await page.locator('[data-teacher-course]').waitFor(); await settled(page);
  await clean(page, 'phone'); await shot(page, 'phone-draft');
  assert.equal(await page.locator('[data-course-back]').getAttribute('href'), '/teacher/courses');
  await page.locator('[data-course-publish]').click(); await page.locator('[data-confirm]').waitFor(); await clean(page, 'phone confirm'); await shot(page, 'phone-confirm');
  await context.close();
 });

 await step('Arabic and RTL: the page, the confirmation and the Lessons note are in Arabic, mirrored, with no overflow', async () => {
  const { page, context } = await open(phone, PAGE, { lang: 'ar' }); await page.locator('[data-teacher-course]').waitFor(); await settled(page);
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  const text = await main(page);
  for (const part of ['التفاصيل', 'النظام التعليمي', 'الصف', 'الظهور', 'مسودة', 'نشر', 'الدروس', 'محرر الدروس قادم']) assert.ok(text.includes(part), part);
  await page.locator('[data-course-publish]').click(); await page.locator('[data-confirm]').waitFor(); assert.ok((await page.locator('[data-confirm]').innerText()).includes('سيستطيع الطلاب الذين تدعوهم رؤيتها'));
  await clean(page, 'arabic'); await shot(page, 'phone-arabic'); await context.close();
 });

 await step('Several teaching spaces: the space is named under the title, by its real name', async () => {
  await ctl({ showSpace: true }); const { page, context } = await open(desktop); await page.locator('[data-course-space]').waitFor();
  assert.equal((await page.locator('[data-course-space]').innerText()).trim(), 'Synthetic Space'); await context.close();
 });

 await step('No description: the About row is not shown; an Arabic title stays isolated', async () => {
  await ctl({ description: null, title: 'فيزياء الصف التاسع' }); const { page, context } = await open(desktop); await page.locator('[data-teacher-course]').waitFor();
  assert.equal(await page.locator('[data-course-description]').count(), 0); assert.doesNotMatch(await main(page), /About this course/);
  assert.equal((await page.locator('[data-course-title]').innerText()).trim(), 'فيزياء الصف التاسع'); await context.close();
 });

 await step('Changed elsewhere: a stale version is refused with a clear message; Reload shows the current state and the next try works', async () => {
  const { page, context } = await open(desktop); await page.locator('[data-course-publish]').waitFor();
  await ctl({ touch: true }); // someone else saved this course after this page read it
  await page.locator('[data-course-publish]').click(); await page.locator('[data-confirm-yes]').click();
  const alert = page.locator('[data-failure="changed"]'); await alert.waitFor();
  assert.match(await alert.innerText(), /changed somewhere else\. Reload to see the latest version/); assert.equal((await state()).status, 'draft', 'nothing was overwritten'); await shot(page, 'desktop-conflict');
  await alert.locator('[data-course-reload]').click(); await page.waitForFunction(() => document.querySelectorAll('[data-failure]').length === 0);
  await page.locator('[data-course-publish]').click(); await page.locator('[data-confirm-yes]').click(); await page.locator('[data-status="published"]').waitFor();
  const s = await state(); assert.equal(s.patches.at(-1).updated_at, '2026-11-05T09:00:01.000000+00:00', 'the reloaded version was sent'); await context.close();
 });

 await step('Publish failures are honest: refused, failed (retry keeps the question), and a lost reply is an unknown outcome with Reload', async () => {
  const { page, context } = await open(desktop); await page.locator('[data-course-publish]').waitFor();
  await ctl({ patch: '403' }); await page.locator('[data-course-publish]').click(); await page.locator('[data-confirm-yes]').click();
  await page.locator('[data-failure="denied"]').waitFor(); assert.match(await page.locator('[data-failure="denied"]').innerText(), /cannot change this course/); assert.equal(await page.locator('[data-course-reload]').count(), 0);
  await page.locator('[data-confirm-no]').click(); await ctl({ patch: 'ok', failPatch: 1 });
  await page.locator('[data-course-publish]').click(); await page.locator('[data-confirm-yes]').click(); await page.locator('[data-failure="failed"]').waitFor();
  assert.match(await page.locator('[data-failure="failed"]').innerText(), /Nothing changed\. Try again\./); assert.equal(await page.locator('[data-confirm]').count(), 1, 'the question is still open for a retry');
  await page.locator('[data-confirm-yes]').click(); await page.locator('[data-status="published"]').waitFor();
  await ctl({ patch: 'lost' }); await page.locator('[data-course-publish]').click(); await page.locator('[data-confirm-yes]').click();
  await page.locator('[data-failure="unknown"]').waitFor(); assert.match(await page.locator('[data-failure="unknown"]').innerText(), /could not confirm whether the change was saved/);
  assert.equal(await page.locator('[data-status="published"]').count(), 1, 'the page does not guess a new state'); assert.equal(await page.locator('[data-course-reload]').count(), 1);
  await shot(page, 'desktop-unknown'); await context.close();
 });

 await step('The grade read fails on its own: the rest of the page still works; retry re-reads only that part; a refusal has no retry', async () => {
  await ctl({ grades: '500' }); const { page, context } = await open(desktop); await page.locator('[data-teacher-course]').waitFor();
  await page.locator('[data-state="error"][role="alert"]').first().waitFor(); await settled(page);
  assert.match(await main(page), /could not load the education system and grade/); assert.equal((await page.locator('[data-course-title]').innerText()).trim(), 'Synthetic Physics 9'); assert.equal(await page.locator('[data-course-publish]').count(), 1, 'publishing is still possible');
  assert.doesNotMatch(await main(page), /Not set/, 'a failed read is not shown as "Not set"');
  await ctl({ grades: 'ok' }); await page.locator('[data-grade-retry]').click(); await page.getByText('American Diploma').waitFor(); assert.equal(await page.locator('[data-grade-retry]').count(), 0);
  await shot(page, 'desktop-grade-error'); await context.close();
  await ctl({ grades: '403' }); const denied = await open(desktop); await denied.page.locator('[data-teacher-course]').waitFor(); await settled(denied.page);
  assert.match(await main(denied.page), /cannot see the education system and grade/); assert.equal(await denied.page.locator('[data-grade-retry]').count(), 0); await denied.context.close();
  await ctl({ grades: 'empty' }); const none = await open(desktop); await none.page.locator('[data-teacher-course]').waitFor(); await settled(none.page);
  assert.equal((await main(none.page)).match(/Not set/g).length, 2, 'an empty classification reads as "Not set"'); await none.context.close();
 });

 await step('Not allowed, archived, missing and server error: no Publish button, a plain note, or an honest page', async () => {
  await ctl({ canEdit: false }); let o = await open(desktop); await o.page.locator('[data-teacher-course]').waitFor();
  assert.equal(await o.page.locator('[data-course-publish]').count(), 0); assert.match(await o.page.locator('[data-cannot-edit]').innerText(), /Only the owner, an admin or the course team/); await o.context.close();
  await ctl({ reset: true, status: 'archived' }); o = await open(desktop); await o.page.locator('[data-teacher-course]').waitFor();
  assert.equal(await o.page.locator('[data-course-publish]').count(), 0); assert.equal(await o.page.locator('[data-status="archived"]').count(), 1); await o.context.close();
  await ctl({ reset: true, load: 'missing' }); o = await open(phone); await o.page.locator('[data-state="missing"]').waitFor(); assert.match(await main(o.page), /Course not found/); await clean(o.page, 'missing'); await o.context.close();
  await ctl({ reset: true, load: 'error' }); o = await open(phone); await o.page.locator('[data-state="error"]').waitFor(); assert.equal(await o.page.locator('[data-course-publish]').count(), 0);
  await ctl({ load: 'ready' }); await o.page.getByRole('button', { name: 'Try again' }).click(); await o.page.locator('[data-course-title]').waitFor(); await o.context.close();
 });

 await step('The first view shows a placeholder for the grade until it has been read, and no loading overlay signal exists', async () => {
  const { page, context } = await open(desktop); await page.locator('[data-teacher-course]').waitFor(); await settled(page);
  assert.equal(await page.evaluate(() => typeof window.__loadingSignal), 'undefined'); assert.equal(await page.locator('[data-state="loading"],[data-skeleton]').count(), 0); await context.close();
 });

 if (process.env.LMS_MATRIX) await step('Screen matrix: every look, theme, language and width, measured', async () => {
  const withLook = (p, look) => p + (p.includes('?') ? '&' : '?') + 'design=' + look;
  const findings = await shootMatrix({ label: 'course-page', open: ({ viewport, lang, theme, target }) => open(viewport, target, { lang, theme }), screens: [
   { name: 'course-page', target: PAGE, ready: '[data-course-publish]' },
  ] });
  assert.deepEqual(findings, []);
 });

 await browser.close(); server.close();
 assert.deepEqual(errors, [], 'no uncaught or console errors');
 assert.deepEqual(external, [], 'no external requests');
 const apis = [...new Set(requests.slice(probes).filter(r => /\/api\//.test(r)).map(r => r.replace(/^(\w+) (\/[^?]*).*/, '$1 $2')))].sort();
 assert.deepEqual(apis.filter(r => !/^(GET \/api\/teacher\/academics|PATCH \/api\/teacher\/courses\/[0-9a-f-]{36}|GET \/api\/communications|GET \/api\/user\/status)$/.test(r)), [], 'the page calls only the existing endpoints: ' + apis.join(', '));
 console.log(`Teacher course page browser checks passed: ${results.length} groups (real middleware, synthetic loopback data, not provider E2E). Screenshots: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
