const { test, expect } = require('./fixture');

for (const vp of [{ width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1180, height: 820 }, { width: 1366, height: 1024 }]) {
  test.describe(`layout ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test('no horizontal overflow; score targets are large; whole court visible above the dock', async ({ app }) => {
      await app.open();
      await app.start();
      const r = await app.ev(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect();
        const tokens = [...document.querySelectorAll('.court .token')].map((t) => t.getBoundingClientRect());
        return {
          scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
          us: box('[data-testid="score-us"]'), opp: box('[data-testid="score-opp"]'),
          lowestToken: Math.max(...tokens.map((t) => t.bottom)), dockTop: box('.dock').top,
        };
      });
      expect(r.scrollW).toBeLessThanOrEqual(r.innerW);
      for (const b of [r.us, r.opp]) { expect(b.width).toBeGreaterThanOrEqual(120); expect(b.height).toBeGreaterThanOrEqual(110); }
      expect(r.lowestToken).toBeLessThanOrEqual(r.dockTop);
    });
  });
}

test('long and hostile names fit on court tokens and render as text', async ({ app }) => {
  await app.open();
  const names = ['Alexandria Montgomery-Washington', 'Mary Elizabeth Van Der Heyden', 'Christopher-Alexander Fitzgerald', '<img src=x onerror="window.__pwned=1">Jane Doe'];
  await app.ev((names) => {
    const team = cc.doc.teams.find((t) => t.name.startsWith('Tampa Catholic'));
    cc.updateDoc((d) => ({ ...d, teams: d.teams.map((t) => (t.id === team.id ? { ...t, players: t.players.map((p, i) => (i < names.length ? { ...p, name: names[i].replace(/[<>"]/g, '') } : p)) } : t)) }));
  }, names);
  await app.start();
  await app.page.waitForTimeout(200);
  const bad = await app.ev(() => [...document.querySelectorAll('.tok-name')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
  expect(bad).toEqual([]);
  expect(await app.ev(() => [document.querySelectorAll('.court img').length, window.__pwned])).toEqual([0, undefined]);
});

test('day theme applies and persists', async ({ app }) => {
  await app.open();
  await app.page.click('[data-testid="open-settings"]');
  await app.page.click('.segmented[aria-label="Theme"] button:has-text("Day")');
  expect(await app.ev(() => document.documentElement.dataset.theme)).toBe('day');
  await app.ev(() => cc.saveNow());
  await app.reload();
  expect(await app.ev(() => document.documentElement.dataset.theme)).toBe('day');
});

test('update check reloads when the server copy has a newer app-version; storage untouched', async ({ app }) => {
  let served = 0;
  await app.page.route('**/index.html*', async (route) => {
    served += 1;
    const res = await route.fetch();
    let body = await res.text();
    if (served > 1) body = body.replace(/(<meta name="app-version" content=")[^"]+/, '$1ZZZZ-newer');
    await route.fulfill({ response: res, body });
  });
  await app.page.addInitScript(() => { if (!localStorage.getItem('marker')) localStorage.setItem('marker', '1'); });
  await app.open();
  // 1: first load, 2: the version check, 3: the reload it triggers.
  await expect.poll(() => served, { timeout: 8000 }).toBeGreaterThanOrEqual(3);
  await app.page.waitForFunction(() => window.cc && document.querySelector('meta[name="app-version"]').content === 'ZZZZ-newer');
  expect(await app.ev(() => [localStorage.getItem('marker'), sessionStorage.getItem('cc_update_check_done')])).toEqual(['1', '1']);
});

test('the version check does nothing when versions match, and runs once per session', async ({ app }) => {
  let served = 0;
  await app.page.route('**/index.html*', async (route) => { served += 1; await route.fallback(); });
  await app.open();
  await expect.poll(() => served).toBe(2);
  await app.page.waitForTimeout(800);
  expect(served).toBe(2);
});
