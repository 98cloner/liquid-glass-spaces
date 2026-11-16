import type {Inputs} from '../platform/types.ts';
import {fma32, fma64} from '../math.js';

const f = Math.fround;
const f16 = (Math as unknown as {f16round(x: number): number}).f16round;

const UNIFORM: [name: string, lanes: 1 | 4][] = [
  ['sourceUVTransform', 4], ['sdfUVTransform', 4], ['displacementMatrix', 4], ['innerRefractionAmount', 1], ['innerRefractionInvHeight', 1],
  ['outerRefractionAmount', 1], ['outerRefractionInvHeight', 1], ['refractionDistance0', 1], ['refractionDistance1', 1], ['blurRadius', 1],
  ['refractionOpacity', 1], ['shadowAmount', 1], ['shadowInvHeight', 1], ['shadowInvRadius', 1], ['shadowOffsetX', 1], ['shadowOffsetY', 1],
  ['shadowVibrancy', 1], ['shadowAlpha', 1], ['shadowOpacity', 1], ['blurAlpha', 4], ['blurDistance', 4], ['faceCM0', 4], ['faceCM1', 4],
  ['faceCM2', 4], ['faceOpacity', 1], ['holdingTone', 1], ['holdingDistance0', 1], ['holdingDistance1', 1], ['clampLimit', 1],
  ['clampPreserveHue', 1], ['holdingToneWhite', 1], ['edrScale', 1], ['renderExtent', 4], ['unit', 1], ['shadowBlurRadius', 1],
  ['complexRefraction', 1], ['shadowDistanceOffset', 1], ['shadowCM0', 4], ['shadowCM1', 4], ['shadowCM2', 4], ['bleedCM0', 4], ['bleedCM1', 4],
  ['bleedCM2', 4], ['bleedBlurRadius', 1], ['bleedAmount', 1], ['bleedInvHeight', 1], ['bleedOpacity', 1], ['bleedDistance0', 1],
  ['bleedDistance1', 1], ['bleedDarkenScale', 1], ['bleedDarkenOffset', 1],
];
export const LANE: Record<string, number> = {};
let lanes = 0;
for (const [name, n] of UNIFORM) { LANE[name] = lanes; lanes += n; }
export const MATERIAL_STRUCT_WGSL = `struct GlassMaterialUniform {\n${UNIFORM.map(([name, n]) => `  ${name}: ${n === 4 ? 'vec4<f32>' : 'f32'},`).join('\n')}\n};`;
const INFINITE = new Set(['outerRefractionInvHeight', 'shadowInvHeight', 'shadowInvRadius', 'bleedInvHeight'].map((k) => LANE[k]));

export type MaterialFields = Record<string, number | number[]>;

