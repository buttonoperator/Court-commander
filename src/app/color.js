// Team colour handling: every team colour is shown on dark and light surfaces, so it is adjusted
// for contrast at render time while the stored colour stays the team's real colour.

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [100, 116, 139];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

function luminance([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a, b) {
  const [l1, l2] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const mix = (a, b, t) => rgbToHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));

/** The team colour, lightened (dark theme) or darkened (light theme) until it reads against the surface. */
export function displayColor(hex, theme = 'night') {
  const surface = theme === 'night' ? '#0b1120' : '#ffffff';
  const toward = theme === 'night' ? '#ffffff' : '#000000';
  let c = hex;
  for (let t = 0; t <= 1 && contrast(c, surface) < 3.2; t += 0.08) c = mix(hex, toward, t);
  return c;
}

/** Black or white, whichever reads better on `hex`. */
export const inkOn = (hex) => (contrast(hex, '#ffffff') >= contrast(hex, '#0b1120') ? '#ffffff' : '#0b1120');

/** When both teams' display colours are too alike, nudge the opponent toward a neutral slate. */
export function separateColors(us, opp) {
  const [a, b] = [hexToRgb(us), hexToRgb(opp)];
  const dist = Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
  return dist < 90 ? '#7c8db5' : opp;
}

export const TEAM_SWATCHES = ['#d6222c', '#f97316', '#f5b400', '#16a34a', '#0b6623', '#0d9488', '#0057b8', '#1e3a5f', '#4f46e5', '#7c3aed', '#be185d', '#1c1c1c', '#64748b', '#a9cce3'];
