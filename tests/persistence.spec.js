const fs = require('fs');
const { test, expect } = require('./support/app');

const KEY = 'courtCommanderState_v1';

// Fields compared across a reload. Chosen to cover the migration-equivalence list.
const snap = () => ({
  score: [state.home.score, state.visitor.score],
  serving: [state.home.serving, state.visitor.serving],
  court: [state.home.positions.map(p => p && p.id), state.visitor.positions.map(p => p && p.id)],
  subs: [state.home.subsRemaining, state.visitor.subsRemaining],
  subLog: [state.home.substitutions, state.visitor.substitutions],
  stats: state.home.roster.map(p => p.stats),
  timeline: state.matchTimeline.length,
  setHistory: state.setHistory,
  flags: [state.gameStarted, state.matchInProgress, state.venue, state.matchFormat],
  toss: [state.coinToss, state.setServeStart],
  undo: [state.home.history.length, state.visitor.history.length],
});

test.describe('save and restore', () => {
  test('[OBSERVED] storage uses one localStorage key whose value is {state, homeTeamName, visitorTeamName, theme, savedAt}', async ({ app }) => {
    await app.open();
    await app.ev(() => saveToLocalStorage());
    const r = await app.ev(k => ({ keys: Object.keys(localStorage), payload: JSON.parse(localStorage.getItem(k)) }), KEY);
    expect(r.keys).toEqual([KEY]);
    expect(Object.keys(r.payload).sort()).toEqual(['homeTeamName', 'savedAt', 'state', 'theme', 'visitorTeamName']);
    expect(typeof r.payload.state.home.score).toBe('number');
  });

  test('[OBSERVED] persisted state has exactly the audited top-level keys', async ({ app }) => {
    await app.open();
    await app.ev(() => saveToLocalStorage());
    const keys = await app.ev(k => Object.keys(JSON.parse(localStorage.getItem(k)).state).sort(), KEY);
    expect(keys).toEqual([
      'coinToss', 'currentColor', 'currentHomeTeamId', 'currentPenSize', 'currentTeam', 'currentTheme', 'currentVisitorTeamId',
      'defaultHomeTeamId', 'drawing', 'gameStarted', 'hasUserChosenTheme', 'home', 'homeTeamBank', 'jerseyColors', 'liberoRules',
      'markerTabMinimized', 'markerTabPosition', 'matchArchive', 'matchFormat', 'matchInProgress', 'matchTimeline', 'rotationPlanner',
      'setHistory', 'setServeStart', 'skipConfirmations', 'statsEnabled', 'suppressRotationPrompt', 'venue', 'visitor',
      'visitorRosterEnabled', 'visitorTeamBank', 'whiteboardEnabled', 'whiteboardStrokes',
    ].sort());
    const teamKeys = await app.ev(k => Object.keys(JSON.parse(localStorage.getItem(k)).state.home).sort(), KEY);
    expect(teamKeys).toEqual(['history', 'positions', 'roster', 'rotations', 'score', 'serving', 'substitutions', 'subsRemaining', 'teamKills'].sort());
  });

  test('[OBSERVED] a mid-set match restores score, serve, lineups, subs, stats, timeline, toss and venue after reload', async ({ app }) => {
    await app.open();
    await app.startMatch({ venue: 'away', winner: 'visitor', choice: 'serve' });
    await app.point('home'); await app.point('visitor'); await app.point('visitor'); await app.point('home');
    await app.ev(() => { addScore('home'); recordKill(state.home.positions[0].id); recordAssist(state.home.positions[1].id); });
    await app.sub('home', 3, 'Addi Rogers');
    const before = await app.ev(snap);
    await app.ev(() => saveToLocalStorage());
    await app.reload();
    expect(await app.ev(snap)).toEqual(before);
  });

  test('[OBSERVED] after reload the scoreboard DOM equals state (no 0-0 flash), and the resume prompt is shown', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 7); await app.points('visitor', 4);
    await app.sub('home', 0, 'Addi Rogers');
    await app.ev(() => saveToLocalStorage());
    await app.reload();
    const r = await app.ev(() => ({
      dom: [document.getElementById('home-score').textContent, document.getElementById('visitor-score').textContent, document.getElementById('home-subs-remaining').textContent],
      resume: document.getElementById('resume-match-modal').classList.contains('active'),
      detail: document.getElementById('resume-match-details').textContent.replace(/\s+/g, ' '),
      badge: document.getElementById('home-venue-badge').textContent,
    }));
    expect(r.dom).toEqual(['7', '4', '11']);
    expect(r.resume).toBe(true);
    expect(r.detail).toContain('Set 1 (in progress)');
    expect(r.detail).toContain('7 – 4');
  });

  test('[OBSERVED] between-sets state restores: set history, locks, next-set button label', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 3);
    await app.ev(() => startNewSet());
    await app.ev(() => saveToLocalStorage());
    await app.reload();
    expect(await app.ev(() => [state.setHistory.length, state.gameStarted, state.matchInProgress])).toEqual([1, false, true]);
    expect(await app.ev(() => document.getElementById('uc-start-game-btn').textContent)).toContain('Start Set 2');
    expect(await app.ev(() => [isRosterReadOnly(), document.querySelectorAll('.game-lock-btn').length])).toEqual([true, 0]);   // .game-lock-btn selector matches no element in markup
  });

  test('[KNOWN_BUG] lost in-flight point: reload while the stat prompt is open keeps the score but not the timeline event', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.ev(() => addScore('home'));
    await app.ev(() => saveToLocalStorage());
    await app.reload();
    expect(await app.ev(() => [state.home.score, state.matchTimeline.length])).toEqual([1, 0]);
  });

  test('[OBSERVED] object identity: positions and roster entries are the same object in session, separate copies after reload', async ({ app }) => {
    await app.open();
    await app.startMatch();
    expect(await app.ev(() => state.home.positions[0] === state.home.roster[0])).toBe(true);
    await app.ev(() => saveToLocalStorage());
    await app.reload();
    expect(await app.ev(() => state.home.positions[0] === state.home.roster.find(p => p.id === state.home.positions[0].id))).toBe(false);
    expect(await app.ev(() => state.home.positions[0].id === state.home.roster.find(p => p.id === state.home.positions[0].id).id)).toBe(true);
  });

  test('[OBSERVED] team names live in the wrapper (from the DOM), not in state', async ({ app }) => {
    await app.open();
    const name = await app.ev(() => document.getElementById('visitor-name').textContent);
    await app.ev(() => saveToLocalStorage());
    const w = await app.ev(k => JSON.parse(localStorage.getItem(k)), KEY);
    expect(w.visitorTeamName).toBe(name);
    expect(JSON.stringify(w.state)).not.toContain('"homeTeamName"');
  });

  test('[OBSERVED] an older save without matchInProgress infers it from gameStarted / setHistory', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 2);
    await app.ev(() => saveToLocalStorage());
    await app.reloadWith(k => { const p = JSON.parse(localStorage.getItem(k)); delete p.state.matchInProgress; localStorage.setItem(k, JSON.stringify(p)); }, KEY);
    expect(await app.ev(() => state.matchInProgress)).toBe(true);
  });

  test('[OBSERVED] an invalid matchFormat in a save is clamped to 3', async ({ app }) => {
    await app.open();
    await app.ev(() => saveToLocalStorage());
    await app.reloadWith(k => { const p = JSON.parse(localStorage.getItem(k)); p.state.matchFormat = 7; localStorage.setItem(k, JSON.stringify(p)); }, KEY);
    expect(await app.ev(() => state.matchFormat)).toBe(3);
  });

  test('[OBSERVED] corrupt storage is ignored and the app starts fresh', async ({ app }) => {
    await app.open();
    await app.reloadWith(k => localStorage.setItem(k, '{not json'), KEY);
    expect(await app.ev(() => [state.home.score, state.matchInProgress, state.home.roster.length > 0])).toEqual([0, false, true]);
  });

  test('[OBSERVED] fields missing from an old save keep their defaults (merge over defaults)', async ({ app }) => {
    await app.open();
    await app.ev(() => saveToLocalStorage());
    await app.reloadWith(k => { const p = JSON.parse(localStorage.getItem(k)); delete p.state.whiteboardStrokes; delete p.state.venue; localStorage.setItem(k, JSON.stringify(p)); }, KEY);
    expect(await app.ev(() => [Array.isArray(state.whiteboardStrokes), state.venue])).toEqual([true, null]);
  });

  test('[OBSERVED] Download Backup emits the localStorage payload as court-commander-backup-*.json', async ({ app }) => {
    await app.open();
    await app.ev(() => saveToLocalStorage());
    const [dl] = await Promise.all([app.page.waitForEvent('download'), app.ev(() => downloadBackup())]);
    expect(dl.suggestedFilename()).toMatch(/^court-commander-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/);
    const body = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    expect(Object.keys(body).sort()).toEqual(['homeTeamName', 'savedAt', 'state', 'theme', 'visitorTeamName']);
  });

  // Regression for X8 (fixed in app-version 2026-10-11-1): the pagehide/visibilitychange/interval
  // autosaves used to overwrite the restored data with the live state while the page reloaded.
  test('[OBSERVED] X8 regression: Restore Backup round trip (export, mutate, restore, reload, compare)', async ({ app }) => {
    await app.open();
    await app.startMatch({ venue: 'away', winner: 'visitor', choice: 'serve' });
    await app.point('home'); await app.point('visitor'); await app.point('visitor');
    await app.ev(() => { addScore('home'); recordKill(state.home.positions[0].id); recordAssist(state.home.positions[1].id); });
    await app.sub('home', 3, 'Addi Rogers');
    await app.ev(() => saveToLocalStorage());
    const exported = await app.ev(snap);
    const [dl] = await Promise.all([app.page.waitForEvent('download'), app.ev(() => downloadBackup())]);
    const file = await dl.path();

    await app.points('visitor', 3);                                   // mutate after the export
    await app.sub('visitor', 1, await app.ev(() => state.visitor.roster[7].name));
    await app.ev(() => saveToLocalStorage());
    expect(await app.ev(snap)).not.toEqual(exported);

    const nav = app.page.waitForEvent('framenavigated');
    await app.page.setInputFiles('#restore-file-input', file);
    await nav;
    await app.page.waitForFunction(() => typeof state !== 'undefined');
    expect(app.dialogs.some(d => d.message.includes('Restore this backup?'))).toBe(true);
    expect(await app.ev(snap)).toEqual(exported);

    await app.page.waitForTimeout(2600);                              // past one autosave interval
    expect(await app.ev(snap)).toEqual(exported);
    expect(await app.ev(k => JSON.parse(localStorage.getItem(k)).state.home.score, KEY)).toBe(exported.score[0]);
    expect(await app.ev(() => document.getElementById('resume-match-modal').classList.contains('active'))).toBe(true);
  });

  test('[OBSERVED] X8 regression: restoring onto a fresh device (empty storage) loads the backup', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 5); await app.points('visitor', 2);
    await app.sub('home', 0, 'Addi Rogers');
    await app.ev(() => saveToLocalStorage());
    const exported = await app.ev(snap);
    const [dl] = await Promise.all([app.page.waitForEvent('download'), app.ev(() => downloadBackup())]);
    const file = await dl.path();

    await app.reloadWith(() => localStorage.clear());                 // simulate a new device
    expect(await app.ev(() => [state.matchInProgress, state.home.score])).toEqual([false, 0]);
    const nav = app.page.waitForEvent('framenavigated');
    await app.page.setInputFiles('#restore-file-input', file);
    await nav;
    await app.page.waitForFunction(() => typeof state !== 'undefined');
    expect(await app.ev(snap)).toEqual(exported);
  });

  test('[OBSERVED] X8 regression: restoring an unreadable file alerts and leaves state and autosave intact', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 2);
    const fs = require('fs');
    const bad = require('path').join(require('os').tmpdir(), 'cc-bad-backup.json');
    fs.writeFileSync(bad, '{"nope":1}');
    await app.page.setInputFiles('#restore-file-input', bad);
    await app.page.waitForFunction(() => document.body && true);
    await expect.poll(() => app.dialogs.some(d => d.message.includes('could not be read'))).toBe(true);
    await app.ev(() => saveToLocalStorage());
    expect(await app.ev(k => JSON.parse(localStorage.getItem(k)).state.home.score, KEY)).toBe(2);   // autosave still works after a failed restore
    fs.rmSync(bad, { force: true });
  });

  test('[OBSERVED] X8: if the restore write throws (quota / private mode), the user is alerted, no reload happens, and autosave stays enabled', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 2);
    await app.ev(() => saveToLocalStorage());
    const [dl] = await Promise.all([app.page.waitForEvent('download'), app.ev(() => downloadBackup())]);
    const file = await dl.path();
    await app.points('home', 1);
    await app.ev(() => {
      window.__marker = 'same-page';
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (window.__failWrites && k === 'courtCommanderState_v1') throw new DOMException('quota', 'QuotaExceededError'); return orig.call(this, k, v); };
      window.__failWrites = true;
    });
    await app.page.setInputFiles('#restore-file-input', file);
    await expect.poll(() => app.dialogs.some(d => d.message.includes('could not be read'))).toBe(true);
    expect(await app.ev(() => window.__marker)).toBe('same-page');            // page was not reloaded
    expect(await app.ev(() => autosaveSuspended)).toBe(false);
    await app.ev(() => { window.__failWrites = false; saveToLocalStorage(); });
    expect(await app.ev(k => JSON.parse(localStorage.getItem(k)).state.home.score, KEY)).toBe(3);   // old value intact, autosave resumes
  });

  // Regression for X10 (fixed in app-version 2026-10-11-2): the unload autosave used to rewrite
  // the data that Erase Saved Data had just removed.
  test('[OBSERVED] X10 regression: Erase Saved Data removes the data and the reload does not re-save it', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 3);
    await app.ev(() => saveToLocalStorage());
    const nav = app.page.waitForEvent('framenavigated');
    await app.ev(() => clearSavedData());
    await nav;
    await app.page.waitForFunction(() => typeof state !== 'undefined');
    expect(await app.ev(() => [state.home.score, state.matchInProgress])).not.toEqual([3, true]);
    expect(await app.ev(() => state.matchInProgress)).toBeFalsy();
  });

  test('[OBSERVED] X10 regression: erase persists across an autosave interval and a manual reload', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 3);
    await app.ev(() => saveToLocalStorage());
    const nav = app.page.waitForEvent('framenavigated');
    await app.ev(() => clearSavedData());
    await nav;
    await app.page.waitForFunction(() => typeof state !== 'undefined');
    await app.page.waitForTimeout(2600);                              // past one autosave interval
    // the fresh page may autosave its own empty state; the erased match must not come back
    const stored = k => { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw).state : null; };
    const after = await app.ev(stored, KEY);
    expect(!after || (!after.matchInProgress && after.home.score === 0)).toBe(true);
    await app.reload();                                               // manual reload
    const after2 = await app.ev(stored, KEY);
    expect(!after2 || (!after2.matchInProgress && after2.home.score === 0)).toBe(true);
    expect(await app.ev(() => state.matchInProgress)).toBeFalsy();
  });
});
