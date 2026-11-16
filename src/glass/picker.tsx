import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {RadioGroup} from '@base-ui/react/radio-group';
import {Radio} from '@base-ui/react/radio';
import {GlassLayer, useGlassScheme, useLayoutChanged} from './react';
import {commit, frameLoop} from './frame';
import {pixelsURL, supercircleField} from './supercircle';
import {lensClock, springAt, useLiquidLens, type LensSpec, type LensSpring} from './liquidLens';

const H = 32, FRAME_H = 31, PAD = 9, INSET = 2, LENS_H = H - 2 * INSET, FONT = 13;
const FILL = {light: 0.12, dark: 0.24}, FILL_RGB = [118, 118, 128];
const LINE = (dpr: number) => Math.ceil(FONT * (2444 / 2048) * dpr - 1e-9) / dpr;

const CAP_PATH: [number, ...number[]][] = [
  [0, 24.45864, 0], [1, 27.54136, 0], [3, 34.34924367429427, 0, 37.980662897960464, 0, 41.88972989328863, 1.2360378994757646],
  [3, 47.95984624390841, 3.445379569633953, 52, 9.215317103327825, 52, 15.674999999999995], [1, 52, 17.325000000000003],
  [3, 52, 23.784682896672173, 47.9598462439084, 29.55462043036605, 41.889729893288624, 31.76396210052424],
  [3, 37.980662897960464, 33, 34.34924367429427, 33, 27.08640522696189, 33], [1, 24.45864, 33],
  [3, 17.650756325705725, 33, 14.019337102039538, 33, 10.110270106711376, 31.76396210052424],
  [3, 4.040153756091595, 29.55462043036605, 0, 23.784682896672177, 0, 17.325000000000006], [1, 0, 15.675],
  [3, 0, 9.215317103327827, 4.040153756091595, 3.4453795696339493, 10.110270106711377, 1.2360378994757628],
  [3, 14.019337102039538, 0, 17.650756325705725, 0, 24.91359477303811, 0],
];
const CAP_W = 52, CAP_H = 33;

function capCoverage(dpr: number): {cov: Float32Array; w: number; h: number} {
  const poly: number[][] = []; let cur = [0, 0];
  for (const [t, ...v] of CAP_PATH) {
    if (t !== 3) { cur = [v[0], v[1]]; poly.push(cur); continue; }
    const [b0, b1, c0, c1, d0, d1] = v, a = cur;
    for (let i = 1; i <= 48; i++) { const s = i / 48, u = 1 - s; poly.push([u * u * u * a[0] + 3 * u * u * s * b0 + 3 * u * s * s * c0 + s * s * s * d0, u * u * u * a[1] + 3 * u * u * s * b1 + 3 * u * s * s * c1 + s * s * s * d1]); }
    cur = [d0, d1];
  }
  const w = Math.round(CAP_W * dpr), h = Math.round(CAP_H * dpr), S = 16, cov = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let j = 0; j < S; j++) {
    const sy = (y + (j + 0.5) / S) / dpr, xs: number[] = [];
    for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[k];
      if ((y0 > sy) !== (y1 > sy)) xs.push((x0 + ((sy - y0) * (x1 - x0)) / (y1 - y0)) * dpr);
    }
    xs.sort((p, q) => p - q);
    for (let n = 0; n + 1 < xs.length; n += 2) {
      const a = xs[n], b = xs[n + 1];
      for (let x = Math.max(0, Math.floor(a)); x < Math.min(w, Math.ceil(b)); x++) cov[y * w + x] += (Math.min(b, x + 1) - Math.max(a, x)) / S;
    }
  }
  return {cov, w, h};
}

