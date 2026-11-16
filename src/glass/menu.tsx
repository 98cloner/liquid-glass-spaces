import {createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useFloating, useInteractions, useListNavigation, useTypeahead} from '@floating-ui/react';
import {commit, frameLoop, frameNow} from './frame';
import {Button, type ButtonProps} from './button';
import {Glass, GlassContainer, GlassLayer, NamedIcon, useFrameScope, useGlassInvalidate, useGlassPage, useLayoutChanged, useIcon, Vibrant} from './react';
import {layoutBox} from './renderer';
import type {GlassMotion} from './renderer';
import {ContextMenuMorph, MenuMorph, spring, step, to, type PanelMorph, type Spring} from './menuMorph';
import {supercircleURL} from './supercircle';
import {fallbackInk, MaterialInk} from './iconFallback';

function HighlightShape({dpr, opacity, shape}: {dpr: number; opacity: number; shape?: (el: HTMLImageElement | null) => void}) {
  return <img alt="" draggable={false} src={supercircleURL(W - 20, ROW, ROW / 2, dpr)} data-lg-highlight="" style={{display: 'block', width: W - 20, height: ROW, opacity}} ref={shape} />;
}
const same = (a: Section[] | null | undefined, b: Section[] | undefined): boolean => !!a === !!b && (!a || a.length === b!.length && a.every((s, i) => s.title === b![i].title && s.items.length === b![i].items.length
  && s.items.every((e, k) => e.part === b![i].items[k].part && same(e.sub, b![i].items[k].sub))));
const MAX_H = 520, W = 250, ROW = 42, PAD = 10, GAP = 21, HEADER = 121 / 3, INSET = 28, CHECK = 15, ICON = 36, ICON_X = 40, TITLE_TOP = 32 / 3, SUB_TITLE = 62;

/** Props of `MenuItem`. */
export interface MenuItemProps {
  /** The row's title. */
  children: ReactNode;
  /** Your icon, or an `iconSet` name. */
  icon?: string | ReactNode;
  /** Title and icon in red. */
  destructive?: boolean;
  /** Dimmed; it can't be chosen. */
  disabled?: boolean;
  /** A checkmark when true. Any row with `checked` set gives the menu a checkmark column. */
  checked?: boolean;
  /** Called when the row is chosen. */
  onSelect?: () => void;
}
type Part = ItemPart | {kind: 'section'; title?: string} | {kind: 'end'} | {kind: 'divider'} | {kind: 'subend'};
type ItemPart = {kind: 'item' | 'submenu'; props: MenuItemProps; open?: boolean};
type Collection = {parts: Map<Element, Part>; changed: () => void};
const Collect = createContext<Collection | null>(null);
function usePart(part: Part) {
  const c = useContext(Collect), ref = useRef<HTMLSpanElement>(null);
  if (c && ref.current) { const was = c.parts.get(ref.current); if (was) Object.assign(was, part); }
  useLayoutEffect(() => {
    const el = ref.current;
    if (!c || !el) return;
    c.parts.set(el, {...part}); c.changed();
    return () => { c.parts.delete(el); c.changed(); };
  }, [c]);
  return c ? <span ref={ref} data-menu-part="" /> : null;
}
/** A row of a menu. */
export function MenuItem(props: MenuItemProps) { return usePart({kind: 'item', props}); }
function SectionMark({title, end}: {title?: string; end?: boolean}) { return usePart(end ? {kind: 'end'} : {kind: 'section', title}); }
/** A group of rows, with an optional title. */
export function MenuSection({title, children}: {title?: string; children: ReactNode}) { return <><SectionMark title={title} />{children}<SectionMark end /></>; }
/** A break between groups of rows. */
export function MenuDivider() { return usePart({kind: 'divider'}); }
/** Props of `MenuSubmenu`. */
export interface MenuSubmenuProps {
  /** The row's title. */
  title: ReactNode;
  /** Your icon, or an `iconSet` name. */
  icon?: string | ReactNode;
  /** Dimmed; it can't be opened. */
  disabled?: boolean;
  /** Its rows. */
  children: ReactNode;
  /** Open as soon as the menu opens. @internal */
  defaultOpen?: boolean }
function SubmenuMark({title, icon, disabled, defaultOpen}: Omit<MenuSubmenuProps, 'children'>) { return usePart({kind: 'submenu', props: {children: title, icon, disabled}, open: defaultOpen}); }
function SubmenuEnd() { return usePart({kind: 'subend'}); }
/** A row with a chevron that opens its own rows in a panel over the menu; a tap on its title row, or on the menu behind, goes back. */
export function MenuSubmenu({children, ...row}: MenuSubmenuProps) { return <><SubmenuMark {...row} />{children}<SubmenuEnd /></>; }

type Entry = {part: ItemPart; sub?: Section[]};
type Section = {title?: string; items: Entry[]};
export type Handoff = {at: [number, number]; pointerId: number; pointerType: string; taken?: boolean; gone?: boolean};
function sectionsOf(box: Element, parts: Map<Element, Part>): Section[] {
  const list = [...box.querySelectorAll('[data-menu-part]')].map((el) => parts.get(el)).filter((p): p is Part => !!p);
  let i = 0;
  const parse = (): Section[] => {
    const out: Section[] = [];
    let open: Section | null = null;
    while (i < list.length) {
      const p = list[i++];
      if (p.kind === 'subend') break;
      if (p.kind === 'section') out.push(open = {title: p.title, items: []});
      else if (p.kind === 'end' || p.kind === 'divider') open = null;
      else { const e: Entry = {part: p, sub: p.kind === 'submenu' ? parse() : undefined}; if (!open) out.push(open = {items: []}); open.items.push(e); }
    }
    return out.filter((s) => s.items.length);
  };
  return parse();
}

type Laid = {rows: {item: Entry; y: number}[]; headers: {title: string; y: number}[]; separators: number[]; height: number; view: number};
function layout(sections: Section[], reversed: boolean, titled = false): Laid {
  const list = reversed ? [...sections].reverse().map((s) => ({...s, items: [...s.items].reverse()})) : sections;
  const out: Laid = {rows: [], headers: [], separators: [], height: 0, view: 0};
  let y = titled ? SUB_TITLE - PAD : 0;
  list.forEach((s, k) => {
    if (k || titled) { if (!titled || k) out.separators.push(y + PAD); y += s.title ? PAD + 1 : titled && !k ? GAP - 1 : GAP; } else if (!s.title) y = PAD;
    if (s.title) { out.headers.push({title: s.title, y}); y += HEADER - 2; }
    for (const item of s.items) { out.rows.push({item, y}); y += ROW; }
  });
  out.height = y + PAD; out.view = Math.min(out.height, MAX_H);
  return out;
}

/** Props of `Menu`, besides `Button`'s (its button). */
export interface MenuProps extends Omit<ButtonProps, 'children' | 'onClick'> {
  /** The button's title. */
  label: ReactNode;
  /** The rows: `<MenuItem>`, `<MenuSection>`, `<MenuDivider>`, `<MenuSubmenu>`. */
  children: ReactNode;
  /** Open, controlled; without it the menu keeps its own state. */
  open?: boolean;
  /** Called when it opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** The screen's safe area in CSS px, [top, right, bottom, left]: what it presents stays inside it. Default [62, 0, 34, 0], a phone in portrait. */
  safeArea?: [number, number, number, number];
  /** Scrolls a long panel by this much once open. @internal */
  scrollBy?: number;
  /** Row order: 'automatic', 'priority' (reversed when the panel opens upward, so the first row stays nearest the button) or 'fixed'. */
  order?: MenuOrder;
}

export type MenuOrder = 'automatic' | 'priority' | 'fixed';
export function reverses(order: MenuOrder, source: Element): boolean {
  if (order !== 'automatic') return order === 'priority';
  for (let e = source.parentElement; e; e = e.parentElement) { const s = getComputedStyle(e); if (/auto|scroll/.test(s.overflowY + ' ' + s.overflowX)) return false; }
  return true;
}

