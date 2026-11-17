import {Toolbar as BaseToolbar} from '@base-ui/react/toolbar';
import {Button as BaseButton} from '@base-ui/react/button';
import {Children, cloneElement, createContext, Fragment, isValidElement, useContext, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type ReactElement, type ReactNode} from 'react';
import {Glass, GlassContainer, NamedIcon, useGlassInvalidate, useLayoutChanged, useIcon, useIconScale, Vibrant, type GlassProps} from './react';
import type {GlassMotion} from './renderer';
import {hostsOf, Morph, TOOLBAR_MORPH, type Entry, type MorphHost, type MorphSettings, type Place} from './morph';
import {localPoint, usePressHighlight, type PressHighlight} from './highlight';
import {useMenuPresenter} from './menu';
import type {GlassTint, SystemColor} from './palette';

const BAR = {inset: 28, height: 48, host: 36, cell: 5, gap: 4, spacer: 12, smoothness: 12};
const FONT = 17;
interface Metrics { height: number; cell: number; gap: number; pad: number; loneText: number; loneSymbol: number; minHost: number }
const BOTTOM: Metrics = {height: 48, cell: 5, gap: 4, pad: 8, loneText: 11, loneSymbol: 38, minHost: 38};
const TOP: Metrics = {height: 44, cell: 4, gap: 8, pad: 7, loneText: 12, loneSymbol: 36, minHost: 36};
const MetricsCtx = createContext(BOTTOM);
function flatChildren(children: ReactNode, prefix = ''): ReactNode[] {
  return Children.toArray(children).flatMap((c) => {
    if (!isValidElement(c)) return [c];
    if (c.type === Fragment) return flatChildren((c.props as {children?: ReactNode}).children, `${prefix}${String(c.key)}/`);
    return prefix ? [cloneElement(c, {key: `${prefix}${String(c.key)}`})] : [c];
  });
}
function mergeGroups(kids: ReactNode[]): ReactNode[] {
  const out: ReactNode[] = [];
  let open: {el: ReactElement<GroupProps>; items: ReactNode[]} | null = null;
  const close = () => { if (open) out.push(open.items.length === flatChildren(open.el.props.children).length ? open.el : cloneElement(open.el, {}, ...open.items)); open = null; };
  for (const c of kids) {
    const group = !isValidElement(c) ? null : c.type === ToolbarGroup ? c as ReactElement<GroupProps> : c.type === ToolbarItem ? <ToolbarGroup key={c.key ?? undefined}>{c}</ToolbarGroup> as ReactElement<GroupProps> : null;
    if (!group) { close(); out.push(c); continue; }
    const shared = (g: ReactElement<GroupProps>) => g.props.sharedBackground ?? true;
    if (open && shared(open.el) === shared(group)) open.items.push(...flatChildren(group.props.children, `${String(group.key)}/`));
    else { close(); open = {el: group, items: flatChildren(group.props.children)}; }
  }
  close();
  return out;
}
const lineHeight = (size: number, dpr: number) => Math.ceil(size * 2444 / 2048 * dpr - 1e-9) / dpr;
const Lone = createContext(false);
const Bare = createContext(false);
type BarContext = {morph: Morph; realign: () => void; live: {current: boolean};
  next: MorphSettings | null;
  setLift: (style: CSSProperties | null) => void};
const isGroup = (c: ReactNode): c is ReactElement => isValidElement(c) && (c.type === ToolbarGroup || (c.type as {toolbarGroup?: boolean}).toolbarGroup === true);
export function useBar() { return useContext(BarCtx); }

