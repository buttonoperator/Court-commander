// App shell: header, navigation (bottom bar on phones, side rail on tablets), screens, sheets, overlays,
// and keyboard shortcuts for iPad keyboards.
import { useEffect, useLayoutEffect } from 'preact/hooks';
import { docStore, ui, useObservable, setUi, matchView, scorePoint, undoLast, redoLast, takeBackControl, checkForUpdate, bootSource, toast } from '../store.js';
import { LiveScreen, MatchMenu } from './Live.jsx';
import { RallySheet, PlayerSheet, TimeoutPick, TimeoutOverlay } from './LiveSheets.jsx';
import { PickPlayer, TossSheet } from './Setup.jsx';
import { StatsScreen } from './Stats.jsx';
import { TeamsScreen, ImportSheet } from './Teams.jsx';
import { HistoryScreen, ArchiveStatsSheet } from './History.jsx';
import { PlannerScreen } from './Planner.jsx';
import { Whiteboard } from './Whiteboard.jsx';
import { SettingsSheet } from './Settings.jsx';
import { Sheet, DialogHost, Toasts } from './primitives.jsx';
import { IconLive, IconLineup, IconStats, IconTeams, IconHistory, IconGear, IconPen } from './icons.jsx';
import { LOGO_SRC } from '../assets.js';

const TABS = [
  { id: 'live', label: 'Match', icon: IconLive },
  { id: 'lineups', label: 'Lineups', icon: IconLineup },
  { id: 'stats', label: 'Stats', icon: IconStats },
  { id: 'teams', label: 'Teams', icon: IconTeams },
  { id: 'history', label: 'History', icon: IconHistory },
];

const openSheet = (sheet) => setUi({ sheet });
const closeSheet = () => setUi({ sheet: null });

function SheetHost() {
  const sheet = useObservable(ui, (s) => s.sheet);
  const doc = useObservable(docStore);
  if (!sheet) return null;
  switch (sheet.kind) {
    case 'rally': return <RallySheet winner={sheet.winner} onClose={closeSheet} />;
    case 'player': return <PlayerSheet team={sheet.team} zone={sheet.zone} onClose={closeSheet} />;
    case 'timeout-pick': return <TimeoutPick onClose={closeSheet} />;
    case 'pick-player': {
      const team = sheet.matchMode ? doc.match.teams[sheet.team] : doc.teams.find((t) => t.id === (sheet.team === 'us' ? doc.selection.usId : doc.selection.oppId));
      return <Sheet title={`Zone ${sheet.zone + 1}`} subtitle={team ? team.name : ''} onClose={closeSheet} id="pick-sheet"><PickPlayer team={sheet.team} zone={sheet.zone} matchMode={sheet.matchMode} onClose={closeSheet} /></Sheet>;
    }
    case 'toss': return <Sheet title={sheet.mode === 'toss' ? 'Coin toss' : `Set ${sheet.set}`} onClose={closeSheet} id="toss-sheet"><TossSheet set={sheet.set} mode={sheet.mode} onClose={closeSheet} /></Sheet>;
    case 'match-menu': return <Sheet title="Match" onClose={closeSheet}><MatchMenu onClose={closeSheet} /></Sheet>;
    case 'settings': return <SettingsSheet onClose={closeSheet} />;
    case 'import': return <ImportSheet onClose={closeSheet} />;
    case 'archive-stats': return <ArchiveStatsSheet id={sheet.id} onClose={closeSheet} />;
    default: return null;
  }
}

