// Statistics derived from the match view. Nothing here is stored: undoing a
// rally automatically removes its stats (v1 bug X7 cannot recur).
import { TEAM_KEYS, other } from './rules.js';
import { ERR_CODES } from './engine.js';

export const STAT_COLUMNS = Object.freeze([
  { key: 'K', label: 'K', title: 'Kills' },
  { key: 'E', label: 'E', title: 'Attack errors' },
  { key: 'ATT', label: 'TA', title: 'Attack attempts (recorded)' },
  { key: 'HIT', label: 'HIT%', title: 'Hitting efficiency (K-E)/TA', derived: true },
  { key: 'AST', label: 'A', title: 'Assists' },
  { key: 'SA', label: 'SA', title: 'Service aces' },
  { key: 'SE', label: 'SE', title: 'Service errors' },
  { key: 'SRV', label: 'SRV', title: 'Serves' },
  { key: 'BS', label: 'BS', title: 'Block solos' },
  { key: 'BA', label: 'BA', title: 'Block assists' },
  { key: 'D', label: 'D', title: 'Digs' },
  { key: 'R', label: 'R', title: 'Receptions' },
  { key: 'RE', label: 'RE', title: 'Reception errors' },
  { key: 'BHE', label: 'BHE', title: 'Ball-handling errors' },
  { key: 'PTS', label: 'PTS', title: 'Points (K + SA + BS + 0.5 BA)', derived: true },
  { key: 'PM', label: '+/-', title: 'Rally plus/minus while on court', derived: true },
]);

const blank = () => ({ K: 0, E: 0, ATT: 0, AST: 0, SA: 0, SE: 0, SRV: 0, BS: 0, BA: 0, D: 0, R: 0, RE: 0, BHE: 0, NET: 0, PM: 0 });

export const hitPct = (s) => (s.ATT > 0 ? (s.K - s.E) / s.ATT : null);
export const points = (s) => s.K + s.SA + s.BS + 0.5 * s.BA;
export const fmtPct = (v, digits = 0) => (v == null ? '–' : `${(v * 100).toFixed(digits)}%`);
export const fmtHit = (v) => (v == null ? '–' : (v < 0 ? '-' : '') + Math.abs(v).toFixed(3).replace(/^0/, ''));

/** Rallies of one set, or of every set when setNumber is null. */
export function ralliesOf(view, setNumber = null) {
  const sets = setNumber == null ? view.sets : view.sets.filter((s) => s.n === setNumber);
  return sets.flatMap((s) => s.rallies.map((r) => ({ ...r, set: s.n })));
}

/** Per-player box score for both teams. */
export function boxScore(match, view, setNumber = null) {
  const table = { us: new Map(), opp: new Map() };
  for (const team of TEAM_KEYS) for (const p of match.teams[team].players) table[team].set(p.id, blank());
  const bump = (team, id, key, n = 1) => {
    if (!id || !table[team].has(id)) return;
    table[team].get(id)[key] += n;
  };
  for (const r of ralliesOf(view, setNumber)) {
    const loser = other(r.winner);
    bump(r.servingTeam, r.server, 'SRV');
    for (const team of TEAM_KEYS) for (const id of r.onCourt[team]) bump(team, id, 'PM', r.winner === team ? 1 : -1);
    switch (r.code) {
      case 'K': bump(r.winner, r.actor, 'K'); bump(r.winner, r.actor, 'ATT'); bump(r.winner, r.assist, 'AST'); break;
      case 'ACE': bump(r.winner, r.actor, 'SA'); bump(loser, r.victim, 'RE'); break;
      case 'BLK': bump(r.winner, r.actor, 'BS'); bump(loser, r.victim, 'E'); bump(loser, r.victim, 'ATT'); break;
      case 'SE': bump(loser, r.actor, 'SE'); break;
      case 'E': bump(loser, r.actor, 'E'); bump(loser, r.actor, 'ATT'); break;
      case 'BHE': bump(loser, r.actor, 'BHE'); break;
      case 'RE': bump(loser, r.actor, 'RE'); break;
      case 'NET': bump(loser, r.actor, 'NET'); break;
      default: break;
    }
  }
  for (const a of view.adjustments) {
    if (setNumber != null && a.set !== setNumber) continue;
    bump(a.team, a.player, a.stat, a.delta);
  }
  const out = {};
  for (const team of TEAM_KEYS) {
    const rows = match.teams[team].players.map((player) => {
      const s = table[team].get(player.id);
      for (const k of Object.keys(s)) if (s[k] < 0) s[k] = 0;
      return { player, stats: { ...s, HIT: hitPct(s), PTS: points(s) } };
    });
    const totals = blank();
    for (const r of rows) for (const k of Object.keys(totals)) totals[k] += r.stats[k] || 0;
    totals.PM = rows.length ? null : 0;
    out[team] = { rows, totals: { ...totals, HIT: hitPct(totals), PTS: points(totals) } };
  }
  return out;
}

