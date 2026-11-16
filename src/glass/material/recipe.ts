import type {Platform, RecipeSpec, LuminanceSpec, Range, Scheme, Value, Colour, RGBA, Inputs} from '../platform/types.ts';
import {encodeAnimatable as encodeSwiftUIColorResolvedAnimation, decodeAnimatable as decodeSwiftUIColorResolvedAnimation} from './colour.ts';

const f = Math.fround;
type Num = number;

export type RecipeContext = {scheme: Scheme; D: Num; Dmin: Num; pixelLength: Num; frost: 0 | 1 | 2; small: boolean; luminance: Num};

export type Recipe = {
  shadow: {present: boolean; offsetX: Num; offsetY: Num; amount: Num; height: Num; distanceOffset: Num; blurRadius: Num; radius: Num; black: Num; white: Num;
    saturation: Num; fill: RGBA | null; opacity: Num; vibrancy: Num};
  blur: {present: boolean; radius2: Num; d0: Num; d1: Num; d2: Num; d3: Num; d4: Num; w0: Num; w1: Num; w2: Num; w3: Num; w4: Num; opacity: Num};
  refraction: {present: boolean; innerHeight: Num; innerAmount: Num; outerHeight: Num; outerAmount: Num; distance0: Num; distance1: Num; opacity: Num};
  face: {present: boolean; opacity: Num; black: Num; white: Num; saturation: Num; fill: RGBA | null};
  bleed: {present: boolean; amount: Num; height: Num; blurRadius: Num; opacity: Num; distance0: Num; distance1: Num; black: Num; white: Num; saturation: Num;
    fill: RGBA | null; darken: boolean};
  sdr: {present: boolean; maxHeadroom: Num; shadowOpacity: Num; holdingWhite: Num; gradient0: Num; gradient1: Num};
};
type Section = keyof Recipe;
const FIELDS: {[S in Section]: {d: string[]; s: string[]; n?: string[]; fill?: true}} = {
  shadow: {d: ['offsetX', 'offsetY', 'amount', 'height', 'radius', 'vibrancy', 'distanceOffset', 'blurRadius'], s: ['black', 'white', 'saturation', 'opacity'], fill: true},
  blur: {d: ['d1', 'd2', 'radius2', 'd0', 'd3', 'd4'], s: ['w0', 'w1', 'w2', 'w3', 'w4', 'opacity']},
  refraction: {d: ['innerHeight', 'innerAmount', 'outerHeight', 'outerAmount'], s: ['opacity'], n: ['distance0', 'distance1']},
  face: {d: [], s: ['opacity', 'black', 'white', 'saturation'], fill: true},
  bleed: {d: ['amount', 'height', 'blurRadius'], s: ['opacity', 'distance0', 'distance1', 'black', 'white', 'saturation'], fill: true},
  sdr: {d: [], s: ['maxHeadroom', 'shadowOpacity', 'holdingWhite'], n: ['gradient0', 'gradient1']},
};


