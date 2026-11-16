import {Children, cloneElement, createContext, isValidElement, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type Ref} from 'react';
import {GlassLayer, NamedIcon, useFrameScope, useGlassMotion, useGlassScheme} from './react';
import {layoutBox} from './renderer';
import {addTicker, commit, frameNow, present} from './frame';
import {ScrollView, type ScrollEdgeEffect} from './scrollView';
import {TopBar, Toolbar, ToolbarGroup, ToolbarItem} from './toolbar';
import {SearchBar, SearchField, type SearchBarProps} from './search';
import {hostsOf, Pulse, TOOLBAR_MORPH} from './morph';
import {TabBarVisibility} from './tabView';

interface NavItem { title?: string; trailing?: ReactNode; toolbar?: ReactNode; pocket: string; titles?: Titles; tabBar?: 'visible' | 'hidden' }
type Titles = {inline: number; large: number; collapsed: boolean; height: number};

function createStore() {
  const items = new Map<number, NavItem>(), listeners = new Set<() => void>();
  let version = 0;
  const notify = () => { version++; listeners.forEach((l) => l()); };
  return {
    items,
    set(i: number, item: NavItem) { items.set(i, item); notify(); },
    delete(i: number) { items.delete(i); notify(); },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    version: () => version,
  };
}
type Store = ReturnType<typeof createStore>;
const PageCtx = createContext<{store: Store; index: number} | null>(null);

const PAGE = {response: .3, velocity: 8.77298168985721, parallax: .3, dim: .1, corner: 62};
const BARS = {response: .416, incoming: .04, blur: 10, removal: 1.45};
const SHARED = {response: .416, damping: .75, delay: .078, pulse: {...TOOLBAR_MORPH.pulse, heightDelay: .145, widthDelay: .175, maxPoints: Infinity}};
const TOOLBAR = {response: .416, damping: .75, onset: {push: .025, pop: .023}, blur: 10, scale: 1.2, cap: 16, edges: {push: .05, pop: 0}, swipeIn: .07};
const critical = (response: number, t: number, v = 0) => { const w = 2 * Math.PI / response; return t <= 0 ? 0 : 1 - (1 + (w - v) * t) * Math.exp(-w * t); };
const underdamped = (response: number, damping: number, t: number) => {
  const w = 2 * Math.PI / response, a = damping * w, wd = w * Math.sqrt(1 - damping * damping);
  if (t <= 0) return {value: 0, envelope: 1};
  return {value: 1 - Math.exp(-a * t) * (Math.cos(wd * t) + a / wd * Math.sin(wd * t)), envelope: Math.exp(-a * t) * (1 + a / wd)};
};

type Transition = {op: 'push' | 'pop'; under: number; top: number; popped: ReactNode[]; poppedKeys: string[]; keys: {top: string; under: string}; t0: number | null; swipe?: Swipe};

const PAGE_SPRING = {response: PAGE.response, damping: 1}, BARS_SPRING = {response: BARS.response, damping: 1}, GHOST = {response: .35, damping: 1, opacity: .9};
const pageSettled = (s: Spring, now: number, span: number) => {
  const {value, velocity} = s.sample(now), w = 2 * Math.PI / PAGE.response;
  return ((s.target - value) / span) ** 2 + (2 * velocity / (w * span)) ** 2 <= 1e-6;
};
type Motion = {cards: Map<string, Spring>; dim: Spring | null; bars: Map<string, {o: Spring; mode: 'materialize' | 'dematerialize'; at: number}>; titles: Map<string, Spring>;
  shared: {out: string; inc: string; m: number; x: number; tb: number} | null};
type Ghost = {key: string; index: number; node: ReactNode; top: boolean};

const CONTROL = 'button, input, select, textarea, a[href], [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [role="slider"], '
  + '[role="switch"], [role="checkbox"], [role="radio"], [role="radiogroup"], [role="tab"], [role="menuitem"], [role="spinbutton"], [role="combobox"], [role="textbox"], '
  + '[role="group"]:has(> * > input[type="range"])';
export function inControl(target: EventTarget | null) {
  const c = target instanceof Element ? target.closest(CONTROL) : null;
  return !!c && !c.matches(':disabled') && c.getAttribute('aria-disabled') !== 'true';
}
function inPanX(target: EventTarget | null, root: Element) {
  for (let e = target instanceof Element ? target : null; e && e !== root; e = e.parentElement) {
    if (e.hasAttribute('data-lg-pan-x')) return true;
    if (e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX)) return true;
  }
  return false;
}

const SWIPE = {hysteresis: 30, rubber: {extent: .5, coefficient: .55}, track: {response: .08, damping: .85}, release: {response: .3, damping: .85},
  duration: .35, threshold: 187.5, flickBoost: 4.25, flickThreshold: 1.5};
type Swipe = {u: number; released: {target: 0 | 1; velocity: number} | null};
function rubberBand(u: number) {
  const {extent: E, coefficient: k} = SWIPE.rubber;
  return u < 0 ? -E * (1 - 1 / (1 + k * -u / E)) : u > 1 ? 1 + E * (1 - 1 / (1 + k * (u - 1) / E)) : u;
}
function swipeStats() {
  let n = 0, prevT = 0, skipT = 0, prevD = 0, prevV = 0, prevA = 0, avgV = 0, avgA = 0, flick = true;
  const vs = [0, 0, 0], as = [0, 0, 0];
  return {
    sample(t: number, d: number, v: number, first: boolean) {
      if (first) { prevT = skipT = t; prevD = d; prevV = v; prevA = 0; avgV = v; avgA = 0; vs[0] = v; as[0] = 0; n = 1; flick = true; return; }
      const sinceSkip = t - skipT; skipT = t;
      if (sinceSkip < .01 && (sinceSkip <= .001 || prevD === d)) return;
      const dt = t - prevT, i = n % 3;
      avgV = n <= 2 ? (v + avgV * n) / (n + 1) : (v + 3 * avgV - vs[i]) / 3; vs[i] = v;
      if (flick && Math.abs(avgV) < SWIPE.flickThreshold) flick = false;
      let a = dt > 0 ? (v - prevV) / dt : prevA;
      if (Math.abs(a - prevA) > 5) a = prevA + (a > prevA ? 5 : -5);
      avgA = n <= 2 ? (a + avgA * n) / (n + 1) : (a + 3 * avgA - as[i]) / 3; as[i] = a;
      prevA = a; prevV = v; prevD = d; prevT = t; n++;
    },
    decide(p: number, vx: number, W: number) {
      let pop: boolean, v: number;
      if (n >= 3) { pop = p + avgV * SWIPE.duration + .5 * avgA * SWIPE.duration ** 2 > Math.min(SWIPE.threshold / W, .5); v = prevV; }
      else { pop = avgV > 0; v = vx; }
      return {pop, velocity: flick ? v * SWIPE.flickBoost : v};
    },
  };
}

