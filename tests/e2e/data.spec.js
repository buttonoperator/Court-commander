const fs = require('fs');
const path = require('path');
const os = require('os');
const { test, expect } = require('./fixture');

const V2 = 'courtCommander.v2';
const V1 = 'courtCommanderState_v1';
const fixture = (n) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', n), 'utf8');

test.describe('persistence, migration, backup', () => {
  test('a mid-set match survives a reload exactly', async ({ app }) => {
    await app.open();
    await app.start();
    await app.points('us', 4);
    await app.points('opp', 3);
    await app.page.click('.half-us .token[data-zone="1"]');
    await app.page.locator('#player-sheet .bench-row:not([disabled])').first().click();
    const before = { view: await app.view(), court: await app.onCourt('us'), events: await app.ev(() => cc.doc.match.events.length) };
    await app.ev(() => cc.saveNow());
    await app.reload();
    expect({ view: await app.view(), court: await app.onCourt('us'), events: await app.ev(() => cc.doc.match.events.length) }).toEqual(before);
    await expect(app.page.locator('[data-testid="score-num-us"]')).toHaveText('4');
  });

  test('first launch migrates a v1 save and leaves the v1 key untouched', async ({ app }) => {
    const raw = fixture('v1-live-match.json');
    await app.page.addInitScript(([k, v]) => { if (!localStorage.getItem('cc-test-seeded')) { localStorage.setItem(k, v); localStorage.setItem('cc-test-seeded', '1'); } }, [V1, raw]);
    await app.open();
    expect(await app.ev((k) => localStorage.getItem(k), V1)).toBe(raw);
    const r = await app.ev(() => ({ archive: cc.doc.archive.map((a) => [a.source, a.sets.length, !!a.carriedOver]), presets: cc.doc.presets.map((p) => p.name), opp: cc.doc.teams.find((t) => t.id === cc.doc.selection.oppId).name }));
    expect(r).toEqual({ archive: [['v1', 2, true], ['v1', 1, false]], presets: ['Base 5-1'], opp: 'Opponent 8' });
    await expect(app.page.locator('.toast')).toContainText('brought over');
    await app.page.click('[data-tab="history"]');
    await app.page.locator('[data-testid="replay"]').nth(1).click();
    await expect(app.page.locator('[data-testid="replay-pos"]')).toHaveText('1/8');
  });

  test('corrupt v2 storage starts fresh with seeded teams', async ({ app }) => {
    await app.page.addInitScript((k) => localStorage.setItem(k, '{not json'), V2);
    await app.open();
    expect(await app.ev(() => [cc.doc.match, cc.doc.teams.length > 10])).toEqual([null, true]);
  });

  test('backup download then restore round-trips the whole document', async ({ app }) => {
    await app.open();
    await app.start();
    await app.points('us', 5);
    await app.page.click('[data-testid="open-settings"]');
    const [dl] = await Promise.all([app.page.waitForEvent('download'), app.page.click('[data-testid="backup"]')]);
    expect(dl.suggestedFilename()).toMatch(/^court-commander-backup-.*\.json$/);
    const file = await dl.path();
    await app.page.keyboard.press('Escape');
    await app.points('opp', 7);
    await app.page.click('[data-testid="open-settings"]');
    await app.page.setInputFiles('[data-testid="restore-input"]', file);
    await app.page.click('.dialog [data-action="confirm"]');
    await expect(app.page.locator('.toast')).toContainText('Backup restored');
    expect((await app.view()).score).toEqual({ us: 5, opp: 0 });
  });

  test('a v1 backup file restores through migration', async ({ app }) => {
    await app.open();
    const file = path.join(os.tmpdir(), `cc-v1-${Date.now()}.json`);
    fs.writeFileSync(file, fixture('v1-fresh.json'));
    await app.page.click('[data-testid="open-settings"]');
    await app.page.setInputFiles('[data-testid="restore-input"]', file);
    await app.page.click('.dialog [data-action="confirm"]');
    expect(await app.ev(() => cc.doc.presets.map((p) => p.name))).toEqual(['Base 5-1']);
    fs.rmSync(file);
  });

  test('an unreadable backup is rejected and nothing changes', async ({ app }) => {
    await app.open();
    const file = path.join(os.tmpdir(), `cc-bad-${Date.now()}.json`);
    fs.writeFileSync(file, '{"nope":1}');
    const teams = await app.ev(() => cc.doc.teams.length);
    await app.page.click('[data-testid="open-settings"]');
    await app.page.setInputFiles('[data-testid="restore-input"]', file);
    await expect(app.page.locator('.toast')).toContainText('could not be read');
    expect(await app.ev(() => cc.doc.teams.length)).toBe(teams);
    fs.rmSync(file);
  });

  test('a second tab takes over saving; the first tab stops writing and can take back control', async ({ app, context }) => {
    await app.open();
    await app.start();
    await app.points('us', 2);
    await app.ev(() => cc.saveNow());
    const b = await context.newPage();
    await b.route((u) => !u.href.startsWith('http://127.0.0.1'), (r) => r.abort());
    await b.goto('/index.html');
    await b.waitForFunction(() => window.cc);
    await expect(app.page.locator('#open-elsewhere')).toBeVisible();
    await app.points('us', 3);
    expect(await app.ev(() => cc.saveNow())).toBe(false);
    const stored = await b.evaluate((k) => JSON.parse(localStorage.getItem(k)).match.events.length, V2);
    expect(stored).toBe(3);
    await app.page.click('[data-testid="take-back"]');
    await app.page.waitForFunction(() => window.cc && !document.querySelector('#open-elsewhere'));
    await expect(b.locator('#open-elsewhere')).toBeVisible();
  });

  test('roster import by paste with preview and warnings', async ({ app }) => {
    await app.open();
    await app.page.click('[data-tab="teams"]');
    await app.page.click('[data-testid="open-import"]');
    await app.page.fill('[data-testid="import-text"]', 'Here you go:\n```json\n' + JSON.stringify({ teamName: 'Pasted <b>Prep</b>', roster: [{ name: 'Ann "AB" Bee', jersey: '#8', pos: 'OH' }, { name: 'Cy Dee', jersey: '8' }, { jersey: '3' }] }) + '\n```');
    await app.page.click('[data-testid="import-preview"]');
    await expect(app.page.locator('.warnings')).toContainText('jersey #8 is used by more than one player');
    await app.page.click('[data-testid="import-save"]');
    const t = await app.ev(() => cc.doc.teams.find((x) => x.name === 'Pasted bPrep/b'));
    expect(t.players.map((p) => [p.name, p.jersey, p.roles])).toEqual([['Ann AB Bee', '8', ['OH']], ['Cy Dee', '8', []]]);
    await expect(app.page.locator('.team-line[data-team="Pasted bPrep/b"]')).toHaveCount(1);
  });

  test('editing a roster mid-match does not change the live match', async ({ app }) => {
    await app.open();
    await app.start();
    const name = await app.ev(() => cc.doc.match.teams.us.players[0].name);
    await app.page.click('[data-tab="teams"]');
    await app.page.click('.team-line[data-team="Tampa Prep Varsity 2026"]');
    await expect(app.page.locator('.note')).toContainText('apply from the next match');
    await app.page.locator('.prow:not(.add) .pname').first().fill('Renamed Player');
    await app.page.locator('.prow:not(.add) .pname').first().press('Tab');
    expect(await app.ev(() => cc.doc.match.teams.us.players[0].name)).toBe(name);
  });
});
