const { test, expect } = require('./fixture');

const openTeam = async (app, name) => {
  await app.page.click('[data-tab="teams"]');
  await app.page.click(`.team-line[data-team="${name}"]`);
};

test.describe('MaxPreps roster workflow', () => {
  test('a linked team opens its MaxPreps roster page in a new tab', async ({ app }) => {
    await app.open();
    await openTeam(app, 'Tampa Catholic Crusaders');
    const link = app.page.locator('[data-testid="open-maxpreps"]');
    await expect(link).toHaveAttribute('href', 'https://www.maxpreps.com/fl/tampa/tampa-catholic-crusaders/volleyball/roster/');
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('an unlinked team offers a MaxPreps search; saving any MaxPreps page link normalises it', async ({ app }) => {
    await app.open();
    await openTeam(app, 'Plant Panthers');
    await expect(app.page.locator('[data-testid="find-maxpreps"]')).toHaveAttribute('href', /google\.com\/search\?q=site%3Amaxpreps\.com%20Plant%20Panthers/);
    await app.page.fill('[data-testid="maxpreps-url"]', 'https://www.maxpreps.com/fl/tampa/plant-panthers/volleyball/25-26/schedule/');
    await app.page.press('[data-testid="maxpreps-url"]', 'Enter');
    await expect(app.page.locator('[data-testid="open-maxpreps"]')).toHaveAttribute('href', 'https://www.maxpreps.com/fl/tampa/plant-panthers/volleyball/roster/');
    await app.page.fill('[data-testid="maxpreps-url"]', 'https://example.com/plant');
    await app.page.press('[data-testid="maxpreps-url"]', 'Enter');
    await expect(app.page.locator('.toast')).toContainText('not a MaxPreps team link');
  });

  test('pasting a copied roster table replaces the roster and keeps matched players and their lineup spots', async ({ app }) => {
    await app.open();
    await app.prepare({ opponent: 'Tampa Catholic Crusaders' });
    const before = await app.ev(() => { const t = cc.doc.teams.find((x) => x.id === cc.doc.selection.oppId); return { kept: t.players[0], slot0: cc.doc.setup.lineup.opp[0] }; });
    await openTeam(app, 'Tampa Catholic Crusaders');
    await app.page.click('[data-testid="paste-roster"]');
    const pasted = ['#\tName\tGr.\tPos.\tHt.', `${before.kept.jersey}\t${before.kept.name}\tSr.\tOH\t5'10"`, '41\tNew Transfer\tSo.\tMB\t6\'0"', 'Head Coach\tSomeone Coach'].join('\n');
    await app.page.fill('[data-testid="import-text"]', pasted);
    await app.page.click('[data-testid="import-preview"]');
    await expect(app.page.locator('#import-sheet')).toContainText('Read as a table');
    await expect(app.page.locator('[data-testid="import-save"]')).toHaveText('Replace roster (2 players)');
    await app.page.click('[data-testid="import-save"]');
    const after = await app.ev(() => cc.doc.teams.find((x) => x.id === cc.doc.selection.oppId).players.map((p) => ({ id: p.id, name: p.name, jersey: p.jersey, grade: p.grade })));
    expect(after.length).toBe(2);
    expect(after[0]).toMatchObject({ id: before.kept.id, name: before.kept.name, grade: 'Sr.' });
    expect(after[1]).toMatchObject({ name: 'New Transfer', jersey: '41' });
    await expect(app.page.locator('.toast')).toContainText('roster updated (2 players)');
  });

  test('pasting the link instead of the roster explains what to do', async ({ app }) => {
    await app.open();
    await openTeam(app, 'Tampa Catholic Crusaders');
    await app.page.click('[data-testid="paste-roster"]');
    await app.page.fill('[data-testid="import-text"]', 'https://www.maxpreps.com/fl/tampa/tampa-catholic-crusaders/volleyball/roster/');
    await app.page.click('[data-testid="import-preview"]');
    await expect(app.page.locator('#import-sheet .note.warn')).toContainText('That is a link, not a roster');
  });

  test('general Import also accepts copied roster text as a new opponent', async ({ app }) => {
    await app.open();
    await app.page.click('[data-tab="teams"]');
    await app.page.click('[data-testid="open-import"]');
    await app.page.fill('[data-testid="import-text"]', '3\nAva Stone\nJr.\nOH\n8\nBea Lane\nSr.\nS\n');
    await app.page.click('[data-testid="import-preview"]');
    await expect(app.page.locator('#import-sheet')).toContainText('one field per line');
    await app.page.click('[data-testid="import-save"]');
    expect(await app.ev(() => cc.doc.teams.find((t) => t.name === 'Imported Team').players.map((p) => p.name))).toEqual(['Ava Stone', 'Bea Lane']);
  });
});
