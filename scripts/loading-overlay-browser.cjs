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
function Link({ href, id, ignore, children }) {
  return <a id={id} href={href} {...(ignore ? { 'data-loading-ignore': '' } : {})} onClick={e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); if (ignore) return; softNavigate(href, false); }}>{children}</a>;
}
function App() {
  const router = useLoadingRouter(); const path = usePathname();
  return <div><nav>
    <Link id="slow" href="/teacher/groups?ms=700">Groups</Link>
    <Link id="fast" href="/teacher/fast?ms=10">Fast</Link>
    <Link id="cancel" href="/teacher/cancelled?ms=700" ignore>Cancelled</Link>
    <button id="push" onClick={() => router.push('/teacher/groups?ms=700')}>push</button>
    <button id="pushfast" onClick={() => router.push('/teacher/fast?ms=10')}>push fast</button>
  </nav><p id="path">{path}</p></div>;
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
  assert.deepEqual(errors, []);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
