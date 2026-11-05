// The owner's feedback on footer, logo and controls, in Chromium: part of scripts/design-foundation-browser.cjs, which provides the page, the real components and the real stylesheet.
const assert = require('node:assert/strict');

const LOOKS = ['classic', 'new'], THEMES = ['light', 'dark'], LANGS = ['en', 'ar'];
const PREFERENCES = ['support_reply', 'session_starting', 'session_details'];

module.exports = async ({ step, open, box, desktop, phone, shot }) => {
  const treeContrast = (page, svg) => page.locator(svg).first().evaluate(mark => {
    const tree = mark.querySelector('g:last-child path'), fill = /rgb\((\d+), (\d+), (\d+)\)/.exec(getComputedStyle(tree).fill).slice(1).map(Number);
    return Math.min(...window.__h.behind(mark).map(back => window.__h.contrast(fill, back)));
  });

  await step('The logo stands out at 3:1 or more on what is behind it: sidebar, phone header and the opening logo, both looks, both themes; the shape is untouched', async () => {
    for (const look of LOOKS) for (const theme of THEMES) {
      const where = `${look} ${theme}`;
      const wide = await open(desktop, `view=home&theme=${theme}`, look);
      const sidebar = await treeContrast(wide.page, '[data-teacher-sidebar] .d-logo-mark svg');
      assert.ok(sidebar >= 3, `sidebar ${where}: ${sidebar.toFixed(2)}`);
      await wide.context.close();
      const small = await open(phone, `view=home&theme=${theme}`, look);
      const header = await treeContrast(small.page, '[data-teacher-phone-header] .d-logo-mark svg');
      assert.ok(header >= 3, `phone header ${where}: ${header.toFixed(2)}`);
      await small.context.close();
      const logo = await open(desktop, `view=logo&theme=${theme}`, look);
      const opening = await treeContrast(logo.page, '[data-logo-panel] svg');
      assert.ok(opening >= 3, `opening logo ${where}: ${opening.toFixed(2)}`);
      const shape = await logo.page.locator('[data-logo-panel] svg').evaluate(s => [s.getAttribute('viewBox'), s.querySelectorAll('g:last-child path').length]);
      assert.equal(shape[0], '0 0 400 468.8'); assert.ok(shape[1] > 20, 'every piece of the tree');
      await logo.context.close();
    }
  });

  await step('Footer: the credits in the owner\'s order, the second name greyer and still AA; teachers get EduLabs\' help line and a link to support, never the student wording; both looks, themes and languages', async () => {
    for (const look of LOOKS) for (const theme of THEMES) for (const lang of LANGS) {
      const where = `${look} ${theme} ${lang}`;
      const { page, context } = await open(desktop, `view=home&theme=${theme}&lang=${lang}`, look);
      const credits = page.locator('footer [data-credits]');
      assert.equal((await credits.innerText()).replace(/\s+/g, ' '), 'Mohamed Tamer Mohamed & Mohamed Ahmed Yehia', where);
      const colours = await credits.evaluate(c => [c.querySelector('[data-credit="1"]'), c.querySelector('[data-credit="2"]')].map(e => getComputedStyle(e).color));
      assert.notEqual(colours[0], colours[1], 'the second name is greyer: ' + where);
      const line = await page.locator('footer').evaluate(f => { const c = f.querySelector('[data-credits]'), r = window.__h.lowContrast(c); return r; });
      assert.deepEqual(line, [], 'AA: ' + where);
      const order = await credits.evaluate(c => { const a = c.querySelector('[data-credit="1"]').getBoundingClientRect(), b = c.querySelector('[data-credit="2"]').getBoundingClientRect(); return a.left < b.left; });
      assert.equal(order, true, 'reads in the same order in Arabic: ' + where);
      const help = page.locator('[data-footer-help]');
      assert.doesNotMatch(await help.innerText(), /authorized teacher|معلّمك المخوّل/, 'no student wording: ' + where);
      assert.match(await help.innerText(), lang === 'ar' ? /تحتاج إلى مساعدة؟ تواصل مع دعم EduLabs/ : /Need help\? Contact EduLabs support/, where);
      assert.equal(await page.locator('[data-footer-support]').getAttribute('href'), '/support');
      assert.deepEqual(await page.evaluate(() => window.__h.lowContrast(document.querySelector('[data-footer-help]'))), [], 'AA: ' + where);
      if (look === 'new' && lang === 'en') await page.locator('footer').screenshot({ path: require('path').resolve('.local/design-foundation-browser/screenshots', `footer-new-${theme}.png`) });
      await context.close();
      const small = await open(phone, `view=home&theme=${theme}&lang=${lang}`, look);
      assert.equal((await small.page.locator('[data-teacher-phone-footer] [data-credits]').innerText()).replace(/\s+/g, ' '), 'Mohamed Tamer Mohamed & Mohamed Ahmed Yehia', 'phone ' + where);
      assert.deepEqual(await small.page.evaluate(() => window.__h.lowContrast(document.querySelector('[data-teacher-phone-footer]'))), [], 'AA on a phone: ' + where);
      await small.context.close();
    }
  });

  await step('Switch: role, name and state for a screen reader; Space and Enter; visible focus; 44 px; RTL; a disabled one explains itself and does nothing; the thumb moves in New only with motion on', async () => {
    for (const look of LOOKS) for (const theme of THEMES) for (const lang of LANGS) {
      const where = `${look} ${theme} ${lang}`;
      const { page, context } = await open(desktop, `view=controls&theme=${theme}&lang=${lang}`, look);
      const plain = page.getByRole('switch', { name: 'Plain switch', exact: true });
      assert.equal(await plain.getAttribute('aria-checked'), 'false', where);
      const size = await plain.boundingBox(); assert.ok(size.height >= 44 && size.width >= 44, '44 px target: ' + JSON.stringify(size));
      await plain.focus(); await page.keyboard.press('Space');
      assert.equal(await plain.getAttribute('aria-checked'), 'true', 'Space turns it on: ' + where);
      await page.keyboard.press('Enter');
      assert.equal(await plain.getAttribute('aria-checked'), 'false', 'Enter turns it off: ' + where);
      await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
      const ring = await plain.evaluate(e => { const s = getComputedStyle(e); return [s.outlineStyle, parseFloat(s.outlineWidth)]; });
      assert.deepEqual(ring, ['solid', 2], 'focus is visible: ' + where);
      // Where the thumb sits: at the end of the track in the reading direction.
      await plain.click(); await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
      const place = await plain.evaluate(e => { const t = e.querySelector('.d-switch-track').getBoundingClientRect(), h = e.querySelector('.d-switch-thumb').getBoundingClientRect(); return { fromLeft: h.left - t.left, fromRight: t.right - h.right }; });
      if (lang === 'ar') assert.ok(place.fromLeft < 6, 'on is at the left in Arabic: ' + JSON.stringify(place)); else assert.ok(place.fromRight < 6, 'on is at the right in English: ' + JSON.stringify(place));
      // Non-text contrast of both states.
      const parts = await plain.evaluate(e => { const read = () => { const track = getComputedStyle(e.querySelector('.d-switch-track')), thumb = getComputedStyle(e.querySelector('.d-switch-thumb')); return { border: track.borderTopColor, fill: track.backgroundColor, thumb: thumb.backgroundColor }; }; const rgb = c => /rgb\((\d+), (\d+), (\d+)\)/.exec(c).slice(1).map(Number), back = window.__h.behind(e)[0], r = read(); return { thumbOnFill: window.__h.contrast(rgb(r.thumb), rgb(r.fill)), edge: window.__h.contrast(rgb(r.border), back) }; });
      assert.ok(parts.thumbOnFill >= 3, 'on: thumb on track ' + parts.thumbOnFill.toFixed(2) + ' ' + where); assert.ok(parts.edge >= 3, 'on: track on page ' + parts.edge.toFixed(2) + ' ' + where);
      await page.keyboard.press('Space'); await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
      const offParts = await plain.evaluate(e => { const track = getComputedStyle(e.querySelector('.d-switch-track')), thumb = getComputedStyle(e.querySelector('.d-switch-thumb')), rgb = c => /rgb\((\d+), (\d+), (\d+)\)/.exec(c).slice(1).map(Number), back = window.__h.behind(e)[0]; return { thumbOnFill: window.__h.contrast(rgb(thumb.backgroundColor), rgb(track.backgroundColor)), edge: window.__h.contrast(rgb(track.borderTopColor), back) }; });
      assert.ok(offParts.thumbOnFill >= 3, 'off: thumb on track ' + offParts.thumbOnFill.toFixed(2) + ' ' + where); assert.ok(offParts.edge >= 3, 'off: track on page ' + offParts.edge.toFixed(2) + ' ' + where);
      // An aria-label wins, so a row of the same words still says which is which.
      assert.equal(await page.getByRole('switch', { name: 'A full spoken name', exact: true }).count(), 1);
      // Disabled: reachable, says why, does nothing.
      const off = page.locator('[data-switch="off"]');
      assert.ok((await off.boundingBox()).width < 320, 'a switch with a reason keeps its own width, and its focus ring with it');
      assert.equal(await off.getAttribute('aria-disabled'), 'true');
      assert.equal(await off.evaluate(e => e.tabIndex), 0, 'a person can reach it and hear why');
      const reason = await off.evaluate(e => document.getElementById(e.getAttribute('aria-describedby')).textContent);
      assert.equal(reason, 'Synthetic reason it is off');
      await off.click({ force: true }); await off.focus(); await page.keyboard.press('Space');
      assert.equal(await off.getAttribute('aria-checked'), 'false'); assert.equal(await page.evaluate(() => window.__wrong), undefined);
      if (look === 'new' && lang === 'ar' && theme === 'dark') await shot(page, 'controls-new-dark-ar');
      if (look === 'new' && lang === 'en' && theme === 'light') await shot(page, 'controls-new-light-en');
      if (look === 'classic' && lang === 'en' && theme === 'light') await shot(page, 'controls-classic-light-en');
      await context.close();
    }
    const moving = async (look, extra) => {
      const { page, context } = await open(desktop, 'view=controls', look, extra);
      const r = await page.evaluate(() => { const s = document.querySelector('[data-switch="plain"]'); s.click(); return new Promise(done => requestAnimationFrame(() => done(document.getAnimations().filter(a => a.effect.target.classList?.contains('d-switch-thumb') && a.effect.target.closest('[data-switch="plain"]')).map(a => [a.transitionProperty, a.effect.getTiming().duration])))); });
      await context.close(); return r;
    };
    assert.deepEqual(await moving('new'), [['transform', 120]], 'New moves the thumb');
    assert.deepEqual(await moving('classic'), [], 'Classic does not');
    assert.deepEqual(await moving('new', { reducedMotion: 'reduce' }), [], 'neither with reduced motion');
  });

  await step('Choice: radiogroup and radios, one tab stop, Space and Enter choose, arrow keys move and choose, mirrored in Arabic; a disabled group explains itself; phone width stays in the page', async () => {
    for (const look of LOOKS) for (const lang of LANGS) {
      const where = `${look} ${lang}`;
      const { page, context } = await open(desktop, `view=controls&lang=${lang}`, look);
      const group = page.locator('[data-choices="plain"]');
      assert.equal(await group.getAttribute('role'), 'radiogroup');
      const radios = group.getByRole('radio'), state = () => radios.evaluateAll(r => r.map(e => e.getAttribute('aria-checked')));
      assert.deepEqual(await state(), ['true', 'false', 'false'], where);
      assert.deepEqual(await radios.evaluateAll(r => r.map(e => e.tabIndex)), [0, -1, -1], 'one tab stop');
      assert.ok((await radios.first().boundingBox()).height >= 44);
      await radios.first().focus();
      await page.keyboard.press(lang === 'ar' ? 'ArrowLeft' : 'ArrowRight');
      assert.deepEqual(await state(), ['false', 'true', 'false'], 'the next one in the reading direction: ' + where);
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-checked')), 'true', 'focus moved with it');
      await page.keyboard.press('ArrowDown'); assert.deepEqual(await state(), ['false', 'false', 'true']);
      await page.keyboard.press('ArrowDown'); assert.deepEqual(await state(), ['true', 'false', 'false'], 'wraps round');
      await page.keyboard.press('ArrowUp'); assert.deepEqual(await state(), ['false', 'false', 'true']);
      await radios.nth(1).evaluate(e => e.focus()); await page.keyboard.press('Space'); assert.deepEqual(await state(), ['false', 'true', 'false'], 'Space chooses');
      await radios.first().evaluate(e => e.focus()); await page.keyboard.press('Enter'); assert.deepEqual(await state(), ['true', 'false', 'false'], 'Enter chooses');
      const ring = await radios.first().evaluate(e => getComputedStyle(e).outlineStyle); assert.equal(ring, 'solid', 'visible focus');
      const description = await radios.first().evaluate(e => document.getElementById(e.getAttribute('aria-describedby')).textContent); assert.equal(description, 'First line', 'the line is read with it');
      const off = page.locator('[data-choices="off"]');
      assert.equal(await off.getAttribute('aria-disabled'), 'true');
      assert.equal(await off.evaluate(e => document.getElementById(e.getAttribute('aria-describedby')).textContent), 'Synthetic reason the choice is off');
      await off.getByRole('radio').nth(1).click({ force: true }); assert.equal(await page.evaluate(() => window.__wrong), undefined);
      await context.close();
      const small = await open(phone, `view=controls&lang=${lang}`, look);
      assert.equal(await small.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no sideways scroll: ' + where);
      await small.context.close();
    }
  });

  await step('Select: a combobox and a listbox for a screen reader, the keyboard and the mouse, a disabled row cannot be chosen, it works inside a dialog; the wrapping label names it', async () => {
    for (const look of LOOKS) for (const lang of LANGS) {
      const where = `${look} ${lang}`;
      const { page, context } = await open(desktop, `view=controls&lang=${lang}`, look);
      const select = page.getByRole('combobox', { name: /Synthetic list/ });
      assert.equal(await select.getAttribute('aria-haspopup'), 'listbox', where);
      assert.equal(await select.getAttribute('aria-expanded'), 'false');
      assert.equal(await select.getAttribute('data-value'), 'two');
      assert.ok((await select.boundingBox()).height >= 44);
      await select.focus(); await page.keyboard.press('Enter');
      const list = page.getByRole('listbox'); await list.waitFor();
      assert.equal(await select.getAttribute('aria-expanded'), 'true');
      assert.equal(await select.getAttribute('aria-controls'), await list.getAttribute('id'), 'the button points at its list');
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'listbox', 'the keyboard is in the list');
      const current = () => list.evaluate(l => document.getElementById(l.getAttribute('aria-activedescendant')).dataset.value);
      assert.equal(await current(), 'two', 'starts on the chosen row');
      await page.keyboard.press('ArrowDown'); assert.equal(await current(), 'three', 'skips the disabled row');
      await page.keyboard.press('Home'); assert.equal(await current(), 'one');
      await page.keyboard.press('End'); assert.equal(await current(), 'three');
      await page.keyboard.type('tw'); assert.equal(await current(), 'two', 'typing finds a row');
      await page.keyboard.press('Escape'); await list.waitFor({ state: 'detached' });
      assert.equal(await select.getAttribute('data-value'), 'two', 'Escape changes nothing');
      await page.waitForFunction(() => document.activeElement.dataset.select === 'plain', null, { timeout: 2000 }); // Radix hands focus back just after it unmounts
      await page.keyboard.press('ArrowDown'); await list.waitFor(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await list.waitFor({ state: 'detached' });
      assert.equal(await select.getAttribute('data-value'), 'three', 'Enter chooses');
      await select.click(); await list.waitFor();
      await page.locator('[role="option"][data-value="locked"]').click({ force: true });
      assert.equal(await select.getAttribute('data-value'), 'three', 'a disabled row cannot be chosen'); assert.equal(await page.locator('[role="option"][data-value="locked"]').getAttribute('aria-disabled'), 'true');
      await page.locator('[role="option"][data-value="one"]').click(); await list.waitFor({ state: 'detached' });
      assert.equal(await select.getAttribute('data-value'), 'one', 'the mouse chooses');
      if (look === 'new' && lang === 'ar') { await select.click(); await list.waitFor(); await shot(page, 'select-open-new-ar'); await page.keyboard.press('Escape'); await list.waitFor({ state: 'detached' }); }
      await page.locator('[data-open-select-dialog]').click();
      const inDialog = page.locator('[data-select="dialog"]'); await inDialog.waitFor();
      await inDialog.click(); await list.waitFor(); await page.locator('[role="option"][data-value="three"]').click();
      assert.equal(await inDialog.getAttribute('data-value'), 'three', 'inside a dialog');
      assert.equal(await page.getByRole('dialog').count(), 1, 'choosing does not close the dialog');
      await context.close();
    }
  });

  const answers = { publicKey: 'c3ludGhldGlj' };
  const notificationsRoute = (key, saved = []) => page => page.route('**/api/communications', r => {
    const body = JSON.parse(r.request().postData());
    saved.push(body);
    const reply = body.action === 'preferences' ? PREFERENCES.map(event_type => ({ event_type, in_app: true, push: false })) : body.action === 'push-config' ? { publicKey: key } : body.action === 'list' ? { rows: [], unread: 0, page: 0 } : { ok: true };
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });

  await step('Notifications and the language page have no native checkbox, radio or select; preferences are named switches; browser push is one switch with its status line, off with an explanation when push is not configured', async () => {
    for (const look of LOOKS) for (const theme of THEMES) for (const lang of LANGS) {
      const where = `${look} ${theme} ${lang}`;
      const saved = [];
      const { page, context } = await open(desktop, `view=notifications&theme=${theme}&lang=${lang}`, look, { beforeGoto: notificationsRoute(null, saved) });
      const browserPush = page.locator('[data-browser-push]'); await browserPush.waitFor();
      await page.waitForFunction(() => document.querySelectorAll('[data-pref-event]').length > 0);
      assert.equal(await page.locator('main input[type="checkbox"], main input[type="radio"], main select').count(), 0, 'no native control: ' + where);
      assert.equal(await browserPush.getAttribute('role'), 'switch');
      assert.equal(await browserPush.getAttribute('aria-disabled'), 'true', 'not configured: off, ' + where);
      const status = await page.locator('[data-browser-push-status]').innerText();
      assert.ok(status.length > 10); assert.equal(await browserPush.getAttribute('aria-describedby'), await page.locator('[data-browser-push-status]').getAttribute('id'), 'the explanation is tied to it');
      const rows = page.locator('[data-pref-kind="in-app"]'), count = await rows.count();
      assert.ok(count >= 3); assert.equal(await page.locator('[data-pref-kind="push"]').count(), count, 'one pair per event');
      const name = await rows.first().getAttribute('aria-label'); assert.ok(name.includes(lang === 'ar' ? 'داخل التطبيق' : 'In-app'), 'names the event and the kind: ' + name);
      assert.notEqual(name, lang === 'ar' ? 'داخل التطبيق' : 'In-app', 'not the kind alone');
      assert.equal(await page.locator('[data-pref-kind="push"]').first().getAttribute('aria-disabled'), 'true', 'per event push waits for the configuration too');
      await rows.first().click();
      await page.waitForFunction(() => document.querySelector('[data-pref-kind="in-app"]').getAttribute('aria-disabled') !== 'true');
      const write = saved.find(b => b.action === 'preference'); assert.ok(write, 'the same call as before'); assert.equal(write.data.inApp, false); assert.equal(write.data.push, false);
      if (look === 'new' && lang === 'en') await shot(page, `notifications-new-${theme}-en`);
      if (look === 'new' && lang === 'ar' && theme === 'light') await shot(page, 'notifications-new-light-ar');
      await context.close();
    }
    const configured = await open(phone, 'view=notifications&lang=ar', 'new', { beforeGoto: notificationsRoute(answers.publicKey) });
    await configured.page.locator('[data-pref-kind="push"]').first().waitFor();
    assert.equal(await configured.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no sideways scroll on a phone');
    await configured.page.waitForFunction(() => document.querySelector('[data-pref-kind="push"]').getAttribute('aria-disabled') !== 'true');
    await shot(configured.page, 'notifications-new-light-ar-phone');
    await configured.context.close();
    for (const look of LOOKS) for (const lang of LANGS) {
      const { page, context } = await open(desktop, `view=language&lang=${lang}`, look);
      await page.locator('[data-design-switch]').waitFor();
      assert.equal(await page.locator('main input[type="checkbox"], main input[type="radio"], main select').count(), 0, 'no native control: ' + look + ' ' + lang);
      assert.equal(await page.getByRole('radio', { name: 'English', exact: true }).count(), 1);
      assert.equal(await page.getByRole('radio', { name: 'العربية', exact: true }).count(), 1);
      assert.ok(await page.getByRole('radio').count() >= 7, 'language, appearance and look');
      if (look === 'new' && lang === 'en') await shot(page, 'language-page-new-en');
      await context.close();
    }
  });

  assert.ok(box);
};