export function packMaterial(fields: MaterialFields, {width, height, sourceUVTransform, sdfUVTransform}: {width: number; height: number; sourceUVTransform: number[]; sdfUVTransform: number[]},
  injected: [name: string, lane: number, value: number][] | null = null) {
  if (![width, height].every((x) => Number.isFinite(x) && x > 0)) throw new TypeError('positive material extent required');
  for (const v of [sourceUVTransform, sdfUVTransform]) if (v?.length !== 4 || !Array.from(v).every(Number.isFinite)) throw new TypeError('finite source and SDF UV transforms required');
  const u = new Float32Array(lanes);
  for (const [name, value] of Object.entries(fields)) typeof value === 'number' ? u[LANE[name]] = value : u.set(value, LANE[name]);
  u.set(sourceUVTransform, LANE.sourceUVTransform); u.set(sdfUVTransform, LANE.sdfUVTransform);
  u.set([width, height, 1 / width, 1 / height], LANE.renderExtent);
  u[LANE.edrScale] = 1; u[LANE.unit] = 1;
  for (const [name, lane, value] of injected ?? []) if (name in LANE) u[LANE[name] + lane] = value;
  check(u);
  return u;
}
function check(u: Float32Array) {
  const violations: object[] = [];
  for (const [name, offset] of [['shadowDistanceOffset', 216], ['clampPreserveHue', 244], ['complexRefraction', 256]] as const)
    if (!Number.isFinite(u[LANE[name]])) violations.push({offset, branch: 'nonfinite-material-operand', actual: u[LANE[name]]});
  if (u[LANE.complexRefraction] !== 0 && u[LANE.shadowDistanceOffset] !== 0) {
    const d = u.subarray(LANE.blurDistance, LANE.blurDistance + 4);
    for (let i = 0; i < 3; i++) {
      if (i === 2 && d[2] === 0 && d[3] === 0) continue;
      const span = f(d[i + 1] - d[i]);
      if (![d[i], d[i + 1], span, f(1 / span), f(-d[i] / span)].every(Number.isFinite) || span === 0)
        violations.push({offset: 176 + 4 * i, branch: 'unsupported-active-blur-ramp', endOffset: 180 + 4 * i});
    }
  }
  if (violations.length) throw new RangeError(`unsupported material shader branch: ${JSON.stringify(violations)}`);
  for (let i = 0; i < u.length; i++) if (!Number.isFinite(u[i]) && !(u[i] === Infinity && INFINITE.has(i))) throw new RangeError('nonfinite packed material lane outside supported shader domain');
}


const KEYS = new Set(['inputBleedAmount', 'inputBleedBlurRadius', 'inputBleedColorMatrixBlack', 'inputBleedColorMatrixFillColor', 'inputBleedColorMatrixSaturation',
  'inputBleedColorMatrixWhite', 'inputBleedDarkenBlend', 'inputBleedDistance0', 'inputBleedDistance1', 'inputBleedHeight', 'inputBleedOpacity', 'inputBlurDistance0',
  'inputBlurDistance1', 'inputBlurDistance2', 'inputBlurDistance3', 'inputBlurDistance4', 'inputBlurOpacity0', 'inputBlurOpacity1', 'inputBlurOpacity2', 'inputBlurOpacity3',
  'inputBlurOpacity4', 'inputBlurRadius', 'inputClamp', 'inputClampPreserveHue', 'inputFaceColorMatrixBlack', 'inputFaceColorMatrixFillColor', 'inputFaceColorMatrixSaturation',
  'inputFaceColorMatrixWhite', 'inputFaceOpacity', 'inputInnerRefractionAmount', 'inputInnerRefractionHeight', 'inputMaxHeadroom', 'inputOuterRefractionAmount',
  'inputOuterRefractionHeight', 'inputRefractionDistance0', 'inputRefractionDistance1', 'inputRefractionOpacity', 'inputSDRGradientDistance0', 'inputSDRGradientDistance1',
  'inputSDRHoldingToneEnabled', 'inputSDRHoldingToneWhite', 'inputSDRShadowOpacity', 'inputShadowAmount', 'inputShadowBlurRadius', 'inputShadowColorMatrixBlack',
  'inputShadowColorMatrixFillColor', 'inputShadowColorMatrixSaturation', 'inputShadowColorMatrixWhite', 'inputShadowDistanceOffset', 'inputShadowHeight', 'inputShadowOffset',
  'inputShadowOpacity', 'inputShadowRadius', 'inputShadowVibrancyContribution', 'inputSourceSublayerName']);
const COLOURS = ['inputFaceColorMatrixFillColor', 'inputBleedColorMatrixFillColor', 'inputShadowColorMatrixFillColor'];