const EPSILON = 2 ** -26;
const unit = (t: Num) => t > 1 ? 1 : t >= 0 ? t : 0;
export function range({at: [start, end], from, to, reverse = false, extension}: Range & {from: Num; to: Num}, x: Num, float: boolean) {
  const q = float ? f : (v: Num) => v;
  const mag = (v: Num) => Math.sqrt(v * v);
  let a = q(from), b = q(to);
  const span = mag(end - start), delta = mag(x - start);
  let t = span <= EPSILON ? 0 : (x < start ? -delta : delta) / span;
  if (extension && t > 1) {
    const far = end + extension.width, s = mag(far - end), d = mag(x - end);
    t = s <= EPSILON ? 0 : (x < end ? -d : d) / s;
    if (reverse) { a = q(extension.target); b = q(from); t = 1 - t; } else { a = q(to); b = q(extension.target); }
    t = unit(t); t = (t * t) * (3 - (t + t));
  } else if (reverse) t = 1 - t;
  t = unit(t);
  return q(a + q(q(b - a) * q(t)));
}
export function floatRange({at: [s0, e0], from, to, reverse = false, extension}: Range & {from: Num; to: Num}, x0: Num) {
  const start = f(s0), end = f(e0), x = f(x0), mag = (v: Num) => Math.sqrt(f(f(v) * f(v)));
  const ratio = (v: Num, a: Num, b: Num) => { const span = mag(f(b - a)), delta = mag(f(v - a)); return span <= EPSILON ? 0 : (v < a ? -delta : delta) / span; };
  let t = ratio(x, start, end), a = f(from), b = f(to);
  if (extension && t > 1) {
    const target = f(extension.target), far = f(end + f(extension.width));
    t = ratio(x, end, far);
    if (reverse) { a = target; b = f(from); t = 1 - t; } else { a = f(to); b = target; }
    t = unit(t); t = (t * t) * (3 - (t + t));
  } else if (reverse) t = 1 - t;
  t = unit(t);
  return f(a + f(f(b - a) * f(t)));
}

const isScheme = (v: unknown): v is {light: unknown; dark: unknown} => !!v && typeof v === 'object' && !Array.isArray(v) && 'light' in v && 'dark' in v;
const pick = <T>(v: T | {light: T; dark: T}, s: Scheme): T => isScheme(v) ? (v as {light: T; dark: T})[s] : v as T;
function value(v: Value, c: RecipeContext, float: boolean): Num {
  const x = pick(v, c.scheme);
  let y: Num;
  if (typeof x === 'number') y = x;
  else if ('px' in x) y = x.plus === undefined ? c.pixelLength * x.px : c.pixelLength * x.px + x.plus;
  else if ('times' in x) {
    y = x.times * (x.of === 'min' ? c.Dmin : c.D);
    if (x.min !== undefined) y = y >= x.min ? y : x.min;
    if (x.max !== undefined) y = y > x.max ? x.max : y;
  } else y = range({...x, from: pick(x.from, c.scheme), to: pick(x.to, c.scheme)}, c.D, float);
  return float ? f(y) : y;
}
const colour = (v: Colour, s: Scheme): RGBA | null => { const x = pick(v, s); return x ? x.map(f) as unknown as RGBA : null; };

export function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !base || typeof base !== 'object' || Array.isArray(base) || isScheme(patch)) return (patch ?? base) as T;
  const out: Record<string, unknown> = {...base as Record<string, unknown>};
  for (const [k, v] of Object.entries(patch)) out[k] = merge(out[k], v);
  return out as T;
}


