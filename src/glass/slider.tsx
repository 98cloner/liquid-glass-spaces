import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from 'react';
import {Slider as BaseSlider} from '@base-ui/react/slider';
import {useGlassPlatform, useGlassScheme} from './react';
import type {Platform} from './platform/types.ts';
import {commit, frameLoop, frameNow} from './frame';
import {type GlassTint, tintRGBA} from './palette';
import {step, type Spring} from './menuMorph';
import {pixelsURL, supercircleField} from './supercircle';
import {restImage, useLiquidLens, type LensSpec} from './liquidLens';

const H = 31, TRACK_Y = 12.5, TRACK_H = 6, THUMB_W = 37, THUMB_H = 24, HIT = 48, HYSTERESIS = 10;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const sliderFill = (v: number, W: number) => { const f = clamp01(v), a = THUMB_W * clamp01(Math.min(f, 1 - f) / 0.02); return a / 2 + (W - a) * f; };
const at = (x: number, y: number): CSSProperties => ({left: Math.floor(x), top: Math.floor(y), translate: `${x - Math.floor(x)}px ${y - Math.floor(y)}px`});
const rubber = (r: number) => Math.sign(r) * 12 * (1 - 1 / (1 + (0.55 * Math.abs(r)) / 12));

const thumbs = new Map<string, {url: string; x: number; y: number; w: number; h: number}>();
function thumbImage(dpr: number, platform: Platform) {
  const key = `${dpr} ${platform.build}`, known = thumbs.get(key); if (known) return known;
  const r = restImage(THUMB_W, THUMB_H, dpr, true, platform), out = {url: pixelsURL(r.px, r.iw, r.ih), x: r.x / dpr, y: r.y / dpr, w: r.iw / dpr, h: r.ih / dpr};
  thumbs.set(key, out);
  return out;
}

const tracks = new Map<string, {url: string; x: number; y: number; w: number; h: number}>();
const masks = new Map<string, Float32Array>();
function trackImage(x: number, y: number, w: number, h: number, [from, fill]: [number, number], rgb: number[], scheme: 'light' | 'dark', dpr: number, phase: [number, number]) {
  const key = [x, y, w, h, from, fill, ...rgb, scheme, dpr, ...phase].join(' ');
  const known = tracks.get(key); if (known) return known;
  const whole = (n: number) => (Number.isInteger(dpr) ? Math.ceil(n / dpr) * dpr : n);
  const X = x * dpr + phase[0], Y = y * dpr + phase[1], IX = Math.floor(X) - 1, IY = Math.floor(Y) - 1, iw = whole(Math.ceil(X + w * dpr) + 1 - IX), ih = whole(Math.ceil(Y + h * dpr) + 1 - IY);
  const mk = [iw, ih, X - IX, Y - IY, w, h, dpr].join(' '), m = masks.get(mk) ?? supercircleField(iw, ih, X - IX, Y - IY, w * dpr, h * dpr, (h / 2) * dpr), f = supercircleField(iw, ih, X - IX + from * dpr, Y - IY, (fill - from) * dpr, h * dpr, (h / 2) * dpr);
  masks.set(mk, m); if (masks.size > 8) masks.delete(masks.keys().next().value!);
  const base = scheme === 'dark' ? 255 : 0, px = new Uint8ClampedArray(iw * ih * 4);
  const over = (p: number, lo: number, hi: number) => Math.max(0, Math.min(p + 1, hi) - Math.max(p, lo));
  for (let i = 0; i < m.length; i++) {
    const bx = over(i % iw, X - IX, X - IX + w * dpr) * over(Math.floor(i / iw), Y - IY, Y - IY + h * dpr), b = 0.1 * bx;
    const a = m[i] * (f[i] + (1 - f[i]) * b); if (a <= 0) continue;
    for (let c = 0; c < 3; c++) px[4 * i + c] = Math.round((m[i] * (f[i] * rgb[c] + (1 - f[i]) * b * base)) / a);
    px[4 * i + 3] = Math.round(a * 255);
  }
  const out = {url: pixelsURL(px, iw, ih), x: (IX - phase[0]) / dpr, y: (IY - phase[1]) / dpr, w: iw / dpr, h: ih / dpr};
  tracks.set(key, out); if (tracks.size > 32) tracks.delete(tracks.keys().next().value!);
  return out;
}

