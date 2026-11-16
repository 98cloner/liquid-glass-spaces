import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Dialog} from '@base-ui/react/dialog';
import {Glass, GlassLayer, useGlassPage, useGlassScheme, Vibrant} from './react';
import {popoverShadowURL} from './popoverShadow';
import {addTicker, commit, frameNow, present} from './frame';
import {layoutBox} from './renderer';
import {ALERT_INK, capsuleFill, lineCount, useActionPress, type AlertAction} from './alert';

export const POPOVER = {radius: 34, arrow: 13, width: 240};
const K = [37.00876055902999, 29.52583609814208, 21.47078895625375, 2.546987186798539, 12.676010105275395, 5.748024905508571, 51.9746094808058].map((v) => v / 34);
const EXPANSION = 1.528665;

type Cmd = [string, ...number[]];
export function popoverPath(width: number, height: number, direction: 'up' | 'down' | 'left' | 'right' | 'none', offset = 0, radius = POPOVER.radius): string {
  const p: Cmd[] = [];
  if (direction === 'none' && Math.min(width, height) < 2 * radius * EXPANSION) p.push(...smallNoArrow(width, height));
  else {
    const r = Math.min(radius, Math.min(width, height) / 2 / EXPANSION), A = POPOVER.arrow, B = 26;
    const x = direction === 'left' ? A : 0, y = direction === 'up' ? A : 0, w = width - (direction === 'left' || direction === 'right' ? A : 0), h = height - (direction === 'up' || direction === 'down' ? A : 0);
    const R = x + w, D = y + h;
    const L = (a: number, b: number) => p.push(['L', a, b]), C = (...a: number[]) => p.push(['C', ...a]);
    const corner = (kind: 'tl' | 'bl' | 'br' | 'tr') => {
      const tr = ([a, b]: number[]) => (kind === 'tl' ? [x + a, y + b] : kind === 'bl' ? [x + b, D - a] : kind === 'br' ? [R - a, D - b] : [R - b, y + a]);
      const [a, b, c, e, f, g, z] = K.map((v) => v * r), c1 = [a, 0, b, 0, c, e], c2 = [f, g, g, f, e, c], c3 = [0, b, 0, a, 0, z];
      for (const v of [c1, c2, c3]) { C(...[0, 2, 4].flatMap((i) => tr(v.slice(i, i + 2)))); if (v === c1) L(...(tr([c, e]) as [number, number])); }
    };
    const axis = direction === 'up' || direction === 'down' ? width : height, threshold = Math.floor(axis / 2) - radius - 15;
    const pinned = offset === 0 ? 0 : offset < -threshold ? -1 : offset > threshold ? 1 : 0;
    let t = Math.max(13, Math.min(axis - 13, axis / 2 + offset));
    const arrow = (map: (a: number, b: number) => number[]) => {
      const a: Cmd[] = [['M', t - 18.5, 0], ['C', t - 13, 0, t - 13, 0, t - 7.5, 6], ['L', t - 2, 12], ['C', t, 13, t, 13, t + 2, 12], ['L', t + 7.5, 6], ['C', t + 13, 0, t + 13, 0, t + 18.5, 0]];
      for (const [cmd, ...v] of a) p.push([cmd, ...v.flatMap((_, i) => (i % 2 ? [] : map(v[i], v[i + 1])))]);
    };
    if (direction === 'down') {
      arrow((a, b) => [a, D + b]);
      if (pinned === 1) { L(t + 13, D); C(R, D, R, D, R, D - r); } else corner('br');
      L(R, y + r); corner('tr'); L(x + r + B + 6, y); corner('tl'); L(x, D - r);
      if (pinned === -1) C(x, D, x, D, t - 13, D); else { corner('bl'); L(t - 18.5, D); }
    } else if (direction === 'up') {
      t = width - t; arrow((a, b) => [width - a, y - b]); const at = width - t;
      if (pinned === -1) { L(at - 13, y); C(x, y, x, y, x, y + r); } else corner('tl');
      L(x, D - r); corner('bl'); L(R - r, D); corner('br'); L(R, y + r);
      if (pinned === 1) C(R, y, R, y, at + 13, y); else { corner('tr'); L(at + 18.5, y); }
    } else if (direction === 'left') {
      arrow((a, b) => [x - b, a]);
      if (pinned === 1) { L(x, t + 13); C(x, D, x, D, x + r, D); } else corner('bl');
      L(R - r, D); corner('br'); L(R, y + r); corner('tr'); L(x + r + B + 6, y);
      if (pinned === -1) C(x, y, x, y, x, t - 13); else { corner('tl'); L(x, t - 18.5); }
    } else if (direction === 'right') {
      t = height - t; arrow((a, b) => [R + b, height - a]); const at = height - t;
      if (pinned === -1) { L(R, at - 13); C(R, y, R, y, R - r, y); } else corner('tr');
      L(x + r + B + 6, y); corner('tl'); L(x, D - r); corner('bl'); L(R - r, D);
      if (pinned === 1) C(R, D, R, D, R, at + 13); else { corner('br'); L(R, at + 18.5); }
    } else {
      p.push(['M', x + K[6] * r, y]); corner('tl'); L(x, D - K[6] * r); corner('bl'); L(R - K[6] * r, D); corner('br'); L(R, y + K[6] * r); corner('tr'); L(x + K[6] * r, y);
    }
  }
  return p.map(([c, ...v]) => `${c}${v.map((n) => +n.toFixed(6)).join(' ')}`).join(' ') + ' Z';
}

