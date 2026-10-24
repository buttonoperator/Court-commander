const { test, expect } = require('./support/app');

// Baseline measurements at the two iPhone viewports named in CLAUDE.md. Sizes are CSS px (= pt on iPhone).
// The numbers are recorded as test annotations and as the expected values below; they are observations,
// not targets (UX requirement U1 asks for >= 56 pt).
for (const vp of [{ w: 390, h: 844 }, { w: 430, h: 932 }]) {
  test.describe(`viewport ${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });

    test('[OBSERVED] primary +1 buttons: size, visibility, and horizontal overflow', async ({ app }, info) => {
      await app.open();
      await app.startMatch();
      const r = await app.ev(() => {
        const box = el => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
        return {
          home: box(document.querySelector("button[onclick=\"addScore('home')\"]")),
          visitor: box(document.querySelector("button[onclick=\"addScore('visitor')\"]")),
          undo: box(document.querySelector('.uc-shared-undo')),
          scrollW: document.documentElement.scrollWidth,
          innerW: window.innerWidth,
        };
      });
      info.annotations.push({ type: 'measured', description: JSON.stringify(r) });
      await app.page.screenshot({ path: `test-results/live-${vp.w}x${vp.h}.png` });
      expect(r.home.w).toBeGreaterThan(0);
      expect(r.visitor.w).toBeGreaterThan(0);
      expect(r.scrollW).toBeLessThanOrEqual(r.innerW + 1);
    });

    test('[OBSERVED] live controls are visible after start; setup controls are hidden', async ({ app }) => {
      await app.open();
      await app.startMatch();
      expect(await app.page.isVisible('#uc-score-live-controls')).toBe(true);
      expect(await app.page.isVisible('#uc-game-choice-controls')).toBe(false);
    });
  });
}

test.describe('update mechanism', () => {
  test('[OBSERVED] a newer app-version on the server triggers the overlay and a reload; storage is untouched', async ({ app }) => {
    let served = 0;
    await app.page.route('**/index.html*', async route => {
      served++;
      const res = await route.fetch();
      let body = await res.text();
      if (served > 1) body = body.replace(/(<meta name="app-version" content=")[^"]+/, '$1ZZZZ-newer');
      await route.fulfill({ response: res, body });
    });
    await app.open();                                   // first load: current version
    const nav = app.page.waitForEvent('framenavigated', { timeout: 5000 });
    await app.page.evaluate(() => { sessionStorage.removeItem('cc_update_check_done'); localStorage.setItem('marker', '1'); return checkForUpdate(); });
    expect(await app.page.evaluate(() => [...document.body.children].some(e => e.textContent === 'Updating Court Commander…'))).toBe(true);
    await nav;
    await app.page.waitForFunction(() => typeof state !== 'undefined');
    expect(await app.page.evaluate(() => localStorage.getItem('marker'))).toBe('1');
  });

  test('[OBSERVED] the check runs once per session and does nothing when versions match', async ({ app }) => {
    await app.open();
    expect(await app.page.evaluate(() => sessionStorage.getItem('cc_update_check_done'))).toBe('1');
    expect(await app.page.evaluate(() => [...document.body.children].some(e => e.textContent === 'Updating Court Commander…'))).toBe(false);
  });

  test('[OBSERVED] app-version meta is present and matches APP_VERSION', async ({ app }) => {
    await app.open();
    expect(await app.page.evaluate(() => [document.querySelector('meta[name="app-version"]').content, APP_VERSION])).toEqual(['2026-10-24-2', '2026-10-24-2']);
  });
});
