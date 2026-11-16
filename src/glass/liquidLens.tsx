import {useEffect, useRef, useState, type ReactNode} from 'react';
import {commit, frameLoop, frameNow} from './frame';
import {Glass, useFrameScope, useGlassPlatform, useParityGlyphs} from './react';
import type {LensFrame} from './lensGPU';
import {Flex} from './motion/flex.js';
import {supercircleField} from './supercircle';
import {shadowA8 as caShadowA8, shadowOpacity as caShadowOpacity} from './render/shadow.ts';
import type {Platform} from './platform/types.ts';
import {IOS26_5} from './platform/ios26_5.ts';

export const lensClock = () => ((window as unknown as {__lensNow?: number}).__lensNow ?? frameNow()) / 1000;
export type LensSpring = {from: number; v0: number; target: number; t0: number; response: number; damping: number};
export function springAt(s: LensSpring, t: number) {
  const w = (2 * Math.PI) / s.response, z = s.damping, a = s.from - s.target, dt = Math.max(0, t - s.t0);
  if (z >= 1) { const b = s.v0 + w * a, e = Math.exp(-w * dt); return {value: s.target + (a + b * dt) * e, velocity: (s.v0 - w * b * dt) * e}; }
  const wd = w * Math.sqrt(1 - z * z), b = (s.v0 + z * w * a) / wd, e = Math.exp(-z * w * dt), c = Math.cos(wd * dt), sn = Math.sin(wd * dt), p = a * c + b * sn;
  return {value: s.target + e * p, velocity: e * (-z * w * p + wd * (-a * sn + b * c))};
}
export type RestImage = {px: Uint8ClampedArray; iw: number; ih: number; x: number; y: number};
const rests = new Map<string, RestImage>();
export function restImage(W: number, H: number, dpr: number, shadow: boolean, p: Platform = IOS26_5): RestImage {
  const key = `${W} ${H} ${dpr} ${shadow} ${p.build}`, known = rests.get(key); if (known) return known;
  const whole = (n: number) => (Number.isInteger(dpr) ? Math.ceil(n / dpr) * dpr : n);
  let out: RestImage;
  if (!shadow) {
    const IX = -1, IY = -1, iw = whole(Math.ceil(W * dpr) + 2), ih = whole(Math.ceil(H * dpr) + 2), m = supercircleField(iw, ih, 1, 1, W * dpr, H * dpr, (H / 2) * dpr);
    const px = new Uint8ClampedArray(iw * ih * 4);
    for (let i = 0; i < m.length; i++) { px[4 * i] = px[4 * i + 1] = px[4 * i + 2] = 255; px[4 * i + 3] = Math.round(m[i] * 255); }
    out = {px, iw, ih, x: IX, y: IY};
  } else {
    const S = p.lens.restShadow, A = caShadowA8({width: W, height: H, radius: S.radius, cornerRadius: H / 2, inputScale: dpr, flag5: true, curve: 'continuous'});
    const [dx, dy] = A.origin.map((v: number) => v * dpr), [dw, dh] = A.extent.map((v: number) => v * dpr), off = S.offset * dpr, op = caShadowOpacity(S.opacity);
    const IX = Math.floor(dx), IY = Math.floor(dy), iw = whole(Math.ceil(dx + dw) - IX), ih = whole(Math.ceil(dy + dh + off) - IY);
    const fw = W * dpr, fh = H * dpr, fill = supercircleField(iw, ih, -IX, -IY, fw, fh, fh / 2);
    const sample = (bytes: Uint8Array, w: number, h: number, u: number, v: number) => {
      const x = Math.min(w - 1, Math.max(0, u * w - 0.5)), y = Math.min(h - 1, Math.max(0, v * h - 0.5)), x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
      const g = (xx: number, yy: number) => bytes[yy * w + xx] / 255;
      return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
    };
    const px = new Uint8ClampedArray(iw * ih * 4);
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
      const X = IX + x + 0.5, Y = IY + y + 0.5, i = y * iw + x;
      const b = sample(A.bytes, A.size[0], A.size[1], (X - dx) / dw, (Y - off - dy) / dh), m = sample(A.rasterBytes, A.rasterSize[0], A.rasterSize[1], (X - dx) / dw, (Y - dy) / dh);
      const a = op * b * (1 - m), c = fill[i], alpha = c + (1 - c) * a;
      if (alpha <= 0) continue;
      px[4 * i] = px[4 * i + 1] = px[4 * i + 2] = Math.round((255 * c) / alpha); px[4 * i + 3] = Math.round(alpha * 255);
    }
    out = {px, iw, ih, x: IX, y: IY};
  }
  rests.set(key, out); if (rests.size > 64) rests.delete(rests.keys().next().value!);
  return out;
}

