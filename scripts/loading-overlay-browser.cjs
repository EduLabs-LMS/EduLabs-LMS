// Skeletons instead of the overlay, the first-load overlay, and stale-while-revalidate per user, in Chromium.
//
// Real: LoadingProvider + LoadingOverlay (the EduLabs logo overlay), first-load.ts, swr-cache.ts, use-swr.ts and the Skeleton components.
// Stand-in: only next/navigation, as a soft-navigation model of Next's App Router with a loading.tsx on every route: the app frame (sidebar) is a layout and
// stays mounted, the route's skeleton is put in the content area at once, and the page replaces it (and the address changes) when the "server" answers.
// The same contract was measured against a real Next production build: see docs/ai/TESTING.md ("Speed").
//
// Run: LMS_ESBUILD_RUNTIME=<node_modules with esbuild> LMS_BROWSER_RUNTIME=<node_modules with playwright> [LMS_CHROMIUM_EXECUTABLE=...] node scripts/loading-overlay-browser.cjs
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('node:assert/strict');
const esbuild = require(path.join(process.env.LMS_ESBUILD_RUNTIME, 'esbuild')), { chromium } = require(path.join(process.env.LMS_BROWSER_RUNTIME, 'playwright'));
const out = path.resolve('.local/loading-overlay-browser'); fs.mkdirSync(out, { recursive: true });
const { firstOpenScript, FIRST_OPEN_KEY } = require('./localization-test-loader.cjs').load('frontend/lib/first-load.ts');

const nav = `
import { useSyncExternalStore } from 'react';
const subs = new Set(); const emit = () => subs.forEach(f => f());
const sub = f => { subs.add(f); return () => subs.delete(f); };
let key = location.pathname + location.search;
let pending = null;
window.addEventListener('popstate', () => { key = location.pathname + location.search; pending = null; emit(); });
export const usePathname = () => useSyncExternalStore(sub, () => key.split('?')[0], () => '/');
export const usePending = () => useSyncExternalStore(sub, () => pending, () => null);
let cache = null, cacheKey = null;
export const useSearchParams = () => useSyncExternalStore(sub, () => { if (cacheKey !== key) { cacheKey = key; cache = new URLSearchParams(key.split('?')[1] || ''); } return cache; }, () => new URLSearchParams());
const delayOf = h => Number(new URLSearchParams(h.split('?')[1] || '').get('ms') || 0);
export const softNavigate = (href, replace) => {
  // The route's loading.tsx shows at once; the page (and the new address) arrive when the server has answered.
  pending = href.split('?')[0]; emit();
  setTimeout(() => { history[replace ? 'replaceState' : 'pushState'](null, '', href); key = location.pathname + location.search; pending = null; emit(); }, delayOf(href));
};
export const useRouter = () => ({ push: h => softNavigate(h, false), replace: h => softNavigate(h, true), refresh() {}, back() { history.back(); }, prefetch() {} });
`;

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LoadingProvider, useGlobalLoading } from '@/frontend/components/providers/loading-provider';
import FirstOpenCurtain from '@/frontend/components/first-open-curtain';
import { useLoadingRouter } from '@/frontend/components/providers/use-loading-router';
import { softNavigate, usePathname, usePending } from 'next/navigation';
import { PageSkeleton, Skeleton } from '@/frontend/components/skeleton';
import { clearSwr, setSwrOwner, swrSize } from '@/frontend/lib/swr-cache';
import { useSwr } from '@/frontend/lib/use-swr';

function Link({ href, id, children }) {
  return <a id={id} href={href} onClick={e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); softNavigate(href, false); }}>{children}</a>;
}

// A teacher page whose data is read in the browser with stale-while-revalidate.
class Refusal extends Error { constructor(status) { super('refused'); this.status = status; } }
const readData = signal => fetch('/data?who=' + (window.__who || 'nobody') + '&d=' + (window.__delay || 0) + '&mode=' + (window.__mode || 'ok'), { signal })
  .then(r => r.ok ? r.json() : Promise.reject(new Refusal(r.status)));