/** A glass button that opens a menu: a glass panel placed against the button, inside the safe area. Rows: `<MenuItem>`, grouped by `<MenuSection>` or split by `<MenuDivider>`; `<MenuSubmenu>` nests. */
export function Menu(props: MenuProps) {
  const {label, children, open, onOpenChange, safeArea, scrollBy, order, ...button} = props;
  const anchor = useRef<HTMLSpanElement>(null), glassEl = () => anchor.current?.firstElementChild as HTMLElement | null;
  const m = useMenuPresenter({children, open, onOpenChange, safeArea, scrollBy, order, source: glassEl, target: glassEl, content: false,
    copy: (motion) => <Button {...button} style={{...button.style, position: 'static', margin: 0}} motion={motion} shapeOnly tabIndex={-1} aria-hidden>{label}</Button>});
  const {press} = m;
  return (
    <>
      {
}
      <span ref={anchor} data-lg-hidden={m.shown ? '' : undefined} data-lg-portal={m.shown && m.morphing ? m.portalKey : undefined}
        style={{display: 'contents', visibility: m.shown && !m.closing && !m.morphing ? 'hidden' : undefined}}>
        <Button {...button} aria-haspopup="menu" aria-expanded={m.open} onPointerDown={(e) => { button.onPointerDown?.(e); if (!button.disabled && e.isPrimary) press.down(e.clientX, e.clientY, e.pointerId, e.pointerType); }}
          onClick={(e) => { if (e.detail === 0) { if (m.open) m.set(false); else m.openByKey('first'); } }}
          onKeyDown={(e) => { button.onKeyDown?.(e); if (!m.open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); m.openByKey(e.key === 'ArrowUp' ? 'last' : 'first'); } }}>{label}</Button>
      </span>
      {m.nodes}
    </>
  );
}

export type MenuSource = {source: () => HTMLElement | null; target: () => HTMLElement | null; copy: (motion: GlassMotion, rect: {w: number; h: number}) => ReactNode; content: boolean;
  scheme?: () => 'light' | 'dark' | undefined};

export function useMenuPresenter({children, open: given, onOpenChange, safeArea = [62, 0, 34, 0], scrollBy, order = 'automatic', source, target, copy, content, scheme, context}: MenuSource &
  {children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; safeArea?: [number, number, number, number]; scrollBy?: number; order?: MenuOrder;
   context?: {place: (source: {x: number; y: number; w: number; h: number}, h: number) => {x: number; y: number; up: boolean}}}) {
  const page = useGlassPage();
  const [own, setOwn] = useState(false), open = given ?? own;
  const set = (v: boolean) => { if (given === undefined) setOwn(v); onOpenChange?.(v); };
  const keyOpen = useRef<'first' | 'last' | null>(null);
  const openByKey = (row: 'first' | 'last') => { keyOpen.current = row; set(true); };
  const [place, setPlace] = useState<{x: number; y: number; up: boolean; reversed: boolean; align: number; bounds: {w: number; h: number; top: number; bottom: number}; button: {x: number; y: number; w: number; h: number}; scheme?: 'light' | 'dark'} | null>(null);
  const morph = useRef<PanelMorph | null>(null), [closing, setClosing] = useState(false), [, poke] = useState(0);
  const portalKey = useId(), [morphing, setMorphing] = useState(false);
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 3;
  const box = useRef<HTMLSpanElement>(null), [sections, setSections] = useState<Section[] | null>(null);
  const [collection] = useState<Collection>(() => {
    let queued = false;
    const c: Collection = {parts: new Map(), changed: () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; if (!box.current) return; const next = sectionsOf(box.current, c.parts); setSections((was) => same(was, next) ? was : next); });
    }};
    return c;
  });
  useLayoutEffect(() => { if (!box.current) return; const next = sectionsOf(box.current, collection.parts); if (!same(sections, next)) setSections(next); });
  const gesture = useRef<{x: number; y: number; at: [number, number]; valid: boolean; timer: number; opened: boolean; handoff?: Handoff; pointer: [number, string]; off: () => void} | null>(null);
  const glassEl = source;
  const onButton = (x: number, y: number) => { const r = target()?.getBoundingClientRect(); return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  const press = {
    down(x: number, y: number, pointerId: number, pointerType: string) {
      clearTimeout(gesture.current?.timer); gesture.current?.off();
      const on = (e: PointerEvent) => { if (e.pointerId !== pointerId) return; if (e.type === 'pointermove') press.move(e.clientX, e.clientY); else if (e.type === 'pointerup') press.up(e.clientX, e.clientY); else press.cancel(); };
      const off = () => { for (const t of ['pointermove', 'pointerup', 'pointercancel']) removeEventListener(t, on as EventListener, true); };
      for (const t of ['pointermove', 'pointerup', 'pointercancel']) addEventListener(t, on as EventListener, true);
      const g: NonNullable<typeof gesture.current> = {x, y, at: [x, y], valid: true, timer: 0, opened: false, pointer: [pointerId, pointerType], off};
      g.timer = window.setTimeout(() => { if (gesture.current === g && g.valid) { g.opened = true; g.handoff = {at: g.at, pointerId, pointerType}; set(true); } }, 150);
      gesture.current = g;
    },
    move(x: number, y: number) {
      const g = gesture.current; if (!g) return;
      g.at = [x, y];
      if (g.opened) { g.handoff!.at = [x, y]; return; }
      const el = glassEl(), k = el && el.offsetWidth ? el.offsetWidth / el.getBoundingClientRect().width : 1;
      if (g.valid && (Math.abs(x - g.x) * k > 10 || Math.abs(y - g.y) * k > 10)) { g.valid = false; clearTimeout(g.timer); }
    },
    up(x: number, y: number) {
      const g = gesture.current; if (!g) return;
      gesture.current = null; clearTimeout(g.timer); g.off();
      if (g.opened) { g.handoff!.gone = true; return; }
      if (g.valid && onButton(x, y)) set(true);
    },
    cancel() { const g = gesture.current; if (!g) return; gesture.current = null; clearTimeout(g.timer); g.off(); if (g.handoff) g.handoff.gone = true; },
  };
  useLayoutEffect(() => () => { clearTimeout(gesture.current?.timer); gesture.current?.off(); }, []);
  const heldOutside = useRef<Handoff | null>(null);
  const presentHeld = (h: Handoff) => { heldOutside.current = h; set(true); };
  const px = (v: number) => Math.floor(v * dpr + .5 + dpr / 64) / dpr;
  const below = (b: {y: number; h: number}, H: number) => {
    const p = 1 / dpr, frinta = (v: number) => Math.sign(v) * Math.round(Math.abs(v)) , round = (v: number) => frinta(v * dpr) / dpr;
    const top = Math.floor(b.y * dpr + .5 + dpr / 64) * p, hs = Math.round(b.h * dpr) * p, c = top + hs * .5, hp = Math.max(1, Math.floor(hs * dpr) / dpr);
    const preview = round(c + hp * -.5);
    return round((preview + H * .5) + H * -.5);
  };
  useLayoutEffect(() => {
    const glass = glassEl(), root = page() ?? glass?.closest<HTMLElement>('canvas > [drawable]') ?? null;
    if (!open) {
      if (morph.current && morph.current.phase === 'open') { morph.current.go('close', clock()); setClosing(true); }
      else if (!morph.current) setPlace(null);
      return;
    }
    if (!root || !glass || !sections) return;
    const b = layoutBox(glass, root), v = layoutBox(root, root), [top, right, bottom, left] = safeArea;
    if (!(b.w > 0 && b.h > 0)) { const f = requestAnimationFrame(() => poke((n) => n + 1)); return () => cancelAnimationFrame(f); }
    const at0 = context ? context.place(b, layout(sections, false).view) : null;
    const up = at0 ? at0.up : b.y + b.h / 2 >= v.h / 2, reversed = !at0 && up && reverses(order, glass), h = layout(sections, reversed).view;
    const c = b.x + b.w / 2;
    const align = at0 ? .5 : Math.abs(c - v.w / 2) <= 20 ? .5 : c < v.w / 2 ? 0 : 1;
    let x = at0 ? at0.x : align === .5 ? px(c - W / 2) : align === 0 ? px(b.x) : px(b.x + b.w) - W;
    if (!at0) x = Math.max(Math.max(8, left), Math.min(x, v.w - Math.max(8, right) - W));
    let y = at0 ? at0.y : up ? px(b.y + b.h) - h : below(b, h);
    if (!at0) y = Math.max(Math.max(8, top), Math.min(y, v.h - Math.max(8, bottom) - h));
    const button = {x: b.x, y: b.y, w: b.w, h: b.h};
    if (!morph.current || morph.current.phase === 'close') {
      morph.current ??= context ? new ContextMenuMorph(button, {x, y, w: W, h}) : new MenuMorph(button, {x, y, w: W, h}, dpr);
      morph.current.go('open', clock());
      setClosing(false);
    }
    morph.current.place(button, {x, y, w: W, h});
    const bounds = {w: v.w, h: v.h, top, bottom};
    setPlace((p) => p && p.x === x && p.y === y && p.up === up && p.reversed === reversed && p.align === align && p.bounds.h === v.h ? p : {x, y, up, reversed, align, bounds, button, scheme: p ? p.scheme : scheme?.()});
  });
  const isClosing = closing || (!open && !!morph.current);
  const root = page() ?? glassEl()?.closest<HTMLElement>('canvas > [drawable]') ?? null, shown = !!place && (open || isClosing);
  const nodes = <>
    <Collect.Provider value={collection}><span ref={box} style={{display: 'none'}}>{children}</span></Collect.Provider>
    {
}
    {shown && root && morph.current && sections && createPortal(<div style={{display: 'contents'}} onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onPointerCancel={stop} onClick={stop}><Panel sections={sections} {...place!} dpr={dpr} morph={morph.current} copy={copy} content={content} scheme={place!.scheme}
      close={() => set(false)} gone={() => { morph.current = null; setClosing(false); setPlace(null); }} closing={isClosing} scrollBy={scrollBy}
      held={gesture.current?.handoff ?? heldOutside.current} target={target} portalKey={portalKey} onMorphing={setMorphing} keyOpen={keyOpen} /></div>, root)}
  </>;
  return {press, presentHeld, open, set, openByKey, shown, closing: isClosing, morphing, portalKey, nodes};
}

