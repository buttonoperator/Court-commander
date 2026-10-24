const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('./support/app');

// Unified roster import: native envelopes, looser screenshot-derived shapes,
// pasted text, and the safety guards. Format reference: docs/roster-json-format.md

const bankNames = () => page => page.evaluate(() => state.visitorTeamBank.map(t => t.name));
const findTeam = (app, name) => app.ev(n => state.visitorTeamBank.find(t => t.name === n) || null, name);
const importText = (app, text) => app.ev(t => { state.currentTeam = 'visitor'; return processRosterImportText(t); }, text);

test.describe('roster import', () => {
  test('[OBSERVED] native single-roster envelope imports into the open team bank', async ({ app }) => {
    await app.open();
    const before = await app.ev(() => state.visitorTeamBank.length);
    const ok = await importText(app, JSON.stringify({
      type: 'court-commander-roster', version: 1, teamName: 'Example High',
      roster: [
        { name: 'Jane Doe', jersey: '12', position: 'Setter', grade: 'Jr.', libero: false },
        { name: 'Alex Roe', jersey: '3', position: 'Libero', grade: 'Sr.', libero: true },
      ],
    }));
    expect(ok).toBe(true);
    expect(await app.ev(() => state.visitorTeamBank.length)).toBe(before + 1);
    const t = await findTeam(app, 'Example High');
    expect(t.roster).toEqual([
      { name: 'Jane Doe', jersey: '12', position: 'Setter', grade: 'Jr.', libero: false },
      { name: 'Alex Roe', jersey: '3', position: 'Libero', grade: 'Sr.', libero: true },
    ]);
    // The preview confirm listed the players.
    const confirmed = app.dialogs.find(d => d.type === 'confirm');
    expect(confirmed.message).toContain('#12 Jane Doe');
  });

  test('[OBSERVED] native team-bank envelope imports every team', async ({ app }) => {
    await app.open();
    await importText(app, JSON.stringify({
      type: 'court-commander-team-bank', version: 1,
      teams: [
        { name: 'Alpha Prep', roster: [{ name: 'A One', jersey: '1' }] },
        { name: 'Beta Prep', roster: [{ name: 'B Two', jersey: '2' }] },
      ],
    }));
    expect(await findTeam(app, 'Alpha Prep')).not.toBeNull();
    expect(await findTeam(app, 'Beta Prep')).not.toBeNull();
    expect(app.lastDialog().message).toContain('Imported: 2 new team(s)');
  });

  test('[OBSERVED] screenshot-style bare array with aliases is normalized', async ({ app }) => {
    await app.open();
    await importText(app, JSON.stringify([
      { player: 'Jane Doe', '#': '#12', pos: 'OH', year: '11' },
      { firstName: 'Kim', lastName: 'Lee', number: 7, pos: 'Opp', class: 'Senior' },
      { name: 'Sam Ray', num: '4', pos: 'L' },
      '9 Pat Quinn',
    ]));
    const t = await findTeam(app, 'Imported Team');
    expect(t.roster).toEqual([
      { name: 'Jane Doe', jersey: '12', position: 'Outside Hitter', grade: 'Jr.', libero: false },
      { name: 'Kim Lee', jersey: '7', position: 'Right Side', grade: 'Sr.', libero: false },
      { name: 'Sam Ray', jersey: '4', position: 'Libero', grade: '', libero: true },
      { name: 'Pat Quinn', jersey: '9', position: '', grade: '', libero: false },
    ]);
  });

  test('[OBSERVED] object without type, using players and team keys, is accepted', async ({ app }) => {
    await app.open();
    await importText(app, JSON.stringify({ team: 'No Type FC', players: [{ name: 'Zed Hall', jersey: '5', position: 'DS' }] }));
    const t = await findTeam(app, 'No Type FC');
    expect(t.roster).toEqual([{ name: 'Zed Hall', jersey: '5', position: '', grade: '', libero: false }]);
  });

  test('[OBSERVED] pasted chat reply with a json fence and surrounding text is accepted', async ({ app }) => {
    await app.open();
    const reply = 'Here is the roster:\n```json\n' +
      JSON.stringify({ type: 'court-commander-roster', version: 1, teamName: 'Fenced High', roster: [{ name: 'Lou Day', jersey: '2' }] }, null, 2) +
      '\n```\nLet me know if anything looks off.';
    expect(await importText(app, reply)).toBe(true);
    expect((await findTeam(app, 'Fenced High')).roster).toHaveLength(1);
  });

  test('[OBSERVED] Paste JSON box imports through the UI and clears itself', async ({ app }) => {
    await app.open();
    await app.ev(() => openRoster('visitor'));
    await app.page.click('#roster-paste-toggle-btn');
    await expect(app.page.locator('#roster-paste-box')).toBeVisible();
    await app.page.fill('#roster-paste-input', JSON.stringify({ teamName: 'Pasted United', roster: [{ name: 'Ann Bee', jersey: '8' }] }));
    await app.page.click('#roster-paste-import-btn');
    expect((await findTeam(app, 'Pasted United')).roster).toHaveLength(1);
    expect(await app.page.inputValue('#roster-paste-input')).toBe('');
  });

  test('[OBSERVED] file picker import uses the same path as paste', async ({ app }) => {
    await app.open();
    await app.ev(() => openRoster('visitor'));
    const file = path.join(os.tmpdir(), `cc-roster-import-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ teamName: 'File FC', roster: [{ name: 'Fay Gee', jersey: '6' }] }));
    await app.page.setInputFiles('#roster-import-input', file);
    await expect.poll(() => findTeam(app, 'File FC')).not.toBeNull();
    fs.unlinkSync(file);
  });

  test('[OBSERVED] export then import round-trips a roster', async ({ app }) => {
    await app.open();
    const [dl] = await Promise.all([app.page.waitForEvent('download'), app.ev(() => exportRoster('home'))]);
    const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    exported.teamName = 'Round Trip';
    await importText(app, JSON.stringify(exported));
    const t = await findTeam(app, 'Round Trip');
    expect(t.roster).toEqual(exported.roster);
  });

  test('[OBSERVED] warnings: skipped nameless rows and duplicate jerseys appear in the preview', async ({ app }) => {
    await app.open();
    await importText(app, JSON.stringify({ teamName: 'Warn Prep', roster: [
      { name: 'Dee One', jersey: '5' }, { name: 'Eve Two', jersey: '5' }, { jersey: '9' },
    ] }));
    const msg = app.dialogs.find(d => d.type === 'confirm').message;
    expect(msg).toContain('1 entry without a name skipped');
    expect(msg).toContain('jersey #5 is used by more than one player');
    expect((await findTeam(app, 'Warn Prep')).roster).toHaveLength(2);
  });

  test('[OBSERVED] invalid JSON and unrecognized shapes alert and save nothing', async ({ app }) => {
    await app.open();
    const before = await app.ev(() => state.visitorTeamBank.length);
    expect(await importText(app, 'not json at all')).toBe(false);
    expect(app.lastDialog().message).toBe('That is not valid JSON.');
    app.clearDialogs();
    expect(await importText(app, JSON.stringify({ hello: 'world' }))).toBe(false);
    expect(app.lastDialog().message).toContain("doesn't look like a Court Commander roster");
    expect(await importText(app, JSON.stringify([]))).toBe(false);
    expect(await app.ev(() => state.visitorTeamBank.length)).toBe(before);
  });

  test('[OBSERVED] cancelling the preview saves nothing', async ({ app }) => {
    await app.open();
    const before = await app.ev(() => state.visitorTeamBank.length);
    app.opts.confirm = false;
    expect(await importText(app, JSON.stringify({ teamName: 'Nope FC', roster: [{ name: 'X Y', jersey: '1' }] }))).toBe(false);
    expect(await app.ev(() => state.visitorTeamBank.length)).toBe(before);
  });

  test('[OBSERVED] import is blocked while a match is in progress', async ({ app }) => {
    await app.open();
    await app.startMatch();
    const before = await app.ev(() => state.visitorTeamBank.length);
    expect(await importText(app, JSON.stringify({ teamName: 'Mid Match', roster: [{ name: 'X Y', jersey: '1' }] }))).toBe(false);
    expect(app.lastDialog().message).toContain('locked while a match is in progress');
    expect(await app.ev(() => state.visitorTeamBank.length)).toBe(before);
    await app.ev(() => openRoster('visitor'));
    await expect(app.page.locator('#roster-paste-import-btn')).toBeDisabled();
  });
});
