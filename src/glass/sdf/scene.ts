import {fma32} from '../math.js';

const f = Math.fround;

export type SDFSurface = {rect: readonly number[]; cornerStyle: 0 | 1; cornerRadius?: number; bottomCornerRadius?: number};
export type SDFKind = 'curve' | 'rect' | 'union' | 'unionRect';
export type SDFDraw = {kind: SDFKind; vertices: Uint8Array; indices: Uint16Array; vertexUniform: Float32Array; uniform: Float32Array; scissor: number[]};
export type SDFScene = {
  surfaces: SDFSurface[];
  unionSmoothness: number; gradientOvalization: number; gaussianRadius?: number;
  outputSDFEffect?: {minimum: number; inset: number; range: {upper: number}} | null; sdfPadding?: number | null;
  size: readonly number[]; origin: readonly number[]; scissor: readonly number[]; renderScale: number; screenCenter: readonly number[];
  rootProjectionReference?: boolean;
  unionFirst?: boolean;
};

export function outputPadding({minimum, maximum, smoothness, gaussianRadius, effectOffset, gaussianPaddingScale}: {minimum: number; maximum: number; smoothness: number;
  gaussianRadius: number; effectOffset: number; gaussianPaddingScale: number}) {
  const [min, max, smooth, gaussian, offset, scale] = [minimum, maximum, smoothness, gaussianRadius, effectOffset, gaussianPaddingScale].map(f);
  if (![min, max, smooth, gaussian, offset, scale].every(Number.isFinite)) throw new RangeError('finite output SDF parameters required');
  const adjust = fma32(gaussian, scale, smooth), inner = f(adjust + max), outer = f(adjust + -min);
  return {layerFloat68: offset > 0 ? inner : f(inner - offset), layerFloat6c: offset > 0 ? f(outer + offset) : outer};
}
export const outerPadding = (effect: {minimum: number; inset: number; range: {upper: number}}, smoothness: number, gaussianRadius = 0) =>
  outputPadding({minimum: effect.minimum, maximum: effect.range.upper, smoothness, gaussianRadius, effectOffset: effect.inset, gaussianPaddingScale: f(2.8)}).layerFloat68;

export function orthographicProjection(size: readonly number[], origin: readonly number[] = [0, 0]) {
  const left = f(origin[0]), right = f(origin[0] + size[0]), top = f(origin[1]), bottom = f(origin[1] + size[1]);
  const rx = f(1 / f(right - left)), ry = f(1 / f(bottom - top));
  return new Float32Array([f(rx + rx), 0, 0, 0, 0, f(-2 * ry), 0, 0, 0, 0, 0, 0, f(-f(right + left) * rx), f(f(bottom + top) * ry), 0, 1]);
}

const CURVE_INDICES = new Uint16Array([0, 1, 5, 5, 4, 0, 3, 7, 6, 6, 2, 3, 10, 11, 15, 15, 14, 10, 9, 13, 12, 12, 8, 9]);
const RECT_INDICES = new Uint16Array([1, 2, 6, 6, 5, 1, 4, 5, 9, 9, 8, 4, 6, 7, 11, 11, 10, 6, 9, 10, 14, 14, 13, 9, 5, 6, 10, 10, 9, 5]);
const CONTINUOUS = 1.528665;

export function sdfScene(scene: SDFScene): SDFDraw[] {
  const {surfaces, unionSmoothness, gradientOvalization, size, origin, scissor, renderScale, screenCenter, rootProjectionReference = false} = scene;
  if (!surfaces.length) throw new TypeError('at least one glass surface required');
  if (surfaces.some(({rect}) => rect.length !== 4 || !rect.every(Number.isFinite) || rect[2] <= 0 || rect[3] <= 0)) throw new TypeError('finite positive scene geometry required');
  const padding = scene.sdfPadding != null ? f(scene.sdfPadding) : outerPadding(scene.outputSDFEffect!, unionSmoothness, scene.gaussianRadius ?? 0);
  if (!(padding >= 0)) throw new RangeError('nonnegative SDF outer padding required');
  const projection = rootProjectionReference ? orthographicProjection(size, origin) : null;

  const draw = (kind: SDFKind, {rect: [cx, cy, width, height], cornerStyle, cornerRadius, bottomCornerRadius}: SDFSurface): SDFDraw => {
    const half = [width, height].map((v) => f(f(v + 2 * padding) * 0.5 - padding)), paddedHalf = [width, height].map((v) => f(f(v + 2 * padding) * 0.5));
    const top = f(Math.max(f(0.01), cornerRadius ?? Math.min(width, height) / 2));
    const bottom = cornerStyle === 1 && bottomCornerRadius !== undefined && f(bottomCornerRadius) !== top && bottomCornerRadius >= 0 ? f(bottomCornerRadius) : null;
    const radius = bottom === null ? top : Math.max(top, bottom);
    const fill = f(radius * (cornerStyle === 0 ? 1 : CONTINUOUS) + padding);
    const axis = (i: number) => {
      const p = paddedHalf[i], m = Math.min(p, fill), extent = i ? height : width;
      const start = -extent / 2 - padding, end = start + extent + 2 * padding;
      return {sdf: [-p, f(-p + m), f(p - m), p], at: [start, start + m, end - m, end]};
    };
    const X = axis(0), Y = axis(1);
    const vertices = new Float32Array(192);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const rx = f((X.at[i] + cx + screenCenter[0]) * renderScale), ry = f((Y.at[j] + cy + screenCenter[1]) * renderScale), at = (j * 4 + i) * 12;
      vertices[at] = projection ? rx : f(rx - origin[0]); vertices[at + 1] = projection ? ry : f(ry - origin[1]); vertices[at + 3] = 1;
      vertices[at + 4] = X.sdf[i]; vertices[at + 5] = Y.sdf[j];
    }
    const vertexUniform = new Float32Array([2 / size[0], 0, 0, 0, 0, -2 / size[1], 0, 0, 0, 0, 0, 0, -1, 1, 0, 1, 1, 1, 0, 0]);
    if (projection) vertexUniform.set(projection);
    const weights = cornerStyle === 0 ? [1, 1] : half.map((v) => f(Math.max(0, Math.min(1, (f(v + v) * -1.4457785175867517) / (top * CONTINUOUS) + 2.8915570351735034))));
    const uniform = new Float32Array(28);
    uniform.set([half[0], half[1], 4, gradientOvalization, 1, 0, 0, 1, weights[0], weights[1], top, bottom === null ? 0 : f(bottom + 1)]);
    uniform[24] = unionSmoothness;
    const curve = kind === 'curve' || kind === 'union';
    return {kind, vertices: new Uint8Array(vertices.buffer), indices: curve ? CURVE_INDICES : RECT_INDICES, vertexUniform, uniform, scissor: [...scissor]};
  };
  return surfaces.flatMap((s, i) => i === 0 && !scene.unionFirst ? [draw('curve', s), draw('rect', s)] : [draw('union', s), draw('unionRect', s)]);
}