const stop = (e: {stopPropagation: () => void}) => e.stopPropagation();

function probeNow(): number { return (window as unknown as {__submenuNow?: number}).__submenuNow ?? frameNow(); }
function clock() { return probeNow() / 1000; }

const SUB_GEO = [0.4, 0.85] as const, SUB_EXPAND = [0.2, 1] as const, SUB_BACK = [0.4, 1] as const, SUB_COLLAPSE = [0.5, 1] as const;
const SUB_OFFSET = 12, SUB_SCALE = 0.97, SUB_HOVER = 500;
type Rect = {x: number; y: number; w: number; h: number};
type Host = {at: [number, number]; top0: number; left: number; h0: number; a0: [number, number]; top1: number; h1: number; a1y: number; row: number};
type List = {sections: Section[]; laid: Laid; title?: MenuItemProps; titleLead?: number; parent: number; row: number; frame: Rect; from: Rect;
  geo: Spring; expand: Spring; scale: Spring; dim: Spring; leaving: boolean; motion: GlassMotion; scroll?: Scroll; host?: Host; widths?: number; carried?: number; fade?: Spring;
  live?: {spacing: number; gaussian: number; material: {size: [number, number]; progress: number; rim?: number} | null; copies: [number, number] | null};
  el?: HTMLElement | null; content?: HTMLElement | null; parts?: {regular?: HTMLElement | null; bold?: HTMLElement | null; right?: HTMLElement | null; svg?: SVGElement | null; boldIcon?: HTMLElement | null; icon?: HTMLElement | null; hl?: HTMLImageElement | null}};
type Scroll = {offset: number; max: number; v: number; frame: number; ind: [number, number][]; held: boolean; el?: HTMLElement | null; bar?: HTMLElement | null};
type Sel = {hot: number | null; y: Spring; color: Spring; root: Spring; t: number; loop: ReturnType<typeof frameLoop>; el?: HTMLElement | null};
const dimLayer = (el: HTMLElement, dim: number) => { if (dim < 1 - 1e-4) el.dataset.lgLayer = `${dim} 1 0`; else delete el.dataset.lgLayer; };

