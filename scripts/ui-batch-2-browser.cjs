// claude/ui-batch-2 in Chromium: before/after pictures of the owner's homework rules (2026-11-27), from the REAL components with synthetic data only
// (no customer records, no provider). Student homework and the teacher Homework screens run in the browser against a fictional API whose
// answers have the shape the database returns in each version (LMS_SHOTS_AS=before: corrected but unreleased, as before 20261127130000;
// after: released at hand-in, selfMarked, canStop, averageScore). Student lesson cards are the REAL server components of website-pages.tsx with
// a synthetic scope (and, after, a synthetic lesson_completion answer). Not provider acceptance.
// The same file runs on the commit before the track (copy it into a checkout of that commit) for the "before" pictures; screens that only exist
// after (the students list, "I'm done") are taken only with LMS_SHOTS_AS=after.
// Needs LMS_BROWSER_RUNTIME (Playwright), LMS_CHROMIUM_EXECUTABLE and a Firebase-mode `npm run build` (fonts).
// Pictures: .local/ui-batch-2-browser/<before|after>/, copied to docs/design/screenshots/ui-batch-2/<before|after>/ with LMS_COPY_SHOTS=1.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('node:assert/strict');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME || path.resolve('node_modules');
if (!browserRuntime) throw Error('Set LMS_BROWSER_RUNTIME to existing Playwright tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const AS = process.env.LMS_SHOTS_AS === 'before' ? 'before' : 'after', after = AS === 'after';
const out = path.resolve('.local/ui-batch-2-browser'), shots = path.join(out, AS), docs = path.resolve(process.env.LMS_DOCS_DIR || 'docs/design/screenshots/ui-batch-2', AS);
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the fonts are needed');
const built = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).join('\n');
const css = [...(built.match(/@font-face\{[^}]*\}/g) || []), ...(built.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []), require('./harness-css.cjs')()].join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

// ---- synthetic data (relative to now)
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const H = 3600000, D = 24 * H, NOW = Date.now(), iso = t => new Date(t).toISOString();
const ORG = uuid(50), COURSE = uuid(10), RUN = uuid(101), GROUP = uuid(1);