export function schemeRecipe(p: Platform, c: RecipeContext): Recipe {
  if (!(c.D > 0)) throw new RangeError('Only nonzero regular-section domain implemented');
  const frost = c.frost ? p.frost[c.frost] : null, spec: RecipeSpec = frost?.recipe ? merge(p.recipe, frost.recipe) : p.recipe;
  const d = (v: Value) => value(v, c, false), s = (v: Value) => value(v, c, true);
  const {shadow: sh, blur: bl, refraction: rf, face: fa, bleed: be, sdr} = spec;
  const r: Recipe = {
    shadow: {present: true, offsetX: d(sh.offset[0]), offsetY: d(sh.offset[1]), amount: d(sh.amount), height: d(sh.height), distanceOffset: d(sh.distanceOffset),
      blurRadius: d(sh.blurRadius), radius: d(sh.radius), black: s(sh.black), white: s(sh.white), saturation: s(sh.saturation), fill: colour(sh.fill, c.scheme),
      opacity: s(sh.opacity), vibrancy: d(sh.vibrancy)},
    blur: {present: true, radius2: d(bl.radius) * 2, d0: d(bl.distances[0]), d1: d(bl.distances[1]), d2: d(bl.distances[2]), d3: d(bl.distances[3]), d4: d(bl.distances[4]),
      w0: s(bl.weights[0]), w1: s(bl.weights[1]), w2: s(bl.weights[2]), w3: s(bl.weights[3]), w4: s(bl.weights[4]), opacity: s(bl.opacity)},
    refraction: {present: true, innerHeight: d(rf.innerHeight), innerAmount: d(rf.innerAmount), outerHeight: d(rf.outerHeight), outerAmount: d(rf.outerAmount),
      distance0: d(rf.distance0), distance1: d(rf.distance1), opacity: s(rf.opacity)},
    face: {present: true, opacity: s(fa.opacity), black: s(fa.black), white: s(fa.white), saturation: s(fa.saturation), fill: colour(fa.fill, c.scheme)},
    bleed: {present: true, amount: d(be.amount), height: d(be.height), blurRadius: d(be.blurRadius), opacity: s(be.opacity), distance0: s(be.distance0),
      distance1: s(be.distance1), black: s(be.black), white: s(be.white), saturation: s(be.saturation), fill: colour(be.fill, c.scheme), darken: pick(be.darken, c.scheme)},
    sdr: {present: true, maxHeadroom: s(sdr.maxHeadroom), shadowOpacity: s(sdr.shadowOpacity), holdingWhite: s(sdr.holdingWhite), gradient0: d(sdr.gradient0), gradient1: d(sdr.gradient1)},
  };
  const diffusion = p.diffusion.increased ? p.diffusion.face : null;
  if (diffusion) {
    r.face.black = s(diffusion.black); r.face.white = s(diffusion.white); r.face.saturation = s(diffusion.saturation);
    if (r.face.fill) r.face.fill = [r.face.fill[0], r.face.fill[1], r.face.fill[2], s(diffusion.fillAlpha)];
  } else if (c.small) adaptLuminance(r, frost?.luminance ? merge(p.luminance, frost.luminance) : p.luminance, c);
  return finalize(r);
}

function adaptLuminance(r: Recipe, l: LuminanceSpec, c: RecipeContext) {
  const L = Math.min(f(c.luminance), 1), ends = (x: Range) => ({...x, from: pick(x.from, c.scheme), to: pick(x.to, c.scheme)});
  if (r.face.fill) r.face.fill = [r.face.fill[0], r.face.fill[1], r.face.fill[2], floatRange(ends(pick(l.faceFillAlpha, c.scheme)), L)];
  r.face.black = Math.max(f(l.faceBlack.min), f(L + f(l.faceBlack.offset)));
  r.face.white = Math.min(f(pick(l.faceWhite.max, c.scheme)), f(L + f(l.faceWhite.offset)));
  if (r.shadow.fill) r.shadow.fill = [r.shadow.fill[0], r.shadow.fill[1], r.shadow.fill[2], floatRange(ends(pick(l.shadowFillAlpha, c.scheme)), L)];
}

function finalize(r: Recipe): Recipe {
  const {shadow, bleed, blur, refraction} = r;
  const shadowOn = shadow.opacity !== 0 ? 1 : 0, bleedOn = bleed.amount !== 0 && bleed.height !== 0 && bleed.opacity !== 0 ? 1 : 0, blurOn = blur.radius2 !== 0 && blur.opacity !== 0 ? 1 : 0;
  shadow.blurRadius *= shadowOn; shadow.radius *= shadowOn; shadow.opacity = f(shadow.opacity * shadowOn);
  shadow.vibrancy *= bleedOn; if (shadow.vibrancy === 0) shadow.blurRadius = 0;
  bleed.blurRadius *= bleedOn; bleed.opacity = f(bleed.opacity * bleedOn);
  blur.radius2 *= blurOn; blur.opacity = f(blur.opacity * blurOn);
  let limit = refraction.outerAmount !== 0 && refraction.outerHeight !== 0 && refraction.opacity !== 0 ? refraction.outerAmount : 0;
  if (limit < blur.d4) {
    const d = [blur.d0, blur.d1, blur.d2, blur.d3, blur.d4], w = [blur.w0, blur.w1, blur.w2, blur.w3, blur.w4];
    const lower = limit < d[3] ? 2 : 3, upper = lower + 1;
    let v: Num;
    if (Math.abs(d[upper] - d[lower]) <= EPSILON) { const u = d[upper] < limit; limit = d[u ? upper : lower]; v = w[u ? upper : lower]; }
    else v = f(w[lower] + f((limit - d[lower]) * (f(w[upper] - w[lower]) / (d[upper] - d[lower]))));
    if (lower === 2) { blur.w3 = v; blur.d3 = limit; blur.d4 = limit; } else { blur.w4 = v; blur.d4 = limit; }
  }
  return r;
}


