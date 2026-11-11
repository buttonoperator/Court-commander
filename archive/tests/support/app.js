// Shared fixture for the characterization suite.
//
// Conventions used in test titles:
//   [OBSERVED]     behavior recorded as-is; believed intended or at least harmless.
//   [KNOWN_BUG]    behavior recorded as-is that is a defect (see docs/audit). Do not
//                  treat as a rule. If the app is fixed, this test should fail and be
//                  inverted.
//   [MISSING_RULE] a rule the skill/plan describes that v1 does not enforce. The test
//                  records that v1 permits the action.
//
// Test setup drives the app through its own global functions (the same ones its
// onclick handlers call). Only the final state is asserted.
const base = require('@playwright/test');
const { expect } = base;

const test = base.test.extend({
  app: async ({ page }, use) => {
    const dialogs = [];
    const opts = { confirm: true, prompt: null };
    page.on('dialog', async d => {
      dialogs.push({ type: d.type(), message: d.message() });
      if (d.type() === 'confirm') return opts.confirm ? d.accept() : d.dismiss();
      if (d.type() === 'prompt') return d.accept(opts.prompt != null ? opts.prompt : d.defaultValue());
      return d.accept();
    });
    // Block everything that is not the local server (fonts, XLSX CDN).
    await page.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    // Stand-in for the blocked SheetJS CDN script: records what exportStats writes.
    await page.addInitScript(() => {
      window.__xlsx = { sheets: [], file: null, rows: {} };
      window.XLSX = {
        utils: {
          book_new: () => ({}),
          aoa_to_sheet: rows => ({ rows }),
          book_append_sheet: (wb, ws, name) => { window.__xlsx.sheets.push(name); window.__xlsx.rows[name] = ws.rows; },
        },
        writeFile: (wb, name) => { window.__xlsx.file = name; },
      };
    });
    const app = {
      page, dialogs, opts,
      async open() { await page.goto('/index.html'); await page.waitForFunction(() => typeof state !== 'undefined' && document.getElementById('home-name')); },
      ev: (fn, arg) => page.evaluate(fn, arg),
      lastDialog: () => dialogs[dialogs.length - 1],
      clearDialogs: () => { dialogs.length = 0; },
      names: (team) => page.evaluate(t => state[t].positions.map(p => p && p.name), team),
      score: () => page.evaluate(() => [state.home.score, state.visitor.score]),
      serving: () => page.evaluate(() => [state.home.serving, state.visitor.serving]),
      /** Loads an opponent from the seeded bank, fills both courts with the first six roster players. */
      async prepareTeams() {
        await page.evaluate(() => {
          const opp = state.visitorTeamBank.find(t => t.roster.length >= 8);
          loadTeamFromBank('visitor', opp.id, true);
          state.home.positions = state.home.roster.slice(0, 6);
          state.visitor.positions = state.visitor.roster.slice(0, 6);
          updateCourt('home'); updateCourt('visitor'); updateBench('home'); updateBench('visitor');
        });
      },
      /** Full start-of-match path through the same functions the buttons call. */
      async startMatch({ venue = 'home', winner = 'home', choice = 'serve', format } = {}) {
        await app.prepareTeams();
        if (format) await page.evaluate(f => setMatchFormat(f), format);
        await page.evaluate(({ venue, winner, choice }) => {
          setVenue(venue); setTossWinner(winner); resolveToss(choice); startSetWithCurrentLineup();
        }, { venue, winner, choice });
      },
      /** Awards a point and closes the stat prompt with Skip so the timeline entry is written. */
      async point(team) {
        await page.evaluate(t => { addScore(t); finalizePoint('SKIP', null); }, team);
      },
      async points(team, n) { for (let i = 0; i < n; i++) await app.point(team); },
      /** Sub the player at positionIdx for roster player `rosterIdx`. */
      async sub(team, positionIdx, rosterName) {
        await page.evaluate(({ team, positionIdx, rosterName }) => {
          openSubstitution(team, positionIdx);
          const p = state[team].roster.find(x => x.name === rosterName);
          confirmSubstitutionChoice(String(p.id));
        }, { team, positionIdx, rosterName });
      },
      /** Runs `fn` in the page (to edit localStorage), freezes autosave writes, then reloads. */
      async reloadWith(fn, arg) {
        await page.evaluate(fn, arg);
        await page.evaluate(() => {
          const orig = Storage.prototype.setItem;
          Storage.prototype.setItem = function (k, v) { if (k === 'courtCommanderState_v1') return; return orig.call(this, k, v); };
        });
        await page.reload();
        await page.waitForFunction(() => typeof state !== 'undefined');
      },
      reload: async () => { await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined'); },
    };
    await use(app);
  },
});

module.exports = { test, expect };
