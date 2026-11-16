import {VIBRANT_WGSL as VIBRANT_COLOR_MATRIX_WGSL} from './material/highlight.ts';
import {shadowA8 as caShadowA8, shadowOpacity as caShadowOpacity} from './render/shadow.ts';
import {supercircleWGSL} from './shaders';

export interface LensFrame {
  tint: 'default' | 'orange';
  shadow?: number[];
  warp: number; blur: number;
  provider: number;
  recipe: number;
  inner: [number, number, number];
  key: number[]; fill: number[];
  large?: {H: number; q: number; curvature: number};
  rest: {opacity: number; image: {key: string; data: Uint8ClampedArray; w: number; h: number; x: number; y: number} | null;
    backdrop?: {blur: number; matrix: number[]; size?: [number, number]}};
}

const WGSL = `
${VIBRANT_COLOR_MATRIX_WGSL}
${supercircleWGSL}
struct U {
  rect: vec4f,
  fieldOrigin: vec4f,
  inner: vec4f,
  innerExtent: vec4f,
  fg: vec4f,
  fgK: vec4f,
  key: array<vec4f, 5>,
  fill: array<vec4f, 5>,
  large: vec4f,
  large2: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var field: texture_2d<f32>;
@group(0) @binding(2) var image: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@group(0) @binding(4) var taps: texture_2d<f32>;

@fragment fn fsPair(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let C = textureLoad(image, vec2i(pos.xy), 0); let m = u.inner.x;
  return C * ((1.0 - m) / max(1.0 - m * C.a, 0.000001));
}
@fragment fn fsOver(@builtin(position) pos: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(pos.xy + u.rect.xy), 0); }
@fragment fn fsPortal(@builtin(position) pos: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(pos.xy), 0) * u.inner.x; }
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let q = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(q * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
}
fn fieldAt(px: vec2f) -> vec4f {
  let p = vec2i(floor(px)) - vec2i(u.fieldOrigin.xy);
  let dim = vec2i(textureDimensions(field));
  if (any(p < vec2i(0)) || any(p >= dim)) { return vec4f(1e4, 0.0, 0.0, 0.0); }
  return textureLoad(field, p, 0);
}
fn q8(c: vec4f) -> vec4f { return round(clamp(c, vec4f(0.0), vec4f(1.0)) * 255.0) / 255.0; }

@fragment fn fsInner(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let f = fieldAt(pos.xy);
  let cov = clamp(0.5 - f.x / max(fwidth(f.x), 0.0001), 0.0, 1.0);
  let local = pos.xy - u.rect.xy - vec2f(0.0, u.inner.y);
  let m = textureSampleLevel(image, smp, (local - u.inner.zw) / u.innerExtent.xy, 0.0).r;
  let a = u.inner.x * (1.0 - m) * cov;
  return vec4f(0.0, 0.0, 0.0, a);
}

@fragment fn fsInnerLensed(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let s = fieldAt(pos.xy);
  let h = -s.x;
  let aa = max(fwidth(h), 0.0001);
  let B = select(clamp(0.5 + h / aa, 0.0, 1.0), 0.0, h < -5.0);
  let H = u.large2.y;
  let t = clamp(h / max(H, 1e-5), 0.0, 1.0);
  let w = select(0.0, (1.0 - sqrt(max(0.0, 1.0 - (1.0 - t) * (1.0 - t)))) * clamp(0.5 + (H - h) / aa, 0.0, 1.0), H > 0.0);
  let at = pos.xy + s.yz * w * u.large2.z;
  let f = fieldAt(at);
  let cov = clamp(0.5 - f.x / max(fwidth(f.x), 0.0001), 0.0, 1.0);
  let local = at - u.rect.xy - vec2f(0.0, u.inner.y);
  let m = textureSampleLevel(image, smp, (local - u.inner.zw) / u.innerExtent.xy, 0.0).r;
  return vec4f(0.0, 0.0, 0.0, u.inner.x * (1.0 - m) * cov * B);
}

fn highlight(before: vec4f, depth: f32, derivative: f32, normal: vec2f, threshold: f32, dir: vec2f, compensation: f32, columns: array<vec4f, 5>) -> vec4f {
  let height = 1.0;
  let t = clamp(depth / height, 0.0, 1.0);
  let band = (1.0 - t) * clamp(depth / derivative + 0.5, 0.0, 1.0) * clamp((height - depth) / derivative + 0.5, 0.0, 1.0);
  let angular = clamp((dot(normal, dir) - threshold) / max(1.0 - threshold, 0.000001), 0.0, 1.0);
  var h = band * angular;
  if (depth < -5.0) { h = 0.0; }
  let alpha = h / max(1.0 + (1.0 - h) * compensation, 0.000001);
  return vibrantColorMatrixSourceOver(vec4f(1.0, 1.0, 1.0, alpha), before, VibrancyUniform(columns), 1.0, 0.0);
}

fn keyFillBand(depth: f32, n: vec2f, aa: f32, threshold: f32, direction: vec2f, curvature: f32) -> f32 {
  let t = clamp(depth, 0.0, 1.0);
  let radial = mix(select(0.0, 1.0, t < 1.0), 1.0 - t, curvature);
  var b = radial * clamp(depth / aa + 0.5, 0.0, 1.0) * clamp((1.0 - depth) / aa + 0.5, 0.0, 1.0);
  b *= clamp((dot(direction, n) - threshold) / max(1.0 - threshold, 0.000001), 0.0, 1.0);
  return select(b, 0.0, depth < -5.0);
}
fn keyFillOver(source: vec4f, dest: vec4f, columns: array<vec4f, 5>) -> vec4f {
  let rgb = dest.rgb / max(dest.a, 0.000001);
  let m = rgb.r * columns[0] + rgb.g * columns[1] + rgb.b * columns[2] + dest.a * columns[3] + columns[4];
  let a = clamp(m.a, 0.0, 1.0) * source.a;
  return vec4f(clamp(m.rgb, vec3f(-0.75), vec3f(1.0)) * a, a) + (1.0 - a) * dest;
}

@fragment fn fsProvider(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let f = fieldAt(pos.xy);
  let fw = max(fwidth(f.x), 0.0001);
  let g = f.yz; let lg = max(length(g), 0.000001);
  let depth = -f.x / lg;
  let derivative = max(fwidth(depth), 0.0001);
  let size = u.fgK.zw;
  let at = (pos.xy - u.fieldOrigin.zw) / size;
  let before = textureSampleLevel(image, smp, at, 0.0);
  if (f.w < 0.001) { return before; }
  let cov = clamp(0.5 - f.x / fw, 0.0, 1.0);
  let ca = cos(u.fg.w); let sa = sin(u.fg.w);
  let r = vec2f(ca * g.x - sa * g.y, sa * g.x + ca * g.y);
  let amount = select(0.0, u.fg.x, -f.x < u.fg.y);
  let delta = vec2f(u.fgK.x * r.y, u.fgK.y * r.x) * amount / size;
  var rgb = vec3f(0.0); var alpha = 0.0;
  for (var i = 0; i < 7; i++) {
    let t = 1.0 - f32(i) / 3.0;
    let c = textureSampleLevel(taps, smp, at + t * delta, 0.0);
    rgb += c.rgb / max(c.a, 0.000001) * vec3f(max(t, 0.0), 1.0 - abs(t), max(-t, 0.0));
    alpha += c.a;
  }
  alpha /= 7.0;
  let spectral = vec4f(rgb / vec3f(2.0, 3.0, 2.0) * alpha, alpha);
  let edgeT = clamp((f.x - u.fg.z) / max(0.0 - u.fg.z, 0.0001), 0.0, 1.0);
  let edge = select(edgeT, 1.0 - mix(u.large.y, u.large.z, edgeT), u.large.x > 0.5) * cov;
  var c = q8(spectral * edge + before * (1.0 - alpha * edge));
  if (u.large.x > 0.5) {
    let n = g / lg;
    let kb = keyFillBand(depth, n, derivative, -4.371138828673793e-8, vec2f(-0.7071067690849304, -0.7071067690849304), u.large2.x);
    let fb = keyFillBand(depth, n, derivative, -4.371138828673793e-8, vec2f(0.7071067690849304, 0.7071067690849304), u.large2.x);
    if (kb + fb < 0.000001) { return c; }
    let a = (kb + fb) * u.large.w;
    return q8(keyFillOver(vec4f(a, a, a, a), c, u.fill));
  }
  c = q8(highlight(c, depth, derivative, g / lg, -4.371138828673793e-8, vec2f(-0.7071067690849304, -0.7071067690849304), 0.0, u.key));
  c = q8(highlight(c, depth, derivative, g / lg, -0.9396926164627075, vec2f(0.7071067690849304, 0.7071067690849304), 2.0, u.fill));
  return mix(before, c, u.innerExtent.w);
}
struct Shape { h: f32, w: f32, B: f32, n: vec2f };
fn shapeAt(P: vec2f) -> Shape {
  let half = u.rect.zw * 0.5;
  let p = P - (u.rect.xy + half);
  let R = min(half.x, half.y);
  let K = 1.5286649465560913;
  let E = R * K;
  let ap = abs(p);
  let wts = clamp(vec2f(2.0 * 1.4457785175867517) - (2.0 * half * 1.4457785175867517) / (R * 1.528665), vec2f(0.0), vec2f(1.0));
  let sg = select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0));
  var d: f32; var n: vec2f;
  if (all(ap > half - min(vec2f(E), half))) {
    let q = ap - half + vec2f(E + (R - E) * max(wts.x, wts.y));
    let v = max(vec2f(0.0), (ap - half + vec2f(E)) / E);
    let L = length(v); let hi = max(v.x, v.y);
    let t = clamp(select(0.0, min(v.x, v.y) / hi, hi > 0.0), 0.0, 1.0);
    let poly = (((-0.9260540008544922 * t + 3.1560099124908447) * t - 3.6412200927734375) * t + 1.268030047416687) * t + 0.2685309946537018;
    let cont = L + 1.0 - 1.0 / (1.0 - t * t * clamp(L, 0.0, 1.0) * poly);
    let circ = length(max(vec2f(0.0), v * K - vec2f(0.5286650061607361))) * 0.6541655659675598 + 0.3458344340324402;
    let s = select(-1.0, 1.0, v.y > v.x);
    let b = clamp(0.5 - s + s * t, 0.0, 1.0);
    var c = cont + (circ - cont) * wts.x;
    c = c + ((cont + (circ - cont) * wts.y) - c) * b;
    d = min(max(q.x, q.y), 0.0) + E * unpack2x16float(pack2x16float(vec2f(c - 1.0, 0.0))).x;
    let pos = max(q, vec2f(0.0));
    n = select(select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), q.x > q.y), normalize(pos), pos.x + pos.y > 0.0) * sg;
  } else {
    let q = ap - half;
    d = max(q.x, q.y);
    n = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), q.x > q.y) * sg;
  }
  let e = vec2f(p.x, half.x * p.y / half.y);
  if (length(e) > 0.0001) { n = normalize(n + (normalize(e) - n) * 0.5); }
  let h = -d;
  let aa = max(fwidthFine(h), 0.0001);
  let B = select(clamp(0.5 + h / aa, 0.0, 1.0), 0.0, h < -5.0 * u.innerExtent.z);
  let H = u.inner.y;
  let t = clamp(h / max(H, 0.00001), 0.0, 1.0);
  let w = (1.0 - sqrt(max(0.0, 1.0 - (1.0 - t) * (1.0 - t)))) * clamp(0.5 + (H - h) / aa, 0.0, 1.0);
  return Shape(h, w, B, n);
}
@fragment fn fsWarp(@builtin(position) at0: vec4f) -> @location(0) vec4f {
  let P = at0.xy + u.fgK.xy;
  let s = shapeAt(P);
  let at = clamp(P + s.n * s.w * u.inner.x, ceil(u.rect.xy) + vec2f(0.5), floor(u.rect.xy + u.rect.zw) - vec2f(0.5));
  return textureSampleLevel(image, smp, (at - u.fieldOrigin.zw) / u.fgK.zw, 0.0) * s.B;
}
@fragment fn fsWarpOver(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let s = shapeAt(pos.xy);
  return textureLoad(image, vec2i(floor(pos.xy - u.fieldOrigin.xy)), 0) * s.B;
}
@fragment fn fsCopy(@builtin(position) at0: vec4f) -> @location(0) vec4f {
  return textureLoad(image, vec2i(floor(at0.xy + u.fgK.xy - u.fieldOrigin.zw)), 0);
}
@fragment fn fsBackdropOver(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let s = supercircle(pos.xy - u.rect.xy, u.rect.zw, 0.5 * min(u.rect.z, u.rect.w));
  let c = textureLoad(image, vec2i(floor(pos.xy - u.fieldOrigin.xy)), 0);
  let k = c.rgb / max(c.a, 0.000001);
  let o = clamp(k.r * u.key[0] + k.g * u.key[1] + k.b * u.key[2] + c.a * u.key[3] + u.key[4], vec4f(0.0), vec4f(1.0));
  return vec4f(o.rgb * o.a, o.a) * s * u.innerExtent.w;
}
@fragment fn fsUnder(@builtin(position) pos: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(floor(pos.xy)), 0); }
@fragment fn fsImage(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = vec2i(floor(pos.xy - u.rect.xy));
  return textureLoad(image, p, 0) * u.innerExtent.w;
}
`;

