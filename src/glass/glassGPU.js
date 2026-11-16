import {materialShaderVertexUV} from './material/shader.ts';
import {LANE} from './material/host.ts';
import {IOS26_5} from './platform/ios26_5.ts';
import {DOWNSAMPLE_WGSL} from './material/downsample.ts';
import {createSDFEncoder, prepareSDFPipelines} from './sdf/producer.ts';
import {sdfScene, outerPadding, orthographicProjection, outputPadding} from './sdf/scene.ts';
import {shadowCirclePath, rasterizeShadowPath, a8Kernel, convolveA8} from './render/shadow.ts';
import {fma32 as fusedMultiplyAddFloat32, fma64 as fusedMultiplyAddFloat64} from './math.js';
import {regularGlassMaterial, packMaterial, CLEAR_BACKDROP_SCALE} from './material/material.ts';
import {createContentsSDF} from './sdf/contents.js';
import {createSDFGaussian} from './render/sdfGaussian.js';
import {createAnalyticGlass} from './sdf/analyticShader.ts';
import {analyticAxes, analyticPrefix, analyticDrawGeometry, ANALYTIC_DRAWS} from './sdf/analytic.ts';
import {rimRecipe, packKeyFill, createRimPipelines} from './material/highlight.ts';
import {yccMatrix, quantizeMatrix} from './material/colour.ts';
import {createLumaPipelines, lumaUniform, lumaDispatch, lumaRegion} from './material/luma.ts';
import {backdropDomain} from './material/backdrop.ts';
import {blueNoise32} from './blueNoise.js';

export function glassShortSide(surfaces, dpr) {
  const largest = surfaces.reduce((a, b) => (b.rect.w * b.rect.h > a.rect.w * a.rect.h ? b : a));
  return Math.min(largest.rect.w, largest.rect.h) / dpr;
}
const sceneSurfaces = (surfaces, dpr) => surfaces.map(({rect: r, radius, bottomRadius, cornerStyle}) => ({
  rect: [(r.x + r.w / 2) / dpr, (r.y + r.h / 2) / dpr, r.w / dpr, r.h / dpr], cornerStyle, cornerRadius: Math.min(radius, r.w / dpr / 2, r.h / dpr / 2), splitUnion: true,
  ...(bottomRadius !== undefined ? {bottomCornerRadius: Math.min(bottomRadius, r.w / dpr / 2, r.h / dpr / 2)} : null)}));
const smoothness = (spacing) => spacing ?? 8;

const columnsOf = (m) => new Float32Array(Array.from({length: 20}, (_, i) => m[(i % 4) * 5 + Math.floor(i / 4)]));
const textOverlays = (({face, rim}) => {
  const light = (angle) => ({height: rim.height, heightScale: 1, heightOffset: 0, angle, spread: rim.spread, spreadScale: 1, spreadOffset: 0, amount: rim.amount, color: [1, 1, 1, 1]});
  return [{kind: 'face', columns: columnsOf(face.matrix)},
    {kind: 'rim', columns: columnsOf(rim.matrix), highlight: packKeyFill({key: light(rim.angles.key), fill: light(rim.angles.fill), curvature: rim.curvature, distanceOffset: 0})}];
});
const textOverlaysOf = new WeakMap();
const TEXT_OVERLAYS = (platform) => { let o = textOverlaysOf.get(platform); if (!o) textOverlaysOf.set(platform, o = textOverlays(platform.highlight.text)); return o; };

const highlightRecipes = new WeakMap();
function highlightRecipe(entries, platform) {
  let cache = highlightRecipes.get(platform);
  if (!cache) highlightRecipes.set(platform, cache = new Map());
  const key = JSON.stringify(entries);
  let r = cache.get(key);
  if (!r) {
    r = rimRecipe(entries, platform);
    if (cache.size > 64) cache.clear();
    cache.set(key, r);
  }
  return r;
}

const OVERSCAN_PT = 64;

const BACKDROP_WGSL = `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct Params { candidate: vec4f, sourceOrigin: vec2f, size: vec2f, clip: vec4f, factor: vec4f };
@group(0) @binding(2) var<uniform> p: Params;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let v = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(v[i], 0, 1);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let j = floor(pos.xy);
  let i = clamp(p.sourceOrigin + j - p.candidate.xy, vec2f(0), p.candidate.zw - 1.0);
  let inv = 1.0 / p.size;
  let f = p.factor.x;
  let uv = (f * (p.candidate.xy + i) + 0.5 * f) * inv;
  let lo = (p.clip.xy + 0.5) * inv;
  let hi = (p.clip.zw - 0.5) * inv;
  if (f == 1.0) { return textureSampleLevel(source, smp, clamp(uv, lo, hi), 0); }
  if (f == 2.0) { return textureSampleLevel(source, smp, clamp(uv, lo, hi), 0); }
  var sum = vec4f(0);
  for (var k = 0u; k < 4u; k++) {
    let o = vec2f(f32(k & 1u) * 2.0 - 1.0, 1.0 - f32(k >> 1u) * 2.0) * inv;
    sum = fma(textureSampleLevel(source, smp, clamp(uv + o, lo, hi), 0), vec4f(0.25), sum);
  }
  return sum;
}`;

function materialShader() {
  return materialShaderVertexUV()
    .replace('@group(0) @binding(4) var<uniform> params: GlassMaterialUniform;',
      '@group(0) @binding(4) var<uniform> params: GlassMaterialUniform;\n@group(0) @binding(5) var<uniform> quad: MaterialQuad;') + `
struct MaterialQuad { position: vec4f, source: vec4f, sdf: vec4f, scale: vec4f, clip: vec4f };
@vertex fn materialVert(@builtin(vertex_index) index: u32) -> VertexOutput {
  let k = array<u32, 6>(0, 1, 2, 2, 3, 0)[index];
  let at = vec2<bool>(k == 1u || k == 2u, k >= 2u);
  let p = select(quad.position.xy, quad.position.zw, at);
  var o: VertexOutput;
  o.position = vec4f(p.x * quad.clip.x - 1.0, 1.0 - p.y * quad.clip.y, 0.0, 1.0);
  o.outputUV = vec2f(0.0);
  o.sourceUV = select(quad.source.xy, quad.source.zw, at) * quad.scale.xy;
  o.sdfUV = select(quad.sdf.xy, quad.sdf.zw, at) * quad.scale.zw;
  return o;
}`;
}

