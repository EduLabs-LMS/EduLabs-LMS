// Optional production-browser motion checks. No test accounts or credentials required.
const fs = require('fs'), assert = require('assert/strict');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.EDULABS_TEST_URL || 'https://localhost:3132';
fs.mkdirSync('.local/redesign/screenshots', { recursive: true });
const report = { checks: [], errors: [] };
(async () => { for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const b = await engine.launch();
    try {
        const c = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
        const p = await c.newPage();
        p.on('pageerror', e => report.errors.push(name + ': ' + e.message));
        await p.goto(base + '/design-preview');
        await p.locator('.intro.go').waitFor();
        assert.equal(await p.locator('.intro-tree path').count(), 22);
        assert.equal(await p.locator('.intro-word span').count(), 7);
        const timings = await p.locator('.intro-word span').evaluateAll(es => es.map(e => getComputedStyle(e).animationDelay));
        assert.equal(timings[0], '1.1s');
        assert.equal(timings[1], '1.17s');
        await p.screenshot({ path: '.local/redesign/screenshots/motion-' + name + '-splash.png' });
        await p.locator('.intro').waitFor({ state: 'detached', timeout: 9000 });
        assert.equal(await p.locator('.curtain').count(), 0);
        report.checks.push(name + ' full splash sequence and overlay cleanup');
        await p.reload({ waitUntil: 'networkidle' });
        assert.equal(await p.locator('.intro').count(), 0);
        report.checks.push(name + ' splash once per session');
        await p.evaluate(() => sessionStorage.removeItem('edulabs:intro-seen'));
        await p.reload();
        await p.locator('.intro.go').waitFor();
        await p.waitForTimeout(300);
        await p.keyboard.press('Escape');
        await p.locator('.intro').waitFor({ state: 'detached', timeout: 3000 });
        report.checks.push(name + ' Escape skip without focus');
        await p.evaluate(() => sessionStorage.removeItem('edulabs:intro-seen'));
        await p.goto(base + '/design-preview#teachers', { waitUntil: 'networkidle' });
        assert.equal(await p.locator('.intro').count(), 0);
        report.checks.push(name + ' deep-link splash skipped');
        await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await p.waitForTimeout(200);
        assert.match(await p.locator('.progress').evaluate(e => getComputedStyle(e).transform), /^matrix\(1,/);
        assert.equal(await p.locator('.hero-art svg').evaluate(e => getComputedStyle(e).animationPlayState), 'paused');
        await p.locator('[data-billing=yearly]').scrollIntoViewIfNeeded();
        await p.locator('[data-billing=yearly]').click();
        assert.equal(await p.locator('[data-billing=yearly]').getAttribute('aria-pressed'), 'true');
        assert.equal(await p.locator('.seg').getAttribute('data-b'), 'yearly');
        report.checks.push(name + ' scroll progress, offscreen pause and pricing control');
        await c.close();
        const reduced = await b.newContext({ ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
        const r = await reduced.newPage();
        await r.goto(base + '/design-preview', { waitUntil: 'networkidle' });
        assert.equal(await r.locator('.intro').count(), 0);
        assert.equal(await r.locator('.hero-art svg').evaluate(e => getComputedStyle(e).animationName), 'none');
        assert.equal(await r.locator('[data-rv][data-s="below"]').count(), 0);
        report.checks.push(name + ' reduced motion immediate content');
        await reduced.close();
        const fallback = await b.newContext({ ignoreHTTPSErrors: true });
        await fallback.addInitScript(() => { delete window.IntersectionObserver; });
        const f = await fallback.newPage();
        await f.goto(base + '/design-preview?skip=intro', { waitUntil: 'networkidle' });
        assert.equal(await f.locator('[data-rv]:not([data-s="in"])').count(), 0);
        report.checks.push(name + ' IntersectionObserver fallback visible');
        await fallback.close();
    }
    finally {
        await b.close();
    }
} fs.writeFileSync('.local/redesign/motion-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); assert.equal(report.errors.length, 0); })().catch(e => { console.error(e.message); process.exit(1); });
