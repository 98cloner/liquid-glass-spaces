const f32 = Math.fround;
const HQ_OFFSETS = [1.9716856479644775, 3.943552255630493, 5.915776252746582, 7.888525485992432, 9.861953735351562, 11.836200714111328];
const HQ_WEIGHTS = [.1889936923980713, .16900713741779327, .12085755169391632, .06910988688468933, .03159967064857483, .01155237015336752, .0033765200059860945];

export function gaussianPlan(radius, scale) {
  const r = f32(f32(radius) * f32(scale));
  let v = f32(r * r), reductions = 0;
  for (;;) {
    const next = v / 16 - 1.1025;
    if (!(next > 7.5)) break;
    v = next; reductions++;
  }
  const passes = Math.max(1, Math.ceil(v / (6.1 * 6.1)));
  return {reductions, passes, variance: f32(v / passes)};
}

export function narrowKernel(v) {
  const g = Array.from({length: 14}, (_, i) => Math.exp(-.5 * i * i / v));
  const z = 1 + 2 * g.slice(1).reverse().reduce((a, b) => a + b, 0);
  for (let i = 0; i < 14; i++) g[i] /= z;
  const weights = [g[0] / 2 + g[1]], offsets = [g[1] / weights[0]];
  for (let i = 2; i < 14; i += 2) { const w = g[i] + g[i + 1]; weights.push(w); offsets.push(i + g[i + 1] / w); }
  const dropped = weights.slice(1).filter((w) => w < .002).reduce((a, b) => a + b, 0);
  const kept = [weights[0] + dropped, ...weights.slice(1).map((w) => (w >= .002 ? w : 0))];
  return {weights: kept.map(f32), offsets: offsets.map((o, i) => (kept[i] ? f32(o) : 0))};
}

const WGSL = `
struct Pass { step: vec2f, factor: vec2f, source: vec2f, mode: vec2f, offsets: array<vec4f, 2>, weights: array<vec4f, 2> };
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Pass;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let c = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(c[i], 0.0, 1.0);
}
fn at(uv: vec2f) -> vec4f { return textureSampleLevel(tex, samp, uv, 0.0); }
fn off(k: u32) -> f32 { return u.offsets[k / 4u][k % 4u]; }
fn wt(k: u32) -> f32 { return u.weights[k / 4u][k % 4u]; }
@fragment fn blur(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let uv = p.xy * u.factor / u.source;
  var t: array<vec4f, 7>;
  if (u.mode.x > 0.5) {
    t[0] = at(uv) * wt(0u);
    for (var k = 0u; k < 6u; k++) { t[k + 1u] = (at(uv + u.step * off(k)) + at(uv - u.step * off(k))) * wt(k + 1u); }
  } else {
    for (var k = 0u; k < 7u; k++) { t[k] = (at(uv + u.step * off(k)) + at(uv - u.step * off(k))) * wt(k); }
  }
  return (((((t[3] + t[0]) + t[2]) + t[1]) + t[6]) + t[5]) + t[4];
}
@fragment fn resolve(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let s = at(p.xy / u.source);
  if (s.a < 0.5) { discard; }
  return vec4f(s.r / s.a, normalize(s.gb), 1.0);
}
`;

export function createSDFGaussian(device) {
  const module = device.createShaderModule({code: WGSL});
  const pipe = (entryPoint) => device.createRenderPipeline({layout: 'auto', vertex: {module, entryPoint: 'vs'}, fragment: {module, entryPoint, targets: [{format: 'rgba16float'}]}, primitive: {topology: 'triangle-list'}});
  const blurPipe = pipe('blur'), resolvePipe = pipe('resolve');
  const sampler = device.createSampler({addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear'});
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  return function slot() {
    const textures = new Map(), uniforms = [];
    const texture = (w, h, n) => {
      const key = `${w}x${h}/${n}`;
      let t = textures.get(key);
      if (!t) textures.set(key, (t = device.createTexture({size: [w, h], format: 'rgba16float', usage})));
      t.used = true;
      return t;
    };
    const run = (encoder, i, pipeline, source, target, data, clear) => {
      const b = (uniforms[i] ??= device.createBuffer({size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}));
      device.queue.writeBuffer(b, 0, data);
      const p = encoder.beginRenderPass({colorAttachments: [{view: target.createView(), loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
      p.setPipeline(pipeline);
      p.setBindGroup(0, device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: source.createView()}, {binding: 1, resource: sampler}, {binding: 2, resource: {buffer: b}}]}));
      p.draw(3);
      p.end();
    };
    return {
      encode(encoder, field, radius, scale) {
        for (const t of textures.values()) t.used = false;
        const plan = gaussianPlan(radius, scale), W = field.width, H = field.height;
        let src = field, w = W, h = H, f = 1, i = 0, n = 0;
        const pass = (horizontal, down, kernel) => {
          const ow = horizontal && down ? Math.ceil(w / 4) : w, oh = !horizontal && down ? Math.ceil(h / 4) : h;
          const out = texture(ow, oh, n++ % 2);
          const data = new Float32Array(24);
          data.set([horizontal ? 1 / w : 0, horizontal ? 0 : 1 / h, horizontal && down ? 4 : 1, !horizontal && down ? 4 : 1, w, h, down ? 1 : 0, 0]);
          if (down) { data.set(HQ_OFFSETS, 8); data.set(HQ_WEIGHTS, 16); } else { data.set(kernel.offsets, 8); data.set(kernel.weights, 16); }
          run(encoder, i++, blurPipe, src, out, data, true);
          src = out; w = ow; h = oh;
        };
        for (let r = 0; r < plan.reductions; r++) { pass(true, true); pass(false, true); f *= 4; }
        const kernel = narrowKernel(plan.variance);
        for (let k = 0; k < plan.passes; k++) { pass(true, false, kernel); pass(false, false, kernel); }
        run(encoder, i++, resolvePipe, src, field, new Float32Array([0, 0, 0, 0, w * f, h * f, 0, 0, ...new Array(16).fill(0)]), true);
        for (const [key, t] of textures) if (!t.used) { t.destroy(); textures.delete(key); }
      },
      destroy() {
        for (const t of textures.values()) t.destroy();
        for (const b of uniforms) b.destroy();
        textures.clear(); uniforms.length = 0;
      },
    };
  };
}
