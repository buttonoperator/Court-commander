// Match engine: an append-only event log plus a pure replay.
//
// Every change to a live match is an event appended to match.events. The
// match view (score, serve, rotations, lineups, subs, timeouts, rallies) is
// never stored; it is recomputed by replay(). This gives:
//   - Undo of ANY action by dropping the last event (stats included, since
//     stats are derived from the same log).
//   - A complete audit trail for replay and analytics.
//   - Saves that cannot drift out of sync with themselves.
//
// Commands validate against the current view and either append one event or
// return an error string. Nothing in this file touches the DOM or storage.

import {
  NFHS, TEAM_KEYS, other, isFrontRow, zoneOfSlot, slotInZone, normalizeFormat,
  setsToWin, setRequiresToss, setWinner, setPointFor, decidingSetNumber, pointTarget, zoneNumber,
} from './rules.js';
import { uid } from './roster.js';

/** Codes credited to the team that WON the rally. */
export const WIN_CODES = Object.freeze(['K', 'ACE', 'BLK']);
/** Codes charged to the team that LOST the rally. */
export const ERR_CODES = Object.freeze(['SE', 'E', 'BHE', 'RE', 'NET']);
export const CODE_LABEL = Object.freeze({
  K: 'Kill', ACE: 'Ace', BLK: 'Block', SE: 'Service error', E: 'Attack error',
  BHE: 'Ball-handling error', RE: 'Reception error', NET: 'Net / violation', PT: 'Point',
});

const now = () => new Date().toISOString();

/**
 * Creates a match. Rosters are snapshotted so later team edits never alter a
 * match in progress (this replaces the v1 roster lock).
 */
export function createMatch({ id, format = 3, venue = 'home', rules = {}, us, opp, trackOppPlayers = true }) {
  const snap = (t, side) => {
    let players = (t.players || []).map((p) => ({ ...p, roles: [...(p.roles || [])] }));
    let generic = false;
    if (side === 'opp' && players.length < 6) {
      // An untracked opponent still rotates; six labelled placeholders make the serve order visible.
      generic = true;
      players = Array.from({ length: 6 }, (_, i) => ({
        id: `opp_generic_${i + 1}`, name: `Server ${i + 1}`, jersey: '', roles: [], grade: '', libero: false, generic: true,
      }));
    }
    return { teamId: t.id || null, name: t.name, color: t.color, players, generic };
  };
  return {
    id: id || uid('m'),
    schema: 2,
    createdAt: now(),
    format: normalizeFormat(format),
    venue: venue === 'away' ? 'away' : 'home',
    rules: { ...NFHS, ...rules },
    trackOppPlayers: Boolean(trackOppPlayers),
    teams: { us: snap(us, 'us'), opp: snap(opp, 'opp') },
    events: [],
  };
}

const emptyPair = (v) => ({ us: v, opp: v });

function newSet(ev) {
  const bindings = { us: {}, opp: {} };
  for (const team of TEAM_KEYS) ev.lineup[team].forEach((pid, slot) => { bindings[team][pid] = slot; });
  return {
    n: ev.set,
    toss: ev.toss || null,
    firstServer: ev.firstServer,
    serving: ev.firstServer,
    score: emptyPair(0),
    lineup: { us: [...ev.lineup.us], opp: [...ev.lineup.opp] },
    starters: { us: [...ev.lineup.us], opp: [...ev.lineup.opp] },
    rot: emptyPair(0),
    liberoId: { us: (ev.libero && ev.libero.us) || null, opp: (ev.libero && ev.libero.opp) || null },
    libero: emptyPair(null), // { id, slot, replaced } while the libero is on court
    bindings,
    subsUsed: emptyPair(0),
    timeoutsUsed: emptyPair(0),
    rallies: [],
    subs: [],
    timeouts: [],
    winner: null,
    endedEarly: false,
    startedAt: ev.at,
    endedAt: null,
  };
}

/** Player ids standing in zone indices 0..5 (zone 1..6) for a team in a set. */
export function onCourt(set, team) {
  const out = [];
  for (let z = 0; z < 6; z++) {
    const slot = slotInZone(z, set.rot[team]);
    const lib = set.libero[team];
    out.push(lib && lib.slot === slot ? lib.id : set.lineup[team][slot]);
  }
  return out;
}

