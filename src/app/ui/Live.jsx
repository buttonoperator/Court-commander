// Live match: scoreboard, momentum, court, dock, between-set and end-of-match panels.
import { useEffect } from 'preact/hooks';
import { docStore, ui, useObservable, matchView, scorePoint, undoLast, redoLast, canUndo, run, setUi, finishMatch, discardMatch, confirmDialog, stageLineupFromSet, haptic } from '../store.js';
import { onCourt, describeEvent, playerById, decidingSetNumber } from '../../core/engine.js';
import { setRequiresToss, setsToWin, pointTarget } from '../../core/rules.js';
import { teamReport, fmtPct } from '../../core/stats.js';
import { displayColor, separateColors } from '../color.js';
import { Court } from './Court.jsx';
import { BumpNumber } from './primitives.jsx';
import { Ball, IconUndo, IconRedo, IconTimer, IconFlag, IconPen, IconSpark, IconStats } from './icons.jsx';
import { MatchSetup, LineupEditor } from './Setup.jsx';

export function useTeamColors(match, theme) {
  if (!match) return { us: '#ef4444', opp: '#60a5fa' };
  const us = displayColor(match.teams.us.color, theme);
  const opp = displayColor(separateColors(match.teams.us.color, match.teams.opp.color), theme);
  return { us, opp };
}

/** Court entries for the live set: players by zone, flagged as libero or substitute. */
export function liveEntries(match, set) {
  const out = {};
  for (const team of ['us', 'opp']) {
    out[team] = onCourt(set, team).map((id) => {
      const p = playerById(match, team, id);
      if (!p) return null;
      const lib = set.libero[team];
      return { ...p, libero: Boolean(lib && lib.id === id) || (p.libero && id === set.liberoId[team]), sub: !set.starters[team].includes(id) && !(lib && lib.id === id) };
    });
  }
  return out;
}

function Scoreboard({ match, view, colors }) {
  const set = view.current;
  const live = view.phase === 'live';
  const need = setsToWin(match.format);
  const side = (team) => {
    const t = match.teams[team];
    const serving = live && set.serving === team;
    const venueTag = team === 'us' ? (match.venue === 'home' ? 'HOME' : 'AWAY') : (match.venue === 'home' ? 'AWAY' : 'HOME');
    const toLeft = match.rules.timeoutsPerSet - (set ? set.timeoutsUsed[team] : 0);
    return (
      <button
        class={`score-side side-${team} ${serving ? 'is-serving' : ''} ${set && set.winner === team ? 'won-set' : ''}`}
        style={{ '--tc': colors[team] }}
        disabled={!live}
        onClick={() => scorePoint(team)}
        aria-label={`Point ${t.name}`}
        data-testid={`score-${team}`}
      >
        <span class="glow" aria-hidden="true" />
        <span class="score-team">
          <span class="score-name">{t.name}</span>
          <span class="venue-tag">{venueTag}</span>
        </span>
        <span class="score-num" data-testid={`score-num-${team}`}><BumpNumber value={set ? set.score[team] : 0} /></span>
        <span class="score-meta">
          <span class="pips" title={`Sets won: ${view.setsWon[team]}`}>
            {Array.from({ length: need }, (_, i) => <i key={i} class={i < view.setsWon[team] ? 'on' : ''} />)}
          </span>
          <span class="to-dots" title={`${toLeft} timeouts left`}>
            {Array.from({ length: match.rules.timeoutsPerSet }, (_, i) => <i key={i} class={i < toLeft ? 'on' : ''} />)}
          </span>
          <span class="subs-count" title="Substitutions used this set" data-testid={`subs-${team}`}>SUB {set ? set.subsUsed[team] : 0}/{match.rules.subsPerSet}</span>
        </span>
        {serving && <span class="serve-chip"><Ball size={14} /> SERVE</span>}
        {live && <span class="tap-hint">+1</span>}
      </button>
    );
  };
  return (
    <div class="scoreboard">
      {side('us')}
      <div class="score-mid">
        <span class="set-label">SET</span>
        <span class="set-num">{set ? set.n : 1}</span>
        <span class="set-target">to {set ? pointTarget(set.n, match.format, match.rules) : match.rules.setTarget}</span>
      </div>
      {side('opp')}
    </div>
  );
}

function MomentumStrip({ match, view, colors }) {
  const set = view.current;
  if (!set) return null;
  const rallies = set.rallies.slice(-14);
  const rep = teamReport(view, set.n);
  const run = rep.currentRun;
  const sp = view.setPoint;
  const isMatchPoint = sp && view.setsWon[sp] === view.need - 1;
  return (
    <div class="momentum">
      <div class="pills" aria-label="Last rallies">
        {rallies.map((r) => <i key={r.index} class={`pill p-${r.winner}`} style={{ '--tc': colors[r.winner] }} title={`${r.score.us}-${r.score.opp}`} />)}
        {!rallies.length && <span class="muted small">First serve: {match.teams[set.firstServer].name}</span>}
      </div>
      <div class="momentum-tags">
        {sp && view.phase === 'live' && <span class="tag tag-hot" style={{ '--tc': colors[sp] }}>{isMatchPoint ? 'MATCH POINT' : 'SET POINT'} · {match.teams[sp].name}</span>}
        {!sp && run && run.n >= 3 && <span class="tag" style={{ '--tc': colors[run.team] }}>{run.n}-0 run · {match.teams[run.team].name}</span>}
        {!sp && (!run || run.n < 3) && rep.rallies > 0 && <span class="tag tag-quiet">Side-out {fmtPct(rep.teams.us.sideoutPct)}</span>}
      </div>
    </div>
  );
}

