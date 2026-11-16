import {supercircleWGSL} from './shaders';

export interface BackdropSpec { blur: number; matrix: number[]; capture?: [number, number, number, number]; radius?: number }

const WGSL = `
struct U { rect: vec4f, capture: vec4f, k: vec4f, m0: vec4f, m1: vec4f, m2: vec4f, m3: vec4f, off: vec4f, snap: vec4f, cells: vec4f, grid: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(2) var lin: sampler;
${supercircleWGSL}
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * vec2f(2, -2) + vec2f(-1, 1), 0, 1);
}
fn cell(c: vec2f) -> vec4f {
  var s = vec4f(0);
  for (var k = 0; k < 4; k++) {
    let t = c + vec2f(select(-1.0, 1.0, (k & 1) == 1), select(-1.0, 1.0, k >= 2));
    s += textureSampleLevel(image, lin, (t - u.capture.xy) / u.capture.zw, 0.0);
  }
  return s * .25;
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let r = min(u.k.x, 0.5 * min(u.rect.z, u.rect.w));
  let p = pos.xy - u.rect.xy;
  let reach = 1.5286649465560913 * r;
  let corner = (p.x < reach || p.x > u.rect.z - reach) && (p.y < reach || p.y > u.rect.w - reach);
  let inside = all(pos.xy >= u.snap.xy) && all(pos.xy < u.snap.zw);
  let cov = select(select(0.0, 1.0, inside), supercircle(p, u.rect.zw, r), corner);
  var acc = vec4f(0); var wsum = 0.0;
  let nx = i32(u.cells.z); let ny = i32(u.cells.w); let k2 = 1.0 / (2.0 * u.grid.x * u.grid.x);
  for (var j = 0; j < ny; j++) { for (var i = 0; i < nx; i++) {
    let c = u.cells.xy + vec2f(f32(i) * 4.0 + 2.0, f32(j) * 4.0 + 2.0);
    let d = c - pos.xy;
    let w = exp(-dot(d, d) * k2);
    acc += cell(c) * w; wsum += w;
  } }
  if (wsum <= 0.0) { return vec4f(0); }
  let a = acc / wsum;
  let s = vec4f(a.rgb / max(a.a, 0.001), 1.0);
  let o = clamp(vec4f(dot(u.m0, s), dot(u.m1, s), dot(u.m2, s), dot(u.m3, s)) + u.off, vec4f(0), vec4f(1));
  return vec4f(o.rgb * o.a, o.a) * cov;
}`;

export function createBackdropGPU(device: GPUDevice) {
  const module = device.createShaderModule({label: 'backdrop view', code: WGSL});
  const premul: GPUBlendState = {color: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}};
  const pipeline = device.createRenderPipeline({label: 'backdrop view', layout: 'auto', vertex: {module, entryPoint: 'vs'},
    fragment: {module, entryPoint: 'fs', targets: [{format: 'rgba8unorm', blend: premul}]}});
  const sampler = device.createSampler({magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge'});
  const captures = new Map<unknown, GPUTexture>(), trash: GPUBuffer[] = [];
  return {
    encode(encoder: GPUCommandEncoder, {target, id, shape, capture, radius, spec, dpr, scale}: {target: GPUTexture; id: unknown; shape: {x: number; y: number; w: number; h: number};
      capture: {x: number; y: number; w: number; h: number}; radius: number; spec: BackdropSpec; dpr: number; scale: number}) {
      const gx0 = Math.ceil(capture.x / 4) * 4, gy0 = Math.ceil(capture.y / 4) * 4;
      const nx = Math.floor((capture.x + capture.w - gx0) / 4), ny = Math.floor((capture.y + capture.h - gy0) / 4);
      const x0 = Math.max(0, gx0 - 1), y0 = Math.max(0, gy0 - 1), x1 = Math.min(target.width, gx0 + 4 * nx + 1), y1 = Math.min(target.height, gy0 + 4 * ny + 1);
      if (nx < 1 || ny < 1 || x1 <= x0 || y1 <= y0) return;
      const W = x1 - x0, H = y1 - y0;
      let c = captures.get(id);
      if (!c || c.width !== W || c.height !== H) {
        c?.destroy();
        c = device.createTexture({size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
        captures.set(id, c);
      }
      encoder.copyTextureToTexture({texture: target, origin: [x0, y0]}, {texture: c}, [W, H]);
      const m = spec.matrix, u = new Float32Array(44);
      u.set([shape.x, shape.y, shape.w, shape.h, x0, y0, W, H, radius, 0, 0, 0]);
      for (let r = 0; r < 4; r++) { u.set(m.slice(r * 5, r * 5 + 4), 12 + r * 4); u[28 + r] = m[r * 5 + 4]; }
      u.set([Math.round(shape.x), Math.round(shape.y), Math.round(shape.x + shape.w), Math.round(shape.y + shape.h)], 32);
      u.set([gx0, gy0, nx, ny, spec.blur * dpr * scale, 0, 0, 0], 36);
      const b = device.createBuffer({size: u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
      device.queue.writeBuffer(b, 0, u); trash.push(b);
      const sx = Math.max(0, Math.floor(shape.x - 1)), sy = Math.max(0, Math.floor(shape.y - 1));
      const sw = Math.min(target.width, Math.ceil(shape.x + shape.w + 1)) - sx, sh = Math.min(target.height, Math.ceil(shape.y + shape.h + 1)) - sy;
      if (sw <= 0 || sh <= 0) return;
      const pass = encoder.beginRenderPass({colorAttachments: [{view: target.createView(), loadOp: 'load', storeOp: 'store'}]});
      pass.setScissorRect(sx, sy, sw, sh);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: b}}, {binding: 1, resource: c.createView()}, {binding: 2, resource: sampler}]}));
      pass.draw(3); pass.end();
    },
    flush() { for (const b of trash.splice(0)) b.destroy(); },
  };
}
