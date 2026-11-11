// Tactics whiteboard. Fixed 10:16 aspect board so normalised strokes never stretch between devices or
// on export. Court lines are a separate layer (never baked into strokes). Pointer Events give Apple
// Pencil pressure and palm-friendly drawing.
import { useEffect, useRef, useState } from 'preact/hooks';
import { docStore, updateDoc, setUi, confirmDialog, stamp } from '../store.js';
import { IconX, IconUndo, IconTrash, IconDownload } from './icons.jsx';

const COLORS = ['#0b1120', '#d6222c', '#2563eb', '#f97316', '#16a34a'];
const SIZES = [3, 6, 12];
const ASPECT = 10 / 16;

function drawCourt(ctx, w, h) {
  ctx.save();
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
  ctx.lineWidth = Math.max(1.5, w / 260);
  const m = w * 0.06;
  const cw = w - 2 * m;
  const ch = h - 2 * m;
  ctx.strokeRect(m, m, cw, ch);
  const mid = m + ch / 2;
  ctx.beginPath(); ctx.moveTo(m - 8, mid); ctx.lineTo(m + cw + 8, mid); ctx.stroke();
  ctx.setLineDash([8, 6]);
  const att = ch / 6; // 3 m attack lines on an 18 m court
  for (const y of [mid - att, mid + att]) { ctx.beginPath(); ctx.moveTo(m, y); ctx.lineTo(m + cw, y); ctx.stroke(); }
  ctx.restore();
}

function drawStroke(ctx, s, w, h) {
  const pts = s.points || [];
  if (!pts.length) return;
  const scale = s.sourceWidth ? w / s.sourceWidth : 1;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    ctx.beginPath(); ctx.arc(pts[0].nx * w, pts[0].ny * h, (s.size * scale) / 2, 0, Math.PI * 2); ctx.fill();
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    ctx.lineWidth = s.size * scale * (b.p ? 0.55 + b.p * 0.9 : 1);
    ctx.beginPath(); ctx.moveTo(a.nx * w, a.ny * h); ctx.lineTo(b.nx * w, b.ny * h); ctx.stroke();
  }
}

export function Whiteboard() {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [strokes, setStrokes] = useState(() => docStore.get().board.strokes);
  const current = useRef(null);

  const redraw = (list = strokes) => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = c.width / dpr;
    const h = c.height / dpr;
    ctx.clearRect(0, 0, w, h);
    drawCourt(ctx, w, h);
    for (const s of list) drawStroke(ctx, s, w, h);
    if (current.current) drawStroke(ctx, current.current, w, h);
  };

  useEffect(() => {
    const fit = () => {
      const box = wrap.current.getBoundingClientRect();
      let w = box.width;
      let h = w / ASPECT;
      if (h > box.height) { h = box.height; w = h * ASPECT; }
      const dpr = window.devicePixelRatio || 1;
      const c = canvas.current;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { redraw(); }, [strokes]);

  const persist = (list) => { setStrokes(list); updateDoc((d) => ({ ...d, board: { strokes: list } })); };
  const pos = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height, p: e.pointerType === 'pen' ? e.pressure : 0 };
  };
  const down = (e) => {
    e.preventDefault();
    canvas.current.setPointerCapture(e.pointerId);
    current.current = { color, size, sourceWidth: canvas.current.getBoundingClientRect().width, points: [pos(e)] };
    redraw();
  };
  const move = (e) => {
    if (!current.current) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs) current.current.points.push(pos(ev));
    redraw();
  };
  const up = () => {
    if (!current.current) return;
    const s = current.current;
    current.current = null;
    persist([...strokes, s]);
  };
  const exportPng = () => {
    const c = canvas.current;
    const out = document.createElement('canvas');
    out.width = c.width;
    out.height = c.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `court-commander-board-${stamp()}.png`;
    a.click();
  };
  return (
    <div class="board-layer" role="dialog" aria-label="Whiteboard">
      <div class="board-tools">
        <button class="icon-btn ghost" aria-label="Close whiteboard" onClick={() => setUi({ whiteboard: false })}><IconX /></button>
        <div class="board-colors">
          {COLORS.map((c) => <button key={c} aria-label={`Colour ${c}`} class={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />)}
        </div>
        <div class="board-sizes">
          {SIZES.map((s) => <button key={s} aria-label={`Pen ${s}`} class={`size-dot ${size === s ? 'on' : ''}`} onClick={() => setSize(s)}><i style={{ width: s + 4 + 'px', height: s + 4 + 'px' }} /></button>)}
        </div>
        <div class="row gap-s">
          <button class="icon-btn ghost" aria-label="Undo stroke" disabled={!strokes.length} onClick={() => persist(strokes.slice(0, -1))}><IconUndo /></button>
          <button class="icon-btn ghost" aria-label="Clear board" disabled={!strokes.length} onClick={async () => { if (await confirmDialog({ title: 'Clear the whiteboard?', confirm: 'Clear', danger: true })) persist([]); }}><IconTrash /></button>
          <button class="icon-btn ghost" aria-label="Save as image" onClick={exportPng}><IconDownload /></button>
        </div>
      </div>
      <div class="board-wrap" ref={wrap}>
        <canvas ref={canvas} class="board-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      </div>
    </div>
  );
}