function readPlace(wrap: HTMLElement | null, keys: string, copy: boolean): Place | null {
  const el = wrap?.firstElementChild as HTMLElement | null, parent = wrap?.parentElement;
  if (!wrap || !el || !parent) return null;
  const br = parent.getBoundingClientRect(), k = br.width / (parseFloat(getComputedStyle(parent).width) || 1) || 1, cs = getComputedStyle(el);
  const hosts = hostsOf(el), ws = hosts.map((h) => parseFloat(getComputedStyle(h).width) || 0), gap = parseFloat(cs.columnGap) || 0;
  const w = parseFloat(cs.width), content = ws.reduce((a, b) => a + b, 0) + gap * Math.max(0, hosts.length - 1), cx = (wrap.getBoundingClientRect().left - br.left) / k + w / 2;
  let x = cx - content / 2;
  return {cx, cy: 0, w, h: parseFloat(cs.height) || BAR.height, keys, hosts: hosts.map((h, i) => { const c = x + ws[i] / 2 + (parseFloat(h.style.translate) || 0); x += ws[i] + gap; return {node: copy ? cloneItem(h) : h, orig: h, cx: c, w: ws[i]}; })};
}
function cloneItem(h: HTMLElement) {
  const c = h.cloneNode(true) as HTMLElement, from = h.querySelectorAll('.lg-vibrant, [data-lg-item]');
  c.querySelectorAll('.lg-vibrant, [data-lg-item]').forEach((v, i) => { (v as unknown as {__lgSource?: Element}).__lgSource = from[i]; });
  return c;
}
function barHost(bar: () => HTMLElement | null, ctx: BarContext, invalidate: () => void): MorphHost {
  const wrapOf = (e: Entry) => e.el!.parentElement as HTMLElement, fills = (e: Entry) => wrapOf(e).dataset.lgFill !== undefined;
  const unpin = (e: Entry) => { e.el!.style.width = ''; if (fills(e)) e.el!.style.flex = FILL_FLEX; };
  return {
    rowItems: true,
    items: hostsOf,
    begin(e) { wrapOf(e).dataset.lgAnimating = ''; if (getComputedStyle(e.el!).position === 'static') e.el!.style.position = 'relative'; },
    end(e) { unpin(e); wrapOf(e).style.left = ''; delete wrapOf(e).dataset.lgAnimating; },
    reset(e) { unpin(e); wrapOf(e).style.left = '0px'; hostsOf(e.el!).forEach((n) => { n.style.translate = ''; }); },
    resize(e, f) { e.el!.style.width = `${f.w}px`; if (fills(e)) e.el!.style.flex = 'none'; },
    place(e, f, leaving) {
      const wrap = wrapOf(e), parent = wrap.parentElement!;
      if (leaving) { wrap.style.left = `${f.cx - f.w / 2}px`; return f; }
      wrap.style.left = '0px';
      const br = parent.getBoundingClientRect(), s = br.width / (parseFloat(getComputedStyle(parent).width) || 1) || 1;
      wrap.style.left = `${f.cx - ((wrap.getBoundingClientRect().left - br.left) / s + f.w / 2)}px`;
      return f;
    },
    leave(e, on) {
      const w = wrapOf(e);
      if (on) { w.dataset.lgLeft = ''; Object.assign(w.style, {position: 'absolute', top: '0px', pointerEvents: 'none'}); }
      else { Object.assign(w.style, {position: '', top: '', pointerEvents: ''}); delete w.dataset.lgLeft; }
    },
    size() { const p = bar(); return p ? [parseFloat(getComputedStyle(p).width) || 0, parseFloat(getComputedStyle(p).height) || BAR.height] : [0, BAR.height]; },
    settled: () => ctx.realign(),
    invalidate,
  };
}
const BarCtx = createContext<BarContext | null>(null);
const FILL_FLEX = '1 1 auto';
const InToolbar = createContext(false);
const Leaving = createContext<(() => void) | null>(null);

