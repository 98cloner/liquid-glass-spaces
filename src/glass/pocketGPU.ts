import {DOWNSAMPLE_WGSL} from './material/downsample.ts';
import {createLumaPipelines, lumaUniform, lumaDispatch, lumaRegion} from './material/luma.ts';

export const GAUSSIAN = [255, 253, 252, 251, 249, 246, 242, 237, 230, 222, 212, 200, 186, 170, 153, 136, 118, 101, 84, 68, 54, 42, 32, 24, 17, 12, 8, 5, 3, 2, 1, 0];

const WGSL = `
struct U { rect: vec4f, size: vec4f, contour: vec4f, alpha: vec4f, misc: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var aux: texture_2d<f32>;
@group(0) @binding(4) var aux2: texture_2d<f32>;
const G = array<f32, 32>(${GAUSSIAN.map((v) => (v / 255).toFixed(8)).join(', ')});
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * vec2f(2, -2) + vec2f(-1, 1), 0, 1);
}
fn gauss(inside: f32) -> f32 {
  let t = clamp((2.8 - inside / u.contour.z) / 5.6, 0.0, 1.0) * 32.0 - 0.5;
  let i = clamp(floor(t), 0.0, 31.0);
  let f = clamp(t - i, 0.0, 1.0);
  return mix(G[u32(i)], G[u32(min(i + 1.0, 31.0))], f);
}
fn shadow(p: vec2f) -> f32 {
  return gauss(min(p.x - u.contour.x, u.misc.x - p.x)) * gauss(select(p.y - u.contour.y, u.contour.y - p.y, u.misc.z > 0.5));
}
fn origin() -> vec2f { return vec2f(u.contour.w, u.misc.w); }
fn cached(k: vec2f) -> f32 {
  return round(shadow(origin() + (k + 0.5) * 4.0 * u.misc.y) * 255.0) / 255.0;
}
fn portal(k: vec2f) -> f32 { return round(clamp(1.25 * cached(k) - 0.25, 0.0, 1.0) * 255.0) / 255.0; }
fn bilinear(p: vec2f, portalled: bool) -> f32 {
  let f = (p - origin()) / (4.0 * u.misc.y) - 0.5;
  let k = floor(f);
  let t = f - k;
  if (portalled) { return mix(mix(portal(k), portal(k + vec2f(1, 0)), t.x), mix(portal(k + vec2f(0, 1)), portal(k + vec2f(1, 1)), t.x), t.y); }
  return mix(mix(cached(k), cached(k + vec2f(1, 0)), t.x), mix(cached(k + vec2f(0, 1)), cached(k + vec2f(1, 1)), t.x), t.y);
}
fn mask(p: vec2f) -> f32 {
  if (u.alpha.w > 0.5) { return 1.0; }
  return bilinear(p, false);
}
@fragment fn capture(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return textureSampleLevel(src, smp, (u.rect.xy + 2.0 * pos.xy) / u.size.zw, 0.0);
}
@fragment fn blur(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let a = bilinear(u.rect.xy + 2.0 * pos.xy, true);
  let b = 2.4 * a;
  let lod = max(0.0, log2(select(b, 1.0 + 0.5 * b, b < 2.0)));
  let uv = pos.xy / u.size.xy;
  let d = lod * 0.25 / u.size.xy;
  var c = textureSampleLevel(src, smp, uv + d, lod) + textureSampleLevel(src, smp, uv + vec2f(d.x, -d.y), lod);
  c = c + textureSampleLevel(src, smp, uv + vec2f(-d.x, d.y), lod) + textureSampleLevel(src, smp, uv - d, lod);
  c = c * 0.25;
  return vec4f(c.rgb / max(c.a, 0.001), 1.0) * clamp(12.5 * b - 0.25, 0.0, 1.0);
}
@fragment fn box4(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let q = pos.xy * 4.0;
  let d = vec2f(textureDimensions(src));
  return (textureSampleLevel(src, smp, (q + vec2f(-1, 1)) / d, 0.0) + textureSampleLevel(src, smp, (q + vec2f(1, 1)) / d, 0.0)
    + textureSampleLevel(src, smp, (q + vec2f(-1, -1)) / d, 0.0) + textureSampleLevel(src, smp, (q + vec2f(1, -1)) / d, 0.0)) * 0.25;
}
fn narrow(uv: vec2f, axis: vec2f) -> vec4f {
  let o = array<f32, 3>(0.6168994903564453, 2.252807855606079, 4.124483108520508);
  let w = array<f32, 3>(0.34292152523994446, 0.14772279560565948, 0.009355677291750908);
  var c = vec4f(0);
  for (var i = 0; i < 3; i++) { let d = axis * o[i] / vec2f(textureDimensions(src)); c += (textureSampleLevel(src, smp, uv + d, 0.0) + textureSampleLevel(src, smp, uv - d, 0.0)) * w[i]; }
  return c;
}
@fragment fn narrowX(@builtin(position) pos: vec4f) -> @location(0) vec4f { return narrow(pos.xy / vec2f(textureDimensions(src)), vec2f(1, 0)); }
@fragment fn narrowY(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = narrow(pos.xy / vec2f(textureDimensions(src)), vec2f(0, 1));
  return vec4f(c.rgb / max(c.a, 0.001), 1.0);
}
@fragment fn composite(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = (pos.xy - u.rect.xy) / (2.0 * u.size.xy);
  let m = mask(pos.xy);
  let op = u.alpha.x;
  let r = u.alpha.y;
  let k = u.alpha.z;
  let uvE = select(uv, (pos.xy - u.rect.xy) / (8.0 * vec2f(textureDimensions(src))), u.alpha.w > 0.5);
  let e = textureSampleLevel(src, smp, uvE, 0.0) * op;
  let b = textureSampleLevel(aux, smp, uv, 0.0);
  let l = vec4f(b.rgb * r * (1.0 - k), k + r * (1.0 - k)) * m * op;
  let d = vec4f(0, 0, 0, select(quantizeToF16(3.0 / 255.0), 0.0, u.alpha.w > 0.5) * m * op);
  let le = l + e * (1.0 - l.a);
  return d + le * (1.0 - d.a);
}
`;

