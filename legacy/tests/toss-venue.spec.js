const { test, expect } = require('./support/app');

test.describe('coin toss, venue and serve alternation', () => {
  test('[OBSERVED] no first server is known before a toss; set 1 requires a toss', async ({ app }) => {
    await app.open();
    expect(await app.ev(() => [firstServerForSet(1), setRequiresCoinToss(1)])).toEqual([null, true]);
  });

  test('[OBSERVED] toss outcomes map to first server (winner serve / receive, both teams)', async ({ app }) => {
    await app.open();
    const out = {};
    for (const winner of ['home', 'visitor']) {
      for (const choice of ['serve', 'receive']) {
        out[`${winner}/${choice}`] = await app.ev(({ winner, choice }) => {
          state.coinToss = {}; state.setServeStart = {};
          openCoinTossModal(1); setTossWinner(winner); resolveToss(choice);
          return [firstServerForSet(1), state.home.serving, state.visitor.serving, state.coinToss[1].choice, state.setServeStart[1]];
        }, { winner, choice });
      }
    }
    expect(out['home/serve']).toEqual(['home', true, false, 'serve', 'home']);
    expect(out['home/receive']).toEqual(['visitor', false, true, 'receive', 'visitor']);
    expect(out['visitor/serve']).toEqual(['visitor', false, true, 'serve', 'visitor']);
    expect(out['visitor/receive']).toEqual(['home', true, false, 'receive', 'home']);
  });

  test('[OBSERVED] middle sets alternate the first server from the previous set', async ({ app }) => {
    await app.open();
    await app.startMatch({ winner: 'home', choice: 'serve', format: 5 });
    await app.ev(() => startNewSet());
    expect(await app.ev(() => [setRequiresCoinToss(2), firstServerForSet(2)])).toEqual([false, 'visitor']);
    await app.ev(() => startGame({ rotationChosen: true }));
    expect(await app.ev(() => [state.setServeStart[2], state.home.serving, state.visitor.serving])).toEqual(['visitor', false, true]);
    await app.ev(() => startNewSet());
    expect(await app.ev(() => firstServerForSet(3))).toBe('home');
  });

  test('[OBSERVED] toss is required for set 1 and the deciding set only, by format', async ({ app }) => {
    await app.open();
    const table = await app.ev(() => [1, 3, 5].map(f => {
      state.matchFormat = f;
      return [f, decidingSetNumber(), [1, 2, 3, 4, 5].filter(n => setRequiresCoinToss(n))];
    }));
    expect(table).toEqual([[1, null, [1]], [3, 3, [1, 3]], [5, 5, [1, 5]]]);
  });

  test('[OBSERVED] deciding-set toss with Playing Area: loser chooses serve (OK) or receive (Cancel); area stored with no side effect', async ({ app }) => {
    await app.open();
    const run = async (ok) => {
      app.opts.confirm = ok;
      return app.ev(() => {
        state.matchFormat = 3; state.coinToss = {};
        openCoinTossModal(3); setTossWinner('home'); resolveToss('area');
        return { toss: state.coinToss[3], courtOrder: [...document.querySelectorAll('.uc-court-half .court')].map(c => c.id) };
      });
    };
    const a = await run(true);
    expect(a.toss).toEqual({ winner: 'home', choice: 'area', firstServer: 'visitor' });
    const b = await run(false);
    expect(b.toss).toEqual({ winner: 'home', choice: 'area', firstServer: 'home' });
    expect(b.courtOrder).toEqual(['visitor-court', 'home-court']);
  });

  test('[OBSERVED] caller text follows venue: visiting captain pre-match, home captain deciding set', async ({ app }) => {
    await app.open();
    const names = await app.ev(() => ({ home: teamDisplayName('home'), visitor: teamDisplayName('visitor') }));
    const read = (venue, set) => app.ev(({ venue, set }) => {
      state.venue = venue; openCoinTossModal(set);
      return document.getElementById('coin-toss-rule').textContent;
    }, { venue, set });
    expect(await read('home', 1)).toContain(`VISITING captain (${names.visitor})`);
    expect(await read('away', 1)).toContain(`VISITING captain (${names.home})`);
    expect(await read('home', 3)).toContain(`HOME captain (${names.home})`);
    expect(await read('away', 3)).toContain(`HOME captain (${names.visitor})`);
  });

  test('[OBSERVED] homeSideTeam/awaySideTeam/venueRoleFor map venue to team keys', async ({ app }) => {
    await app.open();
    const r = await app.ev(() => ['home', 'away', null].map(v => { state.venue = v; return [v, homeSideTeam(), awaySideTeam(), venueRoleFor('home'), venueRoleFor('visitor')]; }));
    expect(r).toEqual([
      ['home', 'home', 'visitor', 'HOME', 'AWAY'],
      ['away', 'visitor', 'home', 'AWAY', 'HOME'],
      [null, 'home', 'visitor', null, null],
    ]);
  });

  test('[OBSERVED] Start without a venue opens the venue modal and does not start', async ({ app }) => {
    await app.open();
    await app.prepareTeams();
    await app.ev(() => startGame());
    expect(await app.ev(() => document.getElementById('venue-modal').classList.contains('active'))).toBe(true);
    expect(await app.ev(() => state.gameStarted)).toBe(false);
  });

  test('[OBSERVED] Start with fewer than 6 players alerts and does not start', async ({ app }) => {
    await app.open();
    await app.ev(() => startGame());
    expect(app.lastDialog().message).toContain('Cannot start the game yet');
    expect(await app.ev(() => state.gameStarted)).toBe(false);
  });

  test('[OBSERVED] venue is locked once the match is in progress', async ({ app }) => {
    await app.open();
    await app.startMatch({ venue: 'home' });
    await app.ev(() => setVenueFromSettings('away'));
    expect(app.lastDialog().message).toContain('Venue is locked');
    expect(await app.ev(() => state.venue)).toBe('home');
  });

  test('[OBSERVED] venue before the match can be changed from Settings', async ({ app }) => {
    await app.open();
    await app.ev(() => setVenueFromSettings('away'));
    expect(await app.ev(() => state.venue)).toBe('away');
  });

  test('[KNOWN_BUG] M3: scoreboard says HOME beside Tampa Prep while the venue badge says AWAY', async ({ app }) => {
    await app.open();
    await app.startMatch({ venue: 'away' });
    const r = await app.ev(() => ({
      badge: document.getElementById('home-venue-badge').textContent,
      labels: [...document.querySelectorAll('.uc-score-side-label')].map(e => e.textContent),
      homeScoreBlockLabel: document.getElementById('home-score').previousElementSibling.textContent,
    }));
    expect(r.badge).toBe('AWAY');
    expect(r.labels).toEqual(['AWAY', 'HOME']);
    expect(r.homeScoreBlockLabel).toBe('HOME');
  });

  test('[KNOWN_BUG] D3: toss modal for a non-toss set 2 is titled "Deciding Set 2"', async ({ app }) => {
    await app.open();
    await app.ev(() => { state.matchFormat = 5; openCoinTossModal(2); });
    expect(await app.ev(() => document.getElementById('coin-toss-title').textContent)).toBe('Deciding Set 2 — Coin Toss');
  });

  test('[MISSING_RULE] R4: no side switch exists; courts stay visitor-above-home through the deciding toss', async ({ app }) => {
    await app.open();
    await app.ev(() => { state.matchFormat = 3; state.venue = 'home'; openCoinTossModal(3); setTossWinner('home'); });
    await app.ev(() => resolveToss('area'));
    expect(await app.ev(() => Object.keys(state).filter(k => /side/i.test(k)))).toEqual([]);
    expect(await app.ev(() => [...document.querySelectorAll('.uc-court-half .court')].map(c => c.id))).toEqual(['visitor-court', 'home-court']);
  });

  test('[OBSERVED] UI path: Start Match -> venue -> toss -> serve -> chooser -> start (390x844 taps)', async ({ app }) => {
    await app.open();
    await app.prepareTeams();
    await app.page.click('#uc-start-game-btn');
    await app.page.click('#venue-modal button:has-text("Home")');
    await app.page.click('#coin-toss-body button:nth-of-type(1)');   // winner: first listed team (Tampa Prep)
    await app.page.click('#coin-toss-body button:has-text("Serve")');
    await app.page.click('#rotation-mgr-actions button:has-text("Start Match")');
    expect(await app.ev(() => [state.venue, state.gameStarted, state.matchInProgress, state.home.serving, state.coinToss[1].winner])).toEqual(['home', true, true, true, 'home']);
  });
});
