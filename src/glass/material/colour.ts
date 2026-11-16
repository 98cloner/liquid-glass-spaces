const f = Math.fround;
const words = (w: number[]) => Array.from(new Float32Array(new Uint32Array(w).buffer));
const mul = (a: number, b: number) => f(a * b), add = (a: number, b: number) => f(a + b), sub = (a: number, b: number) => f(a - b);
const finite = (v: readonly number[], n: number) => {
  if (v?.length !== n || v.some((x) => !Number.isFinite(x) || !Number.isFinite(f(x)))) throw new TypeError(`finite ${n}-component float32 colour required`);
  return v.map(f);
};


const [D_THRESHOLD, D_SCALE, D_MULTIPLIER, D_BIAS, D_EXPONENT, E_THRESHOLD, E_SCALE, E_EXPONENT, E_MULTIPLIER, E_BIAS] =
  words([0x3d25aee6, 0x3d9e8391, 0x3f72a76f, 0x3d55891a, 0x4019999a, 0x3b4d2e1c, 0x414eb852, 0x3ed55555, 0x3f870a3d, 0xbd6147ae]);
const signed = (x: number, g: (m: number) => number) => { const m = x > 0 ? x : -x, r = m === 1 ? 1 : g(m); return x > 0 ? r : -r; };
const linear = (x: number) => signed(x, (m) => m <= D_THRESHOLD ? f(m * D_SCALE) : f(Math.pow(f(f(m * D_MULTIPLIER) + D_BIAS), D_EXPONENT)));
const encoded = (x: number) => signed(x, (m) => m <= E_THRESHOLD ? f(m * E_SCALE) : f(f(f(Math.pow(m, E_EXPONENT)) * E_MULTIPLIER) + E_BIAS));
export const resolveSRGB = (rgba: readonly number[]) => { const [r, g, b, a] = finite(rgba, 4); return [linear(r), linear(g), linear(b), a]; };
export const encodeRGB = (rgb: readonly number[]) => finite(rgb, 3).map(encoded);


const C = words([0x3ed30eb1, 0x3e58fd3b, 0x3f094d17, 0x3f2e4253, 0x3d52b909, 0x3ddbf2f0, 0x3db4d7ec, 0x3e903d74, 0x3f214649, 0x3fa25c2d, 0x4053b18c, 0x408274ab,
  0x40270644, 0x3e6c8362, 0x3eaec16a, 0xbb897f53, 0x3f34133e, 0x3fda931e]);
const THIRD = words([0x3eaaaaab])[0];
const root = (x: number) => (x < 0 || Object.is(x, -0)) ? -f(Math.pow(Math.abs(x), THIRD)) : f(Math.pow(x, THIRD));
const legacyFlag = (legacy: boolean) => { if (typeof legacy !== 'boolean') throw new TypeError('explicit legacyInterpolation boolean required'); };
export function encodeAnimatable(rgba: readonly number[], legacy: boolean) {
  legacyFlag(legacy);
  const [r, g, b, a] = finite(rgba, 4);
  if (legacy) return [r, g, b, a].map((x) => mul(x, 128));
  const l = add(add(mul(C[0], r), mul(C[2], g)), mul(C[4], b)), m = add(add(mul(C[1], r), mul(C[3], g)), mul(C[5], b)), s = add(add(mul(r, C[6]), mul(g, C[7])), mul(b, C[8]));
  return [mul(root(l), a), mul(root(m), a), mul(a, root(s)), a].map((x) => mul(x, 128));
}
export function decodeAnimatable(data: readonly number[], legacy: boolean) {
  legacyFlag(legacy);
  const v = finite(data, 4).map((x) => mul(x, 1 / 128));
  if (legacy) return v;
  let [l, m, s] = v; const a = v[3];
  if (a !== 0) { const k = f(1 / a); l = mul(l, k); m = mul(m, k); s = mul(s, k); }
  const lc = mul(l, mul(l, l)), mc = mul(m, mul(m, m)), sc = mul(s, mul(s, s));
  return [add(sub(mul(lc, C[11]), mul(mc, C[10])), mul(C[13], sc)), sub(sub(mul(mc, C[12]), mul(lc, C[9])), mul(C[14], sc)), add(mul(sc, C[17]), sub(mul(lc, C[15]), mul(mc, C[16]))), a];
}


const TO_YCC = words([0x3e59b3d0, 0x3f371759, 0x3d93dd98, 0, 0, 0xbdeab368, 0xbec55326, 0x3f000000, 0, 0x3f000000, 0x3f000000, 0xbee88ce7, 0xbd3b98c8, 0, 0x3f000000, 0, 0, 0, 0x3f800000, 0]);
const TO_RGB = words([0x3f800000, 0, 0x3fc9930c, 0, 0xbf49930c, 0x3f800000, 0xbe3fcb92, 0xbeefaace, 0, 0x3ea7c84b, 0x3f800000, 0x3fed844d, 0, 0, 0xbf6d844d, 0, 0, 0, 0x3f800000, 0]);
const identity = () => [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const multiply = (a: number[], b: number[]) => Array.from({length: 20}, (_, i) => {
  const r = Math.floor(i / 5), c = i % 5;
  let sum = f(a[r * 5 + 3] * b[15 + c]);
  for (let k = 2; k >= 0; k--) sum = f(sum + f(a[r * 5 + k] * b[k * 5 + c]));
  return c === 4 ? f(sum + a[r * 5 + 4]) : sum;
});
const [EPSILON, STEP] = words([0x2b8cbccc, 0x38d1b717]);
export const quantizeMatrix = (m: readonly number[]) => Array.from(m, (v) => {
  let x = f(v); if (x < EPSILON && x > -EPSILON) x = 0;
  const q = f(x / STEP);
  return f((q < 0 ? -Math.floor(-q + 0.5) : Object.is(q, -0) ? -0 : Math.floor(q + 0.5)) * STEP);
});
export function yccMatrix(black: number, white: number, saturation: number) {
  [black, white, saturation] = [black, white, saturation].map(f);
  if (black === 0 && white === 1 && saturation === 1) return identity();
  const luma = identity(); luma[0] = f(white - black); luma[4] = black;
  const chroma = identity(); chroma[6] = chroma[12] = saturation; chroma[9] = chroma[14] = f(0.5 - f(saturation * 0.5));
  return multiply(TO_RGB, multiply(chroma, multiply(luma, TO_YCC)));
}
const FILL_CAP = words([0x3f7f0000])[0];
export function vibrancyFill(m: readonly number[], encodedRGB: readonly number[], alpha: number) {
  const gains = encodedRGB.map((x) => { const p = Math.min(f(f(alpha) * f(x)), FILL_CAP); return f(1 + f(p / f(1 - p))); });
  return Array.from(m, (v, i) => i < 15 ? f(f(v) * gains[Math.floor(i / 5)]) : f(v));
}