const GLOW_WGSL = `
struct GlowU { big: array<vec4f, 5>, a: vec4f, quad: vec4f, at: vec4f, size: vec4f };
@group(0) @binding(0) var sdf: texture_2d<f32>;
@group(0) @binding(1) var under: texture_2d<f32>;
@group(0) @binding(2) var disc: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@group(0) @binding(4) var<uniform> u: GlowU;
@group(0) @binding(5) var noise: texture_2d<f32>;
@group(0) @binding(6) var mask: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(array<vec2f, 3>(vec2f(-1, 1), vec2f(3, 1), vec2f(-1, -3))[i], 0, 1);
}
fn q8(v: vec4f) -> vec4f { return floor(clamp(v, vec4f(0.0), vec4f(1.0)) * 255.0 + vec4f(0.5)) / 255.0; }
fn halfRound(x: f32) -> f32 { return unpack2x16float(pack2x16float(vec2f(x, 0.0))).x; }
fn matrixOver(alpha: f32, bg: vec4f, m: array<vec4f, 5>) -> vec4f {
  let rgb = bg.rgb / max(bg.a, 0.000001);
  let c = rgb.r * m[0] + rgb.g * m[1] + rgb.b * m[2] + bg.a * m[3] + m[4];
  let ma = clamp(c.a, 0.0, 1.0);
  return vec4f(c.rgb * ma, ma) * alpha;
}
@fragment fn fs(@builtin(position) local: vec4f) -> @location(0) vec4f {
  let pos = local.xy + u.at.xy;
  var c = q8(matrixOver(u.a.x, textureLoad(under, vec2i(pos), 0), u.big));
  let uv = (pos - u.quad.xy) / u.quad.zw;
  if (all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))) {
    let a = textureSampleLevel(disc, smp, uv, 0.0).r * halfRound(u.a.y);
    let n = (textureLoad(noise, vec2u(local.xy) % 32u, 0) - vec4f(0.5)) * (2.0 / 255.0);
    let alpha = clamp(a + select(0.0, n.a, a > 0.0 && a < 1.0), 0.0, 1.0);
    c = q8(vec4f(min(vec3f(a) + n.rgb * a, vec3f(alpha)), alpha) + c * (1.0 - alpha));
  }
  return c;
}
struct CornerV { @builtin(position) position: vec4f, @location(0) @interpolate(linear, center) point: vec2f };
@vertex fn vsCorner(@location(0) position: vec2f, @location(1) point: vec2f) -> CornerV {
  let p = (position - u.at.xy) / u.size.xy * 2.0 - vec2f(1.0);
  return CornerV(vec4f(p.x, -p.y, 0.0, 1.0), point);
}
@fragment fn fsCorner(v: CornerV) -> @location(0) vec4f {
  let p = abs(clamp(v.point, vec2f(-1.0), vec2f(0.0)));
  let largest = max(p.x, p.y);
  let t = select(clamp(min(p.x, p.y) / largest, 0.0, 1.0), 0.0, largest == 0.0);
  let poly = (((3.1560099124908447 - 0.9260540008544922 * t) * t - 3.6412200927734375) * t + 1.268030047416687) * t + 0.2685309946537018;
  let continuous = length(p) + 1.0 - 1.0 / (1.0 - t * t * poly);
  let circular = length(max(vec2f(0.0), p * 1.5286649465560913 - vec2f(0.5286650061607361))) * 0.6541655659675598 + 0.3458344340324402;
  let h = halfRound(mix(continuous, circular, select(u.size.w, u.size.z, p.y > p.x)) - 1.0);
  return vec4f(clamp(0.5 - h / max(fwidth(h + 1.0), 0.00009999999747378752), 0.0, 1.0));
}
@fragment fn fsFill(@builtin(position) local: vec4f) -> @location(0) vec4f {
  let s = textureLoad(sdf, vec2i(local.xy) + vec2i(u.at.xy) - vec2i(u.at.zw), 0);
  return vec4f(select(clamp(0.5 - s.x / clamp(fwidth(s.x), 0.00009999999747378752, 1.0), 0.0, 1.0) * s.w, 0.0, s.x > 1.0));
}
@fragment fn fsOver(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let i = vec2i(pos.xy) - vec2i(u.at.xy);
  return textureLoad(under, i, 0) * textureLoad(mask, i, 0).a;
}`;

const CONTENT_WGSL = `
@group(0) @binding(0) var sdf: texture_2d<f32>;
@group(0) @binding(1) var before: texture_2d<f32>;
@group(0) @binding(2) var after: texture_2d<f32>;
@group(0) @binding(3) var<uniform> at: vec4f;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(array<vec2f, 3>(vec2f(-1, 1), vec2f(3, 1), vec2f(-1, -3))[i], 0, 1);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let i = vec2i(pos.xy);
  let t = i - vec2i(at.xy);
  let d = vec2i(textureDimensions(sdf));
  let s = textureLoad(sdf, clamp(t, vec2i(0), d - vec2i(1)), 0);
  let w = fwidth(s.x);
  let inside = all(t >= vec2i(0)) && all(t < d);
  let f = select(0.0, floor(select(clamp(0.5 - s.x / clamp(w, 0.00009999999747378752, 1.0), 0.0, 1.0) * s.w, 0.0, s.x > 1.0) * 255.0 + 0.5) / 255.0, inside);
  let b = textureLoad(before, i, 0);
  return b + (textureLoad(after, i, 0) - b) * f;
}`;

function analyticDraws({surface: {rect: r, radius, cornerStyle}, dpr, material, smoothness, source}) {
  const effect = material.outputSDFEffect, w = r.w / dpr, h = r.h / dpr;
  const padding = outputPadding({minimum: effect.minimum, maximum: effect.range.upper, effectOffset: effect.inset, smoothness, gaussianRadius: 0, gaussianPaddingScale: Math.fround(2.8)});
  const entry = {rect: [0, 0, w, h], radius: Math.fround(Math.max(Math.fround(0.01), Math.min(radius, w / 2, h / 2))), curve: cornerStyle,
    wrapperScalars: {...padding, nestedScalar: Math.fround(material.gradientOvalization), outerInputs: material.analyticWrapperOuterInputs}};
  const axes = analyticAxes(entry), transform = [dpr, 0, 0, 0, 0, dpr, 0, 0, 0, 0, 1, 0, r.x, r.y, 0, 1];
  return ANALYTIC_DRAWS[axes.four ? 'four' : 'six'].map(([mode, table, indexCount]) => ({mode, prefix: analyticPrefix(entry, mode, axes),
    geometry: analyticDrawGeometry(axes.axes, {transform, source, table, indexCount})}));
}

function glowCorners([w, h], radius, scale, origin) {
  const f = Math.fround, r = radius * 1.528665, inverse = 1 / r, extent = [w, h].map((v) => Math.min(fusedMultiplyAddFloat64(0.5, v, 0.5), r));
  const delta = extent.map((v, i) => f(f(v) * scale[i])), end = extent.map((v) => fusedMultiplyAddFloat32(f(v * inverse), 1, -1)), vertices = new Float32Array(64);
  for (let c = 0; c < 4; c++) {
    const x = f(c & 1 ? w - extent[0] : 0), y = f(c >= 2 ? h - extent[1] : 0), o = [f(fusedMultiplyAddFloat64(x, scale[0], origin[0])), f(fusedMultiplyAddFloat64(y, scale[1], origin[1]))];
    const xs = c & 1 ? [end[0], -1] : [-1, end[0]], ys = c >= 2 ? [end[1], -1] : [-1, end[1]];
    for (let k = 0; k < 4; k++) { const right = k === 1 || k === 2, bottom = k >= 2; vertices.set([f(o[0] + (right ? delta[0] : 0)), f(o[1] + (bottom ? delta[1] : 0)), xs[+right], ys[+bottom]], (c * 4 + k) * 4); }
  }
  return {vertices, weights: [w, h].map((v) => f(Math.max(0, Math.min(1, fusedMultiplyAddFloat64(inverse, v * -1.4457785175867517, 2.8915570351735034)))))};
}

function glowDiscImage(side) {
  let blur = side / 2, scale = 1;
  const threshold = blur > 8 ? 8 : blur > 4 ? 4 : 2;
  while (blur > threshold) { blur /= 2; scale /= 2; }
  blur = Math.fround(blur);
  const padding = Math.ceil(Math.fround(blur * Math.fround(2.8199565410614014) + 0.5)), left = Math.floor(-scale) - padding, w = Math.ceil((Math.ceil(side) + 1) * scale) - left + 2 * padding;
  const {commands, points} = shadowCirclePath(side);
  let used = 0;
  const path = commands.map((op) => { const n = [0, 1, 1, 2, 3][op], at = points.slice(used, used + n); used += n; return {type: ['close', 'move', 'line', '', 'cubic'][op], points: at}; });
  const flip = (a) => { const o = new Uint8Array(w * w); for (let y = 0; y < w; y++) o.set(a.subarray(y * w, (y + 1) * w), (w - 1 - y) * w); return o; };
  const input = flip(rasterizeShadowPath({commands: path, width: w, height: w, origin: [left, left], scale}));
  return {size: w, pixels: flip(convolveA8({input, width: w, height: w, kernel: a8Kernel(blur)})), origin: left / scale, extent: w / scale};
}
const toColumns = (m) => Array.from({length: 20}, (_, i) => m[(i % 4) * 5 + Math.floor(i / 4)]);
const BIG_GLOW = toColumns(quantizeMatrix(yccMatrix(Math.fround(0.05), Math.fround(1.05), Math.fround(1.2))));

