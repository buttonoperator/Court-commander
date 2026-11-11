// Sheets used during a live set: rally annotation, player actions (subs / libero), timeouts.
import { useEffect, useState } from 'preact/hooks';
import { docStore, ui, useObservable, matchView, run, setUi, haptic } from '../store.js';
import { playerById, benchOf, substitutionError, liberoInError, onCourt } from '../../core/engine.js';
import { isFrontRow, other } from '../../core/rules.js';
import { byJersey, shortName } from '../../core/roster.js';
import { boxScore, teamReport, fmtPct } from '../../core/stats.js';
import { useTeamColors, RotationBars } from './Live.jsx';
import { Sheet } from './primitives.jsx';

function PlayerGrid({ ids, team, match, color, onPick, exclude = [], skipLabel = 'Skip', onSkip }) {
  const players = ids.map((id) => playerById(match, team, id)).filter((p) => p && !exclude.includes(p.id));
  return (
    <div class="pgrid">
      {players.map((p) => (
        <button key={p.id} class="pbtn" style={{ '--tc': color }} data-player={p.id} onClick={() => onPick(p.id)}>
          <b>{p.jersey || '–'}</b><span>{p.generic ? p.name : shortName(p.name)}</span>
        </button>
      ))}
      {onSkip && <button class="pbtn skip" onClick={onSkip}>{skipLabel}</button>}
    </div>
  );
}

/**
 * After a +1 tap the point is already on the board. This sheet only describes it, by amending the
 * rally in place: Kill / Ace / Block for the winner, or an error by the loser, plus the players involved.
 */
export function RallySheet({ winner, onClose }) {
  const doc = useObservable(docStore);
  const match = doc.match;
  const view = matchView(doc);
  const colors = useTeamColors(match, doc.settings.theme);
  const [step, setStep] = useState('how');
  const [draft, setDraft] = useState({});
  const set = view && view.sets[view.sets.length - 1];
  const rally = set && set.rallies[set.rallies.length - 1];
  useEffect(() => { if (!rally || rally.winner !== winner) onClose(); }, [rally && rally.index, set && set.n]);
  if (!rally) return null;
  const loser = other(winner);
  const trackOpp = match.trackOppPlayers && !match.teams.opp.generic;
  const canPick = (team) => team === 'us' || trackOpp;
  const name = (t) => match.teams[t].name;
  const commit = (args, close = true) => {
    run('amendRally', args, { quiet: true });
    if (close) { haptic(8); onClose(); }
  };
  const pick = (team, title, onPick, opts = {}) => ({ team, title, onPick, ...opts });

  let body;
  let title = `Point ${name(winner)}`;
  let subtitle = `${rally.score.us}–${rally.score.opp} · how was it won?`;
  if (step === 'how') {
    const servedByWinner = rally.servingTeam === winner;
    body = (
      <div class="how-grid">
        <button class="how" data-code="K" onClick={() => { setDraft({ code: 'K' }); if (canPick(winner)) setStep('actor'); else commit({ code: 'K' }); }}><b>Kill</b><small>attack winner</small></button>
        <button class="how" data-code="ACE" disabled={!servedByWinner} onClick={() => { commit({ code: 'ACE' }, false); setDraft({ code: 'ACE' }); if (canPick(loser)) setStep('victim'); else onClose(); }}><b>Ace</b><small>{servedByWinner ? 'serve winner' : 'they were receiving'}</small></button>
        <button class="how" data-code="BLK" onClick={() => { setDraft({ code: 'BLK' }); if (canPick(winner)) setStep('actor'); else if (canPick(loser)) setStep('victim'); else commit({ code: 'BLK' }); }}><b>Block</b><small>stuff block</small></button>
        <button class="how err" data-code="ERR" onClick={() => setStep('error')}><b>{loser === 'us' ? 'Our error' : 'Their error'}</b><small>{name(loser)} gave it away</small></button>
        <button class="how ghost" data-code="SKIP" onClick={onClose}><b>Skip</b><small>just the point</small></button>
      </div>
    );
  } else if (step === 'error') {
    subtitle = `${name(loser)} error · which kind?`;
    const servedByLoser = rally.servingTeam === loser;
    const kinds = [
      ['SE', 'Service error', servedByLoser], ['E', 'Attack error', true], ['RE', 'Reception error', !servedByLoser],
      ['BHE', 'Ball handling', true], ['NET', 'Net / violation', true],
    ];
    body = (
      <div class="how-grid">
        {kinds.map(([code, label, ok]) => (
          <button key={code} class="how err" data-code={code} disabled={!ok} onClick={() => {
            if (code === 'SE' || !canPick(loser)) commit({ code });
            else { setDraft({ code }); setStep('actor-loser'); }
          }}><b>{label}</b></button>
        ))}
      </div>
    );
  } else {
    const spec = {
      actor: pick(winner, draft.code === 'K' ? 'Who got the kill?' : 'Who blocked it?', (id) => {
        if (draft.code === 'K' && winner === 'us') { setDraft({ ...draft, actor: id }); commit({ ...draft, actor: id }, false); setStep('assist'); }
        else if (draft.code === 'BLK' && canPick(loser)) { setDraft({ ...draft, actor: id }); commit({ ...draft, actor: id }, false); setStep('victim'); }
        else commit({ ...draft, actor: id });
      }),
      assist: pick(winner, 'Who set it? (assist)', (id) => commit({ ...draft, assist: id }), { exclude: [draft.actor], skipLabel: 'No assist' }),
      victim: pick(loser, draft.code === 'ACE' ? 'Who was aced?' : 'Who was blocked?', (id) => commit({ ...draft, victim: id })),
      'actor-loser': pick(loser, 'Who made the error?', (id) => commit({ ...draft, actor: id })),
    }[step];
    subtitle = spec.title;
    body = <PlayerGrid ids={rally.onCourt[spec.team]} team={spec.team} match={match} color={colors[spec.team]} onPick={spec.onPick} exclude={spec.exclude || []} skipLabel={spec.skipLabel || 'Skip'} onSkip={() => (step === 'assist' || step === 'victim' ? onClose() : commit(draft))} />;
  }
  return (
    <Sheet title={title} subtitle={subtitle} onClose={onClose} accent={colors[winner]} id="rally-sheet">
      {body}
    </Sheet>
  );
}