const encode = (c: RGBA) => (encodeSwiftUIColorResolvedAnimation([...c], false) as Num[]).map((x) => f(f(f(x / 128)) * 128));
const decode = (v: Num[]) => (decodeSwiftUIColorResolvedAnimation(v.map((x) => f(f(x / 128) * 128)), false) as Num[]).map(f);
export function blend(entries: {recipe: Recipe; weight: Num}[]): Recipe {
  if (entries.length === 1 && entries[0].weight === 1) return entries[0].recipe;
  const out = {} as Record<Section, Record<string, unknown>>;
  for (const section of Object.keys(FIELDS) as Section[]) {
    const fields = FIELDS[section], o: Record<string, unknown> = {}, at = (e: {recipe: Recipe}) => e.recipe[section] as unknown as Record<string, Num>;
    let any = false;
    for (const k of fields.d) { let n: Num | undefined; for (const e of entries) { const t = at(e)[k] * e.weight; n = n === undefined ? t : n + t; } o[k] = n; any ||= n !== 0; }
    for (const k of [...fields.s, ...fields.n ?? []]) {
      const narrow = !fields.s.includes(k);
      let n: Num | undefined;
      for (const e of entries) { const v = narrow ? f(at(e)[k]) : at(e)[k], t = f(v * f(e.weight)); n = n === undefined ? t : f(n + t); }
      o[k] = n; any ||= n !== 0;
    }
    if (fields.fill) {
      let v: Num[] | null = null;
      for (const e of entries) { const c = at(e).fill as unknown as RGBA | null, x = c ? encode(c) : [0, 0, 0, 0], t = x.map((y) => f(y * f(e.weight))); v = v ? v.map((y, i) => f(y + t[i])) : t; }
      const c = decode(v!);
      o.fill = c[3] !== 0 ? c : null; any ||= c[3] !== 0;
    }
    if (section === 'bleed') {
      let b = 0;
      entries.forEach((e, i) => { const t = f((e.recipe.bleed.darken ? 1 : 0) * f(e.weight)); b = i === 0 ? t : f(b + t); });
      o.darken = b > 0.5; any ||= b > 0.5;
    }
    o.present = any;
    if (!any) { for (const k of [...fields.d, ...fields.s, ...fields.n ?? []]) o[k] = 0; if (fields.fill) o.fill = null; if (section === 'bleed') o.darken = false; }
    out[section] = o;
  }
  return out as unknown as Recipe;
}


const bits = (u: number) => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, u, true); return b.getFloat32(0, true); };
const powf = (x: Num, y: Num) => f(Math.pow(f(x), f(y)));
const K = {lin: bits(0x3b4d2e1c), slope: bits(0x414eb852), gamma: bits(0x3ed55555), scale: bits(0x3f870a3d), offset: bits(0xbd6147ae),
  sLin: bits(0x3d25aee6), sSlope: bits(0x3d9e8391), sScale: bits(0x3f72a76f), sOffset: bits(0x3d55891a), sGamma: bits(0x4019999a)};
