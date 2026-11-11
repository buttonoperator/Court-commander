const { test, expect } = require('./fixture');

test.describe('match flow through the UI', () => {
  test('setup requires a venue and six players before the toss', async ({ app }) => {
    await app.open();
    await app.page.click('[data-testid="begin-match"]');
    await expect(app.page.locator('.toast')).toContainText('Home or Away');
    await expect(app.page.locator('#toss-sheet')).toHaveCount(0);
  });

  test('toss: caller follows venue; winner serve gives the ball to that team', async ({ app }) => {
    await app.open();
    await app.prepare({ venue: 'Away' });
    await app.page.click('[data-testid="begin-match"]');
    await expect(app.page.locator('#toss-rule')).toContainText('visiting captain (Tampa Prep Varsity 2026)');
    await app.page.click('[data-testid="toss-winner-opp"]');
    await app.page.click('.segmented[aria-label="Toss choice"] button:has-text("Serve")');
    await app.page.click('[data-testid="confirm-start"]');
    expect(await app.view()).toMatchObject({ phase: 'live', serving: 'opp', score: { us: 0, opp: 0 } });
    await expect(app.page.locator('.half-opp .token.serving[data-zone="0"]')).toHaveCount(1);
  });

  test('tapping a score card awards one point and the stat sheet records a kill with assist', async ({ app }) => {
    await app.open();
    await app.start();
    const court = await app.onCourt('us');
    await app.page.click('[data-testid="score-us"]');
    await expect(app.page.locator('[data-testid="score-num-us"]')).toHaveText('1');
    await app.page.click('#rally-sheet .how[data-code="K"]');
    await app.page.click(`#rally-sheet .pbtn[data-player="${court[3]}"]`);
    await app.page.click(`#rally-sheet .pbtn[data-player="${court[2]}"]`);
    await expect(app.page.locator('#rally-sheet')).toHaveCount(0);
    const r = await app.ev(() => cc.view.current.rallies[0]);
    expect([r.winner, r.code, r.actor, r.assist]).toEqual(['us', 'K', court[3], court[2]]);
  });

  test('side-out rotates the receiving team clockwise and moves the serve', async ({ app }) => {
    await app.open();
    await app.start();
    const before = await app.onCourt('opp');
    await app.page.click('[data-testid="score-opp"]');
    await app.page.click('#rally-sheet .how[data-code="SKIP"]');
    expect(await app.onCourt('opp')).toEqual([...before.slice(1), before[0]]);
    expect((await app.view()).serving).toBe('opp');
  });

  test('undo reverts the point AND its stats; redo restores it', async ({ app }) => {
    await app.open();
    await app.start();
    await app.page.click('[data-testid="score-us"]');
    await app.page.click('#rally-sheet .how[data-code="ACE"]');
    await app.page.click('#rally-sheet .pbtn.skip');
    const aces = () => app.ev(() => cc.view.current.rallies.filter((r) => r.code === 'ACE').length);
    expect(await aces()).toBe(1);
    await app.page.click('[data-testid="undo"]');
    expect((await app.view()).score).toEqual({ us: 0, opp: 0 });
    expect(await aces()).toBe(0);
    await app.page.click('[data-testid="redo"]');
    expect(await aces()).toBe(1);
  });

  test('substitution through the player sheet; position lock shown on the bench', async ({ app }) => {
    await app.open();
    await app.start();
    const court = await app.onCourt('us');
    await app.page.click('.half-us .token[data-zone="2"]');
    const firstBench = app.page.locator('#player-sheet .bench-row:not([disabled])').first();
    const incoming = await firstBench.getAttribute('data-player');
    await firstBench.click();
    expect((await app.onCourt('us'))[2]).toBe(incoming);
    await expect(app.page.locator('[data-testid="subs-us"]')).toHaveText('SUB 1/18');
    // The replaced starter may only return to their own lineup position.
    await app.page.click('.half-us .token[data-zone="4"]');
    const row = app.page.locator(`#player-sheet .bench-row[data-player="${court[2]}"]`);
    await expect(row).toBeDisabled();
    await expect(row).toContainText('lineup position 3');
  });

  test('timeout: counted, clock shown, limit enforced', async ({ app }) => {
    await app.open();
    await app.start();
    for (let i = 0; i < 2; i++) {
      await app.page.click('[data-testid="timeout"]');
      await app.page.click('[data-testid="timeout-us"]');
      await expect(app.page.locator('.timeout-card')).toBeVisible();
      await app.page.click('.timeout-card button:has-text("Resume play")');
    }
    await app.page.click('[data-testid="timeout"]');
    await expect(app.page.locator('[data-testid="timeout-us"]')).toBeDisabled();
  });

  test('a set ends at 25 win-by-2; deuce continues; between-set screen starts set 2 with alternated serve', async ({ app }) => {
    await app.open();
    await app.start();
    await app.points('us', 24);
    await app.points('opp', 24);
    expect((await app.view()).phase).toBe('live');
    await app.points('us', 1);
    expect((await app.view()).phase).toBe('live');
    await app.points('us', 1);
    expect(await app.view()).toMatchObject({ phase: 'between', setsWon: { us: 1, opp: 0 } });
    await expect(app.page.locator('.set-result')).toContainText('26');
    await app.page.click('[data-testid="start-next-set"]');
    await expect(app.page.locator('#toss-sheet')).toContainText('serves first in set 2');
    await app.page.click('[data-testid="confirm-start"]');
    expect(await app.view()).toMatchObject({ phase: 'live', n: 2, serving: 'opp' });
  });

  test('best of 3 decided at 2-0; saved to history; replay steps through rallies', async ({ app }) => {
    await app.open();
    await app.start();
    await app.points('us', 25);
    await app.page.click('[data-testid="start-next-set"]');
    await app.page.click('[data-testid="confirm-start"]');
    await app.points('us', 25);
    await expect(app.page.locator('.decided')).toContainText('Match won');
    await app.page.click('[data-testid="finish-match"]');
    await expect(app.page.locator('[data-testid="season-record"]')).toContainText('1–0');
    expect(await app.ev(() => [cc.doc.match, cc.doc.archive.length])).toEqual([null, 1]);
    await app.page.click('[data-testid="replay"]');
    await expect(app.page.locator('[data-testid="replay-pos"]')).toHaveText('1/50');
    await app.page.click('[data-testid="replay-next"]');
    await expect(app.page.locator('[data-testid="replay-pos"]')).toHaveText('2/50');
  });

  test('deciding set requires a second toss', async ({ app }) => {
    await app.open();
    await app.start();
    await app.points('us', 25);
    await app.page.click('[data-testid="start-next-set"]');
    await app.page.click('[data-testid="confirm-start"]');
    await app.points('opp', 25);
    await app.page.click('[data-testid="start-next-set"]');
    await expect(app.page.locator('#toss-rule')).toContainText('home captain');
    await app.page.click('[data-testid="toss-winner-opp"]');
    await app.page.click('.segmented[aria-label="Toss choice"] button:has-text("Side of court")');
    await app.page.click('[data-testid="first-server-us"]');
    expect(await app.view()).toMatchObject({ phase: 'live', n: 3, serving: 'us' });
    await app.ev(() => { for (let i = 0; i < 8; i++) cc.scorePoint('us'); cc.setUi({ sheet: null }); });
    await expect(app.page.locator('.toast').filter({ hasText: 'Switch sides' })).toHaveCount(1);
  });

  test('libero: in for a back-row player, not a sub, out on demand', async ({ app }) => {
    await app.open();
    await app.prepare();
    await app.page.click('.libero-pick button:has-text("Pinzon")');
    await app.page.click('[data-testid="begin-match"]');
    await app.page.click('[data-testid="toss-winner-us"]');
    await app.page.click('.segmented[aria-label="Toss choice"] button:has-text("Serve")');
    await app.page.click('[data-testid="confirm-start"]');
    await app.page.click('.half-opp .token[data-zone="2"]');
    await expect(app.page.locator('[data-testid="libero-in"]')).toBeDisabled();
    await app.page.keyboard.press('Escape');
    await app.page.click('.half-opp .token[data-zone="4"]');
    await app.page.click('[data-testid="libero-in"]');
    await expect(app.page.locator('.half-opp .token.libero[data-zone="4"]')).toHaveCount(1);
    await expect(app.page.locator('[data-testid="subs-opp"]')).toHaveText('SUB 0/18');
    await app.page.click('.half-opp .token[data-zone="4"]');
    await app.page.click('[data-testid="libero-out"]');
    await expect(app.page.locator('.half-opp .token.libero')).toHaveCount(0);
  });

  test('keyboard: arrows score, cmd+z undoes', async ({ app }) => {
    await app.open();
    await app.ev(() => cc.updateDoc((d) => ({ ...d, settings: { ...d.settings, statPrompt: false } })));
    await app.start();
    await app.page.keyboard.press('ArrowLeft');
    await app.page.keyboard.press('ArrowRight');
    await app.page.keyboard.press('ArrowRight');
    expect((await app.view()).score).toEqual({ us: 1, opp: 2 });
    await app.page.keyboard.press('Control+z');
    expect((await app.view()).score).toEqual({ us: 1, opp: 1 });
  });

  test('stats tab shows the box score and exports CSV', async ({ app }) => {
    await app.open();
    await app.start();
    await app.points('us', 3);
    await app.page.click('[data-tab="stats"]');
    await expect(app.page.locator('.kpi-card').first()).toBeVisible();
    const [dl] = await Promise.all([app.page.waitForEvent('download'), app.page.click('[data-testid="export-csv"]')]);
    expect(dl.suggestedFilename()).toMatch(/^tampa-prep-varsity-2026-vs-tampa-catholic-crusaders-.*\.csv$/);
  });
});