const NavCtx = createContext<{path: unknown[]; set: (path: unknown[]) => void} | null>(null);
/** The enclosing `<NavigationStack>`'s path, with `push(value)` and `pop()`. */
export function useNavigation<T = unknown>() {
  const n = useContext(NavCtx);
  if (!n) throw new Error('useNavigation() must be inside a <NavigationStack>');
  return {path: n.path as T[], push: (value: T) => n.set([...n.path, value]), pop: () => n.set(n.path.slice(0, -1)), setPath: n.set as (path: T[]) => void};
}

/** A stack of pages under a top bar: `children` the root page, `path` the values pushed on it, each page `destination(value)`. Pushing or popping one page slides it in or out; the bar's back button pops. Without `path` it keeps its own (from `defaultPath`). */
export function NavigationStack<T>({path: given, defaultPath, onPathChange: changed, destination = () => null, children}: {path?: T[]; defaultPath?: T[]; onPathChange?: (path: T[]) => void;
  destination?: (value: T, index: number) => ReactNode; children: ReactNode}) {
  const [own, setOwn] = useState<T[]>(defaultPath ?? []), path = given ?? own;
  const onPathChange = (p: T[]) => { if (given === undefined) setOwn(p); changed?.(p); };
  const [store] = useState(createStore);
  const depth = path.length, pages = [children, ...path.map(destination)];
  const last = useRef({depth, pages}), [trans, setTrans] = useState<Transition | null>(null), swiped = useRef(false);
  const [barKey, setBarKey] = useState(0), [barSwapped, setBarSwapped] = useState(false);
  const keys = useRef<string[]>([]), gen = useRef(0);
  for (let i = 0; i <= last.current.depth; i++) keys.current[i] ??= String(i);
  let t = trans, poppedKeys: string[] = [];
  if (last.current.depth !== depth) {
    const from = last.current.depth;
    if (depth > from) for (let i = from + 1; i <= depth; i++) keys.current[i] = `${i}.${++gen.current}`;
    else { poppedKeys = keys.current.slice(depth + 1); keys.current.length = depth + 1; }
  }
  if (last.current.depth !== depth && swiped.current) { swiped.current = false; last.current = {depth, pages}; t = null; }
  else if (last.current.depth !== depth) {
    const from = last.current.depth, push = depth > from;
    t = Math.abs(from - depth) === 1 ? {op: push ? 'push' : 'pop', under: Math.min(from, depth), top: Math.max(from, depth), popped: push ? [] : last.current.pages.slice(depth + 1),
      poppedKeys, keys: push ? {top: keys.current[depth], under: keys.current[from]} : {top: poppedKeys[0], under: keys.current[depth]}, t0: null} : null;
    last.current = {depth, pages};
    setTrans(t);
  } else last.current = {depth, pages};
  const shown = t?.op === 'pop' ? [...pages, ...t.popped] : pages;
  const root = useRef<HTMLDivElement>(null), scheme = useGlassScheme(), scope = useFrameScope(), motionOf = useGlassMotion();
  const pop = useRef(() => {}); pop.current = () => { swiped.current = true; onPathChange(path.slice(0, -1)); };
  const motion = useRef<Motion>({cards: new Map(), dim: null, bars: new Map(), titles: new Map(), shared: null});
  const [ghosts, setGhosts] = useState<Ghost[]>([]), ghostsRef = useRef(ghosts); ghostsRef.current = ghosts;
  const [ghostStore] = useState(createStore), ghostFade = useRef(new Map<string, Spring>());
  const rendered = useRef(new Map<string, {node: ReactNode; index: number}>()), prevT = useRef<Transition | null>(null);
  if (t !== prevT.current) {
    const p = prevT.current, pair = t ? [t.keys.top, t.keys.under] : [];
    prevT.current = t;
    if (p && t) {
      const add = [p.keys.top, p.keys.under].filter((k) => !pair.includes(k) && rendered.current.has(k)).map((k) => ({key: k, top: k === p.keys.top, ...rendered.current.get(k)!}));
      if (add.length || ghosts.some((g) => pair.includes(g.key))) setGhosts((gs) => [...gs.filter((g) => !pair.includes(g.key) && !add.some((a) => a.key === g.key)), ...add]);
    }
  }
  const lingering = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => lingering.current?.(), []);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || depth < 1) return;
    let g: {id: number; x0: number; y0: number; target: EventTarget | null; swipe: Swipe | null; stats: ReturnType<typeof swipeStats>; pts: [number, number][]} | null = null;
    const local = (e: PointerEvent) => { const r = el.getBoundingClientRect(), k = r.width / el.clientWidth || 1; return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]; };
    const W = () => el.clientWidth;
    let cancelling = false;
    const velocity = () => { const pts = g!.pts, b = pts[pts.length - 1]; let a = pts[0]; for (const p of pts) if (b[0] - p[0] <= 50) { a = p; break; } return b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) * 1000 : 0; };
    const onDown = (e: PointerEvent) => {
      if (g || e.button !== 0 || !e.isPrimary) return;
      if (inControl(e.target) || inPanX(e.target, el)) return;
      const [x, y] = local(e);
      g = {id: e.pointerId, x0: x, y0: y, target: e.target, swipe: null, stats: swipeStats(), pts: [[e.timeStamp, x]]};
    };
    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      if (e.pointerType === 'mouse' && e.buttons === 0) { onUp(e); return; }
      const [x, y] = local(e), tx = x - g.x0, ty = y - g.y0, H = SWIPE.hysteresis;
      g.pts.push([e.timeStamp, x]); if (g.pts.length > 12) g.pts.shift();
      if (!g.swipe) {
        if (Math.abs(ty) >= Math.min(25, 10 + (H - 10) / 25 * Math.abs(tx)) || tx <= -H) { g = null; return; }
        if (tx < H) return;
        cancelling = true;
        g.target?.dispatchEvent(new PointerEvent('pointercancel', {bubbles: true, pointerId: g.id, pointerType: e.pointerType, isPrimary: true}));
        cancelling = false;
        try { el.setPointerCapture(g.id); } catch { }
        const drop = (c: MouseEvent) => { c.stopImmediatePropagation(); c.preventDefault(); };
        el.addEventListener('click', drop, {capture: true, once: true}); setTimeout(() => el.removeEventListener('click', drop, {capture: true}), 600);
        g.swipe = {u: 0, released: null};
        g.stats.sample(e.timeStamp / 1000, 0, velocity() / W(), true);
        setTrans({op: 'pop', under: depth - 1, top: depth, popped: [], poppedKeys: [], keys: {top: keys.current[depth], under: keys.current[depth - 1]}, t0: null, swipe: g.swipe});
        return;
      }
      const tr = Math.sign(tx) * Math.max(Math.abs(tx) - H, 0), u = tr / W();
      g.swipe.u = u;
      g.stats.sample(e.timeStamp / 1000, Math.max(0, tr) / W(), velocity() / W(), false);
    };
    const onUp = (e: PointerEvent) => {
      if (!g || cancelling || e.pointerId !== g.id) return;
      if (e.type === 'lostpointercapture' && e.target !== el) return;
      const s = g.swipe;
      if (s) {
        const cancelled = e.type === 'pointercancel', d = cancelled ? {pop: false, velocity: 0} : g.stats.decide(rubberBand(s.u), velocity() / W(), W());
        s.released = {target: d.pop ? 1 : 0, velocity: d.velocity};
      }
      g = null;
    };
    const noDrag = (e: DragEvent) => e.preventDefault();
    el.addEventListener('dragstart', noDrag, true);
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('pointerup', onUp, true);
    el.addEventListener('pointercancel', onUp, true);
    el.addEventListener('lostpointercapture', onUp, true);
    return () => { el.removeEventListener('lostpointercapture', onUp, true); el.removeEventListener('dragstart', noDrag, true); el.removeEventListener('pointerdown', onDown, true); el.removeEventListener('pointermove', onMove, true); el.removeEventListener('pointerup', onUp, true); el.removeEventListener('pointercancel', onUp, true); };
  }, [depth]);
  useLayoutEffect(() => {
    const M = motion.current, ghosted = (k: string) => ghostsRef.current.some((g) => g.key === k);
    if (!t || !root.current) {
      for (const k of [...M.cards.keys()]) if (!ghosted(k)) M.cards.delete(k);
      M.dim = null; M.bars.clear(); M.titles.clear(); M.shared = null;
      return;
    }
    lingering.current?.();
    const el = root.current, W = el.clientWidth, P = Math.round(PAGE.parallax * W), dpr = devicePixelRatio || 1, px = (v: number) => Math.round(v * dpr) / dpr;
    const q = (s: string) => el.querySelector<HTMLElement>(s);
    const page = (i: number) => q(`:scope > [data-lg-nav-page="${i}"]`), bars = (i: number) => q(`:scope > [data-lg-bars-depth="${i}"]`);
    const title = (i: number) => bars(i)?.querySelector<HTMLElement>('[data-lg-inline-title]');
    const titleGroup = (i: number) => bars(i)?.querySelector<HTMLElement>('[data-lg-nav-title]'), slot = () => q(':scope > [data-lg-nav-toolbar]');
    const hasBar = (i: number) => store.items.get(i)?.toolbar != null;
    const edge = (i: number) => bars(i)?.querySelector<HTMLElement>('[data-lg-edge="top"]');
    const layerOf = (h: HTMLElement, o: number | null) => { if (o === null) delete h.dataset.lgLayer; else h.dataset.lgLayer = `${o} 1 ${BARS.blur * (1 - o)}`; };
    const contentOf = (g: HTMLElement, o: number | null) => { for (const h of hostsOf(g)) layerOf(h, o); };
    const platters = (i: number) => [...edge(i)?.querySelectorAll<HTMLElement>('.lg-glass') ?? []];
    const content = (i: number, o: number | null) => { for (const g of platters(i)) contentOf(g, o); };
    const incoming = t.op === 'push' ? t.top : t.under, outgoing = t.op === 'push' ? t.under : t.top;
    type Box = {cx: number; cy: number; w: number; h: number};
    type Pair = {go: HTMLElement; gi: HTMLElement; same: boolean; pulse: Pulse; kept: Map<HTMLElement, HTMLElement>};
    type Shared = {m: number; t: number | null; x: number};
    const boxOf = (g: HTMLElement): Box => { const r = layoutBox(g, el); return {cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h}; };
    let match: {pairs: Pair[]; out: HTMLElement[]; inc: HTMLElement[]} | null = null;
    const bySlot = (i: number) => {
      const m = new Map<string, HTMLElement>();
      for (const side of edge(i)?.querySelectorAll<HTMLElement>('[data-lg-slot]') ?? []) {
        const gs = [...side.querySelectorAll<HTMLElement>('.lg-glass')];
        (side.dataset.lgSlot === 'trailing' ? gs.reverse() : gs).forEach((g, k) => m.set(`${side.dataset.lgSlot} ${k}`, g));
      }
      return m;
    };
    const matched = () => {
      if (match || !edge(incoming) || !edge(outgoing)) return match;
      const o = bySlot(outgoing), n = bySlot(incoming), pairs: Pair[] = [];
      for (const [k, go] of o) {
        const gi = n.get(k), back = (g: HTMLElement) => g.dataset.lgNavBack !== undefined;
        if (!gi || back(go) !== back(gi)) continue;
        const pulse = new Pulse(SHARED.pulse);
        pulse.trigger(0);
        const kept = new Map<HTMLElement, HTMLElement>(), taken = new Set<HTMLElement>();
        for (const h of hostsOf(go)) {
          const id = h.dataset.lgItemId, twin = id ? hostsOf(gi).find((t) => t.dataset.lgItemId === id && !taken.has(t)) : undefined;
          if (twin) { taken.add(twin); kept.set(h, twin); }
        }
        pairs.push({go, gi, same: back(go), pulse, kept});
      }
      const paired = new Set(pairs.flatMap((p) => [p.go, p.gi]));
      match = {pairs, out: platters(outgoing).filter((g) => !paired.has(g)), inc: platters(incoming).filter((g) => !paired.has(g))};
      return match;
    };
    const carry = (p: Pair, st: Shared | null) => {
      const go = motionOf(p.go), gi = motionOf(p.gi);
      if (!go || !gi) return;
      if (st === null) {
        for (const mo of [go, gi]) { mo.translation = [0, 0]; mo.shape = 1; mo.scale = [1, 1]; }
        for (const h of [...hostsOf(p.go), ...hostsOf(p.gi)]) h.style.translate = '';
        return;
      }
      const from = boxOf(p.go), to = boxOf(p.gi);
      const offset = (h: HTMLElement, b: Box) => { const r = layoutBox(h, el); return r.x + r.w / 2 - (b.cx - b.w / 2); };
      const dx = (h: HTMLElement) => { const twin = p.kept.get(h); return twin ? offset(twin, to) - offset(h, from) : 0; };
      const {m} = st, cx = from.cx + (to.cx - from.cx) * m, cy = from.cy + (to.cy - from.cy) * m, w = from.w + (to.w - from.w) * m, h = from.h + (to.h - from.h) * m;
      const scale: [number, number] = st.t === null ? [1, 1] : p.pulse.scale(st.t, [w, h]);
      go.translation = [cx - from.cx, cy - from.cy]; go.shape = [w / from.w, h / from.h]; go.scale = scale;
      gi.translation = [cx - to.cx, cy - to.cy]; gi.shape = 1; gi.scale = scale;
      for (const [g, own] of [[p.go, from], [p.gi, to]] as const) for (const hh of hostsOf(g)) hh.style.translate = `${(own.w - w) / 2 + dx(hh) * m}px 0`;
    };
    const crossing = (s: number) => critical(BARS.response, s - SHARED.delay);
    const sharedAt = (s: number, m0 = 0, x0 = 0): Shared => ({m: m0 + (1 - m0) * underdamped(SHARED.response, SHARED.damping, s - SHARED.delay).value, t: s, x: x0 + (1 - x0) * crossing(s)});
    const pairsSettled = (s: number) => !match?.pairs.length || (underdamped(SHARED.response, SHARED.damping, s - SHARED.delay).envelope < 1e-3 && 1 - crossing(s) < 1e-3 && match.pairs.every((p) => p.same || p.pulse.settled));
    const barAt = (v: number | null) => {
      const tb = slot(), o = v === null ? 1 : Math.max(0, Math.min(1, v));
      for (const pe of tb?.querySelectorAll<HTMLElement>('[data-lg-piece]') ?? []) {
        const r = v === null ? 0 : 1 - v, s0 = (n: number) => Math.min(TOOLBAR.scale, 1 + TOOLBAR.cap / Math.max(n, 1e-3)), blur = Math.max(0, TOOLBAR.blur * r);
        present(pe, {scale: v === null ? undefined : [1 + (s0(pe.offsetWidth) - 1) * r, 1 + (s0(pe.offsetHeight) - 1) * r], glass: v === null ? undefined : o});
        for (const g of pe.querySelectorAll<HTMLElement>('.lg-glass')) for (const h of hostsOf(g)) {
          if (v === null) delete h.dataset.lgLayer; else h.dataset.lgLayer = `${o} 1 ${blur}`;
        }
      }
    };
    const topEdges = (switched: boolean | null) => {
      const e = edge(outgoing);
      if (!e) return;
      if (switched) e.dataset.lgEdgePockets = ''; else delete e.dataset.lgEdgePockets;
    };
    const from = (on: boolean) => {
      const id = (i: number) => bars(i)?.dataset.lgBars, host = el.querySelector<HTMLElement>(`[data-lg-pocket-id="${CSS.escape(id(incoming) ?? '')}"]`);
      if (!host) return;
      if (on && id(outgoing)) host.dataset.lgPocketFrom = id(outgoing); else delete host.dataset.lgPocketFrom;
    };
    const edges = (on: boolean | null) => {
      const pockets = [t.top, t.under].map((i) => bars(i)?.dataset.lgBars).filter(Boolean).join(' '), tb = slot();
      if (!tb) return;
      if (on === null) delete tb.dataset.lgEdgePockets; else tb.dataset.lgEdgePockets = on ? pockets : '';
    };
    const inKey = t.op === 'push' ? t.keys.top : t.keys.under, outKey = t.op === 'push' ? t.keys.under : t.keys.top;
    const sw = t.swipe, now0 = frameNow();
    const role = (top: boolean) => t.op === 'push' ? (top ? {from: W, to: 0, span: -W} : {from: 0, to: -P, span: -P}) : (top ? {from: 0, to: W, span: W} : {from: -P, to: 0, span: P});
    const topS = M.cards.get(t.keys.top) ?? new Spring(role(true).from), underS = M.cards.get(t.keys.under) ?? new Spring(role(false).from);
    const dimTo = t.op === 'push' ? 1 : 0, saved = M.dim ? M.dim.sample(now0).value : 1 - dimTo, dimS = new Spring(saved);
    const outB = (!sw && M.bars.get(outKey)) || {o: new Spring(1), mode: 'dematerialize' as const, at: -Infinity};
    const inKept = sw ? undefined : M.bars.get(inKey), inB = inKept ?? {o: new Spring(0), mode: 'materialize' as const, at: Infinity};
    const outT = (!sw && M.titles.get(outKey)) || new Spring(1), inT = (!sw && M.titles.get(inKey)) || new Spring(0);
    const rev = !sw && M.shared && M.shared.out === inKey && M.shared.inc === outKey ? M.shared : null;
    const tb0 = rev ? 1 - rev.tb : 0, m0 = rev ? 1 - rev.m : 0, x0 = rev ? 1 - rev.x : 0;
    const track = new Spring(0);
    let trackV: number | undefined;
    if (sw && M.cards.has(t.keys.top)) { const c = M.cards.get(t.keys.top)!.sample(now0); track.set(c.value / W); trackV = c.velocity / W; }
    for (const k of [...M.cards.keys()]) if (!ghosted(k)) M.cards.delete(k);
    M.dim = null; M.bars.clear(); M.titles.clear(); M.shared = null;
    if (!sw) {
      M.cards.set(t.keys.top, topS); M.cards.set(t.keys.under, underS); M.dim = dimS;
      M.bars.set(outKey, outB); M.bars.set(inKey, inB); M.titles.set(outKey, outT); M.titles.set(inKey, inT);
    }
    let start: number | null = null, lastTb = tb0, lastSh: Shared = {m: m0, t: null, x: x0};
    const register = (now: number) => {
      start = now;
      for (const [s, r] of [[topS, role(true)], [underS, role(false)]] as const) s.to(r.to, PAGE_SPRING, now, s.sample(now).velocity + PAGE.velocity * r.span);
      dimS.to(dimTo, PAGE_SPRING, now, PAGE.velocity * (dimTo - saved));
      outB.o.to(0, BARS_SPRING, now); outT.to(0, BARS_SPRING, now); inT.to(1, BARS_SPRING, now);
      inB.at = inKept ? now : now + BARS.incoming * 1000; inB.o.to(1, BARS_SPRING, inB.at);
    };
    const place = (top: number, under: number, dim: number, bo: number, bi: number | null, to: number | undefined, ti: number | undefined, sh: Shared | null) => {
      present(page(t.top), {x: px(top)});
      present(page(t.under), {x: under});
      present(q(':scope > [data-lg-nav-dim]'), {opacity: dim});
      present(titleGroup(incoming), {opacity: ti}); present(titleGroup(outgoing), {opacity: to});
      for (const i of [t.top, t.under]) { const g = titleGroup(i); if (g) g.toggleAttribute('data-lg-below-card', i === t.under); }
      const mt = matched();
      for (const g of mt?.out ?? platters(outgoing)) { present(g, outB.mode === 'dematerialize' ? {dematerialize: bo} : {dematerialize: undefined, materialize: bo}); contentOf(g, bo); }
      for (const g of mt?.inc ?? []) {
        present(g, bi === null ? {dematerialize: 0, materialize: undefined} : inB.mode === 'materialize' ? {dematerialize: undefined, materialize: bi} : {dematerialize: bi, materialize: undefined});
        contentOf(g, bi ?? 0);
      }
      for (const p of mt?.pairs ?? []) {
        present(p.gi, {glass: 0});
        if (p.same) { contentOf(p.go, null); contentOf(p.gi, 0); continue; }
        carry(p, sh ?? {m: 0, t: null, x: 0}); present(p.go, {}); present(p.gi, {});
        const x = sh?.x ?? 0, twins = new Set(p.kept.values());
        for (const h of hostsOf(p.go)) layerOf(h, p.kept.has(h) ? null : 1 - x);
        for (const h of hostsOf(p.gi)) layerOf(h, twins.has(h) ? 0 : x);
      }
      present(title(t.top), {x: top});
      present(title(t.under), {x: under * PAGE.parallax * W / P});
    };
    const pose = (now: number) => {
      const s = (now - (start ?? now)) / 1000, bi = now < inB.at ? null : inB.o.sample(now).value, bo = outB.o.sample(now).value;
      const to = outT.sample(now).value, ti = inT.sample(now).value;
      const {value: tbv, envelope} = underdamped(TOOLBAR.response, TOOLBAR.damping, s - TOOLBAR.onset[t.op]), tb = lastTb = tb0 + (1 - tb0) * tbv;
      place(topS.sample(now).value, underS.sample(now).value, dimS.sample(now).value, bo, bi, to, ti, lastSh = sharedAt(s, m0, x0)); from(true); topEdges(true);
      const both = hasBar(incoming) && hasBar(outgoing);
      if (!both) { barAt(hasBar(incoming) ? tb : 1 - tb); faded = true; } else if (faded) { barAt(null); faded = false; }
      edges(s >= TOOLBAR.edges[t.op] ? hasBar(incoming) : hasBar(outgoing));
      return pageSettled(topS, now, W) && pageSettled(underS, now, P) && Math.abs(bo) < 1e-3 && bi !== null && 1 - bi < 1e-3 && Math.abs(to) < 1e-3 && 1 - ti < 1e-3
        && envelope < 1e-3 && pairsSettled(s);
    };
    let faded = false;
    let ended = false;
    let released: number | null = null, origin: number | null = null, began: number | null = null, restoring: {at: number; from: number} | null = null, tb = 0;
    let lastQ = 0, heldM: number | null = null;
    let barIn: number | null = null;
    const swipePose = (now: number): 'pop' | 'cancel' | null => {
      if (!sw) return null;
      began ??= now;
      if (sw.released && released === null) { released = now; origin = now; track.to(sw.released.target, SWIPE.release, now, sw.released.velocity); }
      else if (released === null && track.target !== rubberBand(sw.u)) { track.to(rubberBand(sw.u), SWIPE.track, now, trackV); trackV = undefined; }
      const {value: q, settled} = track.sample(now), popping = released !== null && sw.released!.target === 1;
      const r = popping ? (now - released!) / 1000 : 0, a = critical(BARS.response, r), ai = popping && r >= BARS.incoming ? critical(BARS.response, r - BARS.incoming) : null;
      let tbSettled: boolean;
      if (!restoring) { const h = underdamped(TOOLBAR.response, TOOLBAR.damping, (now - began) / 1000 - TOOLBAR.onset.pop); tb = h.value; tbSettled = h.envelope < 1e-3; }
      else { const h = underdamped(TOOLBAR.response, TOOLBAR.damping, (now - restoring.at) / 1000); tb = restoring.from * (1 - h.value); tbSettled = h.envelope < 1e-3; }
      if (popping && heldM === null) heldM = Math.max(0, lastQ) / 2;
      lastQ = q;
      place(W * q, -P * (1 - q), 1 - q, popping ? 1 - a : 1, ai, undefined, undefined, popping ? sharedAt(r, heldM!) : {m: Math.max(0, q) / 2, t: null, x: 0}); topEdges(popping);
      if (popping && barIn === null && hasBar(incoming)) { barIn = released!; commit(() => { setBarKey((n) => n + 1); setBarSwapped(true); }); }
      const inBar = barIn === null ? null : underdamped(TOOLBAR.response, TOOLBAR.damping, (now - barIn) / 1000 - TOOLBAR.swipeIn);
      barAt(inBar ? inBar.value : 1 - tb); edges(restoring ? null : inBar !== null);
      if (released === null || !settled) return null;
      if (popping) return 1 - a < 1e-3 && ai !== null && 1 - ai < 1e-3 && tbSettled && (!inBar || inBar.envelope < 1e-3) && pairsSettled(r) ? 'pop' : null;
      if (!restoring) { restoring = {at: now, from: tb}; return null; }
      return tbSettled ? 'cancel' : null;
    };
    const reset = () => {
      for (const i of [t.top, t.under]) {
        present(page(i), {x: undefined}); present(title(i), {x: undefined}); present(titleGroup(i), {opacity: undefined}); titleGroup(i)?.removeAttribute('data-lg-below-card'); barAt(null); edges(null); from(false); topEdges(null);
        for (const g of platters(i)) present(g, {dematerialize: undefined, materialize: undefined, glass: undefined});
        content(i, null);
      }
      for (const p of match?.pairs ?? []) carry(p, null);
    };
    if (sw) { const q0 = track.target; place(W * q0, -P * (1 - q0), 1 - q0, 1, null, undefined, undefined, {m: 0, t: null, x: 0}); barAt(1); edges(false); } else pose(now0);
    const remove = addTicker((now) => {
      if (!sw && start === null) register(now);
      if (!sw) origin = start;
      const end = sw ? swipePose(now) : null;
      if (sw ? !end : !pose(now)) return true;
      ended = true; reset();
      for (const k of [t.keys.top, t.keys.under]) M.cards.delete(k);
      M.dim = null; M.bars.clear(); M.titles.clear(); M.shared = null;
      const own = match?.inc ?? platters(incoming), until = origin === null ? 0 : origin + BARS.removal * 1000;
      if (own.length && (!sw || end === 'pop') && inB.mode === 'materialize' && now < until) {
        const set = (v: number | undefined) => { for (const g of own) present(g, {materialize: v}); };
        set(1);
        const off = addTicker((n) => { if (n < until) return true; set(undefined); lingering.current = null; return false; }, scope);
        lingering.current = () => { off(); set(undefined); lingering.current = null; };
      }
      commit(() => { setTrans(null); setBarSwapped(false); if (end === 'pop') pop.current(); });
      return false;
    }, scope);
    const handOver = () => {
      const now = frameNow();
      if (sw) {
        const c = track.sample(now), from = (x: number, v: number) => { const s = new Spring(x); s.to(x, PAGE_SPRING, now, v); return s; };
        M.cards.set(t.keys.top, from(W * c.value, W * c.velocity)); M.cards.set(t.keys.under, from(-P * (1 - c.value), P * c.velocity)); M.dim = new Spring(1 - c.value);
      } else M.shared = {out: outKey, inc: inKey, m: lastSh.m, x: lastSh.x, tb: lastTb};
    };
    return () => { remove(); if (!ended) { handOver(); reset(); } else for (const p of match?.pairs ?? []) carry(p, null); };
  }, [t]);
  useLayoutEffect(() => {
    const el = root.current, M = motion.current, live = ghosts.filter((g) => !trans || (g.key !== trans.keys.top && g.key !== trans.keys.under));
    if (!el || !live.length) return;
    const W = el.clientWidth, dpr = devicePixelRatio || 1, now0 = frameNow();
    const of = (k: string) => el.querySelector<HTMLElement>(`:scope > [data-lg-nav-key="${CSS.escape(k)}"]`);
    for (const g of live) if (!ghostFade.current.has(g.key)) { const o = new Spring(1); o.to(GHOST.opacity, GHOST, now0, 0); ghostFade.current.set(g.key, o); }
    const step = (now: number) => {
      const done: string[] = [];
      for (const g of live) {
        const x = M.cards.get(g.key), o = ghostFade.current.get(g.key)!;
        if (!x) { done.push(g.key); continue; }
        present(of(g.key), {x: Math.round(x.sample(now).value * dpr) / dpr, opacity: o.sample(now).value});
        if (pageSettled(x, now, W) && o.sample(now).settled) done.push(g.key);
      }
      if (!done.length) return true;
      for (const k of done) { present(of(k), {x: undefined, opacity: undefined}); M.cards.delete(k); ghostFade.current.delete(k); }
      commit(() => setGhosts((gs) => gs.filter((g) => !done.includes(g.key))));
      return false;
    };
    if (!step(now0)) return;
    return addTicker(step, scope);
  }, [ghosts, trans]);
  const [warming, setWarming] = useState<number[]>([]), warmed = useRef(new Set<number>());
  useEffect(() => {
    const cold = shown.map((_, i) => i).filter((i) => i < depth && !warmed.current.has(i));
    for (let i = 0; i <= depth; i++) if (!cold.includes(i)) warmed.current.add(i);
    const el = root.current;
    if (!cold.length || t || !el || typeof IntersectionObserver === 'undefined') return;
    let idle = 0, frames = 0, raf = 0;
    const seen = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || idle) return;
      seen.disconnect();
      const start = () => {
        setWarming(cold);
        const step = () => { if (++frames < 4) raf = requestAnimationFrame(step); else { for (const i of cold) warmed.current.add(i); setWarming([]); } };
        raf = requestAnimationFrame(step);
      };
      idle = typeof requestIdleCallback === 'function' ? requestIdleCallback(start, {timeout: 2000}) : window.setTimeout(start, 200);
    });
    seen.observe(el);
    return () => { seen.disconnect(); if (idle && typeof cancelIdleCallback === 'function') cancelIdleCallback(idle); else clearTimeout(idle); cancelAnimationFrame(raf); if (frames) { setWarming([]); } };
  }, [depth, t, shown.length]);
  const live = (i: number) => i === depth || !!t && (i === t.top || i === t.under);
  const drawn = (i: number) => live(i) || warming.includes(i);
  const ghostShown = ghosts.filter((g) => !t || (g.key !== t.keys.top && g.key !== t.keys.under)), ghostOf = new Map(ghostShown.map((g) => [g.key, g]));
  const keyOf = (i: number) => (i <= depth ? keys.current[i] : t!.poppedKeys[i - depth - 1]);
  const entries = shown.map((node, i) => ({key: keyOf(i), node, index: i, page: true}));
  for (const g of ghostShown) if (!entries.some((e) => e.key === g.key)) entries.push({key: g.key, node: g.node, index: g.index, page: false});
  entries.sort((a, b) => a.index - b.index || Number(a.page) - Number(b.page));
  rendered.current = new Map(entries.map((e) => [e.key, {node: e.node, index: e.index}]));
  return (
    <NavCtx.Provider value={{path, set: onPathChange as (p: unknown[]) => void}}>
    <div ref={root} data-lg-nav-stack="" style={{position: 'absolute', inset: 0, touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none'}}>
      {entries.flatMap(({key, node, index: i, page}) => {
        const ghost = ghostOf.get(key), show = page ? drawn(i) || !!ghost : true, card = (t && key === t.keys.top) || ghost?.top;
        return [
          <PageCtx.Provider key={key} value={page ? {store, index: i} : {store: ghostStore, index: i}}>
            {
}
            <div data-lg-nav-key={key} {...(page ? {'data-lg-nav-page': i} : {})} {...(show ? {} : {'data-lg-hidden': ''})}
              {...(!ghost && i === depth && page ? {} : {inert: true})}
              {...(card || ghost ? {'data-lg-group': ''} : {})} {...(card ? {'data-lg-card': String(PAGE.corner)} : {})}
              style={{position: 'absolute', top: 0, bottom: 0, left: 0, width: '100%', visibility: show ? undefined : 'hidden'}}>
              {
}
              <GlassLayer aria-hidden style={{position: 'absolute', inset: 0, background: scheme === 'dark' ? '#000' : '#fff', pointerEvents: 'none'}} />
              {node}
            </div>
          </PageCtx.Provider>,
          t && page && key === t.keys.under ? <GlassLayer key={`dim:${key}`} data-lg-nav-dim="" data-lg-group="" aria-hidden style={{position: 'absolute', inset: 0, pointerEvents: 'none', backgroundColor: `rgba(0, 0, 0, ${PAGE.dim})`}} /> : null,
        ];
      })}
      <NavigationBars store={store} depths={t ? [t.op === 'push' ? t.under : t.top, t.op === 'push' ? t.top : t.under] : [depth]} depth={depth} onBack={() => onPathChange(path.slice(0, -1))}
        bar={t ? {from: t.op === 'push' ? t.under : t.top, to: t.op === 'push' ? t.top : t.under, swipe: !!t.swipe, swapped: barSwapped} : null} barKey={barKey} />
      <TabBarReporter store={store} index={t ? t.top : depth} />
    </div>
    </NavCtx.Provider>
  );
}

function TabBarReporter({store, index}: {store: Store; index: number}) {
  const report = useContext(TabBarVisibility);
  const hidden = useSyncExternalStore(store.subscribe, () => store.items.get(index)?.tabBar === 'hidden');
  useLayoutEffect(() => { report?.(hidden); }, [report, hidden]);
  useLayoutEffect(() => () => report?.(false), [report]);
  return null;
}

/** A page of a `<NavigationStack>`: its content scrolls under the bar, which shows its `title` ('inline' or a collapsing 'large' title), its `trailing` items, and its `toolbar` at the bottom. `tabBar="hidden"` hides a tab bar while it is shown. */
export function NavigationPage({title, titleDisplayMode = 'inline', trailing, toolbar, tabBar, edgeEffect = 'soft', scrollRef, background, children}: {title?: string; titleDisplayMode?: 'inline' | 'large';
  trailing?: ReactNode; toolbar?: ReactNode; tabBar?: 'visible' | 'hidden'; edgeEffect?: ScrollEdgeEffect; scrollRef?: Ref<HTMLDivElement>; background?: string; children?: ReactNode}) {
  const ctx = useContext(PageCtx), pocket = useId(), large = titleDisplayMode === 'large' && !!title;
  if (!ctx) throw new Error('<NavigationPage> must be a page of a <NavigationStack>');
  const {store, index} = ctx;
  const [titles] = useState<Titles>(() => ({inline: 0, large: 1, collapsed: false, height: BAR.large}));
  const scroller = useRef<HTMLDivElement | null>(null), largeTitle = useRef<HTMLDivElement>(null), scheme = useGlassScheme(), scope = useFrameScope();
  const setScroller = (el: HTMLDivElement | null) => { scroller.current = el; if (typeof scrollRef === 'function') scrollRef(el); else if (scrollRef) (scrollRef as {current: HTMLDivElement | null}).current = el; };
  useLayoutEffect(() => { store.set(index, {title, trailing, toolbar, pocket, titles: large ? titles : undefined, tabBar}); });
  useLayoutEffect(() => () => store.delete(index), [store, index]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!large || !el) return;
    let remove = () => {}, from = titles.large, t0: number | null = null;
    const ink = new Spring(titles.inline);
    let show = titleSprings(0).show;
    const inline = () => document.querySelector<HTMLElement>(`[data-lg-bars="${CSS.escape(pocket)}"] [data-lg-inline-title]`);
    const write = () => { present(largeTitle.current, {opacity: titles.large}); present(inline(), inlinePresentation(titles.inline)); };
    const step = (now: number) => {
      t0 ??= now;
      const k = Math.min(1, (now - t0) / (LARGE.fade * 1000)), e = caEaseInOut(k), to = titles.collapsed ? 0 : 1;
      titles.large = from + (to - from) * e;
      const i = ink.sample(now);
      titles.inline = i.value;
      write();
      return k < 1 || !i.settled;
    };
    let lastTop = el.scrollTop, lastAt: number | null = null, velocity = 0;
    let interactive = false;
    const update = (animate: boolean, at?: number) => {
      const top = el.scrollTop;
      if (at !== undefined) { if (lastAt !== null && at > lastAt) velocity = (top - lastTop) / (at - lastAt) * 1000; lastTop = top; lastAt = at; }
      const c = top >= LARGE.collapse, height = at === undefined ? titles.height : barHeight(top, interactive), shrunk = (height < BAR.large) !== (titles.height < BAR.large);
      titles.height = height;
      const hit = document.querySelector<HTMLElement>(`[data-lg-bars="${CSS.escape(pocket)}"] [data-lg-nav-hit]`);
      if (hit && hit.style.height !== `${height}px`) hit.style.height = `${height}px`;
      if (shrunk && (c === titles.collapsed || !animate)) store.set(index, {...store.items.get(index)!, titles});
      if (c === titles.collapsed && animate) return;
      titles.collapsed = c;
      remove();
      if (animate) {
        const now = frameNow();
        from = titles.large; t0 = null;
        if (c) ink.to(1, show, now);
        else { const s = titleSprings(velocity); show = s.show; ink.to(0, s.hide, now); }
        remove = addTicker(step, scope);
      } else { titles.large = c ? 0 : 1; titles.inline = c ? 1 : 0; ink.set(titles.inline); write(); }
      store.set(index, {...store.items.get(index)!, titles});
    };
    update(false);
    const onScroll = (e: Event) => update(true, e.timeStamp);
    let user = false;
    const onInput = () => { user = interactive = true; };
    const onEnd = () => {
      const y = el.scrollTop, snap = user && y > 0 && y < LARGE.collapse;
      if (snap) el.scrollTo({top: y <= LARGE.collapse / 2 ? 0 : LARGE.collapse, behavior: 'smooth'});
      user = false;
      if (!snap) interactive = false;
    };
    const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    el.addEventListener('scroll', onScroll, {passive: true});
    el.addEventListener('scrollend', onEnd);
    for (const e of inputs) el.addEventListener(e, onInput, {passive: true});
    return () => { remove(); el.removeEventListener('scroll', onScroll); el.removeEventListener('scrollend', onEnd); for (const e of inputs) el.removeEventListener(e, onInput); };
  }, [large]);
  return (
    <ScrollView pocketId={pocket} edgeEffect={edgeEffect} scrollRef={setScroller} contentTop={large ? LARGE.top : undefined} background={background}>
      {large ? (
        <div style={{position: 'relative', paddingTop: LARGE.inset, paddingBottom: LARGE.bottom}}>
          { }
          <GlassLayer ref={largeTitle} data-lg-group="" aria-hidden style={{position: 'absolute', left: 0, top: LARGE.top, width: '100%', height: LARGE.collapse, pointerEvents: 'none'}}>
            <span className="lg-nav-title" role="heading" aria-level={1} style={{position: 'absolute', left: 16, top: 11 / 3, fontSize: 34, fontWeight: 700, lineHeight: `${122 / 3}px`,
              whiteSpace: 'nowrap', color: scheme === 'dark' ? '#fff' : '#000'}}>{title}</span>
          </GlassLayer>
          {children}
        </div>
      ) : children}
    </ScrollView>
  );
}