function toSRGB(v: Num) {
  const x = f(v), a = x > 0 ? x : -x;
  const e = a <= K.lin ? f(a * K.slope) : a === 1 ? 1 : f(f(f(powf(a, K.gamma)) * K.scale) + K.offset);
  return x > 0 ? e : -e;
}
function clampOf(white: Num) {
  if (Number.isFinite(white) && Math.abs(white) <= 1) return 1;
  const a = white > 0 ? white : -white;
  const linear = a <= K.sLin ? f(a * K.sSlope) : a === 1 ? 1 : f(powf(f(f(a * K.sScale) + K.sOffset), K.sGamma));
  const signed = white > 0 ? linear : -linear;
  return Number.isNaN(signed) ? 1 : Math.max(signed, 1);
}
const fillInput = (c: RGBA | null) => c ? {colorSpace: 'extended-sRGB', components: [toSRGB(c[0]), toSRGB(c[1]), toSRGB(c[2]), c[3]]} : null;

export function recipeInputs(r: Recipe): Inputs {
  const {shadow: sh, blur: bl, refraction: rf, face: fa, bleed: be, sdr} = r;
  const i: Inputs = {
    inputShadowAmount: sh.amount, inputShadowHeight: sh.height, inputShadowDistanceOffset: sh.distanceOffset, inputShadowBlurRadius: sh.blurRadius, inputShadowRadius: sh.radius,
    inputShadowVibrancyContribution: sh.vibrancy, inputBlurDistance0: bl.d0, inputBlurDistance1: bl.d1, inputBlurDistance2: bl.d2, inputBlurDistance3: bl.d3, inputBlurDistance4: bl.d4,
    inputInnerRefractionAmount: rf.innerAmount, inputInnerRefractionHeight: rf.innerHeight, inputOuterRefractionAmount: rf.outerAmount, inputOuterRefractionHeight: rf.outerHeight,
    inputRefractionDistance0: rf.distance0, inputRefractionDistance1: rf.distance1, inputBleedAmount: be.amount, inputBleedHeight: be.height, inputBleedBlurRadius: be.blurRadius,
    inputSDRGradientDistance0: sdr.gradient0, inputSDRGradientDistance1: sdr.gradient1,
    inputShadowColorMatrixBlack: sh.black, inputShadowColorMatrixWhite: sh.white, inputShadowColorMatrixSaturation: sh.saturation, inputShadowOpacity: sh.opacity,
    inputRefractionOpacity: rf.opacity, inputFaceOpacity: fa.opacity, inputFaceColorMatrixBlack: fa.black, inputFaceColorMatrixWhite: fa.white, inputFaceColorMatrixSaturation: fa.saturation,
    inputBleedOpacity: be.opacity, inputBleedDistance0: be.distance0, inputBleedDistance1: be.distance1, inputBleedColorMatrixBlack: be.black, inputBleedColorMatrixWhite: be.white,
    inputBleedColorMatrixSaturation: be.saturation, inputMaxHeadroom: sdr.maxHeadroom, inputSDRHoldingToneWhite: sdr.holdingWhite, inputSDRShadowOpacity: sdr.shadowOpacity,
    inputBlurRadius: bl.radius2 * 0.5,
  };
  [bl.w0, bl.w1, bl.w2, bl.w3, bl.w4].forEach((w, k) => { i[`inputBlurOpacity${k}`] = f(w * bl.opacity); });
  i.inputBleedDarkenBlend = be.darken;
  i.inputSDRHoldingToneEnabled = sdr.shadowOpacity !== 0 && sdr.holdingWhite !== 1 && (sdr.gradient0 !== 0 || sdr.gradient1 !== 0);
  i.inputClamp = clampOf(fa.white);
  i.inputClampPreserveHue = false;
  i.inputShadowColorMatrixFillColor = fillInput(sh.present ? sh.fill : null);
  i.inputFaceColorMatrixFillColor = fillInput(fa.present ? fa.fill : null);
  i.inputBleedColorMatrixFillColor = fillInput(be.present ? be.fill : null);
  i.inputShadowOffset = {width: sh.offsetX, height: sh.offsetY};
  i.inputSourceSublayerName = '@0';
  return i;
}