function smallNoArrow(W: number, H: number): Cmd[] {
  if (W < H) return smallNoArrow(H, W).map(([c, ...v]) => [c, ...v.flatMap((_, i) => (i % 2 ? [] : [v[i + 1], v[i]]))] as Cmd);
  const v = H / 2, a = v * .95, m = .980263, off = a * (1 - m), rad = a * m, d = a * .22 * 1.0530431270599365;
  const q = d + (a / 1.0530431270599365 + a * .22 * .33 / 1.0530431270599365) * .67, qq = d + q, extent = 2 * d + qq;
  const th = 70 * Math.PI / 180, co = Math.cos(th), si = Math.sin(th), z = 4 / 3 * Math.tan(th / 4);
  const tr: Cmd[] = [['C', W - (qq - off), 0, W - (q - off), 0, W - rad + rad * co, a - rad * si], ['L', W - rad + rad * co, a - rad * si],
    ['C', W - rad + rad * co + z * rad * si, a - rad * si + z * rad * co, W, a - z * rad, W, a], ['C', W, v, W, v, W, v]];
  const br: Cmd[] = [['C', W, H - v, W, H - v, W, H - v], ['L', W, H - a], ['C', W, H - a + z * rad, W - rad + rad * co + z * rad * si, H - a + rad * si - z * rad * co, W - rad + rad * co, H - a + rad * si],
    ['C', W - (q - off), H, W - (qq - off), H, W - (extent - off), H]];
  const rotate = ([c, ...n]: Cmd): Cmd => [c, ...n.map((u, i) => (i % 2 ? H : W) - u)];
  return [['M', v, 0], ['L', W - v, 0], ...tr, ['L', W, H - v], ...br, ['L', v, H], ...tr.map(rotate), ['L', 0, v], ...br.map(rotate), ['L', v, 0]];
}

const DIRS: Record<number, 'up' | 'down' | 'left' | 'right'> = {1: 'up', 2: 'down', 4: 'left', 8: 'right'};
const roundAway = (x: number) => Math.sign(x) * Math.floor(Math.abs(x) + .5);
export function placePopover(source: {x: number; y: number; w: number; h: number}, content: [number, number], safe: [number, number, number, number], permitted = 15) {
  const [sx, sy, sw, sh] = [source.x, source.y, source.w, source.h], [cw, ch] = content, margin = 10;
  const [ax, ay, aw, ah] = [safe[0] + margin, safe[1] + margin, safe[2] - 2 * margin, safe[3] - 2 * margin], A = POPOVER.arrow;
  const vx = sx + Math.floor(sw / 2) - Math.floor(cw / 2), hy = sy + Math.floor(sh / 2) - Math.floor(ch / 2);
  const candidates: Record<number, number[]> = {1: [vx, sy + sh, cw, ch + A], 2: [vx, sy - ch - A, cw, ch + A], 4: [sx + sw, hy, cw + A, ch], 8: [sx - cw - A, hy, cw + A, ch]};
  let best: {d: number; c: number[]} | null = null, bestArea = -1;
  for (const d of [2, 4, 1, 8]) {
    if (!(permitted & d)) continue;
    const c = candidates[d], x = Math.max(c[0], ax), y = Math.max(c[1], ay), area = Math.max(0, Math.min(c[0] + c[2], ax + aw) - x) * Math.max(0, Math.min(c[1] + c[3], ay + ah) - y);
    if (roundAway(area) > roundAway(bestArea)) { bestArea = area; best = {d, c}; }
  }
  if (!best) {
    const w = Math.min(cw, aw), h = Math.min(ch, ah);
    return {direction: 'none' as 'up' | 'down' | 'left' | 'right' | 'none', x: roundAway(Math.max(ax, Math.min(ax + aw - w, Math.floor(sx + sw / 2 - w / 2)))), y: roundAway(Math.max(ay, Math.min(ay + ah - h, Math.floor(sy + sh / 2 - h / 2)))), w, h, offset: 0};
  }
  const c = best.c, w = Math.min(c[2], aw), h = Math.min(c[3], ah), x = Math.max(ax, Math.min(ax + aw - w, c[0])), y = Math.max(ay, Math.min(ay + ah - h, c[1]));
  return {direction: DIRS[best.d], x: roundAway(x), y: roundAway(y), w, h, offset: roundAway(best.d < 4 ? sx + sw / 2 - (x + w / 2) : sy + sh / 2 - (y + h / 2))};
}