const TINT_WGSL = `
struct TintU { c: array<vec4f, 5>, at: vec4f, sdfAt: vec4f };
@group(0) @binding(0) var own: texture_2d<f32>;
@group(0) @binding(1) var group: texture_2d<f32>;
@group(0) @binding(2) var glass: texture_2d<f32>;
@group(0) @binding(3) var<uniform> t: TintU;
@group(0) @binding(4) var lut: texture_2d<f32>;
@group(0) @binding(5) var smp: sampler;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(array<vec2f, 3>(vec2f(-1, 1), vec2f(3, 1), vec2f(-1, -3))[i], 0, 1);
}
fn q8(v: vec4f) -> vec4f { return round(clamp(v, vec4f(0.0), vec4f(1.0)) * 255.0) / 255.0; }
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let i = vec2i(pos.xy);
  let g = textureLoad(glass, i + vec2i(t.at.xy), 0);
  let c = select(vec4f(0.0), textureLoad(group, i, 0), t.at.z > 0.0);
  let b = q8(c + g * (1.0 - c.a));
  let rgb = b.rgb / max(b.a, 0.000001);
  let m = rgb.r * t.c[0] + rgb.g * t.c[1] + rgb.b * t.c[2] + b.a * t.c[3] + t.c[4];
  let o = textureLoad(own, i + vec2i(t.sdfAt.xy), 0);
  let gradient = q8(textureSampleLevel(lut, smp, vec2f((o.x + 1.0) / 11.0, 0.5), 0.0)).a;
  let a = clamp(m.a, 0.0, 1.0) * select(0.0, gradient, o.w > 0.0);
  return vec4f(m.rgb * a, a);
}
@fragment fn fsClip(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let i = vec2i(pos.xy);
  let p = textureLoad(own, i + vec2i(t.sdfAt.xy), 0);
  let cov = select(clamp(0.5 - p.x / clamp(fwidth(p.x), 0.00009999999747378752, 1.0), 0.0, 1.0) * p.w, 0.0, p.x > 1.0);
  return textureLoad(group, i, 0) * q8(vec4f(cov)).a;
}
@fragment fn fsOver(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return textureLoad(group, vec2i(pos.xy) - vec2i(t.at.xy), 0);
}`;

export function glassAllocation(rect, dpr) {
  const left = rect.x / dpr - OVERSCAN_PT, top = rect.y / dpr - OVERSCAN_PT;
  const right = (rect.x + rect.w) / dpr + OVERSCAN_PT, bottom = (rect.y + rect.h) / dpr + OVERSCAN_PT;
  const x = Math.floor((left * dpr) / 8) * 8, y = Math.floor((top * dpr) / 8) * 8;
  const w = Math.max(8, Math.ceil((right * dpr - x) / 8) * 8), h = Math.max(8, Math.ceil((bottom * dpr - y) / 8) * 8);
  return {x, y, w, h, sw: w / 4, sh: h / 4};
}

function tintFalloff(d) {
  if (d <= 0) return 1;
  if (d >= 10) return 0;
  const bezier = (u, p, q) => 3 * (1 - u) * (1 - u) * u * p + 3 * (1 - u) * u * u * q + u * u * u;
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const u = (lo + hi) / 2; if (bezier(u, 0.60938, 0.47124) < d / 10) lo = u; else hi = u; }
  return 1 - bezier((lo + hi) / 2, 0.00663, 0.99115);
}

