import {fma64 as fma} from '../math.js';

const f = Math.fround;
type P = number[];
export type PathCommand = {type: 'move' | 'line' | 'cubic' | 'close'; points: P[]};


const CONTINUOUS = [1.528665, 1.08849, 0.868407, 0.631494, 0.372824, 0.16906, 0.0749114, 0, 0, 0];
const CIRCULAR = [1, 0.8732602355268562, 0.7476756885741366, 0.6299337664259247, 0.37476586421208946, 0.1726399214289621, 0.07099462715854132, 0.024092519875899457, 0, 0];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export function roundedShadowPath(width: number, height: number, radius: number, curve: 'continuous' | 'circular' = 'continuous'): PathCommand[] {
  if (![width, height, radius].every(Number.isFinite) || width <= 0 || height <= 0 || radius <= 0) throw new RangeError('positive rounded rectangle required');
  const rx = Math.min(width / 2, radius), ry = Math.min(height / 2, radius);
  const table = (size: number, r: number) => { const t = curve === 'continuous' ? clamp01(2.8915749252827907 - 0.9457874626413953 * size / r) : 1; return CONTINUOUS.map((v, i) => v + (CIRCULAR[i] - v) * t); };
  const X = table(width, rx), Y = table(height, ry);
  const quarter = (reverse: boolean): P[] => [[Y[9] * rx, Y[0] * ry], [Y[8] * rx, Y[1] * ry], [Y[7] * rx, Y[2] * ry], [Y[6] * rx, Y[3] * ry], [(reverse ? X : Y)[5] * rx, Y[4] * ry],
    [X[4] * rx, (reverse ? X : Y)[5] * ry], [X[3] * rx, X[6] * ry], [X[2] * rx, X[7] * ry], [X[1] * rx, X[8] * ry], [X[0] * rx, X[9] * ry]];
  const corners = [quarter(false), quarter(true).reverse().map(([x, y]) => [width - x, y]), quarter(false).map(([x, y]) => [width - x, height - y]), quarter(true).reverse().map(([x, y]) => [x, height - y])];
  const commands: PathCommand[] = [];
  corners.forEach((points, i) => {
    commands.push({type: i ? 'line' : 'move', points: [points[0]]});
    for (let j = 1; j < 10; j += 3) commands.push({type: 'cubic', points: points.slice(j, j + 3)});
  });
  commands.push({type: 'close', points: []});
  return commands;
}
export function shadowCirclePath(side: number) {
  if (!Number.isFinite(side) || side <= 0) throw new RangeError('positive finite square size required');
  const radius = side * 0.5, t = CONTINUOUS.map((v, i) => fma(CIRCULAR[i] - v, 1, v));
  const at = (corner: number, i: number) => {
    const x = t[9 - i], y = t[i];
    return corner === 0 ? [fma(x, radius, 0), fma(y, radius, 0)] : corner === 1 ? [fma(-y, radius, side), fma(x, radius, 0)]
      : corner === 2 ? [fma(-x, radius, side), fma(-y, radius, side)] : [fma(y, radius, 0), fma(-x, radius, side)];
  };
  const commands = [1], points = [at(0, 0)];
  for (let corner = 0; corner < 4; corner++) {
    if (corner) { commands.push(2); points.push(at(corner, 0)); }
    for (let segment = 0; segment < 3; segment++) { commands.push(4); for (let i = 1; i <= 3; i++) points.push(at(corner, segment * 3 + i)); }
  }
  commands.push(0);
  return {commands, points};
}


