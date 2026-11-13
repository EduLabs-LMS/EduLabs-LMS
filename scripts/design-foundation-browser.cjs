// The design foundation in Chromium: the real frame, Home, Settings switch and shared components, the real stylesheet and fonts, synthetic loopback data only.
// The test server answers like the real root layout: it reads the cookie with the real designFromCookie and writes data-design into the first byte of <html>.
// Not provider acceptance. Needs a Firebase-mode `npm run build` first (font faces) and LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME.
const { shootMatrix } = require('./screen-matrix.cjs');
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('node:assert/strict');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const { designFromCookie, designCookieKey } = require('./localization-test-loader.cjs').load('shared/design.ts');
const out = path.resolve('.local/design-foundation-browser'), shots = path.join(out, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the real fonts are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat([require('./harness-css.cjs')()]).join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

const entry = `
import React, { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider, L } from '@/frontend/components/language-provider';
import { ToastProvider } from '@/frontend/components/providers/toast-provider';
import { actionToast } from '@/frontend/lib/action-toast';
import { usePathname } from 'next/navigation';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { TeacherFrame } from '@/frontend/features/teacher-frame/teacher-frame';
import { TeacherHomeView } from '@/frontend/features/teacher-home/home-view';
import { TeacherSettingsShell } from '@/frontend/features/teacher-settings/shell';
import { DesignSettings } from '@/frontend/features/teacher-settings/design-settings';
import { LeaveQuestion, useLeaveGuard } from '@/frontend/features/teacher-attendance/leave-guard';
import { buildTeacherHome, createTargets } from '@/shared/teacher-home';
import { Avatar, Button, buttonClass, Card, CardHead, ChoiceGroup, DateTile, DesignSkeleton, Dialog, Field, Icon, IconBadge, ListRow, PageHeader, SearchField, SegmentedControl, Select, StatusPill, Switch, Tabs } from '@/frontend/components/design';
import { FirstLoadLogo } from '@/frontend/components/loading-overlay';
import { NotificationsView } from '@/frontend/features/notifications/notifications-view';
import { LanguageSettings } from '@/frontend/features/personalization/language-settings';
import { AppearanceSettings } from '@/frontend/features/personalization/appearance-settings';
const q = new URLSearchParams(location.search), view = q.get('view') || 'home';
window.__pathname = q.get('path') || ({ home: '/home', settings: '/teacher/settings/language', gallery: '/teacher/groups', controls: '/teacher/groups', notifications: '/notifications', language: '/teacher/settings/language', logo: '/home', guard: '/teacher/groups/g/attendance/s' })[view];
// The server's clock can be given, to prove the screen does not read the device's.
const NOW = Number(q.get('serverNow')) || Date.now(), at = m => new Date(NOW + m * 60000).toISOString();
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ok = value => ({ ok: true, value });
const group = (n, name) => ({ id: uuid(n), offering_id: uuid(100 + n), offering_name: 'Synthetic offering', name, description: '', mode: 'online', location: '', join_url: '', instructions: '', capacity: null, status: 'active', version: 1, staff: true, instructor: false });
const session = (n, g, name, start, extra = {}) => ({ id: uuid(200 + n), group_id: uuid(g), group_name: name, title: 'Synthetic lesson ' + n, starts_at: at(start), ends_at: at(start + 60), mode: 'online', location: '', join_url: '', instructions: '', cancelled: false, version: 1, attendance_state: 'draft', state: 'upcoming', ...extra });
const note = (n, event, m) => ({ id: uuid(300 + n), event_type: event, created_at: at(m), read_at: null, link: null });
const raw = {
 courses: ok([]), now: NOW,
 groups: ok({ rows: [group(1, 'Synthetic Group Alpha'), group(2, 'مجموعة الصف العاشر'), group(3, 'Synthetic Group Gamma')], page: 0, hasMore: false }),
 upcoming: ok({ rows: q.get('upcoming') ? q.get('upcoming').split(',').map((m, i) => session(50 + i, 1, 'Synthetic Group Alpha', Number(m))) : [session(1, 1, 'Synthetic Group Alpha', -20), session(2, 2, 'مجموعة الصف العاشر', 1500), session(3, 1, 'Synthetic Group Alpha', 3000), session(4, 3, 'Synthetic Group Gamma', 4400)], page: 0 }),
 notifications: ok({ rows: [note(1, 'support_reply', -30), note(2, 'session_details', -300), note(3, 'session_starting', -60)], page: 0, unread: 3 }),
 unsaved: ok([{ groupId: uuid(3), rows: [session(14, 3, 'Synthetic Group Gamma', -4000)] }]),
 metrics: ok({ totalStudents: 41, pendingWaitlistCount: 3 }), nextFacts: { kind: 'marked', marked: 9, total: 14 },
};
const targets = createTargets([{ id: uuid(50), name: 'Synthetic space', status: 'active' }], [{ organization_id: uuid(50), role: 'teacher', status: 'active' }]);
const home = { ...buildTeacherHome(raw), createTargets: targets, demo: false, homework: { state: 'unavailable' } }; // the Homework to correct card has its own harness (homework-correct-browser.cjs)

function Gallery() {
 const [dialog, setDialog] = useState(false), [tab, setTab] = useState('one'), [seg, setSeg] = useState('a');
 return <div data-gallery className="grid gap-6">
  <PageHeader data-gallery-header title="Synthetic page" back={{ href: '/teacher/groups', label: 'Groups' }} pill={<StatusPill tone="success" dot>Active</StatusPill>} meta="One meta line" primary={{ key: 'p', label: 'Take attendance', onClick: () => { window.__primary = (window.__primary || 0) + 1; } }} secondary={[{ key: 's', label: 'Edit', onClick: () => { window.__secondary = true; } }, { key: 'd', label: 'Delete', destructive: true, onClick: () => { window.__destructive = true; } }]} />
  <Card data-gallery-buttons className="p-4"><div className="flex flex-wrap items-center gap-3">
   <Button data-variant="primary" variant="primary">Primary</Button><Button data-variant="secondary" variant="secondary">Secondary</Button><Button data-variant="tertiary" variant="tertiary">Tertiary</Button><Button data-variant="destructive" variant="destructive">Destructive</Button><Button data-variant="icon" variant="icon" aria-label="More"><Icon name="more" /></Button>
   <Button data-open-dialog variant="secondary" onClick={() => setDialog(true)}>Open dialog</Button>
   <Button data-toast-button variant="secondary" onClick={() => actionToast('Synthetic action done')}>Toast</Button>
  </div></Card>
  <Card data-gallery-pills className="p-4"><div className="flex flex-wrap items-center gap-3">{['success', 'info', 'warning', 'danger', 'neutral'].map(t => <StatusPill key={t} tone={t} data-pill={t}>{t}</StatusPill>)}{['success', 'info', 'warning', 'danger', 'neutral'].map(t => <IconBadge key={t} name="bell" tone={t} />)}</div></Card>
  <Card data-gallery-list list aria-labelledby="gallery-list"><CardHead id="gallery-list" title="A list" action={<a href="#all" className={buttonClass('tertiary')}>See all</a>} /><ul>
   <ListRow leading={<DateTile value={at(1500)} />} title="Row with a date tile" meta="Tomorrow" trailing={<StatusPill tone="info">Online</StatusPill>} />
   <ListRow leading={<Avatar id={uuid(1)} name="Synthetic Student" />} title="Row with an avatar" meta="Synthetic meta" />
   <ListRow leading={<Avatar id={uuid(2)} name="طالب تجريبي" />} title="Row that is a link" meta="Synthetic meta" href="/teacher/students" />
  </ul></Card>
  <Card data-gallery-forms className="grid gap-4 p-4"><Field label="Name" hint="Hint text" defaultValue="Synthetic" /><Field label="With a problem" error="This needs fixing" /><SearchField label="Search" placeholder="Search" /><Tabs data-gallery-tabs label="Sections" active={tab} onSelect={setTab} items={[{ key: 'one', label: 'One' }, { key: 'two', label: 'Two' }, { key: 'three', label: 'Three' }]} /><SegmentedControl data-gallery-seg label="Choice" value={seg} onChange={setSeg} options={[{ value: 'a', label: 'First' }, { value: 'b', label: 'Second' }]} /><DesignSkeleton className="h-16" /></Card>
  <Dialog data-gallery-dialog open={dialog} onOpenChange={setDialog} title="A dialog" description="A question to confirm." footer={<><Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button><Button variant="primary" onClick={() => setDialog(false)}>Confirm</Button></>} />
 </div>;
}
function Controls() {
 const [on, setOn] = useState(false), [pick, setPick] = useState('a'), [value, setValue] = useState('two'), [inDialog, setInDialog] = useState(false), [dialogValue, setDialogValue] = useState('one');
 const list = [{ value: 'one', label: 'One option' }, { value: 'two', label: 'Two option' }, { value: 'locked', label: 'Locked option', disabled: true }, { value: 'three', label: 'Three option' }];
 return <div data-gallery-controls className="grid gap-4">
  <Switch data-switch="plain" checked={on} onChange={setOn} label="Plain switch" />
  <Switch data-switch="named" aria-label="A full spoken name" checked={on} onChange={setOn} label="Short" />
  <Switch data-switch="off" checked={false} onChange={() => { window.__wrong = true; }} disabled reason="Synthetic reason it is off" label="Disabled switch" />
  <ChoiceGroup data-choices="plain" label="Pick one" value={pick} onChange={setPick} columns={3} options={[{ value: 'a', label: 'First', description: 'First line' }, { value: 'b', label: 'Second', description: 'Second line' }, { value: 'c', label: 'Third', description: 'Third line' }]} />
  <ChoiceGroup data-choices="off" label="Cannot pick" value="a" onChange={() => { window.__wrong = true; }} disabled reason="Synthetic reason the choice is off" options={[{ value: 'a', label: 'First' }, { value: 'b', label: 'Second' }]} />
  <label className="block space-y-1" data-select-label><span>Synthetic list</span><Select data-select="plain" value={value} onChange={setValue} options={list} /></label>
  <Button data-open-select-dialog variant="secondary" onClick={() => setInDialog(true)}>Select in a dialog</Button>
  <Dialog open={inDialog} onOpenChange={setInDialog} title="A dialog with a list"><label className="block space-y-1"><span>In a dialog</span><Select data-select="dialog" value={dialogValue} onChange={setDialogValue} options={list} /></label></Dialog>
 </div>;
}
function GuardPage() {
 const guard = useLeaveGuard(true, href => { window.__left = href; });
 return <div data-guard-page><h1 className="d-title">Attendance</h1>{guard.asking && <LeaveQuestion stay={guard.stay} leave={guard.leave} />}</div>;
}
function Body() {
 if (view === 'settings') return <TeacherSettingsShell><DesignSettings initial={document.documentElement.dataset.design} /></TeacherSettingsShell>;
 if (view === 'gallery') return <><Gallery /><DesignSkeleton className="h-6 w-40" /></>;
 if (view === 'controls') return <Controls />;
 if (view === 'notifications') return <NotificationsView />;
 if (view === 'language') return <div className="space-y-6"><LanguageSettings /><AppearanceSettings /><DesignSettings initial={document.documentElement.dataset.design} /></div>;
 if (view === 'logo') return <div data-logo-panel className="bg-background"><FirstLoadLogo /></div>;
 if (view === 'guard') return <GuardPage />;
 return <TeacherHomeView data={home} />;
}
// A page has its first render when the address changes; a refresh (window.__refresh) brings new data to the page that is already there.
function Page() {
 const path = usePathname();
 const [revision, setRevision] = useState(0); window.__refresh = () => setRevision(v => v + 1);
 return <TeacherFrame><Body key={path} /><span hidden data-revision={revision} /></TeacherFrame>;
}
const lang = q.get('lang') === 'ar' ? 'ar' : 'en';
document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
createRoot(document.getElementById('root')).render(
 <LanguageProvider initialLanguage={lang}>
  <ThemeProvider attribute="class" defaultTheme={q.get('theme') === 'dark' ? 'dark' : 'light'} enableSystem={false} disableTransitionOnChange><Page /><ToastProvider /></ThemeProvider>
 </LanguageProvider>);
`;

// Page-side helpers: installed once per page.
const helpers = () => {
  const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3), a: p[3] === undefined ? 1 : p[3] }; };
  const over = (top, under) => top.rgb.map((c, i) => c * top.a + under[i] * (1 - top.a));
  const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const visible = e => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0 && r.width > 0 && r.height > 0; };
  window.__h = {
    contrast: ratio,
    /** The colours behind an element: every stop of a gradient counts, translucent layers composite on what is under them. */
    behind(element) {
      const chain = []; for (let e = element; e; e = e.parentElement) chain.push(e);
      let under = [[255, 255, 255]];
      for (const e of chain.reverse()) {
        const s = getComputedStyle(e), image = s.backgroundImage;
        const fill = parse(s.backgroundColor);
        if (fill && fill.a > 0) under = under.map(u => over(fill, u));
        // In New with motion on, the active menu pill is a layer of its own (design-components.css).
        if (e.matches('.d-nav, .d-bottom-tab-icon')) { const layer = getComputedStyle(e, '::before'), pill = parse(layer.backgroundColor); if (layer.content !== 'none' && pill && pill.a > 0 && +layer.opacity > 0) under = under.map(u => over(pill, u)); }
        if (image && image.includes('gradient')) { const stops = [...image.matchAll(/rgba?\([^)]+\)/g)].map(m => parse(m[0])); under = stops.flatMap(stop => under.map(u => over(stop, u))); }
      }
      return under;
    },
    /** Every piece of visible text that falls under WCAG AA. Disabled controls are exempt. */
    lowContrast(root = document.body) {
      const bad = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const e = n.parentElement; if (!n.textContent.trim() || !e || !visible(e) || e.closest('[disabled],[aria-disabled="true"],script,style')) continue;
        const s = getComputedStyle(e), color = parse(s.color); if (!color) continue;
        const size = parseFloat(s.fontSize), bold = +s.fontWeight >= 700, large = size >= 24 || (bold && size >= 18.66), need = large ? 3 : 4.5;
        for (const back of this.behind(e)) { const value = ratio(over(color, back), back); if (value < need - 0.01) { bad.push(`${n.textContent.trim().slice(0, 40)} = ${value.toFixed(2)} (${s.color} on ${back.map(Math.round)})`); break; } }
      }
      return bad;
    },
    /** A black outline or a hard black shadow anywhere. */
    blackEdges(root = document.body) {
      const bad = [], black = c => { const p = parse(c); return p && p.a > 0.5 && p.rgb.every(v => v < 16); };
      for (const e of [root, ...root.querySelectorAll('*')]) {
        if (!visible(e) || e.closest('svg')) continue;
        const s = getComputedStyle(e);
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none' && black(s[`border${side}Color`])) { bad.push(`border ${e.tagName}.${String(e.className).slice(0, 60)}`); break; }
        if (s.boxShadow !== 'none') for (const m of s.boxShadow.matchAll(/(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/g)) if (black(m[1]) && +m[4] === 0) bad.push(`shadow ${e.tagName}.${String(e.className).slice(0, 60)}`);
      }
      return bad;
    },
    /** Controls under 44px, apart from ones the text flow owns (a link inside a sentence) and the screen-reader-only ones. */
    tiny(root = document.body, min = 44) {
      return [...root.querySelectorAll('a[href], button, input:not([type="radio"]), select, textarea, [role="tab"], [role="menuitem"], .d-seg-option')].filter(e => {
        if (!visible(e) || e.closest('p') || e.closest('[data-teacher-phone-footer]') || e.closest('footer')) return false;
        const r = e.getBoundingClientRect(); return r.height < min - 0.5 || r.width < min - 0.5;
      }).map(e => `${e.tagName} ${e.innerText?.trim().slice(0, 30) || e.getAttribute('aria-label')} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
    },
    /** What the look must not change: the tags, data attributes and words of the page (owner decision b). */
    structure() {
      const walk = e => [e.tagName, ...[...e.attributes].filter(a => a.name.startsWith('data-') && a.name !== 'data-radix' && !a.name.includes('radix') && a.name !== 'data-enter').map(a => a.name + '=' + a.value), ...[...e.childNodes].map(n => n.nodeType === 3 ? n.textContent.replace(/\d+/g, '#').trim() : n.nodeType === 1 && n.tagName !== 'svg' ? walk(n) : '').filter(Boolean)];
      return JSON.stringify(walk(document.querySelector('[data-teacher-shell]'))).replace(/:r[\w]+:/g, '');
    },
  };
};

(async () => {
 const stubs = {
  'next/navigation': 'import { useSyncExternalStore } from "react"; import { flushSync } from "react-dom"; window.__pushes = window.__pushes || []; const subs = new Set(); window.__setPath = p => { window.__pathname = p; flushSync(() => subs.forEach(f => f())); }; export const usePathname = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => window.__pathname); export const useRouter = () => ({ push(p) { window.__pushes.push(p); }, replace() {}, refresh() {} });',
  '@/frontend/components/providers/use-loading-router': 'export const useLoadingRouter = () => ({ push(p) { window.__pushes.push(p); }, replace() {}, refresh() {} });',
  'next/link': 'import React from "react"; export default React.forwardRef(function Link({ href, children, onClick, ...rest }, ref) { return React.createElement("a", { ...rest, ref, href, onClick: e => { onClick && onClick(e); if (e.defaultPrevented) return; e.preventDefault(); (window.__clicks = window.__clicks || []).push(href); } }, children); });',
  'next/image': 'import React from "react"; export default function Image({ unoptimized, fill, priority, ...p }) { return React.createElement("img", p); }',
  '@/shared/auth-config': 'export const isFirebaseStaging = () => true;',
  '@/frontend/components/providers/application-auth-provider': 'export const useApplicationAuth = () => ({ user: { fullName: "Synthetic Teacher", email: "synthetic.teacher@example.test", imageUrl: null, id: "u" }, signOut: async () => { window.__signedOut = true; } }); export const useWebsiteNavigation = () => ({ viewer: { id: "v", displayName: "Synthetic Viewer" }, organizations: [{ id: "00000000-0000-4000-8000-000000000050", name: "Synthetic space" }], staffOrganizationIds: ["00000000-0000-4000-8000-000000000050"] }); export const WebsiteNavigationProvider = ({ children }) => children;',
  '@/frontend/components/providers/v2-identity': 'export const useUser = () => ({ user: { fullName: "Synthetic Teacher" } }); export const useClerk = () => ({ signOut() {} }); export const UserButton = () => null;',
 };
 const resolveAlias = p => { for (const c of [p + '.tsx', p + '.ts', path.join(p, 'index.tsx'), path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return p; };
 await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: path.join(out, 'app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'boundary', setup(b) {
   b.onResolve({ filter: /.*/ }, a => { if (stubs[a.path]) return { path: a.path, namespace: 'stub' }; if (a.path.startsWith('@/')) return { path: resolveAlias(path.resolve(a.path.slice(2))) }; });
   b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'jsx', resolveDir: process.cwd() }));
  } }] });

 const cookiesSeen = [];
 const noteCalls = [];
 // The real layout sends the teacher frame in the first byte of <body>; this client-rendered page stands in for it with an empty element, so the first frame's tokens are measured as they would be.
 const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname.startsWith('/_next/static/media/')) { const f = path.join(mediaDir, path.basename(url.pathname)); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(f)); }
  if (url.pathname === '/api/communications') { let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
   const { action, data } = JSON.parse(raw || '{}'); noteCalls.push({ action, data });
   if (action === 'preferences') return send([]);
   if (action === 'push-config') return send({ publicKey: null });
   if (action === 'preference' || action === 'read' || action === 'unread' || action === 'read-all') return send({});
   if (action === 'list' && data?.filter) return send({ page: data.page ?? 0, unread: 3, rows: data.filter === 'read' ? [] : [{ id: 'a0000000-0000-4000-8000-000000000001', event_type: 'support_reply', created_at: new Date(Date.now() - 1800000).toISOString(), read_at: null, link: '/support' }, { id: 'a0000000-0000-4000-8000-000000000002', event_type: 'session_details', created_at: new Date(Date.now() - 7200000).toISOString(), read_at: new Date().toISOString(), link: null }] });
   return send({ rows: [], page: 0, unread: 3 });
  }); return; }
  if (url.pathname === '/api/user/status') return send({ user: { role: 'teacher' } });
  if (url.pathname === '/') {
   const cookie = /(?:^|;\s*)([^=;]+)=([^;]*)/g, jar = {}; for (const m of (req.headers.cookie || '').matchAll(cookie)) jar[m[1]] = m[2];
   cookiesSeen.push(req.headers.cookie || '');
   const design = designFromCookie(jar[designCookieKey]);
   res.setHeader('Content-Type', 'text/html; charset=utf-8');
   return res.end(`<!doctype html><html lang="en" data-lms-appearance data-design="${design}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="${fontVars} font-sans"><div data-teacher-shell hidden></div><div id="root"></div><script src="/app.js"></script></body></html>`);
  }
  res.statusCode = 404; res.end();
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
 const errors = [], external = [], results = [];
 const desktop = { width: 1440, height: 900 }, phone = { width: 390, height: 844 };
 /** look: the cookie this browser already has (undefined = none). */
 const open = async (viewport, query, look, { beforeGoto, ...extra } = {}) => {
  const lang = /lang=ar/.test(query) ? 'ar' : 'en';
  const context = await browser.newContext({ viewport, locale: lang, ...extra });
  if (look !== undefined) await context.addCookies([{ name: designCookieKey, value: look, url: origin }]);
  const page = await context.newPage();
  await page.addInitScript(l => { try { localStorage.setItem('edulabs-lms-language', l); } catch {} }, lang);
  await page.addInitScript(helpers);
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message.slice(0, 300)); }); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', r => { if (r.request().url().startsWith(origin)) return r.continue(); external.push(r.request().url()); return r.abort(); });
  if (beforeGoto) await beforeGoto(page);
  await page.goto(origin + '/?' + query);
  await page.locator('[data-teacher-shell][data-lms-shell]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  // Measure a page at rest: its first render's animation has ended. A test of that animation changes the address itself.
  await page.waitForFunction(() => !document.querySelector('main[data-enter]'));
  return { page, context };
 };
 const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
 const shot = (page, name) => page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
 const only = process.env.LMS_ONLY_STEPS && new RegExp(process.env.LMS_ONLY_STEPS); // for working on one group; a full run sets nothing
 const step = async (name, fn) => { if (only && !only.test(name)) return; try { await fn(); results.push('PASS ' + name); console.log('PASS', name); } catch (e) { console.log('FAIL', name); console.error(e); process.exit(1); } };
 const box = (page, selector) => page.locator(selector).first().boundingBox();
 const css1 = (page, selector, property) => page.locator(selector).first().evaluate((e, p) => getComputedStyle(e)[p], property);

 await step('Desktop frame, both looks: a 240px sidebar flush to the edge, six links, Notifications, Settings and the profile row at the bottom', async () => {
  for (const look of ['classic', 'new']) {
   const { page, context } = await open(desktop, 'view=home', look);
   await page.locator('[data-teacher-home]').waitFor();
   const side = await box(page, '[data-teacher-sidebar]');
   assert.equal(side.x, 0, look); assert.equal(side.y, 0, look); assert.equal(side.width, 240, look); assert.equal(side.height, desktop.height, look);
   assert.deepEqual(await page.locator('[data-teacher-nav] a').evaluateAll(n => n.map(e => e.textContent.trim())), ['Home', 'Groups', 'Students', 'Courses', 'Homework', 'Exams'], look);
   assert.deepEqual(await page.locator('[data-teacher-nav] a').evaluateAll(n => n.map(e => e.getAttribute('href'))), ['/home', '/teacher/groups', '/teacher/students', '/teacher/courses', '/teacher/homework', '/teacher/exams'], look);
   assert.match(await page.locator('[data-teacher-sidebar] a.d-logo').innerText(), /EduLabs/); assert.equal(await page.locator('[data-teacher-sidebar] a.d-logo').count(), 1, 'one link to Home'); assert.equal(await page.locator('[data-teacher-sidebar] a.d-logo').getAttribute('href'), '/home');
   assert.equal(await page.locator('[data-unread-count]').innerText(), '3');
   const nav = await box(page, '[data-nav="notifications"]'), settings = await box(page, '[data-nav="settings"]'), profile = await box(page, '[data-teacher-profile]');
   assert.ok(nav.y < settings.y && settings.y < profile.y, 'bell, Settings, profile, top to bottom'); assert.ok(profile.y + profile.height <= desktop.height, 'the profile row stays on screen');
   assert.equal(await page.locator('[data-profile-name]').innerText(), 'Synthetic Teacher'); assert.equal(await page.locator('[data-profile-space]').innerText(), 'Synthetic space');
   await page.locator('[data-teacher-profile]').click();
   await page.locator('[data-profile-menu]').waitFor();
   assert.deepEqual(await page.locator('[data-profile-menu] [role="menuitem"]').allInnerTexts(), ['Settings', 'Help', 'Sign out']);
   assert.equal(await page.locator('[data-teacher-settings-link]').getAttribute('href'), '/teacher/settings'); assert.equal(await page.locator('[data-teacher-support]').getAttribute('href'), '/support');
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('[data-teacher-tabs]').isVisible(), false); assert.equal(await page.locator('[data-teacher-phone-header]').isVisible(), false);
   assert.ok(await noOverflow(page), look);
   await context.close();
  }
 });

 await step('Arabic desktop, both looks: the sidebar is flush to the right edge and the content mirrors', async () => {
  for (const look of ['classic', 'new']) {
   const { page, context } = await open(desktop, 'view=home&lang=ar', look);
   await page.locator('[data-teacher-home]').waitFor();
   const side = await box(page, '[data-teacher-sidebar]');
   assert.equal(side.x + side.width, desktop.width, look); assert.equal(side.width, 240, look);
   assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
   const main = await box(page, '.d-main-inner'); assert.ok(main.x + main.width <= side.x + 1, 'the content does not run under the sidebar');
   assert.match(await page.locator('[data-teacher-sidebar]').innerText(), /[؀-ۿ]/);
   assert.ok(await noOverflow(page), look);
   await page.locator('[data-teacher-profile]').click(); await page.locator('[data-profile-menu]').waitFor();
   assert.match(await page.locator('[data-profile-menu]').innerText(), /[؀-ۿ]/);
   await context.close();
  }
 });

 await step('Phone frame, both looks: a 56px header, bell with a dot, four bottom tabs, More holds the rest, one line of footer', async () => {
  for (const look of ['classic', 'new']) for (const query of ['view=home', 'view=home&lang=ar']) {
   const { page, context } = await open(phone, query, look);
   await page.locator('[data-teacher-home]').waitFor();
   const header = await box(page, '[data-teacher-phone-header]');
   assert.equal(header.height, 56, look); assert.equal(header.y, 0); assert.equal(header.width, phone.width);
   assert.equal(await page.locator('[data-teacher-sidebar]').isVisible(), false);
   assert.equal(await page.locator('[data-unread-dot]').count(), 1, 'three unread');
   const bell = await box(page, '[data-teacher-bell]'); assert.ok(bell.width >= 44 && bell.height >= 44, 'the bell is a real target');
   assert.deepEqual(await page.locator('[data-bottom-tab]').evaluateAll(n => n.map(e => e.dataset.bottomTab)), ['home', 'groups', 'students', 'more']);
   for (const b of await page.locator('[data-bottom-tab]').evaluateAll(n => n.map(e => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }))) assert.ok(b[0] >= 44 && b[1] >= 44, 'tab target');
   const bar = await box(page, '[data-teacher-tabs]'); assert.equal(Math.round(bar.y + bar.height), phone.height, 'tabs at the very bottom'); assert.equal(bar.width, phone.width);
   assert.equal(await page.locator('footer').first().isVisible().catch(() => false), false, 'the long footer stays on desktop');
   assert.equal(await page.locator('[data-teacher-phone-footer]').evaluate(e => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].map(b => Math.round(b.top))).size; }), 1, 'one line of footer');
   await page.locator('[data-bottom-tab="more"]').click();
   await page.locator('[data-more-sheet]').waitFor();
   assert.deepEqual(await page.locator('[data-more-item]').evaluateAll(n => n.map(e => e.dataset.moreItem)), ['courses', 'homework', 'exams', 'reports', 'settings', 'help', 'signout']);
   await page.waitForTimeout(300); // the sheet has finished sliding up
   const sheet = await box(page, '[data-more-sheet]'); assert.ok(Math.abs(sheet.y + sheet.height - phone.height) < 2, 'a bottom sheet on a phone');
   for (const b of await page.locator('[data-more-item]').evaluateAll(n => n.map(e => e.getBoundingClientRect().height))) assert.ok(b >= 44);
   await page.locator('[data-more-item="signout"]').click();
   assert.equal(await page.evaluate(() => window.__signedOut), true);
   assert.ok(await noOverflow(page), `${look} ${query}`);
   await context.close();
  }
 });

 await step('Attendance on a phone hides the tabs; the rest of the frame stays; the page does not leave room for them', async () => {
  for (const look of ['classic', 'new']) {
   const { page, context } = await open(phone, 'view=guard', look);
   assert.equal(await page.locator('[data-teacher-tabs]').count(), 0, 'no tabs on Attendance');
   assert.equal(await page.locator('[data-teacher-phone-header]').isVisible(), true);
   assert.equal(await page.locator('[data-teacher-shell][data-lms-shell]').getAttribute('data-tabs'), 'hidden');
   await context.close();
  }
  const { page, context } = await open(phone, 'view=home&path=' + encodeURIComponent('/teacher/groups/x'), 'new');
  assert.equal(await page.locator('[data-teacher-tabs]').count(), 1, 'a Group page keeps them'); assert.equal(await page.locator('[data-bottom-tab="groups"]').getAttribute('aria-current'), 'page');
  await context.close();
 });

 await step('Signing out of the frame during an unfinished attendance sheet asks first; staying keeps you signed in; leaving signs out', async () => {
  const { page, context } = await open(desktop, 'view=guard', 'new');
  page.on('dialog', d => d.accept());
  await page.locator('[data-guard-page]').waitFor();
  await page.locator('[data-teacher-profile]').click(); await page.locator('[data-teacher-signout]').click();
  await page.locator('[data-leave-stay]').waitFor();
  assert.equal(await page.evaluate(() => window.__signedOut), undefined, 'not signed out yet');
  await page.locator('[data-leave-stay]').click();
  assert.equal(await page.evaluate(() => window.__signedOut), undefined, 'stayed');
  await page.locator('[data-teacher-profile]').click(); await page.locator('[data-teacher-signout]').click();
  await page.locator('[data-leave-go]').click();
  await page.waitForFunction(() => window.__signedOut === true);
  await context.close();
 });

 await step('Active states: Courses and Settings light up on their own pages; a course page keeps Courses', async () => {
  for (const [p, active] of [['/teacher/courses', 'courses'], ['/teacher/settings/courses/x', 'courses'], ['/teacher/settings/account', 'settings'], ['/teacher/groups/x', 'groups'], ['/home', 'home']]) {
   const { page, context } = await open(desktop, 'view=home&path=' + encodeURIComponent(p), 'new');
   const current = await page.locator('[data-teacher-sidebar] [aria-current="page"]').evaluateAll(n => n.map(e => e.dataset.nav));
   const key = { courses: '/teacher/courses', groups: '/teacher/groups', home: '/home' }[active];
   if (active === 'settings') assert.deepEqual(current, ['settings'], p);
   else { assert.equal(current.length, 1, p); assert.equal(await page.locator('[data-teacher-sidebar] [aria-current="page"]').getAttribute('href'), key, p); }
   await context.close();
  }
 });

 await step('The switch, default: a first visit is New; a broken cookie is New; a chosen Classic stays Classic; the server writes it into the first byte', async () => {
  const raw = async cookie => { const r = await fetch(origin + '/?view=settings', { headers: cookie ? { cookie } : {} }); return (await r.text()).match(/<html[^>]*>/)[0]; };
  assert.match(await raw(), /data-design="new"/, 'a browser that has not chosen gets New');
  assert.match(await raw(`${designCookieKey}=new`), /data-design="new"/);
  assert.match(await raw(`${designCookieKey}=classic`), /data-design="classic"/);
  for (const bad of ['NEW', '%22%3E%3Cscript%3E', 'admin', '']) assert.match(await raw(`${designCookieKey}=${bad}`), /data-design="new"/, bad);
  const { page, context } = await open(desktop, 'view=settings');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.design), 'new');
  assert.equal(await page.locator('[data-design-option="new"]').getAttribute('aria-checked'), 'true'); assert.equal(await page.locator('[data-design-option="classic"]').getAttribute('aria-checked'), 'false');
  assert.equal((await context.cookies()).length, 0, 'choosing nothing stores nothing');
  await context.close();
 });

 await step('The opening logo keeps its black offset shadow in the light theme and draws none in the dark theme', async () => {
  for (const [query, shown] of [['view=logo', true], ['view=logo&theme=dark', false]]) {
   const { page, context } = await open(desktop, query, 'new'); await page.locator('[data-first-load-logo] svg').first().waitFor();
   if (!shown) await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
   const display = await page.locator('[data-first-load-logo] svg > g[aria-hidden="true"]').evaluate(e => getComputedStyle(e).display);
   assert.equal(display !== 'none', shown, query); await context.close();
  }
 });

 await step('New belongs to the teacher app: a page with no teacher shell keeps the Classic values, in light and dark, whatever the cookie says', async () => {
  for (const [query, expected] of [['view=settings', '#E9EEE4'], ['view=settings&theme=dark', 'HSL(140 14% 13%)']]) {
   const { page, context } = await open(desktop, query, 'new');
   if (query.includes('dark')) await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
   assert.equal(await page.evaluate(() => document.documentElement.dataset.design), 'new');
   assert.notEqual((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--d-canvas').trim())).toUpperCase(), expected, 'in the teacher app, New');
   await page.evaluate(() => document.querySelectorAll('[data-teacher-shell]').forEach(e => e.removeAttribute('data-teacher-shell')));
   assert.equal((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--d-canvas').trim())).toUpperCase(), expected, 'elsewhere, Classic');
   await context.close();
  }
 });

 await step('The switch, choosing: Settings changes the look at once with no reload, stores only the word, and persists after a reload with no flash', async () => {
  const { page, context } = await open(desktop, 'view=settings', 'classic');
  await page.evaluate(() => { window.__stay = true; });
  const before = await page.locator('[data-teacher-shell][data-lms-shell]').evaluate(() => getComputedStyle(document.body).getPropertyValue('--d-canvas').trim());
  await page.locator('[data-design-option="new"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.design), 'new');
  assert.equal(await page.evaluate(() => window.__stay), true, 'no reload');
  const after = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--d-canvas').trim());
  assert.notEqual(before, after); assert.equal(after.toUpperCase(), '#EDF1E8');
  const cookies = await context.cookies(), cookie = cookies.find(c => c.name === designCookieKey);
  assert.equal(cookies.length, 1); assert.equal(cookie.value, 'new', 'the word only: no user id, no email'); assert.equal(cookie.path, '/'); assert.equal(cookie.sameSite, 'Lax'); assert.ok(cookie.expires > Date.now() / 1000 + 300 * 86400, 'survives closing the browser');
  // No flash: from the very first byte of the reload, nothing ever changes the attribute and the first frame already has the New canvas.
  await page.addInitScript(() => {
   window.__designs = [];
   const record = () => { const d = document.documentElement?.dataset.design; if (window.__designs.at(-1) !== d) window.__designs.push(d); };
   new MutationObserver(record).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-design'], childList: true });
   const paint = () => { const b = document.body; if (b && !window.__firstPaint) window.__firstPaint = getComputedStyle(b).getPropertyValue('--d-canvas').trim(); if (!window.__firstPaint) requestAnimationFrame(paint); };
   requestAnimationFrame(paint);
  });
  await page.reload();
  await page.locator('[data-design-switch]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.__designs.filter(Boolean)), ['new'], 'one value, the right one, from the start');
  assert.equal(await page.locator('[data-design-option="new"]').getAttribute('aria-checked'), 'true');
  assert.equal(String(await page.evaluate(() => window.__firstPaint)).toUpperCase(), '#EDF1E8', 'the tokens of the first frame are already the New ones');
  assert.match(cookiesSeen.at(-1), new RegExp(`^${designCookieKey}=new$`), 'the only cookie the page sent');
  // And back: Classic is one click away, and the keyboard works it.
  await page.locator('[data-design-option="new"]').focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.design), 'classic');
  await page.reload(); await page.locator('[data-design-switch]').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.design), 'classic');
  await context.close();
  const ar = await open(phone, 'view=settings&lang=ar');
  assert.match(await ar.page.locator('[data-design-switch]').innerText(), /التصميم/); assert.match(await ar.page.locator('[data-design-switch]').innerText(), /الكلاسيكي/); assert.match(await ar.page.locator('[data-design-switch]').innerText(), /الجديد/);
  await shot(ar.page, 'switch-phone-ar');
  await ar.context.close();
 });

 await step('The switch changes only the visual layer: the same tags, data attributes and words in both looks', async () => {
  for (const viewport of [desktop, phone]) for (const view of ['home', 'settings', 'gallery']) {
   const signature = async look => { const { page, context } = await open(viewport, 'view=' + view, look); await page.waitForTimeout(100); const s = await page.evaluate(() => window.__h.structure()); await context.close(); return s; };
   assert.equal(await signature('classic'), await signature('new'), `${view} at ${viewport.width}`);
  }
 });

 await step('Every look, theme and direction: AA on rendered text, 44px targets, no overflow, no black edge in New, screenshots', async () => {
  const problems = [];
  for (const look of ['classic', 'new']) for (const theme of ['light', 'dark']) for (const [size, viewport] of [['desktop', desktop], ['phone', phone]]) for (const lang of ['en', 'ar']) for (const view of ['home', 'settings', 'gallery']) {
   const label = `${look}-${theme}-${size}-${lang}-${view}`;
   const { page, context } = await open(viewport, `view=${view}&theme=${theme}&lang=${lang}`, look);
   await page.waitForTimeout(view === 'home' ? 150 : 50);
   assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), theme === 'dark', label);
   if (!await noOverflow(page)) problems.push(`${label}: horizontal scroll`);
   for (const line of await page.evaluate(() => window.__h.lowContrast())) problems.push(`${label}: contrast ${line}`);
   for (const line of await page.evaluate(() => window.__h.tiny())) problems.push(`${label}: target ${line}`);
   if (look === 'new') for (const line of await page.evaluate(() => window.__h.blackEdges())) problems.push(`${label}: ${line}`);
   await shot(page, label);
   await context.close();
  }
  const seen = [...new Set(problems)];
  assert.deepEqual(seen, [], seen.length + ' problems');
 });

 await step('New type: Caprasimo or Lalezar for titles only (28 desktop, 24 phone, never bold), Figtree or Cairo for the rest', async () => {
  const arabicHome = await open(desktop, 'view=home&lang=ar', 'new');
  await arabicHome.page.locator('[data-teacher-home]').waitFor();
  for (const family of await arabicHome.page.locator('[data-teacher-home] h2').evaluateAll(n => n.map(e => getComputedStyle(e).fontFamily.split(',')[0]))) assert.match(family, /Cairo/i, 'Arabic section titles on Home');
  await arabicHome.context.close();
  for (const [lang, title, body] of [['en', /Caprasimo/i, /Figtree/i], ['ar', /Lalezar/i, /Cairo/i]]) for (const [viewport, size] of [[desktop, '28px'], [phone, '24px']]) {
   const { page, context } = await open(viewport, 'view=gallery&lang=' + lang, 'new');
   const h1 = '[data-gallery-header] .d-title';
   const first = async selector => (await css1(page, selector, 'fontFamily')).split(',')[0]; // the face that really draws, not a fallback further down the list
   assert.match(await first(h1), title, lang); assert.equal(await css1(page, h1, 'fontSize'), size, lang); assert.equal(await css1(page, h1, 'fontWeight'), '400', 'never bold');
   assert.match(await first('[data-gallery-list] .d-section'), body, 'a section title is not in the display face'); assert.equal(await css1(page, '[data-gallery-list] .d-section', 'fontSize'), '18px'); assert.equal(await css1(page, '[data-gallery-list] .d-section', 'fontWeight'), '700');
   assert.match(await first('[data-variant="primary"]'), body); assert.match(await first('[data-gallery-forms] .d-field-label'), body);
   const faces = await page.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).join());
   assert.match(faces, title, 'the face really loaded'); assert.match(faces, body, 'the face really loaded');
   if (lang === 'ar') { assert.equal(await page.locator('[data-teacher-shell][data-lms-shell]').evaluate(e => { const s = getComputedStyle(e); return Math.round(parseFloat(s.lineHeight) / parseFloat(s.fontSize) * 100) / 100; }), 1.6, 'Arabic body line height'); assert.equal(await page.locator('[data-gallery-list] li').first().evaluate(e => { const p = e.querySelector('.d-meta'); const s = getComputedStyle(p); return Math.round(parseFloat(s.lineHeight) / parseFloat(s.fontSize) * 100) / 100; }) >= 1.5, true, 'meta line too'); }
   await context.close();
  }
 });

 await step('New components match the prompt: pills, primary, secondary, cards, hero, date tile', async () => {
  const { page, context } = await open(desktop, 'view=gallery', 'new');
  for (const [tone, color, back] of [['success', 'rgb(43, 100, 22)', 'rgb(227, 243, 218)'], ['info', 'rgb(31, 90, 107)', 'rgb(224, 240, 243)'], ['warning', 'rgb(122, 79, 0)', 'rgb(254, 243, 199)'], ['danger', 'rgb(166, 27, 27)', 'rgb(251, 233, 233)'], ['neutral', 'rgb(68, 82, 61)', 'rgb(227, 233, 220)']]) {
   const pill = `[data-pill="${tone}"]`;
   assert.equal((await box(page, pill)).height, 24, tone); assert.equal(await css1(page, pill, 'fontSize'), '13px'); assert.equal(await css1(page, pill, 'fontWeight'), '600'); assert.equal(await css1(page, pill, 'color'), color, tone); assert.equal(await css1(page, pill, 'backgroundColor'), back, tone); assert.equal(await css1(page, pill, 'borderTopWidth'), '0px', 'no border');
  }
  const primary = '[data-variant="primary"]';
  assert.equal(await css1(page, primary, 'backgroundColor'), 'rgb(127, 217, 89)'); assert.equal(await css1(page, primary, 'color'), 'rgb(20, 48, 26)'); assert.match(await css1(page, primary, 'boxShadow'), /rgb\(43, 100, 22\) 3px 3px 0px/); assert.equal(await css1(page, primary, 'borderRadius'), '16px');
  const secondary = '[data-variant="secondary"]';
  assert.equal(await css1(page, secondary, 'borderTopColor'), 'rgb(183, 198, 170)'); assert.equal(await css1(page, secondary, 'borderTopWidth'), '1px'); assert.match(await css1(page, secondary, 'boxShadow'), /0px 2px 0px/);
  const card = '[data-gallery-list]';
  assert.equal(await css1(page, card, 'borderTopColor'), 'rgb(211, 222, 201)'); assert.equal(await css1(page, card, 'borderTopWidth'), '1px'); assert.match(await css1(page, card, 'boxShadow'), /rgb\(211, 222, 201\) 0px 3px 0px/); assert.match(await css1(page, card, 'boxShadow'), /0px 14px 28px -18px/); assert.equal(await css1(page, card, 'borderRadius'), '24px');
  assert.equal(await page.locator('.d-tile').count(), 1);
  await context.close();
  const home = await open(desktop, 'view=home', 'new');
  await home.page.locator('[data-next-session]').waitFor();
  const hero = home.page.locator('[data-next-session]');
  assert.match(await hero.evaluate(e => getComputedStyle(e).backgroundImage), /linear-gradient/); assert.equal(await hero.evaluate(e => getComputedStyle(e).borderRadius), '24px');
  const circles = await hero.evaluate(e => [getComputedStyle(e, '::before').content, getComputedStyle(e, '::after').content]); assert.deepEqual(circles.map(c => c !== 'none'), [true, true], 'two soft circles');
  assert.equal(await home.page.locator('[data-progress-ring]').count(), 1);
  assert.match(await home.page.locator('[data-progress-ring]').innerText(), /9\s*\/\s*14/);
  await home.context.close();
  const classic = await open(desktop, 'view=home', 'classic');
  await classic.page.locator('[data-next-session]').waitFor();
  assert.deepEqual(await classic.page.locator('[data-next-session]').evaluate(e => [getComputedStyle(e, '::before'), getComputedStyle(e, '::after')].map(s => s.content === 'none' || s.display === 'none' || s.backgroundColor === 'rgba(0, 0, 0, 0)')), [true, true], 'no circles in Classic');
  await classic.context.close();
 });

 await step('PageHeader and StickyActionBar: actions top trailing on a desktop; a sticky primary and a ⋯ menu on a phone; Dialog is centred, then a bottom sheet', async () => {
  for (const look of ['classic', 'new']) {
   const wide = await open(desktop, 'view=gallery', look);
   const header = wide.page.locator('[data-gallery-header]');
   assert.deepEqual(await header.locator('button:visible').allInnerTexts(), ['Edit', 'Delete', 'Take attendance'], look);
   assert.equal(await wide.page.locator('[data-sticky-primary]').isVisible(), false, 'no sticky bar on a desktop');
   const title = await box(wide.page, '[data-gallery-header] .d-title'), action = await header.locator('button:visible').first().boundingBox();
   assert.ok(action.x > title.x + title.width && action.y < title.y + title.height, 'trailing, at the top');
   await wide.page.locator('[data-open-dialog]').click();
   await wide.page.waitForTimeout(300); // the dialog has finished opening
   const dialog = await box(wide.page, '[data-gallery-dialog]');
   assert.ok(Math.abs(dialog.x + dialog.width / 2 - desktop.width / 2) < 2 && dialog.y > 20 && dialog.y + dialog.height < desktop.height - 20, 'centred');
   await wide.page.keyboard.press('Escape'); await wide.page.locator('[data-gallery-dialog]').waitFor({ state: 'detached' });
   await wide.page.waitForFunction(() => document.activeElement?.hasAttribute('data-open-dialog'), null, { timeout: 2000 }); // Radix hands focus back just after it unmounts
   await wide.context.close();

   const narrow = await open(phone, 'view=gallery', look);
   const bar = await box(narrow.page, '[data-sticky-primary]');
   const tabs = await box(narrow.page, '[data-teacher-tabs]');
   assert.ok(bar.y + bar.height <= tabs.y + 1, 'the sticky bar sits above the tabs: ' + JSON.stringify([bar, tabs]));
   assert.equal(await narrow.page.locator('[data-gallery-header] .d-page-header-actions button:visible').count(), 1, 'only the ⋯ in the header');
   await narrow.page.locator('[data-sticky-primary] button').click(); assert.equal(await narrow.page.evaluate(() => window.__primary), 1);
   await narrow.page.getByRole('button', { name: 'More actions' }).click();
   assert.deepEqual(await narrow.page.locator('[role="menuitem"]').allInnerTexts(), ['Edit', 'Delete']);
   await narrow.page.getByRole('menuitem', { name: 'Delete' }).click(); await narrow.page.waitForFunction(() => window.__destructive === true); // the menu runs its action once it has closed and handed focus back
   await narrow.page.locator('[data-open-dialog]').click();
   await narrow.page.waitForTimeout(300); // the sheet has finished sliding up
   const sheet = await box(narrow.page, '[data-gallery-dialog]');
   assert.ok(Math.abs(sheet.y + sheet.height - phone.height) < 2 && sheet.width === phone.width, 'a bottom sheet');
   await narrow.context.close();
  }
 });

 await step('Keyboard: focus is visible on every stop of the frame in both looks; tabs and the segmented control answer the arrow keys, mirrored in Arabic', async () => {
  for (const look of ['classic', 'new']) for (const [viewport, query] of [[desktop, 'view=gallery'], [phone, 'view=gallery'], [desktop, 'view=gallery&theme=dark']]) {
   const { page, context } = await open(viewport, query, look);
   const unseen = [];
   for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch { /* the skeleton's endless pulse */ } }); const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e), shadow = s.boxShadow !== 'none' ? s.boxShadow : ''; return { name: e.tagName + ' ' + (e.innerText || e.getAttribute('aria-label') || '').slice(0, 24), outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2, color: s.outlineColor, shadow, radio: e.type === 'radio', label: e.type === 'radio' ? getComputedStyle(e.parentElement).outlineStyle !== 'none' : false, hidden: e.getBoundingClientRect().width === 0 }; });
    if (!state) continue;
    if (!(state.outline || state.label)) unseen.push(state.name);
    if (look === 'new' && state.outline) assert.equal(state.color, query.includes('dark') ? 'rgb(166, 224, 138)' : 'rgb(43, 100, 22)', 'New focus ring, the deep green in light: ' + state.name);
   }
   assert.deepEqual(unseen, [], `${look} ${viewport.width} ${query}`);
   await context.close();
  }
  for (const [lang, key] of [['en', 'ArrowRight'], ['ar', 'ArrowLeft']]) {
   const { page, context } = await open(desktop, 'view=gallery&lang=' + lang, 'new');
   await page.locator('[data-gallery-tabs] [role="tab"]').first().focus(); await page.keyboard.press(key);
   assert.equal(await page.locator('[data-gallery-tabs] [role="tab"][aria-selected="true"]').innerText(), 'Two', lang);
   assert.ok(await page.locator('[data-gallery-tabs] [role="tab"]').nth(1).evaluate(e => e === document.activeElement), lang);
   await context.close();
  }
 });

 await step('Reduced motion: nothing in the frame or the shared components animates or moves', async () => {
  for (const look of ['classic', 'new']) {
   const { page, context } = await open(desktop, 'view=gallery', look, { reducedMotion: 'reduce' });
   const moving = await page.evaluate(() => [...document.querySelectorAll('[data-teacher-shell] *')].filter(e => { const s = getComputedStyle(e), t = s.transitionDuration.split(',').some(v => parseFloat(v) > 0.011), a = s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.011; return /(^|\s)d-/.test(String(e.className)) && (t || a); }).map(e => String(e.className).slice(0, 50)));
   assert.deepEqual(moving, [], look);
   await page.locator('[data-open-dialog]').click();
   const dialog = await page.locator('[data-gallery-dialog]').evaluate(e => { const s = getComputedStyle(e); return [s.animationName === 'none' || parseFloat(s.animationDuration) <= 0.011]; });
   assert.deepEqual(dialog, [true], look);
   await context.close();
  }
 });

 await step('Avatars: the same id gets the same tint in every view; only initials are shown; the page wrote nothing about it to storage', async () => {
  const read = async () => { const { page, context } = await open(desktop, 'view=gallery', 'new'); const v = await page.locator('[data-gallery-list] .d-avatar').evaluateAll(n => n.map(e => [e.textContent, getComputedStyle(e).backgroundColor])); const stored = await page.evaluate(() => JSON.stringify(localStorage) + document.cookie); await context.close(); return { v, stored }; };
  const one = await read(), two = await read();
  assert.deepEqual(one.v, two.v); assert.equal(one.v[0][0], 'SS'); assert.doesNotMatch(one.stored, /Synthetic Student|طالب/);
 });

 await require('./design-feedback-checks.cjs')({ step, open, box, css1, desktop, phone, shot });
 await require('./design-controls-checks.cjs')({ step, open, box, css1, desktop, phone, shot });

 assert.deepEqual(errors, [], 'no page errors or console errors');
 assert.deepEqual(external, [], 'nothing left the loopback');
 await step('Notifications in the teacher frame: the same reads and commands, drawn with the design components; nothing asks for permission on opening; a phone keeps Mark all behind the menu', async () => {
  noteCalls.length = 0;
  const { page, context } = await open(desktop, 'view=notifications', 'new'); await page.locator('[data-teacher-notifications] [data-notification-list]').waitFor();
  assert.equal(await page.locator('[data-notification]').count(), 2); assert.equal(await page.locator('.d-note-dot--unread').count(), 1, 'one unread dot');
  assert.equal(await page.locator('[data-notification] a[href="/support"]').count(), 1); assert.match(await page.locator('[data-teacher-notifications]').innerText(), /currently unavailable/i);
  assert.equal(await page.evaluate(() => Notification.permission === 'default'), true, 'looking asks for nothing');
  await page.getByRole('button', { name: 'Mark read', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-notification]'));
  await page.locator('[data-read-all]').click(); await page.waitForFunction(() => document.querySelector('[data-notification]'));
  await page.locator('[data-pref-kind="in-app"]').first().click(); await page.waitForFunction(() => !document.querySelector('[data-pref-kind="in-app"][aria-disabled="true"]'));
  await page.locator('[data-teacher-notifications] .d-seg button').nth(2).click(); await page.locator('[data-teacher-notifications] [data-state="empty"]').waitFor();
  const made = noteCalls.map(c => c.action); for (const a of ['list', 'preferences', 'push-config', 'read', 'read-all', 'preference']) assert.ok(made.includes(a), 'calls ' + a);
  assert.equal(noteCalls.find(c => c.action === 'read').data.id, 'a0000000-0000-4000-8000-000000000001'); assert.ok(noteCalls.some(c => c.action === 'list' && c.data.filter === 'read')); await context.close();
  const ph = await open(phone, 'view=notifications&lang=ar', 'classic'); await ph.page.locator('[data-teacher-notifications] [data-notification-list]').waitFor(); assert.equal(await ph.page.locator('[data-read-all]').count(), 0, 'behind the menu'); await ph.context.close();
 });
 if (process.env.LMS_MATRIX) await step('Screen matrix: every look, theme, language and width, measured', async () => {
  const findings = await shootMatrix({ label: 'notifications', open: ({ viewport, lang, theme, look, target }) => open(viewport, `view=${target}&theme=${theme}&lang=${lang}`, look), screens: [
   { name: 'notifications', target: 'notifications', ready: '[data-teacher-notifications] [data-notification-list]' },
  ] });
  assert.deepEqual(findings, []);
 });

 await browser.close(); server.close();
 console.log(`Design foundation browser checks passed: ${results.length} groups (real components, real stylesheet, synthetic loopback data, not provider E2E). Screenshots: ${shots}`);
 process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
