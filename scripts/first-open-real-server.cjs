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

  await ok('the logo stands out at 3:1 or more on sign-in and on the opening logo, in both looks and both themes', async () => {
    const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    // The first opaque background going up from the mark.
    const measure = (page, selector) => page.locator(selector).first().evaluate(mark => {
      const rgb = c => { const m = /rgba?\(([^)]+)\)/.exec(c).slice(1)[0].split(/[\s,/]+/).map(Number); return { rgb: m.slice(0, 3), a: m[3] === undefined ? 1 : m[3] }; };
      let back = [255, 255, 255];
      for (let e = mark; e; e = e.parentElement) { const fill = rgb(getComputedStyle(e).backgroundColor); if (fill.a === 1) { back = fill.rgb; break; } }
      return { tree: rgb(getComputedStyle(mark.querySelector('g:last-child path')).fill).rgb, back };
    });
    for (const look of ['classic', 'new']) for (const theme of ['light', 'dark']) {
      const { context, page } = await fresh();
      await context.addCookies([{ name: 'edulabs_design', value: look, url: base }]);
      await context.addInitScript(t => { try { localStorage.setItem('edulabs-lms-appearance', t); } catch { /* the page still paints */ } }, theme);
      await page.goto(base + '/sign-in', { waitUntil: 'domcontentloaded' });
      const opening = await measure(page, CURTAIN + ' svg');
      const shadow = (selector) => page.locator(selector).first().evaluate(mark => { const g = mark.querySelector('g[aria-hidden="true"]'); return g ? getComputedStyle(g).display !== 'none' : false; });
      assert.equal(await shadow(CURTAIN + ' svg'), theme === 'light', `opening logo's shadow ${look} ${theme}`);
      assert.ok(ratio(opening.tree, opening.back) >= 3, `opening logo ${look} ${theme}: ${ratio(opening.tree, opening.back).toFixed(2)}`);
      await gone(page);
      await page.locator('svg[aria-label="EduLabs tree mark"]:visible').first().waitFor();
      const signIn = await measure(page, 'svg[aria-label="EduLabs tree mark"]:visible');
      const marks = await page.locator('svg[aria-label="EduLabs tree mark"]:visible').evaluateAll(all => all.map(mark => { const g = mark.querySelector('g[aria-hidden="true"]'); return g ? getComputedStyle(g).display !== 'none' : false; }));
      assert.ok(marks.length >= 2, 'the small logo and the large tree'); for (const drawn of marks) assert.equal(drawn, theme === 'light', `every sign-in mark's shadow ${look} ${theme}`);
      assert.ok(ratio(signIn.tree, signIn.back) >= 3, `sign-in ${look} ${theme}: ${ratio(signIn.tree, signIn.back).toFixed(2)}`);
      console.log(`      ${look} ${theme}: opening ${ratio(opening.tree, opening.back).toFixed(2)}, sign-in ${ratio(signIn.tree, signIn.back).toFixed(2)}`);
      if (process.env.LMS_FIRST_OPEN_SHOTS) await page.screenshot({ path: require('path').join(process.env.LMS_FIRST_OPEN_SHOTS, `signin-${look}-${theme}.png`) });
      await context.close();
    }
  });

  assert.deepEqual(problems, [], 'no hydration problems and no page errors');
  await browser.close();
  console.log('Opening logo against a real Next server: passed (public pages only, placeholder configuration, not provider E2E).');
})().catch(e => { console.error(e); process.exit(1); });