/** Props of `ConfirmationDialog`. */
export interface ConfirmationDialogProps {
  /** Shown. */
  open: boolean;
  /** Called when it closes. */
  onOpenChange?: (open: boolean) => void;
  /** Its title, shown when `titleVisible`. */
  title?: string;
  /** Shows the title. */
  titleVisible?: boolean;
  /** Text under the title. */
  message?: string;
  /** Its buttons. A cancel action isn't shown: a tap outside or Escape chooses it. */
  actions: AlertAction[];
  /** The element it is presented from: a ref, the element, or a getter. */
  anchor: {current: HTMLElement | null} | HTMLElement | null | (() => HTMLElement | null);
  /** The screen's safe area in CSS px, [top, right, bottom, left]: what it presents stays inside it. Default [62, 0, 34, 0], a phone in portrait. */
  safeArea?: [number, number, number, number];
}

const W = POPOVER.width, PAD = 30, INSET = 16, ROW = 48, GAP = 8;
const PRESENT = {k: 331.90069292204754, c: 29.149026979994403, d: .4937}, DISMISS = {k: 283.97349037964307, c: 28.647572099519508, d: .51566}, FROM_H = 100, FROM_S = .01;
const springQ = ({k, c}: {k: number; c: number}, t: number) => {
  if (t <= 0) return 0;
  const a = c / 2, w = Math.sqrt(k - a * a);
  return 1 - Math.exp(-a * t) * (Math.cos(w * t) + (a / w) * Math.sin(w * t));
};
type Dir = 'up' | 'down' | 'left' | 'right' | 'none';
const anchorOf = (d: Dir, o: number, w: number, h: number): [number, number] =>
  d === 'up' ? [.5 + o / w, 0] : d === 'down' ? [.5 + o / w, 1] : d === 'left' ? [0, .5 + o / h] : d === 'right' ? [1, .5 + o / h] : [.5, .5];