function Dock({ match, view }) {
  const redo = useObservable(ui, (s) => s.redo.length);
  const last = match.events[match.events.length - 1];
  const live = view.phase === 'live';
  return (
    <nav class="dock" aria-label="Match actions">
      <button class="dock-btn" disabled={!canUndo()} onClick={undoLast} data-testid="undo" title={last ? `Undo: ${describeEvent(match, last)}` : 'Undo'}>
        <IconUndo /><span>Undo</span>
      </button>
      <button class="dock-btn" disabled={!redo} onClick={redoLast} data-testid="redo"><IconRedo /><span>Redo</span></button>
      <button class="dock-btn" disabled={!live} onClick={() => setUi({ sheet: { kind: 'timeout-pick' } })} data-testid="timeout"><IconTimer /><span>Timeout</span></button>
      <button class="dock-btn" onClick={() => setUi({ whiteboard: true })}><IconPen /><span>Board</span></button>
      <button class="dock-btn" onClick={() => setUi({ sheet: { kind: 'match-menu' } })} data-testid="match-menu"><IconFlag /><span>Match</span></button>
    </nav>
  );
}

function FeedPanel({ match, view, colors }) {
  const set = view.current;
  const rep = teamReport(view, set ? set.n : null);
  const events = match.events.slice(-9).reverse();
  const worst = [...rep.rotations].filter((r) => r.rallies).sort((a, b) => a.plusMinus - b.plusMinus)[0];
  return (
    <aside class="feed-panel">
      <div class="kpis">
        <Kpi label="Side-out" us={fmtPct(rep.teams.us.sideoutPct)} opp={fmtPct(rep.teams.opp.sideoutPct)} colors={colors} />
        <Kpi label="Point-score" us={fmtPct(rep.teams.us.servePct)} opp={fmtPct(rep.teams.opp.servePct)} colors={colors} />
        <Kpi label="Kills · Aces · Blocks" us={`${rep.teams.us.kills}·${rep.teams.us.aces}·${rep.teams.us.blocks}`} opp={`${rep.teams.opp.kills}·${rep.teams.opp.aces}·${rep.teams.opp.blocks}`} colors={colors} />
        <Kpi label="Errors given" us={rep.teams.us.errors} opp={rep.teams.opp.errors} colors={colors} />
      </div>
      <h4 class="panel-h">Rotations this set</h4>
      <RotationBars rotations={rep.rotations} color={colors.us} current={set ? set.rot.us % 6 : -1} />
      {worst && worst.plusMinus < 0 && <p class="insight"><IconSpark width="16" height="16" /> Rotation {worst.rotation} is {worst.plusMinus} this set.</p>}
      <h4 class="panel-h">Play by play</h4>
      <ol class="feed">
        {events.map((ev, i) => (
          <li key={match.events.length - i} class={`feed-item ev-${ev.type.replace('.', '-')}`} style={ev.winner ? { '--tc': colors[ev.winner] } : null}>
            {describeEvent(match, ev)}
          </li>
        ))}
      </ol>
    </aside>
  );
}

function Kpi({ label, us, opp, colors }) {
  return (
    <div class="kpi">
      <span class="kpi-label">{label}</span>
      <span class="kpi-vals"><b style={{ color: colors.us }}>{us}</b><b style={{ color: colors.opp }}>{opp}</b></span>
    </div>
  );
}

export function RotationBars({ rotations, color, current = -1 }) {
  const max = Math.max(3, ...rotations.map((r) => Math.abs(r.plusMinus)));
  return (
    <div class="rot-bars">
      {rotations.map((r, i) => (
        <div key={r.rotation} class={`rot-bar ${i === current ? 'current' : ''}`} title={`R${r.rotation}: ${r.won}-${r.lost}`}>
          <div class="rot-track">
            <span class={r.plusMinus >= 0 ? 'pos' : 'neg'} style={{ height: `${(Math.abs(r.plusMinus) / max) * 50}%`, '--tc': color }} />
          </div>
          <span class="rot-pm">{r.plusMinus > 0 ? '+' : ''}{r.plusMinus}</span>
          <span class="rot-name">R{r.rotation}</span>
        </div>
      ))}
    </div>
  );
}