// ---- the student pages: real server components, rendered here with a synthetic scope
const serverEntry = `
import React from 'react';
import { renderToString } from 'react-dom/server';
import { LanguageProvider } from '@/frontend/components/language-provider';
import Sidebar from '@/frontend/components/sidebar';
import MobileSidebar from '@/frontend/features/dashboard/mobile-sidebar';
import Footer from '@/frontend/components/footer';
import { WebsiteCourse, WebsiteHome, WebsiteCourses } from '@/app/(dashboard)/_components/website-pages';
const isAsync = f => f && f.constructor && f.constructor.name === 'AsyncFunction';
// React 18 cannot render async server components: resolve them first, as the server would. A component that uses hooks is a client component
// and stays as it is (calling it outside a render throws); one without hooks is drawn the same either way.
async function resolve(node) {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return Promise.all(node.map(resolve));
  if (typeof node.then === 'function') return resolve(await node);
  if (!React.isValidElement(node)) return node;
  const { type, props } = node;
  if (typeof type === 'function' && !(type.prototype && type.prototype.isReactComponent)) {
    if (isAsync(type)) return resolve(await type(props));
    const quiet = console.error; console.error = () => {};
    let outcome; try { outcome = { value: type(props) }; } catch { outcome = null; } finally { console.error = quiet; }
    if (outcome) return resolve(outcome.value);
  }
  if (props && props.children !== undefined) return React.cloneElement(node, { children: await resolve(props.children) });
  return node;
}
export async function render(kind, lang) {
  const tree = kind === 'course' ? await WebsiteCourse({ courseId: '${COURSE}', search: {} }) : kind === 'home' ? await WebsiteHome({ search: {} }) : await WebsiteCourses({ search: {} });
  const body = await resolve(tree);
  return renderToString(<LanguageProvider initialLanguage={lang}>
    <div data-lms-shell className="min-h-screen bg-slate-50 w-full relative">
      <MobileSidebar />
      <aside className="hidden md:block fixed start-4 top-4 bottom-4 w-64 z-50"><Sidebar /></aside>
      <main className="md:ps-72 pt-2 md:pt-4 min-h-screen bg-slate-50 flex flex-col justify-between">
        <div className="flex-1 w-full p-4 sm:p-6 md:p-8">{body}</div><Footer />
      </main>
    </div>
  </LanguageProvider>);
}
`;
const serverStubs = {
  'server-only': 'export {};',
  '@/server/services/website': 'export const getWebsiteContext = async () => globalThis.__ctx; export const loadWebsiteScope = async () => globalThis.__scope; export const courseCapability = () => false; export const offeringCapability = () => false;',
  '@/server/services/groups': 'export const groupService = async () => globalThis.__groups; export const groupFailure = (m, s) => Object.assign(new Error(m), { status: s });',
  'next/navigation': 'export const notFound = () => { throw Error("notFound"); }; export const redirect = p => { throw Error("redirect " + p); }; export const usePathname = () => globalThis.__path; export const useParams = () => ({ courseId: "' + COURSE + '" }); export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, prefetch() {} }); export const useSearchParams = () => new URLSearchParams();',
  'next/link': 'import React from "react"; export default function Link({ href, children, prefetch, ...rest }) { return React.createElement("a", { ...rest, href }, children); }',
  'next/image': 'import React from "react"; export default function Image({ unoptimized, fill, priority, ...p }) { return React.createElement("img", p); }',
  'next/dynamic': 'export default () => () => null;',
  '@/shared/auth-config': 'export const isFirebaseStaging = () => true; export const authBackend = () => "firebase";',
  '@/frontend/lib/api': 'export const api = { get: async () => ({ data: [] }), post: async () => ({ data: {} }), interceptors: { request: { use() {} } } };',
  '@/frontend/components/providers/use-loading-router': 'export const useLoadingRouter = () => ({ push() {}, replace() {}, refresh() {} });',
  '@/frontend/components/providers/application-auth-provider': 'export const WebsiteNavigationProvider = ({ children }) => children; export const useApplicationAuth = () => ({ user: { fullName: "Synthetic Student", email: "student@example.test", imageUrl: null, id: "s" }, signOut: async () => {}, openUserProfile() {}, accountStatus: { loading: false } }); export const useWebsiteNavigation = () => ({ viewer: { id: "s", displayName: "Synthetic Student" }, organizations: [{ id: "' + ORG + '", name: "Synthetic space", status: "active" }], staffOrganizationIds: [] });',
  '@/frontend/components/providers/v2-identity': 'import React from "react"; export const useAuth = () => ({ userId: null, isSignedIn: true }); export const useUser = () => ({ user: { fullName: "Synthetic Student" } }); export const useClerk = () => ({ signOut() {} }); export const UserButton = () => React.createElement("span", { className: "inline-block h-9 w-9 rounded-full border-2 border-black" });',
  'react-quill-new/dist/quill.bubble.css': '',
};
const stubByEnd = { 'teacher-home-pages': 'export const TeacherHomePage = () => null; export const staffContext = async () => null;', 'teacher-foundation-page': 'export const TeacherFoundationPage = () => null;' };
// After: the one completion rule comes from public.lesson_completion; here a synthetic answer for the four lessons below.
serverStubs['@/server/services/lesson-completion'] = 'export const lessonCompletion = async () => new Map(globalThis.__completion.map(r => [r.offeringId + ":" + r.lessonId, r]));';
const student = () => {
  // l1: both parts done, no homework. l2: homework only, handed in. l3: its part done, its homework not handed in. l4: nothing in it, opened.
  const lessons = [['l1', 'Speed and velocity', 2, 2], ['l2', 'Homework only: Faraday homework 1', 0, 0], ['l3', 'Acceleration', 1, 1], ['l4', 'Reading: motion around us', 0, 0]];
  const course = { id: COURSE, organization_id: ORG, title: 'Synthetic Physics 9', description: 'Motion, forces and energy for grade 9.', status: 'published', imageUrl: null };
  const completion = [[2, 2, 0, 0, true], [0, 0, 1, 1, true], [1, 1, 1, 0, false], [0, 0, 0, 0, true]].map(([parts, partsDone, homework, homeworkDone, complete], i) =>
    ({ offeringId: RUN, lessonId: uuid(30 + i), parts, partsDone, homework, homeworkDone, complete, started: true }));
  return {
    completion,
    ctx: { viewer: { id: uuid(7), displayName: 'Synthetic Student', email: 'student@example.test' }, organizations: [{ id: ORG, name: 'Synthetic space', status: 'active' }], memberships: [], courseStaff: [], offeringStaff: [], courses: [course], offerings: [] },
    scope: {
      courses: [course], offerings: [{ id: RUN, course_id: COURSE, name: 'Synthetic run 2026', status: 'active', delivery_mode: 'blended' }],
      enrollments: [{ id: uuid(60), offering_id: RUN, status: 'active', enrolled_at: null, expires_at: null }],
      modules: [{ id: uuid(20), course_id: COURSE, title: 'Motion', position: 0, group_type: 'Chapter', chapter_number: 1, summary: '', description: '' }],
      lessons: lessons.map(([, title], i) => ({ id: uuid(30 + i), module_id: uuid(20), title, status: 'published', position: i, cover_url: null, description: '' })),
      segments: lessons.flatMap(([, , parts], i) => Array.from({ length: parts }, (_, p) => ({ id: uuid(40 + i * 5 + p), lesson_id: uuid(30 + i), title: 'Part ' + (p + 1), position: p, status: 'published', thumbnail_url: null }))),
      segmentProgress: lessons.flatMap(([, , , done], i) => Array.from({ length: done }, (_, p) => ({ offering_id: RUN, segment_id: uuid(40 + i * 5 + p), lesson_id: uuid(30 + i), status: 'completed', updated_at: iso(NOW - D), revision: 1, video_position_seconds: 0 }))),
      progress: [{ offering_id: RUN, lesson_id: uuid(33), status: 'in_progress', last_accessed_at: iso(NOW - D) }],
      progressAvailable: true, progressLimited: false, contentLimited: false, limited: false, progressReadId: 'r', progressReadProofs: [],
    },
    groups: { overview: async () => ({ rows: [] }), view: async () => ({ rows: [], page: 0 }), command: async () => ({}) },
  };
};