function Panel({sections, x, y, up, reversed, align, bounds, scrollBy, dpr, close, morph, copy, content, scheme, button, gone, closing, held, target, portalKey, onMorphing, keyOpen}: {sections: Section[]; x: number; y: number; up: boolean; reversed: boolean;
  align: number; bounds: {w: number; h: number; top: number; bottom: number}; scrollBy?: number;
  dpr: number; close: () => void; morph: PanelMorph; copy: MenuSource['copy']; content: boolean; scheme?: 'light' | 'dark'; button: {x: number; y: number; w: number; h: number}; gone: () => void; closing: boolean;
  held: Handoff | null; target: () => HTMLElement | null; portalKey: string; onMorphing: (running: boolean) => void; keyOpen: {current: 'first' | 'last' | null}}) {
  const laid = layout(sections, reversed), checks = sections.some((s) => s.items.some((i) => i.part.props.checked !== undefined)), lead = INSET + (checks ? CHECK : 0);
  const invalidate = useGlassInvalidate(), scope = useFrameScope();
  const [panelMotion] = useState<GlassMotion>(() => ({scale: [1, 1], translation: [0, 0], shape: [1, 1]})), [sourceMotion] = useState<GlassMotion>(() => ({scale: [1, 1], translation: [0, 0], shape: [1, 1]}));
  const [live] = useState(() => ({spacing: 0, gaussian: 0, material: null as {size: [number, number]; progress: number; from?: [number, number] | null; rim?: number; split?: {kind: 'button' | 'bar'; progress: number} | null} | null, scheme: null as 'light' | 'dark' | null, copies: null as [number, number] | null})), panelRef = useRef<HTMLSpanElement>(null), contentRef = useRef<HTMLDivElement>(null), sourceRef = useRef<HTMLSpanElement>(null);
  useState(() => Object.defineProperty(live, 'scheme', {get: () => scheme ?? null, configurable: true}));
  const [running, setRunning] = useState(true), settledRef = useRef(false), autoOpened = useRef(false);
  const [, rerender] = useState(0);
  const lists = useRef<List[]>([]);
  if (!lists.current.length) lists.current.push({sections, laid, parent: -1, row: -1, frame: {x, y, w: W, h: laid.view}, from: {x, y, w: W, h: laid.view}, geo: spring(1), expand: spring(1), scale: spring(1), dim: spring(1), leaving: false, motion: panelMotion});
  const root = lists.current[0];
  Object.assign(root, {sections, laid, frame: {x, y, w: W, h: laid.view}});
  const stackRoot = (m: GlassMotion) => {
    const s = root.scale.value, ax = (align - .5) * W, ay = (up ? .5 : -.5) * laid.view;
    m.scale = [m.scale[0] * s, m.scale[1] * s]; m.translation = [m.translation[0] + ax * (1 - s), m.translation[1] + ay * (1 - s) + rootShift()];
  };
  const hostOf = (L: List) => {
    const h = L.host!, p = L.geo.value;
    const H = h.h0 + (h.h1 - h.h0) * p, ay = h.a0[1] + (h.a1y - h.a0[1]) * p, top = h.at[1] - ay * H;
    return {top, menu: top + (h.top0 - h.top1) * p};
  };
  const rootShift = () => { const L = lists.current[lists.current.length - 1]; return L?.host ? hostOf(L).menu - L.host.top0 : 0; };
  const closingHost = useRef<{k: number; alpha: number; h: number} | null>(null);
  const fading = useRef<List[]>([]), [fadeLoop] = useState(() => frameLoop(scope));
  const fadeTick = () => {
    const now = clock(), dt = Math.min(.05, now - fadeT.current); fadeT.current = now;
    for (const L of fading.current) { step(L.fade!, dt); writeList(L); }
    const n = fading.current.length;
    fading.current = fading.current.filter((L) => Math.abs(L.fade!.value) > 1 / 512 || Math.abs(L.fade!.velocity) > .01);
    invalidate();
    if (fading.current.length !== n) commit(() => rerender((r) => r + 1));
    return fading.current.length > 0;
  };
  const fadeT = useRef(0);
  useEffect(() => () => fadeLoop.stop(), [fadeLoop]);
  useLayoutEffect(() => { onMorphing(running); return () => onMorphing(false); }, [running, onMorphing]);
  useLayoutEffect(() => {
    const loop = frameLoop(scope);
    settledRef.current = false;
    if (morph.phase === 'open' && morph.released && lists.current.length > 1) {
      const {value, velocity} = morph.released;
      for (const L of lists.current.slice(1)) { L.fade = {value, velocity, target: 0, response: .35, damping: .85}; fading.current.push(L); }
      lists.current = [root]; sels.current.length = 0;
      for (const c of [root.scale, root.dim]) Object.assign(c, {value: 1, velocity: 0, target: 1});
      closingHost.current = null; stackLoop.stop();
      fadeT.current = clock(); fadeLoop.start(fadeTick);
      rerender((r) => r + 1);
    }
    const tick = (): boolean => {
      const pinned = (window as unknown as {__menuMorphAt?: number}).__menuMorphAt, now = pinned !== undefined ? morph.started + pinned / 1000 : clock();
      morph.advance(now);
      const settled = morph.settled;
      (window as unknown as {__menuMorph?: object}).__menuMorph = {phase: morph.phase, started: morph.started * 1000, q: morph.pose().q};
      const p = morph.pose(), H = laid.view, panel = panelRef.current?.firstElementChild as HTMLElement | null, src = sourceRef.current?.querySelector<HTMLElement>('.lg-glass') ?? null;
      Object.assign(panelMotion, {scale: [p.scale, p.scale], translation: [p.panel.x + p.panel.w / 2 - (x + W / 2), p.panel.y + p.panel.h / 2 - (y + H / 2)], shape: [1, p.height / H], radius: p.panel.radius});
      stackRoot(panelMotion);
      Object.assign(sourceMotion, {scale: [p.source.h / button.h, p.source.h / button.h], translation: [p.source.x + p.source.w / 2 - (button.x + button.w / 2), p.source.y + p.source.h / 2 - (button.y + button.h / 2)],
        shape: [p.source.w / p.source.h * button.h / button.w, 1], radius: p.source.radius});
      live.gaussian = p.union;
      live.copies = settled && morph.phase === 'open' ? null : p.copies;
      const from: [number, number] | null = content ? (morph.phase === 'open' ? [W, W] : [button.w, button.h]) : null;
      live.material = settled && morph.phase === 'open' ? null : {size: [W, H], progress: p.q, from, rim: content ? 1 : p.q,
        split: morph.phase === 'close' ? {kind: content ? 'bar' as const : 'button' as const, progress: p.host} : null};
      if (contentRef.current) contentRef.current.style.translate = `0 ${(H - p.height) / 2}px`;
      const L = p.lens, lens = `${L.height} ${L.amount}`;
      const blur = (own: number) => Math.hypot(own, L.blur / L.scale);
      if (panel) {
        if (settled && morph.phase === 'open') { delete panel.dataset.lgLens; delete panel.dataset.lgGenerations; delete panel.dataset.lgConsumer; dimLayer(panel, root.dim.value); }
        else {
          panel.dataset.lgLayer = `${p.rows * root.dim.value} ${L.scale} ${blur(Math.max(0, 4 * (1 - p.q)) * p.scale)}`; panel.dataset.lgLens = lens;
          panel.dataset.lgGenerations = `${p.generations[0]} ${p.generations[1]}`; panel.dataset.lgConsumer = '1';
        }
      }
      if (src) {
        const ss = p.source.h / button.h, clipW = p.source.w / ss;
        src.dataset.lgPortalSpec = `${portalKey} ${p.expanded ? 1 : 0} ${clipW / button.w} ${p.source.x + p.source.w / 2} ${p.source.y + p.source.h / 2} ${ss} ${clipW} ${button.h} ${p.source.radius / ss} ${button.x} ${button.y} ${button.w} ${button.h} ${content ? 1 : 0}`;
        src.dataset.lgLayer = `${p.label} ${L.scale} ${blur(0)}`; src.dataset.lgLens = lens;
      }
      closingHost.current = morph.phase === 'close' ? {k: .2 + .8 * p.host, alpha: Math.max(0, Math.min(1, p.host)), h: p.host} : null;
      lists.current.forEach((S, i) => { if (i) writeList(S); });
      invalidate();
      if (!settled) return true;
      commit(() => {
      if (morph.phase === 'close') gone();
      else {
        setRunning(false); settledRef.current = true;
        const S = scrollOf(root);
        if (S.max > 0 && scrollBy) { S.offset = Math.max(0, Math.min(S.max, S.offset + scrollBy)); applyScroll(root); }
        else if (S.max > 0) showIndicator(S, false);
        const k = laid.rows.findIndex((r) => r.item.part.open && r.item.sub);
        if (k >= 0 && lists.current.length === 1 && !autoOpened.current) { autoOpened.current = true; push(0, k); }
      }
      });
      return false;
    };
    setRunning(true);
    if (tick()) loop.start(tick);
    return () => loop.stop();
  }, [morph, morph.phase, morph.started]);

  const sels = useRef<Sel[]>([]);
  const highlight = (li: number, k: number | null, instant = false) => {
    const L = lists.current[li]; if (!L) return;
    const ry = k === null ? null : L.laid.rows[k].y;
    let s = sels.current[li];
    if (!s) { if (ry === null) return; s = sels.current[li] = {hot: null, y: spring(ry), color: to(spring(0), 1, .3, 1), root: spring(1), t: probeNow() / 1000, loop: frameLoop(scope)}; }
    if (ry === null) to(s.root, 0, .3, 1);
    else {
      if (instant || (s.root.value === 0 && s.root.velocity === 0)) Object.assign(s.y, {value: ry, velocity: 0, target: ry}); else to(s.y, ry, .18, 1);
      if (instant) Object.assign(s.root, {value: 1, velocity: 0, target: 1}); else to(s.root, 1, .3, 1);
    }
    if (k !== null && s.hot !== k) { s.hot = k; rerender((n) => n + 1); }
    s.loop.stop();
    const sel = s;
    const tick = () => {
      const now = probeNow() / 1000;
      for (const c of [sel.y, sel.color, sel.root]) step(c, now - sel.t);
      sel.t = now;
      const el = sel.el;
      if (el) { el.style.top = `${sel.y.value}px`; (el.querySelector('[data-lg-highlight]') as HTMLElement | null)?.style.setProperty('opacity', String(Math.max(0, Math.min(1, sel.color.value * sel.root.value)))); }
      invalidate();
      return [sel.y, sel.color, sel.root].some((c) => c.value !== c.target || c.velocity !== 0);
    };
    sel.t = probeNow() / 1000;
    if (tick()) sel.loop.start(tick);
  };

  const syncRows = () => {
    const hidden = new Set(lists.current.flatMap((L, i) => (i && (L.leaving || L.geo.value !== L.geo.target || L.geo.velocity !== 0) ? [`${L.parent}:${L.row}`] : [])));
    lists.current.forEach((P, i) => (i ? P.content : contentRef.current)?.querySelectorAll<HTMLElement>('[data-menu-row]').forEach((r) => { r.style.opacity = hidden.has(`${i}:${r.dataset.menuRow}`) ? '0' : ''; }));
  };
  useLayoutEffect(syncRows);
  const [stackLoop] = useState(() => frameLoop(scope)), stackT = useRef(0), relayout = useLayoutChanged();
  const animate = () => {
    stackLoop.stop();
    stackT.current = probeNow() / 1000;
    const tick = () => {
      const now = probeNow() / 1000, dt = now - stackT.current; stackT.current = now;
      let busy = false;
      const all = lists.current;
      for (const L of all) for (const c of [L.geo, L.expand, L.scale]) { step(c, dt); busy ||= c.value !== c.target || c.velocity !== 0; }
      const open = all.filter((L) => !L.leaving);
      open.forEach((L, i) => { if (i < open.length - 1) { const a = 1 - .5 * open[i + 1].geo.value; Object.assign(L.dim, {value: a, target: a, velocity: 0}); } });
      for (const L of all) { step(L.dim, dt); busy ||= L.dim.value !== L.dim.target || L.dim.velocity !== 0; }
      if (settledRef.current) {
        Object.assign(panelMotion, {scale: [1, 1], translation: [0, 0], shape: [1, 1], radius: undefined});
        stackRoot(panelMotion);
        const el = panelRef.current?.firstElementChild as HTMLElement | null;
        if (el) dimLayer(el, root.dim.value);
      }
      all.forEach((L, i) => { if (i) writeList(L); });
      invalidate();
      const gone = all.filter((L, i) => i && L.leaving && L.geo.value === L.geo.target && L.geo.velocity === 0 && all[L.parent].dim.value === all[L.parent].dim.target);
      syncRows();
      if (gone.length) { lists.current = all.filter((L) => !gone.includes(L)); sels.current.length = Math.min(sels.current.length, lists.current.length); commit(() => rerender((n) => n + 1)); }
      if (!busy) relayout();
      return busy;
    };
    if (tick()) stackLoop.start(tick);
  };
  const writeList = (L: List) => {
    const f = L.fade?.value, c0 = f !== undefined ? {k: .2 + .8 * f, alpha: Math.max(0, Math.min(1, f)), h: f} : closingHost.current;
    const p = L.geo.value, e = Math.max(0, Math.min(1, L.expand.value)), F = L.frame, s = L.scale.value, h = L.host!, {top} = hostOf(L);
    const A1y = up ? 1 : 0, w0 = W - 2 * PAD, S = [w0 + (W - w0) * p, ROW + (F.h - ROW) * p], A = L.leaving ? [0, A1y] : [h.a0[0] * (1 - p), h.a0[1] + (A1y - h.a0[1]) * p];
    const P0 = L.leaving ? [PAD, h.row + ROW * A1y] : [PAD + w0 * h.a0[0], h.row + ROW * h.a0[1]], P1 = [0, F.y - h.top1 + A1y * F.h];
    const cur = {x: h.left + P0[0] + (P1[0] - P0[0]) * p - A[0] * S[0], y: top + P0[1] + (P1[1] - P0[1]) * p - A[1] * S[1], w: S[0], h: S[1]};
    const t = [cur.x + cur.w / 2 - (F.x + F.w / 2), cur.y + cur.h / 2 - (F.y + F.h / 2)];
    const ax = F.x + align * F.w, ay = up ? F.y + F.h : F.y, c = [cur.x + cur.w / 2, cur.y + cur.h / 2], c1 = [ax + (c[0] - ax) * s, ay + (c[1] - ay) * s];
    const k = c0 ? c0.k : 1, c2 = [h.at[0] + (c1[0] - h.at[0]) * k, h.at[1] + (c1[1] - h.at[1]) * k];
    Object.assign(L.motion, {scale: [s * k, s * k], translation: [c2[0] - (F.x + F.w / 2), c2[1] - (F.y + F.h / 2)], shape: [cur.w / F.w, cur.h / F.h], radius: Math.min(32, cur.h / 2) * s * k});
    if (L.content) L.content.style.translate = `${cur.x - PAD * (1 - p) - F.x - t[0]}px ${cur.y - PAD * (1 - p) - F.y - t[1]}px`;
    if (L.el) { const ph = (v: number) => { const d = v * dpr; return d - Math.floor(d + 1e-6); }; L.el.dataset.lgPhase = `${ph(cur.x)} ${ph(cur.y)}`; }
    if (L.live) {
      L.live.material = c0 ? {size: [W, F.h], progress: c0.h, rim: Math.max(0, c0.h)} : p !== 1 || L.leaving ? {size: [W, F.h], progress: p, rim: Math.max(0, p)} : null;
      L.live.copies = c0 && c0.alpha < 1 ? [c0.alpha, 0] : null;
    }
    const q = L.parts;
    if (q) {
      if (q.regular) q.regular.style.opacity = String(1 - e);
      if (q.bold) q.bold.style.opacity = String(e);
      if (q.regular && q.bold) {
        const width = (el: HTMLElement) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; };
        const r = (L.widths ??= (width(q.regular) > 0 ? width(q.bold) / width(q.regular) : 1) || 1);
        q.regular.style.transform = `scaleX(${1 + (r - 1) * e})`; q.bold.style.transform = `scaleX(${1 / r + (1 - 1 / r) * e})`;
      }
      if (q.icon && q.boldIcon) { q.icon.style.opacity = String(1 - e); q.boldIcon.style.opacity = String(e); }
      if (q.right) q.right.dataset.lgRotate = String(90 * e);
      if (q.svg) q.svg.style.rotate = `${90 * e}deg`;
      if (q.hl) q.hl.style.opacity = String((1 - e) * (L.carried ?? 1));
    }
    if (L.el) dimLayer(L.el, L.dim.value);
  };
  const retarget = (geo: readonly [number, number]) => {
    const open = lists.current.filter((L) => !L.leaving), n = open.length;
    open.forEach((L, i) => to(L.scale, Math.max(.5, Math.min(1, SUB_SCALE ** (n - 1 - i))), geo[0], geo[1]));
    to(open[n - 1].dim, 1, SUB_BACK[0], SUB_BACK[1]);
  };
  const top = () => { const open = lists.current.filter((L) => !L.leaving); return lists.current.indexOf(open[open.length - 1]); };
  const push = (li: number, k: number) => {
    const P = lists.current[li], entry = P.laid.rows[k].item, sub = entry.sub;
    if (!sub || entry.part.props.disabled) return;
    clearTimeout(hover.current);
    const L0 = layout(sub, reversed, true), h = L0.view, n = lists.current.filter((L) => !L.leaving).length;
    const ps = Math.max(.5, SUB_SCALE ** n), py = up ? P.frame.y + P.frame.h : P.frame.y, rowTop = py + (P.frame.y + P.laid.rows[k].y - scrollOf(P).offset - py) * ps;
    let sy = up ? Math.min(rowTop - SUB_OFFSET, P.frame.y + P.frame.h - SUB_OFFSET - h) : Math.max(rowTop - SUB_OFFSET, P.frame.y + SUB_OFFSET);
    sy = Math.max(Math.max(8, bounds.top), Math.min(sy, bounds.h - Math.max(8, bounds.bottom) - h));
    const from = {x: P.frame.x + PAD, y: P.frame.y + P.laid.rows[k].y - scrollOf(P).offset, w: W - 2 * PAD, h: ROW};
    const pChecks = P.sections.some((s) => s.items.some((i) => i.part.props.checked !== undefined));
    const open = lists.current.slice(0, li + 1).filter((Q) => !Q.leaving), top0 = Math.min(...open.map((Q) => Q.frame.y)), bottom0 = Math.max(...open.map((Q) => Q.frame.y + Q.frame.h));
    const at: [number, number] = [button.x + button.w / 2, button.y + button.h / 2], top1 = Math.min(top0, sy), h1 = Math.max(bottom0, sy + h) - top1;
    const host: Host = {at, top0, left: P.frame.x, h0: bottom0 - top0, a0: [(at[0] - P.frame.x) / W, (at[1] - top0) / (bottom0 - top0)], top1, h1, a1y: (at[1] - top1) / h1, row: from.y - top0};
    const L: List = {sections: sub, laid: L0, title: entry.part.props, titleLead: INSET + (pChecks ? CHECK : 0), parent: li, row: k, frame: {x: P.frame.x, y: sy, w: W, h}, from,
      geo: to(spring(0), 1, SUB_GEO[0], SUB_GEO[1]), expand: to(spring(0), 1, SUB_EXPAND[0], SUB_EXPAND[1]), scale: spring(1), dim: spring(1), leaving: false,
      motion: {scale: [1, 1], translation: [0, 0], shape: [from.w / W, from.h / h]}, host, live: {spacing: 0, gaussian: 0, material: {size: [W, h], progress: 0}, copies: null}};
    scrollOf(L);
    lists.current = [...lists.current.slice(0, li + 1), L]; sels.current.length = Math.min(sels.current.length, li + 1);
    highlight(li, k, true);
    const s = sels.current[li]; if (s) to(s.root, 0, SUB_EXPAND[0], SUB_EXPAND[1]);
    L.carried = s ? Math.max(0, Math.min(1, s.color.value)) : 0;
    retarget(SUB_GEO);
    writeList(L);
    rerender((r) => r + 1);
    animate();
  };
  const pop = (li: number) => {
    clearTimeout(hover.current);
    lists.current.forEach((L, i) => { if (i > li && !L.leaving) { L.leaving = true; to(L.geo, 0, SUB_BACK[0], SUB_BACK[1]); to(L.expand, 0, SUB_COLLAPSE[0], SUB_COLLAPSE[1]); const s = sels.current[i]; if (s) to(s.root, 0, .3, 1); } });
    retarget(SUB_BACK);
    rerender((r) => r + 1);
    animate();
  };

  const hit = (cx: number, cy: number) => {
    const all = lists.current;
    for (let i = all.length - 1; i >= 0; i--) {
      const L = all[i], el = i ? L.el : panelRef.current?.firstElementChild as HTMLElement | null;
      if (!el || L.leaving) continue;
      const r = el.getBoundingClientRect(), px = (cx - r.left) * W / r.width, vy = (cy - r.top) * L.laid.view / r.height, py = vy + scrollOf(L).offset;
      if (px < 0 || px > W || vy < 0 || vy > L.laid.view) continue;
      const k = L.laid.rows.findIndex((row) => py >= row.y && py < row.y + ROW);
      return {li: i, k: k >= 0 && !L.laid.rows[k].item.part.props.disabled ? k : null, title: i > 0 && py >= PAD && py < PAD + ROW};
    }
    return null;
  };
  const rowAt = (cx: number, cy: number) => { const h = hit(cx, cy); return h && h.li === top() ? h.k : null; };
  const scrollOf = (L: List): Scroll => (L.scroll ??= {offset: reversed ? L.laid.height - L.laid.view : 0, max: L.laid.height - L.laid.view, v: 0, frame: 0, ind: [[0, 0]], held: false});
  const applyScroll = (L: List) => {
    const S = scrollOf(L);
    if (S.el) S.el.style.translate = `0 ${-S.offset}px`;
    if (S.bar && S.max > 0) {
      const v = L.laid.view, T = v - 66, len = T * (v / L.laid.height) ** .65, over = S.offset < 0 ? -S.offset : S.offset > S.max ? S.offset - S.max : 0, l = Math.max(7, len - over);
      S.bar.style.height = `${l}px`;
      S.bar.style.top = `${33 + (S.offset <= 0 ? 0 : S.offset >= S.max ? T - l : (T - len) * S.offset / S.max)}px`;
      S.bar.style.opacity = String(opacityAt(S, probeNow() / 1000));
    }
    invalidate();
  };
  const opacityAt = (S: Scroll, t: number) => {
    const k = S.ind; if (t <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) if (t < k[i][0]) { const q = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]); return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * q * q * (3 - 2 * q); }
    return k[k.length - 1][1];
  };
  const showIndicator = (S: Scroll, held: boolean) => {
    const now = probeNow() / 1000, cur = opacityAt(S, now);
    S.held = held; S.ind = held ? [[now, 1]] : [[now, cur], [now + .5, 1], [now + 1.5, 1], [now + 2, 0]];
    runScroll();
  };
  const stopScroll = (S: Scroll) => { S.v = 0; };
  const fling = (L: List, v: number) => { const S = scrollOf(L); S.v = v; runScroll(); };
  const scrollT = useRef(0), [scrollLoop] = useState(() => frameLoop(scope));
  const runScroll = () => {
    scrollLoop.stop();
    scrollT.current = probeNow();
    const tick = () => {
      const now = probeNow(), dt = Math.min(50, now - scrollT.current); scrollT.current = now;
      let busy = false;
      for (const L of lists.current) {
        const S = L.scroll; if (!S) continue;
        const dragging = pressed.current?.scrolling && L === lists.current[top()];
        if (!dragging) {
          const edge = S.offset < 0 ? 0 : S.offset > S.max ? S.max : null;
          if (S.v || edge !== null) {
            const E = (z: number) => (z < -.5 ? Math.exp(z) : 1 + z * (1 + .5 * z)), a = E(Math.log(.998) * dt), b = edge === null ? 1 : E(-.01005 * dt), e = edge ?? 0;
            S.offset = e + (S.offset - e) * b + (.998 * b * S.v * (1 - a)) / (1 - .998); S.v *= a * b;
            if (edge !== null && Math.abs(S.offset - edge) < 0.25 / dpr && Math.abs(S.v) < .005) { S.offset = edge; S.v = 0; }
            else if (edge === null && Math.abs(S.v) < .01) S.v = 0;
          }
          if (!S.v && S.held) { const now = probeNow() / 1000; S.held = false; S.ind = [[now, 1], [now + 1, 1], [now + 1.25, 0]]; }
        }
        applyScroll(L);
        busy ||= !!dragging || !!S.v || S.offset < 0 || S.offset > S.max || S.held || probeNow() / 1000 < S.ind[S.ind.length - 1][0];
      }
      return busy;
    };
    if (tick()) scrollLoop.start(tick);
  };
  const rubber = (raw: number, max: number, d: number) => raw < 0 ? -(1 - 1 / (-raw * .55 / d + 1)) * d : raw > max ? max + (1 - 1 / ((raw - max) * .55 / d + 1)) * d : raw;
  const hover = useRef(0);
  const highlightTop = (k: number | null) => {
    const li = top();
    highlight(li, k);
    clearTimeout(hover.current);
    if (k !== null && lists.current[li].laid.rows[k].item.sub) hover.current = window.setTimeout(() => { if (pressed.current && top() === li && sels.current[li]?.hot === k) { push(li, k); lastRow.current = null; } }, SUB_HOVER);
  };
  const pressed = useRef<{x: number; y: number; moved: boolean; handed: boolean; timer: number; inert?: boolean; scrolling?: boolean; o0?: number; pts?: [number, number][]} | null>(null);
  const lastRow = useRef<number | null>(null);
  const finger = {
    down(cx: number, cy: number) {
      clearTimeout(pressed.current?.timer);
      lastRow.current = rowAt(cx, cy);
      const handed = taking.current; taking.current = false;
      const S = scrollOf(lists.current[top()]);
      stopScroll(S);
      const inert = S.max > 0 && handed;
      pressed.current = {x: cx, y: cy, moved: false, handed, inert, o0: S.offset, pts: [[probeNow(), cy]],
        timer: handed || inert ? 0 : window.setTimeout(() => { if (pressed.current && !pressed.current.moved && !pressed.current.scrolling) highlightTop(lastRow.current); }, 150)};
    },
    move(cx: number, cy: number) {
      const p = pressed.current; if (!p) return;
      const k = rowAt(cx, cy), el = panelRef.current?.firstElementChild as HTMLElement | null, scale = el ? W * root.scale.value / el.getBoundingClientRect().width : 1;
      const L = lists.current[top()], S = scrollOf(L);
      if (p.handed && S.max > 0) return;
      if (S.max > 0 && !p.scrolling && Math.abs(cy - p.y) * scale >= 10 && Math.abs(cy - p.y) >= Math.abs(cx - p.x)) {
        p.scrolling = true; clearTimeout(p.timer); clearTimeout(hover.current); highlight(top(), null); showIndicator(S, true);
      }
      if (p.scrolling) {
        const raw = p.o0! + (p.y - cy) * scale;
        S.offset = rubber(raw, S.max, L.laid.view);
        p.pts!.push([probeNow(), cy]); if (p.pts!.length > 8) p.pts!.shift();
        applyScroll(L);
        return;
      }
      if (p.inert) return;
      if (!p.moved && Math.hypot(cx - p.x, cy - p.y) * scale >= 10) { p.moved = true; clearTimeout(p.timer); highlightTop(k); }
      else if (p.moved && k !== lastRow.current) highlightTop(k);
      lastRow.current = k;
    },
    up(cx: number, cy: number) {
      const p = pressed.current; if (!p) return;
      clearTimeout(p.timer); clearTimeout(hover.current); pressed.current = null;
      if (p.handed) giveBack('pointerup', cx, cy);
      if (p.scrolling) {
        const el = panelRef.current?.firstElementChild as HTMLElement | null, scale = el ? W * root.scale.value / el.getBoundingClientRect().width : 1, now = probeNow();
        const pts = p.pts!.filter(([t]) => now - t < 100), a = pts[0], b = pts[pts.length - 1];
        fling(lists.current[top()], a && b && b[0] > a[0] ? -(b[1] - a[1]) * scale / (b[0] - a[0]) : 0);
        return;
      }
      { const L = lists.current[top()], S = scrollOf(L); if (S.offset < 0 || S.offset > S.max) fling(L, 0); }
      if (p.inert) return;
      const h = hit(cx, cy), li = top();
      if (p.handed && !p.moved) { highlight(li, null); return; }
      if (h && h.li === li && h.k !== null) {
        const entry = lists.current[li].laid.rows[h.k].item;
        if (entry.sub) push(li, h.k);
        else { entry.part.props.onSelect?.(); close(); }
      } else if (h && h.li === li && h.title) { highlight(li, null); pop(li - 1); }
      else if (h && h.li < li) { highlight(li, null); pop(h.li); }
      else highlight(li, null);
    },
    cancel() { const p = pressed.current; if (p) { clearTimeout(p.timer); if (p.handed) giveBack('pointercancel', p.x, p.y); } clearTimeout(hover.current); pressed.current = null; highlight(top(), null); },
  };
  const giveBack = (type: string, cx: number, cy: number) => {
    const el = target(), id = held?.pointerId;
    if (el && id !== undefined) setTimeout(() => el.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: held!.pointerType, isPrimary: true, clientX: cx, clientY: cy})));
  };
  const taking = useRef(false);
  useLayoutEffect(() => {
    const el = panelRef.current?.firstElementChild as HTMLElement | null;
    if (!held || !el || held.taken || held.gone) return;
    held.taken = true; taking.current = true;
    const button = target(); if (button) button.dataset.lgHanded = '';
    el.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, composed: true, pointerId: held.pointerId, pointerType: held.pointerType, isPrimary: true,
      clientX: held.at[0], clientY: held.at[1], button: 0, buttons: 1}));
    taking.current = false;
  }, [held]);
  useLayoutEffect(() => () => { scrollLoop.stop(); for (const s of sels.current) s?.loop.stop(); stackLoop.stop(); clearTimeout(pressed.current?.timer); clearTimeout(hover.current); }, []);
  const handlers = {onPointerDown: (e: React.PointerEvent) => finger.down(e.clientX, e.clientY), onPointerMove: (e: React.PointerEvent) => finger.move(e.clientX, e.clientY),
    onPointerUp: (e: React.PointerEvent) => finger.up(e.clientX, e.clientY), onPointerCancel: () => finger.cancel(),
    onLostPointerCapture: (e: React.PointerEvent) => finger.up(e.clientX, e.clientY)};
  const navTop = top(), navList = lists.current[navTop];
  const [active, setActive] = useState<number | null>(null);
  const navRows = useRef<(HTMLElement | null)[]>([]), navLabels = useRef<(string | null)[]>([]), keyed = useRef(false), pending = useRef<number | 'first' | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  navRows.current.length = navLabels.current.length = navList?.laid.rows.length ?? 0;
  const enabled = (k: number) => !!navList?.laid.rows[k] && !navList.laid.rows[k].item.part.props.disabled;
  const edgeRow = (from: 'first' | 'last') => { const n = navList?.laid.rows.length ?? 0; for (let i = 0; i < n; i++) { const k = from === 'first' ? i : n - 1 - i; if (enabled(k)) return k; } return null; };
  const {context} = useFloating({open: !closing});
  const listNav = useListNavigation(context, {listRef: navRows, activeIndex: active, onNavigate: (i) => { if (i !== null) { keyed.current = true; setActive(i); } }, loop: true,
    focusItemOnOpen: false, focusItemOnHover: false, openOnArrowKeyDown: false, scrollItemIntoView: false, disabledIndices: (i) => !enabled(i)});
  const typeahead = useTypeahead(context, {listRef: navLabels, activeIndex: active, onMatch: (i) => { keyed.current = true; setActive(i); }});
  const {getFloatingProps, getItemProps} = useInteractions([listNav, typeahead]);
  const back = () => { const li = top(), L = lists.current[li]; if (li > 0) { pending.current = L.row; pop(L.parent); } else close(); };
  const rowKey = (k: number) => (e: React.KeyboardEvent) => {
    const li = top(), entry = lists.current[li]?.laid.rows[k]?.item; if (!entry) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); if (entry.part.props.disabled) return;
      if (entry.sub) { pending.current = 'first'; push(li, k); } else { entry.part.props.onSelect?.(); close(); }
    } else if (e.key === 'ArrowRight' && entry.sub) { e.preventDefault(); pending.current = 'first'; push(li, k); }
    else if (e.key === 'ArrowLeft' && li > 0) { e.preventDefault(); back(); }
  };
  const navProps = (k: number) => ({ref: (el: HTMLElement | null) => { navRows.current[k] = el; navLabels.current[k] = el?.textContent ?? null; }, tabIndex: k === active ? 0 : -1,
    ...getItemProps({onKeyDown: rowKey(k)})});
  useLayoutEffect(() => { const w = keyOpen.current; if (!w) return; keyOpen.current = null; keyed.current = true; setActive(edgeRow(w)); }, []);
  const shownTop = useRef(navTop);
  useLayoutEffect(() => {
    if (shownTop.current === navTop) return;
    shownTop.current = navTop;
    const p = pending.current; pending.current = null;
    setActive(p === 'first' ? edgeRow('first') : p);
  }, [navTop]);
  useLayoutEffect(() => {
    if (active === null || !keyed.current || closing) return;
    const L = lists.current[navTop]; if (!L?.laid.rows[active]) return;
    highlight(navTop, active);
    const S = scrollOf(L), ry = L.laid.rows[active].y;
    if (S.max > 0) {
      const o = Math.max(0, Math.min(S.max, ry < S.offset + PAD ? ry - PAD : ry + ROW > S.offset + L.laid.view - PAD ? ry + ROW + PAD - L.laid.view : S.offset));
      if (o !== S.offset) { S.offset = o; applyScroll(L); }
    }
    navRows.current[active]?.focus({preventScroll: true});
  }, [active, navTop]);
  useEffect(() => {
    if (closing) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); keyed.current = true; back(); return; }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !wrapper.current?.contains(document.activeElement)) {
        e.preventDefault(); keyed.current = true;
        const k = edgeRow(e.key === 'ArrowUp' ? 'last' : 'first'); if (k === active && k !== null) navRows.current[k]?.focus({preventScroll: true}); else setActive(k);
      }
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  });
  useLayoutEffect(() => { if (closing && wrapper.current?.contains(document.activeElement)) target()?.focus({preventScroll: true}); }, [closing]);
  const snapAt = (fx: number, fy: number) => (ry: number) => (v: number, axis: 0 | 1) => Math.floor((v + (axis ? fy + ry : fx)) * dpr + .5 + 1e-6) / dpr - (axis ? fy + ry : fx);
  return (
    <div ref={wrapper} style={{display: 'contents'}} {...getFloatingProps()} onPointerDownCapture={() => { keyed.current = false; }}>
      {
}
      {
}
      {!closing && <GlassLayer style={{position: 'absolute', inset: 0, touchAction: 'none'}} onPointerDown={(e) => { e.preventDefault(); close(); }} />}
      <GlassContainer spacing={0} animation={null} live={live}>
      {running && <span ref={sourceRef} style={{display: 'contents'}}>
        { }
        <span style={{position: 'absolute', left: button.x, top: button.y, pointerEvents: 'none'}}>
          {copy(sourceMotion, button)}
        </span>
      </span>}
      <span ref={panelRef} style={{display: 'contents'}}>
      <Glass role="menu" radius={32} interactive flex="menu" motion={panelMotion} style={{position: 'absolute', left: x, top: y, width: W, height: laid.view, fontSize: 17, lineHeight: `${61 / 3}px`, userSelect: 'none', pointerEvents: closing ? 'none' : undefined}}
        {...handlers}>
        { }
        <div ref={contentRef} style={{position: 'absolute', inset: 0}}>
          <Scrolled scroll={scrollOf(root)} height={laid.height}>
            <ListContent laid={laid} lead={lead} checks={checks} sel={sels.current[0]} dpr={dpr} snap={snapAt(x, y - scrollOf(root).offset)} nav={navTop === 0 ? navProps : undefined} />
          </Scrolled>
        </div>
        <Indicator scroll={scrollOf(root)} />
      </Glass>
      </span>
      </GlassContainer>
      {lists.current.map((L, i) => i > 0 && <SubList key={`${i}:${L.parent}:${L.row}`} list={L} nav={navTop === i ? navProps : undefined} sel={sels.current[i]} dpr={dpr} snap={snapAt(Math.floor(L.frame.x * dpr + 1e-6) / dpr, Math.floor(L.frame.y * dpr + 1e-6) / dpr)} closing={closing} handlers={handlers} />)}
      {fading.current.map((L, i) => <SubList key={`f${i}:${L.parent}:${L.row}`} list={L} dpr={dpr} snap={snapAt(Math.floor(L.frame.x * dpr + 1e-6) / dpr, Math.floor(L.frame.y * dpr + 1e-6) / dpr)} closing handlers={handlers} />)}
    </div>
  );
}

