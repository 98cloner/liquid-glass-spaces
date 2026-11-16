import type {Platform, RimLight} from '../platform/types.ts';
import {IOS26_5} from '../platform/ios26_5.ts';
import {SDF_FIELD_WGSL} from '../sdf/producer.ts';
import {decodeAnimatable, encodeAnimatable, encodeRGB, quantizeMatrix, resolveSRGB, vibrancyFill, yccMatrix} from './colour.ts';

const f = Math.fround;

export type Light = {height: number; heightScale: number; heightOffset: number; angle: number; spread: number; spreadScale: number; spreadOffset: number; amount: number; color: readonly number[]};
export function packKeyFill({key, fill, curvature, distanceOffset}: {key: Light; fill: Light; curvature: number; distanceOffset: number}) {
  const light = (v: Light) => {
    if (!(v.amount > 0)) throw new RangeError('positive amount required by this bounded adapter');
    const height = f(f(v.heightScale) * f(v.height) + f(v.heightOffset)), spread = f(f(v.spreadScale) * f(v.spread) + f(v.spreadOffset));
    return [height, f(Math.cos(spread)), f(1 / f(v.amount) - 2), f(Math.sin(f(v.angle))), f(-Math.cos(f(v.angle)))];
  };
  return new Float32Array([...light(key), ...light(fill), f(curvature), f(distanceOffset), ...key.color, ...fill.color]);
}


type Record = {d: number[]; opacity: number; controls: number[]; colors: (number[] | null)[]};
type Highlights = {hdr: number; inset: number; key: Record; fill: Record};
const endpoint = (r: {key: RimLight; fill: RimLight}): Highlights => {
  const record = (s: RimLight): Record => ({d: [s.height, s.spread, s.curvature, s.amount, s.extra], opacity: f(s.opacity), controls: s.controls.map(f),
    colors: [null, s.fill ? resolveSRGB(s.fill.map(f)) : null, null]});
  return {hdr: 1, inset: 0, key: record(r.key), fill: record(r.fill)};
};
function blend(entries: {colorScheme: 'light' | 'dark'; weight: number}[], rim: Platform['highlight']['rim']): Highlights | null {
  if (!entries.length || entries.length > 2 || new Set(entries.map((e) => e.colorScheme)).size !== entries.length || entries.some((e) => !Number.isFinite(e.weight)))
    throw new TypeError('one or two unique regular Composite occurrences required');
  const rows = entries.map((e) => ({w: e.weight, h: endpoint(rim[e.colorScheme])}));
  if (rows.length === 1 && rows[0].w === 1) return rows[0].h;
  const sum = (get: (h: Highlights) => number, wide = false) => {
    let r: number | undefined;
    for (const {w, h} of rows) { const t = wide ? get(h) * w : f(get(h) * f(w)); r = r === undefined ? t : wide ? r + t : f(r + t); }
    if (!Number.isFinite(r)) throw new RangeError('nonfinite composite field');
    return r!;
  };
  const record = (k: 'key' | 'fill'): Record => ({d: [0, 1, 2, 3, 4].map((i) => sum((h) => h[k].d[i], true)), opacity: sum((h) => h[k].opacity), controls: [0, 1, 2].map((i) => sum((h) => h[k].controls[i])),
    colors: [0, 1, 2].map((i) => {
      let total: number[] | undefined;
      for (const {w, h} of rows) { const t = encodeAnimatable(h[k].colors[i] ?? [0, 0, 0, 0], false).map((x) => f(x * f(w))); total = total ? total.map((x, j) => f(x + t[j])) : t; }
      const c = decodeAnimatable(total!, false);
      return c[3] === 0 ? null : c;
    })});
  const out = {hdr: sum((h) => h.hdr), inset: sum((h) => h.inset), key: record('key'), fill: record('fill')};
  const empty = (s: Record) => s.d.every((x) => x === 0) && s.opacity === 0 && s.controls.every((x) => x === 0) && s.colors.every((x) => x === null);
  return out.hdr === 0 && out.inset === 0 && empty(out.key) && empty(out.fill) ? null : out;
}
const columns = (m: readonly number[]) => new Float32Array(Array.from({length: 20}, (_, i) => m[(i % 4) * 5 + Math.floor(i / 4)]));
export function rimRecipe(entries: {colorScheme: 'light' | 'dark'; weight: number}[], platform: Platform = IOS26_5) {
  const h = blend(entries, platform.highlight.rim);
  if (!h) return null;
  const k = h.key;
  if (k.colors[0] !== null || k.colors[2] !== null) throw new RangeError('only regular middle fill color is supported');
  let matrix = yccMatrix(k.controls[0], k.controls[1], k.controls[2]);
  const fill = k.colors[1];
  if (fill) matrix = vibrancyFill(matrix, encodeRGB(fill.slice(0, 3)), fill[3]);
  matrix = quantizeMatrix(matrix);
  const light = (s: Record, angle: number): Light => ({height: s.d[0], heightScale: 1, heightOffset: 0, spread: s.d[1], spreadScale: 1, spreadOffset: 0, amount: s.d[3], color: [1, 1, 1, s.opacity], angle});
  const {angles} = platform.highlight;
  return {matrix, clamp: 1, preserveHue: 0, columns: columns(matrix),
    highlight: packKeyFill({key: light(k, angles.key), fill: light(h.fill, angles.fill), curvature: k.d[2], distanceOffset: 0})};
}


