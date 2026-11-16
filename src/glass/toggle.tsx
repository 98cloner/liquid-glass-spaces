import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from 'react';
import {Switch} from '@base-ui/react/switch';
import {useGlassPlatform, useGlassScheme} from './react';
import {commit, frameLoop} from './frame';
import {type GlassTint, tintRGBA} from './palette';
import {pixelsURL, supercircleField} from './supercircle';
import {lensClock, springAt, useLiquidLens, type LensLook, type LensSpec, type LensSpring} from './liquidLens';

const W = 61, H = 28, TRACK_W = 63, THUMB_W = 37, THUMB_H = 24, INSET = 2;
const OFF = {light: [60, 60, 67], dark: [235, 235, 245]}, OFF_ALPHA = 76 / 255;
const at = (x: number, y: number): CSSProperties => ({left: Math.floor(x), top: Math.floor(y), translate: `${x - Math.floor(x)}px ${y - Math.floor(y)}px`});

type Img = {url: string; x: number; y: number; w: number; h: number};
const images = new Map<string, Img>();
const remember = (key: string, make: () => Img) => {
  const known = images.get(key); if (known) return known;
  const out = make(); images.set(key, out); if (images.size > 64) images.delete(images.keys().next().value!);
  return out;
};
const whole = (n: number, dpr: number) => { const p = Math.ceil(n - 1e-9); return Number.isInteger(dpr) ? Math.ceil(p / dpr) * dpr : p; };

function trackImage(on: number, rgb: readonly number[], scheme: 'light' | 'dark', dpr: number): Img {
  return remember(`track ${on} ${rgb} ${scheme} ${dpr}`, () => {
    const iw = whole(TRACK_W * dpr + 2, dpr), ih = whole(H * dpr + 2, dpr), m = supercircleField(iw, ih, 1, 1, TRACK_W * dpr, H * dpr, (H / 2) * dpr), base = OFF[scheme];
    const px = new Uint8ClampedArray(iw * ih * 4);
    for (let i = 0; i < m.length; i++) {
      const c = m[i]; if (c <= 0) continue;
      const b = c * OFF_ALPHA, f = c * on, a = f + (1 - f) * b;
      for (let k = 0; k < 3; k++) px[4 * i + k] = Math.round((f * rgb[k] + (1 - f) * b * base[k]) / a);
      px[4 * i + 3] = Math.round(a * 255);
    }
    return {url: pixelsURL(px, iw, ih), x: -1 / dpr, y: -1 / dpr, w: iw / dpr, h: ih / dpr};
  });
}
function thumbImage(dpr: number): Img {
  return remember(`thumb ${dpr}`, () => {
    const iw = whole(THUMB_W * dpr + 2, dpr), ih = whole(THUMB_H * dpr + 2, dpr), m = supercircleField(iw, ih, 1, 1, THUMB_W * dpr, THUMB_H * dpr, (THUMB_H / 2) * dpr);
    const px = new Uint8ClampedArray(iw * ih * 4);
    for (let i = 0; i < m.length; i++) { px[4 * i] = px[4 * i + 1] = px[4 * i + 2] = 255; px[4 * i + 3] = Math.round(m[i] * 255); }
    return {url: pixelsURL(px, iw, ih), x: -1 / dpr, y: -1 / dpr, w: iw / dpr, h: ih / dpr};
  });
}

function clipMask(dpr: number): Img {
  return remember(`clip ${dpr}`, () => {
    const iw = whole(TRACK_W * dpr + 2, dpr), ih = whole(H * dpr + 2, dpr), m = supercircleField(iw, ih, 1, 1, TRACK_W * dpr, H * dpr, (H / 2) * dpr);
    const px = new Uint8ClampedArray(iw * ih * 4);
    for (let i = 0; i < m.length; i++) { px[4 * i + 3] = Math.round(m[i] * 255); }
    return {url: pixelsURL(px, iw, ih), x: -1 / dpr, y: -1 / dpr, w: iw / dpr, h: ih / dpr};
  });
}

