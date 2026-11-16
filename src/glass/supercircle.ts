const F = Math.fround, H = (Math as unknown as {f16round: (v: number) => number}).f16round;
const K = F(1.5286649465560913);

export function supercircleField(iw: number, ih: number, ox: number, oy: number, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(iw * ih);
  if (!(w > 0 && h > 0 && r > 0)) return out;
  const E = r * K, ex = Math.min(E, w / 2), ey = Math.min(E, h / 2);
  const ix = -F(1 - F(F(ex / r) / K)), iy = -F(1 - F(F(ey / r) / K));
  const wx = ey < E ? 0 : ex < E ? 1 : 0, wy = ey < E ? 1 : ex < E ? 0 : 0;
  const at = (v: number, L: number, e: number, i: number) => v < e ? -1 + (v / e) * (i + 1) : v > L - e ? -i + ((v - (L - e)) / e) * (1 + i) : L - 2 * e <= 0 ? 0 : i - 2 * i * (v - e) / (L - 2 * e);
  const dw = iw + 1, d = new Float32Array(dw * (ih + 1));
  for (let y = 0; y <= ih; y++) for (let x = 0; x < dw; x++) {
    const px = Math.abs(F(at(x + 0.5 - ox, w, ex, ix))), py = Math.abs(F(at(y + 0.5 - oy, h, ey, iy)));
    const m = Math.max(px, py), t = m === 0 ? 0 : Math.min(1, F(Math.min(px, py) / m));
    const poly = F(F(F(F(F(F(F(F(F(3.1560099124908447) - F(F(0.9260540008544922) * t)) * t) - F(3.6412200927734375)) * t) + F(1.268030047416687)) * t) + F(0.2685309946537018)));
    const cont = F(F(F(Math.sqrt(F(F(px * px) + F(py * py)))) + 1) - F(1 / F(1 - F(F(t * t) * poly))));
    const qx = Math.max(0, F(F(px * K) - F(0.5286650061607361))), qy = Math.max(0, F(F(py * K) - F(0.5286650061607361)));
    const circ = F(F(F(Math.sqrt(F(F(qx * qx) + F(qy * qy)))) * F(0.6541655659675598)) + F(0.3458344340324402));
    d[y * dw + x] = H(F(F(cont + F((circ - cont) * (py > px ? wx : wy))) - 1));
  }
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
    const x0 = x & ~1, y0 = y & ~1, x1 = x0 + 1, y1 = y0 + 1;
    const dx = F(d[y * dw + x1] + 1) - F(d[y * dw + x0] + 1), dy = F(d[y1 * dw + x] + 1) - F(d[y0 * dw + x] + 1);
    out[y * iw + x] = Math.min(1, Math.max(0, F(0.5 - F(d[y * dw + x] / Math.max(F(Math.abs(dx) + Math.abs(dy)), F(0.00009999999747378752))))));
  }
  return out;
}
export function circularField(w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(w * h), R = Math.min(r, w / 2, h / 2);
  const sd = (x: number, y: number) => {
    const qx = Math.abs(x - w / 2) - (w / 2 - R), qy = Math.abs(y - h / 2) - (h / 2 - R);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - R;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = x & ~1, y0 = y & ~1, d = sd(x + .5, y + .5);
    const dx = sd(x0 + 1.5, y + .5) - sd(x0 + .5, y + .5), dy = sd(x + .5, y0 + 1.5) - sd(x + .5, y0 + .5);
    out[y * w + x] = Math.min(1, Math.max(0, .5 - d / Math.max(Math.abs(dx) + Math.abs(dy), 1e-4)));
  }
  return out;
}

export type CornerCurve = 'continuous' | 'circular';

export function supercircleCoverage(w: number, h: number, r: number, curve: CornerCurve = 'continuous'): Uint8ClampedArray {
  const f = curve === 'circular' ? circularField(w, h, r) : supercircleField(w, h, 0, 0, w, h, r), out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < f.length; i++) out[i] = Math.round(f[i] * 255);
  return out;
}

const images = new Map<string, ImageData>();
export function supercircleImage(w: number, h: number, r: number, dpr: number, curve: CornerCurve = 'continuous'): ImageData {
  const W = Math.round(w * dpr), Hh = Math.round(h * dpr), key = `${W}x${Hh}/${r * dpr}/${curve}`;
  let img = images.get(key);
  if (!img) {
    const c = supercircleCoverage(W, Hh, r * dpr, curve), px = new Uint8ClampedArray(W * Hh * 4);
    for (let i = 0; i < c.length; i++) { px[4 * i] = px[4 * i + 1] = px[4 * i + 2] = 255; px[4 * i + 3] = c[i]; }
    images.set(key, img = new ImageData(px, W, Hh));
  }
  return img;
}

const urls = new Map<string, string>();
export function supercircleURL(w: number, h: number, r: number, dpr: number, curve: CornerCurve = 'continuous'): string {
  const key = `${w}x${h}/${r}@${dpr}/${curve}`;
  let url = urls.get(key);
  if (!url) {
    const img = supercircleImage(w, h, r, dpr, curve), c = document.createElement('canvas');
    c.width = img.width; c.height = img.height; c.getContext('2d')!.putImageData(img, 0, 0);
    urls.set(key, url = c.toDataURL('image/png'));
  }
  return url;
}

export function pixelsURL(px: Uint8ClampedArray, w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w; c.height = h; c.getContext('2d')!.putImageData(new ImageData(px, w, h), 0, 0);
  return c.toDataURL('image/png');
}