const LARGE = {inset: 168, bottom: 34, top: 116, collapse: 52, fade: .2};
const BAR = {top: 62, inline: 54, large: 106};
const barHeight = (s: number, interactive: boolean) => interactive ? Math.min(BAR.large, Math.max(BAR.inline, BAR.large - s)) : BAR.large;
const TITLE_SPRING = {maxVelocity: 2000, minFactor: .5, bounce: .4, hide: .7, show: .45, drop: 15, blur: 4};
function titleSprings(v: number) {
  const q = Math.min(Math.abs(v) / TITLE_SPRING.maxVelocity, 1), f = 1 + (TITLE_SPRING.minFactor - 1) * q, damping = 1 - TITLE_SPRING.bounce * q;
  return {hide: {response: TITLE_SPRING.hide * f, damping}, show: {response: TITLE_SPRING.show * f, damping}};
}
class Spring {
  target: number; private x0 = 0; private v0 = 0; private t0 = 0; private p = {response: 1, damping: 1};
  constructor(value: number) { this.target = value; }
  set(value: number) { this.target = value; this.x0 = 0; this.v0 = 0; }
  to(target: number, p: {response: number; damping: number}, now: number, velocity?: number) {
    const s = this.sample(now);
    this.target = target; this.x0 = s.value - target; this.v0 = velocity ?? s.velocity; this.t0 = now; this.p = p;
  }
  sample(now: number) {
    const t = Math.max(0, now - this.t0) / 1000, w = 2 * Math.PI / this.p.response, z = this.p.damping, A = this.x0;
    let x: number, v: number;
    if (z >= 1 - 1e-9) { const B = this.v0 + w * A, e = Math.exp(-w * t); x = e * (A + B * t); v = e * (B - w * (A + B * t)); }
    else {
      const wd = w * Math.sqrt(1 - z * z), B = (this.v0 + z * w * A) / wd, e = Math.exp(-z * w * t), c = Math.cos(wd * t), s = Math.sin(wd * t);
      x = e * (A * c + B * s); v = -z * w * x + e * wd * (B * c - A * s);
    }
    const settled = Math.abs(x) < 1e-4 && Math.abs(v) < 1e-3;
    return {value: settled ? this.target : this.target + x, velocity: settled ? 0 : v, settled};
  }
}
function caEaseInOut(k: number) {
  const bx = (t: number) => 3 * .42 * t * (1 - t) ** 2 + 3 * .58 * t * t * (1 - t) + t ** 3, by = (t: number) => 3 * t * t * (1 - t) + t ** 3;
  let a = 0, b = 1;
  for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (bx(m) < k) a = m; else b = m; }
  return by((a + b) / 2);
}

