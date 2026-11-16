import type {Platform, LabelLevel, SystemColor} from './platform/types.ts';
import {IOS26_5} from './platform/ios26_5.ts';
export type {LabelLevel, SystemColor} from './platform/types.ts';
export type GlassScheme = 'light' | 'dark';

/** A label level ('label', 'secondary-label', ...) or a system colour, for `<Vibrant tone>`. */
export type Tone = LabelLevel | SystemColor | 'menu-highlight' | 'tab-label' | 'alert-preferred' | 'popover-shadow' | 'notification-date';

const isLevel = (t: string): t is LabelLevel => t in IOS26_5.palette.labels;

export function toneCSS(tone: Tone, scheme: GlassScheme, opaque = false, p: Platform = IOS26_5): string {
  if (tone === 'menu-highlight') return opaque ? 'rgb(255 255 255)' : scheme === 'dark' ? 'rgb(255 255 255 / .12)' : 'rgb(0 0 0 / .08)';
  if (tone === 'tab-label') return scheme === 'dark' ? 'rgb(255 255 255)' : 'rgb(0 0 0)';
  if (tone === 'notification-date') return 'rgb(255 255 255)';
  if (tone === 'alert-preferred') return opaque ? 'rgb(255 255 255)' : `rgb(${p.palette.systemColors.blue[scheme].join(' ')})`;
  if (tone === 'popover-shadow') return opaque ? 'rgb(0 0 0)' : 'rgb(0 0 0 / .2)';
  if (isLevel(tone)) {
    const v = scheme === 'dark' ? 255 : 0;
    return `rgb(${v} ${v} ${v} / ${opaque ? 1 : p.palette.labels[tone][scheme]})`;
  }
  const [r, g, b] = p.palette.systemColors[tone][scheme];
  return `rgb(${r} ${g} ${b})`;
}

export function paletteVars(scheme: GlassScheme, p: Platform = IOS26_5): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const t of [...Object.keys(p.palette.labels), ...Object.keys(p.palette.systemColors)] as Tone[]) vars[`--lg-${t}`] = toneCSS(t, scheme, false, p);
  vars['--lg-tint'] = toneCSS('blue', scheme, false, p);
  for (const [k, v] of Object.entries(p.palette.menu)) vars[`--lg-menu-${k}`] = v[scheme];
  return vars;
}

export function toneMatrix(tone: Tone, scheme: GlassScheme, system: GlassScheme = scheme, p: Platform = IOS26_5): Float32Array {
  const P = p.palette, POPOVER_SHADOW = P.vibrancy['popover-shadow'], NOTIFICATION_DATE = P.vibrancy['notification-date'];
  const TAB_LABEL = P.vibrancy['tab-label'], ALERT_PREFERRED = P.vibrancy['alert-preferred'], MENU_HIGHLIGHT = P.vibrancy['menu-highlight'];
  if (tone === 'popover-shadow') return new Float32Array(Array.from({length: 20}, (_, i) => POPOVER_SHADOW[(i % 4) * 5 + Math.floor(i / 4)]));
  if (tone === 'notification-date') return new Float32Array(Array.from({length: 20}, (_, i) => NOTIFICATION_DATE[(i % 4) * 5 + Math.floor(i / 4)]));
  if (tone === 'menu-highlight' || tone === 'tab-label' || tone === 'alert-preferred') { const m = (tone === 'tab-label' ? TAB_LABEL : tone === 'alert-preferred' ? ALERT_PREFERRED : MENU_HIGHLIGHT)[scheme]; return new Float32Array(Array.from({length: 20}, (_, i) => m[(i % 4) * 5 + Math.floor(i / 4)])); }
  let k: number, off: number[], alpha: number;
  if (isLevel(tone)) {
    k = 1;
    const s = scheme === 'dark' ? 1 : -1;
    off = [s, s, s];
    alpha = P.labels[tone][scheme];
  } else {
    k = P.colourVibrancy.diagonal;
    const shift = P.colourVibrancy.shift[scheme];
    off = P.systemColors[tone][system].map((v) => Math.fround(v / 255) + shift);
    alpha = 1;
  }
  return new Float32Array([k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, alpha, off[0], off[1], off[2], 0]);
}

/** A system colour ('blue', 'red', 'green', ...) or `#rrggbb`. */
export type GlassTint = SystemColor | `#${string}`;

