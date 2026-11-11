const { test, expect } = require('./support/app');

// Home roster (seeded Tampa Prep Varsity 2026): first six are on court, the rest on the bench.
const BENCH_A = 'Addi Rogers';       // roster index 7
const BENCH_B = 'Nikolina Nastic';   // roster index 8

test.describe('substitutions', () => {
  test('[OBSERVED] a sub swaps the player, decrements the counter, logs and timelines the change', async ({ app }) => {
    await app.open();
    await app.startMatch();
    const out = (await app.names('home'))[3];
    await app.sub('home', 3, BENCH_A);
    expect((await app.names('home'))[3]).toBe(BENCH_A);
    const r = await app.ev(() => ({
      left: state.home.subsRemaining,
      shown: document.getElementById('home-subs-remaining').textContent,
      log: state.home.substitutions,
      ev: state.matchTimeline[0],
      outId: null,
    }));
    expect(r.left).toBe(11);
    expect(r.shown).toBe('11');
    expect(r.log).toHaveLength(1);
    expect(r.log[0].position).toBe(3);
    expect(r.ev).toMatchObject({ type: 'substitution', team: 'home', positionIdx: 3, playerOutName: out, playerInName: BENCH_A, setNumber: 1 });
    expect(await app.ev(() => state.visitor.subsRemaining)).toBe(12);
  });

  test('[OBSERVED] the replaced player appears on the bench and the new player leaves it', async ({ app }) => {
    await app.open();
    await app.startMatch();
    const out = (await app.names('home'))[0];
    await app.sub('home', 0, BENCH_A);
    const bench = await app.ev(() => [...document.querySelectorAll('#home-bench .bench-name')].map(e => e.textContent));
    expect(bench).toContain(out);
    expect(bench).not.toContain(BENCH_A);
  });

  test('[OBSERVED] 12-sub cap: the 13th attempt is blocked with a message and nothing changes', async ({ app }) => {
    await app.open();
    await app.startMatch();
    const starter = (await app.names('home'))[0];
    for (let i = 0; i < 12; i++) await app.sub('home', 0, i % 2 === 0 ? BENCH_A : starter);
    expect(await app.ev(() => state.home.subsRemaining)).toBe(0);
    const names = await app.names('home');
    app.clearDialogs();
    await app.ev(() => openSubstitution('home', 1));
    expect(app.lastDialog().message).toContain('No substitutions left this set');
    expect(await app.names('home')).toEqual(names);
    expect(await app.ev(() => document.getElementById('substitution-modal').classList.contains('active'))).toBe(false);
    expect(await app.ev(() => state.home.substitutions.length)).toBe(12);
  });

  test('[OBSERVED] the counter resets to 12 for both teams at Start New Set; the log does not', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.sub('home', 2, BENCH_A);
    await app.sub('visitor', 2, (await app.ev(() => state.visitor.roster[7].name)));
    await app.ev(() => startNewSet());
    expect(await app.ev(() => [state.home.subsRemaining, state.visitor.subsRemaining])).toEqual([12, 12]);
    expect(await app.ev(() => [document.getElementById('home-subs-remaining').textContent, document.getElementById('visitor-subs-remaining').textContent])).toEqual(['12', '12']);
    expect(await app.ev(() => [state.home.substitutions.length, state.visitor.substitutions.length])).toEqual([1, 1]);
  });

  test('[OBSERVED] opponent subs use the same path and counter', async ({ app }) => {
    await app.open();
    await app.startMatch();
    const bench = await app.ev(() => state.visitor.roster[7].name);
    await app.sub('visitor', 4, bench);
    expect((await app.names('visitor'))[4]).toBe(bench);
    expect(await app.ev(() => [state.visitor.subsRemaining, state.home.subsRemaining])).toEqual([11, 12]);
  });

  test('[OBSERVED] SUB button is rendered on court cards only while a set is live', async ({ app }) => {
    await app.open();
    await app.prepareTeams();
    expect(await app.ev(() => document.querySelectorAll('#home-court .btn-sub').length)).toBe(0);
    await app.startMatch();
    expect(await app.ev(() => document.querySelectorAll('#home-court .btn-sub').length)).toBe(6);
  });

  test('[OBSERVED] opening a sub with an empty bench alerts', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.ev(() => { state.home.positions = state.home.roster.slice(0, 6); state.home.roster = state.home.roster.slice(0, 6); });
    app.clearDialogs();
    await app.ev(() => openSubstitution('home', 0));
    expect(app.lastDialog().message).toContain('No bench players available');
  });

  test('[OBSERVED] a court player missing from the roster blocks the sub with a recovery message', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.ev(() => { state.home.roster = state.home.roster.filter(p => p.id !== state.home.positions[0].id); });
    app.clearDialogs();
    await app.ev(() => openSubstitution('home', 0));
    expect(app.lastDialog().message).toContain('out of sync with the loaded roster');
  });

  test('[MISSING_RULE] R10: re-entry is unrestricted; A out, B in, B out, A in, A out again are all accepted', async ({ app }) => {
    await app.open();
    await app.startMatch();
    const starter = (await app.names('home'))[1];
    await app.sub('home', 1, BENCH_A);          // starter out, A in
    await app.sub('home', 1, starter);          // A out, starter back (re-entry 1)
    await app.sub('home', 1, BENCH_A);          // starter out again
    await app.sub('home', 1, starter);          // starter back again (re-entry 2)
    await app.sub('home', 4, BENCH_B);   // different position, any player
    expect((await app.names('home'))[1]).toBe(starter);
    expect(await app.ev(() => state.home.subsRemaining)).toBe(7);
    expect(app.dialogs.filter(d => /sub/i.test(d.message))).toHaveLength(0);
  });

  test('[MISSING_RULE] R10: a different player may replace a starter at a different position than the first sub', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.sub('home', 0, BENCH_A);
    await app.sub('home', 5, BENCH_B);
    expect(await app.ev(() => state.home.substitutions.map(s => s.position))).toEqual([0, 5]);
  });

  test('[OBSERVED] libero flag is derived from a bare "L" token in the position string', async ({ app }) => {
    await app.open();
    const r = await app.ev(() => {
      const lib = [], non = [];
      for (const t of state.visitorTeamBank) for (const p of t.roster) {
        const toks = (p.position || '').split(',').map(s => s.trim().toUpperCase());
        (toks.includes('L') ? lib : non).push(p.libero);
      }
      return { libCount: lib.length, allLib: lib.every(Boolean), noneNon: non.every(v => !v) };
    });
    expect(r.libCount).toBeGreaterThan(0);
    expect(r.allLib).toBe(true);
    expect(r.noneNon).toBe(true);
  });

  test('[MISSING_RULE] R12/R15: a libero may replace a front-row player and the swap uses one of the 12 subs', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.ev(() => { state.home.roster.find(p => p.name === 'Addi Rogers').libero = true; });
    // positions index 1..3 are front row (zones 2,3,4)
    await app.sub('home', 2, BENCH_A);
    expect((await app.names('home'))[2]).toBe(BENCH_A);
    expect(await app.ev(() => state.home.subsRemaining)).toBe(11);
    expect(app.dialogs).toHaveLength(0);
  });

  test('[OBSERVED] libero rules toggle is a placeholder alert; liberoRules state is unused', async ({ app }) => {
    await app.open();
    await app.ev(() => toggleLiberoRules());
    expect(app.lastDialog().message).toContain('coming in the next update');
    expect(await app.ev(() => state.liberoRules)).toEqual({ enabled: false, allowServing: false, homeTeamEnabled: true, visitorTeamEnabled: false });
  });
});
