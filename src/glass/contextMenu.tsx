import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {forwardCapturedClick, GlassLayer, useGlassPage} from './react';
import {addTicker, commit, frameNow} from './frame';
import {layoutBox} from './renderer';
import {useMenuPresenter, type Handoff} from './menu';
import {spring, step, to, type Spring} from './menuMorph';

type Rect = {x: number; y: number; w: number; h: number};
const MENU_W = 250, SIDE = 16, GAP = 16, TOP = 20, LIFT_MAX = 1.15, LIFT_UP = 26, DIM = {rgb: '22, 21, 42', alpha: .21};
const FEEDBACK = .15, CLICK_DOWN = .4, TIMEOUT = .725, SLOP = 10;
const gravityProgress = (t: number) => (t <= FEEDBACK ? 0 : t <= CLICK_DOWN ? (t - FEEDBACK) / (CLICK_DOWN - FEEDBACK) : t / CLICK_DOWN);
const DIM_OPEN: [number, number][] = [[0, 0], [.0056, .0421], [.0188, .1473], [.0348, .2872], [.048, .4271], [.0621, .5534], [.0954, .7564], [.1645, .9662], [.2108, 1]];
const DIM_CLOSE: [number, number][] = [[0, 1], [.0149, .9384], [.0283, .8406], [.0795, .7143], [.1077, .385], [.2322, .2872], [.2822, 0]];
const DIM_END = .3;
const dimAlpha = (open: boolean, t: number) => {
  const T = open ? DIM_OPEN : DIM_CLOSE;
  if (t <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (t <= T[i][0]) return T[i - 1][1] + (T[i][1] - T[i - 1][1]) * (t - T[i - 1][0]) / (T[i][0] - T[i - 1][0]);
  return T[T.length - 1][1];
};

export function contextLayout(source: Rect, h: number, view: {w: number; h: number}, safe: [number, number, number, number], dpr = 3) {
  const m = Math.max(source.w, source.h), s = Math.min(LIFT_MAX, (view.w - 2 * SIDE) / source.w, (m + LIFT_UP) / m);
  const px = (v: number) => Math.floor(v * dpr + .5) / dpr;
  const pw = px(source.w * s), ph = px(source.h * s), top = safe[0] + TOP, bottom = view.h - safe[2] - TOP;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  let x = clamp(px(source.x + source.w / 2 - pw / 2), SIDE, view.w - SIDE - pw), y = clamp(px(source.y + source.h / 2 - ph / 2), top, bottom - ph);
  const mx = clamp(px(x + pw / 2 - MENU_W / 2), SIDE, view.w - SIDE - MENU_W);
  let my: number, up = false;
  if (y + ph + GAP + h <= bottom) my = y + ph + GAP;
  else if (y - GAP - h >= top) { my = y - GAP - h; up = true; }
  else { y = Math.max(top, bottom - h - GAP - ph); my = y + ph + GAP; }
  return {preview: {x, y, w: pw, h: ph}, scale: pw / source.w, menu: {x: mx, y: my, up}};
}

/** Props of `ContextMenu`. */
export interface ContextMenuProps {
  /** The rows: `<MenuItem>`, `<MenuSection>`, `<MenuDivider>`, `<MenuSubmenu>`. */
  menu: ReactNode;
  /** What is long-pressed and lifted. */
  children: ReactNode;
  /** Open, controlled; otherwise a long press opens it. */
  open?: boolean;
  /** Called when it opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** The screen's safe area in CSS px, [top, right, bottom, left]: what it presents stays inside it. Default [62, 0, 34, 0], a phone in portrait. */
  safeArea?: [number, number, number, number];
  style?: CSSProperties;
  className?: string;
}

/** A long press lifts `children` and opens a menu of `menu` rows beside it. */
export function ContextMenu({menu, children, open, onOpenChange, safeArea = [62, 0, 34, 0], style, className}: ContextMenuProps) {
  const page = useGlassPage(), wrap = useRef<HTMLDivElement>(null), previewRef = useRef<HTMLDivElement>(null), dimRef = useRef<HTMLDivElement>(null);
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 3;
  const [, poke] = useState(0);
  const lay = useRef<ReturnType<typeof contextLayout> | null>(null), srcBox = useRef<Rect | null>(null);
  const m = useMenuPresenter({children: menu, open, onOpenChange, safeArea, source: () => wrap.current, target: () => wrap.current, copy: () => null, content: false,
    context: {place: (b, h) => {
      const root = page(); if (!root) return {x: b.x, y: b.y, up: false};
      const L = contextLayout(b, h, {w: root.offsetWidth || 402, h: root.offsetHeight || 874}, safeArea, dpr);
      lay.current = L; srcBox.current = b;
      return L.menu;
    }}});
  const mRef = useRef(m); mRef.current = m;
  type Press = {id: number; x: number; y: number; at: number; handoff: Handoff; valid: boolean; clicked: boolean};
  const st = useRef({press: null as Press | null, well: spring(1), shadow: 0, lift: spring(0), from: 1, dim: {open: true, at: -1}, suppress: false, t: 0, off: () => {}, downOn: null as Element | null}).current;
  useEffect(() => () => st.off(), [st]);
  const tick = () => {
    st.off();
    st.t = frameNow() / 1000;
    st.off = addTicker((now) => {
      const t = now / 1000, dt = Math.min(.05, t - st.t); st.t = t;
      const P = st.press, el = wrap.current, root = page();
      if (P && P.valid && !mRef.current.open) {
        const e = t - P.at, p = gravityProgress(e);
        if (el && root) { const box = layoutBox(el, root), L0 = Math.max(box.w, box.h); to(st.well, 1 + p * (Math.max(.9, (L0 + 8) / L0) - 1), .4, .6); }
        st.shadow = Math.max(0, Math.min(1, p));
        if (e >= CLICK_DOWN) P.clicked = true;
        if (P.clicked && e > TIMEOUT) openFrom(P);
      }
      for (const c of [st.well, st.lift]) step(c, dt);
      const b = srcBox.current, L = lay.current;
      if (el) {
        const lifted = mRef.current.shown || st.lift.value > .001;
        el.style.transform = lifted || st.well.value === 1 ? '' : `scale(${st.well.value})`;
        el.style.filter = lifted || !st.shadow ? '' : `drop-shadow(0 0 40px rgba(0, 0, 0, ${(.3 * st.shadow).toFixed(4)}))`;
      }
      if (b && L && previewRef.current) {
        const k = st.lift.value, s = st.from + (L.scale - st.from) * k, dx = (L.preview.x + L.preview.w / 2 - (b.x + b.w / 2)) * k, dy = (L.preview.y + L.preview.h / 2 - (b.y + b.h / 2)) * k;
        previewRef.current.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
      }
      const dimAt = st.dim.at < 0 ? 0 : dimAlpha(st.dim.open, t - st.dim.at);
      if (dimRef.current) dimRef.current.style.background = `rgba(${DIM.rgb}, ${Math.max(0, DIM.alpha * dimAt)})`;
      const dimBusy = st.dim.at >= 0 && t - st.dim.at < DIM_END;
      const M = mRef.current, closing = M.shown && !M.open;
      const busy = !!(P && P.valid && !M.open) || dimBusy || closing || [st.well, st.lift].some((c: Spring) => c.value !== c.target || c.velocity !== 0);
      if (!busy && !M.shown) { st.dim.at = -1; commit(() => poke((n) => n + 1)); }
      return busy;
    }, page);
  };
  const openFrom = (P: Press | null) => {
    const root = page(); if (root && wrap.current) srcBox.current = layoutBox(wrap.current, root);
    st.from = st.well.value; Object.assign(st.well, {value: 1, velocity: 0, target: 1}); st.shadow = 0;
    if (P) { P.valid = false; m.presentHeld(P.handoff); } else m.set(true);
  };
  const wasShown = useRef(false);
  useLayoutEffect(() => {
    if (m.open && !wasShown.current) { wasShown.current = true; to(st.lift, 1, .3, .8); st.dim = {open: true, at: frameNow() / 1000}; tick(); }
    else if (!m.open && wasShown.current) { wasShown.current = false; st.from = 1; to(st.lift, 0, .3, .8); st.dim = {open: false, at: frameNow() / 1000}; tick(); }
  });
  useEffect(() => {
    if (!m.open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') m.set(false); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    st.downOn = e.target as Element;
    if (e.button !== 0 || m.open || st.press) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    st.suppress = false;
    st.press = {id: e.pointerId, x: e.clientX, y: e.clientY, at: frameNow() / 1000, handoff: {at: [e.clientX, e.clientY], pointerId: e.pointerId, pointerType: e.pointerType}, valid: true, clicked: false};
    tick();
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = st.press; if (!p || p.id !== e.pointerId) return;
    p.handoff.at = [e.clientX, e.clientY];
    if (!m.open && p.valid && !p.clicked && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) { p.valid = false; to(st.well, 1, .4, .6); st.shadow = 0; tick(); }
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = st.press; if (!p || p.id !== e.pointerId) return;
    st.press = null;
    if (!p.handoff.taken) p.handoff.gone = true;
    if (p.valid && !m.open && (p.clicked || frameNow() / 1000 - p.at >= CLICK_DOWN)) { st.suppress = true; openFrom(null); return; }
    if (!m.open) { to(st.well, 1, .4, .6); st.shadow = 0; tick(); }
  };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const move = (e: TouchEvent) => { if (e.cancelable && (st.press?.clicked || mRef.current.open)) e.preventDefault(); };
    el.addEventListener('touchmove', move, {passive: false});
    return () => el.removeEventListener('touchmove', move);
  }, [st]);

  const root = page(), L = lay.current, b = srcBox.current, visible = m.shown || st.lift.value > .001 || st.dim.at >= 0;
  useLayoutEffect(() => {
    const host = previewRef.current, el = wrap.current;
    if (!host || !el) return;
    host.replaceChildren(...[...el.childNodes].map((n) => n.cloneNode(true)));
  }, [visible && !!b]);
  return (
    <>
      <div ref={wrap} className={className} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
        onClickCapture={(e) => { if (st.suppress) { st.suppress = false; e.stopPropagation(); e.preventDefault(); } else forwardCapturedClick(e, st.downOn); }}
        onContextMenu={(e) => e.preventDefault()} style={{touchAction: 'pan-x pan-y', userSelect: 'none', WebkitUserSelect: 'none', ...style, opacity: visible ? 0 : style?.opacity}}>
        {children}
      </div>
      {visible && root && b && L && createPortal(
        <div data-lg-context-root="" style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
          <GlassLayer ref={dimRef} style={{position: 'absolute', inset: 0, background: `rgba(${DIM.rgb}, 0)`}} />
          <GlassLayer style={{position: 'absolute', inset: 0}}>
            { }
            <div ref={previewRef} style={{position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, transformOrigin: '50% 50%', filter: 'drop-shadow(0 0 40px rgba(0, 0, 0, .3))'}} />
          </GlassLayer>
        </div>, root)}
      {m.nodes}
    </>
  );
}