function Scrolled({scroll, height, children}: {scroll: Scroll; height: number; children: ReactNode}) {
  return <div data-lg-viewport="" style={{position: 'absolute', inset: 0, overflow: 'hidden'}}>
    <div ref={(el) => { scroll.el = el; }} data-lg-exact="" style={{position: 'absolute', left: 0, top: 0, width: W, height, translate: `0 ${-scroll.offset}px`}}>{children}</div>
  </div>;
}
function Indicator({scroll}: {scroll: Scroll}) {
  return scroll.max > 0 ? <div ref={(el) => { scroll.bar = el; }} style={{position: 'absolute', left: W - 6, top: 33, width: 3, height: 0, borderRadius: 1.5, background: 'var(--lg-menu-indicator)', opacity: 0}} /> : null;
}

type RowNav = (k: number) => Record<string, unknown>;
function ListContent({laid, lead, checks, sel, snap, dpr, nav}: {laid: Laid; lead: number; checks: boolean; sel?: Sel; dpr: number; snap: (ry: number) => (v: number, axis: 0 | 1) => number; nav?: RowNav}) {
  return <>
    {sel && sel.hot !== null && (
      <span ref={(el) => { sel.el = el; if (el) { el.style.top = `${sel.y.value}px`; (el.querySelector('[data-lg-highlight]') as HTMLElement | null)?.style.setProperty('opacity', String(Math.max(0, Math.min(1, sel.color.value * sel.root.value)))); } }} style={{position: 'absolute', left: 10}}>
        <Vibrant tone="menu-highlight" style={{display: 'block', width: W - 20, height: ROW}}>
          <HighlightShape dpr={dpr} opacity={0} />
        </Vibrant>
      </span>
    )}
    {laid.headers.map(({title, y: hy}) => (
      <span key={`h${hy}`} style={{position: 'absolute', left: lead, top: hy + 12, width: W - lead - INSET, fontSize: 13, fontWeight: 500, lineHeight: `${47 / 3}px`, whiteSpace: 'nowrap', color: 'var(--lg-menu-header)'}}>{title}</span>
    ))}
    { }
    {laid.separators.map((sy) => <Separator key={`s${sy}`} y={sy} />)}
    {laid.rows.map(({item, y: ry}, k) => <Row key={k} index={k} item={item.part.props} submenu={!!item.sub} y={ry} lead={lead} checks={checks} snap={snap(ry)} nav={nav?.(k)} />)}
  </>;
}
const Separator = ({y}: {y: number}) => <div style={{position: 'absolute', left: 24, top: Math.floor(y), translate: `0 ${y - Math.floor(y)}px`, width: W - 48, height: 1, background: 'var(--lg-menu-separator)'}} />;

