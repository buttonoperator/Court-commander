// Vertical court seen from our bench: opponent on top, net in the middle, our team at the bottom.
//
// Zone placement (zone index z = zone number - 1):
//   Our half    front row (near net), left->right: zones 4 3 2  -> z 3 2 1
//               back row,             left->right: zones 5 6 1  -> z 4 5 0
//   Their half  mirrored, because they face us:
//               front row (near net), left->right: zones 2 3 4  -> z 1 2 3
//               back row (top),       left->right: zones 1 6 5  -> z 0 5 4
import { useLayoutEffect, useRef } from 'preact/hooks';
import { shortName, roleLabel } from '../../core/roster.js';
import { Ball, IconPlus } from './icons.jsx';

const LAYOUT = {
  us: { front: [3, 2, 1], back: [4, 5, 0] },
  opp: { front: [1, 2, 3], back: [0, 5, 4] },
};

/** Shrinks a single-line label until it fits its box (long hyphenated or compound names). */
function useFitText(text) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = '';
      el.classList.remove('two-line');
      let size = parseFloat(getComputedStyle(el).fontSize) || 13;
      let guard = 0;
      while (el.scrollWidth > el.clientWidth + 0.5 && size > 9 && guard < 20) {
        size -= 0.5;
        el.style.fontSize = size + 'px';
        guard += 1;
      }
      // Still too wide at the smallest legible size: break at spaces and hyphens over two lines.
      if (el.scrollWidth > el.clientWidth + 0.5) el.classList.add('two-line');
    };
    fit();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(fit);
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, [text]);
  return ref;
}

export function PlayerToken({ entry, zone, serving, onTap, color, compact, highlight, dim, label }) {
  const name = entry && !entry.empty ? (entry.generic ? entry.name : shortName(entry.name)) : '';
  const nameRef = useFitText(name);
  if (!entry || entry.empty) {
    return (
      <button class={`token empty ${highlight ? 'hl' : ''}`} data-zone={zone} onClick={onTap} aria-label={`Zone ${zone + 1}: empty`}>
        <span class="tok-plus"><IconPlus width="18" height="18" /></span>
        <span class="tok-zone">Z{zone + 1}</span>
      </button>
    );
  }
  const role = entry.libero ? 'L' : (entry.roles && entry.roles[0]) || '';
  return (
    <button
      class={`token ${entry.libero ? 'libero' : ''} ${entry.planned ? 'planned' : ''} ${serving ? 'serving' : ''} ${compact ? 'compact' : ''} ${highlight ? 'hl' : ''} ${dim ? 'dim' : ''}`}
      style={{ '--tc': color }}
      data-zone={zone}
      data-player={entry.id}
      onClick={onTap}
      aria-label={`Zone ${zone + 1}: ${entry.jersey ? '#' + entry.jersey + ' ' : ''}${entry.name}${serving ? ', serving' : ''}`}
    >
      <span class="tok-num">{entry.jersey || (entry.generic ? zone + 1 : '–')}</span>
      <span class="tok-name" ref={nameRef}>{name}</span>
      {role && !compact && <span class="tok-role" title={roleLabel(role)}>{role}</span>}
      {entry.sub && <span class="tok-sub" title="Substitute">SUB</span>}
      {entry.planned && <span class="tok-sub tok-planned" title="Planned substitution">SUB IN</span>}
      {label && <span class="tok-label">{label}</span>}
      {serving && <span class="tok-ball"><Ball size={18} /></span>}
    </button>
  );
}

function Half({ team, entries, serveZone, color, onTap, highlightZone, compact, labels, dimZones }) {
  const rows = team === 'us' ? ['front', 'back'] : ['back', 'front'];
  return (
    <div class={`court-half half-${team}`} style={{ '--tc': color }}>
      {rows.map((row) => (
        <div class={`court-row row-${row}`} key={row}>
          {LAYOUT[team][row].map((z) => (
            <PlayerToken
              key={z}
              zone={z}
              entry={entries[z]}
              serving={serveZone === z}
              color={color}
              compact={compact}
              highlight={highlightZone === z}
              dim={dimZones && dimZones.includes(z)}
              label={labels && labels[z]}
              onTap={onTap ? () => onTap(team, z) : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * entries: { us: [6], opp: [6] } indexed by zone index. Each entry is a player-like object or null.
 * serving: 'us' | 'opp' | null (draws the ball on that team's zone 1).
 */
export function Court({ entries, colors, serving, onTap, highlight, compact = false, labels, hideOpp = false, dimZones, children }) {
  return (
    <div class={`court ${compact ? 'court-compact' : ''}`}>
      {!hideOpp && (
        <Half team="opp" entries={entries.opp} color={colors.opp} serveZone={serving === 'opp' || serving === 'both' ? 0 : -1} onTap={onTap} compact={compact} highlightZone={highlight && highlight.team === 'opp' ? highlight.zone : -1} labels={labels && labels.opp} dimZones={dimZones && dimZones.opp} />
      )}
      <div class="net" aria-hidden="true"><span /></div>
      <Half team="us" entries={entries.us} color={colors.us} serveZone={serving === 'us' || serving === 'both' ? 0 : -1} onTap={onTap} compact={compact} highlightZone={highlight && highlight.team === 'us' ? highlight.zone : -1} labels={labels && labels.us} dimZones={dimZones && dimZones.us} />
      {children}
    </div>
  );
}
