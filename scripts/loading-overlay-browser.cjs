// Real LoadingProvider + LoadingOverlay + useLoadingRouter in Chromium. Only next/navigation is replaced by a small
// soft-navigation stand-in (Next's Link prevents the click, then the URL changes after the "server" delay).
// The same behaviours were also checked against a real Next production build while fixing this.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('node:assert/strict');
const esbuild = require(path.join(process.env.LMS_ESBUILD_RUNTIME, 'esbuild')), { chromium } = require(path.join(process.env.LMS_BROWSER_RUNTIME, 'playwright'));
const out = path.resolve('.local/loading-overlay-browser'); fs.mkdirSync(out, { recursive: true });

const nav = `
import { useSyncExternalStore } from 'react';
const subs = new Set(); const emit = () => subs.forEach(f => f());
const sub = f => { subs.add(f); return () => subs.delete(f); };
let key = location.pathname + location.search;
window.addEventListener('popstate', () => { key = location.pathname + location.search; emit(); });
export const usePathname = () => useSyncExternalStore(sub, () => key.split('?')[0], () => '/');
let cache = null, cacheKey = null;
export const useSearchParams = () => useSyncExternalStore(sub, () => { if (cacheKey !== key) { cacheKey = key; cache = new URLSearchParams(key.split('?')[1] || ''); } return cache; }, () => new URLSearchParams());
const delayOf = h => Number(new URLSearchParams(h.split('?')[1] || '').get('ms') || 0);
export const softNavigate = (href, replace) => setTimeout(() => { history[replace ? 'replaceState' : 'pushState'](null, '', href); key = location.pathname + location.search; emit(); }, delayOf(href));
export const useRouter = () => ({ push: h => softNavigate(h, false), replace: h => softNavigate(h, true), refresh() {}, back() { history.back(); } });
`;
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LoadingProvider } from '@/frontend/components/providers/loading-provider';
import { useLoadingRouter } from '@/frontend/components/providers/use-loading-router';
import { softNavigate, usePathname } from 'next/navigation';
import RouteLoadingSignal from '@/frontend/components/route-loading-signal';
import { usePageLoadingSignal } from '@/frontend/components/providers/use-page-loading-signal';
function Link({ href, id, ignore, children }) {
  return <a id={id} href={href} {...(ignore ? { 'data-loading-ignore': '' } : {})} onClick={e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); if (ignore) return; softNavigate(href, false); }}>{children}</a>;
}
// Stand-ins for what Next renders: loading.tsx fallbacks (RouteLoadingSignal) while the server works, then the page.
function useAfter(ms) { const [done, setDone] = React.useState(ms === 0); React.useEffect(() => { const t = setTimeout(() => setDone(true), ms); return () => clearTimeout(t); }, [ms]); return done; }
function Stacked() { // root fallback + nested fallback; the nested one goes first, the root one last
  const nestedDone = useAfter(300), rootDone = useAfter(1000);
  return <>{!rootDone && <RouteLoadingSignal />}{!nestedDone && <RouteLoadingSignal />}<p id="stacked">{rootDone ? 'stacked page' : 'fallback'}</p></>;
}
// A teacher page that reads its main data in the browser after the server rendered it.
function DataPage({ url }) {
  const [state, setState] = React.useState({ s: 'loading' });
  usePageLoadingSignal(state.s === 'loading');
  React.useEffect(() => { if (state.s !== 'loading') return; const c = new AbortController(); fetch(url, { signal: c.signal }).then(r => r.ok ? r.json() : Promise.reject(r.status)).then(v => setState({ s: 'ready', v }), e => { if (e && e.name === 'AbortError') return; setState({ s: 'error' }); }); return () => c.abort(); }, [url, state.s]);
  return <section>{state.s === 'loading' && <p id="skeleton">Loading...</p>}{state.s === 'ready' && <p id="data">{state.v.name}</p>}{state.s === 'error' && <p id="err" role="alert">Could not load</p>}
    <button id="retry" onClick={() => setState({ s: 'loading' })}>retry</button></section>;
}
function WithServerFallback({ children, ms = 200 }) { const done = useAfter(ms); return done ? children : <RouteLoadingSignal />; }
function Content({ path }) {
  const q = new URLSearchParams(location.search);
  if (path === '/teacher/stacked') return <Stacked />;
  if (path.startsWith('/teacher/data')) return <WithServerFallback ms={q.get("fb") === null ? 200 : Number(q.get("fb"))}><DataPage url={'/data?d=' + (q.get('d') || 0) + (q.get('fail') ? '&fail=1' : '') + (q.get('hang') ? '&hang=1' : '')} /></WithServerFallback>;
  return null;
}
function App() {
  const router = useLoadingRouter(); const path = usePathname();
  return <div><nav>
    <Link id="slow" href="/teacher/groups?ms=700">Groups</Link>
    <Link id="fast" href="/teacher/fast?ms=10">Fast</Link>
    <Link id="cancel" href="/teacher/cancelled?ms=700" ignore>Cancelled</Link>
    <button id="push" onClick={() => router.push('/teacher/groups?ms=700')}>push</button>
    <button id="pushfast" onClick={() => router.push('/teacher/fast?ms=10')}>push fast</button>
    <Link id="data" href="/teacher/data?ms=300&d=1500">Data</Link>
    <Link id="datafast" href="/teacher/data?ms=10&d=0&fb=0">Data fast</Link>
  </nav><p id="path">{path}</p><Content path={path} /></div>;
}
createRoot(document.getElementById('root')).render(<LoadingProvider><App /></LoadingProvider>);
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
  const html = '<!doctype html><meta charset=utf-8><body><div id=root></div><script src=/client.js></script>';
  const server = http.createServer((req, res) => {
    if (req.url === '/client.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(fs.readFileSync(path.join(out, 'client.js'))); }
    if (req.url.startsWith('/data')) {
      const q = new URL(req.url, 'http://x').searchParams;
      if (q.get('hang')) return;
      return setTimeout(() => { res.statusCode = q.get('fail') ? 500 : 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ name: 'teacher data' })); }, Number(q.get('d') || 0));
    }
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
  const errors = [];
  try {

  // Records when the overlay was on screen, in ms since the action, sampled every 20 ms.
  async function run(action, { from = '/teacher/home', wait = 2300, reduced = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + from); await page.locator('#path').waitFor(); await page.waitForTimeout(300);
    await page.evaluate(() => { window.__log = []; window.__t0 = performance.now(); window.__iv = setInterval(() => window.__log.push([Math.round(performance.now() - window.__t0), !!document.querySelector('[role="status"][aria-label]'), location.pathname]), 20); });
    await action(page); await page.waitForTimeout(wait);
    const log = await page.evaluate(() => { clearInterval(window.__iv); return window.__log; });
    await ctx.close();
    const on = log.filter(r => r[1]), changed = log.find(r => r[2] !== log[0][2]);
    return { shown: on.length > 0, from: on[0] && on[0][0], until: on.length ? on[on.length - 1][0] : undefined, urlAt: changed && changed[0], path: log[log.length - 1][2] };
  }
  const ok = (name, fn) => fn().then(() => console.log('PASS ' + name));

  await ok('a slow teacher link shows the overlay after the short delay, keeps it until the page arrives, then finishes calmly', async () => {
    const r = await run(p => p.click('#slow'));
    assert.ok(r.shown, 'overlay shown'); assert.ok(r.from >= 100 && r.from <= 400, 'appears after the 120 ms delay, not instantly: ' + r.from);
    assert.ok(r.until >= r.urlAt, 'still up when the page arrived'); assert.ok(r.until - r.urlAt >= 500, 'finish phase of about 650 ms: ' + (r.until - r.urlAt));
    assert.ok(r.until < r.urlAt + 1400, 'and it goes away: ' + (r.until - r.urlAt)); assert.equal(r.path, '/teacher/groups');
  });
  await ok('router.push through useLoadingRouter shows it too', async () => { const r = await run(p => p.click('#push')); assert.ok(r.shown); assert.ok(r.until >= r.urlAt); assert.equal(r.path, '/teacher/groups'); });
  await ok('a fast navigation (link or router.push) never flashes the overlay', async () => {
    for (const id of ['#fast', '#pushfast']) { const r = await run(p => p.click(id), { wait: 900 }); assert.equal(r.shown, false, id); assert.equal(r.path, '/teacher/fast'); }
  });
  await ok('a cancelled navigation (the app cancels the click and never navigates) does not show it', async () => {
    const r = await run(p => p.click('#cancel'), { wait: 1500 }); assert.equal(r.shown, false); assert.equal(r.path, '/teacher/home');
  });
  await ok('navigating to the page you are already on does not show it', async () => {
    const r = await run(p => p.click('#slow'), { from: '/teacher/groups?ms=700', wait: 1000 }); assert.equal(r.shown, false);
  });
  await ok('modified clicks (open in new tab) do not show it', async () => {
    const r = await run(p => p.click('#slow', { modifiers: ['Control'] }), { wait: 1000 }); assert.equal(r.shown, false);
  });
  await ok('the overlay never takes taps for a navigation', async () => {
    const ctx = await browser.newContext(); const page = await ctx.newPage(); await page.goto(origin + '/teacher/home'); await page.locator('#path').waitFor();
    await page.click('#slow'); await page.locator('[role="status"][aria-label]').waitFor({ timeout: 2000 });
    assert.match(await page.locator('[role="status"][aria-label]').getAttribute('class'), /pointer-events-none/); await ctx.close();
  });
  await ok('with reduced motion the overlay still shows and finishes', async () => {
    const r = await run(p => p.click('#slow'), { reduced: true }); assert.ok(r.shown); assert.equal(r.path, '/teacher/groups');
  });

  // Samples every 20 ms from the very start of the page (full loads) or from the action (client navigations).
  const SAMPLER = () => { window.__log = []; const t0 = performance.now(); window.__iv = setInterval(() => window.__log.push({ t: Math.round(performance.now() - t0), overlay: !!document.querySelector('[role="status"][aria-label]'), data: !!document.querySelector('#data'), err: !!document.querySelector('#err'), skeleton: !!document.querySelector('#skeleton') }), 20); };
  async function trace(url, { wait = 4000, click, reduced = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: reduced ? 'reduce' : 'no-preference' }); const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    if (click) { await page.goto(origin + '/teacher/home'); await page.locator('#path').waitFor(); await page.waitForTimeout(300); await page.evaluate(SAMPLER); await page.click(click); }
    else { await page.addInitScript(SAMPLER); await page.goto(origin + url); }
    await page.waitForTimeout(wait);
    const log = await page.evaluate(() => { clearInterval(window.__iv); return window.__log; }); await ctx.close();
    const edges = log.filter((r, i) => r.overlay && (i === 0 || !log[i - 1].overlay)), on = log.filter(r => r.overlay);
    const gone = on.length ? log.find(r => !r.overlay && r.t > on[on.length - 1].t) : undefined;
    return { log, runs: edges.length, shownAt: on[0] && on[0].t, lastOn: on.length ? on[on.length - 1].t : undefined, dataAtRemoval: gone ? gone.data : undefined, skeletonAfterOverlay: on.length ? log.some(r => r.t > on[on.length - 1].t && r.skeleton) : undefined, final: log[log.length - 1] };
  }

  await ok('two stacked route signals (root + nested), one releasing early: one run, no early finish, no restart', async () => {
    const r = await trace('/teacher/stacked');
    assert.equal(r.runs, 1, 'overlay ran ' + r.runs + ' times'); assert.ok(r.lastOn >= 1000 + 500, 'overlay held until the last signal released and then finished: ' + r.lastOn);
    assert.ok(r.log.filter(x => x.t > 200 && x.t < 1000).every(x => x.overlay), 'overlay up the whole time');
  });
  await ok('a slow browser fetch: the overlay stays up until the data arrives and the data is in the page when the overlay is removed (full reload)', async () => {
    const r = await trace('/teacher/data?d=1500');
    assert.equal(r.runs, 1, 'overlay ran ' + r.runs + ' times'); assert.equal(r.dataAtRemoval, true, 'data present when the overlay is gone');
    assert.equal(r.skeletonAfterOverlay, false, 'no skeleton after the overlay'); assert.ok(r.lastOn >= 1500, 'up until the data: ' + r.lastOn);
    assert.equal(r.final.data, true);
  });
  await ok('the same through a client-side navigation', async () => {
    const r = await trace(null, { click: '#data' });
    assert.equal(r.runs, 1); assert.equal(r.dataAtRemoval, true); assert.equal(r.skeletonAfterOverlay, false);
  });
  await ok('a fast client navigation with a fast fetch never flashes the overlay', async () => {
    const r = await trace(null, { click: '#datafast', wait: 1200 }); assert.equal(r.runs, 0); assert.equal(r.final.data, true);
  });
  await ok('a failing fetch releases the overlay and the page shows its own error state', async () => {
    const r = await trace('/teacher/data?d=800&fail=1');
    assert.equal(r.runs, 1); assert.equal(r.final.err, true); assert.equal(r.final.overlay, false); assert.equal(r.skeletonAfterOverlay, false);
  });
  await ok('a retry after the overlay is gone does not bring the overlay back', async () => {
    const ctx = await browser.newContext(); const page = await ctx.newPage(); await page.goto(origin + '/teacher/data?d=300&fail=1'); await page.locator('#err').waitFor({ timeout: 5000 }); await page.waitForTimeout(1500);
    await page.click('#retry'); await page.waitForTimeout(600); assert.equal(await page.locator('[role="status"][aria-label]').count(), 0); await ctx.close();
  });
  await ok('safety cap: a fetch that never answers releases the overlay after about 10 s and the page keeps its own loading state', async () => {
    const r = await trace('/teacher/data?hang=1', { wait: 12500 });
    assert.equal(r.runs, 1); assert.ok(r.lastOn >= 9500 && r.lastOn <= 11500, 'overlay released around the cap: ' + r.lastOn); assert.equal(r.final.overlay, false); assert.equal(r.final.skeleton, true);
  });
  await ok('with reduced motion a slow fetch still keeps the overlay until the data is there', async () => {
    const r = await trace('/teacher/data?d=1200', { reduced: true }); assert.equal(r.runs, 1); assert.equal(r.dataAtRemoval, true);
  });
  assert.deepEqual(errors, []);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