export interface PocketFrame {
  rect: [number, number, number, number];
  style: 'soft' | 'hard' | 'hidden';
  top: boolean;
  grid: [number, number];
  contour: [number, number, number];
  radius: number;
  dpr: number;
  blur: boolean;
  opacity: number;
  replay: number;
  black: number;
  luma: [number, number, number, number];
}

type Slot = {w: number; h: number; c: GPUTexture; b: GPUTexture; blur: GPUTexture; hard: GPUTexture[]; u: GPUBuffer; mipU: GPUBuffer[];
  luma: {u: GPUBuffer; partial: GPUBuffer | null; out: GPUBuffer; read: GPUBuffer}[]; copied: boolean; mapping: boolean; hasB: boolean};

export async function createPocketGPU(device: GPUDevice) {
  const module = device.createShaderModule({label: 'scroll pocket', code: WGSL}), mipModule = device.createShaderModule({code: DOWNSAMPLE_WGSL});
  const tex = {sampleType: 'float' as const};
  const layout = device.createBindGroupLayout({entries: [
    {binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {}}, {binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: tex},
    {binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {}}, {binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: tex},
    {binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: tex}]});
  const over = {color: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}} as const;
  const pipe = (entry: string, blend = false) => device.createRenderPipelineAsync({layout: device.createPipelineLayout({bindGroupLayouts: [layout]}),
    vertex: {module, entryPoint: 'vs'}, fragment: {module, entryPoint: entry, targets: [{format: 'rgba8unorm', ...(blend ? {blend: over} : {})}]}});
  const [capture, blur, box4, narrowX, narrowY, composite, mip, lumaPipes] = await Promise.all([pipe('capture'), pipe('blur'), pipe('box4'), pipe('narrowX'), pipe('narrowY'),
    pipe('composite', true), device.createRenderPipelineAsync({layout: 'auto', vertex: {module: mipModule, entryPoint: 'downsampleBlurVert'},
      fragment: {module: mipModule, entryPoint: 'variableBlurDownsampleFrag', targets: [{format: 'rgba8unorm'}]}}), createLumaPipelines(device)]);
  const linear = device.createSampler({minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear'});
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
  const dummy = device.createTexture({size: [1, 1], format: 'rgba8unorm', usage});
  const slots = new Map<string, Slot>();
  const slotFor = (id: string, w: number, h: number) => {
    let s = slots.get(id);
    if (s && s.w === w && s.h === h) return s;
    if (s) release(id);
    const t = (tw: number, th: number, mips = 1) => device.createTexture({size: [Math.max(1, tw), Math.max(1, th)], format: 'rgba8unorm', usage, mipLevelCount: mips});
    const hw = Math.ceil(w / 4), hh = Math.ceil(h / 4);
    const buf = (size: number, u: number) => device.createBuffer({size, usage: u});
    s = {w, h, c: t(w, h, 3), b: t(w, h), blur: t(w, h), hard: [t(hw, hh), t(hw, hh), t(hw, hh)], u: buf(80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      mipU: [0, 1].map(() => buf(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)),
      luma: [0, 1].map(() => ({u: buf(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST), partial: null, out: buf(16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC),
        read: buf(32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST)})).slice(0, 2), copied: false, mapping: false, hasB: false};
    s.luma[1].read.destroy();
    s.luma[1].read = s.luma[0].read;
    slots.set(id, s);
    return s;
  };
  function release(id: string) {
    const s = slots.get(id);
    if (!s) return;
    for (const t of [s.c, s.b, s.blur, ...s.hard]) t.destroy();
    for (const b of [s.u, ...s.mipU, s.luma[0].u, s.luma[0].partial, s.luma[0].out, s.luma[0].read, s.luma[1].u, s.luma[1].partial, s.luma[1].out]) b?.destroy();
    slots.delete(id);
  }
  const group = (t: GPUTexture, s: Slot, a: GPUTexture = dummy, a2: GPUTexture = dummy, mips?: number) => device.createBindGroup({layout, entries: [
    {binding: 0, resource: {buffer: s.u}}, {binding: 1, resource: t.createView(mips ? {baseMipLevel: 0, mipLevelCount: mips} : {baseMipLevel: 0, mipLevelCount: t.mipLevelCount})},
    {binding: 2, resource: linear}, {binding: 3, resource: a.createView({baseMipLevel: 0, mipLevelCount: 1})}, {binding: 4, resource: a2.createView({baseMipLevel: 0, mipLevelCount: 1})}]});
  const draw = (enc: GPUCommandEncoder, target: GPUTextureView, p: GPURenderPipeline, g: GPUBindGroup, load = false, scissor?: number[]) => {
    const r = enc.beginRenderPass({colorAttachments: [{view: target, loadOp: load ? 'load' : 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
    if (scissor) r.setScissorRect(scissor[0], scissor[1], scissor[2], scissor[3]);
    r.setPipeline(p); r.setBindGroup(0, g); r.draw(3); r.end();
  };
  const uniforms = (s: Slot, f: PocketFrame, scene: GPUTexture) => {
    const [x, y] = f.rect;
    device.queue.writeBuffer(s.u, 0, new Float32Array([x, y, f.rect[2], f.rect[3], s.w, s.h, scene.width, scene.height,
      f.contour[0], f.contour[1], f.radius, f.grid[0], f.opacity, f.replay, f.black, f.style === 'hard' ? 1 : 0, f.contour[2], f.dpr, f.top ? 1 : 0, f.grid[1]]));
  };
  const half = (f: PocketFrame) => [Math.ceil(f.rect[2] / 2), Math.ceil(f.rect[3] / 2)] as const;
  const luma = (enc: GPUCommandEncoder, t: GPUTexture, level: number, bounds: number[], l: Slot['luma'][number]) => {
    const region = lumaRegion(bounds, level);
    const dispatch = lumaDispatch(region.origin, region.bounds), bytes = Math.max(1, dispatch.threadGroupCount) * 16;
    if (!l.partial || l.partial.size < bytes) { l.partial?.destroy(); l.partial = device.createBuffer({size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC}); }
    device.queue.writeBuffer(l.u, 0, lumaUniform({origin: region.origin, bounds: region.bounds, level}));
    const c = enc.beginComputePass();
    c.setPipeline(lumaPipes.stage1);
    c.setBindGroup(0, device.createBindGroup({layout: lumaPipes.stage1.getBindGroupLayout(0), entries: [{binding: 0, resource: t.createView({baseMipLevel: level, mipLevelCount: 1})},
      {binding: 1, resource: {buffer: l.u}}, {binding: 2, resource: {buffer: l.partial}}]}));
    c.dispatchWorkgroups(dispatch.groupsX, dispatch.groupsY, 1);
    c.setPipeline(lumaPipes.stage2);
    c.setBindGroup(0, device.createBindGroup({layout: lumaPipes.stage2.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: l.u}},
      {binding: 1, resource: {buffer: l.partial}}, {binding: 2, resource: {buffer: l.out}}]}));
    c.dispatchWorkgroups(1, 1, 1);
    c.end();
  };
  const lumaBounds = (f: PocketFrame, s: Slot, level: number) => {
    const k = 2 ** level, x0 = Math.max(0, Math.floor((f.luma[0] - f.rect[0]) / 2)), y0 = Math.max(0, Math.floor((f.luma[1] - f.rect[1]) / 2));
    const x1 = Math.min(s.w, Math.ceil((f.luma[0] + f.luma[2] - f.rect[0]) / 2)), y1 = Math.min(s.h, Math.ceil((f.luma[1] + f.luma[3] - f.rect[1]) / 2));
    return [x0, y0, Math.max(k, x1 - x0), Math.max(k, y1 - y0)];
  };
  return {
    background(enc: GPUCommandEncoder, id: string, scene: GPUTexture, f: PocketFrame) {
      const [w, h] = half(f), s = slotFor(id, w, h);
      uniforms(s, f, scene);
      draw(enc, s.b.createView(), capture, group(scene, s));
      s.hasB = true;
    },
    edge(enc: GPUCommandEncoder, id: string, scene: GPUTexture, f: PocketFrame) {
      const [w, h] = half(f), s = slotFor(id, w, h);
      uniforms(s, f, scene);
      draw(enc, s.c.createView({baseMipLevel: 0, mipLevelCount: 1}), capture, group(scene, s));
      for (let l = 1; l < 3; l++) {
        device.queue.writeBuffer(s.mipU[l - 1], 0, new Float32Array([0, 2 ** (l - 1) / w, 2 ** (l - 1) / h, 0, 0, 0, 1, 1]));
        const r = enc.beginRenderPass({colorAttachments: [{view: s.c.createView({baseMipLevel: l, mipLevelCount: 1}), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
        r.setPipeline(mip);
        r.setBindGroup(0, device.createBindGroup({layout: mip.getBindGroupLayout(0), entries: [{binding: 0, resource: s.c.createView({baseMipLevel: l - 1, mipLevelCount: 1})},
          {binding: 1, resource: {buffer: s.mipU[l - 1]}}, {binding: 2, resource: linear}]}));
        r.draw(3); r.end();
      }
      if (!s.mapping) {
        luma(enc, s.c, 2, lumaBounds(f, s, 2), s.luma[0]);
        enc.copyBufferToBuffer(s.luma[0].out, 0, s.luma[0].read, 0, 16);
        if (s.hasB) { luma(enc, s.b, 0, lumaBounds(f, s, 0), s.luma[1]); enc.copyBufferToBuffer(s.luma[1].out, 0, s.luma[0].read, 16, 16); }
        s.copied = true;
      }
      if (f.style === 'hidden' || !(f.opacity > 0) || !s.hasB) return false;
      let blurred = s.blur;
      if (f.style === 'soft' && f.blur) draw(enc, s.blur.createView(), blur, group(s.c, s, dummy, dummy, 3));
      else if (f.style === 'soft') { enc.beginRenderPass({colorAttachments: [{view: s.blur.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]}).end(); }
      else {
        draw(enc, s.hard[0].createView(), box4, group(s.c, s, dummy, dummy, 1));
        draw(enc, s.hard[1].createView(), narrowX, group(s.hard[0], s));
        draw(enc, s.hard[2].createView(), narrowY, group(s.hard[1], s));
        blurred = s.hard[2];
      }
      const x0 = Math.max(0, f.rect[0]), y0 = Math.max(0, f.rect[1]), x1 = Math.min(scene.width, f.rect[0] + f.rect[2]), y1 = Math.min(scene.height, f.rect[1] + f.rect[3]);
      if (x1 <= x0 || y1 <= y0) return false;
      draw(enc, scene.createView(), composite, group(blurred, s, s.b), true, [x0, y0, x1 - x0, y1 - y0]);
      return true;
    },
    collect(onLuma: (id: string, c: Float32Array, b: Float32Array | null) => void) {
      for (const [id, s] of slots) {
        if (!s.copied || s.mapping) continue;
        s.copied = false; s.mapping = true;
        const read = s.luma[0].read, hasB = s.hasB;
        read.mapAsync(GPUMapMode.READ).then(() => {
          const all = new Float32Array(read.getMappedRange().slice(0));
          read.unmap(); s.mapping = false;
          if (slots.get(id) === s) onLuma(id, all.slice(0, 4), hasB ? all.slice(4, 8) : null);
        }, () => { s.mapping = false; });
      }
    },
    release,
    ids: () => [...slots.keys()],
  };
}
export type PocketGPU = Awaited<ReturnType<typeof createPocketGPU>>;
