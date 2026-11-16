import {fma64} from '../math.js';

const f = Math.fround, DBL_MAX = Number.MAX_VALUE;
export type BlurContribution = {shadow: number; bleed: number; radius: number; uniform: boolean; minimumOperand: number};

const log2f = (v: number) => f(Math.log2(f(v)));
const fcvtzu32 = (v: number) => Number.isNaN(v) || v <= 0 ? 0 : v >= 2 ** 32 ? 0xffffffff : Math.trunc(v) >>> 0;
const maxnm = (a: number, b: number) => Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.max(a, b);
const minnm = (a: number, b: number) => Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.min(a, b);
const sized = (w: number, h: number) => maxnm(w, h) < DBL_MAX && minnm(w, h) > 0;
const round32 = (v: number) => Number.isNaN(v) ? 0 : Math.trunc(v + (v < 0 ? -0.5 : 0.5)) | 0;

export function backdropDomain({rect, dpr, target, sourceScale, margin, blur}: {rect: {x: number; y: number; w: number; h: number}; dpr: number; target: readonly number[];
  sourceScale: number; margin: number; blur: BlurContribution}) {
  const cx = (rect.x + rect.w / 2) / dpr, cy = (rect.y + rect.h / 2) / dpr, w = rect.w / dpr, h = rect.h / dpr;
  const x0 = 0 + cx - w / 2, y0 = 0 + cy - h / 2, root = [x0, y0, 0 + cx + w / 2 - x0, 0 + cy + h / 2 - y0];
  if (!(root[2] > 0 && root[3] > 0)) throw new RangeError('positive participating entry dimensions required');

  let maximum = 0, minimum = 3.4028234663852886e38;
  for (const v of [blur.shadow, blur.bleed, blur.radius]) if (maximum < v) maximum = v;
  if (blur.uniform) minimum = blur.radius; else for (const v of [blur.shadow, blur.bleed, blur.minimumOperand]) if (minimum > v) minimum = v;
  const combined = f(dpr * f(sourceScale)), max32 = f(maximum);
  const [blurMin, blurMax] = max32 === 0 ? [0, 0] : [f(f(minimum) * combined), f(max32 * combined)];
  if (![blurMin, blurMax].every(Number.isFinite)) throw new RangeError('nonfinite blur scale is outside this finite translation');

  if (!Object.is(f(margin), margin)) throw new TypeError('a finite float32 margin required');
  const m = -margin, out = [...root];
  if (Math.max(root[2], root[3]) < DBL_MAX) {
    out[0] += m; out[1] += m; out[2] = root[2] - (m + m); out[3] = m * -2 + root[3];
    if (out[2] <= 0 || out[3] <= 0) out[2] = out[3] = 0;
  }
  const screen = out.map((v) => v * dpr);
  if (!(screen[2] > 0 && screen[3] > 0)) return null;
  const sx = Math.max(screen[0], 0), sy = Math.max(screen[1], 0), ex = Math.min(screen[0] + screen[2], target[0]), ey = Math.min(screen[1] + screen[3], target[1]);
  if (!(ex - sx > 0 && ey - sy > 0)) return null;

  if (!Object.is(f(sourceScale), sourceScale)) throw new TypeError('a finite float32 source scale required');
  let r = [sx, sy, ex - sx, ey - sy];
  if (sourceScale !== 1) r = [r[0] * sourceScale, r[1] * sourceScale, r[2] * sourceScale, r[3] * sourceScale];
  if (sized(r[2], r[3])) { const e = [r[0] + r[2], r[1] + r[3]]; r[0] = Math.ceil(r[0]); r[1] = Math.ceil(r[1]); r[2] = Math.floor(e[0]) - r[0]; r[3] = Math.floor(e[1]) - r[1]; }
  if (r[2] === 0 || r[3] === 0) return null;
  const lo = (v: number) => Math.floor(Math.max(v, -536870911)), hi = (v: number) => Math.ceil(Math.min(v, 536870912));
  const candidate = [lo(r[0]), lo(r[1]), hi(r[0] + r[2]) - lo(r[0]), hi(r[1] + r[3]) - lo(r[1])];
  if (candidate[2] <= 0 || candidate[3] <= 0) return null;
  if (!(blurMin >= 0 && blurMax >= blurMin)) throw new RangeError('ordered finite nonnegative prepare blur scalars required');

  const blurScale = f(blurMax * f(1.6));
  const dimensionLevels = fcvtzu32(f(Math.floor(log2f(f(Math.max(candidate[2] >>> 0, candidate[3] >>> 0)))) + 1));
  let blurLevels = fcvtzu32(f(maxnm(f(Math.ceil(log2f(blurScale))), 0) + 1));
  if (blurLevels === 1 && blurScale !== 0) blurLevels = 2;
  const stableMipLevels = Math.min(dimensionLevels, blurLevels) >>> 0, divisor = 2 ** Math.min(stableMipLevels, 7);
  let b = Math.max(candidate[2], candidate[3]) > 0x3ffffffe ? [-DBL_MAX / 2, -DBL_MAX / 2, DBL_MAX, DBL_MAX] : [...candidate];
  if (sized(b[2], b[3])) {
    const outset = -blurMax * 2.8, ew = fma64(-blurMax, -5.6, b[2]), eh = fma64(-blurMax, -5.6, b[3]), keep = !(0 >= minnm(ew, eh));
    b = [b[0] + outset, b[1] + outset, keep ? ew : 0, keep ? eh : 0];
  }
  const scale = (k: number) => { if (b[2] < DBL_MAX) { b[0] = k * b[0]; b[2] = k * b[2]; } if (b[3] < DBL_MAX) { b[1] = k * b[1]; b[3] = k * b[3]; } };
  if (divisor !== 1) scale(1 / divisor);
  if (sized(b[2], b[3])) { const x = Math.floor(b[0]), y = Math.floor(b[1]); b = [x, y, Math.ceil(b[0] + b[2]) - x, Math.ceil(b[1] + b[3]) - y]; }
  if (stableMipLevels !== 0) scale(divisor);
  const source = !(maxnm(b[2], b[3]) < 0x3fffffff) ? [-0x1fffffff, -0x1fffffff, 0x3fffffff, 0x3fffffff]
    : [round32(b[0]), round32(b[1]), (round32(b[0] + b[2]) - round32(b[0])) | 0, (round32(b[1] + b[3]) - round32(b[1])) | 0];
  return {candidateBounds: candidate, sourceBounds: source, stableMipLevels};
}