function SubList({list: L, sel, dpr, snap, closing, handlers, nav}: {list: List; sel?: Sel; dpr: number; snap: (ry: number) => (v: number, axis: 0 | 1) => number; closing: boolean;
  handlers: Record<string, (e: React.PointerEvent) => void>; nav?: RowNav}) {
  const t = L.title!, checks = L.sections.some((s) => s.items.some((i) => i.part.props.checked !== undefined)), lead = INSET + (checks ? CHECK : 0);
  const tLead = L.titleLead ?? lead, titleX = tLead + (t.icon ? ICON : 0), symbol = typeof t.icon === 'string' ? t.icon : null, entry = useIcon(symbol ?? '', 17, 'menu'), bold = useIcon(symbol ?? '', 17, 'menutitle');
  const right = useIcon('chevron.right', 17, 'menuchevron'), parts = (L.parts ??= {});
  const ts = snap(PAD), cx = ICON_X + (tLead > INSET ? CHECK : 0), phase = (v: number) => { const d = v * dpr; return d - Math.floor(d + 1e-6); };
  const iconAt = (e: {frame: [number, number]; center?: number}) => ({position: 'absolute' as const, left: ts(cx - e.frame[0] / 2, 0), top: ts(ROW / 2 - (e.center ?? 0), 1)});
  return (
    <GlassContainer spacing={0} animation={null} live={L.live}>
    <span ref={(el) => { L.el = el?.firstElementChild as HTMLElement | null; }} style={{display: 'contents'}}>
    <Glass role="menu" aria-label={typeof t.children === 'string' ? t.children : undefined} radius={32} interactive flex="menu" motion={L.motion} data-lg-clip="" data-lg-phase={`${phase(L.frame.x)} ${phase(L.frame.y)}`}
      style={{position: 'absolute', left: L.frame.x, top: L.frame.y, width: W, height: L.laid.view, fontSize: 17, lineHeight: `${61 / 3}px`, userSelect: 'none', pointerEvents: closing || L.leaving ? 'none' : undefined}} {...handlers}>
      <div ref={(el) => { L.content = el; }} style={{position: 'absolute', inset: 0}}>
        <Scrolled scroll={L.scroll!} height={L.laid.height}>
        { }
        <span style={{position: 'absolute', left: 10, top: PAD}}>
          <Vibrant tone="menu-highlight" style={{display: 'block', width: W - 20, height: ROW}}>
            <HighlightShape dpr={dpr} opacity={1} shape={(el) => { parts.hl = el; }} />
          </Vibrant>
        </span>
        <div style={{position: 'absolute', left: 0, top: PAD, width: W, height: ROW, color: 'var(--lg-menu-label)'}}>
          {symbol && entry ? <>
            <span ref={(el) => { parts.icon = el; }} style={{opacity: 0}}><NamedIcon name={symbol} size={17} variant="menu" style={iconAt(entry)} /></span>
            <span ref={(el) => { parts.boldIcon = el; }}><NamedIcon name={symbol} size={17} variant={bold ? 'menutitle' : 'menu'} style={iconAt(bold ?? entry)} /></span>
          </> : t.icon && !symbol ? <span style={{position: 'absolute', left: cx, top: ROW / 2, translate: '-50% -50%', display: 'flex'}}>{t.icon}</span> : null}
          <span ref={(el) => { parts.regular = el; }} style={{position: 'absolute', left: titleX, top: TITLE_TOP, width: W - titleX - INSET - 20, whiteSpace: 'nowrap', opacity: 0, transformOrigin: 'left'}}>{t.children}</span>
          <span ref={(el) => { parts.bold = el; }} style={{position: 'absolute', left: titleX, top: TITLE_TOP, width: W - titleX - INSET - 20, whiteSpace: 'nowrap', fontWeight: 600, transformOrigin: 'left'}}>{t.children}</span>
          { }
          {right ? <span ref={(el) => { parts.right = el; }} data-lg-rotate="90"><NamedIcon name="chevron.right" size={17} variant="menuchevron" style={{position: 'absolute', left: ts(CHEVRON_X - right.frame[0] / 2, 0), top: ts(ROW / 2 - (right.center ?? 0), 1), color: 'var(--lg-label)'}} /></span>
            : <Chevron svgRef={(el) => { parts.svg = el; }} />}
        </div>
        <Separator y={SUB_TITLE} />
        <ListContent laid={L.laid} lead={lead} checks={checks} sel={sel} dpr={dpr} snap={snap} nav={nav} />
        </Scrolled>
      </div>
      <Indicator scroll={L.scroll!} />
    </Glass>
    </span>
    </GlassContainer>
  );
}

