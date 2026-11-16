const PATH_WGSL = `
struct Globals { origin: vec2f, twoOverSize: vec2f, range: f32, count: u32 };
@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var<storage, read> points: array<vec2f>;
fn h(x: f32) -> f32 { return quantizeToF16(x); }
fn clip(p: vec2f) -> vec4f { return vec4f(fma(p.x, g.twoOverSize.x, -1.0), fma(p.y, -g.twoOverSize.y, 1.0), 0, 1); }
struct Distance { @builtin(position) position: vec4f, @location(0) q: vec2f, @location(1) e: vec2f, @location(2) denom: f32 };
@vertex fn distanceVertex(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> Distance {
  var o: Distance;
  let k = iid * 13u + (vid >> 2u); let corner = vid & 3u;
  if (k >= g.count) { o.position = vec4f(-2, -2, 0, 1); return o; }
  let a = points[2u * k]; let b = points[2u * k + 1u]; let d = b - a;
  let rn = g.range * (d * inverseSqrt(dot(d, d)));
  let end = corner == 0u || corner == 3u;
  let side = vec2f(-rn.y, rn.x);
  let p = (select(b, a, end) + select(rn, -rn, end)) + select(-side, side, corner < 2u);
  let inv = 1.0 / g.range;
  o.q = inv * (p - a); o.e = inv * d; o.denom = 1.0 / dot(o.e, o.e);
  o.position = clip(p);
  return o;
}
@fragment fn distanceFragment(i: Distance) -> @location(0) vec4f {
  let t = saturate(dot(i.q, i.e) * i.denom);
  let r = fma(i.e, vec2f(-t), i.q);
  return vec4f(h(1.0 - max(h(saturate(sqrt(dot(r, r)))), 0.0015010833740234375)), 0, 0, 1);
}
struct Record { first: i32, recip: f32, p1: vec2f, p2: vec2f, p3: vec2f };
@group(0) @binding(1) var<storage, read> records: array<Record>;
fn infinite(x: f32) -> bool { return (bitcast<u32>(x) & 0x7f800000u) == 0x7f800000u; }
fn locate(k: i32) -> i32 {
  if (bitcast<i32>(records[0].recip) <= k) { return -1; }
  var base = 1; var n = records[0].first;
  while (n > 1) { let step = n >> 1u; let mid = base + step; if (records[mid].first > k) { n = step; } else { base = mid; n = n - step; } }
  return select(base, -1, infinite(records[base].p1.x));
}
@vertex fn curveVertex(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> Distance {
  var o: Distance;
  let k = i32(iid * 13u + (vid >> 2u)); let corner = vid & 3u; let r = locate(k);
  if (r < 0) { o.position = vec4f(-2, -2, 0, 1); return o; }
  let s = records[r]; let p0 = records[r - 1].p3;
  let t0 = s.recip * f32(k - s.first); let t1 = s.recip * f32(k - s.first + 1);
  let d1 = s.p1 - p0; let d2 = s.p2 - s.p1; let d3 = s.p3 - s.p2;
  let c1 = d1 * 3.0; let c2 = (d2 - d1) * 3.0; let c3 = d1 + fma(d2, vec2f(-2.0), d3);
  let a = fma(fma(fma(c3, vec2f(t0), c2), vec2f(t0), c1), vec2f(t0), p0);
  let b = fma(fma(fma(c3, vec2f(t1), c2), vec2f(t1), c1), vec2f(t1), p0);
  let start = corner == 0u || corner == 3u; let tangent = select((t1 < 1.0), (t0 > 0.0), start); let t = select(t1, t0, start);
  let dir = select(b - a, ((c3 * 3.0) * t + c2 * 2.0) * t + c1, tangent);
  let rn = g.range * (dir * inverseSqrt(dot(dir, dir)));
  let side = vec2f(-rn.y, rn.x);
  let p = (select(b, a, start) + select(select(rn, -rn, start), vec2f(-0.0), tangent)) + select(-side, side, corner < 2u);
  let inv = 1.0 / g.range;
  o.q = inv * (p - a); o.e = inv * (b - a); o.denom = 1.0 / dot(o.e, o.e);
  o.position = clip(p);
  return o;
}
@vertex fn curveInteriorVertex(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> @builtin(position) vec4f {
  let k = i32(iid * 21u + (vid >> 2u)); let corner = vid & 3u;
  if (corner == 0u) { return clip(g.origin); }
  let r = locate(k);
  if (r < 0) { return vec4f(-2, -2, 0, 1); }
  let s = records[r]; let p0 = records[r - 1].p3;
  let t = s.recip * f32(k - s.first + select(1, 0, corner == 1u)); let u = 1.0 - t;
  let b = fma(vec2f(u * (u * u)), p0, ((t * 3.0) * u) * fma(vec2f(u), s.p1, s.p2 * t));
  return clip(fma(vec2f(t * (t * t)), s.p3, b));
}
@vertex fn interiorVertex(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> @builtin(position) vec4f {
  let k = iid * 21u + (vid >> 2u); let corner = vid & 3u;
  if (corner == 0u) { return clip(g.origin); }
  if (k >= g.count) { return vec4f(-2, -2, 0, 1); }
  return clip(select(points[2u * k + 1u], points[2u * k], corner == 1u));
}
@fragment fn interiorFragment(@builtin(front_facing) front: bool) -> @location(0) vec4f { return vec4f(select(-1.0, 1.0, front), 0, 0, 1); }
struct Resolve { offset: vec2i, region: vec2i, innerAlpha: f32, outerAlpha: f32 };
@group(0) @binding(0) var<uniform> resolve: Resolve;
@group(0) @binding(1) var accumulator: texture_2d<f32>;
@group(0) @binding(2) var inner: texture_2d<f32>;
@vertex fn full(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i & 1u) * 2 - 1, f32(i >> 1u) * 2 - 1, 0, 1); }
@fragment fn resolveInner(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let a = textureLoad(accumulator, vec2i(position.xy), 0).r; let w = floor(a);
  return vec4f(h(select(0.0, h(h(1.0 - a) + w), w != 0.0) * resolve.innerAlpha), 0, 0, 1);
}
@fragment fn resolveOuter(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let at = vec2i(position.xy) + resolve.offset;
  if (any(at < vec2i(0)) || any(at >= resolve.region)) { return vec4f(0, 0, 0, 1); }
  let a = textureLoad(accumulator, at, 0).r; let w = floor(a);
  let c1 = select(h(a - w), 1.0, w != 0.0);
  return vec4f(saturate(h(textureLoad(inner, at, 0).r + h(c1 * resolve.outerAlpha))), 0, 0, 1);
}`;
const IMAGE_WGSL = `
struct Params { origin: vec2f, size: vec2f, zero: f32, one: f32, innerAlpha: f32, outerAlpha: f32, innerSlope: f32, outerSlope: f32, outerQuad: f32, squash: f32, scale: f32, smoothness: f32, outside: f32 };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var encoded: texture_2d<f32>;
@group(0) @binding(2) var previous: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i & 1u) * 2 - 1, f32(i >> 1u) * 2 - 1, 0, 1); }
fn half1(x: f32) -> f32 { return quantizeToF16(x); }
fn distance(p: vec2f, quad: f32) -> f32 {
  let a = p.x / quad * params.squash; let b = p.y / quad;
  return sqrt(a * a + b * b) - params.size.y * .5 / quad;
}
@fragment fn encode(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let p = params.origin + position.xy / params.scale;
  let inner = half1(half1(clamp(distance(p, params.size.y) * -params.innerSlope, 0, 1)) * params.innerAlpha);
  let outer = half1(half1(1 - half1(clamp(distance(p, params.outerQuad) * params.outerSlope, 0, 1))) * params.outerAlpha);
  return vec4f(half1(inner + outer), 0, 0, 1);
}
fn read(p: vec2i) -> f32 {
  let size = vec2i(textureDimensions(encoded));
  if (params.outside != 0 && (any(p < vec2i(0)) || any(p >= size))) { return 0.0; }
  return textureLoad(encoded, clamp(p, vec2i(0), size - 1), 0).r;
}
fn decoded(position: vec4f) -> vec4f {
  let at = vec2i(position.xy) - vec2i(params.origin);
  let v = read(at);
  let decoded = v * (params.one - params.zero) + params.zero;
  if (v == 0) { return vec4f(decoded, 0, 0, 1); }
  var g = vec2f(half1(read(at + vec2i(1, 0)) - read(at - vec2i(1, 0))), half1(read(at + vec2i(0, 1)) - read(at - vec2i(0, 1))));
  if (any(g != vec2f(0))) { g = g * inverseSqrt(dot(g, g)); }
  return vec4f(decoded, quantizeToF16(-g), 1);
}
@fragment fn decode(@builtin(position) position: vec4f) -> @location(0) vec4f { return decoded(position); }
@fragment fn decodeUnion(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let a = decoded(position);
  let stored = textureLoad(previous, vec2i(position.xy), 0);
  let b = select(stored, vec4f(10000, 0, 0, 0), stored.w == 0);
  let w = max(params.smoothness, .0001) * clamp(.5 - .5 * dot(a.yz, b.yz), 0, 1);
  let h = clamp(.5 + .5 * (b.x - a.x) / w, 0, 1);
  return vec4f(mix(b.x, a.x, h) - (w * h) * (1 - h), mix(b.yz, a.yz, h), 1);
}`;

