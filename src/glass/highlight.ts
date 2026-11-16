import {useRef, type PointerEvent as ReactPointerEvent} from 'react';
import {useGlassInvalidate} from './react';
import {frameLoop, frameNow} from './frame';

export interface PressHighlight {
  light: number;
  dark: number;
  tracks: (el: HTMLElement, x: number, y: number) => boolean;
  seconds?: number;
}

const SECONDS = .47;
const ease = (t: number) => {
  let u = t;
  for (let i = 0; i < 8; i++) { const x = .75 * (1 - u) * (1 - u) * u + .75 * (1 - u) * u * u + u * u * u - t, dx = .75 * (1 - u) * (1 - u) + 2.25 * u * u; u = Math.min(1, Math.max(0, u - x / (dx || 1))); }
  return .3 * (1 - u) * (1 - u) * u + 3 * (1 - u) * u * u + u * u * u;
};

export function localPoint(el: HTMLElement, x: number, y: number) {
  const r = el.getBoundingClientRect(), s = getComputedStyle(el), w = parseFloat(s.width) + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight), h = parseFloat(s.height) + parseFloat(s.paddingTop) + parseFloat(s.paddingBottom);
  return {x: (x - r.left) / (r.width / w || 1), y: (y - r.top) / (r.height / h || 1), w, h};
}

export function usePressHighlight(spec: PressHighlight, {targets, click = true, onHeld}: {targets?: (el: HTMLElement) => HTMLElement[]; click?: boolean; onHeld?: (held: boolean, scheme: string) => void} = {}) {
  const invalidate = useGlassInvalidate(), live = useRef<() => void>(null);
  return (e: ReactPointerEvent<HTMLElement>) => {
    const el = e.currentTarget, shown = targets?.(el) ?? [el];
    if (e.button !== 0) return;
    live.current?.();
    const scheme = (el.closest('.lg-glass') as HTMLElement | null)?.dataset.glassScheme ?? 'light';
    const pressed = scheme === 'dark' ? spec.dark : spec.light;
    let opacity = pressed, inside = true;
    const loop = frameLoop(el);
    const set = (v: number) => { opacity = v; for (const t of shown) t.style.opacity = v === 1 ? '' : String(v); invalidate(); };
    const seconds = spec.seconds ?? SECONDS;
    const animate = (held: boolean) => {
      const to = held ? pressed : 1;
      onHeld?.(held, scheme);
      if (seconds <= 0) { loop.stop(); set(to); return; }
      const from = opacity, start = frameNow();
      loop.start((now) => { const t = Math.min(1, (now - start) / 1000 / seconds); set(from + (to - from) * ease(t)); return t < 1; });
    };
    set(pressed); onHeld?.(true, scheme);
    const id = e.pointerId;
    const move = (ev: PointerEvent) => { if (ev.pointerId !== id) return; const now = spec.tracks(el, ev.clientX, ev.clientY); if (now !== inside) { inside = now; animate(inside); } };
    const stop = () => { removeEventListener('pointermove', move, true); removeEventListener('pointerup', end, true); removeEventListener('pointercancel', end, true); };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      stop();
      const hit = ev.type === 'pointerup' && spec.tracks(el, ev.clientX, ev.clientY);
      animate(false);
      if (hit && click) el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, clientX: ev.clientX, clientY: ev.clientY, detail: 1}));
      if (click && ev.type === 'pointerup') {
        let timer = 0;
        const done = () => { clearTimeout(timer); removeEventListener('click', drop, true); };
        const drop = (c: MouseEvent) => { if (c.isTrusted) { c.stopImmediatePropagation(); c.preventDefault(); done(); } };
        addEventListener('click', drop, true);
        timer = window.setTimeout(done, 500);
      }
      el.dataset.lgPressHit = hit ? '1' : '0';
    };
    live.current = () => { stop(); loop.stop(); set(1); onHeld?.(false, scheme); };
    addEventListener('pointermove', move, true); addEventListener('pointerup', end, true); addEventListener('pointercancel', end, true);
  };
}