/** A bottom bar, fixed to the bottom of the nearest positioned ancestor (the screen). Its items sit on glass platters that morph when its children change. */
export function Toolbar({children, style, settings = TOOLBAR_MORPH}: {children?: ReactNode; style?: CSSProperties; settings?: MorphSettings}) {
  const bar = useRef<HTMLDivElement>(null), changed = useLayoutChanged(), invalidate = useGlassInvalidate(), [, bump] = useReducer((n: number) => n + 1, 0);
  const [lift, setLift] = useState<CSSProperties | null>(null);
  const [ctx] = useState<BarContext>(() => {
    const c = {realign: () => {}, live: {current: false}, next: null, setLift} as BarContext;
    c.morph = new Morph(barHost(() => bar.current, c, invalidate), settings);
    return c;
  });
  const live = ctx.live.current;
  if (live) for (const e of ctx.morph.entries) e.snap = e.read(true);
  const kids = mergeGroups(flatChildren(children)), keyOf = (c: ReactNode) => (isValidElement(c) ? c.key : null);
  const prev = useRef<ReactNode[]>([]), gone = useRef(new Map<string, {el: ReactElement; at: number}>()).current;
  const now = new Set(kids.map(keyOf));
  if (live) prev.current.forEach((c, i) => { const k = keyOf(c); if (k != null && isGroup(c) && !now.has(k) && !gone.has(k)) gone.set(k, {el: c, at: i}); });
  for (const k of [...gone.keys()]) if (now.has(k)) gone.delete(k);
  prev.current = kids;
  const shown = [...kids];
  for (const [k, {el, at}] of [...gone].sort((a, b) => a[1].at - b[1].at))
    shown.splice(Math.min(at, shown.length), 0, cloneElement(el as ReactElement<{leaving?: () => void}>, {leaving: () => { if (gone.delete(k)) bump(); }}));
  useLayoutEffect(() => { ctx.live.current = true; }, [ctx]);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const dpr = devicePixelRatio || 1, snap = (v: number) => Math.floor(v * dpr + .5 + dpr / 64) / dpr;
    const align = () => {
      let moved = false;
      const page = el.closest('canvas')?.firstElementChild as HTMLElement | null, o = page?.getBoundingClientRect(), k = o ? o.width / parseFloat(getComputedStyle(page!).width) || 1 : 1;
      for (const w of el.querySelectorAll<HTMLElement>(':scope > [data-lg-exact]:not([data-lg-animating])')) {
        const now = parseFloat(w.style.left) || 0, x = (w.getBoundingClientRect().left - (o?.left ?? 0)) / k - now;
        const left = +(snap(x) - x).toFixed(4);
        if (Math.abs(left - now) >= 1 / 64) { w.style.left = `${left}px`; moved = true; }
      }
      if (moved) changed();
    };
    ctx.realign = align;
    align();
    const ro = new ResizeObserver(align);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
  });
  useLayoutEffect(() => {
    if (!bar.current) return;
    ctx.morph.settings = ctx.next ?? settings; ctx.next = null;
    ctx.morph.change();
  });
  return (
    <GlassContainer spacing={BAR.smoothness} animation={null}>
      <BarCtx.Provider value={ctx}>
        <InToolbar.Provider value>
          <BaseToolbar.Root ref={bar} className="lg-toolbar" style={{position: 'absolute', left: BAR.inset, right: BAR.inset, bottom: BAR.inset, height: BAR.height, display: 'flex',
            justifyContent: 'center', alignItems: 'center', ...style, ...lift}}>{shown}</BaseToolbar.Root>
        </InToolbar.Provider>
      </BarCtx.Provider>
    </GlassContainer>
  );
}

/** A top bar's item platters, `top` CSS px below the screen's top (default 62): `<ToolbarGroup placement="leading">` from the left, `placement="principal"` centred, the others from the right. */
export function TopBar({children, top = 62, style}: {children?: ReactNode; top?: number; style?: CSSProperties}) {
  const sides: Record<'leading' | 'principal' | 'trailing', ReactNode[]> = {leading: [], principal: [], trailing: []};
  let last: keyof typeof sides = 'trailing';
  for (const c of flatChildren(children)) {
    const p = isValidElement(c) && c.type !== ToolbarSpacer ? (c.props as {placement?: string}).placement : undefined;
    if (isValidElement(c) && c.type === ToolbarSpacer) { sides[last].push(c); continue; }
    last = p === 'leading' || p === 'principal' ? p : 'trailing';
    sides[last].push(c);
  }
  const lead = mergeGroups(sides.leading), principal = mergeGroups(sides.principal), trail = mergeGroups(sides.trailing);
  const side = (list: ReactNode[], slot: string) => <div data-lg-exact="" data-lg-slot={slot} style={{position: 'relative', display: 'flex', alignItems: 'center'}}>{list}</div>;
  const backdrop = useRef<HTMLDivElement>(null);
  return (
    <MetricsCtx.Provider value={TOP}>
      <div ref={backdrop} aria-hidden style={{position: 'absolute', left: 0, right: 0, top, height: 54, pointerEvents: 'none'}} />
      <GlassContainer spacing={BAR.smoothness} animation={null} backdrop={backdrop}>
        <InToolbar.Provider value>
        <BaseToolbar.Root className="lg-topbar" style={{position: 'absolute', left: 16, right: 16, top, height: TOP.height, display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...style}}>
          {side(lead, 'leading')}{side(trail, 'trailing')}
          {
}
          {principal.length > 0 && <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: TOP.height, display: 'flex', justifyContent: 'center', alignItems: 'center', pointerEvents: 'none'}}>
            <div data-lg-exact="" data-lg-slot="principal" style={{position: 'relative', display: 'flex', alignItems: 'center', pointerEvents: 'auto'}}>{principal}</div>
          </div>}
        </BaseToolbar.Root>
        </InToolbar.Provider>
      </GlassContainer>
    </MetricsCtx.Provider>
  );
}