export const serverOf = (set, team) => onCourt(set, team)[0];

/** Libero must leave when the slot it covers reaches the front row. */
function enforceLiberoBackRow(set, team) {
  const lib = set.libero[team];
  if (lib && isFrontRow(zoneOfSlot(lib.slot, set.rot[team]))) set.libero[team] = null;
}

/** Applies one validated event to the view (mutates `view`, which replay owns). */
function reduce(view, ev, match) {
  const set = view.sets[view.sets.length - 1];
  switch (ev.type) {
    case 'set.start': {
      view.sets.push(newSet(ev));
      break;
    }
    case 'rally': {
      const before = { us: onCourt(set, 'us'), opp: onCourt(set, 'opp') };
      const servingTeam = set.serving;
      const rotBefore = { ...set.rot };
      const leadBefore = Math.max(set.score.us, set.score.opp);
      set.score[ev.winner] += 1;
      const sideout = ev.winner !== servingTeam;
      if (sideout) {
        set.rot[ev.winner] += 1;
        set.serving = ev.winner;
        enforceLiberoBackRow(set, ev.winner);
      }
      // NFHS: in the deciding set the teams change sides when one team reaches 8.
      const switchAt = match.rules.decidingSwitchAt;
      const sideSwitch = set.n === decidingSetNumber(match.format)
        && leadBefore < switchAt && Math.max(set.score.us, set.score.opp) >= switchAt;
      set.rallies.push({
        index: set.rallies.length,
        at: ev.at,
        winner: ev.winner,
        code: ev.code || 'PT',
        actor: ev.actor || null,
        assist: ev.assist || null,
        victim: ev.victim || null,
        servingTeam,
        server: before[servingTeam][0],
        rotBefore,
        onCourt: before,
        sideout,
        score: { ...set.score },
        sideSwitch,
      });
      const w = setWinner(set.score, set.n, match.format, match.rules);
      if (w) { set.winner = w; set.endedAt = ev.at; }
      break;
    }
    case 'sub': {
      const slot = slotInZone(ev.zone, set.rot[ev.team]);
      set.lineup[ev.team][slot] = ev.in;
      set.bindings[ev.team][ev.in] = slot;
      set.subsUsed[ev.team] += 1;
      set.subs.push({ at: ev.at, team: ev.team, zone: ev.zone, slot, out: ev.out, in: ev.in, score: { ...set.score } });
      break;
    }
    case 'libero.in': {
      const slot = slotInZone(ev.zone, set.rot[ev.team]);
      set.libero[ev.team] = { id: ev.in, slot, replaced: set.lineup[ev.team][slot] };
      break;
    }
    case 'libero.out': {
      set.libero[ev.team] = null;
      break;
    }
    case 'timeout': {
      set.timeoutsUsed[ev.team] += 1;
      set.timeouts.push({ at: ev.at, team: ev.team, score: { ...set.score } });
      break;
    }
    case 'set.end': {
      set.winner = set.score.us > set.score.opp ? 'us' : 'opp';
      set.endedEarly = true;
      set.endedAt = ev.at;
      break;
    }
    case 'stat': {
      view.adjustments.push({ ...ev, set: set ? set.n : null });
      break;
    }
    case 'match.end': {
      view.ended = true;
      view.endedAt = ev.at;
      break;
    }
    default:
      view.unknown.push(ev);
  }
}

/** Recomputes the full match view from the event log. Pure. */
export function replay(match, events = match.events) {
  const view = { sets: [], adjustments: [], ended: false, endedAt: null, unknown: [] };
  // The view is rebuilt from scratch on every call, so the fold may mutate it freely.
  for (const ev of events) reduce(view, ev, match);
  return finalize(view, match);
}