export const KEY_FILL_WGSL = `
struct KeyFillUniforms {
  p0: vec4<f32>, p1: vec4<f32>, p2: vec4<f32>,
  color0: vec4<f32>, color1: vec4<f32>,
};
fn keyFillBand(depth:f32, width:f32, aa:f32, curvature:f32)->f32 {
  let t=clamp(depth/width,0.0,1.0);
  let hard=select(0.0,1.0,t<1.0);
  return mix(hard,1.0-t,curvature)
    *clamp(depth/aa+0.5,0.0,1.0)
    *clamp((width-depth)/aa+0.5,0.0,1.0);
}
fn keyFillHighlight(sdf:vec4<f32>, u:KeyFillUniforms)->vec4<f32> {
  let inverseLength=1.0/sqrt(dot(sdf.yz,sdf.yz));
  if(u.p2.z == -1.0){
    let depth=-sdf.x*inverseLength;
    let alpha=clamp((depth-u.p0.x)/(u.p0.y-u.p0.x),0.0,1.0)*u.p0.w;
    return vec4<f32>(alpha);
  }
  let normal=sdf.yz*inverseLength;
  let depth=-(sdf.x+u.p2.w)*inverseLength;
  let aa=max(fwidth(depth),0.00009999999747378752);
  var key=keyFillBand(depth,u.p0.x,aa,u.p2.z)
    *clamp((dot(vec2<f32>(u.p0.w,u.p1.x),normal)-u.p0.y)/max(1.0-u.p0.y,0.0000009999999974752427),0.0,1.0);
  var fill=keyFillBand(depth,u.p1.y,aa,u.p2.z)
    *clamp((dot(u.p2.xy,normal)-u.p1.z)/max(1.0-u.p1.z,0.0000009999999974752427),0.0,1.0);
  if(depth < -5.0){key=0.0;fill=0.0;}
  if(key+fill < 0.0000009999999974752427){discard;}
  key=key/max(1.0+(1.0-key)*u.p0.z,0.0000009999999974752427);
  fill=fill/max(1.0+(1.0-fill)*u.p1.w,0.0000009999999974752427);
  return key*u.color0+fill*u.color1;
}
`;
export const VIBRANT_WGSL = `
struct VibrancyUniform { columns:array<vec4<f32>,5> };
fn vibrantColorMatrix(source:vec4<f32>,background:vec4<f32>,u:VibrancyUniform,limit:f32,preserveHue:f32)->vec4<f32>{
 let rgb=background.rgb/max(background.a,0.0000009999999974752427);
 let c=rgb.x*u.columns[0]+rgb.y*u.columns[1]+rgb.z*u.columns[2]+background.a*u.columns[3]+u.columns[4];
 let matrixAlpha=clamp(c.a,0.0,1.0);
 var result=vec4<f32>(c.rgb*matrixAlpha,matrixAlpha)*source.a;
 let alpha=result.a;
 if(limit>0.0){
  var straight=result.rgb/max(alpha,0.0000009999999974752427);
  if(preserveHue>0.0){let peak=max(max(straight.x,straight.y),straight.z);if(peak>limit){straight*=limit/peak;}}
  else {straight=clamp(straight,vec3<f32>(-0.75),vec3<f32>(limit));}
  result=vec4<f32>(straight*alpha,alpha);
 }
 return result;
}
fn vibrantColorMatrixSourceOver(source:vec4<f32>,background:vec4<f32>,u:VibrancyUniform,limit:f32,preserveHue:f32)->vec4<f32>{
 let color=vibrantColorMatrix(source,background,u,limit,preserveHue);
 return color+background*(1.0-color.a);
}
`;

