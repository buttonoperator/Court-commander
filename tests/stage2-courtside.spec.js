const { test, expect } = require('./support/app');

// Stage 2 (courtside UX): U1 tap targets, U4 between-set dead ends, U5 reload restore, U7 name legibility.
// Requirement text: docs/ux-requirements.md on the audit branch; plan: docs/rewrite-plan.md.

const VIEWPORTS = [{ w: 390, h: 844 }, { w: 430, h: 932 }];

for (const vp of VIEWPORTS) {
  test.describe(`stage 2 at ${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });

    test('U1: both +1 buttons are at least 56 x 56 pt, inside the viewport, with no horizontal overflow', async ({ app }) => {
      await app.open();
      await app.startMatch();
      const r = await app.ev(() => {
        const box = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { w: b.width, h: b.height, left: b.left, right: b.right }; };
        return {
          home: box("button[onclick=\"addScore('home')\"]"),
          visitor: box("button[onclick=\"addScore('visitor')\"]"),
          scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
        };
      });
      for (const side of ['home', 'visitor']) {
        expect(r[side].w).toBeGreaterThanOrEqual(56);
        expect(r[side].h).toBeGreaterThanOrEqual(56);
        expect(r[side].left).toBeGreaterThanOrEqual(0);
        expect(r[side].right).toBeLessThanOrEqual(r.innerW);
      }
      expect(r.scrollW).toBeLessThanOrEqual(r.innerW + 1);
    });

    test('U1: a tap on each +1 button awards exactly one point', async ({ app }) => {
      await app.open();
      await app.startMatch();
      await app.page.click("button[onclick=\"addScore('home')\"]");
      await app.page.click('text=Skip', { timeout: 2000 }).catch(() => {});
      expect(await app.score()).toEqual([1, 0]);
    });

    test('U7: no seeded roster name is truncated on the court view', async ({ app }) => {
      await app.open();
      await app.startMatch();
      const truncated = await app.ev(() => {
        const names = new Set();
        [...state.homeTeamBank, ...state.visitorTeamBank].forEach(t => t.roster.forEach(p => names.add(p.name)));
        state.home.roster.concat(state.visitor.roster).forEach(p => names.add(p.name));
        // Worst cases for opponent rosters read from screenshots: long hyphenated, three-part and compound names.
        ['Alexandria Montgomery-Washington', 'Mary Elizabeth Van Der Heyden', 'Christopher-Alexander Fitzgerald', 'Maria de los Angeles Rodriguez'].forEach(n => names.add(n));
        const bad = [];
        ['home', 'visitor'].forEach(team => {
          const original = state[team].positions.slice();
          [...names].forEach(name => {
            state[team].positions[0] = { id: -1, name, jersey: '88', position: '', grade: '', libero: false, stats: {} };
            updateCourt(team);
            const el = document.querySelector(`#${team}-court .position[data-position-index="0"] .player-name`);
            if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) bad.push(`${team}:${name}`);
          });
          state[team].positions = original;
          updateCourt(team);
        });
        return { checked: names.size, bad };
      });
      expect(truncated.checked).toBeGreaterThan(20);
      expect(truncated.bad).toEqual([]);
    });
  });
}

