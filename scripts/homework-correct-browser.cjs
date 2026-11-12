// Correcting homework, the Home "Homework to correct" card and the student lesson page in Chromium: the real screens, the REAL middleware in
// front of every request, the real CSS and fonts. The server is fictional and synthetic (no customer records), every teacher request is checked
// against the real contract and every refusal is worded by the real reply mapper. Not provider acceptance.
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME / LMS_CHROMIUM_EXECUTABLE and a Firebase-mode `npm run build` (fonts). Pictures:
// .local/homework-correct-browser/screenshots, copied to docs/design/screenshots/homework-correct with LMS_COPY_SHOTS=correct (or 1).
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/homework-correct-browser'), shots = path.join(out, 'screenshots'), docs = path.resolve('docs/design/screenshots/homework-correct');
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

const entry = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { TeacherFrame } from '@/frontend/features/teacher-frame/teacher-frame';
import { CorrectScreen } from '@/frontend/features/teacher-homework/correct-screen';
import { TeacherHomeView } from '@/frontend/features/teacher-home/home-view';
import { LessonOverview } from '@/frontend/features/courses/lesson/lesson-overview';
import { buildTeacherHome, createTargets } from '@/shared/teacher-home';
let lang = 'en'; try { lang = localStorage.getItem('edulabs-lms-language') === 'ar' ? 'ar' : 'en'; } catch {}
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
const parts = location.pathname.split('/'), query = new URLSearchParams(location.search);
function Teacher() {
  const [raw, setRaw] = useState(null);
  const home = location.pathname === '/home';
  useEffect(() => { if (home) fetch('/__home').then(r => r.json()).then(setRaw); }, [home]);
  if (home) return raw ? <TeacherHomeView data={{ ...buildTeacherHome(raw.inputs), createTargets: createTargets(...raw.targets), demo: false, homework: raw.homework }} /> : null;
  return <CorrectScreen homeworkId={parts[3]} start={query.get('try')} />;
}
const student = parts[1] === 'courses';
createRoot(document.getElementById('root')).render(<LanguageProvider initialLanguage={lang}><ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
  {student ? <main className="min-h-screen bg-slate-50 p-4 md:p-8"><LessonOverview courseId={parts[2]} lessonId={parts[4]} offeringId={query.get('offering')} title="Magnetism review" module="Magnetism" back={'/courses/' + parts[2]} /></main>
    : <TeacherFrame><Teacher /></TeacherFrame>}
</ThemeProvider></LanguageProvider>);
`;

// ---- synthetic data (no customer records)
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const DAY = 86400000, iso = ms => new Date(ms).toISOString();
const COURSE = uuid(10), OFF = uuid(20), LESSON = uuid(203), HC = uuid(601), HA = uuid(611), HB = uuid(612);
const Q = { choice: uuid(401), unit: uuid(402), essay: uuid(403) };
const opt = n => uuid(500 + n);
const questions = [
 { id: Q.choice, type: 'single_choice', text: '', imageId: null, points: 1, responseMode: 'text', modelAnswer: '', options: [0, 1, 2, 3].map(i => ({ id: opt(10 + i), text: '' })), correctIds: [opt(11)] },
 { id: Q.unit, type: 'single_choice', text: 'Which is the unit of magnetic field strength?', imageId: null, points: 1, responseMode: 'text', modelAnswer: '', options: [{ id: opt(21), text: 'tesla' }, { id: opt(22), text: 'newton' }, { id: opt(23), text: 'joule' }], correctIds: [opt(21)] },
 { id: Q.essay, type: 'essay', text: 'Explain why two north poles push each other away.', imageId: null, points: 4, responseMode: 'both', modelAnswer: 'Like poles repel: the field lines between them push apart, so the magnets move away from each other.', options: [], correctIds: [] },
];
const definition = { title: 'Magnetism review homework', mode: 'PLATFORM_QUESTIONS', questions, rules: { maxTries: 2 } };
const students = [
 ['Synthetic Student 1', 'photo'], ['طالبة تجريبية ٢', 'deleted'], ['Synthetic Student 3', 'late'], ['Synthetic Student 4', 'kept'], ['Synthetic Student 5', 'blank'],
 ['Synthetic Student 6', 'corrected'], ['Synthetic Student 7', 'released'],
].map(([name, kind], i) => ({ name, kind, userId: uuid(700 + i), submissionId: uuid(800 + i) }));
const missing = [['Synthetic Student 8', uuid(720)], ['طالب تجريبي ٩', uuid(721)]];
const NOW = Date.now(), deadline = iso(NOW - DAY);
function tryOf(s) {
 const late = s.kind === 'late', kept = s.kind === 'kept';
 const answers = [
  { questionId: Q.choice, optionIds: [s.kind === 'deleted' ? opt(13) : opt(11)], text: '', fileIds: [], ...(kept ? { kept: true } : {}) },
  ...(s.kind === 'blank' ? [] : [{ questionId: Q.unit, optionIds: [s.kind === 'photo' ? opt(22) : opt(21)], text: '', fileIds: [] }]),
  { questionId: Q.essay, optionIds: [], text: s.kind === 'deleted' ? 'الأقطاب المتشابهة تتنافر لأن خطوط المجال بينها تتدافع.' : 'Two north poles repel because like poles push each other away. The field lines between them do not join, so they push apart.', fileIds: ['photo', 'deleted'].includes(s.kind) ? [uuid(900 + students.indexOf(s))] : [] },
 ];
 const files = ['photo', 'deleted'].includes(s.kind) ? [{ id: uuid(900 + students.indexOf(s)), name: 'answer.jpg', mime: 'image/jpeg', ...(s.kind === 'deleted' ? { deleted: true } : {}) }] : [];
 const done = s.kind === 'corrected' || s.kind === 'released';
 const correction = done ? { status: 'approved', revision: 2, released: s.kind === 'released', score: 5, feedback: 'Clear answer.', marks: [{ questionId: Q.essay, points: 3, feedback: 'Name the field lines.' }] }
  : { status: 'submitted', revision: 1, released: false, score: null, feedback: '', marks: [] };
 return { id: s.submissionId, revision: 1, number: kept ? 2 : 1, status: 'submitted', submittedAt: iso(NOW - (late ? 0.3 : 1.4) * DAY), missedDeadline: late, answers, files, correction };
}
function fresh() { return { stale: false, manyStale: false, retry: 'ok', retried: false, posts: [], invalid: [], tries: Object.fromEntries(students.map(s => [s.submissionId, tryOf(s)])) }; }
let S = fresh();
const stateOf = t => t.correction.released ? 'released' : t.correction.score !== null ? 'corrected' : 'waiting';
function queue(q) {
 const rows = students.map(s => { const t = S.tries[s.submissionId]; return { userId: s.userId, name: s.name, submissionId: s.submissionId, try: t.number, submittedAt: t.submittedAt, late: t.missedDeadline, waiting: stateOf(t) === 'waiting' ? 1 : 0, status: t.correction.score === null ? 'submitted' : 'corrected', released: t.correction.released, score: t.correction.score, revision: t.correction.revision }; });
 const toCorrect = rows.filter(r => r.waiting), done = rows.filter(r => !r.waiting), gone = missing.map(([name, userId]) => ({ userId, name }));
 const list = { to_correct: toCorrect, done, missing: gone }[q.tab];
 const releasable = done.filter(r => !r.released).map(r => ({ submissionId: r.submissionId, revision: r.revision }));
 return { tab: q.tab, page: q.page, pageSize: 50, serverNow: iso(Date.now()), readyToRelease: releasable.length, releasable,
  homework: { id: HC, title: definition.title, courseId: COURSE, offeringId: OFF, lessonId: LESSON, version: 1, workflow: 'questions', mode: 'PLATFORM_QUESTIONS', status: 'published', deadline, lateAllowed: true, tries: 'fix_mistakes', maxTries: 2, solutionsOpen: 'after_hand_in', photosAllowed: true, canCorrect: true, canRelease: true },
  counts: { toCorrect: toCorrect.length, done: done.length, missing: gone.length, handedIn: rows.length, total: rows.length + gone.length, late: rows.filter(r => r.late).length },
  rows: list.slice(q.page * 50, q.page * 50 + 50) };
}
const tryView = id => ({ id: HC, revision: 3, staff: true, canGrade: true, canRelease: true, workflow: 'questions', definition, submissions: [S.tries[id]] });
const homeRaw = () => {
 const ok = value => ({ ok: true, value });
 const group = (n, name) => ({ id: uuid(n), offering_id: uuid(100 + n), offering_name: 'Synthetic offering', name, description: '', mode: 'online', location: '', join_url: '', instructions: '', capacity: null, status: 'active', version: 1, staff: true, instructor: false });
 const at = m => iso(NOW + m * 60000);
 const session = (n, g, name, start) => ({ id: uuid(200 + n), group_id: uuid(g), group_name: name, title: 'Synthetic lesson ' + n, starts_at: at(start), ends_at: at(start + 60), mode: 'online', location: '', join_url: '', instructions: '', cancelled: false, version: 1, attendance_state: 'draft', state: 'upcoming' });
 return { targets: [[{ id: uuid(50), name: 'Synthetic space', status: 'active' }], [{ organization_id: uuid(50), role: 'teacher', status: 'active' }]],
  inputs: { courses: ok([{ id: COURSE, organization_id: uuid(50), title: 'Synthetic Physics 9', status: 'published' }]), now: NOW,
   groups: ok({ rows: [group(1, 'Synthetic Group Alpha'), group(2, 'مجموعة الصف العاشر')], page: 0, hasMore: false }),
   upcoming: ok({ rows: [session(1, 1, 'Synthetic Group Alpha', 1500), session(2, 2, 'مجموعة الصف العاشر', 3000)], page: 0 }),
   notifications: ok({ rows: [], page: 0, unread: 0 }), unsaved: ok([]), metrics: ok({ totalStudents: 41, pendingWaitlistCount: 0 }), nextFacts: { kind: 'marked', marked: 9, total: 14 } },
  homework: { state: 'ready', data: { items: [{ id: HC, title: definition.title, courseTitle: 'Synthetic Physics 9', waiting: 5 }, { id: uuid(602), title: 'واجب القراءة الأول', courseTitle: 'لغة عربية — الصف التاسع', waiting: 3 }], more: 0 } } };
};
// The student side: two homework in the lesson with no part. A: handed in, a second try allowed (Try again). B: handed in late (Missed the deadline).
const studentQuestions = questions.map(({ correctIds, modelAnswer, ...q }) => q);
const studentView = id => {
 const a = id === HA, retried = a && S.retried;
 const handed = { id: uuid(a ? 851 : 852), revision: 1, number: 1, status: 'submitted', submittedAt: iso(NOW - (a ? 2 : 0.2) * DAY), missedDeadline: !a,
  answers: [{ questionId: Q.choice, optionIds: [opt(11)], text: '', fileIds: [] }, { questionId: Q.unit, optionIds: [opt(22)], text: '', fileIds: [] }, { questionId: Q.essay, optionIds: [], text: 'Like poles repel.', fileIds: [] }], files: [],
  correction: { status: 'submitted', revision: 1, released: false, score: null, feedback: '', marks: [], annotations: [] } };
 const draft = { id: uuid(853), revision: 1, number: 2, status: 'draft', submittedAt: null, answers: [{ questionId: Q.choice, optionIds: [opt(11)], text: '', fileIds: [], kept: true }], files: [] };
 return { id, offeringId: OFF, lessonId: LESSON, segmentId: null, revision: 2, locked: true, staff: false, canGrade: false, canRelease: false, workflow: 'questions',
  definition: { title: a ? 'Magnetism review homework' : 'Magnets around the house', instructions: 'Answer in your own words.', mode: 'PLATFORM_QUESTIONS', published: true, questions: studentQuestions },
  deadline: a ? iso(NOW + 2 * DAY) : iso(NOW - DAY), deadlinePassed: !a, triesUsed: retried ? 2 : 1, triesLeft: a ? (retried ? 0 : 1) : 0, canStart: false, canRetry: a && !retried, triesEnded: false,
  submissions: [retried ? draft : handed], solutions: retried ? null : { text: 'Like poles repel.', video: '', videoId: null, files: [], keys: [] }, references: [] };
};
const photo = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#fbf8ef"/>' +
 Array.from({ length: 14 }, (_, i) => `<line x1="40" x2="860" y1="${70 + i * 38}" y2="${70 + i * 38}" stroke="#c9d7ea" stroke-width="2"/>`).join('') +
 '<g fill="none" stroke="#1d3a8a" stroke-width="4" stroke-linecap="round"><path d="M90 150 q30 -40 60 0 t60 0 t60 0"/><path d="M90 230 q40 -30 80 0 t80 0"/><rect x="360" y="300" width="160" height="70"/><rect x="560" y="300" width="160" height="70"/><path d="M530 335 h20 M545 325 l10 10 -10 10 M550 335 h-20"/></g>' +
 '<text x="390" y="345" font-size="36" font-family="Arial" fill="#1d3a8a">S  N</text><text x="590" y="345" font-size="36" font-family="Arial" fill="#1d3a8a">N  S</text></svg>';

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

 const requests = [];
 const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
  const body = cb => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => { let b = null; try { b = JSON.parse(Buffer.concat(parts).toString() || '{}'); } catch { b = undefined; } cb(b); }); };
  const reply = e => { const r = hw.homeworkReply(e); return send(r.body, r.status); };
  if (url.pathname === '/__app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
  if (url.pathname === '/__style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname === '/__photo.svg') { res.setHeader('Content-Type', 'image/svg+xml'); return res.end(photo); }
  if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
  if (url.pathname === '/__ctl') return body(b => { if (b.reset) S = fresh(); for (const k of ['stale', 'manyStale', 'retry']) if (k in b) S[k] = b[k]; send({}); });
  if (url.pathname === '/__state') return send({ posts: S.posts, invalid: S.invalid });
  if (url.pathname === '/__home') return send(homeRaw());
  requests.push(req.method + ' ' + url.pathname);
  const decision = gate(url.pathname);
  if (decision.kind === 'json') return send({ error: 'This legacy workflow is unavailable in Firebase staging.' }, decision.status);
  if (decision.kind === 'redirect') { res.statusCode = 307; res.setHeader('Location', decision.location); return res.end(); }
  if (decision.kind !== 'next') return send({ error: 'harness: middleware said ' + decision.kind }, 500);
  const teacher = url.pathname.match(/^\/api\/teacher\/homework\/([0-9a-f-]{36})\/(queue|release-many|tries\/([0-9a-f-]{36}))$/);
  if (teacher && teacher[1] !== HC) return send({ kind: 'denied' }, 404);
  if (teacher && teacher[2] === 'queue' && req.method === 'GET') {
   const keys = [...url.searchParams.keys()], q = contract.queueQuery.safeParse(Object.fromEntries(url.searchParams));
   if (!q.success || keys.length !== new Set(keys).size) { S.invalid.push(url.search); return send({ kind: 'invalid' }, 400); }
   return send(queue(q.data));
  }
  if (teacher && teacher[3] && req.method === 'GET') { if (url.search) { S.invalid.push(url.search); return send({ kind: 'invalid' }, 400); } return S.tries[teacher[3]] ? send(tryView(teacher[3])) : send({ kind: 'denied' }, 404); }
  if (teacher && teacher[3] && req.method === 'POST') return body(b => {
   S.posts.push({ path: url.pathname, body: b });
   const parsed = contract.tryWrite.safeParse(b), t = S.tries[teacher[3]];
   if (!parsed.success) { S.invalid.push(b); return send({ kind: 'invalid' }, 400); }
   if (!t) return send({ kind: 'denied' }, 404);
   if (S.stale || parsed.data.revision !== t.correction.revision) return reply({ code: 'PT409', message: 'Correction changed; reload' });
   if (parsed.data.action === 'grade') {
    if (t.correction.released && parsed.data.reason.trim().length < 3) return reply({ code: '22023', message: 'A reason is required to change a released grade', details: '{"reason":"reason_required"}' });
    const essay = parsed.data.marks.find(m => m.questionId === Q.essay);
    const auto = (t.answers.find(a => a.questionId === Q.choice)?.optionIds[0] === opt(11) ? 1 : 0) + (t.answers.find(a => a.questionId === Q.unit)?.optionIds[0] === opt(21) ? 1 : 0);
    t.correction = { status: essay ? 'approved' : 'under_correction', revision: t.correction.revision + 1, released: false, score: essay ? auto + essay.points : null, feedback: parsed.data.feedback, marks: parsed.data.marks };
    return send({ submissionId: t.id, revision: t.correction.revision });
   }
   if (stateOf(t) !== 'corrected') return reply({ code: 'PT409', message: 'Not ready', details: '{"reason":"unfinished"}' });
   t.correction = { ...t.correction, released: true, revision: t.correction.revision + 1 };
   return send({ submissionId: t.id, revision: t.correction.revision });
  });
  if (teacher && teacher[2] === 'release-many' && req.method === 'POST') return body(b => {
   S.posts.push({ path: url.pathname, body: b });
   const parsed = contract.releaseMany.safeParse(b);
   if (!parsed.success) { S.invalid.push(b); return send({ kind: 'invalid' }, 400); }
   if (S.manyStale || parsed.data.items.some(i => S.tries[i.submissionId]?.correction.revision !== i.revision)) return reply({ code: 'PT409', message: 'Corrections changed', details: '{"reason":"stale"}' });
   for (const i of parsed.data.items) S.tries[i.submissionId].correction = { ...S.tries[i.submissionId].correction, released: true, revision: i.revision + 1 };
   return send({ released: parsed.data.items.length });
  });
  const student = url.pathname.match(/^\/api\/homework\/([0-9a-f-]{36}|new)\/([a-z-]+)$/);
  if (student && req.method === 'POST') return body(b => {
   const [, id, action] = student;
   if (action === 'media') return send({ id: b.id, name: 'answer.jpg', mime: 'image/svg+xml', url: '/__photo.svg' });
   if (action === 'list') return send({ rows: [{ id: HA, title: 'Magnetism review homework', status: 'published', mode: 'PLATFORM_QUESTIONS', offering_id: OFF, version: 1 }, { id: HB, title: 'Magnets around the house', status: 'published', mode: 'PLATFORM_QUESTIONS', offering_id: OFF, version: 1 }], hasMore: false, total: 2 });
   if (action === 'get') return send(studentView(id));
   if (action === 'revisions') return send({ rows: [], total: 0, page: 0 });
   if (action === 'history') return send({ rows: [], total: 0, page: 0 });
   if (action === 'work') {
    S.posts.push({ path: url.pathname, body: b });
    if (b.action !== 'retry') return send({ error: 'harness: only retry' }, 400);
    if (S.retry !== 'ok') return send({ error: S.retry === 'deadline_passed' ? 'The deadline has passed' : 'No tries left', reason: S.retry }, 409);
    S.retried = true; return send(studentView(id).submissions[0]);
   }
   return send({ error: 'harness: not served' }, 404);
  });
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
 const CORRECT = `/teacher/homework/${HC}/correct`, LESSON_PAGE = `/courses/${COURSE}/lessons/${LESSON}?offering=${OFF}`;
 const open = async (viewport, { lang = 'en', look = 'classic', target = CORRECT, ready = '[data-correct-screen]' } = {}) => {
  const context = await browser.newContext({ viewport, locale: lang });
  await context.addInitScript(([l]) => { try { localStorage.setItem('edulabs-lms-language', l); localStorage.setItem('edulabs-lms-appearance', 'light'); } catch {} }, [lang]);
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
 // Measured: the parts this change adds (the correcting screen, its dialog, the Home card); Home's other cards are not part of it.
 const SCOPE = '[data-correct-screen], [data-section="th-homework"], [role="dialog"]';
 const tinyTargets = page => page.evaluate(scope => [...document.querySelectorAll(scope)].flatMap(r => [...r.querySelectorAll('a, button, input, textarea, [role="tab"]')]).filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.height < 43.5 || r.width < 43.5) && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.sr-only') && !e.closest('p'); }).map(e => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 40) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)), SCOPE);
 const smallText = page => page.evaluate(scope => { const bad = []; for (const root of document.querySelectorAll(scope)) { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.textContent.trim() || n.parentElement.closest('.sr-only')) continue; const s = parseFloat(getComputedStyle(n.parentElement).fontSize); if (s < 12) bad.push(n.textContent.trim().slice(0, 30) + ':' + s); } } return bad; }, SCOPE);
 const nativeOff = page => page.evaluate(() => [...document.querySelectorAll('main button[disabled], main input[disabled], main textarea[disabled], [role="dialog"] button[disabled], input[type="checkbox"]')].map(e => e.outerHTML.slice(0, 80)));
 const forbidden = /organi[sz]ation|tenant|\bslug\b|\bmodules?\b|\bofferings?\b|\bblocks?\b|\bsegments?\b|enrol(l)?ment|submission|منظمة|مؤسسة|وحدة|كتل/i;
 // Teacher screens: the teacher design rules. The student page keeps the existing student styles (not restyled here): no sideways scroll only.
 const clean = async (page, label, teacher = true) => {
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => null)))); await settle(page);
  assert.ok(await overflow(page), 'no sideways scroll ' + label);
  if (!teacher) return;
  assert.deepEqual(await tinyTargets(page), [], '44px targets ' + label);
  assert.deepEqual(await smallText(page), [], '12px or more ' + label); assert.deepEqual(await nativeOff(page), [], 'no native disabled or checkbox ' + label);
  // The words of this change only (Home's other cards are not part of it).
  const text = await page.evaluate(scope => [...document.querySelectorAll(scope)].map(e => e.innerText).join('\n'), SCOPE);
  assert.doesNotMatch(text, forbidden, 'wording ' + label); assert.doesNotMatch(text, /\bSoon\b|قريبًا/, 'nothing says Soon here ' + label);
 };
 const lastPost = async () => (await state()).posts.at(-1);
 const S0 = students[0].submissionId, SDEL = students[1].submissionId, SLATE = students[2].submissionId, SKEPT = students[3].submissionId, SDONE = students[5].submissionId, SREL = students[6].submissionId;
 const tryReady = id => `[data-try-shown="${id}"] [data-correct-bar]`;

 // ---- behaviour
 await step('Correcting: To correct first, the choice summary with letters, the essay with its photo through the media route, Save and next student', async () => {
  const { page, context } = await open(desktop, { ready: tryReady(S0) });
  try {
   assert.equal(await page.locator('[data-tab="to_correct"]').getAttribute('aria-selected'), 'true');
   assert.match(await page.locator('[data-tab="to_correct"]').innerText(), /5/);
   assert.equal(await page.locator('[data-student-row]').count(), 5);
   assert.equal(await page.locator(`[data-student-row="${S0}"]`).getAttribute('aria-current'), 'true');
   assert.match(new URL(page.url()).search, new RegExp('try=' + S0));
   assert.equal(await page.locator('[data-choice]').count(), 2); assert.equal(await page.locator('[data-choice][data-right]').count(), 1);
   assert.match(await page.locator('[data-choice-summary]').innerText(), /B/);
   await page.locator(`[data-photo] img[src="/__photo.svg"]`).waitFor();
   assert.equal(await page.locator('[data-photo-open]').getAttribute('target'), '_blank');
   await page.locator('[data-model-toggle]').click(); await page.locator('[data-model-answer]').waitFor();
   assert.match(await page.locator('[data-incomplete]').innerText(), /.+/);
   await page.locator(`[data-stepper="${Q.essay}"] button`).last().click(); await page.locator(`[data-stepper="${Q.essay}"] button`).last().click(); await page.locator(`[data-stepper="${Q.essay}"] button`).last().click();
   assert.equal(await page.locator(`[data-stepper-value]`).getAttribute('data-stepper-value'), '3');
   await page.locator('[data-essay-note] textarea').fill('Good: name the field lines next time.');
   await page.locator('[data-overall-note] textarea').fill('Well done.');
   await page.locator('[data-correct-next]').click();
   await page.locator(tryReady(SDEL)).waitFor();
   const post = (await state()).posts.find(p => p.path.endsWith(S0));
   assert.deepEqual(post.body, { action: 'grade', revision: 1, feedback: 'Well done.', reason: '', marks: [{ questionId: Q.essay, points: 3, feedback: 'Good: name the field lines next time.' }] });
   assert.equal(await page.locator('[data-student-row]').count(), 4, 'the corrected student left To correct');
   assert.match(await page.locator('[data-correct-live]').innerText(), /.+/);
  } finally { await context.close(); }
 });
 await step('Correcting: a deleted photo says so and asks for nothing; Missed the deadline; a kept answer is not editable', async () => {
  const { page, context } = await open(desktop, { target: CORRECT + '?try=' + SDEL, ready: tryReady(SDEL) });
  try {
   assert.match(await page.locator('[data-photo-deleted]').innerText(), /Image deleted to free space/);
   assert.equal(await page.locator('[data-photo]').count(), 0);
   await page.locator(`[data-student-row="${SLATE}"]`).click(); await page.locator(tryReady(SLATE)).waitFor();
   await page.locator('[data-try-state] [data-missed]').waitFor();
   await page.locator(`[data-student-row="${SKEPT}"]`).click(); await page.locator(tryReady(SKEPT)).waitFor();
   assert.match(await page.locator('[data-choice-summary]').innerText(), /kept|Kept/i);
  } finally { await context.close(); }
 });
 await step('Correcting: a change made elsewhere keeps the typing and offers Reload; Reload keeps it and the next save goes through', async () => {
  await ctl({ stale: true });
  const { page, context } = await open(desktop, { ready: tryReady(S0) });
  try {
   await page.locator(`[data-stepper="${Q.essay}"] button`).last().click();
   await page.locator('[data-overall-note] textarea').fill('Typed before the change.');
   await page.locator('[data-correct-save]').click();
   await page.locator('[data-correct-failure="changed"] [data-correct-reload]').waitFor();
   assert.equal(await page.locator('[data-overall-note] textarea').inputValue(), 'Typed before the change.');
   await ctl({ stale: false });
   await page.locator('[data-correct-reload]').click();
   await page.waitForFunction(() => !document.querySelector('[data-correct-failure]'));
   assert.equal(await page.locator('[data-overall-note] textarea').inputValue(), 'Typed before the change.', 'Reload keeps the typing');
   await page.locator('[data-correct-save]').click();
   await page.waitForFunction(id => document.querySelector(`[data-correct-try="${id}"]`)?.dataset.tryState === 'corrected', S0);
  } finally { await context.close(); }
 });
 await step('Correcting: release one; a released grade changes only with a reason; Release N grades sends the queue list, refuses all on a change', async () => {
  const { page, context } = await open(desktop, { target: CORRECT + '?try=' + SDONE, ready: tryReady(SDONE) });
  try {
   assert.match(await page.locator('[data-release-many]').innerText(), /1/);
   await page.locator('[data-tab="done"][aria-selected="true"]').waitFor(); await page.locator(`[data-student-row="${SDONE}"][aria-current="true"]`).waitFor();
   assert.match(await page.locator('#hw-c-try').innerText(), /Synthetic Student 6/, 'a student opened by address keeps their name');
   await page.locator('[data-release-one]').click();
   await page.waitForFunction(id => document.querySelector(`[data-correct-try="${id}"]`)?.dataset.tryState === 'released', SDONE);
   assert.deepEqual((await lastPost()).body, { action: 'release', revision: 2, reason: '' });
   assert.equal(await page.locator('[data-release-many]').count(), 0, 'nothing left to release');
   await page.locator(`[data-stepper="${Q.essay}"] button`).first().click();
   await page.locator('[data-edit-reason]').waitFor();
   await page.locator('[data-correct-save]').click();
   assert.equal(await page.locator('[data-edit-reason] input').getAttribute('aria-invalid'), 'true', 'no reason, nothing sent');
   await page.locator('[data-edit-reason] input').fill('Marked twice by mistake');
   await page.locator('[data-correct-save]').click();
   await page.waitForFunction(id => document.querySelector(`[data-correct-try="${id}"]`)?.dataset.tryState === 'corrected', SDONE);
   assert.equal((await lastPost()).body.reason, 'Marked twice by mistake');
  } finally { await context.close(); }
  await ctl({ reset: true, manyStale: true });
  const second = await open(desktop, { target: CORRECT + '?try=' + SDONE, ready: tryReady(SDONE) });
  try {
   const p = second.page;
   await p.locator('[data-release-many-open]').click(); await p.locator('[data-release-many-confirm]').click();
   await p.locator('[data-release-many-error="changed"]').waitFor(); await p.locator('[data-release-many-reload]').waitFor();
   assert.deepEqual((await lastPost()).body, { items: [{ submissionId: SDONE, revision: 2 }] }, 'the queue list exactly');
   await ctl({ manyStale: false });
   await p.locator('[data-release-many-reload]').click(); await p.locator('[data-release-many-confirm]').click();
   await p.locator('[data-release-many-dialog]').waitFor({ state: 'detached' });
   await p.waitForFunction(id => document.querySelector(`[data-correct-try="${id}"]`)?.dataset.tryState === 'released', SDONE);
  } finally { await second.context.close(); }
 });
 await step('Correcting on a phone: the list first, a student opens alone with a position and Back to the list', async () => {
  const { page, context } = await open(phone, { ready: '[data-student-row]' });
  try {
   assert.equal(await page.locator('[data-correct-try]').count(), 0);
   await page.locator(`[data-student-row="${S0}"]`).click(); await page.locator(tryReady(S0)).waitFor();
   assert.equal(await page.locator('[data-correct-students]').count(), 0);
   assert.match(await page.locator('[data-correct-position]').innerText(), /1.*5/);
   assert.equal(await page.locator('[data-correct-save]').count(), 0, 'one Save and next on a phone');
   await page.locator('[data-correct-list]').click(); await page.locator('[data-correct-students]').waitFor();
  } finally { await context.close(); }
  // A change made elsewhere on a phone: Reload is reachable, not covered by the sticky bar or the bottom tabs.
  await ctl({ reset: true, stale: true });
  const second = await open(phone, { target: CORRECT + '?try=' + S0, ready: tryReady(S0) });
  try {
   const p = second.page;
   await p.locator(`[data-stepper="${Q.essay}"] button`).last().click(); await p.locator('[data-correct-next]').click();
   const reload = p.locator('[data-correct-reload]'); await reload.waitFor();
   await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
   await reload.scrollIntoViewIfNeeded();
   assert.ok(await reload.evaluate(e => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === e || e.contains(hit); }), 'Reload is what a tap reaches');
   await ctl({ stale: false }); await reload.click(); await p.waitForFunction(() => !document.querySelector('[data-correct-failure]'));
  } finally { await second.context.close(); }
 });
 await step('Home: Homework to correct lists the waiting homework, each one tap to its correcting screen', async () => {
  const { page, context } = await open(desktop, { target: '/home', ready: '[data-section="th-homework"]' });
  try {
   assert.equal(await page.locator('[data-homework-correct]').count(), 2);
   assert.equal(await page.locator(`[data-homework-correct="${HC}"] a, a[data-homework-correct="${HC}"]`).first().getAttribute('href'), CORRECT);
   assert.equal(await page.locator('[data-homework-all]').getAttribute('href'), '/teacher/homework');
  } finally { await context.close(); }
 });
 await step('Student: the lesson with no part shows its homework; Try again starts a new try with the kept answer locked; a refusal is said plainly', async () => {
  const { page, context } = await open(desktop, { target: LESSON_PAGE, ready: '[data-lesson-page]' });
  try {
   await page.getByRole('button', { name: /Magnetism review homework/ }).click();
   await page.locator('[data-try-again]').waitFor();
   assert.match(await page.locator('[data-homework-rules]').innerText(), /1/);
   await page.locator('[data-try-again]').click();
   await page.locator(`[data-kept-answer="${Q.choice}"]`).waitFor();
   assert.deepEqual((await lastPost()).body, { action: 'retry', submissionId: uuid(851), revision: 1, data: {} });
  } finally { await context.close(); }
  await ctl({ reset: true, retry: 'deadline_passed' });
  const ar = await open(desktop, { lang: 'ar', target: LESSON_PAGE, ready: '[data-lesson-page]' });
  try {
   await ar.page.locator('[data-lesson-page] section button').first().click();
   await ar.page.locator('[data-try-again]').click();
   assert.match(await ar.page.locator('[data-lesson-page] [role="alert"]').innerText(), /الموعد/);
  } finally { await ar.context.close(); }
 });

 // ---- pictures
 const toStudent = (id) => async p => { await p.locator('[data-lesson-page] section button').nth(id === HA ? 0 : 1).click(); await p.locator('[data-homework-rules]').waitFor(); };
 const screens = [
  { name: 'correct-choice-essay-photo', target: CORRECT + '?try=' + S0, ready: tryReady(S0), act: async p => { await p.locator('[data-photo] img').waitFor(); await p.locator(`[data-stepper="${Q.essay}"] button`).last().click(); } },
  { name: 'correct-photo-deleted', target: CORRECT + '?try=' + SDEL, ready: tryReady(SDEL) },
  { name: 'correct-missed-deadline', target: CORRECT + '?try=' + SLATE, ready: tryReady(SLATE), sizes: ['desktop'] },
  { name: 'correct-release-confirm', target: CORRECT + '?try=' + SDONE, ready: tryReady(SDONE), act: async p => { await p.locator('[data-release-many-open]').click(); await p.locator('[data-release-many-dialog]').waitFor(); } },
  { name: 'correct-release-changed', target: CORRECT + '?try=' + SDONE, ready: tryReady(SDONE), before: { manyStale: true }, sizes: ['desktop'], act: async p => { await p.locator('[data-release-many-open]').click(); await p.locator('[data-release-many-confirm]').click(); await p.locator('[data-release-many-error]').waitFor(); } },
  { name: 'correct-stale', target: CORRECT + '?try=' + S0, ready: tryReady(S0), before: { stale: true }, act: async p => { await p.locator(`[data-stepper="${Q.essay}"] button`).last().click(); await p.locator('[data-overall-note] textarea').fill('Typed before the change.'); await p.locator('[data-correct-next]').click(); await p.locator('[data-correct-reload]').waitFor(); } },
  { name: 'correct-released-reason', target: CORRECT + '?try=' + SREL, ready: tryReady(SREL), sizes: ['desktop'], act: async p => { await p.locator(`[data-stepper="${Q.essay}"] button`).first().click(); await p.locator('[data-edit-reason]').waitFor(); } },
  { name: 'correct-list', target: CORRECT, ready: '[data-student-row]', sizes: ['phone'] },
  { name: 'correct-done-tab', target: CORRECT + '?try=' + SDONE, ready: tryReady(SDONE), sizes: ['desktop'], act: async p => { await p.locator('[data-tab="done"]').click(); await p.locator('[data-tab-panel="done"] [data-student-row]').first().waitFor(); } },
  { name: 'home-card', target: '/home', ready: '[data-section="th-homework"]' },
  { name: 'student-lesson-no-parts', target: LESSON_PAGE, ready: '[data-lesson-page] section button', student: true },
  { name: 'student-try-again', target: LESSON_PAGE, ready: '[data-lesson-page] section button', student: true, act: toStudent(HA) },
  { name: 'student-missed-deadline', target: LESSON_PAGE, ready: '[data-lesson-page] section button', student: true, act: toStudent(HB) },
  { name: 'student-kept-answer', target: LESSON_PAGE, ready: '[data-lesson-page] section button', student: true, sizes: ['desktop'], act: async p => { await toStudent(HA)(p); await p.locator('[data-try-again]').click(); await p.locator('[data-kept-answer]').waitFor(); } },
  { name: 'student-refused', target: LESSON_PAGE, ready: '[data-lesson-page] section button', student: true, before: { retry: 'no_tries_left' }, sizes: ['desktop'], act: async p => { await toStudent(HA)(p); await p.locator('[data-try-again]').click(); await p.locator('[data-lesson-page] [role="alert"]').waitFor(); } },
 ];
 const SIZES = { desktop, phone };
 await step('Pictures: correcting, the Home card and the student lesson page, both looks, both languages, desktop 1360 and phone 390, each measured', async () => {
  for (const s of screens) for (const look of ['classic', 'new']) for (const lang of ['en', 'ar']) for (const size of s.sizes ?? ['desktop', 'phone']) {
   await ctl({ reset: true, ...(s.before ?? {}) });
   const label = `${s.name}-${size}-${look}-${lang}`;
   const { page, context } = await open(SIZES[size], { lang, look, target: s.target, ready: s.ready });
   try {
    if (s.act) await s.act(page);
    if (lang === 'ar') assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    await clean(page, label, !s.student);
    await shot(page, label);
   } finally { await context.close(); }
  }
 });

 await browser.close(); server.close();
 assert.deepEqual(errors, [], 'no uncaught or console errors');
 assert.deepEqual(external, [], 'no external requests');
 assert.deepEqual((await Promise.resolve(S.invalid)), [], 'every request matched the contract');
 const apis = [...new Set(requests.filter(r => /\/api\//.test(r)).map(r => r.replace(/[0-9a-f-]{36}/g, ':id')))].sort();
 assert.deepEqual(apis.filter(r => !/^(GET \/api\/teacher\/homework\/:id\/(queue|tries\/:id)|POST \/api\/teacher\/homework\/:id\/(tries\/:id|release-many)|POST \/api\/homework\/(:id|new)\/(list|get|revisions|history|work|media)|(GET|POST) \/api\/communications|GET \/api\/user\/status)$/.test(r)), [], 'only the correcting and student homework routes: ' + apis.join(', '));
 if (process.env.LMS_COPY_SHOTS === 'correct' || process.env.LMS_COPY_SHOTS === '1') {
  fs.mkdirSync(docs, { recursive: true }); for (const f of fs.readdirSync(docs)) if (f.endsWith('.png')) fs.unlinkSync(path.join(docs, f));
  for (const f of pictures) fs.copyFileSync(path.join(shots, f), path.join(docs, f));
  fs.writeFileSync(path.join(docs, 'README.md'), '# Homework correcting screenshots\n\nSynthetic harness data (scripts/homework-correct-browser.cjs): the real screens, middleware and CSS, a fictional server checked against the real contract and reply mapper. Light theme; desktop 1360 and phone 390; Classic and New; English and Arabic (right to left). File names: `<screen>-<size>-<look>-<language>.png`.\n\n' +
   '- correct-choice-essay-photo: one student, the choice summary (right or wrong with the letters), the essay with the photo exactly as sent, a mark being given\n' +
   '- correct-photo-deleted: a photo deleted to free space ("Image deleted to free space")\n- correct-missed-deadline: a try handed in after the deadline (desktop)\n' +
   '- correct-release-confirm: "Release N grades" confirm, saying students are notified\n- correct-release-changed: a grade changed elsewhere, nothing released, Reload (desktop)\n' +
   '- correct-stale: a save refused because the try changed elsewhere; what was typed is kept and Reload is offered\n- correct-released-reason: changing a released grade asks for a reason (desktop)\n' +
   '- correct-list: the student list on a phone\n- correct-done-tab: the Done tab (desktop)\n- home-card: Home with "Homework to correct"\n' +
   '- student-lesson-no-parts: the student lesson page for a lesson with no part, its homework below\n- student-try-again: handed in, deadline and tries left, Try again\n' +
   '- student-missed-deadline: handed in late, "Missed the deadline", no tries left\n- student-kept-answer: after Try again, the kept answer is locked (desktop)\n- student-refused: Try again refused, said plainly in the page language (desktop)\n\n' +
   'The student pictures show the existing student styles inside a plain page (no student sidebar); they were not restyled.\n');
 }
 console.log(`Homework correcting browser checks passed: ${results.length} groups, ${pictures.length} pictures (real middleware, real contract and reply mapper, synthetic loopback data, not provider E2E). Screenshots: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
