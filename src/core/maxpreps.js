// MaxPreps link handling and a parser for roster text a coach copies from a roster page.
//
// Court Commander never fetches MaxPreps itself: MaxPreps publishes no API and its terms prohibit
// automated collection. The app opens the team's page in the browser; the coach copies the roster
// and pastes it here. This file turns that pasted text into players.
import { parseRoles } from './rules.js';
import { normalizeGrade, cleanText } from './roster.js';

const SPORT = 'volleyball';

/**
 * Accepts any MaxPreps URL for a school (team home, roster, schedule, a season page) and returns the
 * team's volleyball home and roster links, or null if it is not a MaxPreps school URL.
 *   https://www.maxpreps.com/fl/tampa/tampa-prep-terrapins/volleyball/25-26/schedule/
 *     -> { base: 'https://www.maxpreps.com/fl/tampa/tampa-prep-terrapins/volleyball/', roster: base + 'roster/' }
 */
export function maxPrepsLinks(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch { return null; }
  if (!/^(www\.)?maxpreps\.com$/i.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  // Current layout: /{state}/{city}/{school-slug}/{sport}/...
  if (parts.length >= 3 && /^[a-z]{2}$/i.test(parts[0])) {
    const school = parts.slice(0, 3).join('/').toLowerCase();
    const base = `https://www.maxpreps.com/${school}/${SPORT}/`;
    return { base, roster: `${base}roster/`, school };
  }
  // Older layout: /high-schools/{school-(city,st)}/{sport}/home.htm
  if (parts[0] === 'high-schools' && parts[1]) {
    const base = `https://www.maxpreps.com/high-schools/${parts[1]}/${SPORT}/`;
    return { base, roster: `${base}roster.htm`, school: parts[1] };
  }
  return null;
}

/** A web search scoped to MaxPreps, used until the team's MaxPreps page is saved. */
export const maxPrepsSearchUrl = (teamName) =>
  `https://www.google.com/search?q=${encodeURIComponent(`site:maxpreps.com ${teamName} volleyball roster`)}`;

// ---------------------------------------------------------------------------
// Pasted roster text

const GRADE_RE = /^(fr|so|jr|sr|freshman|sophomore|junior|senior|9|10|11|12|9th|10th|11th|12th)\.?$/i;
const HEIGHT_RE = /^\d['’]\s?\d{1,2}(["”]|'')?$|^\d-\d{1,2}$/;
const JERSEY_RE = /^#?\d{1,3}$/;
const STAFF_RE = /\b(coach|head coach|assistant|statistician|manager|trainer|athletic director|staff)\b/i;
const HEADER_WORDS = /^(#|no\.?|num|number|jersey|name|player|athlete|grade|gr\.?|class|cl\.?|yr\.?|year|pos\.?|position|ht\.?|height|wt\.?|weight)$/i;

const isRole = (s) => parseRoles(s.replace(/\./g, '')).length > 0 && s.length <= 30 && !/\d/.test(s);

/** Classifies a single cell. */
function kind(cell) {
  const c = cell.trim();
  if (!c) return 'empty';
  if (JERSEY_RE.test(c)) return 'jersey';
  if (GRADE_RE.test(c)) return 'grade';
  if (HEIGHT_RE.test(c)) return 'height';
  if (isRole(c)) return 'role';
  if (HEADER_WORDS.test(c)) return 'header';
  return 'text';
}

function player(fields) {
  const name = cleanText((fields.name || '').replace(/\s+/g, ' ')) || '';
  if (!name || name.split(' ').length > 5) return null;
  const roles = parseRoles((fields.position || '').replace(/\./g, ''));
  return { name, jersey: (fields.jersey || '').replace(/^#/, ''), roles, grade: normalizeGrade(fields.grade || ''), libero: roles.includes('L') };
}

/** Tab-separated rows (what copying an HTML table produces). Uses the header row when present. */
function parseTable(lines) {
  const rows = lines.map((l) => l.split('\t').map((c) => c.trim()));
  let map = null;
  const out = [];
  for (const cells of rows) {
    const kinds = cells.map(kind);
    if (!map && kinds.filter((k) => k === 'header').length >= 2) {
      map = {};
      cells.forEach((c, i) => {
        const h = c.toLowerCase().replace(/\./g, '');
        if (/^(#|no|num|number|jersey)$/.test(h)) map.jersey = i;
        else if (/^(name|player|athlete)$/.test(h)) map.name = i;
        else if (/^(grade|gr|class|cl|yr|year)$/.test(h)) map.grade = i;
        else if (/^(pos|position)$/.test(h)) map.position = i;
      });
      continue;
    }
    if (cells.some((c) => STAFF_RE.test(c))) continue;
    if (map && map.name !== undefined) {
      const p = player({ name: cells[map.name], jersey: cells[map.jersey] || '', grade: cells[map.grade] || '', position: cells[map.position] || '' });
      if (p) out.push(p);
      continue;
    }
    const f = {};
    cells.forEach((c, i) => {
      const k = kinds[i];
      if (k === 'jersey' && f.jersey === undefined) f.jersey = c;
      // A second small number in a row without headers is the grade (9-12), not another jersey.
      else if ((k === 'grade' || (k === 'jersey' && GRADE_RE.test(c))) && !f.grade) f.grade = c;
      else if (k === 'role' && !f.position) f.position = c;
      else if (k === 'text' && !f.name) f.name = c;
    });
    const p = player(f);
    if (p) out.push(p);
  }
  return out;
}

/** One field per line (card layouts). A jersey number line starts each player. */
function parseBlocks(lines) {
  const out = [];
  let cur = null;
  const flush = () => { if (cur) { const p = player(cur); if (p) out.push(p); } cur = null; };
  let staff = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (STAFF_RE.test(l)) { staff = true; if (cur && cur.name) flush(); else cur = null; continue; }
    const k = kind(l);
    if (k === 'jersey') { flush(); staff = false; cur = { jersey: l }; continue; }
    if (!cur || staff) continue;
    if (k === 'grade' && !cur.grade) cur.grade = l;
    else if (k === 'role' && !cur.position) cur.position = l;
    else if (k === 'text' && !cur.name) cur.name = l;
  }
  flush();
  return out;
}

/** One player per line in free text: "12 Jane Doe Jr. OH 5'10"". */
function parseLines(lines) {
  const out = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || STAFF_RE.test(l)) continue;
    const tokens = l.split(/\s+/);
    const f = { nameParts: [] };
    for (const t of tokens) {
      const bare = t.replace(/[,;]$/, '');
      const k = kind(bare);
      if (k === 'jersey' && f.jersey === undefined && !f.nameParts.length) f.jersey = bare;
      else if (k === 'grade' && !f.grade) f.grade = bare;
      else if (k === 'height') continue;
      else if (k === 'role') f.position = f.position ? `${f.position},${bare}` : bare;
      else if (k === 'header') continue;
      else f.nameParts.push(bare);
    }
    const p = player({ ...f, name: f.nameParts.join(' ') });
    if (p && f.jersey !== undefined) out.push(p);
  }
  return out;
}

/**
 * Parses roster text copied from a web page. Returns { players, format, warnings } or null when no
 * players could be read. Rows for coaches and staff are skipped.
 */
export function parseRosterText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return null;
  const tabbed = lines.filter((l) => l.includes('\t')).length;
  const singles = lines.filter((l) => !l.includes('\t') && l.trim().split(/\s+/).length <= 4).length;
  const jerseyLines = lines.filter((l) => JERSEY_RE.test(l.trim())).length;
  let format;
  let players;
  if (tabbed >= Math.max(2, lines.length / 3)) { format = 'table'; players = parseTable(lines.filter((l) => l.includes('\t'))); }
  else if (jerseyLines >= 2 && singles / lines.length > 0.7) { format = 'blocks'; players = parseBlocks(lines); }
  else { format = 'lines'; players = parseLines(lines); }
  if (!players.length) return null;
  const warnings = [];
  const seen = new Set();
  for (const p of players) {
    if (p.jersey && seen.has(p.jersey)) warnings.push(`Jersey #${p.jersey} appears more than once.`);
    if (p.jersey) seen.add(p.jersey);
  }
  const noJersey = players.filter((p) => !p.jersey).length;
  if (noJersey) warnings.push(`${noJersey} player${noJersey === 1 ? ' has' : 's have'} no jersey number.`);
  return { players, format, warnings };
}

/**
 * Replaces a team's roster with imported players while keeping player ids for anyone matched by
 * name (case-insensitive), so saved lineups and planned subs keep pointing at the same people.
 * Roles and libero flags edited in the app are kept when the import has none.
 */
export function mergeRoster(existing, imported, makePlayer) {
  const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));
  return imported.map((ip) => {
    const prev = byName.get(ip.name.trim().toLowerCase());
    const fresh = makePlayer(ip);
    if (!prev) return fresh;
    return { ...fresh, id: prev.id, roles: fresh.roles.length ? fresh.roles : prev.roles, libero: fresh.libero || prev.libero, grade: fresh.grade || prev.grade };
  });
}