const REST = {light: [255, 255, 255, 1], dark: [235, 235, 245, 0.3]};
const rests = new Map<string, {url: string; w: number; h: number}>();
function restOf(W: number, scheme: 'light' | 'dark', dpr: number) {
  const key = `${W} ${scheme} ${dpr}`, known = rests.get(key); if (known) return known;
  const whole = (n: number) => (Number.isInteger(dpr) ? Math.ceil(n / dpr) * dpr : n);
  const iw = whole(Math.ceil(W * dpr) + 2), ih = whole(Math.ceil(LENS_H * dpr) + 2), m = supercircleField(iw, ih, 1, 1, W * dpr, LENS_H * dpr, (LENS_H / 2) * dpr), c = REST[scheme];
  const px = new Uint8ClampedArray(iw * ih * 4);
  for (let i = 0; i < m.length; i++) { px[4 * i] = c[0]; px[4 * i + 1] = c[1]; px[4 * i + 2] = c[2]; px[4 * i + 3] = Math.round(m[i] * c[3] * 255); }
  const out = {url: pixelsURL(px, iw, ih), w: iw / dpr, h: ih / dpr}; rests.set(key, out); if (rests.size > 32) rests.delete(rests.keys().next().value!);
  return out;
}

const tracks = new Map<string, string>();
function trackURL(widths: number[], scheme: 'light' | 'dark', dpr: number): string {
  const key = `${widths} ${scheme} ${dpr}`, known = tracks.get(key); if (known) return known;
  const {cov, w: cw, h: ch} = capCoverage(dpr), a = FILL[scheme];
  const P = FILL_RGB.map((c) => (cov: number) => Math.round(cov * c * a) / 255), alpha = (c: number) => Math.round(c * a * 255) / 255;
  const half = cw / 2, oh = Math.round(H * dpr), cap = (ch - 2) / 2, scale = Math.min(1, oh / (2 * cap));
  const rowOf = (j: number) => { const y = j + 0.5; return (y < oh / 2 ? y / scale : ch - (oh - y) / scale) - 0.5; };
  const total = widths.reduce((s, v) => s + Math.round(v * dpr), 0), px = new Uint8ClampedArray(total * oh * 4);
  let x0 = 0;
  widths.forEach((wPt, k) => {
    const sw = Math.round(wPt * dpr), first = k === 0, last = k === widths.length - 1;
    for (let x = 0; x < sw; x++) {
      const col = first && x < half ? x : last && sw - 1 - x < half ? cw - (sw - x) : -1;
      for (let j = 0; j < oh; j++) {
        const r = Math.min(ch - 1, Math.max(0, rowOf(j))), r0 = Math.floor(r), r1 = Math.min(ch - 1, r0 + 1), f = r - r0;
        const c0 = col < 0 ? 1 : cov[r0 * cw + col], c1 = col < 0 ? 1 : cov[r1 * cw + col];
        const al = alpha(c0) * (1 - f) + alpha(c1) * f, i = 4 * (j * total + x0 + x);
        if (al <= 0) continue;
        for (let c = 0; c < 3; c++) px[i + c] = Math.round(((P[c](c0) * (1 - f) + P[c](c1) * f) / al) * 255);
        px[i + 3] = Math.round(al * 255);
      }
    }
    x0 += sw;
  });
  const url = pixelsURL(px, total, oh); tracks.set(key, url); if (tracks.size > 32) tracks.delete(tracks.keys().next().value!);
  return url;
}

const at = (x: number, y: number): CSSProperties => ({left: Math.floor(x), top: Math.floor(y), translate: `${x - Math.floor(x)}px ${y - Math.floor(y)}px`});
const DRAG = {response: 0.2, damping: 0.85}, SETTLE = {response: 0.4, damping: 0.85}, MARGIN = 70, LIFT: [number, number] = [24, 16];
const BOUNDS = {response: 0.25, damping: 1, impulse: 0};
const rubber = (r: number) => Math.sign(r) * 12 * (1 - 1 / (1 + (0.55 * Math.abs(r)) / 12));
const HIGHLIGHT = {light: 0.2, dark: 0.4};

const round = (v: number, dpr: number) => (Math.sign(v) * Math.round(Math.abs(v) * dpr)) / dpr;

