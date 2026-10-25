// Actual platform-admin React components, design-system CSS, the ORIGINAL EduLabs fonts (extracted from the
// Next build output) and language/theme providers in Chromium against a FICTIONAL in-memory HTTP backend.
// This is NOT Firebase/Supabase end-to-end verification: it proves presentation, interaction, state
// preservation, RTL/LTR, light/dark and responsive behavior only.
// Needs existing tooling (nothing is installed) and a prior `next build` (for the real font files):
//   LMS_BROWSER_RUNTIME  node_modules containing `playwright`
//   LMS_ESBUILD_RUNTIME  node_modules containing `esbuild`
//   LMS_CHROMIUM_EXECUTABLE  optional Chrome/Chromium path
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('node:assert/strict'), { randomUUID, randomBytes } = require('crypto');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/platform-admin-browser'), shots = path.join(out, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));

// ---- the original fonts, exactly as the application ships them -----------------------------------------
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
const fontSheet = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).find(c => c.includes('@font-face') && c.includes('Caprasimo')) : null;
if (!fontSheet) throw Error('Run `npm run build` first: the original next/font output (.next/static/css) is needed to verify the real brand fonts');
const fontFaces = fontSheet.match(/@font-face\{[^}]*\}/g) || [], fontVars = fontSheet.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || [];
assert.ok(fontFaces.length >= 8 && fontVars.length === 4, 'expected Figtree, Caprasimo, Cairo and Lalezar from next/font');
const bodyClass = fontVars.map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

// ---- fictional backend -------------------------------------------------------------------------
let portals, posts, behaviors, detailFailures, secrets, dropActions, appliedOnce, actionPosts;
function reset() { portals = []; posts = []; behaviors = []; detailFailures = 0; secrets = []; dropActions = null; appliedOnce = false; actionPosts = 0; }
reset();
const iso = (days = 0) => new Date(Date.UTC(2030, 0, 2, 3, 4) + days * 86400000).toISOString();
function fictionalPortal(request, status = 'pending') {
 const id = randomUUID(), inv = randomUUID();
 const detail = {
  organizationId: id, status: 'active', createdAt: iso(), hasOwner: status === 'accepted',
  invitations: [{ id: inv, teacherEmail: request.teacherEmail, createdAt: iso(), expiresAt: iso(request.expiresInDays), acceptedAt: status === 'accepted' ? iso(1) : null, revokedAt: null, revokeReason: null, status }],
  educationSystems: request.systems.map(s => ({ id: randomUUID(), name: s.label, examinationBoard: s.examinationBoard ?? null, gradeLevels: s.grades.map(g => ({ id: randomUUID(), name: g.label })) })),
  subjects: request.subjects.map(s => ({ id: randomUUID(), name: s.label })),
  courses: [{ id: randomUUID(), title: request.course.title, status: 'draft', subject: request.subjects.find(s => s.key === request.course.subjectKey).label,
   gradeLevel: request.systems.flatMap(s => s.grades).find(g => g.key === request.course.gradeKey).label, educationSystem: request.systems.find(s => s.grades.some(g => g.key === request.course.gradeKey)).label }],
  activity: [{ action: 'portal.provision', occurredAt: iso(), actor: 'administrator' }],
 };
 return detail;
}
const sampleRequest = (email = 'list.teacher@example.test') => ({ teacherEmail: email, expiresInDays: 7, systems: [{ label: 'IGCSE', examinationBoard: 'Cambridge', grades: [{ key: 'g1', label: 'Grade 10' }, { key: 'g2', label: 'Grade 11' }] }], subjects: [{ key: 's1', label: 'Physics' }, { key: 's2', label: 'Chemistry' }], course: { title: 'Physics - Grade 10', gradeKey: 'g1', subjectKey: 's1' } });
const summary = d => ({ organizationId: d.organizationId, teacherEmail: d.invitations[0].teacherEmail, createdAt: d.createdAt, expiresAt: d.invitations[0].expiresAt, acceptedAt: d.invitations[0].acceptedAt,
 invitationStatus: d.invitations[0].status, course: { id: d.courses[0].id, title: d.courses[0].title, subject: d.courses[0].subject, grade: d.courses[0].gradeLevel, educationSystem: d.courses[0].educationSystem, examinationBoard: d.educationSystems[0].examinationBoard } });
const secret = () => { const s = randomBytes(32).toString('base64url'); secrets.push(s); return s; };
function applyRevoke(portal) {
 const latest = portal.invitations[0]; latest.status = 'revoked'; latest.revokedAt = iso(1); latest.revokeReason = 'revoked';
 portal.activity.unshift({ action: 'invitation.revoke', occurredAt: iso(1), actor: 'administrator' });
 return { organizationId: portal.organizationId, invitationId: latest.id };
}
function applyReissue(portal, input) {
 const latest = portal.invitations[0]; latest.status = 'revoked'; latest.revokeReason = 'superseded';
 const fresh = { ...latest, id: randomUUID(), status: 'pending', revokedAt: null, revokeReason: null, expiresAt: iso(input.expiresInDays), teacherEmail: input.teacherEmail || latest.teacherEmail };
 portal.invitations.unshift(fresh); portal.activity.unshift({ action: 'invitation.reissue', occurredAt: iso(1), actor: 'administrator' });
 return { organizationId: portal.organizationId, invitationId: fresh.id, expiresAt: fresh.expiresAt, invitationSecret: secret(), delivery: 'not_sent' };
}

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { PlatformAdminShell } from '@/frontend/features/platform-admin/shell';
import { ProvisionForm } from '@/frontend/features/platform-admin/provision-form';
import { TeachersView } from '@/frontend/features/platform-admin/teachers-view';
import { PortalView } from '@/frontend/features/platform-admin/portal-view';
import { SettingsView } from '@/frontend/features/platform-admin/settings-view';
const q = new URLSearchParams(location.search), view = q.get('view') || 'new';
window.__pathname = view === 'settings' ? '/platform-admin/settings' : view === 'new' ? '/platform-admin/teachers/new' : '/platform-admin/teachers' + (view === 'detail' ? '/' + q.get('id') : '');
function Body() {
 const [data, setData] = React.useState(undefined);
 React.useEffect(() => {
  if (view === 'new' || view === 'settings') return;
  fetch(view === 'list' ? '/api/platform-admin/portals' : '/api/platform-admin/portals/' + q.get('id')).then(r => r.ok ? r.json() : null).then(setData, () => setData(null));
 }, []);
 if (view === 'new') return <ProvisionForm />;
 if (view === 'settings') return <SettingsView />;
 if (data === undefined) return <p>Loading…</p>;
 if (view === 'list') return <TeachersView initial={data} />;
 return <PortalView initial={data} portalId={q.get('id')} />;
}
createRoot(document.getElementById('root')).render(
 <LanguageProvider initialLanguage={q.get('lang') === 'ar' ? 'ar' : 'en'}>
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
   <PlatformAdminShell name="Fictional Admin"><Body /></PlatformAdminShell>
  </ThemeProvider>
 </LanguageProvider>);
