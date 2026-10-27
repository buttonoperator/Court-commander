const { test, expect } = require('./support/app');

test.describe('set history, match end, locking', () => {
  test('[OBSERVED] Start New Set records the set and resets the board', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 5);
    await app.points('visitor', 2);
    await app.ev(() => startNewSet());
    const r = await app.ev(() => ({
      rec: state.setHistory[0],
      score: [state.home.score, state.visitor.score],
      flags: [state.gameStarted, state.matchInProgress],
      sets: [document.getElementById('home-sets-won').textContent, document.getElementById('visitor-sets-won').textContent],
      scoreDom: [document.getElementById('home-score').textContent, document.getElementById('visitor-score').textContent],
    }));
    expect(r.rec).toMatchObject({ setNumber: 1, homeScore: 5, visitorScore: 2, homeKills: 0, visitorKills: 0 });
    expect(typeof r.rec.date).toBe('string');
    expect(Object.keys(r.rec).sort()).toEqual(['date', 'homeKills', 'homeScore', 'setNumber', 'visitorKills', 'visitorScore']);
    expect(r.score).toEqual([0, 0]);
    expect(r.flags).toEqual([false, true]);
    expect(r.sets).toEqual(['1', '0']);
    expect(r.scoreDom).toEqual(['0', '0']);
  });

  test('[OBSERVED] Start New Set with no match in progress alerts and records nothing', async ({ app }) => {
    await app.open();
    await app.ev(() => startNewSet());
    expect(app.lastDialog().message).toContain('No match is in progress');
    expect(await app.ev(() => state.setHistory.length)).toBe(0);
  });

  test('[OBSERVED] sets won are decided by comparing set scores; a tied set counts for neither', async ({ app }) => {
    await app.open();
    await app.startMatch({ format: 5 });
    await app.points('home', 2); await app.points('visitor', 2);
    await app.ev(() => startNewSet());
    expect(await app.ev(() => [document.getElementById('home-sets-won').textContent, document.getElementById('visitor-sets-won').textContent])).toEqual(['0', '0']);
  });

  test('[OBSERVED] best-of-3: the second set win produces a "Match complete" alert', async ({ app }) => {
    await app.open();
    await app.startMatch({ format: 3, winner: 'home', choice: 'serve' });
    await app.points('home', 1);
    await app.ev(() => startNewSet());
    await app.ev(() => startGame({ rotationChosen: true }));
    await app.points('home', 1);
    app.clearDialogs();
    await app.ev(() => startNewSet());
    expect(app.lastDialog().message).toContain('Match complete');
    expect(app.lastDialog().message).toContain('wins 2–0');
  });

  test('[OBSERVED] best-of-1 completes after one set', async ({ app }) => {
    await app.open();
    await app.startMatch({ format: 1 });
    await app.points('visitor', 1);
    app.clearDialogs();
    await app.ev(() => startNewSet());
    expect(app.lastDialog().message).toContain('Match complete');
  });

  // Was KNOWN_BUG (Stage 2, U4): startGame used to start another set after the match was decided.
  test('[OBSERVED] U4 regression: after the match is decided no further set can start; End Match is offered', async ({ app }) => {
    await app.open();
    await app.startMatch({ format: 1 });
    await app.points('home', 1);
    await app.ev(() => startNewSet());
    app.clearDialogs();
    await app.ev(() => startGame({ rotationChosen: true }));
    expect(await app.ev(() => state.gameStarted)).toBe(false);
    expect(app.lastDialog().message).toContain('match is decided');
  });

  test('[OBSERVED] match format change is locked during a match and clamps invalid values on load', async ({ app }) => {
    await app.open();
    await app.ev(() => setMatchFormat(5));
    expect(await app.ev(() => state.matchFormat)).toBe(5);
    await app.ev(() => setMatchFormat(2));
    expect(await app.ev(() => state.matchFormat)).toBe(5);
    await app.startMatch();
    await app.ev(() => setMatchFormat(1));
    expect(app.lastDialog().message).toContain('Match format is locked');
    expect(await app.ev(() => state.matchFormat)).toBe(5);
  });

  test('[OBSERVED] End Match folds the live set into history, archives it, and clears live state', async ({ app }) => {
    await app.open();
    await app.startMatch({ venue: 'away' });
    await app.points('home', 3);
    await app.points('visitor', 1);
    await app.ev(() => endMatch());
    const r = await app.ev(() => ({
      archive: state.matchArchive.length,
      sets: state.matchArchive[0].sets.map(s => [s.homeScore, s.visitorScore, !!s.inProgress]),
      live: { setHistory: state.setHistory.length, timeline: state.matchTimeline.length, score: [state.home.score, state.visitor.score], venue: state.venue, coinToss: state.coinToss, setServeStart: state.setServeStart, flags: [state.gameStarted, state.matchInProgress], subs: [state.home.subsRemaining, state.visitor.subsRemaining] },
      statsCleared: state.home.roster.every(p => Object.values(p.stats).every(v => v === 0)),
    }));
    expect(r.archive).toBe(1);
    expect(r.sets).toEqual([[3, 1, false]]);
    expect(r.live).toEqual({ setHistory: 0, timeline: 0, score: [0, 0], venue: null, coinToss: {}, setServeStart: {}, flags: [false, false], subs: [12, 12] });
    expect(r.statsCleared).toBe(true);
  });

  test('[OBSERVED] End Match keeps court lineups and rosters', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 1);
    const names = await app.names('home');
    await app.ev(() => endMatch());
    expect(await app.names('home')).toEqual(names);
  });

  test('[OBSERVED] End Match declined at the confirmation changes nothing', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 1);
    app.opts.confirm = false;
    await app.ev(() => endMatch());
    expect(await app.ev(() => [state.matchInProgress, state.home.score, state.setHistory.length])).toEqual([true, 1, 0]);
  });

  test('[OBSERVED] Reset Board archives on request, clears scores/stats/venue and unlocks', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 2);
    await app.ev(() => resetAll());
    expect(await app.ev(() => [state.matchArchive.length, state.home.score, state.matchInProgress, state.venue])).toEqual([1, 0, false, null]);
  });

  test('[OBSERVED] roster/team edits are locked during a match; viewing is allowed', async ({ app }) => {
    await app.open();
    await app.startMatch();
    expect(await app.ev(() => guardRosterEdit())).toBe(true);
    expect(app.lastDialog().message).toContain('Roster editing is locked');
    const before = await app.ev(() => state.home.roster.length);
    await app.ev(() => loadTeamFromBank('home', state.homeTeamBank[0].id));
    expect(app.lastDialog().message).toContain('Locked');
    expect(await app.ev(() => state.home.roster.length)).toBe(before);
  });

  test('[OBSERVED] saved rotations: save any time, load only between sets', async ({ app }) => {
    await app.open();
    await app.startMatch();
    app.opts.prompt = 'R1';
    await app.ev(() => saveRotation('home'));
    expect(await app.ev(() => state.home.rotations.map(r => [r.name, r.positions.length]))).toEqual([['R1', 6]]);
    app.clearDialogs();
    await app.ev(() => applyRotation('home', 0));
    expect(app.lastDialog().message).toContain('Locked while a set is live');
    await app.ev(() => startNewSet());
    app.clearDialogs();
    await app.ev(() => applyRotation('home', 0));
    expect(app.dialogs).toHaveLength(0);
  });

  test('[OBSERVED] a saved rotation stores only id/name/jersey/position/grade/libero/isGeneric per slot', async ({ app }) => {
    await app.open();
    await app.startMatch();
    app.opts.prompt = 'R1';
    await app.ev(() => saveRotation('home'));
    const keys = await app.ev(() => Object.keys(state.home.rotations[0].positions[0]).sort());
    expect(keys).toEqual(['grade', 'id', 'isGeneric', 'jersey', 'libero', 'name', 'position']);
  });

  test('[KNOWN_BUG] X5: reloading the same bank team regenerates player ids and orphans saved rotations', async ({ app }) => {
    await app.open();
    await app.ev(() => { state.home.positions = state.home.roster.slice(0, 6); });
    app.opts.prompt = 'R1';
    await app.ev(() => saveRotation('home'));
    await app.page.waitForTimeout(100);
    await app.ev(() => loadTeamFromBank('home', state.currentHomeTeamId, true));
    await app.ev(() => applyRotation('home', 0));
    expect(await app.ev(() => state.home.positions.filter(p => p === null).length)).toBe(6);
  });
});
