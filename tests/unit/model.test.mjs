import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { migrateV1, normalizeDoc, emptyDoc, archiveFromMatch } from '../../src/core/model.js';
import { ensureSeedTeams, VARSITY_NAME } from '../../src/core/seed.js';
import { SEED_OPP, SEED_VERSION } from '../../src/core/seed-data.js';
import { createMatch, dispatch, replay } from '../../src/core/engine.js';
import { boxScore, teamReport, boxScoreCsv, fmtHit } from '../../src/core/stats.js';
import { normalizeImportPayload, parseJsonLoose, rosterEnvelope, createTeam, cleanText } from '../../src/core/roster.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

test('seed: first run creates Tampa Prep and every opponent, selects varsity', () => {
  const doc = ensureSeedTeams(emptyDoc());
  const us = doc.teams.filter((t) => t.side === 'us');
  const opp = doc.teams.filter((t) => t.side === 'opp');
  assert.ok(us.some((t) => t.name === VARSITY_NAME && t.players.length === 16));
  assert.equal(opp.length, SEED_OPP.length);
  assert.equal(doc.teams.find((t) => t.id === doc.selection.usId).name, VARSITY_NAME);
  assert.ok(opp.flatMap((t) => t.players).some((p) => p.libero), 'libero flags derived from "L" roles');
});

test('seed: idempotent, and a roster version bump re-syncs varsity keeping player ids', () => {
  const a = ensureSeedTeams(emptyDoc());
  const b = ensureSeedTeams(a);
  assert.equal(b.teams.length, a.teams.length);
  const v = a.teams.find((t) => t.name === VARSITY_NAME);
  const stale = { ...a, teams: a.teams.map((t) => (t === v ? { ...v, sourceVersion: 'old', players: v.players.slice(0, 3) } : t)) };
  const c = ensureSeedTeams(stale);
  const v2 = c.teams.find((t) => t.name === VARSITY_NAME);
  assert.equal(v2.players.length, 16);
  assert.equal(v2.sourceVersion, SEED_VERSION);
  assert.equal(v2.players[0].id, v.players[0].id);
});

test('migration: a v1 save with no match keeps teams, rosters, saved rotation and settings', () => {
  const doc = migrateV1(fixture('v1-fresh.json'));
  assert.ok(doc);
  const names = doc.teams.map((t) => t.name);
  // Fixtures are anonymised with scripts/anonymize-export.js (team and player names replaced).
  assert.equal(doc.teams.length, 15);
  assert.equal(doc.teams.find((t) => t.id === doc.selection.usId).name, 'Home Team 1');
  assert.equal(doc.teams.find((t) => t.id === doc.selection.oppId).name, 'Opponent 8');
  assert.ok(doc.teams.find((t) => t.id === doc.selection.usId).players.every((p) => /^Player \d{3}$/.test(p.name)));
  assert.equal(doc.presets.length, 1);
  assert.equal(doc.presets[0].name, 'Base 5-1');
  assert.equal(doc.presets[0].slots.filter(Boolean).length, 6, 'rotation players matched by name');
  assert.equal(doc.archive.length, 0);
  assert.equal(doc.match, null);
});

test('migration: a v1 match in progress becomes a carried-over history entry; archive kept', () => {
  const doc = migrateV1(fixture('v1-live-match.json'));
  assert.equal(doc.archive.length, 2);
  const [carried, archived] = doc.archive;
  assert.equal(carried.carriedOver, true);
  assert.deepEqual(carried.sets.map((s) => [s.n, s.us, s.opp, s.inProgress]), [[1, 6, 2, false], [2, 1, 1, true]]);
  assert.equal(carried.format, 5);
  assert.ok(carried.legacy.timeline.some((e) => e.type === 'substitution'));
  assert.ok(carried.legacy.box.us.some((p) => p.stats.K === 1));
  assert.deepEqual(archived.sets.map((s) => [s.us, s.opp]), [[6, 2]]);
  assert.equal(archived.legacy.timeline.filter((e) => e.type === 'point').length, 8);
  assert.equal(archived.legacy.timeline[0].court.us.length, 6);
});

test('migration output survives normalisation and seeding without duplicates', () => {
  const doc = ensureSeedTeams(normalizeDoc(JSON.parse(JSON.stringify(migrateV1(fixture('v1-live-match.json'))))));
  const varsity = doc.teams.filter((t) => t.name === VARSITY_NAME);
  assert.equal(varsity.length, 1);
  assert.equal(doc.archive.length, 2);
});

test('migration rejects junk', () => {
  assert.equal(migrateV1(null), null);
  assert.equal(migrateV1({ nope: 1 }), null);
});

test('normalizeDoc: strips markup, fills defaults, drops a corrupt match', () => {
  const doc = normalizeDoc({ teams: [{ id: 't', name: '<b>X</b>', side: 'opp', players: [{ name: 'A "B" <i>', jersey: '#4' }] }], match: { events: 'bad' }, setup: { format: 7 } });
  assert.equal(doc.teams[0].name, 'bX/b');
  assert.equal(doc.teams[0].players[0].name, 'A B i');
  assert.equal(doc.teams[0].players[0].jersey, '4');
  assert.equal(doc.match, null);
  assert.equal(doc.setup.format, 3);
  assert.equal(doc.settings.rules.subsPerSet, 18);
});

