// Teams and rosters: browse, edit, import (paste / file) and export.
import { useState } from 'preact/hooks';
import { docStore, useObservable, updateDoc, confirmDialog, toast, downloadText, slug, promptDialog } from '../store.js';
import { createTeam, createPlayer, byJersey, rosterEnvelope, bankEnvelope, normalizeImportPayload, parseJsonLoose, GRADES, cleanText } from '../../core/roster.js';
import { ROLES } from '../../core/rules.js';
import { displayColor, TEAM_SWATCHES } from '../color.js';
import { TeamBadge, Sheet, Segmented } from './primitives.jsx';
import { IconPlus, IconTrash, IconDownload, IconUpload, IconBack, IconChevron } from './icons.jsx';

const patchTeam = (id, fn) => updateDoc((d) => ({ ...d, teams: d.teams.map((t) => (t.id === id ? { ...fn(t), updatedAt: new Date().toISOString() } : t)) }));

function PlayerRow({ team, p }) {
  const set = (patch) => patchTeam(team.id, (t) => ({ ...t, players: t.players.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) }));
  const toggleRole = (code) => {
    const roles = p.roles.includes(code) ? p.roles.filter((r) => r !== code) : [...p.roles, code];
    set({ roles, libero: roles.includes('L') });
  };
  return (
    <div class="prow" data-player={p.id}>
      <input class="input jersey" inputMode="numeric" aria-label="Jersey" value={p.jersey} onChange={(e) => set({ jersey: cleanText(e.currentTarget.value).replace(/^#/, '') })} />
      <input class="input pname" aria-label="Name" value={p.name} onChange={(e) => set({ name: cleanText(e.currentTarget.value) || p.name })} />
      <div class="role-chips">
        {ROLES.map((r) => <button key={r.code} title={r.label} class={`rchip ${p.roles.includes(r.code) ? 'on' : ''} ${r.code === 'L' ? 'lib' : ''}`} onClick={() => toggleRole(r.code)}>{r.code}</button>)}
      </div>
      <select class="select grade" aria-label="Grade" value={p.grade} onChange={(e) => set({ grade: e.currentTarget.value })}>
        <option value="">–</option>
        {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
      <button class="icon-btn ghost" aria-label={`Remove ${p.name}`} onClick={async () => {
        if (await confirmDialog({ title: `Remove ${p.name}?`, confirm: 'Remove', danger: true })) patchTeam(team.id, (t) => ({ ...t, players: t.players.filter((x) => x.id !== p.id) }));
      }}><IconTrash width="18" height="18" /></button>
    </div>
  );
}

function TeamEditor({ team, onBack, liveTeamIds }) {
  const doc = useObservable(docStore);
  const [name, setName] = useState('');
  const [jersey, setJersey] = useState('');
  const theme = doc.settings.theme;
  const add = () => {
    const n = cleanText(name);
    if (!n) return;
    patchTeam(team.id, (t) => ({ ...t, players: [...t.players, createPlayer({ name: n, jersey })] }));
    setName('');
    setJersey('');
  };
  const players = [...team.players].sort(byJersey);
  return (
    <div class="team-editor">
      <div class="editor-head">
        <button class="btn ghost sm" onClick={onBack}><IconBack width="18" height="18" /> Teams</button>
        <div class="row gap-s">
          <button class="btn ghost sm" onClick={() => downloadText(`roster-${slug(team.name)}.json`, JSON.stringify(rosterEnvelope(team), null, 2))}><IconDownload width="16" height="16" /> Export</button>
          <button class="btn ghost sm danger-text" onClick={async () => {
            if (await confirmDialog({ title: `Delete ${team.name}?`, message: 'Matches already played keep their own copy of the roster.', confirm: 'Delete', danger: true })) {
              updateDoc((d) => ({ ...d, teams: d.teams.filter((t) => t.id !== team.id), selection: { usId: d.selection.usId === team.id ? null : d.selection.usId, oppId: d.selection.oppId === team.id ? null : d.selection.oppId } }));
              onBack();
            }
          }}><IconTrash width="16" height="16" /> Delete</button>
        </div>
      </div>
      <section class="card team-hero" style={{ '--tc': displayColor(team.color, theme) }}>
        <TeamBadge name={team.name} color={displayColor(team.color, theme)} size={64} />
        <div class="grow">
          <input class="input title-input" aria-label="Team name" value={team.name} onChange={(e) => patchTeam(team.id, (t) => ({ ...t, name: cleanText(e.currentTarget.value) || t.name }))} />
          <div class="swatches">
            {TEAM_SWATCHES.map((c) => <button key={c} aria-label={`Colour ${c}`} class={`swatch ${team.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => patchTeam(team.id, (t) => ({ ...t, color: c }))} />)}
            <label class="swatch custom" title="Custom colour"><input type="color" value={team.color} onInput={(e) => patchTeam(team.id, (t) => ({ ...t, color: e.currentTarget.value }))} /></label>
          </div>
        </div>
      </section>
      {liveTeamIds.includes(team.id) && <p class="note">A match with this team is in progress. Roster changes apply from the next match.</p>}
      <section class="card">
        <header class="card-head"><h3>Roster <span class="muted">{team.players.length}</span></h3></header>
        <div class="prow add">
          <input class="input jersey" inputMode="numeric" placeholder="#" aria-label="New player jersey" value={jersey} onInput={(e) => setJersey(e.currentTarget.value)} />
          <input class="input pname" placeholder="Add player name" aria-label="New player name" value={name} onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button class="btn primary sm" data-testid="add-player" onClick={add}><IconPlus width="16" height="16" /> Add</button>
        </div>
        <div class="roster-list">
          {players.map((p) => <PlayerRow key={p.id} team={team} p={p} />)}
        </div>
      </section>
    </div>
  );
}

/** Import sheet: paste text or pick a file, preview, then save to the chosen side. */
export function ImportSheet({ onClose }) {
  const [text, setText] = useState('');
  const [side, setSide] = useState('opp');
  const [preview, setPreview] = useState(null);
  const analyse = (raw) => {
    const parsed = parseJsonLoose(raw);
    if (!parsed.ok) { setPreview({ error: 'That is not valid JSON.' }); return; }
    const result = normalizeImportPayload(parsed.value);
    if (!result) { setPreview({ error: "That doesn't look like a roster. See docs/roster-json-format.md for the accepted shapes." }); return; }
    setPreview(result);
  };
  const save = () => {
    if (!preview || preview.error) return;
    let added = 0;
    let replaced = 0;
    updateDoc((d) => {
      let teams = [...d.teams];
      preview.teams.forEach((t, i) => {
        const name = t.name || (preview.kind === 'bank' ? `Imported Team ${i + 1}` : 'Imported Team');
        const fresh = createTeam({ name, color: t.color, side, players: t.players });
        const idx = teams.findIndex((x) => x.name === name && x.side === side);
        if (idx >= 0) { teams[idx] = { ...fresh, id: teams[idx].id }; replaced += 1; } else { teams = [...teams, fresh]; added += 1; }
      });
      return { ...d, teams };
    });
    toast(`Imported: ${added} new team(s)${replaced ? `, ${replaced} updated` : ''}`, { tone: 'success' });
    onClose();
  };
  return (
    <Sheet title="Import roster" subtitle="Paste a roster JSON (or a chat reply that contains one), or choose a file." onClose={onClose} wide id="import-sheet">
      <Segmented value={side} onChange={setSide} label="Save as" options={[{ value: 'opp', label: 'Opponent' }, { value: 'us', label: 'Our team' }]} />
      <textarea class="input textarea" data-testid="import-text" rows="7" placeholder='{"teamName": "…", "roster": [{"name": "…", "jersey": "12"}]}' value={text} onInput={(e) => { setText(e.currentTarget.value); setPreview(null); }} />
      <div class="row gap-s">
        <button class="btn ghost" data-testid="import-preview" onClick={() => analyse(text)} disabled={!text.trim()}>Preview</button>
        <label class="btn ghost"><IconUpload width="16" height="16" /> File
          <input type="file" accept=".json,application/json,text/plain" data-testid="import-file" hidden onChange={async (e) => { const f = e.currentTarget.files[0]; if (f) { const t = await f.text(); setText(t); analyse(t); } e.currentTarget.value = ''; }} />
        </label>
      </div>
      {preview && preview.error && <p class="note warn">{preview.error}</p>}
      {preview && !preview.error && (
        <div class="import-preview">
          {preview.teams.map((t, i) => (
            <div key={i} class="ip-team">
              <b>{t.name || 'Unnamed roster'}</b> <span class="muted">{t.players.length} players</span>
              {preview.teams.length === 1 && <ul>{t.players.slice(0, 30).map((p, j) => <li key={j}>{p.jersey ? `#${p.jersey}` : '–'} {p.name}{p.libero ? ' (L)' : ''}{p.roles.length ? ` · ${p.roles.join('/')}` : ''}{p.grade ? ` · ${p.grade}` : ''}</li>)}</ul>}
            </div>
          ))}
          {preview.warnings.length > 0 && <ul class="warnings">{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <button class="btn primary block" data-testid="import-save" onClick={save}>Import {preview.teams.length} team{preview.teams.length > 1 ? 's' : ''}</button>
        </div>
      )}
    </Sheet>
  );
}

export function TeamsScreen({ openSheet }) {
  const doc = useObservable(docStore);
  const [openId, setOpenId] = useState(null);
  const theme = doc.settings.theme;
  const liveTeamIds = doc.match ? [doc.match.teams.us.teamId, doc.match.teams.opp.teamId] : [];
  const open = doc.teams.find((t) => t.id === openId);
  if (open) return <TeamEditor team={open} onBack={() => setOpenId(null)} liveTeamIds={liveTeamIds} />;
  const create = async (side) => {
    const name = await promptDialog({ title: side === 'us' ? 'New team of ours' : 'New opponent', placeholder: 'Team name', confirm: 'Create' });
    if (!cleanText(name)) return;
    const t = createTeam({ name, side, color: side === 'us' ? '#d6222c' : '#1e3a5f' });
    updateDoc((d) => ({ ...d, teams: [...d.teams, t] }));
    setOpenId(t.id);
  };
  const group = (side, title) => (
    <section class="card">
      <header class="card-head">
        <h3>{title}</h3>
        <button class="btn ghost sm" onClick={() => create(side)}><IconPlus width="16" height="16" /> New</button>
      </header>
      <div class="team-list">
        {doc.teams.filter((t) => t.side === side).map((t) => (
          <button key={t.id} class="team-line" data-team={t.name} onClick={() => setOpenId(t.id)} style={{ '--tc': displayColor(t.color, theme) }}>
            <TeamBadge name={t.name} color={displayColor(t.color, theme)} />
            <span class="tl-name">{t.name}{t.id === doc.selection.usId && <span class="pill-tag">default</span>}</span>
            <span class="muted small">{t.players.length} players</span>
            <IconChevron width="18" height="18" />
          </button>
        ))}
      </div>
    </section>
  );
  return (
    <div class="teams">
      <div class="page-head">
        <h1>Teams</h1>
        <div class="row gap-s">
          <button class="btn ghost sm" data-testid="open-import" onClick={() => openSheet({ kind: 'import' })}><IconUpload width="16" height="16" /> Import</button>
          <button class="btn ghost sm" onClick={() => downloadText('court-commander-teams.json', JSON.stringify(bankEnvelope(doc.teams), null, 2))}><IconDownload width="16" height="16" /> Export all</button>
        </div>
      </div>
      {group('us', 'Our teams')}
      {group('opp', 'Opponents')}
    </div>
  );
}