function expansion(opacity: Num) {
  const v = f(opacity);
  if (v >= 0.505) return ((Math.min(v, 1) - 0.505) / 0.495) * 0.05 + 1.65;
  if (v <= 0.005) return 0;
  const result = Math.log(Math.max(v - 0.005, 0) * 2) * 0.3 + 1.65;
  return result < 0 ? 0 : result;
}

export function outputRange(r: Recipe) {
  let lower = 0, upper = 0;
  const merge = (lo: Num, hi: Num) => { if (lo < lower) lower = lo; if (upper <= hi) upper = hi; };
  const {shadow: sh, blur: bl, refraction: rf, face: fa, bleed: be} = r;
  if (sh.present && sh.opacity !== 0) {
    let high = -sh.distanceOffset, low = high - Math.abs(sh.height);
    if (sh.radius > 0) { const extent = sh.radius * expansion(sh.opacity); if (low > 0) low = 0; if (extent >= high) high = extent + 0; }
    lower = Math.min(low, 0); upper = high >= 0 ? high : 0;
  }
  if (bl.present && bl.opacity !== 0 && bl.radius2 !== 0) {
    let low = bl.d0 < bl.d1 && bl.w0 === bl.w1 ? bl.d1 : bl.d0, high = bl.d3 < bl.d4 && bl.w3 === bl.w4 ? bl.d3 : bl.d4;
    if (high <= low) { high = bl.d4; low = bl.d0; }
    if (low < high) merge(low, high + 1);
  }
  if (rf.present && ((rf.innerHeight !== 0 && rf.innerAmount !== 0) || (rf.outerHeight !== 0 && rf.outerAmount !== 0 && rf.opacity !== 0))) {
    let low = -Math.max(Math.abs(rf.innerHeight), Math.abs(rf.outerHeight)), high = 0;
    if (rf.opacity !== 0 && rf.distance0 <= rf.distance1) { low = Math.min(low, rf.distance0); high = Math.max(rf.distance1 + 1, 0); }
    merge(low, high);
  }
  if (be.present && be.opacity !== 0 && be.amount !== 0 && be.height !== 0) {
    let low = -Math.abs(be.height), high = 0;
    if (be.distance0 < be.distance1) { low = Math.min(low, be.distance0); high = Math.max(f(be.distance1 + 1), 0); }
    merge(low, high);
  }
  if (fa.present && fa.opacity !== 0) merge(-1, 1);
  return {lower, upper};
}

export function providerMargin(r: Recipe) {
  const mx = (a: Num, b: Num) => a <= b ? b : a, {shadow: sh, blur: bl, refraction: rf, bleed: be} = r;
  const reach = mx(Math.abs(sh.offsetX), Math.abs(sh.offsetY)) + mx(Math.abs(sh.amount) + (sh.distanceOffset >= 0 ? 0 : -sh.distanceOffset), sh.radius * expansion(sh.opacity));
  const shadow = sh.opacity > 0 && sh.vibrancy > 0 ? reach : reach * 0;
  const knots = [bl.d0, bl.d1, bl.d2, bl.d3, bl.d4], first = knots.findIndex((d) => d >= 0);
  let blur = 0;
  if (first >= 0 && bl.radius2 > 0) { blur = knots[first]; for (let k = first + 1; k < 5; k++) blur = mx(blur, knots[k]); }
  const outer = rf.opacity > 0 ? rf.outerAmount : rf.outerAmount * 0;
  const refraction = rf.innerAmount >= 0 ? mx(rf.innerAmount, outer) : outer >= 0 ? outer : 0;
  const bleed = be.opacity > 0 ? Math.abs(be.amount) : Math.abs(be.amount) * 0;
  return mx(mx(mx(shadow, blur), refraction), bleed);
}
