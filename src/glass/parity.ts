const ASCENT = 1950 / 2048, HEIGHT = (1950 + 494) / 2048, WEIGHTS: Record<string, string> = {500: '510', 600: '590'};
const PROPS = ['lineHeight', 'translate', 'fontWeight', 'fontSynthesisWeight', 'width', 'height', 'marginTop', 'marginBottom', 'display', 'position', 'webkitTextFillColor'] as const;

export interface GlyphMasks {
  base: string;
  scale: number;
  margin: number;
  entries: Record<string, {file: string; frame: [number, number]; size: [number, number]}>;
}

const metrics = new Map<string, {ascent: number; descent: number}>();
let context: CanvasRenderingContext2D | null = null;
function fontMetrics(s: CSSStyleDeclaration) {
  const font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  let m = metrics.get(font);
  if (!m) {
    context ??= document.createElement('canvas').getContext('2d')!;
    context.font = font;
    const t = context.measureText('H');
    metrics.set(font, (m = {ascent: t.fontBoundingBoxAscent, descent: t.fontBoundingBoxDescent}));
  }
  return m;
}

const holdsText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== '');

function drawnBox(el: Element, root: Element, dpr: number) {
  const snap = (v: number) => Math.floor(v * dpr + .5 + .025) / dpr;
  for (let a: Element | null = el; a && a !== root; a = a.parentElement) {
    if (a.hasAttribute('drawable')) { const r = a.getBoundingClientRect(), o = root.getBoundingClientRect(); return {box: a, left: snap(r.left - o.left), top: snap(r.top - o.top)}; }
  }
  return {box: root, left: 0, top: 0};
}
export function snapError(box: Element): [number, number] {
  const p = box.parentElement;
  if (!(box.classList.contains('lg-vibrant') || box.hasAttribute('data-lg-item')) || !p || p.children.length !== 1 || p.hasAttribute('drawable')) return [0, 0];
  const a = box.getBoundingClientRect(), b = p.getBoundingClientRect();
  return Math.abs(a.width - b.width) < .02 && Math.abs(a.height - b.height) < .02 ? [b.left - a.left, b.top - a.top] : [0, 0];
}

function paintedOrigin(el: Element, box: Element, b: DOMRect, ks: number) {
  const chain: {el: Element; t: [number, number]}[] = [];
  for (let a = el.parentElement; a && a !== box; a = a.parentElement) {
    const s = getComputedStyle(a), t: [number, number] = [0, 0];
    if (s.translate !== 'none') { const v = s.translate.split(' ').map(parseFloat); t[0] += v[0] || 0; t[1] += v[1] || 0; }
    if (s.transform !== 'none') { const m = new DOMMatrixReadOnly(s.transform); t[0] += m.e; t[1] += m.f; }
    if (t[0] || t[1]) chain.unshift({el: a, t});
  }
  let px = 0, py = 0, cx = 0, cy = 0;
  for (const {el: a, t} of chain) {
    const r = a.getBoundingClientRect(), x = (r.left - b.left) / ks, y = (r.top - b.top) / ks;
    px += Math.round(x - cx - t[0]) + t[0]; py += Math.round(y - cy - t[1]) + t[1];
    cx = x; cy = y;
  }
  return {painted: [px, py], client: [cx, cy]};
}

const nativeSnap = (v: number, dpr: number) => Math.floor(v * dpr + .5 + dpr / 64);

