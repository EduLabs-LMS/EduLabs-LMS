// The Board (/class/<session>/board) in Chromium: the real Board component with the real language and theme providers, the REAL middleware in
// front of every request, the real built CSS and fonts. The page's server check (app/(board)/class/[sessionId]/board/page.tsx: the Group's staff
// only, through private.live_class_joined) is played by this fictional server from a harness cookie; the real check is pinned by
// scripts/live-class.test.cjs and the SQL suite. Pointer input: real mouse events, and synthetic Pointer Events for pen (with pressure) and touch,
// which is what a pen tablet sends but not the tablet itself. Synthetic loopback data only; nothing leaves the machine.
// Covers: students refused, mouse/pen/touch drawing, palm rejection, eraser, colours and widths, undo/redo (buttons and keys), pages, clear page,
// save as picture (PNG on white, always 1600 x 900), resizing and rotating (the drawing scales, never cut off), kept after a reload, New board, storage blocked, Arabic and dark (the drawing area stays white), phone, tablet
// and desktop with 44 px targets and no sideways scroll; LMS_MATRIX=1 adds the screen matrix (both looks, themes, languages, widths).
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME and a Firebase-mode `npm run build` first (CSS, fonts). LMS_ONLY_STEPS runs matching steps.
const { shootMatrix } = require('./screen-matrix.cjs');
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME || path.resolve('node_modules');
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/live-class-board-browser'), shots = path.join(out, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the real CSS and fonts are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat([require('./harness-css.cjs')()]).join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

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

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { Board } from '@/frontend/features/live-class/board';
const sessionId = location.pathname.split('/')[2];
const query = new URLSearchParams(location.search);
let lang = 'en';
try { lang = localStorage.getItem('edulabs-lms-language') === 'ar' ? 'ar' : 'en'; } catch {}
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
document.documentElement.dataset.design = query.get('design') === 'new' ? 'new' : 'classic';
createRoot(document.getElementById('root')).render(
 <LanguageProvider initialLanguage={lang}>
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange><Board sessionId={sessionId} /></ThemeProvider>
 </LanguageProvider>);
