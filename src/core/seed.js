// Seeds and re-syncs the built-in teams.
import { SEED_VERSION, SEED_US, SEED_OPP } from './seed-data.js';
import { createTeam, createPlayer } from './roster.js';

export const VARSITY_NAME = 'Tampa Prep Varsity 2026';

/**
 * Ensures every seed team exists (matched by name; never duplicates or deletes coach-made teams),
 * and re-syncs the official varsity roster when SEED_VERSION changes. Player ids are preserved by
 * name so saved lineups keep pointing at the same players. Returns a new document.
 */
export function ensureSeedTeams(doc) {
  const teams = doc.teams.map((t) => ({ ...t, players: [...t.players] }));
  const has = (name, side) => teams.find((t) => t.name === name && t.side === side);
  for (const [list, side] of [[SEED_US, 'us'], [SEED_OPP, 'opp']]) {
    for (const s of list) {
      const meta = { ...(s.maxprepsUrl ? { maxprepsUrl: s.maxprepsUrl } : {}), ...(s.name === VARSITY_NAME ? { sourceVersion: SEED_VERSION, isDefault: true } : {}) };
      const existing = has(s.name, side);
      if (!existing) teams.push(createTeam({ name: s.name, color: s.color, side, players: s.players, meta }));
      else if (s.maxprepsUrl && !existing.maxprepsUrl) existing.maxprepsUrl = s.maxprepsUrl; // backfill links for saved teams
    }
  }
  const varsity = teams.find((t) => t.name === VARSITY_NAME && t.side === 'us');
  if (varsity && varsity.sourceVersion !== SEED_VERSION) {
    const seed = SEED_US.find((s) => s.name === VARSITY_NAME);
    const byName = new Map(varsity.players.map((p) => [p.name, p]));
    varsity.players = seed.players.map((sp) => {
      const prev = byName.get(sp.name);
      const fresh = createPlayer(sp);
      return prev ? { ...fresh, id: prev.id, roles: prev.roles.length ? prev.roles : fresh.roles, libero: prev.libero || fresh.libero } : fresh;
    });
    varsity.sourceVersion = SEED_VERSION;
    varsity.updatedAt = new Date().toISOString();
  }
  const selection = { ...doc.selection };
  if (!selection.usId || !teams.some((t) => t.id === selection.usId)) {
    const def = teams.find((t) => t.side === 'us' && t.isDefault) || varsity || teams.find((t) => t.side === 'us');
    selection.usId = def ? def.id : null;
  }
  if (selection.oppId && !teams.some((t) => t.id === selection.oppId)) selection.oppId = null;
  return { ...doc, teams, selection, seedVersion: SEED_VERSION };
}
