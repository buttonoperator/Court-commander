// Settings sheet: appearance, scoring workflow, rules profile, data.
import { docStore, useObservable, updateDoc, downloadBackup, restoreBackup, eraseAll, APP_VERSION, ui } from '../store.js';
import { Sheet, Segmented, Toggle } from './primitives.jsx';
import { IconDownload, IconUpload, IconTrash } from './icons.jsx';

export function SettingsSheet({ onClose }) {
  const doc = useObservable(docStore);
  const saveState = useObservable(ui, (s) => s.saveState);
  const s = doc.settings;
  const set = (patch) => updateDoc((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  const setRule = (patch) => updateDoc((d) => ({ ...d, settings: { ...d.settings, rules: { ...d.settings.rules, ...patch } } }));
  return (
    <Sheet title="Settings" onClose={onClose} wide id="settings-sheet">
      <div class="settings">
        <section>
          <h4 class="step-h">Appearance</h4>
          <Segmented value={s.theme} onChange={(v) => set({ theme: v })} label="Theme" options={[{ value: 'night', label: 'Night' }, { value: 'day', label: 'Day (bright gyms)' }]} />
        </section>
        <section>
          <h4 class="step-h">Scoring</h4>
          <Toggle checked={s.statPrompt} onChange={(v) => set({ statPrompt: v })} label="Ask how each point was won" hint="Kill, ace, block or error, then the player. Builds the box score." />
          <Toggle checked={s.trackOppPlayers} onChange={(v) => set({ trackOppPlayers: v })} label="Track opponent players" hint="Applies from the next match." />
          <Toggle checked={s.haptics} onChange={(v) => set({ haptics: v })} label="Vibration feedback" hint="On devices that support it." />
          <Toggle checked={s.confirmDestructive} onChange={(v) => set({ confirmDestructive: v })} label="Confirm before deleting" />
        </section>
        <section>
          <h4 class="step-h">Rules <span class="muted small">applies from the next match</span></h4>
          <label class="field"><span>Substitutions per set</span>
            <Segmented size="sm" value={s.rules.subsPerSet} onChange={(v) => setRule({ subsPerSet: v })} label="Substitutions per set" options={[{ value: 12, label: '12' }, { value: 15, label: '15' }, { value: 18, label: '18 · NFHS' }]} />
          </label>
          <label class="field"><span>Set length</span>
            <Segmented size="sm" value={s.rules.setTarget} onChange={(v) => setRule({ setTarget: v })} label="Set length" options={[{ value: 21, label: '21' }, { value: 25, label: '25 · NFHS' }]} />
          </label>
          <label class="field"><span>Deciding set</span>
            <Segmented size="sm" value={s.rules.decidingSetTarget} onChange={(v) => setRule({ decidingSetTarget: v })} label="Deciding set" options={[{ value: 15, label: '15 · NFHS' }, { value: 25, label: '25' }]} />
          </label>
          <p class="muted small">Win by 2, no cap. Two timeouts per set. A substitute stays in one lineup position for the set (NFHS 10-3-3). The libero replaces back-row players only and leaves at the front row.</p>
        </section>
        <section>
          <h4 class="step-h">Data <span class={`save-state st-${saveState}`}>{{ saved: 'Saved on this device', pending: 'Saving…', error: 'Not saved: storage unavailable', suspended: 'Paused: open in another tab' }[saveState]}</span></h4>
          <div class="row gap-s wrap">
            <button class="btn ghost" data-testid="backup" onClick={downloadBackup}><IconDownload width="16" height="16" /> Download backup</button>
            <label class="btn ghost"><IconUpload width="16" height="16" /> Restore backup
              <input type="file" accept=".json,application/json" data-testid="restore-input" hidden onChange={async (e) => { const f = e.currentTarget.files[0]; e.currentTarget.value = ''; if (f) restoreBackup(await f.text()); }} />
            </label>
            <button class="btn ghost danger-text" onClick={eraseAll}><IconTrash width="16" height="16" /> Erase all data</button>
          </div>
          <p class="muted small">Backups from the previous version of Court Commander can be restored here too.{doc.migratedFromV1 && doc.migratedFromV1 !== 'skipped' ? ' Your v1 data was imported automatically and the original v1 save was left untouched.' : ''}</p>
        </section>
        <p class="version muted small">Court Commander {APP_VERSION}</p>
      </div>
    </Sheet>
  );
}