const f = Math.fround;
const add = (a: number, b: number) => f(a + b), sub = (a: number, b: number) => f(a - b), mul = (a: number, b: number) => f(a * b), div = (a: number, b: number) => f(a / b);
const words = (w: number[]) => Array.from(new Float32Array(new Uint32Array(w).buffer));
const TO_YCC = words([0x3e59b3d0, 0x3f371759, 0x3d93dd98, 0, 0, 0xbdeab368, 0xbec55326, 0x3f000000, 0, 0x3f000000, 0x3f000000, 0xbee88ce7, 0xbd3b98c8, 0, 0x3f000000, 0, 0, 0, 0x3f800000, 0]);
const TO_RGB = words([0x3f800000, 0, 0x3fc9930c, 0, 0xbf49930c, 0x3f800000, 0xbe3fcb92, 0xbeefaace, 0, 0x3ea7c84b, 0x3f800000, 0x3fed844d, 0, 0, 0xbf6d844d, 0, 0, 0, 0x3f800000, 0]);
const multiply = (a: number[], b: number[]) => Array.from({length: 20}, (_, i) => {
  const r = Math.floor(i / 5), c = i % 5;
  let sum = mul(a[r * 5 + 3], b[15 + c]);
  for (let k = 2; k >= 0; k--) sum = add(sum, mul(a[r * 5 + k], b[k * 5 + c]));
  return c === 4 ? add(sum, a[r * 5 + 4]) : sum;
});
const CHROMA_EPS = f(0.0003452669770922512);
function toHSL(rgb: number[]): [number, number, number] {
  const [r, g, b] = rgb.map(f), lo = Math.min(r, g, b), hi = Math.max(r, g, b), sum = add(hi, lo), l = mul(sum, 0.5), d = sub(hi, lo);
  let h = 0, s = 0;
  if (d >= CHROMA_EPS) {
    s = div(d, l > 0.5 ? sub(sub(2, hi), lo) : sum);
    h = hi === r ? add(g < b ? 6 : 0, div(sub(g, b), d)) : hi === g ? add(div(sub(b, r), d), 2) : add(div(sub(r, g), d), 4);
  }
  return [mul(h, 60) * (Math.PI / 180), s, l];
}
function fromHSL([h, s, l]: number[]): number[] {
  if (s === 0) return [l, l, l];
  const t = f(h * (180 / Math.PI) / 360), q = l >= 0.5 ? sub(add(s, l), mul(s, l)) : mul(l, add(s, 1)), p = sub(add(l, l), q);
  const ch = (t: number) => {
    if (t < 0) t = add(t, 1);
    if (t > 1) t = add(t, -1);
    const v = t < f(1 / 6) ? add(p, mul(mul(sub(q, p), 6), t)) : t < 0.5 ? q : t < f(2 / 3) ? add(p, mul(mul(sub(q, p), sub(f(2 / 3), t)), 6)) : p;
    return Math.max(0, Math.min(1, v));
  };
  return [ch(add(t, f(1 / 3))), ch(t), ch(add(t, f(-1 / 3)))];
}

export function tintRGBA(tint: GlassTint, system: GlassScheme, p: Platform = IOS26_5): number[] {
  if (tint.startsWith('#')) {
    const hex = tint.slice(1), v = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) throw new TypeError(`tint: '#rrggbb[aa]' expected, got ${tint}`);
    return [v(0), v(2), v(4), hex.length === 8 ? v(6) : 1];
  }
  return [...p.palette.systemColors[tint as SystemColor][system].map((v) => v / 255), 1];
}

export function tintMatrixRows(tint: GlassTint, system: GlassScheme, material: GlassScheme, p: Platform = IOS26_5): number[] {
  return rowsForRGBA(tintRGBA(tint, system, p), material, p);
}

function rowsForRGBA([r, g, b, a]: number[], material: GlassScheme, p: Platform): number[] {
  const c = [r, g, b].map(f), [h, s, l] = toHSL(c), dark = material === 'dark', T = p.palette.tint, t = T[material];
  if (s === 0) {
    const black = mul(l, f(T.grey.black)), white = add(l, mul(sub(1, l), f(T.grey.white)));
    const m = multiply(TO_RGB, multiply([sub(white, black), 0, 0, 0, black, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0], TO_YCC));
    m[18] = f(a);
    return m;
  }
  const d = fromHSL([h, mul(s, f(t.saturation)), mul(l, f(t.lightness))]);
  const top = dark ? d : c, bottom = dark ? c : d;
  const black = f(t.black), k = div(1, sub(f(t.white), black)), bias = mul(-k, black), Y = T.luma.map(f);
  const rows: number[] = [];
  for (let i = 0; i < 3; i++) {
    const delta = sub(top[i], bottom[i]);
    rows.push(...Y.map((w) => mul(delta, mul(k, w))), 0, add(mul(delta, bias), bottom[i]));
  }
  rows.push(0, 0, 0, f(a), 0);
  return rows;
}

const columns = (r: number[]) => new Float32Array(Array.from({length: 20}, (_, i) => r[(i % 4) * 5 + Math.floor(i / 4)]));

export function tintMatrix(tint: GlassTint, system: GlassScheme, material: GlassScheme, p: Platform = IOS26_5): Float32Array {
  return columns(tintMatrixRows(tint, system, material, p));
}

export function disabledTintMatrix(system: GlassScheme, material: GlassScheme, p: Platform = IOS26_5): Float32Array {
  const d = p.palette.disabled;
  return columns(rowsForRGBA([...d.tint.map((v) => v / 255), d.alpha[system]], material, p));
}
export function disabledLabel(scheme: GlassScheme, p: Platform = IOS26_5): string {
  const v = scheme === 'dark' ? 255 : 0;
  return `rgb(${v} ${v} ${v} / ${Math.fround(p.palette.labels['tertiary-label'][scheme] * p.palette.disabled.labelOpacity)})`;
}

export function barProminentLabel(scheme: GlassScheme): string {
  return scheme === 'dark' ? 'rgb(0 0 0)' : 'rgb(255 255 255)';
}
const ICC_Y = [0.2224884, 0.7168732, 0.0606079];
const srgbLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), srgbEncode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
export function barDisabledTintMatrix(tint: GlassTint, system: GlassScheme, material: GlassScheme, p: Platform = IOS26_5): Float32Array {
  const [r, g, b, a] = tintRGBA(tint, system, p), l = srgbEncode(ICC_Y[0] * srgbLinear(r) + ICC_Y[1] * srgbLinear(g) + ICC_Y[2] * srgbLinear(b));
  return columns(rowsForRGBA([l, l, l, a * p.palette.disabled.barAlpha[system]], material, p));
}

export function prominentLabel(_tint: GlassTint, _scheme: GlassScheme): string {
  return 'rgb(255 255 255)';
}