const columns = (m: number[]) => Array.from({length: 20}, (_, i) => m[(i % 4) * 5 + Math.floor(i / 4)]);

export function createLensPasses(device: GPUDevice) {
  const module = device.createShaderModule({code: WGSL});
  const premul: GPUBlendState = {color: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}};
  const pipe = (entryPoint: string, blend?: GPUBlendState) => device.createRenderPipeline({layout: 'auto', vertex: {module, entryPoint: 'vs'}, fragment: {module, entryPoint, targets: [{format: 'rgba8unorm', blend}]}});
  const inner = pipe('fsInner', premul), innerLensed = pipe('fsInnerLensed', premul), provider = pipe('fsProvider'), rest = pipe('fsImage', premul);
  const warpLayer = pipe('fsWarp'), warpOver = pipe('fsWarpOver', premul), copyLayer = pipe('fsCopy'), backdropOver = pipe('fsBackdropOver', premul);
  let layer: GPUTexture | null = null;
  const pair = pipe('fsPair', premul), portal = pipe('fsPortal', premul), over = pipe('fsOver', premul);
  const under = pipe('fsUnder', {color: {srcFactor: 'constant', dstFactor: 'one-minus-constant'}, alpha: {srcFactor: 'constant', dstFactor: 'one-minus-constant'}});
  const linear = device.createSampler({magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge'});
  const blankField = device.createTexture({size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING});
  let copy: GPUTexture | null = null, tapCopy: GPUTexture | null = null;
  const masks = new Map<string, {tex: GPUTexture; origin: number[]; extent: number[]}>();
  const images = new Map<string, GPUTexture>();
  const retired: GPUTexture[] = [];
  const buffers: GPUBuffer[] = [];
  const uniform = (data: Float32Array) => {
    const b = device.createBuffer({size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(b, 0, data); buffers.push(b); return b;
  };
  const U = () => new Float32Array(4 * 6 + 40 + 8);
  const draw = (encoder: GPUCommandEncoder, target: GPUTexture, p: GPURenderPipeline, u: Float32Array, field: GPUTexture, image: GPUTexture, scissor: number[], constant = 0, taps?: GPUTexture) => {
    const [x0, y0] = [Math.max(0, Math.floor(scissor[0])), Math.max(0, Math.floor(scissor[1]))];
    const [x1, y1] = [Math.min(target.width, Math.ceil(scissor[0] + scissor[2])), Math.min(target.height, Math.ceil(scissor[1] + scissor[3]))];
    if (x1 <= x0 || y1 <= y0) return;
    const pass = encoder.beginRenderPass({colorAttachments: [{view: target.createView(), loadOp: 'load', storeOp: 'store'}]});
    pass.setScissorRect(x0, y0, x1 - x0, y1 - y0);
    pass.setPipeline(p);
    if (p === under) pass.setBlendConstant([constant, constant, constant, constant]);
    const used = p === under ? [2] : p === rest || p === warpOver || p === backdropOver || p === pair || p === portal || p === over ? [0, 2] : p === provider ? [0, 1, 2, 3, 4] : [0, 1, 2, 3];
    pass.setBindGroup(0, device.createBindGroup({layout: p.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: uniform(u)}}, {binding: 1, resource: field.createView()},
      {binding: 2, resource: image.createView()}, {binding: 3, resource: linear}, {binding: 4, resource: (taps ?? image).createView()}].filter((e) => used.includes(e.binding))}));
    pass.draw(3);
    pass.end();
  };
  const maskFor = (w0: number, h0: number, radius0: number, dpr: number) => {
    const r4 = (v: number) => Math.round(v * 1e4) / 1e4, w = r4(w0), h = r4(h0), radius = r4(radius0), key = `${w} ${h} ${radius} ${dpr}`;
    let m = masks.get(key);
    if (!m) {
      const A = caShadowA8({width: w, height: h, radius, cornerRadius: h / 2, inputScale: dpr, flag5: false, curve: 'continuous'});
      const [tw, th] = A.size, row = Math.ceil(tw / 256) * 256, bytes = new Uint8Array(row * th);
      for (let y = 0; y < th; y++) bytes.set(A.bytes.subarray(y * tw, (y + 1) * tw), y * row);
      const tex = device.createTexture({size: [tw, th], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
      device.queue.writeTexture({texture: tex}, bytes, {bytesPerRow: row}, [tw, th]);
      m = {tex, origin: A.origin, extent: A.extent};
      masks.set(key, m);
      if (masks.size > 48) { const [k, v] = masks.entries().next().value!; retired.push(v.tex); masks.delete(k); }
    }
    return m;
  };

  const copyOf = (encoder: GPUCommandEncoder, target: GPUTexture, x: number, y: number, w: number, h: number) => {
    const cx = Math.max(0, Math.floor(x)), cy = Math.max(0, Math.floor(y)), cw = Math.min(target.width, Math.ceil(x + w)) - cx, ch = Math.min(target.height, Math.ceil(y + h)) - cy;
    if (cw <= 0 || ch <= 0) return null;
    if (!copy || copy.width < cw || copy.height < ch) {
      if (copy) retired.push(copy);
      copy = device.createTexture({size: [Math.max(cw, copy?.width ?? 0), Math.max(ch, copy?.height ?? 0)], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
    }
    encoder.copyTextureToTexture({texture: target, origin: [cx, cy]}, {texture: copy}, [cw, ch]);
    return {cx, cy, tex: copy};
  };

  return {
    group(encoder: GPUCommandEncoder, target: GPUTexture, image: GPUTexture, m: number, first: boolean) {
      const u = U(); u[8] = first ? m : caShadowOpacity(m);
      draw(encoder, target, first ? pair : portal, u, blankField, image, [0, 0, target.width, target.height]);
    },
    warp(encoder: GPUCommandEncoder, {target, source, rect, dpr, frame, blur}: {target: GPUTexture; source?: GPUTexture; rect: {x: number; y: number; w: number; h: number}; dpr: number; frame: LensFrame;
      blur: (source: GPUTexture, radius: number) => GPUTexture}) {
      if (!(Math.abs(frame.warp) > 1e-3) && !(frame.blur > 0.01)) return false;
      const spread = frame.blur > 0.01 ? Math.ceil(3 * frame.blur * dpr) + 2 : 1;
      const m = Math.ceil(Math.abs(frame.warp) * dpr) + 2 + spread, c = copyOf(encoder, source ?? target, rect.x - m, rect.y - m, rect.w + 2 * m, rect.h + 2 * m);
      if (!c) return false;
      const rx = Math.max(0, Math.floor(rect.x) - spread), ry = Math.max(0, Math.floor(rect.y) - spread);
      const rw = Math.min(target.width, Math.ceil(rect.x + rect.w) + spread) - rx, rh = Math.min(target.height, Math.ceil(rect.y + rect.h) + spread) - ry;
      if (rw <= 0 || rh <= 0) return false;
      if (!layer || layer.width !== rw || layer.height !== rh) {
        if (layer) retired.push(layer);
        layer = device.createTexture({size: [rw, rh], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT});
      }
      const u = U();
      u.set([rect.x, rect.y, rect.w, rect.h], 0); u.set([0, 0, c.cx, c.cy], 4);
      u.set([frame.warp * dpr, 36 * dpr, 0, 0], 8); u.set([0, 0, dpr, 0], 12); u.set([rx, ry, c.tex.width, c.tex.height], 20);
      const pass = encoder.beginRenderPass({colorAttachments: [{view: layer.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
      pass.setPipeline(warpLayer);
      pass.setBindGroup(0, device.createBindGroup({layout: warpLayer.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: uniform(u)}}, {binding: 2, resource: c.tex.createView()}, {binding: 3, resource: linear}]}));
      pass.draw(3); pass.end();
      const out = frame.blur > 0.01 ? blur(layer, frame.blur) : layer;
      u.set([rx, ry, 0, 0], 4);
      draw(encoder, target, warpOver, u, blankField, out, [rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2]);
      return true;
    },
    backdrop(encoder: GPUCommandEncoder, {target, source, rect, dpr, frame, blur}: {target: GPUTexture; source?: GPUTexture; rect: {x: number; y: number; w: number; h: number}; dpr: number; frame: LensFrame;
      blur: (source: GPUTexture, radius: number) => GPUTexture}) {
      const b0 = frame.rest.backdrop;
      if (!b0 || !(frame.rest.opacity > 0)) return false;
      const b = b0;
      if (b.size) { const w = b.size[0] * dpr, h = b.size[1] * dpr; rect = {x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h}; }
      const spread = b.blur > 0.01 ? Math.ceil(3 * b.blur * dpr) + 2 : 1;
      const c = copyOf(encoder, source ?? target, rect.x - spread, rect.y - spread, rect.w + 2 * spread, rect.h + 2 * spread);
      if (!c) return false;
      const rx = Math.max(0, Math.floor(rect.x) - spread), ry = Math.max(0, Math.floor(rect.y) - spread);
      const rw = Math.min(target.width, Math.ceil(rect.x + rect.w) + spread) - rx, rh = Math.min(target.height, Math.ceil(rect.y + rect.h) + spread) - ry;
      if (rw <= 0 || rh <= 0) return false;
      if (!layer || layer.width !== rw || layer.height !== rh) {
        if (layer) retired.push(layer);
        layer = device.createTexture({size: [rw, rh], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT});
      }
      const u = U();
      u.set([rect.x, rect.y, rect.w, rect.h], 0); u.set([0, 0, c.cx, c.cy], 4); u.set([rx, ry, c.tex.width, c.tex.height], 20);
      const pass = encoder.beginRenderPass({colorAttachments: [{view: layer.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
      pass.setPipeline(copyLayer);
      pass.setBindGroup(0, device.createBindGroup({layout: copyLayer.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: uniform(u)}}, {binding: 2, resource: c.tex.createView()}]}));
      pass.draw(3); pass.end();
      const out = b.blur > 0.01 ? blur(layer, b.blur) : layer;
      u.set([rx, ry, 0, 0], 4); u.set(columns(b.matrix), 24); u[15] = Math.min(1, frame.rest.opacity);
      draw(encoder, target, backdropOver, u, blankField, out, [rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2]);
      return true;
    },
    fade(encoder: GPUCommandEncoder, {target, sample, rect, dpr, frame}: {target: GPUTexture; sample: GPUTexture; rect: {x: number; y: number; w: number; h: number}; dpr: number; frame: LensFrame}) {
      if (frame.large) return;
      const a = 1 - Math.max(0, Math.min(1, frame.provider));
      if (!(a > 0)) return;
      const m = 40 * dpr;
      draw(encoder, target, under, U(), blankField, sample, [rect.x - m, rect.y - m, rect.w + 2 * m, rect.h + 2 * m], a);
    },
    rest(encoder: GPUCommandEncoder, {target, rect, frame}: {target: GPUTexture; rect: {x: number; y: number}; frame: LensFrame}) {
      const im = frame.rest.image;
      if (!im || !(frame.rest.opacity > 0)) return;
      let tex = images.get(im.key);
      if (!tex) {
        tex = device.createTexture({size: [im.w, im.h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
        device.queue.writeTexture({texture: tex}, im.data, {bytesPerRow: im.w * 4}, [im.w, im.h]);
        images.set(im.key, tex);
        if (images.size > 48) { const [k, v] = images.entries().next().value!; retired.push(v); images.delete(k); }
      }
      const x = Math.round(rect.x + im.x), y = Math.round(rect.y + im.y), u = U();
      u.set([x, y, im.w, im.h], 0); u[15] = Math.min(1, frame.rest.opacity);
      draw(encoder, target, rest, u, blankField, tex, [x, y, im.w, im.h]);
    },
    encode(encoder: GPUCommandEncoder, {target, rect, field, dpr, frame, scale = [1, 1], source}: {target: GPUTexture; rect: {x: number; y: number; w: number; h: number}; field: {texture: GPUTexture; origin: number[]}; dpr: number; frame: LensFrame; scale?: [number, number]; source?: GPUTexture}) {
      const u = U(), w = rect.w / dpr, h = rect.h / dpr;
      u.set([rect.x, rect.y, rect.w, rect.h], 0);
      u.set([field.origin[0], field.origin[1], 0, 0], 4);
      const box = [rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4];
      const [io, ir, iy] = frame.inner;
      if (io > 0) {
        const [kx, ky] = scale, m = maskFor(w / kx, h / ky, Math.max(0, ir), dpr), L = frame.large;
        u.set([caShadowOpacity(io), iy * dpr * ky, m.origin[0] * dpr * kx, m.origin[1] * dpr * ky], 8);
        u.set([m.extent[0] * dpr * kx, m.extent[1] * dpr * ky, dpr, 1], 12);
        if (L) u.set([L.curvature, 0.2 * L.H, (-L.H / 4) * L.q * dpr, 0], 68);
        draw(encoder, target, L ? innerLensed : inner, u, field.texture, m.tex, box);
      }
      if (!(frame.provider > 0)) return;
      const pad = Math.ceil(Math.max(5, frame.recipe / 19) * dpr * 2) + 4;
      const cx = Math.max(0, Math.floor(rect.x) - pad), cy = Math.max(0, Math.floor(rect.y) - pad);
      const cw = Math.min(target.width, Math.ceil(rect.x + rect.w) + pad) - cx, ch = Math.min(target.height, Math.ceil(rect.y + rect.h) + pad) - cy;
      if (cw <= 0 || ch <= 0) return;
      if (!copy || copy.width < cw || copy.height < ch) {
        if (copy) retired.push(copy);
        copy = device.createTexture({size: [Math.max(cw, copy?.width ?? 0), Math.max(ch, copy?.height ?? 0)], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
      }
      encoder.copyTextureToTexture({texture: target, origin: [cx, cy]}, {texture: copy}, [cw, ch]);
      const [kx, ky] = scale, ex = (w / kx / 2 + 100) * kx * dpr, ey = (h / ky / 2 + 100) * ky * dpr, mx = rect.x + rect.w / 2, my = rect.y + rect.h / 2;
      const end = (v: number) => Math.floor(Math.fround(v) + 0.5);
      const Wn = Math.ceil((end(Math.min(target.width, mx + ex)) - end(Math.max(0, mx - ex))) / 64) * 64, Hn = Math.ceil((end(Math.min(target.height, my + ey)) - end(Math.max(0, my - ey))) / 64) * 64;
      const H = frame.recipe;
      u.set([field.origin[0], field.origin[1], cx, cy], 4);
      u.set([0, 0, dpr, Math.max(0, Math.min(1, frame.provider))], 12);
      const L = frame.large;
      if (L) {
        const q = L.q;
        u.set([Math.fround(-5 + (L.H / 19 + 5) * q), Math.fround((L.H / 1.8) * q), Math.fround(-0.2 * L.H * q), Math.PI / 2 + (-Math.PI / 12 - Math.PI / 2) * q], 16);
        u.set([1, q, 1 - q, Math.max(0, q)], 64); u.set([L.curvature, 0, 0, 0], 68);
      } else u.set([Math.fround(H / 19), Math.fround(H / 1.8), Math.fround(-0.2 * H), -Math.PI / 12], 16);
      u.set([(dpr * ky * Wn) / Hn, (dpr * kx * Hn) / Wn, copy.width, copy.height], 20);
      u.set(columns(frame.key), 24); u.set(columns(frame.fill), 44);
      let taps: GPUTexture | undefined;
      if (source) {
        if (!tapCopy || tapCopy.width < copy.width || tapCopy.height < copy.height) {
          if (tapCopy) retired.push(tapCopy);
          tapCopy = device.createTexture({size: [copy.width, copy.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT});
        }
        encoder.copyTextureToTexture({texture: source, origin: [cx, cy]}, {texture: tapCopy}, [cw, ch]);
        const uo = U(); uo.set([cx, cy, 0, 0], 0);
        draw(encoder, tapCopy, over, uo, blankField, target, [0, 0, cw, ch]);
        taps = tapCopy;
      }
      draw(encoder, target, provider, u, field.texture, copy, box, 0, taps);
    },
    endFrame() {
      for (const t of retired.splice(0)) t.destroy();
      for (const b of buffers.splice(0)) b.destroy();
    },
  };
}