function reader(inputs: Inputs) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new TypeError('CAFilter input dictionary required');
  for (const [k, v] of Object.entries(inputs)) {
    if (!KEYS.has(k)) throw new RangeError(`Unmapped material input ${k}`);
    if (typeof v === 'number' || typeof v === 'boolean' || v === null || k === 'inputSourceSublayerName') continue;
    const ok = COLOURS.includes(k) ? (v as {colorSpace?: string}).colorSpace === 'extended-sRGB' && !(v as {contentHeadroom?: number}).contentHeadroom
      : k === 'inputShadowOffset' && typeof (v as {width?: number}).width === 'number' && typeof (v as {height?: number}).height === 'number';
    if (!ok) throw new TypeError(`Unsupported generated value for ${k}`);
  }
  const num = (k: string, d: number) => typeof inputs[k] === 'number' ? inputs[k] as number : d;
  const get = (k: string, d: number) => { const v = num(k, d); if (!Number.isFinite(v)) throw new TypeError(`missing float key ${k}`); return v; };
  const int = (k: string) => { const v = inputs[k]; if (typeof v !== 'number' && typeof v !== 'boolean') return 0; const x = Number(v); return Number.isNaN(x) ? 0 : Math.min(2147483647, Math.max(-2147483648, Math.trunc(x))) || 0; };
  const colour = (k: string) => { const v = inputs[k] as {components: number[]} | null | undefined; if (!v || typeof v !== 'object') return [0, 0, 0, 0]; const [r, g, b, a] = v.components; return [r * a, g * a, b * a, a].map(f); };
  const offset = () => { const o = inputs.inputShadowOffset as {width: number; height: number} | null | undefined; return o && typeof o === 'object' ? [o.width, o.height] : [0, 10]; };
  const halfRadius = (opacity: string, radius: string, d: number) => num(opacity, 1) <= 0 ? 0 : num(radius, d) * 0.5;
  return {num, get, int, colour, offset, bleedBlurRadius: halfRadius('inputBleedOpacity', 'inputBleedBlurRadius', 100), shadowBlurRadius: halfRadius('inputShadowOpacity', 'inputShadowBlurRadius', 25)};
}


const decode = (words: number[]) => Array.from(new Float32Array(new Uint32Array(words).buffer));
const RGB_TO_YCC = decode([0x3e59b3d0, 0x3f371759, 0x3d93dd98, 0, 0, 0xbdeab368, 0xbec55326, 0x3f000000, 0, 0x3f000000, 0x3f000000, 0xbee88ce7, 0xbd3b98c8, 0, 0x3f000000, 0, 0, 0, 0x3f800000, 0]);
const YCC_TO_RGB = decode([0x3f800000, 0, 0x3fc9930c, 0, 0xbf49930c, 0x3f800000, 0xbe3fd1dd, 0xbeefadf3, 0, 0x3ea7cb71, 0x3f800000, 0x3fed844d, 0, 0, 0xbf6d844d, 0, 0, 0, 0x3f800000, 0]);
const CONCAT_ORDERS = [
  [[3, 2, 1, 0], [3, 2, 1, 0], [3, 2, 1, 0], [3, 2, 1, 0], [3, 2, 1, 0]],
  [[3, 2, 1, 0], [3, 2, 1, 0], [3, 2, 1, 0], [3, 1, 2, 0], [2, 1, 3, 0]],
  [[3, 2, 1, 0], [3, 2, 1, 0], [3, 2, 0, 1], [3, 0, 2, 1], [2, 0, 3, 1]],
  [[3, 2, 1, 0], [3, 1, 2, 0], [3, 0, 2, 1], [3, 0, 1, 2], [0, 1, 3, 2]],
];
function concat(a: number[], b: number[]) {
  const out = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) {
    const [first, ...rest] = CONCAT_ORDERS[row][col];
    let sum = col === 4 ? fma32(a[row * 5 + first], b[first * 5 + col], a[row * 5 + 4]) : f(a[row * 5 + first] * b[first * 5 + col]);
    for (const k of rest) sum = fma32(a[row * 5 + k], b[k * 5 + col], sum);
    out.push(sum);
  }
  return out;
}
function yccRows(white: number, black: number, saturation: number, colour: number[]) {
  [white, black, saturation] = [white, black, saturation].map(f);
  const luma = Array(20).fill(0); luma[0] = f(white - black); luma[4] = black; luma[6] = luma[12] = luma[18] = 1;
  const chroma = Array(20).fill(0); chroma[0] = chroma[18] = 1; chroma[6] = chroma[12] = saturation; chroma[9] = chroma[14] = f(fma64(-saturation, 0.5, 0.5));
  const m = concat(YCC_TO_RGB, concat(chroma, concat(luma, RGB_TO_YCC))), rest = f(1 - colour[3]);
  return [0, 1, 2].map((row) => [0, 1, 2, 4].map((col) => f16(col === 4 ? f(f(m[row * 5 + 4] * rest) + colour[row]) : f(m[row * 5 + col] * rest))));
}