const dots = new Map<string, {url: string; x: number; y: number; w: number; h: number}>();
function tickImage(xs: number[], y: number, rgb: number[], dpr: number, phase: [number, number]) {
  const key = [...xs, y, ...rgb, dpr, ...phase].join(' ');
  const known = dots.get(key); if (known) return known;
  const whole = (n: number) => (Number.isInteger(dpr) ? Math.ceil(n / dpr) * dpr : n), S = 3 * dpr;
  const X0 = Math.min(...xs) * dpr + phase[0], Y = y * dpr + phase[1], IX = Math.floor(X0) - 1, IY = Math.floor(Y) - 1;
  const iw = whole(Math.ceil(Math.max(...xs) * dpr + phase[0] + S) + 1 - IX), ih = whole(Math.ceil(Y + S) + 1 - IY), cover = new Float32Array(iw * ih);
  for (const x of xs) {
    const X = x * dpr + phase[0], f = supercircleField(iw, ih, X - IX, Y - IY, S, S, S / 2), edge = (e: number) => Math.ceil(e - .5);
    const x0 = edge(X) - IX, x1 = edge(X + S) - IX, y0 = edge(Y) - IY, y1 = edge(Y + S) - IY;
    for (let i = 0; i < f.length; i++) { const cx = i % iw, cy = Math.floor(i / iw); if (cx >= x0 && cx < x1 && cy >= y0 && cy < y1) cover[i] = Math.max(cover[i], f[i]); }
  }
  const px = new Uint8ClampedArray(iw * ih * 4);
  for (let i = 0; i < cover.length; i++) if (cover[i] > 0) { px.set(rgb, 4 * i); px[4 * i + 3] = Math.round(cover[i] * 255); }
  const out = {url: pixelsURL(px, iw, ih), x: (IX - phase[0]) / dpr, y: (IY - phase[1]) / dpr, w: iw / dpr, h: ih / dpr};
  dots.set(key, out); if (dots.size > 32) dots.delete(dots.keys().next().value!);
  return out;
}

const LENS: LensSpec = {rest: [THUMB_W, THUMB_H], lifted: [57.35, 37.2], optical: [57 + 1 / 3, 37], shadow: true, warp: [50, 0]};

function panVelocity() {
  type Seg = {d: number; dt: number} | null;
  let last: [number, number] | null = null, cur: Seg = null, prev: Seg = null;
  return {
    down(x: number, t: number) { last = [x, t]; cur = prev = null; },
    move(x: number, t: number) { if (last && t > last[1]) { prev = cur; cur = {d: x - last[0], dt: t - last[1]}; } last = [x, t]; },
    get() { const v = (s: Seg) => (s && s.dt >= 0.001 ? s.d / s.dt : 0); return prev && prev.dt > 2 ** -23 ? 0.2 * v(cur) + 0.8 * v(prev) : v(cur); },
  };
}

/** Props of `Slider`. */
export type SliderProps = {
  /** The value, 0 to 1, controlled. */
  value?: number;
  /** The starting value when uncontrolled (default 0). */
  defaultValue?: number;
  /** Called as the value changes. */
  onChange?: (value: number) => void;
  /** The fill's colour (default blue). */
  tint?: GlassTint;
  /** Dimmed; it can't be moved. */
  disabled?: boolean;
  /** A tick at every `step`; the value rounds to it. */
  step?: number;
  /** Ticks at these values; the value keeps to them. */
  ticks?: number[];
  /** Where the fill starts from (default 0). */
  neutral?: number;
  style?: CSSProperties; className?: string; 'aria-label'?: string;
  /** Submits the value with its form. */
  name?: string;
};

