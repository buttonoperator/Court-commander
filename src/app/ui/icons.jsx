// Inline SVG icon set (stroke icons, 24px grid). No external assets.
const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
const I = (paths) => (props) => <svg {...base} {...props}>{paths}</svg>;

export const IconLive = I(<><circle cx="12" cy="12" r="9" /><path d="M12 3c2.5 3 2.5 15 0 18M3.5 9c5 1.5 12 1.5 17 0M3.5 15c5-1.5 12-1.5 17 0" /></>);
export const IconLineup = I(<><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 12h18M9 3v18M15 3v18" /></>);
export const IconStats = I(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>);
export const IconTeams = I(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17.5" cy="9" r="2.5" /><path d="M17 14.6c2.4.2 4 1.8 4.5 4.4" /></>);
export const IconHistory = I(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>);
export const IconUndo = I(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>);
export const IconRedo = I(<><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>);
export const IconTimer = I(<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></>);
export const IconSwap = I(<><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></>);
export const IconPen = I(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>);
export const IconGear = I(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>);
export const IconPlus = I(<path d="M12 5v14M5 12h14" />);
export const IconX = I(<path d="M18 6 6 18M6 6l12 12" />);
export const IconCheck = I(<path d="m5 12 5 5L20 7" />);
export const IconChevron = I(<path d="m9 18 6-6-6-6" />);
export const IconBack = I(<path d="m15 18-6-6 6-6" />);
export const IconTrash = I(<><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></>);
export const IconDownload = I(<><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></>);
export const IconUpload = I(<><path d="M12 21V9M7 14l5-5 5 5M5 3h14" /></>);
export const IconPlay = I(<path d="M7 4v16l13-8Z" />);
export const IconPause = I(<><path d="M8 4v16M16 4v16" /></>);
export const IconFlag = I(<><path d="M4 22V4M4 4h13l-2 4 2 4H4" /></>);
export const IconEdit = I(<><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></>);
export const IconShield = I(<path d="M12 3 5 6v6c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6Z" />);
export const IconSpark = I(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />);
export const IconPrint = I(<><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2" /><rect x="6" y="14" width="12" height="7" rx="1" /></>);
export const IconCoin = I(<><circle cx="12" cy="12" r="9" /><path d="M14.5 9.5c-.5-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2-.5-2.5-1.5M12 6.5v1.5M12 16v1.5" /></>);
export const IconLink = I(<><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></>);
export const IconEraser = I(<><path d="m7 21-4-4L14 6l7 7-8 8Z" /><path d="M7 21h14M10 10l7 7" /></>);

/** Volleyball glyph used for the serve marker. */
export function Ball({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" class="ball">
      <circle cx="12" cy="12" r="10" fill="#fff" stroke="#0b1120" stroke-width="1.6" />
      <path d="M12 2c1.8 3.6 1.6 8.2-.4 11.6M21.6 9.5c-3.9-.4-8 1.4-10 4.1M4 19c2.5-3 6.6-4.6 10.4-4.2M2.6 9.6c3 .9 5.6 3 7 6M14.6 21.4c-.5-3.4.6-7 3-9.6" fill="none" stroke="#0b1120" stroke-width="1.3" />
    </svg>
  );
}
