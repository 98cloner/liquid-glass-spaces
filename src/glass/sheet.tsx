import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {Dialog} from '@base-ui/react/dialog';
import {Glass, GlassLayer, useGlassPage, useGlassScheme} from './react';
import {addTicker, commit, eventTime, frameNow, present} from './frame';
import {inControl} from './navigation';
import {supercircleURL} from './supercircle';

/** A height a sheet rests at: 'medium' (about half the screen), 'large', `{fraction}` of the screen, or `{height}` in CSS px. */
export type SheetDetent = 'medium' | 'large' | {fraction: number} | {height: number};
/** Props of `Sheet`. */
export interface SheetProps {
  /** Shown. */
  open: boolean;
  /** Called when it is dismissed (dragged down or a tap outside). */
  onOpenChange?: (open: boolean) => void;
  /** The heights it rests at (default ['large']). */
  detents?: SheetDetent[];
  /** The current detent, controlled (default the first). */
  detent?: SheetDetent;
  /** Called when a drag settles it at another detent. */
  onDetentChange?: (detent: SheetDetent) => void;
  /** The grabber at its top: 'automatic' (shown with more than one detent), 'visible' or 'hidden'. */
  dragIndicator?: 'automatic' | 'visible' | 'hidden';
  /** No dismissal by dragging down or tapping outside. */
  dismissDisabled?: boolean;
  /** The screen's safe area in CSS px, [top, right, bottom, left]: what it presents stays inside it. Default [62, 0, 34, 0], a phone in portrait. */
  safeArea?: [number, number, number, number];
  /** Your own background (an element or a CSS colour) over its glass and fill, behind its content, clipped to its corners. */
  background?: ReactNode;
  /** Its content. */
  children?: ReactNode;
}

const SPRING = {response: .3441442326, fast: .8, flick: 1000, rest: 250, projection: .99 / (1 - .99) / 1000, hysteresis: 10};
const INSET = 8, CORNER = {top: 38, screen: 62, step: 14, min: 20}, COLOR_RESPONSE = .3441, COLOR_SETTLE = .50582;
const DIM = {light: .2, dark: .48}, OPAQUE = {light: '#fff', dark: 'rgb(28, 28, 30)'}, GRABBER = {w: 36, h: 5, top: 5};
const GRABBER_BACKDROP = (scheme: 'light' | 'dark') => JSON.stringify({blur: 30, capture: [0, -GRABBER.top, GRABBER.w, 15],
  matrix: scheme === 'light' ? [1, 0, 0, 0, -.2279, 0, 1, 0, 0, -.2279, 0, 0, 1, 0, -.2197, 0, 0, 0, 1, 0] : [1, 0, 0, 0, .2747, 0, 1, 0, 0, .2747, 0, 0, 1, 0, .2864, 0, 0, 0, 1, 0]});

function springAt(response: number, damping: number, x0: number, v0: number, to: number, t: number) {
  const w = 2 * Math.PI / response, d = x0 - to;
  if (damping >= 1) { const c = v0 + w * d, e = Math.exp(-w * t); return {x: to + (d + c * t) * e, v: (v0 - w * c * t) * e}; }
  const a = damping * w, wd = w * Math.sqrt(1 - damping * damping), e = Math.exp(-a * t), C = Math.cos(wd * t), S = Math.sin(wd * t);
  return {x: to + e * (d * C + (v0 + a * d) / wd * S), v: e * (v0 * C - (a * v0 + w * w * d) / wd * S)};
}
type Motion = {from: number; v: number; to: number; at: number; damping: number};
const sample = (m: Motion, now: number) => {
  const {x, v} = springAt(SPRING.response, m.damping, m.from, m.v, m.to, Math.max(0, (now - m.at) / 1000));
  const done = Math.abs(x - m.to) < .01 && Math.abs(v) < 1;
  return {x: done ? m.to : x, v: done ? 0 : v, done};
};
const sameDetent = (a: SheetDetent, b: SheetDetent) => JSON.stringify(a) === JSON.stringify(b);
type PanVelocity = {move: (y: number, t: number) => void; velocity: () => number};
function panVelocity(y0: number, t0: number): PanVelocity {
  let y = y0, t = t0, cur: {dy: number; dt: number} | null = null, prev: {dy: number; dt: number} | null = null;
  const seg = (s: {dy: number; dt: number} | null) => (!s || s.dt < .001 ? 0 : s.dy / s.dt);
  return {
    move(ny, nt) { const dt = nt - t; if (dt > 0) { prev = cur; cur = {dy: ny - y, dt}; } y = ny; t = nt; },
    velocity() { const v = seg(cur); return prev && prev.dt > 2 ** -23 ? .2 * v + .8 * seg(prev) : v; },
  };
}

