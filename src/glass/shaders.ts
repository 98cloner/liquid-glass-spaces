
const fullscreen = `
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  var o: VOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = vec2f((p[i].x + 1.0) * 0.5, (1.0 - p[i].y) * 0.5);
  return o;
}
`;

export const copyWGSL = `
${fullscreen}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@fragment fn fsCopy(in: VOut) -> @location(0) vec4f {
  return textureSampleLevel(src, samp, in.uv, 0.0);
}
`;

export const premultiplyWGSL = `
${fullscreen}
@group(0) @binding(0) var src: texture_2d<f32>;
@fragment fn fsPremultiply(in: VOut) -> @location(0) vec4f {
  let c = textureLoad(src, vec2i(in.pos.xy), 0);
  return vec4f(c.rgb * c.a, c.a);
}
`;

export const supercircleWGSL = `
fn cornerUnit(u: f32, L: f32, E: f32) -> f32 {
  let e = min(E, L * 0.5);
  let i = 1.0 - (e / (E / 1.5286649465560913)) / 1.5286649465560913;
  let v = min(u, L - u);
  return select(i * abs(1.0 - 2.0 * (v - e) / max(L - 2.0 * e, 1e-6)), 1.0 - (v / e) * (1.0 - i), v < e);
}
fn supercircle(local: vec2f, size: vec2f, r: f32) -> f32 {
  let E = r * 1.5286649465560913;
  let p = vec2f(cornerUnit(local.x, size.x, E), cornerUnit(local.y, size.y, E));
  let m = max(p.x, p.y);
  let t = select(clamp(min(p.x, p.y) / m, 0.0, 1.0), 0.0, m == 0.0);
  let poly = (((3.1560099124908447 - 0.9260540008544922 * t) * t - 3.6412200927734375) * t + 1.268030047416687) * t + 0.2685309946537018;
  let cont = length(p) + 1.0 - 1.0 / (1.0 - t * t * poly);
  let circ = length(max(vec2f(0.0), p * 1.5286649465560913 - 0.5286650061607361)) * 0.6541655659675598 + 0.3458344340324402;
  let clampY = size.y * 0.5 < E;
  let clampX = size.x * 0.5 < E;
  let wx = select(select(0.0, 1.0, clampX), 0.0, clampY);
  let wy = select(0.0, 1.0, clampY);
  let h = unpack2x16float(pack2x16float(vec2f(mix(cont, circ, select(wy, wx, p.y > p.x)) - 1.0, 0.0))).x;
  return clamp(0.5 - h / max(fwidth(h + 1.0), 0.00009999999747378752), 0.0, 1.0);
}
`;

export const quadWGSL = `
struct QuadU { canvas: vec2f, center: vec2f, half: vec2f, pad: vec2f };
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> q: QuadU;
struct QOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vsQuad(@builtin(vertex_index) i: u32) -> QOut {
  var c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                          vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let px = q.center + c[i] * q.half;
  var o: QOut;
  o.pos = vec4f(px.x / q.canvas.x * 2.0 - 1.0, 1.0 - px.y / q.canvas.y * 2.0, 0.0, 1.0);
  o.uv = c[i] * 0.5 + vec2f(0.5);
  return o;
}
@fragment fn fsQuad(in: QOut) -> @location(0) vec4f {
  return textureSample(tex, samp, in.uv);
}
@fragment fn fsLayer(in: QOut) -> @location(0) vec4f {
  return textureSample(tex, samp, in.uv) * q.pad.x;
}
struct Portal { a: vec4f, b: vec4f, c: vec4f, d: vec4f };
@group(0) @binding(3) var<uniform> portal: Portal;
${supercircleWGSL}
@fragment fn fsPortal(in: QOut) -> @location(0) vec4f {
  let dpr = portal.a.z;
  let P = (in.pos.xy + portal.a.xy) / dpr;
  let hs = portal.c.xy * 0.5;
  let local = (P - portal.b.xy) / portal.b.z + hs;
  let r = min(portal.c.z, min(hs.x, hs.y));
  let px = portal.b.z * dpr;
  let cover = supercircle(local * px, portal.c.xy * px, r * px);
  let c = select(vec2f((local.x - hs.x) / portal.b.w + portal.d.z * 0.5, local.y / portal.b.w), local, portal.a.w > 0.5);
  let uv = (portal.d.xy + c) * dpr / vec2f(textureDimensions(tex));
  return textureSampleLevel(tex, samp, uv, 0.0) * cover;
}
struct Lens { a: vec4f };
@group(0) @binding(3) var<uniform> lens: Lens;
@group(0) @binding(4) var field: texture_2d<f32>;
@fragment fn fsLensLayer(in: QOut) -> @location(0) vec4f {
  let p = in.pos.xy;
  let dim = vec2i(textureDimensions(field));
  let fp = vec2i(floor(p - lens.a.xy));
  let inside = all(fp >= vec2i(0)) && all(fp < dim);
  let s = select(vec4f(0.0), textureLoad(field, clamp(fp, vec2i(0), dim - vec2i(1)), 0), inside);
  let h = -s.r;
  let aa = max(fwidth(h), 0.0001);
  let B = select(s.a * clamp(0.5 + h / aa, 0.0, 1.0), 0.0, h < -5.0);
  let H = lens.a.z;
  let t = clamp(h / max(H, 1e-5), 0.0, 1.0);
  let w = select(0.0, (1.0 - sqrt(max(0.0, 1.0 - (1.0 - t) * (1.0 - t)))) * clamp(0.5 + (H - h) / aa, 0.0, 1.0), H > 0.0 && s.a > 0.0);
  let at = p + s.gb * w * lens.a.w;
  let uv = (at - (q.center - q.half)) / (2.0 * q.half);
  return textureSampleLevel(tex, samp, uv, 0.0) * q.pad.x * B;
}
`;

