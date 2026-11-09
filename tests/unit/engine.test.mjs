import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, replay, dispatch, undo, onCourt, benchOf, describeEvent } from '../../src/core/engine.js';
import { createTeam } from '../../src/core/roster.js';
import { setWinner, setRequiresToss, decidingSetNumber, zoneOfSlot, slotInZone, NFHS } from '../../src/core/rules.js';

const roster = (prefix, n = 10) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix.toUpperCase()} Player ${i + 1}`, jersey: String(i + 1), roles: [] }));
const us = createTeam({ id: 'us', name: 'Tampa Prep', side: 'us', players: [...roster('u', 9), { id: 'uL', name: 'U Libero', jersey: '20', roles: ['L'], libero: true }] });
const opp = createTeam({ id: 'op', name: 'Rival', side: 'opp', players: roster('o', 10) });
const L = { us: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'], opp: ['o1', 'o2', 'o3', 'o4', 'o5', 'o6'] };

/** Runs commands, throwing on the first rejection so a test fails at the right line. */
function run(match, ...steps) {
  for (const [type, args] of steps) {
    const r = dispatch(match, type, args);
    if (!r.ok) throw new Error(`${type} rejected: ${r.error}`);
    match = r.match;
  }
  return match;
}
const point = (winner, extra = {}) => ['rally', { winner, ...extra }];
const points = (winner, n) => Array.from({ length: n }, () => point(winner));
function started(opts = {}) {
  const m = createMatch({ format: opts.format ?? 3, us, opp });
  return run(m, ['startSet', { lineup: L, libero: { us: opts.libero ? 'uL' : null }, toss: { winner: 'us', choice: opts.choice || 'serve' } }]);
}

test('geometry: slots and zones are inverse, side-out moves zone 2 to zone 1', () => {
  for (let r = 0; r < 12; r++) for (let z = 0; z < 6; z++) assert.equal(zoneOfSlot(slotInZone(z, r), r), z);
  assert.equal(slotInZone(0, 1), 1);
});

test('toss: winner serve / receive sets the first server', () => {
  assert.equal(replay(started()).current.serving, 'us');
  assert.equal(replay(started({ choice: 'receive' })).current.serving, 'opp');
});

test('set 1 cannot start without a toss; lineups are validated', () => {
  const m = createMatch({ us, opp });
  assert.match(dispatch(m, 'startSet', { lineup: L }).error, /coin toss/);
  assert.match(dispatch(m, 'startSet', { lineup: { ...L, us: L.us.slice(0, 5) }, toss: { winner: 'us', choice: 'serve' } }).error, /six players/);
  assert.match(dispatch(m, 'startSet', { lineup: { ...L, us: ['u1', 'u1', 'u3', 'u4', 'u5', 'u6'] }, toss: { winner: 'us', choice: 'serve' } }).error, /same player/);
  assert.match(dispatch(m, 'startSet', { lineup: L, libero: { us: 'u1' }, toss: { winner: 'us', choice: 'serve' } }).error, /libero/);
});

test('serving team scores: +1, no rotation, keeps serve', () => {
  const m = run(started(), point('us'));
  const v = replay(m);
  assert.deepEqual(v.current.score, { us: 1, opp: 0 });
  assert.deepEqual(onCourt(v.current, 'us'), L.us);
  assert.equal(v.current.serving, 'us');
});

test('receiving team scores: +1, rotates clockwise, takes the serve; other team unchanged', () => {
  const v = replay(run(started(), point('opp')));
  assert.deepEqual(onCourt(v.current, 'opp'), ['o2', 'o3', 'o4', 'o5', 'o6', 'o1']);
  assert.deepEqual(onCourt(v.current, 'us'), L.us);
  assert.equal(v.current.serving, 'opp');
});

test('six side-outs each return both teams to the starting lineup', () => {
  let m = started();
  for (let i = 0; i < 6; i++) m = run(m, point('opp'), point('us'));
  const v = replay(m);
  assert.deepEqual(onCourt(v.current, 'us'), L.us);
  assert.deepEqual(onCourt(v.current, 'opp'), L.opp);
});

test('rally records the server, rotation and the lineup before the point', () => {
  const v = replay(run(started(), point('opp'), point('opp')));
  const [a, b] = v.current.rallies;
  assert.equal(a.server, 'u1');
  assert.equal(a.sideout, true);
  assert.equal(b.server, 'o2');
  assert.equal(b.sideout, false);
  assert.deepEqual(b.rotBefore, { us: 0, opp: 1 });
});

test('NFHS scoring: 25 win-by-2, no cap, deciding set to 15', () => {
  assert.equal(setWinner({ us: 25, opp: 23 }, 1, 3), 'us');
  assert.equal(setWinner({ us: 25, opp: 24 }, 1, 3), null);
  assert.equal(setWinner({ us: 31, opp: 33 }, 1, 3), 'opp');
  assert.equal(setWinner({ us: 15, opp: 13 }, 3, 3), 'us');
  assert.equal(setWinner({ us: 15, opp: 13 }, 3, 5), null);
  assert.equal(setWinner({ us: 15, opp: 13 }, 5, 5), 'us');
  assert.equal(setWinner({ us: 15, opp: 0 }, 1, 1), null);
});

test('a set ends itself at 25-x and further rallies are refused', () => {
  let m = run(started(), ...points('us', 25));
  const v = replay(m);
  assert.equal(v.current.winner, 'us');
  assert.equal(v.phase, 'between');
  assert.deepEqual(v.setsWon, { us: 1, opp: 0 });
  assert.match(dispatch(m, 'rally', { winner: 'us' }).error, /Start the set/);
});

test('set point flag', () => {
  const v = replay(run(started(), ...points('us', 24)));
  assert.equal(v.setPoint, 'us');
});

test('serve alternates in middle sets; toss for set 1 and the deciding set only', () => {
  assert.deepEqual([1, 2, 3, 4, 5].filter((n) => setRequiresToss(n, 5)), [1, 5]);
  assert.deepEqual([1, 2, 3].filter((n) => setRequiresToss(n, 3)), [1, 3]);
  assert.deepEqual([1].filter((n) => setRequiresToss(n, 1)), [1]);
  assert.equal(decidingSetNumber(1), null);
  let m = started({ format: 5 });
  m = run(m, ...points('us', 25), ['startSet', { lineup: L }]);
  assert.equal(replay(m).current.firstServer, 'opp');
  m = run(m, ...points('opp', 25), ['startSet', { lineup: L }]);
  assert.equal(replay(m).current.firstServer, 'us');
});

test('deciding set needs a toss; "side" choice lets the loser pick serve', () => {
  let m = started({ format: 3 });
  m = run(m, ...points('us', 25), ['startSet', { lineup: L }], ...points('opp', 25));
  assert.match(dispatch(m, 'startSet', { lineup: L }).error, /coin toss/);
  m = run(m, ['startSet', { lineup: L, toss: { winner: 'us', choice: 'side' }, firstServer: 'opp' }]);
  const v = replay(m);
  assert.equal(v.current.n, 3);
  assert.equal(v.current.firstServer, 'opp');
  assert.deepEqual(v.current.toss, { winner: 'us', choice: 'side' });
});

test('deciding set flags the side switch when a team reaches 8, once', () => {
  let m = started({ format: 3 });
  m = run(m, ...points('us', 25), ['startSet', { lineup: L }], ...points('opp', 25), ['startSet', { lineup: L, toss: { winner: 'us', choice: 'serve' } }], ...points('us', 9));
  const flags = replay(m).current.rallies.map((r) => r.sideSwitch);
  assert.deepEqual(flags.map((f, i) => (f ? i : -1)).filter((i) => i >= 0), [7]);
});

test('match decided: best-of-3 at 2-0, no further set, End Match allowed', () => {
  let m = started({ format: 3 });
  m = run(m, ...points('us', 25), ['startSet', { lineup: L }], ...points('us', 25));
  const v = replay(m);
  assert.equal(v.phase, 'decided');
  assert.equal(v.decided, 'us');
  assert.match(dispatch(m, 'startSet', { lineup: L }).error, /decided/);
  assert.equal(replay(run(m, ['endMatch', {}])).phase, 'ended');
});

test('best-of-1 is decided after one set', () => {
  let m = createMatch({ format: 1, us, opp });
  m = run(m, ['startSet', { lineup: L, toss: { winner: 'opp', choice: 'serve' } }], ...points('opp', 25));
  assert.equal(replay(m).decided, 'opp');
});

test('undo restores score, serve and rotation after a side-out', () => {
  const m = run(started(), point('opp'));
  const back = undo(m).match;
  const v = replay(back);
  assert.deepEqual(v.current.score, { us: 0, opp: 0 });
  assert.equal(v.current.serving, 'us');
  assert.deepEqual(onCourt(v.current, 'opp'), L.opp);
});

test('undo of a set-winning rally reopens the set (v1 X6 fixed)', () => {
  const m = run(started(), ...points('us', 25));
  const v = replay(undo(m).match);
  assert.equal(v.phase, 'live');
  assert.deepEqual(v.current.score, { us: 24, opp: 0 });
});

test('undo of Start Set returns to between-sets without touching the previous set', () => {
  const m = run(started(), ...points('us', 25), ['startSet', { lineup: L }]);
  const v = replay(undo(m).match);
  assert.equal(v.phase, 'between');
  assert.deepEqual(v.sets[0].score, { us: 25, opp: 0 });
});

test('ace and service error take the server automatically and validate the serving team', () => {
  let m = started();
  assert.match(dispatch(m, 'rally', { winner: 'opp', code: 'ACE' }).error, /serving team/);
  m = run(m, point('us', { code: 'ACE' }));
  assert.equal(replay(m).current.rallies[0].actor, 'u1');
  m = run(m, point('opp', { code: 'SE' }));
  assert.equal(replay(m).current.rallies[1].actor, 'u1');
});

test('kill with assist; actor must be on court; assist dropped when same as killer', () => {
  let m = started();
  assert.match(dispatch(m, 'rally', { winner: 'us', code: 'K', actor: 'u9' }).error, /not on the court/);
  m = run(m, point('us', { code: 'K', actor: 'u3', assist: 'u2' }), point('us', { code: 'K', actor: 'u3', assist: 'u3' }));
  const [a, b] = replay(m).current.rallies;
  assert.equal(a.assist, 'u2');
  assert.equal(b.assist, null);
});

test('amendRally re-describes the last rally in place', () => {
  let m = run(started(), point('us'));
  m = run(m, ['amendRally', { code: 'K', actor: 'u4' }]);
  assert.equal(m.events.length, 2);
  const r = replay(m).current.rallies[0];
  assert.deepEqual([r.winner, r.code, r.actor], ['us', 'K', 'u4']);
  assert.match(dispatch(run(m, ['timeout', { team: 'us' }]), 'amendRally', { code: 'K' }).error, /Nothing to amend/);
});

test('substitution: swaps in place, counts, and the replaced player goes to the bench', () => {
  const m = run(started(), ['sub', { team: 'us', zone: 3, in: 'u8' }]);
  const v = replay(m);
  assert.equal(onCourt(v.current, 'us')[3], 'u8');
  assert.equal(v.current.subsUsed.us, 1);
  assert.ok(benchOf(m, v.current, 'us').some((p) => p.id === 'u4'));
  assert.ok(!benchOf(m, v.current, 'us').some((p) => p.id === 'u8'));
});

test('NFHS position lock: a player returns only to the lineup position they played (v1 R10 fixed)', () => {
  let m = run(started(), ['sub', { team: 'us', zone: 1, in: 'u8' }]);
  // u2 (starter, slot 1) may come back for u8 in slot 1
  assert.equal(dispatch(m, 'sub', { team: 'us', zone: 1, in: 'u2' }).ok, true);
  // but u2 may not enter a different lineup position
  assert.match(dispatch(m, 'sub', { team: 'us', zone: 4, in: 'u2' }).error, /lineup position 2/);
  // and u8, now bound to slot 1, may not replace someone else later
  m = run(m, ['sub', { team: 'us', zone: 1, in: 'u2' }]);
  assert.match(dispatch(m, 'sub', { team: 'us', zone: 5, in: 'u8' }).error, /lineup position 2/);
  // the lock follows the slot through rotations
  m = run(m, point('opp'), point('us'));
  assert.equal(dispatch(m, 'sub', { team: 'us', zone: 0, in: 'u8' }).ok, true);
});

test('substitution limit is the rules profile value (NFHS 18)', () => {
  let m = started();
  for (let i = 0; i < NFHS.subsPerSet; i++) m = run(m, ['sub', { team: 'us', zone: 0, in: i % 2 ? 'u1' : 'u7' }]);
  assert.match(dispatch(m, 'sub', { team: 'us', zone: 2, in: 'u9' }).error, /No substitutions left/);
  assert.equal(replay(m).current.subsUsed.opp, 0);
});

test('subs and timeouts reset each set', () => {
  let m = run(started(), ['sub', { team: 'us', zone: 0, in: 'u7' }], ['timeout', { team: 'us' }], ...points('us', 25), ['startSet', { lineup: L }]);
  const v = replay(m);
  assert.deepEqual(v.current.subsUsed, { us: 0, opp: 0 });
  assert.deepEqual(v.current.timeoutsUsed, { us: 0, opp: 0 });
});

test('libero: back row only, not a sub, and leaves automatically at the front row', () => {
  let m = started({ libero: true });
  assert.match(dispatch(m, 'liberoIn', { team: 'us', zone: 2 }).error, /back-row/);
  m = run(m, ['liberoIn', { team: 'us', zone: 4 }]); // zone 5: slot 4 (u5)
  let v = replay(m);
  assert.equal(onCourt(v.current, 'us')[4], 'uL');
  assert.equal(v.current.subsUsed.us, 0);
  assert.match(dispatch(m, 'sub', { team: 'us', zone: 0, in: 'uL' }).error, /libero cannot enter/);
  assert.match(dispatch(m, 'sub', { team: 'us', zone: 4, in: 'u7' }).error, /Take the libero out/);
  // We serve. Opp side-out, then our side-out rotates slot 4 into zone 4 (front row).
  m = run(m, point('opp'), point('us'));
  v = replay(m);
  assert.equal(v.current.libero.us, null);
  assert.equal(onCourt(v.current, 'us')[3], 'u5');
});

test('libero out command and undo of it', () => {
  let m = run(started({ libero: true }), ['liberoIn', { team: 'us', zone: 5 }], ['liberoOut', { team: 'us' }]);
  assert.equal(replay(m).current.libero.us, null);
  assert.equal(replay(undo(m).match).current.libero.us.id, 'uL');
});

test('timeouts: two per set', () => {
  let m = run(started(), ['timeout', { team: 'opp' }], ['timeout', { team: 'opp' }]);
  assert.match(dispatch(m, 'timeout', { team: 'opp' }).error, /no timeouts left/);
});

test('end set early requires a leader', () => {
  let m = started();
  assert.match(dispatch(m, 'endSet').error, /tied/);
  m = run(m, point('opp'), ['endSet', {}]);
  const v = replay(m);
  assert.equal(v.sets[0].winner, 'opp');
  assert.equal(v.sets[0].endedEarly, true);
});

test('untracked opponent gets six rotating placeholders', () => {
  const m = createMatch({ us, opp: createTeam({ name: 'Unknown HS', players: [] }) });
  assert.equal(m.teams.opp.generic, true);
  assert.equal(m.teams.opp.players.length, 6);
});

test('describeEvent reads naturally', () => {
  const m = run(started(), point('us', { code: 'K', actor: 'u3' }));
  assert.equal(describeEvent(m, m.events[1]), 'Point Tampa Prep · Kill #3 U Player 3');
});

test('replay of a long match is fast', () => {
  let m = createMatch({ format: 5, us, opp });
  m = run(m, ['startSet', { lineup: L, toss: { winner: 'us', choice: 'serve' } }]);
  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < 24; i++) m = run(m, point('us'), point('opp'));
    m = run(m, point(s % 2 ? 'opp' : 'us'), point(s % 2 ? 'opp' : 'us'));
    if (s < 3) m = run(m, ['startSet', { lineup: L }]);
  }
  const t = performance.now();
  for (let i = 0; i < 50; i++) replay(m);
  assert.ok((performance.now() - t) / 50 < 5, 'replay should take well under 5 ms');
});
