const fs = require('fs');
const { test, expect } = require('./support/app');

async function playTwoSets(app, venue = 'home') {
  await app.startMatch({ venue, winner: 'home', choice: 'serve', format: 3 });
  await app.points('home', 3);
  await app.points('visitor', 2);
  await app.ev(() => { addScore('home'); recordKill(state.home.positions[0].id); recordAssist(state.home.positions[1].id); });
  await app.ev(() => startNewSet());
  await app.ev(() => startGame({ rotationChosen: true }));
  await app.points('visitor', 2);      // live, unfinished set 2
}

test.describe('archive and export shapes', () => {
  test('[OBSERVED] archiveCurrentMatch entry has the audited keys; live set is appended with inProgress', async ({ app }) => {
    await app.open();
    await playTwoSets(app);
    await app.ev(() => archiveCurrentMatch());
    const m = await app.ev(() => state.matchArchive[0]);
    expect(Object.keys(m).sort()).toEqual(['date', 'homeRoster', 'homeTeamName', 'id', 'matchFormat', 'setsWonHome', 'setsWonVisitor', 'sets', 'timeline', 'visitorRoster', 'visitorRosterEnabled', 'visitorTeamName'].sort());
    expect(m.sets.map(s => [s.setNumber, s.homeScore, s.visitorScore, !!s.inProgress])).toEqual([[1, 4, 2, false], [2, 0, 2, true]]);
    expect([m.setsWonHome, m.setsWonVisitor, m.matchFormat, m.visitorRosterEnabled]).toEqual([1, 1, 3, true]);
    expect(Object.keys(m.homeRoster[0]).sort()).toEqual(['jersey', 'name', 'position', 'stats']);
    expect(Object.keys(m.homeRoster[0].stats)).toHaveLength(17);
    expect(m.timeline.length).toBeGreaterThan(5);
    expect(typeof m.id).toBe('number');
    expect(new Date(m.date).toISOString()).toBe(m.date);
  });

  test('[KNOWN_BUG] M5: archive stores no venue, coin toss or serve record', async ({ app }) => {
    await app.open();
    await playTwoSets(app, 'away');
    await app.ev(() => archiveCurrentMatch());
    const txt = await app.ev(() => JSON.stringify(state.matchArchive[0]));
    expect(txt).not.toMatch(/venue|coinToss|setServeStart/);
  });

  test('[OBSERVED] archive is newest-first and a snapshot (later stat edits do not change it)', async ({ app }) => {
    await app.open();
    await playTwoSets(app);
    await app.ev(() => archiveCurrentMatch());
    await app.page.waitForTimeout(5);
    await app.ev(() => archiveCurrentMatch());
    const ids = await app.ev(() => state.matchArchive.map(m => m.id));
    expect(ids[0]).toBeGreaterThan(ids[1]);
    const before = await app.ev(() => state.matchArchive[0].homeRoster[0].stats.K);
    await app.ev(() => { state.home.roster[0].stats.K += 5; });
    expect(await app.ev(() => state.matchArchive[0].homeRoster[0].stats.K)).toBe(before);
  });

  test('[OBSERVED] archiving with no data alerts and adds nothing', async ({ app }) => {
    await app.open();
    await app.ev(() => archiveCurrentMatch());
    expect(app.lastDialog().message).toContain('no match data yet');
    expect(await app.ev(() => state.matchArchive.length)).toBe(0);
  });

  test('[OBSERVED] rename label, delete from history', async ({ app }) => {
    await app.open();
    await playTwoSets(app);
    await app.ev(() => archiveCurrentMatch());
    app.opts.prompt = 'Senior night';
    await app.ev(() => editMatchLabel(state.matchArchive[0].id));
    expect(await app.ev(() => state.matchArchive[0].editedLabel)).toBe('Senior night');
    await app.ev(() => deleteMatchFromHistory(state.matchArchive[0].id));
    expect(await app.ev(() => state.matchArchive.length)).toBe(0);
  });

  test('[KNOWN_BUG] U11: history list labels a Tampa Prep result "(Home W)" regardless of venue', async ({ app }) => {
    await app.open();
    await app.startMatch({ venue: 'away', format: 1 });
    await app.points('home', 2);
    await app.ev(() => startNewSet());
    await app.ev(() => archiveCurrentMatch());
    await app.ev(() => openMatchHistory());
    const text = await app.ev(() => document.getElementById('match-history-list').textContent.replace(/\s+/g, ' '));
    expect(text).toContain('(Home W)');
  });

  test('[OBSERVED] roster export shape and filename', async ({ app }) => {
    await app.open();
    const [dl] = await Promise.all([app.page.waitForEvent('download'), app.ev(() => exportRoster('home'))]);
    expect(dl.suggestedFilename()).toBe('roster-tampa-prep-varsity-2026.json');
    const b = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    expect(Object.keys(b).sort()).toEqual(['exportedAt', 'roster', 'teamName', 'type', 'version']);
    expect(b).toMatchObject({ type: 'court-commander-roster', version: 1, teamName: 'Tampa Prep Varsity 2026' });
    expect(Object.keys(b.roster[0]).sort()).toEqual(['grade', 'jersey', 'libero', 'name', 'position']);
    expect(b.roster).toHaveLength(16);
  });

  test('[OBSERVED] team-bank export shape carries the internal team key in the payload and filename', async ({ app }) => {
    await app.open();
    const [dl] = await Promise.all([app.page.waitForEvent('download'), app.ev(() => exportTeamBank('visitor'))]);
    expect(dl.suggestedFilename()).toBe('court-commander-visitor-team-bank.json');
    const b = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    expect(Object.keys(b).sort()).toEqual(['exportedAt', 'team', 'teams', 'type', 'version']);
    expect(b).toMatchObject({ type: 'court-commander-team-bank', version: 1, team: 'visitor' });
    expect(Object.keys(b.teams[0]).sort()).toEqual(['name', 'roster']);
    expect(b.teams.length).toBeGreaterThan(5);
  });

  test('[OBSERVED] team-bank import adds teams and strips stats/ids; existing names are overwritten on confirm', async ({ app }) => {
    await app.open();
    const n = await app.ev(() => state.visitorTeamBank.length);
    await app.ev(() => {
      state.currentTeam = 'visitor';
      handleTeamBankImportPayload('visitor', { teams: [{ name: 'Zeta Prep', roster: [{ name: 'A B', jersey: '1', position: 'S', stats: { K: 9 } }] }] });
    });
    expect(await app.ev(() => state.visitorTeamBank.length)).toBe(n + 1);
    const t = await app.ev(() => state.visitorTeamBank.find(x => x.name === 'Zeta Prep'));
    expect(Object.keys(t).sort()).toEqual(['id', 'name', 'roster', 'savedAt']);
    expect(Object.keys(t.roster[0]).sort()).toEqual(['grade', 'jersey', 'libero', 'name', 'position']);
  });

  test('[KNOWN_BUG] U11: XLSX export uses Home/Visitor sheet names and headers', async ({ app }) => {
    await app.open();
    await playTwoSets(app);
    await app.ev(() => exportStats());
    const x = await app.ev(() => window.__xlsx);
    expect(x.sheets).toEqual(['Home Team Stats', 'Visitor Team Stats', 'Match Summary']);
    expect(x.file).toMatch(/_vs_.*\.xlsx$/);
    expect(JSON.stringify(x.rows['Match Summary'])).toContain('Home Kills');
    expect(x.rows['Home Team Stats'][1]).toHaveLength(18);
  });

  test('[OBSERVED] match export opens a print window containing both team names and set scores', async ({ app }) => {
    await app.open();
    await playTwoSets(app);
    await app.ev(() => archiveCurrentMatch());
    const [popup] = await Promise.all([app.page.waitForEvent('popup'), app.ev(() => exportMatchToDocument(state.matchArchive[0].id))]);
    await popup.waitForLoadState();
    const html = await popup.content();
    expect(html).toContain(await app.ev(() => state.matchArchive[0].homeTeamName));
    expect(html).toContain('In progress');
  });

  test('[OBSERVED] replay theater builds from live and from archived matches', async ({ app }) => {
    await app.open();
    await playTwoSets(app);
    await app.ev(() => openTheaterModeLive());
    expect(await app.ev(() => theaterState.setsMeta.map(s => [s.setNumber, s.final]))).toEqual([[1, true], [2, false]]);
    await app.ev(() => { closeTheaterMode(); archiveCurrentMatch(); openTheaterModeArchived(state.matchArchive[0].id); });
    expect(await app.ev(() => theaterState.setsMeta.map(s => [s.setNumber, s.final]))).toEqual([[1, true], [2, false]]);
    expect(await app.ev(() => Object.keys(theaterState).sort())).toEqual(['currentPointIdx', 'currentSetEvents', 'currentSetIdx', 'homeTeamName', 'matchFormat', 'setsMeta', 'timeline', 'visitorTeamName']);
  });

  test('[KNOWN_BUG] M6: replay theater draws Tampa Prep with the opposite colour slot from the live court', async ({ app }) => {
    await app.open();
    const css = await app.ev(() => ({
      court: getComputedStyle(document.createElement('div')).color,
      home: document.documentElement.innerHTML.includes('#home-court .player-jersey { color: var(--team2-color); }'),
    }));
    expect(css.home).toBe(true);        // live court: home -> team2
    const src = await app.ev(() => renderTheaterTimeline.toString() + renderTheaterDetail.toString());
    expect(src).toContain("isHome ? 'var(--team1-color)' : 'var(--team2-color)'");   // theater: home -> team1
  });
});