const OFF_X = INSET + THUMB_W / 2, ON_X = TRACK_W - INSET - THUMB_W / 2, MID_Y = H / 2, KNOB = {response: 0.3, damping: 1};
const LENS: LensSpec = {rest: [THUMB_W, THUMB_H], lifted: [58, 115 / 3], optical: [58, 115 / 3], shadow: false, warp: [50, 9]};
const LOOKS: Record<string, LensLook> = {
  'light/off': {key: [2.8880999088287354, -1.8432999849319458, -0.1858000010251999, 0, -1.2905999422073364, -0.5478000044822693, 1.5928999185562134, -0.18609999120235443, 0, -1.2905999422073364, -0.513700008392334, -1.7272999286651611, 3.046099901199341, 0, -1.1469999551773071, 0, 0, 0, 1, 0], shadow: [0.443799168, 0.443799168, 0.456200778]},
  'dark/off': {key: [1.08079993724823, -0.689799964427948, -0.06949999928474426, 0, 0.1428000032901764, -0.20499999821186066, 0.5960999727249146, -0.06960000097751617, 0, 0.1428000032901764, -0.1979999989271164, -0.6657999753952026, 1.1741999387741089, 0, 0.17239999771118164, 0, 0, 0, 1, 0], shadow: [0.412499875, 0.412499875, 0.487500072]},
  'light/on': {key: [1.6755999326705933, -1.0694999694824219, -0.10779999941587448, 0, -0.32899999618530273, -0.21490000188350677, 0.6248999834060669, -0.0729999989271164, 0, 0.10130000114440918, -0.28380000591278076, -0.9541999697685242, 1.6826999187469482, 0, -0.18599998950958252, 0, 0, 0, 1, 0], shadow: [0.384113461, 0.515886486, 0.417280793]},
  'dark/on': {key: [1.6976999044418335, -1.0835999250411987, -0.10920000076293945, 0, -0.3464999794960022, -0.2102999985218048, 0.6114999651908875, -0.0714000016450882, 0, 0.12069999426603317, -0.28459998965263367, -0.9569999575614929, 1.687600016593933, 0, -0.18949998915195465, 0, 0, 0, 1, 0], shadow: [0.378409088, 0.521590889, 0.413982153]},
  'light/on/orange': {key: [1.0087000131607056, -0.6437999606132507, -0.0648999959230423, 0, 0.19999998807907104, -0.24639999866485596, 0.7164999842643738, -0.08370000123977661, 0, -0.030299998819828033, -0.3308999836444855, -1.1126999855041504, 1.9621999263763428, 0, -0.3831000030040741, 0, 0, 0, 1, 0], shadow: [0.5625, 0.443197638, 0.337499946]},
  'dark/on/orange': {key: [1.0087000131607056, -0.6437999606132507, -0.0648999959230423, 0, 0.19999998807907104, -0.24329999089241028, 0.7074999809265137, -0.08269999921321869, 0, -0.017500000074505806, -0.3222000002861023, -1.083299994468689, 1.9103999137878418, 0, -0.3464999794960022, 0, 0, 0, 1, 0], shadow: [0.5625, 0.444021732, 0.337499946]},
};
const lookOf = (scheme: 'light' | 'dark', on: boolean, tint: string) => LOOKS[on ? (tint === 'orange' ? `${scheme}/on/orange` : `${scheme}/on`) : `${scheme}/off`];
const rubber = (r: number) => Math.sign(r) * 12 * (1 - 1 / (1 + (0.55 * Math.abs(r)) / 12));
const WELL = {on: {response: 0.68, duration: 0.9994651738}, off: {response: 0.4, duration: 0.5879206905}};
type Well = {from: number; to: number; t0: number; response: number; duration: number};

/** Props of `Toggle`. */
export type ToggleProps = {
  /** On, controlled. */
  checked?: boolean;
  /** The starting state when uncontrolled (default off). */
  defaultChecked?: boolean;
  /** Called with the new state. */
  onChange?: (checked: boolean) => void;
  /** The colour when on (default green). */
  tint?: GlassTint;
  /** Dimmed; it can't be switched. */
  disabled?: boolean;
  style?: CSSProperties; className?: string; 'aria-label'?: string;
  /** Submits `on` with its form when on. */
  name?: string;
};