type GroupProps = Omit<GlassProps, 'radius'> & {sharedBackground?: boolean; placement?: 'leading' | 'trailing' | 'principal'; animated?: boolean; leaving?: (() => void) | null;
  fill?: boolean};
/** Items on one platter, shared with the groups beside it unless a `<ToolbarSpacer>` separates them. `sharedBackground={false}`: the same layout without the glass. A prominent item gets a platter of its own. */
export function ToolbarGroup({children, sharedBackground = true, placement: _placement, animated = true, leaving = null, fill = false, style, ...rest}: GroupProps) {
  const M = useContext(MetricsCtx);
  const box: CSSProperties = {display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', boxSizing: 'border-box', height: M.height,
    minWidth: M.height, padding: `0 ${M.cell}px`, gap: M.cell * 2 + M.gap, ...(fill ? {flex: FILL_FLEX} : null), ...style};
  const segments: {items: ReactNode[]; prominent?: ItemProps}[] = [];
  for (const c of flatChildren(children)) {
    const p = isValidElement(c) && c.type === ToolbarItem ? (c.props as ItemProps) : null;
    if (p?.prominent) segments.push({items: [c], prominent: p});
    else if (segments.length && !segments[segments.length - 1].prominent) segments[segments.length - 1].items.push(c);
    else segments.push({items: [c]});
  }
  const bar = useContext(BarCtx), last = useRef(segments), [, bump] = useReducer((n: number) => n + 1, 0);
  const emptied = !segments.length && last.current.length > 0 && !!bar?.live.current;
  if (segments.length || !emptied) last.current = segments;
  const shown = emptied ? last.current : segments, gone = leaving ?? (emptied ? () => { last.current = []; bump(); } : null);
  return <Leaving.Provider value={gone}>{shown.map((g, i) => (
    <Fragment key={i}>
      {i > 0 && !gone ? <ToolbarSpacer /> : null}
      <Bare.Provider value={!sharedBackground && !g.prominent}><Lone.Provider value={g.items.length === 1}>
        <Platter items={g.items} box={box} animated={animated} fill={fill} glass={g.prominent ? {prominent: true, bar: true, tint: g.prominent.tint, disabled: g.prominent.disabled} : sharedBackground ? rest : null} />
      </Lone.Provider></Bare.Provider>
    </Fragment>
  ))}</Leaving.Provider>;
}

function Platter({items, box, glass, animated, fill = false}: {items: ReactNode[]; box: CSSProperties; glass: Omit<GlassProps, 'radius'> | null; animated: boolean; fill?: boolean}) {
  const bar = useContext(BarCtx), leaving = useContext(Leaving), ref = useRef<HTMLSpanElement>(null);
  const keys = items.map((c, i) => (isValidElement(c) && c.key != null ? String(c.key) : `#${i}`)).join('|');
  const [motion] = useState<GlassMotion>(() => ({scale: [1, 1], translation: [0, 0], shape: 1}));
  const [entry] = useState<Entry>(() => { const e: Entry = {el: null, keys, motion: null, animated, leaving: null, snap: null, read: (copy = false) => readPlace(ref.current, e.keys, copy)}; return e; });
  Object.assign(entry, {keys, animated, leaving, motion: glass ? motion : null});
  useLayoutEffect(() => { entry.el = ref.current?.firstElementChild as HTMLElement | null; });
  useLayoutEffect(() => {
    if (!bar) return;
    bar.morph.entries.add(entry);
    return () => { bar.morph.entries.delete(entry); };
  }, [bar, entry]);
  return (
    <span ref={ref} data-lg-exact="" data-lg-piece="" {...(fill ? {'data-lg-fill': ''} : null)} style={{position: 'relative', display: 'flex', flex: fill ? '1 1 0' : 'none', minWidth: fill ? 0 : undefined}}>
      {glass ? <Glass interactive {...glass} motion={motion} style={box}>{items}</Glass> : <div style={box}>{items}</div>}
    </span>
  );
}