// ---- the browser screens: student homework (no frame, the student look) and the teacher Homework screens (the real TeacherFrame)
const entry = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { TeacherFrame } from '@/frontend/features/teacher-frame/teacher-frame';
import { HomeworkStudent } from '@/frontend/features/courses/lesson/homework-student';
import { TeacherHomeworkPage } from '@/frontend/features/teacher-homework/homework-page';
import { HomeworkWizard } from '@/frontend/features/teacher-homework/homework-wizard';
${after ? "import { HomeworkStudentsScreen } from '@/frontend/features/teacher-homework/students-screen';" : 'const HomeworkStudentsScreen = () => null;'}
let lang = 'en'; try { lang = localStorage.getItem('edulabs-lms-language') === 'ar' ? 'ar' : 'en'; } catch {}
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
document.documentElement.dataset.design = 'new';
const parts = location.pathname.split('/');
function Student() {
  const [view, setView] = useState(null);
  useEffect(() => { fetch('/__hw/' + parts[2]).then(r => r.json()).then(setView); }, []);
  return view ? <div data-student-page className="min-h-screen bg-slate-50 p-4 sm:p-8"><div className="mx-auto max-w-3xl"><HomeworkStudent initial={view} /></div></div> : null;
}
function Teacher() {
  const [load, setLoad] = useState(null);
  useEffect(() => { fetch('/__load').then(r => r.json()).then(setLoad); }, []);
  if (!load) return null;
  const id = parts[3];
  const body = !id ? <TeacherHomeworkPage load={load} /> : parts[4] === 'students' ? <HomeworkStudentsScreen homeworkId={id} /> : <HomeworkWizard key={id} load={load} homeworkId={id} initialCourse={null} />;
  return <TeacherFrame>{body}</TeacherFrame>;
}
const page = parts[1] === 'hw' ? <Student /> : <Teacher />;
createRoot(document.getElementById('root')).render(<LanguageProvider initialLanguage={lang}><ThemeProvider attribute="class" enableSystem={false} disableTransitionOnChange>{page}</ThemeProvider></LanguageProvider>);
`;
const browserStubs = {
  '@/frontend/components/providers/use-loading-router': 'export const useLoadingRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() {}, prefetch() {} });',
  'next/navigation': 'export const usePathname = () => location.pathname; export const useRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() {}, prefetch() {} }); export const useSearchParams = () => new URLSearchParams(location.search); export const useParams = () => ({});',
  'next/link': 'import React from "react"; export default React.forwardRef(function Link({ href, children, prefetch, ...rest }, ref) { return React.createElement("a", { ...rest, ref, href }, children); });',
  'next/image': 'import React from "react"; export default function Image({ unoptimized, fill, priority, ...p }) { return React.createElement("img", p); }',
  '@/shared/auth-config': 'export const isFirebaseStaging = () => true;',
  '@/frontend/components/providers/application-auth-provider': 'export const useApplicationAuth = () => ({ user: { fullName: "Synthetic Teacher", email: "teacher@example.test", imageUrl: null, id: "u" }, openUserProfile() {}, signOut: async () => {} }); export const useWebsiteNavigation = () => ({ viewer: { id: "v", displayName: "Synthetic Teacher" }, organizations: [], staffOrganizationIds: [] });',
  '@/frontend/components/providers/v2-identity': 'import React from "react"; export const useUser = () => ({ user: { fullName: "Synthetic Teacher" } }); export const useClerk = () => ({ signOut() {} }); export const UserButton = () => React.createElement("span", { className: "inline-block h-9 w-9 rounded-full" });',
  // The student homework calls, answered by the fictional server below (the same reasons and shapes as the real route).
  '@/frontend/lib/homework': 'export async function homeworkApi(id, action, body) { const r = await fetch("/__hwapi", { method: "POST", body: JSON.stringify({ id, action, body }) }); const v = await r.json(); if (!r.ok) throw Object.assign(new Error(v.error || "failed"), v); return v; } export async function uploadHomeworkFile() { throw new Error("no uploads in the harness"); }',
};

// ---- the student homework: what get_homework returns in each version (before: a self-marked try stays unreleased; after: released at hand-in)
const Q = { a: uuid(401), b: uuid(402), essay: uuid(403) }, opt = (q, i) => uuid(Number(q.slice(-3)) * 10 + i);
const choice = (id, text, points) => ({ id, type: 'single_choice', text, imageId: null, points, responseMode: 'text', modelAnswer: '', correctIds: [], options: ['1 V', '2 V', '4 V', '8 V'].map((t, i) => ({ id: opt(id, i), text: t })) });
const essayQ = { id: Q.essay, type: 'essay', text: 'Explain, in your own words, why the induced current changes direction.', imageId: null, points: 4, responseMode: 'text', modelAnswer: '', correctIds: [], options: [] };
const definition = (title, questions) => ({ title, instructions: 'Answer every question. Show your working on paper.', mode: 'PLATFORM_QUESTIONS', published: true, usesMarks: true, filePoints: 0, modelAnswer: 'Faraday: the induced EMF equals the rate of change of the flux.', solutionVideo: '', solutionVideoId: null, referenceIds: [], solutionIds: [], questions });
const answers = [{ questionId: Q.a, optionIds: [opt(Q.a, 1)], text: '', fileIds: [] }, { questionId: Q.b, optionIds: [opt(Q.b, 0)], text: '', fileIds: [] }];
const keys = [{ questionId: Q.a, correctIds: [opt(Q.a, 1)], modelAnswer: 'EMF = N ΔΦ/Δt = 2 V.' }, { questionId: Q.b, correctIds: [opt(Q.b, 2)], modelAnswer: 'Doubling the turns doubles the EMF.' }];
const HW = { stopped: false };
function hwView(name) {
  const base = { id: uuid(300), offeringId: RUN, lessonId: uuid(31), segmentId: null, revision: 2, locked: true, staff: false, canGrade: false, canRelease: false, references: [], workflow: 'questions', deadline: iso(NOW + 2 * D), deadlinePassed: false };
  const tries = name === 'tries';
  const qs = [choice(Q.a, 'A coil’s flux changes by 0.2 Wb in 0.1 s. What EMF is induced?', 2), choice(Q.b, 'The same coil with twice the turns gives…', 1), ...(name === 'mixed' ? [essayQ] : [])];
  const marks = [{ questionId: Q.a, points: 2, feedback: '' }, { questionId: Q.b, points: 0, feedback: '' }];
  const stopped = name === 'tries' && HW.stopped;
  const released = after && name !== 'mixed';
  const correction = { status: name === 'mixed' ? 'under_correction' : 'corrected', revision: 1, released, score: released ? 2 : null, feedback: '', marks: released ? marks : [], annotations: [],
    ...(after && name === 'mixed' ? { selfMarked: { score: 2, max: 3, essays: 1, marks: marks.map(({ questionId, points }) => ({ questionId, points })) } } : {}) };
  const submission = { id: uuid(310), revision: 3, number: 1, status: 'submitted', submittedAt: iso(NOW - 2 * H), missedDeadline: false, files: [],
    answers: [...answers, ...(name === 'mixed' ? [{ questionId: Q.essay, optionIds: [], text: 'The flux first grows and then shrinks, so the current reverses.', fileIds: [] }] : [])], correction };
  // Answers: before, the Faraday homework said "after the deadline" (closed until then); after, one-try opens at hand-in, tries at the last
  // try or "I'm done". Mixed homework is one try: the answers open at hand-in in both versions' rules for after_hand_in.
  const open = after ? (name === 'one' || name === 'mixed' || stopped) : name === 'mixed';
  return { ...base, definition: definition(name === 'mixed' ? 'Faraday mixed' : 'Faraday homework 1', qs), submissions: [submission],
    solutions: open ? { text: 'Faraday: the induced EMF equals the rate of change of the flux.', video: '', videoId: null, files: [], keys } : null,
    triesUsed: 1, triesLeft: tries && !stopped ? 2 : 0, canStart: false, canRetry: tries && !stopped, triesEnded: false,
    ...(after ? { stopped, canStop: tries && !stopped, solutionsOpen: open } : {}) };
}

// ---- the teacher Homework screens (shapes of homework_portal and homework_students)
const C = { id: COURSE, spaceId: 'synthetic-space', title: 'Synthetic Physics 9', status: 'published', canEdit: true, offerings: [{ id: RUN, name: 'Synthetic run', canManage: true }] };
const load = { state: 'ready', courses: [C] };
const prow = (n, title, extra) => ({ id: uuid(n), title, courseId: COURSE, courseTitle: C.title, offeringId: RUN, lessonId: uuid(31), lessonTitle: 'Electromagnetic induction', version: 1, workflow: 'questions', mode: 'PLATFORM_QUESTIONS',
  status: 'published', deadline: iso(NOW + 2 * D), lateAllowed: false, tries: 'one_time', maxTries: 1, solutionsOpen: 'after_hand_in', photosAllowed: true, updatedAt: iso(NOW - D), questionCount: 2, totalMarks: 3,
  handedIn: 0, total: 14, late: 0, waiting: 0, imageBytes: null, ...extra });
const ROWS = [
  prow(300, 'Faraday homework 1', { deadline: iso(NOW - 3 * D), lateAllowed: true, handedIn: 12, late: 2, imageBytes: 0, ...(after ? { averageScore: 2.25 } : {}) }),
  prow(301, 'Lenz’s law practice', { deadline: iso(NOW - 9 * D), handedIn: 13, late: 0, imageBytes: 0, ...(after ? { averageScore: 2.69 } : {}) }),
  prow(302, 'Faraday mixed', { deadline: iso(NOW + 2 * D), totalMarks: 7, questionCount: 3, handedIn: 6, waiting: 4, ...(after ? { averageScore: null } : {}) }),
  prow(303, 'Coils and turns', { deadline: iso(NOW + 4 * D), tries: 'fix_mistakes', maxTries: 3, handedIn: 9, late: 0, ...(after ? { averageScore: 2.5 } : {}) }),
  prow(304, 'Transformers (draft)', { status: 'draft', handedIn: null, total: null, late: null, deadline: iso(NOW + 7 * D), solutionsOpen: after ? 'after_hand_in' : 'after_deadline' }),
];
// Before, the self-marked "Faraday homework 1" waited in "To correct" (its tries were never released); after, only essays wait there.
if (!after) ROWS[0].waiting = 12;
const tabOf = r => r.status === 'draft' ? 'drafts' : Date.parse(r.deadline) > NOW ? 'open' : 'closed';
function portal(q) {
  const counts = { open: 0, closed: 0, drafts: 0 }; for (const r of ROWS) counts[tabOf(r)]++;
  const rows = ROWS.filter(r => tabOf(r) === q.tab).sort((a, b) => q.tab === 'closed' ? b.deadline.localeCompare(a.deadline) : a.deadline.localeCompare(b.deadline));
  return { tab: q.tab, page: 0, pageSize: 25, serverNow: iso(NOW), counts, rows, stats: { weekStart: iso(NOW - 3 * D), weekEnd: iso(NOW + 4 * D), essaysWaiting: 4, correctedThisWeek: 31, handedInThisWeek: 40, onTimePercent: 92 },
    toCorrect: ROWS.filter(r => r.waiting) };
}
const names = ['Amira Hassan', 'Omar Khaled', 'Laila Mostafa', 'Youssef Adel', 'Nour Samir', 'Karim Fathy', 'Salma Ibrahim', 'Hana Tarek', 'Ziad Amr', 'مريم أحمد', 'Mostafa Ali', 'Farida Nabil', 'Adam Sherif', 'Jana Wael'];
function students() {
  const rows = names.map((name, i) => {
    const state = i === 4 || i === 11 ? 'late' : i === 7 || i === 13 ? 'not_handed_in' : 'handed_in';
    return { userId: uuid(6000 + i), name, groupId: i < 8 ? GROUP : uuid(2), groupName: i < 8 ? 'Saturday Group' : 'مجموعة الأحد', state, late: state === 'late', submittedAt: state === 'not_handed_in' ? null : iso(NOW - (3 * D) - (state === 'late' ? -5 * H : (i + 1) * H)),
      tries: state === 'not_handed_in' ? 0 : 1, score: state === 'not_handed_in' ? null : [3, 2, 3, 1, 2, 3, 2, 0, 3, 2, 3, 1, 2, 0][i], waiting: false };
  });
  const marked = rows.filter(r => r.score !== null);
  return { page: 0, pageSize: 100, serverNow: iso(NOW), homework: { id: uuid(300), title: 'Faraday homework 1', courseId: COURSE, offeringId: RUN, deadline: iso(NOW - 3 * D), lateAllowed: true, tries: 'one_time', maxTries: 1, status: 'published', usesMarks: true, totalMarks: 3 },
    counts: { total: rows.length, handedIn: marked.length, late: rows.filter(r => r.state === 'late').length, notHandedIn: rows.filter(r => r.state === 'not_handed_in').length, averageScore: Math.round(100 * marked.reduce((s, r) => s + r.score, 0) / marked.length) / 100 }, rows };
}
// The draft the wizard opens on its Solutions step.
const draftView = () => ({ id: uuid(304), offeringId: RUN, lessonId: uuid(31), segmentId: null, revision: 3, version: 1, locked: false, staff: true, canManage: true, workflow: 'questions', deadline: iso(NOW + 7 * D), courseId: COURSE,
  definition: { ...definition('Transformers (draft)', [{ ...choice(Q.a, 'A transformer has 100 and 200 turns. With 4 V in, what comes out?', 2), correctIds: [opt(Q.a, 3)] }, { ...choice(Q.b, 'Which needs an alternating current?', 1), correctIds: [opt(Q.b, 0)] }]),
    published: false, rules: { deadline: iso(NOW + 7 * D), lateAllowed: false, tries: 'fix_mistakes', maxTries: 3, solutionsOpen: after ? 'after_hand_in' : 'after_deadline', photosAllowed: true } } });
const content = () => ({ archived: false, canEdit: true, chapters: [{ id: uuid(80), title: 'Electricity and magnetism', type: 'chapter', number: 4, position: 0, updatedAt: iso(NOW - D) }],
  lessons: [{ id: uuid(31), chapterId: uuid(80), title: 'Electromagnetic induction', position: 0, status: 'published', updatedAt: iso(NOW - D), homework: 3, draftHomework: 1, deleteBlockers: [], contentBlocks: 0, hasCover: false, parts: 0 }] });

(async () => {
  const resolveAlias = p => { for (const c of [p + '.tsx', p + '.ts', path.join(p, 'index.tsx'), path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return p; };
  const plugin = stubs => ({ name: 'boundary', setup(b) {
    b.onResolve({ filter: /.*/ }, a => {
      if (stubs[a.path] !== undefined) return { path: a.path, namespace: 'stub' };
      const end = Object.keys(stubByEnd).find(k => a.path.endsWith('/' + k));
      if (end && stubs === serverStubs) return { path: end, namespace: 'stub-end' };
      if (a.path.startsWith('@/')) return { path: resolveAlias(path.resolve(a.path.slice(2))) };
      if (a.path.endsWith('.css')) return { path: a.path, namespace: 'stub-css' };
    });
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'jsx', resolveDir: process.cwd() }));
    b.onLoad({ filter: /.*/, namespace: 'stub-end' }, a => ({ contents: stubByEnd[a.path], loader: 'jsx', resolveDir: process.cwd() }));
    b.onLoad({ filter: /.*/, namespace: 'stub-css' }, () => ({ contents: '', loader: 'js' }));
  } });
  await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: path.join(out, AS + '-app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_AUTH_BACKEND': '"firebase-staging"' }, banner: { js: 'var process = { env: {} };' }, logLevel: 'error', plugins: [plugin(browserStubs)] });
  await esbuild.build({ stdin: { contents: serverEntry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: path.join(out, AS + '-server.cjs'), platform: 'node', format: 'cjs', target: 'node20', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error', plugins: [plugin(serverStubs)] });
  const data = student();
  Object.assign(globalThis, { __ctx: data.ctx, __scope: data.scope, __groups: data.groups, __completion: data.completion, __path: '/courses/' + COURSE });
  const ssr = require(path.join(out, AS + '-server.cjs'));
  const posts = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    const body = cb => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => cb(JSON.parse(Buffer.concat(parts).toString() || '{}'))); };
    const doc = (inner, { lang = 'en', theme = 'light', script = true } = {}) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" class="${theme === 'dark' ? 'dark' : ''}" data-lms-appearance style="color-scheme:${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Harness</title><link rel="stylesheet" href="/__style.css"></head><body class="${fontVars} font-sans">${inner}${script ? '<script src="/__app.js"></script>' : ''}</body></html>`); };
    if (url.pathname === '/__app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, AS + '-app.js'))); }
    if (url.pathname === '/__style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
    if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
    if (url.pathname === '/__ctl') return body(b => { if (b.reset) { HW.stopped = false; posts.length = 0; } send({ posts }); });
    if (url.pathname.startsWith('/__hw/')) return send(hwView(url.pathname.split('/')[2]));
    if (url.pathname === '/__hwapi') return body(b => {
      posts.push(b);
      if (b.action === 'work' && b.body.action === 'stop') { HW.stopped = true; return send(hwView('tries').submissions[0]); }
      if (b.action === 'get') return send(hwView(HW.stopped ? 'tries' : 'one'));
      if (b.action === 'revisions' || b.action === 'history') return send({ rows: [], total: 0, page: 0, hasMore: false });
      if (b.action === 'media') return send({ id: '', name: '', mime: 'image/png', url: '' });
      return send({ error: 'harness: ' + b.action }, 404);
    });
    if (url.pathname === '/__load') return send(load);
    if (url.pathname.startsWith('/s/')) { const [, , kind, lang, theme] = url.pathname.split('/'); return ssr.render(kind, lang).then(html => doc(html, { lang, theme, script: false }), e => { res.statusCode = 500; res.end(String(e && e.stack)); }); }
    if (url.pathname === '/api/teacher/homework') return send(portal({ tab: url.searchParams.get('tab') || 'open' }));
    if (url.pathname === `/api/teacher/homework/${uuid(300)}/students`) return send(students());
    if (url.pathname === `/api/teacher/homework/${uuid(304)}`) return send(draftView());
    if (url.pathname === `/api/teacher/courses/${COURSE}/content`) return send(content());
    if (url.pathname === '/api/communications' || url.pathname.startsWith('/api/notifications')) return send({ rows: [], page: 0, unread: 0 });
    if (url.pathname.startsWith('/api/')) return send({ kind: 'denied' }, 404);
    const theme = url.searchParams.get('theme') || 'light', lang = url.searchParams.get('lang') || 'en';
    doc('<div id="root"></div>', { lang, theme });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const ctl = b => fetch(origin + '/__ctl', { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
  const errors = [];
  const SIZES = { phone: { width: 390, height: 844 }, wide: { width: 1920, height: 1080 } };
  const open = async (size, p, { lang = 'en', theme = 'light' } = {}) => {
    const context = await browser.newContext({ viewport: SIZES[size], locale: lang, reducedMotion: 'reduce' });
    await context.addInitScript(([l, t]) => { try { localStorage.setItem('edulabs-lms-language', l); localStorage.setItem('edulabs-lms-appearance', t); sessionStorage.setItem('edulabs-opened', '1'); } catch {} }, [lang, theme]);
    const page = await context.newPage();
    page.on('pageerror', e => { errors.push(p + ': ' + e.message); console.error('PAGEERROR', p, e.message.slice(0, 400)); });
    await page.goto(origin + p + (p.includes('?') ? '&' : '?') + `lang=${lang}&theme=${theme}`);
    return { page, context };
  };
  const shot = (page, name, full = true) => page.screenshot({ path: path.join(shots, name + '.png'), fullPage: full });
  const MATRIX = [['phone', 'light', 'en'], ['wide', 'light', 'en'], ['wide', 'dark', 'en'], ['phone', 'dark', 'ar']];
  const overflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  const done = [];
  const only = process.env.LMS_ONLY_STEPS ? new RegExp(process.env.LMS_ONLY_STEPS) : null;
  const step = async (name, fn) => { if (only && !only.test(name)) return; await ctl({ reset: true }); await fn(); done.push(name); console.log('PASS', name); };
  const ready = page => page.waitForLoadState('networkidle').then(() => page.waitForTimeout(250));

  // 1. Student homework right after the hand-in: one try (Faraday homework 1), tries left, and mixed (an essay waiting).
  for (const name of ['one', 'tries', 'mixed']) await step('1-student-homework-' + name, async () => {
    for (const [size, theme, lang] of MATRIX) {
      const { page, context } = await open(size, '/hw/' + name, { lang, theme });
      await page.locator('[data-student-page] section').first().waitFor(); await ready(page);
      const text = await page.locator('[data-student-page]').innerText();
      if (after) {
        assert.ok(await overflow(page), 'no sideways scroll');
        if (name !== 'mixed') assert.match(text, lang === 'ar' ? /درجتك: [٢2] \/ [٣3]/ : /Your mark: 2 \/ 3/, 'the mark shows at once');
        if (name === 'one') { assert.equal(await page.locator('[data-answers-when]').count(), 0, 'one try: the answers are open'); assert.equal(await page.locator('[data-stop-homework]').count(), 0); }
        if (name === 'tries') { assert.equal(await page.locator('[data-answers-when="after_tries"]').count(), 1); assert.equal(await page.locator('[data-stop-homework]').count(), 1); }
        if (name === 'mixed') { assert.match(text, lang === 'ar' ? /صُحّح تلقائيًا: [٢2] \/ [٣3]/ : /Marked automatically: 2 \/ 3/); assert.equal(await page.locator(`[data-question-waiting="${Q.essay}"]`).count(), 1); assert.equal(await page.locator('[data-homework-mark]').count(), 0, 'no total before the essay release'); }
        assert.doesNotMatch(text, /under_correction|Under Correction|^corrected$/m, 'no raw status words');
      }
      await shot(page, `1-student-homework-${name}-${size}-${theme}-${lang}`); await context.close();
    }
  });
  // 2. "I'm done, show me the answers": asks first, then the answers open and the tries end (after only).
  if (after) await step('2-student-homework-stop', async () => {
    for (const [size, theme, lang] of [['phone', 'light', 'en'], ['wide', 'light', 'en'], ['phone', 'dark', 'ar']]) {
      await ctl({ reset: true });
      const { page, context } = await open(size, '/hw/tries', { lang, theme });
      await page.locator('[data-stop-homework]').click(); await page.locator('[data-stop-confirm]').waitFor();
      assert.equal((await ctl({})).posts.filter(p => p.body && p.body.action === 'stop').length, 0, 'asking sends nothing');
      await shot(page, `2-student-homework-stop-ask-${size}-${theme}-${lang}`, false);
      await page.locator('[data-stop-confirm]').click(); await page.locator('[data-stopped]').waitFor(); await ready(page);
      const sent = (await ctl({})).posts.find(p => p.body && p.body.action === 'stop');
      assert.ok(sent && sent.body.submissionId === uuid(310) && sent.body.revision === 3, 'stop names the try and its revision');
      assert.equal(await page.locator('[data-answers-when]').count(), 0, 'the answers are open'); assert.equal(await page.locator('[data-try-again], [data-stop-homework]').count(), 0, 'no more tries');
      await shot(page, `2-student-homework-stopped-${size}-${theme}-${lang}`); await context.close();
    }
  });
  // 3. Lesson cards and the chapter count: the course page and Home.
  for (const kind of ['course', 'home']) await step('3-student-' + kind, async () => {
    for (const [size, theme, lang] of MATRIX) {
      const { page, context } = await open(size, `/s/${kind}/${lang}/${theme}`, { lang, theme });
      await page.waitForLoadState('networkidle');
      const text = await page.locator('main').innerText();
      if (after) {
        assert.ok(await overflow(page), 'no sideways scroll');
        if (kind === 'course') assert.match(text, lang === 'ar' ? /٣ ?\/ ?٤|3 ?\/ ?4/ : /3 ?\/ ?4/, 'three of four lessons complete under the one rule');
        assert.doesNotMatch(text, /Your Grade|Exam Prep/, 'no placeholder slides or badge');
        if (lang === 'ar') { assert.match(text, /الفصل/); assert.doesNotMatch(text, /chapter/i, 'Arabic chapter labels'); }
      }
      await shot(page, `3-student-${kind}-${size}-${theme}-${lang}`); await context.close();
    }
  });
  // 4. The teacher Homework page: every homework with handed in, late and the average; Closed newest first; To correct has essays only.
  await step('4-teacher-homework', async () => {
    for (const [size, theme, lang] of MATRIX) {
      const { page, context } = await open(size, '/teacher/homework', { lang, theme });
      if (size === 'phone') { await page.locator('[data-all-homework]').click(); }
      await page.locator('[data-homework-list]').waitFor(); await ready(page);
      if (after) {
        assert.ok(await overflow(page));
        assert.match(await page.locator(`[data-homework-row="${uuid(302)}"] [data-row-summary]`).innerText(), lang === 'ar' ? /المتوسط|لا درجات/ : /6 of 14 handed in · 0 late · no marks yet/);
      }
      await shot(page, `4-teacher-homework-open-${size}-${theme}-${lang}`);
      await page.locator('[data-tab="closed"]').click(); await page.locator(`[data-homework-row="${uuid(300)}"]`).waitFor(); await ready(page);
      if (after) {
        const order = await page.locator('[data-homework-row]').evaluateAll(rows => rows.map(r => r.getAttribute('data-homework-row')));
        assert.deepEqual(order, [uuid(300), uuid(301)], 'Closed: newest first');
        assert.match(await page.locator(`[data-homework-row="${uuid(300)}"] [data-row-summary]`).innerText(), lang === 'ar' ? /١٢|12/ : /12 of 14 handed in · 2 late · average 2.25 \/ 3/);
      }
      await shot(page, `4-teacher-homework-closed-${size}-${theme}-${lang}`); await context.close();
    }
  });
  // 5. One homework's students, read only (after only).
  if (after) await step('5-teacher-homework-students', async () => {
    for (const [size, theme, lang] of MATRIX) {
      const { page, context } = await open(size, `/teacher/homework/${uuid(300)}/students`, { lang, theme });
      await page.locator('[data-student-row]').first().waitFor(); await ready(page);
      assert.ok(await overflow(page));
      assert.equal(await page.locator('[data-students-group]').count(), 2, 'by Group');
      assert.equal(await page.locator('[data-student-state="late"]').count(), 2); assert.equal(await page.locator('[data-student-state="not_handed_in"]').count(), 2);
      assert.equal(await page.locator('button:not([data-sidebar-toggle]):not([aria-haspopup]) >> text=/Release|Save|تحرير/').count(), 0, 'nothing to change here');
      await shot(page, `5-teacher-homework-students-${size}-${theme}-${lang}`); await context.close();
    }
  });
  // 6. The wizard's Solutions step: no "After the deadline" after.
  await step('6-wizard-solutions', async () => {
    for (const [size, theme, lang] of MATRIX) {
      const { page, context } = await open(size, `/teacher/homework/${uuid(304)}`, { lang, theme });
      await page.locator('[data-homework-wizard][data-step]').waitFor();
      for (const s of ['questions', 'rules', 'solutions']) { await page.locator('[data-step-next]').click(); await page.locator(`[data-homework-wizard][data-step="${s}"]`).waitFor(); }
      await ready(page);
      if (after) {
        assert.equal(await page.locator('[data-solutions="after_deadline"]').count(), 0, 'no after-the-deadline choice');
        assert.match(await page.locator('[data-solutions-rule]').innerText(), lang === 'ar' ? /يختار الطالب التوقف/ : /chooses to stop and see them/);
      }
      await shot(page, `6-wizard-solutions-${size}-${theme}-${lang}`); await context.close();
    }
  });

  await browser.close(); server.close();
  assert.deepEqual(errors, [], 'no page errors');
  if (process.env.LMS_COPY_SHOTS) { fs.mkdirSync(docs, { recursive: true }); for (const f of fs.readdirSync(docs)) if (f.endsWith('.png')) fs.unlinkSync(path.join(docs, f)); for (const f of fs.readdirSync(shots)) fs.copyFileSync(path.join(shots, f), path.join(docs, f)); }
  console.log(`ui-batch-2 (${AS}): ${done.length} groups. Pictures: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