export function sheetGeometry(O: number, screen: {w: number; h: number}, safe: [number, number, number, number], M = mediumOffset(screen, safe)) {
  const k = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 3;
  const p = Math.max(0, Math.min(1, (O - M) / (safe[0] + 10 - M))), i = INSET * (1 - p), s = 1 - 2 * i / screen.w;
  const h = Math.round((screen.h - O) * k) / k, q = Math.max(0, Math.min(1, (O - 72) / (screen.h - 72)));
  const top = Math.round(O * k) / k;
  return {p, inset: i, scale: s, top, height: h, dy: h * (1 - s) / 2 - i, screenTop: top + h * (1 - s) - i, corners: {top: CORNER.top, bottom: Math.max(CORNER.screen - CORNER.step * q, CORNER.min)}};
}
function mediumOffset(screen: {w: number; h: number}, safe: [number, number, number, number]) {
  const [top, , bottom] = safe, full = screen.h - top - bottom;
  return screen.h - bottom - full * (screen.h <= 568 ? .63 : .56);
}
export function detentOffset(d: SheetDetent, screen: {w: number; h: number}, safe: [number, number, number, number]) {
  const full = screen.h - safe[0] - safe[2];
  const height = d === 'large' ? full : d === 'medium' ? full * (screen.h <= 568 ? .63 : .56) : 'fraction' in d ? full * d.fraction : d.height;
  return screen.h - safe[2] - Math.min(full, Math.max(0, height));
}

