import {Tabs} from '@base-ui/react/tabs';
import {Children, createContext, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode} from 'react';
import {Glass, GlassContainer, GlassLayer, NamedIcon, useFrameScope, useGlassFlexReset, useGlassPlatform, useGlassPose, useGlassScheme, useIcon, Vibrant} from './react';
import {fallbackFrame} from './iconFallback';
import {toneCSS, type GlassScheme} from './palette';
import type {LensFrame} from './lensGPU';
import {addTicker, commit, frameLoop, frameNow, present} from './frame';
import {step as stepSpring} from './menuMorph';
import {localPoint, usePressHighlight, type PressHighlight} from './highlight';
import {lensClock, springAt, useLiquidLens, type LensSpec, type LensSpring} from './liquidLens';

const LABEL = 10, MEDIUM = 500, SEMIBOLD = 600;
export const TAB_SELECTION: Record<'light' | 'dark', number[]> = {
  light: [1.185, -0.05, -0.005, 0, -0.2, -0.015, 1.15, -0.005, 0, -0.2, -0.015, -0.05, 1.195, 0, -0.2, 0, 0, 0, 1, 0],
  dark: [1.082, -0.113, -0.011, 0, 0.135, -0.034, 1.003, -0.011, 0, 0.135, -0.034, -0.113, 1.105, 0, 0.135, 0, 0, 0, 1, 0],
};

export const TabBarVisibility = createContext<((hidden: boolean) => void) | null>(null);

/** Props of `Tab`. */
export type TabProps<T> = {
  /** The value the `TabView` selects it by. */
  value: T;
  /** Its label in the bar. */
  title: string;
  /** Its icon: your element or an `iconSet` name. */
  icon?: ReactNode | string;
  /** Its page. */
  children?: ReactNode;
  /** Dimmed; it can't be selected. */
  disabled?: boolean;
  /** 'search': a circle of its own after the bar; selected, the bar shrinks beside a search field. */
  role?: 'search'};
/** A tab of a `<TabView>`: its page and its item in the bar. Renders nothing itself. */
export function Tab<T>(_: TabProps<T>): null { return null; }

export function tabBarLayout(text: number[], image: number[], screen: {w: number; h: number}, safe: [number, number, number, number], search = false, fill = false) {
  const n = text.length, outer = 21, height = 62, minimum = 54, variable = n > 3, extra = variable ? 12 : 0;
  let inset = n > 4 ? 15 : 24, spacing = variable ? 0 : 32;
  const natural = text.map((t, i) => Math.max(minimum, Math.max(t, image[i] ?? 0) + extra));
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const ideal = 2 * inset + (n - 1) * spacing + (variable ? sum(natural) : n * Math.max(...natural));
  const available = screen.w - safe[1] - safe[3] - 2 * outer - (search ? height + 8 : 0), width = Math.max(8, variable || search || fill ? available : Math.min(available, ideal));
  let inner = width - 2 * inset, widths = [...natural], equal = !variable, distribute = variable || search || fill;
  const maximum = Math.min(inner, Math.max(...natural));
  let cell = Math.min(maximum, (inner - (n - 1) * (variable ? 2 : spacing)) / n);
  if (variable) {
    const room = n > 1 ? (inner - sum(natural)) / (n - 1) : Infinity;
    if (room < 14) { distribute = false; inset = Math.min(inset, 14); inner = width - 2 * inset; }
    else if (maximum > minimum) { distribute = maximum <= (inner - (n - 1) * 2) / n; inset = Math.min(inset, 18); inner = width - 2 * inset; }
    if (distribute && n > 1) cell = Math.max(cell, inner / n - (inset - 4));
    equal = distribute;
  } else if ((search || fill) && n > 1) cell = inner / n - (inset - 4);
  if (equal) widths = widths.map(() => cell);
  let total = sum(widths); const excess = total - inner + (distribute ? 0 : (n - 1) * spacing);
  if (excess > 0) { widths = widths.map((w) => w - excess / n); total = sum(widths); }
  if (distribute && n > 1) spacing = (inner - total) / (n - 1);
  const grow = inset - 4; let x = inset;
  const buttons = widths.map((w) => { const b = {x: x - grow, y: 4, w: w + 2 * grow, h: height - 8}; x += w + spacing; return b; });
  const bottom = Math.min(safe[2], 21);
  return {frame: {x: Math.round(safe[3] + outer + (available - width) / 2), y: screen.h - bottom - height, w: width, h: height}, buttons,
    search: search ? {x: screen.w - safe[1] - outer - height, w: height} : null};
}

const SETTLE = {response: 0.4, damping: 0.85}, DRAG = {response: 0.2, damping: 0.85}, LIFT = 8, GATE = 8, CONTENT_SCALE = 0.16;
const BOUNDS = {response: 0.25, damping: 1, impulse: 0};

const LINE = (dpr: number) => Math.ceil(LABEL * (2444 / 2048) * dpr - 1e-9) / dpr;

function TabSymbol({name, width}: {name: string; width: number}) {
  const fallback = fallbackFrame(name, 18, 'tab'), entry = (useIcon(name, 18, 'tab') ?? (fallback && {frame: fallback})) as {frame: number[]; top?: number} | null;
  if (!entry) return <NamedIcon name={name} size={18} variant="tab" />;
  return <NamedIcon name={name} size={18} variant="tab" style={{position: 'absolute', left: Math.round((width - entry.frame[0]) / 2), top: entry.top ?? 6}} />;
}

function CentredSymbol({name, side, height = side}: {name: string; side: number; height?: number}) {
  const fallback = fallbackFrame(name, 18, 'tab'), entry = (useIcon(name, 18, 'tab') ?? (fallback && {frame: fallback})) as {frame: number[]} | null;
  if (!entry) return <NamedIcon name={name} size={18} variant="tab" />;
  return <NamedIcon name={name} size={18} variant="tab" style={{position: 'absolute', left: (side - entry.frame[0]) / 2, top: (height - entry.frame[1]) / 2}} />;
}