function finalize(view, match) {
  const setsWon = emptyPair(0);
  for (const s of view.sets) if (s.winner) setsWon[s.winner] += 1;
  const need = setsToWin(match.format);
  const decided = setsWon.us >= need ? 'us' : setsWon.opp >= need ? 'opp' : null;
  const current = view.sets[view.sets.length - 1] || null;
  let phase;
  if (view.ended) phase = 'ended';
  else if (!current) phase = 'pre';
  else if (!current.winner) phase = 'live';
  else if (decided) phase = 'decided';
  else phase = 'between';
  const nextSetNumber = phase === 'pre' ? 1 : phase === 'between' ? current.n + 1 : null;
  const setPoint = phase === 'live' ? setPointFor(current.score, current.n, match.format, match.rules) : null;
  return { ...view, setsWon, decided, current, phase, nextSetNumber, setPoint, need };
}

// ---------------------------------------------------------------------------
// Queries used by both commands and UI.

export const playerById = (match, team, id) => match.teams[team].players.find((p) => p.id === id) || null;

/** Who serves first in set n: the toss for set 1 and the deciding set, alternation otherwise. */
export function scheduledFirstServer(match, view, n) {
  if (setRequiresToss(n, match.format)) return null; // decided by the toss
  const prev = view.sets.find((s) => s.n === n - 1);
  return prev ? other(prev.firstServer) : null;
}

/** Bench = roster players not on court and not the set's designated libero. */
export function benchOf(match, set, team) {
  const court = new Set(onCourt(set, team));
  return match.teams[team].players.filter((p) => !court.has(p.id) && p.id !== set.liberoId[team] && !set.lineup[team].includes(p.id));
}

/** Why `incomingId` may not replace the player in zone `zone`, or null if legal. */
export function substitutionError(match, view, { team, zone, in: incomingId }) {
  const set = view.current;
  if (!set || view.phase !== 'live') return 'Substitutions can only be made while a set is in progress.';
  if (!(zone >= 0 && zone < 6)) return 'Pick a court position first.';
  const rules = match.rules;
  if (set.subsUsed[team] >= rules.subsPerSet) return `No substitutions left this set (${rules.subsPerSet} used).`;
  const slot = slotInZone(zone, set.rot[team]);
  const lib = set.libero[team];
  if (lib && lib.slot === slot) return 'The libero is in that position. Take the libero out first.';
  const incoming = playerById(match, team, incomingId);
  if (!incoming) return 'That player is not on this roster.';
  if (incomingId === set.liberoId[team]) return 'The designated libero cannot enter as a regular substitute.';
  if (set.lineup[team].includes(incomingId)) return `${incoming.name} is already on the court.`;
  if (rules.positionLock && incomingId in set.bindings[team] && set.bindings[team][incomingId] !== slot) {
    const bound = set.bindings[team][incomingId];
    const z = zoneOfSlot(bound, set.rot[team]);
    return `${incoming.name} already played in lineup position ${bound + 1} this set and may only return there (currently zone ${zoneNumber(z)}).`;
  }
  return null;
}

export function liberoInError(match, view, { team, zone }) {
  const set = view.current;
  if (!set || view.phase !== 'live') return 'The libero can only be moved while a set is in progress.';
  const libId = set.liberoId[team];
  if (!libId) return 'No libero is designated for this set.';
  if (set.libero[team]) return 'The libero is already on the court.';
  if (isFrontRow(zone)) return 'The libero may only replace a back-row player (zones 1, 5, 6).';
  return null;
}

// ---------------------------------------------------------------------------
// Commands. Each returns { ok: true, match, event } or { ok: false, error }.

function append(match, event) {
  const ev = { at: now(), ...event };
  return { ok: true, match: { ...match, events: [...match.events, ev] }, event: ev };
}
const fail = (error) => ({ ok: false, error });

function validateLineup(match, team, ids, liberoId) {
  if (!Array.isArray(ids) || ids.length !== 6 || ids.some((x) => !x)) return `${match.teams[team].name} needs six players on the court.`;
  if (new Set(ids).size !== 6) return `${match.teams[team].name} has the same player in two positions.`;
  for (const id of ids) if (!playerById(match, team, id)) return `${match.teams[team].name}: a lineup player is not on the roster.`;
  if (liberoId && ids.includes(liberoId)) return `${match.teams[team].name}: the designated libero cannot also be in the starting six.`;
  if (liberoId && !playerById(match, team, liberoId)) return 'The libero is not on the roster.';
  return null;
}

