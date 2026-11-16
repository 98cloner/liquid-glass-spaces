import type {Platform, Inputs, LensState, Scheme, VariantContext} from '../platform/types.ts';
import {IOS26_5} from '../platform/ios26_5.ts';
import {schemeRecipe, blend, recipeInputs, outputRange, providerMargin, type Recipe, type RecipeContext} from './recipe.ts';
import {host, packMaterial, type MaterialFields} from './host.ts';
export {packMaterial} from './host.ts';
const SWIFTUI_OUTPUT_SDF_MINIMUM = -10000;

export {LENS_RANGE_UPPER} from '../platform/ios26_5.ts';
export const CLEAR_BACKDROP_SCALE = 0.5;
const f = Math.fround;
type Range = {lower: number; upper: number};
type Colour = {colorSpace: string; components: number[]};
const isColour = (v: unknown): v is Colour => !!v && typeof v === 'object' && Array.isArray((v as Colour).components) && (v as Colour).components.length === 4;


function toward(p: Platform, inputs: Inputs, range: Range, t: number, from: {inputs: Inputs; range: Range} | null = null, split: {kind: string; progress: number} | null = null) {
  const out: Inputs = {}, keys = split ? p.toward.split[split.kind] : null;
  for (const [k, v] of Object.entries(inputs)) {
    const o = from?.inputs[k], u = keys?.has(k) ? split!.progress : t;
    if (typeof v === 'number') { const a = typeof o === 'number' ? o : k === 'inputMaxHeadroom' ? p.toward.maxHeadroom : p.toward.one.test(k) ? 1 : 0; out[k] = f(a + (v - a) * u); }
    else if (isColour(v)) {
      const pre = (c: number[]) => [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]], b = pre(v.components), a = isColour(o) ? pre(o.components) : [0, 0, 0, 0];
      const m = a.map((x, i) => x + (b[i] - x) * u);
      out[k] = {...v, components: m[3] > 0 ? [m[0] / m[3], m[1] / m[3], m[2] / m[3], m[3]] : [0, 0, 0, 0]};
    } else out[k] = v;
  }
  const lo = from ? from.range.upper : 0;
  return {inputs: out, range: {...range, upper: f(lo + (range.upper - lo) * t)}};
}
function largeToward(p: Platform, inputs: Inputs, range: Range, t: number) {
  const r = toward(p, inputs, range, t);
  r.inputs.inputClamp = inputs.inputClamp;
  for (const [k, v] of Object.entries(inputs)) if (isColour(v)) r.inputs[k] = {...v, components: [...v.components.slice(0, 3), f(v.components[3] * t)]};
  return r;
}
function pocketFilled(inputs: Inputs, alpha: number): Inputs {
  const c = inputs.inputFaceColorMatrixFillColor;
  return isColour(c) ? {...inputs, inputFaceColorMatrixFillColor: {...c, components: [...c.components.slice(0, 3), f(alpha)]}} : {...inputs};
}


function shapeMetrics(entries: number[][]) {
  if (entries.some((e) => e.some((v) => !Number.isFinite(v) || v <= 0))) throw new Error('positive actual material entry geometry required');
  if (!entries.length) return {D: 0, Dmin: 0};
  let Dmin = Infinity, best = -Infinity, D = -Infinity;
  for (const [w, h] of entries) {
    const smaller = h < w ? h : w, larger = w <= h ? h : w, area = smaller * larger;
    if (smaller < Dmin) Dmin = smaller;
    if (best < area) { best = area; D = smaller; }
  }
  return {D, Dmin};
}

export type MaterialArgs = {
  width: number; height: number; shapes?: number[][] | null; dpr: number; scheme: Scheme; variant?: string; luminance?: number | null;
  materialComposite?: {colorScheme: Scheme; weight: number}[] | null; extent: number[]; sourceSize?: number[]; sourceScale?: number;
  sourceUVTransform: number[]; sdfUVTransform: number[]; materialBranch?: 'texture-sdf' | 'analytic-sdf'; progress?: number; from?: number[] | null;
  split?: {kind: string; progress: number} | null; lens?: LensState | null; frost?: 0 | 1 | 2; pocketFill?: number | null; optionsDistance?: number | null;
  noLuminance?: boolean; outputs?: {key: string; apply(inputs: Inputs): Inputs} | null; platform?: Platform;
};

export function regularGlassMaterial(a: MaterialArgs) {
  const {extent, sourceUVTransform, sdfUVTransform} = a, m = material(a);
  return {...m, uniform: packMaterial(m.fields, {width: extent[0], height: extent[1], sourceUVTransform, sdfUVTransform})};
}

