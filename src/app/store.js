// Application store: the persistent document, the derived match view, session-only UI state,
// autosave, the two-tab guard, backup/restore and the update check.
import { useEffect, useState, useRef } from 'preact/hooks';
import { STORAGE_KEY, LEGACY_KEY, emptyDoc, normalizeDoc, migrateV1, archiveFromMatch, emptyLineup } from '../core/model.js';
import { ensureSeedTeams } from '../core/seed.js';
import { replay, dispatch, undo as undoEvent, createMatch, describeEvent, onCourt } from '../core/engine.js';
import { uid } from '../core/roster.js';

const OWNER_KEY = 'courtCommander.v2.owner';
const TAB_ID = uid('tab');

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, value) { localStorage.setItem(key, value); }

// ---------------------------------------------------------------------------
// Tiny observable

function observable(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set(next) { value = next; subs.forEach((fn) => fn(value)); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

/** Subscribes a component to an observable through a selector. Re-renders only when the selected value changes. */
export function useObservable(obs, select = (x) => x) {
  const [val, setVal] = useState(() => select(obs.get()));
  const selRef = useRef(select);
  selRef.current = select;
  useEffect(() => obs.subscribe((v) => {
    const next = selRef.current(v);
    setVal((prev) => (Object.is(prev, next) ? prev : next));
  }), [obs]);
  return val;
}

// ---------------------------------------------------------------------------
// Document

function loadDoc() {
  const raw = safeGet(STORAGE_KEY);
  if (raw) {
    try { return { doc: ensureSeedTeams(normalizeDoc(JSON.parse(raw))), source: 'v2' }; } catch { /* fall through to a fresh start */ }
  }
  const legacy = safeGet(LEGACY_KEY);
  if (legacy) {
    try {
      const migrated = migrateV1(JSON.parse(legacy));
      if (migrated) return { doc: ensureSeedTeams(normalizeDoc(migrated)), source: 'v1' };
    } catch { /* corrupt v1 save: start fresh, leave it in place */ }
  }
  return { doc: ensureSeedTeams(emptyDoc()), source: 'new' };
}

const initial = loadDoc();
export const docStore = observable(initial.doc);
export const bootSource = initial.source;

/** Session-only UI state (never persisted). */
export const ui = observable({
  tab: 'live',
  sheet: null,          // { kind, ...props }
  dialog: null,         // { title, message, ... , resolve }
  toasts: [],
  redo: [],             // events removed by undo, newest last
  timeout: null,        // { team, endsAt }
  whiteboard: false,
  replay: null,         // archive id under replay
  ownerLost: false,
  updating: false,
  saveState: 'saved',   // saved | pending | error | suspended
  oppPicker: null,      // setup screen: opponent list open (null = open only until an opponent is chosen)
});
export const setUi = (patch) => ui.set({ ...ui.get(), ...(typeof patch === 'function' ? patch(ui.get()) : patch) });

/** Memoised view of the current match. */
let viewCache = { match: null, view: null };
export function matchView(doc = docStore.get()) {
  if (!doc.match) return null;
  if (viewCache.match !== doc.match) viewCache = { match: doc.match, view: replay(doc.match) };
  return viewCache.view;
}

export function updateDoc(fn) {
  const next = fn(docStore.get());
  if (next && next !== docStore.get()) {
    docStore.set(next);
    scheduleSave();
  }
  return next;
}

// ---------------------------------------------------------------------------
// Autosave + two-tab guard

let saveTimer = null;
let suspended = false;

export function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (suspended) { setUi({ saveState: 'suspended' }); return false; }
  try {
    const doc = { ...docStore.get(), savedAt: new Date().toISOString() };
    safeSet(STORAGE_KEY, JSON.stringify(doc));
    setUi({ saveState: 'saved' });
    return true;
  } catch {
    setUi({ saveState: 'error' });
    return false;
  }
}

function scheduleSave() {
  if (suspended) return;
  setUi({ saveState: 'pending' });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

function claimOwnership() {
  try { safeSet(OWNER_KEY, TAB_ID); } catch { /* storage unavailable: nothing to guard */ }
  suspended = false;
  setUi({ ownerLost: false });
}

/** Called by the "Use here" button after another tab took over: reload this tab from storage. */
export function takeBackControl() {
  claimOwnership();
  location.reload();
}

export function isSuspended() { return suspended; }

if (typeof window !== 'undefined') {
  claimOwnership();
  window.addEventListener('storage', (e) => {
    if (e.key === OWNER_KEY && e.newValue && e.newValue !== TAB_ID) {
      // Another tab opened Court Commander. Stop writing so neither tab overwrites the other.
      suspended = true;
      clearTimeout(saveTimer);
      setUi({ ownerLost: true, saveState: 'suspended' });
    }
  });
  const flush = () => { if (saveTimer) saveNow(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  if (bootSource !== 'v2') saveNow();
}

// ---------------------------------------------------------------------------
// Toasts and dialogs

export function toast(message, { tone = 'info', action = null, ms = 2600 } = {}) {
  const id = uid('toast');
  setUi((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, tone, action }] }));
  setTimeout(() => setUi((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

/** Promise-based confirm. Resolves true/false. */
export function confirmDialog({ title, message = '', confirm = 'OK', cancel = 'Cancel', danger = false, force = false }) {
  if (!force && docStore.get().settings.confirmDestructive === false) return Promise.resolve(true);
  return new Promise((resolve) => setUi({ dialog: { kind: 'confirm', title, message, confirm, cancel, danger, resolve } }));
}

/** Promise-based text prompt. Resolves the string or null. */
export function promptDialog({ title, message = '', value = '', confirm = 'Save', placeholder = '' }) {
  return new Promise((resolve) => setUi({ dialog: { kind: 'prompt', title, message, value, confirm, placeholder, resolve } }));
}

export function closeDialog(result) {
  const d = ui.get().dialog;
  setUi({ dialog: null });
  if (d && d.resolve) d.resolve(result);
}

export function haptic(pattern = 12) {
  if (docStore.get().settings.haptics && navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* unsupported */ } }
}

// ---------------------------------------------------------------------------
// Match actions

/** Runs an engine command against the live match. Returns { ok, error }. Shows the error as a toast. */
export function run(type, args = {}, { quiet = false } = {}) {
  const doc = docStore.get();
  if (!doc.match) return { ok: false, error: 'No match in progress.' };
  const r = dispatch(doc.match, type, args);
  if (!r.ok) {
    if (!quiet) toast(r.error, { tone: 'warn' });
    return r;
  }
  updateDoc((d) => ({ ...d, match: r.match }));
  if (type !== 'amendRally') setUi({ redo: [] });
  return r;
}

export function canUndo() {
  const d = docStore.get();
  return Boolean(d.match && d.match.events.length > 1);
}

/** Undo the last event. The first set.start is kept (undoing it would leave an empty match). */
export function undoLast() {
  const doc = docStore.get();
  if (!canUndo()) return;
  const r = undoEvent(doc.match);
  if (!r.ok) return;
  updateDoc((d) => ({ ...d, match: r.match }));
  setUi((s) => ({ redo: [...s.redo, r.event], sheet: s.sheet && s.sheet.kind === 'rally' ? null : s.sheet }));
  haptic([8, 30, 8]);
  toast(`Undid: ${describeEvent(doc.match, r.event)}`, { tone: 'muted' });
}

export function redoLast() {
  const { redo } = ui.get();
  const ev = redo[redo.length - 1];
  const doc = docStore.get();
  if (!ev || !doc.match) return;
  const match = { ...doc.match, events: [...doc.match.events, ev] };
  try { replay(match); } catch { setUi({ redo: [] }); return; }
  updateDoc((d) => ({ ...d, match }));
  setUi({ redo: redo.slice(0, -1) });
  toast(`Redid: ${describeEvent(doc.match, ev)}`, { tone: 'muted' });
}

/** Scores a rally, then opens the stat sheet when enabled. */
export function scorePoint(winner) {
  const before = matchView();
  const r = run('rally', { winner });
  if (!r.ok) return;
  haptic(15);
  const view = matchView();
  const rally = view.sets[view.sets.length - 1].rallies.at(-1);
  if (rally && rally.sideSwitch) toast('Switch sides: a team reached 8 in the deciding set', { tone: 'accent', ms: 5000 });
  if (view.phase !== 'live' && before && before.phase === 'live') haptic([20, 40, 20, 40, 60]);
  if (docStore.get().settings.statPrompt) setUi({ sheet: { kind: 'rally', winner } });
}

/** Creates the match from the setup screen and starts set 1. */
export function startMatch({ toss, firstServer }) {
  const doc = docStore.get();
  const us = doc.teams.find((t) => t.id === doc.selection.usId);
  const opp = doc.teams.find((t) => t.id === doc.selection.oppId) || { id: null, name: 'Opponent', color: '#64748b', players: [] };
  if (!us) return { ok: false, error: 'Choose your team first.' };
  const match = createMatch({ format: doc.setup.format, venue: doc.setup.venue || 'home', rules: doc.settings.rules, us, opp, trackOppPlayers: doc.settings.trackOppPlayers });
  const lineup = { us: doc.setup.lineup.us, opp: match.teams.opp.generic ? match.teams.opp.players.map((p) => p.id) : doc.setup.lineup.opp };
  const r = dispatch(match, 'startSet', { lineup, libero: doc.setup.libero, toss, firstServer });
  if (!r.ok) { toast(r.error, { tone: 'warn' }); return r; }
  updateDoc((d) => ({ ...d, match: r.match }));
  setUi({ redo: [], sheet: null });
  haptic([10, 30, 10]);
  return r;
}

/** Starts the next set using the staged lineup. */
export function startNextSet({ toss = null, firstServer = null } = {}) {
  const doc = docStore.get();
  const m = doc.match;
  const lineup = { us: doc.setup.lineup.us, opp: m.teams.opp.generic ? m.teams.opp.players.map((p) => p.id) : doc.setup.lineup.opp };
  const r = run('startSet', { lineup, libero: doc.setup.libero, toss, firstServer });
  if (r.ok) setUi({ sheet: null });
  return r;
}

/** Copies a set's starting lineup into the staging area (used when a set ends). */
export function stageLineupFromSet(set) {
  updateDoc((d) => ({ ...d, setup: { ...d.setup, lineup: { us: [...set.starters.us], opp: [...set.starters.opp] }, libero: { ...set.liberoId } } }));
}

/** Ends the match, files it in history and clears the live slot. */
export function finishMatch() {
  const doc = docStore.get();
  if (!doc.match) return;
  let match = doc.match;
  const view = matchView();
  if (view.phase !== 'ended') {
    const r = dispatch(match, 'endMatch');
    if (r.ok) match = r.match;
  }
  const record = archiveFromMatch(match);
  updateDoc((d) => ({ ...d, match: null, archive: [record, ...d.archive.filter((a) => a.id !== record.id)], setup: { ...d.setup, venue: null, libero: { us: null, opp: null } } }));
  setUi({ redo: [], sheet: null, tab: 'history' });
  toast('Match saved to History', { tone: 'success' });
}

/** Abandons the live match without filing it (still recoverable from a backup). */
export function discardMatch() {
  updateDoc((d) => ({ ...d, match: null, setup: { ...d.setup, lineup: emptyLineup(), venue: null } }));
  setUi({ redo: [], sheet: null });
}

export const currentOnCourt = (team) => {
  const v = matchView();
  return v && v.current ? onCourt(v.current, team) : [];
};

// ---------------------------------------------------------------------------
// Files

export function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const stamp = () => new Date().toISOString().replace(/[T:]/g, '-').slice(0, 19);
export const slug = (s) => String(s || 'team').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function downloadBackup() {
  saveNow();
  downloadText(`court-commander-backup-${stamp()}.json`, JSON.stringify({ type: 'court-commander-backup', version: 2, exportedAt: new Date().toISOString(), doc: docStore.get() }, null, 1));
}

/** Accepts a v2 backup, a raw v2 document, or a v1 backup payload. */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (data && data.type === 'court-commander-backup' && data.doc) return ensureSeedTeams(normalizeDoc(data.doc));
  if (data && data.schema === 2 && Array.isArray(data.teams)) return ensureSeedTeams(normalizeDoc(data));
  if (data && data.state && data.state.home) {
    const migrated = migrateV1(data);
    return migrated ? ensureSeedTeams(normalizeDoc(migrated)) : null;
  }
  return null;
}

export async function restoreBackup(text) {
  const doc = parseBackup(text);
  if (!doc) { toast('That file could not be read as a Court Commander backup.', { tone: 'warn', ms: 4000 }); return false; }
  const ok = await confirmDialog({ title: 'Restore this backup?', message: `${doc.teams.length} teams, ${doc.archive.length} matches in history${doc.match ? ', plus a match in progress' : ''}. This replaces everything on this device.`, confirm: 'Restore', danger: true, force: true });
  if (!ok) return false;
  try {
    safeSet(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    toast('The backup could not be saved on this device (storage full or private mode).', { tone: 'warn', ms: 4000 });
    return false;
  }
  docStore.set(doc);
  claimOwnership();
  setUi({ redo: [], sheet: null, tab: 'live' });
  toast('Backup restored', { tone: 'success' });
  return true;
}

export async function eraseAll() {
  const ok = await confirmDialog({ title: 'Erase all data on this device?', message: 'Teams you created, match history and the current match are deleted. Download a backup first if you may need them.', confirm: 'Erase', danger: true, force: true });
  if (!ok) return;
  const fresh = ensureSeedTeams(emptyDoc());
  fresh.migratedFromV1 = 'skipped';
  docStore.set(fresh);
  saveNow();
  setUi({ redo: [], sheet: null, tab: 'live' });
  toast('All data erased', { tone: 'muted' });
}

// ---------------------------------------------------------------------------
// Update check: once per session, compare our app-version with the server copy.

export const APP_VERSION = (typeof document !== 'undefined' && document.querySelector('meta[name="app-version"]')?.content) || 'dev';

export async function checkForUpdate() {
  if (!/^https?:/.test(location.protocol)) return;
  try { if (sessionStorage.getItem('cc_update_check_done')) return; sessionStorage.setItem('cc_update_check_done', '1'); } catch { return; }
  try {
    const res = await fetch(location.pathname + '?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const html = await res.text();
    const m = html.match(/<meta name="app-version" content="([^"]+)">/);
    if (m && m[1] !== APP_VERSION && !docStore.get().match) {
      saveNow();
      setUi({ updating: true });
      setTimeout(() => location.reload(), 600);
    }
  } catch { /* offline courtside: fine */ }
}

// Debug and test handle. Read-only accessors plus the same functions the UI calls.
if (typeof window !== 'undefined') {
  window.cc = {
    get doc() { return docStore.get(); },
    get view() { return matchView(); },
    get ui() { return ui.get(); },
    run, scorePoint, undoLast, redoLast, startMatch, startNextSet, finishMatch, updateDoc, setUi, saveNow, isSuspended,
    parseBackup, downloadBackup, restoreBackup,
  };
}
