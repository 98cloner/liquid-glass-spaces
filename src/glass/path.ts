
export interface Contour { start: [number, number]; elements: ({type: 'L'; p: [number, number]} | {type: 'C'; c1: [number, number]; c2: [number, number]; p: [number, number]})[] }
export interface FlatPath { contours: Contour[]; segments: Float32Array; bounds: {x: number; y: number; w: number; h: number} }

const cache = new Map<string, FlatPath>();

export function flattenPath(d: string, tolerance = .005): FlatPath {
  const key = `${tolerance}|${d}`, hit = cache.get(key);
  if (hit) return hit;
  const contours: Contour[] = [], out: number[] = [], tokens = d.match(/[MLHVCSQTZmlhvcsqtz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, prev = '', contour: Contour | null = null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const num = () => Number(tokens[i++]);
  const grow = (px: number, py: number) => { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); };
  const open = () => { if (!contour) { contour = {start: [x, y], elements: []}; contours.push(contour); } return contour; };
  const flat = (nx: number, ny: number) => { if (nx !== x || ny !== y) out.push(x, y, nx, ny); x = nx; y = ny; grow(x, y); };
  const line = (nx: number, ny: number) => { if (nx !== x || ny !== y) open().elements.push({type: 'L', p: [nx, ny]}); flat(nx, ny); };
  const cubic = (ax: number, ay: number, bx: number, by: number, ex: number, ey: number) => {
    open().elements.push({type: 'C', c1: [ax, ay], c2: [bx, by], p: [ex, ey]});
    const dd = Math.max(Math.hypot(x - 2 * ax + bx, y - 2 * ay + by), Math.hypot(ax - 2 * bx + ex, ay - 2 * by + ey));
    const n = Math.max(1, Math.ceil(Math.sqrt(.75 * dd / tolerance)));
    const px = x, py = y;
    for (const [p0, p1, p2, p3, axis] of [[px, ax, bx, ex, 0], [py, ay, by, ey, 1]] as const) {
      const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0, disc = b * b - 4 * a * c;
      const roots = Math.abs(a) < 1e-12 ? (Math.abs(b) < 1e-12 ? [] : [-c / b]) : disc < 0 ? [] : [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)];
      for (const t of roots) if (t > 0 && t < 1) {
        const u = 1 - t, v = u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
        if (axis) { y0 = Math.min(y0, v); y1 = Math.max(y1, v); } else { x0 = Math.min(x0, v); x1 = Math.max(x1, v); }
      }
    }
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      flat(u * u * u * px + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * ex, u * u * u * py + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * ey);
    }
    x = ex; y = ey;
    cx = bx; cy = by;
  };
  const close = () => { if (x !== sx || y !== sy) line(sx, sy); contour = null; };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { close(); prev = 'Z'; continue; }
    if (C === 'M') {
      close();
      x = sx = num() + ox; y = sy = num() + oy;
      grow(x, y);
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L') line(num() + ox, num() + oy);
    else if (C === 'H') line(num() + ox, y);
    else if (C === 'V') line(x, num() + oy);
    else if (C === 'C') { const a = num() + ox, b = num() + oy, c = num() + ox, e = num() + oy; cubic(a, b, c, e, num() + ox, num() + oy); }
    else if (C === 'S') {
      const r = 'CS'.includes(prev), a = r ? 2 * x - cx : x, b = r ? 2 * y - cy : y, c = num() + ox, e = num() + oy;
      cubic(a, b, c, e, num() + ox, num() + oy);
    } else if (C === 'Q' || C === 'T') {
      const r = 'QT'.includes(prev), qx = C === 'Q' ? num() + ox : r ? 2 * x - cx : x, qy = C === 'Q' ? num() + oy : r ? 2 * y - cy : y, ex = num() + ox, ey = num() + oy;
      cubic(x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey), ex, ey);
      cx = qx; cy = qy;
    } else break;
    prev = C;
  }
  close();
  const result = {contours, segments: new Float32Array(out), bounds: {x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0)}};
  if (cache.size > 64) cache.clear();
  cache.set(key, result);
  return result;
}
