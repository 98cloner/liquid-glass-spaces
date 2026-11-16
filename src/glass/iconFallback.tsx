import {type CSSProperties} from 'react';
import back from '@material-symbols/svg-400/rounded/arrow_back_ios_new.svg?raw';
import forward from '@material-symbols/svg-400/rounded/arrow_forward_ios.svg?raw';
import search from '@material-symbols/svg-400/rounded/search.svg?raw';
import close from '@material-symbols/svg-400/rounded/close.svg?raw';
import cancel from '@material-symbols/svg-400/rounded/cancel-fill.svg?raw';
import check from '@material-symbols/svg-400/rounded/check.svg?raw';

type Box = [number, number, number, number];
const M: Record<string, [string, Box]> = {
  back: [back, [280, -863.5, 414.5, 766.5]], forward: [forward, [264.5, -865, 414.5, 766.5]], search: [search, [120, -841, 707, 707]],
  close: [close, [219, -741, 522, 522]], cancel: [cancel, [80, -880, 800, 800]], check: [check, [166.5, -704, 626.5, 446]],
};
const pathOf = (svg: string) => svg.match(/ d="([^"]+)"/)![1];
export function MaterialInk({glyph, to, fill = 'currentColor'}: {glyph: keyof typeof M; to: Box; fill?: string}) {
  const [svg, [x, y, w, h]] = M[glyph], s = Math.min(to[2] / w, to[3] / h);
  const tx = to[0] + to[2] / 2 - (x + w / 2) * s, ty = to[1] + to[3] / 2 - (y + h / 2) * s;
  return <path d={pathOf(svg)} fill={fill} transform={`translate(${tx} ${ty}) scale(${s})`} />;
}

const GLYPHS: Record<string, [number, number, keyof typeof M, number, number, number?]> = {
  'chevron.backward|17|back': [16.333, 23, 'back', 11, 18.667, -1.333],
  'chevron.right|17|menuchevron': [9.333, 12.667, 'forward', 6, 10.333, .667],
  'magnifyingglass|17|': [20.333, 18.667, 'search', 16.333, 16.333],
  'magnifyingglass|17|bar': [25.667, 25.333, 'search', 21, 21],
  'magnifyingglass|18|tab': [27.667, 26.667, 'search', 22.333, 22.333],
  'xmark|17|bar': [23, 21.333, 'close', 17, 17],
  'xmark.circle.fill|17|': [19.667, 19, 'cancel', 17, 17],
  'checkmark|17|menucheck': [13.333, 12.333, 'check', 10.333, 10],
  'checkmark|17|': [18.333, 16.333, 'check', 14.333, 14.333],
  'checkmark|17|bar': [24, 22.667, 'check', 18.667, 18.333],
};
export function fallbackInk(name: string, size: number, variant?: string): Box {
  const [w, h, , iw, ih, dx = 0] = GLYPHS[`${name}|${size}|${variant ?? ''}`];
  return [(w - iw) / 2 + dx, (h - ih) / 2, iw, ih];
}

export function IconFallback({name, size, variant, style, className}: {name: string; size: number; variant?: string; style?: CSSProperties; className?: string}) {
  const g = GLYPHS[`${name}|${size}|${variant ?? ''}`];
  if (!g) return null;
  const [w, h, glyph] = g;
  return (
    <svg aria-hidden="true" className={className} width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display: 'inline-block', flex: 'none', overflow: 'visible', ...style}}><MaterialInk glyph={glyph} to={fallbackInk(name, size, variant)} /></svg>
  );
}
export const hasIconFallback = (name: string, size: number, variant?: string) => `${name}|${size}|${variant ?? ''}` in GLYPHS;
export const fallbackFrame = (name: string, size: number, variant?: string): [number, number] | null => { const g = GLYPHS[`${name}|${size}|${variant ?? ''}`]; return g ? [g[0], g[1]] : null; };