function BetweenSets({ match, view, colors }) {
  const doc = useObservable(docStore);
  const last = view.current;
  const next = view.nextSetNumber;
  const needsToss = setRequiresToss(next, match.format);
  // Stage the finished set's lineup once, so the coach starts from what they just played.
  useEffect(() => {
    const staged = doc.setup.lineup.us;
    if (!staged.some(Boolean) || staged.some((id) => !playerById(match, 'us', id))) stageLineupFromSet(last);
  }, [last.n]);
  const start = () => setUi({ sheet: { kind: 'toss', set: next, mode: needsToss ? 'toss' : 'confirm' } });
  return (
    <div class="between">
      <div class="set-result" style={{ '--tc': colors[last.winner] }}>
        <span class="eyebrow">Set {last.n} {last.endedEarly ? 'ended' : 'won'}</span>
        <h2>{match.teams[last.winner].name}</h2>
        <p class="final-score"><span style={{ color: colors.us }}>{last.score.us}</span><span class="dash">–</span><span style={{ color: colors.opp }}>{last.score.opp}</span></p>
        <p class="muted small">Sets {view.setsWon.us}–{view.setsWon.opp}{next === decidingSetNumber(match.format) ? ' · next is the deciding set (coin toss)' : ''}</p>
      </div>
      <LineupEditor match={match} title={`Set ${next} lineup`} />
      <button class="btn primary xl" data-testid="start-next-set" onClick={start}>Start set {next}</button>
    </div>
  );
}

function Decided({ match, view, colors }) {
  const w = view.decided;
  const won = w === 'us';
  return (
    <div class={`decided ${won ? 'win' : 'loss'}`} style={{ '--tc': colors[w] }}>
      {won && <div class="confetti" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ '--i': i }} />)}</div>}
      <span class="eyebrow">Match {won ? 'won' : 'over'}</span>
      <h2>{match.teams[w].name}</h2>
      <p class="final-score big"><span style={{ color: colors.us }}>{view.setsWon.us}</span><span class="dash">–</span><span style={{ color: colors.opp }}>{view.setsWon.opp}</span></p>
      <div class="set-chips">
        {view.sets.map((s) => <span key={s.n} class="set-chip"><b>S{s.n}</b> {s.score.us}–{s.score.opp}</span>)}
      </div>
      <div class="row gap">
        <button class="btn primary xl" data-testid="finish-match" onClick={finishMatch}>Save to history</button>
        <button class="btn ghost xl" onClick={() => setUi({ tab: 'stats' })}><IconStats /> Box score</button>
      </div>
      <p class="muted small">Undo is still available if the last point was entered by mistake.</p>
    </div>
  );
}

export function LiveScreen() {
  const doc = useObservable(docStore);
  const theme = doc.settings.theme;
  const match = doc.match;
  const colors = useTeamColors(match, theme);
  if (!match) return <MatchSetup />;
  const view = matchView(doc);
  const set = view.current;
  const entries = set ? liveEntries(match, set) : { us: [], opp: [] };
  const onTap = (team, zone) => {
    if (view.phase !== 'live') return;
    haptic(6);
    setUi({ sheet: { kind: 'player', team, zone } });
  };
  return (
    <div class={`live phase-${view.phase}`}>
      <div class="live-main">
        <Scoreboard match={match} view={view} colors={colors} />
        {view.phase === 'live' && (
          <>
            <MomentumStrip match={match} view={view} colors={colors} />
            <Court entries={entries} colors={colors} serving={set.serving} onTap={onTap} />
          </>
        )}
        {view.phase === 'between' && <BetweenSets match={match} view={view} colors={colors} />}
        {view.phase === 'decided' && <Decided match={match} view={view} colors={colors} />}
        {view.phase === 'ended' && (
          <div class="between"><button class="btn primary xl" onClick={finishMatch}>Save to history</button></div>
        )}
      </div>
      {set && <FeedPanel match={match} view={view} colors={colors} />}
      <Dock match={match} view={view} />
    </div>
  );
}

/** Sheet: end set early / end match / discard. */
export function MatchMenu({ onClose }) {
  const doc = docStore.get();
  const view = matchView(doc);
  const endSet = async () => {
    const ok = await confirmDialog({ title: 'End this set now?', message: 'The team that is ahead wins the set. Use this for a forfeit or a shortened practice set.', confirm: 'End set', danger: true });
    if (ok) { run('endSet'); onClose(); }
  };
  const endMatch = async () => {
    const ok = view.phase === 'decided' || await confirmDialog({ title: 'End the match and save it?', message: 'The match is filed in History with the sets played so far.', confirm: 'End match', danger: true });
    if (ok) finishMatch();
  };
  const discard = async () => {
    const ok = await confirmDialog({ title: 'Discard this match?', message: 'It will not be saved to History. This cannot be undone.', confirm: 'Discard', danger: true, force: true });
    if (ok) { discardMatch(); onClose(); }
  };
  return (
    <div class="menu-list">
      <button class="menu-item" disabled={view.phase !== 'live'} onClick={endSet}><IconFlag /> End set early</button>
      <button class="menu-item" data-testid="end-match" onClick={endMatch}><IconFlag /> End match and save</button>
      <button class="menu-item danger" onClick={discard}><IconFlag /> Discard match</button>
    </div>
  );
}