/** Space between groups: a fixed gap (default) or `flexible`, taking the free width. */
export function ToolbarSpacer({flexible = false}: {flexible?: boolean}) {
  return <span aria-hidden style={{flex: flexible ? '1 1 auto' : 'none', minWidth: BAR.spacer}} />;
}

const itemPress = (M: Metrics): PressHighlight => ({light: .2, dark: .4, tracks: (el, x, y) => {
  const p = localPoint(el, x, y), out = 15, half = M.gap / 2;
  if (!el.closest('.lg-glass')) return p.x >= -out && p.x < p.w + out && p.y >= -out && p.y < p.h + out;
  const v = (M.height - BAR.host) / 2 + out;
  return p.x >= -(M.cell + (el.previousElementSibling ? half : 0) + out) && p.x < p.w + M.cell + (el.nextElementSibling ? half : 0) + out && p.y >= -v && p.y < p.h + v;
}});
const ITEM_PRESS = {bottom: itemPress(BOTTOM), top: itemPress(TOP)};

type ItemProps = {icon?: string | ReactNode; children?: ReactNode; style?: CSSProperties; prominent?: boolean; tint?: GlassTint; disabled?: boolean;
  identifier?: string;
  menu?: ReactNode; menuOpen?: boolean; onMenuOpenChange?: (open: boolean) => void; safeArea?: [number, number, number, number];
  /** A link: the item is an `<a href>` (SwiftUI's `Link` in a toolbar), so a modified click, a middle click and the context menu act as on any link. */
  href?: string;
  /** The link's target and rel (`href` only). */
  target?: string; rel?: string};
type ItemElementProps = ItemProps & Omit<React.HTMLAttributes<HTMLSpanElement>, 'children' | 'style'> & {
  ref?: React.Ref<HTMLSpanElement>};

/** A bar item: a title, your icon, or an `iconSet` name. `onClick` fires on a release over it. `prominent` gives it a platter of its own filled with `tint` (default blue); otherwise `tint` colours its label. `disabled` dims it. */
export function ToolbarItem(props: ItemElementProps) {
  return props.menu != null ? <MenuBarItem {...props} /> : <BarItem {...props} />;
}

function MenuBarItem({menu, menuOpen, onMenuOpenChange, safeArea, ...item}: ItemElementProps) {
  const host = useRef<HTMLSpanElement>(null), platter = () => host.current?.closest<HTMLElement>('.lg-glass') ?? null;
  const m = useMenuPresenter({children: menu, open: menuOpen, onOpenChange: onMenuOpenChange, safeArea, source: platter, target: () => host.current, content: true,
    scheme: () => { const v = platter()?.dataset.glassScheme; return v === 'dark' || v === 'light' ? v : undefined; },
    copy: (motion, r) => <Glass shapeOnly motion={motion} tabIndex={-1} aria-hidden style={{display: 'block', width: r.w, height: r.h}} />});
  const invalidate = useGlassInvalidate(), hidden = m.shown ? (m.morphing ? m.portalKey : '') : null;
  useLayoutEffect(() => {
    const el = platter();
    if (!el) return;
    if (hidden !== null) el.dataset.lgHidden = ''; else delete el.dataset.lgHidden;
    if (hidden) el.dataset.lgPortal = hidden; else delete el.dataset.lgPortal;
    invalidate();
  }, [hidden]);
  const {press} = m;
  return <>
    <BarItem {...item} hostRef={host} onPointerDown={(e) => { item.onPointerDown?.(e); if (!item.disabled && e.isPrimary) press.down(e.clientX, e.clientY, e.pointerId, e.pointerType); }}
      onClick={(e) => { item.onClick?.(e); if (e.detail === 0) { if (m.open) m.set(false); else m.openByKey('first'); } }}
      aria-haspopup="menu" aria-expanded={m.open}
      onKeyDown={(e) => { item.onKeyDown?.(e); if (!m.open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); m.openByKey(e.key === 'ArrowUp' ? 'last' : 'first'); } }} />
    {m.nodes}
  </>;
}

