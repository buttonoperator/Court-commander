// Pre-match setup, the shared lineup editor and the coin toss / first-serve sheet.
import { useState } from 'preact/hooks';
import { docStore, useObservable, updateDoc, setUi, startMatch, startNextSet, matchView, toast } from '../store.js';
import { emptyLineup } from '../../core/model.js';
import { byJersey, shortName } from '../../core/roster.js';
import { decidingSetNumber, other } from '../../core/rules.js';
import { scheduledFirstServer } from '../../core/engine.js';
import { displayColor, separateColors } from '../color.js';
import { Court } from './Court.jsx';
import { Segmented, TeamBadge } from './primitives.jsx';
import { IconCoin, IconTrash, IconSpark, IconChevron } from './icons.jsx';

/** Rosters for lineup editing: the live match snapshot when one exists, otherwise the selected teams. */
export function lineupContext(doc, match) {
  if (match) return { us: match.teams.us, opp: match.teams.opp, generic: match.teams.opp.generic };
  const us = doc.teams.find((t) => t.id === doc.selection.usId) || { name: 'Our team', color: '#d6222c', players: [] };
  const opp = doc.teams.find((t) => t.id === doc.selection.oppId) || null;
  return { us, opp: opp || { name: 'Opponent', color: '#64748b', players: [] }, generic: !opp || opp.players.length < 6 };
}

const setLineup = (team, slots) => updateDoc((d) => ({ ...d, setup: { ...d.setup, lineup: { ...d.setup.lineup, [team]: slots } } }));
/** Loads a saved lineup (starting six, libero, planned subs) into the staging area. */
export function applyPreset(p, players) {
  const known = (id) => players.some((x) => x.id === id);
  updateDoc((d) => ({
    ...d,
    setup: {
      ...d.setup,
      lineup: { ...d.setup.lineup, us: p.slots.map((id) => (known(id) ? id : null)) },
      libero: { ...d.setup.libero, us: p.libero && known(p.libero) ? p.libero : d.setup.libero.us },
      plannedSubs: { ...d.setup.plannedSubs, us: (p.plannedSubs || []).filter((x) => known(x.in)) },
    },
  }));
}
const setLibero = (team, id) => updateDoc((d) => ({ ...d, setup: { ...d.setup, libero: { ...d.setup.libero, [team]: id } } }));

/** First six non-liberos by jersey: a sensible default the coach then adjusts. */
function autoFill(players) {
  const pool = [...players].filter((p) => !p.libero).sort(byJersey).slice(0, 6);
  return Array.from({ length: 6 }, (_, i) => (pool[i] ? pool[i].id : null));
}

