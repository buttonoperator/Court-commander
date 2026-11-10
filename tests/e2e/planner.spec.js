const { test, expect } = require('./fixture');

test.describe('lineups tab: both teams and planned subs', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
    await app.prepare();
    await app.page.click('[data-tab="lineups"]');
  });

  test('every rotation shows both teams, each rotated clockwise', async ({ app }) => {
    await expect(app.page.locator('.rot-card')).toHaveCount(6);
    const zone1 = (r, team) => app.page.locator(`.rot-card[data-rotation="${r}"] .half-${team} .token[data-zone="0"]`).getAttribute('data-player');
    const base = await app.ev(() => cc.doc.setup.lineup);
    for (let r = 1; r <= 6; r++) {
      expect(await zone1(r, 'us')).toBe(base.us[r - 1]);
      expect(await zone1(r, 'opp')).toBe(base.opp[r - 1]);
    }
  });

  test('plan a sub for either team; it carries forward; remove it from the note', async ({ app }) => {
    const card = (r) => app.page.locator(`.rot-card[data-rotation="${r}"]`);
    for (const team of ['us', 'opp']) {
      const out = await card(3).locator(`.half-${team} .token[data-zone="3"]`).getAttribute('data-player');
      await card(3).locator(`.half-${team} .token[data-zone="3"]`).click();
      const row = app.page.locator('#plan-sub-sheet .bench-row:not([disabled])').first();
      const incoming = await row.getAttribute('data-player');
      await row.click();
      await expect(card(3).locator(`.half-${team} .token.planned[data-player="${incoming}"]`)).toHaveCount(1);
      // Rotation 4: the same lineup position has moved to zone 3, still the sub, no longer flagged.
      await expect(card(4).locator(`.half-${team} .token[data-zone="2"]`)).toHaveAttribute('data-player', incoming);
      await expect(card(4).locator(`.half-${team} .token.planned`)).toHaveCount(0);
      await expect(card(2).locator(`.half-${team} .token[data-player="${out}"]`)).toHaveCount(1);
    }
    await expect(app.page.locator('[data-testid="sub-notes-3"] li')).toHaveCount(2);
    await expect(app.page.locator('[data-testid="planned-count-opp"]')).toContainText('1/18');
    await app.page.locator('[data-testid="sub-notes-3"] li').first().locator('button').click();
    await expect(app.page.locator('[data-testid="sub-notes-3"] li')).toHaveCount(1);
  });

  test('plan respects the position lock and on-court rule, with reasons shown', async ({ app }) => {
    const card = (r) => app.page.locator(`.rot-card[data-rotation="${r}"]`);
    const starter = await card(2).locator('.half-us .token[data-zone="0"]').getAttribute('data-player');
    await card(2).locator('.half-us .token[data-zone="1"]').click();
    const onCourt = app.page.locator(`#plan-sub-sheet .bench-row[data-player="${starter}"]`);
    await expect(onCourt).toBeDisabled();
    await expect(onCourt).toContainText('already on the court');
  });

  test('saved lineup keeps planned subs and reloads them', async ({ app }) => {
    const card = app.page.locator('.rot-card[data-rotation="2"]');
    await card.locator('.half-us .token[data-zone="4"]').click();
    await app.page.locator('#plan-sub-sheet .bench-row:not([disabled])').first().click();
    await app.page.click('[data-testid="save-preset"]');
    await app.page.fill('.dialog .input', 'Plan A');
    await app.page.click('.dialog [data-action="confirm"]');
    await app.ev(() => cc.updateDoc((d) => ({ ...d, setup: { ...d.setup, plannedSubs: { us: [], opp: [] } } })));
    await expect(app.page.locator('.sub-notes')).toHaveCount(0);
    await app.page.click('.preset-chips .chip:has-text("Plan A")');
    await expect(app.page.locator('[data-testid="sub-notes-2"] li')).toHaveCount(1);
  });
});