const MORPH = {response: .3, damping: .8, impulse: .016 * (2 * Math.PI / .3) ** 2}, LAYOUT = {response: .3, damping: 1};
const ACC_COLLAPSE = {response: .36, damping: .72}, ACC_COLLAPSE_LATE = {response: .42, damping: .76}, ACC_EXPAND = {response: .3, damping: .72}, ACC_EXPAND_LATE = {response: .36, damping: .72};
const POCKET_EXPAND = {response: 2 * Math.PI / Math.sqrt(341.02371602399535), damping: 1};
type Box = {x: number; y: number; w: number; h: number};
type Chan = {from: number; v: number; to: number; t0: number; response: number; damping: number};
type Spring = {response: number; damping: number};
const chan = (v: number, now: number, s: Spring = MORPH): Chan => ({from: v, v: 0, to: v, t0: now, response: s.response, damping: s.damping});
function at(c: Chan, now: number) {
  const t = Math.max(0, (now - c.t0) / 1000), w = 2 * Math.PI / c.response, d = c.from - c.to;
  if (c.damping >= 1) { const k = c.v + w * d, e = Math.exp(-w * t); return {x: c.to + (d + k * t) * e, v: (c.v - w * k * t) * e}; }
  const z = c.damping, a = z * w, wd = w * Math.sqrt(1 - z * z), e = Math.exp(-a * t), C = Math.cos(wd * t), S = Math.sin(wd * t);
  return {x: c.to + e * (d * C + (c.v + a * d) / wd * S), v: e * (c.v * C - (a * c.v + w * w * d) / wd * S)};
}
const resting = (c: Chan, now: number) => { const q = at(c, now); return Math.abs(q.x - c.to) < .01 && Math.abs(q.v) < .1; };
function steerTo(c: Chan | null, to: number, now: number, kick = false, s: Spring = MORPH): Chan {
  if (!c) return chan(to, now, s);
  if (c.to === to && c.response === s.response && c.damping === s.damping) return c;
  const q = at(c, now), rest = resting(c, now);
  return {from: q.x, v: rest ? (kick && s === MORPH ? MORPH.impulse * (to - q.x) : 0) : q.v, to, t0: now, response: s.response, damping: s.damping};
}
type Track = {cx: Chan; cy: Chan; w: Chan; h: Chan};
const trackTo = (k: Track | null, b: Box, now: number, kick = false, s: Spring = MORPH): Track => ({cx: steerTo(k?.cx ?? null, b.x + b.w / 2, now, kick, s), cy: steerTo(k?.cy ?? null, b.y + b.h / 2, now, kick, s),
  w: steerTo(k?.w ?? null, b.w, now, kick, s), h: steerTo(k?.h ?? null, b.h, now, kick, s)});
const settledAt = (c: Chan, now: number) => (resting(c, now) ? c.to : at(c, now).x);
const boxOf = (k: Track, now: number): Box => { const w = settledAt(k.w, now), h = settledAt(k.h, now); return {x: settledAt(k.cx, now) - w / 2, y: settledAt(k.cy, now) - h / 2, w, h}; };
const trackResting = (k: Track, now: number) => resting(k.cx, now) && resting(k.cy, now) && resting(k.w, now) && resting(k.h, now);
const snapTo = (b: Box, now: number): Track => trackTo(null, b, now);
const CANCEL_PRESS: PressHighlight = {light: .75, dark: 1, seconds: 0, tracks: (el, x, y) => { const p = localPoint(el, x, y); return p.x >= -15 && p.x < p.w + 15 && p.y >= -15 && p.y < p.h + 15; }};

function bandAtOf(b: {collapse: boolean; t0: number; from: number; c: Chan | null}, now: number, accTop: number) {
  if (b.collapse) { const e = now - b.t0; return e < 67 ? b.from : e < 820 ? accTop : null; }
  return resting(b.c!, now) ? null : at(b.c!, now).x;
}

/** Props of `TabView`. */
export type TabViewProps<T> = {
  /** The selected tab's value, controlled. */
  selection?: T;
  /** The starting selection when uncontrolled (default the first tab). */
  defaultSelection?: T;
  /** Called with the newly selected tab's value. */
  onSelectionChange?: (value: T) => void;
  /** Its `<Tab>`s. */
  children: ReactNode;
  /** The screen's safe area in CSS px, [top, right, bottom, left]: what it presents stays inside it. Default [62, 0, 34, 0], a phone in portrait. */
  safeArea?: [number, number, number, number];
  /** With a `<Tab role="search">`: the search field's text; the field takes the bar's place while that tab is selected. */
  searchText?: string;
  /** Called as the search text changes. */
  onSearchTextChange?: (text: string) => void;
  /** The search field's placeholder (default "Search"). */
  searchPrompt?: string;
  /** The software keyboard's height in CSS px (`useKeyboardHeight()`): while editing, the field sits above it. */
  keyboard?: number;
  /** A glass bar above the tab bar, inline beside it when minimized. */
  accessory?: ReactNode;
  /** 'onScrollDown': the bar minimizes as the selected page scrolls down; a tap expands it. Default 'automatic' (stays). */
  minimizeBehavior?: 'automatic' | 'never' | 'onScrollDown';
  /** Minimized, controlled. */
  minimized?: boolean;
  /** Called when it minimizes or expands. */
  onMinimizedChange?: (minimized: boolean) => void;
  style?: CSSProperties; className?: string;
};