function rallyEvent(match, view, a) {
  const set = view.current;
  if (!set || view.phase !== 'live') return fail(view.phase === 'pre' || view.phase === 'between' ? 'Start the set before scoring.' : 'This set is over.');
  if (!TEAM_KEYS.includes(a.winner)) return fail('Unknown team.');
  const code = a.code || 'PT';
  const loser = other(a.winner);
  if (code !== 'PT' && !WIN_CODES.includes(code) && !ERR_CODES.includes(code)) return fail(`Unknown play code ${code}.`);
  const actorTeam = WIN_CODES.includes(code) ? a.winner : loser;
  let actor = a.actor || null;
  if (code === 'ACE') {
    if (set.serving !== a.winner) return fail('An ace can only be scored by the serving team.');
    actor = serverOf(set, a.winner);
  }
  if (code === 'SE') {
    if (set.serving !== loser) return fail('A service error can only be charged to the serving team.');
    actor = serverOf(set, loser);
  }
  if (actor && !onCourt(set, actorTeam).includes(actor)) return fail('That player is not on the court.');
  const assist = code === 'K' && a.assist && a.assist !== actor ? a.assist : null;
  if (assist && !onCourt(set, a.winner).includes(assist)) return fail('The assisting player is not on the court.');
  const victim = (code === 'ACE' || code === 'BLK') && a.victim ? a.victim : null;
  if (victim && !onCourt(set, loser).includes(victim)) return fail('That player is not on the court.');
  const ev = { type: 'rally', winner: a.winner, code };
  if (actor) ev.actor = actor;
  if (assist) ev.assist = assist;
  if (victim) ev.victim = victim;
  return { ok: true, event: ev };
}

export const commands = {
  startSet(match, view, { lineup, libero = {}, toss = null, firstServer = null }) {
    if (view.phase === 'live') return fail('A set is already in progress.');
    if (view.phase === 'decided') return fail('The match is decided. End the match to save it.');
    if (view.phase === 'ended') return fail('This match has ended.');
    const n = view.nextSetNumber;
    for (const team of TEAM_KEYS) {
      const err = validateLineup(match, team, lineup && lineup[team], libero[team]);
      if (err) return fail(err);
    }
    let first;
    let tossRecord = null;
    if (setRequiresToss(n, match.format)) {
      if (!toss || !TEAM_KEYS.includes(toss.winner)) return fail('Record the coin toss first.');
      if (!['serve', 'receive', 'side'].includes(toss.choice)) return fail('Record the toss winner\'s choice.');
      if (toss.choice === 'serve') first = toss.winner;
      else if (toss.choice === 'receive') first = other(toss.winner);
      else first = firstServer; // toss winner chose a side: the loser picks serve or receive
      if (!TEAM_KEYS.includes(first)) return fail('Record who serves first.');
      tossRecord = { winner: toss.winner, choice: toss.choice };
    } else {
      first = scheduledFirstServer(match, view, n);
    }
    for (const team of TEAM_KEYS) {
      const lib = libero[team];
      if (lib && !playerById(match, team, lib)) return fail('Unknown libero.');
    }
    return append(match, {
      type: 'set.start', set: n, firstServer: first, toss: tossRecord,
      lineup: { us: [...lineup.us], opp: [...lineup.opp] },
      libero: { us: libero.us || null, opp: libero.opp || null },
    });
  },

  rally(match, view, args) {
    const r = rallyEvent(match, view, args);
    return r.ok ? append(match, r.event) : r;
  },

  /** Re-describes the most recent rally (the stat prompt after a quick tap). Same winner, same position in the log. */
  amendRally(match, _view, args) {
    const last = match.events[match.events.length - 1];
    if (!last || last.type !== 'rally') return fail('Nothing to amend.');
    const prior = { ...match, events: match.events.slice(0, -1) };
    const r = rallyEvent(prior, replay(prior), { ...args, winner: last.winner });
    if (!r.ok) return r;
    const ev = { ...r.event, at: last.at };
    return { ok: true, match: { ...match, events: [...prior.events, ev] }, event: ev };
  },

  sub(match, view, { team, zone, in: incoming }) {
    const err = substitutionError(match, view, { team, zone, in: incoming });
    if (err) return fail(err);
    const out = onCourt(view.current, team)[zone];
    return append(match, { type: 'sub', team, zone, out, in: incoming });
  },

  liberoIn(match, view, { team, zone }) {
    const err = liberoInError(match, view, { team, zone });
    if (err) return fail(err);
    const set = view.current;
    return append(match, { type: 'libero.in', team, zone, in: set.liberoId[team], out: onCourt(set, team)[zone] });
  },

  liberoOut(match, view, { team }) {
    if (view.phase !== 'live') return fail('No set in progress.');
    if (!view.current.libero[team]) return fail('The libero is not on the court.');
    return append(match, { type: 'libero.out', team });
  },

  timeout(match, view, { team }) {
    if (view.phase !== 'live') return fail('Timeouts can only be called during a set.');
    if (view.current.timeoutsUsed[team] >= match.rules.timeoutsPerSet) return fail(`${match.teams[team].name} has no timeouts left this set.`);
    return append(match, { type: 'timeout', team });
  },

  endSet(match, view) {
    if (view.phase !== 'live') return fail('No set in progress.');
    const s = view.current.score;
    if (s.us === s.opp) return fail('A tied set cannot be ended. Score the next rally first.');
    return append(match, { type: 'set.end' });
  },

  adjustStat(match, view, { team, player, stat, delta }) {
    if (view.phase === 'ended') return fail('This match has ended.');
    if (!playerById(match, team, player)) return fail('Unknown player.');
    if (!['D', 'R', 'BA', 'ATT', 'SRV', 'AST', 'K', 'E', 'BS', 'SA', 'SE', 'RE', 'BHE'].includes(stat)) return fail('Unknown stat.');
    const d = Number(delta);
    if (!Number.isInteger(d) || d === 0) return fail('Bad adjustment.');
    return append(match, { type: 'stat', team, player, stat, delta: d });
  },

  endMatch(match, view) {
    if (view.phase === 'ended') return fail('This match has already ended.');
    return append(match, { type: 'match.end' });
  },
};