const GAMMA = f(2.22);
const ALPHA_ABOVE_ONE = decode([0x3f800001])[0];

export function host(inputs: Inputs, {dpr: s, extent, sourceSize, sourceScale, raster}: {dpr: number; extent: number[]; sourceSize: number[]; sourceScale: number; raster: boolean}) {
  if (raster && (!Array.isArray(extent) || extent.length !== 2 || extent.some((v) => !Number.isInteger(v) || v <= 0))) throw new TypeError('raster material requires the current SDF allocation');
  if (!Number.isFinite(sourceScale) || !Array.isArray(sourceSize) || sourceSize.length !== 2 || sourceSize.some((v) => !Number.isInteger(v) || v <= 0)) throw new TypeError('a source scale and allocation required');
  const r = reader(inputs), {get, int} = r, shadowOffset = r.offset();
  if (!shadowOffset.every(Number.isFinite)) throw new TypeError('explicit shadowOffset required');

  const k = f(f(s) * f(sourceScale)), materialScale = f(s * f(sourceScale));
  const [x, y] = shadowOffset;
  const shadowXY = raster ? [f(fma64(f(s), x, y * 0)), f(fma64(f(s), y, x * 0))].map((v, i) => f(-v / extent[i])) : [-f(x), -f(y)];

  const face = r.colour('inputFaceColorMatrixFillColor'), bleed = r.colour('inputBleedColorMatrixFillColor'), shadow = r.colour('inputShadowColorMatrixFillColor');
  const limit = f(get('inputMaxHeadroom', 1.2)), hdr = limit > ALPHA_ABOVE_ONE ? f(0 / f(limit - 1)) : 1;
  const sdrShadow = get('inputSDRShadowOpacity', 0);
  if (sdrShadow > 0) shadow[3] = f(fma32(-hdr, sdrShadow, sdrShadow) + shadow[3]);
  const rows = (prefix: string, d: [number, number, number], fill: number[]) =>
    yccRows(get(`input${prefix}ColorMatrixWhite`, d[0]), get(`input${prefix}ColorMatrixBlack`, d[1]), get(`input${prefix}ColorMatrixSaturation`, d[2]), fill);
  const [face0, face1, face2] = rows('Face', [1, 0, 1], face), [bleed0, bleed1, bleed2] = rows('Bleed', [1, 0, 1], bleed), [shadow0, shadow1, shadow2] = rows('Shadow', [1, 0, 1], shadow);

  const g = (key: string, d: number) => f(get(key, d)), inv = (key: string, d: number) => f(1 / get(key, d));
  const clamp01 = (v: number) => v > 1 ? 1 : v < 0 ? 0 : v;
  const blurScale = f(materialScale * f(1.6));
  const alpha = [g('inputBlurOpacity0', 1), g('inputBlurOpacity1', 0.1), g('inputBlurOpacity2', 0.1), g('inputBlurOpacity3', 0.4)];
  const darken = int('inputBleedDarkenBlend');
  const fields: MaterialFields = {
    displacementMatrix: [f(k / sourceSize[0]) + 0, 0, 0, f(k / sourceSize[1]) + 0],
    innerRefractionAmount: g('inputInnerRefractionAmount', -150), innerRefractionInvHeight: inv('inputInnerRefractionHeight', 60),
    outerRefractionAmount: g('inputOuterRefractionAmount', 100), outerRefractionInvHeight: inv('inputOuterRefractionHeight', 50),
    refractionDistance0: g('inputRefractionDistance0', -11), refractionDistance1: g('inputRefractionDistance1', -3),
    blurRadius: f(g('inputBlurRadius', 30) * blurScale), refractionOpacity: g('inputRefractionOpacity', 0.75),
    shadowAmount: g('inputShadowAmount', 200), shadowInvHeight: inv('inputShadowHeight', 250), shadowInvRadius: inv('inputShadowRadius', 25),
    shadowOffsetX: shadowXY[0], shadowOffsetY: shadowXY[1], shadowVibrancy: g('inputShadowVibrancyContribution', 1), shadowAlpha: shadow[3],
    shadowOpacity: clamp01(g('inputShadowOpacity', 1)),
    blurAlpha: [alpha[0], f(alpha[0] - alpha[1]), f(alpha[1] - alpha[2]), f(alpha[2] - alpha[3])],
    blurDistance: [g('inputBlurDistance0', -450), g('inputBlurDistance1', -3), g('inputBlurDistance2', -0), g('inputBlurDistance3', 0)],
    faceCM0: face0, faceCM1: face1, faceCM2: face2,
    faceOpacity: clamp01(g('inputFaceOpacity', 1)), holdingTone: int('inputSDRHoldingToneEnabled') === 0 ? 0 : f(1 - hdr),
    holdingDistance0: g('inputSDRGradientDistance0', -2.5), holdingDistance1: g('inputSDRGradientDistance1', -1.5),
    clampLimit: f(Math.pow(g('inputClamp', 0), f(1 / GAMMA))), clampPreserveHue: int('inputClampPreserveHue'), holdingToneWhite: g('inputSDRHoldingToneWhite', 0.97),
    shadowBlurRadius: f(f(r.shadowBlurRadius) * blurScale),
    complexRefraction: g('inputInnerRefractionAmount', -150) !== 0 || g('inputOuterRefractionAmount', 100) !== 0 || alpha.some((v, i) => i > 0 && v !== alpha[i - 1]) ? 1 : 0,
    shadowDistanceOffset: g('inputShadowDistanceOffset', -50),
    shadowCM0: shadow0, shadowCM1: shadow1, shadowCM2: shadow2, bleedCM0: bleed0, bleedCM1: bleed1, bleedCM2: bleed2,
    bleedBlurRadius: f(f(r.bleedBlurRadius) * blurScale), bleedAmount: g('inputBleedAmount', 400), bleedInvHeight: inv('inputBleedHeight', 500),
    bleedOpacity: clamp01(g('inputBleedOpacity', 0.2)), bleedDistance0: g('inputBleedDistance0', -400), bleedDistance1: g('inputBleedDistance1', -42),
    bleedDarkenScale: darken !== 0 ? 1 : -1, bleedDarkenOffset: darken === 0 ? 1 : 0,
  };

  const b = (key: string, d: number) => { const v = r.num(key, d); if (!Number.isFinite(v)) throw new RangeError('finite backdrop filter values required'); return v; };
  const radius = f(b('inputBlurRadius', 30));
  const uniform = !(b('inputShadowOpacity', 1) > 0) && !(b('inputBleedOpacity', 1) > 0) && b('inputBlurOpacity0', 1) === 1 && b('inputBlurOpacity2', 0.1) === 1
    && b('inputBlurOpacity3', 0.1) === 1 && b('inputBlurOpacity4', 0.4) === 1;
  const blur = Object.freeze({shadow: f(r.shadowBlurRadius), bleed: f(r.bleedBlurRadius), radius, uniform, minimumOperand: uniform ? radius : f(b('inputBlurOpacity3', 0.4))});

  const outer = raster ? null : Object.freeze({sourceScale, shadowExtent: r.num('inputShadowRadius', 25), shadowOffset: Object.freeze(shadowOffset.slice()),
    hostLinear: Object.freeze([s, 0, 0, s]), layerLinear: Object.freeze([s, 0, 0, s])});
  return {fields, blur, outer};
}