`;

(async () => {
 const stubs = {
  'next/navigation': 'export const usePathname = () => window.__pathname; export const useRouter = () => ({ push() {}, replace() {} });',
  'next/link': 'import React from "react"; export default function Link({ href, children, ...rest }) { return React.createElement("a", { href: "#" + href, ...rest }, children); }',
 };
 const resolveAlias = p => { for (const candidate of [p + '.tsx', p + '.ts', path.join(p, 'index.tsx'), path.join(p, 'index.ts')]) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate; return p; };
 await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: path.join(out, 'app.js'), platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'component-boundary', setup(build) {
   build.onResolve({ filter: /.*/ }, a => {
    if (stubs[a.path]) return { path: a.path, namespace: 'stub' };
    if (a.path.startsWith('@/')) return { path: resolveAlias(path.resolve(a.path.slice(2))) };
   });
   build.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'jsx', resolveDir: process.cwd() }));
  } }] });
 // The same files the application imports, in the same order, followed by the real font faces and variables.
 const css = ['frontend/design-system/tokens.css', 'frontend/design-system/components.css', 'frontend/styles/platform-admin.css'].map(f => fs.readFileSync(f, 'utf8')).join('\n') + '\n' + fontFaces.join('\n') + '\n' + fontVars.join('\n');
 const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
  if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  if (url.pathname.startsWith('/_next/static/media/')) {
   const file = path.join(mediaDir, path.basename(url.pathname));
   if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
   res.setHeader('Content-Type', 'font/woff2'); return res.end(fs.readFileSync(file));
  }
  const body = () => new Promise(r => { const parts = []; req.on('data', b => parts.push(b)); req.on('end', () => r(parts.length ? JSON.parse(Buffer.concat(parts)) : null)); });
  if (url.pathname === '/api/platform-admin/portals') {
   if (req.method === 'GET') return send({ items: portals.map(summary), hasMore: false });
   return body().then(async input => {
    posts.push(input);
    const behavior = behaviors.shift() || 'ok';
    if (behavior === 'drop') return req.socket.destroy();
    if (behavior === 'slow') await new Promise(r => setTimeout(r, 600));
    if (behavior === 'outage') return send({ error: 'down', reason: 'unavailable' }, 503);
    if (behavior === 'conflict' || portals.some(p => p.invitations[0].teacherEmail === input.teacherEmail && p.invitations[0].status === 'pending')) return send({ error: 'exists', reason: 'pending_exists' }, 409);
    const detail = fictionalPortal(input); portals.unshift(detail);
    send({ organizationId: detail.organizationId, invitationId: detail.invitations[0].id, courseId: detail.courses[0].id, expiresAt: detail.invitations[0].expiresAt, invitationSecret: secret(), delivery: 'not_sent' }, 201);
   });
  }
  const match = url.pathname.match(/^\/api\/platform-admin\/portals\/([0-9a-f-]{36})$/);
  if (match) {
   const portal = portals.find(p => p.organizationId === match[1]);
   if (!portal) return send({ error: 'Not found', reason: 'not_found' }, 404);
   if (req.method === 'GET') { if (detailFailures > 0) { detailFailures--; return send({ error: 'down', reason: 'unavailable' }, 503); } return send(portal); }
   return body().then(input => {
    actionPosts++;
    // A dropped connection: the write may or may not have happened. `applied` performs it once, silently.
    if (dropActions) {
     if (dropActions === 'applied' && !appliedOnce && portal.invitations[0].status === 'pending') { appliedOnce = true; input.action === 'revoke' ? applyRevoke(portal) : applyReissue(portal, input); }
     return req.socket.destroy();
    }
    if (input.action === 'revoke') {
     if (portal.invitations[0].status !== 'pending') return send({ error: 'nothing', reason: 'used' }, 409);
     return send(applyRevoke(portal));
    }
    send(applyReissue(portal, input));
   });
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0}</style></head><body class="${bodyClass}"><div id="root"></div><script src="/app.js"></script></body></html>`);
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + server.address().port;
 const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE || undefined });
 const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), errors = [], results = [], external = [];
 await context.route('**/*', route => { if (route.request().url().startsWith(origin)) return route.continue(); external.push(route.request().url()); return route.abort(); });
 const page = await context.newPage();
 page.on('pageerror', e => errors.push(e.message));
 page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push(m.text()); });
 const cdp = await context.newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
 const open = async (query = '') => { await page.goto(origin + '/?' + query); await page.locator('#pa-sidebar').waitFor({ state: 'attached' }); };
 const step = async (name, fn) => { console.log('...', name); try { await fn(); results.push('PASS ' + name); } catch (error) { await page.screenshot({ path: path.join(out, 'failure-' + results.length + '.png') }).catch(() => {}); throw new Error(name + ': ' + error.message, { cause: error }); } };
 const noOverflow = async label => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal overflow: ' + label);
 const prefGroup = name => page.getByRole('radiogroup', { name });
 const setLang = async code => { await open('view=settings'); await prefGroup(/^(Language|اللغة)$/).getByRole('radio').nth(code === 'ar' ? 1 : 0).click(); await page.waitForFunction(c => document.documentElement.lang === c, code); };
 const setTheme = async mode => { await open('view=settings'); await prefGroup(/^(Appearance|المظهر)$/).getByRole('radio').nth({ light: 0, dark: 1, system: 2 }[mode]).click(); await page.waitForFunction(m => document.documentElement.classList.contains('dark') === (m === 'dark'), mode); };
 const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
 const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
 const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
 const style = (selector, property) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [selector, property]);
 const family = selector => style(selector, 'fontFamily');
 // The fonts Chromium actually rasterised for a node (not merely the declared stack).
 const renderedFonts = async selector => {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  return fonts.map(f => f.familyName);
 };
 const fontsReady = async () => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(150); };

 const nextStep = () => page.getByRole('button', { name: 'Next', exact: true }).click();
 const dot = name => page.getByRole('navigation', { name: 'Setup progress' }).getByRole('button', { name: new RegExp('^' + name) });
 const stepHeading = name => page.getByRole('heading', { name: new RegExp('^' + name) });
 const states = () => page.locator('.eds-stepper li').evaluateAll(items => items.map(li => li.dataset.state));
 // Walks the real wizard: each step is filled and left through Next, ending on the First course step (or earlier with upTo).
 const fillBasics = async ({ customTitle = true, upTo = 4 } = {}) => {
  await page.locator('#pa-email').fill('New.Teacher@Example.test'); if (upTo === 1) return; await nextStep();
  await stepHeading('Education systems').waitFor(); await page.locator('#pa-sys-0').fill('IGCSE');
  if (await page.locator('#pa-board-0').isHidden()) await page.getByRole('button', { name: 'Examination board (optional)' }).click();
  await page.locator('#pa-board-0').fill('Cambridge');
  await page.locator('#pa-grade-0').fill('Grade 10'); await page.locator('#pa-grade-0').press('Enter');
  await page.locator('#pa-grade-0').fill('Grade 11'); await page.getByRole('button', { name: 'Add grade level' }).click();
  if (upTo === 2) return; await nextStep();
  await stepHeading('Subjects').waitFor(); await page.locator('#pa-subject').fill('Physics'); await page.locator('#pa-subject').press('Enter');
  if (upTo === 3) return; await nextStep();
  await stepHeading('First course').waitFor();
  await page.locator('#pa-course-grade').selectOption({ label: 'Grade 10' }); await page.locator('#pa-course-subject').selectOption({ label: 'Physics' });
  if (customTitle) await page.locator('#pa-course-title').fill('Physics for Grade 10');
 };

 const scanContrast = () => page.evaluate(() => {
  const parse = c => { let m = c.match(/^rgba?\(([^)]+)\)$/); if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; } m = c.match(/^color\(srgb ([^)]+)\)$/); if (m) { const p = m[1].split(/[ /]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; } return null; };
  const over = (t, b) => { const a = t[3]; return [t[0] * a + b[0] * (1 - a), t[1] * a + b[1] * (1 - a), t[2] * a + b[2] * (1 - a), 1]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const background = el => { const chain = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) chain.push(c); if (c && c[3] === 1) break; } let base = [255, 255, 255, 1]; for (let i = chain.length - 1; i >= 0; i--) base = over(chain[i], base); return base; };
  const failures = []; let checked = 0;
  for (const el of document.querySelectorAll('.eds-root *')) {
   if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
   const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
   if (el.closest('[hidden]') || el.closest('[disabled]') || el.matches(':disabled')) continue;
   const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
   const fg0 = parse(cs.color); if (!fg0) continue;
   const bg = background(el), fg = over(fg0, bg), [x, y] = [lum(fg), lum(bg)].sort((a, b) => b - a), ratio = (x + 0.05) / (y + 0.05);
   const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700, need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
   checked++; if (ratio < need) failures.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} "${el.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)} < ${need}`);
  }
  return { checked, failures };
 });
 const auditStructure = () => page.evaluate(() => {
  const problems = [];
  const text = id => document.getElementById(id)?.textContent || '';
  const named = el => {
   const byLabel = [...(el.labels || [])].map(l => l.textContent).join(' ');
   const base = el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(' ').map(text).join(' ') || byLabel;
   return (base || (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) ? '' : el.textContent) || '').trim();
  };
  for (const el of document.querySelectorAll('input:not([type=hidden]),select,textarea,button,a[href]')) if (!named(el)) problems.push('unnamed control: ' + el.outerHTML.slice(0, 90));
  const ids = [...document.querySelectorAll('[id]')].map(e => e.id); for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) problems.push('duplicate id ' + id);
  if (document.querySelectorAll('h1').length !== 1) problems.push('expected exactly one h1, found ' + document.querySelectorAll('h1').length);
  if (document.querySelectorAll('main').length !== 1) problems.push('expected one main landmark');
  for (const nav of document.querySelectorAll('nav')) if (!nav.getAttribute('aria-label')) problems.push('nav without a name');
  for (const el of document.querySelectorAll('[aria-describedby],[aria-controls],[aria-labelledby]')) for (const attr of ['aria-describedby', 'aria-controls', 'aria-labelledby']) for (const id of (el.getAttribute(attr) || '').split(' ').filter(Boolean)) if (!document.getElementById(id)) problems.push(`${attr} -> missing #${id}`);
  for (const el of document.querySelectorAll('[aria-invalid="true"]')) if (!el.getAttribute('aria-describedby')) problems.push('invalid field without a described error: ' + el.id);
  for (const svg of document.querySelectorAll('svg')) if (!svg.closest('[aria-hidden="true"]') && svg.getAttribute('aria-hidden') !== 'true' && !svg.getAttribute('aria-label') && !svg.querySelector('title')) problems.push('svg exposed without a name');
  for (const img of document.querySelectorAll('img:not([alt])')) problems.push('img without alt');
  let previous = 0; for (const h of document.querySelectorAll('h1,h2,h3')) { const level = Number(h.tagName[1]); if (previous && level > previous + 1) problems.push('heading level jumps to ' + h.tagName); previous = level; }
  return problems;
 });
 const accessible = async label => {
  const problems = await auditStructure(); assert.deepEqual(problems, [], 'accessibility structure (' + label + ')');
  const c = await scanContrast(); assert.ok(c.checked > 8, 'contrast scan saw text (' + label + ')'); assert.deepEqual(c.failures, [], 'contrast (' + label + ')');
 };

 await step('original brand fonts: Figtree body and controls, Caprasimo display, no Times fallback anywhere', async () => {
  reset(); await open('view=new'); await fontsReady();
  assert.ok(await page.evaluate(() => document.fonts.check('16px Figtree') && document.fonts.check('16px Caprasimo')), 'Figtree and Caprasimo are loaded from the original files');
  const bodyFamily = await family('.eds-root p'), h1Family = await family('h1'), h2Family = await family('h2'), inputFamily = await family('#pa-email'), buttonFamily = await family('button.eds-btn'), wordmark = await family('.eds-wordmark');
  assert.match(bodyFamily, /^Figtree/, 'paragraphs: ' + bodyFamily); assert.match(inputFamily, /^Figtree/, 'inputs: ' + inputFamily); assert.match(buttonFamily, /^Figtree/, 'buttons: ' + buttonFamily);
  assert.match(h2Family, /^Figtree/, 'section headings are the body face, not a decorative one: ' + h2Family);
  assert.match(h1Family, /^Caprasimo/, 'page title: ' + h1Family); assert.match(wordmark, /^Caprasimo/, 'wordmark: ' + wordmark);
  assert.deepEqual([...new Set(await renderedFonts('.eds-root p'))].filter(f => !/Figtree/.test(f)), [], 'paragraph text is rasterised in Figtree');
  assert.ok((await renderedFonts('h1')).some(f => /Caprasimo/.test(f)), 'the h1 is rasterised in Caprasimo');
  assert.ok((await renderedFonts('.eds-wordmark')).some(f => /Caprasimo/.test(f)), 'the wordmark is rasterised in Caprasimo');
  assert.ok((await renderedFonts('#pa-email')).every(f => /Figtree/.test(f)), 'form controls are rasterised in Figtree');
  const serif = await page.evaluate(() => [...document.querySelectorAll('.eds-root *')].filter(e => /Times|Georgia/i.test(getComputedStyle(e).fontFamily.split(',')[0])).map(e => e.tagName + '.' + e.className).slice(0, 5));
  assert.deepEqual(serif, [], 'nothing resolves to a serif stack');
  assert.equal(await page.locator('svg.eds-brand-mark').count(), 1, 'the real EduLabs tree mark is used');
 });

 await step('wizard: one step at a time, a connected text-free progress line, Next primary and no Back on the first step', async () => {
  reset(); await open('view=new');
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'ltr');
  await page.getByRole('heading', { name: 'Create a teacher portal' }).waitFor(); await stepHeading('Teacher').waitFor();
  assert.equal(await page.getByRole('alert').count(), 0); assert.equal(await page.locator('#pa-email').inputValue(), '');
  assert.equal(await page.getByText(/display name/i).count(), 1, 'only the sentence saying the teacher chooses it'); assert.equal(await page.getByLabel(/website|domain/i).count(), 0);
  assert.equal(await page.getByRole('navigation', { name: 'Platform navigation' }).getByRole('link').count(), 1);
  // later steps are not on the page at all
  for (const gone of ['#pa-sys-0', '#pa-board-0', '#pa-subject', '#pa-course-title', '#pa-course-grade']) assert.equal(await page.locator(gone).count(), 0, gone);
  assert.equal(await page.getByRole('button', { name: 'Back', exact: true }).count(), 0); assert.equal(await page.getByRole('link', { name: 'Cancel' }).count(), 1);
  assert.equal(await page.locator('#pa-lifetime').isVisible(), false); assert.equal(await page.getByRole('button', { name: 'Invitation settings' }).getAttribute('aria-expanded'), 'false');
  // the progress line
  assert.equal(await page.locator('.eds-stepper-point').count(), 4);
  assert.deepEqual(await page.locator('.eds-stepper-point').allInnerTexts(), ['', '', '', ''], 'no numbers or text inside the circles');
  assert.deepEqual(await states(), ['current', 'upcoming', 'upcoming', 'upcoming']);
  assert.deepEqual((await page.locator('.eds-stepper-label').allInnerTexts()).map(x => x.split(',')[0].trim()), ['Teacher', 'Education', 'Subjects', 'First course']);
  assert.equal(await dot('Teacher').getAttribute('aria-current'), 'step'); assert.equal(await dot('Education').getAttribute('aria-disabled'), 'true');
  assert.match(await dot('Teacher').innerText(), /current step/); assert.match(await dot('Subjects').innerText(), /not started/);
  const geometry = await page.evaluate(() => { const points = [...document.querySelectorAll('.eds-stepper-point')], li = document.querySelectorAll('.eds-stepper li')[1], line = getComputedStyle(li, '::before');
   return { radius: points.map(p => getComputedStyle(p).borderTopLeftRadius), sizes: points.map(p => [p.offsetWidth, p.offsetHeight]), lineHeight: line.height, lineWidth: parseFloat(line.width), liWidth: li.offsetWidth, ys: points.map(p => Math.round(p.getBoundingClientRect().top)) }; });
  assert.ok(geometry.radius.every(r => r === '50%'), 'circles'); assert.ok(geometry.sizes.every(([w, h]) => w === h && w >= 24), 'same-size round points'); assert.equal(geometry.lineHeight, '3px');
  assert.ok(Math.abs(geometry.lineWidth - geometry.liWidth) < 2, 'the line spans point to point'); assert.equal(new Set(geometry.ys).size, 1, 'all points sit on one horizontal line');
  await accessible('wizard step 1, empty');
 });
 await step('progressive disclosure: invitation settings open on demand and keep the value; the board stays collapsed until asked for', async () => {
  await page.getByRole('button', { name: 'Invitation settings' }).click(); await page.locator('#pa-lifetime').selectOption('14');
  await page.getByRole('button', { name: 'Invitation settings' }).click();
  assert.equal(await page.locator('#pa-lifetime').inputValue(), '14', 'collapsing keeps the chosen lifetime');
  await page.locator('#pa-email').fill('disclose@example.test'); await nextStep(); await stepHeading('Education systems').waitFor();
  assert.equal(await page.locator('#pa-board-0').isVisible(), false); assert.equal(await page.getByRole('button', { name: 'Examination board (optional)' }).getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: 'Examination board (optional)' }).click(); await page.locator('#pa-board-0').fill('Cambridge');
  await page.getByRole('button', { name: 'Examination board (optional)' }).click();
  assert.equal(await page.locator('#pa-board-0').isVisible(), true, 'a board with a value cannot be hidden and forgotten');
  await page.locator('#pa-sys-0').fill('IGCSE'); await page.locator('#pa-grade-0').fill('Grade 9'); await page.locator('#pa-grade-0').press('Enter');
  await page.locator('#pa-board-0').fill('x'.repeat(130)); await nextStep();
  await stepHeading('Education systems').waitFor(); assert.equal(await page.evaluate(() => document.activeElement.id), 'pa-board-0', 'focus lands on the invalid board field');
  assert.equal(await page.locator('#pa-board-0').getAttribute('aria-invalid'), 'true');
  await page.locator('#pa-board-0').fill('Cambridge'); await dot('Teacher').click(); await page.locator('#pa-email').waitFor();
  assert.equal(await page.locator('#pa-email').inputValue(), 'disclose@example.test'); await page.getByRole('button', { name: 'Invitation settings' }).click();
  assert.equal(await page.locator('#pa-lifetime').inputValue(), '14', 'the lifetime survived the round trip');
 });
 await step('Next validates only the current step, shows specific errors, focuses the first invalid field and never advances early', async () => {
  reset(); await open('view=new');
  await nextStep(); await page.getByText('Some details need attention').waitFor(); await stepHeading('Teacher').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pa-email'); await page.getByText('Enter the teacher email.').waitFor();
  assert.equal(await page.getByText('Add at least one grade level.').count(), 0, 'later steps stay quiet');
  await page.locator('#pa-email').fill('not-an-email'); await nextStep(); await page.getByText('Enter a valid email address.').waitFor();
  await accessible('wizard step 1, with errors');
  await page.locator('#pa-email').fill('step@example.test'); await nextStep(); await stepHeading('Education systems').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pa-step-title', 'focus moves to the new step heading');
  assert.deepEqual(await states(), ['completed', 'current', 'upcoming', 'upcoming']);
  assert.equal(await page.getByText('Enter the teacher email.').count(), 0);
  await nextStep(); await page.getByText('Add at least one grade level.').waitFor(); await page.getByText('Enter a name.').first().waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pa-sys-0', 'first invalid field of the step');
  // step jumping: an upcoming step cannot bypass validation, a completed one can be reopened and loses nothing
  await dot('First course').click({ force: true }); await stepHeading('Education systems').waitFor(); assert.equal(await dot('First course').getAttribute('aria-disabled'), 'true');
  await dot('Teacher').click(); await page.locator('#pa-email').waitFor(); assert.equal(await page.locator('#pa-email').inputValue(), 'step@example.test');
  assert.deepEqual(await states(), ['current', 'upcoming', 'upcoming', 'upcoming'], 'a step that was left invalid is not shown as completed');
  await nextStep(); await page.locator('#pa-sys-0').fill('IGCSE'); await page.locator('#pa-grade-0').fill('Grade 10'); await page.locator('#pa-grade-0').press('Enter'); await nextStep();
  await stepHeading('Subjects').waitFor(); await nextStep(); await page.getByText('Add at least one subject.').waitFor(); assert.equal(await page.evaluate(() => document.activeElement.id), 'pa-subject');
  await page.locator('#pa-subject').fill('Physics'); await page.locator('#pa-subject').press('Enter'); await nextStep(); await stepHeading('First course').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Review setup', exact: true }).count(), 1); assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).count(), 0, 'the last step offers Review setup instead of Next');
  await page.getByRole('button', { name: 'Review setup', exact: true }).click(); await page.getByText('Choose a grade level for the course.').waitFor(); await page.getByText('Choose a subject for the course.').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pa-course-grade'); await accessible('wizard step 4, with errors');
  assert.equal(await page.getByRole('heading', { name: 'Review before creating' }).count(), 0); assert.equal(posts.length, 0, 'nothing is sent while moving between steps');
  // the upcoming dots are now reachable because every earlier step is valid; the course step still blocks review
  await dot('Teacher').click(); await dot('First course').click(); await stepHeading('First course').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Back', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await stepHeading('Subjects').waitFor();
  assert.deepEqual((await page.locator('ul[aria-label="Subjects taught"] li').allInnerTexts()).map(x => x.replace('×', '').trim()), ['Physics'], 'Back keeps the subjects');
 });
 await step('course title is suggested from Subject and Grade Level with a normal hyphen, stays editable and is never overwritten once customised', async () => {
  reset(); await open('view=new'); await fillBasics({ customTitle: false });
  assert.equal(await page.locator('#pa-course-title').inputValue(), 'Physics - Grade 10');
  assert.equal(await page.getByText('Suggested from the subject and grade level').count(), 1, 'the suggestion is explained');
  await page.locator('#pa-course-grade').selectOption({ label: 'Grade 11' });
  assert.equal(await page.locator('#pa-course-title').inputValue(), 'Physics - Grade 11', 'an untouched suggestion follows the selection');
  await page.locator('#pa-course-title').fill('Lab Physics, Year 11');
  assert.equal(await page.getByText('Suggested from the subject and grade level').count(), 0, 'the hint disappears once the title is the administrator\'s own');
  await page.getByRole('button', { name: 'Subject missing? Add it here' }).click(); await page.getByLabel('New subject name').fill('Chemistry'); await page.getByRole('button', { name: 'Add and use' }).click();
  await page.locator('#pa-course-grade').selectOption({ label: 'Grade 10' });
  assert.equal(await page.locator('#pa-course-title').inputValue(), 'Lab Physics, Year 11', 'a customised title survives later selections');
  // ...and survives leaving and re-entering the step
  await dot('Subjects').click(); await nextStep(); await stepHeading('First course').waitFor(); assert.equal(await page.locator('#pa-course-title').inputValue(), 'Lab Physics, Year 11');
  await page.locator('#pa-course-title').fill('');
  assert.equal(await page.locator('#pa-course-title').inputValue(), 'Chemistry - Grade 10', 'clearing the field restores the suggestion');
  assert.ok(!(await page.locator('#pa-course-title').inputValue()).match(/[\u2013\u2014]/), 'a plain hyphen, never a dash');
 });
 await step('inline creation works in the wizard, and every earlier step keeps its values when revisited', async () => {
  reset(); await open('view=new'); await fillBasics();
  await page.getByRole('button', { name: 'Grade level missing? Add it here' }).click();
  await page.getByLabel('New grade level name').fill('Grade 12'); await page.getByLabel('New grade level name').press('Enter');
  assert.equal(await page.locator('#pa-course-grade option:checked').innerText(), 'Grade 12', 'the new grade level is selected');
  await page.getByRole('button', { name: 'Subject missing? Add it here' }).click();
  await page.getByLabel('New subject name').fill('Chemistry'); await page.getByRole('button', { name: 'Add and use' }).click();
  assert.equal(await page.locator('#pa-course-subject option:checked').innerText(), 'Chemistry'); assert.equal(await page.locator('#pa-course-title').inputValue(), 'Physics for Grade 10', 'the customised title is untouched');
  await dot('Teacher').click(); assert.equal(await page.locator('#pa-email').inputValue(), 'New.Teacher@Example.test', 'step 1 intact');
  await dot('Education').click(); assert.equal(await page.locator('#pa-sys-0').inputValue(), 'IGCSE'); assert.equal(await page.locator('#pa-board-0').inputValue(), 'Cambridge');
  assert.deepEqual((await page.locator('ul[aria-label="Grade levels"] li').allInnerTexts()).map(c => c.replace('×', '').trim()), ['Grade 10', 'Grade 11', 'Grade 12']);
  await page.getByRole('button', { name: 'Add another education system' }).click();
  assert.equal(await page.locator('#pa-sys-1').count(), 1); assert.equal(await page.locator('#pa-sys-0').inputValue(), 'IGCSE');
  await page.locator('#pa-grade-0').fill('grade 10'); await page.locator('#pa-grade-0').press('Enter'); await page.getByText('already in this education system').waitFor();
  assert.equal((await page.locator('ul[aria-label="Grade levels"]').first().locator('li').count()), 3, 'duplicates are refused without losing the list');
  await page.getByRole('button', { name: 'Remove this education system' }).last().click();
  assert.equal(await page.locator('#pa-sys-1').count(), 0); assert.equal(await page.locator('#pa-sys-0').inputValue(), 'IGCSE');
  await dot('Subjects').click(); assert.deepEqual((await page.locator('ul[aria-label="Subjects taught"] li').allInnerTexts()).map(c => c.replace('×', '').trim()), ['Physics', 'Chemistry']);
  await dot('First course').click(); assert.equal(await page.locator('#pa-course-grade option:checked').innerText(), 'Grade 12');
 });
 await step('review stays separate: it shows exactly what will be created, any step can be edited from it, and nothing is lost on the round trip', async () => {
  await page.getByRole('button', { name: 'Review setup', exact: true }).click(); await page.getByRole('heading', { name: 'Review before creating' }).waitFor();
  const text = await page.locator('main').innerText();
  for (const expected of ['new.teacher@example.test', 'IGCSE', 'Cambridge', 'Grade 12', 'Physics', 'Chemistry', 'Physics for Grade 10', 'accepting the invitation', 'starts empty']) assert.ok(text.includes(expected), expected);
  assert.equal(posts.length, 0); assert.deepEqual(await states(), ['completed', 'completed', 'completed', 'completed']); assert.equal(await page.locator('[aria-current="step"]').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Create portal' }).count(), 1); assert.equal(await page.locator('#pa-email').count(), 0, 'the form is not shown beside the review');
  await accessible('review, light');
  await dot('Education').click(); await stepHeading('Education systems').waitFor(); assert.equal(await page.locator('#pa-sys-0').inputValue(), 'IGCSE');
  await page.locator('#pa-sys-0').fill('IGCSE Extended'); await dot('First course').click(); await stepHeading('First course').waitFor();
  assert.equal(await page.locator('#pa-course-title').inputValue(), 'Physics for Grade 10');
  await page.getByRole('button', { name: 'Review setup', exact: true }).click(); await page.getByRole('heading', { name: 'Review before creating' }).waitFor();
  assert.ok((await page.locator('main').innerText()).includes('IGCSE Extended'), 'the edit is in the review');
  await page.getByRole('button', { name: 'Back to edit' }).click(); await stepHeading('First course').waitFor(); assert.equal(await page.locator('#pa-course-title').inputValue(), 'Physics for Grade 10');
  await dot('Education').click(); await page.locator('#pa-sys-0').fill('IGCSE'); await dot('First course').click();
  assert.equal(posts.length, 0, 'no provisioning request while editing');
 });
 await step('motion: steps enter with a subtle transition that stops under reduced motion', async () => {
  const anim = () => page.evaluate(() => getComputedStyle(document.querySelector('.eds-step-panel')).animationName);
  assert.match(await anim(), /eds-step-in/); await page.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await anim(), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
 });

 await step('a definite refusal keeps the draft and says what to fix; a retry then succeeds', async () => {
  behaviors = ['conflict']; await page.getByRole('button', { name: 'Review setup', exact: true }).click(); await page.getByRole('button', { name: 'Create portal' }).click();
  await page.getByText('A pending invitation already exists for this email').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Create portal' }).isEnabled(), true);
  behaviors = ['outage']; await page.getByRole('button', { name: 'Create portal' }).click(); await page.getByText('This is unavailable right now').waitFor();
  assert.equal(portals.length, 0, 'nothing was created by either failure');
 });
 await step('create is single-flight and success shows the one-time code, honest delivery and a pending owner', async () => {
  behaviors = ['slow']; const before = posts.length;
  const create = page.getByRole('button', { name: 'Create portal' }); await create.dblclick();
  await page.getByRole('heading', { name: 'Portal created' }).waitFor();
  assert.equal(posts.length - before, 1, 'a double click sends one request');
  const request = posts.at(-1);
  assert.deepEqual(Object.keys(request).sort(), ['course', 'expiresInDays', 'subjects', 'systems', 'teacherEmail']);
  assert.equal(request.teacherEmail, 'new.teacher@example.test'); assert.equal(request.systems[0].examinationBoard, 'Cambridge');
  assert.deepEqual(Object.keys(request.course).sort(), ['gradeKey', 'subjectKey', 'title']);
  const shown = await page.locator('[data-invitation-link]').innerText(); assert.ok(shown.endsWith('/teacher-invitation/' + secrets.at(-1))); assert.match(shown, /\/teacher-invitation\/[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(posts).includes(shown), 'the secret was never sent by the browser');
  await page.getByText('No email was sent').waitFor(); await page.getByText('can access this teaching space after accepting').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Inspect portal' }).count(), 1);
  assert.equal(portals.length, 1);
  await accessible('created, light');
 });
 await step('a dropped connection while creating is reported as unknown, never as failure, and points to the list', async () => {
  reset(); await open('view=new'); await fillBasics(); behaviors = ['drop', 'drop', 'drop'];
  await page.getByRole('button', { name: 'Review setup', exact: true }).click(); await page.getByRole('button', { name: 'Create portal' }).click();
  await page.getByRole('heading', { name: 'We could not confirm the result' }).waitFor();
  await page.getByRole('link', { name: 'Check teacher portals' }).waitFor();
  await page.getByRole('button', { name: 'Back to review' }).click(); await page.getByRole('heading', { name: 'Review before creating' }).waitFor();
 });
 await step('the list is honest when empty, populated from data, and a failed read offers retry', async () => {
  reset(); await open('view=list'); await page.getByText('No teacher portals yet').waitFor(); assert.equal(await page.locator('table').count(), 0);
  await page.getByRole('link', { name: 'Create teacher portal' }).first().waitFor();
  portals.unshift(fictionalPortal(sampleRequest())); portals.unshift(fictionalPortal(sampleRequest('done.teacher@example.test'), 'accepted'));
  await open('view=list');
  const text = await page.locator('table').innerText();
  for (const expected of ['list.teacher@example.test', 'done.teacher@example.test', 'IGCSE · Cambridge · Grade 10 · Physics', 'Invitation pending', 'Owner confirmed', '2030-01-02 03:04 UTC']) assert.ok(text.includes(expected), expected);
  await accessible('list, light');
  await page.route('**/api/platform-admin/portals', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"reason":"unavailable"}' }));
  await page.getByRole('button', { name: 'Refresh' }).click(); await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('table').count(), 1, 'stale data stays visible beside the error rather than becoming an empty list');
  await page.unroute('**/api/platform-admin/portals'); await page.getByRole('button', { name: 'Retry' }).click(); await page.getByRole('alert').waitFor({ state: 'detached' });
 });
 await step('portal page: inspect, reissue shows a new one-time link, revoke needs confirmation, refresh failure is not reported as a failed change', async () => {
  const id = portals.find(p => p.invitations[0].teacherEmail === 'list.teacher@example.test').organizationId;
  await open('view=detail&id=' + id);
  await page.getByText('Access starts after the teacher accepts the invitation.').waitFor();
  const text = await page.locator('main').innerText(); for (const expected of ['Email delivery status isn't retained here', 'IGCSE', 'Grade 10', 'Physics - Grade 10', 'Draft, no content yet', 'Portal created', 'Administrator']) assert.ok(text.includes(expected), expected);
  assert.equal(await page.locator('[data-invitation-link]').count(), 0, 'a stored invitation never displays a secret');
  await accessible('portal, light');
  await page.getByRole('button', { name: 'Issue a replacement link' }).click(); await page.locator('#pa-re-days').selectOption('14');
  await page.getByRole('button', { name: 'Issue replacement link' }).click(); await page.getByText('A new invitation link was issued.').waitFor();
  assert.ok((await page.locator('[data-invitation-link]').innerText()).endsWith('/teacher-invitation/' + secrets.at(-1)));
  await page.getByRole('button', { name: 'I have saved the link' }).click(); assert.equal(await page.locator('[data-invitation-link]').count(), 0);
  await page.getByText('New invitation link issued').waitFor();
  await page.getByRole('button', { name: 'Revoke invitation' }).click(); await page.getByText('Revoke this invitation?').waitFor();
  assert.equal(portals.find(p => p.organizationId === id).invitations[0].status, 'pending', 'nothing happens before confirmation');
  detailFailures = 1; await page.getByRole('button', { name: 'Yes, revoke' }).click();
  await page.getByText('The change was saved, but the page could not be refreshed').waitFor();
  assert.equal(portals.find(p => p.organizationId === id).invitations[0].status, 'revoked');
 });

 const newPortal = async email => { const portal = fictionalPortal(sampleRequest(email)); portals.unshift(portal); await open('view=detail&id=' + portal.organizationId); await page.getByText('Access starts after the teacher accepts the invitation.').waitFor(); return portal; };
 const unknownBanner = () => page.getByText('The outcome is unknown');
 await step('revoke with a dropped connection that DID apply: unknown first, no blind retry, a safe refresh confirms the revocation', async () => {
  reset(); const portal = await newPortal('revoke.applied@example.test'); dropActions = 'applied';
  await page.getByRole('button', { name: 'Revoke invitation' }).click(); await page.getByRole('button', { name: 'Yes, revoke' }).click();
  await unknownBanner().waitFor();
  assert.equal(await page.getByText('The connection dropped while revoking').count(), 1);
  assert.equal(await page.getByText(/could not be revoked|try again later/i).count(), 0, 'a dropped connection is not reported as a failure');
  assert.equal(await page.getByRole('button', { name: 'Revoke invitation' }).isDisabled(), true, 'revoke is locked, so the administrator cannot retry blindly');
  assert.equal(await page.getByRole('button', { name: 'Issue a replacement link' }).isDisabled(), true);
  await accessible('portal, unknown revoke');
  const sent = actionPosts; dropActions = null;
  await page.getByRole('button', { name: 'Refresh invitation status' }).click();
  await page.getByText('Confirmed: the invitation was revoked.').waitFor();
  assert.equal(actionPosts, sent, 'the refresh is a read and sent no further write');
  assert.equal(await unknownBanner().count(), 0); assert.equal(portal.invitations[0].status, 'revoked');
 });
 await step('revoke with a dropped connection that did NOT apply: the refresh says so and the action becomes available again', async () => {
  reset(); await newPortal('revoke.lost@example.test'); dropActions = 'unapplied';
  await page.getByRole('button', { name: 'Revoke invitation' }).click(); await page.getByRole('button', { name: 'Yes, revoke' }).click();
  await unknownBanner().waitFor(); dropActions = null;
  await page.getByRole('button', { name: 'Refresh invitation status' }).click();
  await page.getByText('the invitation is still pending. The revoke did not go through.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Revoke invitation' }).isEnabled(), true, 'the administrator may now act again, deliberately');
 });
 await step('reissue with a dropped connection that DID apply: the lost secret is explained and a deliberate replacement path issues a visible code', async () => {
  reset(); const portal = await newPortal('reissue.applied@example.test'); const original = portal.invitations[0].id; dropActions = 'applied';
  await page.getByRole('button', { name: 'Issue a replacement link' }).click(); await page.getByRole('button', { name: 'Issue replacement link' }).click();
  await unknownBanner().waitFor();
  assert.equal(await page.getByText('The connection dropped while issuing a replacement link').count(), 1);
  assert.equal(await page.locator('[data-invitation-link]').count(), 0, 'no secret exists to show');
  assert.equal(await page.getByRole('button', { name: 'Issue a replacement link' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Issue a replacement code' }).count(), 0, 'no replacement is offered until the status is known');
  const sent = actionPosts; dropActions = null;
  await page.getByRole('button', { name: 'Refresh invitation status' }).click();
  await page.getByText('its secret never reached this page and cannot be shown again', { exact: false }).waitFor();
  assert.equal(actionPosts, sent, 'refreshing sent no write'); assert.notEqual(portal.invitations[0].id, original, 'the server did issue a code');
  await accessible('portal, lost secret');
  await page.getByRole('button', { name: 'Issue a replacement code' }).click();
  await page.getByRole('button', { name: 'Issue replacement link' }).click(); await page.getByText('A new invitation link was issued.').waitFor();
  assert.ok((await page.locator('[data-invitation-link]').innerText()).endsWith('/teacher-invitation/' + secrets.at(-1)));
  assert.equal(portal.invitations.length, 3, 'original, the lost code and the deliberate replacement');
  assert.equal(portal.invitations.filter(i => i.status === 'pending').length, 1, 'exactly one code works');
 });
 await step('reissue with a dropped connection that did NOT apply: nothing changed and the current code still works', async () => {
  reset(); const portal = await newPortal('reissue.lost@example.test'); dropActions = 'unapplied';
  await page.getByRole('button', { name: 'Issue a replacement link' }).click(); await page.getByRole('button', { name: 'Issue replacement link' }).click();
  await unknownBanner().waitFor(); dropActions = null;
  await page.getByRole('button', { name: 'Refresh invitation status' }).click();
  await page.getByText('Confirmed: no new code was issued. The current code still works.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Issue a replacement code' }).count(), 0); assert.equal(portal.invitations.length, 1);
 });
 await step('a failed status refresh keeps the controls locked and can be retried', async () => {
  reset(); await newPortal('refresh.fails@example.test'); dropActions = 'unapplied';
  await page.getByRole('button', { name: 'Revoke invitation' }).click(); await page.getByRole('button', { name: 'Yes, revoke' }).click();
  await unknownBanner().waitFor(); dropActions = null; detailFailures = 1;
  await page.getByRole('button', { name: 'Refresh invitation status' }).click();
  await page.getByText('The status could not be refreshed').waitFor();
  assert.equal(await unknownBanner().count(), 1, 'still unknown'); assert.equal(await page.getByRole('button', { name: 'Revoke invitation' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Refresh invitation status' }).click(); await page.getByText('the invitation is still pending', { exact: false }).waitFor();
 });

 await step('Arabic RTL: layout mirrors, the original Arabic fonts render, nothing overflows (desktop, tablet, phone), light and dark are readable', async () => {
  reset(); await setLang('ar'); await open('view=new');
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl'); await page.getByRole('heading', { name: 'إنشاء بوابة معلم' }).waitFor();
  await page.waitForFunction(() => document.fonts.check('16px Cairo') || true); await fontsReady();
  assert.match(await family('.eds-root p'), /^Cairo/, 'Arabic body text uses Cairo'); assert.match(await family('h1'), /^Lalezar/, 'Arabic display uses Lalezar');
  assert.match(await family('h2'), /^Cairo/);
  for (let attempt = 0; attempt < 20 && !(await renderedFonts('.eds-root p')).some(f => /Cairo/.test(f)); attempt++) await page.waitForTimeout(150);
  assert.ok((await renderedFonts('.eds-root p')).some(f => /Cairo/.test(f)), 'Cairo is rasterised for Arabic paragraphs');
  assert.ok((await renderedFonts('h1')).some(f => /Lalezar/.test(f)), 'Lalezar is rasterised for the Arabic title');
  const sidebar = await page.locator('#pa-sidebar').boundingBox(); assert.ok(sidebar.x > 600, 'sidebar sits on the right in RTL');
  const xs = await page.locator('.eds-stepper-point').evaluateAll(p => p.map(e => Math.round(e.getBoundingClientRect().left))); assert.ok(xs[0] > xs[1] && xs[1] > xs[2] && xs[2] > xs[3], 'the progress line runs right to left: ' + xs);
  assert.deepEqual((await page.locator('.eds-stepper-label').allInnerTexts()).map(x => x.split('،')[0].split(',')[0].trim()), ['المعلم', 'التعليم', 'المواد', 'المقرر الأول']);
  assert.equal(await page.getByRole('button', { name: 'رجوع', exact: true }).count(), 0);
  for (const mode of ['Light', 'Dark']) {
   await setTheme(mode.toLowerCase()); await open('view=new');
   const bg = await style('.pa-root', 'backgroundColor'), fg = await style('.pa-root', 'color'); assert.ok(contrast(fg, bg) >= 7, mode + ' body contrast');
   await page.getByRole('button', { name: 'التالي', exact: true }).click(); await page.getByRole('alert').first().waitFor();
   const cardBg = await style('.eds-card', 'backgroundColor'); const err = await style('.eds-error', 'color'); assert.ok(contrast(err, cardBg) >= 4.5, mode + ' error contrast ' + err);
   const btn = await style('.eds-btn[data-variant="primary"]', 'backgroundColor'), btnFg = await style('.eds-btn[data-variant="primary"]', 'color'); assert.ok(contrast(btnFg, btn) >= 4.5, mode + ' primary button contrast');
   await accessible('arabic form ' + mode);
   await page.screenshot({ path: path.join(shots, `form-errors-${mode.toLowerCase()}-ar.png`), fullPage: true });
  }
  for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]]) { await page.setViewportSize({ width: w, height: h }); await noOverflow(`ar dark ${w}`); }
  await page.getByRole('button', { name: 'فتح قائمة التنقل' }).click();
  assert.ok((await page.locator('#pa-sidebar').boundingBox()).x > 0, 'RTL drawer opens from the right edge'); await page.screenshot({ path: path.join(shots, 'nav-drawer-mobile-dark-ar.png') });
  await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1440, height: 900 });
  await setLang('en'); await setTheme('light');
 });

 await step('phone width English: every wizard step and the review fit without horizontal scroll, and Back/Next stay on screen', async () => {
  reset(); await page.setViewportSize({ width: 390, height: 844 }); await open('view=new'); await noOverflow('step 1');
  const visible = async name => { const box = await page.getByRole('button', { name, exact: true }).boundingBox(); assert.ok(box && box.y >= 0 && box.y + box.height <= 844, name + ' is inside the viewport: ' + JSON.stringify(box)); };
  await visible('Next'); await page.locator('#pa-email').fill('phone@example.test'); await nextStep(); await noOverflow('step 2'); await visible('Next'); await visible('Back');
  const labels = await page.evaluate(() => [...document.querySelectorAll('.eds-stepper-label')].map(l => l.scrollWidth <= l.parentElement.clientWidth + 1)); assert.ok(labels.every(Boolean), 'step labels fit under their points');
  await page.locator('#pa-sys-0').fill('IGCSE'); await page.locator('#pa-grade-0').fill('Grade 10'); await page.locator('#pa-grade-0').press('Enter'); await nextStep();
  await noOverflow('step 3'); await page.locator('#pa-subject').fill('Physics'); await page.locator('#pa-subject').press('Enter'); await nextStep(); await noOverflow('step 4'); await visible('Review setup');
  await page.locator('#pa-course-grade').selectOption({ label: 'Grade 10' }); await page.locator('#pa-course-subject').selectOption({ label: 'Physics' });
  await page.getByRole('button', { name: 'Review setup', exact: true }).click(); await page.getByRole('heading', { name: 'Review before creating' }).waitFor(); await noOverflow('review 390'); await visible('Create portal');
  portals.unshift(fictionalPortal(sampleRequest('phone.teacher@example.test')));
  await open('view=list'); await page.getByText('phone.teacher@example.test').waitFor(); await noOverflow('list 390');
  await open('view=detail&id=' + portals[0].organizationId); await page.getByText('Access starts after the teacher accepts the invitation.').waitFor(); await noOverflow('detail 390');
  await page.setViewportSize({ width: 1440, height: 900 });
 });
 await step('desktop: the tallest filled step keeps Back and Next inside a normal 1440x900 window', async () => {
  reset(); await open('view=new'); await fillBasics({ upTo: 2 });
  const box = await page.getByRole('button', { name: 'Next', exact: true }).boundingBox(); assert.ok(box.y + box.height <= 900, 'Next is visible without scrolling: ' + JSON.stringify(box));
  await page.screenshot({ path: path.join(shots, '2-education-step-in-viewport-desktop-light.png') });
 });
 await step('keyboard: the wizard is operable without a pointer, including the stepper, the disclosures and focus after each step', async () => {
  reset(); await open('view=new'); await page.locator('#pa-email').focus();
  await dot('Education').focus(); await page.keyboard.press('Enter'); await page.getByText('Enter the teacher email.').waitFor(); assert.equal(await page.locator('#pa-email').count(), 1, 'a blocked step does not open from the keyboard either');
  await page.locator('#pa-email').focus(); await page.keyboard.type('kbd@example.test'); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-controls')), 'pa-settings', 'Tab reaches the invitation settings toggle');
  await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'pa-lifetime', 'the opened section is next in order');
  await page.locator('#pa-email').focus(); await page.keyboard.press('Enter');
  await stepHeading('Education systems').waitFor(); assert.equal(await page.evaluate(() => document.activeElement.id), 'pa-step-title', 'Enter in the email field acts as Next and focus follows the step');
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'pa-sys-0');
  await page.keyboard.type('IGCSE'); await page.locator('#pa-grade-0').focus(); await page.keyboard.type('Grade 9'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('ul[aria-label="Grade levels"] li').count(), 1); assert.equal(await page.evaluate(() => document.activeElement.id), 'pa-grade-0', 'focus stays in the field after adding so several can be entered quickly');
  assert.equal(await page.getByRole('heading', { name: /^Education systems/ }).count(), 1, 'Enter inside the grade field adds an item; it does not advance');
  await page.getByRole('button', { name: 'Back', exact: true }).focus(); await page.keyboard.press('Enter'); await page.locator('#pa-email').waitFor();
  const focusRing = await page.evaluate(() => { document.querySelector('#pa-email').focus(); const s = getComputedStyle(document.querySelector('#pa-email')); return s.outlineStyle + ' ' + s.outlineWidth; }); assert.doesNotMatch(focusRing, /^none/);
  const stepRing = await page.evaluate(() => { const b = document.querySelector('.eds-stepper-step'); b.focus(); return getComputedStyle(b).outlineStyle; }); assert.notEqual(stepRing, 'none', 'stepper buttons show focus');
  assert.equal(posts.length, 0);
  await accessible('wizard keyboard');
 });

 await step('native controls follow the brand: custom select chevron, branded text selection and focus ring, no browser-default blue, no layout shift on focus', async () => {
  reset();
  for (const mode of ['light', 'dark']) {
   await setTheme(mode); await open('view=new'); await fillBasics({ customTitle: false });
   const select = '#pa-course-grade';
   assert.equal(await style(select, 'appearance'), 'none', 'the native select arrow is removed');
   assert.match(await style(select, 'backgroundImage'), /data:image\/svg\+xml/, 'a themed chevron replaces it');
   assert.ok(parseFloat(await style(select, 'paddingRight')) >= 36, 'room for the chevron');
   const before = await page.locator('#pa-course-title').boundingBox(); await page.locator('#pa-course-title').focus();
   const after = await page.locator('#pa-course-title').boundingBox(); assert.deepEqual([after.width, after.height], [before.width, before.height], 'focusing does not resize the field');
   const ring = await style('#pa-course-title', 'outlineColor'); assert.doesNotMatch(ring, /^rgb\(\s*(11|140),/, 'not the old blue focus color');
   const ringRgb = ring.match(/\d+(\.\d+)?/g).map(Number); assert.ok(ringRgb[1] > ringRgb[2] && ringRgb[1] >= ringRgb[0], 'the focus ring is green: ' + ring);
   assert.equal(await style('#pa-course-title', 'borderTopLeftRadius'), await page.evaluate(() => { document.querySelector('#pa-course-title').blur(); return getComputedStyle(document.querySelector('#pa-course-title')).borderTopLeftRadius; }), 'radius is unchanged by focus');
   await page.locator('#pa-course-title').selectText();
   const selected = await page.evaluate(() => { const rule = [...document.styleSheets].flatMap(s => [...s.cssRules]).find(r => r.selectorText === '.eds-root ::selection'); return rule && rule.cssText; });
   assert.match(selected, /var\(--eds-selection-bg\)/, 'selection is themed through tokens');
   assert.equal(await style('#pa-course-title', 'caretColor'), await style('#pa-course-title', 'color'), 'caret matches the text color');
   assert.equal(await style('.eds-root', 'accentColor'), 'rgb(126, 217, 87)');
   const opt = await page.evaluate(() => { const o = document.querySelector('#pa-course-grade option'); const s = getComputedStyle(o); return { bg: s.backgroundColor, fg: s.color }; });
   assert.ok(contrast(opt.fg, opt.bg) >= 4.5, mode + ' dropdown option contrast');
   await page.locator('#pa-course-title').focus(); await page.locator('#pa-course-title').selectText();
   await page.locator('main section').screenshot({ path: path.join(shots, `5-native-controls-${mode}.png`) });
  }
  await setTheme('light');
 });

 // ---- the screenshots the owner reviews: real pages, real fonts, desktop + mobile, light + dark ----------

 await step('layout: the whole wizard is centered in the main area at desktop, tablet and phone widths, in LTR and RTL, without hard-coded offsets', async () => {
  const measure = async () => { await page.waitForTimeout(380); return page.evaluate(() => {
   const content = document.querySelector('.pa-content'), cs = getComputedStyle(content), pageBox = document.querySelector('.eds-page').getBoundingClientRect(), c = content.getBoundingClientRect();
   const area = (c.left + parseFloat(cs.paddingLeft) + c.right - parseFloat(cs.paddingRight)) / 2, mid = (pageBox.left + pageBox.right) / 2;
   const center = el => { const r = el.getBoundingClientRect(); return (r.left + r.right) / 2 - mid; };
   const textCenter = el => { const range = document.createRange(); range.selectNodeContents(el); const r = range.getBoundingClientRect(); return (r.left + r.right) / 2 - mid; };
   return { page: Math.round((mid - area) * 10) / 10, width: pageBox.width, gapStart: pageBox.left - c.left, gapEnd: c.right - pageBox.right, vw: innerWidth,
    items: { h1: textCenter(document.querySelector('h1')), intro: textCenter(document.querySelector('.eds-page-head p')), stepper: center(document.querySelector('.eds-stepper')), card: center(document.querySelector('.eds-card')), actions: center(document.querySelector('.eds-wizard-actions')) } };
  }); };
  const verify = (m, label) => {
   assert.ok(Math.abs(m.page) <= 1.5, label + ': the container is centered in the content area (' + m.page + 'px off)');
   for (const [name, offset] of Object.entries(m.items)) assert.ok(Math.abs(offset) <= 2.5, label + ': ' + name + ' shares the center (' + offset + 'px)');
   assert.ok(Math.abs(m.gapStart - m.gapEnd) <= 1.5, label + ': equal space on both sides'); assert.ok(m.width <= 705, label + ': a responsive max-width, not full bleed (' + m.width + ')');
   if (m.vw < 760) assert.ok(m.gapStart >= 12 && m.gapStart <= 28 && m.width >= m.vw - 56, label + ': phone uses the available width with padding (' + m.gapStart + ')');
  };
  for (const [w, h] of [[1440, 900], [1180, 820], [1024, 768], [768, 1024], [390, 844]]) {
   reset(); await page.setViewportSize({ width: w, height: h }); await open('view=new'); await stepHeading('Teacher').waitFor();
   verify(await measure(), w + ' step 1'); await noOverflow('centered step 1 ' + w);
   await fillBasics({ upTo: 2 }); verify(await measure(), w + ' step 2 (the tallest)'); await noOverflow('centered step 2 ' + w);
   await nextStep(); await page.locator('#pa-subject').fill('Physics'); await page.locator('#pa-subject').press('Enter'); await nextStep();
   await page.locator('#pa-course-grade').selectOption({ label: 'Grade 10' }); await page.locator('#pa-course-subject').selectOption({ label: 'Physics' });
   await page.getByRole('button', { name: 'Review setup', exact: true }).click(); await page.getByRole('heading', { name: 'Review before creating' }).waitFor(); verify(await measure(), w + ' review');
  }
  await setLang('ar'); await page.setViewportSize({ width: 1440, height: 900 }); await open('view=new'); verify(await measure(), 'RTL desktop step 1');
  await page.setViewportSize({ width: 390, height: 844 }); await open('view=new'); verify(await measure(), 'RTL phone step 1'); await noOverflow('RTL phone');
  await setLang('en'); await page.setViewportSize({ width: 1440, height: 900 });
  // other layout variants use the same primitive: the settings page is regular width and centered too; the list is wide
  await open('view=settings'); const settings = await page.evaluate(() => { const p = document.querySelector('.eds-page'); return [p.dataset.layout, p.getBoundingClientRect().width]; }); assert.equal(settings[0], 'regular'); assert.ok(settings[1] <= 897 && settings[1] > 705, 'regular is wider than focused: ' + settings[1]);
  await open('view=list'); assert.equal(await page.locator('.eds-page').getAttribute('data-layout'), 'wide');
 });
 await step('header: no language or appearance controls in the top header; the phone header holds only the menu button', async () => {
  reset(); await page.setViewportSize({ width: 1440, height: 900 });
  for (const view of ['view=new', 'view=list']) { await open(view); assert.equal(await page.locator('.pa-topbar').isVisible(), false, 'no top header strip on desktop'); assert.equal(await page.getByRole('radiogroup').count(), 0); assert.equal(await page.getByRole('button', { name: /^(EN|عربي|Light|Dark|System)$/ }).count(), 0, 'no preference buttons anywhere outside Settings'); }
  await page.setViewportSize({ width: 390, height: 844 }); await open('view=new');
  assert.equal(await page.locator('.pa-topbar').isVisible(), true); assert.equal(await page.locator('.pa-topbar button').count(), 1, 'only the navigation menu button'); assert.equal(await page.getByRole('button', { name: /^(EN|عربي|Light|Dark|System)$/ }).count(), 0);
  await page.setViewportSize({ width: 1440, height: 900 });
 });
 await step('settings: reachable from the sidebar footer; language and appearance work, persist across reloads and navigation, RTL follows, and the keys work', async () => {
  reset(); await open('view=list');
  const link = page.locator('.pa-sidebar-foot').getByRole('link', { name: 'Settings' }); assert.equal(await link.count(), 1); assert.equal(await link.getAttribute('aria-current'), null);
  assert.ok((await link.boundingBox()).y > 450, 'Settings sits near the bottom of the sidebar'); assert.equal(await page.getByRole('navigation', { name: 'Platform navigation' }).getByRole('link').count(), 1);
  await open('view=settings'); assert.equal(await link.getAttribute('aria-current'), 'page'); await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
  assert.equal(await page.getByRole('radiogroup').count(), 2); assert.equal(await page.locator('.eds-card').count(), 2, 'only real settings, no placeholder sections');
  assert.deepEqual(await prefGroup('Language').getByRole('radio').allInnerTexts(), ['English', 'العربية']); assert.deepEqual(await prefGroup('Appearance').getByRole('radio').allInnerTexts(), ['Light', 'Dark', 'System']);
  const note = await page.getByText(/not synchronized to your other devices/).count(); assert.equal(note, 1, 'honest about being per browser'); assert.equal(await page.getByText(/sync(?!hronized)/i).count(), 0);
  await accessible('settings, light');
  // appearance: applies, stores, survives a reload and navigation
  await prefGroup('Appearance').getByRole('radio', { name: 'Dark' }).click(); await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  assert.equal(await page.evaluate(() => localStorage.getItem('edulabs-lms-appearance')), 'dark'); assert.equal(await prefGroup('Appearance').getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked'), 'true');
  await accessible('settings, dark');
  await page.reload(); await page.locator('#pa-sidebar').waitFor({ state: 'attached' }); await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  assert.equal(await prefGroup('Appearance').getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked'), 'true', 'the saved choice is shown after a reload');
  await open('view=list'); assert.equal(await isDark(), true, 'dark persists across navigation');
  await open('view=settings'); await prefGroup('Appearance').getByRole('radio', { name: 'System' }).click();
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.classList.contains('dark')); await page.emulateMedia({ colorScheme: 'light' }); await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  assert.equal(await page.evaluate(() => localStorage.getItem('edulabs-lms-appearance')), 'system'); await page.emulateMedia({ colorScheme: 'light' });
  await prefGroup('Appearance').getByRole('radio', { name: 'Light' }).click();
  // language: applies, stores, survives a reload and navigation, mirrors the layout
  await prefGroup('Language').getByRole('radio', { name: 'العربية' }).click(); await page.waitForFunction(() => document.documentElement.dir === 'rtl');
  await page.getByRole('heading', { name: 'الإعدادات', level: 1 }).waitFor(); assert.equal(await page.evaluate(() => localStorage.getItem('edulabs-lms-language')), 'ar'); assert.match(await page.evaluate(() => document.cookie), /edulabs_lms_language=ar/);
  assert.ok((await page.locator('#pa-sidebar').boundingBox()).x > 600, 'sidebar on the right in RTL'); assert.deepEqual(await prefGroup('اللغة').getByRole('radio').allInnerTexts(), ['English', 'العربية']);
  assert.equal(await page.getByText('محفوظة في هذا المتصفح', { exact: false }).count() + await page.getByText('تُحفظ في هذا المتصفح', { exact: false }).count() >= 1, true);
  await accessible('settings, arabic'); await page.screenshot({ path: path.join(shots, '8-settings-ar-light.png') });
  await page.reload(); await page.locator('#pa-sidebar').waitFor({ state: 'attached' }); assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl', 'Arabic survives a reload');
  await open('view=list'); assert.equal(await page.evaluate(() => document.documentElement.lang), 'ar'); await page.getByRole('heading', { name: 'بوابات المعلمين', level: 1 }).waitFor();
  // keyboard: one tab stop per group, arrows move and select, RTL reverses them, focus follows the selection
  await open('view=settings'); const langs = prefGroup('اللغة').getByRole('radio'); assert.equal(await prefGroup('اللغة').locator('[tabindex="0"]').count(), 1, 'one tab stop per radio group');
  await langs.nth(1).focus(); await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => document.documentElement.dir === 'ltr');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-checked') + ':' + document.activeElement.textContent), 'true:English', 'in RTL the right arrow goes to the previous choice and focus follows');
  await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => document.documentElement.dir === 'rtl'); assert.equal(await page.evaluate(() => document.activeElement.textContent), 'العربية', 'in LTR the right arrow goes forward');
  await page.keyboard.press('ArrowLeft'); await page.waitForFunction(() => document.documentElement.dir === 'ltr');
  const themes = prefGroup('Appearance').getByRole('radio'); await themes.nth(0).focus(); await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Dark'); await page.keyboard.press('ArrowLeft'); await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Light');
  await page.keyboard.press('Tab'); assert.notEqual(await page.evaluate(() => document.activeElement.closest('[role="radiogroup"]')?.getAttribute('aria-label') ?? null), 'Appearance', 'Tab leaves the group');
  const ring = await page.evaluate(() => { const r = document.querySelector('[role="radio"]'); r.focus(); return getComputedStyle(r).outlineStyle; }); assert.notEqual(ring, 'none', 'radios show focus');
  await setLang('en'); await setTheme('light');
 });

 await step('screenshots: teacher list, all four wizard steps, review and portal detail in desktop/mobile and light/dark', async () => {
  reset(); portals.unshift(fictionalPortal(sampleRequest('amira.teacher@example.test'))); portals.unshift(fictionalPortal({ ...sampleRequest('omar.teacher@example.test'), course: { title: 'Chemistry - Grade 11', gradeKey: 'g2', subjectKey: 's2' } }, 'accepted'));
  portals.unshift(fictionalPortal(sampleRequest('lina.teacher@example.test')));
  const detailId = portals[2].organizationId;
  for (const [device, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
   await page.setViewportSize(size);
   for (const mode of ['light', 'dark']) {
    await setTheme(mode);
    // The viewport is grown to the page height for the capture so sticky bars are not stitched misleadingly.
    const shot = async name => {
     await page.waitForTimeout(450);
     for (let i = 0; i < 2; i++) { const height = await page.evaluate(() => document.documentElement.scrollHeight); await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) }); await page.waitForTimeout(80); }
     await page.screenshot({ path: path.join(shots, `${name}-${device}-${mode}.png`) }); await page.setViewportSize(size);
    };
    const setMode = async () => { await fontsReady(); assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), mode === 'dark'); };
    await open('view=list'); await page.getByText('amira.teacher@example.test').waitFor(); await setMode(); await noOverflow(`list ${device} ${mode}`); await accessible(`list ${device} ${mode}`); await shot('1-teacher-list');
    await open('view=new'); await setMode();
    await page.locator('#pa-email').fill('New.Teacher@Example.test'); await noOverflow(`step1 ${device} ${mode}`); await accessible(`step1 ${device} ${mode}`); await shot('2-create-step1-teacher');
    await nextStep(); await stepHeading('Education systems').waitFor(); await page.locator('#pa-sys-0').fill('IGCSE');
    await page.getByRole('button', { name: 'Examination board (optional)' }).click(); await page.locator('#pa-board-0').fill('Cambridge');
    await page.locator('#pa-grade-0').fill('Grade 10'); await page.locator('#pa-grade-0').press('Enter'); await page.locator('#pa-grade-0').fill('Grade 11'); await page.getByRole('button', { name: 'Add grade level' }).click();
    await noOverflow(`step2 ${device} ${mode}`); await accessible(`step2 ${device} ${mode}`); await shot('3-create-step2-education');
    await nextStep(); await stepHeading('Subjects').waitFor(); await page.locator('#pa-subject').fill('Physics'); await page.locator('#pa-subject').press('Enter'); await page.locator('#pa-subject').fill('Chemistry'); await page.locator('#pa-subject').press('Enter');
    await noOverflow(`step3 ${device} ${mode}`); await accessible(`step3 ${device} ${mode}`); await shot('4-create-step3-subjects');
    await nextStep(); await stepHeading('First course').waitFor(); await page.locator('#pa-course-grade').selectOption({ label: 'Grade 10' }); await page.locator('#pa-course-subject').selectOption({ label: 'Physics' });
    await noOverflow(`step4 ${device} ${mode}`); await accessible(`step4 ${device} ${mode}`); await shot('5-create-step4-course');
    await page.getByRole('button', { name: 'Review setup', exact: true }).click(); await page.getByRole('heading', { name: 'Review before creating' }).waitFor(); await noOverflow(`review ${device} ${mode}`); await accessible(`review ${device} ${mode}`); await shot('6-review-setup');
    await open('view=detail&id=' + detailId); await page.getByText('Access starts after the teacher accepts the invitation.').waitFor(); await setMode(); await noOverflow(`detail ${device} ${mode}`); await accessible(`detail ${device} ${mode}`); await shot('7-portal-detail');
    await open('view=settings'); await setMode(); await noOverflow(`settings ${device} ${mode}`); await accessible(`settings ${device} ${mode}`); await shot('8-settings');
   }
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await setTheme('light');
 });

 await step('no uncaught errors, no external requests', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); });
 await browser.close(); server.close();
 console.log(results.join('\n')); console.log('Platform-admin browser checks passed: ' + results.length + ' groups (fictional HTTP state, not provider E2E). Screenshots: ' + shots);
})().catch(error => { console.error(error.message); if (error.cause) console.error(error.cause.message); process.exit(1); });
