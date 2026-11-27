// claude/ui-quick-fixes in Chromium: before/after pictures of the five owner items, from the REAL components with synthetic data only (no
// customer records, no provider). Teacher screens run in the browser inside the real TeacherFrame against a fictional /api; student pages are
// the REAL server components of app/(dashboard)/_components/website-pages.tsx rendered on the server with stubbed reads (a synthetic scope and
// Groups service), inside the student frame of app/(dashboard)/layout.tsx. Not provider acceptance.
// The same file runs on the commit before the track (copy it into a checkout of that commit) to take the "before" pictures: it only uses
// props both versions understand, and it checks the new behaviour only when LMS_SHOTS_AS=after.
// Needs LMS_BROWSER_RUNTIME (Playwright), LMS_CHROMIUM_EXECUTABLE and a Firebase-mode `npm run build` (fonts).
// Pictures: .local/ui-quick-fixes-browser/<before|after>/, copied to docs/design/screenshots/ui-quick-fixes/<before|after>/ with LMS_COPY_SHOTS=1.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('node:assert/strict');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME || path.resolve('node_modules');
if (!browserRuntime) throw Error('Set LMS_BROWSER_RUNTIME to existing Playwright tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const AS = process.env.LMS_SHOTS_AS === 'before' ? 'before' : 'after', after = AS === 'after';
const out = path.resolve('.local/ui-quick-fixes-browser'), shots = path.join(out, AS), docs = path.resolve(process.env.LMS_DOCS_DIR || 'docs/design/screenshots/ui-quick-fixes', AS);
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the fonts are needed');
// Only the fonts come from the build; every rule is compiled from the sources of the checkout being pictured (scripts/harness-css.cjs), so the
// "before" pictures cannot pick up a rule this track added.
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
const student = () => {
  const lessons = [['l1', 'Speed and velocity', 2], ['l2', 'Homework only: forces review', 0], ['l3', 'Acceleration', 1], ['l4', 'Magnetism review', 0]];
  const course = { id: COURSE, organization_id: ORG, title: 'Synthetic Physics 9', description: 'Motion, forces and energy for grade 9.\nEvery lesson has a short video and homework.', status: 'published', imageUrl: null };
  return {
    ctx: { viewer: { id: uuid(7), displayName: 'Synthetic Student', email: 'student@example.test' }, organizations: [{ id: ORG, name: 'Synthetic space', status: 'active' }], memberships: [], courseStaff: [], offeringStaff: [], courses: [course], offerings: [{ id: RUN, course_id: COURSE, name: 'Synthetic run 2026', status: 'active', delivery_mode: 'blended' }], repository: {} },
    scope: {
      courses: [course], offerings: [{ id: RUN, course_id: COURSE, name: 'Synthetic run 2026', status: 'active', delivery_mode: 'blended' }],
      enrollments: [{ id: uuid(60), offering_id: RUN, status: 'active', enrolled_at: null, expires_at: null }],
      modules: [{ id: uuid(20), course_id: COURSE, title: 'Motion', position: 0, group_type: 'Chapter', chapter_number: 1, summary: '', description: '' }],
      lessons: lessons.map(([id, title], i) => ({ id: uuid(30 + i), module_id: uuid(20), title, status: 'published', position: i, cover_url: null, description: '' })),
      segments: lessons.flatMap(([, , parts], i) => Array.from({ length: parts }, (_, p) => ({ id: uuid(40 + i * 5 + p), lesson_id: uuid(30 + i), title: 'Part ' + (p + 1), position: p, status: 'published', thumbnail_url: null }))),
      segmentProgress: [{ offering_id: RUN, segment_id: uuid(40), lesson_id: uuid(30), status: 'completed', updated_at: iso(NOW - D), revision: 1, video_position_seconds: 0 }], progress: [],
      progressAvailable: true, progressLimited: false, contentLimited: false, limited: false, progressReadId: 'r', progressReadProofs: [],
    },
    groups: {
      overview: async () => ({ rows: [{ id: GROUP, offering_id: RUN, offering_name: 'Synthetic run 2026', name: 'Saturday Group', description: '', mode: 'center', location: 'Synthetic Centre', join_url: '', instructions: '', capacity: 20, status: 'active', version: 1, staff: false, instructor: false }], page: 0 }),
      view: async () => ({ rows: [], page: 0, serverNow: iso(NOW), nextSession: { id: uuid(70), group_id: GROUP, title: 'Synthetic lesson', starts_at: iso(NOW + 2 * D + 3 * H), ends_at: iso(NOW + 2 * D + 4 * H), mode: 'center', location: 'Synthetic Centre', join_url: '', instructions: '', cancelled: false, version: 1, attendance_state: 'draft', state: 'upcoming' } }),
      command: async () => ({}),
    },
  };
};

// ---- the teacher screens, in the browser
const entry = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { TeacherFrame } from '@/frontend/features/teacher-frame/teacher-frame';
import { TeacherHomeView } from '@/frontend/features/teacher-home/home-view';
import { TeacherGroupsList } from '@/frontend/features/teacher-groups/list-view';
import { TeacherGroupView } from '@/frontend/features/teacher-groups/group-view';
import { TeacherCourseView } from '@/frontend/features/teacher-course/course-view';
import { buildTeacherHome, createTargets } from '@/shared/teacher-home';
const q = new URLSearchParams(location.search), pathname = location.pathname;
window.__pathname = pathname;
let lang = 'en'; try { lang = localStorage.getItem('edulabs-lms-language') === 'ar' ? 'ar' : 'en'; } catch {}
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
document.documentElement.dataset.design = q.get('design') === 'classic' ? 'classic' : 'new';
const NOW = Date.now(), at = m => new Date(NOW + m * 60000).toISOString(), uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ok = value => ({ ok: true, value });
const group = (n, name) => ({ id: uuid(n), offering_id: uuid(100 + n), offering_name: 'Synthetic run', name, description: '', mode: 'center', location: 'Synthetic Centre', join_url: '', instructions: '', capacity: 20, status: 'active', version: 1, staff: true, instructor: true });
const session = (n, g, name, start) => ({ id: uuid(200 + n), group_id: uuid(g), group_name: name, title: 'Synthetic lesson ' + n, starts_at: at(start), ends_at: at(start + 60), mode: 'center', location: 'Synthetic Centre', join_url: '', instructions: '', cancelled: false, version: 1, attendance_state: 'draft' });
const home = () => ({ ...buildTeacherHome({ now: NOW, courses: ok([{ id: uuid(10), organization_id: uuid(50), title: 'Synthetic Physics 9', status: 'published' }]), groups: ok({ rows: [group(1, 'Saturday Group'), group(2, 'مجموعة الأحد')], page: 0, hasMore: false }),
  upcoming: ok({ rows: [session(1, 1, 'Saturday Group', 90), session(2, 2, 'مجموعة الأحد', 1500), session(3, 1, 'Saturday Group', 3000)], page: 0 }), notifications: ok({ rows: [], page: 0, unread: 0 }), unsaved: ok([]) }),
  createTargets: createTargets([{ id: uuid(50), name: 'Synthetic space', status: 'active' }], [{ organization_id: uuid(50), role: 'teacher', status: 'active' }]), demo: false, homework: { state: 'unavailable' } });
function Course() {
  const [load, setLoad] = useState(null);
  const read = () => fetch('/__course').then(r => r.json()).then(setLoad);
  useEffect(() => { read(); window.addEventListener('harness-refresh', read); return () => window.removeEventListener('harness-refresh', read); }, []);
  return load ? <TeacherCourseView load={load} /> : null;
}
function Body() {
  if (pathname === '/home') return <TeacherHomeView data={home()} />;
  if (pathname === '/teacher/groups') return <TeacherGroupsList />;
  if (pathname.startsWith('/teacher/groups/')) return <TeacherGroupView groupId={pathname.split('/')[3]} />;
  if (pathname.startsWith('/teacher/settings/courses/')) return <Course />;
  return <p>Harness page</p>;
}
createRoot(document.getElementById('root')).render(<LanguageProvider initialLanguage={lang}><ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange><TeacherFrame><Body /></TeacherFrame></ThemeProvider></LanguageProvider>);
`;
const browserStubs = {
  '@/frontend/components/providers/use-loading-router': 'export const useLoadingRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() { window.dispatchEvent(new Event("harness-refresh")); } });',
  'next/navigation': 'export const usePathname = () => location.pathname; export const useRouter = () => ({ push(p) { location.assign(p); }, replace(p) { location.replace(p); }, refresh() { window.dispatchEvent(new Event("harness-refresh")); }, prefetch() {} }); export const useSearchParams = () => new URLSearchParams(location.search);',
  'next/link': 'import React from "react"; export default function Link({ href, children, prefetch, ...rest }) { return React.createElement("a", { ...rest, href, onClick: e => { rest.onClick && rest.onClick(e); e.preventDefault(); } }, children); }',
  'next/image': 'import React from "react"; export default function Image({ unoptimized, fill, priority, ...p }) { return React.createElement("img", p); }',
  '@/shared/auth-config': 'export const isFirebaseStaging = () => true;',
  '@/frontend/components/providers/application-auth-provider': 'export const useApplicationAuth = () => ({ user: { fullName: "Synthetic Teacher", email: "teacher@example.test", imageUrl: null, id: "u" }, openUserProfile() {}, signOut: async () => {}, accountStatus: { loading: false } }); export const useWebsiteNavigation = () => ({ viewer: { id: "v", displayName: "Synthetic Teacher" }, organizations: [{ id: "' + ORG + '", name: "Synthetic space", status: "active" }], staffOrganizationIds: ["' + ORG + '"] });',
  '@/frontend/components/providers/v2-identity': 'import React from "react"; export const useUser = () => ({ user: { fullName: "Synthetic Teacher" } }); export const useClerk = () => ({ signOut() {} }); export const UserButton = () => React.createElement("span", {});',
};

// ---- fictional teacher API
const T = { course: null, patches: [], patch: 'ok', addRefusal: 'other_group' };
const freshCourse = () => ({ state: 'ready', course: { id: COURSE, organizationId: ORG, spaceName: 'Synthetic space', showSpace: false, title: 'Synthetic Physics 9', description: 'Motion, forces and energy for grade 9.', status: 'published', updatedAt: '2026-11-27T09:00:00.000000+00:00', canEdit: true, canChangeStatus: true, canRestore: true } });
T.course = freshCourse();
const tGroup = { id: GROUP, offering_id: RUN, offering_name: 'Synthetic run', name: 'Saturday Group', description: '', mode: 'center', location: 'Synthetic Centre, Room 4', join_url: '', instructions: '', capacity: 20, status: 'active', version: 3, staff: true, instructor: true };
const tMembers = Array.from({ length: 6 }, (_, i) => ({ id: uuid(5000 + i), user_id: uuid(6000 + i), display_name: 'Synthetic student ' + (i + 1), starts_at: iso(NOW - 90 * D), ends_at: null, eligible: true }));
const tEligible = Array.from({ length: 24 }, (_, i) => ({ user_id: uuid(6100 + i), display_name: ['Amira Hassan', 'Omar Khaled', 'Laila Mostafa', 'Youssef Adel', 'Nour Samir', 'Karim Fathy'][i % 6] + ' ' + (i + 1) }));
const tSessions = [0, 1].map(i => ({ id: uuid(1100 + i), group_id: GROUP, title: 'Synthetic lesson ' + (i + 1), starts_at: iso(NOW + (i + 1) * 2 * D), ends_at: iso(NOW + (i + 1) * 2 * D + H), mode: 'center', location: '', join_url: '', instructions: '', cancelled: false, version: 1, attendance_state: 'draft', state: 'upcoming' }));
function groupsApi(body) {
  const section = body.data && body.data.section;
  if (body.action === 'view' && !body.groupId) return [200, { rows: [tGroup, { ...tGroup, id: uuid(2), name: 'مجموعة الأحد', capacity: null, mode: 'online' }], page: 0, hasMore: false, serverNow: iso(NOW) }];
  if (body.action === 'view' && section === 'detail') return [200, { group: tGroup, schedules: [{ weekday: 6, time: '17:00', durationMinutes: 90 }], serverNow: iso(NOW) }];
  if (body.action === 'view' && section === 'sessions') return [200, { rows: tSessions, page: 0, serverNow: iso(NOW), nextSession: tSessions[0], hasMore: false }];
  if (body.action === 'view' && section === 'members') return [200, { rows: tMembers, page: 0, hasMore: false }];
  if (body.action === 'view' && section === 'history') return [200, { rows: [], page: 0, hasMore: false }];
  if (body.action === 'view' && section === 'eligible') return [200, { rows: tEligible, page: 0, hasMore: false }];
  if (body.action === 'view' && section === 'summary') return [200, { own: { attended: 0, absent: 0 }, staff: { attended: 0, absent: 0 }, pendingHomework: 0 }];
  if (body.action === 'add') return [400, { error: 'Check the entered details.', reason: T.addRefusal }];
  if (body.action === 'view') return [200, { rows: [], page: 0 }];
  return [404, { error: 'Not found' }];
}

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
  await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: path.join(out, AS + '-app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'error', plugins: [plugin(browserStubs)] });
  await esbuild.build({ stdin: { contents: serverEntry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: path.join(out, AS + '-server.cjs'), platform: 'node', format: 'cjs', target: 'node20', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error', external: ['react', 'react-dom', 'react-dom/server'], plugins: [plugin(serverStubs)] });
  const data = student();
  Object.assign(globalThis, { __ctx: data.ctx, __scope: data.scope, __groups: data.groups, __path: '/courses/' + COURSE });
  const ssr = require(path.join(out, AS + '-server.cjs'));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    const body = cb => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => cb(JSON.parse(Buffer.concat(parts).toString() || '{}'))); };
    const doc = (inner, { lang = 'en', theme = 'light', script = true } = {}) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" class="${theme === 'dark' ? 'dark' : ''}" data-lms-appearance style="color-scheme:${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Harness</title><link rel="stylesheet" href="/__style.css"></head><body class="${fontVars} font-sans">${inner}${script ? '<script src="/__app.js"></script>' : ''}</body></html>`); };
    if (url.pathname === '/__app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, AS + '-app.js'))); }
    if (url.pathname === '/__style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
    if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
    if (url.pathname === '/__course') return send(T.course);
    if (url.pathname === '/__ctl') return body(b => { if (b.reset) { T.course = freshCourse(); T.patches = []; T.patch = 'ok'; T.addRefusal = 'other_group'; } const { reset, courseFields, ...rest } = b; Object.assign(T, rest); if (b.courseFields) Object.assign(T.course.course, b.courseFields); send({ patches: T.patches }); });
    if (url.pathname.startsWith('/s/')) { // a student page, rendered by the real server components
      const [, , kind, lang, theme] = url.pathname.split('/');
      return ssr.render(kind, lang).then(html => doc(html, { lang, theme, script: false }), e => { res.statusCode = 500; res.end(String(e && e.stack)); });
    }
    if (url.pathname === '/api/study-groups' && req.method === 'POST') return body(b => { const [status, value] = groupsApi(b); send(value, status); });
    if (url.pathname === '/api/teacher/courses/' + COURSE && req.method === 'PATCH') return body(b => {
      T.patches.push(b);
      if (T.patch === 'changed') { T.course.course.updatedAt = '2026-11-27T08:59:59.000000+00:00'; return send({ error: 'Course changed. Reload before saving.' }, 409); } // someone else saved meanwhile
      if (T.patch === 'denied') return send({ error: 'Only the course owner, its instructor or the space owner or admin can publish, unpublish or archive a course' }, 403);
      const c = T.course.course; Object.assign(c, 'title' in b ? { title: b.title } : {}, 'description' in b ? { description: b.description } : {}, b.status ? { status: b.status } : {}); c.updatedAt = '2026-11-27T09:00:0' + T.patches.length + '.000000+00:00';
      return send({ id: COURSE });
    });
    if (url.pathname === '/api/teacher/courses/' + COURSE + '/content') return send({ archived: T.course.course.status === 'archived', canEdit: true, chapters: [{ id: uuid(80), title: 'Motion', type: 'chapter', number: 1, position: 0, updatedAt: '2026-11-27T09:00:00.000000+00:00' }], lessons: [{ id: uuid(81), chapterId: uuid(80), title: 'Speed and velocity', position: 0, status: 'published', updatedAt: '2026-11-27T09:00:00.000000+00:00', homework: 1, draftHomework: 0, deleteBlockers: [], contentBlocks: 0, hasCover: false, parts: 1 }] });
    if (url.pathname === '/api/teacher/academics') return send({ courseId: COURSE, revision: 1, stageIds: [uuid(70)], selected: [{ id: uuid(70), label: 'Grade 9', status: 'active', programLabel: 'National', programStatus: 'active' }] });
    if (url.pathname.startsWith('/api/')) { const report = (() => { try { return require('./reports-fixture.cjs')(url); } catch { return null; } })(); if (report) return send(report.body, report.status); if (url.pathname === '/api/communications') return send({ rows: [], page: 0, unread: 0 }); return send({ rows: [], page: 0 }); }
    doc('<div id="root"></div>');
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
    await page.goto(origin + p);
    return { page, context };
  };
  const shot = (page, name, full = true) => page.screenshot({ path: path.join(shots, name + '.png'), fullPage: full });
  const MATRIX = [['phone', 'light', 'en'], ['wide', 'light', 'en'], ['wide', 'dark', 'en'], ['phone', 'dark', 'ar']];
  const overflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  const done = [];
  const only = process.env.LMS_ONLY_STEPS ? new RegExp(process.env.LMS_ONLY_STEPS) : null;
  const step = async (name, fn) => { if (only && !only.test(name)) return; await ctl({ reset: true }); await fn(); done.push(name); console.log('PASS', name); };

  // 1 and 2: the student Home (lesson cards) and the course page (top section, Groups box, lesson cards)
  for (const kind of ['home', 'course']) await step('student ' + kind, async () => {
    for (const [size, theme, lang] of MATRIX) {
      const { page, context } = await open(size, `/s/${kind}/${lang}/${theme}`, { lang, theme });
      await page.waitForLoadState('networkidle');
      const text = await page.locator('main').innerText();
      if (after) {
        assert.ok(await overflow(page), 'no sideways scroll ' + kind + ' ' + size);
        assert.doesNotMatch(text, /\bLocked\b|غير متاح/, 'no lesson the student can open says Locked');
        assert.match(text, lang === 'ar' ? /فتح الدرس/ : /Open lesson/);
        if (kind === 'course') {
          assert.doesNotMatch(text, /đánh giá|4\/5|awaiting integration|Feedbacks|Your enrollment|blended/i, 'no leftovers');
          assert.equal(await page.locator('[data-course-continue]').getAttribute('href'), `/courses/${COURSE}/chapters/${uuid(41)}?offering=${RUN}`, 'Continue opens the part Continue Learning would');
          assert.match(text, lang === 'ar' ? /مجموعاتك[\s\S]*Saturday Group[\s\S]*الحصة القادمة/ : /Your Groups[\s\S]*Saturday Group[\s\S]*Next session:/);
          if (size === 'wide') { // the top section lines up with the lessons below
            const [top, lessons] = await Promise.all([page.locator('[data-course-detail]').boundingBox(), page.locator('[data-course-page] > div').last().boundingBox()]);
            assert.ok(Math.abs(top.x - lessons.x) <= 1 && Math.abs(top.width - lessons.width) <= 1, `aligned: ${JSON.stringify(top)} ${JSON.stringify(lessons)}`);
          }
        }
      }
      await shot(page, `${kind === 'home' ? '1-student-home' : '2-student-course'}-${size}-${theme}-${lang}`); await context.close();
    }
  });

  // 3: Home and Groups in the teacher frame
  for (const [name, p] of [['3-teacher-home', '/home'], ['3-teacher-groups', '/teacher/groups'], ['3-teacher-group', '/teacher/groups/' + GROUP]]) await step(name, async () => {
    for (const [size, theme, lang] of MATRIX) {
      const { page, context } = await open(size, p, { lang, theme });
      await page.locator('main.d-main-inner').waitFor(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
      if (after && size === 'wide') {
        const [main, side] = await Promise.all([page.locator('main.d-main-inner').boundingBox(), page.locator('aside').first().boundingBox()]);
        const room = SIZES.wide.width - side.width, left = main.x - side.width, right = SIZES.wide.width - main.x - main.width;
        if (lang === 'ar') assert.ok(Math.abs((main.x) - (SIZES.wide.width - side.width - main.x - main.width)) <= 2, 'centred (rtl)'); else assert.ok(Math.abs(left - right) <= 2, `centred beside the menu: ${left} ${right} of ${room}`);
        assert.ok(main.width <= 1040 + 64 + 1, 'one sensible width');
      }
      if (after && size === 'phone') assert.ok(await overflow(page), 'phone unchanged: no sideways scroll');
      await shot(page, `${name}-${size}-${theme}-${lang}`); await context.close();
    }
  });

  // 4: Add a student, refused by the database: where the message is, and what it says
  await step('4-add-student-refused', async () => {
    for (const [size, theme, lang] of MATRIX) {
      const { page, context } = await open(size, '/teacher/groups/' + GROUP, { lang, theme });
      await page.locator('[role="tab"]').nth(1).click();
      await page.locator('[data-add-student]').first().click();
      const target = page.locator('[data-eligible]').nth(1); await target.waitFor();
      await target.locator('[data-add-one]').click();
      await page.locator('[role="dialog"] [role="alert"]').waitFor();
      if (after) {
        const alert = target.locator('[role="alert"]');
        assert.equal(await alert.count(), 1, 'said on the row whose Add was pressed');
        assert.match(await alert.innerText(), lang === 'ar' ? /في مجموعة أخرى لهذه الدورة/ : /Omar Khaled 2 is already in another Group of this course/);
        assert.ok(await alert.isVisible() && await alert.evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'visible where the teacher is looking');
        assert.equal(await target.locator('[data-add-one]').getAttribute('aria-describedby'), await target.locator('[data-add-error]').getAttribute('id'));
      }
      await shot(page, `4-add-refused-${size}-${theme}-${lang}`, false); await context.close();
    }
    if (after) for (const [reason, words] of [['full', /This Group is full/], ['no_access', /no longer has access to this course/]]) {
      await ctl({ addRefusal: reason });
      const { page, context } = await open('phone', '/teacher/groups/' + GROUP);
      await page.locator('[role="tab"]').nth(1).click(); await page.locator('[data-add-student]').first().click();
      const target = page.locator('[data-eligible]').nth(1); await target.locator('[data-add-one]').click();
      assert.match(await target.locator('[role="alert"]').innerText(), words); await shot(page, `4-add-refused-${reason}-phone-light-en`, false); await context.close();
    }
  });

  // 5: course settings
  await step('5-course-settings', async () => {
    for (const [size, theme, lang] of MATRIX) {
      const { page, context } = await open(size, '/teacher/settings/courses/' + COURSE, { lang, theme });
      await page.locator('[data-teacher-course]').waitFor(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
      if (after) { assert.equal(await page.locator('[data-course-settings]').count(), 1); assert.equal(await page.locator('[data-course-archive]').count(), 1); assert.ok(await overflow(page)); }
      await shot(page, `5-course-${size}-${theme}-${lang}`); await context.close();
    }
    if (!after) return;
    // rename: only the changed field is sent, with the version read
    let o = await open('phone', '/teacher/settings/courses/' + COURSE);
    await o.page.locator('[data-course-name]').fill('Synthetic Physics 9 (2026)'); await o.page.locator('[data-course-save]').click();
    await o.page.waitForFunction(() => document.querySelector('[data-course-title]')?.textContent.includes('(2026)'));
    let s = await ctl({}); assert.deepEqual(s.patches, [{ updated_at: '2026-11-27T09:00:00.000000+00:00', title: 'Synthetic Physics 9 (2026)' }]);
    await o.context.close();
    // an empty name is refused on the page, nothing sent
    await ctl({ reset: true }); o = await open('phone', '/teacher/settings/courses/' + COURSE);
    await o.page.locator('[data-course-name]').fill('  '); await o.page.locator('[data-course-save]').click();
    assert.match(await o.page.locator('[data-course-settings] [role="alert"]').innerText(), /Enter a course name/); assert.equal((await ctl({})).patches.length, 0);
    await shot(o.page, '5-course-empty-name-phone-light-en'); await o.context.close();
    // changed elsewhere (PT409): said plainly, Reload keeps what was typed
    await ctl({ reset: true, patch: 'changed' }); o = await open('wide', '/teacher/settings/courses/' + COURSE);
    await o.page.locator('[data-course-about]').fill('A new description typed here.'); await o.page.locator('[data-course-save]').click();
    const alert = o.page.locator('[data-failure="changed"]'); await alert.waitFor(); assert.match(await alert.innerText(), /changed somewhere else\. Reload/);
    await shot(o.page, '5-course-changed-wide-light-en'); await ctl({ patch: 'ok' });
    await alert.locator('[data-course-reload]').click(); await o.page.waitForFunction(() => !document.querySelector('[data-failure]'));
    assert.equal(await o.page.locator('[data-course-about]').inputValue(), 'A new description typed here.', 'the typing survives the reload'); await o.context.close();
    // archive asks first
    await ctl({ reset: true }); o = await open('phone', '/teacher/settings/courses/' + COURSE, { lang: 'ar', theme: 'dark' });
    await o.page.locator('[data-course-archive]').click(); await o.page.locator('[data-confirm="archived"]').waitFor();
    assert.match(await o.page.locator('[data-confirm]').innerText(), /أرشفة/); assert.equal((await ctl({})).patches.length, 0, 'asking changes nothing');
    await shot(o.page, '5-course-archive-confirm-phone-dark-ar'); await o.context.close();
    o = await open('wide', '/teacher/settings/courses/' + COURSE);
    await o.page.locator('[data-course-archive]').click(); await shot(o.page, '5-course-archive-confirm-wide-light-en');
    await o.page.locator('[data-confirm-yes]').click(); await o.page.locator('[data-status="archived"]').waitFor();
    assert.equal((await ctl({})).patches.at(-1).status, 'archived'); assert.equal(await o.page.locator('[data-course-restore]').count(), 1, 'the space owner or admin may restore');
    await shot(o.page, '5-course-archived-admin-wide-light-en'); await o.context.close();
    // an archived course for a course owner who is not a space owner or admin: no Restore
    await ctl({ reset: true, courseFields: { status: 'archived', canRestore: false } }); o = await open('wide', '/teacher/settings/courses/' + COURSE);
    await o.page.locator('[data-teacher-course]').waitFor(); assert.equal(await o.page.locator('[data-course-restore]').count(), 0); assert.match(await o.page.locator('[data-cannot-edit]').innerText(), /Only the space owner or an admin can restore/);
    await o.context.close();
    // an editor: text only, no status buttons
    await ctl({ reset: true, courseFields: { canChangeStatus: false, canRestore: false } }); o = await open('wide', '/teacher/settings/courses/' + COURSE, { theme: 'dark' });
    await o.page.locator('[data-course-settings]').waitFor(); assert.equal(await o.page.locator('[data-course-publish], [data-course-archive]').count(), 0);
    assert.match(await o.page.locator('[data-cannot-edit]').innerText(), /Only the course owner, its instructor/); await shot(o.page, '5-course-editor-wide-dark-en'); await o.context.close();
    // a refused status change says who may do it
    await ctl({ reset: true, patch: 'denied' }); o = await open('phone', '/teacher/settings/courses/' + COURSE);
    await o.page.locator('[data-course-publish]').click(); await o.page.locator('[data-confirm-yes]').click();
    assert.match(await o.page.locator('[data-failure="denied"]').innerText(), /Only the course owner, its instructor/); await o.context.close();
  });

  await browser.close(); server.close();
  assert.deepEqual(errors, [], 'no page errors');
  if (process.env.LMS_COPY_SHOTS) { fs.mkdirSync(docs, { recursive: true }); for (const f of fs.readdirSync(docs)) if (f.endsWith('.png')) fs.unlinkSync(path.join(docs, f)); for (const f of fs.readdirSync(shots)) fs.copyFileSync(path.join(shots, f), path.join(docs, f)); }
  console.log(`ui-quick-fixes (${AS}): ${done.length} groups. Pictures: ${shots}`);
})().catch(e => { console.error(e); process.exit(1); });