/** Tap on a court player: substitution with rule checks, libero in/out, and the player's numbers. */
export function PlayerSheet({ team, zone, onClose }) {
  const doc = useObservable(docStore);
  const match = doc.match;
  const view = matchView(doc);
  const colors = useTeamColors(match, doc.settings.theme);
  if (!view || view.phase !== 'live') return null;
  const set = view.current;
  const id = onCourt(set, team)[zone];
  const p = playerById(match, team, id);
  if (!p) return null;
  const lib = set.libero[team];
  const isLib = lib && lib.id === id;
  const bench = benchOf(match, set, team).sort(byJersey);
  const box = boxScore(match, view, set.n)[team].rows.find((r) => r.player.id === id);
  const s = box ? box.stats : null;
  const doSub = (incoming) => { const r = run('sub', { team, zone, in: incoming }); if (r.ok) { haptic([10, 20, 10]); onClose(); } };
  const libErr = isLib ? null : liberoInError(match, view, { team, zone });
  const libPlayer = set.liberoId[team] && playerById(match, team, set.liberoId[team]);
  return (
    <Sheet title={`${p.jersey ? '#' + p.jersey + ' ' : ''}${p.name}`} subtitle={`${match.teams[team].name} · zone ${zone + 1}${isFrontRow(zone) ? ' · front row' : ' · back row'}${zone === 0 && set.serving === team ? ' · serving' : ''}`} onClose={onClose} accent={colors[team]} id="player-sheet">
      {s && (
        <div class="mini-stats">
          {[['K', s.K], ['E', s.E], ['SA', s.SA], ['SE', s.SE], ['BS', s.BS], ['+/-', s.PM > 0 ? `+${s.PM}` : s.PM]].map(([k, v]) => <span key={k}><b>{v}</b><small>{k}</small></span>)}
        </div>
      )}
      {isLib && <button class="btn primary block" data-testid="libero-out" onClick={() => { if (run('liberoOut', { team }).ok) onClose(); }}>Libero out · {playerById(match, team, lib.replaced)?.name} returns</button>}
      {!isLib && libPlayer && !lib && (
        <button class="btn accent block" data-testid="libero-in" disabled={Boolean(libErr)} onClick={() => { if (run('liberoIn', { team, zone }).ok) onClose(); }}>
          Libero in · #{libPlayer.jersey} {libPlayer.name}{libErr ? ` (${isFrontRow(zone) ? 'front row' : 'unavailable'})` : ''}
        </button>
      )}
      {!isLib && !p.generic && (
        <>
          <h4 class="step-h">Substitute <span class="muted small">{set.subsUsed[team]}/{match.rules.subsPerSet} used</span></h4>
          {bench.length === 0 && <p class="muted">No bench players available.</p>}
          <div class="bench-list">
            {bench.map((b) => {
              const err = substitutionError(match, view, { team, zone, in: b.id });
              return (
                <button key={b.id} class="bench-row" disabled={Boolean(err)} data-player={b.id} onClick={() => doSub(b.id)} title={err || ''}>
                  <b class="bench-num" style={{ '--tc': colors[team] }}>{b.jersey || '–'}</b>
                  <span class="bench-name">{b.name}<small>{err || (b.roles || []).join(' · ') || 'Eligible'}</small></span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}

export function TimeoutPick({ onClose }) {
  const doc = useObservable(docStore);
  const match = doc.match;
  const view = matchView(doc);
  const colors = useTeamColors(match, doc.settings.theme);
  if (!view || !view.current) return null;
  const call = (team) => {
    if (run('timeout', { team }).ok) {
      haptic([30, 30, 30]);
      setUi({ sheet: null, timeout: { team, endsAt: Date.now() + match.rules.timeoutSeconds * 1000, set: view.current.n } });
    }
  };
  return (
    <Sheet title="Timeout" subtitle="Who called it?" onClose={onClose}>
      <div class="big-choice">
        {['us', 'opp'].map((t) => {
          const left = match.rules.timeoutsPerSet - view.current.timeoutsUsed[t];
          return (
            <button key={t} class="choice" style={{ '--tc': colors[t] }} disabled={left <= 0} data-testid={`timeout-${t}`} onClick={() => call(t)}>
              <span>{match.teams[t].name}</span><small>{left} left</small>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/** Full-screen timeout clock with the numbers a coach wants in 60 seconds. */
export function TimeoutOverlay() {
  const t = useObservable(ui, (s) => s.timeout);
  const doc = useObservable(docStore);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!t) return undefined;
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, [t]);
  const match = doc.match;
  const colors = useTeamColors(match, doc.settings.theme);
  if (!t || !match) return null;
  const view = matchView(doc);
  const total = match.rules.timeoutSeconds * 1000;
  const left = Math.max(0, t.endsAt - now);
  if (left === 0 && now - t.endsAt > 4000) { setTimeout(() => setUi({ timeout: null }), 0); }
  const rep = teamReport(view, t.set);
  const frac = left / total;
  const R = 70;
  const C = 2 * Math.PI * R;
  return (
    <div class="timeout-layer" role="dialog" aria-label="Timeout">
      <div class="timeout-card" style={{ '--tc': colors[t.team] }}>
        <span class="eyebrow">Timeout · {match.teams[t.team].name}</span>
        <svg class="ring" viewBox="0 0 160 160" width="180" height="180">
          <circle cx="80" cy="80" r={R} class="ring-bg" />
          <circle cx="80" cy="80" r={R} class="ring-fg" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }} />
          <text x="80" y="92" text-anchor="middle" class="ring-text">{Math.ceil(left / 1000)}</text>
        </svg>
        <div class="to-insights">
          <div><small>Score</small><b>{view.current.score.us}–{view.current.score.opp}</b></div>
          <div><small>Our side-out</small><b>{fmtPct(rep.teams.us.sideoutPct)}</b></div>
          <div><small>Their side-out</small><b>{fmtPct(rep.teams.opp.sideoutPct)}</b></div>
          <div><small>Errors given</small><b>{rep.teams.us.errors}</b></div>
        </div>
        <RotationBars rotations={rep.rotations} color={colors.us} current={view.current.rot.us % 6} />
        <button class="btn primary block" onClick={() => setUi({ timeout: null })}>Resume play</button>
      </div>
    </div>
  );
}
