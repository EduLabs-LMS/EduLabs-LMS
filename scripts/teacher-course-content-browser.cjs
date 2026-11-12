// The Content section of the course page in Chromium: the real course page and Settings shell, the REAL middleware in front of every request, the real built CSS and fonts. The server is fictional and
// synthetic, but every request is checked against the real contract and every refusal is worded by the real reply mapper, with the database's own codes. Not provider acceptance.
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME, a Firebase-mode `npm run build` (CSS, fonts) and optionally LMS_FRESH_CSS.
const { shootMatrix } = require('./screen-matrix.cjs');
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/teacher-course-content-browser'), shots = path.join(out, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the real CSS and fonts are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat([require('./harness-css.cjs')()]).join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

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
const { contentEdit } = loadTs('shared/contracts/course-content.ts');
const { contentReply } = loadTs('shared/course-content.ts');

const entry = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { TeacherSettingsShell } from '@/frontend/features/teacher-settings/shell';
import { TeacherCourseView } from '@/frontend/features/teacher-course/course-view';
let lang = 'en'; try { lang = localStorage.getItem('edulabs-lms-language') === 'ar' ? 'ar' : 'en'; } catch {}
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
function Page() {
  const [load, setLoad] = useState(null);
  useEffect(() => { fetch('/__load').then(r => r.json()).then(setLoad); }, []);
  return load ? <main><TeacherSettingsShell><TeacherCourseView load={load} /></TeacherSettingsShell></main> : null;
}
createRoot(document.getElementById('root')).render(<LanguageProvider initialLanguage={lang}><ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange><Page /></ThemeProvider></LanguageProvider>);
`;

const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const COURSE = uuid(10), ORG = uuid(50), CH = { motion: uuid(101), energy: uuid(102), empty: uuid(103), waves: uuid(104) }, L = { speed: uuid(201), velocity: uuid(202), acceleration: uuid(203), work: uuid(204), power: uuid(205), sound: uuid(206) };
let tick = 0;
const stamp = () => `2026-11-06T10:${String(Math.floor(++tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.${String(100000 + tick)}+00:00`;
const lessonRow = (id, chapterId, title, position, extra = {}) => ({ id, chapterId, title, position, status: 'draft', updatedAt: stamp(), homework: 0, draftHomework: 0, deleteBlockers: [], contentBlocks: 0, hasCover: false, parts: 0, ...extra });
const chapterRow = (id, title, position) => ({ id, title, type: 'chapter', number: position + 1, position, updatedAt: stamp() });
const fresh = () => {
 tick = 0;
 return {
  archived: false, canEdit: true, fail: null, delay: 0, refuse: null, read: 'ok', posts: [], invalid: [], reads: 0,
  chapters: [chapterRow(CH.motion, 'Motion', 0), chapterRow(CH.energy, 'Energy', 1), chapterRow(CH.empty, 'Empty for now', 2), chapterRow(CH.waves, 'Waves', 3)],
  lessons: [
   lessonRow(L.speed, CH.motion, 'Speed', 0, { status: 'published', homework: 1, deleteBlockers: ['student_work', 'homework'] }),
   lessonRow(L.velocity, CH.motion, 'Velocity', 3, { draftHomework: 1, deleteBlockers: ['homework'] }), // positions with gaps, as after a move or a delete
   lessonRow(L.acceleration, CH.motion, 'Acceleration', 7, { status: 'published' }),
   lessonRow(L.work, CH.energy, 'Work', 1, { parts: 2, contentBlocks: 3, hasCover: true, deleteBlockers: ['parts', 'content'] }),
   lessonRow(L.power, CH.energy, 'Power', 2),
   lessonRow(L.sound, CH.waves, 'Sound', 0),
  ],
 };
};
let S = fresh();

// ---- what the database functions answer, with their real codes. Everything below is synthetic; the checks that the real functions do this are in course-content-screen-sql.cjs.
const refuse = error => { throw Object.assign(new Error('refused'), { dbError: error }); };
const stale = () => refuse({ code: 'PT409', message: 'Stale', details: null });
const sameStamps = (rows, items) => { if (rows.length !== items.length) stale(); for (const it of items) { const row = rows.find(r => r.id === it.id); if (!row || row.updatedAt !== it.updated_at) stale(); } };
const inChapter = id => S.lessons.filter(l => l.chapterId === id).sort((a, b) => a.position - b.position);
const renumber = () => { S.chapters.sort((a, b) => a.position - b.position).forEach((c, i) => { if (c.position !== i || c.number !== i + 1) c.updatedAt = stamp(); c.position = i; c.number = i + 1; }); };
const refusalFor = lessons => {
 const blocked = lessons.filter(l => l.deleteBlockers.length);
 return { code: '23503', message: 'Lesson in use', details: JSON.stringify({ reasons: [...new Set(blocked.flatMap(l => l.deleteBlockers))], lessonIds: blocked.map(l => l.id), contentBlocks: blocked.reduce((n, l) => n + l.contentBlocks, 0), covers: blocked.filter(l => l.hasCover).length, parts: blocked.reduce((n, l) => n + l.parts, 0), homework: blocked.reduce((n, l) => n + l.homework + l.draftHomework, 0) }) };
};
function apply(edit) {
 if (S.archived) refuse({ code: 'PT409', message: 'Course archived', details: JSON.stringify({ reasons: ['archived'] }) });
 const lesson = () => S.lessons.find(l => l.id === edit.id) ?? refuse({ code: '42501', message: 'Lesson unavailable' });
 const chapter = () => S.chapters.find(c => c.id === edit.id) ?? refuse({ code: '42501', message: 'Module unavailable' });
 const check = row => { if (row.updatedAt !== edit.updatedAt) stale(); return row; };
 switch (edit.action) {
  case 'create_chapter': { const row = chapterRow(uuid(300 + ++tick), edit.title, S.chapters.length); S.chapters.push(row); return row.id; }
  case 'create_lesson': { if (!S.chapters.some(c => c.id === edit.parentId)) refuse({ code: '42501', message: 'Module unavailable' }); const row = lessonRow(uuid(400 + ++tick), edit.parentId, edit.title, Math.max(-1, ...inChapter(edit.parentId).map(l => l.position)) + 5); S.lessons.push(row); return row.id; }
  case 'rename_chapter': { const row = check(chapter()); row.title = edit.title; row.updatedAt = stamp(); return row.id; }
  case 'rename_lesson': { const row = check(lesson()); row.title = edit.title; row.updatedAt = stamp(); return row.id; }
  case 'publish_lesson': case 'unpublish_lesson': { const row = check(lesson()); row.status = edit.action === 'publish_lesson' ? 'published' : 'draft'; row.updatedAt = stamp(); return row.id; }
  case 'reorder_modules': sameStamps(S.chapters, edit.items); edit.items.forEach((it, i) => { const c = S.chapters.find(r => r.id === it.id); c.position = i; c.number = i + 1; c.updatedAt = stamp(); }); return COURSE;
  case 'reorder_lessons': sameStamps(inChapter(edit.parentId), edit.items); edit.items.forEach((it, i) => { const l = S.lessons.find(r => r.id === it.id); l.position = i; l.updatedAt = stamp(); }); return COURSE;
  case 'move_lesson': { const row = check(lesson()); if (row.chapterId === edit.parentId) refuse({ code: '23514', message: 'Same chapter' }); sameStamps([...inChapter(edit.parentId), row], edit.items); row.chapterId = edit.parentId; edit.items.forEach((it, i) => { const l = S.lessons.find(r => r.id === it.id); l.position = i; l.updatedAt = stamp(); }); return row.id; }
  case 'delete_lesson': { const row = check(lesson()); if (S.refuse) { Object.assign(row, S.refuse); S.refuse = null; } if (row.deleteBlockers.length) refuse(refusalFor([row])); S.lessons = S.lessons.filter(l => l !== row); return row.id; }
  case 'delete_chapter': { const row = check(chapter()); const rows = inChapter(row.id); sameStamps(rows, edit.items); if (rows.some(l => l.deleteBlockers.length)) refuse(refusalFor(rows)); S.lessons = S.lessons.filter(l => l.chapterId !== row.id); S.chapters = S.chapters.filter(c => c !== row); S.chapters.forEach((c, i, all) => { c.position = all.indexOf(c); }); renumber(); return row.id; }
 }
}
const structure = () => ({ archived: S.archived, canEdit: S.canEdit && !S.archived, chapters: S.chapters, lessons: S.lessons });

(async () => {
 const stubs = {
  '@/frontend/components/providers/use-loading-router': 'export const useLoadingRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() {} });',
  'next/navigation': 'export const usePathname = () => location.pathname; export const useRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() {} });',
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
  const send = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
  const body = cb => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => cb(JSON.parse(Buffer.concat(parts) || '{}'))); };
  if (url.pathname === '/__app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
  if (url.pathname === '/__style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
  if (url.pathname === '/__ctl') return body(b => {
   if (b.reset) S = fresh();
   if (b.touchLesson) S.lessons.find(l => l.id === b.touchLesson).updatedAt = stamp();
   if (b.touchChapter) S.chapters.find(c => c.id === b.touchChapter).updatedAt = stamp();
   if (b.removeLesson) S.lessons = S.lessons.filter(l => l.id !== b.removeLesson);
   if (b.emptyCourse) { S.chapters = []; S.lessons = []; }
   for (const k of ['archived', 'canEdit', 'fail', 'delay', 'refuse', 'read']) if (k in b) S[k] = b[k];
   send({});
  });
  if (url.pathname === '/__state') return send({ posts: S.posts, invalid: S.invalid, reads: S.reads, chapters: S.chapters, lessons: S.lessons });
  if (url.pathname === '/__load') return send({ state: 'ready', course: { id: COURSE, organizationId: ORG, spaceName: 'Synthetic Space', showSpace: false, title: 'Synthetic Physics 9', description: null, status: S.archived ? 'archived' : 'draft', updatedAt: '2026-11-05T09:00:00.000000+00:00', canEdit: S.canEdit && !S.archived } });
  requests.push(req.method + ' ' + req.url);
  const decision = gate(url.pathname);
  if (decision.kind === 'json') return send({ error: 'This legacy workflow is unavailable in Firebase staging.' }, decision.status);
  if (decision.kind === 'redirect') { res.statusCode = 307; res.setHeader('Location', decision.location); return res.end(); }
  if (url.pathname === '/api/teacher/academics') return send({ courseId: COURSE, revision: 1, stageIds: [], selected: [] });
  if (url.pathname === `/api/teacher/courses/${COURSE}/content`) {
   if (req.method === 'GET') {
    S.reads++;
    if (S.read === '503') return send({ kind: 'failed' }, 503);
    if (S.read === '403') return send({ kind: 'denied' }, 403);
    return send(structure());
   }
   if (req.method === 'POST') return body(async b => {
    S.posts.push(b);
    if (S.delay) await new Promise(r => setTimeout(r, S.delay));
    const failNow = S.fail; if (failNow !== 'lost') S.fail = null; // Chromium quietly retries a request whose reused connection dropped, so a lost reply stays lost until the step clears it.
    if (failNow === 'lost') return req.socket.destroy();
    if (failNow) return send({ kind: 'failed' }, failNow);
    const edit = contentEdit.safeParse(b);
    if (!edit.success) { S.invalid.push(b); return send({ kind: 'invalid' }, 400); }
    if (!S.canEdit) return send({ kind: 'denied' }, 404);
    try { const id = apply(edit.data); return send({ id, structure: structure() }); }
    catch (e) { if (!e.dbError) throw e; const r = contentReply(e.dbError); return send(r.body, r.status); }
   });
  }
  if (url.pathname.startsWith('/api/')) { if (url.pathname === '/api/communications') return send({ rows: [], page: 0, unread: 0 }); if (url.pathname === '/api/user/status') return send({ user: { role: 'teacher' } }); return send({ error: 'harness: not served' }, 404); }
  const h = decision.headers || new Map();
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); for (const [k, v] of h) res.setHeader(k, v);
  if (!h.has('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><html lang="en" data-lms-appearance><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Harness</title><link rel="stylesheet" href="/__style.css"></head><body class="${fontVars} font-sans"><div id="root"></div><script src="/__app.js"></script></body></html>`);
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 const ctl = b => fetch(origin + '/__ctl', { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
 const state = () => fetch(origin + '/__state').then(r => r.json());
 const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
 const errors = [], results = [], external = [];
 const phone = { width: 390, height: 844 }, desktop = { width: 1440, height: 1000 }, tall = { width: 1440, height: 1800 };
 const PAGE = '/teacher/settings/courses/' + COURSE;
 const open = async (viewport, { lang = 'en', theme = 'light', look = 'classic' } = {}) => {
  const context = await browser.newContext({ viewport, locale: lang });
  await context.addInitScript(([l, t]) => { try { localStorage.setItem('edulabs-lms-language', l); localStorage.setItem('edulabs-lms-appearance', t); } catch {} }, [lang, theme]);
  const page = await context.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message.slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', r => { if (r.request().url().startsWith(origin)) return r.continue(); external.push(r.request().url()); return r.abort(); });
  await page.goto(origin + PAGE);
  await page.locator('[data-teacher-course]').waitFor();
  await page.evaluate(l => { document.documentElement.dataset.design = l; if (l === 'new') document.querySelector('main')?.setAttribute('data-teacher-shell', ''); }, look);
  return { page, context };
};
 const ready = async page => { await page.locator('[data-content-note]').waitFor(); return page; };
 const only = process.env.LMS_ONLY_STEPS ? new RegExp(process.env.LMS_ONLY_STEPS) : null;
 const step = async (name, fn) => { if (only && !only.test(name)) return; try { await ctl({ reset: true }); await fn(); results.push('PASS ' + name); console.log('PASS', name); } catch (e) { console.log('FAIL', name); throw e; } };
 const shot = (page, name) => page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
 const overflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
 const tinyTargets = page => page.evaluate(() => [...document.querySelectorAll('main a, main button, main input, [role="dialog"] button, [role="menu"] [role="menuitem"]')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 43.5 || r.width < 43.5) && getComputedStyle(e).visibility !== 'hidden'; }).map(e => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
 const smallText = page => page.evaluate(() => { const bad = []; const w = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.textContent.trim()) continue; const s = parseFloat(getComputedStyle(n.parentElement).fontSize); if (s < 12) bad.push(n.textContent.trim().slice(0, 30) + ':' + s); } return bad; });
 const forbidden = /organi[sz]ation|tenant|\bslug\b|program(me)?s?\b|\bstages?\b|\bmodules?\b|\boffering|\bblocks?\b|website studio|منظمة|مؤسسة|وحدة|برنامج|مرحلة|كتل/i;
 const section = page => page.locator('[data-section="content"]');
 const clean = async (page, label) => {
  assert.ok(await overflow(page), 'no sideways scroll ' + label); assert.deepEqual(await tinyTargets(page), [], '44px targets ' + label);
  assert.deepEqual(await smallText(page), [], '12px or more ' + label); assert.doesNotMatch(await page.locator('main').innerText(), forbidden, 'wording ' + label);
 };
 const lessons = (page, chapter) => page.locator(`[data-chapter="${chapter}"] [data-lesson]`).evaluateAll(rows => rows.map(r => r.querySelector('[data-lesson-number]').innerText.trim() + ' ' + r.querySelector('[data-lesson-title]').innerText.trim()));
 const chapters = page => page.locator('[data-chapter]').evaluateAll(rows => rows.map(r => r.querySelector('[data-chapter-label]').textContent.trim() + ' ' + r.querySelector('[data-chapter-title]').innerText.trim()));
 const focused = page => page.evaluate(() => { const e = document.activeElement; return e ? [e.getAttribute('data-focus-id'), e.getAttribute('data-focus-part')].join(':') : ''; });
 const waitFocus = async (page, id, part) => { await page.waitForFunction(([i, p]) => { const e = document.activeElement; return e && e.getAttribute('data-focus-id') === i && e.getAttribute('data-focus-part') === p; }, [id, part], { timeout: 5000 }).catch(async () => { assert.fail(`focus should be on ${id}:${part}, is on ${await focused(page)}`); }); };
 const handle = (page, id) => page.locator(`[data-focus-id="${id}"][data-focus-part="handle"]`);
 const menuOf = (page, id) => page.locator(`[data-focus-id="${id}"][data-focus-part="menu"]`);
 const pick = async (page, id, action) => { await menuOf(page, id).click(); await page.locator(`[role="menu"] [data-action="${action}"]`).click(); };
 // Radix needs a moment to register a menu's layer; a person never presses Escape within milliseconds of opening one.
 const closeMenu = async page => { await page.waitForTimeout(150); await page.keyboard.press('Escape'); await page.locator('[role="menu"]').waitFor({ state: 'detached' }); };
 const lastPost = async () => (await state()).posts.at(-1);
 const row = (s, id) => s.lessons.find(l => l.id === id) ?? s.chapters.find(c => c.id === id);
 const dragTo = async (page, from, target, side = 'top', { release = true } = {}) => {
  const a = await from.boundingBox(), b = await target.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  const y = side === 'top' ? b.y + 3 : b.y + b.height - 3;
  await page.mouse.move(a.x + a.width / 2, (a.y + y) / 2, { steps: 4 }); await page.mouse.move(a.x + a.width / 2, y, { steps: 6 });
  if (release) await page.mouse.up();
 };
 let probes = 0;

 await step('Middleware: the content endpoint passes; the legacy chapters route and anything else next to it is refused', async () => {
  const get = p => fetch(origin + p, { redirect: 'manual' });
  assert.equal((await get(`/api/teacher/courses/${COURSE}/content`)).status, 200);
  for (const bad of [`/api/teacher/courses/${COURSE}/chapters`, `/api/teacher/courses/${COURSE}/content/x`, `/api/teacher/courses/${COURSE}/lessons`]) assert.equal((await get(bad)).status, 503, bad);
  probes = requests.length;
 });

 await step('Reading: chapter numbers as stored, lessons by order despite gaps, the homework pills, the summary and the line under the list', async () => {
  const { page, context } = await open(desktop); await ready(page);
  assert.deepEqual(await chapters(page), ['Chapter 1 Motion', 'Chapter 2 Energy', 'Chapter 3 Empty for now', 'Chapter 4 Waves']);
  assert.deepEqual(await lessons(page, CH.motion), ['1.1 Speed', '1.2 Velocity', '1.3 Acceleration'], 'positions 0, 3, 7');
  assert.deepEqual(await lessons(page, CH.energy), ['2.1 Work', '2.2 Power']);
  assert.equal((await page.locator('[data-content-summary]').innerText()), '4 chapters · 6 lessons · drag to reorder');
  assert.equal(await page.locator(`[data-lesson="${L.speed}"] [data-lesson-homework="published"]`).innerText(), '1 homework');
  assert.equal(await page.locator(`[data-lesson="${L.velocity}"] [data-lesson-homework="draft"]`).innerText(), 'Draft homework');
  assert.equal(await page.locator(`[data-lesson="${L.acceleration}"] [data-lesson-homework="none"]`).innerText(), 'No homework');
  assert.equal(await page.locator(`[data-lesson="${L.velocity}"] [data-lesson-draft]`).count(), 1); assert.equal(await page.locator(`[data-lesson="${L.speed}"] [data-lesson-draft]`).count(), 0, 'a published lesson has no Draft pill');
  assert.match(await page.locator('[data-content-note]').innerText(), /Videos and files inside a lesson come with the lesson editor/);
  assert.equal(await page.locator(`[data-add-lesson="${CH.empty}"]`).innerText(), 'Add the first lesson'); assert.equal(await page.locator(`[data-add-lesson="${CH.motion}"]`).innerText(), 'Add lesson');
  assert.equal(await page.locator('[data-tour="course-lessons"]').count(), 1);
  await clean(page, 'desktop'); await shot(page, 'desktop-list'); await context.close();
 });

 for (const look of ['classic', 'new']) await step(`Desktop drag (${look}): a lesson and a chapter, with the exact versions read; a line shows the drop; focus stays on the handle; a lesson stays in its chapter`, async () => {
  const { page, context } = await open(tall, { look }); await ready(page); await page.emulateMedia({ reducedMotion: 'reduce' });
  const before = await state();
  await dragTo(page, handle(page, L.acceleration), page.locator(`[data-lesson="${L.speed}"]`), 'top', { release: false });
  assert.equal(await page.locator(`[data-lesson="${L.acceleration}"][data-dragging]`).count(), 1, 'the dragged row is marked');
  assert.equal(await page.locator(`[data-lesson="${L.speed}"][data-drop="before"]`).count(), 1, 'the line shows where it lands');
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'nothing animates');
  assert.equal((await state()).posts.length, 0, 'nothing is sent until the drop');
  await shot(page, `drag-${look}`); await page.mouse.up();
  await page.locator(`[data-chapter="${CH.motion}"] [data-lesson]:first-child[data-lesson="${L.acceleration}"]`).waitFor();
  assert.deepEqual(await lessons(page, CH.motion), ['1.1 Acceleration', '1.2 Speed', '1.3 Velocity']);
  await page.waitForFunction(() => !document.querySelector('[data-dragging]'));
  const post = await lastPost();
  assert.deepEqual(post, { action: 'reorder_lessons', parentId: CH.motion, items: [L.acceleration, L.speed, L.velocity].map(id => ({ id, updated_at: row(before, id).updatedAt })) });
  await waitFocus(page, L.acceleration, 'handle');
  // A chapter, among chapters; the new numbers show.
  const s = await state();
  await dragTo(page, handle(page, CH.waves), page.locator(`[data-chapter="${CH.energy}"]`), 'top');
  await page.waitForFunction(id => document.querySelectorAll('[data-chapter]')[1]?.getAttribute('data-chapter') === id, CH.waves);
  assert.deepEqual(await chapters(page), ['Chapter 1 Motion', 'Chapter 2 Waves', 'Chapter 3 Energy', 'Chapter 4 Empty for now']);
  assert.deepEqual(await lessons(page, CH.waves), ['2.1 Sound'], 'lesson labels follow the chapter'); assert.deepEqual(await lessons(page, CH.energy), ['3.1 Work', '3.2 Power']);
  assert.deepEqual(await lastPost(), { action: 'reorder_modules', items: [CH.motion, CH.waves, CH.energy, CH.empty].map(id => ({ id, updated_at: row(s, id).updatedAt })) });
  await waitFocus(page, CH.waves, 'handle');
  // Over another chapter: still only its own chapter's order.
  const count = (await state()).posts.length;
  await dragTo(page, handle(page, L.acceleration), page.locator(`[data-lesson="${L.power}"]`), 'top');
  await page.waitForFunction(id => document.querySelectorAll('[data-chapter="' + id + '"] [data-lesson]').length === 3 && !document.querySelector('[data-dragging]'), CH.motion);
  await page.waitForFunction(n => document.querySelector('[data-content-live]').textContent.includes('Acceleration'), 0);
  const moved = await lastPost(); assert.equal((await state()).posts.length, count + 1); assert.equal(moved.action, 'reorder_lessons'); assert.equal(moved.parentId, CH.motion, 'never into another chapter by dragging');
  assert.deepEqual(await lessons(page, CH.energy), ['3.1 Work', '3.2 Power']);
  await context.close();
 });

 await step('Desktop drag: Escape cancels and a short press does nothing, with nothing sent; holding near the bottom edge scrolls the page', async () => {
  const { page, context } = await open(tall); await ready(page);
  await dragTo(page, handle(page, L.acceleration), page.locator(`[data-lesson="${L.speed}"]`), 'top', { release: false });
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('[data-dragging]')); await page.mouse.up();
  assert.deepEqual(await lessons(page, CH.motion), ['1.1 Speed', '1.2 Velocity', '1.3 Acceleration']);
  const b = await handle(page, L.speed).boundingBox(); await page.mouse.move(b.x + 5, b.y + 5); await page.mouse.down(); await page.mouse.move(b.x + 5, b.y + 6); await page.mouse.up();
  assert.equal(await page.locator('[data-dragging]').count(), 0); assert.equal((await state()).posts.length, 0, 'nothing was sent');
  await context.close();
  const short = await open({ width: 1440, height: 760 }); await ready(short.page);
  await handle(short.page, L.speed).scrollIntoViewIfNeeded(); const h = await handle(short.page, L.speed).boundingBox();
  await short.page.mouse.move(h.x + 10, h.y + 10); await short.page.mouse.down(); await short.page.mouse.move(h.x + 10, 750, { steps: 5 });
  const top = await short.page.evaluate(() => window.scrollY); await short.page.waitForFunction(y => window.scrollY > y + 40, top);
  await short.page.keyboard.press('Escape'); await short.page.mouse.up(); await short.context.close();
 });

 await step('Keyboard: arrows on the handle and Move up / Move down in the menu, with focus kept; the ends are off; every move sends the versions it now holds', async () => {
  const { page, context } = await open(desktop); await ready(page);
  await handle(page, L.speed).focus(); await page.keyboard.press('ArrowUp'); assert.equal((await state()).posts.length, 0, 'the first row has nowhere up to go');
  await page.keyboard.press('ArrowDown'); await page.waitForFunction(id => document.querySelector('[data-chapter] [data-lesson]')?.getAttribute('data-lesson') !== id, L.speed);
  assert.deepEqual(await lessons(page, CH.motion), ['1.1 Velocity', '1.2 Speed', '1.3 Acceleration']); await waitFocus(page, L.speed, 'handle');
  await page.waitForFunction(() => document.querySelector('[data-content-live]').textContent.length > 0);
  assert.match(await page.locator('[data-content-live]').textContent(), /Speed is now Lesson 1\.2/, 'said out loud');
  await page.keyboard.press('ArrowDown'); await page.waitForFunction(id => document.querySelectorAll('[data-chapter] [data-lesson]')[2]?.getAttribute('data-lesson') === id, L.speed); await waitFocus(page, L.speed, 'handle');
  assert.deepEqual((await state()).invalid, []);
  // The menu, by keyboard alone: Enter opens, the first enabled item is focused, Move up skips nothing here; Move down is off on the last row.
  await menuOf(page, L.speed).focus(); await page.keyboard.press('Enter'); await page.locator('[role="menu"]').waitFor();
  { const down = page.locator('[role="menu"] [data-action="down"]'); assert.equal(await down.getAttribute('aria-disabled'), 'true', 'Move down is off on the last row'); assert.equal(await down.getAttribute('data-disabled'), null, 'reachable, not disabled'); assert.equal((await down.innerText()).replace(/\s+/g, ' ').trim(), 'Move down (already last)', 'the reason is inside the item'); }
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem'); await page.keyboard.press('ArrowDown'); await page.waitForFunction(() => document.activeElement?.getAttribute('data-action') === 'unpublish', null, { timeout: 5000 }); await page.keyboard.press('ArrowDown'); await page.waitForFunction(() => document.activeElement?.getAttribute('data-action') === 'up'); await page.keyboard.press('Enter');
  await page.waitForFunction(id => document.querySelectorAll('[data-chapter] [data-lesson]')[1]?.getAttribute('data-lesson') === id, L.speed);
  await waitFocus(page, L.speed, 'menu');
  assert.deepEqual(await lessons(page, CH.motion), ['1.1 Velocity', '1.2 Speed', '1.3 Acceleration']);
  // A chapter from the menu; the first has no Move up.
  await menuOf(page, CH.motion).click(); const up = page.locator('[role="menu"] [data-action="up"]'); assert.equal(await up.getAttribute('aria-disabled'), 'true'); assert.equal(await up.getAttribute('data-disabled'), null, 'reachable, not disabled'); assert.equal((await up.innerText()).replace(/\s+/g, ' ').trim(), 'Move up (already first)', 'the reason is inside the item'); await page.locator('[role="menu"] [data-action="down"]').click();
  await page.waitForFunction(id => document.querySelector('[data-chapter]')?.getAttribute('data-chapter') !== id, CH.motion); await waitFocus(page, CH.motion, 'menu');
  assert.deepEqual((await chapters(page)).slice(0, 2), ['Chapter 1 Energy', 'Chapter 2 Motion']);
  await context.close();
 });

 await step('Move to another chapter: asks where, says the homework stays, goes last in the target with every version in it, focus on the moved row, cancel changes nothing', async () => {
  const { page, context } = await open(desktop); await ready(page); const s = await state();
  await pick(page, L.speed, 'other'); const dialog = page.locator('[data-content-move]'); await dialog.waitFor();
  assert.match(await dialog.innerText(), /Move "Speed"/); assert.match(await dialog.innerText(), /homework and student progress stay with it/);
  assert.equal(await dialog.locator(`[data-move-target="${CH.motion}"]`).count(), 0, 'not its own chapter'); await shot(page, 'desktop-move');
  await dialog.locator('[data-move-no]').click(); await dialog.waitFor({ state: 'detached' }); await waitFocus(page, L.speed, 'menu'); assert.equal((await state()).posts.length, 0);
  await pick(page, L.speed, 'other'); await dialog.locator(`[data-move-target="${CH.energy}"]`).click(); await dialog.locator('[data-move-yes]').click(); await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(await lastPost(), { action: 'move_lesson', id: L.speed, parentId: CH.energy, updatedAt: row(s, L.speed).updatedAt, items: [L.work, L.power, L.speed].map(id => ({ id, updated_at: row(s, id).updatedAt })) });
  assert.deepEqual(await lessons(page, CH.energy), ['2.1 Work', '2.2 Power', '2.3 Speed']); assert.deepEqual(await lessons(page, CH.motion), ['1.1 Velocity', '1.2 Acceleration'], 'the numbers close up');
  await waitFocus(page, L.speed, 'menu');
  // Into an empty chapter: the list is just this lesson.
  await pick(page, L.velocity, 'other'); await dialog.locator(`[data-move-target="${CH.empty}"]`).click(); await dialog.locator('[data-move-yes]').click(); await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(await lessons(page, CH.empty), ['3.1 Velocity']); assert.equal((await lastPost()).items.length, 1);
  await context.close();
 });

 await step('Add and rename inline: an empty name stays put, Escape cancels, the new or renamed row takes the focus, and Enter submits once', async () => {
  const { page, context } = await open(desktop); await ready(page); const s = await state();
  await page.locator('[data-add-chapter]').click(); const input = page.locator('[data-content-form="add-chapter"] input'); await waitFocus(page, 'add-chapter', 'input');
  await page.keyboard.press('Enter'); await page.getByText('Enter a name.').waitFor(); assert.equal((await state()).posts.length, 0, 'no empty name is sent');
  await page.keyboard.press('Escape'); await waitFocus(page, 'add-chapter', 'button');
  await page.keyboard.press('Enter'); await waitFocus(page, 'add-chapter', 'input'); await input.fill('  Heat  '); await page.keyboard.press('Enter');
  await page.locator('[data-chapter-title]', { hasText: 'Heat' }).waitFor(); assert.deepEqual(await lastPost(), { action: 'create_chapter', title: 'Heat' });
  assert.equal((await chapters(page)).at(-1), 'Chapter 5 Heat'); const heat = (await state()).chapters.at(-1).id; await waitFocus(page, heat, 'menu');
  assert.equal(await page.locator(`[data-add-lesson="${heat}"]`).innerText(), 'Add the first lesson');
  await page.locator(`[data-add-lesson="${heat}"]`).click(); await waitFocus(page, heat, 'input'); await shot(page, 'desktop-add-lesson');
  await page.keyboard.press('Escape'); await waitFocus(page, 'add-lesson-' + heat, 'button');
  await page.keyboard.press('Enter'); await waitFocus(page, heat, 'input'); await page.keyboard.type('Temperature'); await page.locator(`[data-chapter="${heat}"] [data-content-submit]`).click();
  await page.locator('[data-lesson-title]', { hasText: 'Temperature' }).waitFor(); assert.deepEqual(await lastPost(), { action: 'create_lesson', parentId: heat, title: 'Temperature' });
  assert.deepEqual(await lessons(page, heat), ['5.1 Temperature']); await waitFocus(page, (await state()).lessons.at(-1).id, 'menu');
  assert.equal(await page.locator(`[data-add-lesson="${heat}"]`).innerText(), 'Add lesson');
  // Rename a lesson, and a chapter.
  await pick(page, L.power, 'rename'); await waitFocus(page, L.power, 'input'); assert.equal(await page.locator(`[data-lesson="${L.power}"] input`).inputValue(), 'Power');
  await page.keyboard.press('Escape'); await waitFocus(page, L.power, 'menu'); assert.equal((await state()).posts.length, 2, 'cancelling sends nothing');
  await pick(page, L.power, 'rename'); await page.locator(`[data-lesson="${L.power}"] input`).fill('Power and energy'); await page.keyboard.press('Enter');
  await page.locator('[data-lesson-title]', { hasText: 'Power and energy' }).waitFor(); await waitFocus(page, L.power, 'menu');
  assert.deepEqual(await lastPost(), { action: 'rename_lesson', id: L.power, updatedAt: row(s, L.power).updatedAt, title: 'Power and energy' });
  await pick(page, CH.waves, 'rename'); await page.locator(`[data-chapter="${CH.waves}"] [data-content-form] input`).fill('Waves and sound'); await page.keyboard.press('Enter');
  await page.locator('[data-chapter-title]', { hasText: 'Waves and sound' }).waitFor(); await waitFocus(page, CH.waves, 'menu');
  assert.deepEqual(await lastPost(), { action: 'rename_chapter', id: CH.waves, updatedAt: row(s, CH.waves).updatedAt, title: 'Waves and sound' });
  // The same name sends nothing.
  const n = (await state()).posts.length; await pick(page, L.work, 'rename'); await page.keyboard.press('Enter'); await waitFocus(page, L.work, 'menu'); assert.equal((await state()).posts.length, n);
  await context.close();
 });

 await step('Delete: asks first, cancel gives the focus back, then the row goes and the focus moves to its neighbour; a chapter names its lessons and renumbers the rest', async () => {
  const { page, context } = await open(desktop); await ready(page); const s = await state();
  await pick(page, L.acceleration, 'delete'); const ask = page.locator('[data-content-confirm]'); await ask.waitFor();
  assert.match(await ask.innerText(), /Delete "Acceleration"\?/); assert.match(await ask.innerText(), /published, and students will no longer see it/);
  await shot(page, 'desktop-confirm'); await ask.locator('[data-confirm-no]').click(); await ask.waitFor({ state: 'detached' }); await waitFocus(page, L.acceleration, 'menu'); assert.equal((await state()).posts.length, 0);
  await pick(page, L.acceleration, 'delete'); await ask.locator('[data-confirm-yes]').click(); await ask.waitFor({ state: 'detached' });
  assert.deepEqual(await lastPost(), { action: 'delete_lesson', id: L.acceleration, updatedAt: row(s, L.acceleration).updatedAt }); assert.deepEqual(await lessons(page, CH.motion), ['1.1 Speed', '1.2 Velocity']); await waitFocus(page, L.velocity, 'menu');
  await pick(page, CH.waves, 'delete'); await ask.waitFor(); assert.match(await ask.innerText(), /removes the chapter and the 1 lesson inside it/); await ask.locator('[data-confirm-yes]').click(); await ask.waitFor({ state: 'detached' });
  assert.deepEqual(await lastPost(), { action: 'delete_chapter', id: CH.waves, updatedAt: row(s, CH.waves).updatedAt, items: [{ id: L.sound, updated_at: row(s, L.sound).updatedAt }] });
  assert.equal(await page.locator(`[data-chapter="${CH.waves}"]`).count(), 0); await waitFocus(page, CH.empty, 'menu');
  // Empty a course down to nothing: the focus lands on Add chapter.
  await ctl({ emptyCourse: true }); await page.reload(); await page.locator('[data-content-empty]').waitFor(); assert.match(await page.locator('[data-content-empty]').innerText(), /No chapters yet/);
  assert.equal(await page.locator('[data-content-summary]').count(), 0); await clean(page, 'empty'); await context.close();
 });

 await step('Publish and unpublish a lesson: a draft publishes at once with its version; unpublishing asks first and says answers and grades are kept', async () => {
  const { page, context } = await open(desktop); await ready(page);
  await menuOf(page, L.velocity).click(); await page.locator('[role="menu"] [data-action="publish"]').click();
  await page.locator(`[data-lesson="${L.velocity}"] [data-lesson-draft]`).waitFor({ state: 'detached' });
  const sent = (await state()).posts.at(-1); assert.equal(sent.action, 'publish_lesson'); assert.equal(sent.id, L.velocity); assert.match(sent.updatedAt, /\.\d{6}\+00:00$/, 'the exact version read');
  await menuOf(page, L.speed).click(); await page.locator('[role="menu"] [data-action="unpublish"]').click();
  const ask = page.locator('[data-content-unpublish]'); await ask.waitFor();
  assert.match(await ask.innerText(), /Students won't see this lesson or its homework until you publish it again\. Their answers and grades are kept\./);
  const posts = (await state()).posts.length; await ask.locator('[data-unpublish-no]').click(); await ask.waitFor({ state: 'detached' }); assert.equal((await state()).posts.length, posts, 'cancel sends nothing');
  await menuOf(page, L.speed).click(); await page.locator('[role="menu"] [data-action="unpublish"]').click(); await ask.waitFor(); await clean(page, 'unpublish confirm'); await shot(page, 'unpublish-confirm');
  await ask.locator('[data-unpublish-yes]').click(); await ask.waitFor({ state: 'detached' });
  assert.deepEqual(Object.keys((await state()).posts.at(-1)).sort(), ['action', 'id', 'updatedAt']); assert.equal((await state()).posts.at(-1).action, 'unpublish_lesson');
  assert.equal((await state()).lessons.find(l => l.id === L.speed).status, 'draft'); await page.locator(`[data-lesson="${L.speed}"] [data-lesson-draft]`).waitFor();
  await context.close();
 });
 await step('Refused before trying: the menu\'s Delete is off, says why under it, stays reachable, and does nothing; for a lesson and for a chapter', async () => {
  const { page, context } = await open(desktop); await ready(page);
  await menuOf(page, L.speed).click(); const item = page.locator('[role="menu"] [data-action="delete"]'); await item.waitFor();
  assert.equal(await item.getAttribute('aria-disabled'), 'true'); assert.equal(await item.getAttribute('data-disabled'), null, 'the keyboard can reach it');
  const note = page.locator('[data-menu-note="delete"]'); assert.equal(await note.innerText(), 'Students have started its homework, so it stays. This lesson has 1 homework. You can rename or move it.');
  assert.equal(await item.getAttribute('aria-describedby'), await note.getAttribute('id')); await page.screenshot({ path: path.join(shots, 'desktop-delete-off.png') });
  await item.click({ force: true }); assert.equal(await page.locator('[data-content-confirm]').count(), 0, 'no question is asked'); assert.equal(await item.count(), 1, 'the menu stays open'); await closeMenu(page); await waitFocus(page, L.speed, 'menu');
  await menuOf(page, L.work).click(); assert.equal(await note.innerText(), 'This lesson has 2 parts, 3 content items and a cover. You can rename or move it.'); await closeMenu(page);
  await menuOf(page, CH.energy).click(); assert.equal(await note.innerText(), 'Lessons in this chapter have 2 parts, 3 content items and a cover. You can rename or move it.', 'only the lesson that stops it is counted'); await closeMenu(page);
  await menuOf(page, CH.motion).click(); assert.match(await note.innerText(), /^Students have started homework in this chapter, so it stays\. Lessons in this chapter have 2 homework\./); await closeMenu(page);
  assert.equal((await state()).posts.length, 0); await context.close();
 });

 await step('Refused by the server (23503): the row stays, the reasons are in plain words where it happened, and the fresh read turns the menu\'s Delete off', async () => {
  const { page, context } = await open(desktop); await ready(page);
  await ctl({ refuse: { deleteBlockers: ['student_progress', 'content'], contentBlocks: 1, hasCover: true } });
  await pick(page, L.acceleration, 'delete'); await page.locator('[data-confirm-yes]').click();
  const alert = page.locator(`[data-lesson="${L.acceleration}"] [data-failure="refused"]`); await alert.waitFor();
  assert.equal(await alert.innerText(), 'Students have started this lesson, so it stays. This lesson has 1 content item and a cover. You can rename or move it.');
  assert.equal(await alert.getAttribute('role'), 'alert'); assert.equal(await page.locator('[data-content-reload]').count(), 0, 'nothing to reload: the answer is final');
  assert.equal(await page.locator(`[data-lesson="${L.acceleration}"]`).count(), 1); await waitFocus(page, L.acceleration, 'menu'); await shot(page, 'desktop-refused');
  await menuOf(page, L.acceleration).click();
  await page.locator('[role="menu"] [data-action="delete"][aria-disabled="true"]').waitFor(); await closeMenu(page); await context.close();
 });

 await step('Stale: what was typed stays, "This changed somewhere else" offers Reload, and the next save sends the new version', async () => {
  const { page, context } = await open(desktop); await ready(page);
  await pick(page, L.power, 'rename'); const input = page.locator(`[data-lesson="${L.power}"] input`); await input.fill('My long careful title'); await ctl({ touchLesson: L.power });
  const old = (await lastPost()); assert.equal(old, undefined); await page.keyboard.press('Enter');
  const alert = page.locator('[data-failure="changed"]'); await alert.waitFor(); assert.match(await alert.innerText(), /This changed somewhere else\./);
  assert.equal(await input.inputValue(), 'My long careful title', 'nothing typed is lost'); await shot(page, 'desktop-stale');
  const sent = await lastPost(); await alert.locator('[data-content-reload]').click(); await page.waitForFunction(() => !document.querySelector('[data-failure]'));
  assert.equal(await input.inputValue(), 'My long careful title', 'still there after the reload'); assert.equal((await state()).lessons.find(l => l.id === L.power).title, 'Power', 'nothing was overwritten');
  await input.focus(); await page.keyboard.press('Enter'); await page.locator('[data-lesson-title]', { hasText: 'My long careful title' }).waitFor();
  const again = await lastPost(); assert.notEqual(again.updatedAt, sent.updatedAt, 'the reloaded version was sent'); await context.close();
 });

 await step('Stale reorder: the old order comes straight back and is never left on the screen; a row gone elsewhere reads the same way', async () => {
  const { page, context } = await open(desktop); await ready(page);
  await ctl({ touchLesson: L.velocity, delay: 300 }); await handle(page, L.speed).focus(); await page.keyboard.press('ArrowDown');
  await page.waitForFunction(id => document.querySelector('[data-chapter] [data-lesson]')?.getAttribute('data-lesson') !== id, L.speed); // shown at once
  assert.deepEqual(await lessons(page, CH.motion), ['1.1 Velocity', '1.2 Speed', '1.3 Acceleration'], 'optimistic');
  await page.locator('[data-failure="changed"]').waitFor(); assert.deepEqual(await lessons(page, CH.motion), ['1.1 Speed', '1.2 Velocity', '1.3 Acceleration'], 'rejected, so put back'); await waitFocus(page, L.speed, 'handle');
  await page.locator('[data-content-reload]').click(); await page.waitForFunction(() => !document.querySelector('[data-failure]')); await ctl({ delay: 0 });
  await ctl({ removeLesson: L.power }); await pick(page, L.power, 'rename'); await page.locator(`[data-lesson="${L.power}"] input`).fill('Gone'); await page.keyboard.press('Enter');
  await page.locator('[data-failure="changed"]').waitFor(); assert.equal(await page.locator(`[data-lesson="${L.power}"] input`).inputValue(), 'Gone');
  await page.locator('[data-content-reload]').click(); await page.locator(`[data-lesson="${L.power}"]`).waitFor({ state: 'detached' }); await context.close();
 });

 await step('Failures: a server error and a lost reply both put the order back; a lost reply is an unknown outcome with Reload; writes never overlap', async () => {
  const { page, context } = await open(desktop); await ready(page);
  await ctl({ fail: 503 }); await handle(page, L.speed).focus(); await page.keyboard.press('ArrowDown'); await page.locator('[data-failure="failed"]').waitFor();
  assert.deepEqual(await lessons(page, CH.motion), ['1.1 Speed', '1.2 Velocity', '1.3 Acceleration']); assert.match(await page.locator('[data-failure="failed"]').innerText(), /Nothing changed/);
  await ctl({ fail: 'lost' }); await page.keyboard.press('ArrowDown'); await page.locator('[data-failure="unknown"]').waitFor(); assert.deepEqual(await lessons(page, CH.motion), ['1.1 Speed', '1.2 Velocity', '1.3 Acceleration']);
  assert.match(await page.locator('[data-failure="unknown"]').innerText(), /could not confirm whether the change was saved/); assert.equal(await page.locator('[data-content-reload]').count(), 1);
  await ctl({ fail: null }); await page.locator('[data-content-reload]').click(); await page.waitForFunction(() => !document.querySelector('[data-failure]'));
  const n = (await state()).posts.length; await ctl({ delay: 300 }); await handle(page, L.speed).focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => document.querySelector('[data-content-live]').textContent.includes('Speed is now')); assert.equal((await state()).posts.length, n + 1, 'one at a time'); assert.deepEqual((await state()).invalid, []);
  await context.close();
 });

 await step('The read fails on its own: the course page stays, Try again re-reads; a refusal has no retry', async () => {
  await ctl({ read: '503' }); const { page, context } = await open(desktop);
  await page.locator('[data-section="content"] [data-state="error"]').waitFor(); assert.equal((await page.locator('[data-course-title]').innerText()).trim(), 'Synthetic Physics 9'); assert.equal(await page.locator('[data-add-chapter]').count(), 0, 'nothing to edit until it is read');
  await ctl({ read: 'ok' }); await page.locator('[data-section="content"] [data-state="error"] button').click(); await ready(page); assert.equal((await chapters(page)).length, 4); await context.close();
  await ctl({ read: '403' }); const o = await open(desktop); await o.page.locator('[data-section="content"] [data-state="error"]').waitFor(); assert.equal(await o.page.locator('[data-section="content"] [data-state="error"] button').count(), 0); await o.context.close();
 });

 await step('Resizing the window: an open menu survives a height change; typed text survives crossing the phone width, and a menu closed by the crossing leaves the page usable', async () => {
  const { page, context } = await open(desktop); await ready(page);
  await menuOf(page, L.power).click(); await page.locator('[role="menu"]').waitFor();
  await page.setViewportSize({ width: 1440, height: 800 }); await page.waitForTimeout(100); assert.equal(await page.locator('[role="menu"]').count(), 1, 'a height change does not close it');
  await page.setViewportSize({ width: 1300, height: 900 }); await page.waitForTimeout(100); assert.equal(await page.locator('[role="menu"]').count(), 1, 'nor does a width change inside desktop');
  await page.setViewportSize(phone); await page.locator('[role="menu"]').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.body.style.pointerEvents), '', 'the page is not left frozen');
  const toggle = page.locator(`[data-chapter="${CH.energy}"] [data-chapter-toggle]`); await toggle.click(); await toggle.click(); await page.setViewportSize(desktop);
  await pick(page, L.power, 'rename'); const input = page.locator(`[data-lesson="${L.power}"] input`); await input.fill('Half typed');
  await page.setViewportSize(phone); await page.waitForTimeout(100); assert.equal(await input.inputValue(), 'Half typed', 'typed text stays on a phone width');
  await page.setViewportSize(desktop); await page.waitForTimeout(100); assert.equal(await input.inputValue(), 'Half typed', 'and back');
  assert.equal((await state()).posts.length, 0); await context.close();
 });

 const noControls = async page => { for (const s of ['[data-add-chapter]', '[data-drag-handle]', '[data-row-menu]', '[data-add-lesson]', '[data-content-form]']) assert.equal(await section(page).locator(s).count(), 0, s + ' is not offered'); };
 await step('Archived: read-only with a short line saying why, no edit controls, the lessons still readable; both languages', async () => {
  await ctl({ archived: true }); const { page, context } = await open(desktop); await ready(page);
  assert.match(await page.locator('[data-content-readonly="archived"]').innerText(), /This course is archived, so its content cannot be changed\./); await noControls(page);
  assert.deepEqual(await lessons(page, CH.motion), ['1.1 Speed', '1.2 Velocity', '1.3 Acceleration']); assert.doesNotMatch(await page.locator('[data-content-summary]').innerText(), /drag/);
  await clean(page, 'archived'); await shot(page, 'desktop-archived'); await context.close();
  const o = await open(phone, { lang: 'ar' }); await ready(o.page); assert.ok((await o.page.locator('[data-content-readonly="archived"]').innerText()).includes('هذه الدورة مؤرشفة')); await noControls(o.page); await clean(o.page, 'archived ar'); await o.context.close();
 });
 await step('Archived while the page was open: the refused write turns the screen read-only at once, with no stale controls left', async () => {
  const { page, context } = await open(desktop); await ready(page);
  await pick(page, L.power, 'rename'); await page.locator(`[data-lesson="${L.power}"] input`).fill('Too late'); await ctl({ archived: true }); await page.keyboard.press('Enter');
  await page.locator('[data-content-readonly="archived"]').waitFor(); await noControls(page); assert.equal(await page.locator('[data-failure]').count(), 0, 'the line says it; no second message');
  assert.deepEqual(await lessons(page, CH.energy), ['2.1 Work', '2.2 Power']); await context.close();
 });
 await step('Assistant (canEdit false, not archived): read-only with its own line, no edit controls, on a phone too', async () => {
  await ctl({ canEdit: false }); const { page, context } = await open(desktop); await ready(page);
  assert.match(await page.locator('[data-content-readonly="staff"]').innerText(), /You can see this content, but you cannot change it\./); await noControls(page); await clean(page, 'assistant'); await shot(page, 'desktop-assistant'); await context.close();
  const o = await open(phone); await ready(o.page); await noControls(o.page); await clean(o.page, 'assistant phone'); await o.context.close();
  assert.equal((await state()).posts.length, 0);
 });

 for (const look of ['classic', 'new']) await step(`Phone (${look}): no drag, the first chapter open, ⋯ opens a bottom sheet with the same actions, moves keep the focus, Delete off says why`, async () => {
  const { page, context } = await open(phone, { look }); await ready(page);
  assert.equal(await page.locator('[data-drag-handle]').count(), 0, 'no drag on a phone'); assert.doesNotMatch(await page.locator('[data-content-summary]').innerText(), /drag/);
  assert.equal(await page.locator('[data-lesson]').count(), 3, 'only the first chapter is open'); assert.equal(await page.locator(`[data-chapter="${CH.energy}"] [data-chapter-toggle]`).getAttribute('aria-expanded'), 'false');
  await clean(page, 'phone'); await shot(page, `phone-${look}`);
  await page.locator(`[data-chapter="${CH.energy}"] [data-chapter-toggle]`).click(); assert.equal(await page.locator(`[data-chapter="${CH.energy}"] [data-lesson]`).count(), 2);
  // The sheet for a lesson with room to move.
  await menuOf(page, L.acceleration).click(); const sheet = page.locator('[data-content-sheet]'); await sheet.waitFor();
  assert.deepEqual((await sheet.locator('.d-sheet-item').allInnerTexts()).map(x => x.replace(/\s+/g, ' ').trim()), ['Rename', 'Unpublish lesson', 'Move up', 'Move down (already last)', 'Move to another chapter', 'Delete lesson']);
  const headText = await sheet.innerText(); assert.match(headText, /LESSON 1\.3|Lesson 1\.3/i); assert.match(headText, /Acceleration/); assert.match(headText, /Delete asks first\. A lesson whose homework students answered cannot be deleted\./);
  const down = sheet.locator('[data-action="down"]');
  assert.equal(await down.getAttribute('aria-disabled'), 'true', 'the last row has no Move down'); assert.equal(await down.getAttribute('disabled'), null, 'reachable, not the disabled attribute');
  assert.equal((await page.locator('#' + await down.getAttribute('aria-describedby')).innerText()).trim(), '(already last)', 'and it says why, inside the item'); await clean(page, 'phone sheet'); await shot(page, `phone-sheet-${look}`);
  const box = await sheet.boundingBox(); assert.ok(box.y + box.height >= phone.height - 1, 'it sits at the bottom');
  await sheet.locator('[data-action="up"]').click(); await sheet.waitFor({ state: 'detached' });
  await page.waitForFunction(id => document.querySelectorAll('[data-chapter] [data-lesson]')[1]?.getAttribute('data-lesson') === id, L.acceleration);
  assert.deepEqual(await lessons(page, CH.motion), ['1.1 Speed', '1.2 Acceleration', '1.3 Velocity']); await waitFocus(page, L.acceleration, 'menu');
  // Move to another chapter from the sheet.
  await menuOf(page, L.acceleration).click(); await sheet.locator('[data-action="other"]').click(); const move = page.locator('[data-content-move]'); await move.waitFor(); await clean(page, 'phone move'); await move.locator(`[data-move-target="${CH.empty}"]`).click(); await move.locator('[data-move-yes]').click(); await move.waitFor({ state: 'detached' });
  assert.deepEqual(await lessons(page, CH.empty), ['3.1 Acceleration']); await waitFocus(page, L.acceleration, 'menu');
  // Delete off, with the reason in the sheet.
  await menuOf(page, L.speed).click(); await sheet.waitFor(); assert.equal(await sheet.locator('[data-action="delete"]').getAttribute('aria-disabled'), 'true');
  assert.match(await sheet.locator('[data-action-note="delete"]').innerText(), /Students have started its homework/); await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => null)))); await sheet.locator('[data-action="delete"]').click({ force: true }); assert.equal(await sheet.count(), 1, 'nothing happens'); assert.equal(await page.locator('[data-content-confirm]').count(), 0);
  await sheet.locator('[aria-label]').first().click(); await sheet.waitFor({ state: 'detached' }); await waitFocus(page, L.speed, 'menu');
  // Rename and delete from the sheet, and a chapter's sheet.
  await menuOf(page, L.power).click(); await sheet.locator('[data-action="rename"]').click(); await waitFocus(page, L.power, 'input'); await page.locator(`[data-lesson="${L.power}"] input`).fill('Power 2'); await page.keyboard.press('Enter'); await page.locator('[data-lesson-title]', { hasText: 'Power 2' }).waitFor(); await waitFocus(page, L.power, 'menu');
  await menuOf(page, L.power).click(); await sheet.locator('[data-action="delete"]').click(); const ask = page.locator('[data-content-confirm]'); await ask.waitFor(); await clean(page, 'phone confirm'); await ask.locator('[data-confirm-yes]').click(); await ask.waitFor({ state: 'detached' }); await waitFocus(page, L.work, 'menu');
  await menuOf(page, CH.waves).click(); await sheet.waitFor(); assert.deepEqual((await sheet.locator('.d-sheet-item').allInnerTexts()).map(x => x.replace(/\s+/g, ' ').trim()), ['Rename', 'Move up', 'Move down (already last)', 'Delete chapter']); await page.waitForTimeout(150); await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'detached' }); await waitFocus(page, CH.waves, 'menu');
  // Adding on a phone.
  await page.locator('[data-add-chapter]').click(); await waitFocus(page, 'add-chapter', 'input'); await clean(page, 'phone add'); await page.keyboard.press('Escape');
  assert.deepEqual((await state()).invalid, []); await context.close();
 });

 for (const look of ['classic', 'new']) await step(`Arabic and RTL (${look}): every word in Arabic, mirrored, numbers left to right, refusals in the owner's forms, focus kept, drag works the same`, async () => {
  const { page, context } = await open(tall, { lang: 'ar', look }); await ready(page);
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  const text = await section(page).innerText();
  for (const part of ['المحتوى', 'إضافة فصل', 'إضافة درس', 'إضافة أول درس', 'الفصل 1', 'واجب واحد', 'واجب مسودة', 'لا يوجد واجب', 'مسودة', 'لا توجد دروس بعد', '4 فصول', '6 دروس']) assert.ok(text.includes(part), part);
  assert.ok((await page.locator('[data-content-note]').innerText()).includes('ستأتي مقاطع الفيديو والملفات داخل الدرس مع محرر الدروس'));
  assert.doesNotMatch(text, /Chapter|Lesson|homework/, 'no English left');
  const [grip, title] = await Promise.all([handle(page, L.speed).boundingBox(), page.locator(`[data-lesson="${L.speed}"] [data-lesson-title]`).boundingBox()]); assert.ok(grip.x > title.x, 'the handle sits at the start, on the right');
  assert.equal(await page.locator(`[data-lesson="${L.speed}"] [data-lesson-number] bdi`).getAttribute('dir'), 'ltr'); assert.equal((await lessons(page, CH.motion))[0].split(' ')[0], '1.1');
  await menuOf(page, L.work).click(); const note = page.locator('[data-menu-note="delete"]'); assert.equal(await note.innerText(), 'في هذا الدرس جزءان و3 عناصر محتوى وصورة غلاف. يمكنك إعادة تسميته أو نقله.'); assert.equal(await page.locator('[role="menu"] [data-action="rename"]').evaluate(e => getComputedStyle(e).direction), 'rtl', 'the menu reads right to left'); await page.screenshot({ path: path.join(shots, `arabic-menu-${look}.png`) }); await closeMenu(page);
  await dragTo(page, handle(page, L.acceleration), page.locator(`[data-lesson="${L.speed}"]`), 'top'); await page.waitForFunction(id => document.querySelector('[data-chapter] [data-lesson]')?.getAttribute('data-lesson') === id, L.acceleration); await waitFocus(page, L.acceleration, 'handle');
  await ctl({ refuse: { deleteBlockers: ['student_work'] } }); await pick(page, L.acceleration, 'delete'); await page.locator('[data-confirm-yes]').click(); const alert = page.locator('[data-failure="refused"]'); await alert.waitFor(); assert.equal(await alert.innerText(), 'بدأ الطلاب في واجبه، لذا يبقى. يمكنك إعادة تسميته أو نقله.');
  await ctl({ touchLesson: L.power }); await pick(page, L.power, 'rename'); await page.locator(`[data-lesson="${L.power}"] input`).fill('عنوان جديد'); await page.keyboard.press('Enter'); const stale = page.locator('[data-failure="changed"]'); await stale.waitFor(); assert.ok((await stale.innerText()).includes('تغيّر هذا في مكان آخر')); assert.equal(await page.locator(`[data-lesson="${L.power}"] input`).inputValue(), 'عنوان جديد');
  await clean(page, 'arabic desktop'); await shot(page, `arabic-desktop-${look}`); await context.close();
  const o = await open(phone, { lang: 'ar', look }); await ready(o.page); await clean(o.page, 'arabic phone'); await menuOf(o.page, L.speed).click(); const sheet = o.page.locator('[data-content-sheet]'); await sheet.waitFor();
  assert.ok((await sheet.innerText()).includes('حذف الدرس')); assert.ok((await sheet.locator('[data-action-note="delete"]').innerText()).includes('بدأ الطلاب في واجبه')); await clean(o.page, 'arabic sheet'); await shot(o.page, `arabic-phone-sheet-${look}`); await o.context.close();
 });

 if (process.env.LMS_MATRIX) await step('Screen matrix: every look, theme, language and width, measured', async () => {
  const findings = await shootMatrix({ label: 'course-content', open: ({ viewport, lang, theme, look }) => open(viewport, { lang, theme, look }), screens: [
   { name: 'course-content', target: PAGE, ready: '[data-content-note]' },
   { name: 'course-content-menu', target: PAGE, ready: '[data-content-note]', sizes: ['desktop'], act: page => menuOf(page, L.speed).click() },
   { name: 'course-content-sheet', target: PAGE, ready: '[data-content-note]', sizes: ['phone'], act: page => menuOf(page, L.speed).click() },
  ] });
  assert.deepEqual(findings, []);
 });

 await browser.close(); server.close();
 assert.deepEqual(errors, [], 'no uncaught or console errors');
 assert.deepEqual(external, [], 'no external requests');
 const apis = [...new Set(requests.slice(probes).filter(r => /\/api\//.test(r)).map(r => r.replace(/^(\w+) (\/[^?]*).*/, '$1 $2')))].sort();
 assert.deepEqual(apis.filter(r => !/^((GET|POST) \/api\/teacher\/courses\/[0-9a-f-]{36}\/content|GET \/api\/teacher\/academics|GET \/api\/communications|GET \/api\/user\/status)$/.test(r)), [], 'only the content route: ' + apis.join(', '));
 console.log(`Course content browser checks passed: ${results.length} groups (real middleware, real contract and reply mapper, synthetic loopback data, not provider E2E). Screenshots: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