/** Team-level analytics a coach reads at a timeout. */
export function teamReport(view, setNumber = null) {
  const rallies = ralliesOf(view, setNumber);
  const blankTeam = () => ({
    won: 0, served: 0, servedWon: 0, received: 0, receivedWon: 0,
    kills: 0, aces: 0, blocks: 0, oppErrors: 0, errors: 0, unforced: 0, longestRun: 0,
  });
  const t = { us: blankTeam(), opp: blankTeam() };
  let run = { team: null, n: 0 };
  for (const r of rallies) {
    const w = r.winner;
    const l = other(w);
    t[w].won += 1;
    t[r.servingTeam].served += 1;
    t[other(r.servingTeam)].received += 1;
    if (r.servingTeam === w) t[w].servedWon += 1; else t[w].receivedWon += 1;
    if (r.code === 'K') t[w].kills += 1;
    if (r.code === 'ACE') t[w].aces += 1;
    if (r.code === 'BLK') t[w].blocks += 1;
    if (ERR_CODES.includes(r.code)) { t[w].oppErrors += 1; t[l].errors += 1; }
    run = run.team === w ? { team: w, n: run.n + 1 } : { team: w, n: 1 };
    t[w].longestRun = Math.max(t[w].longestRun, run.n);
  }
  for (const k of ['us', 'opp']) {
    t[k].sideoutPct = t[k].received ? t[k].receivedWon / t[k].received : null;
    t[k].servePct = t[k].served ? t[k].servedWon / t[k].served : null;
  }
  // Our six rotations, keyed by which lineup slot is serving/standing in zone 1.
  const rotations = Array.from({ length: 6 }, (_, i) => ({ rotation: i + 1, rallies: 0, won: 0, lost: 0, served: 0, servedWon: 0, received: 0, receivedWon: 0 }));
  for (const r of rallies) {
    const row = rotations[r.rotBefore.us % 6];
    row.rallies += 1;
    if (r.winner === 'us') row.won += 1; else row.lost += 1;
    if (r.servingTeam === 'us') { row.served += 1; if (r.winner === 'us') row.servedWon += 1; } else { row.received += 1; if (r.winner === 'us') row.receivedWon += 1; }
  }
  for (const row of rotations) row.plusMinus = row.won - row.lost;
  const current = run.team ? { ...run } : null;
  return { teams: t, rotations, currentRun: current, rallies: rallies.length };
}

/** Score progression for a set as [{us, opp, winner}] (drives the momentum chart). */
export function progression(view, setNumber) {
  const set = view.sets.find((s) => s.n === setNumber);
  return set ? set.rallies.map((r) => ({ us: r.score.us, opp: r.score.opp, winner: r.winner, code: r.code })) : [];
}

/** CSV of a box score. */
export function boxScoreCsv(match, view, setNumber = null) {
  const box = boxScore(match, view, setNumber);
  const cols = STAT_COLUMNS;
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmt = (k, v) => (k === 'HIT' ? fmtHit(v) : v == null ? '' : Number.isInteger(v) ? v : Number(v).toFixed(1));
  const lines = [['Team', '#', 'Player', ...cols.map((c) => c.label)].join(',')];
  for (const team of TEAM_KEYS) {
    for (const row of box[team].rows) {
      lines.push([match.teams[team].name, row.player.jersey, row.player.name, ...cols.map((c) => fmt(c.key, row.stats[c.key]))].map(esc).join(','));
    }
    lines.push([match.teams[team].name, '', 'TOTAL', ...cols.map((c) => fmt(c.key, box[team].totals[c.key]))].map(esc).join(','));
  }
  return lines.join('\n');
}
