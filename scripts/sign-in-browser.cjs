// The sign-in and sign-up form on the shared components: the real FirebaseForm, FirebaseAuthProvider and design components in a browser,
// with a SYNTHETIC Firebase SDK and a loopback server (no provider, no network, no real account).
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME and a Firebase-mode `npm run build` (the font faces are read from .next/static/css and media).
// LMS_MATRIX=1 adds the screen matrix (scripts/screen-matrix.cjs): sign-in, sign-up, a failed sign-in and the unverified-email panel in Classic and
// New, light and dark, English and Arabic, desktop and phone. The copy on this page is English only (it was before); Arabic shows the mirrored layout.
// LMS_ONLY_STEPS is a regex on step names.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('node:assert/strict');
const { shootMatrix } = require('./screen-matrix.cjs');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/sign-in-browser'); fs.mkdirSync(out, { recursive: true });
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the real font faces are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat([require('./harness-css.cjs')()]).join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');

const sdk = `
const listeners = new Set(); const read = () => JSON.parse(localStorage.getItem('synthetic-user') || 'null');
function persist(u) { localStorage.setItem('synthetic-user', JSON.stringify(u)); }
function user(v) { return v && { ...v, async reload() { Object.assign(this, read()); }, async getIdToken() { return this.emailVerified ? 'synthetic-verified' : 'synthetic-unverified'; }, async getIdTokenResult() { return { claims: { role: 'authenticated' } }; } }; }
const auth = { get currentUser() { return user(read()); }, async authStateReady() {} };
window.__calls = { reset: [], mail: 0, creates: 0 };
const emit = () => listeners.forEach(f => f(auth.currentUser));
export const getAuth = () => auth, browserLocalPersistence = {}; export async function setPersistence() {}
export function onIdTokenChanged(a, f) { listeners.add(f); void f(a.currentUser); return () => listeners.delete(f); }
export async function createUserWithEmailAndPassword(a, email) { window.__calls.creates++; persist({ uid: 'synthetic-user', email, emailVerified: false }); emit(); return { user: a.currentUser }; }
export async function updateProfile(u, v) { persist({ ...read(), ...v }); }
export async function sendEmailVerification() { window.__calls.mail++; }
export async function signInWithEmailAndPassword(a, email) { if (email === 'wrong@example.invalid') throw { code: 'auth/invalid-credential' }; if (email === 'unverified@example.invalid') { persist({ uid: 'synthetic-user', email, emailVerified: false }); emit(); return { user: auth.currentUser }; } persist({ uid: 'synthetic-user', email, emailVerified: true }); emit(); return { user: auth.currentUser }; }
export async function signOut() { localStorage.removeItem('synthetic-user'); emit(); }
export class GoogleAuthProvider {} export class OAuthProvider { addScope() {} }
export async function getRedirectResult() { return null; } export function getAdditionalUserInfo() { return null; }
export async function signInWithPopup() { throw { code: 'auth/popup-closed-by-user' }; } export async function signInWithRedirect() {}
export async function sendPasswordResetEmail(a, email) { window.__calls.reset.push(email); }
`;
const entry = `import React from 'react'; import { createRoot } from 'react-dom/client';
import { FirebaseAuthProvider } from '@/frontend/components/providers/firebase-auth-provider';
import { LoadingProvider } from '@/frontend/components/providers/loading-provider';
import { FirebaseForm } from '@/frontend/features/auth/firebase-form';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
const q = new URLSearchParams(location.search);
// The same wrapper as app/(auth)/layout.tsx (Firebase staging), inside the <main> the matrix measures.
createRoot(document.getElementById('root')).render(<LanguageProvider initialLanguage={q.get('lang') === 'ar' ? 'ar' : 'en'}><ThemeProvider><LoadingProvider><FirebaseAuthProvider><main className="flex min-h-full items-center justify-center p-4 py-8 sm:p-8"><FirebaseForm register={location.pathname === '/sign-up'} /></main></FirebaseAuthProvider></LoadingProvider></ThemeProvider></LanguageProvider>);`;
const stubs = {
  'firebase/auth': sdk, 'firebase/app': `export const getApps = () => [{}], getApp = () => ({}), initializeApp = () => ({});`,
  '@/shared/auth-config': `export const getFirebaseConfig = () => ({});`,
  '@/frontend/lib/account-draft': `export async function storeAccountDraft() {}`,
  'next/navigation': `const router = { replace(p) { window.__navigated = p; }, refresh() { throw Error('Unexpected global refresh'); } }; export const useRouter = () => router; export const usePathname = () => location.pathname;`,
  'next/link': `import React from 'react'; export default function Link(p) { return <a {...p} />; }`,
};
const resolveAlias = p => { for (const c of [p + '.tsx', p + '.ts', path.join(p, 'index.tsx'), path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return p; };

(async () => {
  await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'browser', outfile: path.join(out, 'app.js'), jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_FIREBASE_APPLE_ENABLED': '"false"' },
    plugins: [{ name: 'synthetic-transports', setup(b) {
      b.onResolve({ filter: /.*/ }, a => { if (stubs[a.path]) return { path: a.path, namespace: 'fixture' }; if (a.path.startsWith('@/')) return { path: resolveAlias(path.resolve(a.path.slice(2))) }; });
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: process.cwd() }));
    } }] });
  const posts = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
    if (u.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
    if (u.pathname.startsWith('/_next/static/media/')) return res.end(fs.readFileSync(path.join(mediaDir, path.basename(u.pathname))));
    if (req.method === 'POST') { const parts = []; req.on('data', v => parts.push(v)); return req.on('end', () => {
      let v = {}; try { v = JSON.parse(Buffer.concat(parts) || '{}'); } catch {}
      posts.push(u.pathname); res.setHeader('Content-Type', 'application/json');
      if (u.pathname.endsWith('/logout')) return res.end('{"ok":true}');
      if (u.pathname.endsWith('/provision')) return res.end('{"refreshRequired":false}');
      if (v.idToken !== 'synthetic-verified') { res.statusCode = 403; return res.end('{"error":"Verify your email first."}'); }
      res.setHeader('Set-Cookie', 'synthetic-session=yes; HttpOnly; SameSite=Strict; Path=/'); return res.end('{"ok":true}');
    }); }
    const lang = u.searchParams.get('lang') === 'ar' ? 'ar' : 'en', dark = u.searchParams.get('theme') === 'dark';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html data-lms-appearance data-design="new" lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" class="${dark ? 'dark' : ''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title><link rel="stylesheet" href="/style.css"></head><body class="${fontVars} font-sans"><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port, errors = [], results = [];
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
  const open = async ({ viewport = { width: 1280, height: 900 }, lang = 'en', theme = 'light', look = 'new', target = '/sign-in', seed } = {}) => {
    const context = await browser.newContext({ viewport, locale: lang });
    await context.addInitScript(([l, t, s]) => { try { localStorage.setItem('edulabs-lms-language', l); localStorage.setItem('edulabs-lms-appearance', t); if (s) localStorage.setItem('synthetic-user', s); } catch {} }, [lang, theme, seed ?? '']);
    await context.route('**/*', r => r.request().url().startsWith(origin) ? r.continue() : r.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message.slice(0, 300)); });
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const join = target.includes('?') ? '&' : '?';
    await page.goto(origin + target + join + 'lang=' + lang + '&theme=' + theme);
    await page.evaluate(l => { document.documentElement.dataset.design = l; }, look);
    return { page, context };
  };
  const only = process.env.LMS_ONLY_STEPS ? new RegExp(process.env.LMS_ONLY_STEPS) : null;
  const step = async (name, fn) => { if (only && !only.test(name)) return; try { await fn(); results.push(name); console.log('PASS ' + name); } catch (e) { console.log('FAIL ' + name); throw e; } };
  const unverified = JSON.stringify({ uid: 'synthetic-user', email: 'unverified@example.invalid', emailVerified: false });
  const fill = async (page, email, password) => { await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password); };
  try {
    await step('sign-in: the form, the show-password control, the Forgot your password link and a failed sign-in keep their wording', async () => {
      const { page, context } = await open();
      await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
      assert.equal(await page.locator('[data-auth-surface]').count(), 1, 'the sign-in surface is marked');
      const password = page.getByLabel('Password', { exact: true });
      assert.equal(await password.getAttribute('type'), 'password');
      await page.getByRole('button', { name: 'Show password', exact: true }).click();
      assert.equal(await password.getAttribute('type'), 'text');
      assert.equal(await page.getByRole('button', { name: 'Hide password', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: 'Hide password', exact: true }).click();
      assert.equal(await password.getAttribute('type'), 'password');
      // Forgot password is a link to EduLabs' own page (/forgot-password); the page no longer asks Firebase to send mail.
      const forgot = page.getByRole('link', { name: 'Forgot your password?', exact: true });
      assert.equal(await forgot.getAttribute('href'), '/forgot-password');
      assert.equal(await page.getByRole('button', { name: 'Forgot password?' }).count(), 0, 'the old button is gone');
      assert.deepEqual(await page.evaluate(() => window.__calls.reset), [], 'nothing is sent to Firebase from here');
      await fill(page, 'wrong@example.invalid', 'synthetic-local-only-123!');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Email or password is incorrect.' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).isEnabled(), true);
      assert.equal(await page.getByRole('link', { name: 'Create an account', exact: true }).getAttribute('href'), '/sign-up');
      assert.equal(await page.getByRole('button', { name: 'Continue with Apple', exact: true }).isDisabled(), true);
      await page.getByText('Apple sign-in requires provider setup and is currently unavailable.').waitFor();
      await context.close();
    });
    await step('sign-in: a verified account goes home once, an unverified one is held with the verification panel', async () => {
      let { page, context } = await open();
      await fill(page, 'student@example.invalid', 'synthetic-local-only-123!');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForFunction(() => window.__navigated === '/home');
      await context.close();
      ({ page, context } = await open());
      await fill(page, 'unverified@example.invalid', 'synthetic-local-only-123!');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Your account is saved. Verify your email' }).waitFor();
      await page.getByRole('button', { name: 'Resend verification', exact: true }).waitFor();
      await page.getByRole('button', { name: 'I verified my email', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__navigated ?? null), null, 'not sent anywhere');
      await context.close();
    });
    await step('sign-up: names, photo, password rules and the match hint', async () => {
      const { page, context } = await open({ target: '/sign-up' });
      await page.getByRole('heading', { name: 'Create your account', exact: true }).waitFor();
      await page.getByLabel('First name', { exact: true }).fill('Synthetic');
      await page.getByLabel('Last name', { exact: true }).fill('Student');
      await fill(page, 'student@example.invalid', 'synthetic-local-only-123!');
      await page.getByLabel('Confirm password', { exact: true }).fill('different');
      await page.getByText('Passwords do not match.').waitFor();
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Passwords must match.' }).waitFor();
      await page.getByLabel('Confirm password', { exact: true }).fill('synthetic-local-only-123!');
      await page.getByText('Passwords match.').waitFor();
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      assert.equal(await page.locator('.d-photo-preview img').count(), 0);
      await page.locator('.d-photo input[type="file"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
      await page.locator('.d-photo-preview img').waitFor();
      await page.locator('.d-photo-actions .d-btn--tertiary').click();
      await page.waitForFunction(() => !document.querySelector('.d-photo-preview img'));
      assert.equal(await page.getByRole('link', { name: 'Already have an account? Sign in', exact: true }).getAttribute('href'), '/sign-in');
      await context.close();
    });
    await step('the Sign in button is ink on lime at AA in Classic and New, light and dark', async () => {
      for (const look of ['classic', 'new']) for (const theme of ['light', 'dark']) {
        const { page, context } = await open({ look, theme });
        await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
        await page.waitForFunction(t => (t === 'dark') === document.documentElement.classList.contains('dark'), theme);
        const r = await page.getByRole('button', { name: 'Sign in', exact: true }).evaluate(b => {
          const s = getComputedStyle(b), canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
          const rgb = c => { canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = '#000'; canvas.fillStyle = c; canvas.fillRect(0, 0, 1, 1); return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3); };
          const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
          const back = rgb(s.backgroundColor), text = rgb(s.color), a = lum(back), c = lum(text);
          return { back, text, ratio: (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05), lime: back[1] > back[0] && back[1] > back[2] && back[1] > 150 };
        });
        assert.ok(r.lime, `${look} ${theme}: the button is lime (${r.back})`);
        assert.ok(r.text[0] < 80 && r.text[1] < 80 && r.text[2] < 80, `${look} ${theme}: the text is ink (${r.text})`);
        assert.ok(r.ratio >= 4.5, `${look} ${theme}: ${r.ratio.toFixed(2)}`);
        console.log(`      ${look} ${theme}: ${r.ratio.toFixed(2)}:1`);
        await context.close();
      }
    });
    await step('Classic and a page with no marker keep Classic values: the marker is what opts the sign-in in', async () => {
      const { page, context } = await open({ look: 'new' });
      await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
      const primary = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--d-primary').trim());
      const withMarker = await primary();
      await page.evaluate(() => document.querySelector('[data-auth-surface]').removeAttribute('data-auth-surface'));
      const without = await primary();
      assert.notEqual(withMarker, without, 'the New tokens apply because of the marker');
      assert.equal(without.toLowerCase(), '#000000', 'without it a New browser still reads Classic');
      await context.close();
    });
    if (process.env.LMS_MATRIX === '1' && (!only || only.test('Screen matrix'))) {
      const findings = await shootMatrix({ label: 'sign-in', open: ({ viewport, lang, theme, look, target }) => open({ viewport, lang, theme, look, target: target.url, seed: target.seed }), screens: [
        { name: 'signin', target: { url: '/sign-in' }, ready: 'form' },
        { name: 'signup', target: { url: '/sign-up' }, ready: 'form' },
        { name: 'signin-error', target: { url: '/sign-in' }, ready: 'form', act: async page => { await fill(page, 'wrong@example.invalid', 'synthetic-local-only-123!'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Email or password is incorrect.' }).waitFor(); } },
        { name: 'signin-unverified', target: { url: '/sign-in', seed: unverified }, ready: '.d-auth-verify' },
      ] });
      for (const f of findings) console.log('FINDING', f);
      assert.deepEqual(findings, [], 'the screen matrix has findings');
      results.push('Screen matrix');
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
  console.log(results.length + ' steps passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
