// Lineups and rotation planner: the six rotations of a lineup, setter tracking, notes, live +/-.
import { docStore, useObservable, updateDoc, promptDialog, confirmDialog, toast, matchView } from '../store.js';
import { uid, cleanText, shortName } from '../../core/roster.js';
import { slotInZone, isFrontRow } from '../../core/rules.js';
import { teamReport } from '../../core/stats.js';
import { displayColor } from '../color.js';
import { Court } from './Court.jsx';
import { LineupEditor } from './Setup.jsx';
import { IconTrash } from './icons.jsx';

export function PlannerScreen() {
  const doc = useObservable(docStore);
  const theme = doc.settings.theme;
  const team = doc.match ? { ...doc.match.teams.us, id: doc.match.teams.us.teamId } : doc.teams.find((t) => t.id === doc.selection.usId);
  if (!team) return null;
  const color = displayColor(team.color, theme);
  const slots = doc.setup.lineup.us;
  const byId = (id) => team.players.find((p) => p.id === id) || null;
  const notes = (doc.planner[team.id] && doc.planner[team.id].notes) || ['', '', '', '', '', ''];
  const setNote = (r, text) => updateDoc((d) => {
    const prev = (d.planner[team.id] && d.planner[team.id].notes) || ['', '', '', '', '', ''];
    const next = [...prev];
    next[r] = text;
    return { ...d, planner: { ...d.planner, [team.id]: { notes: next } } };
  });
  const view = doc.match ? matchView(doc) : null;
  const rep = view && view.sets.length ? teamReport(view) : null;
  const presets = doc.presets.filter((p) => p.teamId === team.id);
  const savePreset = async () => {
    if (!slots.every(Boolean)) { toast('Place all six players before saving the lineup.', { tone: 'warn' }); return; }
    const name = cleanText(await promptDialog({ title: 'Save lineup', placeholder: 'e.g. 5-1 base', confirm: 'Save' }));
    if (!name) return;
    updateDoc((d) => ({ ...d, presets: [...d.presets.filter((p) => !(p.teamId === team.id && p.name === name)), { id: uid('lp'), teamId: team.id, name, slots: [...slots], libero: d.setup.libero.us }] }));
    toast(`Saved "${name}"`, { tone: 'success' });
  };
  const complete = slots.every(Boolean);
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
              <button class="chip" onClick={() => updateDoc((d) => ({ ...d, setup: { ...d.setup, lineup: { ...d.setup.lineup, us: p.slots.map((id) => (team.players.some((x) => x.id === id) ? id : null)) }, libero: { ...d.setup.libero, us: p.libero || d.setup.libero.us } } }))}>{p.name}</button>
              <button class="chip x" aria-label={`Delete ${p.name}`} onClick={async () => { if (await confirmDialog({ title: `Delete lineup "${p.name}"?`, confirm: 'Delete', danger: true })) updateDoc((d) => ({ ...d, presets: d.presets.filter((x) => x.id !== p.id) })); }}><IconTrash width="14" height="14" /></button>
            </span>
          ))}
        </div>
      )}
      <LineupEditor match={doc.match} title={doc.match ? 'Next set lineup' : 'Starting lineup'} />
      {!complete && <p class="muted pad-x">Place all six players to see every rotation.</p>}
      {complete && (
        <div class="rotation-grid">
          {Array.from({ length: 6 }, (_, r) => {
            const entries = Array.from({ length: 6 }, (_, z) => byId(slots[slotInZone(z, r)]));
            const setterZone = entries.findIndex((p) => p && p.roles.includes('S'));
            const frontHitters = entries.filter((p, z) => p && isFrontRow(z) && !p.roles.includes('S')).length;
            const row = rep && rep.rotations[r];
            return (
              <section class="card rot-card" key={r} data-rotation={r + 1}>
                <header class="card-head">
                  <h3>Rotation {r + 1}</h3>
                  <span class="muted small">{entries[0] ? `#${entries[0].jersey} ${shortName(entries[0].name)} serves` : ''}</span>
                </header>
                <div class="rot-tags">
                  {setterZone >= 0 && <span class="tag">Setter Z{setterZone + 1} · {isFrontRow(setterZone) ? 'front' : 'back'}</span>}
                  <span class="tag">{frontHitters} front-row hitter{frontHitters === 1 ? '' : 's'}</span>
                  {row && row.rallies > 0 && <span class={`tag ${row.plusMinus >= 0 ? 'tag-good' : 'tag-bad'}`}>{row.plusMinus > 0 ? '+' : ''}{row.plusMinus} live</span>}
                </div>
                <Court entries={{ us: entries, opp: [] }} colors={{ us: color, opp: color }} serving="us" compact hideOpp highlight={setterZone >= 0 ? { team: 'us', zone: setterZone } : null} />
                <textarea class="input textarea note-input" rows="2" placeholder="Serve-receive notes, who passes, who hits…" value={notes[r]} onChange={(e) => setNote(r, e.currentTarget.value)} aria-label={`Notes for rotation ${r + 1}`} />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
