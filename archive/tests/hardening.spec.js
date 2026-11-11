const { test, expect } = require('./support/app');

// Open issues closed after Stage 2: markup in names, two tabs overwriting each other, name fit after a hidden court.
const KEY = 'courtCommanderState_v1';
const EVIL = '<img src=x onerror="window.__pwned=1">Jane "JJ" Doe';

async function openSecondPage(context) {
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  await page.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof state !== 'undefined' && document.getElementById('home-name'));
  return page;
}

const stored = (page) => page.evaluate(k => { const p = JSON.parse(localStorage.getItem(k)); return [p.state.home.score, p.state.visitor.score]; }, KEY);
const overlayShown = (page) => page.evaluate(() => !!document.getElementById('open-elsewhere-overlay'));

test.describe('markup in names', () => {
  test('imported names lose <, > and " and render as text', async ({ app }) => {
    await app.open();
    await app.ev(t => { state.currentTeam = 'visitor'; processRosterImportText(t); },
      JSON.stringify({ teamName: '<b>Evil</b> High', roster: [{ name: EVIL, jersey: '<9>' }] }));
    const team = await app.ev(() => state.visitorTeamBank.find(t => t.name.includes('Evil')));
    expect(team.name).toBe('bEvil/b High');
    expect(team.roster[0].name).toBe('img src=x onerror=window.__pwned=1Jane JJ Doe');
    expect(team.roster[0].jersey).toBe('9');
    await app.ev(id => { loadTeamFromBank('visitor', id, true); state.visitor.positions = state.visitor.roster.slice(0, 1).concat([null, null, null, null, null]); updateCourt('visitor'); updateBench('visitor'); }, team.id);
    expect(await app.ev(() => document.querySelectorAll('#visitor-court img').length)).toBe(0);
    expect(await app.ev(() => window.__pwned)).toBeUndefined();
  });

  test('a saved or restored state carrying markup is cleaned on load', async ({ app }) => {
    await app.open();
    await app.ev(() => saveToLocalStorage());
    await app.reloadWith(([k, evil]) => {
      const p = JSON.parse(localStorage.getItem(k));
      p.state.home.roster[0].name = evil;
      p.state.home.positions[0] = p.state.home.roster[0];
      p.visitorTeamName = '<i>Opp</i>';
      localStorage.setItem(k, JSON.stringify(p));
    }, [KEY, EVIL]);
    expect(await app.ev(() => state.home.roster[0].name)).toBe('img src=x onerror=window.__pwned=1Jane JJ Doe');
    expect(await app.ev(() => document.getElementById('visitor-name').textContent)).toBe('iOpp/i');
    expect(await app.ev(() => document.querySelectorAll('img[src="x"]').length)).toBe(0);
    expect(await app.ev(() => window.__pwned)).toBeUndefined();
  });

  test('the player form strips markup characters; apostrophes are kept', async ({ app }) => {
    await app.open();
    await app.ev(() => openRoster('home'));
    await app.page.fill('#player-name', `<b>Kate</b> O'Neil "KO"`);
    await app.ev(() => addPlayer());
    const names = await app.ev(() => state.home.roster.map(p => p.name));
    expect(names).toContain(`bKate/b O'Neil KO`);
  });

  test('cleanUserText keeps cancel (null) from prompts', async ({ app }) => {
    await app.open();
    expect(await app.ev(() => [cleanUserText(null), cleanUserText(undefined), cleanUserText('a<b>"c')])).toEqual([null, undefined, 'abc']);
  });
});

test.describe('two tabs on the same site', () => {
  test('opening a second tab stops the first one saving and shows the reload prompt', async ({ app, context }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 2);
    expect(await overlayShown(app.page)).toBe(false);
    const b = await openSecondPage(context);
    await expect.poll(() => overlayShown(app.page)).toBe(true);
    expect(await app.ev(() => autosaveSuspended)).toBe(true);
    // The first tab's in-memory changes no longer reach storage.
    await app.points('home', 3);
    await app.ev(() => saveToLocalStorage());
    expect(await stored(b)).toEqual([2, 0]);
    expect(await overlayShown(b)).toBe(false);
  });

  test('Restore Backup in one tab is not overwritten by another open tab', async ({ app, context }) => {
    await app.open();
    await app.startMatch();
    await app.points('home', 3); await app.points('visitor', 2);
    const [dl] = await Promise.all([app.page.waitForEvent('download'), app.ev(() => downloadBackup())]);
    const file = await dl.path();
    await app.points('home', 3);                                   // this tab now at 6-2
    await app.ev(() => saveToLocalStorage());

    const b = await openSecondPage(context);                       // tab B takes control
    await expect.poll(() => overlayShown(app.page)).toBe(true);
    const nav = b.waitForEvent('framenavigated');
    await b.setInputFiles('#restore-file-input', file);
    await nav;
    await b.waitForFunction(() => typeof state !== 'undefined');
    expect(await stored(b)).toEqual([3, 2]);
    await b.waitForTimeout(4500);                                  // two autosave intervals of the stale tab
    expect(await stored(b)).toEqual([3, 2]);
    expect(await app.ev(() => [state.home.score, state.visitor.score])).toEqual([6, 2]);   // stale tab kept its view, did not write
  });

  test('Reload in the stale tab takes control back; the other tab is then prompted', async ({ app, context }) => {
    await app.open();
    await app.startMatch();
    const b = await openSecondPage(context);
    await expect.poll(() => overlayShown(app.page)).toBe(true);
    await app.page.click('#open-elsewhere-reload-btn');
    await app.page.waitForFunction(() => typeof state !== 'undefined' && !document.getElementById('open-elsewhere-overlay'));
    await expect.poll(() => overlayShown(b)).toBe(true);
    expect(await app.ev(() => autosaveSuspended)).toBe(false);
  });
});

test.describe('court name fit', () => {
  test('a long name rendered while the court tab was hidden is fitted when the court is shown', async ({ app }) => {
    await app.open();
    await app.startMatch();
    await app.page.click("button.tab-btn[onclick=\"switchTab('stats')\"]");
    await app.ev(() => {
      state.visitor.positions[0] = { id: -1, name: 'Alexandria Montgomery-Washington', jersey: '88', position: '', grade: '', libero: false, stats: {} };
      updateCourt('visitor');
    });
    await app.page.click("button.tab-btn[onclick=\"switchTab('court')\"]");
    const r = await app.ev(() => {
      const el = document.querySelector('#visitor-court .position[data-position-index="0"] .player-name');
      return { size: el.style.fontSize, clipped: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1 };
    });
    expect(r.size).not.toBe('');
    expect(r.clipped).toBe(false);
  });
});
