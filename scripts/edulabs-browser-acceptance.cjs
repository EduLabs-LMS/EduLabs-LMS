// Optional Playwright visual acceptance; artifacts stay in ignored .local/. No account data.
const base = process.env.EDULABS_TEST_URL || 'https://localhost:3132';
const fs = require('fs'), assert = require('assert/strict');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const out = process.env.EDULABS_SCREENSHOT_DIR || '.local/redesign/screenshots';
fs.mkdirSync(out, { recursive: true });
const report = { checks: [], errors: [], overflow: [], browsers: [] };
(async () => {
    for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
        const browser = await engine.launch({ headless: true });
        try {
            const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
            const page = await context.newPage();
            page.on('pageerror', e => report.errors.push({ browser: name, error: e.message }));
            page.on('console', m => { if (m.type() === 'error' && /hydration|did not match|Minified React error/.test(m.text()))
                report.errors.push({ browser: name, error: m.text() }); });
            await page.goto(base + '/design-preview', { waitUntil: 'networkidle' });
            await page.evaluate(() => document.fonts.ready);
            assert.match(await page.locator('h1').evaluate(e => getComputedStyle(e).fontFamily), /Caprasimo/i);
            assert.equal(await page.locator('.hero-art svg path').count(), 22);
            assert.equal(await page.locator('.hero-art svg').getAttribute('viewBox'), '0 0 400 468.8');
            for (const locale of ['en', 'ar']) {
                if (locale === 'ar') {
                    await page.getByRole('button', { name: 'Change language', exact: true }).click();
                    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
                }
                for (const theme of ['light', 'dark']) {
                    if (theme === 'dark')
                        await page.getByRole('button', { name: locale === 'ar' ? 'التبديل للوضع الداكن' : 'Switch to dark mode' }).click();
                    assert.equal(await page.locator('.svc-lms li').first().evaluate(e => getComputedStyle(e).color), 'rgb(0, 0, 0)');
                    for (const width of [360, 390, 430, 768, 900, 1120, 1440]) {
                        await page.setViewportSize({ width, height: 900 });
                        await page.evaluate(() => scrollTo(0, 0));
                        const dims = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, font: getComputedStyle(document.querySelector('h1')).fontFamily, bg: getComputedStyle(document.querySelector('.edu-marketing')).backgroundColor }));
                        if (dims.scroll > dims.width + 1)
                            report.overflow.push({ name, locale, theme, width, ...dims });
                        if ([390, 1440].includes(width))
                            await page.screenshot({ path: `${out}/${name}-${locale}-${theme}-${width}.png`, fullPage: true, animations: 'disabled' });
                        report.checks.push(`${name} ${locale} ${theme} ${width}px`);
                    }
                    if (theme === 'dark')
                        await page.getByRole('button', { name: locale === 'ar' ? 'التبديل للوضع الفاتح' : 'Switch to light mode' }).click();
                }
            }
            await page.setViewportSize({ width: 390, height: 850 });
            const menu = page.getByRole('button', { name: 'القائمة', exact: true });
            // Arabic dictionary may use 'Menu' wording; selector stays semantic through aria-controls.
            const trigger = page.locator('[aria-controls="edu-menu"]');
            await trigger.click();
            assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
            await page.keyboard.press('Escape');
            assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
            await trigger.click();
            await page.locator('#edu-menu a[href="#services"]').click();
            assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
            await page.goto(base + '/sign-in', { waitUntil: 'networkidle' });
            assert.equal(await page.locator('html').getAttribute('lang'), 'ar');
            assert.equal(await page.locator('.intro').count(), 0);
            for (const width of [360, 390, 430, 768, 900, 1120, 1440]) {
                await page.setViewportSize({ width, height: 900 });
                const size = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
                assert.ok(size[1] <= size[0] + 1, `auth overflow ${name} ${width}`);
            }
            await page.screenshot({ path: `${out}/${name}-auth-ar-light.png`, fullPage: true });
            report.browsers.push({ name, version: browser.version() });
            await context.close();
        }
        finally {
            await browser.close();
        }
    }
    fs.writeFileSync('.local/redesign/visual-report.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checks: report.checks.length, errors: report.errors, overflow: report.overflow, browsers: report.browsers }, null, 2));
    assert.equal(report.errors.length, 0);
    assert.equal(report.overflow.length, 0);
})().catch(e => { fs.writeFileSync('.local/redesign/visual-report.json', JSON.stringify({ ...report, failure: e.message }, null, 2)); console.error(e.message); process.exit(1); });