const mix = (a: P, b: P, t: number) => a.map((v, i) => v + (b[i] - v) * t);
function split(p: P[], t: number) {
  const a = mix(p[0], p[1], t), b = mix(p[1], p[2], t), c = mix(p[2], p[3], t), d = mix(a, b, t), e = mix(b, c, t), m = mix(d, e, t);
  return [[p[0], a, d, m], [m, e, c, p[3]]];
}
const poly = (p: P[], i: number) => [p[0][i], 3 * (p[1][i] - p[0][i]), 3 * (p[2][i] - 2 * p[1][i] + p[0][i]), p[3][i] - 3 * p[2][i] + 3 * p[1][i] - p[0][i]];
function areaTo(p: P[], t: number) {
  const X = poly(p, 0), Y = poly(p, 1);
  let area = 0;
  for (let i = 0; i < 4; i++) for (let j = 1; j < 4; j++) area += X[i] * j * Y[j] * t ** (i + j) / (i + j);
  return area;
}
function quadraticEdge(p: P[]) {
  const [[a, b], [c, d], [e, g], [h, i]] = p;
  const A = 0.9 * (g * (c + a - 2 * h) + i * (2 * e + c - 3 * a) + b * (3 * h - 2 * c - e) + d * (2 * a - e - h)) / (b - i) ** 3;
  const B = (a - h + A * (i * i - b * b)) / (b - i), C = a - (A * b + B) * b;
  return [A, B, C];
}
function reciprocalEstimate(x: number) {
  const exponent = Math.floor(Math.log2(x)), bucket = Math.floor(x / 2 ** (exponent + 1) * 512);
  return Math.floor(262144 / (2 * bucket + 1) + 0.5) / 256 * 2 ** (-exponent - 1);
}
function yExtrema(p: P[]) {
  const [, c, b, a] = poly(p, 1), A = 3 * a, B = 2 * b, roots: number[] = [];
  if (A === 0) { if (B !== 0) roots.push(-c / B); }
  else { const d = B * B - 4 * A * c; if (d >= 0) { const q = -0.5 * (B + Math.sign(B || 1) * Math.sqrt(d)); if (q !== 0) roots.push(q / A, c / q); } }
  return roots.filter((t) => t > 1e-6 && t < 1 - 1e-6).sort((x, y) => x - y).filter((t, i, r) => !i || t - r[i - 1] > 1e-6);
}
export function rasterizeShadowPath({commands, width, height, origin = [0, 0], scale = 1}: {commands: PathCommand[]; width: number; height: number; origin?: number[]; scale?: number}) {
  type Edge = {low: number; high: number; A: number; B: number; C: number; sign: number};
  const edges: Edge[] = [];
  let last: P | undefined, start: P | undefined;
  const edge = (p: P[], [A, B, C]: number[]) => {
    const a = p[0], b = p[p.length - 1], low = Math.min(a[1], b[1]), high = Math.max(a[1], b[1]);
    if (f(low) >= f(high)) return;
    edges.push({low: f(low), high: f(high), A: f(A), B: f(2 * A * low + B), C: f((A * low + B) * low + C), sign: Math.sign(b[1] - a[1])});
  };
  const line = (a: P, b: P) => { if (Math.abs(a[1] - b[1]) < 1e-6) return; const B = (b[0] - a[0]) / (b[1] - a[1]); edge([a, b], [0, B, b[0] - B * b[1]]); };
  const monotonic = (p: P[], depth = 0): void => {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
    const flat = Math.max((x0 - 2 * x1 + x2) ** 2 + (y0 - 2 * y1 + y2) ** 2, (x1 - 2 * x2 + x3) ** 2 + (y1 - 2 * y2 + y3) ** 2) <= 0.125 ** 2;
    if (Math.abs(y0 - y3) < 0.0001 || depth >= 127 || flat) { line(p[0], p[3]); return; }
    const abc = quadraticEdge(p), [A, B, C] = abc, primitive = (y: number) => A / 3 * y ** 3 + B / 2 * y * y + C * y;
    const ts = [0, 1 / 3, 2 / 3, 1], points = ts.map((t) => split(p, t)[0][3]);
    const residual = ts.map((t, j) => areaTo(p, t) - primitive(points[j][1]) + primitive(y0));
    if ([0, 1, 2].some((j) => Math.abs((residual[j + 1] - residual[j]) / Math.hypot(points[j + 1][0] - points[j][0], points[j + 1][1] - points[j][1])) > 0.125))
      for (const half of split(p, 0.5)) monotonic(half, depth + 1);
    else edge(p, abc);
  };
  const cubic = (p: P[]) => {
    let previous = 0;
    for (const t of yExtrema(p)) { const [left, right] = split(p, (t - previous) / (1 - previous)); monotonic(left); p = right; previous = t; }
    monotonic(p);
  };
  for (const c of commands) {
    const p = c.points.map((q) => q.map((v) => v * scale));
    if (c.type === 'move') { if (last && start) line(last, start); last = start = p[0]; }
    else if (c.type === 'line') { line(last!, p[0]); last = p[0]; }
    else if (c.type === 'cubic') { cubic([last!, ...p]); last = p[2]; }
    else { line(last!, start!); last = start; }
  }
  const bytes = new Uint8Array(width * height);
  for (let yy = 0; yy < height; yy++) {
    const y = yy + origin[1], spans: {xmin: number; xmax: number; reciprocal: number; height: number}[] = [];
    for (const e of edges) {
      const lo = Math.max(y, e.low), hi = Math.min(y + 1, e.high);
      if (hi <= lo) continue;
      const at = (v: number) => { const t = f(v - e.low); return f(f(t * e.A + e.B) * t + e.C); };
      const xl = at(lo), xh = at(hi), xmin = Math.min(xl, xh), xmax = Math.max(xl, xh), span = f(Math.max(f(xmax - xmin), f(1e-6)));
      spans.push({xmin, xmax, reciprocal: reciprocalEstimate(span), height: f(e.sign * f(hi - lo))});
    }
    spans.sort((a, b) => a.xmin - b.xmin || a.xmax - b.xmax);
    for (let xx = 0; xx < width; xx++) {
      const x = xx + origin[0];
      let sum = 0;
      for (const e of spans) {
        if (e.xmax <= x) { sum = f(sum + e.height); continue; }
        if (e.xmin >= x + 1) continue;
        const lo = Math.max(x, e.xmin), hi = Math.min(x + 1, e.xmax);
        const area = f(f(f(lo - hi) * e.reciprocal) * f(f(-0.5 * f(hi + lo)) + e.xmin) + (x + 1 - hi));
        sum = f(e.height * area + sum);
      }
      bytes[yy * width + xx] = Math.trunc(f(Math.min(1, Math.abs(sum)) * f(255.99)));
    }
  }
  return bytes;
}