const CHEVRON_X = W - 31;
function Chevron({svgRef}: {svgRef?: (el: SVGSVGElement | null) => void}) {
  return (
    <svg ref={svgRef} width={28 / 3} height={38 / 3} viewBox={`0 0 ${28 / 3} ${38 / 3}`} style={{position: 'absolute', left: CHEVRON_X - 14 / 3, top: ROW / 2 - 19 / 3, color: 'var(--lg-label)', overflow: 'visible'}}>
      <MaterialInk glyph="forward" to={fallbackInk('chevron.right', 17, 'menuchevron')} />
    </svg>
  );
}

function Row({index, item, submenu, y, lead, checks, snap, nav}: {index: number; item: MenuItemProps; submenu: boolean; y: number; lead: number; checks: boolean; snap: (v: number, axis: 0 | 1) => number; nav?: Record<string, unknown>}) {
  const {icon, children, destructive, disabled, checked} = item, symbol = typeof icon === 'string' ? icon : null, entry = useIcon(symbol ?? '', 17, 'menu');
  const check = useIcon('checkmark', 17, 'menucheck'), chevron = useIcon('chevron.right', 17, 'menuchevron'), cx = ICON_X + (checks ? CHECK : 0), titleX = lead + (icon ? ICON : 0);
  const content = (
    <>
      {checked && (check ? <NamedIcon name="checkmark" size={17} variant="menucheck" style={{position: 'absolute', left: snap(21, 0), top: snap(ROW / 2 - (check.center ?? 0), 1)}} />
        : <NamedIcon name="checkmark" size={17} variant="menucheck" style={{position: 'absolute', left: 21, top: ROW / 2 - 6.167}} />)}
      {symbol && entry ? <NamedIcon name={symbol} size={17} variant="menu" style={{position: 'absolute', left: snap(cx - entry.frame[0] / 2, 0), top: snap(ROW / 2 - (entry.center ?? 0), 1)}} />
        : icon && !symbol ? <span style={{position: 'absolute', left: cx, top: ROW / 2, translate: '-50% -50%', display: 'flex'}}>{icon}</span> : null}
      <span style={{position: 'absolute', left: titleX, top: TITLE_TOP, width: W - titleX - INSET - (submenu ? 20 : 0), whiteSpace: 'nowrap'}}>{children}</span>
    </>
  );
  const tone = disabled ? 'secondary-label' : destructive ? 'red' : null;
  const chev = submenu && (chevron ? <NamedIcon name="chevron.right" size={17} variant="menuchevron" style={{position: 'absolute', left: snap(CHEVRON_X - chevron.frame[0] / 2, 0), top: snap(ROW / 2 - (chevron.center ?? 0), 1), color: 'var(--lg-label)'}} /> : <Chevron />);
  return (
    <div role={checked !== undefined ? 'menuitemcheckbox' : 'menuitem'} aria-checked={checked} data-menu-row={index} aria-haspopup={submenu ? 'menu' : undefined} aria-disabled={disabled || undefined} {...nav}
      style={{position: 'absolute', left: 0, top: y, width: W, height: ROW, color: 'var(--lg-menu-label)'}}>
      { }
      {tone ? <Vibrant tone={tone} style={{display: 'block', position: 'relative', width: '100%', height: '100%'}}>{content}</Vibrant> : content}
      {chev}
    </div>
  );
}