`;

const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const CLASS = uuid(1), OTHER = uuid(2), UNKNOWN = uuid(3);
// What private.live_class_joined answers: the Group's staff of these classes, nobody else.
const staffClasses = new Set([CLASS, OTHER]);

(async () => {
 const stubs = {
  'next/navigation': 'export const usePathname = () => location.pathname; export const useRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() {} }); export const useSearchParams = () => new URLSearchParams(location.search);',
  '@/shared/auth-config': 'export const isFirebaseStaging = () => true;',
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
  if (url.pathname === '/__app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
  if (url.pathname === '/__style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
  requests.push(req.method + ' ' + url.pathname);
  const decision = gate(url.pathname);
  if (decision.kind === 'json') { res.statusCode = decision.status; return res.end('{}'); }
  if (decision.kind === 'redirect') { res.statusCode = 307; res.setHeader('Location', decision.location); return res.end(); }
  for (const [k, v] of decision.headers ?? []) res.setHeader(k, v);
  if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // The page's own check, played here: staff of the class get the Board; students, other people and unknown classes get "not found".
  const m = url.pathname.match(/^\/class\/([0-9a-f-]{36})\/board$/);
  const role = /(?:^|; )lms-harness-role=staff(?:;|$)/.test(req.headers.cookie || '') ? 'staff' : 'student';
  if (!m || role !== 'staff' || !staffClasses.has(m[1])) { res.statusCode = 404; return res.end('<!doctype html><html><body><h1>404</h1><p>This page could not be found.</p></body></html>'); }
  res.end(`<!doctype html><html lang="en" data-lms-appearance><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Board | EduLabs</title><link rel="stylesheet" href="/__style.css"></head><body class="${fontVars} font-sans"><div id="root"></div><script src="/__app.js"></script></body></html>`);
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
 const errors = [], results = [], external = [];
 const phone = { width: 390, height: 844 }, tablet = { width: 820, height: 1180 }, desktop = { width: 1440, height: 900 };
 const board = id => `/class/${id}/board`;
 const open = async (viewport, target, { lang = 'en', theme = 'light', role = 'staff', look = 'classic', init } = {}) => {
  const context = await browser.newContext({ viewport, locale: lang, acceptDownloads: true, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'lms-harness-role', value: role, url: origin }]);
  await context.addInitScript(([l, t]) => { try { localStorage.setItem('edulabs-lms-language', l); localStorage.setItem('edulabs-lms-appearance', t); } catch {} }, [lang, theme]);
  if (init) await context.addInitScript(init);
  await context.route('**/*', r => { const u = r.request().url(); if (u.startsWith(origin)) return r.continue(); external.push(u); return r.abort(); });
  const page = await context.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message.slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const response = await page.goto(origin + target + (look === 'new' ? '?design=new' : ''));
  return { page, context, response };
 };
 const ready = p => p.locator('[data-board-canvas]').waitFor();
 const only = process.env.LMS_ONLY_STEPS ? new RegExp(process.env.LMS_ONLY_STEPS) : null;
 const step = async (name, fn) => { if (only && !only.test(name)) return; try { await fn(); results.push('PASS ' + name); console.log('PASS', name); } catch (e) { console.log('FAIL', name); throw e; } };
 const shot = (p, name) => p.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
 const overflow = p => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1);
 const tinyTargets = p => p.evaluate(() => [...document.querySelectorAll('[data-board] button, [role="dialog"] button')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 43.5 || r.width < 43.5); }).map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
 const frames = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
 /** Synthetic Pointer Events on the canvas (what a pen or a finger sends): points are CSS pixels inside the drawing area. */
 const draw = async (p, type, points, { id = type === 'pen' ? 7 : type === 'touch' ? 9 : 1, pressure = 0.5, up = true } = {}) => {
  await p.evaluate(([type, points, id, pressure, up]) => {
   const c = document.querySelector('[data-board-canvas]'), r = c.getBoundingClientRect();
   const ev = (name, [x, y], buttons) => c.dispatchEvent(new PointerEvent(name, { bubbles: true, cancelable: true, pointerId: id, pointerType: type, isPrimary: true, clientX: r.left + x, clientY: r.top + y, pressure: buttons ? pressure : 0, buttons, button: name === 'pointermove' ? -1 : 0 }));
   ev('pointerdown', points[0], 1);
   for (const pt of points.slice(1)) ev('pointermove', pt, 1);
   if (up) ev('pointerup', points.at(-1), 0);
  }, [type, points, id, pressure, up]);
  await frames(p);
 };
 const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
 /** The canvas pixel at a CSS point: [r, g, b, alpha] (alpha 0 = nothing drawn; the white is the area behind it). */
 const px = (p, x, y) => p.evaluate(([x, y]) => [...document.querySelector('[data-board-canvas]').getContext('2d').getImageData(Math.round(x * devicePixelRatio), Math.round(y * devicePixelRatio), 1, 1).data], [x, y]);
 const saved = (p, id = CLASS) => p.evaluate(k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, 'edulabs-board:' + id);
 const label = p => p.locator('[data-page-label]').innerText();

 // ------------------------------------------------------------------ the real middleware, and who gets the page
 let probes = 0;
 await step('Middleware: /class/<uuid>/board is reachable with no-referrer and no-store; lookalikes are not', async () => {
  const get = p => fetch(origin + p, { redirect: 'manual', headers: { cookie: 'lms-harness-role=staff' } });
  const r = await get(board(CLASS)); assert.equal(r.status, 200);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer'); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  for (const bad of [board(CLASS) + '/', `/class/${CLASS}/boards`, `/class/${CLASS}/board/x`, '/class/board', '/class/A0000000-0000-4000-8000-00000000000B/board', '/board']) {
   const x = await get(bad); assert.equal(x.status, 307, bad); assert.equal(x.headers.get('location'), '/unavailable', bad);
  }
  probes = requests.length;
 });

 await step('Students and everyone but the Group\'s staff get "not found": no board, nothing drawn, nothing stored', async () => {
  for (const [role, id] of [['student', CLASS], ['staff', UNKNOWN]]) {
   const { page: p, context, response } = await open(desktop, board(id), { role });
   assert.equal(response.status(), 404, role + ' ' + id);
   assert.equal(await p.locator('[data-board]').count(), 0);
   assert.equal(await p.evaluate(() => localStorage.length), 2, 'only the harness language and theme');
   await context.close();
  }
 });

 // ------------------------------------------------------------------ drawing
 await step('Mouse: draws in black, Undo removes it, Redo brings it back; each change is kept in this browser', async () => {
  const { page: p, context } = await open(desktop, board(CLASS));
  await ready(p);
  assert.equal(await label(p), 'Page 1 of 1');
  assert.equal(await p.locator('[data-undo]').isDisabled(), true);
  const box = await p.locator('[data-board-canvas]').boundingBox();
  assert.equal(await p.locator('[data-board-canvas]').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)', 'white');
  await p.mouse.move(box.x + 100, box.y + 100); await p.mouse.down();
  for (let i = 1; i <= 20; i++) await p.mouse.move(box.x + 100 + i * 10, box.y + 100);
  await p.mouse.up(); await frames(p);
  const ink = await px(p, 200, 100);
  assert.ok(ink[3] > 200 && ink[0] < 40, 'black ink: ' + ink);
  assert.equal((await saved(p)).pages[0].length, 1, 'kept');
  assert.equal((await saved(p)).pages[0][0].color, '#111111');
  await p.locator('[data-undo]').click(); await frames(p);
  assert.equal((await px(p, 200, 100))[3], 0, 'undone');
  assert.equal((await saved(p)).pages[0].length, 0);
  await p.locator('[data-redo]').click(); await frames(p);
  assert.ok((await px(p, 200, 100))[3] > 200, 'redone');
  // Keys: Ctrl+Z and Ctrl+Y.
  await p.keyboard.press('Control+z'); await frames(p); assert.equal((await px(p, 200, 100))[3], 0);
  await p.keyboard.press('Control+y'); await frames(p); assert.ok((await px(p, 200, 100))[3] > 200);
  // A right click does not draw.
  await p.mouse.move(box.x + 100, box.y + 300); await p.mouse.down({ button: 'right' }); await p.mouse.move(box.x + 300, box.y + 300); await p.mouse.up({ button: 'right' }); await frames(p);
  assert.equal((await px(p, 200, 300))[3], 0, 'right button');
  assert.ok(await overflow(p)); assert.deepEqual(await tinyTargets(p), []);
  await shot(p, 'board-mouse-1440');
  await context.close();
 });

 await step('Pen: pressure changes the width; palm rejection: a hand on the screen while the pen writes (or after a pen was used) draws nothing', async () => {
  const { page: p, context } = await open(tablet, board(CLASS));
  await ready(p);
  await p.locator('[data-width="12"]').click();
  await draw(p, 'pen', line(100, 60, 400, 60), { pressure: 0.1 });
  await draw(p, 'pen', line(100, 140, 400, 140), { pressure: 1 });
  const s = (await saved(p)).pages[0];
  assert.equal(s.length, 2); assert.equal(s[0].points[2], 0.1); assert.equal(s[1].points[2], 1);
  const thick = async y => { let n = 0; for (let d = -12; d <= 12; d++) if ((await px(p, 250, y + d))[3] > 100) n++; return n; };
  const light = await thick(60), heavy = await thick(140);
  assert.ok(heavy > light + 3, `pressure: ${light}px vs ${heavy}px`);
  // The pen is down and a palm lands: the palm draws nothing, the pen stroke goes on.
  await draw(p, 'pen', [[100, 220], [150, 220]], { up: false });
  await draw(p, 'touch', line(100, 300, 400, 300));
  await draw(p, 'pen', [[150, 220], [400, 220]], { up: true });
  assert.ok((await px(p, 250, 220))[3] > 200, 'the pen stroke went on');
  assert.equal((await px(p, 250, 300))[3], 0, 'no palm stroke');
  // Later, with the pen lifted: a finger still draws nothing on a device whose pen was used.
  await draw(p, 'touch', line(100, 380, 400, 380));
  assert.equal((await px(p, 250, 380))[3], 0, 'touch is off once a pen was used');
  assert.equal((await saved(p)).pages[0].length, 3, 'two pen strokes and the third; no touch stroke');
  assert.ok(await overflow(p)); assert.deepEqual(await tinyTargets(p), []);
  await shot(p, 'board-pen-820');
  await context.close();
 });

 await step('Pen hovering turns touch off; on a device with no pen a finger draws, one finger at a time', async () => {
  const { page: p, context } = await open(tablet, board(OTHER));
  await ready(p);
  await draw(p, 'touch', line(100, 100, 400, 100));
  assert.ok((await px(p, 250, 100))[3] > 200, 'a finger draws when no pen was seen');
  // A second finger while the first is drawing does not draw.
  await draw(p, 'touch', [[100, 200], [200, 200]], { id: 21, up: false });
  await draw(p, 'touch', line(100, 300, 400, 300), { id: 22 });
  await draw(p, 'touch', [[200, 200], [400, 200]], { id: 21 });
  assert.equal((await px(p, 250, 300))[3], 0, 'second finger');
  assert.ok((await px(p, 350, 200))[3] > 200, 'first finger');
  // A hovering pen (a move with no button) is enough to stop the hand.
  await p.evaluate(() => { const c = document.querySelector('[data-board-canvas]'), r = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, pointerType: 'pen', clientX: r.left + 50, clientY: r.top + 50, buttons: 0 })); });
  await draw(p, 'touch', line(100, 400, 400, 400));
  assert.equal((await px(p, 250, 400))[3], 0, 'hover');
  await context.close();
 });

 await step('Eraser, colours and widths: the eraser clears what it crosses; a colour is drawn in that colour; the pressed buttons say which', async () => {
  const { page: p, context } = await open(desktop, board(CLASS));
  await ready(p);
  await p.locator('[data-color="#dc2626"]').click();
  await p.locator('[data-width="12"]').click();
  assert.equal(await p.locator('[data-color="#dc2626"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await p.locator('[data-color="#111111"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await p.locator('[data-width="12"]').getAttribute('aria-pressed'), 'true');
  await draw(p, 'mouse', line(100, 400, 500, 400));
  const red = await px(p, 300, 400);
  assert.ok(red[0] > 180 && red[1] < 80 && red[2] < 80 && red[3] > 200, 'red: ' + red);
  await p.locator('[data-tool-eraser]').click();
  assert.equal(await p.locator('[data-tool-eraser]').getAttribute('aria-pressed'), 'true');
  assert.equal(await p.locator('[data-board]').getAttribute('data-tool'), 'eraser');
  await draw(p, 'mouse', line(300, 300, 300, 500));
  assert.equal((await px(p, 300, 400))[3], 0, 'erased where it crossed');
  assert.ok((await px(p, 150, 400))[3] > 200, 'the rest stays');
  const s = (await saved(p)).pages[0];
  assert.equal(s.at(-1).tool, 'eraser');
  // Picking a colour goes back to the pen.
  await p.locator('[data-color="#1d4ed8"]').click();
  assert.equal(await p.locator('[data-tool-pen]').getAttribute('aria-pressed'), 'true');
  await shot(p, 'board-eraser-1440');
  await context.close();
 });

 await step('Pages, Clear page and a reload: a new page is empty, each page keeps its drawing, Clear asks first and clears only that page, a reload keeps everything', async () => {
  const { page: p, context } = await open(desktop, board(OTHER));
  await ready(p);
  await p.locator('[data-new-board]').click(); await p.locator('[data-confirm]').click();
  await draw(p, 'mouse', line(100, 100, 300, 100));
  await p.locator('[data-add-page]').click(); await frames(p);
  assert.equal(await label(p), 'Page 2 of 2');
  assert.equal((await px(p, 200, 100))[3], 0, 'the new page is empty');
  assert.equal(await p.locator('[data-next]').isDisabled(), true);
  await draw(p, 'mouse', line(100, 200, 300, 200));
  await p.locator('[data-prev]').click(); await frames(p);
  assert.equal(await label(p), 'Page 1 of 2');
  assert.ok((await px(p, 200, 100))[3] > 200 && (await px(p, 200, 200))[3] === 0, 'page 1 as drawn');
  await p.locator('[data-next]').click();
  await p.reload(); await ready(p); await frames(p);
  assert.equal(await label(p), 'Page 2 of 2', 'the page shown is kept');
  assert.ok((await px(p, 200, 200))[3] > 200, 'page 2 after the reload');
  await p.locator('[data-clear]').click();
  const dialog = p.locator('[role="dialog"]');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Clear this page\?/);
  assert.deepEqual(await tinyTargets(p), []);
  await shot(p, 'board-clear-dialog-1440');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  assert.ok((await px(p, 200, 200))[3] > 200, 'Cancel keeps it');
  await p.locator('[data-clear]').click(); await p.locator('[data-confirm]').click(); await frames(p);
  assert.equal((await px(p, 200, 200))[3], 0, 'cleared');
  assert.equal(await p.locator('[data-clear]').isDisabled(), true);
  await p.locator('[data-prev]').click(); await frames(p);
  assert.ok((await px(p, 200, 100))[3] > 200, 'the other page stays');
  const s = await saved(p, OTHER);
  assert.equal(s.pages.length, 2); assert.equal(s.pages[1].length, 0);
  await context.close();
 });

 await step('Save picture: a PNG of the page on white; New board asks, then deletes every page from this browser', async () => {
  const { page: p, context } = await open(desktop, board(CLASS));
  await ready(p);
  await p.locator('[data-new-board]').click(); await p.locator('[data-confirm]').click();
  await draw(p, 'mouse', line(100, 100, 400, 100));
  await p.locator('[data-tool-eraser]').click();
  await draw(p, 'mouse', line(250, 50, 250, 150));
  const [download] = await Promise.all([p.waitForEvent('download'), p.locator('[data-save-picture]').click()]);
  assert.equal(download.suggestedFilename(), 'board-page-1.png');
  const bytes = fs.readFileSync(await download.path());
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'a PNG');
  const picture = await p.evaluate(async b64 => {
   const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
   const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
   const at = (a, b) => [...x.getImageData(a, b, 1, 1).data];
   const k = 1600 / document.querySelector('[data-board-canvas]').getBoundingClientRect().width;
   return { size: [img.width, img.height], corner: at(2, 2), ink: at(Math.round(150 * k), Math.round(100 * k)), hole: at(Math.round(250 * k), Math.round(100 * k)) };
  }, bytes.toString('base64'));
  assert.deepEqual(picture.corner, [255, 255, 255, 255], 'white, not transparent');
  assert.deepEqual(picture.hole, [255, 255, 255, 255], 'erased is white');
  assert.ok(picture.ink[0] < 60 && picture.ink[3] === 255, 'the drawing: ' + picture.ink);
  assert.deepEqual(picture.size, [1600, 900], 'the page, not the window');
  await p.locator('[data-add-page]').click();
  await p.locator('[data-new-board]').click();
  const dialog = p.locator('[role="dialog"]'); await dialog.waitFor();
  assert.match(await dialog.innerText(), /Start a new board\?/);
  await p.locator('[data-confirm]').click(); await frames(p);
  assert.equal(await label(p), 'Page 1 of 1');
  assert.equal((await px(p, 150, 100))[3], 0);
  assert.equal(await saved(p), null, 'deleted from this browser');
  await p.reload(); await ready(p);
  assert.equal(await label(p), 'Page 1 of 1');
  await context.close();
 });

 await step('Resizing and rotating: the whole page stays on screen at 16:9 and the drawing scales with it; nothing is cut off', async () => {
  const { page: p, context } = await open(desktop, board(OTHER));
  await ready(p);
  await p.locator('[data-new-board]').click(); await p.locator('[data-confirm]').click();
  const geometry = () => p.evaluate(() => {
   const c = document.querySelector('[data-board-canvas]').getBoundingClientRect(), a = document.querySelector('.d-board-area').getBoundingClientRect();
   return { c: [c.left, c.top, c.right, c.bottom, c.width, c.height], a: [a.left, a.top, a.right, a.bottom] };
  });
  const whole = g => g.c[0] >= g.a[0] - 0.5 && g.c[1] >= g.a[1] - 0.5 && g.c[2] <= g.a[2] + 0.5 && g.c[3] <= g.a[3] + 0.5 && Math.abs(g.c[4] / g.c[5] - 16 / 9) < 0.02;
  let g = await geometry();
  assert.ok(whole(g), 'desktop: ' + JSON.stringify(g));
  // Lines near the four edges of the page, in page units (1600 x 900), drawn through the real input.
  const k0 = g.c[4] / 1600;
  const marks = [[80, 80, 1520, 80], [80, 820, 1520, 820], [80, 80, 80, 820], [1520, 80, 1520, 820]];
  for (const [x0, y0, x1, y1] of marks) await draw(p, 'mouse', line(x0 * k0, y0 * k0, x1 * k0, y1 * k0, 30));
  // Ink near a page point (within 2 CSS pixels: a thin line scaled down lands between pixel rows).
  const inked = (x, y) => p.evaluate(([x, y]) => { const c = document.querySelector('[data-board-canvas]'), sx = c.width / 1600, sy = c.height / 900; const d = c.getContext('2d').getImageData(Math.round(x * sx) - 2, Math.round(y * sy) - 2, 5, 5).data; let m = 0; for (let i = 3; i < d.length; i += 4) m = Math.max(m, d[i]); return m > 100; }, [x, y]);
  for (const [vw, vh, name] of [[700, 900, 'narrow'], [1440, 500, 'short'], [390, 844, 'phone portrait'], [844, 390, 'phone landscape'], [1440, 900, 'back to desktop']]) {
   await p.setViewportSize({ width: vw, height: vh }); await frames(p); await frames(p);
   g = await geometry();
   assert.ok(whole(g), name + ': the whole page fits: ' + JSON.stringify(g));
   for (const [x, y] of [[800, 80], [800, 820], [80, 450], [1520, 450], [1520, 820]]) assert.ok(await inked(x, y), `${name}: the drawing at ${x},${y} is still there, scaled`);
   assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, name + ': no sideways scroll');
   if (name === 'short') await shot(p, 'board-resized-short-1440x500');
   if (name === 'phone portrait') await shot(p, 'board-resized-390');
  }
  assert.equal((await saved(p, OTHER)).pages[0].length, 4, 'resizing never changes what is stored');
  await context.close();
 });

 await step('Storage blocked: the board still works and says it cannot be kept', async () => {
  const { page: p, context } = await open(desktop, board(OTHER), { init: () => { Storage.prototype.setItem = function () { throw new DOMException('blocked', 'QuotaExceededError'); }; } });
  await ready(p);
  const k = (await p.locator('[data-board-canvas]').boundingBox()).width / 1600;
  await draw(p, 'mouse', line(100, 100, 300, 100));
  await p.locator('[data-storage="none"]').waitFor(); await frames(p);
  // The notice takes room, so the page is redrawn smaller: look for the line by its page position.
  assert.ok(await p.evaluate(([x, y]) => { const c = document.querySelector('[data-board-canvas]'), sx = c.width / 1600, sy = c.height / 900; const d = c.getContext('2d').getImageData(Math.round(x * sx) - 2, Math.round(y * sy) - 2, 5, 5).data; let m = 0; for (let i = 3; i < d.length; i += 4) m = Math.max(m, d[i]); return m > 100; }, [200 / k, 100 / k]), 'the drawing stays, redrawn');
  assert.match(await p.locator('[data-storage]').innerText(), /cannot be kept in this browser/);
  await shot(p, 'board-not-saved-1440');
  await context.close();
 });

 await step('Arabic and dark: right-to-left toolbar, translated, the drawing area stays white and draws where the pen is; phone fits with no sideways scroll', async () => {
  const { page: p, context } = await open(phone, board(CLASS), { lang: 'ar', theme: 'dark' });
  await ready(p);
  assert.equal(await p.evaluate(() => document.documentElement.dir), 'rtl');
  assert.equal(await p.evaluate(() => document.documentElement.classList.contains('dark')), true);
  assert.equal(await label(p), 'صفحة 1 من 1');
  assert.equal(await p.locator('[data-undo]').getAttribute('aria-label'), 'تراجع');
  assert.equal(await p.locator('[data-board-canvas]').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)', 'white in dark');
  assert.notEqual(await p.locator('.d-board-bar').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)', 'the toolbar follows the theme');
  await draw(p, 'touch', line(40, 60, 120, 60));
  // A thin line on a phone-sized page is under 2 px wide: the strongest pixel within 2 px of the finger.
  assert.ok(await p.evaluate(([x, y]) => { const d = document.querySelector('[data-board-canvas]').getContext('2d').getImageData(x - 2, y - 2, 5, 5).data; let m = 0; for (let i = 3; i < d.length; i += 4) m = Math.max(m, d[i]); return m > 100; }, [80, 60]), 'drawn where the finger was');
  const box = await p.locator('[data-board-canvas]').boundingBox();
  assert.ok(Math.abs(box.width / box.height - 16 / 9) < 0.02 && box.width >= 380, 'the whole 16:9 page across the phone: ' + JSON.stringify(box));
  assert.ok(await overflow(p)); assert.deepEqual(await tinyTargets(p), []);
  await shot(p, 'board-ar-dark-390');
  await context.close();
 });

 if (process.env.LMS_MATRIX) await step('Screen matrix: both looks, both themes, both languages, both widths, measured', async () => {
  const drawSome = async p => { await draw(p, 'mouse', line(60, 60, 260, 120)); await p.locator('[data-color="#1d4ed8"]').click(); await draw(p, 'mouse', line(60, 160, 260, 160)); };
  const findings = await shootMatrix({ label: 'live-class-board', open: ({ viewport, lang, theme, look, target }) => open(viewport, target, { lang, theme, look }), screens: [
   { name: 'board-empty', target: board(CLASS), ready: '[data-board-canvas]', act: async p => { await p.locator('[data-new-board]').click(); await p.locator('[data-confirm]').click(); await p.locator('[role="dialog"]').waitFor({ state: 'detached' }); } },
   { name: 'board-drawn', target: board(OTHER), ready: '[data-board-canvas]', act: drawSome },
   { name: 'board-confirm-new', target: board(OTHER), ready: '[data-board-canvas]', act: async p => { await p.locator('[data-new-board]').click(); await p.locator('[role="dialog"]').waitFor(); } },
  ] });
  assert.deepEqual(findings, []);
 });

 await browser.close(); server.close();
 assert.deepEqual(errors, [], 'no uncaught or console errors');
 assert.deepEqual(external, [], 'nothing leaves the machine');
 const calls = requests.slice(probes).filter(r => !/^GET \/class\/[0-9a-f-]{36}\/board$/.test(r));
 assert.deepEqual(calls, [], 'the Board sends nothing: ' + calls.join(', '));
 console.log(`Board browser checks passed: ${results.length} groups (real middleware, real Board, synthetic pointer input, fictional page check, synthetic loopback data). Screenshots: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