const CACHE_SIZE = 256;
const caches = new WeakMap<Platform, Map<string, ReturnType<typeof build>>>();
function material(a: MaterialArgs) {
  const p = a.platform ?? IOS26_5;
  let cache = caches.get(p);
  if (!cache) caches.set(p, cache = new Map());
  const key = JSON.stringify([a.width, a.height, a.shapes, a.dpr, a.scheme, a.variant, a.luminance, a.materialComposite, a.extent, a.sourceSize, a.sourceScale, a.materialBranch,
    a.progress, a.from, a.split, a.lens, a.frost, a.pocketFill, a.optionsDistance, a.noLuminance, a.outputs?.key ?? null]);
  let m = cache.get(key);
  if (m) { cache.delete(key); cache.set(key, m); return m; }
  m = build({...a, platform: p});
  cache.set(key, m);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return m;
}
function build({width, height, shapes = null, dpr, scheme, variant = 'regular', luminance = null, materialComposite = null, extent, sourceSize = [1, 1], sourceScale = 0.25,
  sourceUVTransform, sdfUVTransform, materialBranch = 'texture-sdf', progress = 1, from = null, split = null, lens = null, frost = 0, pocketFill = null, optionsDistance = null,
  noLuminance = false, outputs = null, platform: p = IOS26_5}: MaterialArgs): {fields: MaterialFields; analyticWrapperOuterInputs: unknown; inputs: Inputs;
    outputSDFEffect: {minimum: number; inset: number; range: Range}; gradientOvalization: number; domainMaterial: {backdropBlurContribution: unknown; backdropProviderMargin: {value: number}; backdropProviderGeometry: null}} {
  if (!Number.isFinite(dpr) || dpr <= 0) throw new Error('positive material raster scale required');
  const blending = progress !== 1 || !!split;
  const start = from && blending ? material({width: from[0], height: from[1], shapes: [from], dpr, scheme, variant, luminance, materialComposite, extent, sourceSize, sourceScale,
    sourceUVTransform, sdfUVTransform, materialBranch, frost, pocketFill, optionsDistance, noLuminance, platform: p}) : null;

  const {D, Dmin} = shapeMetrics(shapes ?? [[width, height]]);
  const options = optionsDistance && optionsDistance > 0 ? optionsDistance : D;
  const L = luminance === null ? (scheme === 'dark' ? 0 : 1) : f(luminance);
  const context = (s: Scheme): RecipeContext => ({scheme: s, D, Dmin, pixelLength: 1 / dpr, frost, small: !noLuminance && options <= p.luminance.below, luminance: L});
  const recipe: Recipe = materialComposite === null ? schemeRecipe(p, context(scheme))
    : blend(materialComposite.map(({colorScheme, weight}) => ({recipe: schemeRecipe(p, context(colorScheme)), weight})));
  let inputs = recipeInputs(recipe), range = outputRange(recipe);

  const filling = pocketFill !== null && frost !== 0 && scheme === 'light';
  if (filling) inputs = pocketFilled(inputs, pocketFill!);
  const v = p.variants[variant], vc: VariantContext = {width, height, scheme, lens};
  if (v) {
    const presented = v.inputs(inputs, vc), r = v.rangeUpper === undefined ? range : {...range, upper: v.rangeUpper}, q = v.progress?.(vc) ?? null;
    ({inputs, range} = q === null ? {inputs: presented, range: r} : largeToward(p, presented, r, q));
  } else if (variant !== 'regular') throw new RangeError(`unknown glass variant ${variant}`);
  if (!v && blending) ({inputs, range} = toward(p, inputs, range, Math.max(1e-4, progress), start ? {inputs: start.inputs, range: start.outputSDFEffect.range} : null,
    split ? {kind: split.kind, progress: Math.max(1e-4, split.progress)} : null));
  if (outputs) { inputs = outputs.apply(inputs); if (filling) inputs = pocketFilled(inputs, pocketFill!); }

  const h = host(inputs, {dpr, extent, sourceSize, sourceScale, raster: materialBranch === 'texture-sdf'});
  const own = typeof v?.margin === 'function' ? v.margin(vc) : v?.margin ?? null;
  return {fields: h.fields, analyticWrapperOuterInputs: h.outer, inputs, outputSDFEffect: {minimum: SWIFTUI_OUTPUT_SDF_MINIMUM, inset: 0, range},
    gradientOvalization: (inputs.inputBleedOpacity as number) > 0 ? p.ovalization : 0,
    domainMaterial: {backdropBlurContribution: h.blur, backdropProviderMargin: {value: own ?? providerMargin(recipe)}, backdropProviderGeometry: null}};
}
