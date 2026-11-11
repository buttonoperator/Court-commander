const { test, expect } = require('./support/app');

test.describe('scoring and rotation', () => {
  test('[OBSERVED] initial state: 0-0, visitor flagged serving, nothing started', async ({ app }) => {
    await app.open();
    expect(await app.score()).toEqual([0, 0]);
    expect(await app.serving()).toEqual([false, true]);
    expect(await app.ev(() => [state.gameStarted, state.matchInProgress, state.matchFormat])).toEqual([false, false, 3]);
  });

  test('[OBSERVED] addScore before the set starts alerts and changes nothing', async ({ app }) => {
    await app.open();
    await app.ev(() => addScore('home'));
    expect(app.lastDialog().message).toContain('Start Game');
    expect(await app.score()).toEqual([0, 0]);
  });

  test('[OBSERVED] serving team scores: +1, no rotation, serve unchanged', async ({ app }) => {
    await app.open();
    await app.startMatch({ winner: 'home', choice: 'serve' });
    const before = await app.names('home');
    await app.point('home');
    expect(await app.score()).toEqual([1, 0]);
    expect(await app.names('home')).toEqual(before);
    expect(await app.serving()).toEqual([true, false]);
  });

  test('[OBSERVED] receiving team scores: +1, rotates (zone 2 -> zone 1), takes the serve', async ({ app }) => {
    await app.open();
    await app.startMatch({ winner: 'home', choice: 'serve' });
    const before = await app.names('visitor');
    const homeBefore = await app.names('home');
    await app.point('visitor');
    const after = await app.names('visitor');
    expect(await app.score()).toEqual([0, 1]);
    expect(after[0]).toBe(before[1]);
    expect(after).toEqual([...before.slice(1), before[0]]);
    expect(await app.serving()).toEqual([false, true]);
    expect(await app.names('home')).toEqual(homeBefore);
  });

  test('[OBSERVED] six side-outs return a team to its original lineup', async ({ app }) => {
    await app.open();
    await app.startMatch({ winner: 'home', choice: 'serve' });
    const start = await app.names('visitor');
    for (let i = 0; i < 6; i++) {
      await app.point('visitor');
      await app.point('home');
    }
    expect(await app.names('visitor')).toEqual(start);
    expect(await app.score()).toEqual([6, 6]);
  });

  test('[OBSERVED] exactly one team is flagged serving after any sequence of points', async ({ app }) => {
    await app.open();
    await app.startMatch();
    for (const t of ['home', 'visitor', 'visitor', 'home', 'home', 'visitor']) {
      await app.point(t);
      const s = await app.serving();
      expect(s[0] !== s[1]).toBe(true);
    }
  });

  test('[OBSERVED] point event written to matchTimeline with score, server-before and SKIP code', async ({ app }) => {
    await app.open();
    await app.startMatch({ winner: 'home', choice: 'serve' });
    await app.point('visitor');
    const e = await app.ev(() => state.matchTimeline[0]);
    expect(e).toMatchObject({ type: 'point', setNumber: 1, seq: 0, scoringTeam: 'visitor', homeScore: 0, visitorScore: 1, servingTeamBefore: 'home', code: 'SKIP' });
    expect(e.homePositions).toHaveLength(6);
    expect(Object.keys(e.homePositions[0]).sort()).toEqual(['jersey', 'name']);
  });

  test('[OBSERVED] stats: Tampa Prep kill and assist credit scorer and assistant', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.ev(() => {
      addScore('home');
      const [a, b] = state.home.positions;
      recordKill(a.id);
      recordAssist(b.id);
    });
    const r = await app.ev(() => {
      const [a, b] = state.home.positions;
      return { a: a.name, b: b.name, ra: state.home.roster.find(p => p.id === a.id).stats, rb: state.home.roster.find(p => p.id === b.id).stats, ev: state.matchTimeline[0] };
    });
    expect(r.ra).toMatchObject({ K: 1, ATT: 1, PTS: 1 });
    expect(r.rb.AST).toBe(1);
    expect(r.ev).toMatchObject({ code: 'K', playerName: r.a, assistName: r.b });
  });

  test('[OBSERVED] stats: our attack error credits E and ATT; event code is E', async ({ app }) => {
    await app.open();
    await app.startMatch({ winner: 'home', choice: 'serve' });
    await app.ev(() => { addScore('visitor'); recordPlayerError(state.home.positions[2].id, 'E'); });
    const r = await app.ev(() => ({ s: state.home.roster.find(p => p.id === state.home.positions[2].id).stats, code: state.matchTimeline[0].code }));
    expect(r.s).toMatchObject({ E: 1, ATT: 1 });
    expect(r.code).toBe('E');
  });

  test('[KNOWN_BUG] X1: Tampa Prep teamKills is never incremented, so setHistory.homeKills is always 0', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.ev(() => { addScore('home'); recordKill(state.home.positions[0].id); recordAssist(state.home.positions[1].id); });
    await app.ev(() => startNewSet());
    const r = await app.ev(() => ({ perPlayerK: state.home.roster.reduce((n, p) => n + p.stats.K, 0), rec: state.setHistory[0] }));
    expect(r.perPlayerK).toBe(1);
    expect(r.rec.homeKills).toBe(0);
  });

  test('[OBSERVED] opponent team kill increments visitor.teamKills and records code K', async ({ app }) => {
    await app.open();
    await app.startMatch({ winner: 'home', choice: 'serve' });
    await app.ev(() => { addScore('visitor'); recordVisitorTeamKill(); });
    expect(await app.ev(() => [state.visitor.teamKills, state.matchTimeline[0].code])).toEqual([1, 'K']);
  });

  test('[OBSERVED] undo restores score, serve and lineup after a rotating point, and pops the timeline', async ({ app }) => {
    await app.open();
    await app.startMatch({ winner: 'home', choice: 'serve' });
    const before = await app.names('visitor');
    await app.point('visitor');
    await app.ev(() => undoLastPoint());
    expect(await app.score()).toEqual([0, 0]);
    expect(await app.serving()).toEqual([true, false]);
    expect(await app.names('visitor')).toEqual(before);
    expect(await app.ev(() => state.matchTimeline.length)).toBe(0);
  });

  test('[OBSERVED] undo with the stat prompt still open discards the pending event', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.ev(() => addScore('home'));
    await app.ev(() => undoLastPoint());
    expect(await app.score()).toEqual([0, 0]);
    expect(await app.ev(() => state.matchTimeline.length)).toBe(0);
  });

  test('[KNOWN_BUG] X7: undo does not revert the stat credited to the undone point', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.ev(() => { addScore('home'); recordKill(state.home.positions[0].id); recordAssist(state.home.positions[1].id); });
    await app.ev(() => undoLastPoint());
    const r = await app.ev(() => ({
      K: state.home.roster.reduce((n, p) => n + p.stats.K, 0),
      AST: state.home.roster.reduce((n, p) => n + p.stats.AST, 0),
      score: state.home.score,
    }));
    expect(r.score).toBe(0);
    expect(r.K).toBe(1);
    expect(r.AST).toBe(1);
  });

  test("[KNOWN_BUG] X6: undo after Start New Set rolls back the previous set's last point while setHistory keeps it", async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 3);
    await app.ev(() => startNewSet());
    expect(await app.ev(() => state.home.score)).toBe(0);
    await app.ev(() => undoLastPoint());
    const r = await app.ev(() => ({ score: state.home.score, hist: state.setHistory[0].homeScore }));
    expect(r.score).toBe(2);
    expect(r.hist).toBe(3);
  });

  test('[MISSING_RULE] R1/R3: no point target or win-by-2; 30-0 does not end the set', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 30);
    expect(await app.score()).toEqual([30, 0]);
    expect(await app.ev(() => [state.gameStarted, state.setHistory.length])).toEqual([true, 0]);
    expect(await app.ev(() => document.getElementById('home-score').textContent)).toBe('30');
  });
});
