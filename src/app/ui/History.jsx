// Match history and the replay theater (works for v2 matches and migrated v1 archives).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { docStore, useObservable, updateDoc, confirmDialog, promptDialog, setUi, ui } from '../store.js';
import { replay, playerById, CODE_LABEL, ERR_CODES } from '../../core/engine.js';
import { other } from '../../core/rules.js';
import { displayColor, separateColors } from '../color.js';
import { Court } from './Court.jsx';
import { MatchStats, MomentumChart, printReport } from './Stats.jsx';
import { Empty, TeamBadge, fmtDate, Sheet } from './primitives.jsx';
import { IconHistory, IconPlay, IconPause, IconTrash, IconEdit, IconStats, IconPrint, IconX, IconBack, IconChevron } from './icons.jsx';

/** Frames for the replay: one per rally with the lineup on court as that rally was played. */
export function framesFor(record) {
  if (record.match) {
    const m = record.match;
    const view = replay(m);
    const frames = [];
    for (const s of view.sets) {
      for (const r of s.rallies) {
        const actorTeam = ERR_CODES.includes(r.code) ? other(r.winner) : r.winner;
        const actor = r.actor && playerById(m, actorTeam, r.actor);
        const assist = r.assist && playerById(m, r.winner, r.assist);
        frames.push({
          set: s.n, score: r.score, winner: r.winner, serving: r.servingTeam,
          text: `${m.teams[r.winner].name} · ${CODE_LABEL[r.code] || 'Point'}${actor ? ` · #${actor.jersey} ${actor.name}` : ''}${assist ? ` (set by #${assist.jersey} ${assist.name})` : ''}`,
          court: { us: r.onCourt.us.map((id) => playerById(m, 'us', id)), opp: r.onCourt.opp.map((id) => playerById(m, 'opp', id)) },
        });
      }
    }
    return frames;
  }
  const tl = (record.legacy && record.legacy.timeline) || [];
  return tl.filter((e) => e.type === 'point').map((e) => ({
    set: e.set, score: e.score, winner: e.scoringTeam, serving: e.serving,
    text: `${e.scoringTeam === 'us' ? record.us.name : record.opp.name}${e.code && !['SKIP', 'PT'].includes(e.code) ? ` · ${CODE_LABEL[e.code] || e.code}` : ''}${e.player ? ` · ${e.player}` : ''}${e.assist ? ` (set by ${e.assist})` : ''}`,
    court: {
      us: e.court.us.map((p, i) => (p ? { id: `u${i}`, ...p } : null)),
      opp: e.court.opp.map((p, i) => (p ? { id: `o${i}`, ...p } : null)),
    },
  }));
}

