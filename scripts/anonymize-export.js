#!/usr/bin/env node
// Anonymizes player names in a Court Commander export while keeping structure,
// numbers, ids, jerseys, positions, timestamps and every other field byte-identical.
//
//   node scripts/anonymize-export.js <input.json> [output.json]
//
// Handles: full backup / localStorage payload ({state, ...}), team-bank export,
// single-roster export. Output defaults to <input>.anon.json. Never writes next to
// a path ignored by git unless you point it there; the default output name
// (*.anon.json) is NOT ignored, so it is safe to commit once reviewed.
//
// What is replaced (consistently: the same real string always maps to the same alias):
//   - player names in rosters, positions[], saved rotations, bank rosters, planner plans,
//     archive rosters, timeline events (playerName, assistName, playerOutName, playerInName,
//     subbedOutName, and names inside homePositions / visitorPositions)
//   - team names (homeTeamName, visitorTeamName, bank entry names, planner context, teamName)
//     -> "Home Team", "Opponent N"
//   - editedLabel on archived matches -> "Match N"
// What is kept: ids, jersey, grade, position, stats, scores, dates, flags, colors.
// Unknown fields that look like free text are NOT touched. Review the output before sharing.
// Anonymized files are for tests and migration work only: team names change, so loading one
// into the live app would defeat its name-based seed-roster sync.
const fs = require('fs');

const [, , inFile, outArg] = process.argv;
if (!inFile) { console.error('usage: node scripts/anonymize-export.js <input.json> [output.json]'); process.exit(2); }
const outFile = outArg || inFile.replace(/\.json$/i, '') + '.anon.json';
const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));

const playerAlias = new Map();
const teamAlias = new Map();
const matchLabel = new Map();
const alias = (map, key, make) => {
  if (key == null || key === '') return key;
  if (!map.has(key)) map.set(key, make(map.size + 1));
  return map.get(key);
};
const player = n => alias(playerAlias, n, i => `Player ${String(i).padStart(3, '0')}`);
const team = n => {
  if (n === 'Tampa Prep' || /^Tampa Prep Varsity/i.test(String(n))) return alias(teamAlias, n, i => `Home Team ${i}`);
  return alias(teamAlias, n, i => `Opponent ${i}`);
};

const PLAYER_KEYS = new Set(['playerName', 'assistName', 'playerOutName', 'playerInName', 'subbedOutName']);
const TEAM_KEYS = new Set(['homeTeamName', 'visitorTeamName', 'teamName']);

// A "player-like" object has a name plus at least one of jersey/position/stats/libero.
const isPlayerLike = o => o && typeof o === 'object' && !Array.isArray(o) && typeof o.name === 'string' &&
  ('jersey' in o || 'position' in o || 'stats' in o || 'libero' in o);

function walk(node, ctx) {
  if (Array.isArray(node)) { node.forEach((v, i) => { node[i] = walk(v, ctx); }); return node; }
  if (!node || typeof node !== 'object') return node;

  if (isPlayerLike(node)) node.name = player(node.name);

  for (const k of Object.keys(node)) {
    const v = node[k];
    if (typeof v === 'string') {
      if (PLAYER_KEYS.has(k)) node[k] = player(v);
      else if (TEAM_KEYS.has(k)) node[k] = team(v);
      else if (k === 'editedLabel' && v) node[k] = alias(matchLabel, v, i => `Match ${i}`);
      continue;
    }
    if (v && typeof v === 'object') {
      node[k] = walk(v, ctx);
    }
  }
  // Bank entry: object with name + roster array and no jersey -> team name.
  if (typeof node.name === 'string' && Array.isArray(node.roster) && !isPlayerLike(node)) node.name = team(node.name);
  // Planner plan context stores the Tampa Prep team name under homeTeamName (handled by TEAM_KEYS).
  return node;
}

walk(data, {});
fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
console.log(`wrote ${outFile}: ${playerAlias.size} distinct player names and ${teamAlias.size} team names replaced`);
