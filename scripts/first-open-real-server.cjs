// The opening logo against a REAL Next.js server: what the harnesses cannot prove, because they render on the client. The first byte, hydration, and the page with its JavaScript blocked.
// Only public pages are requested, with placeholder public configuration and no provider secrets. How to start the server: docs/ai/TESTING.md.
//
// Run: LMS_FIRST_OPEN_BASE=http://127.0.0.1:3477 LMS_BROWSER_RUNTIME=<node_modules with playwright> [LMS_CHROMIUM_EXECUTABLE=...] node scripts/first-open-real-server.cjs
const path = require('path'), assert = require('node:assert/strict');
const { chromium } = require(path.join(process.env.LMS_BROWSER_RUNTIME, 'playwright'));
const { firstOpenScript, FIRST_OPEN_KEY } = require('./localization-test-loader.cjs').load('frontend/lib/first-load.ts');
const base = process.env.LMS_FIRST_OPEN_BASE || 'http://127.0.0.1:3477';
const CURTAIN = '[data-first-open-curtain]';
const ok = (name, fn) => fn().then(() => console.log('PASS ' + name));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
  const problems = [];
  const fresh = async (options = {}, route = '/sign-in') => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
    const page = await context.newPage();
    page.on('pageerror', e => problems.push(route + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && /hydrat|did not match|server rendered/i.test(m.text())) problems.push(route + ': ' + m.text()); });
    return { context, page };
  };
  const gone = page => page.waitForFunction(selector => !document.querySelector(selector) && !document.documentElement.hasAttribute('data-first-open'), CURTAIN, { timeout: 120000 });

  await ok('the first byte: the head script comes before the body, and the logo is already in the markup, hidden', async () => {
    const html = await (await fetch(base + '/sign-in')).text();
    const head = html.indexOf(firstOpenScript), body = html.indexOf('<body');
    assert.ok(head > 0, 'the exact script is in the page'); assert.ok(head < body, 'and runs before the body');
    assert.ok(html.indexOf('data-first-open-curtain') > body, 'the logo is in the server\'s markup');
    assert.doesNotMatch(html.match(/<html[^>]*>/)[0], /data-first-open/, 'the server never decides: the tab does');
  });

  // Next compiles on first request under `next dev`: warm the page so the timings below measure the browser and not the compiler.
  { const { context, page } = await fresh(); await page.goto(base + '/sign-in', { waitUntil: 'load', timeout: 300000 }); await gone(page); await context.close(); }

  await ok('a real fresh opening: the logo covers the page from the first paint, hydrates quietly, plays, and leaves nothing behind', async () => {
    const { context, page } = await fresh();
    await page.addInitScript(() => { window.__on = []; const t0 = performance.now(); const sample = () => { const e = document.querySelector('[data-first-open-curtain]'), s = e && getComputedStyle(e); window.__on.push([Math.round(performance.now() - t0), !!s && s.display === 'flex' && s.visibility !== 'hidden']); requestAnimationFrame(sample); }; requestAnimationFrame(sample); });
    await page.goto(base + '/sign-in', { waitUntil: 'commit' });
    await gone(page);
    const on = await page.evaluate(() => window.__on), shown = on.filter(r => r[1]);
    assert.ok(on[0][1], 'on from the very first frame');
    assert.ok(shown.at(-1)[0] - shown[0][0] >= 1300, 'the whole animation: ' + (shown.at(-1)[0] - shown[0][0]));
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), FIRST_OPEN_KEY), '1');
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(500);
    assert.equal(await page.locator(CURTAIN).count(), 0, 'not on a reload: it is dropped from the page');
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-first-open')), false);
    await context.close();
  });

  await ok('a real fresh opening with reduced motion: nothing moves, and it goes after a moment', async () => {
    const { context, page } = await fresh({ reducedMotion: 'reduce' });
    await page.goto(base + '/sign-in', { waitUntil: 'commit' });
    await page.locator('[data-first-open-curtain] [data-first-load-logo]').waitFor({ state: 'attached' });
    assert.equal(await page.evaluate(() => document.querySelector('[data-first-load-logo]').getAnimations({ subtree: true }).length), 0);
    await gone(page);
    await context.close();
  });

  await ok('with every script of the app blocked, the logo still animates by itself and the stylesheet lifts it: the page can never stay hidden', async () => {
    const { context, page } = await fresh();
    await page.route('**/_next/static/chunks/**', r => r.abort());
    await page.goto(base + '/sign-in', { waitUntil: 'commit' });
    await page.locator(CURTAIN).waitFor();
    assert.ok(await page.evaluate(() => document.querySelector('[data-first-load-logo]').getAnimations({ subtree: true }).length > 0), 'animating with no JavaScript of the app');
    await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).visibility === 'hidden', CURTAIN, { timeout: 8000 });
    assert.ok(await page.locator('form, h1').first().isVisible(), 'the server\'s page is there');
    await context.close();
  });

  await ok('with JavaScript off there is no logo at all', async () => {
    const { context, page } = await fresh({ javaScriptEnabled: false });
    await page.goto(base + '/sign-in', { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator(CURTAIN).isVisible(), false);
    await context.close();
  });

  await ok('a teacher\'s public website is not covered: its own document, its own strict policy, no script', async () => {
    const response = await fetch(base + '/t/synthetic-site', { redirect: 'manual' }), html = await response.text();
    assert.doesNotMatch(html, /data-first-open/);
    const policy = response.headers.get('content-security-policy');
    if (policy) assert.match(policy, /default-src 'none'/);
    console.log('      /t/synthetic-site answered', response.status, policy ? 'with its strict policy' : 'without a policy header');
  });

  assert.deepEqual(problems, [], 'no hydration problems and no page errors');
  await browser.close();
  console.log('Opening logo against a real Next server: passed (public pages only, placeholder configuration, not provider E2E).');
})().catch(e => { console.error(e); process.exit(1); });
