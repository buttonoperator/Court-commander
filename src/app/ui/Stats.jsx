// Stats: KPIs, momentum chart, rotation +/-, box score; CSV and printable report.
import { useState } from 'preact/hooks';
import { docStore, useObservable, matchView, downloadText, slug, stamp } from '../store.js';
import { replay } from '../../core/engine.js';
import { boxScore, teamReport, STAT_COLUMNS, fmtPct, fmtHit, boxScoreCsv, progression } from '../../core/stats.js';
import { useTeamColors, RotationBars } from './Live.jsx';
import { Segmented, Empty } from './primitives.jsx';
import { IconStats, IconDownload, IconPrint } from './icons.jsx';

const fmtCell = (key, v) => (key === 'HIT' ? fmtHit(v) : v == null ? '–' : key === 'PM' ? (v > 0 ? `+${v}` : `${v}`) : Number.isInteger(v) ? v : v.toFixed(1));

export function MomentumChart({ points, colors, height = 140 }) {
  if (!points.length) return <div class="chart-empty muted small">No rallies yet</div>;
  const W = 600;
  const H = height;
  const diffs = [0, ...points.map((p) => p.us - p.opp)];
  const max = Math.max(4, ...diffs.map(Math.abs));
  const x = (i) => (i / Math.max(1, diffs.length - 1)) * W;
  const y = (d) => H / 2 - (d / max) * (H / 2 - 8);
  const line = diffs.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H / 2} L0,${H / 2} Z`;
  return (
    <svg class="momentum-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Score margin by rally">
      <defs>
        <linearGradient id="mc-up" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color={colors.us} stop-opacity=".55" /><stop offset=".5" stop-color={colors.us} stop-opacity="0" /></linearGradient>
        <linearGradient id="mc-dn" x1="0" x2="0" y1="0" y2="1"><stop offset=".5" stop-color={colors.opp} stop-opacity="0" /><stop offset="1" stop-color={colors.opp} stop-opacity=".55" /></linearGradient>
        <clipPath id="mc-top"><rect x="0" y="0" width={W} height={H / 2} /></clipPath>
        <clipPath id="mc-bot"><rect x="0" y={H / 2} width={W} height={H / 2} /></clipPath>
      </defs>
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} class="mc-axis" />
      <path d={area} fill="url(#mc-up)" clip-path="url(#mc-top)" />
      <path d={area} fill="url(#mc-dn)" clip-path="url(#mc-bot)" />
      <path d={line} class="mc-line" vector-effect="non-scaling-stroke" />
    </svg>
  );
}

export function BoxTable({ match, box, team, colors }) {
  const rows = box[team].rows.filter((r) => !r.player.generic);
  if (!rows.length) return <p class="muted small">No player stats for this team.</p>;
  return (
    <div class="table-wrap">
      <table class="box">
        <thead>
          <tr>
            <th class="sticky">Player</th>
            {STAT_COLUMNS.map((c) => <th key={c.key} title={c.title}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.player.id}>
              <td class="sticky"><b class="jn" style={{ color: colors[team] }}>{r.player.jersey}</b> {r.player.name}</td>
              {STAT_COLUMNS.map((c) => <td key={c.key} class={r.stats[c.key] ? '' : 'zero'}>{fmtCell(c.key, r.stats[c.key])}</td>)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td class="sticky">Team</td>
            {STAT_COLUMNS.map((c) => <td key={c.key}>{c.key === 'PM' ? '' : fmtCell(c.key, box[team].totals[c.key])}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Opens a print-ready report in a new window (Save as PDF from the print dialog). */
export function printReport(match, view) {
  const box = boxScore(match, view);
  const rep = teamReport(view);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const table = (team) => `<h3>${esc(match.teams[team].name)}</h3><table><thead><tr><th>#</th><th>Player</th>${STAT_COLUMNS.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${box[team].rows.filter((r) => !r.player.generic).map((r) => `<tr><td>${esc(r.player.jersey)}</td><td>${esc(r.player.name)}</td>${STAT_COLUMNS.map((c) => `<td>${fmtCell(c.key, r.stats[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const sets = view.sets.map((s) => `<td>${s.score.us}–${s.score.opp}${s.winner ? '' : ' (in progress)'}</td>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(match.teams.us.name)} vs ${esc(match.teams.opp.name)}</title>
