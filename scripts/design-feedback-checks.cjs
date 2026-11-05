// The owner's feedback on the New look, in Chromium: part of scripts/design-foundation-browser.cjs, which provides the page, the real components and the real stylesheet.
const assert = require('node:assert/strict');

const LIME = 'rgb(127, 217, 89)', INK = 'rgb(20, 48, 26)', EDGE = 'rgb(43, 100, 22)';
const TREE = 'rgb(126, 217, 87)';
const SERVER_NOW = Date.UTC(2031, 2, 3, 9, 0, 0); // a fixed server clock, far from any real device clock

module.exports = async ({ step, open, box, css1, desktop, phone, shot }) => {
  const settle = page => page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch { /* endless */ } } });
  const moved = (page, selector) => page.locator(selector).first().evaluate(e => getComputedStyle(e).transform);

  await step('Active item: a lime rounded pill with a deep green edge in New, the black border and shadow in Classic; both themes, both directions, phone tabs too', async () => {
    for (const theme of ['light', 'dark']) for (const lang of ['en', 'ar']) {
      const wide = await open(desktop, `view=home&theme=${theme}&lang=${lang}`, 'new');
      const item = '[data-nav="home"]';
      assert.equal(await css1(wide.page, item, 'backgroundColor'), LIME, theme);
      assert.equal(await css1(wide.page, item, 'color'), INK, theme);
      assert.equal(await css1(wide.page, item, 'boxShadow'), `${EDGE} 3px 3px 0px 0px`, 'about 3 px down and right, ' + theme + ' ' + lang);
      assert.equal(await css1(wide.page, item, 'borderRadius'), '16px', "Classic's rounded shape");
      assert.equal(await css1(wide.page, item + ' svg', 'color'), INK, 'the icon');
      assert.equal(await wide.page.locator(item).evaluate(e => getComputedStyle(e, '::before').content), 'none', 'no old side bar');
      const primary = await wide.page.locator('[data-take-attendance]').evaluate(e => { const s = getComputedStyle(e); return [s.backgroundColor, s.color, s.boxShadow, s.borderRadius]; });
      assert.deepEqual(primary, [LIME, INK, `${EDGE} 3px 3px 0px 0px`, '16px'], 'the primary button has the same lime and edge');
      await wide.context.close();
      const small = await open(phone, `view=home&theme=${theme}&lang=${lang}`, 'new');
      const pill = '[data-bottom-tab="home"] .d-bottom-tab-icon';
      assert.equal(await css1(small.page, pill, 'backgroundColor'), LIME);
      assert.equal(await css1(small.page, pill, 'boxShadow'), `${EDGE} 2px 2px 0px 0px`);
      assert.equal(await css1(small.page, pill, 'color'), INK);
      await small.context.close();
    }
    const classic = await open(desktop, 'view=home', 'classic');
    assert.equal(await css1(classic.page, '[data-nav="home"]', 'boxShadow'), 'rgb(0, 0, 0) 3px 3px 0px 0px');
    assert.equal(await css1(classic.page, '[data-nav="home"]', 'borderTopColor'), 'rgb(0, 0, 0)');
    await classic.context.close();
  });

  await step('The logo: the real tree and the Caprasimo word, no box and no background, in the sidebar and the phone header, both looks and themes', async () => {
    for (const look of ['classic', 'new']) for (const theme of ['light', 'dark']) for (const [viewport, logo] of [[desktop, '[data-teacher-sidebar] a.d-logo'], [phone, '[data-teacher-phone-header] a.d-logo']]) {
      const { page, context } = await open(viewport, `view=home&theme=${theme}`, look);
      const found = await page.locator(logo).evaluate(a => {
        const bare = e => { const s = getComputedStyle(e); return s.backgroundColor === 'rgba(0, 0, 0, 0)' && s.backgroundImage === 'none' && s.boxShadow === 'none' && parseFloat(s.borderTopWidth) === 0; };
        const mark = a.querySelector('.d-logo-mark'), svg = mark.querySelector('svg'), tree = svg.querySelector('g:last-child path'), box = svg.getBoundingClientRect();
        return { link: bare(a), mark: bare(mark), svg: bare(svg), fill: getComputedStyle(tree).fill, label: svg.getAttribute('aria-label'), ratio: box.width / box.height, word: getComputedStyle(a.querySelector('.d-logo-word')).fontFamily.split(',')[0] };
      });
      const where = `${look} ${theme} ${viewport.width}`;
      assert.deepEqual([found.link, found.mark, found.svg], [true, true, true], 'nothing painted behind the logo: ' + where);
      assert.equal(found.fill, TREE, 'the tree keeps its own colour: ' + where);
      assert.equal(found.label, 'EduLabs tree mark');
      assert.ok(Math.abs(found.ratio - 400 / 468.8) < 0.02, 'its natural shape: ' + found.ratio);
      assert.match(found.word, /Caprasimo/i, where);
      await context.close();
    }
  });

  await step('Homework, Exams and Reports: visible with a Soon tag in both looks, not links, not focusable, and a tooltip', async () => {
    for (const look of ['classic', 'new']) for (const [lang, soon, tip, names] of [['en', 'Soon', 'Coming soon', ['Homework', 'Exams', 'Reports']], ['ar', 'قريبًا', 'سيتوفر قريبًا', ['الواجبات', 'الامتحانات', 'التقارير']]]) {
      const { page, context } = await open(desktop, 'view=home&lang=' + lang, look);
      const rows = await page.locator('[data-teacher-nav] [data-soon]').evaluateAll(n => n.map(e => ({ key: e.dataset.nav, tag: e.tagName, role: e.getAttribute('role'), disabled: e.getAttribute('aria-disabled'), title: e.getAttribute('title'), href: e.getAttribute('href'), tab: e.getAttribute('tabindex'), text: e.innerText.split('\n').map(s => s.trim()).filter(Boolean), width: e.getBoundingClientRect().width })));
      assert.deepEqual(rows.map(r => r.key), ['homework', 'exams', 'reports'], look);
      rows.forEach((r, i) => {
        assert.deepEqual([r.tag, r.role, r.disabled, r.title, r.href, r.tab], ['SPAN', 'link', 'true', tip, null, null], r.key);
        assert.deepEqual(r.text, [names[i], soon], r.key); assert.ok(r.width > 180, 'as wide as the links');
      });
      assert.equal(await page.locator('[data-teacher-nav] a[href*="homework"], [data-teacher-nav] a[href*="exams"], [data-teacher-nav] a[href*="reports"]').count(), 0);
      const reached = [];
      for (let i = 0; i < 16; i++) { await page.keyboard.press('Tab'); reached.push(await page.evaluate(() => document.activeElement?.dataset?.nav || '')); }
      for (const key of ['homework', 'exams', 'reports']) assert.ok(!reached.includes(key), 'the keyboard passes it: ' + key);
      assert.ok(reached.includes('courses'), 'and still reaches the real items');
      await page.locator('[data-nav="homework"]').click({ force: true });
      assert.equal(await page.evaluate(() => window.__pathname), '/home', 'a click goes nowhere');
      assert.deepEqual(await page.evaluate(() => window.__pushes), []);
      await context.close();

      const small = await open(phone, 'view=home&lang=' + lang, look);
      await small.page.locator('[data-bottom-tab="more"]').click(); await small.page.locator('[data-more-sheet]').waitFor(); await small.page.waitForTimeout(300);
      const sheet = await small.page.locator('[data-more-sheet] [data-soon]').evaluateAll(n => n.map(e => [e.dataset.moreItem, e.tagName, e.getAttribute('aria-disabled'), e.getAttribute('title'), e.getAttribute('href'), e.innerText.includes(e.querySelector('.d-soon').innerText)]));
      assert.deepEqual(sheet, ['homework', 'exams', 'reports'].map(key => [key, 'SPAN', 'true', tip, null, true]), look);
      await small.page.locator('[data-more-item="exams"]').click({ force: true });
      assert.equal(await small.page.locator('[data-more-sheet]').isVisible(), true, 'tapping it does nothing, the sheet stays');
      assert.equal(await small.page.evaluate(() => window.__pathname), '/home');
      await small.context.close();
    }
  });

  await step('Motion, buttons: in New hover lightens, press moves onto the edge and the edge shrinks, release comes back; Classic keeps its own', async () => {
    const { page, context } = await open(desktop, 'view=gallery', 'new');
    const primary = '[data-variant="primary"]', secondary = '[data-variant="secondary"]';
    const glow = () => page.locator(primary).evaluate(e => +getComputedStyle(e, '::after').opacity);
    assert.equal(await glow(), 0);
    await page.locator(primary).hover(); await page.waitForTimeout(200);
    assert.ok(Math.abs(await glow() - 0.16) < 0.01, 'hover lightens');
    assert.equal(await moved(page, primary), 'none', 'hover alone does not move it');
    await page.mouse.down(); await page.waitForTimeout(200);
    assert.equal(await moved(page, primary), 'matrix(1, 0, 0, 1, 3, 3)', 'pressed onto its edge, the same 3 px');
    assert.match(await css1(page, primary, 'boxShadow'), /0px 0px 0px/, 'the edge has shrunk');
    await page.mouse.up(); await page.waitForTimeout(300);
    assert.equal(await moved(page, primary), 'none', 'back'); assert.match(await css1(page, primary, 'boxShadow'), /3px 3px 0px/);
    const timing = await page.locator(primary).evaluate(e => { const s = getComputedStyle(e); return [s.transitionProperty, s.transitionDuration]; });
    assert.match(timing[0], /transform/); for (const d of timing[1].split(',')) { const ms = parseFloat(d) * 1000; assert.ok(ms >= 120 && ms <= 250, d); }
    await page.locator(secondary).hover(); await page.mouse.down(); await page.waitForTimeout(200);
    assert.equal(await moved(page, secondary), 'matrix(1, 0, 0, 1, 0, 2)', 'a secondary button sits on its 2 px bottom edge');
    await page.mouse.up();
    await context.close();
    const classic = await open(desktop, 'view=gallery', 'classic');
    assert.equal(await classic.page.locator(primary).evaluate(e => getComputedStyle(e, '::after').content), 'none', 'no overlay in Classic');
    await classic.page.locator(primary).hover(); await classic.page.mouse.down(); await classic.page.waitForTimeout(200);
    assert.equal(await moved(classic.page, primary), 'matrix(1, 0, 0, 1, 2, 2)', "Classic's own press"); await classic.page.mouse.up();
    await classic.context.close();
  });

  const slides = async (page, container, path) => page.evaluate(({ container, path }) => {
    const parent = document.querySelector(container);
    window.__setPath(path);
    const moving = parent.querySelector('.d-slider'), style = getComputedStyle(moving), running = moving.getAnimations();
    return { sliding: parent.hasAttribute('data-sliding'), display: style.display, property: running[0]?.transitionProperty, duration: running[0]?.effect.getTiming().duration, easing: running[0]?.effect.getTiming().easing, from: running[0] && moving.style.transform };
  }, { container, path });

  await step('Motion, the indicator: the menu pill and the tab pill slide to the new item in New, also in Arabic; the real pill is back afterwards; Classic jumps', async () => {
    for (const lang of ['en', 'ar']) for (const [viewport, container, item] of [[desktop, '[data-teacher-sidebar]', '[data-nav="students"]'], [phone, '[data-teacher-tabs]', '[data-bottom-tab="students"] .d-bottom-tab-icon']]) {
      const { page, context } = await open(viewport, 'view=home&lang=' + lang, 'new');
      const start = await page.evaluate(({ container }) => { const c = document.querySelector(container); return c.querySelector('[aria-current="page"]').getBoundingClientRect().top; }, { container });
      const r = await slides(page, container, '/teacher/students');
      assert.equal(r.sliding, true, 'sliding'); assert.equal(r.display, 'block'); assert.equal(r.property, 'transform', 'transform only');
      assert.equal(r.duration, 220); assert.equal(r.easing, 'ease-out');
      await page.waitForFunction(c => !document.querySelector(c).hasAttribute('data-sliding'), container, { timeout: 500 });
      assert.equal(await page.locator(container + ' .d-slider').evaluate(e => getComputedStyle(e).display), 'none', 'the stand-in is gone');
      assert.equal(await css1(page, item, 'backgroundColor'), LIME, 'the real pill is painted again');
      assert.ok(start > 0);
      await context.close();
    }
    const { page, context } = await open(desktop, 'view=home', 'classic');
    assert.equal((await slides(page, '[data-teacher-sidebar]', '/teacher/students')).sliding, false, 'Classic jumps');
    assert.equal(await css1(page, '[data-nav="students"]', 'backgroundColor') !== 'rgba(0, 0, 0, 0)', true);
    await context.close();
    for (const lang of ['en', 'ar']) {
      const tabs = await open(desktop, 'view=gallery&lang=' + lang, 'new');
      const r = await tabs.page.evaluate(() => { const list = document.querySelector('[data-gallery-tabs]'); list.querySelectorAll('[role="tab"]')[1].click(); return new Promise(done => requestAnimationFrame(() => { const line = list.querySelector('.d-slider'); done({ sliding: list.hasAttribute('data-sliding'), height: line.getBoundingClientRect().height, display: getComputedStyle(line).display, property: line.getAnimations()[0]?.transitionProperty }); })); });
      assert.deepEqual(r, { sliding: true, height: 2, display: 'block', property: 'transform' }, 'the tab underline slides: ' + lang);
      await tabs.page.waitForFunction(() => !document.querySelector('[data-gallery-tabs]').hasAttribute('data-sliding'), null, { timeout: 500 });
      assert.match(await css1(tabs.page, '[data-gallery-tabs] [role="tab"][aria-selected="true"]', 'boxShadow'), /inset/, 'and the real underline is back');
      await tabs.context.close();
    }
  });

  const entering = page => page.evaluate(() => window.__entry.map(a => a));
  const watchEntry = page => page.evaluate(() => {
    window.__setPath('/teacher/groups');
    window.__entry = document.getAnimations().filter(a => a.animationName === 'd-enter').map(a => { const k = a.effect.getKeyframes()[0], t = a.effect.getTiming(); return { opacity: k.opacity, transform: k.transform, duration: t.duration, delay: t.delay, easing: k.easing, row: a.effect.target.matches('.d-row') }; });
    window.__ring = document.getAnimations().filter(a => a.animationName === 'd-ring-in').length;
  });

  await step('Motion, a page\'s first render: cards and rows rise with a short stagger in New, the ring draws, the numbers count up; a refresh animates nothing; Classic never', async () => {
    const { page, context } = await open(desktop, 'view=home&path=/home', 'new');
    await page.evaluate(() => { window.__counts = []; new MutationObserver(() => { const e = document.querySelector('[data-summary="students"] .d-kpi-value'); if (e) window.__counts.push(e.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
    await watchEntry(page);
    const found = await entering(page);
    assert.ok(found.length >= 6, 'cards and rows: ' + found.length);
    assert.ok(found.some(a => a.row), 'list rows too');
    for (const a of found) { assert.equal(a.opacity, '0'); assert.equal(a.transform, 'translateY(6px)', 'rises about 6 px'); assert.equal(a.duration, 220); assert.equal(a.easing, 'ease-out'); assert.equal(a.delay % 30, 0, 'the stagger, about 30 ms'); assert.ok(a.delay <= 210, 'and short'); }
    assert.ok(new Set(found.map(a => a.delay)).size >= 2, 'a real stagger');
    assert.equal(await page.evaluate(() => window.__ring), 1, 'the ring draws itself');
    await page.locator('main:not([data-enter])').waitFor({ timeout: 1500 });
    const counts = await page.evaluate(() => window.__counts);
    assert.ok(counts.includes('41') && Number(counts[0]) < 41, 'the number rises from below: ' + counts.slice(0, 6).join(' '));
    assert.equal(counts.at(-1), '41');
    assert.equal(await page.locator('[data-summary="students"] .d-kpi-value').innerText(), '41');
    // A background refresh of the same page: nothing rises.
    await page.evaluate(() => { window.__refresh(); });
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.animationName === 'd-enter' || a.animationName === 'd-ring-in').length), 0, 'never on a data refresh');
    await page.evaluate(() => { window.__counts.length = 0; window.__refresh(); }); await page.waitForTimeout(60);
    assert.deepEqual(await page.evaluate(() => window.__counts), [], 'no count on a refresh either');
    await context.close();

    const classic = await open(desktop, 'view=home&path=/home', 'classic');
    await watchEntry(classic.page);
    assert.deepEqual(await entering(classic.page), [], 'Classic');
    assert.equal(await classic.page.evaluate(() => window.__ring), 0, 'Classic');
    assert.equal(await classic.page.locator('[data-summary="students"] .d-kpi-value').innerText(), '41');
    await classic.context.close();
  });

  await step('Behind the opening logo the page is simply there, never held invisible, and it rises as the logo fades', async () => {
    const { page, context } = await open(desktop, 'view=home&path=/home', 'new');
    await page.evaluate(() => { document.documentElement.setAttribute('data-first-open', '1'); document.querySelector('main').setAttribute('data-enter', ''); });
    assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.animationName === 'd-enter' || a.animationName === 'd-ring-in').length), 0, 'nothing is running or held');
    const opacity = await page.locator('[data-summary="students"]').evaluate(e => getComputedStyle(e).opacity);
    assert.equal(opacity, '1', 'visible even if the app never gets further');
    await page.evaluate(() => document.documentElement.setAttribute('data-first-open', 'leaving'));
    assert.ok(await page.evaluate(() => document.getAnimations().filter(a => a.animationName === 'd-enter').length) > 0, 'the rise starts as the logo fades');
    await context.close();
  });

  await step('Motion, dialogs and sheets: New fades and scales on a desktop (also mirrored in Arabic), slides up on a phone; Classic has none', async () => {
    const dialogAnimation = async (viewport, query, look) => {
      const { page, context } = await open(viewport, query, look);
      await page.locator('[data-open-dialog]').click();
      const open_ = await page.locator('[data-gallery-dialog]').evaluate(e => { const s = getComputedStyle(e); return [s.animationName, parseFloat(s.animationDuration) * 1000, s.animationTimingFunction]; });
      const overlay = await page.locator('.d-dialog-overlay').evaluate(e => getComputedStyle(e).animationName);
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      const closing = await page.evaluate(() => { const e = document.querySelector('[data-gallery-dialog]'); return e ? getComputedStyle(e).animationName : 'none'; });
      await page.locator('[data-gallery-dialog]').waitFor({ state: 'detached' });
      await context.close();
      return { open: open_, overlay, closing };
    };
    assert.deepEqual(await dialogAnimation(desktop, 'view=gallery', 'new'), { open: ['d-dialog-in', 200, 'ease-out'], overlay: 'd-fade-in', closing: 'd-dialog-out' });
    assert.deepEqual(await dialogAnimation(desktop, 'view=gallery&lang=ar', 'new'), { open: ['d-dialog-in-rtl', 200, 'ease-out'], overlay: 'd-fade-in', closing: 'd-dialog-out-rtl' });
    assert.deepEqual(await dialogAnimation(phone, 'view=gallery', 'new'), { open: ['d-sheet-in', 250, 'ease-out'], overlay: 'd-fade-in', closing: 'd-sheet-out' });
    const classic = await dialogAnimation(desktop, 'view=gallery', 'classic');
    assert.deepEqual([classic.open[0], classic.overlay, classic.closing], ['none', 'none', 'none']);
  });

  await step('Motion, skeletons and toasts: a shimmer in New (mirrored in Arabic) and Classic\'s pulse in Classic; a short toast in New only, the screen keeps its own confirmation', async () => {
    const skeleton = async (query, look) => { const { page, context } = await open(desktop, query, look); const r = await page.locator('.d-skeleton').first().evaluate(e => [getComputedStyle(e).animationName, getComputedStyle(e, '::after').animationName]); await context.close(); return r; };
    assert.deepEqual(await skeleton('view=gallery', 'new'), ['none', 'd-shimmer']);
    assert.deepEqual(await skeleton('view=gallery&lang=ar', 'new'), ['none', 'd-shimmer-rtl']);
    assert.deepEqual(await skeleton('view=gallery', 'classic'), ['d-pulse', 'none']);
    const { page, context } = await open(desktop, 'view=gallery', 'new');
    await page.locator('[data-toast-button]').click();
    const toast = page.locator('[data-action-toast]');
    await toast.waitFor();
    assert.equal(await toast.innerText(), 'Synthetic action done');
    assert.equal(await toast.evaluate(e => getComputedStyle(e).animationName), 'd-toast-in');
    assert.equal(await toast.getAttribute('aria-hidden'), 'true', 'silent: the screen\'s own confirmation is what is read');
    assert.deepEqual(await toast.evaluate(e => { const s = getComputedStyle(e); return [s.boxShadow.includes('rgb(0, 0, 0)'), s.borderTopColor === 'rgb(0, 0, 0)']; }), [false, false], 'no black edge');
    await shot(page, 'new-toast');
    await toast.waitFor({ state: 'detached', timeout: 5000 });
    await context.close();
    const classic = await open(desktop, 'view=gallery', 'classic');
    await classic.page.locator('[data-toast-button]').click(); await classic.page.waitForTimeout(150);
    assert.equal(await classic.page.locator('[data-action-toast]').count(), 0, 'Classic');
    await classic.context.close();
  });

  await step('Reduced motion turns all of it off in New: no press, no slide, no rise, no count, no dialog animation, no shimmer, no toast', async () => {
    for (const lang of ['en', 'ar']) {
      const home = await open(desktop, 'view=home&lang=' + lang, 'new', { reducedMotion: 'reduce' });
      await home.page.evaluate(() => { window.__counts = []; new MutationObserver(() => { const e = document.querySelector('[data-summary="students"] .d-kpi-value'); if (e) window.__counts.push(e.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
      assert.equal((await slides(home.page, '[data-teacher-sidebar]', '/teacher/students')).sliding, false, 'no slide');
      assert.deepEqual(await home.page.evaluate(() => document.getAnimations().map(a => a.animationName || a.transitionProperty)), [], 'nothing runs after a page change');
      await home.page.waitForTimeout(80);
      assert.equal(new Set(await home.page.evaluate(() => window.__counts)).size <= 1, true, 'no count');
      await home.context.close();
      const gallery = await open(desktop, 'view=gallery&lang=' + lang, 'new', { reducedMotion: 'reduce' });
      const primary = '[data-variant="primary"]';
      await gallery.page.locator(primary).hover(); await gallery.page.mouse.down();
      assert.equal(await moved(gallery.page, primary), 'none', 'no press'); await gallery.page.mouse.up();
      assert.equal(await gallery.page.locator(primary).evaluate(e => getComputedStyle(e, '::after').content), 'none', 'no hover layer');
      assert.deepEqual(await gallery.page.locator('.d-skeleton').first().evaluate(e => [getComputedStyle(e).animationName, getComputedStyle(e, '::after').content]), ['none', 'none'], 'no shimmer');
      await gallery.page.locator('[data-toast-button]').click(); await gallery.page.waitForTimeout(100);
      assert.equal(await gallery.page.locator('[data-action-toast]').count(), 0, 'no toast');
      await gallery.page.locator('[data-open-dialog]').click();
      assert.equal(await gallery.page.locator('[data-gallery-dialog]').evaluate(e => getComputedStyle(e).animationName), 'none', 'no dialog animation');
      await gallery.context.close();
    }
  });

  const line = (page, selector) => page.locator(selector).first().evaluate(e => e.textContent.trim());

  await step('Countdown: on the hero and the rows in both looks, with tabular figures', async () => {
    for (const look of ['classic', 'new']) {
      const { page, context } = await open(desktop, `view=home&serverNow=${SERVER_NOW}&upcoming=25,200,3180,1440`, look);
      assert.equal(await page.locator('[data-next-session] [data-countdown]').count(), 1, 'on the hero when nothing is live');
      const rows = await page.locator('[data-section="th-coming"] [data-countdown]').allInnerTexts();
      assert.equal(rows.length, 3); assert.ok(await page.locator('[data-countdown]').first().evaluate(e => getComputedStyle(e).fontVariantNumeric === 'tabular-nums'), 'tabular figures');
      await context.close();
    }
  });

  /** The device's clock says deviceMs; the data's "now" is the fixed server clock. */
  const openAtServerTime = (query, viewport, look, deviceMs) => open(viewport, query, look, { beforeGoto: page => page.clock.install({ time: deviceMs }) });

  await step('Countdown against the server: with a device clock hours or years wrong the words are still right; one minute later they change; hero is empty during a live class', async () => {
    const cases = [
      ['25,200,1440,3180', 'en', 'in 25 min', ['in 3 h 20 min', 'in 24 h', 'in 2 d 5 h']],
      ['60,1441,2880,4380', 'en', 'in 1 h', ['in 1 d', 'in 2 d', 'in 3 d 1 h']],
      ['25,200,1440,3180', 'ar', /^بعد 25 دقيقة$|^بعد ٢٥ دقيقة$/, [/^بعد (3|٣) ساعات و(20|٢٠) دقيقة$/, /^بعد (24|٢٤) ساعة$/, /^بعد يومين و(5|٥) ساعات$/]],
      ['1,62,1500,10200', 'ar', 'بعد دقيقة', ['بعد ساعة ودقيقتين', 'بعد يوم وساعة', /^بعد (7|٧) أيام وساعتين$/]],
    ];
    for (const [deviceSkew, label] of [[0, 'right clock'], [3 * 3600000, 'three hours fast'], [-5 * 365 * 86400000, 'five years slow']]) for (const [upcoming, lang, hero, rows] of cases) {
      const query = `view=home&lang=${lang}&serverNow=${SERVER_NOW}&upcoming=${upcoming}`;
      const { page, context } = await openAtServerTime(query, desktop, 'new', SERVER_NOW + deviceSkew);
      const same = (actual, expected, where) => expected instanceof RegExp ? assert.match(actual, expected, where) : assert.equal(actual, expected, where);
      same(await line(page, '[data-next-session] [data-countdown]'), hero, `hero ${label} ${lang}`);
      const shown = await page.locator('[data-section="th-coming"] [data-countdown]').allInnerTexts();
      assert.equal(shown.length, rows.length);
      shown.forEach((text, i) => same(text.trim(), rows[i], `row ${i} ${label} ${lang}`));
      assert.equal(await page.locator('[data-next-session] [data-countdown] bdi').count(), 1, 'isolated from the text around it');
      await context.close();
    }
    const { page, context } = await openAtServerTime(`view=home&serverNow=${SERVER_NOW}&upcoming=2,120`, desktop, 'new', SERVER_NOW + 7 * 3600000);
    assert.equal(await line(page, '[data-next-session] [data-countdown]'), 'in 2 min');
    await page.clock.fastForward(30000); await page.waitForTimeout(50);
    assert.equal(await line(page, '[data-next-session] [data-countdown]'), 'in 2 min', 'no ticking inside the minute');
    await page.clock.fastForward(31000); await page.waitForTimeout(50);
    assert.equal(await line(page, '[data-next-session] [data-countdown]'), 'in 1 min', 'once a minute');
    await page.clock.fastForward(60000); await page.waitForTimeout(50);
    assert.equal(await line(page, '[data-next-session] [data-countdown]'), 'starting now', 'at the start');
    assert.match(await line(page, '[data-section="th-coming"] [data-countdown]'), /^in 1 h 5[89] min$/, 'the rows move with it');
    await context.close();
    const live = await open(desktop, 'view=home', 'new');
    assert.equal(await live.page.locator('[data-next-session][data-happening-now] [data-countdown]').count(), 0, 'not while the class is live');
    assert.equal(await live.page.locator('[data-section="th-coming"] [data-countdown]').count(), 3, 'the rows still have it');
    await live.context.close();
  });

  await step('Screenshots of the frame and Home in New: desktop and phone, light and dark, English and Arabic', async () => {
    for (const theme of ['light', 'dark']) for (const [size, viewport] of [['desktop', desktop], ['phone', phone]]) for (const lang of ['en', 'ar']) for (const [name, query] of [['home', 'view=home'], ['home-next', 'view=home&upcoming=25,200,3180,1440']]) {
      const { page, context } = await open(viewport, `${query}&theme=${theme}&lang=${lang}`, 'new');
      await settle(page);
      await shot(page, `new-${theme}-${size}-${lang}-${name}`);
      await context.close();
    }
    // The menu item being pressed down and the More sheet, for the report.
    const sheet = await open(phone, 'view=home', 'new');
    await sheet.page.locator('[data-bottom-tab="more"]').click(); await sheet.page.locator('[data-more-sheet]').waitFor(); await sheet.page.waitForTimeout(300);
    await shot(sheet.page, 'new-light-phone-en-more-sheet');
    await sheet.context.close();
  });
};
