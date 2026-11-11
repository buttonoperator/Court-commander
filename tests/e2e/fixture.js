// Shared fixture: opens the app offline, exposes helpers that drive it through real taps where it matters
// and through window.cc (the same functions the buttons call) for fast setup.
const base = require('@playwright/test');
const { expect } = base;

const test = base.test.extend({
  app: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route((u) => !u.href.startsWith('http://127.0.0.1'), (r) => r.abort());
    const app = {
      page, errors,
      async open() { await page.goto('/index.html'); await page.waitForFunction(() => window.cc && document.querySelector('.app')); },
      ev: (fn, arg) => page.evaluate(fn, arg),
      view: () => page.evaluate(() => { const v = cc.view; return v && { phase: v.phase, score: v.current && v.current.score, serving: v.current && v.current.serving, setsWon: v.setsWon, n: v.current && v.current.n }; }),
      /** Selects an opponent and auto-fills both lineups through the UI. */
      async prepare({ opponent = 'Tampa Catholic Crusaders', venue = 'Home', format = 'Best of 3' } = {}) {
        await page.click(`.team-card[data-team="${opponent}"]`);
        await page.click(`.segmented[aria-label="Venue"] button:has-text("${venue}")`);
        await page.click(`.segmented[aria-label="Match format"] button:has-text("${format}")`);
        await page.click('[data-testid="autofill"]');
      },
      /** Full start through the coin toss sheet. */
      async start(opts = {}) {
        await app.prepare(opts);
        await page.click('[data-testid="begin-match"]');
        await page.click(`[data-testid="toss-winner-${opts.winner || 'us'}"]`);
        await page.click(`.segmented[aria-label="Toss choice"] button:has-text("${opts.choice || 'Serve'}")`);
        await page.click('[data-testid="confirm-start"]');
        await expect(page.locator('[data-testid="score-us"]')).toBeEnabled();
      },
      /** Rallies through the engine (stat sheet closed), for bulk scoring. */
      points: (winner, n) => page.evaluate(({ winner, n }) => { for (let i = 0; i < n; i++) cc.run('rally', { winner }); cc.setUi({ sheet: null }); }, { winner, n }),
      onCourt: (team) => page.evaluate((t) => [0, 1, 2, 3, 4, 5].map((z) => document.querySelector(`.half-${t} .token[data-zone="${z}"]`)?.dataset.player), team),
      reload: async () => { await page.reload(); await page.waitForFunction(() => window.cc && document.querySelector('.app')); },
    };
    await use(app);
    expect(errors, 'no uncaught page errors').toEqual([]);
  },
});

module.exports = { test, expect };