export type LensSpec = {rest: [number, number]; lifted: [number, number]; optical: [number, number]; shadow: boolean; warp: [number, number];
  springs?: {lift: {response: number; damping: number; impulse: number}; unlift: {response: number; damping: number; impulse: number}};
  blur?: number;
  restColor?: Record<'light' | 'dark', number[]>;
  large?: boolean;
  backdrop?: {blur: number; matrix: Record<'light' | 'dark', number[]>}};
export type LensLook = {key: number[]; shadow: number[]};

export type LensOuter = () => {centre: number[]; scale: number[]; translation: number[]} | null;
export function useLiquidLens(spec: LensSpec, centre: () => number[], dpr: number, outer?: LensOuter) {
  const [, redraw] = useState(0), scope = useFrameScope(), platform = useGlassPlatform(), L = platform.lens;
  const at = useRef(centre); at.current = centre;
  const parityGlyphs = useParityGlyphs();
  const lens = useRef({last: null as {key: string; frame: LensFrame; motion: unknown} | null, spring: null as LensSpring | null, issued: null as number | null, live: false, lifted: false, acceptedAt: 0, fallAt: null as number | null, falling: false, recipe: spec.rest[1], loop: frameLoop(scope), timer: 0,
    flex: null as Flex | null, prev: null as number[] | null, pose: {scale: [1, 1], translation: [0, 0]}}).current;
  const [RW, RH] = spec.rest, [LW, LH] = spec.lifted, [OW, OH] = spec.optical;
  const clock = lensClock;
  const progress = (t: number) => (lens.spring ? springAt(lens.spring, t) : {value: 0, velocity: 0});
  const retarget = (target: number, t: number) => {
    const p = progress(t), c = target ? spec.springs?.lift ?? L.lift : spec.springs?.unlift ?? L.unlift, w = (2 * Math.PI) / c.response;
    lens.spring = {from: p.value, v0: p.velocity + c.impulse * w * w * (target - (lens.spring?.target ?? 0)), target, t0: t, response: c.response, damping: c.damping};
    lens.live = true;
  };
  const since = (at: number) => (lens.spring && lens.live && lens.issued !== null && lens.issued <= at ? lens.issued : at);
  const kick = () => { clearTimeout(lens.timer); lens.loop.start(tick); };
  const tick = (): boolean => {
    const t = clock();
    if (lens.fallAt !== null && t >= lens.fallAt) {
      const at = since(lens.fallAt);
      lens.recipe = RH + (OH - RH) * progress(at).value;
      lens.lifted = false; lens.falling = true; retarget(0, at); lens.fallAt = null;
      if (lens.flex) { lens.flex.up(at); lens.flex.resize([RW, RH]); }
    }
    const c = at.current();
    if (lens.flex) {
      const p = lens.prev ?? c, o = outer?.(), w = o ? p.map((v, i) => o.centre[i] + (v - o.centre[i]) * o.scale[i] + o.translation[i]) : p;
      const f = lens.flex.frame(t, w, o ? o.scale : null); lens.pose = {scale: f.scale, translation: f.translation.map((v, i) => v * f.scale[i])};
    }
    lens.prev = c;
    const p = progress(t), s = lens.spring!, still = Math.abs(p.value - s.target) < 1e-4 && Math.abs(p.velocity) < 1e-3, flexing = !!lens.flex && !lens.flex.settled;
    let again = false;
    if (flexing) again = true;
    else if (still && !lens.lifted) { lens.spring = null; lens.falling = false; lens.flex = null; lens.prev = null; lens.pose = {scale: [1, 1], translation: [0, 0]}; }
    else if (still) {
      lens.spring = {...s, from: s.target, v0: 0, t0: t}; lens.live = false;
      if (lens.fallAt !== null) lens.timer = window.setTimeout(() => lens.loop.start(tick), Math.max(0, (lens.fallAt - clock()) * 1000));
    } else again = true;
    lens.issued = lens.spring ? t : null;
    commit(() => redraw((n) => n + 1));
    return again;
  };
  useEffect(() => () => { lens.loop.stop(); clearTimeout(lens.timer); }, [lens]);

  const press = () => {
    if (!lens.lifted) { const t = clock(); lens.lifted = true; lens.falling = false; lens.acceptedAt = t; lens.fallAt = null; retarget(1, since(t)); kick(); }
    lens.flex ??= new Flex([LW, LH], dpr, 'lens', platform);
    lens.flex.resize([LW, LH]); lens.flex.down(at.current(), clock());
  };
  const release = () => {
    if (lens.lifted && lens.fallAt === null) lens.fallAt = Math.max(clock(), lens.acceptedAt + L.hang);
    if (lens.spring) kick();
  };
  const moved = () => { if (lens.spring) kick(); };

  const bounds = () => {
    const q = progress(clock()).value, rw = RW + q * (LW - RW), rh = RH + q * (LH - RH), [cx, cy] = at.current();
    return {left: cx - rw / 2, top: cy - rh / 2, width: rw, height: rh};
  };
  const element = (scheme: 'light' | 'dark', tint: string, look?: LensLook, content?: {children: ReactNode; lens?: [number, number]; size?: [number, number]}) => {
    if (!lens.spring) return null;
    const q = progress(clock()).value, orange = tint === 'orange';
    const rw = RW + q * (LW - RW), rh = RH + q * (LH - RH), ow = RW + q * (OW - RW), oh = RH + q * (OH - RH);
    const [cx, cy] = at.current(), box = {left: cx - rw / 2, top: cy - rh / 2, width: ow, height: oh};
    const rest = 1 - q;
    let image: LensFrame['rest']['image'] = null;
    if (rest * 255 >= 0.5 && !spec.backdrop) {
      const r = restImage(ow, oh, dpr, spec.shadow, platform), data = new Uint8ClampedArray(r.px.length), c = spec.restColor?.[scheme] ?? [255, 255, 255, 1];
      for (let i = 0; i < data.length; i += 4) {
        const a = (r.px[i + 3] / 255) * c[3];
        data[i] = r.px[i] * (c[0] / 255) * a; data[i + 1] = r.px[i + 1] * (c[1] / 255) * a; data[i + 2] = r.px[i + 2] * (c[2] / 255) * a; data[i + 3] = Math.round(a * 255);
      }
      image = {key: `${ow} ${oh} ${dpr} ${spec.shadow} ${c}`, data, w: r.iw, h: r.ih, x: r.x, y: r.y};
    }
    let frame: LensFrame = {tint: orange ? 'orange' : 'default', provider: Math.max(0, Math.min(1, q)), recipe: lens.falling ? lens.recipe : RH + (OH - RH) * q,
      inner: [L.inner.opacity * q, Math.max(0, L.inner.radius * q), L.inner.offset * q], key: look?.key ?? L.key[orange ? `${scheme}/orange` : scheme] as number[], fill: L.fill[scheme] as number[], rest: {opacity: rest, image, backdrop: spec.backdrop ? {blur: spec.backdrop.blur, matrix: spec.backdrop.matrix[scheme], size: [RW, RH]} : undefined},
      shadow: look?.shadow, warp: spec.warp[0] + (spec.warp[1] - spec.warp[0]) * q, blur: Math.max(0, (spec.blur ?? L.blur) * (1 - q)), large: spec.large ? {H: OH, q, curvature: lens.lifted ? L.curvature.lifted : L.curvature.rest} : undefined};
    const [sx, sy] = lens.pose.scale, off = [(ow - rw) / 2, (oh - rh) / 2];
    let motion = {scale: [sx, sy] as [number, number], translation: [lens.pose.translation[0] + (1 - sx) * -off[0], lens.pose.translation[1] + (1 - sy) * -off[1]] as [number, number], shape: 1};
    const lensed = content?.lens && content.size && !parityGlyphs();
    const key = JSON.stringify([frame, motion], (k, v) => (k === 'data' ? undefined : v));
    if (lens.last?.key === key) { frame = lens.last.frame; motion = lens.last.motion as typeof motion; } else lens.last = {key, frame, motion};
    return <Glass lens={frame} radius="capsule" motion={motion} style={{position: 'absolute', ...box, pointerEvents: 'none'}}
      {...(content?.lens && !lensed ? {'data-lg-layer': '1 1 0', 'data-lg-lens': `${content.lens[0]} ${content.lens[1] * q}`} : {})}>
      {lensed ? (
        <div data-lg-layer="1 1 0" data-lg-lens={`${content.lens![0]} ${content.lens![1] * q}`} style={{position: 'absolute', left: -box.left, top: -box.top, width: content.size![0], height: content.size![1], pointerEvents: 'none'}}>
          <span {...({drawable: ''} as Record<string, string>)} data-lg-item="" style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>{content.children}</span>
        </div>
      ) : content && <div style={{position: 'absolute', left: -box.left, top: -box.top}}>{content.children}</div>}
    </Glass>;
  };
  return {get active() { return !!lens.spring; }, get lifted() { return lens.lifted; }, press, release, moved, element, bounds};
}