export const contentLensWGSL = `
struct QuadU { canvas: vec2f, center: vec2f, half: vec2f, pad: vec2f };
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> q: QuadU;
struct CL { a: vec4f, b: vec4f, c: vec4f, d: vec4f };
@group(0) @binding(3) var<uniform> cl: CL;
struct QOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vsQuad(@builtin(vertex_index) i: u32) -> QOut {
  var c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                          vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let px = q.center + c[i] * q.half;
  var o: QOut;
  o.pos = vec4f(px.x / q.canvas.x * 2.0 - 1.0, 1.0 - px.y / q.canvas.y * 2.0, 0.0, 1.0);
  o.uv = c[i] * 0.5 + vec2f(0.5);
  return o;
}
fn h16(x: vec2f) -> vec2f { return unpack2x16float(pack2x16float(x)); }
fn lensMap(p: vec2f, half: vec2f, ov: f32, H: f32) -> vec3f {
  let R = min(half.x, half.y);
  let K = 1.5286649465560913;
  let E = R * K;
  let ap = abs(p);
  let wts = clamp(vec2f(2.0 * 1.4457785175867517) - (2.0 * half * 1.4457785175867517) / (R * 1.528665), vec2f(0.0), vec2f(1.0));
  let sg = select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0));
  var d: f32; var n: vec2f;
  if (all(ap > half - min(vec2f(E), half))) {
    let qq = ap - half + vec2f(E + (R - E) * max(wts.x, wts.y));
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
    d = min(max(qq.x, qq.y), 0.0) + E * h16(vec2f(c - 1.0, 0.0)).x;
    let pos = max(qq, vec2f(0.0));
    n = select(select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), qq.x > qq.y), normalize(pos), pos.x + pos.y > 0.0) * sg;
  } else {
    let qq = ap - half;
    d = max(qq.x, qq.y);
    n = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), qq.x > qq.y) * sg;
  }
  let e = vec2f(p.x, half.x * p.y / half.y);
  if (ov > 0.0 && length(e) > 0.0001) { n = normalize(n + (normalize(e) - n) * ov); }
  let h = -d;
  let aa = max(fwidth(h), 0.0001);
  let B = select(clamp(0.5 + h / aa, 0.0, 1.0), 0.0, h < -5.0);
  let t = clamp(h / max(H, 0.00001), 0.0, 1.0);
  let w = select(0.0, (1.0 - sqrt(max(0.0, 1.0 - (1.0 - t) * (1.0 - t)))) * clamp(0.5 + (H - h) / aa, 0.0, 1.0), H > 0.0);
  return vec3f(h16(n * w), h16(vec2f(B, 0.0)).x);
}
@fragment fn fsContentLens(in: QOut) -> @location(0) vec4f {
  let A = cl.b.xy; let c0 = cl.a.xy; let half = cl.a.zw; let a = cl.b.z;
  let P = in.pos.xy;
  let F2 = lensMap((P - c0) / A, half, cl.c.w, cl.c.z);
  let P2 = P + a * A * F2.xy;
  let F1 = lensMap((P2 - c0) / A, half, cl.c.y, cl.c.x);
  let P1 = P2 + a * A * F1.xy;
  let uv = (P1 - cl.d.xy) / cl.d.zw;
  return textureSampleLevel(tex, samp, uv, 0.0) * q.pad.x * F1.z * F2.z;
}
`;