export function a8Kernel(sigma: number) {
  if (!Number.isFinite(sigma) || sigma <= 0 || sigma > 8) throw new RangeError('the direct Gaussian needs 0 < sigma <= 8');
  const support = Math.ceil(f(2.5 * sigma));
  const values = Array.from({length: 2 * support + 1}, (_, i) => Math.exp(-0.5 * (i - support) ** 2 / (sigma * sigma)) * (0.3989422804014327 / sigma));
  const sum = values.reduce((a, b) => a + b, 0), divisor = 16384;
  return {support, divisor, weights: values.map((v) => Math.trunc(v * divisor / sum))};
}
export function convolveA8({input, width, height, kernel: {weights, divisor, support}}: {input: Uint8Array; width: number; height: number; kernel: ReturnType<typeof a8Kernel>}) {
  if (input.length !== width * height || width <= 0 || height <= 0) throw new RangeError('packed A8 image required');
  const horizontal = new Uint8Array(input.length), output = new Uint8Array(input.length);
  for (let axis = 0; axis < 2; axis++) {
    const src = axis ? horizontal : input, dst = axis ? output : horizontal;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let i = 0; i < weights.length; i++) {
        const xx = x + (axis ? 0 : i - support), yy = y + (axis ? i - support : 0);
        if (xx >= 0 && xx < width && yy >= 0 && yy < height) sum += src[yy * width + xx] * weights[i];
      }
      dst[y * width + x] = Math.min(255, Math.floor((sum + divisor / 2) / divisor));
    }
  }
  return output;
}
function resamplingFilter(scale: number) {
  scale = f(scale);
  const inverse = 1 / scale, count = Math.trunc(6 / Math.min(1, scale) + 0.5);
  const bits = Math.min(6, Math.max(0, 6 - Math.floor(Math.log2(f(inverse))))), rows: number[][] = [];
  for (let phase = 0; phase < 2 ** bits; phase++) {
    const weights: number[] = [];
    let total = 0;
    for (let j = 0; j < count; j++) {
      const x = f(f(1 - count * 0.5 - phase / 2 ** bits + j) * Math.min(1, scale)), angle = f(x * f(Math.PI));
      const w = Math.abs(x) >= 3 ? 0 : Math.abs(x) < 2 ** -24 ? 1 : f(f(f(Math.sin(angle)) * f(Math.sin(f(angle / 3)))) / f(f(x * f(angle * f(Math.PI))) / 3));
      weights.push(w); total = f(total + w);
    }
    const reciprocal = f(1 / total);
    for (let j = 0; j < count; j++) weights[j] = f(weights[j] * reciprocal);
    let bias = f(0.5), step = f(0.25), taps: number[];
    for (;;) {
      taps = weights.map((w) => Math.trunc(f(w * 16384 + bias)));
      const residual = 16384 - taps.reduce((s, w) => s + w, 0), next = f(bias + (residual > 0 ? step : -step));
      step = f(step * 0.5);
      if (Math.abs(residual) < 2 || next === bias) {
        let largest = 0;
        for (let j = 1; j < count; j++) if (Math.abs(taps[j]) > Math.abs(taps[largest])) largest = j;
        taps[largest] += residual;
        break;
      }
      bias = next;
    }
    rows.push(taps);
  }
  return {count, bits, rows};
}
function resamplingWeights(n: number, m: number, vertical: boolean) {
  const scale = f(m / n), inverse = 1 / scale, {count, bits, rows} = resamplingFilter(scale);
  const step = Math.trunc(inverse * 2 ** 32), pad = vertical ? Math.ceil(scale * Math.floor((count + 1) / 2)) : 0, intermediate = vertical ? Math.ceil(scale * n) + 2 * pad : 0;
  const translate = vertical ? (n - intermediate) * scale + pad : 0, center = vertical ? (intermediate - 0.5) * (1 - inverse) + translate * inverse : inverse * 0.5 - 0.5;
  const initial = Math.trunc((center - count * 0.5 + 1) * 2 ** 32) + (vertical ? intermediate - m - pad : 0) * step, out: number[][][] = [];
  for (let i = 0; i < m; i++) {
    const position = initial + i * step + (vertical ? 0 : 2 ** (31 - bits)), base = Math.floor(position / 2 ** 32), phase = Math.floor((position - base * 2 ** 32) / 2 ** (32 - bits));
    out.push(rows[phase].map((w, j) => [Math.max(0, Math.min(n - 1, base + j)), w]));
  }
  return out;
}
function resampleA8(input: Uint8Array, width: number, height: number, outWidth: number, outHeight: number) {
  const X = resamplingWeights(width, outWidth, false), Y = resamplingWeights(height, outHeight, true);
  const temp = new Uint8Array(width * outHeight), result = new Uint8Array(outWidth * outHeight), round = (s: number) => Math.max(0, Math.min(255, Math.floor((s + 8192) / 16384)));
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < width; x++) temp[y * width + x] = round(Y[y].reduce((s, [j, w]) => s + input[j * width + x] * w, 0));
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) result[y * outWidth + x] = round(X[x].reduce((s, [j, w]) => s + temp[y * width + j] * w, 0));
  return result;
}


