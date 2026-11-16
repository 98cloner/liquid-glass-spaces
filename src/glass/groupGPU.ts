import {GAUSSIAN} from './pocketGPU';
import {bbox, uncovered, type Rect, type SceneWrites} from './sceneWrites';
import {supercircleWGSL} from './shaders';

const WGSL = `
struct U { rect: vec4f, card: vec4f, shadow: vec4f, under: vec4f, underK: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var saved: texture_2d<f32>;
@group(0) @binding(2) var drawn: texture_2d<f32>;
const G = array<f32, 32>(${GAUSSIAN.map((v) => (v / 255).toFixed(8)).join(', ')});
${supercircleWGSL}
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * vec2f(2, -2) + vec2f(-1, 1), 0, 1);
}
fn gauss(inside: f32, R: f32) -> f32 {
  let t = clamp((2.8 - inside / R) / 5.6, 0.0, 1.0) * 32.0 - 0.5;
  let i = clamp(floor(t), 0.0, 31.0);
  let f = clamp(t - i, 0.0, 1.0);
  return mix(G[u32(i)], G[u32(min(i + 1.0, 31.0))], f);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = vec2i(pos.xy);
  let s = textureLoad(saved, p, 0);
  let d = textureLoad(drawn, p, 0);
  var cov = 1.0;
  var sh = 0.0;
  if (u.card.z > 0.5) {
    cov = supercircle(pos.xy - u.rect.xy, u.rect.zw, min(u.card.x, 0.5 * min(u.rect.z, u.rect.w)));
    let o = pos.xy - vec2f(0.0, u.shadow.z);
    sh = u.shadow.x * gauss(min(o.x - u.rect.x, u.rect.x + u.rect.z - o.x), u.shadow.y) * gauss(min(o.y - u.rect.y, u.rect.y + u.rect.w - o.y), u.shadow.y);
  }
  if (u.underK.y > 0.5) {
    cov *= 1.0 - supercircle(pos.xy - u.under.xy, u.under.zw, min(u.underK.x, 0.5 * min(u.under.z, u.under.w)));
  }
  return mix(s * (1.0 - sh), d, u.card.y * cov);
}
`;

export interface GroupFrame {
  opacity: number;
  card?: {rect: [number, number, number, number]; radius: number; shadow: [number, number, number]};
  under?: {rect: [number, number, number, number]; radius: number};
}

export type GroupSaved = {tex: GPUTexture; scene: GPUTexture; rects: Rect[]; stop: () => void};

export async function createGroupGPU(device: GPUDevice) {
  const module = device.createShaderModule({label: 'group', code: WGSL});
  const pipeline = await device.createRenderPipelineAsync({layout: 'auto', vertex: {module, entryPoint: 'vs'}, fragment: {module, entryPoint: 'fs', targets: [{format: 'rgba8unorm'}]}});
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
  let pool: GPUTexture[] = [], used = 0, size = [0, 0], writes: SceneWrites | null = null, uniform: ((size: number) => GPUBuffer) | null = null;
  const take = (w: number, h: number) => {
    if (size[0] !== w || size[1] !== h) { pool.forEach((t) => t.destroy()); pool = []; size = [w, h]; }
    if (used >= pool.length) pool.push(device.createTexture({size: [w, h], format: 'rgba8unorm', usage}));
    return pool[used++];
  };
  return {
    begin(w: SceneWrites, u: (size: number) => GPUBuffer) { used = 0; writes = w; uniform = u; },
    save(enc: GPUCommandEncoder, scene: GPUTexture): GroupSaved {
      const tex = take(scene.width, scene.height), rects: Rect[] = [];
      writes!.track(scene);
      const stop = writes!.watch(scene, (r) => {
        for (const p of uncovered(r, rects)) { enc.copyTextureToTexture({texture: scene, origin: [p.x, p.y]}, {texture: tex, origin: [p.x, p.y]}, [p.w, p.h]); rects.push(p); }
      });
      return {tex, scene, rects, stop};
    },
    composite(enc: GPUCommandEncoder, scene: GPUTexture, g: GroupSaved, f: GroupFrame) {
      g.stop();
      const W = scene.width, H = scene.height, c0 = f.card;
      let region = bbox(g.rects);
      if (c0) {
        const m = Math.ceil(2.8 * Math.abs(c0.shadow[1])) + Math.ceil(Math.abs(c0.shadow[2])) + 2;
        const cr = {x: c0.rect[0] - m, y: c0.rect[1] - m, w: c0.rect[2] + 2 * m, h: c0.rect[3] + 2 * m};
        region = bbox(region ? [region, cr] : [cr]);
      }
      const u = uniform!(80);
      if (!region) return u;
      const x0 = Math.max(0, Math.floor(region.x)), y0 = Math.max(0, Math.floor(region.y)), x1 = Math.min(W, Math.ceil(region.x + region.w)), y1 = Math.min(H, Math.ceil(region.y + region.h));
      if (x1 <= x0 || y1 <= y0) return u;
      const R = {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
      for (const p of uncovered(R, g.rects)) { enc.copyTextureToTexture({texture: scene, origin: [p.x, p.y]}, {texture: g.tex, origin: [p.x, p.y]}, [p.w, p.h]); g.rects.push(p); }
      const saved = g.tex, d = take(W, H);
      enc.copyTextureToTexture({texture: scene, origin: [R.x, R.y]}, {texture: d, origin: [R.x, R.y]}, [R.w, R.h]);
      const c = f.card, o = f.under;
      device.queue.writeBuffer(u, 0, new Float32Array([...(c?.rect ?? [0, 0, 0, 0]), c?.radius ?? 0, Math.max(0, Math.min(1, f.opacity)), c ? 1 : 0, 0, ...(c?.shadow ?? [0, 1, 0]), 0,
        ...(o?.rect ?? [0, 0, 0, 0]), o?.radius ?? 0, o ? 1 : 0, 0, 0]));
      const r = enc.beginRenderPass({colorAttachments: [{view: scene.createView(), loadOp: 'load', storeOp: 'store'}]});
      r.setScissorRect(R.x, R.y, R.w, R.h);
      r.setPipeline(pipeline);
      r.setBindGroup(0, device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: u}}, {binding: 1, resource: saved.createView()}, {binding: 2, resource: d.createView()}]}));
      r.draw(3); r.end();
      return u;
    },
  };
}
export type GroupGPU = Awaited<ReturnType<typeof createGroupGPU>>;