<style>body{font:12px -apple-system,Segoe UI,Roboto,sans-serif;color:#0b1120;margin:28px}h1{font-size:22px;margin:0}h2{font-size:13px;color:#555;font-weight:500;margin:4px 0 18px}h3{margin:22px 0 6px;font-size:14px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:right}th:nth-child(2),td:nth-child(2){text-align:left}.kpi{display:flex;gap:24px;margin:12px 0}.kpi div{border:1px solid #ddd;border-radius:8px;padding:8px 12px}.kpi b{display:block;font-size:18px}@media print{body{margin:10mm}}</style></head>
<body><h1>${esc(match.teams.us.name)} ${view.setsWon.us}–${view.setsWon.opp} ${esc(match.teams.opp.name)}</h1><h2>${new Date(match.createdAt).toLocaleString()} · ${match.venue === 'home' ? 'Home' : 'Away'} · best of ${match.format}</h2>
<table><tr><th style="text-align:left">Sets</th>${sets}</tr></table>
<div class="kpi"><div>Side-out<b>${fmtPct(rep.teams.us.sideoutPct)}</b></div><div>Point-score<b>${fmtPct(rep.teams.us.servePct)}</b></div><div>Kills<b>${rep.teams.us.kills}</b></div><div>Aces<b>${rep.teams.us.aces}</b></div><div>Blocks<b>${rep.teams.us.blocks}</b></div><div>Errors<b>${rep.teams.us.errors}</b></div></div>
${table('us')}${match.teams.opp.generic ? '' : table('opp')}<p style="color:#888;margin-top:24px">Court Commander</p><script>setTimeout(()=>print(),300)</script></body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
  return html;
}

/** Stats for a match object (live or archived). */
export function MatchStats({ match, view }) {
  const doc = useObservable(docStore);
  const colors = useTeamColors(match, doc.settings.theme);
  const [setFilter, setSetFilter] = useState(null);
  const [team, setTeam] = useState('us');
  const box = boxScore(match, view, setFilter);
  const rep = teamReport(view, setFilter);
  const chartSet = setFilter || (view.current ? view.current.n : 1);
  const t = rep.teams;
  const cards = [
    ['Side-out %', fmtPct(t.us.sideoutPct), fmtPct(t.opp.sideoutPct)],
    ['Point-score %', fmtPct(t.us.servePct), fmtPct(t.opp.servePct)],
    ['Kills', t.us.kills, t.opp.kills],
    ['Aces', t.us.aces, t.opp.aces],
    ['Blocks', t.us.blocks, t.opp.blocks],
    ['Errors given', t.us.errors, t.opp.errors],
    ['Longest run', t.us.longestRun, t.opp.longestRun],
    ['Points won', t.us.won, t.opp.won],
  ];
  return (
    <div class="stats">
      <div class="stats-toolbar">
        <Segmented value={setFilter} onChange={setSetFilter} size="sm" label="Set filter" options={[{ value: null, label: 'Match' }, ...view.sets.map((s) => ({ value: s.n, label: `Set ${s.n}` }))]} />
        <div class="row gap-s">
          <button class="btn ghost sm" data-testid="export-csv" onClick={() => downloadText(`${slug(match.teams.us.name)}-vs-${slug(match.teams.opp.name)}-${stamp()}.csv`, boxScoreCsv(match, view, setFilter), 'text/csv')}><IconDownload width="16" height="16" /> CSV</button>
          <button class="btn ghost sm" data-testid="print-report" onClick={() => printReport(match, view)}><IconPrint width="16" height="16" /> Report</button>
        </div>
      </div>
      <div class="kpi-grid">
        <div class="kpi-legend"><span style={{ '--tc': colors.us }}>{match.teams.us.name}</span><span style={{ '--tc': colors.opp }}>{match.teams.opp.name}</span></div>
        {cards.map(([label, a, b]) => (
          <div class="kpi-card" key={label}>
            <small>{label}</small>
            <div class="kpi-pair"><b style={{ color: colors.us }}>{a}</b><b style={{ color: colors.opp }}>{b}</b></div>
          </div>
        ))}
      </div>
      <div class="grid-2 charts">
        <section class="card">
          <header class="card-head"><h3>Momentum · set {chartSet}</h3><span class="muted small">margin by rally</span></header>
          <MomentumChart points={progression(view, chartSet)} colors={colors} />
        </section>
        <section class="card">
          <header class="card-head"><h3>Rotation +/-</h3><span class="muted small">{match.teams.us.name}, by server slot</span></header>
          <RotationBars rotations={rep.rotations} color={colors.us} />
        </section>
      </div>
      <section class="card">
        <header class="card-head">
          <h3>Box score</h3>
          <Segmented value={team} onChange={setTeam} size="sm" label="Team" options={[{ value: 'us', label: match.teams.us.name }, { value: 'opp', label: match.teams.opp.name }]} />
        </header>
        <BoxTable match={match} box={box} team={team} colors={colors} />
      </section>
    </div>
  );
}

export function StatsScreen() {
  const doc = useObservable(docStore);
  const latest = doc.archive.find((a) => a.match);
  if (doc.match) return <MatchStats match={doc.match} view={matchView(doc)} />;
  if (latest) {
    return (
      <div>
        <p class="muted small pad-x">No live match. Showing the last match in History.</p>
        <MatchStats match={latest.match} view={replay(latest.match)} />
      </div>
    );
  }
  return <Empty icon={<IconStats width="40" height="40" />} title="No stats yet">Start a match and every point you enter builds the box score, side-out rates and rotation analysis here.</Empty>;
}