export function LineupEditor({ match = null, title = 'Starting lineups' }) {
  const doc = useObservable(docStore);
  const ctx = lineupContext(doc, match);
  const theme = doc.settings.theme;
  const colors = { us: displayColor(ctx.us.color, theme), opp: displayColor(separateColors(ctx.us.color, ctx.opp.color), theme) };
  const lineup = doc.setup.lineup;
  const entry = (team, id) => {
    const p = id && ctx[team].players.find((x) => x.id === id);
    return p ? { ...p } : { empty: true };
  };
  const entries = {
    us: lineup.us.map((id) => entry('us', id)),
    opp: ctx.generic ? Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, name: `Server ${i + 1}`, generic: true, jersey: '' })) : lineup.opp.map((id) => entry('opp', id)),
  };
  const presets = doc.presets.filter((p) => ctx.us.id && p.teamId === (match ? match.teams.us.teamId : ctx.us.id));
  const liberos = (team) => ctx[team].players.filter((p) => p.libero && !lineup[team].includes(p.id));
  const onTap = (team, zone) => {
    if (team === 'opp' && ctx.generic) return;
    setUi({ sheet: { kind: 'pick-player', team, zone, matchMode: Boolean(match) } });
  };
  const complete = (team) => lineup[team].every(Boolean);
  return (
    <section class="card lineup-editor">
      <header class="card-head">
        <h3>{title}</h3>
        <div class="row gap-s">
          {presets.length > 0 && (
            <select class="select" aria-label="Load saved lineup" onChange={(e) => {
              const p = presets.find((x) => x.id === e.currentTarget.value);
              if (p) applyPreset(p, ctx.us.players);
              e.currentTarget.value = '';
            }}>
              <option value="">Saved lineups…</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button class="btn ghost sm" data-testid="autofill" onClick={() => { setLineup('us', autoFill(ctx.us.players)); if (!ctx.generic) setLineup('opp', autoFill(ctx.opp.players)); }}><IconSpark width="16" height="16" /> Auto-fill</button>
          <button class="btn ghost sm" aria-label="Clear lineups" onClick={() => updateDoc((d) => ({ ...d, setup: { ...d.setup, lineup: emptyLineup() } }))}><IconTrash width="16" height="16" /></button>
        </div>
      </header>
      <p class="muted small">Tap a position to place a player. Zone 1 (right back, with the ball) serves first.</p>
      <Court entries={entries} colors={colors} serving={null} onTap={onTap} compact labels={{ us: entries.us.map((e, z) => (e.empty ? null : `Z${z + 1}`)), opp: null }} />
      <div class="lineup-status">
        <span class={`status-dot ${complete('us') ? 'ok' : ''}`}>{ctx.us.name}: {lineup.us.filter(Boolean).length}/6</span>
        <span class={`status-dot ${ctx.generic || complete('opp') ? 'ok' : ''}`}>{ctx.opp.name}: {ctx.generic ? 'serve order only' : `${lineup.opp.filter(Boolean).length}/6`}</span>
      </div>
      {['us', 'opp'].map((team) => (team === 'opp' && ctx.generic) || !ctx[team].players.some((p) => p.libero) ? null : (
        <div class="libero-pick" key={team}>
          <span class="label">{team === 'us' ? ctx.us.name : ctx.opp.name} libero</span>
          <div class="chips">
            <button class={`chip ${!doc.setup.libero[team] ? 'on' : ''}`} onClick={() => setLibero(team, null)}>None</button>
            {liberos(team).map((p) => (
              <button key={p.id} class={`chip ${doc.setup.libero[team] === p.id ? 'on' : ''}`} onClick={() => setLibero(team, p.id)}>#{p.jersey} {shortName(p.name)}</button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

/** Sheet body: choose the player for one zone of the staged lineup. */
export function PickPlayer({ team, zone, matchMode, onClose }) {
  const doc = useObservable(docStore);
  const ctx = lineupContext(doc, matchMode ? doc.match : null);
  const lineup = doc.setup.lineup[team];
  const players = [...ctx[team].players].sort(byJersey);
  const place = (id) => {
    const next = [...lineup];
    const from = next.indexOf(id);
    if (from >= 0) next[from] = next[zone]; // swap when the player is already placed
    next[zone] = id;
    setLineup(team, next);
    if (doc.setup.libero[team] === id) setLibero(team, null);
    onClose();
  };
  return (
    <div class="pick-grid">
      {players.map((p) => {
        const at = lineup.indexOf(p.id);
        return (
          <button key={p.id} class={`pick ${at === zone ? 'on' : ''}`} data-player={p.id} onClick={() => place(p.id)}>
            <span class="pick-num" style={{ '--tc': displayColor(ctx[team].color, doc.settings.theme) }}>{p.jersey || '–'}</span>
            <span class="pick-name">{p.name}</span>
            <span class="pick-meta">{p.libero ? 'Libero' : (p.roles || []).join(' · ')}{at >= 0 && at !== zone ? ` · in Z${at + 1} (swap)` : ''}</span>
          </button>
        );
      })}
      {lineup[zone] && <button class="pick clear" onClick={() => { const n = [...lineup]; n[zone] = null; setLineup(team, n); onClose(); }}>Clear zone {zone + 1}</button>}
    </div>
  );
}

/** Coin toss (set 1 and the deciding set) or first-serve confirmation (other sets), then start. */
export function TossSheet({ set, mode, onClose }) {
  const doc = useObservable(docStore);
  const match = doc.match;
  const ctx = lineupContext(doc, match);
  const names = { us: ctx.us.name, opp: ctx.opp.name };
  const [winner, setWinner] = useState(null);
  const [choice, setChoice] = useState(null);
  const venue = match ? match.venue : doc.setup.venue || 'home';
  const homeTeam = venue === 'home' ? 'us' : 'opp';
  const caller = set === 1 ? other(homeTeam) : homeTeam;
  const format = match ? match.format : doc.setup.format;
  const go = (args) => {
    const r = match ? startNextSet(args) : startMatch(args);
    if (r && r.ok) { onClose(); setUi({ tab: 'live' }); }
  };
  if (mode === 'confirm') {
    const view = matchView(doc);
    const first = scheduledFirstServer(match, view, set);
    return (
      <div class="toss">
        <p class="toss-rule">Serve alternates each set (NFHS 5-4). <b>{names[first]}</b> serves first in set {set}.</p>
        <button class="btn primary xl" data-testid="confirm-start" onClick={() => go({})}>Start set {set}</button>
      </div>
    );
  }
  return (
    <div class="toss">
      <p class="toss-rule" id="toss-rule">
        {set === 1 ? 'Pre-match toss' : `Deciding set ${set}`}: the {set === 1 ? 'visiting' : 'home'} captain (<b>{names[caller]}</b>) calls it.
      </p>
      <h4 class="step-h">1 · Who won the toss?</h4>
      <div class="big-choice">
        {['us', 'opp'].map((t) => (
          <button key={t} class={`choice ${winner === t ? 'on' : ''}`} data-testid={`toss-winner-${t}`} onClick={() => { setWinner(t); setChoice(null); }}>
            <TeamBadge name={names[t]} color={displayColor(t === 'us' ? ctx.us.color : ctx.opp.color, doc.settings.theme)} />
            <span>{names[t]}</span>
          </button>
        ))}
      </div>
      {winner && (
        <>
          <h4 class="step-h">2 · {names[winner]} chose</h4>
          <Segmented value={choice} onChange={setChoice} label="Toss choice" options={[{ value: 'serve', label: 'Serve' }, { value: 'receive', label: 'Receive' }, { value: 'side', label: 'Side of court' }]} />
        </>
      )}
      {winner && choice === 'side' && (
        <>
          <h4 class="step-h">3 · {names[other(winner)]} picks serve or receive. Who serves first?</h4>
          <div class="big-choice">
            {['us', 'opp'].map((t) => (
              <button key={t} class="choice" data-testid={`first-server-${t}`} onClick={() => go({ toss: { winner, choice }, firstServer: t })}><IconCoin /> {names[t]} serves</button>
            ))}
          </div>
        </>
      )}
      {winner && (choice === 'serve' || choice === 'receive') && (
        <button class="btn primary xl" data-testid="confirm-start" onClick={() => go({ toss: { winner, choice } })}>
          Start {set === 1 ? 'match' : `set ${set}`} · {names[choice === 'serve' ? winner : other(winner)]} serves
        </button>
      )}
      {format > 1 && set === 1 && <p class="muted small">A second toss is held before set {decidingSetNumber(format)} if the match gets there.</p>}
    </div>
  );
}

export function MatchSetup() {
  const doc = useObservable(docStore);
  const [query, setQuery] = useState('');
  const us = doc.teams.find((t) => t.id === doc.selection.usId);
  const ourTeams = doc.teams.filter((t) => t.side === 'us');
  const opps = doc.teams.filter((t) => t.side === 'opp' && t.name.toLowerCase().includes(query.trim().toLowerCase()));
  const opp = doc.teams.find((t) => t.id === doc.selection.oppId) || null;
  const theme = doc.settings.theme;
  const select = (patch) => updateDoc((d) => ({ ...d, selection: { ...d.selection, ...patch }, setup: { ...d.setup, lineup: { ...d.setup.lineup, ...(patch.oppId !== undefined ? { opp: emptyLineup().opp } : {}), ...(patch.usId !== undefined ? { us: emptyLineup().us } : {}) }, libero: { us: patch.usId !== undefined ? null : d.setup.libero.us, opp: patch.oppId !== undefined ? null : d.setup.libero.opp }, plannedSubs: { us: patch.usId !== undefined ? [] : d.setup.plannedSubs.us, opp: patch.oppId !== undefined ? [] : d.setup.plannedSubs.opp } } }));
  const setSetup = (patch) => updateDoc((d) => ({ ...d, setup: { ...d.setup, ...patch } }));
  const begin = () => {
    if (!doc.setup.venue) { toast('Choose Home or Away first. It decides who calls the coin toss.', { tone: 'warn' }); return; }
    if (!doc.setup.lineup.us.every(Boolean)) { toast(`Place six ${us ? us.name : 'players'} on the court.`, { tone: 'warn' }); return; }
    if (opp && opp.players.length >= 6 && !doc.setup.lineup.opp.every(Boolean)) { toast(`Place six ${opp.name} players on the court, or use Auto-fill.`, { tone: 'warn' }); return; }
    setUi({ sheet: { kind: 'toss', set: 1, mode: 'toss' } });
  };
  return (
    <div class="setup">
      <section class="hero">
        <div class="hero-teams">
          <TeamBadge name={us ? us.name : 'Us'} color={displayColor(us ? us.color : '#d6222c', theme)} size={56} />
          <span class="vs">VS</span>
          <TeamBadge name={opp ? opp.name : '?'} color={displayColor(opp ? opp.color : '#64748b', theme)} size={56} />
        </div>
        <span class="eyebrow">New match · {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
        <h1 class="hero-title">{us ? us.name : 'Your team'} <span class="muted">vs</span> {opp ? opp.name : 'Opponent'}</h1>
      </section>

      {ourTeams.length > 1 && (
        <section class="card">
          <header class="card-head"><h3>Your team</h3></header>
          <div class="chips">
            {ourTeams.map((t) => <button key={t.id} class={`chip ${t.id === doc.selection.usId ? 'on' : ''}`} onClick={() => select({ usId: t.id })}>{t.name} <small>{t.players.length}</small></button>)}
          </div>
        </section>
      )}

      <section class="card">
        <header class="card-head">
          <h3>Opponent</h3>
          <input class="input search" type="search" placeholder="Search teams" value={query} onInput={(e) => setQuery(e.currentTarget.value)} aria-label="Search opponents" />
        </header>
        <div class="team-grid" role="listbox" aria-label="Opponents">
          {opps.map((t) => (
            <button key={t.id} role="option" aria-selected={t.id === doc.selection.oppId} class={`team-card ${t.id === doc.selection.oppId ? 'on' : ''}`} style={{ '--tc': displayColor(t.color, theme) }} onClick={() => select({ oppId: t.id })} data-team={t.name}>
              <TeamBadge name={t.name} color={displayColor(t.color, theme)} />
              <span class="tc-name">{t.name}</span>
              <span class="tc-meta">{t.players.length} players</span>
            </button>
          ))}
          <button class={`team-card ghost ${!doc.selection.oppId ? 'on' : ''}`} onClick={() => select({ oppId: null })} data-team="unlisted">
            <TeamBadge name="? ?" color="#64748b" />
            <span class="tc-name">Unlisted opponent</span>
            <span class="tc-meta">No roster · serve order only</span>
          </button>
        </div>
      </section>

      <section class="card grid-2">
        <div>
          <h3 class="field-h">Venue for {us ? us.name : 'us'}</h3>
          <Segmented value={doc.setup.venue} onChange={(v) => setSetup({ venue: v })} label="Venue" options={[{ value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }]} />
        </div>
        <div>
          <h3 class="field-h">Format</h3>
          <Segmented value={doc.setup.format} onChange={(v) => setSetup({ format: v })} label="Match format" options={[{ value: 1, label: '1 set' }, { value: 3, label: 'Best of 3' }, { value: 5, label: 'Best of 5' }]} />
        </div>
      </section>

      <LineupEditor />

      <div class="setup-cta">
        <button class="btn primary xl" data-testid="begin-match" onClick={begin}><IconCoin /> Coin toss & start <IconChevron /></button>
      </div>
    </div>
  );
}

