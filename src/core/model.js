// Persistent app document (schema 2): defaults, normalisation and the v1 migration.
//
// Storage keys:
//   courtCommander.v2       this document
//   courtCommanderState_v1  the legacy save. Read once for migration and NEVER modified or deleted,
//                           so going back to the v1 build is always possible.
import { NFHS, normalizeFormat, TEAM_KEYS } from './rules.js';
import { createTeam, createPlayer, uid, cleanText, cleanDeep } from './roster.js';
import { replay } from './engine.js';

export const STORAGE_KEY = 'courtCommander.v2';
export const LEGACY_KEY = 'courtCommanderState_v1';
export const SCHEMA = 2;

export const THEMES = Object.freeze(['night', 'day']);

export function defaultSettings() {
  return {
    theme: 'night',
    statPrompt: true,          // open the "how was the point won" sheet after each rally
    trackOppPlayers: true,     // ask for opponent players in the stat sheet
    haptics: true,
    sound: false,
    confirmDestructive: true,
    rules: { setTarget: NFHS.setTarget, decidingSetTarget: NFHS.decidingSetTarget, subsPerSet: NFHS.subsPerSet, timeoutsPerSet: NFHS.timeoutsPerSet },
  };
}

export const emptyLineup = () => ({ us: [null, null, null, null, null, null], opp: [null, null, null, null, null, null] });

export function defaultSetup() {
  return { format: 3, venue: null, lineup: emptyLineup(), libero: { us: null, opp: null } };
}

export function emptyDoc() {
  return {
    schema: SCHEMA,
    savedAt: null,
    settings: defaultSettings(),
    teams: [],
    selection: { usId: null, oppId: null },
    setup: defaultSetup(),
    match: null,
    archive: [],
    presets: [],
    planner: {},
    board: { strokes: [] },
    migratedFromV1: null,
    seedVersion: null,
  };
}

/** Repairs a loaded document: fills defaults, drops malformed pieces, strips markup. */
export function normalizeDoc(raw) {
  const base = emptyDoc();
  if (!raw || typeof raw !== 'object') return base;
  const doc = cleanDeep(raw);
  const out = { ...base, ...doc };
  out.schema = SCHEMA;
  out.settings = { ...base.settings, ...(doc.settings || {}), rules: { ...base.settings.rules, ...((doc.settings || {}).rules || {}) } };
  if (!THEMES.includes(out.settings.theme)) out.settings.theme = 'night';
  out.teams = Array.isArray(doc.teams) ? doc.teams.filter((t) => t && t.id && Array.isArray(t.players)).map((t) => ({ ...t, players: t.players.map((p) => createPlayer(p)) })) : [];
  out.selection = { usId: null, oppId: null, ...(doc.selection || {}) };
  const setup = doc.setup || {};
  out.setup = {
    ...base.setup, ...setup,
    format: normalizeFormat(setup.format ?? 3),
    lineup: {
      us: fixSix(setup.lineup && setup.lineup.us),
      opp: fixSix(setup.lineup && setup.lineup.opp),
    },
    libero: { us: null, opp: null, ...(setup.libero || {}) },
  };
  out.match = validMatch(doc.match) ? doc.match : null;
  out.archive = Array.isArray(doc.archive) ? doc.archive.filter((a) => a && a.id) : [];
  out.presets = Array.isArray(doc.presets) ? doc.presets.filter((p) => p && p.id && Array.isArray(p.slots)) : [];
  out.planner = doc.planner && typeof doc.planner === 'object' ? doc.planner : {};
  out.board = { strokes: Array.isArray(doc.board && doc.board.strokes) ? doc.board.strokes : [] };
  return out;
}

const fixSix = (arr) => Array.from({ length: 6 }, (_, i) => (Array.isArray(arr) && arr[i]) || null);

