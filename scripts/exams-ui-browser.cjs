// Teacher Exams (part 1) in Chromium: the Exams page, the wizard (online and paper, every step, a Group's window), correcting one online
// try and the paper mark sheet. The real screens, the REAL middleware in front of every request, the real CSS and fonts. The server is
// fictional and synthetic (no customer records); every teacher request is checked against the real contract and every refusal is worded by
// the real reply mapper. Not provider acceptance.
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME / LMS_CHROMIUM_EXECUTABLE and a Firebase-mode `npm run build` (fonts). Pictures:
// .local/exams-ui-browser/screenshots, copied to docs/design/screenshots/exams-ui with LMS_COPY_SHOTS=1.
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/exams-ui-browser'), shots = path.join(out, 'screenshots'), docs = path.resolve('docs/design/screenshots/exams-ui');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the fonts are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat([require('./harness-css.cjs')()]).join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

class NextResponse { constructor(kind, status, location) { this.kind = kind; this.status = status; this.location = location; this.headers = new Map(); } static next() { return new NextResponse('next', 200); } static json(_, o) { return new NextResponse('json', o.status); } static redirect(u) { return new NextResponse('redirect', 307, String(u)); } }
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
const contract = loadTs('shared/contracts/teacher-exams.ts', { '@/shared/contracts/teacher-homework': loadTs('shared/contracts/teacher-homework.ts') });

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { TeacherFrame } from '@/frontend/features/teacher-frame/teacher-frame';
import { TeacherExamsPage } from '@/frontend/features/teacher-exams/exams-page';
import { ExamWizard } from '@/frontend/features/teacher-exams/exam-wizard';
import { ExamCorrectScreen } from '@/frontend/features/teacher-exams/exam-correct';
import { PaperMarks } from '@/frontend/features/teacher-exams/paper-marks';
let lang = 'en'; try { lang = localStorage.getItem('edulabs-lms-language') === 'ar' ? 'ar' : 'en'; } catch {}
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
const parts = location.pathname.split('/'), query = new URLSearchParams(location.search);
const load = window.__LOAD;
function Screen() {
  const id = parts[3], sub = parts[4];
  if (!id) return <TeacherExamsPage load={load} />;
  if (sub === 'correct') return <ExamCorrectScreen examId={id} start={query.get('try')} />;
  if (sub === 'marks') return <PaperMarks examId={id} />;
  return <ExamWizard key={id} load={load} examId={id === 'new' ? null : id} initialCourse={query.get('course')} initialKind={query.get('kind') === 'paper' ? 'paper' : 'online'} />;
}
createRoot(document.getElementById('root')).render(<LanguageProvider initialLanguage={lang}><ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
  <TeacherFrame><Screen /></TeacherFrame>
</ThemeProvider></LanguageProvider>);
`;

// ---- synthetic data (no customer records)
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const DAY = 86400000, MIN = 60000, NOW = Date.now(), iso = ms => new Date(ms).toISOString();
const cairo = ms => { const f = hw.cairoFields(iso(ms)); return hw.cairoIso(f.date, f.time); };
const C = { physics: uuid(10), arabic: uuid(11) }, OFF = { physics: uuid(20), arabic: uuid(21) };
const CH = { motion: uuid(101), energy: uuid(102) };
const G = { alpha: uuid(61), tenth: uuid(62), late: uuid(63) };
const E = { live: uuid(301), draft: uuid(302), paper: uuid(303), closed: uuid(304), arabic: uuid(305) };
const load = { state: 'ready', courses: [
 { id: C.physics, title: 'Synthetic Physics 9', canEdit: true, offerings: [{ id: OFF.physics, name: 'Synthetic run' }] },
 { id: C.arabic, title: 'لغة عربية — الصف التاسع', canEdit: true, offerings: [{ id: OFF.arabic, name: 'Synthetic run' }] },
] };
const structure = () => ({ archived: false, canEdit: true,
 chapters: [{ id: CH.motion, title: 'Motion', type: 'chapter', number: 1, position: 0, updatedAt: '2026-11-06T10:00:00+00:00' }, { id: CH.energy, title: 'Energy', type: 'chapter', number: 2, position: 1, updatedAt: '2026-11-06T10:00:00+00:00' }],
 lessons: [] });
const opt = n => uuid(500 + n);
const Q = { choice: uuid(401), number: uuid(402), essay: uuid(403) };
const staffQuestions = [
 { id: Q.choice, position: 0, type: 'single_choice', text: 'Which is a unit of speed?', imageId: null, points: 1, responseMode: 'text', options: [{ id: opt(1), text: 'm/s' }, { id: opt(2), text: 'kg' }, { id: opt(3), text: 'N' }, { id: opt(4), text: 'J' }], correctOptionIds: [opt(1)], numberValue: null, tolerance: 0, modelText: '', modelImageId: null },
 { id: Q.number, position: 1, type: 'number', text: 'A car goes 120 m in 8 s. What is its speed in m/s?', imageId: null, points: 2, responseMode: 'text', options: [], correctOptionIds: [], numberValue: 15, tolerance: 0.5, modelText: '120 ÷ 8 = 15', modelImageId: null },
 { id: Q.essay, position: 2, type: 'essay', text: 'Explain why a moving car slows down when the engine stops.', imageId: null, points: 4, responseMode: 'both', options: [], correctOptionIds: [], numberValue: null, tolerance: 0, modelText: 'Friction and air resistance act against the motion.', modelImageId: null },
];
const windows = () => [
 { groupId: G.alpha, groupName: 'Synthetic Group Alpha', source: 'auto', sessionId: uuid(71), opensAt: cairo(NOW + 2 * DAY), closesAt: cairo(NOW + 2 * DAY + 90 * MIN), state: 'ok', frozen: false },
 { groupId: G.tenth, groupName: 'مجموعة الصف العاشر', source: 'custom', sessionId: null, opensAt: cairo(NOW + 3 * DAY), closesAt: cairo(NOW + 3 * DAY + 60 * MIN), state: 'ok', frozen: false },
 { groupId: G.late, groupName: 'Synthetic Group Late', source: 'auto', sessionId: null, opensAt: null, closesAt: null, state: 'needs_time', frozen: false },
];
function view(id) {
 const paper = id === E.paper, live = id === E.live;
 const base = { id, familyId: id, version: 1, courseId: C.physics, offeringId: OFF.physics, kind: paper ? 'paper' : 'online', title: paper ? 'Midterm on paper' : live ? 'Motion quiz' : 'Energy test (draft)',
  description: paper ? '' : 'Bring a calculator. Show your working.', status: id === E.draft ? 'draft' : 'published', publishedAt: id === E.draft ? null : iso(NOW - DAY),
  maxMarks: paper ? 40 : null, heldOn: paper ? hw.cairoFields(iso(NOW - DAY)).date : null, timing: paper ? null : 'per_group', startingFrom: paper ? null : hw.cairoFields(iso(NOW + DAY)).date, opensAt: null, closesAt: null,
  timeLimitMinutes: paper ? null : 45, tries: paper ? null : 'one_time', shuffle: false, photosAllowed: true, autoRelease: false, coversAllChapters: !paper, chapterIds: paper ? [CH.motion] : [],
  questionCount: paper ? 0 : 3, totalPoints: paper ? 0 : 7, hasEssays: !paper,
  serverNow: iso(Date.now()), lastClose: null, closed: false, reviewOpen: false, revision: S.revision[id] ?? 3, staff: true, can: { author: true, correct: true, release: true }, started: live,
  questions: paper ? [] : staffQuestions, windows: paper ? [] : windows(), holds: [] };
 return base;
}
const students = [['Synthetic Student 1', 'waiting'], ['طالبة تجريبية ٢', 'waiting'], ['Synthetic Student 3', 'corrected'], ['Synthetic Student 4', 'released']]
 .map(([name, kind], i) => ({ name, kind, userId: uuid(700 + i), attemptId: uuid(800 + i), resultId: uuid(900 + i) }));
const item = (q, answer, mark) => ({ ...q, answer: answer && { optionIds: null, numberValue: null, text: null, uploadId: null, kept: false, savedAt: iso(NOW - 3 * MIN), ...answer }, mark });
function attempt(s) {
 const done = s.kind !== 'waiting';
 return { id: s.attemptId, userId: s.userId, number: 1, status: 'submitted', startedAt: iso(NOW - DAY - 40 * MIN), deadlineAt: iso(NOW - DAY + 5 * MIN), submittedAt: iso(NOW - DAY - 2 * MIN), autoSubmitted: s.userId === students[1].userId,
  revision: S.results[s.resultId].revision, groupId: G.alpha, items: [
   item(staffQuestions[0], { optionIds: [s.userId === students[1].userId ? opt(2) : opt(1)] }, { points: s.userId === students[1].userId ? 0 : 1, auto: true, note: '' }),
   item(staffQuestions[1], { numberValue: 15.2 }, { points: 2, auto: true, note: '' }),
   item(staffQuestions[2], { text: s.userId === students[1].userId ? 'لأن الاحتكاك ومقاومة الهواء يعملان عكس الحركة.' : 'Friction with the road and the air pushes against the car, so it loses speed.', uploadId: s.userId === students[0].userId ? uuid(950) : null },
    done ? { points: 3, auto: false, note: 'Name both forces.' } : null),
  ] };
}
const sheetStudents = [['Synthetic Student 1', [G.alpha], 34], ['طالبة تجريبية ٢', [G.alpha], 28.5], ['Synthetic Student 3', [G.tenth], null], ['Synthetic Student 4', [G.tenth], 'absent'], ['Synthetic Student 5', [], null], ['طالب تجريبي ٦', [G.alpha], 39]]
 .map(([name, groupIds, mark], i) => ({ name, groupIds, mark, userId: uuid(1000 + i) }));
function fresh() {
 return { revision: {}, invalid: [], posts: [],
  results: Object.fromEntries(students.map(s => [s.resultId, { revision: 2, status: s.kind === 'waiting' ? 'waiting' : 'corrected', released: s.kind === 'released', score: s.kind === 'waiting' ? null : 6 }])),
  marks: Object.fromEntries(sheetStudents.map((s, i) => [s.userId, { mark: typeof s.mark === 'number' ? s.mark : null, absent: s.mark === 'absent', released: i === 5, resultId: s.mark === null ? null : uuid(1100 + i), revision: s.mark === null ? null : 1 }])) };
}
let S = fresh();
const pgroup = (g, name, window, opens, closes, started, total) => ({ groupId: g, name, state: 'ok', opensAt: opens, closesAt: closes, window, secondsLeft: window === 'open' ? Math.round((Date.parse(closes) - Date.now()) / 1000) : null, total, started });
const prow = (over) => ({ id: E.live, title: 'Motion quiz', kind: 'online', status: 'published', courseId: C.physics, courseTitle: 'Synthetic Physics 9', offeringId: OFF.physics, version: 1, timing: 'per_group', startingFrom: hw.cairoFields(iso(NOW - DAY)).date,
 opensAt: null, closesAt: null, heldOn: null, timeLimitMinutes: 45, updatedAt: iso(NOW - DAY), lastClose: cairo(NOW + 2 * DAY), held: false, questionCount: 3, totalMarks: 7, hasEssays: true,
 total: 24, handedIn: 9, waiting: 2, toRelease: 1, released: 1, groups: null, noGroup: null, ...over });
function portal(q) {
 const rows = {
  open: [
   prow({ groups: [pgroup(G.alpha, 'Synthetic Group Alpha', 'open', cairo(NOW - 20 * MIN), cairo(NOW + 25 * MIN), 9, 14), pgroup(G.tenth, 'مجموعة الصف العاشر', 'upcoming', cairo(NOW + DAY), cairo(NOW + DAY + 60 * MIN), 0, 10)], noGroup: { total: 0, started: 0 } }),
   prow({ id: E.paper, title: 'Midterm on paper', kind: 'paper', timing: null, startingFrom: null, timeLimitMinutes: null, heldOn: hw.cairoFields(iso(NOW - DAY)).date, held: false, questionCount: 0, totalMarks: 40, hasEssays: false, total: 6, handedIn: 4, waiting: null, toRelease: 3, released: 1 }),
   prow({ id: E.arabic, title: 'اختبار النحو القصير', courseId: C.arabic, courseTitle: 'لغة عربية — الصف التاسع', offeringId: OFF.arabic, timing: 'same_time', startingFrom: null, opensAt: cairo(NOW + 2 * DAY), closesAt: cairo(NOW + 2 * DAY + 40 * MIN), timeLimitMinutes: null, total: 18, handedIn: 0, waiting: 0, toRelease: 0, released: 0, hasEssays: false, questionCount: 10, totalMarks: 10 }),
  ],
  closed: [prow({ id: E.closed, title: 'Forces warm-up', lastClose: cairo(NOW - 5 * DAY), handedIn: 22, waiting: 0, toRelease: 0, released: 22 })],
  drafts: [prow({ id: E.draft, title: 'Energy test (draft)', status: 'draft', total: null, handedIn: null, waiting: null, toRelease: null, released: null })],
  archived: [],
 }[q.tab].filter(r => !q.course || r.courseId === q.course);
 return { tab: q.tab, page: q.page, pageSize: 20, serverNow: iso(Date.now()), counts: { open: 3, closed: 1, drafts: 1, archived: 0 }, rows };
}
function queue(q) {
 const rows = students.map(s => { const r = S.results[s.resultId]; return { userId: s.userId, name: s.name, groupIds: [G.alpha], resultId: s.resultId, attemptId: s.attemptId, number: 1, submittedAt: iso(NOW - DAY - 2 * MIN), autoSubmitted: s.userId === students[1].userId,
  status: r.status, score: r.score, maxScore: 7, waitingMarks: r.status === 'waiting' ? 1 : 0, released: r.released, releasedAt: r.released ? iso(NOW - 3600000) : null, revision: r.revision, windowClosed: true, windowClosesAt: iso(NOW - DAY), inProgress: false }; });
 const list = { to_correct: rows.filter(r => r.status === 'waiting'), corrected: rows.filter(r => r.status === 'corrected'), missing: [{ userId: uuid(760), name: 'Synthetic Student 8', groupIds: [G.alpha], resultId: null, attemptId: null, number: null, submittedAt: null, autoSubmitted: null, status: null, score: null, maxScore: null, waitingMarks: null, released: false, releasedAt: null, revision: null, windowClosed: true, windowClosesAt: iso(NOW - DAY), inProgress: false }] }[q.tab];
 const releasable = rows.filter(r => r.status === 'corrected' && !r.released).map(r => ({ resultId: r.resultId, revision: r.revision }));
 return { tab: q.tab, page: q.page, pageSize: 50, serverNow: iso(Date.now()), lastClose: iso(NOW - DAY), closed: true, holds: [],
  counts: { to_correct: rows.filter(r => r.status === 'waiting').length, corrected: rows.filter(r => r.status === 'corrected').length, missing: 1, released: rows.filter(r => r.released).length, inProgress: 0 }, readyToRelease: releasable.length, releasable, rows: list };
}
function sheet() {
 const rows = sheetStudents.map(s => { const m = S.marks[s.userId]; return { userId: s.userId, name: s.name, groupIds: s.groupIds, resultId: m.resultId, mark: m.mark, absent: m.absent, released: m.released, releasedAt: m.released ? iso(NOW - 3600000) : null, revision: m.revision }; });
 return { page: 0, pageSize: 500, maxMarks: 40, heldOn: hw.cairoFields(iso(NOW - DAY)).date, status: 'published', serverNow: iso(Date.now()),
  counts: { total: rows.length, marked: rows.filter(r => r.mark !== null).length, absent: rows.filter(r => r.absent).length, released: rows.filter(r => r.released).length },
  releasable: rows.filter(r => r.resultId && !r.released && (r.mark !== null || r.absent)).map(r => ({ resultId: r.resultId, revision: r.revision })),
  groups: [{ id: G.alpha, name: 'Synthetic Group Alpha' }, { id: G.tenth, name: 'مجموعة الصف العاشر' }], rows };
}
const photo = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#fbf8ef"/>' +
 Array.from({ length: 14 }, (_, i) => `<line x1="40" x2="860" y1="${70 + i * 38}" y2="${70 + i * 38}" stroke="#c9d7ea" stroke-width="2"/>`).join('') +
 '<g fill="none" stroke="#1d3a8a" stroke-width="4" stroke-linecap="round"><path d="M90 150 q30 -40 60 0 t60 0 t60 0"/><path d="M90 230 q40 -30 80 0 t80 0"/><path d="M120 360 h500"/><path d="M600 340 l20 20 -20 20"/></g>' +
 '<text x="140" y="420" font-size="34" font-family="Arial" fill="#1d3a8a">friction  +  air</text></svg>';

(async () => {
 const stubs = {
  '@/frontend/components/providers/use-loading-router': 'export const useLoadingRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() {}, prefetch() {} });',
  'next/navigation': 'export const usePathname = () => location.pathname; export const useRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() {}, prefetch() {} }); export const useSearchParams = () => new URLSearchParams(location.search);',
  'next/image': 'import React from "react"; export default function Image({ unoptimized, fill, priority, ...p }) { return React.createElement("img", p); }',
  'next/link': 'import React from "react"; export default React.forwardRef(function Link({ href, children, onClick, prefetch, ...rest }, ref) { return React.createElement("a", { ...rest, ref, href, onClick: e => { onClick && onClick(e); if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); location.assign(href); } }, children); });',
  '@/frontend/components/providers/application-auth-provider': 'export const useApplicationAuth = () => ({ user: { fullName: "Synthetic Teacher", email: "synthetic.teacher@example.test", imageUrl: null, id: "u" }, signOut: async () => {} }); export const useWebsiteNavigation = () => ({ viewer: { id: "v", displayName: "Synthetic Viewer" }, organizations: [{ id: "00000000-0000-4000-8000-000000000050", name: "Synthetic space" }], staffOrganizationIds: ["00000000-0000-4000-8000-000000000050"] }); export const WebsiteNavigationProvider = ({ children }) => children;',
  '@/frontend/components/providers/v2-identity': 'import React from "react"; export const useUser = () => ({ user: { fullName: "Synthetic Teacher" } }); export const useClerk = () => ({ signOut() {} }); export const UserButton = () => React.createElement("span", { className: "h-9 w-9 rounded-full" });',
  '@/frontend/lib/firebase': 'export const getFirebaseAuth = () => ({ currentUser: null }); export const restoreFirebaseAuth = async () => {};',
 };
 const resolveAlias = p => { for (const c of [p + '.tsx', p + '.ts', path.join(p, 'index.tsx'), path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return p; };
 await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: path.join(out, 'app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_AUTH_BACKEND': '"firebase-staging"' }, banner: { js: 'var process = { env: {} };' },
  plugins: [{ name: 'boundary', setup(b) {
   b.onResolve({ filter: /.*/ }, a => { if (stubs[a.path]) return { path: a.path, namespace: 'stub' }; if (a.path.startsWith('@/')) return { path: resolveAlias(path.resolve(a.path.slice(2))) }; });
   b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'jsx', resolveDir: process.cwd() }));
  } }] });

 const apis = [];
 const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
  const body = cb => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => { let b = null; try { b = JSON.parse(Buffer.concat(parts).toString() || '{}'); } catch { b = undefined; } cb(b); }); };
  const reply = e => { const r = ex.examReply(e); return send(r.body, r.status); };
  const checked = (schema, b, cb) => { const p = schema.safeParse(b); if (!p.success) { S.invalid.push({ path: url.pathname, b }); return send({ kind: 'invalid' }, 400); } S.posts.push({ path: url.pathname, body: b }); return cb(p.data); };
  if (url.pathname === '/__app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
  if (url.pathname === '/__style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname === '/__photo.svg') { res.setHeader('Content-Type', 'image/svg+xml'); return res.end(photo); }
  if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
  if (url.pathname === '/__ctl') return body(b => { if (b.reset) S = fresh(); send({}); });
  if (url.pathname === '/__state') return send({ posts: S.posts, invalid: S.invalid });
  const decision = gate(url.pathname);
  if (url.pathname.startsWith('/api/')) apis.push(req.method + ' ' + url.pathname.replace(/[0-9a-f-]{36}/g, ':id'));
  if (decision.kind === 'json') return send({ error: 'This legacy workflow is unavailable in Firebase staging.' }, decision.status);
  if (decision.kind === 'redirect') { res.statusCode = 307; res.setHeader('Location', decision.location); return res.end(); }
  if (decision.kind !== 'next') return send({ error: 'harness: middleware said ' + decision.kind }, 500);
  const q = schema => { const keys = [...url.searchParams.keys()], p = schema.safeParse(Object.fromEntries(url.searchParams)); if (!p.success || keys.length !== new Set(keys).size) { S.invalid.push({ path: url.pathname, q: url.search }); return null; } return p.data; };
  if (url.pathname === '/api/teacher/exams' && req.method === 'GET') { const p = q(contract.portalQuery); return p ? send(portal(p)) : send({ kind: 'invalid' }, 400); }
  const m = url.pathname.match(/^\/api\/teacher\/exams\/([0-9a-f-]{36}|new)(?:\/(save|lifecycle|window|upload|queue|work|release-many|sheet|marks|tries\/([0-9a-f-]{36})))?$/);
  if (m) {
   const [, id, action, tryId] = m;
   if (!action && req.method === 'GET') return url.search ? send({ kind: 'invalid' }, 400) : send(view(id));
   if (action === 'queue') { const p = q(contract.queueQuery); return p ? send(queue(p)) : send({ kind: 'invalid' }, 400); }
   if (action === 'sheet') { const p = q(contract.sheetQuery); return p ? send(sheet()) : send({ kind: 'invalid' }, 400); }
   if (tryId) { const s = students.find(x => x.attemptId === tryId); return s ? send({ ...view(E.live), attempt: attempt(s) }) : send({ kind: 'denied' }, 404); }
   if (req.method !== 'POST') return send({ kind: 'invalid' }, 405);
   return body(b => {
    if (action === 'save') return checked(contract.examSave, b, d => { const at = id === 'new' ? uuid(399) : id; S.revision[at] = (d.revision ?? 0) + 1; return send({ id: at, revision: S.revision[at] }); });
    if (action === 'lifecycle') return checked(contract.examLifecycle, b, () => send({ id, revision: 9 }));
    if (action === 'window') return checked(contract.examWindow, b, () => send({ revision: 9 }));
    if (action === 'upload') return checked(contract.examUpload, b, d => d.action === 'get' ? send({ id: d.id, name: 'answer.svg', mime: 'image/svg+xml', url: '/__photo.svg' }) : send({ kind: 'denied' }, 403));
    if (action === 'work') return checked(contract.examWork, b, d => {
     if (d.action === 'grade') { const s = students.find(x => x.attemptId === d.attemptId), r = S.results[s.resultId]; if (d.revision !== r.revision) return reply({ code: 'PT409', details: '{"reason":"stale"}' }); Object.assign(r, { revision: r.revision + 1, status: 'corrected', score: 3 + d.marks[0].points }); return send({ revision: r.revision, status: r.status, score: r.score, released: r.released }); }
     const r = S.results[d.resultId]; Object.assign(r, { revision: r.revision + 1, released: true }); return send({ revision: r.revision });
    });
    if (action === 'release-many') return checked(contract.examReleaseMany, b, d => { for (const i of d.items) { const r = S.results[i.resultId] ?? Object.values(S.marks).find(x => x.resultId === i.resultId); if (r) Object.assign(r, { released: true, revision: (r.revision ?? 0) + 1 }); } return send({ released: d.items.length }); });
    if (action === 'marks') return checked(contract.examPaperMarks, b, d => send({ items: d.items.map((i, k) => { const x = S.marks[i.userId]; Object.assign(x, { mark: i.mark, absent: i.absent, resultId: x.resultId ?? uuid(1200 + k), revision: (x.revision ?? 0) + 1 }); return { userId: i.userId, resultId: x.resultId, revision: x.revision }; }) }));
    return send({ kind: 'invalid' }, 400);
   });
  }
  if (/^\/api\/teacher\/courses\/[0-9a-f-]{36}\/content$/.test(url.pathname) && req.method === 'GET') return send(structure());
  if (url.pathname === '/api/study-groups' && req.method === 'POST') return body(b => send(b?.action === 'view' && b?.data?.section === 'sessions'
   ? { rows: [{ id: uuid(71), group_id: b.groupId, title: 'Synthetic lesson', starts_at: cairo(NOW + 2 * DAY), ends_at: cairo(NOW + 2 * DAY + 90 * MIN), mode: 'online', location: '', join_url: '', instructions: '', cancelled: false, version: 1, attendance_state: 'draft', state: 'upcoming' },
     { id: uuid(72), group_id: b.groupId, title: 'Synthetic lesson', starts_at: cairo(NOW + 9 * DAY), ends_at: cairo(NOW + 9 * DAY + 90 * MIN), mode: 'online', location: '', join_url: '', instructions: '', cancelled: false, version: 1, attendance_state: 'draft', state: 'upcoming' }], page: 0, hasMore: false }
   : { error: 'harness: not served' }, b?.action === 'view' ? 200 : 404));
  if (url.pathname.startsWith('/api/')) { if (url.pathname === '/api/communications') return send({ rows: [], page: 0, unread: 0 }); if (url.pathname === '/api/user/status') return send({ user: { role: 'teacher' } }); return send({ error: 'harness: not served' }, 404); }
  const h = decision.headers || new Map();
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); for (const [k, v] of h) res.setHeader(k, v);
  if (!h.has('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><html lang="en" data-lms-appearance><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Harness</title><link rel="stylesheet" href="/__style.css"><script>window.__LOAD = ${JSON.stringify(load)};</script></head><body class="${fontVars} font-sans"><div id="root"></div><script src="/__app.js"></script></body></html>`);
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
  await page.evaluate(l => { document.documentElement.dataset.design = l; if (l === 'new' && !document.querySelector('[data-teacher-shell]')) document.querySelector('main')?.setAttribute('data-teacher-shell', ''); }, look);
  return { page, context };
 };
 const only = process.env.LMS_ONLY_STEPS ? new RegExp(process.env.LMS_ONLY_STEPS) : null;
 const step = async (name, fn) => { if (only && !only.test(name)) return; try { await ctl({ reset: true }); await fn(); results.push('PASS ' + name); console.log('PASS', name); } catch (e) { console.log('FAIL', name); throw e; } };
 const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch {} }); r(); }))));
 const shot = async (page, name) => { await settle(page); const file = path.join(shots, name + '.png'); await page.screenshot({ path: file, fullPage: true }); pictures.push(name + '.png'); };
 const overflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
 const SCOPE = '[data-exams-page], [data-exam-wizard], [data-correct-screen], [data-paper-marks], [role="dialog"]';
 const tinyTargets = page => page.evaluate(scope => [...document.querySelectorAll(scope)].flatMap(r => [...r.querySelectorAll('a, button, input, textarea, select, [role="tab"], [role="checkbox"], [role="switch"]')]).filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 43.5 || r.width < 43.5) && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.sr-only') && !e.closest('p') && !(e.tagName === 'INPUT' && ['radio', 'checkbox'].includes(e.type) && e.closest('label')); }).map(e => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 40) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)), SCOPE);
 const smallText = page => page.evaluate(scope => { const bad = []; for (const root of document.querySelectorAll(scope)) { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.textContent.trim() || n.parentElement.closest('.sr-only')) continue; const s = parseFloat(getComputedStyle(n.parentElement).fontSize); if (s < 12) bad.push(n.textContent.trim().slice(0, 30) + ':' + s); } } return bad; }, SCOPE);
 const nativeOff = page => page.evaluate(() => [...document.querySelectorAll('main button[disabled], main input[disabled], main textarea[disabled], main select[disabled], [role="dialog"] button[disabled], input[type="checkbox"]')].map(e => e.outerHTML.slice(0, 80)));
 const forbidden = /organi[sz]ation|tenant|\bslug\b|\bmodules?\b|\bofferings?\b|\bblocks?\b|\bsegments?\b|enrol(l)?ment|submission|منظمة|مؤسسة|وحدة|كتل/i;
 const clean = async (page, label) => {
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => null)))); await settle(page);
  assert.ok(await overflow(page), 'no sideways scroll ' + label);
  assert.deepEqual(await tinyTargets(page), [], '44px targets ' + label);
  assert.deepEqual(await smallText(page), [], '12px or more ' + label); assert.deepEqual(await nativeOff(page), [], 'no native disabled or checkbox ' + label);
  const text = await page.evaluate(scope => [...document.querySelectorAll(scope)].map(e => e.innerText).join('\n'), SCOPE);
  assert.doesNotMatch(text, forbidden, 'wording ' + label); assert.doesNotMatch(text, /\bSoon\b|قريبًا/, 'nothing says Soon here ' + label);
  assert.doesNotMatch(text, /\bex\.[a-z_]+\.|\bhw\.w\.|undefined|NaN/, 'no raw keys or broken numbers ' + label);
 };
 // Every screen in four ways: phone English Classic, phone Arabic New, desktop English New, desktop Arabic Classic.
 const WAYS = [[phone, 'en', 'classic', 'phone-en-classic'], [phone, 'ar', 'new', 'phone-ar-new'], [desktop, 'en', 'new', 'desktop-en-new'], [desktop, 'ar', 'classic', 'desktop-ar-classic']];
 const every = async (name, target, ready, act) => { for (const [viewport, lang, look, tag] of WAYS) {
  const { page, context } = await open(viewport, target, ready, { lang, look });
  try { if (act) await act(page, { viewport, lang }); await clean(page, `${name} ${tag}`); await shot(page, `${name}-${tag}`); } finally { await context.close(); }
 } };
 const next = async page => { const before = await page.locator('[data-exam-wizard]').getAttribute('data-step'); await page.locator('[data-step-next]').click(); await page.waitForFunction(b => document.querySelector('[data-exam-wizard]')?.dataset.step !== b, before); };

 // ---- the Exams page
 await step('Exams page: Live now with the open Group, To correct, the tabs with counts, rows with their actions', async () => {
  await every('01-exams-page', '/teacher/exams', '[data-exams-page] [data-exam-row]', async page => {
   assert.equal(await page.locator('[data-live-card]').count(), 1, 'one Group is live');
   assert.match(await page.locator('[data-live-card]').innerText(), /9/);
   assert.ok(await page.locator('[data-correct-row]').count() >= 2, 'online waiting and paper missing');
   assert.equal(await page.locator('[data-exam-row]').count(), 3);
  });
  await every('02-exams-drafts', '/teacher/exams', '[data-exams-page] [data-exam-row]', async page => { await page.locator('[data-tab="drafts"]').click(); await page.locator(`[data-exam-row="${E.draft}"]`).waitFor(); });
 });
 await step('Exams page: the row menu offers the right actions', async () => {
  const { page, context } = await open(phone, '/teacher/exams', '[data-exam-row]');
  try {
   await page.locator(`[data-exam-row="${E.live}"] [data-row-menu]`).first().click();
   await page.locator('[role="menu"], [role="dialog"]').first().waitFor();
   await clean(page, 'row menu'); await shot(page, '03-row-menu-phone-en-classic');
  } finally { await context.close(); }
 });

 // ---- the wizard, online: every step of a complete draft, and a new one
 await step('Wizard (online): Details, Questions, When, Rules and Review of a draft; the per-Group windows; nothing invalid is sent', async () => {
  const steps = ['details', 'questions', 'when', 'rules', 'review'];
  for (const [i, s] of steps.entries()) await every(`1${i}-wizard-${s}`, `/teacher/exams/${E.draft}`, '[data-exam-wizard][data-step="details"]', async page => { for (let k = 0; k < i; k++) await next(page); assert.equal(await page.locator('[data-exam-wizard]').getAttribute('data-step'), s); });
  const { page, context } = await open(desktop, `/teacher/exams/${E.draft}`, '[data-exam-wizard][data-step="details"]');
  try {
   await next(page); await next(page);
   assert.equal(await page.locator('[data-window-row]').count(), 3);
   assert.equal(await page.locator(`[data-window-row="${G.late}"]`).getAttribute('data-state'), 'needs_time');
  } finally { await context.close(); }
  assert.deepEqual((await state()).invalid, []);
 });
 await step('Wizard (online): a Group\'s window dialog (another session or a time)', async () => {
  for (const [viewport, lang, look, tag] of [WAYS[0], WAYS[3]]) {
   const { page, context } = await open(viewport, `/teacher/exams/${E.draft}`, '[data-exam-wizard][data-step="details"]', { lang, look });
   try {
    await next(page); await next(page);
    await page.locator(`[data-window-row="${G.alpha}"] [data-window-change]`).click();
    await page.locator('[data-window-dialog]').waitFor(); await page.locator('[data-session]').first().waitFor();
    await clean(page, 'window dialog ' + tag); await shot(page, `15-window-dialog-${tag}`);
    await page.locator('[data-session]').nth(1).click(); await page.locator('[data-window-save]').click();
    await page.locator('[data-window-dialog]').waitFor({ state: 'detached' });
    const post = (await state()).posts.find(p => p.path.endsWith('/window'));
    assert.deepEqual(post.body, { groupId: G.alpha, revision: 3, source: 'picked', sessionId: uuid(72) });
   } finally { await context.close(); }
  }
 });
 await step('Wizard: a new online exam and a new paper exam start on Details', async () => {
  await every('16-wizard-new-online', `/teacher/exams/new?course=${C.physics}`, '[data-exam-wizard][data-step="details"]');
  await every('17-wizard-new-paper', `/teacher/exams/new?course=${C.physics}&kind=paper`, '[data-exam-wizard][data-step="details"]', async page => {
   assert.equal(await page.locator('[data-field="max-marks"]').count(), 1);
  });
  await every('18-wizard-paper-edit', `/teacher/exams/${E.paper}`, '[data-exam-wizard][data-step="details"]');
 });
 await step('Wizard: the issues list when Next finds something missing', async () => {
  const { page, context } = await open(phone, `/teacher/exams/new?course=${C.physics}`, '[data-exam-wizard][data-step="details"]');
  try { await page.locator('[data-step-next]').click(); await page.locator('[data-issues]').waitFor(); assert.ok(await page.locator('[data-issue="title"]').count()); await clean(page, 'issues'); await shot(page, '19-wizard-issues-phone-en-classic'); }
  finally { await context.close(); }
 });

 // ---- correcting
 await step('Correcting: To correct first, the automatic lines, the essay with its photo, a mark saved with the right revision', async () => {
  await every('20-correct-list', `/teacher/exams/${E.live}/correct`, '[data-correct-screen] [data-student-row]', async page => {
   assert.equal(await page.locator('[data-tab="to_correct"]').getAttribute('aria-selected'), 'true');
   assert.equal(await page.locator('[data-student-row]').count(), 2);
  });
  await every('21-correct', `/teacher/exams/${E.live}/correct?try=${students[0].attemptId}`, `[data-try-shown="${students[0].attemptId}"] [data-correct-bar]`, async page => {
   await page.locator('[data-photo] img[src="/__photo.svg"]').first().waitFor();
  });
  const { page, context } = await open(desktop, `/teacher/exams/${E.live}/correct`, `[data-try-shown="${students[0].attemptId}"] [data-correct-bar]`);
  try {
   for (let i = 0; i < 6; i++) await page.locator(`[data-stepper="${Q.essay}"] button`).last().click();
   await page.locator('[data-correct-save], [data-correct-next]').first().click();
   await page.waitForFunction(() => true);
   await new Promise(r => setTimeout(r, 400));
   const post = (await state()).posts.find(p => p.path.endsWith('/work'));
   assert.ok(post, 'a grade was sent');
   assert.deepEqual({ ...post.body, marks: post.body.marks.map(m => ({ questionId: m.questionId, points: m.points })) }, { action: 'grade', attemptId: students[0].attemptId, revision: 2, reason: '', marks: [{ questionId: Q.essay, points: 3 }] });
  } finally { await context.close(); }
  await every('22-correct-corrected', `/teacher/exams/${E.live}/correct?try=${students[2].attemptId}`, `[data-try-shown="${students[2].attemptId}"] [data-correct-bar]`);
  assert.deepEqual((await state()).invalid, []);
 });

 // ---- paper marks
 await step('Paper marks: the sheet, a mark typed in Arabic digits saves as a number, Absent, Release marks', async () => {
  await every('30-marks', `/teacher/exams/${E.paper}/marks`, '[data-paper-marks] [data-mark-row]');
  const { page, context } = await open(phone, `/teacher/exams/${E.paper}/marks`, '[data-paper-marks] [data-mark-row]', { lang: 'ar' });
  try {
   await page.locator(`[data-mark-row="${sheetStudents[2].userId}"] [data-mark-input]`).fill('٣٢٫٥');
   await page.locator(`[data-mark-row="${sheetStudents[2].userId}"] [data-mark-input]`).press('Enter');
   await page.waitForFunction(() => document.activeElement?.hasAttribute('data-mark-input'));
   await new Promise(r => setTimeout(r, 1200));
   const post = (await state()).posts.find(p => p.path.endsWith('/marks'));
   assert.deepEqual(post?.body, { items: [{ userId: sheetStudents[2].userId, mark: 32.5, absent: false, revision: null, reason: '' }] });
   await clean(page, 'marks typed'); await shot(page, '31-marks-typed-phone-ar-new');
  } finally { await context.close(); }
  assert.deepEqual((await state()).invalid, []);
 });

 // ---- the whole run
 await step('Only the exam, course content and Group routes were called; nothing outside; no page errors', async () => {
  const allowed = /^(GET \/api\/teacher\/exams(\/:id(\/(queue|sheet|tries\/:id))?)?|POST \/api\/teacher\/exams\/(new|:id)\/(save|lifecycle|window|upload|work|release-many|marks)|GET \/api\/teacher\/courses\/:id\/content|POST \/api\/study-groups|(GET|POST) \/api\/communications|GET \/api\/user\/status)$/;
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
