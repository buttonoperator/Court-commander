// Lineups and rotation planner: both teams through all six rotations, planned substitutions for
// either team (checked against the same NFHS rules as the live match), setter tracking, notes, live +/-.
import { docStore, useObservable, updateDoc, promptDialog, confirmDialog, toast, matchView, setUi } from '../store.js';
import { uid, cleanText, shortName, byJersey } from '../../core/roster.js';
import { isFrontRow, NFHS } from '../../core/rules.js';
import { teamReport } from '../../core/stats.js';
import { planRotations, plannedSubError, setPlannedSub, prunePlannedSubs } from '../../core/plan.js';
import { displayColor, separateColors } from '../color.js';
import { Court } from './Court.jsx';
import { LineupEditor, lineupContext, applyPreset } from './Setup.jsx';
import { Sheet } from './primitives.jsx';
import { IconTrash, IconSwap, IconX } from './icons.jsx';

const TEAMS = ['us', 'opp'];

/** Everything the planner and its sheet need, derived from the document. */
function usePlan() {
  const doc = useObservable(docStore);
  const ctx = lineupContext(doc, doc.match);
  const rules = doc.match ? doc.match.rules : { ...NFHS, ...doc.settings.rules };
  const base = doc.setup.lineup;
  const subs = {};
  for (const t of TEAMS) subs[t] = prunePlannedSubs(base[t], doc.setup.plannedSubs[t] || [], ctx[t].players.map((p) => p.id));
  const plannable = { us: true, opp: !ctx.generic };
  return { doc, ctx, rules, base, subs, plannable };
}

const writeSubs = (team, list) => updateDoc((d) => ({ ...d, setup: { ...d.setup, plannedSubs: { ...d.setup.plannedSubs, [team]: list } } }));

