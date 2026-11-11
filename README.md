# Court Commander v2

Live volleyball match control for Tampa Prep: scoring, rotations, substitutions, libero tracking, timeouts, statistics, lineup planning, match history with replay, and a tactics whiteboard. Ships as one self-contained `index.html` (no network required courtside), served by GitHub Pages as before.

## Commands

| Command | Action |
| --- | --- |
| `npm install` | Installs build and test tooling (esbuild, Preact, Playwright). Runtime has no dependencies. |
| `npm run build` | Bundles `src/` into `./index.html`. Optional: `node scripts/build.mjs --version 2026-11-10-1`. |
| `npm run test:unit` | Engine, rules, stats, import, seeding and v1 migration tests (Node test runner, 56 checks). |
| `npm run test:e2e` | Playwright suite against the built `index.html` (39 checks, phone and iPad viewports). |
| `npm test` | Unit tests, build, end-to-end tests. |
| `npm run test:archive` | Characterization suite of the frozen v1 build in `archive/` (reference only). |

Set `CHROME_PATH` to a local Chrome binary if Playwright's bundled browser is not installed.

Deploy: run `npm test`, bump the version (`--version`), commit `index.html`. Clients compare the `app-version` meta tag once per session and reload when it changes (not during a live match).

## Layout

```
src/
  core/            pure logic, no DOM; runs in Node and the browser
    maxpreps.js    MaxPreps team links and the parser for roster text pasted from a web page
    plan.js        rotation planner: both lineups over six rotations with planned subs
    rules.js       NFHS rules profile, zone/slot geometry, set and toss rules
    engine.js      event-sourced match engine: commands, replay, undo
    stats.js       box score, side-out / point-score %, rotation +/-, CSV
    roster.js      players, teams, sanitising, roster import/export
    model.js       persisted document (schema 2), normalisation, v1 migration
    seed.js        built-in teams and roster version sync
    seed-data.js   Tampa Prep and opponent rosters (from v1)
  app/
    store.js       document store, autosave, two-tab guard, backup/restore, update check
    color.js       team colour contrast handling
    ui/            Preact components (App, Live, Setup, LiveSheets, Stats, Teams, History, Planner, Whiteboard, Settings)
  styles/app.css   design system (night and day themes)
  assets/          logo, icons, Barlow Condensed (inlined at build)
  index.html       page template
scripts/build.mjs  single-file build
tests/unit         Node tests
tests/e2e          Playwright tests
tests/fixtures     v1 saves produced by the v1 build, anonymised
archive/            frozen v1 build and its characterization suite
docs/              architecture notes, roster JSON format
```

See `docs/architecture.md` for the data model and design decisions.