/** A segment: its value, its label, and whether it is disabled. */
export type PickerOption<T> = {value: T; label: ReactNode; disabled?: boolean};
/** Props of `Picker`. */
export type PickerProps<T> = {
  /** The segments, in order. */
  options: PickerOption<T>[];
  /** The selected value, controlled. */
  selection?: T;
  /** The starting selection when uncontrolled (default the first). */
  defaultSelection?: T;
  /** Called with the new selection. */
  onChange?: (value: T) => void;
  /** The control's width in CSS px, shared equally by the segments. Default: each segment as wide as the widest label, plus padding. */
  width?: number;
  /** Dimmed; the selection can't change. */
  disabled?: boolean;
  style?: CSSProperties; className?: string; 'aria-label'?: string;
  /** Submits the selected index with its form. */
  name?: string;
};

/** A segmented control. Tap a segment, or drag the selection, which lifts into a glass lens while held. Arrow keys move the selection. */
export function Picker<T>({options, selection, defaultSelection, onChange, width, disabled = false, style, className, 'aria-label': label, name}: PickerProps<T>) {
  const scheme = useGlassScheme() as 'light' | 'dark', dpr = typeof window === 'undefined' ? 3 : window.devicePixelRatio || 3;
  const [own, setOwn] = useState<T | undefined>(defaultSelection ?? options[0]?.value), value = selection ?? own;
  const index = Math.max(0, options.findIndex((o) => Object.is(o.value, value)));
  const root = useRef<HTMLDivElement>(null), measurers = useRef<HTMLDivElement>(null), labels = useRef<(HTMLSpanElement | null)[]>([]);
  const [texts, setTexts] = useState<[number, number][]>([]);
  const [shown, setShown] = useState<number[]>([]);
  const [snap, setSnap] = useState<[number, number]>([0, 0]);
  const measure = () => {
    const el = root.current, pr = measurers.current; if (!el || !pr) return;
    const b = el.getBoundingClientRect(), k = b.width / (el.offsetWidth || 1);
    if (!(k > 0)) return;
    const to = (v: number) => (Math.floor(v * dpr + 0.5) - v * dpr) / dpr / k, p: [number, number] = [to(b.left), to(b.top)];
    setSnap((s) => (Math.abs(p[0] - s[0]) > 1e-6 || Math.abs(p[1] - s[1]) > 1e-6 ? p : s));
    const spans = [...pr.children] as HTMLElement[], t = options.map((_, i) => [spans[2 * i].getBoundingClientRect().width / k, spans[2 * i + 1].getBoundingClientRect().width / k] as [number, number]);
    setTexts((s) => (s.length === t.length && s.every((v, i) => Math.abs(v[0] - t[i][0]) + Math.abs(v[1] - t[i][1]) < 1e-3) ? s : t));
    const f = options.map((_, i) => (labels.current[i]?.getBoundingClientRect().width ?? 0) / k);
    setShown((s) => (s.length === f.length && s.every((v, i) => Math.abs(v - f[i]) < 1e-3) ? s : f));
  };
  useLayoutEffect(measure);
  const changed = useLayoutChanged();
  useLayoutEffect(() => { changed(); }, [snap[0], snap[1], shown.join(), texts.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const f = requestAnimationFrame(measure); document.fonts?.ready.then(measure); return () => cancelAnimationFrame(f); }, []);

  const n = options.length, fit = Math.max(...options.map((_, i) => Math.ceil(Math.max(...(texts[i] ?? [0, 0])) - 1e-6) + 2 * PAD), 16);
  const each = width !== undefined ? Math.floor(width / n) : fit, widths = options.map((_, i) => (i === n - 1 && width !== undefined ? width - each * (n - 1) : each));
  const xs = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0)), W = xs[n - 1] + widths[n - 1];
  const track = trackURL(widths, scheme, dpr), rest = restOf(widths[index] - 2 * INSET, scheme, dpr);
  const choose = (i: number) => { if (disabled || options[i]?.disabled) return; setOwn(options[i].value); if (!Object.is(options[i].value, value)) onChange?.(options[i].value); };
  const centre = (i: number) => xs[i] + widths[i] / 2;

  const [, redraw] = useState(0);
  const g = useRef({x: null as LensSpring | null, tracking: false, id: -1, origin: -1, selectedOrigin: false, highlighted: -1, offset: 0, lastX: 0, loop: frameLoop(() => root.current)}).current;
  const clock = lensClock;
  const xAt = (t: number) => (g.x ? springAt(g.x, t).value : centre(index));
  const aim = (target: number, cfg: {response: number; damping: number}, t: number) => {
    const p = g.x ? springAt(g.x, t) : {value: centre(index), velocity: 0};
    g.x = {from: p.value, v0: p.velocity, target, t0: t, ...cfg};
  };
  const lensSpec: LensSpec = {rest: [widths[index] - 2 * INSET, LENS_H], lifted: [widths[index] - 2 * INSET + LIFT[0], LENS_H + LIFT[1]], optical: [widths[index] - 2 * INSET + LIFT[0], LENS_H + LIFT[1]],
    shadow: false, warp: [0, 9], springs: {lift: BOUNDS, unlift: BOUNDS}, blur: 0, restColor: REST as Record<'light' | 'dark', number[]>, large: true};
  const lens = useLiquidLens(lensSpec, () => [xAt(clock()), H / 2], dpr);
  const tick = (): boolean => {
    const t = clock(), moving = !!g.x && (() => { const p = springAt(g.x!, t); return Math.abs(p.value - g.x!.target) > 1e-3 || Math.abs(p.velocity) > 1e-2; })();
    lens.moved();
    if (!moving && !g.tracking) g.x = null;
    commit(() => redraw((v) => v + 1));
    return moving;
  };
  const kick = () => g.loop.start(tick);
  useEffect(() => () => g.loop.stop(), []);
  const shownIndex = useRef(index);
  useEffect(() => { if (shownIndex.current !== index) { shownIndex.current = index; if (!g.tracking) { aim(centre(index), SETTLE, clock()); kick(); } } });

  const local = (e: React.PointerEvent) => { const r = root.current!.getBoundingClientRect(), k = r.width / (root.current!.offsetWidth || 1); return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]; };
  const segmentAt = (x: number, y: number, nearest: boolean, anywhere = false) => {
    if (!nearest && (x < 0 || x >= W || y < 0 || y >= H)) return -1;
    if (nearest && !anywhere && (x < -MARGIN || x >= W + MARGIN || y < -MARGIN || y >= H + MARGIN)) return -1;
    let i = xs.findIndex((v, k) => x >= v && x < v + widths[k]); if (i < 0) i = x < 0 ? 0 : n - 1;
    return options[i].disabled ? -1 : i;
  };
  const down = (e: React.PointerEvent) => {
    if (disabled || g.tracking) return;
    const [x, y] = local(e), i = segmentAt(x, y, false); if (i < 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    Object.assign(g, {tracking: true, id: e.pointerId, origin: i, selectedOrigin: i === index, highlighted: i, offset: 0, lastX: x});
    if (g.selectedOrigin) { lens.press(); aim(centre(index), DRAG, clock()); }
    kick();
  };
  const move = (e: React.PointerEvent) => {
    if (!g.tracking || e.pointerId !== g.id) return;
    const [x, y] = local(e);
    g.highlighted = segmentAt(x, y, true, g.selectedOrigin);
    if (g.selectedOrigin) {
      g.offset += x - g.lastX; g.lastX = x;
      const raw = centre(g.origin) + g.offset, lo = centre(0), hi = centre(n - 1);
      aim(raw < lo ? lo + rubber(raw - lo) : raw > hi ? hi + rubber(raw - hi) : raw, DRAG, clock());
    }
    kick();
  };
  const up = (e: React.PointerEvent) => {
    if (!g.tracking || e.pointerId !== g.id) return;
    const to = e.type === 'pointercancel' ? -1 : g.highlighted;
    g.tracking = false;
    const next = to >= 0 ? to : index;
    if (to >= 0 && !g.selectedOrigin) lens.press();
    lens.release();
    shownIndex.current = next;
    aim(centre(next), SETTLE, clock());
    if (to >= 0) choose(to);
    kick();
  };
  const ink = scheme === 'dark' ? '#fff' : '#000';

  return (
    <RadioGroup ref={root} data-lg-ring="within" className={className} aria-label={label} disabled={disabled} name={name} value={index} onValueChange={(v) => choose(v as number)}
      style={{position: 'relative', width: W, height: FRAME_H, opacity: disabled ? 0.5 : undefined, userSelect: 'none', touchAction: 'none', '--lg-ring-bottom': `${H - FRAME_H}px`, '--lg-corner': '9999px', ...style} as CSSProperties}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>
      <div ref={measurers} aria-hidden="true" style={{position: 'absolute', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: FONT}}>
        {options.map((o, i) => [<span key={`r${i}`} style={{position: 'absolute', fontWeight: 400}}>{o.label}</span>, <span key={`m${i}`} style={{position: 'absolute', fontWeight: 500}}>{o.label}</span>])}
      </div>
      <div data-lg-exact="" style={{position: 'absolute', left: 0, top: 0, width: W, height: H, translate: `${snap[0]}px ${snap[1]}px`}}>
        <img alt="" draggable={false} src={track} style={{position: 'absolute', left: 0, top: 0, width: W, height: H}} />
        {!lens.active && <img alt="" draggable={false} src={rest.url} style={{position: 'absolute', ...at(xAt(clock()) - widths[index] / 2 + INSET - 1 / dpr, INSET - 1 / dpr), width: rest.w, height: rest.h}} />}
        {
}
        {(() => {
          const labelsOf = (copy: boolean) => options.map((o, i) => {
            const tw = Math.ceil((shown[i] || texts[i]?.[i === index ? 1 : 0] || 0) * dpr - 1e-6) / dpr, left = round((widths[i] - tw) / 2, dpr);
            const label = <span ref={copy ? undefined : (e) => { labels.current[i] = e; }} data-lg-font="segment" style={{position: 'absolute', left: 0, top: 0, lineHeight: `${LINE(dpr)}px`, whiteSpace: 'nowrap', textAlign: 'center', fontSize: FONT, fontWeight: (g.tracking && g.selectedOrigin ? i === g.highlighted : i === index) ? 500 : 400, color: ink,
              opacity: g.tracking && !g.selectedOrigin && g.highlighted === i && i !== index ? HIGHLIGHT[scheme] : 1, transition: 'opacity .47s cubic-bezier(.25, .1, .25, 1)'}}>{o.label}</span>;
            const placed = <div style={{position: 'absolute', left: Math.floor(left), translate: `${left - Math.floor(left)}px 0`, top: round((H - LINE(dpr)) / 2, dpr)}}>{label}</div>;
            return copy ? <div key={i} aria-hidden="true" style={{position: 'absolute', ...at(xs[i], 0), width: widths[i], height: H}}>{placed}</div> : (
              <Radio.Root key={i} value={i} disabled={o.disabled} render={<div />} style={{position: 'absolute', ...at(xs[i], 0), width: widths[i], height: H}}>{placed}</Radio.Root>
            );
          });
          const Hl = LENS_H + LIFT[1];
          if (!lens.active) return <>{lens.element(scheme, 'default')}{labelsOf(false)}</>;
          const b = lens.bounds(), hole = `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${b.width}' height='${b.height}'><rect width='${b.width}' height='${b.height}' rx='${b.height / 2}'/></svg>`)}")`;
          return <>
            {lens.element(scheme, 'default', undefined, {children: labelsOf(true), lens: [0.2 * Hl, -Hl / 4], size: [W, H]})}
            <GlassLayer style={{position: 'absolute', left: 0, top: 0, width: W, height: H, maskImage: `linear-gradient(#000, #000), ${hole}`, maskComposite: 'exclude',
              maskPosition: `0 0, ${b.left}px ${b.top}px`, maskSize: `100% 100%, ${b.width}px ${b.height}px`, maskRepeat: 'no-repeat'}}>{labelsOf(false)}</GlassLayer>
          </>;
        })()}
      </div>
    </RadioGroup>
  );
}