function NavigationBars({store, depths, depth, onBack, bar, barKey}: {store: Store; depths: number[]; depth: number; onBack: () => void;
  bar: {from: number; to: number; swipe: boolean; swapped: boolean} | null; barKey: number}) {
  useSyncExternalStore(store.subscribe, store.version);
  const moving = depths.length > 1, has = (i: number) => store.items.get(i)?.toolbar != null;
  const shown = !bar ? depth : bar.swipe ? (bar.swapped && has(bar.to) ? bar.to : bar.from) : has(bar.to) ? bar.to : bar.from, item = store.items.get(shown);
  return <>
    {depths.map((d) => {
      const it = store.items.get(d);
      if (!it) return null;
      return (
        <div key={d} data-lg-bars={it.pocket} data-lg-bars-depth={d} {...(moving && d !== depth ? {inert: true} : {})}>
          <NavigationBar title={it.title} titles={it.titles} back={d > 0} onBack={onBack} trailing={it.trailing} moving={moving} />
        </div>
      );
    })}
    {item?.toolbar != null && <div key={`bar${barKey}`} data-lg-bars={item.pocket} data-lg-nav-toolbar="" {...(moving && shown !== depth ? {inert: true} : {})}>{asBar(item.toolbar, shown)}</div>}
  </>;
}