test('import: native envelopes, aliases, fences, warnings', () => {
  const a = normalizeImportPayload([{ player: 'Jane Doe', '#': '#12', pos: 'OH', year: '11' }, { firstName: 'Kim', lastName: 'Lee', number: 7, pos: 'Opp', class: 'Senior' }, { name: 'Sam Ray', num: '4', pos: 'L' }, '9 Pat Quinn']);
  assert.deepEqual(a.teams[0].players.map((p) => [p.name, p.jersey, p.roles.join('/'), p.grade, p.libero]), [
    ['Jane Doe', '12', 'OH', 'Jr.', false], ['Kim Lee', '7', 'RS', 'Sr.', false], ['Sam Ray', '4', 'L', '', true], ['Pat Quinn', '9', '', '', false],
  ]);
  const fenced = parseJsonLoose('Here:\n```json\n{"teamName":"F","roster":[{"name":"A","jersey":"1"}]}\n```\nthanks');
  assert.equal(fenced.ok, true);
  const w = normalizeImportPayload({ teamName: 'W', roster: [{ name: 'D', jersey: '5' }, { name: 'E', jersey: '5' }, { jersey: '9' }] });
  assert.deepEqual(w.warnings, ['W: 1 entry without a name skipped.', 'W: jersey #5 is used by more than one player.']);
  assert.equal(normalizeImportPayload({ hello: 1 }), null);
  const bank = normalizeImportPayload({ type: 'court-commander-team-bank', teams: [{ name: 'A', roster: [{ name: 'x' }] }, { name: 'B', roster: [{ name: 'y' }] }] });
  assert.equal(bank.kind, 'bank');
});

test('export round-trips through import', () => {
  const t = createTeam({ name: 'RT', side: 'opp', players: [{ name: 'A B', jersey: '3', roles: ['OH', 'RS'], grade: 'Jr.' }, { name: 'C D', jersey: '1', roles: ['L'] }] });
  const back = normalizeImportPayload(JSON.parse(JSON.stringify(rosterEnvelope(t))));
  assert.deepEqual(back.teams[0].players.map((p) => [p.name, p.jersey, p.roles, p.grade, p.libero]), [['A B', '3', ['OH', 'RS'], 'Jr.', false], ['C D', '1', ['L'], '', true]]);
  assert.equal(cleanText(null), null);
});

test('stats: derived from rallies, undo-safe, team report and CSV', () => {
  const us = createTeam({ id: 'u', name: 'Us', side: 'us', players: Array.from({ length: 8 }, (_, i) => ({ id: `u${i}`, name: `U${i}`, jersey: `${i}` })) });
  const opp = createTeam({ id: 'o', name: 'Them', side: 'opp', players: Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, name: `O${i}`, jersey: `${i}` })) });
  let m = createMatch({ us, opp });
  const go = (t, a) => { const r = dispatch(m, t, a); assert.ok(r.ok, r.error); m = r.match; };
  go('startSet', { lineup: { us: ['u0', 'u1', 'u2', 'u3', 'u4', 'u5'], opp: ['o0', 'o1', 'o2', 'o3', 'o4', 'o5'] }, toss: { winner: 'us', choice: 'serve' } });
  go('rally', { winner: 'us', code: 'ACE' });
  go('rally', { winner: 'us', code: 'K', actor: 'u2', assist: 'u1' });
  go('rally', { winner: 'opp', code: 'E', actor: 'u2' });
  go('rally', { winner: 'us', code: 'BLK', actor: 'u3', victim: 'o4' });
  go('adjustStat', { team: 'us', player: 'u4', stat: 'D', delta: 3 });
  const view = replay(m);
  const box = boxScore(m, view);
  const row = (id) => box.us.rows.find((r) => r.player.id === id).stats;
  assert.equal(row('u0').SA, 1);
  assert.equal(row('u0').SRV, 3, 'served the ace, the kill and the lost rally');
  assert.deepEqual([row('u2').K, row('u2').E, row('u2').ATT], [1, 1, 2]);
  assert.equal(fmtHit(row('u2').HIT), '.000');
  assert.equal(row('u1').AST, 1);
  assert.equal(row('u3').BS, 1);
  assert.equal(row('u4').D, 3);
  assert.equal(row('u0').PM, 2, 'on court for 3 won and 1 lost');
  assert.equal(box.us.totals.PTS, 3);
  const rep = teamReport(view);
  assert.equal(rep.teams.us.won, 3);
  assert.equal(rep.teams.opp.sideoutPct, 1 / 3);
  assert.equal(rep.teams.us.sideoutPct, 1);
  assert.equal(rep.teams.us.longestRun, 2);
  assert.equal(rep.rotations[0].rallies, 4, 'we only rotate after winning the 4th rally');
  assert.match(boxScoreCsv(m, view), /^Team,#,Player,K,E,TA,HIT%/);
  const archived = archiveFromMatch(m);
  assert.deepEqual(archived.sets, [{ n: 1, us: 3, opp: 1, winner: null, inProgress: true }]);
});
