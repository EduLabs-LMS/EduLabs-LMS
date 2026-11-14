// Student Exams (part 2) in Chromium: the list, an exam from start to hand-in (every kind of question, each answer saved as it is given, a lost
// connection, the deadline, the confirm), the second try, the score and the answer review, in English and Arabic (RTL), phone first. The real
// screens, the REAL middleware in front of every request, the real CSS and fonts. The server is fictional and synthetic (no customer records):
// every request is checked against the real contract and every refusal is worded by the real reply mapper. Not provider acceptance.
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME / LMS_CHROMIUM_EXECUTABLE and a Firebase-mode `npm run build` (fonts). Pictures:
// .local/exams-student-browser/screenshots, copied to docs/design/screenshots/exams-student with LMS_COPY_SHOTS=1.
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/exams-student-browser'), shots = path.join(out, 'screenshots'), docs = path.resolve('docs/design/screenshots/exams-student');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the fonts are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat([require('./harness-css.cjs')()]).join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

class NextResponse { constructor(kind, status, location) { this.kind = kind; this.status = status; this.location = location; this.headers = new Map(); } static next() { return new NextResponse('next', 200); } static json(_b, init) { return new NextResponse('json', init?.status ?? 200); } static redirect(url, status = 307) { return new NextResponse('redirect', status, String(url)); } }
function loadTs(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { module: m, exports: m.exports, URL, Intl, Date, Math, Number, JSON, Array, Set, Map, Object, String, RegExp, require: n => n === 'zod' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const middleware = loadTs('middleware.ts', {
 '@/shared/public-website': loadTs('shared/public-website.ts', { zod: require('zod') }), '@/shared/website-routes': loadTs('shared/website-routes.ts'),
 '@clerk/nextjs/server': { clerkMiddleware: () => () => { throw Error('the legacy handler must not run in Firebase staging'); }, createRouteMatcher: () => () => false },
 '@/shared/auth-config': { isFirebaseStaging: () => true }, 'next/server': { NextResponse },
}).default;
const gate = p => middleware({ nextUrl: new URL('https://platform.example' + p), url: 'https://platform.example' + p }, {});
const hw = loadTs('shared/teacher-homework.ts');
const ex = loadTs('shared/teacher-exams.ts', { '@/shared/teacher-homework': hw });
const st = loadTs('shared/exams-student.ts', { '@/shared/teacher-exams': ex });
const contract = loadTs('shared/contracts/exams-student.ts');

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { StudentExamsList } from '@/frontend/features/student-exams/exam-list';
import { StudentExamScreen } from '@/frontend/features/student-exams/exam-screen';
let lang = 'en'; try { lang = localStorage.getItem('edulabs-lms-language') === 'ar' ? 'ar' : 'en'; } catch {}
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
const id = location.pathname.split('/')[2];
createRoot(document.getElementById('root')).render(<LanguageProvider initialLanguage={lang}><ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
  <main data-student-main className="min-h-screen bg-white p-4 md:p-8">{id ? <StudentExamScreen examId={id} /> : <StudentExamsList load={window.__LIST} />}</main>
</ThemeProvider></LanguageProvider>);
`;

// ---- synthetic data (no customer records)
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const DAY = 86400000, MIN = 60000, NOW = Date.now(), iso = ms => new Date(ms).toISOString();
const E = { open: uuid(301), soon: uuid(302), handed: uuid(303), released: uuid(304), paper: uuid(305), waitingReview: uuid(306), closed: uuid(307) };
const COURSE = { physics: uuid(10), arabic: uuid(11) };
const opt = n => uuid(500 + n);
const Q = { single: uuid(401), many: uuid(402), number: uuid(403), essay: uuid(404) };
const questions = [
 { id: Q.single, type: 'single_choice', text: 'Which is a unit of speed?', points: 1, responseMode: 'text', options: [[1, 'm/s'], [2, 'kg'], [3, 'N'], [4, 'J']], right: [opt(1)] },
 { id: Q.many, type: 'multiple_choice', text: 'Which of these are vectors?', points: 2, responseMode: 'text', options: [[5, 'Velocity'], [6, 'Mass'], [7, 'Force'], [8, 'Time']], right: [opt(5), opt(7)] },
 { id: Q.number, type: 'number', text: 'A car goes 120 m in 8 s. What is its speed in m/s?', points: 2, responseMode: 'text', options: [], value: 15, tolerance: 0.5 },
 { id: Q.essay, type: 'essay', text: 'Explain why a moving car slows down when the engine stops.', points: 4, responseMode: 'both', options: [], model: 'Friction and air resistance act against the motion.' },
];
const wins = { open: [NOW - 10 * MIN, NOW + 2 * 60 * MIN], soon: [NOW + DAY, NOW + DAY + 90 * MIN], past: [NOW - 3 * DAY, NOW - 2 * DAY], later: [NOW - 3 * DAY, NOW + 5 * DAY] };
const window_ = ([a, b]) => ({ opensAt: iso(a), closesAt: iso(b), state: 'ok' });
const def = (id, title, win, over = {}) => ({ id, title, description: over.kind === 'paper' ? '' : 'Bring a calculator. Show your working.', kind: 'online', status: 'published', courseId: COURSE.physics, courseTitle: 'Synthetic Physics 9', offeringId: uuid(20),
 maxMarks: null, heldOn: null, timing: 'per_group', timeLimitMinutes: 45, rule: 'fix_mistakes', photosAllowed: true, questionCount: 4, totalPoints: 9, reviewOpen: false, window: win && window_(win), tries: [], result: null, ...over });
const submittedTry = (n = 1, answers = {}) => ({ id: uuid(600 + n), number: n, status: 'submitted', startedAt: iso(NOW - 2 * DAY), deadlineAt: iso(NOW - 2 * DAY + 45 * MIN), submittedAt: iso(NOW - 2 * DAY + 30 * MIN), autoSubmitted: false, revision: 2, answers });
const goodAnswers = () => ({ [Q.single]: { optionIds: [opt(1)], numberValue: null, text: null, uploadId: null, kept: false, savedAt: iso(NOW - DAY) }, [Q.many]: { optionIds: [opt(5), opt(6)], numberValue: null, text: null, uploadId: null, kept: false, savedAt: iso(NOW - DAY) },
 [Q.number]: { optionIds: null, numberValue: 15.2, text: null, uploadId: null, kept: false, savedAt: iso(NOW - DAY) }, [Q.essay]: { optionIds: null, numberValue: null, text: 'Friction pushes against the car.', uploadId: null, kept: false, savedAt: iso(NOW - DAY) } });
function fresh() {
 const ex_ = {
  [E.open]: def(E.open, 'Motion quiz', wins.open),
  [E.soon]: def(E.soon, 'Energy quiz', wins.soon),
  [E.handed]: def(E.handed, 'Forces warm-up', wins.later, { tries: [submittedTry(1, goodAnswers())], result: { waiting: true } }),
  [E.released]: def(E.released, 'Waves unit test', wins.past, { reviewOpen: true, tries: [submittedTry(1, goodAnswers())], result: { score: 6.5, maxScore: 9, absent: false, releasedAt: iso(NOW - DAY) } }),
  [E.waitingReview]: def(E.waitingReview, 'Heat mid-term', wins.later, { tries: [submittedTry(1, goodAnswers())], result: { score: 7, maxScore: 9, absent: false, releasedAt: iso(NOW - MIN) }, rule: 'one_time' }),
  [E.paper]: def(E.paper, 'Midterm on paper', null, { kind: 'paper', maxMarks: 40, heldOn: '2026-11-10', timing: null, timeLimitMinutes: null, rule: null, questionCount: 0, totalPoints: 0, result: { score: 31, maxScore: 40, absent: false, releasedAt: iso(NOW - DAY) } }),
  [E.closed]: def(E.closed, 'Optics quiz', wins.past, { courseId: COURSE.arabic, courseTitle: 'لغة عربية — الصف التاسع' }),
 };
 return { ex: ex_, posts: [], invalid: [], offline: false, limitMs: null };
}
let S = fresh();
const rowOf = e => ({ id: e.id, title: e.title, kind: e.kind, status: e.status, courseId: e.courseId, courseTitle: e.courseTitle, offeringId: e.offeringId, heldOn: e.heldOn, timeLimitMinutes: e.timeLimitMinutes, tries: e.rule,
 window: e.window, tryState: e.tries.some(t => t.status === 'in_progress') ? 'in_progress' : e.tries.length ? 'submitted' : 'not_started', result: e.result && !('waiting' in e.result) ? { score: e.result.score, maxScore: e.result.maxScore, absent: e.result.absent } : null });
function settleTries(e) {
 for (const t of e.tries) if (t.status === 'in_progress' && Date.parse(t.deadlineAt) <= Date.now()) { Object.assign(t, { status: 'submitted', autoSubmitted: true, submittedAt: t.deadlineAt, revision: t.revision + 1 }); e.result ??= { waiting: true }; }
}
const itemsOf = (e, t) => questions.map((q, i) => {
 const a = t.answers[q.id] ?? null, item = { id: q.id, position: i + 1, type: q.type, text: q.text, imageId: null, points: q.points, responseMode: q.responseMode, options: q.options.map(([n, text]) => ({ id: opt(n), text })), answer: a, mark: null };
 if (e.reviewOpen) Object.assign(item, { correctOptionIds: q.right ?? [], numberValue: q.value ?? null, tolerance: q.tolerance ?? 0, modelText: q.model ?? '', modelImageId: null, mark: t.status === 'submitted' ? { points: q.type === 'essay' ? 3 : i === 0 ? 1 : 1.5, auto: q.type !== 'essay', note: q.type === 'essay' ? 'Name both forces.' : '' } : null });
 return item;
});
function viewOf(e, attemptId) {
 settleTries(e);
 const closed = e.window ? Date.parse(e.window.closesAt) <= Date.now() : true;
 const view = { id: e.id, title: e.title, description: e.description, kind: e.kind, status: e.status, courseId: e.courseId, courseTitle: e.courseTitle, offeringId: e.offeringId, maxMarks: e.maxMarks, heldOn: e.heldOn, timing: e.timing,
  timeLimitMinutes: e.timeLimitMinutes, rule: e.rule, photosAllowed: e.photosAllowed, questionCount: e.questionCount, totalPoints: e.totalPoints, serverNow: iso(Date.now()), lastClose: e.window?.closesAt ?? null, closed, reviewOpen: e.reviewOpen,
  staff: false, window: e.window, tries: e.tries.map(({ answers: _a, ...t }) => t), result: e.result };
 const t = attemptId && e.tries.find(x => x.id === attemptId);
 if (t) { const { answers: _a, ...rest } = t; view.attempt = { ...rest, items: itemsOf(e, t), serverNow: iso(Date.now()) }; }
 return view;
}
const photo = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#fbf8ef"/>' +
 Array.from({ length: 14 }, (_, i) => `<line x1="40" x2="860" y1="${70 + i * 38}" y2="${70 + i * 38}" stroke="#c9d7ea" stroke-width="2"/>`).join('') +
 '<g fill="none" stroke="#1d3a8a" stroke-width="4" stroke-linecap="round"><path d="M90 150 q30 -40 60 0 t60 0 t60 0"/><path d="M120 360 h500"/><path d="M600 340 l20 20 -20 20"/></g>' +
 '<text x="140" y="420" font-size="34" font-family="Arial" fill="#1d3a8a">friction  +  air</text></svg>';
const PHOTO_ID = uuid(9001);

(async () => {
 const stubs = {
  'next/navigation': 'export const usePathname = () => location.pathname; export const useRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() {}, prefetch() {} }); export const useSearchParams = () => new URLSearchParams(location.search);',
  'next/link': 'import React from "react"; export default React.forwardRef(function Link({ href, children, prefetch, ...rest }, ref) { return React.createElement("a", { ...rest, ref, href }, children); });',
  '@/frontend/lib/exam-upload': `export const uploadAnswerPhoto = async (examId, attemptId, file, onProgress) => { onProgress(40); await new Promise(r => setTimeout(r, 50)); onProgress(100); window.__uploads = (window.__uploads || []).concat([[examId, attemptId, file.type, file.size]]); return { id: ${JSON.stringify(PHOTO_ID)} }; }; export const studentPictureUrl = async () => '/__photo.svg'; export const examPictureUrl = studentPictureUrl;`,
 };
 const resolveAlias = p => { for (const c of [p + '.tsx', p + '.ts', path.join(p, 'index.tsx'), path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return p; };
 await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: path.join(out, 'app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_AUTH_MODE': '"firebase"' },
  plugins: [{ name: 'boundary', setup(b) {
   b.onResolve({ filter: /.*/ }, a => { if (stubs[a.path]) return { path: a.path, namespace: 'stub' }; if (a.path.startsWith('@/')) return { path: resolveAlias(path.resolve(a.path.slice(2))) }; });
   b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'jsx', resolveDir: process.cwd() }));
  } }] });

 const apis = [];
 const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
  const body = cb => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => { let b; try { b = JSON.parse(Buffer.concat(parts).toString() || '{}'); } catch { b = undefined; } cb(b); }); };
  const refuse = e => { const r = st.studentReply(e); return send(r.body, r.status); };
  if (url.pathname === '/__app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
  if (url.pathname === '/__style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname === '/__photo.svg') { res.setHeader('Content-Type', 'image/svg+xml'); return res.end(photo); }
  if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
  if (url.pathname === '/__ctl') return body(b => { if (b.reset) S = fresh(); if ('offline' in b) S.offline = b.offline; if ('limitMs' in b) S.limitMs = b.limitMs; send({}); });
  if (url.pathname === '/__state') return send({ posts: S.posts, invalid: S.invalid });
  const decision = gate(url.pathname);
  if (url.pathname.startsWith('/api/')) apis.push(req.method + ' ' + url.pathname.replace(/[0-9a-f-]{36}/g, ':id'));
  if (decision.kind === 'json') return send({ error: 'This legacy workflow is unavailable in Firebase staging.' }, decision.status);
  if (decision.kind === 'redirect') { res.statusCode = 307; res.setHeader('Location', decision.location); return res.end(); }
  if (decision.kind !== 'next') return send({ error: 'harness: middleware said ' + decision.kind }, 500);
  if (url.pathname === '/api/exams' && req.method === 'GET') return url.search ? send({ kind: 'invalid' }, 400) : send({ serverNow: iso(Date.now()), rows: Object.values(S.ex).map(e => { settleTries(e); return rowOf(e); }) });
  const m = url.pathname.match(/^\/api\/exams\/([0-9a-f-]{36})(?:\/(work|upload))?$/);
  if (m) {
   const [, id, action] = m, e = S.ex[id];
   if (!e) return send({ kind: 'denied' }, 403);
   if (!action && req.method === 'GET') {
    const keys = [...url.searchParams.keys()], p = contract.examViewQuery.safeParse(Object.fromEntries(url.searchParams));
    if (!p.success || keys.length !== new Set(keys).size) { S.invalid.push({ path: url.pathname, q: url.search }); return send({ kind: 'invalid' }, 400); }
    return send(viewOf(e, p.data.attempt));
   }
   if (req.method !== 'POST') return send({ kind: 'invalid' }, 405);
   return body(b => {
    if (action === 'upload') { const p = contract.studentUpload.safeParse(b); if (!p.success) { S.invalid.push({ path: url.pathname, b }); return send({ kind: 'invalid' }, 400); } return send({ id: PHOTO_ID, url: '/__photo.svg' }); }
    const p = contract.examStudentWork.safeParse(b);
    if (!p.success) { S.invalid.push({ path: url.pathname, b }); return send({ kind: 'invalid' }, 400); }
    if (S.offline && p.data.action !== 'start' && p.data.action !== 'retry') { req.socket.destroy(); return; }
    S.posts.push({ path: url.pathname, body: p.data });
    settleTries(e); const d = p.data, open = e.window && Date.parse(e.window.opensAt) <= Date.now() && Date.now() < Date.parse(e.window.closesAt);
    const attemptReply = t => { const { answers: _a, ...rest } = t; return send({ ...rest, items: itemsOf(e, t), serverNow: iso(Date.now()) }); };
    const newTry = (n, kept) => { const ms = S.limitMs ?? e.timeLimitMinutes * MIN; const t = { id: uuid(700 + n + e.tries.length), number: n, status: 'in_progress', startedAt: iso(Date.now()), deadlineAt: iso(Math.min(Date.now() + ms, Date.parse(e.window.closesAt))), submittedAt: null, autoSubmitted: false, revision: 1, answers: kept }; e.tries.push(t); e.result = null; return t; };
    if (d.action === 'start') { if (e.tries.length) return refuse({ code: 'PT409', details: '{"reason":"started"}' }); if (!open) return refuse({ code: 'PT409', details: '{"reason":"not_open"}' }); return attemptReply(newTry(1, {})); }
    if (d.action === 'retry') {
     if (e.rule === 'one_time' || e.tries.length !== 1 || e.tries[0].status !== 'submitted') return refuse({ code: 'PT409', details: '{"reason":"no_tries_left"}' });
     if (!open) return refuse({ code: 'PT409', details: '{"reason":"not_open"}' });
     const first = e.tries[0].answers, kept = {};
     if (e.rule === 'fix_mistakes') for (const q of questions) { const a = first[q.id]; const right = q.type === 'single_choice' && a?.optionIds?.length === 1 && a.optionIds[0] === q.right[0]; if (right) kept[q.id] = { ...a, kept: true }; }
     return attemptReply(newTry(2, kept));
    }
    const t = e.tries.find(x => x.id === d.attemptId);
    if (!t) return refuse({ code: '42501' });
    if (t.status !== 'in_progress') return refuse({ code: 'PT409', details: '{"reason":"deadline_passed"}' });
    if (d.revision !== t.revision) return refuse({ code: 'PT409', details: '{"reason":"stale"}' });
    if (d.action === 'submit') { Object.assign(t, { status: 'submitted', submittedAt: iso(Date.now()), revision: t.revision + 1 }); e.result = { waiting: true }; return send({ id: t.id, revision: t.revision }); }
    const q = questions.find(x => x.id === d.questionId);
    if (!q) return refuse({ code: '23514', message: 'Invalid answer' });
    if (t.answers[q.id]?.kept) return refuse({ code: '23514', message: 'This answer is kept from your first try' });
    if (d.optionIds && d.optionIds.some(o => !q.options.some(([n]) => opt(n) === o))) return refuse({ code: '23514', message: 'Invalid choice' });
    const prev = t.answers[q.id] ?? { optionIds: null, numberValue: null, text: null, uploadId: null, kept: false, savedAt: null };
    t.answers[q.id] = { ...prev, ...(d.optionIds ? { optionIds: d.optionIds } : {}), ...(d.numberValue !== undefined ? { numberValue: d.numberValue } : {}), ...(d.text !== undefined ? { text: d.text } : {}), ...(d.uploadId !== undefined ? { uploadId: d.uploadId } : {}), savedAt: iso(Date.now()) };
    return send({ attemptId: t.id, questionId: q.id, savedAt: t.answers[q.id].savedAt, revision: t.revision, deadlineAt: t.deadlineAt });
   });
  }
  if (url.pathname.startsWith('/api/')) return send({ error: 'harness: not served' }, 404);
  const h = decision.headers || new Map();
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); for (const [k, v] of h) res.setHeader(k, v);
  if (!h.has('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  const list = { state: 'ready', data: { serverNow: iso(Date.now()), rows: Object.values(S.ex).map(e => { settleTries(e); return rowOf(e); }) } };
  res.end(`<!doctype html><html lang="en" data-lms-appearance><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Harness</title><link rel="stylesheet" href="/__style.css"><script>window.__LIST = ${JSON.stringify(list)};</script></head><body class="${fontVars} font-sans"><div id="root"></div><script src="/__app.js"></script></body></html>`);
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 const ctl = b => fetch(origin + '/__ctl', { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
 const state = () => fetch(origin + '/__state').then(r => r.json());
 const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
 const errors = [], results = [], external = [], pictures = [];
 const phone = { width: 390, height: 844 }, desktop = { width: 1360, height: 900 };
 const open = async (viewport, target, ready, { lang = 'en', look = 'classic' } = {}) => {
  const context = await browser.newContext({ viewport, locale: lang });
  await context.addInitScript(([l]) => { try { localStorage.setItem('edulabs-lms-language', l); localStorage.setItem('edulabs-lms-appearance', 'light'); } catch {} }, [lang]);
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message.slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', r => { if (r.request().url().startsWith(origin)) return r.continue(); external.push(r.request().url()); return r.abort(); });
  await page.goto(origin + target);
  try { await page.locator(ready).first().waitFor({ timeout: 15000 }); }
  catch (e) { await page.screenshot({ path: path.join(out, 'failed.png'), fullPage: true }); console.log('SHOWN:', (await page.locator('body').innerText()).slice(0, 1500)); throw e; }
  await page.evaluate(l => { document.documentElement.dataset.design = l; }, look);
  return { page, context };
 };
 const only = process.env.LMS_ONLY_STEPS ? new RegExp(process.env.LMS_ONLY_STEPS) : null;
 const step = async (name, fn) => { if (only && !only.test(name)) return; try { await ctl({ reset: true, offline: false, limitMs: null }); await fn(); results.push('PASS ' + name); console.log('PASS', name); } catch (e) { console.log('FAIL', name); throw e; } };
 const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch {} }); r(); }))));
 const shot = async (page, name) => { await settle(page); const file = path.join(shots, name + '.png'); await page.screenshot({ path: file, fullPage: true }); pictures.push(name + '.png'); };
 const overflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
 const SCOPE = '[data-student-main]';
 const tinyTargets = page => page.evaluate(scope => [...document.querySelectorAll(scope)].flatMap(r => [...r.querySelectorAll('a, button, textarea, select, input:not([type="radio"]):not([type="checkbox"]):not([type="file"])')]).filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 43.5 || r.width < 43.5) && !e.closest('[hidden]'); }).map(e => (e.getAttribute('data-tile') || e.textContent || e.tagName).trim().slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)), SCOPE);
 const forbidden = /organi[sz]ation|tenant|\bslug\b|\bmodules?\b|\bofferings?\b|\bblocks?\b|\bsegments?\b|enrol(l)?ment|submission|منظمة|مؤسسة|وحدة|كتل/i;
 const clean = async (page, label) => {
  await settle(page);
  assert.ok(await overflow(page), 'no sideways scroll ' + label);
  assert.deepEqual(await tinyTargets(page), [], '44px targets ' + label);
  const text = await page.evaluate(scope => [...document.querySelectorAll(scope)].map(e => e.innerText).join('\n'), SCOPE);
  assert.doesNotMatch(text, forbidden, 'wording ' + label); assert.doesNotMatch(text, /\bSoon\b|قريبًا/, 'nothing says Soon ' + label);
  assert.doesNotMatch(text, /\b(se|th)\.[a-z_]+\.|undefined|NaN|\[object/, 'no raw keys or broken numbers ' + label);
 };
 // Every screen in four ways: phone English Classic, phone Arabic New, desktop English New, desktop Arabic Classic.
 const WAYS = [[phone, 'en', 'classic', 'phone-en-classic'], [phone, 'ar', 'new', 'phone-ar-new'], [desktop, 'en', 'new', 'desktop-en-new'], [desktop, 'ar', 'classic', 'desktop-ar-classic']];
 const every = async (name, target, ready, prepare) => {
  for (const [viewport, lang, look, tag] of WAYS) {
   const { page, context } = await open(viewport, target, ready, { lang, look });
   try {
    assert.equal(await page.evaluate(() => document.documentElement.dir), lang === 'ar' ? 'rtl' : 'ltr');
    if (prepare) await prepare(page, lang);
    await clean(page, name + ' ' + tag); await shot(page, name + '-' + tag);
   } finally { await context.close(); }
  }
 };
 const savedPosts = async () => (await state()).posts.filter(p => p.body.action === 'save').map(p => p.body);
 const waitSaved = (page, n = 1) => page.waitForFunction(() => document.querySelector('[data-student-exam]')?.getAttribute('data-save-state') === 'saved').then(() => new Promise(r => setTimeout(r, n)));

 await step('The list: open now, coming up with the student\'s own window, handed in, results, closed; a course filter', async () => {
  await every('01-list', '/exams', '[data-student-exams] [data-exam-row]', async page => {
   const sections = await page.locator('[data-section]').evaluateAll(n => n.map(x => x.getAttribute('data-section')));
   assert.deepEqual(sections, ['open', 'upcoming', 'waiting', 'results', 'closed']);
   assert.equal(await page.locator(`[data-exam-row="${E.open}"]`).getAttribute('data-section-of'), 'open');
   assert.equal(await page.locator(`[data-exam-row="${E.paper}"]`).getAttribute('data-section-of'), 'results');
   assert.equal(await page.locator(`[data-exam-row="${E.soon}"]`).getAttribute('data-section-of'), 'upcoming');
   assert.match(await page.locator(`[data-exam-row="${E.released}"] [data-row-line]`).innerText(), /6\.5|٦٫٥/);
  });
  const { page, context } = await open(phone, '/exams', '[data-course-filter]');
  try {
   await page.locator(`[data-course="${COURSE.arabic}"]`).click();
   assert.equal(await page.locator('[data-exam-row]').count(), 1);
   assert.equal(await page.locator(`[data-exam-row="${E.closed}"]`).count(), 1);
  } finally { await context.close(); }
 });

 await step('Starting and taking: every kind of question, each answer saved as it is given, Previous and Next, Arabic digits, one photo, the confirm lists what is left, Handed in', async () => {
  await every('02-overview', `/exams/${E.open}`, '[data-student-exam="overview"] [data-start]');
  const { page, context } = await open(phone, `/exams/${E.open}`, '[data-student-exam="overview"] [data-start]');
  try {
   await page.locator('[data-start]').click();
   await page.locator('[data-student-exam="taking"] [data-question="1"]').waitFor();
   assert.ok(await page.locator('[role="timer"]').count());
   // one choice: picked and saved with the try's revision
   await page.locator(`[data-option="${opt(1)}"]`).click();
   await waitSaved(page);
   const first = (await savedPosts()).at(-1); assert.match(first.attemptId, /^[0-9a-f-]{36}$/); assert.deepEqual(first, { action: 'save', attemptId: first.attemptId, revision: 1, questionId: Q.single, optionIds: [opt(1)] });
   await clean(page, 'taking choice'); await shot(page, '03-taking-choice-phone-en-classic');
   await page.locator('[data-next]').click();
   assert.match(await page.locator('[data-question="2"]').innerText(), /Choose every right answer/);
   await page.locator(`[data-option="${opt(5)}"]`).click(); await page.locator(`[data-option="${opt(7)}"]`).click(); await waitSaved(page);
   assert.deepEqual((await savedPosts()).at(-1).optionIds, [opt(5), opt(7)]);
   await page.locator('[data-next]').click();
   const input = page.locator('[data-number]');
   assert.equal(await input.getAttribute('inputmode'), 'decimal');
   await input.fill('١٥٫٥'); await waitSaved(page, 200);
   assert.equal((await savedPosts()).at(-1).numberValue, 15.5, 'Arabic digits and the Arabic decimal sign are a number');
   await clean(page, 'taking number'); await shot(page, '04-taking-number-phone-en-classic');
   await page.locator('[data-prev]').click(); await page.locator('[data-next]').click();
   assert.equal(await input.inputValue(), '١٥٫٥', 'what was typed stays');
   await page.locator('[data-next]').click();
   // an essay: text and one photo
   await page.locator('[data-text]').fill('Friction with the road and the air slows it.');
   await page.waitForFunction(() => document.querySelector('[data-student-exam]')?.getAttribute('data-save-state') === 'saved');
   await page.locator('[data-photo-input]').setInputFiles({ name: 'answer.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
   await page.locator(`[data-photo-box] [data-picture="${PHOTO_ID}"]`).waitFor();
   await waitSaved(page, 200);
   const essay = (await savedPosts()).at(-1);
   assert.equal(essay.uploadId, PHOTO_ID); assert.equal(essay.questionId, Q.essay);
   assert.ok(await page.locator('[data-photo-remove]').count());
   await clean(page, 'taking essay'); await shot(page, '05-taking-essay-photo-phone-en-classic');
   // the confirm names what is not answered: the second question is answered, question 1..4 all are; clear the number to leave one
   await page.locator('[data-tile="3"]').click(); await input.fill(''); await waitSaved(page, 200);
   assert.equal((await savedPosts()).at(-1).numberValue, null);
   await page.locator('[data-tile="4"]').click();
   await page.locator('[data-hand-in]').click();
   await page.locator('[data-confirm]').waitFor();
   assert.equal(await page.locator('[data-unanswered]').getAttribute('data-unanswered'), '3');
   await clean(page, 'confirm'); await shot(page, '06-hand-in-confirm-phone-en-classic');
   await page.locator('[data-keep-working]').click();
   await page.locator('[data-tile="3"]').click(); await input.fill('15'); await waitSaved(page, 200);
   await page.locator('[data-tile="4"]').click(); await page.locator('[data-hand-in]').click();
   assert.equal(await page.locator('[data-unanswered]').getAttribute('data-unanswered'), '');
   await page.locator('[data-confirm-hand-in]').click();
   await page.locator('[data-student-exam="overview"] [data-handed-in]').waitFor();
   assert.ok(await page.locator('[data-score-waiting]').count(), 'no score until it is released');
   assert.equal(await page.locator('[data-review]').count(), 0, 'no answers while review is closed');
   const submit = (await state()).posts.filter(p => p.body.action === 'submit');
   assert.equal(submit.length, 1); assert.equal(submit[0].body.revision, 1);
   await clean(page, 'handed in'); await shot(page, '07-handed-in-phone-en-classic');
  } finally { await context.close(); }
  assert.deepEqual((await state()).invalid, []);
  // the same in Arabic: RTL, the stored order, Arabic digits
  await ctl({ reset: true });
  const ar = await open(phone, `/exams/${E.open}`, '[data-start]', { lang: 'ar', look: 'new' });
  try {
   await ar.page.locator('[data-start]').click(); await ar.page.locator('[data-question="1"]').waitFor();
   assert.equal(await ar.page.evaluate(() => getComputedStyle(document.querySelector('[data-question]')).direction), 'rtl');
   assert.equal(await ar.page.locator('[data-option]').evaluateAll(n => n.map(x => x.getAttribute('data-option')).join()), [1, 2, 3, 4].map(opt).join(), 'the stored order of the choices');
   await clean(ar.page, 'arabic taking'); await shot(ar.page, '08-taking-choice-phone-ar-new');
   await ar.page.locator('[data-tile="3"]').click(); await clean(ar.page, 'arabic number'); await shot(ar.page, '09-taking-number-phone-ar-new');
   await ar.page.locator('[data-tile="4"]').click(); await clean(ar.page, 'arabic essay'); await shot(ar.page, '10-taking-essay-phone-ar-new');
  } finally { await ar.context.close(); }
 });

 await step('Taking on a desktop: the same screen, both languages', async () => {
  for (const [lang, look, tag] of [['en', 'new', 'desktop-en-new'], ['ar', 'classic', 'desktop-ar-classic']]) {
   await ctl({ reset: true });
   const { page, context } = await open(desktop, `/exams/${E.open}`, '[data-start]', { lang, look });
   try {
    await page.locator('[data-start]').click(); await page.locator('[data-question="1"]').waitFor();
    await page.locator(`[data-option="${opt(2)}"]`).click(); await waitSaved(page);
    await clean(page, 'desktop taking ' + tag); await shot(page, '11-taking-choice-' + tag);
   } finally { await context.close(); }
  }
 });

 await step('A lost connection: the answer stays on screen, the screen says so plainly, it is tried again and saved when the connection is back', async () => {
  const { page, context } = await open(phone, `/exams/${E.open}`, '[data-start]');
  try {
   await page.locator('[data-start]').click(); await page.locator('[data-question="1"]').waitFor();
   await ctl({ offline: true });
   await page.locator(`[data-option="${opt(3)}"]`).click();
   await page.locator('[data-offline]').waitFor({ timeout: 10000 });
   assert.equal(await page.locator(`[data-option="${opt(3)}"]`).getAttribute('data-picked'), '', 'the answer stays on screen');
   assert.equal(await page.locator('[data-student-exam]').getAttribute('data-save-state'), 'offline');
   await clean(page, 'offline'); await shot(page, '12-lost-connection-phone-en-classic');
   // handing in with unsaved answers is held back and says why
   await page.locator('[data-hand-in-link]').click(); await page.locator('[data-confirm-hand-in]').click();
   await page.locator('[data-unsaved-block]').waitFor({ timeout: 10000 });
   assert.equal((await state()).posts.filter(p => p.body.action === 'submit').length, 0);
   await page.locator('[data-keep-working]').click();
   await ctl({ offline: false });
   await page.waitForFunction(() => document.querySelector('[data-student-exam]')?.getAttribute('data-save-state') === 'saved', null, { timeout: 15000 });
   assert.deepEqual((await savedPosts()).at(-1).optionIds, [opt(3)], 'saved once the connection is back');
   assert.equal(await page.locator('[data-offline]').count(), 0);
  } finally { await context.close(); }
  await ctl({ reset: true });
  const ar = await open(phone, `/exams/${E.open}`, '[data-start]', { lang: 'ar', look: 'new' });
  try {
   await ar.page.locator('[data-start]').click(); await ar.page.locator('[data-question="1"]').waitFor();
   await ctl({ offline: true }); await ar.page.locator(`[data-option="${opt(1)}"]`).click(); await ar.page.locator('[data-offline]').waitFor({ timeout: 10000 });
   await clean(ar.page, 'arabic offline'); await shot(ar.page, '13-lost-connection-phone-ar-new');
  } finally { await ar.context.close(); await ctl({ offline: false }); }
 });

 await step('The deadline: the server\'s clock runs the countdown, at zero the screen says so and the hand-in the server made wins', async () => {
  await ctl({ limitMs: 4500 });
  const { page, context } = await open(phone, `/exams/${E.open}`, '[data-start]');
  try {
   await page.locator('[data-start]').click(); await page.locator('[data-question="1"]').waitFor();
   const left = Number(await page.locator('[role="timer"]').getAttribute('data-timer'));
   assert.ok(left >= 1 && left <= 5, 'timer ' + left);
   await page.locator(`[data-option="${opt(1)}"]`).click(); await waitSaved(page, 100);
   await page.locator('[data-student-exam="overview"] [data-handed-in]').waitFor({ timeout: 20000 });
   assert.ok(await page.locator('[data-auto-handed]').count(), 'the screen says the time ran out');
   assert.equal((await state()).posts.filter(p => p.body.action === 'submit').length, 0, 'the server handed it in, not the client');
   await clean(page, 'time is up'); await shot(page, '14-time-is-up-phone-en-classic');
  } finally { await context.close(); }
  await ctl({ reset: true, limitMs: 4500 });
  const ar = await open(phone, `/exams/${E.open}`, '[data-start]', { lang: 'ar', look: 'new' });
  try {
   await ar.page.locator('[data-start]').click(); await ar.page.locator('[data-question="1"]').waitFor();
   await ar.page.locator('[data-student-exam="overview"] [data-auto-handed]').waitFor({ timeout: 20000 });
   await clean(ar.page, 'arabic time is up'); await shot(ar.page, '15-time-is-up-phone-ar-new');
  } finally { await ar.context.close(); }
 });

 await step('The second try: offered inside the window, the right answer kept, from zero when the rule says so, never a third', async () => {
  const { page, context } = await open(phone, `/exams/${E.handed}`, '[data-retry]');
  try {
   assert.ok(await page.locator('[data-handed-in]').count());
   await clean(page, 'retry offer'); await shot(page, '16-second-try-offer-phone-en-classic');
   await page.locator('[data-retry]').click(); await page.locator('[data-student-exam="taking"] [data-question="1"]').waitFor();
   assert.ok(await page.locator('[data-kept]').count(), 'the right answer from the first try is kept');
   assert.equal(await page.locator(`[data-option="${opt(1)}"] input`).isDisabled(), true, 'a kept answer cannot change');
   await page.locator('[data-next]').click();
   assert.equal(await page.locator('[data-kept]').count(), 0, 'a wrong one is open again');
   await page.locator(`[data-option="${opt(7)}"]`).click(); await waitSaved(page);
   await clean(page, 'second try'); await shot(page, '17-second-try-phone-en-classic');
   await page.locator('[data-hand-in-link]').click(); await page.locator('[data-confirm-hand-in]').click();
   await page.locator('[data-student-exam="overview"] [data-handed-in]').waitFor();
   assert.equal(await page.locator('[data-retry]').count(), 0, 'never a third try');
  } finally { await context.close(); }
  await ctl({ reset: true });
  const ar = await open(phone, `/exams/${E.handed}`, '[data-retry]', { lang: 'ar', look: 'new' });
  try { await clean(ar.page, 'arabic retry offer'); await shot(ar.page, '18-second-try-offer-phone-ar-new'); } finally { await ar.context.close(); }
  const closed = await open(phone, `/exams/${E.closed}`, '[data-closed-note]');
  try { assert.equal(await closed.page.locator('[data-start]').count(), 0, 'no Start after the window'); assert.equal(await closed.page.locator('[data-retry]').count(), 0); } finally { await closed.context.close(); }
 });

 await step('Results and review: the score once released, the answer review (right answers, model answer, the marker\'s note) only when review is open', async () => {
  await every('19-results', `/exams/${E.released}`, '[data-score]', async page => { assert.ok(await page.locator('[data-review]').count()); });
  const { page, context } = await open(phone, `/exams/${E.released}`, '[data-review]');
  try {
   await page.locator('[data-review]').click(); await page.locator('[data-student-exam="review"]').waitFor();
   assert.ok(await page.locator(`[data-review-item="2"] [data-option="${opt(5)}"][data-right]`).count(), 'a right answer is shown');
   assert.ok(await page.locator(`[data-review-item="2"] [data-option="${opt(6)}"][data-picked]:not([data-right])`).count(), 'a wrong pick is shown');
   assert.ok(await page.locator('[data-review-item="3"] [data-number-review]').count());
   assert.ok(await page.locator('[data-review-item="4"] [data-model]').count(), 'the model answer');
   assert.match(await page.locator('[data-note]').first().innerText(), /Name both forces/);
   await clean(page, 'review'); await shot(page, '20-review-phone-en-classic');
  } finally { await context.close(); }
  for (const [viewport, lang, look, tag] of [WAYS[1], WAYS[2], WAYS[3]]) {
   const o = await open(viewport, `/exams/${E.released}`, '[data-review]', { lang, look });
   try { await o.page.locator('[data-review]').click(); await o.page.locator('[data-student-exam="review"]').waitFor(); await clean(o.page, 'review ' + tag); await shot(o.page, '20-review-' + tag); } finally { await o.context.close(); }
  }
  // review closed: a score may be out while the window is still open for others, but no answers
  const closedReview = await open(phone, `/exams/${E.waitingReview}`, '[data-score]');
  try { assert.equal(await closedReview.page.locator('[data-review]').count(), 0); assert.ok(await closedReview.page.locator('[data-review-later]').count()); await clean(closedReview.page, 'review later'); } finally { await closedReview.context.close(); }
  // paper: the mark once released
  await every('21-paper', `/exams/${E.paper}`, '[data-score]', async page => { assert.equal(await page.locator('[data-start]').count(), 0); assert.match(await page.locator('[data-score]').innerText(), /31|٣١/); });
 });

 await step('Only the student Exams routes were called; nothing outside; no page errors', async () => {
  const allowed = /^(GET \/api\/exams(\/:id)?|POST \/api\/exams\/:id\/(work|upload))$/;
  assert.deepEqual([...new Set(apis)].filter(r => !allowed.test(r)), [], 'routes: ' + [...new Set(apis)].join(', '));
  assert.deepEqual(external, [], 'nothing left the machine'); assert.deepEqual(errors, [], 'no page errors');
 });
 await browser.close(); server.close();
 fs.writeFileSync(path.join(out, 'results.txt'), results.join('\n') + '\n');
 if (process.env.LMS_COPY_SHOTS) {
  fs.mkdirSync(docs, { recursive: true });
  for (const f of fs.readdirSync(docs)) if (f.endsWith('.png')) fs.unlinkSync(path.join(docs, f));
  for (const f of pictures) fs.copyFileSync(path.join(shots, f), path.join(docs, f));
 }
 console.log(`${results.length} steps passed, ${pictures.length} pictures`);
})().catch(e => { console.error(e); process.exit(1); });