/** A list of actions in a glass popover, presented from an element. */
export function ConfirmationDialog({open, onOpenChange, title, titleVisible = false, message, actions, anchor, safeArea = [62, 0, 34, 0]}: ConfirmationDialogProps) {
  const page = useGlassPage(), scheme = useGlassScheme(), ink = ALERT_INK[scheme];
  const [shown, setShown] = useState(false), [, poke] = useState(0), [q, setQ] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  const st = useRef({at: 0, closing: false, off: () => {}, chosen: null as AlertAction | null, geo: null as null | {w: number; h: number; open: [number, number]; close: [number, number]}}).current;
  useEffect(() => { poke((n) => n + 1); }, []);
  useEffect(() => () => st.off(), [st]);

  const run = () => {
    st.off();
    st.off = addTicker((now) => {
      const t = (now - st.at) / 1000, spec = st.closing ? DISMISS : PRESENT, p = springQ(spec, t), v = st.closing ? 1 - p : p, done = t > spec.d + .1;
      const g = st.geo;
      if (g) {
        const s = FROM_S + (1 - FROM_S) * v, [ax, ay] = st.closing ? g.close : g.open, h = FROM_H + (g.h - FROM_H) * v;
        const A = [ax * g.w, ay * g.h], C = [g.w / 2, ay * (g.h - h) + h / 2];
        present(box.current, done ? {} : {opacity: Math.max(0, Math.min(1, v)), scale: [s, s], x: (A[0] - C[0]) * (1 - s), y: (A[1] - C[1]) * (1 - s)});
      }
      commit(() => setQ(done ? (st.closing ? 0 : 1) : v));
      if (done && st.closing) { st.closing = false; commit(() => setShown(false)); const c = st.chosen; st.chosen = null; c?.onSelect?.(); }
      return !done;
    }, page);
  };
  useLayoutEffect(() => {
    if (open && (!shown || st.closing)) {
      if (!shown) setShown(true);
      st.closing = false; st.at = frameNow(); run();
    } else if (!open && shown && !st.closing) {
      st.closing = true; st.at = frameNow(); run();
    }
  });
  const choose = (i: number) => { const a = actions[i]; if (!a || a.disabled) return; st.chosen = a; onOpenChange?.(false); };
  const cancel = () => { actions.find((a) => a.role === 'cancel')?.onSelect?.(); onOpenChange?.(false); };
  const {pressed, handlers} = useActionPress(box, actions, choose);

  const root = page(), source = typeof anchor === 'function' ? anchor() : anchor instanceof HTMLElement ? anchor : anchor?.current ?? null;
  return (
    <Dialog.Root open={shown && !!root && !!source} modal="trap-focus" disablePointerDismissal onOpenChange={(o, d) => { if (!o && d.reason === 'escape-key') cancel(); }}>
      {shown && root && source && <Dialog.Portal container={root}>{content(root, source)}</Dialog.Portal>}
    </Dialog.Root>
  );

  function content(root: HTMLElement, source: HTMLElement) {
    const font = getComputedStyle(root).fontFamily;
    const shownTitle = titleVisible && title ? title : undefined, lone = !shownTitle !== !message ? (shownTitle ?? message)! : null, two = !!(shownTitle && message);
    const lines = two ? lineCount(message!, font, W - 2 * PAD) : 0, msgH = lines === 1 ? 18 : lines * 19;
    const loneLines = lone !== null ? lineCount(lone, font, W - 2 * PAD, 17, 22) : 1, loneExtra = (loneLines - 1) * 22;
    const headerFull = lone !== null ? 44.33 + loneExtra : two ? 50 + msgH + 4.33 : 0, headerMin = lone !== null ? headerFull - 17.33 : two ? headerFull - 17.33 - 7.33 : 0;
    const rows = actions.map((a, i) => ({a, i})).filter((x) => x.a.role !== 'cancel');
    const A = 2 * INSET + rows.length * ROW + Math.max(0, rows.length - 1) * GAP, aMin = ROW * Math.min(rows.length, 1.5);
    const [top0, right, bottom, left0] = safeArea, sw = root.offsetWidth || 402, sh = root.offsetHeight || 874, safe: [number, number, number, number] = [left0, top0, sw - left0 - right, sh - top0 - bottom];
    const srcBox = layoutBox(source, root), at = placePopover(srcBox, [W, headerFull + A], safe), prov = placePopover(srcBox, [320, 480], safe);
    const dir = at.direction, vertical = dir === 'up' || dir === 'down', AR = POPOVER.arrow, B = at.h - (vertical ? AR : 0);
    let headerView = headerFull, headerContent = headerFull, titleTop = 22, gap = 7.67;
    if (headerFull + A > B) {
      const room = B - A - headerMin;
      if (room >= 0) { const t = Math.min(17.33, room); titleTop = 4.67 + t; gap = .33 + Math.min(7.33, room - t); headerContent = headerView = headerMin + room; }
      else { titleTop = 4.67; gap = .33; headerContent = headerMin; headerView = Math.max(0, Math.min(B - aMin, headerMin, Math.max(.6 * B, B - A))); }
    }
    const actionsView = B - headerView;
    st.geo = {w: at.w, h: at.h, open: anchorOf(prov.direction, prov.offset, at.w, at.h), close: anchorOf(dir, at.offset, at.w, at.h)};
    const h = FROM_H + (at.h - FROM_H) * q, p = at.h === FROM_H ? 1 : (h - FROM_H) / (at.h - FROM_H);
    const body0 = FROM_H - (vertical ? AR : 0), lerp = (a: number, b: number) => a + (b - a) * p;
    const hv = lerp(Math.max(0, body0 - aMin), headerView), av = lerp(Math.min(aMin, body0), actionsView), tTop = lerp(4.67, titleTop), mTop = tTop + 20.33 + lerp(.33, gap);
    const ay = (st.closing ? st.geo.close : st.geo.open)[1], oy = ay * (at.h - h);
    const shape = popoverPath(at.w, h, dir, at.offset);
    const body = {x: dir === 'left' ? AR : 0, y: dir === 'up' ? AR : 0, h: h - (vertical ? AR : 0)};
    const bw = W - 2 * INSET, scrolls = (q === 1 && !st.closing);
    const shadow = popoverShadowURL();
    return (
      <div data-lg-popover-root="" style={{position: 'absolute', inset: 0}}>
        { }
        <GlassLayer onPointerDown={(e) => { if (e.button === 0 && !st.closing) cancel(); }} style={{position: 'absolute', inset: 0}} />
        <Dialog.Popup ref={box} aria-label={shownTitle ? undefined : title ?? message ?? 'Confirm'} data-lg-group="" data-lg-popup="" {...handlers} initialFocus={box}
          style={{position: 'absolute', left: at.x, top: at.y, width: at.w, height: at.h, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none'}}>
          {
}
          {(() => {
            const S = {x: body.x - 150, y: oy + body.y - 150, w: W + 300, h: body.h + 300}, x0 = Math.max(S.x, -at.x), y0 = Math.max(S.y, -at.y);
            const x1 = Math.min(S.x + S.w, sw - at.x), y1 = Math.min(S.y + S.h, sh - at.y);
            if (x1 <= x0 || y1 <= y0) return null;
            return <Vibrant tone="popover-shadow" style={{position: 'absolute', left: x0, top: y0, width: x1 - x0, height: y1 - y0, overflow: 'hidden', color: 'transparent', pointerEvents: 'none'}}>
              <span style={{position: 'absolute', left: S.x - x0, top: S.y - y0, width: S.w, height: S.h, boxSizing: 'border-box', borderStyle: 'solid', borderWidth: 184,
                borderImage: `url(${shadow}) 552 fill / 184px stretch`}} />
            </Vibrant>;
          })()}
          <Glass shape={shape} style={{position: 'absolute', left: 0, top: oy, width: at.w, height: h}}>
            <div style={{position: 'absolute', left: body.x, top: body.y, width: W, height: Math.max(0, body.h), overflow: 'hidden'}}>
              { }
              <div style={{position: 'absolute', left: 0, top: 0, width: W, height: Math.max(0, hv), overflowX: 'hidden', overflowY: scrolls && headerContent > headerView + .5 ? 'auto' : 'hidden'}}>
                <div style={{position: 'relative', height: headerContent}}>
                  {lone !== null && <div style={{position: 'absolute', left: PAD, top: tTop, width: W - 2 * PAD, display: 'flex', justifyContent: 'center'}}>
                    {shownTitle ? <Dialog.Title render={<span />} style={{fontSize: 17, lineHeight: loneLines > 1 ? '22px' : '20.333px', textAlign: 'center', color: ink.title}}>{lone}</Dialog.Title>
                      : <Dialog.Description render={<span />} style={{fontSize: 17, lineHeight: loneLines > 1 ? '22px' : '20.333px', textAlign: 'center', color: ink.title}}>{lone}</Dialog.Description>}
                  </div>}
                  {two && <div style={{position: 'absolute', left: PAD, top: tTop, width: W - 2 * PAD}}>
                    <Dialog.Title render={<span />} style={{fontSize: 17, lineHeight: '20.333px', fontWeight: 600, color: ink.title}}>{shownTitle}</Dialog.Title>
                  </div>}
                  {two && <Dialog.Description render={<div />} style={{position: 'absolute', left: PAD, top: mTop, width: W - 2 * PAD, fontSize: 15, lineHeight: lines === 1 ? '18px' : '19px', color: ink.message}}>{message}</Dialog.Description>}
                </div>
              </div>
              { }
              <div style={{position: 'absolute', left: 0, top: hv, width: W, height: Math.max(0, av), overflowX: 'hidden', overflowY: scrolls && A > actionsView + .5 ? 'auto' : 'hidden'}}>
                <div style={{position: 'relative', height: A}}>
                  {rows.map(({a, i}, k) => (
                    <div key={i} data-lg-alert-action={i} data-lg-ring="" role="button" aria-disabled={a.disabled || undefined} tabIndex={a.disabled ? -1 : 0}
                      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); choose(i); } }}
                      style={{position: 'absolute', left: INSET, top: INSET + k * (ROW + GAP), width: bw, height: ROW, '--lg-corner': '8.5px'} as React.CSSProperties}>
                      <div style={{position: 'absolute', inset: 0, opacity: pressed === i ? .4 : 1, transition: 'opacity .1s ease-in-out', background: ink.fill, ...capsuleFill(bw)}} />
                      <div style={{position: 'absolute', left: 8, right: 8, top: 14, height: 20.333, display: 'flex', justifyContent: 'center'}}>
                        <span style={{fontSize: 17, lineHeight: '20.333px', fontWeight: 500, whiteSpace: 'nowrap', color: a.disabled ? ink.off : a.role === 'destructive' ? ink.red : ink.label}}>{a.label}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Glass>
        </Dialog.Popup>
      </div>
    );
  }
}
