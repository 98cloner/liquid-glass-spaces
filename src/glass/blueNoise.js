export function blueNoise32(seed = 1) {
  const N = 32, out = new Uint8Array(N * N * 4), cos = new Float64Array(N), sin = new Float64Array(N);
  for (let k = 0; k < N; k++) { cos[k] = Math.cos(2 * Math.PI * k / N); sin[k] = Math.sin(2 * Math.PI * k / N); }
  let s = seed >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const dft2 = (re, im, sign) => {
    for (let pass = 0; pass < 2; pass++) {
      const r2 = new Float64Array(N * N), i2 = new Float64Array(N * N);
      for (let a = 0; a < N; a++) for (let k = 0; k < N; k++) {
        let sr = 0, si = 0;
        for (let n = 0; n < N; n++) { const at = pass ? n * N + a : a * N + n, j = (k * n) % N, c = cos[j], z = sign * sin[j]; sr += re[at] * c - im[at] * z; si += re[at] * z + im[at] * c; }
        const to = pass ? k * N + a : a * N + k; r2[to] = sr; i2[to] = si;
      }
      re.set(r2); im.set(i2);
    }
  };
  for (let c = 0; c < 4; c++) {
    const re = new Float64Array(N * N), im = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) re[i] = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    dft2(re, im, -1);
    for (let u = 0; u < N; u++) for (let v = 0; v < N; v++) {
      const r = Math.hypot(Math.min(u, N - u), Math.min(v, N - v)) / N, w = r <= 0.22 ? 0 : r >= 0.32 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * (r - 0.22) / 0.1);
      re[u * N + v] *= w; im[u * N + v] *= w;
    }
    dft2(re, im, 1);
    let m = 0, q = 0;
    for (let i = 0; i < N * N; i++) m += re[i];
    m /= N * N;
    for (let i = 0; i < N * N; i++) q += (re[i] - m) ** 2;
    const k = 53 / Math.sqrt(q / (N * N));
    for (let i = 0; i < N * N; i++) out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(127.5 + (re[i] - m) * k)));
  }
  return out;
}
