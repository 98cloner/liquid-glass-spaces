import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Glass, useGlassPage, useGlassScheme, Vibrant} from './react';
import {layoutBox} from './renderer';
import {addTicker, commit, frameNow, present} from './frame';
import {MaterialInk} from './iconFallback';

/** An action of an `EditMenu`. */
export interface EditMenuAction {
  /** Its title. */
  label: string;
  /** Called when it is chosen. */
  onSelect?: () => void;
}
/** Props of `EditMenu`. */
export interface EditMenuProps {
  /** Shown. */
  open: boolean;
  /** Called when it closes. */
  onOpenChange?: (open: boolean) => void;
  /** Its actions, in a row. */
  actions: EditMenuAction[];
  /** What it points at: a text selection's `Range`, or a rect in the page's CSS px. */
  source: Range | {x: number; y: number; w: number; h: number};
  /** Shows a chevron for more actions; its press calls this. */
  onOverflow?: () => void;
  /** The screen's safe area in CSS px, [top, right, bottom, left]: what it presents stays inside it. Default [62, 0, 34, 0], a phone in portrait. */
  safeArea?: [number, number, number, number];
}

const H = 44, PAD = 16, END = 4, GAP = 15, PAGE = 36, MARGIN = 8, MAX_W = 500;
const INK = {light: {sep: 'rgba(60, 60, 67, .12)', page: 'rgba(116, 116, 128, .08)', hi: 'rgba(118, 118, 128, .12)', chevron: '#000'},
  dark: {sep: 'rgba(84, 84, 88, .5)', page: 'rgba(118, 118, 128, .18)', hi: 'rgba(118, 118, 128, .24)', chevron: '#fff'}};
const PRESENT = {k: 522.9226998861, c: 38.8747553390}, DISMISS = {k: 372.8890758694, c: 32.8275711752}, FROM = .2;
const springQ = ({k, c}: {k: number; c: number}, t: number) => {
  if (t <= 0) return 0;
  const a = c / 2, w = Math.sqrt(k - a * a);
  return 1 - Math.exp(-a * t) * (Math.cos(w * t) + (a / w) * Math.sin(w * t));
};

let measure: HTMLSpanElement | undefined;
function labelWidth(text: string, font: string, dpr: number) {
  const el = measure ??= Object.assign(document.createElement('span'), {});
  Object.assign(el.style, {position: 'absolute', visibility: 'hidden', left: '-9999px', whiteSpace: 'nowrap', fontSize: '15px', fontFamily: font});
  if (!el.isConnected) document.body.appendChild(el);
  el.textContent = text;
  return Math.ceil(el.getBoundingClientRect().width * dpr - 1e-6) / dpr;
}

function rangeBox(r: Range, root: HTMLElement) {
  let el: Element | null = r.commonAncestorContainer instanceof Element ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
  while (el instanceof HTMLElement && el !== root && getComputedStyle(el).display.startsWith('inline')) el = el.parentElement;
  if (!(el instanceof HTMLElement)) return {x: 0, y: 0, w: 0, h: 0};
  const a = r.getBoundingClientRect(), e = el.getBoundingClientRect(), k = e.width / (el.offsetWidth || e.width || 1) || 1, b = layoutBox(el, root);
  return {x: b.x + (a.left - e.left) / k, y: b.y + (a.top - e.top) / k, w: a.width / k, h: a.height / k};
}

