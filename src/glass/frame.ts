import {flushSync} from 'react-dom';


export const glassClock = () => (window as unknown as {__glassNow?: number}).__glassNow;
export const eventTime = (e: {timeStamp: number}) => (window as unknown as {__glassEventNow?: number}).__glassEventNow ?? glassClock() ?? e.timeStamp;
export const frameNow = () => (running ? current : glassClock() ?? performance.now());

export type Ticker = (now: number) => boolean;
export type FrameScope = Element | null | undefined | (() => Element | null | undefined);
const tickers = new Map<Ticker, FrameScope>(), painters = new Map<() => void, Element>();
let raf = 0, running = false, current = 0;
let wanted: Set<Element> | 'all' = new Set();
function want(scope: FrameScope) {
  if (wanted === 'all') return;
  const el = typeof scope === 'function' ? scope() : scope, canvas = el?.isConnected ? el.closest('canvas') : null;
  if (canvas) wanted.add(canvas); else wanted = 'all';
}
function schedule() { if (!raf) raf = requestAnimationFrame(frame); }

function frame() {
  raf = 0;
  const now = current = glassClock() ?? performance.now();
  running = true;
  try {
    for (const [t, scope] of [...tickers]) {
      if (!tickers.has(t)) continue;
      let again = false;
      try { again = t(now); } catch (e) { console.error('[glass] ticker failed', e); }
      if (!again) tickers.delete(t);
      want(scope);
    }
  } finally { running = false; }
  const w = wanted;
  wanted = new Set();
  for (const [p, canvas] of painters) if (w === 'all' || w.has(canvas)) p();
  if (tickers.size) schedule();
}

export function requestFrame(scope?: FrameScope) { want(scope); schedule(); }

export function addTicker(t: Ticker, scope?: FrameScope): () => void {
  tickers.set(t, scope); schedule();
  return () => { tickers.delete(t); };
}

export function addPainter(p: () => void, canvas: Element): () => void {
  painters.set(p, canvas);
  return () => { painters.delete(p); };
}

export function commit(fn: () => void) { if (running) flushSync(fn); else fn(); }

export function frameLoop(scope?: FrameScope) {
  let off = () => {};
  return {start(tick: Ticker) { off(); off = addTicker(tick, scope); }, stop() { off(); off = () => {}; }};
}

export interface Presentation { x?: number; y?: number; opacity?: number; blur?: number; glass?: number; materialize?: number; dematerialize?: number; scale?: [number, number] }
const values = new WeakMap<Element, Presentation>();

export function present(el: Element | null | undefined, p: Presentation) {
  if (!el) return;
  const was = values.get(el), v = {...was, ...p};
  for (const k of Object.keys(v) as (keyof Presentation)[]) if (v[k] === undefined) delete v[k];
  if (JSON.stringify(v) === JSON.stringify(was ?? {})) return;
  if (Object.keys(v).length) values.set(el, v); else values.delete(el);
  if (running) want(el); else requestFrame(el);
}

export const presentationOf = (el: Element): Presentation | undefined => values.get(el);

export function presentedGlass(el: Element, root: Element): {glass: number; materialize: number | null; dematerialize: number} {
  let glass = 1, materialize: number | null = null, dematerialize = 1;
  for (let e: Element | null = el; e && e !== root; e = e.parentElement) {
    const v = values.get(e);
    if (v?.glass !== undefined) glass *= v.glass;
    if (v?.dematerialize !== undefined) dematerialize *= v.dematerialize;
    if (v?.materialize !== undefined) materialize = (materialize ?? 1) * v.materialize;
  }
  return {glass, materialize, dematerialize};
}

export function presentedOffset(el: Element, root: Element): [number, number] {
  let x = 0, y = 0;
  for (let e: Element | null = el; e && e !== root; e = e.parentElement) {
    const v = values.get(e);
    if (v) { x += v.x ?? 0; y += v.y ?? 0; }
  }
  return [x, y];
}