export function ReplayTheater({ record, onClose }) {
  const doc = useObservable(docStore);
  const theme = doc.settings.theme;
  const colors = { us: displayColor(record.us.color, theme), opp: displayColor(separateColors(record.us.color, record.opp.color), theme) };
  const frames = useMemo(() => framesFor(record), [record.id]);
  const sets = [...new Set(frames.map((f) => f.set))];
  const [idx, setIdx] = useState(frames.length ? 0 : -1);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return undefined;
    const iv = setInterval(() => setIdx((i) => { if (i >= frames.length - 1) { setPlaying(false); return i; } return i + 1; }), 900);
    return () => clearInterval(iv);
  }, [playing, frames.length]);
  const f = frames[idx];
  const empty = Array(6).fill(null);
  const setFrames = f ? frames.filter((x) => x.set === f.set) : [];
  return (
    <div class="theater" role="dialog" aria-label="Replay">
      <header class="theater-head">
        <button class="icon-btn ghost" aria-label="Close replay" onClick={onClose}><IconX /></button>
        <div class="theater-title"><b>{record.us.name}</b> <span class="muted">vs</span> <b>{record.opp.name}</b><small>{fmtDate(record.date)}</small></div>
        <span />
      </header>
      {!f ? <Empty title="Nothing to replay">This match has no recorded rallies.</Empty> : (
        <div class="theater-body">
          <div class="set-tabs" role="tablist">
            {sets.map((n) => <button key={n} role="tab" aria-selected={f.set === n} class={f.set === n ? 'on' : ''} onClick={() => { setPlaying(false); setIdx(frames.findIndex((x) => x.set === n)); }}>Set {n}</button>)}
          </div>
          <div class="theater-score">
            <span style={{ color: colors.us }}>{f.score.us}</span><span class="dash">–</span><span style={{ color: colors.opp }}>{f.score.opp}</span>
          </div>
          <p class="theater-text" style={{ '--tc': colors[f.winner] }}>{f.text}</p>
          <Court entries={{ us: f.court.us.length ? f.court.us : empty, opp: f.court.opp.length ? f.court.opp : empty }} colors={colors} serving={f.serving} compact />
          <MomentumChart points={setFrames.slice(0, setFrames.indexOf(f) + 1).map((x) => ({ us: x.score.us, opp: x.score.opp }))} colors={colors} height={90} />
          <div class="scrubber">
            <button class="icon-btn" aria-label="Previous rally" onClick={() => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }}><IconBack /></button>
            <button class="icon-btn primary" aria-label={playing ? 'Pause' : 'Play'} data-testid="replay-play" onClick={() => setPlaying((p) => !p)}>{playing ? <IconPause /> : <IconPlay />}</button>
            <button class="icon-btn" aria-label="Next rally" data-testid="replay-next" onClick={() => { setPlaying(false); setIdx((i) => Math.min(frames.length - 1, i + 1)); }}><IconChevron /></button>
            <input type="range" min="0" max={frames.length - 1} value={idx} aria-label="Rally" onInput={(e) => { setPlaying(false); setIdx(Number(e.currentTarget.value)); }} />
            <span class="muted small" data-testid="replay-pos">{idx + 1}/{frames.length}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LegacyBox({ record }) {
  const cols = ['K', 'E', 'ATT', 'AST', 'SA', 'SE', 'BS', 'BA', 'D', 'R', 'RE', 'BHE'];
  const table = (team) => (
    <div class="table-wrap">
      <table class="box">
        <thead><tr><th class="sticky">{record[team].name}</th>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{record.legacy.box[team].map((p, i) => <tr key={i}><td class="sticky"><b class="jn">{p.jersey}</b> {p.name}</td>{cols.map((c) => <td key={c} class={p.stats[c] ? '' : 'zero'}>{p.stats[c]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
  return <div>{table('us')}{record.legacy.box.opp.length > 0 && table('opp')}</div>;
}

export function ArchiveStatsSheet({ id, onClose }) {
  const doc = useObservable(docStore);
  const record = doc.archive.find((a) => a.id === id);
  if (!record) return null;
  return (
    <Sheet title={`${record.us.name} vs ${record.opp.name}`} subtitle={fmtDate(record.date)} onClose={onClose} wide>
      {record.match ? <MatchStats match={record.match} view={replay(record.match)} /> : <LegacyBox record={record} />}
    </Sheet>
  );
}

export function HistoryScreen({ openSheet }) {
  const doc = useObservable(docStore);
  const theme = doc.settings.theme;
  const replayId = useObservable(ui, (s) => s.replay);
  const record = replayId && doc.archive.find((a) => a.id === replayId);
  if (record) return <ReplayTheater record={record} onClose={() => setUi({ replay: null })} />;
  if (!doc.archive.length) return <Empty icon={<IconHistory width="40" height="40" />} title="No matches yet">Finished matches land here with full replay and box scores.</Empty>;
  const wins = doc.archive.filter((a) => a.setsWon.us > a.setsWon.opp && !a.carriedOver).length;
  const losses = doc.archive.filter((a) => a.setsWon.us < a.setsWon.opp && !a.carriedOver).length;
  return (
    <div class="history">
      <div class="page-head">
        <h1>History</h1>
        <span class="record-pill" data-testid="season-record"><b>{wins}</b>–<b>{losses}</b> <small>record</small></span>
      </div>
      <div class="archive-list">
        {doc.archive.map((a) => {
          const result = a.setsWon.us > a.setsWon.opp ? 'W' : a.setsWon.us < a.setsWon.opp ? 'L' : '–';
          return (
            <article key={a.id} class={`archive-card res-${result}`} data-archive={a.id} style={{ '--tc': displayColor(a.opp.color, theme) }}>
              <div class="ac-main">
                <span class={`res res-${result}`}>{result}</span>
                <TeamBadge name={a.opp.name} color={displayColor(a.opp.color, theme)} />
                <div class="ac-title">
                  <b>{a.label || `vs ${a.opp.name}`}</b>
                  <small>{fmtDate(a.date)}{a.venue ? ` · ${a.venue === 'home' ? 'Home' : 'Away'}` : ''}{a.source === 'v1' ? ' · imported from v1' : ''}</small>
                </div>
                <span class="ac-sets">{a.setsWon.us}–{a.setsWon.opp}</span>
              </div>
              <div class="ac-setline">{a.sets.map((s) => <span key={s.n} class={s.inProgress ? 'inprog' : ''}>{s.us}–{s.opp}{s.inProgress ? '*' : ''}</span>)}</div>
              <div class="ac-actions">
                <button class="btn ghost sm" data-testid="replay" onClick={() => setUi({ replay: a.id })}><IconPlay width="16" height="16" /> Replay</button>
                <button class="btn ghost sm" onClick={() => openSheet({ kind: 'archive-stats', id: a.id })}><IconStats width="16" height="16" /> Stats</button>
                {a.match && <button class="btn ghost sm" onClick={() => printReport(a.match, replay(a.match))}><IconPrint width="16" height="16" /></button>}
                <button class="btn ghost sm" aria-label="Rename" onClick={async () => {
                  const label = await promptDialog({ title: 'Label this match', value: a.label || '', placeholder: 'e.g. Senior night' });
                  if (label !== null) updateDoc((d) => ({ ...d, archive: d.archive.map((x) => (x.id === a.id ? { ...x, label: label.trim() || null } : x)) }));
                }}><IconEdit width="16" height="16" /></button>
                <button class="btn ghost sm" aria-label="Delete" onClick={async () => {
                  if (await confirmDialog({ title: 'Delete this match from History?', confirm: 'Delete', danger: true })) updateDoc((d) => ({ ...d, archive: d.archive.filter((x) => x.id !== a.id) }));
                }}><IconTrash width="16" height="16" /></button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
