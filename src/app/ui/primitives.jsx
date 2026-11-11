// Shared building blocks: sheets, dialogs, toasts, segmented controls, toggles, team badges.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ui, useObservable, closeDialog, setUi } from '../store.js';
import { IconX } from './icons.jsx';
import { initials } from '../../core/roster.js';

/** Bottom sheet on phones, centred panel on tablets. Closes on backdrop tap and Escape. */
export function Sheet({ title, subtitle, onClose, children, wide = false, accent, footer, id }) {
  // Layout effect: the Escape handler must exist as soon as the sheet is on screen.
  useLayoutEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="sheet-layer" onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <section class={`sheet ${wide ? 'sheet-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} id={id} style={accent ? { '--sheet-accent': accent } : null}>
        <div class="sheet-grip" />
        {(title || onClose) && (
          <header class="sheet-head">
            <div>
              {title && <h2 class="sheet-title">{title}</h2>}
              {subtitle && <p class="sheet-sub">{subtitle}</p>}
            </div>
            {onClose && <button class="icon-btn ghost" aria-label="Close" onClick={onClose}><IconX /></button>}
          </header>
        )}
        <div class="sheet-body">{children}</div>
        {footer && <footer class="sheet-foot">{footer}</footer>}
      </section>
    </div>
  );
}

export function DialogHost() {
  const dialog = useObservable(ui, (s) => s.dialog);
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  // Layout effect: seed the prompt's text before it is shown, so early typing is never overwritten.
  useLayoutEffect(() => {
    if (dialog && dialog.kind === 'prompt') {
      setText(dialog.value || '');
      setTimeout(() => inputRef.current && inputRef.current.select(), 30);
    }
  }, [dialog]);
  if (!dialog) return null;
  const submit = () => closeDialog(dialog.kind === 'prompt' ? text : true);
  return (
    <div class="dialog-layer" onClick={(e) => e.target === e.currentTarget && closeDialog(dialog.kind === 'prompt' ? null : false)}>
      <div class="dialog" role="alertdialog" aria-label={dialog.title}>
        <h3>{dialog.title}</h3>
        {dialog.message && <p>{dialog.message}</p>}
        {dialog.kind === 'prompt' && (
          <input ref={inputRef} class="input" value={text} placeholder={dialog.placeholder} onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        )}
        <div class="dialog-actions">
          <button class="btn ghost" data-action="cancel" onClick={() => closeDialog(dialog.kind === 'prompt' ? null : false)}>{dialog.cancel || 'Cancel'}</button>
          <button class={`btn ${dialog.danger ? 'danger' : 'primary'}`} data-action="confirm" onClick={submit}>{dialog.confirm}</button>
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useObservable(ui, (s) => s.toasts);
  return (
    <div class="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast tone-${t.tone}`}>
          <span>{t.message}</span>
          {t.action && <button class="toast-action" onClick={() => { t.action.run(); setUi((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

export function Segmented({ value, options, onChange, size = 'md', label }) {
  return (
    <div class={`segmented seg-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={value === o.value} class={value === o.value ? 'on' : ''} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label class="toggle-row">
      <span class="toggle-text"><span>{label}</span>{hint && <small>{hint}</small>}</span>
      <span class={`toggle ${checked ? 'on' : ''}`}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
        <span class="knob" />
      </span>
    </label>
  );
}

export function TeamBadge({ name, color, size = 34 }) {
  return (
    <span class="team-badge" style={{ '--c': color, width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.38) + 'px' }}>
      {initials(name)}
    </span>
  );
}

export function Empty({ icon, title, children }) {
  return (
    <div class="empty">
      {icon && <div class="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

/** Animated number: re-mounts the digit span when the value changes so CSS can play a bump. */
export function BumpNumber({ value, class: cls = '' }) {
  return <span class={`bump ${cls}`} key={value}>{value}</span>;
}

export const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; }
};