/** Pages under a glass tab bar; the selection moves as a glass lens. One page shows at a time. */
export function TabView<T>({selection, defaultSelection, onSelectionChange, children, safeArea = [62, 0, 34, 0], searchText = '', onSearchTextChange, searchPrompt = 'Search', keyboard = 0, accessory, minimizeBehavior = 'automatic', minimized: givenMin, onMinimizedChange, style, className}: TabViewProps<T>) {
  const all = Children.toArray(children).filter((c): c is ReactElement<TabProps<T>> => isValidElement(c) && c.type === Tab).map((c) => c.props);
  const tabs = all.filter((t) => t.role !== 'search'), searchTab = all.find((t) => t.role === 'search') ?? null;
  const [own, setOwn] = useState<T | undefined>(defaultSelection ?? all[0]?.value), value = selection ?? own;
  const page = Math.max(0, all.findIndex((t) => Object.is(t.value, value))), searching = !!searchTab && Object.is(searchTab.value, value);
  const [ownMin, setOwnMin] = useState(false), minimized = !searchTab && (givenMin ?? ownMin), circled = searching || minimized;
  const setMinimized = (v: boolean) => { if (givenMin === undefined) setOwnMin(v); if (v !== minimized) onMinimizedChange?.(v); };
  const lastBar = useRef(0), found = tabs.findIndex((t) => Object.is(t.value, value));
  if (found >= 0) lastBar.current = found;
  const index = found >= 0 ? found : Math.min(lastBar.current, Math.max(0, tabs.length - 1));
  const scheme = useGlassScheme() as 'light' | 'dark', dpr = typeof window === 'undefined' ? 3 : window.devicePixelRatio || 3, platform = useGlassPlatform();
  const scope = useFrameScope();
  const root = useRef<HTMLDivElement>(null), measurers = useRef<HTMLDivElement>(null), pages = useRef<(HTMLDivElement | null)[]>([]), bars = useRef<HTMLDivElement>(null);
  const [hiddenBy, setHiddenBy] = useState<Record<number, boolean>>({});
  const reporters = useMemo(() => all.map((_, i) => (h: boolean) => setHiddenBy((s) => (!!s[i] === h ? s : {...s, [i]: h}))), [all.length]);
  const [screen, setScreen] = useState({w: 402, h: 874}), [texts, setTexts] = useState<[number, number][]>([]);
  const measure = () => {
    const el = root.current, pr = measurers.current; if (!el || !pr) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w && h) setScreen((s) => (s.w === w && s.h === h ? s : {w, h}));
    const k = el.getBoundingClientRect().width / (w || 1); if (!(k > 0)) return;
    const spans = [...pr.children] as HTMLElement[], t = tabs.map((_, i) => [spans[2 * i].getBoundingClientRect().width / k, spans[2 * i + 1].getBoundingClientRect().width / k] as [number, number]);
    setTexts((s) => (s.length === t.length && s.every((v, i) => Math.abs(v[0] - t[i][0]) + Math.abs(v[1] - t[i][1]) < 1e-3) ? s : t));
  };
  useLayoutEffect(measure);
  useLayoutEffect(() => { document.fonts?.ready.then(measure); }, []);
  useLayoutEffect(() => {
    const id = pages.current[page]?.querySelector<HTMLElement>('[data-lg-pocket-id]')?.dataset.lgPocketId;
    if (bars.current) { if (id) bars.current.dataset.lgBars = id; else delete bars.current.dataset.lgBars; }
  });

  const ceil = (v: number) => Math.ceil(v * dpr - 1e-6) / dpr;
  const L = tabBarLayout(tabs.map((_, i) => ceil(texts[i]?.[0] ?? 0)), tabs.map((t) => (t.icon ? 24 : 0)), screen, safeArea, !!searchTab, !!accessory && !searchTab);
  const ACC = 48, ACC_GAP = 8, accTop = accessory && !searchTab ? ACC + ACC_GAP : 0;
  const sa = useRef({p: 0, tag: 2 as 0 | 1 | 2, acc: 0, init: 0, last: 0, idle: 0, touching: false, released: false, wheelAt: -1e9, wheelD: 0, shrinking: 0, pivot: [0, 0] as [number, number],
    hint: {value: 1, velocity: 0, target: 1, response: .1, damping: .8}, t: 0, off: () => {}}).current;
  sa.pivot = [screen.w / 2 - L.frame.x - L.frame.w / 2, (screen.h - (L.frame.y - accTop)) / 2 - accTop - L.frame.h / 2];
  useEffect(() => {
    if (minimizeBehavior !== 'onScrollDown' || !accTop) return;
    const el = pages.current[page]?.querySelector<HTMLElement>('[data-lg-scroll]');
    if (!el) return;
    sa.last = el.scrollTop; sa.tag = 2;
    const hint = (target: number, response: number) => {
      Object.assign(sa.hint, {target, response, damping: .8});
      sa.off(); sa.t = frameNow() / 1000;
      sa.off = addTicker((now) => {
        const t = now / 1000; stepSpring(sa.hint, Math.min(.05, t - sa.t)); sa.t = t;
        const s = sa.hint.value, [dx, dy] = sa.pivot;
        present(tablist.current, s === 1 ? {scale: undefined, x: undefined, y: undefined} : {scale: [s, s], x: (1 - s) * dx, y: (1 - s) * dy});
        return s !== sa.hint.target || sa.hint.velocity !== 0;
      }, scope);
    };
    const tracking = () => sa.touching || performance.now() - sa.wheelAt < 120;
    const setP = (p: number) => {
      if (p === sa.p) return;
      sa.p = p;
      if (p > 0 && p < 1) { hint(1 - .05 * p, tracking() ? .1 : .5); return; }
      hint(1, .3);
      if ((p === 1) !== minimizedRef.current) commit(() => setMinimizedRef.current(p === 1));
    };
    const begin = () => { sa.tag = 0; sa.acc = 0; sa.released = false; sa.wheelD = 0; sa.shrinking = 0; };
    const coast = () => { if (sa.tag === 0) { sa.tag = 1; sa.init = sa.p; } };
    const end = () => { if (sa.touching) return; sa.tag = 2; setP(Math.floor(sa.p)); };
    const onScroll = () => {
      const y = el.scrollTop, lo = 0, hi = Math.max(lo, el.scrollHeight - el.clientHeight);
      clearTimeout(sa.idle); sa.idle = window.setTimeout(end, 120);
      let delta = y - sa.last; sa.last = y;
      if (sa.tag === 2) return;
      if (sa.released && !sa.touching) coast();
      if (y < lo) delta = Math.min(delta, 0); else if (y > hi) delta = Math.max(delta, 0);
      if (sa.tag === 0) {
        const a = (delta < 0 || Object.is(delta, -0)) !== (sa.acc < 0 || Object.is(sa.acc, -0)) ? delta : sa.acc + delta;
        if (y >= hi && delta > 0 && sa.p !== 0) { sa.tag = 2; setP(0); return; }
        if (a < 0 || hi - lo < 1.5 * 64) return;
        sa.tag = 1; sa.init = sa.p; delta = Math.max(a, 0);
      }
      if (y <= lo && delta < 0 && sa.init !== 0) { sa.tag = 2; setP(0); }
      else if (sa.p !== 1) { const p = Math.max(0, Math.min(1, sa.p + delta / 64)); if (p === 1) sa.tag = 2; setP(p); }
    };
    const down = () => { sa.touching = true; begin(); };
    const up = () => { sa.touching = false; sa.released = true; clearTimeout(sa.idle); sa.idle = window.setTimeout(end, 120); };
    const wheel = (e: WheelEvent) => {
      if (sa.tag === 2 && performance.now() - sa.wheelAt >= 120) begin();
      sa.wheelAt = performance.now();
      const d = e.deltaY, shrinks = d !== 0 && Math.sign(d) === Math.sign(sa.wheelD) && Math.abs(d) < Math.abs(sa.wheelD);
      sa.shrinking = shrinks ? sa.shrinking + 1 : 0; sa.wheelD = d;
      if (sa.shrinking >= 3) coast();
    };
    el.addEventListener('scroll', onScroll, {passive: true});
    el.addEventListener('touchstart', down, {passive: true}); el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
    el.addEventListener('wheel', wheel, {passive: true});
    return () => {
      el.removeEventListener('scroll', onScroll); el.removeEventListener('touchstart', down); el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up); el.removeEventListener('wheel', wheel); clearTimeout(sa.idle);
    };
  }, [page, minimizeBehavior, accTop]);
  useEffect(() => () => sa.off(), []);
  const minimizedRef = useRef(minimized); minimizedRef.current = minimized;
  const setMinimizedRef = useRef(setMinimized); setMinimizedRef.current = setMinimized;
  useEffect(() => { sa.p = minimized ? 1 : 0; }, [minimized]);
  const pick = (t: TabProps<T> | null | undefined) => { if (!t || t.disabled) return; setOwn(t.value); if (!Object.is(t.value, value)) onSelectionChange?.(t.value); };
  const choose = (i: number) => pick(tabs[i]);

  const content = (i: number, selected: boolean, noIcon = false) => {
    const t = tabs[i], b = L.buttons[i], tw = ceil(texts[i]?.[selected ? 1 : 0] ?? 0), left = Math.round((b.w - tw) / 2);
    return (
      <Vibrant key={i} aria-hidden="true" tone={selected ? 'blue' : 'tab-label'} data-lg-tone-color={selected ? 'page' : undefined} style={{position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h}}>
        {noIcon ? null : typeof t.icon === 'string' ? <TabSymbol name={t.icon} width={b.w} />
          : t.icon != null && <div style={{position: 'absolute', left: 0, right: 0, top: 6, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{t.icon}</div>}
        <span style={{position: 'absolute', left, top: 35, lineHeight: `${LINE(dpr)}px`, fontSize: LABEL, fontWeight: selected ? SEMIBOLD : MEDIUM, whiteSpace: 'nowrap'}}>{t.title}</span>
      </Vibrant>
    );
  };

  const tablist = useRef<HTMLDivElement>(null);
  const [adapted] = useState(() => ({spacing: 0, get scheme() { const v = tablist.current?.querySelector<HTMLElement>('.lg-glass')?.dataset.glassScheme; return v === 'dark' || v === 'light' ? v : null; }}));
  const barScheme = () => adapted.scheme ?? scheme;
  const centre = (i: number) => L.buttons[i].x + L.buttons[i].w / 2, CY = L.frame.h / 2;
  const [, redraw] = useState(0);
  const g = useRef({x: null as LensSpring | null, tracking: false, id: -1, anchor: 0.5, highlighted: -1, reselect: true, startX: 0, settling: false, loop: frameLoop(scope)}).current;
  const clock = lensClock, sb = L.buttons[index];
  const xAt = (t: number) => (g.x ? springAt(g.x, t).value : centre(index));
  const aim = (target: number, cfg: {response: number; damping: number}, t: number) => {
    const p = g.x ? springAt(g.x, t) : {value: centre(index), velocity: 0};
    g.x = {from: p.value, v0: p.velocity, target, t0: t, ...cfg};
  };
  const spec: LensSpec = {rest: [sb.w, sb.h], lifted: [sb.w + 2 * LIFT, sb.h + 2 * LIFT], optical: [sb.w + 2 * LIFT, sb.h + 2 * LIFT], shadow: false, warp: [0, 9],
    springs: {lift: BOUNDS, unlift: BOUNDS}, blur: 0, large: true, backdrop: {blur: 2, matrix: TAB_SELECTION}};
  const poseOf = useGlassPose();
  const lens = useLiquidLens(spec, () => [xAt(clock()), CY], dpr, () => {
    const pose = poseOf(tablist.current?.querySelector('[data-lg-flex-host]') ?? null);
    return pose ? {centre: [L.frame.w / 2, L.frame.h / 2], scale: pose.scale, translation: pose.translation} : null;
  });
  const tick = (): boolean => {
    const t = clock(), moving = !!g.x && (() => { const p = springAt(g.x!, t); return Math.abs(p.value - g.x!.target) > 1e-3 || Math.abs(p.velocity) > 1e-2; })();
    if (g.settling && (!g.x || Math.abs(xAt(t) - g.x.target) < GATE)) { g.settling = false; lens.release(); }
    lens.moved();
    if (!moving && !g.tracking) g.x = null;
    commit(() => redraw((v) => v + 1));
    return moving || g.settling;
  };
  const kick = () => g.loop.start(tick);
  useEffect(() => () => g.loop.stop(), []);
  const shownIndex = useRef(index);
  useEffect(() => { if (shownIndex.current !== index) { shownIndex.current = index; if (!g.tracking) { aim(centre(index), SETTLE, clock()); kick(); } } });

  const local = (e: React.PointerEvent) => { const el = tablist.current!, r = el.getBoundingClientRect(), k = r.width / (el.offsetWidth || 1); return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]; };
  const buttonAt = (x: number) => {
    const has = (i: number) => x >= L.buttons[i].x && x < L.buttons[i].x + L.buttons[i].w && !tabs[i].disabled;
    return has(index) ? index : L.buttons.findIndex((_, i) => has(i));
  };
  const follow = (x: number) => {
    const w = L.buttons[Math.max(0, g.highlighted)].w, a = g.anchor, lo = a * w, hi = L.frame.w - (1 - a) * w;
    return Math.min(hi, Math.max(lo, x)) - a * w + w / 2;
  };
  const down = (e: React.PointerEvent) => {
    if (g.tracking || !e.isPrimary || circled) return;
    const [x] = local(e), i = buttonAt(x); if (i < 0) return;
    Object.assign(g, {tracking: true, id: e.pointerId, highlighted: i, anchor: (x - L.buttons[i].x) / L.buttons[i].w, reselect: true, startX: x, settling: false});
    lens.press();
    aim(centre(i), SETTLE, clock());
    kick();
  };
  const move = (e: React.PointerEvent) => {
    if (!g.tracking || e.pointerId !== g.id) return;
    const [x] = local(e);
    if (Math.abs(x - g.startX) >= 4) g.reselect = false;
    const i = buttonAt(x); if (i >= 0) g.highlighted = i;
    aim(follow(x), DRAG, clock());
    if (!lens.lifted) lens.press();
    kick();
  };
  const up = (e: React.PointerEvent) => {
    if (!g.tracking || e.pointerId !== g.id) return;
    g.tracking = false;
    const to = e.type === 'pointercancel' ? -1 : g.highlighted, next = to >= 0 && !(to === index && !g.reselect) ? to : index;
    g.highlighted = -1;
    shownIndex.current = next;
    aim(centre(next), SETTLE, clock());
    g.settling = true;
    if (to >= 0) choose(to);
    kick();
  };

  const active = lens.active, lb = active ? lens.bounds() : {left: sb.x, top: sb.y, width: sb.w, height: sb.h};
  const q = active ? Math.max(0, (lb.width - sb.w) / (2 * LIFT)) : 0;
  const rest: LensFrame = useMemo(() => ({tint: 'default', provider: 0, recipe: sb.h, inner: [0, 0, 0], key: platform.lens.key[scheme] as number[], fill: platform.lens.fill[scheme] as number[],
    rest: {opacity: 1, image: null, backdrop: {blur: 2, get matrix() { return TAB_SELECTION[barScheme()]; }}}, warp: 0, blur: 0, large: {H: sb.h + 2 * LIFT, q: 0, curvature: platform.lens.curvature.rest}}),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [sb.h, scheme, platform]);
  const selectedContent = (i: number) => {
    const b = L.buttons[i], H = sb.h + 2 * LIFT;
    return (
      <div key={i} data-lg-layer={`1 ${1 + CONTENT_SCALE * q} ${4 * Math.max(0, Math.min(1, p))}`} data-lg-lens={`${0.2 * H * q} ${(-H / 4) * q} 11.2`} style={{position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h}}>
        <div style={{position: 'absolute', left: -b.x, top: -b.y}}>{content(i, true, i === index && carried)}</div>
      </div>
    );
  };

  const [editing, setEditing] = useState(false), field = useRef<HTMLInputElement>(null);
  const lifted = searching && editing && keyboard > 0, S = 48, back = tabs[index];
  const uid = useId();
  const underKey = useId();
  const flexReset = useGlassFlexReset(), platter = (k: 'a' | 'b' | 'c') => tablist.current?.querySelector<HTMLElement>(`[data-lg-tab-platter="${k}"]`) ?? null;
  const platterScheme = (k: 'a' | 'b'): GlassScheme => { const v = platter(k)?.dataset.glassScheme; return v === 'dark' || v === 'light' ? v : barScheme(); };
  const backEntry = useIcon(typeof back?.icon === 'string' ? back.icon : '', 18, 'tab') as {frame: number[]; top?: number} | null;
  const iconFrame = (_t: unknown) => (backEntry ? [backEntry.frame[0], backEntry.frame[1], backEntry.top ?? 6] : [28, 28, 6]);
  const circleGlyph = (i: ReactNode | string) => typeof i === 'string' ? <CentredSymbol name={i} side={S} />
    : <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{i}</div>;
  const matchedGlyph = (i: ReactNode | string) => typeof i === 'string' ? <NamedIcon name={i} size={18} variant="tab" />
    : <div style={{width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center'}}><div style={{flex: 'none', display: 'flex'}}>{i}</div></div>;
  const targets = (): {a: Box; b: Box; c: Box | null} => {
    if (accTop) {
      if (!minimized) return {a: {x: 0, y: 0, w: L.frame.w, h: L.frame.h}, b: {x: 0, y: -accTop, w: L.frame.w, h: ACC}, c: null};
      const y = screen.h - Math.min(safeArea[2], 28) - S - L.frame.y;
      return {a: {x: 28 - L.frame.x, y, w: S, h: S}, b: {x: 28 + S + ACC_GAP - L.frame.x, y, w: screen.w - safeArea[1] - safeArea[3] - 2 * 28 - S - ACC_GAP, h: S}, c: null};
    }
    if (!L.search) return {a: {x: 0, y: 0, w: L.frame.w, h: L.frame.h}, b: {x: 0, y: 0, w: 0, h: 0}, c: null};
    if (!searching) return {a: {x: 0, y: 0, w: L.frame.w, h: L.frame.h}, b: {x: L.search.x - L.frame.x, y: 0, w: L.search.w, h: L.frame.h}, c: null};
    const top = (L.frame.h - S) / 2, x0 = 28 - L.frame.x, gap = lifted ? 8 : 12;
    const fx = lifted ? 8 - L.frame.x : x0 + S + 12, fy = lifted ? screen.h - keyboard - 8 - S - L.frame.y : top;
    const fw = lifted ? screen.w - safeArea[1] - 8 - 8 - S - 8 : screen.w - safeArea[1] - 28 - (28 + S + 12) - (editing ? S + 12 : 0);
    return {a: {x: x0, y: top, w: S, h: S}, b: {x: fx, y: fy, w: fw, h: S}, c: editing ? {x: fx + fw + gap, y: fy, w: S, h: S} : null};
  };
  const m = useRef({mode: null as boolean | null, a: null as Track | null, b: null as Track | null, la: null as Track | null, lb: null as Track | null,
    c: null as Track | null, lc: null as Track | null, cp: null as Chan | null, closing: null as Box | null, p: null as Chan | null,
    icon: null as Track | null, mag: null as Track | null, fw: 286, follow: false, loop: frameLoop(scope),
    accLate: null as {at: number; apply: (t: number, b: Track) => Track} | null,
    band: null as {collapse: boolean; t0: number; from: number; c: Chan | null} | null, bandLoop: frameLoop(scope), bandOn: false}).current;
  const bandAt = (b: {collapse: boolean; t0: number; from: number; c: Chan | null}, t: number) => bandAtOf(b, t, accTop);
  const now = clock() * 1000, T = targets(), modeChanged = m.mode !== null && m.mode !== circled;
  if (searching) m.fw = T.b.w;
  const layout = (k: Track | null, b: Box) => (!k || modeChanged ? snapTo(b, now) : trackTo(k, b, now, false, LAYOUT));
  m.la = layout(m.la, T.a); m.lb = layout(m.lb, T.b);
  const la = boxOf(m.la, now), lbx = boxOf(m.lb, now);
  if (modeChanged) for (const [k, el] of [['a', platter('a')], ['b', platter('b')]] as const) {
    const pose = flexReset(el), t = m[k];
    if (!t || !pose) continue;
    const b = boxOf(t, now), cx = b.x + b.w / 2 + pose.translation[0], cy = b.y + b.h / 2 + pose.translation[1], w = b.w * pose.scale[0], h = b.h * pose.scale[1];
    m[k] = {cx: chan(cx, now), cy: chan(cy, now), w: chan(w, now), h: chan(h, now)};
  }
  if (modeChanged) m.follow = false;
  else if (!m.follow && !m.accLate && m.a && m.b && trackResting(m.a, now) && trackResting(m.b, now)) m.follow = true;
  if (accTop && m.b) {
    if (modeChanged) {
      const S0 = boxOf(m.b, now), D = lbx, k = m.b;
      if (Math.abs(S0.y + S0.h / 2 - (D.y + D.h / 2)) > 15) {
        const [first, second] = circled ? [ACC_COLLAPSE, ACC_COLLAPSE_LATE] : [ACC_EXPAND, ACC_EXPAND_LATE], xFirst = circled;
        const x = (s: Spring, t: number) => ({cx: steerTo(k.cx, D.x + D.w / 2, t, false, s), w: steerTo(k.w, D.w, t, false, s)});
        const y = (s: Spring, t: number) => ({cy: steerTo(k.cy, D.y + D.h / 2, t, false, s), h: steerTo(k.h, D.h, t, false, s)});
        m.b = {...k, ...(xFirst ? x(first, now) : y(first, now))};
        m.accLate = {at: now + 50, apply: (t, b) => ({...b, ...(xFirst ? y(second, t) : x(second, t))})};
      } else { m.b = trackTo(k, D, now, false, LAYOUT); m.accLate = null; }
    }
    if (m.accLate && now >= m.accLate.at) { m.b = m.accLate.apply(m.accLate.at, m.b); m.accLate = null; }
  }
  if (m.follow) { m.a = m.la; m.b = m.lb; }
  else {
    m.a = m.a ? trackTo(m.a, la, now) : snapTo(T.a, now);
    if (!accTop || !m.b) m.b = m.b ? trackTo(m.b, lbx, now) : snapTo(T.b, now);
  }
  const missingIn = (f: Box): Box => ({x: f.x + f.w / 2 - S * .2, y: f.y + f.h / 2 - S * .2, w: S * .4, h: S * .4});
  if (T.c) { m.closing = null; if (!m.lc) { m.lc = snapTo(T.c, now); m.c = snapTo(missingIn(boxOf(m.b, now)), now); m.cp = chan(0, now); } m.lc = trackTo(m.lc, T.c, now, false, LAYOUT); m.cp = steerTo(m.cp, 1, now, true); }
  else if (m.lc) {
    if (!m.closing) {
      m.closing = missingIn(T.b); m.lc = snapTo(m.closing, now);
      const pose = flexReset(platter('c'));
      if (pose && m.c) { const b = boxOf(m.c, now); m.c = {cx: chan(b.x + b.w / 2 + pose.translation[0], now), cy: chan(b.y + b.h / 2 + pose.translation[1], now), w: chan(b.w * pose.scale[0], now), h: chan(b.h * pose.scale[1], now)}; }
    }
    m.cp = steerTo(m.cp, 0, now, true);
  }
  if (m.lc) m.c = trackTo(m.c, boxOf(m.lc, now), now);
  if (m.closing && m.cp && m.c && resting(m.cp, now) && trackResting(m.c, now)) { m.c = m.lc = m.cp = null; m.closing = null; }
  m.p = steerTo(m.p, circled ? 1 : 0, now, true);
  const iconBar = (() => { const b0 = L.buttons[index] ?? {x: 0, y: 4, w: 0, h: 54}, f = iconFrame(back); return {x: b0.x + Math.round((b0.w - f[0]) / 2), y: b0.y + (f[2] ?? 6), w: f[0], h: f[1]}; })();
  const iconCircle = (() => { const f = iconFrame(back); return {x: (S - f[0]) / 2, y: (S - f[1]) / 2, w: f[0], h: f[1]}; })();
  const magCircle = {x: (L.search?.w ?? 62) / 2 - 14, y: (L.frame.h - 26.67) / 2, w: 28, h: 26.67}, magField = {x: 13, y: 14.33, w: 20.33, h: 18.67};
  m.icon = m.icon && !modeChanged ? m.icon : m.icon ? trackTo(m.icon, circled ? iconCircle : iconBar, now, true) : snapTo(circled ? iconCircle : iconBar, now);
  m.mag = m.mag && !modeChanged ? m.mag : m.mag ? trackTo(m.mag, searching ? magField : magCircle, now, true) : snapTo(searching ? magField : magCircle, now);
  if (modeChanged && accTop) {
    const minRel = screen.h - Math.min(safeArea[2], 28) - S - L.frame.y + accTop, cur = m.band ? bandAt(m.band, now) ?? (circled ? 0 : minRel) : circled ? 0 : minRel;
    m.band = circled ? {collapse: true, t0: now, from: cur, c: null} : {collapse: false, t0: now, from: cur, c: {from: cur, v: 0, to: 0, t0: now, ...POCKET_EXPAND}};
    m.bandOn = true;
  }
  m.mode = circled;
  const val = (c: Chan) => (resting(c, now) ? c.to : at(c, now).x);
  const A = boxOf(m.a, now), B = boxOf(m.b, now), C = m.c && m.lc ? boxOf(m.c, now) : null, p = val(m.p), cp = m.cp ? val(m.cp) : 0;
  const icon = boxOf(m.icon, now), mag = boxOf(m.mag, now);
  const tracks = () => [m.a!, m.b!, m.la!, m.lb!, m.icon!, m.mag!, ...(m.c ? [m.c, m.lc!] : [])];
  const settled = (t: number) => !m.accLate && tracks().every((k) => trackResting(k, t)) && resting(m.p!, t) && (!m.cp || resting(m.cp, t));
  const morphing = !settled(now) && !!m.p && !(p === (circled ? 1 : 0) && !m.c && settled(now));
  useEffect(() => { if (morphing || m.closing) m.loop.start(() => { commit(() => redraw((v) => v + 1)); return !settled(clock() * 1000) || !!m.closing; }); });
  useEffect(() => () => m.loop.stop(), []);
  useEffect(() => {
    if (!m.bandOn) return;
    m.bandOn = false;
    m.bandLoop.start(() => {
      const el = bars.current, v = m.band ? bandAt(m.band, clock() * 1000) : null;
      if (v === null) { m.band = null; if (el) delete el.dataset.lgBandTop; return false; }
      if (el) el.dataset.lgBandTop = v.toFixed(3);
      return true;
    });
  });
  useEffect(() => () => m.bandLoop.stop(), []);
  const fade = (o: number): CSSProperties => { const v = Math.max(0, Math.min(1, o)); return {opacity: v, filter: v < 1 ? `blur(${4 * (1 - v)}px)` : undefined}; };
  const pin = (o: number) => Math.max(0, Math.min(1, o / .65));
  const iconMoving = !(trackResting(m.icon, now) && trackResting(m.mag, now) && resting(m.p, now));
  const carried = circled || iconMoving;
  const cancel = () => { onSearchTextChange?.(''); field.current?.blur(); setEditing(false); };
  const [xHeld, setXHeld] = useState(false);
  const cancelPress = usePressHighlight(CANCEL_PRESS, {targets: (el) => [...el.querySelectorAll<HTMLElement>('[data-lg-cancel-x]')], onHeld: (h, sch) => setXHeld(h && sch === 'light')});
  const preview = (clip: Box, w: number, h: number, o: number, children: ReactNode) => {
    const k = circled || accTop ? clip.h / h : clip.w / w, v = Math.max(0, Math.min(1, o)), scaled = Math.abs(k - 1) > 1e-4;
    return <div aria-hidden={o < .5 || undefined} data-lg-layer={v < 1 || scaled ? `${v} ${k} ${4 * (1 - v)}` : undefined}
      style={{position: 'absolute', left: 0, top: 0, width: w, height: h, transform: scaled ? `scale(${k})` : undefined, transformOrigin: '0 0', ...fade(o)}}>{children}</div>;
  };
  const matched = (b: Box, f: number[], el: ReactNode, o: number, tone: 'blue' | 'tab-label' | null, sch: GlassScheme) => {
    const sx = b.w / f[0], sy = b.h / f[1], scaled = Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4, fill = {position: 'absolute', inset: 0, lineHeight: 0} as const;
    return <span aria-hidden="true" data-lg-scheme={sch} ref={(e) => present(e, {scale: scaled ? [sx, sy] : undefined})}
      style={{position: 'absolute', left: b.x + (b.w - f[0]) / 2, top: b.y + (b.h - f[1]) / 2, width: f[0], height: f[1], lineHeight: 0, opacity: tone ? o : undefined}}>
      { }
      {tone ? <Vibrant tone={tone} data-lg-tone-color={tone === 'blue' ? 'page' : undefined} style={fill}>{el}</Vibrant>
        : <GlassLayer style={fill}><span style={{...fill, color: toneCSS('label', sch, true, platform), opacity: o}}>{el}</span></GlassLayer>}
    </span>;
  };

  return (
    <Tabs.Root ref={root} className={className} value={searching ? -1 : index} onValueChange={(v) => choose(v as number)} style={{position: 'absolute', inset: 0, ...style}}>
      <div ref={measurers} aria-hidden="true" style={{position: 'absolute', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: LABEL}}>
        {tabs.map((t, i) => [<span key={`r${i}`} style={{position: 'absolute', fontWeight: MEDIUM}}>{t.title}</span>, <span key={`s${i}`} style={{position: 'absolute', fontWeight: SEMIBOLD}}>{t.title}</span>])}
      </div>
      { }
      {all.map((t, i) => (
        <div key={i} ref={(e) => { pages.current[i] = e; }} role="tabpanel" id={`${uid}-panel-${i}`} aria-labelledby={t.role === 'search' ? undefined : `${uid}-tab-${tabs.indexOf(t)}`}
          aria-label={t.role === 'search' ? t.title : undefined} aria-hidden={i !== page || undefined} inert={i !== page || undefined}
          {...(i === page ? {} : {'data-lg-hidden': ''})} style={{position: 'absolute', inset: 0, visibility: i === page ? undefined : 'hidden'}}>
          <TabBarVisibility.Provider value={reporters[i]}>{t.children}</TabBarVisibility.Provider>
        </div>
      ))}
      { }
      <div ref={bars} data-lg-edge="bottom" {...(hiddenBy[page] ? {'data-lg-hidden': '', inert: true} : {})} style={{position: 'absolute', left: 0, right: 0, top: L.frame.y - accTop, bottom: 0, pointerEvents: 'none', visibility: hiddenBy[page] ? 'hidden' : undefined}}>
        <Tabs.List ref={tablist} activateOnFocus onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
          data-lg-flex-scope="" style={{position: 'absolute', left: L.frame.x, top: accTop, width: L.frame.w, height: L.frame.h, pointerEvents: 'auto', touchAction: 'none', userSelect: 'none'}}>
          <GlassContainer spacing={6} animation={null} backdrop={lifted ? undefined : bars}>
            { }
            <Glass data-lg-tab-platter="a" data-lg-under-source={underKey} glassId="tab-bar" radius="capsule" bar interactive data-lg-flex-host="" data-lg-uikit-platter="" role={searching ? 'tab' : undefined} aria-label={searching ? back?.title : undefined}
              onPointerDown={circled ? (e) => e.stopPropagation() : undefined} onClick={searching ? () => { setEditing(false); choose(index); } : minimized ? () => setMinimized(false) : undefined}
              style={{position: 'absolute', left: A.x, top: A.y, width: A.w, height: A.h, overflow: iconMoving ? 'hidden' : undefined}}>
              {p < 1 && preview(A, L.frame.w, L.frame.h, 1 - p, <>
                {tabs.map((_, i) => content(i, false))}
                {!circled && tabs.map((t, i) => (
                  <Tabs.Tab key={i} value={i} nativeButton={false} data-lg-ring="" disabled={t.disabled} id={`${uid}-tab-${i}`} aria-controls={`${uid}-panel-${all.indexOf(t)}`} aria-label={t.title} render={<div />}
                    style={{position: 'absolute', left: L.buttons[i].x, top: L.buttons[i].y, width: L.buttons[i].w, height: L.buttons[i].h}} />
                ))}
                { }
                <div data-lg-dest-out="" aria-hidden="true" style={{position: 'absolute', left: lb.left, top: lb.top, width: lb.width, height: lb.height, pointerEvents: 'none'}} />
              </>)}
              { }
              { }
              {minimized && !iconMoving && back?.icon != null && <Vibrant aria-hidden="true" tone="blue" data-lg-tone-color="page" style={{position: 'absolute', inset: 0}}>{circleGlyph(back.icon)}</Vibrant>}
              {searching && !iconMoving && back?.icon != null && <Vibrant aria-hidden="true" tone="tab-label" style={{position: 'absolute', inset: 0}}>{circleGlyph(back.icon)}</Vibrant>}
            </Glass>
            { }
            {accTop > 0 && <Glass data-lg-tab-platter="b" glassId="tab-accessory" radius="capsule" bar interactive data-lg-uikit-platter="" onPointerDown={(e) => e.stopPropagation()}
              style={{position: 'absolute', left: B.x, top: B.y, width: B.w, height: B.h, overflow: 'hidden'}}>
              <div style={{position: 'absolute', inset: 0}}>{accessory}</div>
            </Glass>}
            { }
            {searchTab && L.search && <Glass data-lg-tab-platter="b" data-lg-under-source={underKey} glassId="tab-search" radius="capsule" bar interactive data-lg-uikit-platter="" role={searching ? undefined : 'tab'} aria-selected={searching ? undefined : false}
              aria-label={searching ? undefined : searchTab.title} onPointerDown={(e) => e.stopPropagation()} onClick={searching ? undefined : () => pick(searchTab)}
              onPointerUp={searching ? () => field.current?.focus() : undefined} style={{position: 'absolute', left: B.x, top: B.y, width: B.w, height: B.h, overflow: iconMoving ? 'hidden' : undefined, cursor: searching ? 'text' : undefined}}>
              {p > 0 && preview(B, m.fw, S, p, <>
                <input ref={field} type="search" className="lg-search-input" value={searchText} placeholder={searchPrompt} aria-label={searchPrompt} enterKeyHint="search" tabIndex={searching ? 0 : -1}
                  onChange={(e) => onSearchTextChange?.(e.target.value)} onFocus={() => setEditing(true)} onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
                  style={{position: 'absolute', left: 41.33, top: 14, right: 16, height: 20.333,
                    fontSize: 17, lineHeight: '20.333px', color: 'var(--lg-label)', caretColor: 'rgb(20, 111, 225)'}} />
              </>)}
              { }
              {!iconMoving && (searching ? <span aria-hidden="true" style={{position: 'absolute', left: 13, top: 14.33, color: toneCSS('label', platterScheme('b'), true), lineHeight: 0}}><NamedIcon name="magnifyingglass" size={17} /></span>
                : <Vibrant aria-hidden="true" tone="tab-label" style={{position: 'absolute', inset: 0}}>
                  {typeof searchTab.icon === 'string' || searchTab.icon == null ? <CentredSymbol name={typeof searchTab.icon === 'string' ? searchTab.icon : 'magnifyingglass'} side={L.search.w} height={L.frame.h} />
                    : <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{searchTab.icon}</div>}
                </Vibrant>)}
            </Glass>}
            {
}
            {C && <Glass data-lg-tab-platter="c" data-lg-band-skip="" glassId="tab-close" radius="capsule" bar interactive data-lg-uikit-platter="" role="button" aria-label="Cancel" onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); cancelPress(e); }}
              onClick={cancel} style={{position: 'absolute', left: C.x, top: C.y, width: C.w, height: C.h, color: 'var(--lg-label)', pointerEvents: m.closing ? 'none' : undefined}}>
              {preview(C, S, S, m.closing ? cp * cp : cp, <span data-lg-cancel-x="" style={{position: 'absolute', left: 37 / 3, top: 40 / 3, lineHeight: 0}}>{xHeld ? <Vibrant tone="tab-label"><NamedIcon name="xmark" size={17} variant="bar" /></Vibrant> : <NamedIcon name="xmark" size={17} variant="bar" />}</span>)}
            </Glass>}
          </GlassContainer>
          { }
          {
}
          {p < 1 && <div data-lg-group="" ref={(el) => { const mv = p > 0 || iconMoving, k = circled || accTop ? A.h / L.frame.h : A.w / L.frame.w, sc = mv && Math.abs(k - 1) > 1e-4;
            present(el, {opacity: p > 0 ? Math.max(0, 1 - p) : undefined, x: mv ? A.x - (sc ? (1 - k) * L.frame.w / 2 : 0) : undefined,
              y: mv ? A.y - (sc ? (1 - k) * L.frame.h / 2 : 0) : undefined, scale: sc ? [k, k] : undefined}); }} style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}><GlassContainer spacing={0} animation={null} live={adapted}>
            {
}
            {active ? lens.element(barScheme(), 'default', undefined, {children: tabs.map((_, i) => selectedContent(i))})
              : <Glass lens={rest} radius="capsule" style={{position: 'absolute', left: sb.x, top: sb.y, width: sb.w, height: sb.h, pointerEvents: 'none'}}>
                <div style={{position: 'absolute', left: -sb.x, top: -sb.y}}>{tabs.map((_, i) => selectedContent(i))}</div>
              </Glass>}
          </GlassContainer></div>}
          {
}
          { }
          {iconMoving && <div aria-hidden="true" data-lg-under={underKey} style={{position: 'absolute', left: -L.frame.x, top: -L.frame.y, width: screen.w, height: screen.h, pointerEvents: 'none'}}>
              {back?.icon != null && <>
                { }
                {matched({...icon, x: L.frame.x + A.x + icon.x, y: L.frame.y + A.y + icon.y}, iconFrame(back), matchedGlyph(back.icon), 1, 'blue', platterScheme('a'))}
                {matched({...icon, x: L.frame.x + A.x + icon.x, y: L.frame.y + A.y + icon.y}, iconFrame(back), matchedGlyph(back.icon), pin(circled ? p : 1 - p), searching ? 'tab-label' : 'blue', platterScheme('a'))}
              </>}
              {L.search && <>
                { }
                {matched({...mag, x: L.frame.x + B.x + mag.x, y: L.frame.y + B.y + mag.y}, searching ? [27.67, 26.67] : [20.33, 18.67],
                  searching ? <NamedIcon name="magnifyingglass" size={18} variant="tab" /> : <NamedIcon name="magnifyingglass" size={17} />, 1, searching ? 'blue' : null, platterScheme('b'))}
                {matched({...mag, x: L.frame.x + B.x + mag.x, y: L.frame.y + B.y + mag.y}, searching ? [20.33, 18.67] : [27.67, 26.67],
                  searching ? <NamedIcon name="magnifyingglass" size={17} /> : <NamedIcon name="magnifyingglass" size={18} variant="tab" />, pin(searching ? p : 1 - p), searching ? null : 'tab-label', platterScheme('b'))}
              </>}
          </div>}
        </Tabs.List>
      </div>
    </Tabs.Root>
  );
}
