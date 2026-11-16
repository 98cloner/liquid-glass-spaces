import {fma32, fma64} from '../math.js';

const f = Math.fround;

export type WrapperInputs = {sourceScale: number; shadowExtent: number; shadowOffset: readonly number[]; hostLinear: readonly number[]; layerLinear: readonly number[]};
export type AnalyticEntry = {rect: readonly number[]; radius: number; curve: number;
  wrapperScalars: {layerFloat68: number; layerFloat6c: number; nestedScalar: number; outerInputs: WrapperInputs}};

function scalarsOf({layerFloat68, layerFloat6c, nestedScalar, outerInputs: o}: AnalyticEntry['wrapperScalars']) {
  if (!o.hostLinear.every((v, i) => f(v) === f(o.layerLinear[i]))) throw new RangeError('unequal linear transform wrapper input branch remains unvalidated');
  if (!Object.is(o.sourceScale, f(o.sourceScale)) || !Number.isFinite(o.shadowExtent)) throw new RangeError('a float32 source scale and a finite shadow extent required');
  const extent = f(o.shadowExtent + o.shadowExtent), offset = o.shadowOffset.map((v) => -(-f(v)));
  return [layerFloat6c > 4096 ? 4096 : layerFloat6c, 0 < layerFloat68 ? 0 : layerFloat68, extent, offset[0], offset[1], o.sourceScale, nestedScalar];
}

export function analyticAxes(entry: AnalyticEntry) {
  const {rect, radius, curve} = entry, scalars = scalarsOf(entry.wrapperScalars);
  if (!Object.is(radius, f(radius)) || radius < f(0.01)) throw new RangeError('ordinary scalar radius branch required');
  const adjust = (r: readonly number[], amount: number) => {
    const d = f(-amount), width = r[2] - (d + d), height = fma64(d, -2, r[3]);
    if (!(width > 0 && height > 0)) throw new RangeError('empty adjusted rectangle branch remains unvalidated');
    return [r[0] + d, r[1] + d, width, height];
  };
  const primary = adjust(rect, scalars[1]), other = adjust([rect[0] + scalars[3], rect[1] + scalars[4], rect[2], rect[3]], scalars[2]);
  const full = primary.slice(2).map(f), hi = full.map((v) => f(v * 0.5)), lo = full.map((v) => f(v * -0.5));
  const extent = (curve ? radius * 1.528665 : radius) + scalars[1];
  const four = !(extent < Math.max(...hi));
  if (!(Math.max(scalars[2], scalars[3], scalars[4]) > 0)) throw new RangeError(four ? 'alternate two-axis branch remains unvalidated' : 'four-axis branch required');
  const inset = hi.map((v) => extent < v ? f(extent) : v);
  const axis = (i: number) => {
    const start = primary[i], end = start + primary[i + 2], os = other[i], oe = os + other[i + 2];
    const outerStart = f(start < os ? start : os), outerEnd = f(oe > end ? oe : end), a = f(fma64(outerStart - start, 1, lo[i])), b = f(fma64(outerEnd - end, 1, hi[i]));
    return four ? {position: [outerStart, start, end, outerEnd], sdf: [a, lo[i], hi[i], b]}
      : {position: [outerStart, start, start + inset[i], end - inset[i], end, outerEnd], sdf: [a, lo[i], f(lo[i] + inset[i]), f(hi[i] - inset[i]), hi[i], b]};
  };
  const x = axis(0), y = axis(1);
  return {primary, scalars, four, axes: {positionX: x.position, positionY: y.position, sdfX: x.sdf, sdfY: y.sdf}};
}

export function analyticPrefix(entry: AnalyticEntry, mode: -4 | 0 | 4, axes = analyticAxes(entry)) {
  const {primary, scalars} = axes, half = primary.slice(2).map(f).map((v) => fma32(0.5, v, -scalars[1]));
  const weights = entry.curve ? half.map((v) => f(Math.max(0, Math.min(1, (f(v + v) * -1.4457785175867517) / (entry.radius * 1.528665) + 2.8915570351735034)))) : [1, 1];
  return new Uint8Array(new Float32Array([half[0], half[1], mode, scalars[6], 1, 0, 0, 1, weights[0], weights[1], entry.radius, 0]).buffer);
}

const TABLES: Record<string, number[]> = {
  four32: [0, 1, 5, 4, 3, 7, 6, 2, 10, 11, 15, 14, 9, 13, 12, 8, 1, 2, 6, 5, 4, 5, 9, 8, 6, 7, 11, 10, 9, 10, 14, 13],
  four4: [5, 6, 10, 9],
  six20: [14, 15, 21, 20, 8, 9, 15, 14, 20, 21, 27, 26, 13, 14, 20, 19, 15, 16, 22, 21],
  six16: [7, 8, 14, 13, 9, 10, 16, 15, 21, 22, 28, 27, 19, 20, 26, 25],
  six64: [2, 3, 9, 8, 26, 27, 33, 32, 12, 13, 19, 18, 16, 17, 23, 22, 0, 1, 7, 6, 1, 2, 8, 7, 6, 7, 13, 12, 4, 5, 11, 10, 3, 4, 10, 9, 10, 11, 17, 16, 28, 29, 35, 34,
    27, 28, 34, 33, 22, 23, 29, 28, 24, 25, 31, 30, 25, 26, 32, 31, 18, 19, 25, 24],
};
export const ANALYTIC_DRAWS: Record<'six' | 'four', [-4 | 0 | 4, string, number][]> = {
  six: [[4, 'six16', 16], [-4, 'six64', 64], [0, 'six20', 20]],
  four: [[4, 'four4', 4], [-4, 'four32', 32]],
};

export function analyticDrawGeometry(axes: ReturnType<typeof analyticAxes>['axes'], {transform, source, table, indexCount}: {transform: readonly number[];
  source: {dimensions: readonly number[]; origin: readonly number[]; scale: number}; table: string; indexCount: number}) {
  const {positionX: X, positionY: Y, sdfX, sdfY} = axes, n = X.length, m = transform, scale = f(source.scale);
  const reciprocal = source.dimensions.map((x) => f(1 / f(x))), origin = source.origin.map((x) => -f(x));
  const grid = new Float32Array(n * n * 8);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = f(fma64(m[4], Y[y], fma64(m[0], X[x], m[12]))), py = f(fma64(m[5], Y[y], fma64(m[1], X[x], m[13])));
    grid.set([px, py, 0, 1, f(sdfX[x]), f(sdfY[y]), f(fma32(px, scale, origin[0]) * reciprocal[0]), f(fma32(py, scale, origin[1]) * reciprocal[1])], (y * n + x) * 8);
  }
  const quads = TABLES[table].slice(0, indexCount), triangles = new Uint16Array(quads.length / 4 * 6);
  for (let i = 0; i < quads.length; i += 4) triangles.set([quads[i], quads[i + 1], quads[i + 2], quads[i + 2], quads[i + 3], quads[i]], i / 4 * 6);
  const indexed = !(n * n > triangles.length), count = indexed ? n * n : triangles.length;
  const vertices = new Uint8Array(count * 48), from = new Uint8Array(grid.buffer);
  for (let i = 0; i < count; i++) { const k = indexed ? i : triangles[i]; vertices.set(from.subarray(k * 32, k * 32 + 32), i * 48); }
  return {vertices, indices: indexed ? triangles : null, indexFormat: indexed ? 'uint16' as const : null, count: triangles.length};
}