function Header() {
  const doc = useObservable(docStore);
  const view = doc.match ? matchView(doc) : null;
  const saveState = useObservable(ui, (s) => s.saveState);
  const status = view
    ? { pre: 'Ready', live: `Set ${view.current.n} · live`, between: 'Between sets', decided: 'Match decided', ended: 'Ended' }[view.phase]
    : 'No match';
  return (
    <header class="topbar">
      <div class="brand">
        <img src={LOGO_SRC} alt="" width="34" height="34" />
        <div class="brand-text"><b>Court Commander</b><small>{doc.match ? `${doc.match.teams.us.name} vs ${doc.match.teams.opp.name}` : 'Volleyball match control'}</small></div>
      </div>
      <div class="topbar-right">
        <span class={`live-pill ${view && view.phase === 'live' ? 'on' : ''}`}><i />{status}</span>
        <span class={`save-dot st-${saveState}`} title={saveState} aria-label={`Save status: ${saveState}`} />
        <button class="icon-btn ghost" aria-label="Whiteboard" onClick={() => setUi({ whiteboard: true })}><IconPen /></button>
        <button class="icon-btn ghost" aria-label="Settings" data-testid="open-settings" onClick={() => openSheet({ kind: 'settings' })}><IconGear /></button>
      </div>
    </header>
  );
}

function Nav() {
  const tab = useObservable(ui, (s) => s.tab);
  const live = useObservable(docStore, (d) => Boolean(d.match));
  return (
    <nav class="tabbar" aria-label="Sections">
      {TABS.map((t) => (
        <button key={t.id} class={`tab ${tab === t.id ? 'on' : ''}`} aria-current={tab === t.id ? 'page' : undefined} data-tab={t.id} onClick={() => setUi({ tab: t.id, replay: null })}>
          <t.icon />
          <span>{t.label}</span>
          {t.id === 'live' && live && <i class="tab-dot" />}
        </button>
      ))}
    </nav>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || ui.get().dialog) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redoLast(); else undoLast(); return; }
      if (ui.get().sheet || ui.get().whiteboard) return;
      const v = matchView();
      if (!v || v.phase !== 'live' || ui.get().tab !== 'live') return;
      if (e.key === 'ArrowLeft' || e.key === '1') { e.preventDefault(); scorePoint('us'); }
      if (e.key === 'ArrowRight' || e.key === '2') { e.preventDefault(); scorePoint('opp'); }
      if (e.key.toLowerCase() === 't') setUi({ sheet: { kind: 'timeout-pick' } });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const tab = useObservable(ui, (s) => s.tab);
  const theme = useObservable(docStore, (d) => d.settings.theme);
  const whiteboard = useObservable(ui, (s) => s.whiteboard);
  const ownerLost = useObservable(ui, (s) => s.ownerLost);
  const updating = useObservable(ui, (s) => s.updating);
  useShortcuts();
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'night' ? '#070b14' : '#f4f6fb';
  }, [theme]);
  useEffect(() => {
    const el = document.getElementById('screen');
    if (el) el.scrollTop = 0;
  }, [tab]);
  useEffect(() => {
    checkForUpdate();
    if (bootSource === 'v1') toast('Your teams and match history were brought over from the previous version.', { tone: 'success', ms: 6000 });
  }, []);
  return (
    <div class={`app tab-${tab}`}>
      <Header />
      <Nav />
      <main class="screen" id="screen">
        {tab === 'live' && <LiveScreen />}
        {tab === 'lineups' && <PlannerScreen />}
        {tab === 'stats' && <StatsScreen />}
        {tab === 'teams' && <TeamsScreen openSheet={openSheet} />}
        {tab === 'history' && <HistoryScreen openSheet={openSheet} />}
      </main>
      <SheetHost />
      <TimeoutOverlay />
      {whiteboard && <Whiteboard />}
      <DialogHost />
      <Toasts />
      {ownerLost && (
        <div class="blocker" id="open-elsewhere">
          <div class="dialog">
            <h3>Court Commander is open in another tab</h3>
            <p>This tab stopped saving so the two copies cannot overwrite each other.</p>
            <div class="dialog-actions"><button class="btn primary" data-testid="take-back" onClick={takeBackControl}>Use it here instead</button></div>
          </div>
        </div>
      )}
      {updating && <div class="blocker"><div class="dialog"><h3>Updating Court Commander…</h3></div></div>}
    </div>
  );
}