/** The row of edit actions (Copy, Paste, ...) shown above or below a selection. */
export function EditMenu({open, onOpenChange, actions, source: given, onOverflow, safeArea = [62, 0, 34, 0]}: EditMenuProps) {
  const page = useGlassPage(), scheme = useGlassScheme(), ink = INK[scheme], box = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false), [, poke] = useState(0), [pressed, setPressed] = useState<number | null>(null);
  const st = useRef({at: 0, closing: false, off: () => {}, anchor: [.5, 0] as [number, number], w: 0, chosen: null as EditMenuAction | null,
    source: null as {x: number; y: number; w: number; h: number} | null}).current;
  useEffect(() => { poke((n) => n + 1); }, []);
  useEffect(() => () => st.off(), [st]);
  const run = () => {
    st.off();
    st.off = addTicker((now) => {
      const t = (now - st.at) / 1000, p = springQ(st.closing ? DISMISS : PRESENT, t), v = st.closing ? 1 - p : p, done = t > .9;
      const s = FROM + (1 - FROM) * v, [ax, ay] = st.anchor;
      present(box.current, done ? {} : {opacity: Math.max(0, Math.min(1, v)), scale: [s, s], x: (ax - .5) * st.w * (1 - s), y: (ay - .5) * H * (1 - s)});
      if (done && st.closing) { st.closing = false; commit(() => setShown(false)); const c = st.chosen; st.chosen = null; c?.onSelect?.(); }
      return !done;
    }, page);
  };
  useLayoutEffect(() => {
    if (open && (!shown || st.closing)) { if (!shown) setShown(true); st.closing = false; st.at = frameNow(); run(); }
    else if (!open && shown && !st.closing) { st.closing = true; st.at = frameNow(); run(); }
  });

  useEffect(() => {
    const root = page();
    if (!shown || !root) return;
    const down = (e: PointerEvent) => { if (e.button === 0 && !st.closing && !box.current?.contains(e.target as Node)) onOpenChange?.(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !st.closing) onOpenChange?.(false); };
    root.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key);
    return () => { root.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key); };
  });

  const root = page();
  if (!shown || !root) return null;
  const live = given instanceof Range ? rangeBox(given, root) : given;
  if (open || !st.source) st.source = live;
  const source = st.source;
  const dpr = window.devicePixelRatio || 3, font = getComputedStyle(root).fontFamily, vw = root.offsetWidth || 402, vh = root.offsetHeight || 874;
  const cells: {a: EditMenuAction; x: number; w: number; lw: number}[] = [];
  let x = END;
  for (const a of actions) { const lw = labelWidth(a.label, font, dpr); cells.push({a, x, w: lw + 2 * PAD, lw}); x += lw + 2 * PAD; }
  const W = Math.min(MAX_W, onOverflow ? x - 2 + PAGE + END : x + END);
  const [top, right, bottom, left] = safeArea, above = source.y - top > vh - bottom - (source.y + source.h);
  const y = above ? source.y - GAP - H : source.y + source.h + GAP;
  const mx = Math.max(left + MARGIN, Math.min(source.x + source.w / 2 - (W - 2 * END) / 2, vw - right - MARGIN - W));
  st.w = W; st.anchor = [Math.max(0, Math.min(1, (source.x + source.w / 2 - mx) / W)), above ? 1 : 0];
  const at = (cx: number) => cells.findIndex((c) => cx >= c.x && cx < c.x + c.w);
  const local = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return (e.clientX - r.left) * W / r.width; };
  const choose = (i: number) => { st.chosen = cells[i].a; onOpenChange?.(false); };
  return createPortal(
    <div data-lg-edit-root="" style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
      <div ref={box} role="menu" data-lg-group="" style={{position: 'absolute', left: mx, top: y, width: W, height: H, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'auto'}}
        onPointerDown={(e) => { e.preventDefault(); const i = at(local(e)); if (i < 0) return; e.currentTarget.setPointerCapture(e.pointerId); setPressed(i); }}
        onPointerMove={(e) => { if (pressed === null) return; const i = at(local(e)); setPressed(i < 0 ? null : i); }}
        onPointerUp={(e) => { const i = pressed; setPressed(null); if (i !== null && at(local(e)) === i) choose(i); }}
        onPointerCancel={() => setPressed(null)}>
        { }
        <Glass radius="capsule" tracksLuma={false} snap={false} style={{position: 'absolute', inset: 0}}>
          {pressed !== null && <div style={{position: 'absolute', left: cells[pressed].x, top: 4, width: cells[pressed].w, height: PAGE, borderRadius: PAGE / 2, background: ink.hi}} />}
          {cells.map((c, i) => (
            <div key={i} role="menuitem" style={{position: 'absolute', left: c.x, top: 0, width: c.w, height: H}}>
              {i > 0 && pressed !== i && pressed !== i - 1 && <div style={{position: 'absolute', left: 0, top: 13, width: 1, height: 18, background: ink.sep}} />}
              <Vibrant tone="tab-label" style={{position: 'absolute', left: PAD, top: 13, height: 18, fontSize: 15, lineHeight: '18px', whiteSpace: 'nowrap'}}>{c.a.label}</Vibrant>
            </div>
          ))}
          {onOverflow && <div role="button" aria-label="More" onPointerDown={(e) => { e.stopPropagation(); onOverflow(); }}
            style={{position: 'absolute', left: x - 2, top: 4, width: PAGE, height: PAGE, borderRadius: PAGE / 2, background: ink.page}}>
            <svg width={PAGE} height={PAGE} viewBox="0 0 36 36" style={{position: 'absolute', inset: 0}}>
              <MaterialInk glyph="forward" to={[14.1, 10.9, 8.2, 14.2]} fill={ink.chevron} />
            </svg>
          </div>}
        </Glass>
      </div>
    </div>, root);
}
