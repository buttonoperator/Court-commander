const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('./support/app');

const leafPaths = (o, p = '', out = []) => {
  if (o && typeof o === 'object') for (const k of Object.keys(o)) leafPaths(o[k], p + '/' + (Array.isArray(o) ? '[]' : k), out);
  else out.push(p + ':' + typeof o);
  return out.sort();
};

test('[OBSERVED] scripts/anonymize-export.js keeps structure and numbers, removes every player name', async ({ app }) => {
  await app.open();
  await app.startMatch();
  await app.ev(() => { addScore('home'); recordKill(state.home.positions[0].id); recordAssist(state.home.positions[1].id); });
  app.opts.prompt = 'Senior Night';
  await app.ev(() => { saveRotation('home'); archiveCurrentMatch(); editMatchLabel(state.matchArchive[0].id); saveToLocalStorage(); });
  const raw = await app.ev(() => localStorage.getItem('courtCommanderState_v1'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-anon-'));
  const inFile = path.join(dir, 'x.backup.json');
  const outFile = path.join(dir, 'x.anon.json');
  fs.writeFileSync(inFile, raw);
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'anonymize-export.js'), inFile, outFile]);
  const a = JSON.parse(raw);
  const b = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const txt = fs.readFileSync(outFile, 'utf8');

  expect(leafPaths(b)).toEqual(leafPaths(a));                       // identical structure and value types
  const names = new Set();
  (function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (typeof o.name === 'string' && 'jersey' in o) names.add(o.name); Object.values(o).forEach(walk); } })(a);
  expect(names.size).toBeGreaterThan(50);
  expect([...names].filter(n => txt.includes(n))).toEqual([]);      // no original name survives anywhere
  expect(b.state.home.score).toBe(a.state.home.score);
  expect(b.state.home.roster.map(p => p.jersey)).toEqual(a.state.home.roster.map(p => p.jersey));
  expect(b.state.home.roster.map(p => p.id)).toEqual(a.state.home.roster.map(p => p.id));
  expect(b.state.matchTimeline).toHaveLength(a.state.matchTimeline.length);
  expect(b.homeTeamName).toMatch(/^Home Team \d+$/);
  expect(b.state.matchArchive[0].editedLabel).toBe('Match 1');
  fs.rmSync(dir, { recursive: true, force: true });
});