/** Dispatches a command by name. */
export function dispatch(match, type, args = {}) {
  const fn = commands[type];
  if (!fn) return fail(`Unknown command ${type}.`);
  return fn(match, replay(match), args);
}

/** Removes the most recent event. */
export function undo(match) {
  if (!match.events.length) return { ok: false, error: 'Nothing to undo.' };
  const event = match.events[match.events.length - 1];
  return { ok: true, match: { ...match, events: match.events.slice(0, -1) }, event };
}

/** Human description of an event, for undo toasts and the audit log. */
export function describeEvent(match, ev) {
  const name = (team, id) => {
    const p = id && playerById(match, team, id);
    return p ? `${p.jersey ? '#' + p.jersey + ' ' : ''}${p.name}` : '';
  };
  const tn = (team) => match.teams[team].name;
  switch (ev.type) {
    case 'set.start': return `Start of set ${ev.set}`;
    case 'rally': {
      const code = ev.code || 'PT';
      const actorTeam = ERR_CODES.includes(code) ? other(ev.winner) : ev.winner;
      const who = name(actorTeam, ev.actor);
      return `Point ${tn(ev.winner)}${code !== 'PT' ? ` · ${CODE_LABEL[code]}${who ? ' ' + who : ''}` : ''}`;
    }
    case 'sub': return `Sub ${tn(ev.team)}: ${name(ev.team, ev.in)} for ${name(ev.team, ev.out)}`;
    case 'libero.in': return `Libero in for ${name(ev.team, ev.out)}`;
    case 'libero.out': return 'Libero out';
    case 'timeout': return `Timeout ${tn(ev.team)}`;
    case 'set.end': return 'Set ended early';
    case 'stat': return `Stat ${ev.stat} ${ev.delta > 0 ? '+' : ''}${ev.delta} ${name(ev.team, ev.player)}`;
    case 'match.end': return 'Match ended';
    default: return ev.type;
  }
}

export { pointTarget, decidingSetNumber, setRequiresToss };
