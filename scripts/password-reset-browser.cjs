// The two password-reset pages and the reset email in Chromium: the REAL containers (ForgotPassword, ResetPassword), views, language provider and design CSS
// on a loopback server with a SYNTHETIC Firebase SDK (verifyPasswordResetCode, confirmPasswordReset) and a fictional request endpoint. No provider, no network,
// no real account, address or code.
// Needs LMS_BROWSER_RUNTIME / LMS_ESBUILD_RUNTIME / LMS_CHROMIUM_EXECUTABLE and a Firebase-mode build for the font faces (.next/static), like sign-in-browser.cjs.
// LMS_COPY_SHOTS=1 writes the pictures to docs/design/screenshots/password-reset/ (otherwise to .local/password-reset-browser/shots).
// LMS_ONLY_STEPS is a regex on step names.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('node:assert/strict'), ts = require('typescript');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME, esbuildRuntime = process.env.LMS_ESBUILD_RUNTIME;
if (!browserRuntime || !esbuildRuntime) throw Error('Set LMS_BROWSER_RUNTIME and LMS_ESBUILD_RUNTIME to existing Playwright/esbuild tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright')), esbuild = require(path.join(esbuildRuntime, 'esbuild'));
const out = path.resolve('.local/password-reset-browser'); fs.mkdirSync(out, { recursive: true });
const shotsDir = process.env.LMS_COPY_SHOTS === '1' ? path.resolve('docs/design/screenshots/password-reset') : path.join(out, 'shots'); fs.mkdirSync(shotsDir, { recursive: true });
const cssDir = path.resolve('.next/static/css'), mediaDir = path.resolve('.next/static/media');
if (!fs.existsSync(cssDir)) throw Error('Run the Firebase-mode `npm run build` first: the real font faces are needed');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).concat([require('./harness-css.cjs')()]).join('\n');
const fontVars = (css.match(/\.__variable_[a-z0-9]+\{[^}]*\}/g) || []).map(v => v.match(/^\.([^{]+)\{/)[1]).join(' ');
const logoPng = fs.readFileSync('public/email/edulabs-mark.png');

const EMAIL = 'student@example.invalid', CODE = 'VALID_code-0123456789';
// Synthetic Firebase: the code's first letters choose what happens, like a real code would by its state.
const sdk = `
window.__calls = { verify: [], confirm: [] }; window.__online = true; window.__confirmFail = null;
export async function verifyPasswordResetCode(a, code) {
  window.__calls.verify.push(code); await new Promise(r => setTimeout(r, 30));
  if (code.startsWith('EXPIRED')) throw { code: 'auth/expired-action-code' };
  if (code.startsWith('USED')) throw { code: 'auth/invalid-action-code' };
  if (code.startsWith('DISABLED')) throw { code: 'auth/user-disabled' };
  if (code.startsWith('OFFLINE') && window.__forceOffline) throw { code: 'auth/network-request-failed' };
  return ${JSON.stringify(EMAIL)};
}
export async function confirmPasswordReset(a, code, password) {
  window.__calls.confirm.push({ code, length: password.length }); await new Promise(r => setTimeout(r, 30));
  if (window.__confirmFail) throw { code: window.__confirmFail };
}`;
const entry = `import React from 'react'; import { createRoot } from 'react-dom/client';
import { LoadingProvider } from '@/frontend/components/providers/loading-provider';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import { ForgotPassword } from '@/frontend/features/auth/forgot-password';
import { ResetPassword } from '@/frontend/features/auth/reset-password';
const q = new URLSearchParams(location.search);
// The wrapper of app/(auth)/layout.tsx (Firebase staging), inside the <main> the measurements use.
createRoot(document.getElementById('root')).render(<LanguageProvider initialLanguage={q.get('lang') === 'ar' ? 'ar' : 'en'}><ThemeProvider><LoadingProvider><main className="flex min-h-full items-center justify-center p-4 py-8 sm:p-8">{location.pathname === '/reset-password' ? <ResetPassword /> : <ForgotPassword />}</main></LoadingProvider></ThemeProvider></LanguageProvider>);`;
const stubs = {
  'firebase/auth': sdk, '@/frontend/lib/firebase': `export const getFirebaseAuth = () => ({});`,
  'next/navigation': `export const useRouter = () => ({ replace() {}, refresh() {} }); export const usePathname = () => location.pathname;`,
  'next/link': `import React from 'react'; export default function Link(p) { return <a {...p} />; }`,
};
const resolveAlias = p => { for (const c of [p + '.tsx', p + '.ts', path.join(p, 'index.tsx'), path.join(p, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return p; };

// The email, compiled from the real source.
function loadEmail() {
  const js = ts.transpileModule(fs.readFileSync('server/services/password-reset-email.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} }; new Function('module', 'exports', 'require', 'URL', js)(m, m.exports, () => ({}), URL); return m.exports;
}

(async () => {
  await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'browser', outfile: path.join(out, 'app.js'), jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'synthetic-transports', setup(b) {
      b.onResolve({ filter: /.*/ }, a => { if (stubs[a.path]) return { path: a.path, namespace: 'fixture' }; if (a.path.startsWith('@/')) return { path: resolveAlias(path.resolve(a.path.slice(2))) }; });
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: stubs[a.path], loader: 'tsx', resolveDir: process.cwd() }));
    } }] });
  // What the fictional request endpoint does: 'ok' (202 for every address, like the real one), 'limit' (429), 'down' (503), 'bad' (400), 'drop' (the connection fails).
  let mode = 'ok'; const posts = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(fs.readFileSync(path.join(out, 'app.js'))); }
    if (u.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
    if (u.pathname.startsWith('/_next/static/media/')) return res.end(fs.readFileSync(path.join(mediaDir, path.basename(u.pathname))));
    if (u.pathname === '/__mode') { mode = u.searchParams.get('m'); return res.end('ok'); }
    if (u.pathname === '/api/auth/firebase/password-reset' && req.method === 'POST') {
      const parts = []; req.on('data', v => parts.push(v));
      return req.on('end', () => {
        let body = null; try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch {}
        posts.push({ body, type: req.headers['content-type'], cache: req.headers['cache-control'] });
        if (mode === 'drop') return req.socket.destroy();
        const status = { ok: 202, limit: 429, down: 503, bad: 400 }[mode] ?? 500;
        res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(status === 202 ? { ok: true } : { error: 'x', retryAfterSeconds: 60 }));
      });
    }
    const lang = u.searchParams.get('lang') === 'ar' ? 'ar' : 'en', dark = u.searchParams.get('theme') === 'dark';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html data-lms-appearance data-design="new" lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" class="${dark ? 'dark' : ''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Password reset</title><link rel="stylesheet" href="/style.css"></head><body class="${fontVars} font-sans"><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port, errors = [], consoleLines = [], results = [];
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
  const open = async ({ viewport = { width: 1280, height: 900 }, lang = 'en', theme = 'light', look = 'new', target = '/forgot-password', chooseLanguage = true, init = null } = {}) => {
    const context = await browser.newContext({ viewport, locale: lang });
    await context.addInitScript(([l, t, c]) => { try { if (c) localStorage.setItem('edulabs-lms-language', l); localStorage.setItem('edulabs-lms-appearance', t); } catch {} }, [lang, theme, chooseLanguage]);
    if (init) await context.addInitScript(init);
    await context.route('**/*', r => r.request().url().startsWith(origin) ? r.continue() : r.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.message.slice(0, 300)); });
    page.on('console', m => { consoleLines.push(m.text()); if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(origin + target + (target.includes('?') ? '&' : '?') + 'lang=' + lang + '&theme=' + theme);
    await page.evaluate(l => { document.documentElement.dataset.design = l; }, look);
    return { page, context };
  };
  const only = process.env.LMS_ONLY_STEPS ? new RegExp(process.env.LMS_ONLY_STEPS) : null;
  const step = async (name, fn) => { if (only && !only.test(name)) return; try { await fn(); results.push(name); console.log('PASS ' + name); } catch (e) { console.log('FAIL ' + name); throw e; } };
  const setMode = async m => { mode = m; };
  const resetUrl = code => '/reset-password?oobCode=' + code;
  const heading = (page, name) => page.getByRole('heading', { name, exact: true });
  const send = async (page, email) => { await page.getByLabel('Email', { exact: true }).fill(email); await page.getByRole('button', { name: 'Send reset link', exact: true }).click(); };

  try {
    await step('forgot: a bad address is caught on the page, a good one is sent once and the page says the same thing for any address', async () => {
      posts.length = 0; await setMode('ok');
      const { page, context } = await open();
      await heading(page, 'Forgot your password?').waitFor();
      assert.equal(await page.locator('[data-auth-surface]').count(), 1);
      await send(page, 'not an email');
      await page.getByText('Enter a valid email address.').waitFor(); assert.equal(posts.length, 0, 'nothing is sent for a bad address');
      await send(page, '  Someone@Example.INVALID ');
      await heading(page, 'Check your email').waitFor();
      await page.getByText("If an account exists for this email, we've sent a link.").waitFor();
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0].body, { email: 'someone@example.invalid', language: 'en' }); assert.match(posts[0].type, /application\/json/);
      assert.equal(await page.getByText('someone@example.invalid').count(), 0, 'the sent state does not repeat the address');
      const resend = page.getByRole('button', { name: /^Send again in \d+s$/ }); await resend.waitFor(); assert.equal(await resend.isDisabled(), true);
      assert.equal(await page.getByRole('link', { name: 'Back to sign in', exact: true }).getAttribute('href'), '/sign-in');
      const sentText = await page.locator('[data-password-reset]').innerText();
      // An unknown address reads exactly the same.
      const second = await open(); await send(second.page, 'nobody-at-all@example.invalid'); await heading(second.page, 'Check your email').waitFor();
      assert.equal((await second.page.locator('[data-password-reset]').innerText()).replace(/\d+s/, 'Ns'), sentText.replace(/\d+s/, 'Ns'));
      await second.context.close(); await context.close();
    });
    await step('forgot: Send again waits for the countdown and sends the same request', async () => {
      posts.length = 0; await setMode('ok');
      const { page, context } = await open();
      await page.clock.install(); await send(page, 'again@example.invalid'); await heading(page, 'Check your email').waitFor();
      for (let i = 0; i < 62; i++) { await page.clock.runFor(1000); await page.waitForTimeout(15); }
      const resend = page.getByRole('button', { name: 'Send again', exact: true }); await resend.waitFor(); assert.equal(await resend.isEnabled(), true);
      await resend.click(); await page.waitForFunction(() => document.body.innerText.includes('Send again in'));
      assert.equal(posts.length, 2); assert.deepEqual(posts[1].body, posts[0].body);
      await context.close();
    });
    await step('forgot: no language is sent when the person never chose one, so the email carries both', async () => {
      posts.length = 0; await setMode('ok');
      const { page, context } = await open({ chooseLanguage: false });
      await send(page, 'nochoice@example.invalid'); await heading(page, 'Check your email').waitFor();
      assert.deepEqual(posts[0].body, { email: 'nochoice@example.invalid' });
      await context.close();
      const ar = await open({ lang: 'ar' });
      await ar.page.getByLabel('البريد الإلكتروني', { exact: true }).fill('arabic@example.invalid'); await ar.page.getByRole('button', { name: 'إرسال رابط إعادة التعيين', exact: true }).click();
      await heading(ar.page, 'تحقّق من بريدك الإلكتروني').waitFor();
      assert.deepEqual(posts[1].body, { email: 'arabic@example.invalid', language: 'ar' });
      await ar.context.close();
    });
    await step('forgot: too many asks, the service being off, a bad reply and a lost connection each say so and leave the form usable', async () => {
      const { page, context } = await open();
      for (const [m, text] of [['limit', 'Too many requests. Please wait a few minutes and try again.'], ['down', 'Password reset is not available right now. Please try again later.'], ['bad', 'Enter a valid email address.'], ['drop', "We couldn't send the request. Check your connection and try again."]]) {
        await setMode(m); await send(page, 'x@example.invalid');
        await page.getByText(text, { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Send reset link', exact: true }).isEnabled(), true, m);
      }
      await setMode('ok'); await send(page, 'x@example.invalid'); await heading(page, 'Check your email').waitFor();
      await context.close();
    });
    await step('reset: a good link shows the email it is for; the rule, the strength hint, show/hide and the match check', async () => {
      const { page, context } = await open({ target: resetUrl(CODE) });
      await heading(page, 'Choose a new password').waitFor();
      await page.getByText('For').first().waitFor(); await page.getByText(EMAIL).waitFor();
      assert.deepEqual(await page.evaluate(() => window.__calls.verify), [CODE]);
      const pw = page.getByLabel('New password', { exact: true }), again = page.getByLabel('Confirm new password', { exact: true });
      assert.equal(await page.locator('.d-strength').count(), 0);
      await pw.fill('short'); await page.getByText('Strength: too short').waitFor(); await page.getByText('(5/12)').waitFor();
      await pw.fill('aaaaaaaaaaaa'); await page.getByText('Strength: weak').waitFor();
      await pw.fill('kdhfjrutyeoq'); await page.getByText('Strength: okay').waitFor();
      await pw.fill('kdhfjrutyeoqpwmz'); await page.getByText('Strength: good').waitFor();
      await pw.fill('Kdhfjr7tyeo!pwmzx'); await page.getByText('Strength: strong').waitFor();
      await again.fill('different'); await page.getByText('The passwords do not match.').waitFor();
      await again.fill('Kdhfjr7tyeo!pwmzx'); await page.getByText('The passwords match.').waitFor();
      assert.equal(await pw.getAttribute('type'), 'password'); assert.equal(await again.getAttribute('type'), 'password');
      await page.getByRole('button', { name: 'Show passwords', exact: true }).click();
      assert.equal(await pw.getAttribute('type'), 'text'); assert.equal(await again.getAttribute('type'), 'text');
      assert.equal(await page.getByRole('button', { name: 'Hide passwords', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: 'Hide passwords', exact: true }).click(); assert.equal(await pw.getAttribute('type'), 'password');
      await context.close();
    });
    await step('reset: too short and mismatched passwords are refused on the page; a good pair is saved, the code leaves the address bar and Sign in is offered', async () => {
      const { page, context } = await open({ target: resetUrl(CODE) });
      await heading(page, 'Choose a new password').waitFor();
      const pw = page.getByLabel('New password', { exact: true }), again = page.getByLabel('Confirm new password', { exact: true }), save = page.getByRole('button', { name: 'Save new password', exact: true });
      await pw.fill('short'); await again.fill('short'); await save.click();
      await page.getByText('Use at least 12 characters.').waitFor();
      await pw.fill('a-long-enough-password'); await again.fill('a-long-enough-passwore'); await save.click();
      await page.getByText('The two passwords must match.').waitFor();
      assert.deepEqual(await page.evaluate(() => window.__calls.confirm), [], 'nothing reached Firebase');
      await again.fill('a-long-enough-password'); await save.click();
      await heading(page, 'Password changed').first().waitFor();
      assert.deepEqual(await page.evaluate(() => window.__calls.confirm), [{ code: CODE, length: 'a-long-enough-password'.length }]);
      assert.equal(await page.evaluate(() => location.search), '', 'the spent code is out of the address bar');
      assert.equal(await page.getByRole('link', { name: 'Sign in', exact: true }).getAttribute('href'), '/sign-in');
      assert.equal(await page.locator('input').count(), 0, 'no password stays in the page');
      await page.getByText('Your password has been changed.', { exact: false }).waitFor();
      await context.close();
    });
    await step('reset: an expired, used, disabled, missing or damaged link says so and offers a new link; a lost connection offers Try again', async () => {
      for (const [target, title, newLink] of [
        [resetUrl('EXPIRED_0123456789'), 'This link has expired', true], [resetUrl('USED_0123456789abc'), "This link can't be used", true], [resetUrl('DISABLED_0123456789'), "We can't reset this password", false],
        ['/reset-password', "This link can't be used", true], [resetUrl('x'), "This link can't be used", true], [resetUrl('has spaces in it'), "This link can't be used", true],
      ]) {
        const { page, context } = await open({ target });
        await heading(page, title).first().waitFor();
        assert.equal(await page.getByRole('link', { name: 'Send a new link', exact: true }).count(), newLink ? 1 : 0, target);
        if (newLink) assert.equal(await page.getByRole('link', { name: 'Send a new link', exact: true }).getAttribute('href'), '/forgot-password');
        assert.equal(await page.locator('input').count(), 0, 'nothing can be typed: ' + target);
        await context.close();
      }
      const off = await open({ target: resetUrl('OFFLINE_0123456789a'), init: () => { window.__forceOffline = true; } });
      const op = off.page;
      await heading(op, "We couldn't check your link").waitFor();
      await op.evaluate(() => { window.__forceOffline = false; });
      await op.getByRole('button', { name: 'Try again', exact: true }).click();
      await heading(op, 'Choose a new password').waitFor(); await op.getByText(EMAIL).waitFor();
      await off.context.close();
    });
    await step('reset: a weak-password answer and a lost connection on Save keep the form and say so; a code used in another tab ends the link', async () => {
      const { page, context } = await open({ target: resetUrl(CODE) });
      await heading(page, 'Choose a new password').waitFor();
      const pw = page.getByLabel('New password', { exact: true }), again = page.getByLabel('Confirm new password', { exact: true }), save = page.getByRole('button', { name: 'Save new password', exact: true });
      await pw.fill('a-long-enough-password'); await again.fill('a-long-enough-password');
      await page.evaluate(() => { window.__confirmFail = 'auth/weak-password'; }); await save.click();
      await page.getByText('Choose a stronger password, at least 12 characters.').waitFor();
      assert.equal(await pw.inputValue(), 'a-long-enough-password');
      await page.evaluate(() => { window.__confirmFail = 'auth/network-request-failed'; }); await save.click();
      await page.getByText('Check your connection and try again.').waitFor(); assert.equal(await save.isEnabled(), true);
      await page.evaluate(() => { window.__confirmFail = 'auth/invalid-action-code'; }); await save.click();
      await heading(page, "This link can't be used").first().waitFor();
      assert.equal(await page.locator('input').count(), 0);
      await context.close();
    });
    await step('nothing sensitive leaves the page: the code and the passwords never reach our server or the console', async () => {
      assert.ok(posts.length > 0);
      for (const p of posts) assert.deepEqual(Object.keys(p.body).sort().filter(k => !['email', 'language'].includes(k)), [], 'only an email and a language are ever posted');
      const joined = consoleLines.join('\n');
      for (const secret of [CODE, 'a-long-enough-password', 'Kdhfjr7tyeo', EMAIL, 'someone@example.invalid']) assert.ok(!joined.includes(secret), 'console shows ' + secret);
    });

    // ------------------------------------------------------------------------------------------------------------------------------------
    // The pictures: five screens, 390 and 1360, Classic and New, English and Arabic, each measured.
    // ------------------------------------------------------------------------------------------------------------------------------------
    const measure = () => {
      const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const targets = [...document.querySelectorAll('main a, main button, main input')].filter(visible).filter(el => getComputedStyle(el).display !== 'inline').map(el => { const b = el.getBoundingClientRect(); return { name: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30), w: Math.round(b.width), h: Math.round(b.height) }; }).filter(t => t.h < 43.5 || t.w < 43.5);
      const small = []; const walk = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT); let n;
      while ((n = walk.nextNode())) { const el = n.parentElement; if (n.textContent.trim() && visible(el) && parseFloat(getComputedStyle(el).fontSize) < 12) small.push(n.textContent.trim().slice(0, 30)); }
      const raw = document.body.innerText.match(/\bpr\.[a-z_.]+/g) || [];
      return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, targets, small, raw, dir: document.documentElement.dir, design: document.documentElement.dataset.design };
    };
    const screens = [
      { name: 'forgot', target: '/forgot-password', ready: async p => { await p.locator('[data-password-reset]').waitFor(); } },
      { name: 'sent', target: '/forgot-password', ready: async (p, lang) => { await setMode('ok'); await p.locator('input[type="email"]').fill('student@example.invalid'); await p.locator('button[type="submit"]').click(); await p.locator('[role="status"]').first().waitFor(); } },
      { name: 'reset', target: resetUrl(CODE), ready: async p => { await p.locator('input[autocomplete="new-password"]').first().waitFor(); const f = p.locator('input[autocomplete="new-password"]'); await f.nth(0).fill('kdhfjrutyeoqpwmz'); await f.nth(1).fill('kdhfjrutyeoqpwmz'); await p.locator('.d-strength').waitFor(); } },
      { name: 'success', target: resetUrl(CODE), ready: async p => { const f = p.locator('input[autocomplete="new-password"]'); await f.nth(0).waitFor(); await f.nth(0).fill('Kdhfjr7tyeo!pwmzx'); await f.nth(1).fill('Kdhfjr7tyeo!pwmzx'); await p.locator('button[type="submit"]').click(); await p.locator('[role="status"]').first().waitFor(); } },
      { name: 'expired', target: resetUrl('EXPIRED_0123456789'), ready: async p => { await p.locator('.d-auth-outcome').waitFor(); } },
    ];
    await step('pictures: every screen at 390 and 1360, Classic and New, English and Arabic, measured', async () => {
      const findings = [], listed = [];
      for (const screen of screens) for (const look of ['classic', 'new']) for (const lang of ['en', 'ar']) for (const width of [390, 1360]) {
        const tag = `${screen.name}-${look}-${lang}-${width}`;
        const { page, context } = await open({ viewport: { width, height: width === 390 ? 844 : 900 }, lang, look, target: screen.target });
        try {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await screen.ready(page, lang);
          await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
          const m = await page.evaluate(measure);
          if (m.design !== look) findings.push(`${tag}: not in ${look}`);
          if (lang === 'ar' && m.dir !== 'rtl') findings.push(`${tag}: not right-to-left`);
          if (m.overflow) findings.push(`${tag}: sideways scroll`);
          for (const t of m.targets) findings.push(`${tag}: target ${t.name} ${t.w}x${t.h}`);
          for (const t of m.small) findings.push(`${tag}: text under 12px: ${t}`);
          for (const t of m.raw) findings.push(`${tag}: raw key ${t}`);
          const file = path.join(shotsDir, tag + '.png'); await page.screenshot({ path: file, fullPage: true }); listed.push(tag + '.png');
        } catch (e) { findings.push(`${tag}: could not be drawn: ${String(e.message).split('\n')[0].slice(0, 160)}`); }
        finally { await context.close(); }
      }
      for (const f of findings) console.log('FINDING', f);
      assert.deepEqual(findings, []); assert.equal(listed.length, 40);
    });
    await step('pictures: the email itself, rendered, English, Arabic and both, 390 and 1360, light and dark', async () => {
      const { passwordResetEmailContent } = loadEmail();
      const link = 'https://app.example.test/reset-password?oobCode=EXAMPLE_CODE_0123456789';
      const shots = [];
      for (const [name, language] of [['en', 'en'], ['ar', 'ar'], ['both', undefined]]) for (const scheme of ['light', 'dark']) for (const width of [390, 1360]) {
        if (name === 'both' && scheme === 'dark') continue;
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
        await context.route('**/*', r => r.request().url() === 'https://app.example.test/email/edulabs-mark.png' ? r.fulfill({ contentType: 'image/png', body: logoPng }) : r.request().url().startsWith('data:') ? r.continue() : r.abort());
        const page = await context.newPage(); const { html } = passwordResetEmailContent({ link, language });
        await page.setContent(html, { waitUntil: 'load' });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        assert.equal(overflow, false, `email ${name} ${scheme} ${width}: sideways scroll`);
        assert.equal(await page.evaluate(() => [...document.images].every(i => i.complete && i.naturalWidth > 0)), true, 'the logo loads');
        const file = `email-${name}-${scheme}-${width}.png`; await page.screenshot({ path: path.join(shotsDir, file), fullPage: true }); shots.push(file); await context.close();
      }
      assert.equal(shots.length, 10);
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
  console.log(results.length + ' steps passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
