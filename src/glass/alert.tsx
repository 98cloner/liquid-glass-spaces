import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from 'react';
import {Dialog} from '@base-ui/react/dialog';
import {Glass, GlassLayer, useGlassPage, useGlassScheme, Vibrant} from './react';
import {addTicker, commit, frameNow, present} from './frame';
import {supercircleURL} from './supercircle';

/** A button of an `Alert` or a `ConfirmationDialog`. */
export interface AlertAction {
  /** Its title. */
  label: string;
  /** 'cancel' (Escape chooses it) or 'destructive' (red). */
  role?: 'cancel' | 'destructive';
  /** The default action: Return chooses it; drawn filled. */
  preferred?: boolean;
  /** Dimmed; it can't be chosen. */
  disabled?: boolean;
  /** Called when it is chosen; the alert then closes. */
  onSelect?: () => void;
}
/** A text field of an `Alert`. */
export interface AlertField {
  /** Its placeholder. */
  placeholder?: string;
  /** Its text. */
  value: string;
  /** Called as its text changes. */
  onChange?: (value: string) => void;
  /** A password field. */
  secure?: boolean;
}
/** Props of `Alert`. */
export interface AlertProps {
  /** Shown. */
  open: boolean;
  /** Called when it closes (an action chosen, or Escape with a cancel action). */
  onOpenChange?: (open: boolean) => void;
  /** Its title. */
  title: string;
  /** Text under the title. */
  message?: string;
  /** Its buttons (default a single OK). */
  actions?: AlertAction[];
  /** Text fields above the buttons. */
  fields?: AlertField[];
  /** The screen's safe area in CSS px, [top, right, bottom, left]: what it presents stays inside it. Default [62, 0, 34, 0], a phone in portrait. */
  safeArea?: [number, number, number, number];
}

const W = 320, CORNER = 34, PAD = 30, INSET = 16, GAP = 8, ROW = 48, FIT = 124, SLIDE = 15;
const FIELD = {top: 12, in: 15, row: 48, bottom: 4, radius: 24, text: 15, line: 1};
const RESPONSE = 2 * Math.PI / Math.sqrt(522.3503149568596), FROM = 1.2, PRESS = .4;
const DIM = {light: .2, dark: .48};
export const ALERT_INK = {light: {title: 'rgba(0, 0, 0, 1)', message: 'rgba(0, 0, 0, .55)', fill: 'rgba(0, 0, 0, .12)', label: '#000', red: 'rgb(255, 56, 60)', off: 'rgba(60, 60, 67, .3)', line: 'rgba(0, 0, 0, .25)', caret: 'rgb(0, 136, 255)'},
  dark: {title: 'rgba(255, 255, 255, .95)', message: 'rgba(255, 255, 255, .6)', fill: 'rgba(255, 255, 255, .11)', label: '#fff', red: 'rgb(255, 66, 69)', off: 'rgba(235, 235, 245, .3)', line: 'rgba(255, 255, 255, .15)', caret: 'rgb(0, 145, 255)'}};
const critical = (t: number) => { const w = 2 * Math.PI / RESPONSE; return t <= 0 ? 0 : 1 - (1 + w * t) * Math.exp(-w * t); };