export const glyphWGSL = `
struct QuadU { canvas: vec2f, center: vec2f, half: vec2f, pad: vec2f };
struct Ink { color: vec4f, m: array<vec4f, 5>, vibrant: vec4f };
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> q: QuadU;
@group(0) @binding(3) var dest: texture_2d<f32>;
@group(0) @binding(4) var<uniform> ink: Ink;
struct QOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) local: vec2f };
@vertex fn vsQuad(@builtin(vertex_index) i: u32) -> QOut {
  var c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                          vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let cs = cos(q.pad.y); let sn = sin(q.pad.y);
  let ext = vec2f(abs(cs) * q.half.x + abs(sn) * q.half.y, abs(sn) * q.half.x + abs(cs) * q.half.y);
  let px = q.center + c[i] * (ext + vec2f(q.pad.x));
  let d = px - q.center;
  var o: QOut;
  o.pos = vec4f(px.x / q.canvas.x * 2.0 - 1.0, 1.0 - px.y / q.canvas.y * 2.0, 0.0, 1.0);
  o.local = vec2f(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
  o.uv = (o.local + q.half) / (2.0 * q.half);
  return o;
}
@fragment fn fsGlyph(in: QOut) -> @location(0) vec4f {
  let edge = clamp(q.half + vec2f(0.5) - abs(in.local), vec2f(0.0), vec2f(1.0));
  let cover = edge.x * edge.y;
  let d = textureLoad(dest, vec2i(in.pos.xy), 0);
  let bg = d.rgb / max(d.a, 0.000001);
  let m = bg.r * ink.m[0] + bg.g * ink.m[1] + bg.b * ink.m[2] + d.a * ink.m[3] + ink.m[4];
  let vib = ink.vibrant.x > 0.5;
  let clampC = ink.vibrant.y > 0.5 || ink.m[3].w < 1.0;
  let color = select(ink.color.rgb, select(m.rgb, clamp(m.rgb, vec3f(0.0), vec3f(1.0)), clampC), vib);
  let s = textureSample(tex, samp, in.uv).a;
  let a = select(s, round(s * cover * 255.0) / 255.0, q.pad.x > 0.5) * select(ink.color.a, clamp(m.a, 0.0, 1.0) * ink.color.a, vib);
  if (ink.vibrant.z > 0.5) { return vec4f(clamp(color * a, vec3f(0.0), vec3f(1.0)), a); }
  let v = clamp(clamp(color * a, vec3f(0.0), vec3f(1.0)) + d.rgb * (1.0 - a), vec3f(0.0), vec3f(1.0)) * 255.0;
  return vec4f(ceil(v - 0.5) / 255.0, a + d.a * (1.0 - a));
}
`;

export const vibrantWGSL = `
struct QuadU { canvas: vec2f, center: vec2f, half: vec2f, pad: vec2f };
struct Vibrancy { c: array<vec4f, 5>, opacity: f32, layer: f32 };
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> q: QuadU;
@group(0) @binding(3) var dest: texture_2d<f32>;
@group(0) @binding(4) var<uniform> v: Vibrancy;
struct QOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vsQuad(@builtin(vertex_index) i: u32) -> QOut {
  var c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                          vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let px = q.center + c[i] * q.half;
  var o: QOut;
  o.pos = vec4f(px.x / q.canvas.x * 2.0 - 1.0, 1.0 - px.y / q.canvas.y * 2.0, 0.0, 1.0);
  o.uv = c[i] * 0.5 + vec2f(0.5);
  return o;
}
@fragment fn fsVibrant(in: QOut) -> @location(0) vec4f {
  let cov = textureSample(tex, samp, in.uv).a;
  let d = textureLoad(dest, vec2i(in.pos.xy), 0);
  let bg = d.rgb / max(d.a, 0.000001);
  let m = bg.r * v.c[0] + bg.g * v.c[1] + bg.b * v.c[2] + d.a * v.c[3] + v.c[4];
  let a = clamp(m.a, 0.0, 1.0) * v.opacity * cov;
  let c = select(m.rgb, clamp(m.rgb, vec3f(0.0), vec3f(1.0)), m.a < 1.0);
  if (v.layer > 0.5) { return vec4f(clamp(c * a, vec3f(0.0), vec3f(1.0)), a); }
  return vec4f(clamp(c * a, vec3f(0.0), vec3f(1.0)) + d.rgb * (1.0 - a), a + d.a * (1.0 - a));
}
`;