function asBar(el: ReactNode, page: number): ReactNode {
  if (!isValidElement(el)) return el;
  if (el.type === Toolbar) {
    const {children, ...props} = el.props as {children?: ReactNode; style?: CSSProperties};
    return <Toolbar {...props}>{Children.toArray(children).map((c) => (isValidElement(c) ? cloneElement(c, {key: `${page}:${String(c.key)}`}) : c))}</Toolbar>;
  }
  if (el.type === SearchBar) {
    const {style, ...props} = el.props as SearchBarProps;
    return <Toolbar style={style}><SearchField key={`${page}:search`} {...props} /></Toolbar>;
  }
  return el;
}

const TITLE = {top: 62 + 35 / 3, height: 62 / 3};
const inlinePresentation = (shown: number) => ({opacity: Math.min(1, Math.max(0, shown)), y: TITLE_SPRING.drop * (1 - shown),
  blur: shown > 0 && shown < 1 ? TITLE_SPRING.blur * (1 - shown) : undefined});

function NavigationBar({title, titles, back, onBack, trailing, moving}: {title?: string; titles?: Titles; back: boolean; onBack: () => void; trailing?: ReactNode; moving: boolean}) {
  const shown = !titles || titles.collapsed, scheme = useGlassScheme();
  return (
    <div data-lg-edge="top" {...(titles && titles.height < BAR.large ? {'data-lg-hard-bottom': String(BAR.top + BAR.inline)} : {})}>
      {
}
      {title || back || trailing ? <GlassLayer data-lg-nav-hit="" aria-hidden style={{position: 'absolute', left: 0, right: 0, top: BAR.top, height: titles ? titles.height : BAR.inline}} /> : null}
      {title ? (<div data-lg-nav-title="" {...(moving ? {'data-lg-group': ''} : {})}>
        <GlassLayer data-lg-inline-title="" data-lg-group="" {...(shown ? {'data-lg-floating': ''} : {})} data-lg-pocket-region={`${BAR.top} ${BAR.top + 44}`} aria-hidden
          ref={(el) => { if (el && titles) present(el, inlinePresentation(titles.inline)); }}
          style={{position: 'absolute', left: 0, right: 0, top: TITLE.top, height: TITLE.height, display: 'flex', justifyContent: 'center',
          pointerEvents: 'none', color: `var(--lg-floating, ${scheme === 'dark' ? '#fff' : '#000'})`, fontSize: 17, fontWeight: 600, lineHeight: `${TITLE.height}px`, whiteSpace: 'nowrap'}}>
          <span className="lg-nav-title" role="heading" aria-level={1}>{title}</span>
        </GlassLayer>
      </div>) : null}
      <TopBar>
        {back ? (
          <ToolbarGroup key="back" placement="leading" data-lg-nav-back="">
            {
}
            <ToolbarItem key="back" aria-label="Back" onClick={onBack} icon={<NamedIcon name="chevron.backward" size={17} variant="back" style={{left: -1 / 6, top: 1 / 6}} />} />
          </ToolbarGroup>
        ) : null}
        {trailing}
      </TopBar>
    </div>
  );
}