/** A switch. A tap flips it; held or dragged, its knob lifts into a glass lens. Space and Enter flip it. */
export function Toggle({checked, defaultChecked = false, onChange, tint = 'green', disabled = false, style, className, 'aria-label': label, name}: ToggleProps) {
  const scheme = useGlassScheme(), dpr = typeof window === 'undefined' ? 3 : window.devicePixelRatio || 3, platform = useGlassPlatform();
  const [own, setOwn] = useState(defaultChecked), on = checked ?? own;
  const root = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<[number, number]>([0, 0]);
  const measure = () => {
    const el = root.current; if (!el) return;
    const b = el.getBoundingClientRect(), k = b.width / (el.offsetWidth || 1);
    const to = (v: number) => (Math.floor(v * dpr + 0.5) - v * dpr) / dpr / k, p: [number, number] = [to(b.left), to(b.top)];
    setSnap((s) => (Math.abs(p[0] - s[0]) > 1e-6 || Math.abs(p[1] - s[1]) > 1e-6 ? p : s));
  };
  useLayoutEffect(measure);
  useEffect(() => { const f = requestAnimationFrame(measure); return () => cancelAnimationFrame(f); }, []);
  const rgb = tintRGBA(tint, scheme, platform).slice(0, 3).map((c) => Math.round(c * 255));
  const clock = lensClock;
  const m = useRef({displayed: on, touching: false, id: -1, startX: 0, startedOn: on, pending: !on, preview: on, applyNext: false, zeroOffset: 0, began: false,
    recognized: false, timer: 0, loop: frameLoop(() => root.current),
    knob: [{from: on ? ON_X : OFF_X, v0: 0, target: on ? ON_X : OFF_X, t0: 0, ...KNOB}, {from: MID_Y, v0: 0, target: MID_Y, t0: 0, ...KNOB}] as LensSpring[],
    well: null as Well | null}).current;
  const [, redraw] = useState(0);
  const knobAt = (t: number) => m.knob.map((k) => springAt(k, t).value);
  const aim = (axis: number, target: number, t: number, jump = false) => {
    const k = m.knob[axis], p = springAt(k, t);
    m.knob[axis] = jump ? {...k, from: target, v0: p.velocity, target, t0: t} : {...k, from: p.value, v0: p.velocity, target, t0: t};
  };
  const wellAt = (w: Well, t: number) => { const u = Math.max(0, t - w.t0), o = (2 * Math.PI) / w.response, p = 1 - (1 + o * u) * Math.exp(-o * u); return w.from + (w.to - w.from) * p; };
  const show = (v: boolean, t: number) => {
    const to = v ? 315 : -252, from = m.well ? wellAt(m.well, t) : m.displayed ? 315 : -252;
    m.displayed = v;
    if (from === to && !m.well) return;
    m.well = {from, to, t0: t, ...(v ? WELL.on : WELL.off)};
  };
  const lens = useLiquidLens(LENS, () => knobAt(clock()), dpr);
  const tick = (): boolean => {
    const t = clock();
    if (m.well && t - m.well.t0 >= m.well.duration) m.well = null;
    const moving = m.knob.some((k) => { const p = springAt(k, t); return Math.abs(p.value - k.target) > 1e-3 || Math.abs(p.velocity) > 1e-2; });
    if (!moving) m.knob = m.knob.map((k) => ({...k, from: k.target, v0: 0, t0: t}));
    lens.moved();
    commit(() => redraw((n) => n + 1));
    return !!moving || !!m.well;
  };
  const kick = () => m.loop.start(tick);
  useEffect(() => () => { m.loop.stop(); clearTimeout(m.timer); }, [m]);
  useLayoutEffect(() => {
    if (m.touching || on === m.displayed) return;
    const t = clock(); show(on, t); aim(0, on ? ON_X : OFF_X, t); kick();
  }, [on]);
  const set = (v: boolean) => { if (v === on) return; setOwn(v); onChange?.(v); };

  const local = (e: React.PointerEvent) => { const b = root.current!.getBoundingClientRect(), k = b.width / (root.current!.offsetWidth || 1); return (e.clientX - b.left) / k; };
  const anchor = (c: number, size: number) => { const o = (c - size / 2) * dpr; return (Math.sign(o) * Math.round(Math.abs(o))) / dpr + size / 2; };
  const recognize = () => {
    if (m.recognized || !m.touching) return;
    m.recognized = true;
    const t = clock(), k = m.knob[0], p = springAt(k, t);
    if (Math.abs(p.value - k.target) < 1e-3 && Math.abs(p.velocity) < 1e-2) aim(0, anchor(p.value, LENS.lifted[0]), t, true);
    aim(1, anchor(MID_Y, LENS.lifted[1]), t);
    lens.press(); kick();
  };
  const down = (e: React.PointerEvent) => {
    if (disabled || m.touching) return;
    Object.assign(m, {touching: true, id: e.pointerId, startX: local(e), startedOn: m.displayed, pending: !m.displayed, preview: m.displayed, applyNext: false, zeroOffset: 0, began: false, recognized: false});
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    m.timer = window.setTimeout(recognize, 10);
  };
  const move = (e: React.PointerEvent) => {
    if (!m.touching || e.pointerId !== m.id) return;
    const t = clock();
    if (m.applyNext) { m.applyNext = false; show(m.pending, t); }
    const dx = local(e) - m.startX;
    if (!m.began) m.began = dx !== 0;
    else { const delta = dx - m.zeroOffset; if ((m.preview ? -delta : delta) > 25) { m.preview = !m.preview; m.pending = m.preview; m.zeroOffset = dx; m.applyNext = true; } }
    const raw = (m.startedOn ? ON_X : OFF_X) + dx, c = Math.max(OFF_X, Math.min(ON_X, raw));
    aim(0, c + rubber(raw - c), t); kick();
  };
  const up = (e: React.PointerEvent) => {
    if (!m.touching || e.pointerId !== m.id) return;
    clearTimeout(m.timer); recognize();
    m.touching = false;
    const t = clock(), v = e.type === 'pointercancel' ? on : m.pending;
    show(v, t); aim(0, v ? ON_X : OFF_X, t); aim(1, MID_Y, t);
    lens.release(); kick();
    set(v);
  };

  const [kx, ky] = knobAt(clock()), w = m.well, base = trackImage(!w && m.displayed ? 1 : 0, rgb, scheme, dpr), thumb = thumbImage(dpr), clip = clipMask(dpr);
  const strip = w ? wellAt(w, clock()) - 315 : 0, colour = `rgb(${rgb.join(' ')})`;

  return (
    <Switch.Root ref={root} render={<div />} data-lg-ring="" checked={on} onCheckedChange={set} disabled={disabled} name={name} className={className} aria-label={label}
      style={{position: 'relative', width: W, height: H, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', opacity: disabled ? 0.5 : undefined, '--lg-ring-right': `${TRACK_W - W}px`, ...style} as CSSProperties}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
      onClick={(e) => { if (e.detail !== 0) e.preventBaseUIHandler(); }}>
      { }
      <div style={{position: 'absolute', left: 0, top: 0, width: TRACK_W, height: H}} />
      <div data-lg-exact="" style={{position: 'absolute', inset: 0, translate: `${snap[0]}px ${snap[1]}px`, pointerEvents: 'none'}}>
        <img alt="" draggable={false} src={base.url} style={{position: 'absolute', ...at(base.x, base.y), width: base.w, height: base.h}} />
        {w && <div style={{position: 'absolute', ...at(clip.x, clip.y), width: clip.w, height: clip.h, maskImage: `url(${clip.url})`, maskSize: '100% 100%',
          backgroundImage: `linear-gradient(to right, ${colour} 0, ${colour} 63px, rgb(${rgb.join(' ')} / 0) 567px)`, backgroundSize: '630px 31px', backgroundRepeat: 'no-repeat',
          backgroundPosition: `${strip - clip.x}px ${-clip.y}px`}} />}
        {!lens.active && <img alt="" draggable={false} src={thumb.url} style={{position: 'absolute', ...at(kx - THUMB_W / 2 + thumb.x, ky - THUMB_H / 2 + thumb.y), width: thumb.w, height: thumb.h}} />}
        {lens.element(scheme as 'light' | 'dark', tint, lookOf(scheme as 'light' | 'dark', m.displayed, tint))}
      </div>
    </Switch.Root>
  );
}
