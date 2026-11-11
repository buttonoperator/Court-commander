// Teams, players, sanitising and roster import/export.
import { ROLES, parseRoles } from './rules.js';

let idCounter = 0;
/** Short, collision-resistant id. Deterministic prefix keeps ids readable in saves. */
export function uid(prefix = 'id') {
  idCounter = (idCounter + 1) % 1e6;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

/** Strips characters that could form markup. Keeps apostrophes. Passes null/undefined through. */
export function cleanText(value) {
  return value == null ? value : String(value).replace(/[<>"]/g, '').replace(/\s+/g, ' ').trim();
}

/** Recursively cleans every string inside a JSON-like value (used on loaded and restored saves). */
export function cleanDeep(node) {
  if (typeof node === 'string') return node.replace(/[<>"]/g, '');
  if (Array.isArray(node)) return node.map(cleanDeep);
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[k] = cleanDeep(node[k]);
    return out;
  }
  return node;
}

export const GRADES = Object.freeze(['Fr.', 'So.', 'Jr.', 'Sr.']);
const GRADE_MAP = {
  '9': 'Fr.', '9th': 'Fr.', fr: 'Fr.', 'fr.': 'Fr.', freshman: 'Fr.',
  '10': 'So.', '10th': 'So.', so: 'So.', 'so.': 'So.', soph: 'So.', sophomore: 'So.',
  '11': 'Jr.', '11th': 'Jr.', jr: 'Jr.', 'jr.': 'Jr.', junior: 'Jr.',
  '12': 'Sr.', '12th': 'Sr.', sr: 'Sr.', 'sr.': 'Sr.', senior: 'Sr.',
};
export const normalizeGrade = (g) => GRADE_MAP[String(g || '').trim().toLowerCase()] || cleanText(g || '') || '';

export const roleLabel = (code) => (ROLES.find((r) => r.code === code) || {}).label || '';

/** Canonical player record. `roles` is an ordered list of role codes (primary first). */
export function createPlayer({ id, name, jersey = '', roles = [], position, grade = '', libero = false } = {}) {
  const roleList = Array.isArray(roles) && roles.length ? roles.filter((r) => roleLabel(r)) : parseRoles(position);
  const isLibero = Boolean(libero) || roleList.includes('L');
  return {
    id: id || uid('p'),
    name: cleanText(name) || 'Player',
    jersey: cleanText(String(jersey ?? '')).replace(/^#/, ''),
    roles: isLibero && !roleList.includes('L') ? ['L', ...roleList] : roleList,
    grade: normalizeGrade(grade),
    libero: isLibero,
  };
}

export function createTeam({ id, name, color = '#334155', side = 'opp', players = [], meta = {} } = {}) {
  return {
    id: id || uid('t'),
    name: cleanText(name) || (side === 'us' ? 'Our Team' : 'Opponent'),
    color: /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#334155',
    side,
    players: players.map((p) => (p && p.id && Array.isArray(p.roles) ? p : createPlayer(p))),
    updatedAt: new Date().toISOString(),
    ...meta,
  };
}

/** Sort for display: numeric jersey ascending, then name. */
export function byJersey(a, b) {
  const ja = parseInt(a.jersey, 10);
  const jb = parseInt(b.jersey, 10);
  if (Number.isFinite(ja) && Number.isFinite(jb) && ja !== jb) return ja - jb;
  if (Number.isFinite(ja) !== Number.isFinite(jb)) return Number.isFinite(ja) ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export const shortName = (name = '') => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
};

export const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((s) => s[0] || '').join('').toUpperCase();

// ---------------------------------------------------------------------------
// Import / export. One format, two envelopes (documented in docs/roster-json-format.md):
//   { type: 'court-commander-roster', version: 1, teamName, roster: [...] }
//   { type: 'court-commander-team-bank', version: 1, teams: [{ name, roster }] }
// The importer also accepts looser shapes (screenshot transcriptions, chat replies).

export function exportPlayer(p) {
  const out = { name: p.name, jersey: p.jersey, position: roleLabel(p.roles[0]) || '', grade: p.grade, libero: p.libero };
  if (p.roles.length > 1) out.roles = p.roles.slice();
  return out;
}

export function rosterEnvelope(team) {
  return {
    type: 'court-commander-roster', version: 1, exportedAt: new Date().toISOString(),
    teamName: team.name, color: team.color, roster: team.players.map(exportPlayer),
  };
}

export function bankEnvelope(teams) {
  return {
    type: 'court-commander-team-bank', version: 1, exportedAt: new Date().toISOString(),
    teams: teams.map((t) => ({ name: t.name, color: t.color, side: t.side, roster: t.players.map(exportPlayer) })),
  };
}

function field(obj, keys) {
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase().replace(/[\s_-]/g, '')] = obj[k];
  for (const k of keys) {
    const v = lower[k];
    if (v !== undefined && v !== null && (Array.isArray(v) || String(v).trim() !== '')) return v;
  }
  return '';
}

/** One loosely-shaped entry -> plain player fields, or null if it has no name. */
export function normalizeImportedPlayer(p) {
  let name = '';
  let jersey = '';
  let position = '';
  let grade = '';
  let libero = false;
  let roles = null;
  if (typeof p === 'string') {
    const m = p.trim().match(/^#?(\d{1,3})\s*[-.)]?\s+(.+)$/);
    if (m) { jersey = m[1]; name = m[2]; } else { name = p; }
  } else if (p && typeof p === 'object' && !Array.isArray(p)) {
    name = String(field(p, ['name', 'playername', 'player', 'fullname']));
    if (!name) name = [field(p, ['firstname', 'first']), field(p, ['lastname', 'last'])].filter(Boolean).join(' ');
    jersey = String(field(p, ['jersey', 'jerseynumber', 'jerseyno', 'number', 'num', 'no', '#']));
    position = String(field(p, ['position', 'pos']));
    grade = String(field(p, ['grade', 'year', 'class', 'yr']));
    const r = field(p, ['roles']);
    if (Array.isArray(r)) roles = parseRoles(r.join(','));
    const lib = field(p, ['libero', 'islibero']);
    libero = lib === true || /^(true|yes|y|x|1)$/i.test(String(lib));
  } else {
    return null;
  }
  name = cleanText(name) || '';
  if (!name) return null;
  const roleList = roles && roles.length ? roles : parseRoles(position.replace(/\.$/, ''));
  if (roleList.includes('L')) libero = true;
  return {
    name,
    jersey: (cleanText(jersey) || '').replace(/^#/, ''),
    roles: roleList,
    grade: normalizeGrade(grade),
    libero,
  };
}

function listOf(obj) {
  for (const k of ['roster', 'players']) if (Array.isArray(obj[k])) return obj[k];
  return null;
}
function nameOf(obj) {
  for (const k of ['teamName', 'team_name', 'team', 'name']) {
    if (typeof obj[k] === 'string' && cleanText(obj[k])) return cleanText(obj[k]);
  }
  return '';
}

/**
 * Normalises any accepted payload to { kind: 'roster'|'bank', teams: [{ name, color, players }], warnings },
 * or null when nothing usable is present.
 */
export function normalizeImportPayload(payload) {
  const warnings = [];
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  let kind;
  let raw;
  if (Array.isArray(payload)) {
    if (payload.length && payload.every((x) => isObj(x) && listOf(x))) {
      kind = 'bank';
      raw = payload.map((x) => ({ name: nameOf(x), color: x.color, list: listOf(x) }));
    } else {
      kind = 'roster';
      raw = [{ name: '', list: payload }];
    }
  } else if (isObj(payload) && Array.isArray(payload.teams)) {
    kind = 'bank';
    raw = payload.teams.filter(isObj).map((x) => ({ name: nameOf(x), color: x.color, list: listOf(x) }));
  } else if (isObj(payload) && listOf(payload)) {
    kind = 'roster';
    raw = [{ name: nameOf(payload), color: payload.color, list: listOf(payload) }];
  } else {
    return null;
  }
  const teams = [];
  raw.forEach((t, i) => {
    const label = t.name || (kind === 'bank' ? `Team ${i + 1}` : 'Roster');
    if (!t.list) { warnings.push(`${label}: no player list found, skipped.`); return; }
    const players = [];
    let skipped = 0;
    for (const entry of t.list) {
      const p = normalizeImportedPlayer(entry);
      if (p) players.push(p); else skipped += 1;
    }
    if (skipped) warnings.push(`${label}: ${skipped} entr${skipped === 1 ? 'y' : 'ies'} without a name skipped.`);
    const seen = new Set();
    for (const p of players) {
      if (!p.jersey) continue;
      if (seen.has(p.jersey)) warnings.push(`${label}: jersey #${p.jersey} is used by more than one player.`);
      seen.add(p.jersey);
    }
    if (!players.length) { warnings.push(`${label}: no valid players, skipped.`); return; }
    teams.push({ name: t.name, color: t.color, players });
  });
  return teams.length ? { kind, teams, warnings } : null;
}

/** Extracts JSON from file text or a pasted chat reply (tolerates ```json fences and chatter). */
export function parseJsonLoose(text) {
  const trimmed = String(text || '').trim();
  const attempts = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) attempts.push(fence[1].trim());
  const first = trimmed.search(/[[{]/);
  const last = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (first >= 0 && last > first) attempts.push(trimmed.slice(first, last + 1));
  for (const a of attempts) {
    try { return { ok: true, value: JSON.parse(a) }; } catch { /* next */ }
  }
  return { ok: false };
}