export async function createRegularGlassRenderer(device) {
  const mod = (code) => device.createShaderModule({code});
  const backdropModule = mod(BACKDROP_WGSL), downsampleModule = mod(DOWNSAMPLE_WGSL), materialModule = mod(materialShader()), tintModule = mod(TINT_WGSL), glowModule = mod(GLOW_WGSL), contentModule = mod(CONTENT_WGSL);
  const premul = {color: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}};
  const [backdropPipe, downsamplePipe, materialPipe, sdfPipelines, rimPipes, lumaPipes, tintPipe, tintClipPipe, tintOverPipe, glowPipe, glowOverPipe, glowCornerPipe, glowFillPipe, analytic, contentPipe] = await Promise.all([
    device.createRenderPipelineAsync({layout: 'auto', vertex: {module: backdropModule, entryPoint: 'vs'}, fragment: {module: backdropModule, entryPoint: 'fs', targets: [{format: 'rgba8unorm'}]}}),
    device.createRenderPipelineAsync({layout: 'auto', vertex: {module: downsampleModule, entryPoint: 'downsampleBlurVert'}, fragment: {module: downsampleModule, entryPoint: 'variableBlurDownsampleFrag', targets: [{format: 'rgba8unorm'}]}}),
    device.createRenderPipelineAsync({layout: 'auto', vertex: {module: materialModule, entryPoint: 'materialVert'}, fragment: {module: materialModule, entryPoint: 'glassBackgroundNoBleed', targets: [{format: 'rgba8unorm', blend: premul}]}}),
    prepareSDFPipelines(device),
    createRimPipelines(device, 'rgba8unorm'),
    createLumaPipelines(device),
    device.createRenderPipelineAsync({layout: 'auto', vertex: {module: tintModule, entryPoint: 'vs'}, fragment: {module: tintModule, entryPoint: 'fs', targets: [{format: 'rgba8unorm', blend: premul}]}}),
    device.createRenderPipelineAsync({layout: 'auto', vertex: {module: tintModule, entryPoint: 'vs'}, fragment: {module: tintModule, entryPoint: 'fsClip', targets: [{format: 'rgba8unorm'}]}}),
    device.createRenderPipelineAsync({layout: 'auto', vertex: {module: tintModule, entryPoint: 'vs'}, fragment: {module: tintModule, entryPoint: 'fsOver', targets: [{format: 'rgba8unorm', blend: premul}]}}),
    device.createRenderPipelineAsync({layout: 'auto', vertex: {module: glowModule, entryPoint: 'vs'}, fragment: {module: glowModule, entryPoint: 'fs', targets: [{format: 'rgba8unorm'}]}}),
    device.createRenderPipelineAsync({layout: 'auto', vertex: {module: glowModule, entryPoint: 'vs'}, fragment: {module: glowModule, entryPoint: 'fsOver', targets: [{format: 'rgba8unorm', blend: premul}]}}),
    device.createRenderPipelineAsync({layout: 'auto', vertex: {module: glowModule, entryPoint: 'vsCorner', buffers: [{arrayStride: 16, attributes: [{shaderLocation: 0, offset: 0, format: 'float32x2'}, {shaderLocation: 1, offset: 8, format: 'float32x2'}]}]},
      fragment: {module: glowModule, entryPoint: 'fsCorner', targets: [{format: 'rgba8unorm', blend: {color: {srcFactor: 'zero', dstFactor: 'src-alpha'}, alpha: {srcFactor: 'zero', dstFactor: 'src-alpha'}}}]}}),
    device.createRenderPipelineAsync({layout: 'auto', vertex: {module: glowModule, entryPoint: 'vs'}, fragment: {module: glowModule, entryPoint: 'fsFill', targets: [{format: 'rgba8unorm'}]}}),
    createAnalyticGlass(device, 'rgba8unorm'),
    device.createRenderPipelineAsync({layout: 'auto', vertex: {module: contentModule, entryPoint: 'vs'}, fragment: {module: contentModule, entryPoint: 'fs', targets: [{format: 'rgba8unorm'}]}}),
  ]);
  const nearest = device.createSampler({minFilter: 'nearest', magFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge'});
  const quadIndices = device.createBuffer({size: 12, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(quadIndices, 0, new Uint16Array([0, 1, 2, 2, 3, 0]));
  const linear = device.createSampler({magFilter: 'linear', minFilter: 'linear'});
  const sourceSampler = device.createSampler({addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear'});
  const tintLut = device.createTexture({size: [256, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
  device.queue.writeTexture({texture: tintLut}, new Float16Array(Array.from({length: 256}, (_, i) => Array(4).fill(tintFalloff(((i + 0.5) / 256) * 11 - 1))).flat()), {bytesPerRow: 2048}, [256, 1]);
  const glowDiscs = new Map();
  const glowNoise = device.createTexture({size: [32, 32], format: 'bgra8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
  device.queue.writeTexture({texture: glowNoise}, blueNoise32(1), {bytesPerRow: 128}, [32, 32]);
  const glowCornerIndices = device.createBuffer({size: 48, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(glowCornerIndices, 0, new Uint16Array([0, 1, 2, 3].flatMap((c) => [0, 1, 2, 2, 3, 0].map((i) => i + c * 4))));
  const sdfSampler = device.createSampler({addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'nearest'});
  const uniform = (size) => device.createBuffer({size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
  const zeroLod = uniform(16);
  const lodFor = (s, opacity) => {
    if (opacity >= 1) return zeroLod;
    s.lodU ??= uniform(16);
    device.queue.writeBuffer(s.lodU, 0, new Float32Array([0, 1 - Math.max(0, opacity), 0, 0]));
    return s.lodU;
  };
  const contentsSDF = createContentsSDF(device), gaussianSlot = createSDFGaussian(device);
  function encodeField(encoder, {surfaces, scene, target, previous, encoder: mesh, contents, material, spacing, dpr}) {
    for (let i = 0, started = false; i < surfaces.length; started = true) {
      if (started) encoder.copyTextureToTexture({texture: target}, {texture: previous}, scene.size);
      if (surfaces[i].contents !== null && surfaces[i].contents !== undefined) {
        const {rect: r, contents: reach} = surfaces[i];
        (contents[i] ??= contentsSDF()).encode(encoder, {bounds: [r.x / dpr, r.y / dpr, r.w / dpr, r.h / dpr], zero: Math.max(material.outputSDFEffect.range.upper, smoothness(spacing), reach), one: Math.min(material.outputSDFEffect.range.lower, 0),
          scale: dpr, target, origin: scene.origin, previous: started ? previous : null, smoothness: Math.fround(smoothness(spacing)), path: surfaces[i].path ?? null});
        i++;
      } else {
        let j = i;
        while (j < surfaces.length && (surfaces[j].contents === null || surfaces[j].contents === undefined)) j++;
        mesh.encode(encoder, {...scene, target, previous, surfaces: sceneSurfaces(surfaces.slice(i, j), dpr), unionFirst: started});
        i = j;
      }
    }
  }

  function createSlot() {
    return {key: '', backdropU: uniform(64), downsampleU: [uniform(32), uniform(32), uniform(32)], materialU: uniform(384), quadU: uniform(80), source: null, sdf: null, sdfPrev: null, sdfEncoder: null,
      hlVertices: device.createBuffer({size: 192, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST}), hlVertexU: uniform(80), hlU: uniform(368), hlU2: uniform(368),
      hlKey: '', snapshot: null, tintUs: [], tintSnap: null, tintSdf: [],
      lumaU: uniform(32), lumaPartial: null, lumaOut: device.createBuffer({size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC}),
      lumaRead: device.createBuffer({size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST}), lumaMapping: false, lumaCopied: false};
  }
  const slots = new Map();
  const retired = [];
  const retire = (...rs) => { for (const r of rs) if (r) retired.push(r); };

  function slotFor(id, a, sourceSize, levels) {
    let s = slots.get(id);
    if (!s) slots.set(id, (s = createSlot()));
    const key = `${a.w}x${a.h}`, sourceKey = `${sourceSize.join('x')}/${levels}`;
    if (s.key !== key) {
      retire(s.sdf);
      s.sdf = device.createTexture({size: [a.w, a.h], format: 'rgba16float', usage});
      s.key = key;
    }
    if (s.sourceKey !== sourceKey) {
      retire(s.source);
      s.source = device.createTexture({size: sourceSize, format: 'rgba8unorm', mipLevelCount: levels, usage});
      s.sourceKey = sourceKey;
    }
    return s;
  }

  return {
    endFrame() {
      for (const r of retired.splice(0)) r.destroy();
    },
    field(id) {
      return slots.get(id)?.field ?? null;
    },
    ready(id, ownTints = 0) {
      const s = slots.get(id);
      return !!s?.sdfEncoder && s.tintSdf.length >= ownTints;
    },
    prepare(id, ownTints = 0) {
      let s = slots.get(id);
      if (!s) slots.set(id, (s = createSlot()));
      s.sdfEncoder ??= createSDFEncoder(device, sdfPipelines);
      while (s.tintSdf.length < ownTints) s.tintSdf.push({encoder: createSDFEncoder(device, sdfPipelines), key: '', sdf: null, prev: null});
      return Promise.resolve();
    },
    /** @param encoder @param o.id @param o.backdrop @param o.target @param o.rect @param o.surfaces @param o.spacing @param o.gaussian @param o.materialSize @param o.materialProgress @param o.materialFrom @param o.materialSplit @param o.dpr @param o.variant @param o.scissor @param o.sampleClip @param o.tracks @param o.outputs @param o.layoutShortSide */
    encode(encoder, {platform = IOS26_5, id, backdrop, target, rect, surfaces, spacing = null, gaussian = 0, materialSize = null, materialProgress = 1, materialFrom = null, materialSplit = null, lens = null, dpr, scheme, variant = 'regular', luminance = null, materialComposite = null, pocket = null, scissor, sampleClip = null, materialPath = 'T', tracks = null, layoutShortSide = null, noLuminance = false, outputs = null}) {
      const a = glassAllocation(rect, dpr);
      const [W, H] = [target.width, target.height];
      const widthPt = materialSize ? materialSize[0] : rect.w / dpr, heightPt = materialSize ? materialSize[1] : rect.h / dpr;
      const shortSide = materialSize ? Math.min(...materialSize) : glassShortSide(surfaces, dpr);
      const tracksLuma = variant !== 'clear' && variant !== 'lens' && variant !== 'text' && (tracks ?? shortSide <= platform.luminance.tracksUpTo);
      const k = variant === 'clear' ? 1 / CLEAR_BACKDROP_SCALE : variant === 'lens' ? 1 : 4;
      const recipe = {width: widthPt, height: heightPt, shapes: materialSize ? [materialSize] : surfaces.filter((s) => !s.member?.g?.shapeOnly).map(({rect: r}) => [r.w / dpr, r.h / dpr]), progress: materialProgress, from: materialFrom, split: materialSplit, lens, dpr, scheme, variant, luminance: tracksLuma ? luminance : null, materialComposite: tracksLuma ? materialComposite : null,
        frost: pocket && tracksLuma ? pocket.frost : 0, pocketFill: pocket && tracksLuma ? pocket.fill : null, extent: [a.w, a.h], sourceScale: 1 / k, sdfUVTransform: [1, 1, 0, 0],
        optionsDistance: materialSize ? null : layoutShortSide, noLuminance, outputs: tracksLuma && !materialSize && materialProgress === 1 && !materialSplit ? outputs : null, platform};
      const pre = regularGlassMaterial({...recipe, sourceSize: [1, 1], sourceUVTransform: [1, 1, 0, 0]});
      const domain = backdropDomain({rect, dpr, target: [W, H], sourceScale: 1 / k, margin: Math.fround(pre.domainMaterial.backdropProviderMargin.value), blur: pre.domainMaterial.backdropBlurContribution});
      if (!domain) return null;
      const [cx, cy, cw, ch] = domain.candidateBounds, [sx, sy, lw, lh] = domain.sourceBounds;
      const sw = Math.ceil(lw / 64) * 64, sh = Math.ceil(lh / 64) * 64;
      const levels = variant === 'lens' ? 5 : Math.max(1, domain.stableMipLevels);
      const s = slotFor(id, a, [sw, sh], levels);
      while (s.downsampleU.length < levels - 1) s.downsampleU.push(uniform(32));
      if (!s.sdfEncoder) throw new Error('prepare() the glass before encode()');

      const material = regularGlassMaterial({...recipe, sourceSize: [sw, sh],
        sourceUVTransform: [a.w / k / sw, a.h / k / sh, (a.x / k - sx) / sw, (a.y / k - sy) / sh]});
      const injected = globalThis.__glassMaterialFields ?? null;
      if (injected) material.uniform = packMaterial(material.fields, {width: a.w, height: a.h, sourceUVTransform: [a.w / k / sw, a.h / k / sh, (a.x / k - sx) / sw, (a.y / k - sy) / sh], sdfUVTransform: [1, 1, 0, 0]}, injected);
      device.queue.writeBuffer(s.materialU, 0, material.uniform);
      const [c0, c1, c2, c3] = sampleClip ?? [0, 0, W, H];
      device.queue.writeBuffer(s.backdropU, 0, new Float32Array([cx, cy, cw, ch, sx, sy, W, H, c0, c1, c2, c3, k, 0, 0, 0]));
      for (let l = 1; l < levels; l++) device.queue.writeBuffer(s.downsampleU[l - 1], 0, new Float32Array([0, 2 ** (l - 1) / sw, 2 ** (l - 1) / sh, 0, 0, 0, 1, 1]));

      const pass = (view, draw, load = 'clear') => {
        const p = encoder.beginRenderPass({colorAttachments: [{view, loadOp: load, storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
        draw(p);
        p.end();
      };
      const bind = (pipe, entries) => device.createBindGroup({layout: pipe.getBindGroupLayout(0), entries: entries.map((resource, binding) => ({binding, resource}))});

      pass(s.source.createView({baseMipLevel: 0, mipLevelCount: 1}), (p) => {
        p.setPipeline(backdropPipe);
        p.setBindGroup(0, bind(backdropPipe, [backdrop.createView(), linear, {buffer: s.backdropU}]));
        p.draw(3);
      });
      for (let l = 1; l < levels; l++)
        pass(s.source.createView({baseMipLevel: l, mipLevelCount: 1}), (p) => {
          p.setPipeline(downsamplePipe);
          p.setBindGroup(0, bind(downsamplePipe, [s.source.createView({baseMipLevel: l - 1, mipLevelCount: 1}), {buffer: s.downsampleU[l - 1]}, linear]));
          p.draw(3);
        });
      const lumaLevel = levels - 1;
      const region = lumaRegion([0, 0, lw, lh], lumaLevel);
      if (tracksLuma && region.bounds[0] > region.origin[0] && region.bounds[1] > region.origin[1]) {
        const dispatch = lumaDispatch(region.origin, region.bounds);
        const bytes = Math.max(1, dispatch.threadGroupCount) * 16;
        if (!s.lumaPartial || s.lumaPartial.size < bytes) {
          retire(s.lumaPartial);
          s.lumaPartial = device.createBuffer({size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC});
        }
        device.queue.writeBuffer(s.lumaU, 0, lumaUniform({origin: region.origin, bounds: region.bounds, level: lumaLevel}));
        const c = encoder.beginComputePass();
        c.setPipeline(lumaPipes.stage1);
        c.setBindGroup(0, device.createBindGroup({layout: lumaPipes.stage1.getBindGroupLayout(0), entries: [
          {binding: 0, resource: s.source.createView({baseMipLevel: lumaLevel, mipLevelCount: 1})}, {binding: 1, resource: {buffer: s.lumaU}}, {binding: 2, resource: {buffer: s.lumaPartial}}]}));
        c.dispatchWorkgroups(dispatch.groupsX, dispatch.groupsY, 1);
        c.setPipeline(lumaPipes.stage2);
        c.setBindGroup(0, device.createBindGroup({layout: lumaPipes.stage2.getBindGroupLayout(0), entries: [
          {binding: 0, resource: {buffer: s.lumaU}}, {binding: 1, resource: {buffer: s.lumaPartial}}, {binding: 2, resource: {buffer: s.lumaOut}}]}));
        c.dispatchWorkgroups(1, 1, 1);
        c.end();
        if (!s.lumaMapping) {
          encoder.copyBufferToBuffer(s.lumaOut, 0, s.lumaRead, 0, 16);
          s.lumaCopied = true;
        }
      }
      s.alloc = a;
      s.material = material; s.spacing = spacing;
      s.scene = {unionSmoothness: smoothness(spacing), gaussianRadius: gaussian > 0 ? gaussian : 0, gradientOvalization: material.gradientOvalization, outputSDFEffect: material.outputSDFEffect,
        size: [a.w, a.h], origin: [a.x, a.y], scissor: [0, 0, a.w, a.h], renderScale: dpr, screenCenter: [0, 0]};
      const shared = outerPadding(material.outputSDFEffect, smoothness(spacing), gaussian > 0 ? gaussian : 0), padding = shared * dpr;
      const unblurred = outerPadding(material.outputSDFEffect, smoothness(spacing));
      const ox = Math.min(...surfaces.map((e) => Math.round(e.rect.x - padding) - 1)), oy = Math.min(...surfaces.map((e) => Math.round(e.rect.y - padding) - 1));
      const rawW = Math.ceil((Math.max(...surfaces.map((e) => e.rect.x + e.rect.w + padding)) + 1 - ox) / 64) * 64;
      const rawH = Math.ceil((Math.max(...surfaces.map((e) => e.rect.y + e.rect.h + padding)) + 1 + 8 * dpr - oy) / 64) * 64;
      if (s.rawKey !== `${rawW}x${rawH}`) {
        retire(s.sdfRaw, s.sdfPrev);
        s.sdfRaw = device.createTexture({size: [rawW, rawH], format: 'rgba16float', usage});
        s.sdfPrev = device.createTexture({size: [rawW, rawH], format: 'rgba16float', usage});
        s.rawKey = `${rawW}x${rawH}`;
      }
      const f = Math.fround, inset = Math.trunc(dpr * f(unblurred - f(smoothness(spacing) + 1)));
      const zero = (e) => Math.max(material.outputSDFEffect.range.upper, smoothness(spacing), e.contents);
      const layer = (axis) => Math.min(axis ? rect.y : rect.x, ...surfaces.filter((e) => e.contents !== null && e.contents !== undefined).map((e) => Math.floor((axis ? e.rect.y : e.rect.x) / dpr - zero(e)) * dpr));
      s.maskOrigin = [layer(0), layer(1)].map((v) => Math.floor(f(f(v - dpr * unblurred) + 0.5)) + inset);
      const fromX = Math.max(0, a.x - ox), fromY = Math.max(0, a.y - oy), toX = Math.max(0, ox - a.x), toY = Math.max(0, oy - a.y);
      const fieldKey = JSON.stringify([rawW, rawH, a.w, a.h, fromX, fromY, toX, toY, dpr, gaussian, spacing, material.outputSDFEffect, material.gradientOvalization,
        surfaces.map((e) => [e.rect.x - ox, e.rect.y - oy, e.rect.w, e.rect.h, e.radius, e.cornerStyle, e.bottomRadius ?? null, e.contents ?? null,
          e.contents !== null && e.contents !== undefined ? [e.rect.x, e.rect.y] : null, e.path?.key ?? null])]);
      if (s.fieldKey !== fieldKey || s.fieldTextures !== s.sdf || s.fieldRaw !== s.sdfRaw) {
        encodeField(encoder, {surfaces, scene: {...s.scene, size: [rawW, rawH], origin: [ox, oy], scissor: [0, 0, rawW, rawH], rootProjectionReference: true}, target: s.sdfRaw, previous: s.sdfPrev,
          encoder: s.sdfEncoder, contents: (s.contents ??= []), material, spacing, dpr});
        if (gaussian > 0) (s.gaussian ??= gaussianSlot()).encode(encoder, s.sdfRaw, gaussian, dpr);
        encoder.beginRenderPass({colorAttachments: [{view: s.sdf.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]}).end();
        encoder.copyTextureToTexture({texture: s.sdfRaw, origin: [fromX, fromY]}, {texture: s.sdf, origin: [toX, toY]}, [Math.min(rawW - fromX, a.w - toX), Math.min(rawH - fromY, a.h - toY)]);
        s.fieldKey = fieldKey; s.fieldTextures = s.sdf; s.fieldRaw = s.sdfRaw;
      }
      s.field = {texture: s.sdfRaw, origin: [ox, oy]};
      const margin = tracksLuma ? 134.4 - pre.domainMaterial.backdropProviderMargin.value : 0, drop = tracksLuma ? [0, 8 * dpr] : [0, 0], at = [sx * k, sy * k], end = [(sx + lw) * k, (sy + lh) * k];
      let from = at.map((v, i) => v - margin + drop[i]), to = end.map((v, i) => v + margin + drop[i]);
      if (variant === 'lens' && lens?.large) {
        const o = pre.inputs.inputShadowOffset ?? {width: 0, height: 0}, m = (28 / 3) * dpr;
        const dx = o.width * dpr, dy = o.height * dpr;
        from = [rect.x - m + dx, rect.y - m + dy]; to = [rect.x + rect.w + m + dx, rect.y + rect.h + m + dy];
      }
      device.queue.writeBuffer(s.quadU, 0, new Float32Array([...from, ...to, ...from.map((v, i) => (v - at[i]) / k), ...to.map((v, i) => (v - at[i]) / k),
        from[0] - ox, from[1] - oy, to[0] - ox, to[1] - oy, 1 / sw, 1 / sh, 1 / rawW, 1 / rawH, 2 / W, 2 / H, 0, 0]));
      material.uniform[LANE.shadowOffsetX] *= a.w / rawW; material.uniform[LANE.shadowOffsetY] *= a.h / rawH;
      device.queue.writeBuffer(s.materialU, 0, material.uniform);
      const inline = materialPath === 'A' && surfaces.length === 1 ? regularGlassMaterial({...recipe, sourceSize: [sw, sh], materialBranch: 'analytic-sdf', sourceUVTransform: [1, 1, 0, 0]}) : null;
      s.inline = !!inline;
      const draws = inline && analyticDraws({surface: surfaces[0], dpr, material: inline, smoothness: smoothness(spacing), source: {dimensions: [sw, sh], origin: [sx, sy], scale: 1 / k}})
        .map(({prefix, geometry: g}) => ({prefix, vertices: g.vertices, indices: g.indices, count: g.count}));
      const inlineUniform = inline && packMaterial(inline.fields, {width: W, height: H, sourceUVTransform: [1, 1, 0, 0], sdfUVTransform: [1, 1, 0, 0]}, injected);
      pass(target.createView(), (p) => {
        let [sx, sy, sw, sh] = scissor;
        if (!draws) {
          const x0 = Math.max(sx, Math.floor(from[0])), y0 = Math.max(sy, Math.floor(from[1])), x1 = Math.min(sx + sw, Math.ceil(to[0])), y1 = Math.min(sy + sh, Math.ceil(to[1]));
          [sx, sy, sw, sh] = [x0, y0, x1 - x0, y1 - y0];
        }
        if (sw <= 0 || sh <= 0) return;
        p.setScissorRect(sx, sy, sw, sh);
        if (draws) { (s.analytic ??= analytic.glass()).encode(p, {draws, uniform: inlineUniform, size: [W, H], source: s.source.createView(), sampler: sourceSampler}); return; }
        p.setPipeline(materialPipe);
        p.setBindGroup(0, bind(materialPipe, [s.source.createView(), sourceSampler, s.sdfRaw.createView(), sdfSampler, {buffer: s.materialU}, {buffer: s.quadU}]));
        p.draw(6);
      }, 'load');
      return material;
    },
    /** @param o.tints */
    encodeTints(encoder, {id, target, rect, dpr, scissor, tints}) {
      const s = slots.get(id);
      if (!s?.sdf) return;
      const a = s.alloc, [W, H] = [target.width, target.height];
      const x0 = Math.max(a.x, scissor[0], 0), y0 = Math.max(a.y, scissor[1], 0);
      const x1 = Math.min(a.x + a.w, scissor[0] + scissor[2], W), y1 = Math.min(a.y + a.h, scissor[1] + scissor[3], H);
      if (x1 <= x0 || y1 <= y0) return;
      if (!s.tintSnap || s.tintSnap.width !== W || s.tintSnap.height !== H) {
        retire(s.tintSnap);
        s.tintSnap = device.createTexture({size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING});
      }
      if (s.tintGroupKey !== `${a.w}x${a.h}`) {
        retire(s.tintGroup, s.tintPrev);
        s.tintGroup = device.createTexture({size: [a.w, a.h], format: 'rgba8unorm', usage});
        s.tintPrev = device.createTexture({size: [a.w, a.h], format: 'rgba8unorm', usage});
        s.tintGroupKey = `${a.w}x${a.h}`;
      }
      const [gx, gy] = s.maskOrigin.map((v) => v & 1);
      const size = [x1 - x0, y1 - y0], at = [Math.max(0, x0 - a.x - gx), Math.max(0, y0 - a.y - gy)];
      encoder.copyTextureToTexture({texture: target, origin: [x0, y0]}, {texture: s.tintSnap, origin: [x0, y0]}, size);
      tints.forEach(({matrix, own}, k) => {
        const u = new Float32Array(28);
        u.set(matrix, 0);
        u.set([a.x + gx, a.y + gy, k ? 1 : 0, 0, gx, gy, 0, 0], 20);
        const tintU = (s.tintUs[k] ??= uniform(112));
        device.queue.writeBuffer(tintU, 0, u);
        let ownSdf = s.sdf;
        if (own) {
          const t = s.tintSdf[k], key = `${a.w}x${a.h}`;
          if (t.key !== key) {
            retire(t.sdf, t.prev);
            t.sdf = device.createTexture({size: [a.w, a.h], format: 'rgba16float', usage});
            t.prev = device.createTexture({size: [a.w, a.h], format: 'rgba16float', usage});
            t.key = key;
          }
          encodeField(encoder, {surfaces: own, scene: s.scene, target: t.sdf, previous: t.prev, encoder: t.encoder, contents: (t.contents ??= []), material: s.material, spacing: s.spacing, dpr});
          ownSdf = t.sdf;
        }
        if (k) encoder.copyTextureToTexture({texture: s.tintGroup, origin: at}, {texture: s.tintPrev, origin: at}, size);
        const p = encoder.beginRenderPass({colorAttachments: [{view: s.tintGroup.createView(), loadOp: k ? 'load' : 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store'}]});
        p.setScissorRect(...at, ...size);
        p.setPipeline(tintPipe);
        p.setBindGroup(0, device.createBindGroup({layout: tintPipe.getBindGroupLayout(0), entries: [
          {binding: 0, resource: ownSdf.createView()}, {binding: 1, resource: s.tintPrev.createView()}, {binding: 2, resource: s.tintSnap.createView()}, {binding: 3, resource: {buffer: tintU}},
          {binding: 4, resource: tintLut.createView()}, {binding: 5, resource: sdfSampler}]}));
        p.draw(3);
        p.end();
      });
      const clip = encoder.beginRenderPass({colorAttachments: [{view: s.tintPrev.createView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store'}]});
      clip.setScissorRect(...at, ...size);
      clip.setPipeline(tintClipPipe);
      clip.setBindGroup(0, device.createBindGroup({layout: tintClipPipe.getBindGroupLayout(0), entries: [
        {binding: 0, resource: s.sdf.createView()}, {binding: 1, resource: s.tintGroup.createView()}, {binding: 3, resource: {buffer: s.tintUs[0]}}]}));
      clip.draw(3);
      clip.end();
      const over = encoder.beginRenderPass({colorAttachments: [{view: target.createView(), loadOp: 'load', storeOp: 'store'}]});
      over.setScissorRect(x0, y0, ...size);
      over.setPipeline(tintOverPipe);
      over.setBindGroup(0, device.createBindGroup({layout: tintOverPipe.getBindGroupLayout(0), entries: [{binding: 1, resource: s.tintPrev.createView()}, {binding: 3, resource: {buffer: s.tintUs[0]}}]}));
      over.draw(3);
      over.end();
    },
    /** @param o.element @param o.glow @param o.size @param o.viewRadius @param o.inPlace */
    encodeGlow(encoder, {id, target, element, view, glow, size, viewRadius, scissor, inPlace = false}) {
      const s = slots.get(id);
      if (!s?.sdf) return;
      const a = s.alloc, [W, H] = [target.width, target.height], e = view ?? element.rect;
      const x0 = Math.max(e.x - 2, a.x, scissor[0], 0), y0 = Math.max(e.y - 2, a.y, scissor[1], 0);
      const x1 = Math.min(e.x + e.w + 2, a.x + a.w, scissor[0] + scissor[2], W), y1 = Math.min(e.y + e.h + 2, a.y + a.h, scissor[1] + scissor[3], H);
      if (x1 <= x0 || y1 <= y0) return;
      if (!s.glowUnder || s.glowUnder.width !== W || s.glowUnder.height !== H) {
        retire(s.glowUnder);
        s.glowUnder = device.createTexture({size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING});
      }
      const side = Math.round(glow.side * 1000) / 1000;
      let image = glowDiscs.get(side);
      if (!image) {
        const {size: n, pixels, origin, extent} = glowDiscImage(glow.side), stride = Math.ceil(n / 256) * 256, rows = new Uint8Array(stride * n);
        const texture = device.createTexture({size: [n, n], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
        for (let y = 0; y < n; y++) rows.set(pixels.subarray(y * n, (y + 1) * n), y * stride);
        device.queue.writeTexture({texture}, rows, {bytesPerRow: stride}, [n, n]);
        glowDiscs.set(side, (image = {texture, origin, extent}));
      }
      const cx = e.x + (glow.position[0] * e.w) / size[0], cy = e.y + (glow.position[1] * e.h) / size[1];
      const sx = (e.w / size[0]) * glow.scale, sy = (e.h / size[1]) * glow.scale;
      const byte = (v) => Math.trunc(Math.max(0, Math.min(1, v)) * 255 + 0.5) / 255;
      const f = Math.fround, near = (v) => Math.floor(f(f(v) + 0.5)), ox = Math.floor(f(e.x)), oy = Math.floor(f(e.y)), gw = Math.ceil(f(e.x + e.w)) - ox, gh = Math.ceil(f(e.y + e.h)) - oy;
      if (!s.glowGroup || s.glowGroup.width < gw || s.glowGroup.height < gh) {
        retire(s.glowGroup, s.glowMask);
        s.glowGroup = device.createTexture({size: [Math.ceil(gw / 64) * 64, Math.ceil(gh / 64) * 64], format: 'rgba8unorm', usage});
        s.glowMask = device.createTexture({size: [s.glowGroup.width, s.glowGroup.height], format: 'rgba8unorm', usage});
      }
      const corners = viewRadius > 0 ? glowCorners(size, viewRadius, [e.w / size[0], e.h / size[1]], [e.x, e.y]) : null;
      const curve = element.cornerStyle === 0 ? [1, 1] : corners?.weights ?? [0, 0];
      const u = new Float32Array(36);
      u.set(BIG_GLOW, 0);
      const half = Math.f16round ?? ((v) => v);
      u.set([glow.first || inPlace ? half(byte(glow.big)) : glow.big > 0 ? 1 : 0, byte(glow.little), 0, 0, ...(glow.quad ?? [cx + (image.origin - glow.side / 2) * sx, cy + (image.origin - glow.side / 2) * sy, image.extent * sx, image.extent * sy]), ox, oy, a.x, a.y, s.glowGroup.width, s.glowGroup.height, curve[0], curve[1]], 20);
      const glowU = uniform(144);
      retire(glowU);
      device.queue.writeBuffer(glowU, 0, u);
      encoder.copyTextureToTexture({texture: target, origin: [x0, y0]}, {texture: s.glowUnder, origin: [x0, y0]}, [x1 - x0, y1 - y0]);
      const left = Math.max(x0, near(e.x)) - ox, top = Math.max(y0, near(e.y)) - oy, scissor2 = [left, top, Math.min(x1, near(e.x + e.w)) - ox - left, Math.min(y1, near(e.y + e.h)) - oy - top];
      if (scissor2[2] <= 0 || scissor2[3] <= 0) return;
      const group = encoder.beginRenderPass({colorAttachments: [{view: s.glowGroup.createView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store'}]});
      group.setScissorRect(...scissor2);
      group.setPipeline(glowPipe);
      group.setBindGroup(0, device.createBindGroup({layout: glowPipe.getBindGroupLayout(0), entries: [
        {binding: 1, resource: s.glowUnder.createView()}, {binding: 2, resource: image.texture.createView()}, {binding: 3, resource: sdfSampler}, {binding: 4, resource: {buffer: glowU}}, {binding: 5, resource: glowNoise.createView()}]}));
      group.draw(3);
      if (corners) {
        const mesh = device.createBuffer({size: 256, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
        retire(mesh);
        device.queue.writeBuffer(mesh, 0, corners.vertices);
        group.setPipeline(glowCornerPipe);
        group.setBindGroup(0, device.createBindGroup({layout: glowCornerPipe.getBindGroupLayout(0), entries: [{binding: 4, resource: {buffer: glowU}}]}));
        group.setVertexBuffer(0, mesh);
        group.setIndexBuffer(glowCornerIndices, 'uint16');
        group.drawIndexed(24);
      }
      group.end();
      const fill = encoder.beginRenderPass({colorAttachments: [{view: s.glowMask.createView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store'}]});
      fill.setScissorRect(...scissor2);
      fill.setPipeline(glowFillPipe);
      fill.setBindGroup(0, device.createBindGroup({layout: glowFillPipe.getBindGroupLayout(0), entries: [{binding: 0, resource: s.sdf.createView()}, {binding: 4, resource: {buffer: glowU}}]}));
      fill.draw(3);
      fill.end();
      const p = encoder.beginRenderPass({colorAttachments: [{view: target.createView(), loadOp: 'load', storeOp: 'store'}]});
      p.setScissorRect(scissor2[0] + ox, scissor2[1] + oy, scissor2[2], scissor2[3]);
      p.setPipeline(glowOverPipe);
      p.setBindGroup(0, device.createBindGroup({layout: glowOverPipe.getBindGroupLayout(0), entries: [{binding: 1, resource: s.glowGroup.createView()}, {binding: 4, resource: {buffer: glowU}}, {binding: 6, resource: s.glowMask.createView()}]}));
      p.draw(3);
      p.end();
    },
    contentBefore(encoder, {id, target, region}) {
      const s = slots.get(id);
      if (!s?.sdf) return false;
      const [W, H] = [target.width, target.height];
      if (!s.contentBefore || s.contentBefore.width !== W || s.contentBefore.height !== H) {
        retire(s.contentBefore, s.contentAfter);
        s.contentBefore = device.createTexture({size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING});
        s.contentAfter = device.createTexture({size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING});
      }
      encoder.copyTextureToTexture({texture: target, origin: [region[0], region[1]]}, {texture: s.contentBefore, origin: [region[0], region[1]]}, [region[2], region[3]]);
      return true;
    },
    contentMask(encoder, {id, target, region}) {
      const s = slots.get(id);
      encoder.copyTextureToTexture({texture: target, origin: [region[0], region[1]]}, {texture: s.contentAfter, origin: [region[0], region[1]]}, [region[2], region[3]]);
      const u = (s.contentU ??= uniform(16));
      device.queue.writeBuffer(u, 0, new Float32Array([s.alloc.x, s.alloc.y, 0, 0]));
      const p = encoder.beginRenderPass({colorAttachments: [{view: target.createView(), loadOp: 'load', storeOp: 'store'}]});
      p.setScissorRect(...region);
      p.setPipeline(contentPipe);
      p.setBindGroup(0, device.createBindGroup({layout: contentPipe.getBindGroupLayout(0), entries: [{binding: 0, resource: s.sdf.createView()}, {binding: 1, resource: s.contentBefore.createView()},
        {binding: 2, resource: s.contentAfter.createView()}, {binding: 3, resource: {buffer: u}}]}));
      p.draw(3);
      p.end();
    },
    encodeHighlight(encoder, {platform = IOS26_5, id, target, surfaces, spacing = null, dpr, scheme, materialComposite = null, scissor, rimOpacity = 1, variant = 'regular'}) {
      const s = slots.get(id);
      if (!s) throw new Error('prepare() the glass before encodeHighlight()');
      const recipe = highlightRecipe(materialComposite ?? [{colorScheme: scheme, weight: 1}], platform);
      if (!recipe || !s.alloc) return;
      const shortSide = glassShortSide(surfaces, dpr);
      const a = s.alloc, [W, H] = [target.width, target.height];
      if (s.hlKey !== `${W}x${H}`) {
        retire(s.snapshot);
        s.snapshot = device.createTexture({size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING});
        s.hlKey = `${W}x${H}`;
      }
      const [ox, oy, ew, eh] = [a.x, a.y, a.w, a.h];
      const v = new Float32Array(48);
      [[ox, oy, 0, 0], [ox + ew, oy, ew, 0], [ox + ew, oy + eh, ew, eh], [ox, oy + eh, 0, eh]].forEach(([x, y, u, w], i) => v.set([x, y, 0, 1, u, w], i * 12));
      device.queue.writeBuffer(s.hlVertices, 0, v);
      device.queue.writeBuffer(s.hlVertexU, 0, new Float32Array([2 / W, 0, 0, 0, 0, -2 / H, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1, 1 / a.w, 1 / a.h, 0, 0]));
      const u = new Float32Array(92);
      u.set(recipe.columns, 24); u.set([recipe.clamp ?? 0, recipe.preserveHue ?? 0], 44); u.set(recipe.highlight, 68);
      u[89] = 1 - Math.min(1, Math.max(0, rimOpacity));
      const spread = Math.PI / 2 + (2.792526803190927 - Math.PI / 2) * Math.min(1, Math.max(0, (shortSide - 166) / (201.3 - 166)));
      u[68 + 1] = u[68 + 6] = Math.cos(spread);
      device.queue.writeBuffer(s.hlU, 0, u);
      const x0 = Math.min(W, Math.max(0, Math.floor(ox) - 1)), y0 = Math.min(H, Math.max(0, Math.floor(oy) - 1));
      const x1 = Math.min(W, Math.ceil(ox + ew) + 1), y1 = Math.min(H, Math.ceil(oy + eh) + 1);
      let [qx, qy, qw, qh] = [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
      const cx1 = Math.min(qx + qw, scissor[0] + scissor[2]), cy1 = Math.min(qy + qh, scissor[1] + scissor[3]);
      qx = Math.max(qx, scissor[0]); qy = Math.max(qy, scissor[1]); qw = cx1 - qx; qh = cy1 - qy;
      if (qw <= 0 || qh <= 0) return;
      if (s.inline) {
        const scene = sdfScene({surfaces: sceneSurfaces(surfaces, dpr), unionSmoothness: smoothness(spacing), size: [W, H], origin: [0, 0], scissor: [0, 0, W, H], renderScale: dpr, screenCenter: [0, 0],
          gradientOvalization: s.scene.gradientOvalization, sdfPadding: Math.fround(smoothness(spacing) + 1)});
        scene.forEach((input, i) => {
          const pipeline = rimPipes[input.kind === 'rect' ? 'rect' : 'curve'], d = ((s.rimBuffers ??= [])[i] ??= {vertices: device.createBuffer({size: 768, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST}), indices: device.createBuffer({size: 108, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST}), vertex: uniform(80), geometry: uniform(112), highlight: uniform(368)});
          input.vertexUniform.set(orthographicProjection([W, H]));
          for (const [name, data] of [['vertices', input.vertices], ['indices', input.indices], ['vertex', input.vertexUniform], ['geometry', input.uniform], ['highlight', u]]) device.queue.writeBuffer(d[name], 0, data);
          encoder.copyTextureToTexture({texture: target, origin: [qx, qy]}, {texture: s.snapshot, origin: [qx, qy]}, [qw, qh]);
          const p = encoder.beginRenderPass({colorAttachments: [{view: target.createView(), loadOp: 'load', storeOp: 'store'}]});
          p.setPipeline(pipeline);
          p.setBindGroup(0, device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: d.vertex}}, {binding: 1, resource: {buffer: d.geometry}}, {binding: 3, resource: {buffer: d.highlight}}, {binding: 4, resource: s.snapshot.createView()}]}));
          p.setScissorRect(qx, qy, qw, qh);
          p.setVertexBuffer(0, d.vertices);
          p.setIndexBuffer(d.indices, 'uint16');
          p.drawIndexed(input.indices.length);
          p.end();
        });
        return;
      }
      const pass = (buffer) => {
        encoder.copyTextureToTexture({texture: target, origin: [qx, qy]}, {texture: s.snapshot, origin: [qx, qy]}, [qw, qh]);
        const p = encoder.beginRenderPass({colorAttachments: [{view: target.createView(), loadOp: 'load', storeOp: 'store'}]});
        p.setPipeline(rimPipes.raster);
        p.setBindGroup(0, device.createBindGroup({layout: rimPipes.raster.getBindGroupLayout(0), entries: [
          {binding: 0, resource: {buffer: s.hlVertexU}}, {binding: 1, resource: {buffer}}, {binding: 2, resource: s.sdf.createView()},
          {binding: 3, resource: s.snapshot.createView()}, {binding: 4, resource: nearest}, {binding: 5, resource: {buffer: lodFor(s, rimOpacity)}}]}));
        p.setScissorRect(qx, qy, qw, qh);
        p.setVertexBuffer(0, s.hlVertices);
        p.setIndexBuffer(quadIndices, 'uint16');
        p.drawIndexed(6);
        p.end();
      };
      if (variant === 'text' && !s.inline) {
        TEXT_OVERLAYS(platform).forEach((o, i) => {
          const t = new Float32Array(92);
          t.set(o.columns, 24); t.set([1, 0], 44);
          if (o.kind === 'face') { t.set([-0.5 / dpr, 0.5 / dpr, 0, 1], 68); t[78] = -1; } else t.set(o.highlight, 68);
          t[89] = u[89];
          device.queue.writeBuffer(i ? s.hlU2 : s.hlU, 0, t);
          pass(i ? s.hlU2 : s.hlU);
        });
        return;
      }
      encoder.copyTextureToTexture({texture: target, origin: [qx, qy]}, {texture: s.snapshot, origin: [qx, qy]}, [qw, qh]);
      const p = encoder.beginRenderPass({colorAttachments: [{view: target.createView(), loadOp: 'load', storeOp: 'store'}]});
      p.setPipeline(rimPipes.raster);
      p.setBindGroup(0, device.createBindGroup({layout: rimPipes.raster.getBindGroupLayout(0), entries: [
        {binding: 0, resource: {buffer: s.hlVertexU}}, {binding: 1, resource: {buffer: s.hlU}}, {binding: 2, resource: s.sdf.createView()},
        {binding: 3, resource: s.snapshot.createView()}, {binding: 4, resource: nearest}, {binding: 5, resource: {buffer: lodFor(s, rimOpacity)}}]}));
      p.setScissorRect(qx, qy, qw, qh);
      p.setVertexBuffer(0, s.hlVertices);
      p.setIndexBuffer(quadIndices, 'uint16');
      p.drawIndexed(6);
      p.end();
    },
    collect(onLuma) {
      for (const [id, s] of slots) {
        if (!s.lumaCopied || s.lumaMapping) continue;
        s.lumaCopied = false;
        s.lumaMapping = true;
        const read = s.lumaRead;
        read.mapAsync(GPUMapMode.READ).then(() => {
          const sum = new Float32Array(read.getMappedRange().slice(0));
          read.unmap();
          s.lumaMapping = false;
          if (slots.get(id) === s) onLuma(id, sum);
        }, () => { s.lumaMapping = false; });
      }
    },
    release(id) {
      const s = slots.get(id);
      if (!s) return;
      for (const b of [s.lumaU, s.lumaOut, s.lumaRead, s.lumaPartial]) b?.destroy();
      for (const b of [s.backdropU, ...s.downsampleU, s.materialU, s.quadU, s.hlVertices, s.hlVertexU, s.hlU, s.hlU2, ...s.tintUs]) b.destroy();
      s.tintSnap?.destroy(); s.tintGroup?.destroy(); s.tintPrev?.destroy(); s.glowUnder?.destroy(); s.glowGroup?.destroy(); s.glowMask?.destroy(); s.glowMesh?.destroy(); s.glowU?.destroy(); s.contentBefore?.destroy(); s.contentAfter?.destroy(); s.contentU?.destroy(); s.rimBuffers?.forEach((d) => Object.values(d).forEach((b) => b.destroy()));
      for (const t of s.tintSdf) { t.encoder.destroy(); t.sdf?.destroy(); t.prev?.destroy(); }
      s.analytic?.destroy(); s.gaussian?.destroy(); s.lodU?.destroy(); s.source?.destroy(); s.sdf?.destroy(); s.sdfPrev?.destroy(); s.sdfEncoder?.destroy(); s.contents?.forEach((c) => c?.destroy()); s.tintSdf?.forEach((t) => t.contents?.forEach((c) => c?.destroy()));
      s.snapshot?.destroy(); s.sdfRaw?.destroy();
      slots.delete(id);
    },
    destroy() {
      for (const id of [...slots.keys()]) this.release(id);
      quadIndices.destroy(); zeroLod.destroy();
    },
  };
}