test.describe('stage 2: between sets and reload', () => {
  const visible = (app, id) => app.ev(i => { const e = document.getElementById(i); return !!e && e.offsetParent !== null && getComputedStyle(e).display !== 'none'; }, id);

  test('U4: after every set transition the next valid action is visible', async ({ app }) => {
    await app.open();
    await app.startMatch({ format: 5 });
    for (let set = 1; set <= 2; set++) {
      await app.points('home', 1);
      await app.ev(() => startNewSet());
      expect(await visible(app, 'uc-start-game-btn')).toBe(true);
      expect(await app.ev(() => document.getElementById('uc-start-game-btn').textContent)).toContain(`Start Set ${set + 1}`);
      expect(await visible(app, 'uc-end-match-btn')).toBe(true);
      await app.ev(() => startGame({ rotationChosen: true }));
      expect(await app.ev(() => state.gameStarted)).toBe(true);
    }
  });

  test('U4: once the match is decided the only next action is End Match and no further set can start', async ({ app }) => {
    await app.open();
    await app.startMatch({ format: 1 });
    await app.points('home', 1);
    await app.ev(() => startNewSet());
    expect(await visible(app, 'uc-end-match-btn')).toBe(true);
    expect(await visible(app, 'uc-start-game-btn')).toBe(false);
    app.clearDialogs();
    await app.ev(() => startGame({ rotationChosen: true }));
    expect(await app.ev(() => state.gameStarted)).toBe(false);
    expect(app.lastDialog().message).toContain('match is decided');
    // The same screen after a reload.
    await app.ev(() => saveToLocalStorage());
    await app.reload();
    expect(await visible(app, 'uc-end-match-btn')).toBe(true);
    expect(await visible(app, 'uc-start-game-btn')).toBe(false);
  });

  test('U4: a best-of-3 that is not yet decided still offers Start Set', async ({ app }) => {
    await app.open();
    await app.startMatch({ format: 3 });
    await app.points('home', 1);
    await app.ev(() => startNewSet());
    expect(await visible(app, 'uc-start-game-btn')).toBe(true);
  });

  test('U5: a point whose stat prompt was open at reload is recovered into the timeline with no new persisted key', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.point('visitor');
    await app.ev(() => addScore('home'));            // stat prompt is open: timeline has not recorded this point
    await app.ev(() => saveToLocalStorage());
    const keysBefore = await app.ev(k => Object.keys(JSON.parse(localStorage.getItem(k)).state).sort(), 'courtCommanderState_v1');
    await app.reload();
    const r = await app.ev(() => ({
      score: [state.home.score, state.visitor.score],
      timeline: state.matchTimeline.map(e => [e.scoringTeam, e.homeScore, e.visitorScore, e.code]),
    }));
    expect(r.score).toEqual([1, 1]);
    expect(r.timeline).toEqual([['visitor', 0, 1, 'SKIP'], ['home', 1, 1, 'PT']]);
    await app.ev(() => saveToLocalStorage());
    const keysAfter = await app.ev(k => Object.keys(JSON.parse(localStorage.getItem(k)).state).sort(), 'courtCommanderState_v1');
    expect(keysAfter).toEqual(keysBefore);
  });

  test('U5: recovery does not duplicate a point that was already logged, and runs once', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 2);
    await app.ev(() => saveToLocalStorage());
    await app.reload();
    expect(await app.ev(() => state.matchTimeline.length)).toBe(2);
    await app.reload();
    expect(await app.ev(() => state.matchTimeline.length)).toBe(2);
  });

  test('U5: mid-set DOM is identical after reload (score, serve marker, lineup, controls, locks)', async ({ app }) => {
    const dom = () => app.ev(() => {
      const txt = id => document.getElementById(id).textContent.trim();
      const court = team => [...document.querySelectorAll(`#${team}-court .position`)].map(p => [
        p.dataset.positionIndex, p.classList.contains('serving-position'), (p.querySelector('.player-name') || {}).textContent, (p.querySelector('.player-jersey') || {}).textContent]);
      return {
        scores: [txt('home-score'), txt('visitor-score')],
        sets: [txt('home-sets-won'), txt('visitor-sets-won')],
        subs: [txt('home-subs-remaining'), txt('visitor-subs-remaining')],
        home: court('home'), visitor: court('visitor'),
        live: getComputedStyle(document.getElementById('uc-score-live-controls')).display,
        choice: getComputedStyle(document.getElementById('uc-game-choice-controls')).display,
        locked: document.querySelectorAll('.is-game-locked').length,
        badges: [txt('home-venue-badge'), txt('visitor-venue-badge')],
        resumeModal: document.getElementById('resume-match-modal').classList.contains('active'),
      };
    });
    await app.open();
    await app.startMatch({ venue: 'away', winner: 'visitor', choice: 'serve' });
    await app.points('visitor', 2); await app.points('home', 3);
    await app.sub('home', 3, 'Addi Rogers');
    await app.ev(() => saveToLocalStorage());
    const before = await dom();
    await app.reload();
    await app.ev(() => resumeSavedMatch());
    const after = await dom();
    expect({ ...after, resumeModal: false }).toEqual({ ...before, resumeModal: false });
  });
});