test.describe('setup lineup feedback', () => {
  test('tapping the opponent side with no opponent chosen explains why', async ({ app }) => {
    await app.open();
    await app.page.click('.lineup-editor .half-opp .token[data-zone="0"]');
    await expect(app.page.locator('.toast')).toContainText('Pick the opponent above');
    await expect(app.page.locator('#pick-sheet')).toHaveCount(0);
  });

  test('a team with no players says so and links to Teams', async ({ app }) => {
    await app.open();
    await app.ev(() => cc.updateDoc((d) => ({ ...d, teams: d.teams.map((t) => (t.id === d.selection.usId ? { ...t, players: [] } : t)) })));
    await app.page.click('.lineup-editor .half-us .token[data-zone="0"]');
    await expect(app.page.locator('#pick-sheet')).toContainText('has no players yet');
    await app.page.click('[data-testid="go-teams"]');
    await expect(app.page.locator('.teams')).toBeVisible();
  });

  test('every court spot on the setup screen can be filled by tapping', async ({ app }) => {
    await app.open();
    await app.page.click('.team-card[data-team="Tampa Catholic Crusaders"]');
    for (const team of ['us', 'opp']) {
      for (let z = 0; z < 6; z++) {
        await app.page.click(`.lineup-editor .half-${team} .token[data-zone="${z}"]`);
        await app.page.locator('#pick-sheet .pick:not(:has-text("in Z"))').first().click();
      }
    }
    expect(await app.ev(() => [cc.doc.setup.lineup.us.filter(Boolean).length, cc.doc.setup.lineup.opp.filter(Boolean).length])).toEqual([6, 6]);
  });
});

test('opponent picker collapses to one row after choosing, and Change reopens it', async ({ app }) => {
  await app.open();
  await expect(app.page.locator('.team-grid')).toBeVisible();
  await app.page.click('.team-card[data-team="Tampa Catholic Crusaders"]');
  await expect(app.page.locator('.team-grid')).toHaveCount(0);
  await expect(app.page.locator('[data-testid="opponent-summary"]')).toContainText('Tampa Catholic Crusaders');
  await app.page.click('[data-testid="change-opponent"]');
  await app.page.click('.team-card[data-team="Plant Panthers"]');
  await expect(app.page.locator('[data-testid="opponent-summary"]')).toContainText('Plant Panthers');
  // Choosing "Unlisted" also collapses; tapping a placeholder spot reopens the list.
  await app.page.click('[data-testid="change-opponent"]');
  await app.page.click('.team-card[data-team="unlisted"]');
  await expect(app.page.locator('[data-testid="opponent-summary"]')).toContainText('Unlisted opponent');
  await app.page.click('.lineup-editor .half-opp .token[data-zone="0"]');
  await expect(app.page.locator('.team-grid')).toBeVisible();
});