/** A modal alert of glass at the screen's centre: a title, a message, optional text fields and buttons. Focus stays in it while open. */
export function Alert({open, onOpenChange, title, message, actions = [{label: 'OK'}], fields = [], safeArea = [62, 0, 34, 0]}: AlertProps) {
  const page = useGlassPage(), scheme = useGlassScheme(), ink = ALERT_INK[scheme];
  const [shown, setShown] = useState(false), [, poke] = useState(0);
  const [stacked, setStacked] = useState(false);
  const box = useRef<HTMLDivElement | null>(null), dim = useRef<HTMLDivElement | null>(null);
  const st = useRef({from: 0, to: 0, at: 0, scale: FROM, closing: false, off: () => {}, chosen: null as AlertAction | null}).current;
  useEffect(() => { poke((n) => n + 1); }, []);
  useEffect(() => () => st.off(), [st]);

  const order = actions.map((a, i) => ({a, i}));
  const cancel = order.filter((x) => x.a.role === 'cancel'), rest = order.filter((x) => x.a.role !== 'cancel');
  const side = actions.length === 2 && !stacked;
  const rows = side ? [...cancel, ...rest] : [...rest, ...cancel];

  const run = () => {
    st.off();
    st.off = addTicker((now) => {
      const t = (now - st.at) / 1000, p = critical(t), o = st.from + (st.to - st.from) * p, done = t > 1.2;
      const s = st.closing ? 1 : FROM + (1 - FROM) * p;
      present(box.current, {opacity: done && st.to === 1 ? undefined : o, scale: done || s === 1 ? undefined : [s, s]});
      present(dim.current, {opacity: done && st.to === 1 ? undefined : o});
      if (done && st.closing) { st.closing = false; commit(() => setShown(false)); const c = st.chosen; st.chosen = null; c?.onSelect?.(); }
      return !done;
    }, page);
  };
  useLayoutEffect(() => {
    if (open && (!shown || st.closing)) {
      if (!shown) { setShown(true); setStacked(false); }
      st.closing = false; st.from = 0; st.to = 1; st.at = frameNow(); run();
    } else if (!open && shown && !st.closing) {
      const now = frameNow(), t = (now - st.at) / 1000, o = st.from + (st.to - st.from) * critical(t);
      st.closing = true; st.from = o; st.to = 0; st.at = now; run();
    }
  });
  useLayoutEffect(() => {
    const font = page() ? getComputedStyle(page()!).fontFamily : '';
    if (shown && actions.length === 2 && !stacked && actions.some((a) => textWidth(a.label, font) > FIT)) setStacked(true);
  });

  const choose = (i: number) => { const a = actions[i]; if (!a || a.disabled) return; st.chosen = a; onOpenChange?.(false); };
  const {pressed, handlers} = useActionPress(box, actions, choose);
  const escape = () => { const c = actions.findIndex((a) => a.role === 'cancel'); if (c >= 0) choose(c); };
  useEffect(() => {
    if (!shown) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const f = (e.target as HTMLElement | null)?.closest?.('[data-lg-alert-field]') as HTMLElement | null, k = f ? Number(f.dataset.lgAlertField) : -1;
        if (k >= 0 && k < fields.length - 1) { e.preventDefault(); box.current?.querySelector<HTMLInputElement>(`[data-lg-alert-field="${k + 1}"] input`)?.focus(); return; }
        const p = actions.findIndex((a) => a.preferred && !a.disabled); if (p >= 0) choose(p);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const root = page();
  return (
    <Dialog.Root open={shown && !!root} modal="trap-focus" disablePointerDismissal
      onOpenChange={(o, d) => { if (!o && d.reason === 'escape-key') escape(); }}>
      {shown && root && <Dialog.Portal container={root}>{content(root)}</Dialog.Portal>}
    </Dialog.Root>
  );

  function content(root: HTMLElement) {
    const screenH = root.offsetHeight || 874, screenW = root.offsetWidth || 402;
    const lone = !message, font = getComputedStyle(root).fontFamily;
    const lines = message ? lineCount(message, font) : 0, headerH = message ? 49.67 + (lines === 1 ? 18 : lines * 19) + 4.33 : 21.67 + 20.33 + 4;
    const preferred = actions.findIndex((a) => a.preferred && !a.disabled && a.role !== 'destructive');
    const actionsH = INSET * 2 + (side ? ROW : rows.length * ROW + (rows.length - 1) * GAP);
    const fieldsTop = headerH + FIELD.top, bodyH = fields.length ? FIELD.top + fields.length * FIELD.row + FIELD.bottom : 0;
    const H = headerH + bodyH + actionsH, top = Math.round(((safeArea[0] + screenH - safeArea[2]) / 2 - H / 2) * 3) / 3;
    const bw = side ? (W - 2 * INSET - GAP) / 2 : W - 2 * INSET;
    const fill = capsuleFill;
    return (
      <div data-lg-alert-root="" style={{position: 'absolute', inset: 0}}>
        <GlassLayer ref={dim} data-lg-group="" style={{position: 'absolute', inset: 0, background: `rgba(0, 0, 0, ${DIM[scheme]})`}} />
        <Dialog.Popup ref={box} role="alertdialog" data-lg-group="" data-lg-popup="" {...handlers}
          initialFocus={() => box.current?.querySelector<HTMLElement>('[data-lg-alert-input]') ?? box.current}
          style={{position: 'absolute', left: (screenW - W) / 2, top, width: W, height: H, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none'}}>
          { }
          <Glass radius={CORNER} style={{position: 'absolute', inset: 0}}>
            { }
            <div style={{position: 'absolute', left: PAD, top: lone ? 21.67 : 22, width: W - 2 * PAD, display: 'flex', justifyContent: lone ? 'center' : 'flex-start'}}>
              <Dialog.Title render={<span />} style={{fontSize: 17, lineHeight: '20.333px', fontWeight: lone ? 400 : 600, textAlign: lone ? 'center' : 'start', color: ink.title}}>{title}</Dialog.Title>
            </div>
            {message && <Dialog.Description render={<div />} style={{position: 'absolute', left: PAD, top: 49.67, width: W - 2 * PAD, fontSize: 15, lineHeight: lines === 1 ? '18px' : '19px', color: ink.message}}>{message}</Dialog.Description>}
            {fields.length > 0 && <div style={{position: 'absolute', left: FIELD.in, top: fieldsTop, width: W - 2 * FIELD.in, height: fields.length * FIELD.row,
              background: ink.fill, ...fieldGroup(W - 2 * FIELD.in, fields.length * FIELD.row)}} />}
            {fields.map((f, k) => (
              <div key={k} data-lg-alert-field={k} style={{position: 'absolute', left: FIELD.in, top: fieldsTop + k * FIELD.row, width: W - 2 * FIELD.in, height: FIELD.row}}>
                {k < fields.length - 1 && <div style={{position: 'absolute', left: FIELD.text, right: FIELD.text, bottom: 0, height: FIELD.line, background: ink.line}} />}
                <input type={f.secure ? 'password' : 'text'} value={f.value} placeholder={f.placeholder} aria-label={f.placeholder} spellCheck={false} autoComplete="off"
                  onChange={(e) => f.onChange?.(e.target.value)} data-lg-alert-input=""
                  style={{position: 'absolute', left: FIELD.text, top: 7, width: W - 2 * FIELD.in - 2 * FIELD.text, height: 35, boxSizing: 'border-box', padding: '7.333px 0',
                    fontSize: 17, lineHeight: '20.333px', color: ink.label, caretColor: ink.caret,
                    ['--lg-alert-placeholder' as string]: ink.off, userSelect: 'text', WebkitUserSelect: 'text'}} />
              </div>
            ))}
            {rows.map(({a, i}, k) => (
              <div key={i} data-lg-alert-action={i} data-lg-ring="" role="button" aria-disabled={a.disabled || undefined} tabIndex={a.disabled ? -1 : 0}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); choose(i); } }}
                style={{position: 'absolute', left: INSET + (side ? k * (bw + GAP) : 0), top: headerH + bodyH + INSET + (side ? 0 : k * (ROW + GAP)), width: bw, height: ROW, '--lg-corner': '8.5px'} as CSSProperties}>
                <div style={{position: 'absolute', inset: 0, opacity: pressed === i ? PRESS : 1, transition: 'opacity .1s ease-in-out'}}>
                  {preferred === i ? <Vibrant tone="alert-preferred" style={{position: 'absolute', inset: 0, background: 'currentColor', ...fill(bw)}} />
                    : <div style={{position: 'absolute', inset: 0, background: ink.fill, ...fill(bw)}} />}
                </div>
                {
}
                <div data-lg-layer={preferred === i ? '1 1 0' : undefined} style={{position: 'absolute', left: 8, right: 8, top: 14, height: 20.333}}>
                  <span {...(preferred === i ? {drawable: '', 'data-lg-item': ''} : {})} style={{position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center'}}>
                    <span style={{fontSize: 17, lineHeight: '20.333px', textAlign: 'center', fontWeight: preferred === i ? 600 : 500, whiteSpace: 'nowrap',
                      color: a.disabled ? ink.off : preferred === i ? '#fff' : a.role === 'destructive' ? ink.red : ink.label}}>{a.label}</span>
                  </span>
                </div>
              </div>
            ))}
          </Glass>
        </Dialog.Popup>
      </div>
    );
  }
}

export function capsuleFill(w: number): CSSProperties {
  const u = supercircleURL(w, ROW, ROW / 2, window.devicePixelRatio || 1);
  return {WebkitMask: `url(${u}) 0 0 / 100% 100%`, mask: `url(${u}) 0 0 / 100% 100%`};
}

export function useActionPress(box: {current: HTMLElement | null}, actions: AlertAction[], choose: (i: number) => void) {
  const [pressed, setPressed] = useState<number | null>(null);
  const drag = useRef<{id: number; x: number; y: number; slid: boolean} | null>(null);
  const at = (x: number, y: number) => {
    const els = box.current?.querySelectorAll<HTMLElement>('[data-lg-alert-action]') ?? [];
    for (const el of els) { const r = el.getBoundingClientRect(); if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return Number(el.dataset.lgAlertAction); }
    return null;
  };
  const down = (e: React.PointerEvent<HTMLElement>) => {
    if (drag.current || e.button !== 0) return;
    const i = at(e.clientX, e.clientY);
    if (i === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {id: e.pointerId, x: e.clientX, y: e.clientY, slid: false};
    setPressed(actions[i]?.disabled ? null : i);
  };
  const up = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    if (e.type === 'lostpointercapture' && e.target !== e.currentTarget) return;
    drag.current = null;
    const i = e.type === 'pointerup' ? pressed : null;
    setPressed(null);
    if (i !== null) choose(i);
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) { up(e); return; }
    if (!d.slid && Math.hypot(e.clientX - d.x, e.clientY - d.y) < SLIDE) return;
    d.slid = true;
    const i = at(e.clientX, e.clientY);
    setPressed(i !== null && !actions[i]?.disabled ? i : null);
  };
  return {pressed, handlers: {onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up, onLostPointerCapture: up}};
}

function fieldGroup(w: number, h: number): CSSProperties {
  const u = supercircleURL(w, h, FIELD.radius, window.devicePixelRatio || 1);
  return {WebkitMask: `url(${u}) 0 0 / 100% 100%`, mask: `url(${u}) 0 0 / 100% 100%`};
}

let measure: HTMLDivElement | undefined;
const measurer = (style: Partial<CSSStyleDeclaration>) => {
  const el = measure ??= document.createElement('div');
  el.removeAttribute('style');
  Object.assign(el.style, {position: 'absolute', visibility: 'hidden', left: '-9999px', top: '0'}, style);
  if (!el.isConnected) document.body.appendChild(el);
  return el;
};
export function lineCount(text: string, fontFamily: string, width = W - 2 * PAD, size = 15, line = 19) {
  const el = measurer({width: `${width}px`, fontSize: `${size}px`, lineHeight: `${line}px`, fontFamily});
  el.textContent = text;
  return Math.max(1, Math.round(el.offsetHeight / line));
}
function textWidth(text: string, fontFamily: string) {
  const el = measurer({display: 'inline-block', whiteSpace: 'nowrap', fontSize: '17px', fontWeight: '500', fontFamily});
  el.textContent = text;
  return el.getBoundingClientRect().width;
}