const RASTER = `
 struct VertexUniform{mvp:mat4x4<f32>,texmat:vec4<f32>};
 struct MaterialUniform{lanes:array<vec4<f32>,23>};
 struct VertexOut{@builtin(position) position:vec4<f32>,@location(0) @interpolate(linear,center) uv:vec2<f32>};
 @group(0) @binding(0) var<uniform> vertex:VertexUniform;
 @group(0) @binding(1) var<uniform> material:MaterialUniform;
 @group(0) @binding(2) var source:texture_2d<f32>;
 @group(0) @binding(3) var destination:texture_2d<f32>;
 @group(0) @binding(4) var sourceSampler:sampler;
 @group(0) @binding(5) var<uniform> lod:vec4<f32>;
 @vertex fn rasterHighlightVertex(@location(0) position:vec4<f32>,@location(1) point:vec2<f32>)->VertexOut{
  var o:VertexOut;o.position=vertex.mvp*position;o.uv=point*vertex.texmat.xy+vertex.texmat.zw;return o;
 }
 @fragment fn rasterHighlightFragment(v:VertexOut)->@location(0) vec4<f32>{
  let sdf=textureSampleBias(source,sourceSampler,v.uv,lod.x);
  let h=keyFillHighlight(sdf,KeyFillUniforms(material.lanes[17],material.lanes[18],material.lanes[19],material.lanes[20],material.lanes[21]))*(1.0-lod.y);
  let columns=VibrancyUniform(array<vec4<f32>,5>(material.lanes[6],material.lanes[7],material.lanes[8],material.lanes[9],material.lanes[10]));
  return vibrantColorMatrixSourceOver(h,textureLoad(destination,vec2<i32>(v.position.xy),0),columns,material.lanes[11].x,material.lanes[11].y);
 }`;
const ANALYTIC = `
  struct HighlightParams {lanes: array<vec4<f32>, 23>};
  @group(0) @binding(3) var<uniform> highlight: HighlightParams;
  @group(0) @binding(4) var backdrop: texture_2d<f32>;
  fn shade(v: VertexOut, sdf: vec4<f32>) -> vec4<f32> {
    let h = keyFillHighlight(sdf, KeyFillUniforms(highlight.lanes[17], highlight.lanes[18], highlight.lanes[19], highlight.lanes[20], highlight.lanes[21])) * (1.0 - highlight.lanes[22].y);
    let columns = VibrancyUniform(array<vec4<f32>, 5>(highlight.lanes[6], highlight.lanes[7], highlight.lanes[8], highlight.lanes[9], highlight.lanes[10]));
    return vibrantColorMatrixSourceOver(h, textureLoad(backdrop, vec2<i32>(v.position.xy), 0), columns, highlight.lanes[11].x, highlight.lanes[11].y);
  }
  @fragment fn highlightCurve(v: VertexOut) -> @location(0) vec4<f32> { return shade(v, finish(v.point, curveSDF(v.point))); }
  @fragment fn highlightRect(v: VertexOut) -> @location(0) vec4<f32> { return shade(v, finish(v.point, rectSDF(v.point))); }`;

const vertexLayout: GPUVertexBufferLayout[] = [{arrayStride: 48, attributes: [{shaderLocation: 0, offset: 0, format: 'float32x4'}, {shaderLocation: 1, offset: 16, format: 'float32x2'}]}];
async function module(device: GPUDevice, label: string, code: string) {
  const m = device.createShaderModule({label, code});
  const errors = (await m.getCompilationInfo()).messages.filter((x) => x.type === 'error');
  if (errors.length) throw new Error(errors.map((x) => x.message).join('\n'));
  return m;
}
export async function createRimPipelines(device: GPUDevice, format: GPUTextureFormat) {
  const [raster, analytic] = await Promise.all([module(device, 'raster key/fill rim', KEY_FILL_WGSL + VIBRANT_WGSL + RASTER), module(device, 'analytic key/fill rim', SDF_FIELD_WGSL + KEY_FILL_WGSL + VIBRANT_WGSL + ANALYTIC)]);
  const pipeline = (m: GPUShaderModule, vertex: string, fragment: string) => device.createRenderPipelineAsync({layout: 'auto', primitive: {topology: 'triangle-list'},
    vertex: {module: m, entryPoint: vertex, buffers: vertexLayout}, fragment: {module: m, entryPoint: fragment, targets: [{format}]}});
  const [r, curve, rect] = await Promise.all([pipeline(raster, 'rasterHighlightVertex', 'rasterHighlightFragment'), pipeline(analytic, 'vertexMain', 'highlightCurve'), pipeline(analytic, 'vertexMain', 'highlightRect')]);
  return {raster: r, curve, rect};
}