export function applyTextParity(root: HTMLElement, dpr: number, glyphs: GlyphMasks | null = null) {
  const els = [...root.querySelectorAll('*')].filter(holdsText) as HTMLElement[];
  const own = els.map((el) => PROPS.map((p) => el.style[p]));
  const frames: ([number, number] | null)[] = [];
  const masks = els.map((el) => {
    const s = getComputedStyle(el), size = parseFloat(s.fontSize), weight = WEIGHTS[s.fontWeight];
    const entry = glyphs && dpr === glyphs.scale ? glyphs.entries[`${el.textContent!.trim()}|${size}|${s.fontWeight}${s.textAlign === 'center' ? '|center' : ''}${el.dataset.lgFont ? `|${el.dataset.lgFont}` : ''}`] : undefined;
    frames.push(entry?.frame ?? null);
    el.style.translate = '';
    if (weight) el.style.fontWeight = weight;
    el.style.fontSynthesisWeight = 'none';
    el.style.marginTop = el.style.marginBottom = '0px';
    if (!entry) { el.style.lineHeight = `${Math.ceil(size * HEIGHT * dpr - 1e-9) / dpr}px`; return null; }
    if (el.textContent!.includes('\n')) el.style.height = `${entry.frame[1]}px`;
    else el.style.lineHeight = `${entry.frame[1]}px`;
    if (!el.classList.contains('lg-glass') && (s.display === 'inline' || s.display === 'block' || s.display === 'inline-block')) {
      el.style.width = `${entry.frame[0]}px`;
      if (s.display === 'inline') el.style.display = 'inline-block';
    }
    if (s.position === 'static') el.style.position = 'relative';
    el.style.webkitTextFillColor = 'transparent';
    const mask = document.createElement('div');
    mask.setAttribute('aria-hidden', 'true');
    mask.dataset.lgGlyphs = '';
    Object.assign(mask.style, {position: 'absolute', width: `${entry.size[0] / dpr}px`, height: `${entry.size[1] / dpr}px`, backgroundColor: 'currentColor', pointerEvents: 'none',
      maskImage: `url("${glyphs!.base}${encodeURIComponent(entry.file)}")`, maskSize: `${entry.size[0] / dpr}px ${entry.size[1] / dpr}px`, maskRepeat: 'no-repeat', webkitTextFillColor: 'initial'});
    el.append(mask);
    const box = drawnBox(el, root, dpr).box;
    if (box !== root && !box.hasAttribute('data-lg-plain')) { mask.dataset.lgGlyphsGpu = `${glyphs!.base}${encodeURIComponent(entry.file)}`; mask.style.visibility = 'hidden'; }
    return mask;
  });
  const shifts = els.map((el, k) => {
    const s = getComputedStyle(el), size = parseFloat(s.fontSize), line = parseFloat(s.lineHeight), {ascent, descent} = fontMetrics(s);
    const {box, left, top} = drawnBox(el, root, dpr), r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    const offset = r.top - b.top + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop);
    const mask = masks[k];
    if (mask) {
      const lw = parseFloat(getComputedStyle(box).width), ks = box !== root && lw > 0 && Math.abs(b.width / lw - 1) > 1e-3 ? b.width / lw : 1;
      const ex = (r.left - b.left) / ks + parseFloat(s.borderLeftWidth), ey = (r.top - b.top) / ks + parseFloat(s.borderTopWidth), m = glyphs!.margin;
      const range = document.createRange();
      range.selectNodeContents([...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== '')!);
      const t = range.getClientRects()[0];
      const [w] = frames[k]!, centred = s.textAlign === 'center' || (s.display.includes('flex') && s.justifyContent === 'center');
      const [sx, sy] = snapError(box);
      const fx = (t.left - b.left) / ks + sx + (centred ? (t.width / ks - w) / 2 : 0), fy = (t.top - b.top) / ks + sy - Math.floor((line - ascent - descent) / 2);
      const tx = nativeSnap(left + fx, dpr) / dpr - m - left, ty = nativeSnap(top + fy, dpr) / dpr - m - top;
      const {painted: [px, py], client: [cx, cy]} = mask.dataset.lgGlyphsGpu ? {painted: [0, 0], client: [0, 0]} : paintedOrigin(el, box, b, ks);
      const [nx, ny] = [Math.floor(tx - px + 1e-6), Math.floor(ty - py + 1e-6)];
      Object.assign(mask.style, {left: `${nx - (ex - cx)}px`, top: `${ny - (ey - cy)}px`, translate: `${tx - px - nx}px ${ty - py - ny}px`});
      return 0;
    }
    const native = nativeSnap(top + offset + snapError(box)[1], dpr) + Math.round(size * ASCENT * dpr);
    const chrome = (top + Math.floor(offset + .5) + Math.floor((line - ascent - descent) / 2) + ascent) * dpr;
    return (native - Math.round(chrome)) / dpr;
  });
  els.forEach((el, k) => { el.style.translate = shifts[k] ? `0 ${shifts[k]}px` : ''; });
  const unplaced = els.some((el) => { const {box} = drawnBox(el, root, dpr); if (box === root) return false; const r = (el.closest('[data-lg-item]') ?? box).getBoundingClientRect(); return r.left === 0 && r.top === 0; });
  return Object.assign(() => els.forEach((el, k) => { masks[k]?.remove(); PROPS.forEach((p, i) => { el.style[p] = own[k][i]; }); }), {unplaced});
}