function validMatch(m) {
  if (!m || typeof m !== 'object' || !Array.isArray(m.events) || !m.teams) return false;
  try { replay(m); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Archive records

/** Summary row stored in the archive for a finished (or abandoned) v2 match. */
export function archiveFromMatch(match, label = null) {
  const view = replay(match);
  const sets = view.sets.map((s) => ({ n: s.n, us: s.score.us, opp: s.score.opp, winner: s.winner, inProgress: !s.winner }));
  return {
    id: match.id,
    source: 'v2',
    date: match.createdAt,
    endedAt: view.endedAt || new Date().toISOString(),
    label,
    format: match.format,
    venue: match.venue,
    us: { name: match.teams.us.name, color: match.teams.us.color },
    opp: { name: match.teams.opp.name, color: match.teams.opp.color },
    setsWon: view.setsWon,
    winner: view.decided,
    sets,
    match,
  };
}

// ---------------------------------------------------------------------------
// v1 -> v2 migration

const LEGACY_STAT_MAP = { K: 'K', E: 'E', ATT: 'ATT', AST: 'AST', SA: 'SA', SE: 'SE', A: 'SRV', BS: 'BS', BA: 'BA', D: 'D', R: 'R', RE: 'RE', BHE: 'BHE' };

function legacyStats(s = {}) {
  const out = {};
  for (const [from, to] of Object.entries(LEGACY_STAT_MAP)) out[to] = Number(s[from]) || 0;
  return out;
}

function legacyRosterToPlayers(roster = []) {
  return roster.filter((p) => p && p.name).map((p) => createPlayer({ name: p.name, jersey: p.jersey, position: p.position, grade: p.grade, libero: p.libero }));
}

/** Converts one v1 archive entry (or the live v1 match) to a v2 archive record with a legacy timeline. */
function legacyArchiveRecord(m, extra = {}) {
  const sets = (m.sets || []).map((s) => ({
    n: s.setNumber, us: Number(s.homeScore) || 0, opp: Number(s.visitorScore) || 0,
    winner: s.inProgress ? null : s.homeScore > s.visitorScore ? 'us' : s.visitorScore > s.homeScore ? 'opp' : null,
    inProgress: Boolean(s.inProgress),
  }));
  const timeline = (m.timeline || []).map((e) => ({
    type: e.type,
    set: e.setNumber,
    scoringTeam: e.scoringTeam === 'home' ? 'us' : e.scoringTeam === 'visitor' ? 'opp' : null,
    team: e.team === 'home' ? 'us' : e.team === 'visitor' ? 'opp' : null,
    score: { us: e.homeScore, opp: e.visitorScore },
    serving: e.servingTeamBefore === 'home' ? 'us' : e.servingTeamBefore === 'visitor' ? 'opp' : null,
    code: e.code || null,
    player: e.playerName || null,
    assist: e.assistName || null,
    playerIn: e.playerInName || null,
    playerOut: e.playerOutName || null,
    court: {
      us: (e.homePositions || []).map((p) => (p ? { name: p.name, jersey: p.jersey } : null)),
      opp: (e.visitorPositions || []).map((p) => (p ? { name: p.name, jersey: p.jersey } : null)),
    },
  }));
  const box = (roster = []) => roster.map((p) => ({ name: p.name, jersey: p.jersey, position: p.position, stats: legacyStats(p.stats) }));
  return {
    id: `v1_${m.id || Date.now()}`,
    source: 'v1',
    date: m.date || new Date().toISOString(),
    label: m.editedLabel || null,
    format: normalizeFormat(m.matchFormat),
    venue: null,
    us: { name: cleanText(m.homeTeamName) || 'Tampa Prep', color: '#d6222c' },
    opp: { name: cleanText(m.visitorTeamName) || 'Opponent', color: '#1e3a5f' },
    setsWon: { us: Number(m.setsWonHome) || 0, opp: Number(m.setsWonVisitor) || 0 },
    winner: null,
    sets,
    legacy: { timeline, box: { us: box(m.homeRoster), opp: box(m.visitorRoster) } },
    ...extra,
  };
}

/**
 * Builds a v2 document from a v1 save payload ({ state, homeTeamName, visitorTeamName, theme }).
 * Teams, saved lineups, settings and match history carry over. A match that was in progress in
 * v1 is preserved as a history entry marked "carried over"; it cannot be resumed in v2 because v1
 * did not record lineups or substitutions as replayable events.
 */
export function migrateV1(payload) {
  const doc = emptyDoc();
  const st = payload && payload.state;
  if (!st || typeof st !== 'object') return null;
  const clean = cleanDeep(st);

  // Teams. The live roster wins over the bank copy for the team that was loaded (it may hold edits).
  const teamsByLegacyId = new Map();
  const addBank = (bank, side, liveId, liveRoster) => {
    for (const t of Array.isArray(bank) ? bank : []) {
      if (!t || !t.name) continue;
      const roster = t.id === liveId && Array.isArray(liveRoster) && liveRoster.length ? liveRoster : t.roster;
      const team = createTeam({
        name: t.name, color: t.color || (side === 'us' ? '#d6222c' : '#1e3a5f'), side,
        players: legacyRosterToPlayers(roster),
        meta: t.sourceVersion ? { sourceVersion: t.sourceVersion } : {},
      });
      teamsByLegacyId.set(`${side}:${t.id}`, team);
      doc.teams.push(team);
    }
  };
  addBank(clean.homeTeamBank, 'us', clean.currentHomeTeamId, clean.home && clean.home.roster);
  addBank(clean.visitorTeamBank, 'opp', clean.currentVisitorTeamId, clean.visitor && clean.visitor.roster);

  const usTeam = teamsByLegacyId.get(`us:${clean.currentHomeTeamId}`) || teamsByLegacyId.get(`us:${clean.defaultHomeTeamId}`) || doc.teams.find((t) => t.side === 'us');
  const oppTeam = teamsByLegacyId.get(`opp:${clean.currentVisitorTeamId}`) || null;
  doc.selection = { usId: usTeam ? usTeam.id : null, oppId: oppTeam ? oppTeam.id : null };
  if (usTeam && teamsByLegacyId.get(`us:${clean.defaultHomeTeamId}`)) usTeam.isDefault = true;

  // Saved rotations become lineup presets, matched to players by name (v1 ids were not stable).
  for (const side of TEAM_KEYS) {
    const legacyKey = side === 'us' ? 'home' : 'visitor';
    const team = side === 'us' ? usTeam : oppTeam;
    const rotations = clean[legacyKey] && clean[legacyKey].rotations;
    if (!team || !Array.isArray(rotations)) continue;
    for (const r of rotations) {
      const slots = (r.positions || []).slice(0, 6).map((p) => {
        const match = p && team.players.find((x) => x.name === p.name);
        return match ? match.id : null;
      });
      while (slots.length < 6) slots.push(null);
      doc.presets.push({ id: uid('lp'), teamId: team.id, name: cleanText(r.name) || 'Lineup', slots, libero: null });
    }
  }

  // Settings.
  doc.settings.theme = ['blackout', 'charcoal'].includes(clean.currentTheme) ? 'night' : 'day';
  doc.settings.statPrompt = clean.statsEnabled !== false;
  doc.settings.trackOppPlayers = clean.visitorRosterEnabled !== false;
  doc.settings.confirmDestructive = !clean.skipConfirmations;
  doc.setup.format = normalizeFormat(clean.matchFormat);

  // History.
  doc.archive = (Array.isArray(clean.matchArchive) ? clean.matchArchive : []).map((m) => legacyArchiveRecord(m));

  // A v1 match in progress is kept as history so no data is lost.
  const home = clean.home || {};
  const visitor = clean.visitor || {};
  const hasLive = (Array.isArray(clean.setHistory) && clean.setHistory.length) || home.score > 0 || visitor.score > 0;
  if (clean.matchInProgress || hasLive) {
    const sets = (clean.setHistory || []).map((s) => ({ ...s }));
    if (home.score > 0 || visitor.score > 0) sets.push({ setNumber: sets.length + 1, homeScore: home.score, visitorScore: visitor.score, inProgress: true });
    if (sets.length) {
      doc.archive.unshift(legacyArchiveRecord({
        id: `live${Date.now()}`, date: payload.savedAt || new Date().toISOString(),
        homeTeamName: payload.homeTeamName, visitorTeamName: payload.visitorTeamName,
        sets, setsWonHome: sets.filter((s) => !s.inProgress && s.homeScore > s.visitorScore).length,
        setsWonVisitor: sets.filter((s) => !s.inProgress && s.visitorScore > s.homeScore).length,
        matchFormat: clean.matchFormat, timeline: clean.matchTimeline,
        homeRoster: home.roster, visitorRoster: clean.visitorRosterEnabled === false ? [] : visitor.roster,
      }, { carriedOver: true, label: 'Carried over from v1 (in progress)' }));
    }
  }

  doc.board.strokes = Array.isArray(clean.whiteboardStrokes) ? clean.whiteboardStrokes : [];
  doc.migratedFromV1 = new Date().toISOString();
  return doc;
}
