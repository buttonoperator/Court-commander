// Rotation plan: a starting lineup plus planned substitutions, projected over the six rotations.
//
// A planned sub is { rotation, slot, in }: before rotation `rotation` (0-based, 0 = starting
// rotation) the player in lineup slot `slot` is replaced by `in`. Subs are keyed by SLOT, not zone,
// so a sub carries forward through later rotations exactly as it does in a live set (the player
// stays in that lineup position and rotates with it). Rotation r puts slot (z + r) mod 6 in zone z.
import { slotInZone, NFHS } from './rules.js';

const bySeq = (a, b) => a.rotation - b.rotation || a.slot - b.slot;

/** Lineup (by slot) in force at rotation r, after every planned sub up to and including r. */
export function slotsAt(base, subs, r) {
  const slots = [...base];
  for (const s of [...subs].sort(bySeq)) if (s.rotation <= r) slots[s.slot] = s.in;
  return slots;
}

/** Players by zone index for rotation r, with the subs that happen right before it. */
export function rotationView(base, subs, r) {
  const before = r > 0 ? slotsAt(base, subs, r - 1) : [...base];
  const slots = slotsAt(base, subs, r);
  const here = subs.filter((s) => s.rotation === r).map((s) => ({ ...s, out: (r > 0 ? before : base)[s.slot] }));
  const zones = Array.from({ length: 6 }, (_, z) => slots[slotInZone(z, r)]);
  return { slots, zones, subs: here };
}

/** All six rotations. */
export const planRotations = (base, subs) => Array.from({ length: 6 }, (_, r) => rotationView(base, subs, r));

/** The slot each player is bound to anywhere in the plan (NFHS 10-3-3: one lineup position per set). */
function bindings(base, subs) {
  const out = new Map();
  base.forEach((id, slot) => { if (id) out.set(id, slot); });
  for (const s of [...subs].sort(bySeq)) if (!out.has(s.in)) out.set(s.in, s.slot);
  return out;
}

/**
 * Why `incoming` cannot be planned into `slot` before rotation `rotation`, or null when legal.
 * `existing` subs at the same (rotation, slot) are ignored, because the new sub replaces them.
 */
export function plannedSubError({ base, subs, rotation, slot, incoming, liberoId = null, rules = NFHS, nameOf = (id) => id }) {
  if (!base.every(Boolean)) return 'Set the full starting lineup first.';
  if (rotation < 1 || rotation > 5) return 'Plan substitutions for rotations 2 to 6. Change rotation 1 in the starting lineup.';
  if (incoming === liberoId) return 'The designated libero cannot be a regular substitute.';
  const others = subs.filter((s) => !(s.rotation === rotation && s.slot === slot));
  const before = slotsAt(base, others, rotation - 1);
  if (before[slot] === incoming) return null; // removes a planned sub, always allowed
  const now = slotsAt(base, others, rotation);
  if (now.includes(incoming) && now[slot] !== incoming) return `${nameOf(incoming)} is already on the court in this rotation.`;
  const bound = bindings(base, others).get(incoming);
  if (rules.positionLock && bound !== undefined && bound !== slot) return `${nameOf(incoming)} plays lineup position ${bound + 1} in this plan and may only sub into that position.`;
  if (others.length + 1 > rules.subsPerSet) return `This plan already uses all ${rules.subsPerSet} substitutions.`;
  return null;
}

/** Adds or replaces the planned sub at (rotation, slot). Planning the player who would already be there removes it. */
export function setPlannedSub(base, subs, { rotation, slot, incoming }) {
  const others = subs.filter((s) => !(s.rotation === rotation && s.slot === slot));
  const before = slotsAt(base, others, rotation - 1);
  if (before[slot] === incoming) return others;
  return [...others, { rotation, slot, in: incoming }].sort(bySeq);
}

/** Drops planned subs that no longer make sense after the starting lineup or roster changed. */
export function prunePlannedSubs(base, subs, playerIds) {
  const known = new Set(playerIds);
  let kept = [];
  for (const s of [...subs].sort(bySeq)) {
    if (!known.has(s.in) || s.rotation < 1 || s.rotation > 5 || s.slot < 0 || s.slot > 5) continue;
    const before = slotsAt(base, kept, s.rotation - 1);
    if (before[s.slot] === s.in || before.includes(s.in)) continue;
    kept = [...kept, s];
  }
  return kept;
}