/** Sheet: choose who subs into one zone before one rotation. */
export function PlanSubSheet({ team, rotation, zone, onClose }) {
  const { doc, ctx, rules, base, subs } = usePlan();
  const theme = doc.settings.theme;
  const rot = planRotations(base[team], subs[team])[rotation];
  const slot = (zone + rotation) % 6;
  const current = rot.zones[zone];
  const planned = subs[team].find((s) => s.rotation === rotation && s.slot === slot);
  const name = (id) => { const p = ctx[team].players.find((x) => x.id === id); return p ? `${p.jersey ? '#' + p.jersey + ' ' : ''}${p.name}` : 'Player'; };
  const color = displayColor(team === 'us' ? ctx.us.color : separateColors(ctx.us.color, ctx.opp.color), theme);
  const pick = (id) => {
    const err = plannedSubError({ base: base[team], subs: subs[team], rotation, slot, incoming: id, liberoId: doc.setup.libero[team], rules, nameOf: name });
    if (err) { toast(err, { tone: 'warn' }); return; }
    writeSubs(team, setPlannedSub(base[team], subs[team], { rotation, slot, incoming: id }));
    onClose();
  };
  const players = [...ctx[team].players].sort(byJersey);
  return (
    <Sheet title={`Rotation ${rotation + 1} · zone ${zone + 1}`} subtitle={`${ctx[team].name} · planned sub for ${name(current)}`} onClose={onClose} accent={color} id="plan-sub-sheet">
      {planned && (
        <button class="btn ghost block danger-text" data-testid="remove-planned-sub" onClick={() => { writeSubs(team, subs[team].filter((s) => s !== planned)); onClose(); }}>
          <IconX width="16" height="16" /> Remove planned sub ({name(planned.in)} in)
        </button>
      )}
      <div class="bench-list">
        {players.filter((p) => p.id !== current).map((p) => {
          const err = plannedSubError({ base: base[team], subs: subs[team], rotation, slot, incoming: p.id, liberoId: doc.setup.libero[team], rules, nameOf: name });
          return (
            <button key={p.id} class="bench-row" data-player={p.id} disabled={Boolean(err)} onClick={() => pick(p.id)} title={err || ''}>
              <b class="bench-num" style={{ '--tc': color }}>{p.jersey || '–'}</b>
              <span class="bench-name">{p.name}<small>{err || (p.roles || []).join(' · ') || 'Eligible'}</small></span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

export function PlannerScreen() {
  const { doc, ctx, rules, base, subs, plannable } = usePlan();
  const theme = doc.settings.theme;
  const colors = { us: displayColor(ctx.us.color, theme), opp: displayColor(separateColors(ctx.us.color, ctx.opp.color), theme) };
  const teamId = doc.match ? doc.match.teams.us.teamId : ctx.us.id;
  const byId = (team, id) => ctx[team].players.find((p) => p.id === id) || null;
  const label = (team, id) => { const p = byId(team, id); return p ? `${p.jersey ? '#' + p.jersey + ' ' : ''}${shortName(p.name)}` : '?'; };
  const notesKey = teamId || 'default';
  const notes = (doc.planner[notesKey] && doc.planner[notesKey].notes) || ['', '', '', '', '', ''];
  const setNote = (r, text) => updateDoc((d) => {
    const next = [...((d.planner[notesKey] && d.planner[notesKey].notes) || ['', '', '', '', '', ''])];
    next[r] = text;
    return { ...d, planner: { ...d.planner, [notesKey]: { notes: next } } };
  });
  const view = doc.match ? matchView(doc) : null;
  const rep = view && view.sets.length ? teamReport(view) : null;
  const presets = doc.presets.filter((p) => p.teamId === teamId);
  const savePreset = async () => {
    if (!base.us.every(Boolean)) { toast('Place all six players before saving the lineup.', { tone: 'warn' }); return; }
    const name = cleanText(await promptDialog({ title: 'Save lineup', message: 'Saves the starting six, the libero and the planned subs for your team.', placeholder: 'e.g. 5-1 base', confirm: 'Save' }));
    if (!name) return;
    updateDoc((d) => ({ ...d, presets: [...d.presets.filter((p) => !(p.teamId === teamId && p.name === name)), { id: uid('lp'), teamId, name, slots: [...base.us], libero: d.setup.libero.us, plannedSubs: subs.us }] }));
    toast(`Saved "${name}"`, { tone: 'success' });
  };
  const ready = { us: base.us.every(Boolean), opp: ctx.generic || base.opp.every(Boolean) };
  const rotations = {
    us: ready.us ? planRotations(base.us, subs.us) : null,
    opp: ctx.generic ? null : ready.opp ? planRotations(base.opp, subs.opp) : null,
  };
  const generic = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, name: `Server ${i + 1}`, generic: true, jersey: '' }));
  const entriesFor = (team, r) => {
    if (team === 'opp' && ctx.generic) return Array.from({ length: 6 }, (_, z) => generic[(z + r) % 6]);
    const rot = rotations[team];
    if (!rot) return Array(6).fill({ empty: true });
    const subIns = new Set(rot[r].subs.map((s) => s.in));
    return rot[r].zones.map((id) => { const p = byId(team, id); return p ? { ...p, planned: subIns.has(id) } : { empty: true }; });
  };
  const onTap = (r) => (team, zone) => {
    if (!plannable[team]) return;
    if (r === 0) { setUi({ sheet: { kind: 'pick-player', team, zone, matchMode: Boolean(doc.match) } }); return; }
    if (!rotations[team]) { toast('Set the full starting lineup first.', { tone: 'warn' }); return; }
    setUi({ sheet: { kind: 'plan-sub', team, rotation: r, zone } });
  };
  return (
    <div class="planner">
      <div class="page-head">
        <h1>Lineups</h1>
        <button class="btn primary sm" data-testid="save-preset" onClick={savePreset}>Save lineup</button>
      </div>
      {presets.length > 0 && (
        <div class="chips preset-chips">
          {presets.map((p) => (
            <span key={p.id} class="chip-group">
              <button class="chip" onClick={() => applyPreset(p, ctx.us.players)}>{p.name}{p.plannedSubs && p.plannedSubs.length ? <small>{p.plannedSubs.length} subs</small> : null}</button>
              <button class="chip x" aria-label={`Delete ${p.name}`} onClick={async () => { if (await confirmDialog({ title: `Delete lineup "${p.name}"?`, confirm: 'Delete', danger: true })) updateDoc((d) => ({ ...d, presets: d.presets.filter((x) => x.id !== p.id) })); }}><IconTrash width="14" height="14" /></button>
            </span>
          ))}
        </div>
      )}
      <LineupEditor match={doc.match} title={doc.match ? 'Next set lineup' : 'Starting lineups'} />
      <div class="plan-summary">
        <p class="muted small">Tap a player in rotations 2 to 6 to plan a substitution. It carries forward with that lineup position until you plan the player back.</p>
        <div class="row gap-s wrap">
          {TEAMS.filter((t) => plannable[t]).map((t) => (
            <span key={t} class="tag" style={{ '--tc': colors[t] }} data-testid={`planned-count-${t}`}><IconSwap width="14" height="14" /> {ctx[t].name}: {subs[t].length}/{rules.subsPerSet} subs planned</span>
          ))}
        </div>
      </div>
      {!ready.us && <p class="muted pad-x">Place all six of your players to see every rotation.</p>}
      {ready.us && (
        <div class="rotation-grid">
          {Array.from({ length: 6 }, (_, r) => {
            const ours = entriesFor('us', r);
            const setterZone = ours.findIndex((p) => p && p.roles && p.roles.includes('S'));
            const frontHitters = ours.filter((p, z) => p && !p.empty && isFrontRow(z) && !(p.roles || []).includes('S')).length;
            const row = rep && rep.rotations[r];
            const changes = TEAMS.flatMap((t) => (rotations[t] ? rotations[t][r].subs.map((s) => ({ ...s, team: t })) : []));
            return (
              <section class="card rot-card" key={r} data-rotation={r + 1}>
                <header class="card-head">
                  <h3>Rotation {r + 1}</h3>
                  <span class="muted small">{ours[0] && !ours[0].empty ? `${label('us', ours[0].id)} serves` : ''}</span>
                </header>
                <div class="rot-tags">
                  {setterZone >= 0 && <span class="tag">Setter Z{setterZone + 1} · {isFrontRow(setterZone) ? 'front' : 'back'}</span>}
                  <span class="tag">{frontHitters} front-row hitter{frontHitters === 1 ? '' : 's'}</span>
                  {row && row.rallies > 0 && <span class={`tag ${row.plusMinus >= 0 ? 'tag-good' : 'tag-bad'}`}>{row.plusMinus > 0 ? '+' : ''}{row.plusMinus} live</span>}
                </div>
                <Court entries={{ us: ours, opp: entriesFor('opp', r) }} colors={colors} serving="both" compact onTap={onTap(r)} highlight={setterZone >= 0 ? { team: 'us', zone: setterZone } : null} />
                {changes.length > 0 && (
                  <ul class="sub-notes" data-testid={`sub-notes-${r + 1}`}>
                    {changes.map((c) => (
                      <li key={`${c.team}-${c.slot}`} style={{ '--tc': colors[c.team] }}>
                        <span><b>{ctx[c.team].name}</b> {label(c.team, c.in)} in for {label(c.team, c.out)}</span>
                        <button class="icon-btn ghost" aria-label="Remove planned sub" onClick={() => writeSubs(c.team, subs[c.team].filter((s) => !(s.rotation === c.rotation && s.slot === c.slot)))}><IconX width="16" height="16" /></button>
                      </li>
                    ))}
                  </ul>
                )}
                <textarea class="input textarea note-input" rows="2" placeholder="Serve-receive notes, who passes, who hits…" value={notes[r]} onChange={(e) => setNote(r, e.currentTarget.value)} aria-label={`Notes for rotation ${r + 1}`} />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
