// The teacher Homework screens in Chromium: the real Homework page, wizard and teacher frame, the REAL middleware in front of every request,
// the real built CSS and fonts. The server is fictional and synthetic (demo-seed-like: questions-only homework, photo rows without files),
// but every request is checked against the real contract and every refusal is worded by the real reply mapper. Not provider acceptance.
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME / LMS_CHROMIUM_EXECUTABLE and a Firebase-mode `npm run build` (CSS, fonts); LMS_FRESH_CSS
// recompiles Tailwind. Pictures: .local/teacher-homework-browser/screenshots, copied to docs/design/screenshots/homework-ui with LMS_COPY_SHOTS=1
// (the move-* ones to docs/design/screenshots/homework-move; LMS_COPY_SHOTS=move copies only those).
const { shootMatrix } = require('./screen-matrix.cjs');
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/teacher-homework-browser'), shots = path.join(out, 'screenshots'), docs = path.resolve('docs/design/screenshots/homework-ui'), moveDocs = path.resolve('docs/design/screenshots/homework-move');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the real CSS and fonts are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat([require('./harness-css.cjs')()]).join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

class NextResponse { constructor(kind, status, location) { this.kind = kind; this.status = status; this.location = location; this.headers = new Map(); } static next() { return new NextResponse('next', 200); } static json(_, o) { return new NextResponse('json', o.status); } static redirect(u) { return new NextResponse('redirect', 307, String(u)); } }
function loadTs(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { module: m, exports: m.exports, URL, Intl, Date, Math, Number, JSON, Array, Set, Map, Object, String, require: n => n === 'zod' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const middleware = loadTs('middleware.ts', {
 '@/shared/public-website': loadTs('shared/public-website.ts', { zod: require('zod') }), '@/shared/website-routes': loadTs('shared/website-routes.ts'),
 '@clerk/nextjs/server': { clerkMiddleware: () => () => { throw Error('the legacy handler must not run in Firebase staging'); }, createRouteMatcher: () => () => false },
 '@/shared/auth-config': { isFirebaseStaging: () => true }, 'next/server': { NextResponse },
}).default;
const gate = p => middleware({ nextUrl: new URL('https://platform.example' + p), url: 'https://platform.example' + p }, {});
const hw = loadTs('shared/teacher-homework.ts');
const contract = loadTs('shared/contracts/teacher-homework.ts');
const { contentEdit } = loadTs('shared/contracts/course-content.ts');

const entry = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { TeacherFrame } from '@/frontend/features/teacher-frame/teacher-frame';
import { TeacherHomeworkPage } from '@/frontend/features/teacher-homework/homework-page';
import { HomeworkWizard } from '@/frontend/features/teacher-homework/homework-wizard';
let lang = 'en'; try { lang = localStorage.getItem('edulabs-lms-language') === 'ar' ? 'ar' : 'en'; } catch {}
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
const id = location.pathname.split('/')[3] || null;
function Page() {
  const [load, setLoad] = useState(null);
  useEffect(() => { fetch('/__load').then(r => r.json()).then(setLoad); }, []);
  if (!load) return null;
  if (!id) return <TeacherHomeworkPage load={load} />;
  return <HomeworkWizard key={id} load={load} homeworkId={id === 'new' ? null : id} initialCourse={new URLSearchParams(location.search).get('course')} />;
}
createRoot(document.getElementById('root')).render(<LanguageProvider initialLanguage={lang}><ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange><TeacherFrame><Page /></TeacherFrame></ThemeProvider></LanguageProvider>);
`;

// ---- synthetic data (no customer records): two courses, one run each; homework like the demo seed's questions-only ones
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const C = { physics: uuid(10), arabic: uuid(11) }, OFF = { physics: uuid(20), arabic: uuid(21) };
const CH = { motion: uuid(101), energy: uuid(102) }, LS = { speed: uuid(201), velocity: uuid(202), work: uuid(203) };
const H = { open: uuid(301), late: uuid(302), closed: uuid(303), draft: uuid(304), started: uuid(305), arabic: uuid(306) };
const DAY = 86400000, NOW = Date.now(), iso = ms => new Date(ms).toISOString();
const cairoAt = (days, time) => hw.cairoIso(hw.cairoFields(iso(NOW + days * DAY)).date, time);
const load = { state: 'ready', courses: [
 { id: C.physics, spaceId: 'synthetic-space', title: 'Synthetic Physics 9', status: 'published', canEdit: true, offerings: [{ id: OFF.physics, name: 'Synthetic run', canManage: true }] },
 { id: C.arabic, spaceId: 'synthetic-space', title: 'لغة عربية — الصف التاسع', status: 'published', canEdit: true, offerings: [{ id: OFF.arabic, name: 'Synthetic run', canManage: true }] },
] };
let tick = 0; const stamp = () => `2026-11-06T10:00:${String(++tick % 60).padStart(2, '0')}.${String(100000 + tick)}+00:00`;
const structure = () => ({ archived: false, canEdit: true,
 chapters: [{ id: CH.motion, title: 'Motion', type: 'chapter', number: 1, position: 0, updatedAt: S.stamps.motion }, { id: CH.energy, title: 'Energy', type: 'chapter', number: 2, position: 1, updatedAt: S.stamps.energy }],
 lessons: [
  { id: LS.speed, chapterId: CH.motion, title: 'Speed', position: 0, status: 'published', updatedAt: S.stamps.speed, homework: 3, draftHomework: 0, deleteBlockers: [], contentBlocks: 0, hasCover: false, parts: 0 },
  { id: LS.velocity, chapterId: CH.motion, title: 'Velocity', position: 1, status: S.velocity, updatedAt: S.stamps.velocity, homework: 0, draftHomework: 1, deleteBlockers: [], contentBlocks: 0, hasCover: false, parts: 0 },
  { id: LS.work, chapterId: CH.energy, title: 'Work', position: 0, status: 'published', updatedAt: S.stamps.work, homework: 1, draftHomework: 0, deleteBlockers: [], contentBlocks: 0, hasCover: false, parts: 0 },
 ] });
const question = (n, type, extra = {}) => ({ id: uuid(400 + n), type, text: type === 'essay' ? 'Explain why a moving car slows down when the engine stops.' : '', imageId: null, points: type === 'essay' ? 4 : 1, responseMode: type === 'essay' ? 'both' : 'text', modelAnswer: '',
 options: type === 'essay' ? [] : ['A', 'B', 'C', 'D'].map((_, i) => ({ id: uuid(500 + n * 10 + i), text: '' })), correctIds: type === 'essay' ? [] : [uuid(500 + n * 10 + 1)], ...extra });
const definition = (title, published, rules) => ({ title, instructions: 'Answer in your own words. Show your working.', mode: 'PLATFORM_QUESTIONS', published, usesMarks: true, filePoints: 0, modelAnswer: 'Friction and air resistance act against the motion.', solutionVideo: '', solutionVideoId: null, referenceIds: [], solutionIds: [],
 questions: [question(1, 'single_choice'), question(2, 'single_choice', { text: 'Which is a unit of speed?', options: [{ id: uuid(521), text: 'm/s' }, { id: uuid(522), text: 'kg' }, { id: uuid(523), text: 'N' }], correctIds: [uuid(521)] }), question(3, 'essay')],
 rules: { deadline: null, lateAllowed: false, tries: 'one_time', maxTries: 1, solutionsOpen: 'after_hand_in', photosAllowed: true, ...rules } });
const row = (id, title, course, lesson, lessonTitle, extra) => ({ id, title, courseId: C[course], courseTitle: load.courses.find(c => c.id === C[course]).title, offeringId: OFF[course], lessonId: lesson, lessonTitle, version: 1, workflow: 'questions', mode: 'PLATFORM_QUESTIONS',
 status: 'published', deadline: null, lateAllowed: false, tries: 'one_time', maxTries: 1, solutionsOpen: 'after_hand_in', photosAllowed: true, updatedAt: stamp(), handedIn: 0, total: 12, late: 0, waiting: 0, imageBytes: 0, ...extra });
function fresh() {
 tick = 0;
 const S = { stamps: { motion: stamp(), energy: stamp(), speed: stamp(), velocity: stamp(), work: stamp() }, velocity: 'draft', portal: 'ok', stale: false, moveRace: false, posts: [], invalid: [], homework: {} };
 const add = (r, def, locked = false) => { r.questionCount = def.questions.length; r.totalMarks = def.questions.reduce((n, q) => n + q.points, 0); S.homework[r.id] = { row: r, view: { id: r.id, offeringId: r.offeringId, lessonId: r.lessonId, segmentId: null, revision: 3, version: r.version, locked, staff: true, canManage: true, workflow: 'questions', deadline: r.deadline, definition: def, courseId: r.courseId } }; };
 add(row(H.open, 'Speed and distance', 'physics', LS.speed, 'Speed', { deadline: cairoAt(2, '23:59'), handedIn: 7, waiting: 3 }), definition('Speed and distance', true, { deadline: cairoAt(2, '23:59') }), true);
 add(row(H.started, 'Forces around us: friction, gravity and the long list of everyday examples', 'physics', LS.work, 'Work', { deadline: cairoAt(5, '18:00'), tries: 'fix_mistakes', maxTries: 3, lateAllowed: true, handedIn: 2, waiting: 1 }), definition('Forces around us', true, { deadline: cairoAt(5, '18:00'), tries: 'fix_mistakes', maxTries: 3, lateAllowed: true }), true);
 add(row(H.arabic, 'واجب القراءة الأول', 'arabic', LS.speed, 'Speed', { deadline: cairoAt(1, '20:00'), handedIn: 10, total: 10 }), definition('واجب القراءة الأول', true, { deadline: cairoAt(1, '20:00') }), true);
 add(row(H.closed, 'Units and measurement', 'physics', LS.speed, 'Speed', { deadline: cairoAt(-6, '23:59'), handedIn: 11, late: 2, imageBytes: 1468006 }), definition('Units and measurement', true, { deadline: cairoAt(-6, '23:59') }), true);
 add(row(H.late, 'Average speed', 'physics', LS.speed, 'Speed', { deadline: cairoAt(-2, '12:00'), lateAllowed: true, handedIn: 9, late: 1, imageBytes: 0 }), definition('Average speed', true, { deadline: cairoAt(-2, '12:00'), lateAllowed: true }), true);
 add(row(H.draft, 'Velocity practice', 'physics', LS.velocity, 'Velocity', { status: 'draft', handedIn: null, total: null, deadline: cairoAt(7, '23:59') }), definition('Velocity practice', false, { deadline: cairoAt(7, '23:59') }));
 return S;
}
let S = fresh();
const tabOf = r => r.status === 'draft' ? 'drafts' : Date.parse(r.deadline) > Date.now() ? 'open' : 'closed';
function portal(q) {
 const all = Object.values(S.homework).map(h => h.row).filter(r => !q.course || r.courseId === q.course);
 const counts = { open: 0, closed: 0, drafts: 0 }; for (const r of all) counts[tabOf(r)]++;
 const rows = all.filter(r => tabOf(r) === q.tab).sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
 // Saturday 00:00 in Cairo, from Cairo's own date (a UTC weekday is a different day around midnight).
 const today = hw.cairoToday(Date.now()), back = (new Date(today + 'T12:00:00Z').getUTCDay() + 1) % 7;
 const week = hw.cairoIso(new Date(Date.parse(today + 'T12:00:00Z') - back * DAY).toISOString().slice(0, 10), '00:00');
 return { tab: q.tab, page: q.page, pageSize: 25, serverNow: iso(Date.now()), counts, rows: rows.slice(q.page * 25, q.page * 25 + 25),
  stats: { weekStart: week, weekEnd: iso(Date.parse(week) + 7 * DAY), essaysWaiting: S.portal === 'empty' ? 0 : 4, correctedThisWeek: S.portal === 'empty' ? 0 : 6, handedInThisWeek: S.portal === 'empty' ? 0 : 19, onTimePercent: S.portal === 'empty' ? null : 84 },
  toCorrect: S.portal === 'empty' ? [] : all.filter(r => r.waiting).map(r => ({ ...r })) };
}

(async () => {
 const stubs = {
  '@/frontend/components/providers/use-loading-router': 'export const useLoadingRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() {}, prefetch() {} });',
  'next/navigation': 'export const usePathname = () => location.pathname; export const useRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() {}, prefetch() {} }); export const useSearchParams = () => new URLSearchParams(location.search);',
  'next/image': 'import React from "react"; export default function Image({ unoptimized, fill, priority, ...p }) { return React.createElement("img", p); }',
  'next/link': 'import React from "react"; export default React.forwardRef(function Link({ href, children, onClick, prefetch, ...rest }, ref) { return React.createElement("a", { ...rest, ref, href, onClick: e => { onClick && onClick(e); if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); location.assign(href); } }, children); });',
  '@/frontend/components/providers/application-auth-provider': 'export const useApplicationAuth = () => ({ user: { fullName: "Synthetic Teacher", email: "synthetic.teacher@example.test", imageUrl: null, id: "u" }, signOut: async () => {} }); export const useWebsiteNavigation = () => ({ viewer: { id: "v", displayName: "Synthetic Viewer" }, organizations: [{ id: "00000000-0000-4000-8000-000000000050", name: "Synthetic space" }], staffOrganizationIds: ["00000000-0000-4000-8000-000000000050"] }); export const WebsiteNavigationProvider = ({ children }) => children;',
  '@/frontend/components/providers/v2-identity': 'import React from "react"; export const useUser = () => ({ user: { fullName: "Synthetic Teacher" } }); export const useClerk = () => ({ signOut() {} }); export const UserButton = () => React.createElement("span", { className: "h-9 w-9 rounded-full" });',
 };
 const resolveAlias = p => { for (const c of [p + '.tsx', p + '.ts', path.join(p, 'index.tsx'), path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return p; };
 await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: path.join(out, 'app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_AUTH_BACKEND': '"firebase-staging"' }, banner: { js: 'var process = { env: {} };' },
  plugins: [{ name: 'boundary', setup(b) {
   b.onResolve({ filter: /.*/ }, a => { if (stubs[a.path]) return { path: a.path, namespace: 'stub' }; if (a.path.startsWith('@/')) return { path: resolveAlias(path.resolve(a.path.slice(2))) }; });
   b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'jsx', resolveDir: process.cwd() }));
  } }] });

 const requests = [];
 const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
  const body = cb => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => { let b = null; try { b = JSON.parse(Buffer.concat(parts).toString() || '{}'); } catch { b = undefined; } cb(b); }); };
  if (url.pathname === '/__app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
  if (url.pathname === '/__style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
  if (url.pathname === '/__ctl') return body(b => { if (b.reset) S = fresh(); for (const k of ['portal', 'stale', 'moveRace']) if (k in b) S[k] = b[k]; send({}); });
  if (url.pathname === '/__state') return send({ posts: S.posts, invalid: S.invalid, velocity: S.velocity });
  if (url.pathname === '/__load') return send(load);
  requests.push(req.method + ' ' + url.pathname);
  const decision = gate(url.pathname);
  if (decision.kind === 'json') return send({ error: 'This legacy workflow is unavailable in Firebase staging.' }, decision.status);
  if (decision.kind === 'redirect') { res.statusCode = 307; res.setHeader('Location', decision.location); return res.end(); }
  if (decision.kind !== 'next') return send({ error: 'harness: middleware said ' + decision.kind }, 500);
  const api = url.pathname.match(/^\/api\/teacher\/homework(?:\/([^/]+)(?:\/([a-z-]+))?)?$/);
  if (api && req.method === 'GET' && !api[1]) {
   if (S.portal === '503') return send({ kind: 'failed' }, 503);
   if (S.portal === '401') return send({ kind: 'signin' }, 401);
   const keys = [...url.searchParams.keys()], q = contract.portalQuery.safeParse(Object.fromEntries(url.searchParams));
   if (!q.success || keys.length !== new Set(keys).size) { S.invalid.push(url.search); return send({ kind: 'invalid' }, 400); }
   if (S.portal === 'empty') S.homework = {};
   return send(portal(q.data));
  }
  if (api && req.method === 'GET' && api[1] && !api[2]) { const h = S.homework[api[1]]; return h ? send(h.view) : send({ kind: 'denied' }, 404); }
  if (api && req.method === 'POST') return body(b => {
   S.posts.push({ path: url.pathname, body: b });
   const id = api[1], action = api[2], h = S.homework[id];
   if (action === 'save') {
    const parsed = contract.homeworkSave.safeParse(b);
    if (!parsed.success || (id === 'new') !== (b.revision === null)) { S.invalid.push(b); return send({ kind: 'invalid' }, 400); }
    if (S.stale) { const r = hw.homeworkReply({ code: 'PT409', message: 'Homework changed. Reload it.' }); return send(r.body, r.status); }
    if (h && h.view.revision !== b.revision) { const r = hw.homeworkReply({ code: 'PT409', message: 'Homework changed. Reload it.' }); return send(r.body, r.status); }
    // A move (another lesson or course): refused once a student started (or one starts meanwhile: moveRace) and for a later version, as save_homework does.
    const moving = h && (b.offeringId !== h.view.offeringId || b.lessonId !== h.view.lessonId);
    if (moving && (h.view.locked || S.moveRace)) { const r = hw.homeworkReply({ code: 'PT409', message: 'Work has started; this homework stays in its lesson', details: '{"reason":"started"}' }); return send(r.body, r.status); }
    if (moving && h.view.version > 1) { const r = hw.homeworkReply({ code: 'PT409', message: 'A later version stays in its lesson', details: '{"reason":"versioned"}' }); return send(r.body, r.status); }
    if (h?.view.locked) { const r = hw.homeworkReply({ code: 'PT409', message: 'Work has started; clone a new version' }); return send(r.body, r.status); }
    if (moving) { const course = b.offeringId === OFF.arabic ? 'arabic' : 'physics'; h.view = { ...h.view, offeringId: b.offeringId, lessonId: b.lessonId, courseId: C[course] }; h.row = { ...h.row, offeringId: b.offeringId, lessonId: b.lessonId, courseId: C[course], courseTitle: load.courses.find(c => c.id === C[course]).title }; }
    const target = h ?? (S.homework[uuid(390 + Object.keys(S.homework).length)] = { row: row(uuid(390 + Object.keys(S.homework).length), b.definition.title, b.offeringId === OFF.arabic ? 'arabic' : 'physics', b.lessonId, 'Lesson', { status: 'draft' }), view: { id: uuid(390 + Object.keys(S.homework).length), offeringId: b.offeringId, lessonId: b.lessonId, segmentId: null, revision: 0, version: 1, locked: false, staff: true, canManage: true, workflow: 'questions', deadline: null } });
    target.view = { ...target.view, revision: target.view.revision + 1, definition: parsed.data.definition, deadline: parsed.data.definition.rules.deadline };
    target.row = { ...target.row, questionCount: parsed.data.definition.questions.length, totalMarks: parsed.data.definition.questions.reduce((n, q) => n + q.points, 0), title: parsed.data.definition.title, status: parsed.data.definition.published ? 'published' : 'draft', deadline: parsed.data.definition.rules.deadline };
    return send({ id: target.view.id, revision: target.view.revision });
   }
   if (!h) return send({ kind: 'denied' }, 404);
   if (action === 'lifecycle') {
    const parsed = contract.homeworkLifecycle.safeParse(b);
    if (!parsed.success) { S.invalid.push(b); return send({ kind: 'invalid' }, 400); }
    if (parsed.data.revision !== h.view.revision) { const r = hw.homeworkReply({ code: 'PT409', message: 'Homework changed' }); return send(r.body, r.status); }
    if (parsed.data.action === 'reschedule') {
     if (!hw.deadlineInFuture(parsed.data.deadline, Date.now())) { const r = hw.homeworkReply({ code: '23514', message: 'The new deadline must be in the future' }); return send(r.body, r.status); }
     h.row = { ...h.row, deadline: parsed.data.deadline, lateAllowed: parsed.data.lateAllowed }; h.view = { ...h.view, revision: h.view.revision + 1, deadline: parsed.data.deadline };
    }
    if (parsed.data.action === 'publish' || parsed.data.action === 'unpublish') { h.row = { ...h.row, status: parsed.data.action === 'publish' ? 'published' : 'draft' }; h.view = { ...h.view, revision: h.view.revision + 1 }; }
    if (parsed.data.action === 'clone') { const nid = uuid(380); S.homework[nid] = { row: { ...h.row, id: nid, status: 'draft', version: 2 }, view: { ...h.view, id: nid, revision: 1, version: 2, locked: false, definition: { ...h.view.definition, published: false } } }; return send({ id: nid }); }
    return send({ id });
   }
   if (action === 'delete-images') {
    if (!contract.homeworkDeleteImages.safeParse(b).success) { S.invalid.push(b); return send({ kind: 'invalid' }, 400); }
    if (tabOf(h.row) !== 'closed') { const r = hw.homeworkReply({ code: 'PT409', message: 'Homework is still open', details: '{"reason":"still_open"}' }); return send(r.body, r.status); }
    const bytes = h.row.imageBytes; h.row = { ...h.row, imageBytes: 0 };
    return send({ deletedFiles: 20, bytesFreed: bytes, filesRemoved: 0, storage: 'done' }); // demo seed v5: photo rows with no stored file
   }
  });
  const content = url.pathname.match(/^\/api\/teacher\/courses\/([0-9a-f-]{36})\/content$/);
  if (content && req.method === 'GET') return send(structure());
  if (content && req.method === 'POST') return body(b => {
   S.posts.push({ path: url.pathname, body: b });
   const edit = contentEdit.safeParse(b);
   if (!edit.success) { S.invalid.push(b); return send({ kind: 'invalid' }, 400); }
   if (edit.data.action === 'publish_lesson' && edit.data.id === LS.velocity && edit.data.updatedAt === S.stamps.velocity) { S.velocity = 'published'; S.stamps.velocity = stamp(); return send({ id: LS.velocity, structure: structure() }); }
   return send({ kind: 'changed' }, 409);
  });
  if (url.pathname.startsWith('/api/homework/')) return send({ error: 'harness: no media in the demo homework' }, 404);
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
 const errors = [], results = [], external = [], pictures = [];
 const phone = { width: 390, height: 844 }, desktop = { width: 1360, height: 900 };
 const open = async (viewport, { lang = 'en', theme = 'light', look = 'classic', target = '/teacher/homework', ready = '[data-homework-page]' } = {}) => {
  const context = await browser.newContext({ viewport, locale: lang });
  await context.addInitScript(([l, t]) => { try { localStorage.setItem('edulabs-lms-language', l); localStorage.setItem('edulabs-lms-appearance', t); } catch {} }, [lang, theme]);
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message.slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', r => { if (r.request().url().startsWith(origin)) return r.continue(); external.push(r.request().url()); return r.abort(); });
  await page.goto(origin + target);
  await page.locator(ready).first().waitFor();
  await page.evaluate(l => { document.documentElement.dataset.design = l; if (l === 'new' && !document.querySelector('[data-teacher-shell]')) document.querySelector('main')?.setAttribute('data-teacher-shell', ''); }, look);
  return { page, context };
 };
 const only = process.env.LMS_ONLY_STEPS ? new RegExp(process.env.LMS_ONLY_STEPS) : null;
 const step = async (name, fn) => { if (only && !only.test(name)) return; try { await ctl({ reset: true }); await fn(); results.push('PASS ' + name); console.log('PASS', name); } catch (e) { console.log('FAIL', name); throw e; } };
 const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch {} }); r(); }))));
 const shot = async (page, name) => { await settle(page); const file = path.join(shots, name + '.png'); await page.screenshot({ path: file, fullPage: true }); pictures.push(name + '.png'); };
 const overflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
 const tinyTargets = page => page.evaluate(() => [...document.querySelectorAll('main a, main button, main input, main [role="combobox"], [role="dialog"] button, [role="dialog"] input, [role="menu"] [role="menuitem"]')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 43.5 || r.width < 43.5) && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.sr-only'); }).map(e => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 40) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
 const smallText = page => page.evaluate(() => { const bad = []; for (const root of document.querySelectorAll('main, [role="dialog"], [role="menu"]')) { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.textContent.trim() || n.parentElement.closest('.sr-only')) continue; const s = parseFloat(getComputedStyle(n.parentElement).fontSize); if (s < 12) bad.push(n.textContent.trim().slice(0, 30) + ':' + s); } } return bad; });
 const nativeOff = page => page.evaluate(() => [...document.querySelectorAll('main button[disabled], main input[disabled], [role="dialog"] button[disabled], input[type="checkbox"]')].map(e => e.outerHTML.slice(0, 80)));
 const forbidden = /organi[sz]ation|tenant|\bslug\b|\bmodules?\b|\bofferings?\b|\bblocks?\b|\bsegments?\b|enrol(l)?ment|منظمة|مؤسسة|وحدة|كتل/i;
 const clean = async (page, label) => {
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => null)))); await settle(page);
  assert.ok(await overflow(page), 'no sideways scroll ' + label); assert.deepEqual(await tinyTargets(page), [], '44px targets ' + label);
  assert.deepEqual(await smallText(page), [], '12px or more ' + label); assert.deepEqual(await nativeOff(page), [], 'no native disabled or checkbox ' + label);
  const text = await page.evaluate(() => [...document.querySelectorAll('main, [role="dialog"], [role="menu"]')].map(e => e.innerText).join('\n'));
  assert.doesNotMatch(text, forbidden, 'wording ' + label); assert.doesNotMatch(text, /\bSoon\b|قريبًا/, 'nothing says Soon here ' + label);
 };
 const lastPost = async () => (await state()).posts.at(-1);
 // Escape once the menu has its focus (pressed too early it goes nowhere); the page is usable again after.
 const closeMenu = async page => {
  const menu = page.locator('[role="menu"]');
  for (let i = 0; i < 3 && await menu.count(); i++) { await page.waitForFunction(() => document.activeElement?.closest('[role="menu"]'), null, { timeout: 2000 }).catch(() => null); await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached', timeout: 2000 }).catch(() => null); }
  assert.equal(await menu.count(), 0, 'the menu closed');
  await page.waitForFunction(() => getComputedStyle(document.body).pointerEvents !== 'none');
 };
 // The wizard's bar stays in view and above the phone's bottom tabs: the button is what a tap at its centre reaches.
 const onTop = async (page, selector) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const ok = await page.locator(selector).evaluate(e => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.bottom <= innerHeight && r.top >= 0 && (hit === e || e.contains(hit)); });
  assert.ok(ok, selector + ' is in view and not covered');
 };

 // ---- behaviour
 await step('Page: numbers, To correct (Correct is off with its reason), tabs with counts, rows and the menu by tab', async () => {
  const { page, context } = await open(desktop);
  await page.locator('[data-stat]').first().waitFor();
  assert.deepEqual(await page.locator('[data-stat]').evaluateAll(t => t.map(x => x.getAttribute('data-stat'))), ['waiting', 'corrected', 'handed', 'on_time']);
  assert.match(await page.locator('[data-stat="on_time"]').innerText(), /84/);
  const correct = page.locator('[data-correct]').first();
  assert.equal(await correct.getAttribute('aria-disabled'), 'true'); assert.equal(await correct.getAttribute('disabled'), null);
  assert.match(await page.locator('#' + await correct.getAttribute('aria-describedby')).innerText(), /Correcting comes in the next update/);
  assert.match(await page.locator('[data-tab="open"]').innerText(), /3/); assert.match(await page.locator('[data-tab="closed"]').innerText(), /2/); assert.match(await page.locator('[data-tab="drafts"]').innerText(), /1/);
  await page.locator(`[data-row-menu="${H.open}"]`).click();
  assert.deepEqual(await page.locator('[role="menu"] [data-action]').evaluateAll(a => a.map(x => x.getAttribute('data-action'))), ['edit', 'deadline', 'unpublish']);
  await closeMenu(page);
  await page.locator('[data-tab="closed"]').click(); await page.locator(`[data-homework-row="${H.closed}"]`).waitFor();
  await page.locator(`[data-row-menu="${H.closed}"]`).click();
  assert.deepEqual(await page.locator('[role="menu"] [data-action]').evaluateAll(a => a.map(x => x.getAttribute('data-action'))), ['edit', 'deadline', 'unpublish', 'delete_images']);
  assert.match(await page.locator('[data-menu-note="delete_images"]').innerText(), /1\.4 MB/);
  await closeMenu(page);
  await page.locator('[data-tab="drafts"]').click(); await page.locator(`[data-homework-row="${H.draft}"]`).waitFor();
  await page.locator(`[data-row-menu="${H.draft}"]`).click();
  assert.deepEqual(await page.locator('[role="menu"] [data-action]').evaluateAll(a => a.map(x => x.getAttribute('data-action'))), ['edit', 'publish']);
  await page.locator('[role="menu"] [data-action="publish"]').click();
  await page.locator(`[data-homework-row="${H.draft}"]`).waitFor({ state: 'detached' });
  assert.deepEqual((await lastPost()).body, { action: 'publish', revision: 3 }, 'the revision read, exactly');
  await clean(page, 'page desktop'); await context.close();
 });
 await step('Page: the course filter reads again; the page read is never repeated-key or malformed', async () => {
  const { page, context } = await open(desktop);
  await page.locator('[data-course-filter] [role="combobox"]').click(); await page.locator(`[role="option"][data-value="${C.arabic}"]`).click();
  await page.locator(`[data-homework-row="${H.open}"]`).waitFor({ state: 'detached' });
  assert.equal(await page.locator(`[data-homework-row="${H.arabic}"]`).count(), 1);
  assert.ok((await state()).posts.length === 0 && /course=/.test((await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/api/teacher/homework?')).pop()))), 'the read carries the course');
  assert.deepEqual((await state()).invalid, []); await context.close();
 });
 await step('Change deadline: Cairo time with its offset, a past time is refused in place, the note about solutions', async () => {
  const { page, context } = await open(desktop);
  await page.locator(`[data-row-menu="${H.open}"]`).click(); await page.locator('[role="menu"] [data-action="deadline"]').click();
  const dialog = page.locator('[data-deadline-dialog]'); await dialog.waitFor();
  assert.match(await dialog.innerText(), /Students who already saw the solutions keep them and get no more tries\./);
  const day = hw.cairoFields(iso(NOW + 4 * DAY)).date;
  await page.locator('[data-deadline-date] input, input[data-deadline-date]').first().fill(day); await page.locator('[data-deadline-time] input, input[data-deadline-time]').first().fill('21:30');
  await page.locator('[data-deadline-late]').click();
  await page.locator('[data-deadline-save]').click(); await dialog.waitFor({ state: 'detached' });
  const sent = (await lastPost()).body;
  assert.deepEqual(sent, { action: 'reschedule', revision: 3, deadline: hw.cairoIso(day, '21:30'), lateAllowed: true }); assert.match(sent.deadline, /\+0[23]:00$/);
  await page.locator(`[data-row-menu="${H.open}"]`).click(); await page.locator('[role="menu"] [data-action="deadline"]').click(); await dialog.waitFor();
  await page.locator('[data-deadline-date] input, input[data-deadline-date]').first().fill(hw.cairoFields(iso(NOW - 2 * DAY)).date);
  const before = (await state()).posts.length;
  await page.locator('[data-deadline-save]').click(); await page.locator('[data-deadline-error]').waitFor();
  assert.equal((await state()).posts.length, before, 'a past time is caught before sending'); await context.close();
 });
 await step('Delete images: closed homework, managers, the size, grades and notes kept, sends only the confirmation', async () => {
  const { page, context } = await open(desktop);
  await page.locator('[data-tab="closed"]').click(); await page.locator(`[data-row-menu="${H.closed}"]`).click(); await page.locator('[role="menu"] [data-action="delete_images"]').click();
  const dialog = page.locator('[data-delete-images]'); await dialog.waitFor();
  assert.match(await dialog.innerText(), /grades and notes are kept/i); assert.match(await dialog.innerText(), /1\.4 MB/);
  await page.locator('[data-delete-confirm]').click(); await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(await lastPost(), { path: `/api/teacher/homework/${H.closed}/delete-images`, body: { confirm: true } }); await context.close();
 });
 await step('Phone: numbers 2 by 2, To correct, All homework opens the list, the row menu is reachable', async () => {
  const { page, context } = await open(phone);
  await page.locator('[data-all-homework]').click(); await page.locator('[data-homework-list]').waitFor();
  await page.locator('[data-tab="closed"]').click(); await page.locator(`[data-row-menu="${H.closed}"]`).click(); await page.locator('[role="menu"]').waitFor();
  await clean(page, 'phone list menu'); await context.close();
 });
 await step('States: empty, error with Retry, signed out', async () => {
  await ctl({ portal: 'empty' }); let o = await open(desktop); await o.page.locator('[data-homework-page] [data-state="empty"]').first().waitFor(); await o.context.close();
  await ctl({ portal: '503' }); o = await open(desktop); await o.page.locator('[role="alert"], [data-state="error"]').first().waitFor(); await o.context.close();
  await ctl({ portal: '401' }); o = await open(desktop); assert.match(await o.page.locator('main').innerText(), /sign in/i); await o.context.close();
 });
 await step('Wizard: a new homework saves itself once it has a title, a course and a lesson; blank answers as letters; photos off on Rules; tries; the deadline with its offset', async () => {
  const { page, context } = await open(desktop, { target: '/teacher/homework/new', ready: '[data-homework-wizard]' });
  await page.locator('[data-step-next]').click(); assert.ok(await page.locator('[data-issue="title"]').count(), 'Details says what is missing');
  await page.locator('[data-field="title"] input, input[data-field="title"]').first().fill('Synthetic new homework');
  await page.locator('[data-field="course"] [role="combobox"]').click(); await page.locator(`[role="option"][data-value="${C.physics}:${OFF.physics}"]`).click();
  await page.locator('[data-field="lesson"] [role="combobox"]').click(); await page.locator(`[role="option"][data-value="${LS.velocity}"]`).click();
  await page.locator('[data-lesson-draft]').waitFor();
  assert.match(await page.locator('[data-lesson-draft]').innerText(), /Students see it when this lesson is published/);
  await page.locator('[data-save-state="hw.w.saved"]').waitFor({ timeout: 8000 });
  const first = await lastPost(); assert.equal(first.path, '/api/teacher/homework/new/save'); assert.equal(first.body.revision, null); assert.equal(first.body.definition.published, false);
  await page.waitForFunction(() => /\/teacher\/homework\/[0-9a-f-]{36}$/.test(location.pathname));
  await page.locator('[data-publish-lesson]').click(); await page.locator('[data-lesson-draft]').waitFor({ state: 'detached' });
  assert.equal((await state()).velocity, 'published');
  await page.locator('[data-step-next]').click(); await page.locator('[data-homework-wizard][data-step="questions"]').waitFor();
  assert.equal(await page.locator('[data-textbook], [data-multiple]').count(), 0, 'no textbook switch and no type control');
  assert.equal(await page.locator('[data-options="chips"] [data-option]').count(), 4, 'four blank answers, A to D, as a row of letters');
  assert.equal(await page.locator('[data-option-text]').count(), 0, 'blank answers show no text boxes');
  await page.locator('[data-options="chips"] [data-option="B"]').click();
  assert.equal(await page.locator('[data-options]').getAttribute('data-choice-type'), 'single_choice');
  await page.locator('[data-options="chips"] [data-option="D"]').click();
  assert.equal(await page.locator('[data-options]').getAttribute('data-choice-type'), 'multiple_choice', 'two right answers: multiple choice');
  assert.match(await page.locator('[data-choice-hint]').innerText(), /Choose every right answer/);
  await page.locator('[data-options="chips"] [data-option="D"]').click();
  assert.equal(await page.locator('[data-options]').getAttribute('data-choice-type'), 'single_choice', 'tapping again unmarks it');
  assert.equal(await page.locator('[data-photos-switch]').count(), 0, 'photo answers are not on the Questions step');
  assert.equal(await page.locator('[data-model="choice"] [data-field="model-answer"] .d-field-label').innerText(), 'Explanation (students see it when solutions open)');
  assert.match(await page.locator('[data-model="choice"] [data-file-pick]').innerText(), /Add a model answer picture/, 'a choice question offers the model answer picture too');
  await page.locator('[data-add-question]').click(); await page.locator('[data-kind="essay"]').click();
  await page.locator('[data-question] textarea').first().fill('Explain friction in two lines.');
  await page.locator('[data-step-next]').click(); await page.locator('[data-homework-wizard][data-step="rules"]').waitFor();
  assert.equal(await page.locator('[data-photos] legend').innerText(), 'How students answer');
  await page.locator('[data-photos-switch]').click();
  assert.equal(await page.locator('[data-photos-off]').innerText(), 'Off: essays that took a photo are now answered in text.', 'one line says what happened');
  const day = hw.cairoFields(iso(NOW + 3 * DAY)).date;
  await page.locator('[data-field="deadline-date"] input, input[data-field="deadline-date"]').first().fill(day);
  await page.locator('[data-tries="fix_mistakes"]').click();
  const more = page.locator('[data-stepper] button').last();
  for (let i = 0; i < 12 && !(await more.getAttribute('aria-disabled')); i++) await more.click();
  assert.equal(await more.getAttribute('aria-disabled'), 'true', 'ten tries at most: the button stays reachable and says why');
  assert.ok((await page.locator('#' + await more.getAttribute('aria-describedby')).textContent()).trim(), 'with its reason');
  assert.equal(await more.getAttribute('disabled'), null);
  await page.locator('[data-save-state="hw.w.saved"]').waitFor({ timeout: 8000 }); await page.waitForTimeout(1500);
  const saved = (await lastPost()).body;
  assert.equal(saved.definition.rules.deadline, hw.cairoIso(day, '23:59')); assert.match(saved.definition.rules.deadline, /\+0[23]:00$/);
  assert.equal(saved.definition.rules.tries, 'fix_mistakes'); assert.ok(saved.definition.rules.maxTries <= 10 && saved.definition.rules.maxTries >= 2, 'tries stay 2 to 10');
  assert.equal(saved.definition.rules.photosAllowed, false); assert.ok(saved.definition.questions.every(q => q.responseMode === 'text'), 'photos off: every essay is text');
  assert.deepEqual(saved.definition.questions[0].options.map(o => o.text), ['', '', '', '']); assert.equal(saved.definition.questions[0].correctIds.length, 1);
  await page.locator('[data-step-next]').click(); await page.locator('[data-step-next]').click(); await page.locator('[data-homework-wizard][data-step="review"]').waitFor();
  await page.locator('[data-publish]').click(); await page.waitForURL(/\/teacher\/homework$/);
  assert.equal((await state()).posts.filter(p => p.path.endsWith('/save')).at(-1).body.definition.published, true);
  assert.deepEqual((await state()).invalid, [], 'every request met the contract'); await context.close();
 });
 await step('Wizard: a stale save keeps what was typed and offers Reload; started homework says saving makes a new version', async () => {
  await ctl({ stale: true });
  const { page, context } = await open(desktop, { target: '/teacher/homework/' + H.draft, ready: '[data-homework-wizard][data-step]' });
  const title = page.locator('[data-field="title"] input, input[data-field="title"]').first();
  await title.fill('Velocity practice, typed here');
  await page.locator('[data-reload]').waitFor({ timeout: 8000 });
  assert.equal(await title.inputValue(), 'Velocity practice, typed here', 'what was typed stays');
  await context.close();
  const o = await open(desktop, { target: '/teacher/homework/' + H.started, ready: '[data-homework-wizard][data-step]' });
  assert.match(await o.page.locator('main').innerText(), /new version/i); assert.match(await o.page.locator('main').innerText(), /Change deadline/);
  await o.context.close();
 });

 await step('Move: course and lesson stay editable until a student starts; another course clears the lesson and nothing saves until one is picked; a refused move keeps what was typed', async () => {
  const { page, context } = await open(desktop, { target: '/teacher/homework/' + H.draft, ready: '[data-lesson-draft]' });
  const course = page.locator('[data-field="course"] [role="combobox"]'), lesson = page.locator('[data-field="lesson"] [role="combobox"]');
  assert.equal(await course.getAttribute('aria-disabled'), null, 'nobody started: the course may change'); assert.equal(await page.locator('[data-fixed]').count(), 0, 'no note unless really locked');
  const before = (await state()).posts.length;
  await course.click(); await page.locator(`[role="option"][data-value="${C.arabic}:${OFF.arabic}"]`).click();
  assert.equal(await lesson.getAttribute('data-value'), '', 'another course clears the lesson');
  await page.waitForTimeout(2000);
  assert.equal((await state()).posts.length, before, 'no autosave until a lesson is picked');
  await lesson.click(); await page.locator(`[role="option"][data-value="${LS.work}"]`).click();
  await page.locator('[data-save-state="hw.w.saved"]').waitFor({ timeout: 8000 });
  const moved = await lastPost(); assert.equal(moved.body.offeringId, OFF.arabic); assert.equal(moved.body.lessonId, LS.work);
  await context.close();

  const locked = await open(desktop, { target: '/teacher/homework/' + H.started, ready: '[data-fixed]' });
  for (const field of ['course', 'lesson']) {
   const box = locked.page.locator(`[data-field="${field}"] [role="combobox"]`);
   assert.equal(await box.getAttribute('aria-disabled'), 'true', field + ' is aria-disabled'); assert.equal(await box.getAttribute('disabled'), null, field + ' stays reachable');
   assert.equal(await box.getAttribute('aria-describedby'), 'hw-fixed', field + ' says why');
  }
  assert.equal(await locked.page.locator('[data-fixed]').innerText(), 'A student has started this homework, so it stays in this lesson.');
  await locked.context.close();

  await ctl({ reset: true, moveRace: true });
  const race = await open(desktop, { target: '/teacher/homework/' + H.draft, ready: '[data-lesson-draft]' });
  const title = race.page.locator('[data-field="title"] input, input[data-field="title"]').first();
  await title.fill('Velocity practice, moved');
  await race.page.locator('[data-field="lesson"] [role="combobox"]').click(); await race.page.locator(`[role="option"][data-value="${LS.speed}"]`).click();
  await race.page.locator('[data-reload]').waitFor({ timeout: 8000 });
  assert.match(await race.page.locator('[data-save-failure="stale"]').innerText(), /A student has started this homework, so it stays in this lesson\./);
  assert.equal(await title.inputValue(), 'Velocity practice, moved', 'what was typed stays');
  await race.context.close();
 });
 await step('Rows: each shows "N questions · M marks" from the portal', async () => {
  const { page, context } = await open(desktop);
  if (await page.locator('[data-all-homework]').count()) await page.locator('[data-all-homework]').click();
  assert.equal(await page.locator(`[data-homework-row="${H.open}"] [data-counts]`).innerText(), '3 questions · 6 marks');
  await context.close();
  const ar = await open(desktop, { lang: 'ar' });
  if (await ar.page.locator('[data-all-homework]').count()) await ar.page.locator('[data-all-homework]').click();
  assert.match(await ar.page.locator(`[data-homework-row="${H.open}"] [data-counts]`).innerText(), /[؀-ۿ]/);
  await ar.context.close();
 });

 // ---- pictures: every new screen and dialog, 1360 and 390, Classic and New, English and Arabic
 const screens = [
  { name: 'page', target: '/teacher/homework', ready: '[data-stat]' },
  { name: 'page-all-homework', target: '/teacher/homework', ready: '[data-stat]', sizes: ['phone'], act: async p => { await p.locator('[data-all-homework]').click(); await p.locator('[data-homework-list]').waitFor(); } },
  { name: 'page-closed-menu', target: '/teacher/homework', ready: '[data-stat]', act: async p => { if (await p.locator('[data-all-homework]').count()) await p.locator('[data-all-homework]').click(); await p.locator('[data-tab="closed"]').click(); await p.locator(`[data-row-menu="${H.closed}"]`).click(); await p.locator('[role="menu"]').waitFor(); } },
  { name: 'page-drafts', target: '/teacher/homework', ready: '[data-stat]', sizes: ['desktop'], act: async p => { await p.locator('[data-tab="drafts"]').click(); await p.locator(`[data-homework-row="${H.draft}"]`).waitFor(); } },
  { name: 'dialog-change-deadline', target: '/teacher/homework', ready: '[data-stat]', act: async p => { if (await p.locator('[data-all-homework]').count()) await p.locator('[data-all-homework]').click(); await p.locator(`[data-row-menu="${H.open}"]`).click(); await p.locator('[role="menu"] [data-action="deadline"]').click(); await p.locator('[data-deadline-dialog]').waitFor(); } },
  { name: 'dialog-delete-images', target: '/teacher/homework', ready: '[data-stat]', act: async p => { if (await p.locator('[data-all-homework]').count()) await p.locator('[data-all-homework]').click(); await p.locator('[data-tab="closed"]').click(); await p.locator(`[data-row-menu="${H.closed}"]`).click(); await p.locator('[role="menu"] [data-action="delete_images"]').click(); await p.locator('[data-delete-images]').waitFor(); } },
  { name: 'page-empty', target: '/teacher/homework', ready: '[data-state="empty"]', before: { portal: 'empty' } },
  { name: 'page-error', target: '/teacher/homework', ready: '[data-homework-page] [role="alert"], [data-homework-page] [data-state="error"]', before: { portal: '503' }, sizes: ['desktop'] },
  { name: 'wizard-details', target: '/teacher/homework/' + H.draft, ready: '[data-lesson-draft]' },
  { name: 'wizard-questions', target: '/teacher/homework/' + H.draft, ready: '[data-homework-wizard][data-step]', act: async p => { await p.locator('[data-step-next]').click(); await p.locator('[data-homework-wizard][data-step="questions"]').waitFor(); } },
  { name: 'wizard-questions-essay', target: '/teacher/homework/' + H.draft, ready: '[data-homework-wizard][data-step]', act: async p => { await p.locator('[data-step-next]').click(); await p.locator('[data-question-tab="3"], [data-question-tab]').last().click(); } },
  { name: 'wizard-rules', target: '/teacher/homework/' + H.draft, ready: '[data-homework-wizard][data-step]', act: async p => { for (const s of ['questions', 'rules']) { await p.locator('[data-step-next]').click(); await p.locator(`[data-homework-wizard][data-step="${s}"]`).waitFor(); } await p.locator('[data-tries="fix_mistakes"]').click(); } },
  { name: 'wizard-solutions', target: '/teacher/homework/' + H.draft, ready: '[data-homework-wizard][data-step]', act: async p => { for (const s of ['questions', 'rules', 'solutions']) { await p.locator('[data-step-next]').click(); await p.locator(`[data-homework-wizard][data-step="${s}"]`).waitFor(); } } },
  { name: 'wizard-review', target: '/teacher/homework/' + H.draft, ready: '[data-homework-wizard][data-step]', act: async p => { for (const s of ['questions', 'rules', 'solutions', 'review']) { await p.locator('[data-step-next]').click(); await p.locator(`[data-homework-wizard][data-step="${s}"]`).waitFor(); } await onTop(p, '[data-publish]'); await onTop(p, '[data-keep-draft]'); } },
  { name: 'wizard-new', target: '/teacher/homework/new', ready: '[data-homework-wizard][data-step]', sizes: ['phone'] },
  { name: 'wizard-stale', target: '/teacher/homework/' + H.draft, ready: '[data-homework-wizard][data-step]', before: { stale: true }, sizes: ['desktop'], act: async p => { await p.locator('[data-field="title"] input, input[data-field="title"]').first().fill('Velocity practice, typed here'); await p.locator('[data-reload]').waitFor({ timeout: 8000 }); } },
  { name: 'wizard-started', target: '/teacher/homework/' + H.started, ready: '[data-homework-wizard][data-step]', sizes: ['desktop'] },
  // The homework move change (docs/design/screenshots/homework-move).
  { name: 'move-details-unlocked', target: '/teacher/homework/' + H.draft, ready: '[data-lesson-draft]' },
  { name: 'move-details-locked', target: '/teacher/homework/' + H.started, ready: '[data-fixed]' },
  { name: 'move-rows', target: '/teacher/homework', ready: '[data-stat]', act: async p => { if (await p.locator('[data-all-homework]').count()) await p.locator('[data-all-homework]').click(); await p.locator('[data-counts]').first().waitFor(); } },
  { name: 'move-questions-chips', target: '/teacher/homework/' + H.draft, ready: '[data-homework-wizard][data-step]', act: async p => { await p.locator('[data-step-next]').click(); await p.locator('[data-options="chips"]').waitFor(); } },
  { name: 'move-questions-list', target: '/teacher/homework/' + H.draft, ready: '[data-homework-wizard][data-step]', act: async p => { await p.locator('[data-step-next]').click(); await p.locator('[data-question-tab="2"]').click(); await p.locator('[data-options="list"]').waitFor(); } },
  { name: 'move-question-menu', target: '/teacher/homework/' + H.draft, ready: '[data-homework-wizard][data-step]', sizes: ['desktop'], act: async p => { await p.locator('[data-step-next]').click(); await p.locator('[data-question-menu]').click(); await p.locator('[role="menu"] [data-menu-note="up"]').waitFor(); } },
  { name: 'move-rules-photos', target: '/teacher/homework/' + H.draft, ready: '[data-homework-wizard][data-step]', act: async p => { for (const s of ['questions', 'rules']) { await p.locator('[data-step-next]').click(); await p.locator(`[data-homework-wizard][data-step="${s}"]`).waitFor(); } await p.locator('[data-photos]').waitFor(); } },
  { name: 'move-rules-photos-off', target: '/teacher/homework/' + H.draft, ready: '[data-homework-wizard][data-step]', sizes: ['desktop'], act: async p => { for (const s of ['questions', 'rules']) { await p.locator('[data-step-next]').click(); await p.locator(`[data-homework-wizard][data-step="${s}"]`).waitFor(); } await p.locator('[data-photos-switch]').click(); await p.locator('[data-photos-off]').waitFor(); } },
 ];
 const SIZES = { desktop, phone };
 await step('Pictures: every new screen and dialog, both looks, both languages, desktop 1360 and phone 390, each measured', async () => {
  for (const s of screens) for (const look of ['classic', 'new']) for (const lang of ['en', 'ar']) for (const size of s.sizes ?? ['desktop', 'phone']) {
   await ctl({ reset: true, ...(s.before ?? {}) });
   const label = `${s.name}-${size}-${look}-${lang}`;
   const { page, context } = await open(SIZES[size], { lang, look, target: s.target, ready: s.ready });
   try {
    if (s.act) await s.act(page);
    if (lang === 'ar') assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    await clean(page, label);
    await shot(page, label);
   } finally { await context.close(); }
  }
 });

 if (process.env.LMS_MATRIX) await step('Screen matrix: light and dark, measured', async () => {
  const findings = await shootMatrix({ label: 'homework', open: ({ viewport, lang, theme, look, target }) => open(viewport, { lang, theme, look, target: target.path, ready: target.ready }),
   screens: [{ name: 'homework-page', target: { path: '/teacher/homework', ready: '[data-stat]' }, ready: '[data-stat]' }, { name: 'homework-wizard', target: { path: '/teacher/homework/' + H.draft, ready: '[data-lesson-draft]' }, ready: '[data-lesson-draft]' }] });
  assert.deepEqual(findings, []);
 });

 await browser.close(); server.close();
 assert.deepEqual(errors, [], 'no uncaught or console errors');
 assert.deepEqual(external, [], 'no external requests');
 const apis = [...new Set(requests.filter(r => /\/api\//.test(r)).map(r => r.replace(/[0-9a-f-]{36}/g, ':id')))].sort();
 assert.deepEqual(apis.filter(r => !/^(GET \/api\/teacher\/homework(\/:id)?|POST \/api\/teacher\/homework\/(new|:id)\/(save|lifecycle|delete-images)|(GET|POST) \/api\/teacher\/courses\/:id\/content|(GET|POST) \/api\/communications|GET \/api\/user\/status)$/.test(r)), [], 'only the homework and content routes: ' + apis.join(', '));
 if (process.env.LMS_COPY_SHOTS) {
  const moves = pictures.filter(p => p.startsWith('move-'));
  fs.mkdirSync(moveDocs, { recursive: true }); for (const f of fs.readdirSync(moveDocs)) if (f.endsWith('.png')) fs.unlinkSync(path.join(moveDocs, f));
  for (const f of moves) fs.copyFileSync(path.join(shots, f), path.join(moveDocs, f));
  fs.writeFileSync(path.join(moveDocs, 'README.md'), '# Homework move screenshots\n\nSynthetic harness data (scripts/teacher-homework-browser.cjs): the real screens, middleware and CSS, a fictional server checked against the real contract. Light theme; desktop 1360 and phone 390; Classic and New; English and Arabic.\n\n- move-details-unlocked: Details, course and lesson editable (nobody started)\n- move-details-locked: Details, a student started; course and lesson aria-disabled with the reason\n- move-rows: Homework rows with "N questions · M marks"\n- move-questions-chips: blank answers as a row of letters, the explanation and the model answer picture below\n- move-questions-list: answers with text as a list\n- move-question-menu: "Move up (already first)" inside the item\n- move-rules-photos / move-rules-photos-off: photo answers under How students answer, and the one-line note when off\n\n' + moves.map(p => `- ${p}`).join('\n') + '\n');
 }
 if (process.env.LMS_COPY_SHOTS && process.env.LMS_COPY_SHOTS !== 'move') { fs.mkdirSync(docs, { recursive: true }); for (const f of fs.readdirSync(docs)) if (f.endsWith('.png')) fs.unlinkSync(path.join(docs, f)); for (const f of pictures) fs.copyFileSync(path.join(shots, f), path.join(docs, f)); fs.writeFileSync(path.join(docs, 'README.md'), '# Homework UI screenshots\n\nSynthetic harness data (scripts/teacher-homework-browser.cjs): the real screens, middleware and CSS, a fictional server checked against the real contract. Light theme; desktop 1360 and phone 390; Classic and New; English and Arabic.\n\n' + pictures.map(p => `- ${p}`).join('\n') + '\n'); }
 console.log(`Homework browser checks passed: ${results.length} groups, ${pictures.length} pictures (real middleware, real contract and reply mapper, synthetic loopback data, not provider E2E). Screenshots: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
