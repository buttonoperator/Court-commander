// Rules profile and pure rule helpers.
//
// Court geometry used everywhere in the engine:
//   A team's on-court array is indexed by ZONE INDEX z = 0..5, where z + 1 is
//   the official zone number. z = 0 is zone 1 (right back, the server).
//   Front row = zones 2, 3, 4 = indices 1, 2, 3. Back row = indices 0, 4, 5.
//
// Lineup SLOTS are the six serving-order positions written on the lineup card
// (slot 0 serves first). With r side-out rotations taken, slot s stands in
// zone index (s - r) mod 6, and zone index z holds slot (z + r) mod 6.
// A side-out therefore moves the zone-2 player to zone 1, which is the
// clockwise rotation required by the rules.

/** NFHS defaults. Values a state association may adopt differently are settings. */
export const NFHS = Object.freeze({
  id: 'nfhs',
  label: 'NFHS (High School)',
  setTarget: 25,
  decidingSetTarget: 15,
  winBy: 2,
  subsPerSet: 18,        // NFHS 10-3-1: 18 team substitutions per set
  timeoutsPerSet: 2,
  timeoutSeconds: 60,
  decidingSwitchAt: 8,   // teams change sides when one team reaches 8 in the deciding set
  positionLock: true,    // NFHS 10-3-3: a player stays in one lineup position for the set
});

export const TEAM_KEYS = Object.freeze(['us', 'opp']);
export const other = (team) => (team === 'us' ? 'opp' : 'us');

export const FRONT_ROW = Object.freeze([1, 2, 3]);
export const BACK_ROW = Object.freeze([0, 4, 5]);
export const isFrontRow = (zoneIndex) => zoneIndex >= 1 && zoneIndex <= 3;
export const zoneNumber = (zoneIndex) => zoneIndex + 1;

/** Zone index that lineup slot `slot` occupies after `rot` rotations. */
export const zoneOfSlot = (slot, rot) => (((slot - rot) % 6) + 6) % 6;
/** Lineup slot standing in zone index `zone` after `rot` rotations. */
export const slotInZone = (zone, rot) => (zone + rot) % 6;

export const VALID_FORMATS = Object.freeze([1, 3, 5]);
export const normalizeFormat = (f) => (VALID_FORMATS.includes(Number(f)) ? Number(f) : 3);

/** Sets needed to win a best-of-`format` match. */
export const setsToWin = (format) => Math.floor(normalizeFormat(format) / 2) + 1;

/** The set that can decide a full-length match (3 of best-of-3, 5 of best-of-5). Null for a one-set match. */
export const decidingSetNumber = (format) => (normalizeFormat(format) > 1 ? normalizeFormat(format) : null);

/** NFHS 5-4: a toss before the match and before a deciding set. Other sets alternate first serve. */
export const setRequiresToss = (setNumber, format) =>
  setNumber === 1 || setNumber === decidingSetNumber(format);

export const pointTarget = (setNumber, format, rules = NFHS) =>
  setNumber === decidingSetNumber(format) ? rules.decidingSetTarget : rules.setTarget;

/** Winner of a set given its score, or null while it is still being played. */
export function setWinner(score, setNumber, format, rules = NFHS) {
  const target = pointTarget(setNumber, format, rules);
  const lead = score.us - score.opp;
  if (score.us >= target && lead >= rules.winBy) return 'us';
  if (score.opp >= target && -lead >= rules.winBy) return 'opp';
  return null;
}

/** Point-for-the-set flag: the leader wins the set on the next rally. */
export function setPointFor(score, setNumber, format, rules = NFHS) {
  for (const team of TEAM_KEYS) {
    const next = { ...score, [team]: score[team] + 1 };
    if (setWinner(next, setNumber, format, rules) === team) return team;
  }
  return null;
}

export const ROLES = Object.freeze([
  { code: 'S', label: 'Setter' },
  { code: 'OH', label: 'Outside Hitter' },
  { code: 'MB', label: 'Middle Blocker' },
  { code: 'RS', label: 'Right Side' },
  { code: 'L', label: 'Libero' },
  { code: 'DS', label: 'Defensive Specialist' },
]);

const ROLE_ALIASES = {
  S: 'S', SETTER: 'S',
  OH: 'OH', OUTSIDE: 'OH', 'OUTSIDE HITTER': 'OH', LEFT: 'OH',
  MB: 'MB', MH: 'MB', MIDDLE: 'MB', 'MIDDLE BLOCKER': 'MB', 'MIDDLE HITTER': 'MB',
  RS: 'RS', OPP: 'RS', OPPOSITE: 'RS', 'RIGHT SIDE': 'RS', RIGHT: 'RS',
  L: 'L', LIB: 'L', LIBERO: 'L',
  DS: 'DS', 'DEFENSIVE SPECIALIST': 'DS',
};

/** "OH, OPP" -> ['OH', 'RS']; unknown tokens are dropped. */
export function parseRoles(text) {
  if (!text) return [];
  const out = [];
  for (const raw of String(text).split(/[,/]+/)) {
    const code = ROLE_ALIASES[raw.trim().toUpperCase()];
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}