function DataPage() {
  const { data, retry } = useSwr('data:page', readData, e => e);
  return <section data-page="data">
    {data.state === 'loading' && <div id="data-skeleton" data-skeleton="data"><Skeleton className="h-6 w-40" /></div>}
    {data.state === 'ready' && <p id="data" data-refreshing={data.refreshing ? '1' : '0'}>{data.value.name}</p>}
    {data.state === 'error' && <p id="err" role="alert">Could not load ({String(data.error && data.error.status)})</p>}
    <button id="retry" onClick={retry}>retry</button>
  </section>;
}

function Page({ path }) {
  if (path === '/teacher/data') return <DataPage />;
  return <p id="page" data-page={path}>page {path}</p>;
}

function App() {
  const router = useLoadingRouter(); const path = usePathname(); const pending = usePending();
  const { beginFirstLoad, startLoading, stopLoading } = useGlobalLoading();
  const [, force] = React.useReducer(v => v + 1, 0);
  return <div>
    <aside id="frame" data-frame>
      <nav>
        <Link id="slow" href="/teacher/groups?ms=700">Groups</Link>
        <Link id="fast" href="/teacher/fast?ms=10">Fast</Link>
        <Link id="data-link" href="/teacher/data?ms=10">Data</Link>
        <Link id="home" href="/teacher/home?ms=10">Home</Link>
        <button id="push" onClick={() => router.push('/teacher/students?ms=700')}>push</button>
      </nav>
      <button id="signin" onClick={() => { beginFirstLoad(); router.replace('/teacher/home?ms=' + (window.__signinMs ?? 300)); }}>sign in</button>
      <button id="signin-remount" onClick={async () => {
        // What the real sign-in does: the handler holds the loading provider it was rendered under, then signing in changes the user, the app tree is
        // keyed on the user (FirebaseBridge) and everything, the provider included, is mounted again before the handler reaches goHome(true).
        const stale = beginFirstLoad; window.__setUid('uid-new');
        await new Promise(r => setTimeout(r, 60)); stale(); softNavigate('/teacher/home?ms=' + (window.__signinMs ?? 300), true);
      }}>sign in (user changes)</button>
      <button id="save" onClick={() => startLoading('Saving')}>save</button>
      <button id="saved" onClick={() => stopLoading()}>saved</button>
      <button id="login-a" onClick={() => { window.__who = 'a'; setSwrOwner('uid-a'); }}>a</button>
      <button id="login-b" onClick={() => { window.__who = 'b'; setSwrOwner('uid-b'); }}>b</button>
      <button id="logout" onClick={() => { clearSwr(); window.__who = null; force(); }}>logout</button>
    </aside>
    <main id="content">{pending ? <PageSkeleton name={pending} label="Loading" /> : <Page path={path} />}</main>
  </div>;
}
window.__swrSize = swrSize;
function Root() {
  const [uid, setUid] = React.useState('signed-out'); window.__setUid = setUid;
  return <React.Fragment key={uid}><LoadingProvider><App /></LoadingProvider></React.Fragment>;
}
// As in the root layout: the curtain is outside the part of the tree that is keyed on the user.
createRoot(document.getElementById('root')).render(<><Root /><FirstOpenCurtain /></>);
`;

const plugin = {
  name: 'overlay-harness', setup(b) {
    b.onResolve({ filter: /.*/ }, a => {
      if (a.path.endsWith('.css')) return { path: 'empty', namespace: 'empty' };
      if (a.path === 'next/navigation') return { path: a.path, namespace: 'nav' };
      if (a.path.startsWith('@/')) { const base = path.resolve(a.path.slice(2)); for (const e of ['.tsx', '.ts', '/index.tsx', '/index.ts']) if (fs.existsSync(base + e)) return { path: base + e }; }
    });
    b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '' }));
    b.onLoad({ filter: /.*/, namespace: 'nav' }, () => ({ contents: nav, loader: 'js', resolveDir: process.cwd() }));
  }
};

(async () => {
  await esbuild.build({ bundle: true, jsx: 'automatic', plugins: [plugin], logLevel: 'warning', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' }, stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, outfile: path.join(out, 'client.js') });
  // The real head script, as the root layout writes it.
  const html = '<!doctype html><meta charset=utf-8><script>' + firstOpenScript + '</script><link rel=stylesheet href=/style.css><body><div id=root></div><script src=/client.js></script>';
  const css = require('./harness-css.cjs')();
  const server = http.createServer((req, res) => {
    if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
    if (req.url === '/client.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(fs.readFileSync(path.join(out, 'client.js'))); }
    if (req.url.startsWith('/data')) {
      const q = new URL(req.url, 'http://x').searchParams;
      const status = q.get('mode') === '403' ? 403 : q.get('mode') === '500' ? 500 : 200;
      return setTimeout(() => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ name: 'data for ' + q.get('who') })); }, Number(q.get('d') || 0));
    }
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
  const errors = [];
  const OVERLAY = '[role="status"][aria-label]';
  const ok = (name, fn) => fn().then(() => console.log('PASS ' + name));

  // Samples every 10 ms from the moment it is installed: is the overlay up, is a skeleton up, which page is showing, is the frame the same node.
  const SAMPLER = () => {
    window.__frameNode = document.getElementById('frame'); 
    window.__log = []; const t0 = performance.now();
    window.__iv = setInterval(() => window.__log.push({ t: Math.round(performance.now() - t0), overlay: !!document.querySelector('[role="status"][aria-label]'), skeleton: !!document.querySelector('[data-skeleton]'),
      page: (document.querySelector('[data-page]') || {}).dataset ? document.querySelector('[data-page]').dataset.page : null, sameFrame: document.getElementById('frame') === window.__frameNode }), 10);
  };
  /** fresh: a brand new tab. Otherwise the tab has been opened before, so only the sign-in overlay is under test. */
  async function open(url, { reduced = false, sessionFlag = false, fresh = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    if (!fresh) await page.addInitScript(key => sessionStorage.setItem(key, '1'), FIRST_OPEN_KEY);
    if (sessionFlag) await page.addInitScript(() => { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('edulabs-first-load', 'pending'); sessionStorage.setItem('__seeded', '1'); } });
    await page.goto(origin + url); await page.locator('#frame').waitFor();
    return { ctx, page };
  }
  const summary = (log) => {
    const on = log.filter(r => r.overlay), edges = log.filter((r, i) => r.overlay && (i === 0 || !log[i - 1].overlay));
    return { overlayShown: on.length > 0, runs: edges.length, from: on[0] && on[0].t, until: on.length ? on[on.length - 1].t : undefined, firstSkeleton: (log.find(r => r.skeleton) || {}).t, lastSkeleton: log.filter(r => r.skeleton).pop()?.t,
      frameAlways: log.every(r => r.sameFrame), finalPage: log[log.length - 1].page };
  };
  async function action(url, act, { wait = 2200, reduced = false, sessionFlag = false } = {}) {
    const { ctx, page } = await open(url, { reduced, sessionFlag });
    await page.waitForTimeout(sessionFlag ? 0 : 300);
    await page.evaluate(SAMPLER); const t0 = Date.now();
    if (act) await act(page);
    await page.waitForTimeout(wait);
    const log = await page.evaluate(() => { clearInterval(window.__iv); return window.__log; });
    await ctx.close();
    return { ...summary(log), log, t0 };
  }

  // ---- in-app navigation: frame stays, skeleton in the content area, never the overlay ----
  await ok('a slow in-app link keeps the frame, shows the page skeleton within 100 ms, and never shows the logo overlay', async () => {
    const r = await action('/teacher/home', p => p.click('#slow'), { wait: 1500 });
    assert.equal(r.overlayShown, false, 'no overlay for in-app navigation');
    assert.ok(r.firstSkeleton !== undefined && r.firstSkeleton <= 100 + 30, 'skeleton within ~100 ms of the click: ' + r.firstSkeleton);
    assert.ok(r.lastSkeleton >= 600, 'skeleton stays until the page arrives: ' + r.lastSkeleton);
    assert.equal(r.frameAlways, true, 'the app frame (sidebar) is the same node throughout: it never remounts');
    assert.equal(r.finalPage, '/teacher/groups'); assert.equal(r.log[r.log.length - 1].skeleton, false, 'and the skeleton is gone');
  });
  await ok('router.push behaves the same', async () => {
    const r = await action('/teacher/home', p => p.click('#push'), { wait: 1500 });
    assert.equal(r.overlayShown, false); assert.ok(r.firstSkeleton <= 130, String(r.firstSkeleton)); assert.equal(r.frameAlways, true); assert.equal(r.finalPage, '/teacher/students');
  });
  await ok('a fast in-app navigation never shows the overlay', async () => {
    const r = await action('/teacher/home', p => p.click('#fast'), { wait: 800 });
    assert.equal(r.overlayShown, false); assert.equal(r.finalPage, '/teacher/fast');
  });
  await ok('twenty navigations in a row never bring the overlay back', async () => {
    const { ctx, page } = await open('/teacher/home'); await page.waitForTimeout(300); await page.evaluate(SAMPLER);
    for (let i = 0; i < 20; i++) { await page.click(i % 2 ? '#fast' : '#home'); await page.waitForTimeout(60); }
    await page.waitForTimeout(500);
    const log = await page.evaluate(() => { clearInterval(window.__iv); return window.__log; }); await ctx.close();
    assert.equal(summary(log).overlayShown, false); assert.equal(summary(log).frameAlways, true);
  });
  await ok('in a tab that has been opened, loading a page again or restoring a session (no sign-in) shows no overlay', async () => {
    const r = await action('/teacher/home', null, { wait: 800 }); assert.equal(r.overlayShown, false);
  });

  // ---- a fresh opening: the first full page load in a browser tab, on any route ----
  const CURTAIN = '[data-first-open-curtain]';
  // Every 10 ms from the first moment of the document: is the curtain on screen, and did it stay one and the same element.
  const CURTAIN_SAMPLER = () => {
    window.__c = []; const t0 = performance.now(); let node = null; window.__nodes = 0;
    const sample = () => { const e = document.querySelector('[data-first-open-curtain]'); if (e && e !== node) { node = e; window.__nodes++; }
      const s = e && getComputedStyle(e); window.__c.push({ t: Math.round(performance.now() - t0), on: !!s && s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0, attr: document.documentElement.getAttribute('data-first-open') }); };
    window.__ci = setInterval(sample, 10);
  };
  const seen = log => { const on = log.filter(r => r.on); return { shown: on.length > 0, for: on.length ? on[on.length - 1].t - on[0].t : 0, last: log[log.length - 1] }; };
  for (const route of ['/', '/sign-in', '/sign-up', '/join/abc', '/home', '/teacher/home', '/teacher/groups', '/notifications', '/settings', '/public-page']) {
    await ok('a fresh opening plays the logo to its end on ' + route, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(CURTAIN_SAMPLER);
      await page.goto(origin + route); await page.locator('#frame').waitFor({ state: 'attached' });
      assert.equal(await page.evaluate(() => { const e = document.querySelector('[data-first-open-curtain] [data-first-load-logo]'); return !!e && e.getAnimations({ subtree: true }).length > 0; }), true, 'the logo is animating, over the page');
      assert.equal(await page.locator(OVERLAY).count(), 0, 'it is the curtain, not the action overlay');
      await page.waitForFunction(() => !document.querySelector('[data-first-open-curtain]'), null, { timeout: 4000 });
      const log = await page.evaluate(() => window.__c); const r = seen(log);
      assert.equal(r.shown, true); assert.ok(r.for >= 1300, 'the whole animation: ' + r.for); assert.ok(r.for < 3400, 'and then it goes: ' + r.for);
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-first-open')), false, 'nothing is left behind');
      const stored = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)));
      assert.equal(stored, JSON.stringify([[FIRST_OPEN_KEY, '1']]), 'one word in session storage, no personal data');
      await ctx.close();
    });
  }
  await ok('a fresh opening: once per tab. Not on a reload, not on in-app navigation; a new tab plays it again', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage();
    await page.addInitScript(CURTAIN_SAMPLER);
    await page.goto(origin + '/teacher/home'); await page.waitForFunction(() => !document.querySelector('[data-first-open-curtain]'), null, { timeout: 4000 });
    await page.click('#slow'); await page.waitForTimeout(900);
    assert.equal(seen(await page.evaluate(() => window.__c)).last.attr, null, 'in-app navigation');
    assert.equal(await page.locator(CURTAIN).count(), 0, 'in-app navigation');
    await page.reload(); await page.locator('#frame').waitFor(); await page.waitForTimeout(400);
    assert.equal(seen(await page.evaluate(() => window.__c)).shown, false, 'the reload never shows it, not even for a moment');
    await page.goto(origin + '/teacher/groups'); await page.locator('#frame').waitFor(); await page.waitForTimeout(300);
    assert.equal(seen(await page.evaluate(() => window.__c)).shown, false, 'nor a full page load to another address in the same tab');
    const other = await ctx.newPage(); await other.addInitScript(CURTAIN_SAMPLER);
    await other.goto(origin + '/teacher/groups'); await other.waitForFunction(() => !document.querySelector('[data-first-open-curtain]'), null, { timeout: 4000 });
    assert.ok(seen(await other.evaluate(() => window.__c)).for >= 1300, 'another tab is a fresh opening');
    await ctx.close();
  });
  await ok('a fresh opening: the logo stays one element while the user change mounts the app tree again, so it never restarts', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage();
    await page.addInitScript(CURTAIN_SAMPLER);
    await page.goto(origin + '/teacher/home'); await page.locator('#frame').waitFor({ state: 'attached' });
    await page.evaluate(() => window.__setUid('uid-restored')); await page.waitForTimeout(100);
    await page.waitForFunction(() => !document.querySelector('[data-first-open-curtain]'), null, { timeout: 4000 });
    assert.equal(await page.evaluate(() => window.__nodes), 1);
    await ctx.close();
  });
  await ok('a fresh opening with reduced motion: the still logo, nothing moving, for a moment', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }), page = await ctx.newPage();
    await page.addInitScript(CURTAIN_SAMPLER);
    await page.goto(origin + '/sign-in'); await page.locator('#frame').waitFor({ state: 'attached' });
    assert.equal(await page.evaluate(() => { const e = document.querySelector('[data-first-load-logo]'); return e.getAnimations({ subtree: true }).length; }), 0, 'nothing moves');
    await page.locator('[data-first-load-logo] svg').waitFor();
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.first-load-letter')).opacity), '1', 'the word is there from the start');
    await page.waitForFunction(() => !document.querySelector('[data-first-open-curtain]'), null, { timeout: 2000 });
    const r = seen(await page.evaluate(() => window.__c)); assert.ok(r.for >= 400 && r.for < 1200, 'a moment: ' + r.for);
    await ctx.close();
  });
  await ok('a fresh opening cannot block: no storage means no logo; the page underneath is there all along', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage();
    await page.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('blocked'); } }));
    await page.goto(origin + '/teacher/home'); await page.locator('#frame').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-first-open')), false); assert.equal(await page.locator(CURTAIN).count(), 0);
    await ctx.close();
    const quota = await browser.newContext({ viewport: { width: 1280, height: 800 } }), second = await quota.newPage();
    await second.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
    await second.goto(origin + '/teacher/home'); await second.locator('#frame').waitFor();
    assert.equal(await second.evaluate(() => document.documentElement.hasAttribute('data-first-open')), false, 'a flag that cannot be written would replay on every load: skipped instead');
    await quota.close();
  });
  await ok('a fresh opening whose JavaScript never arrives: the stylesheet lifts the logo by itself', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage();
    await page.route('**/client.js', r => r.abort());
    await page.goto(origin + '/teacher/home');
    // The harness renders on the client, so with no client the markup the server sends in the real app is written here, to the real stylesheet and the real head script.
    await page.evaluate(() => { const e = document.createElement('div'); e.setAttribute('data-first-open-curtain', ''); e.textContent = 'logo'; document.body.append(e); });
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-first-open')), '1');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-first-open-curtain]')).visibility), 'visible');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-first-open-curtain]')).visibility === 'hidden', null, { timeout: 7500 });
    await ctx.close();
  });
  await ok('a fresh opening, then signing in: the sign-in overlay still plays once', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage();
    await page.goto(origin + '/sign-in'); await page.waitForFunction(() => !document.querySelector('[data-first-open-curtain]'), null, { timeout: 4000 });
    await page.click('#signin'); await page.locator(OVERLAY).waitFor({ timeout: 300 });
    await page.waitForFunction(selector => !document.querySelector(selector), OVERLAY, { timeout: 3200 });
    assert.equal(await page.locator(CURTAIN).count(), 0, 'and the curtain did not come back');
    await ctx.close();
  });

  // ---- first load after sign-in ----
  await ok('sign-in plays the logo animation once and to its end, on an opaque screen with no loading text, over a page that is ready', async () => {
    const { ctx, page } = await open('/sign-in'); await page.waitForTimeout(300);
    await page.evaluate(SAMPLER);
    // At the moment the overlay goes away, every animation inside the logo has to have finished.
    await page.evaluate(() => { window.__atEnd = null; const iv = setInterval(() => { const logo = document.querySelector('[data-first-load-logo]'); if (!logo) { if (window.__seen) clearInterval(iv); return; } window.__seen = true; const all = logo.getAnimations({ subtree: true }); window.__atEnd = { count: all.length, running: all.filter(a => a.playState === 'running').length, word: logo.querySelector('.first-load-letter:last-child') ? getComputedStyle(logo.querySelector('.first-load-letter:last-child')).opacity : null, bg: getComputedStyle(logo.parentElement).backgroundColor, text: logo.parentElement.innerText, blocks: getComputedStyle(logo.parentElement).pointerEvents }; }, 20); });
    await page.click('#signin'); await page.waitForTimeout(3200);
    const log = await page.evaluate(() => { clearInterval(window.__iv); return window.__log; }); const end = await page.evaluate(() => window.__atEnd); await ctx.close();
    const r = summary(log);
    assert.equal(r.overlayShown, true); assert.equal(r.runs, 1, 'one run');
    assert.ok(r.from <= 100, 'appears at once, no delay: ' + r.from);
    assert.ok(r.until - r.from >= 1300, 'the whole animation plays, about 1.4 s and more: ' + (r.until - r.from)); assert.ok(r.until < 2600, 'and then it goes: ' + r.until);
    assert.equal(end.running, 0, 'nothing was still running when it went'); assert.equal(end.word, '1', 'the last letter of the word has landed');
    assert.doesNotMatch(end.text, /Loading/, 'no loading text'); assert.match(end.bg, /^rgb\(/, 'opaque: ' + end.bg); assert.equal(end.blocks, 'auto', 'taps do not reach the page underneath');
    assert.equal(r.finalPage, '/teacher/home');
  });
  await ok('sign-in plays it even though the user change mounts the whole app tree (and the loading provider) again mid-handler', async () => {
    const r = await action('/sign-in', p => p.click('#signin-remount'), { wait: 3000 });
    assert.equal(r.overlayShown, true, 'overlay shown after a sign-in that remounts the tree'); assert.equal(r.runs, 1, 'one run');
    assert.ok(r.until - r.from >= 1300 && r.until < 2800, 'plays, then lifts: ' + r.from + '..' + r.until);
    assert.equal(r.finalPage, '/teacher/home');
  });
  await ok('after the animation the logo waits for the first page to arrive, so the sign-in form never shows again', async () => {
    const r = await action('/sign-in', async p => { await p.evaluate(() => { window.__signinMs = 2600; }); await p.click('#signin'); }, { wait: 3400 });
    assert.equal(r.overlayShown, true); assert.ok(r.until >= 2500 && r.until < 3200, 'it stays until the address changed: ' + r.until);
    assert.equal(r.finalPage, '/teacher/home');
  });
  await ok('a page that takes very long does not hold the logo past the cap: the frame and a skeleton take over', async () => {
    const r = await action('/sign-in', async p => { await p.evaluate(() => { window.__signinMs = 9000; }); await p.click('#signin'); }, { wait: 7400 });
    assert.equal(r.overlayShown, true); assert.ok(r.until < 7200, 'gone although the page is still on its way: ' + r.until); assert.equal(r.log[r.log.length - 1].overlay, false);
    assert.ok(r.log.some(x => x.t > r.until && x.skeleton), 'the skeleton is what is left while the page is on its way');
  });
  await ok('after the first load the overlay never replays: not on navigation, not after a reload in the same tab', async () => {
    const { ctx, page } = await open('/teacher/login'); await page.waitForTimeout(300);
    await page.click('#signin'); await page.waitForTimeout(2800);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('edulabs-first-load')), null, 'the mark is cleared once played');
    await page.evaluate(SAMPLER); await page.click('#slow'); await page.waitForTimeout(1200);
    await page.reload(); await page.locator('#frame').waitFor(); await page.evaluate(SAMPLER); await page.waitForTimeout(900);
    const log = await page.evaluate(() => { clearInterval(window.__iv); return window.__log; }); await ctx.close();
    assert.equal(summary(log).overlayShown, false);
  });
  await ok('a full page load in the middle of signing in (the Google redirect) still plays it once', async () => {
    const { ctx, page } = await open('/teacher/home', { sessionFlag: true });
    const first = [];
    const t0 = Date.now(); while (Date.now() - t0 < 2800) { first.push(await page.locator(OVERLAY).count()); await page.waitForTimeout(20); }
    assert.ok(first.some(n => n > 0), 'overlay shown after the redirect load'); assert.equal(first[first.length - 1], 0, 'and gone after playing');
    await page.reload(); await page.locator('#frame').waitFor(); await page.waitForTimeout(100);
    assert.equal(await page.locator(OVERLAY).count(), 0, 'a later reload does not replay it'); await ctx.close();
  });
  await ok('with reduced motion the still logo shows for a moment and finishes', async () => {
    const r = await action('/teacher/login', p => p.click('#signin'), { wait: 1800, reduced: true });
    assert.equal(r.overlayShown, true); assert.ok(r.until >= 500 && r.until < 1300, String(r.until)); assert.equal(r.log[r.log.length - 1].overlay, false);
  });
  await ok('a blocking action (save) still shows the overlay after the short delay and lets go when it ends', async () => {
    const r = await action('/teacher/home', async p => { await p.click('#save'); await p.waitForTimeout(900); await p.evaluate(() => document.getElementById('saved').click()); }, { wait: 1800 });
    assert.equal(r.overlayShown, true); assert.ok(r.from >= 100 && r.from <= 300, 'after the 120 ms delay: ' + r.from); assert.equal(r.log[r.log.length - 1].overlay, false);
  });
  await ok('a quick blocking action never flashes it', async () => {
    const r = await action('/teacher/home', async p => { await p.click('#save'); await p.waitForTimeout(40); await p.evaluate(() => document.getElementById('saved').click()); }, { wait: 800 });
    assert.equal(r.overlayShown, false);
  });

  // ---- stale-while-revalidate, per user ----
  const textOf = (page, sel) => page.locator(sel).first().textContent();
  async function swrPage() {
    const { ctx, page } = await open('/teacher/home');
    await page.evaluate(() => { window.__delay = 250; }); return { ctx, page };
  }
  await ok('swr: a revisit shows the last data at once (no skeleton) and refreshes it in the background', async () => {
    const { ctx, page } = await swrPage();
    await page.click('#login-a'); await page.click('#data-link'); await page.locator('#data').waitFor();
    assert.equal(await textOf(page, '#data'), 'data for a');
    await page.click('#home'); await page.locator('[data-page="/teacher/home"]').waitFor();
    await page.evaluate(() => { window.__delay = 800; window.__who = 'a'; });
    await page.click('#data-link');
    await page.locator('#data').waitFor({ timeout: 300 });
    assert.equal(await page.locator('#data-skeleton').count(), 0, 'no skeleton on the revisit');
    assert.equal(await page.locator('#data').getAttribute('data-refreshing'), '1', 'refreshing in the background');
    await page.waitForFunction(() => document.querySelector('#data')?.dataset.refreshing === '0', null, { timeout: 3000 });
    await ctx.close();
  });
  await ok('swr: another user never sees the first user\'s copy, and signing out empties it', async () => {
    const { ctx, page } = await swrPage();
    await page.click('#login-a'); await page.click('#data-link'); await page.locator('#data').waitFor();
    assert.equal(String(await page.evaluate(() => window.__swrSize())), '1');
    await page.click('#logout');
    // the mounted screen lets go of the previous user's data at once
    await page.waitForFunction(() => !document.querySelector('#data') || document.querySelector('#data').textContent !== 'data for a', null, { timeout: 500 });
    await page.evaluate(() => { window.__delay = 600; });
    await page.click('#login-b');
    const seen = await page.evaluate(() => new Promise(resolve => { const texts = []; const iv = setInterval(() => { const el = document.querySelector('#data'); if (el) texts.push(el.textContent); }, 10); setTimeout(() => { clearInterval(iv); resolve(texts); }, 1500); }));
    assert.ok(seen.length > 0 && seen.every(t => t === 'data for b'), 'user b only ever sees b\'s data: ' + JSON.stringify([...new Set(seen)]));
    await ctx.close();
  });
  await ok('swr: after sign-out and a different sign-in the old data is gone from memory (cache size) and nothing was written to storage', async () => {
    const { ctx, page } = await swrPage();
    await page.click('#login-a'); await page.click('#data-link'); await page.locator('#data').waitFor();
    const stored = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie]));
    assert.doesNotMatch(stored, /data for a|uid-a/, 'no copy and no user id in browser storage');
    await page.click('#logout'); assert.equal(String(await page.evaluate(() => window.__swrSize())), '0');
    await ctx.close();
  });
  await ok('swr: a refusal on the refresh removes the copy and shows the refusal; an outage keeps the copy', async () => {
    const { ctx, page } = await swrPage();
    await page.click('#login-a'); await page.click('#data-link'); await page.locator('#data').waitFor();
    await page.click('#home'); await page.evaluate(() => { window.__mode = '500'; window.__delay = 100; });
    await page.click('#data-link'); await page.waitForTimeout(600);
    assert.equal(await textOf(page, '#data'), 'data for a', 'an outage keeps what was shown'); assert.equal(await page.locator('#err').count(), 0);
    await page.click('#home'); await page.evaluate(() => { window.__mode = '403'; });
    await page.click('#data-link'); await page.locator('#err').waitFor({ timeout: 2000 });
    assert.match(await textOf(page, '#err'), /403/); assert.equal(await page.locator('#data').count(), 0, 'the copy is not shown any more');
    await page.click('#home'); await page.evaluate(() => { window.__mode = 'ok'; window.__delay = 400; });
    await page.click('#data-link'); await page.waitForTimeout(80);
    assert.equal(await page.locator('#data').count(), 0, 'and it stays gone: the next visit starts from a skeleton'); assert.equal(await page.locator('#data-skeleton').count(), 1);
    await ctx.close();
  });
  await ok('swr: a first read that fails is an error, never an empty page', async () => {
    const { ctx, page } = await swrPage();
    await page.click('#login-a'); await page.evaluate(() => { window.__mode = '500'; });
    await page.click('#data-link'); await page.locator('#err').waitFor({ timeout: 2000 }); assert.equal(await page.locator('#data').count(), 0); await ctx.close();
  });
  await ok('swr: with nobody signed in nothing is kept', async () => {
    const { ctx, page } = await swrPage();
    await page.click('#data-link'); await page.locator('#data').waitFor(); assert.equal(String(await page.evaluate(() => window.__swrSize())), '0'); await ctx.close();
  });

  assert.deepEqual(errors, []);
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