export function shadowOpacity(opacity: number) {
  const byte = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
  if (byte === 0) return 0;
  const value = f(byte * f(1 / 255)), step = 2 ** (Math.floor(Math.log2(value)) - 10);
  return Math.round(value / step) * step;
}
function rasterScale(radius: number, inputScale: number, flag5: boolean) {
  const scale = f(inputScale);
  if (!(radius > 0) || !(scale > 0) || !Number.isFinite(radius * scale)) throw new Error('finite positive shadow radius and scale required');
  let blur = radius * scale, blurScale = scale;
  const threshold = blur > 8 ? 8 : blur > 4 ? 4 : 2;
  while (blur > threshold) { blur *= 0.5; blurScale *= 0.5; }
  return {rasterScale: flag5 ? scale : blurScale, gaussianRadius: f(blur), downsampleAfterRaster: flag5, downsampleRatio: flag5 ? blurScale / scale : 1};
}
export function shadowA8({width, height, radius, cornerRadius = Math.min(width, height) / 2, inputScale = 1, flag5 = true, curve = 'continuous'}: {width: number; height: number;
  radius: number; cornerRadius?: number; inputScale?: number; flag5?: boolean; curve?: 'continuous' | 'circular'}) {
  if (!Number.isFinite(radius) || radius < 0) throw new RangeError('nonnegative radius required');
  const plan = radius === 0 ? {rasterScale: inputScale, gaussianRadius: 0, downsampleAfterRaster: false, downsampleRatio: 1} : rasterScale(radius, inputScale, flag5), q = radius * plan.rasterScale;
  const padding = q > 0.6 ? Math.ceil(f(f(q) * f(2.8199565410614014) + 0.5)) : 0;
  const origin = [Math.floor(-plan.rasterScale) - padding, Math.floor(-plan.rasterScale) - padding];
  const size = [width, height].map((v, i) => Math.ceil((Math.ceil(v) + 1) * plan.rasterScale) - origin[i] + 2 * padding);
  const raster = rasterizeShadowPath({commands: roundedShadowPath(width, height, cornerRadius, curve), width: size[0], height: size[1], origin, scale: plan.rasterScale});
  const flip = (b: Uint8Array, w: number, h: number) => { const o = new Uint8Array(b.length); for (let y = 0; y < h; y++) o.set(b.subarray(y * w, (y + 1) * w), (h - 1 - y) * w); return o; };
  const flipped = flip(raster, size[0], size[1]);
  const blurSize = plan.downsampleAfterRaster ? size.map((n) => Math.floor(n * plan.downsampleRatio)) : size;
  const input = plan.downsampleAfterRaster ? resampleA8(flipped, size[0], size[1], blurSize[0], blurSize[1]) : flipped;
  const blurred = plan.gaussianRadius <= 0.6 ? input : convolveA8({input, width: blurSize[0], height: blurSize[1], kernel: a8Kernel(plan.gaussianRadius)});
  return {bytes: flip(blurred, blurSize[0], blurSize[1]), size: blurSize, rasterBytes: raster, rasterSize: size, origin: origin.map((x) => x / plan.rasterScale), extent: size.map((x) => x / plan.rasterScale)};
}