function BarItem({icon, children, style, prominent = false, tint, disabled = false, identifier, href, target, rel, hostRef, ref: given, menu: _menu, menuOpen: _o, onMenuOpenChange: _c, safeArea: _s, ...rest}: ItemElementProps & {hostRef?: React.Ref<HTMLSpanElement>}) {
  const setRef = (el: HTMLSpanElement | null) => { for (const r of [hostRef, given]) { if (typeof r === 'function') r(el); else if (r) (r as {current: HTMLSpanElement | null}).current = el; } };
  const lone = useContext(Lone), bare = useContext(Bare), M = useContext(MetricsCtx), changed = useLayoutChanged(), dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 3;
  const symbolic = icon != null && children == null;
  const entry = useIcon(typeof icon === 'string' ? icon : '', FONT, 'bar');
  const pad = lone ? (symbolic ? 0 : M.loneText) : M.pad, content = useRef<HTMLSpanElement>(null), [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const measure = () => { const w = parseFloat(getComputedStyle(el).width) || 0; setWidth(lone && symbolic ? M.loneSymbol : Math.max(M.minHost, Math.ceil((w + 2 * pad) * dpr - 1e-6) / dpr)); changed(); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lone, symbolic, pad, dpr, M]);
  const bar = useContext(BarCtx);
  useLayoutEffect(() => { if (width !== undefined) bar?.morph.replan(); }, [width, bar]);
  const capture = useIconScale();
  const loneLayer: [number, number] | undefined = lone && symbolic && entry?.lone ? [(entry.lone[0] - 1) / capture + (M.loneSymbol - 38) / 2, (entry.lone[1] - 1) / capture] : undefined;
  const label = <>
    {typeof icon === 'string' ? <NamedIcon name={icon} size={FONT} variant="bar" layer={loneLayer} style={loneLayer ? {width: M.loneSymbol, height: BAR.host} : undefined} /> : icon}
    {children != null ? <span style={{display: 'block'}}>{children}</span> : null}
  </>;
  const tone = prominent ? null : disabled ? 'tertiary-label' : tint && !tint.startsWith('#') ? tint as SystemColor : bare ? 'label' : null;
  const press = usePressHighlight(M === TOP ? ITEM_PRESS.top : ITEM_PRESS.bottom);
  const inBar = useContext(InToolbar), link = href !== undefined;
  const Part = (link ? (inBar ? BaseToolbar.Link : 'a') : inBar ? BaseToolbar.Button : BaseButton) as React.ElementType;
  const kind = link ? {href, target, rel, ...(disabled ? {'aria-disabled': true, onClickCapture: (e: React.MouseEvent) => e.preventDefault()} : null)}
    : {nativeButton: false, disabled, render: <span />};
  const itemId = identifier !== undefined ? `id:${identifier}` : typeof icon === 'string' ? `image:${icon}` : typeof children === 'string' && children ? `title:${children}` : undefined;
  const {onPointerDown: given_down, onClick, tabIndex, ...attrs} = rest;
  return (
    <Part ref={setRef} {...kind} data-lg-ring={M === TOP ? 'clipped' : ''} data-lg-item-id={itemId} {...attrs} {...(tabIndex !== undefined ? {tabIndex} : null)}
      onPointerDown={(e: React.PointerEvent) => { given_down?.(e as unknown as React.PointerEvent<HTMLSpanElement>); press(e as unknown as React.PointerEvent<HTMLSpanElement>); }}
      onClick={(e: React.MouseEvent) => onClick?.(e as unknown as React.MouseEvent<HTMLSpanElement>)}
      style={{position: 'relative', display: 'flex', color: 'inherit', textDecoration: 'none', alignItems: 'center', justifyContent: 'center', flex: 'none', height: BAR.host, width, touchAction: 'none',
      fontSize: FONT, fontWeight: 400, lineHeight: `${lineHeight(FONT, dpr)}px`, whiteSpace: 'nowrap', userSelect: 'none',
      ...(M === TOP ? {'--lg-ring-top': '4px', '--lg-ring-bottom': '4px'} : null), ...style} as React.CSSProperties}>
      {
}
      <span {...{drawable: ""}} data-lg-item="" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%'}}>
        <span ref={content} style={{display: 'flex', alignItems: 'center', flex: 'none'}}>
          {tone ? <Vibrant tone={tone} style={{display: 'flex', alignItems: 'center'}}>{label}</Vibrant> : label}
        </span>
      </span>
    </Part>
  );
}