/** A sheet of glass that slides up from the bottom of the screen; dragged, it moves between its detents or away. */
export function Sheet({open, onOpenChange, detents = ['large'], detent, onDetentChange, dragIndicator = 'automatic', dismissDisabled = false, safeArea = [62, 0, 34, 0], background, children}: SheetProps) {
  const page = useGlassPage(), scheme = useGlassScheme();
  const [, poke] = useState(0);
  const [shown, setShown] = useState(false);
  const [glassOn, setGlassOn] = useState(true);
  const host = useRef<HTMLDivElement | null>(null), dim = useRef<HTMLDivElement | null>(null), fill = useRef<HTMLDivElement | null>(null);
  const st = useRef({O: 0, travel: 0, offset: null as Motion | null, slide: null as Motion | null, color: {from: 0, to: 0, at: -Infinity}, opaque: false,
    closing: false, glassOn: true, corners: {top: CORNER.top, bottom: CORNER.screen}, drag: null as null | {id: number; y0: number; pos0: number; moved: boolean; vel: PanVelocity; U: number}, screen: {w: 402, h: 874}}).current;
  const offsets = () => detents.map((d) => detentOffset(d, st.screen, safeArea));
  const originOf = () => { const os = [...new Set(offsets())].sort((a, b) => a - b); return os.length > 1 ? os[1] : undefined; };
  const [own, setOwn] = useState<SheetDetent | null>(null);
  const selected = detent ?? (own && detents.some((d) => sameDetent(d, own)) ? own : null) ?? detents[0] ?? 'large';
  const cb = useRef({onOpenChange, onDetentChange, detents}); cb.current = {onOpenChange, onDetentChange, detents};
  useEffect(() => { poke((n) => n + 1); }, []);

  const apply = (now: number) => {
    const el = host.current; if (!el) return;
    const g = sheetGeometry(st.O, st.screen, safeArea, originOf());
    el.style.top = `${g.top}px`; el.style.height = `${g.height}px`;
    present(el, {y: st.travel + g.dy, scale: g.scale === 1 ? undefined : [g.scale, g.scale]});
    const full = st.screen.h - g.screenTop;
    present(dim.current, {opacity: Math.max(0, Math.min(1, 1 - st.travel / full))});
    const c = st.color, t = Math.max(0, (now - c.at) / 1000), a = c.at === -Infinity ? c.to : springAt(COLOR_RESPONSE, 1, c.from, 0, c.to, t).x;
    if (fill.current) fill.current.style.opacity = `${Math.max(0, Math.min(1, a))}`;
    if (st.glassOn && c.to === 1 && t >= COLOR_SETTLE) { st.glassOn = false; commit(() => setGlassOn(false)); }
    const opaque = g.p > .5;
    if (opaque !== st.opaque) {
      st.opaque = opaque;
      const from = Math.max(0, Math.min(1, a));
      st.color = {from, to: opaque ? 1 : 0, at: now};
      if (!opaque && !st.glassOn) { st.glassOn = true; commit(() => setGlassOn(true)); }
    }
    if (Math.abs(g.corners.bottom - st.corners.bottom) > .01) { st.corners = g.corners; const c2 = g.corners; commit(() => setCorners(c2)); }
  };
  const [corners, setCorners] = useState({top: CORNER.top, bottom: CORNER.screen});

  const tick = (now: number) => {
    let moving = false;
    if (st.offset) { const q = sample(st.offset, now); st.O = q.x; if (q.done) st.offset = null; else moving = true; }
    if (st.slide) { const q = sample(st.slide, now); st.travel = q.x; if (q.done) st.slide = null; else moving = true; }
    const c = st.color;
    if (c.at !== -Infinity && (now - c.at) / 1000 < COLOR_SETTLE + .05) moving = true;
    apply(now);
    if (!moving && st.closing && !st.drag) { st.closing = false; commit(() => { setShown(false); setOwn(null); }); return false; }
    return moving || !!st.drag;
  };
  const run = () => { off.current(); off.current = addTicker(tick, page); };
  const off = useRef(() => {});
  useEffect(() => () => off.current(), []);

  useLayoutEffect(() => {
    const root = page();
    if (!root) return;
    st.screen = {w: root.offsetWidth || 402, h: root.offsetHeight || 874};
    const now = frameNow();
    if (open && (!shown || st.closing)) {
      const O = detentOffset(selected, st.screen, safeArea), g = sheetGeometry(O, st.screen, safeArea, originOf());
      if (!shown) {
        st.O = O; st.offset = null; st.opaque = g.p > .5; st.color = {from: 0, to: st.opaque ? 1 : 0, at: -Infinity};
        st.travel = st.screen.h - g.screenTop; st.glassOn = !st.opaque; setGlassOn(st.glassOn); st.corners = g.corners; setCorners(g.corners); setShown(true);
      }
      st.closing = false;
      st.slide = {from: st.travel, v: st.slide ? sample(st.slide, now).v : 0, to: 0, at: now, damping: 1};
      run();
    } else if (!open && shown && !st.closing) {
      const g = sheetGeometry(st.O, st.screen, safeArea, originOf());
      st.closing = true;
      st.slide = {from: st.travel, v: st.slide ? sample(st.slide, now).v : 0, to: st.screen.h - g.screenTop, at: now, damping: 1};
      run();
    }
  });
  const last = useRef(selected);
  useLayoutEffect(() => {
    if (sameDetent(last.current, selected)) return;
    last.current = selected;
    if (!shown || st.drag) return;
    const now = frameNow(), to = detentOffset(selected, st.screen, safeArea);
    st.offset = {from: st.O, v: st.offset ? sample(st.offset, now).v : 0, to, at: now, damping: 1};
    run();
  });
  useLayoutEffect(() => { if (shown) apply(frameNow()); });

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (st.drag || e.button !== 0 || inControl(e.target)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const y = e.clientY / scaleOf(e.currentTarget);
    st.drag = {id: e.pointerId, y0: y, pos0: st.O + st.travel, moved: false, vel: panVelocity(y, eventTime(e) / 1000), U: st.O + st.travel};
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = st.drag;
    if (!d || d.id !== e.pointerId) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) { up(e); return; }
    const y = e.clientY / scaleOf(e.currentTarget), dy = y - d.y0;
    d.vel.move(y, eventTime(e) / 1000);
    if (!d.moved) { if (Math.abs(dy) < SPRING.hysteresis) return; d.moved = true; d.y0 = y; d.pos0 = st.O + st.travel; st.offset = st.slide = null; run(); return; }
    const os = offsets(), top = Math.min(...os), lowest = Math.max(...os);
    d.U = d.pos0 + dy;
    const pos = Math.max(top, d.U);
    if (pos <= lowest) { st.O = pos; st.travel = 0; }
    else if (dismissDisabled) { const E = 200, k = .55, u = pos - lowest; st.O = lowest; st.travel = E * (1 - 1 / (1 + k * u / E)); }
    else { st.O = lowest; st.travel = pos - lowest; }
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = st.drag;
    if (!d || d.id !== e.pointerId) return;
    if (e.type === 'lostpointercapture' && e.target !== e.currentTarget) return;
    st.drag = null;
    if (!d.moved) return;
    const vRaw = e.type === 'pointerup' ? d.vel.velocity() : 0, vEff = Math.abs(vRaw) < SPRING.rest ? 0 : vRaw;
    const os = offsets(), U = d.U, lowest = Math.max(...os), top = Math.min(...os);
    const stops = [...os.map((o, i) => ({o, i})), ...(dismissDisabled ? [] : [{o: st.screen.h, i: -1}])].sort((a, b) => a.o - b.o);
    const nearest = (y: number) => stops.reduce((a, b) => (Math.abs(b.o - y) < Math.abs(a.o - y) ? b : a));
    const current = nearest(U);
    let target = nearest(U + vEff * SPRING.projection);
    if (Math.abs(vRaw) >= SPRING.flick && target === current && ((U >= current.o) !== (vRaw < 0))) {
      const j = stops.indexOf(current) + Math.sign(vRaw);
      if (j >= 0 && j < stops.length) target = stops[j];
    }
    const floor = dismissDisabled ? lowest : st.screen.h, past = U < top ? top - U : U > floor ? U - floor : 0;
    const E = U < top ? 0 : 200, F = past > 0 ? (E === 0 ? 0 : E * (1 - 1 / (1 + .55 * past / E))) : 0;
    const v = past > 0 ? vEff * F / past : vEff;
    const now = frameNow(), damping = Math.abs(vRaw) >= SPRING.flick ? SPRING.fast : 1;
    if (target.i === -1) {
      st.closing = true; st.slide = {from: st.travel, v, to: st.screen.h - lowest, at: now, damping};
      run(); cb.current.onOpenChange?.(false); return;
    }
    if (st.travel > 0) st.slide = {from: st.travel, v, to: 0, at: now, damping};
    st.offset = {from: st.O, v: st.travel > 0 ? 0 : v, to: Math.min(target.o, lowest), at: now, damping};
    run();
    const next = cb.current.detents[target.i];
    last.current = next;
    if (detent === undefined && next) setOwn(next);
    if (next && !sameDetent(next, selected)) cb.current.onDetentChange?.(next);
  };

  const root = page();
  const grabber = dragIndicator === 'visible' || dragIndicator === 'automatic' && detents.length > 1;
  return (
    <Dialog.Root open={shown && !!root} modal="trap-focus" disablePointerDismissal
      onOpenChange={(o, d) => { if (!o && d.reason === 'escape-key' && !dismissDisabled) cb.current.onOpenChange?.(false); }}>
      {shown && root && <Dialog.Portal container={root}>
        <div data-lg-sheet-root="" style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
          { }
          <GlassLayer ref={dim} data-lg-group="" style={{position: 'absolute', inset: 0, background: `rgba(0, 0, 0, ${DIM[scheme]})`, pointerEvents: 'auto'}}
            onClick={() => { if (!dismissDisabled) cb.current.onOpenChange?.(false); }} />
          <Dialog.Popup ref={host} data-lg-sheet="" data-lg-popup="" initialFocus={host} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
            style={{position: 'absolute', left: 0, width: '100%', overflow: 'hidden', pointerEvents: 'auto', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none'}}>
            {glassOn && <Glass data-lg-sheet-glass="" variant="sheet" radius={corners.top} bottomRadius={corners.bottom} style={{position: 'absolute', inset: 0}} />}
            <GlassLayer ref={fill} style={{position: 'absolute', inset: 0, background: OPAQUE[scheme], opacity: 0, ...continuousMask(corners.top, corners.bottom)}} />
            {background != null && <GlassLayer style={{position: 'absolute', inset: 0, overflow: 'hidden', ...(typeof background === 'string' ? {background} : null), ...continuousMask(corners.top, corners.bottom)}}>
              {typeof background === 'string' ? null : background}
            </GlassLayer>}
            <GlassLayer plain={false} style={{position: 'absolute', inset: 0}}>
              {children}
            </GlassLayer>
            {grabber && <GlassLayer data-lg-backdrop={GRABBER_BACKDROP(scheme)} style={{position: 'absolute', top: GRABBER.top, left: '50%', marginLeft: -GRABBER.w / 2,
              width: GRABBER.w, height: GRABBER.h}} />}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>}
    </Dialog.Root>
  );
}

function scaleOf(el: HTMLElement) {
  const r = el.closest<HTMLElement>('[data-lg-sheet-root]')?.getBoundingClientRect(), w = el.closest<HTMLElement>('[data-lg-sheet-root]')?.offsetWidth;
  return r && w ? r.width / w || 1 : 1;
}

function continuousMask(top: number, bottom: number) {
  const dpr = window.devicePixelRatio || 1, q = (r: number) => Math.round(r * 4) / 4;
  const t = q(top), b = q(bottom), Et = Math.ceil(t * 1.528665), Eb = Math.ceil(b * 1.528665);
  const it = supercircleURL(2 * Et, 2 * Et, t, dpr), ib = supercircleURL(2 * Eb, 2 * Eb, b, dpr), solid = 'linear-gradient(#000, #000)';
  const layers = [
    [`url(${it})`, 'left top', `${2 * Et}px ${2 * Et}px`], [`url(${it})`, 'right top', `${2 * Et}px ${2 * Et}px`],
    [`url(${ib})`, 'left bottom', `${2 * Eb}px ${2 * Eb}px`], [`url(${ib})`, 'right bottom', `${2 * Eb}px ${2 * Eb}px`],
    [solid, `${Et}px 0`, `calc(100% - ${2 * Et}px) calc(100% - ${Eb}px)`], [solid, `${Eb}px ${Et}px`, `calc(100% - ${2 * Eb}px) calc(100% - ${Et}px)`],
    [solid, `0 ${Et}px`, `100% calc(100% - ${Et + Eb}px)`]];
  const mask = layers.map(([i, p, z]) => `${i} ${p} / ${z} no-repeat`).join(', ');
  return {maskImage: undefined, mask, WebkitMask: mask} as const;
}