const f = Math.fround, half = Math.f16round, bits = new DataView(new ArrayBuffer(4));
function reciprocalEstimate(x) {
  bits.setFloat32(0, x);
  const u = bits.getUint32(0), scaled = 256 | ((u & 0x7fffff) >>> 15), r = (Math.floor((1 << 19) / (scaled * 2 + 1)) + 1) >> 1;
  bits.setUint32(0, (u & 0x80000000) | ((253 - ((u >>> 23) & 255)) << 23) | ((r & 255) << 15));
  return bits.getFloat32(0);
}
function reciprocal(d) {
  let x = reciprocalEstimate(d);
  x = f(f(-d * x + 2) * x);
  return f(x * f(-d * x + 2));
}
const slope = (distance, quad) => half(f(quad * half(reciprocal(f(distance)))));

export function createContentsSDF(device) {
  const module = device.createShaderModule({code: IMAGE_WGSL}), target = {format: 'rgba16float'}, usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
  const pipeline = (entryPoint) => device.createRenderPipeline({layout: 'auto', vertex: {module, entryPoint: 'vs'}, fragment: {module, entryPoint, targets: [target]}, primitive: {topology: 'triangle-strip'}});
  const encodePipe = pipeline('encode'), decodePipe = pipeline('decode'), unionPipe = pipeline('decodeUnion');
  const paths = pathProducer(device);
  return () => {
    const imageU = device.createBuffer({size: 64, usage}), decodeU = device.createBuffer({size: 64, usage});
    let image = null, key = '', path = null;
    return {
      get image() { return image; },
      get pathData() { return path?.data; },
      /** @param o.bounds @param o.target @param o.zero @param o.previous @param o.path */
      encode(encoder, {bounds: [x, y, w, h], zero, one, scale, target: atlas, origin: [ox, oy], previous = null, smoothness = 0, path: pathShape = null}) {
        const left = Math.floor(x - zero), top = Math.floor(y - zero), columns = Math.round((Math.ceil(x + w + zero) - left) * scale), rows = Math.round((Math.ceil(y + h + zero) - top) * scale);
        const inner = f(-one / (zero - one)), outerQuad = f(h + 2 * f(zero)), centre = [left - x - w / 2, top - y - h / 2];
        const write = (buffer, [a, b]) => device.queue.writeBuffer(buffer, 0, new Float32Array([a, b, w, h, zero, one, half(inner), half(f(1 - inner)), slope(-one, h), slope(zero, outerQuad), outerQuad, f(h / w), scale, smoothness, pathShape ? 1 : 0]));
        const next = [columns, rows, ...centre, w, h, zero, one, scale, pathShape?.key].join();
        if (next !== key) {
          key = next;
          if (image?.width !== columns || image?.height !== rows) { image?.destroy(); image = device.createTexture({size: [columns, rows], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC}); }
          if (pathShape) (path ??= paths()).encode(encoder, {image, bounds: [x, y, w, h], zero, one, scale, at: [Math.round(left * scale), Math.round(top * scale)], local: pathShape.local, alphas: [half(inner), half(f(1 - inner))]});
          else {
            const p = encoder.beginRenderPass({colorAttachments: [{view: image.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
            write(imageU, centre);
            p.setPipeline(encodePipe);
            p.setBindGroup(0, device.createBindGroup({layout: encodePipe.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: imageU}}]}));
            p.draw(4);
            p.end();
          }
        }
        const fromX = Math.round(left * scale) - ox, fromY = Math.round(top * scale) - oy;
        write(decodeU, [fromX, fromY]);
        const pipe = previous ? unionPipe : decodePipe, entries = [{binding: 0, resource: {buffer: decodeU}}, {binding: 1, resource: image.createView()}];
        if (previous) entries.push({binding: 2, resource: previous.createView()});
        const p = encoder.beginRenderPass({colorAttachments: [{view: atlas.createView(), loadOp: previous ? 'load' : 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
        p.setPipeline(pipe);
        p.setBindGroup(0, device.createBindGroup({layout: pipe.getBindGroupLayout(0), entries}));
        p.setScissorRect(Math.max(0, fromX), Math.max(0, fromY), Math.min(atlas.width - Math.max(0, fromX), columns + Math.min(0, fromX)), Math.min(atlas.height - Math.max(0, fromY), rows + Math.min(0, fromY)));
        p.draw(4);
        p.end();
      },
      destroy() { image?.destroy(); imageU.destroy(); decodeU.destroy(); path?.destroy(); },
    };
  };
}

function pathProducer(device) {
  const module = device.createShaderModule({code: PATH_WGSL}), half16 = {format: 'r16float'};
  const blend = (operation) => ({operation, srcFactor: 'one', dstFactor: 'one'});
  const draw = (vertex, fragment, operation, primitive) => device.createRenderPipeline({layout: 'auto', vertex: {module, entryPoint: vertex},
    fragment: {module, entryPoint: fragment, targets: [{...half16, blend: {color: blend(operation), alpha: blend(operation)}, writeMask: GPUColorWrite.RED}]}, primitive});
  const strip = {topology: 'triangle-strip', stripIndexFormat: 'uint16'}, fan = {topology: 'triangle-list', frontFace: 'cw'};
  const lines = [draw('distanceVertex', 'distanceFragment', 'max', strip), draw('interiorVertex', 'interiorFragment', 'add', fan)];
  const curves = [draw('curveVertex', 'distanceFragment', 'max', strip), draw('curveInteriorVertex', 'interiorFragment', 'add', fan)];
  const full = (entryPoint, format) => device.createRenderPipeline({layout: 'auto', vertex: {module, entryPoint: 'full'}, fragment: {module, entryPoint, targets: [{format}]}, primitive: {topology: 'triangle-strip'}});
  const innerPipe = full('resolveInner', 'r16float'), outerPipe = full('resolveOuter', 'rgba16float');
  const indices = (n, of) => { const a = new Uint16Array(Math.ceil(n / 2) * 2); for (let i = 0; i < n; i++) a[i] = of(i); const b = device.createBuffer({size: a.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST}); device.queue.writeBuffer(b, 0, a); return b; };
  const stripB = indices(64, (i) => i % 5 === 4 ? 0xffff : 4 * Math.floor(i / 5) + [1, 0, 2, 3][i % 5]), fanB = indices(63, (i) => 4 * Math.floor(i / 3) + [1, 0, 2][i % 3]);
  return () => {
    const usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, innerU = device.createBuffer({size: 32, usage}), outerU = device.createBuffer({size: 32, usage}), resolveU = device.createBuffer({size: 32, usage});
    let pointsB = null, accumulator = null, innerR = null;
    const texture = (size) => device.createTexture({size, format: 'r16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING});
    return {
      encode(encoder, {image, bounds: [x, y, w, h], zero, one, scale, at, local, alphas}) {
        const ranges = [f(f(-one) * scale), f(f(zero) * scale)], reach = ranges[1];
        const o = [Math.floor(x * scale - reach) - 1, Math.floor(y * scale - reach) - 1];
        const region = [Math.ceil((x + w) * scale + reach) - o[0] + 1, Math.ceil((y + h) * scale + reach) - o[1] + 1], size = region.map((v) => Math.ceil(v / 32) * 32);
        if (accumulator?.width !== size[0] || accumulator?.height !== size[1]) { accumulator?.destroy(); innerR?.destroy(); accumulator = texture(size); innerR = texture(size); }
        const {contours, segments, at: [bx, by], k: [kx, ky]} = local, m = [f(kx * scale), f(ky * scale)], t = [f(bx * scale - o[0]), f(by * scale - o[1])];
        const place = (v, axis) => f(f(v) * m[axis] + t[axis]);
        const at2 = ([u, v]) => [place(u, 0), place(v, 1)], same = (a, b) => a[0] === b[0] && a[1] === b[1];
        let area = 0;
        for (let i = 0; i < segments.length; i += 4) area += segments[i] * segments[i + 3] - segments[i + 2] * segments[i + 1];
        const c3 = f(1 / 3), countOf = (p0, p1, p2, p3) => {
          const w = [0, 1].map((i) => Math.max(Math.abs(f(f(p2[i] - f(p1[i] + p1[i])) + p0[i])), Math.abs(f(f(p1[i] - f(p2[i] + p2[i])) + p3[i]))));
          const n = Math.ceil(f(Math.sqrt(f(f(Math.sqrt(f(f(w[0] * w[0]) + f(w[1] * w[1])))) * 6))));
          return !Number.isFinite(n) ? 0 : n < 1 ? (same(p0, p3) ? 0 : 1) : Math.min(n, 1024);
        };
        const paths = contours.map(({start, elements}) => {
          const edges = [];
          let cur = at2(start);
          const s0 = cur;
          for (const e of elements) {
            const p = at2(e.p);
            if (e.type === 'L') { if (!same(cur, p)) edges.push({p0: cur, p3: p, n: 1}); }
            else { const c1 = at2(e.c1), c2 = at2(e.c2); edges.push({p0: cur, c1, c2, p3: p, n: countOf(cur, c1, c2, p)}); }
            cur = p;
          }
          if (!same(cur, s0)) edges.push({p0: cur, p3: s0, n: 1});
          return area < 0 ? edges.reverse().map(({p0, c1, c2, p3, n}) => (c1 ? {p0: p3, c1: c2, c2: c1, p3: p0, n} : {p0: p3, p3: p0, n})) : edges;
        }).filter((edges) => edges.length);
        const curved = paths.some((edges) => edges.some((e) => e.n > 1));
        let data, count;
        if (!curved) {
          const flat = paths.flat();
          data = new Float32Array(flat.flatMap(({p0, p3}) => [...p0, ...p3]));
          count = flat.length;
        } else {
          const n = paths.reduce((sum, edges) => sum + 1 + edges.filter((e) => e.n).length, 0), buffer = new ArrayBuffer(32 * n), F = new Float32Array(buffer), I = new Int32Array(buffer);
          let r = 0, total = 0, cur = null;
          for (const edges of paths) {
            const s0 = edges[0].p0;
            if (!cur || !same(cur, s0)) { I[r * 8] = total; F.set([0, Infinity, Infinity, Infinity, Infinity, ...s0], r * 8 + 1); r++; }
            for (const e of edges) {
              if (!e.n) continue;
              const [c1, c2] = e.c1 ? [e.c1, e.c2] : [[0, 1].map((i) => f(c3 * f(e.p3[i] - e.p0[i]) + e.p0[i])), [0, 1].map((i) => f(c3 * f(e.p0[i] - e.p3[i]) + e.p3[i]))];
              I[r * 8] = total; F.set([f(1 / e.n), ...c1, ...c2, ...e.p3], r * 8 + 1); r++;
              total += e.n; cur = e.p3;
            }
          }
          I[0] = r - 1; I[1] = total;
          data = F.subarray(0, r * 8); count = total;
        }
        const points = data;
        this.data = data;
        if (!pointsB || pointsB.size < points.byteLength) { pointsB?.destroy(); pointsB = device.createBuffer({size: Math.max(32, Math.ceil(points.byteLength / 1024) * 1024), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST}); }
        device.queue.writeBuffer(pointsB, 0, points);
        const [distancePipe, interiorPipe] = curved ? curves : lines, [perDistance, perInterior] = [13, 21];
        const globals = (range) => { const b = new ArrayBuffer(24), v = new Float32Array(b); v.set([place((x + w / 2 - bx) / kx, 0), place((y + h / 2 - by) / ky, 1), 2 / size[0], 2 / size[1], range]); new Uint32Array(b)[5] = count; return b; };
        device.queue.writeBuffer(innerU, 0, globals(ranges[0]));
        device.queue.writeBuffer(outerU, 0, globals(ranges[1]));
        const r = new ArrayBuffer(24); new Int32Array(r).set([at[0] - o[0], at[1] - o[1], ...region]); new Float32Array(r).set(alphas, 4);
        device.queue.writeBuffer(resolveU, 0, r);
        const group = (pipe, entries) => device.createBindGroup({layout: pipe.getBindGroupLayout(0), entries: entries.map((resource, binding) => ({binding, resource}))});
        const scissors = [[Math.floor(x * scale) - o[0], Math.floor(y * scale) - o[1], Math.ceil((x + w) * scale) - Math.floor(x * scale), Math.ceil((y + h) * scale) - Math.floor(y * scale)], [1, 1, region[0] - 2, region[1] - 2]];
        [innerU, outerU].forEach((uniform, k) => {
          const p = encoder.beginRenderPass({colorAttachments: [{view: accumulator.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
          const [sx, sy, sw, sh] = scissors[k];
          p.setScissorRect(Math.max(0, sx), Math.max(0, sy), Math.max(0, Math.min(sw, size[0] - sx)), Math.max(0, Math.min(sh, size[1] - sy)));
          p.setPipeline(distancePipe); p.setBindGroup(0, group(distancePipe, [{buffer: uniform}, {buffer: pointsB}])); p.setIndexBuffer(stripB, 'uint16'); p.drawIndexed(64, Math.ceil(count / perDistance));
          p.setScissorRect(0, 0, region[0], region[1]);
          p.setPipeline(interiorPipe); p.setBindGroup(0, group(interiorPipe, [{buffer: uniform}, {buffer: pointsB}])); p.setIndexBuffer(fanB, 'uint16'); p.drawIndexed(63, Math.ceil(count / perInterior));
          p.end();
          const out = k ? image : innerR, pipe = k ? outerPipe : innerPipe;
          const q = encoder.beginRenderPass({colorAttachments: [{view: out.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
          if (!k) q.setScissorRect(0, 0, region[0], region[1]);
          q.setPipeline(pipe); q.setBindGroup(0, group(pipe, k ? [{buffer: resolveU}, accumulator.createView(), innerR.createView()] : [{buffer: resolveU}, accumulator.createView()])); q.draw(4);
          q.end();
        });
      },
      destroy() { innerU.destroy(); outerU.destroy(); resolveU.destroy(); pointsB?.destroy(); accumulator?.destroy(); innerR?.destroy(); },
    };
  };
}
