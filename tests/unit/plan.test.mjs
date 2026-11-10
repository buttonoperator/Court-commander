import test from 'node:test';
import assert from 'node:assert/strict';
import { planRotations, rotationView, plannedSubError, setPlannedSub, prunePlannedSubs, slotsAt } from '../../src/core/plan.js';

const base = ['a', 'b', 'c', 'd', 'e', 'f'];

test('rotations without subs: zone 1 serves slot r, clockwise', () => {
  const rots = planRotations(base, []);
  assert.deepEqual(rots[0].zones, base);
  assert.deepEqual(rots[1].zones, ['b', 'c', 'd', 'e', 'f', 'a']);
  assert.deepEqual(rots[5].zones, ['f', 'a', 'b', 'c', 'd', 'e']);
});

test('a planned sub carries forward with its lineup position and is reported only where it happens', () => {
  const subs = setPlannedSub(base, [], { rotation: 2, slot: 3, incoming: 'x' });
  const rots = planRotations(base, subs);
  assert.deepEqual(rots[1].slots, base);
  assert.deepEqual(rots[2].slots, ['a', 'b', 'c', 'x', 'e', 'f']);
  assert.deepEqual(rots[2].subs, [{ rotation: 2, slot: 3, in: 'x', out: 'd' }]);
  assert.deepEqual(rots[3].subs, []);
  assert.equal(rots[5].slots[3], 'x');
  assert.equal(rots[2].zones.indexOf('x'), 1, 'slot 3 stands in zone 2 in rotation 3');
});

test('sub back: the starter returns to the same position later', () => {
  let subs = setPlannedSub(base, [], { rotation: 1, slot: 0, incoming: 'x' });
  assert.equal(plannedSubError({ base, subs, rotation: 4, slot: 0, incoming: 'a' }), null);
  subs = setPlannedSub(base, subs, { rotation: 4, slot: 0, incoming: 'a' });
  assert.deepEqual(rotationView(base, subs, 4).subs, [{ rotation: 4, slot: 0, in: 'a', out: 'x' }]);
  assert.equal(slotsAt(base, subs, 5)[0], 'a');
});

test('rules: position lock, already on court, libero, rotation 1, sub limit', () => {
  const subs = setPlannedSub(base, [], { rotation: 1, slot: 0, incoming: 'x' });
  assert.match(plannedSubError({ base, subs, rotation: 3, slot: 2, incoming: 'a' }), /lineup position 1/);
  assert.match(plannedSubError({ base, subs, rotation: 3, slot: 2, incoming: 'x' }), /already on the court/);
  assert.match(plannedSubError({ base, subs: [], rotation: 2, slot: 1, incoming: 'L', liberoId: 'L' }), /libero/);
  assert.match(plannedSubError({ base, subs: [], rotation: 0, slot: 1, incoming: 'x' }), /rotations 2 to 6/);
  assert.match(plannedSubError({ base, subs: [{ rotation: 1, slot: 0, in: 'x' }], rotation: 2, slot: 1, incoming: 'y', rules: { subsPerSet: 1, positionLock: true } }), /all 1 substitutions/);
  assert.match(plannedSubError({ base: ['a', null, 'c', 'd', 'e', 'f'], subs: [], rotation: 2, slot: 1, incoming: 'y' }), /starting lineup/);
});

test('replacing and removing a planned sub at the same spot', () => {
  let subs = setPlannedSub(base, [], { rotation: 2, slot: 1, incoming: 'x' });
  subs = setPlannedSub(base, subs, { rotation: 2, slot: 1, incoming: 'y' });
  assert.deepEqual(subs, [{ rotation: 2, slot: 1, in: 'y' }]);
  subs = setPlannedSub(base, subs, { rotation: 2, slot: 1, incoming: 'b' });
  assert.deepEqual(subs, []);
});

test('prune drops subs for removed players or ones that became no-ops after a lineup change', () => {
  const subs = [{ rotation: 2, slot: 1, in: 'x' }, { rotation: 3, slot: 2, in: 'gone' }, { rotation: 4, slot: 4, in: 'a' }];
  const kept = prunePlannedSubs(['a', 'b', 'c', 'd', 'e', 'f'], subs, ['a', 'b', 'c', 'd', 'e', 'f', 'x']);
  assert.deepEqual(kept, [{ rotation: 2, slot: 1, in: 'x' }]);
});