/** A slider from 0 to 1. Dragged, its thumb lifts into a glass lens. Keys: arrows, Page Up / Page Down, Home / End. */
export function Slider({value: given, defaultValue = 0, onChange, tint = 'blue', disabled = false, step: by, ticks: marks, neutral, style, className, 'aria-label': label, name}: SliderProps) {
  const ticks = marks ?? (by && by > 0 ? Array.from({length: Math.floor(1 / by + 1e-9) + 1}, (_, i) => Math.min(1, i * by)) : null);
  const snapTo = (v: number) => (ticks?.length ? ticks.reduce((a, t) => (Math.abs(t - v) < Math.abs(a - v) ? t : a), ticks[0]) : v);
  const scheme = useGlassScheme(), dpr = typeof window === 'undefined' ? 3 : window.devicePixelRatio || 3, platform = useGlassPlatform();
  const [own, setOwn] = useState(defaultValue), value = clamp01(given ?? own);
  const root = useRef<HTMLDivElement>(null), [W, setW] = useState(0);
  const drive = useRef({raw: value, touching: false, picked: false, start: [0, 0], startValue: value, pickup: [0, 0], id: -1, settle: null as Spring | null, loop: frameLoop(() => root.current), vel: panVelocity()});
  const [, redraw] = useState(0);
  useLayoutEffect(() => {
    const el = root.current!, ro = new ResizeObserver(() => setW(el.offsetWidth));
    ro.observe(el); setW(el.offsetWidth); return () => ro.disconnect();
  }, []);
  const d = drive.current;
  if (!d.touching && !d.settle) d.raw = value;
  const centre = () => {
    const over = (d.raw - clamp01(d.raw)) * W, e = clamp01(d.raw) + (W ? rubber(over) / W : 0), x = (W - THUMB_W) * e;
    return d.touching ? [x + THUMB_W / 2, TRACK_Y + TRACK_H / 2] : [Math.round(x) + THUMB_W / 2, Math.round(TRACK_Y + TRACK_H / 2 - THUMB_H / 2) + THUMB_H / 2];
  };
  const lens = useLiquidLens(LENS, centre, dpr);
  const L = W, publish = (v: number) => { const c = snapTo(clamp01(v)); if (c !== clamp01(given ?? own)) { setOwn(c); onChange?.(c); } };

  const over = (d.raw - clamp01(d.raw)) * L, O = rubber(over), elastic = clamp01(d.raw) + (L ? O / L : 0);
  const moving = d.touching || !!d.settle || lens.active;
  const thumbX = d.touching ? (W - THUMB_W) * elastic : Math.round((W - THUMB_W) * (moving ? elastic : clamp01(d.raw))), thumbY = Math.round(TRACK_Y + TRACK_H / 2 - THUMB_H / 2);
  const tl = L + 0.73 * Math.abs(O), th = TRACK_H - Math.abs(O) / 3, tx = -0.365 * Math.abs(O) + 0.77 * O;
  const [snap, setSnap] = useState<[number, number]>([0, 0]), phase: [number, number] = [0, 0];
  useLayoutEffect(() => {
    const b = root.current!.getBoundingClientRect(), k = b.width / (root.current!.offsetWidth || 1);
    const to = (v: number) => (Math.floor(v * dpr + 0.5) - v * dpr) / dpr / k, p: [number, number] = [to(b.left), to(b.top)];
    if (Math.abs(p[0] - snap[0]) > 1e-6 || Math.abs(p[1] - snap[1]) > 1e-6) setSnap(p);
  });
  const [r, g, b] = tintRGBA(tint, scheme, platform).map((c, i) => (i < 3 ? Math.round(c * 255) : c));

  const end = (v: number) => (v >= 1 ? tl : sliderFill(v, L)), fill: [number, number] = neutral === undefined ? [0, end(d.raw)] : [end(Math.min(d.raw, neutral)), end(Math.max(d.raw, neutral))];
  const track = W > 0 ? trackImage(tx, TRACK_Y + (TRACK_H - th) / 2, tl, th, fill, [r, g, b], scheme, dpr, phase) : null;

  const settleTick = (): boolean => {
    const s = d.settle; if (!s) return false;
    const now = frameNow() / 1000, dt = Math.min(0.05, now - (s as Spring & {t: number}).t); (s as Spring & {t: number}).t = now;
    let again = true;
    commit(() => {
      step(s, dt); d.raw = s.value; publish(d.raw);
      if (s.value === s.target && s.velocity === 0) { d.settle = null; d.raw = clamp01(s.value); again = false; }
      redraw((n) => n + 1);
    });
    return again;
  };
  useEffect(() => () => d.loop.stop(), [d]);

  const down = (e: React.PointerEvent) => {
    if (disabled || d.touching) return;
    const box = root.current!.getBoundingClientRect(), k = box.width / (W || 1), x = (e.clientX - box.left) / k, y = (e.clientY - box.top) / k;
    const cx = (W - THUMB_W) * clamp01(d.raw) + THUMB_W / 2, cy = TRACK_Y + TRACK_H / 2, hw = Math.max(HIT, THUMB_W) / 2, hh = Math.max(HIT, THUMB_H) / 2;
    if (x < cx - hw || x >= cx + hw || y < cy - hh || y >= cy + hh) return;
    d.loop.stop(); if (d.settle) { d.raw = d.settle.value; d.settle = null; }
    Object.assign(d, {touching: true, picked: false, start: [x, y], startValue: d.raw, pickup: [0, 0], id: e.pointerId});
    lens.press();
    d.vel.down(x, e.timeStamp / 1000);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    redraw((n) => n + 1);
  };
  const move = (e: React.PointerEvent) => {
    if (!d.touching || e.pointerId !== d.id) return;
    const box = root.current!.getBoundingClientRect(), k = box.width / (W || 1), x = (e.clientX - box.left) / k, y = (e.clientY - box.top) / k;
    const dx = x - d.start[0], dy = y - d.start[1];
    d.vel.move(x, e.timeStamp / 1000);
    if (!d.picked) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < HYSTERESIS) return;
      d.picked = true; d.pickup = [Math.sign(dx) * Math.min(HYSTERESIS, Math.abs(dx)), Math.sign(dy) * Math.min(HYSTERESIS, Math.abs(dy))]; d.startValue = d.raw;
      return;
    }
    d.raw = d.startValue + (dx - d.pickup[0]) / L; publish(d.raw);
    lens.moved();
    redraw((n) => n + 1);
  };
  const up = (e: React.PointerEvent) => {
    if (!d.touching || e.pointerId !== d.id) return;
    d.touching = false;
    lens.release();
    if (!d.picked) { redraw((n) => n + 1); return; }
    const v = d.vel.get() / L, p = d.raw, projected = p + 0.099 * v, target = snapTo(clamp01(Math.abs(projected - p) < 10 / L ? p : projected));
    d.settle = Object.assign({value: p, velocity: v, target, response: 0.4, damping: 1}, {t: frameNow() / 1000});
    d.loop.start(settleTick);
  };

  const key = (v: number) => {
    if (d.touching || d.settle) return;
    const cur = clamp01(given ?? own);
    if (ticks?.length && v !== 0 && v !== 1) { const next = v > cur ? ticks.find((t) => t > cur + 1e-9) : [...ticks].reverse().find((t) => t < cur - 1e-9); if (next !== undefined) publish(next); return; }
    publish(v);
  };
  return (
    <BaseSlider.Root ref={root} className={className} value={value} onValueChange={(v) => key(v as number)} min={0} max={1} step={ticks?.length ? 1e-6 : by && by > 0 ? by : 0.01} largeStep={0.1} disabled={disabled} name={name}
      data-lg-ring="" style={{position: 'relative', height: H, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', opacity: disabled ? 0.5 : undefined, ...style} as CSSProperties}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>
      <BaseSlider.Thumb aria-label={label} style={{position: 'absolute', left: thumbX, top: thumbY, width: THUMB_W, height: THUMB_H, pointerEvents: 'none', translate: 'none'}} />
      <div data-lg-exact="" style={{position: 'absolute', inset: 0, translate: `${snap[0]}px ${snap[1]}px`, pointerEvents: 'none'}}>
      {W > 0 && ticks?.length ? (() => { const t = tickImage(ticks.map((v) => (W - THUMB_W) * clamp01(v) + 16.5), TRACK_Y + TRACK_H + 4, scheme === 'dark' ? [56, 56, 58] : [198, 198, 200], dpr, phase);
        return <img alt="" draggable={false} src={t.url} style={{position: 'absolute', ...at(t.x, t.y), width: t.w, height: t.h, pointerEvents: 'none'}} />; })() : null}
      {track && <img alt="" draggable={false} src={track.url} style={{position: 'absolute', ...at(track.x, track.y), width: track.w, height: track.h, pointerEvents: 'none'}} />}
      {!lens.active && (() => { const t = thumbImage(dpr, platform); return <img alt="" draggable={false} src={t.url} style={{position: 'absolute', ...at(thumbX + t.x, thumbY + t.y), width: t.w, height: t.h, pointerEvents: 'none'}} />; })()}
      {W > 0 && lens.element(scheme as 'light' | 'dark', tint)}
      </div>
    </BaseSlider.Root>
  );
}
