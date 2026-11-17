import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref, type RefObject} from 'react';
import {applyTextParity, type GlyphMasks} from './parity';
import {GlassRenderer, htmlInCanvasSupported, layoutBox, type GlassContainerRecord, type GlassMotion, type GlassRecord} from './renderer';
import {containerMorph, Morph, type ContainerAnimation, type Entry, type MorphHost, type MorphSettings, type Place} from './morph';
import {paletteVars, toneCSS, type GlassTint, type Tone} from './palette';
import type {LensFrame} from './lensGPU';
import {hasIconFallback, IconFallback} from './iconFallback';
import {IOS26_5, type Platform} from './platform/index.ts';
export {IOS26_5, IOS26_5_TINTED, derivePlatform, type Platform} from './platform/index.ts';
import './glass.css';

class Registry {
  root: HTMLElement | null = null;
  records = new Set<GlassRecord>();
  renderer: GlassRenderer | null = null;
  dark = false;
  platform: Platform = IOS26_5;
  invalidate() {
    this.renderer?.invalidate();
  }
  relayout: (() => void) | null = null;
  parityGlyphs = false;
  glasses = (): GlassRecord[] => [...this.records];
}

/** Named bitmap icons for `<GlassRoot iconSet>`: each entry a mask image (`file`, served under `base`) with its frame in CSS px, keyed `symbol:<name>|<size>` or `symbol:<name>|<size>|<variant>`; `scale` is the device px per CSS px the images were made at. */
export interface IconSet {
  base: string;
  scale: number;
  entries: Record<string, {file: string; frame: [number, number]; layer?: [number, number]; size: [number, number]; titleOffset?: number; lone?: [number, number]; shapes?: {x: number; y: number; rule: string; d: string}[];
    center?: number}>;
}

const Ctx = createContext<{registry: Registry; iconSet: IconSet | null} | null>(null);
const drawable = {drawable: ''} as Record<string, string>;

const cssVars = (scheme: 'light' | 'dark') => Object.entries(paletteVars(scheme)).map(([k, v]) => `${k}:${v}`).join(';');

let paletteInjected = false;
function injectPaletteStyle() {
  if (paletteInjected || typeof document === 'undefined') return;
  paletteInjected = true;
  const s = document.createElement('style');
  s.textContent = `.lg-glass{${cssVars('light')};color:var(--lg-label)}`;
  document.head.append(s);
}

/** Props of `GlassRoot`. */
export interface GlassRootProps {
  /** The page: ordinary DOM, drawn into the root's canvas with the glass over it. */
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  /** Dark appearance: the glass's material and labels for a dark page. Default false. */
  dark?: boolean;
  /** Layout adjustments that place text as the native renderer does (baselines, weights), for pixel comparison; `{glyphs}` draws text from supplied glyph masks. Off by default. @internal */
  parity?: boolean | {glyphs?: GlyphMasks};
  /** Bitmap icons by name: a string `icon` on a button, bar item, menu row or tab draws its entry, and the library's own chrome (back chevron, search, checkmarks) uses it when it has the icon, Material Symbols otherwise. */
  iconSet?: IconSet;
  /** Rendered instead where the glass can't run (no HTML-in-Canvas or WebGPU, or no GPU device). Default nothing. */
  unsupported?: ReactNode;
  /** The glass as data: `IOS26_5` (default), `IOS26_5_TINTED`, or one made from them with `derivePlatform`. */
  platform?: Platform;
  /** Called once, when the root has drawn its first frame (its page and glass on screen): the moment to take away a loading screen. Not called where the glass can't run (`unsupported`). */
  onFirstFrame?: () => void;
}

/** Whether this browser can draw the glass (HTML-in-Canvas and WebGPU). A supported browser can still fail to get a GPU device: `<GlassRoot unsupported>` covers both. False on a server. */
export const glassSupported = htmlInCanvasSupported;

const noSubscription = () => () => {};
const onClient = () => true, onServer = () => false;

/** The root of a page with glass: a canvas the size of the page that the browser draws the page into (HTML-in-Canvas), every `<Glass>` inside drawn over it by WebGPU. Wrap the page in one. Renders on the client only: on a server, and in the hydration's first pass, an empty box with its `className` and `style`. */
export function GlassRoot(props: GlassRootProps) {
  const {children, style, className, dark = false, parity = false, iconSet, unsupported = null, platform = IOS26_5, onFirstFrame} = props;
  const firstFrame = useRef(onFirstFrame);
  firstFrame.current = onFirstFrame;
  const [registry] = useState(() => new Registry());
  const isClient = useSyncExternalStore(noSubscription, onClient, onServer);
  const [failed, setFailed] = useState(() => !htmlInCanvasSupported());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  registry.dark = dark;
  registry.platform = platform;

  useLayoutEffect(() => {
    registry.root = rootRef.current;
    if (failed || !isClient) return;
    const canvas = canvasRef.current!;
    canvas.setAttribute('layoutsubtree', '');
    canvas.setAttribute('content', 'drawable');
    let cancelled = false;
    GlassRenderer.create(canvas, {root: () => registry.root, glasses: registry.glasses, dark: () => registry.dark, platform: () => registry.platform, placed: () => registry.relayout?.(), drawn: () => firstFrame.current?.()})
      .then((r) => {
        if (cancelled) return r.destroy();
        registry.renderer = r;
        r.invalidate();
      })
      .catch((error) => {
        console.error('[glass] no renderer:', error);
        if (!cancelled) setFailed(true);
      });
    const ro = new ResizeObserver(() => registry.invalidate());
    ro.observe(canvas);
    return () => {
      cancelled = true;
      ro.disconnect();
      registry.renderer?.destroy();
      registry.renderer = null;
    };
  }, [failed, isClient, registry]);

  useEffect(() => registry.invalidate(), [dark, platform, registry]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!parity || !root) return;
    const glyphs = typeof parity === 'object' ? parity.glyphs ?? null : null;
    registry.parityGlyphs = !!glyphs;
    let undo = () => {};
    let retries = 0;
    const apply = () => {
      undo();
      const u = applyTextParity(root, devicePixelRatio, glyphs);
      undo = u;
      mo.takeRecords();
      registry.invalidate();
      if (u.unplaced && retries++ < 60) registry.relayout?.(); else if (!u.unplaced) retries = 0;
    };
    const mo = new MutationObserver(apply);
    apply();
    document.fonts.ready.then(apply);
    mo.observe(root, {childList: true, characterData: true, subtree: true});
    const ro = new ResizeObserver(apply);
    ro.observe(root);
    let queued = 0;
    registry.relayout = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; apply(); }); };
    return () => { mo.disconnect(); ro.disconnect(); cancelAnimationFrame(queued); registry.relayout = null; registry.parityGlyphs = false; undo(); };
  }, [parity, isClient, registry]);
  if (!isClient) return <div className={className} style={style} />;
  injectPaletteStyle();
  if (failed) return <>{unsupported}</>;

  const page = (
    <div ref={rootRef} {...drawable} className={className} style={{position: 'relative', width: '100%', height: '100%', overflow: 'hidden', '--lg-focus-ring': `rgb(${platform.palette.systemColors.blue[dark ? 'dark' : 'light'].join(' ')})`} as CSSProperties}>
      {children}
    </div>
  );
  return (
    <Ctx.Provider value={{registry, iconSet: iconSet ?? null}}>
      <canvas ref={canvasRef} style={{display: 'block', ...style}}>
        {page}
      </canvas>
    </Ctx.Provider>
  );
}

export function useLayoutChanged(): () => void {
  const ctx = useContext(Ctx);
  return () => ctx?.registry.relayout?.();
}

export function useGlassPage(): () => HTMLElement | null {
  const ctx = useContext(Ctx), screen = useContext(ScreenCtx);
  return () => screen?.current ?? ctx?.registry.root ?? null;
}

const ScreenCtx = createContext<RefObject<HTMLDivElement | null> | null>(null);
/** A screen inside the page (a device in a web page): menus, sheets, alerts and dialogs inside it present within it and size themselves by it. A positioned box that clips. */
export function GlassScreen({children, style, className}: {children?: ReactNode; style?: CSSProperties; className?: string}) {
  const ref = useRef<HTMLDivElement>(null);
  return <ScreenCtx.Provider value={ref}><div ref={ref} className={className} style={{position: 'relative', overflow: 'hidden', ...style}}>{children}</div></ScreenCtx.Provider>;
}
/** The enclosing `<GlassRoot>`'s appearance. */
export function useGlassScheme(): 'light' | 'dark' {
  return useContext(Ctx)?.registry.dark ? 'dark' : 'light';
}
/** The enclosing `<GlassRoot>`'s platform (`IOS26_5` outside one). */
export function useGlassPlatform(): Platform {
  return useContext(Ctx)?.registry.platform ?? IOS26_5;
}
export function useParityGlyphs(): () => boolean {
  const ctx = useContext(Ctx);
  return () => !!ctx?.registry.parityGlyphs;
}

export function useGlassPose(): (el: Element | null) => GlassRecord['pose'] | undefined {
  const ctx = useContext(Ctx);
  return (el) => { if (el) for (const r of ctx?.registry.records ?? []) if (r.el === el) return r.pose; return undefined; };
}

export function useGlassMotion(): (el: Element | null) => GlassMotion | undefined {
  const ctx = useContext(Ctx);
  return (el) => { if (el) for (const r of ctx?.registry.records ?? []) if (r.el === el) return r.motion; return undefined; };
}

export function useGlassFlexReset(): (el: Element | null) => GlassRecord['pose'] | undefined {
  const ctx = useContext(Ctx);
  return (el) => {
    if (el) for (const r of ctx?.registry.records ?? []) if (r.el === el) { const p = r.pose; r.flex = undefined; r.pose = undefined; ctx?.registry.invalidate(); return p; }
    return undefined;
  };
}

/** A getter for the root element this component draws in (null before it mounts). */
export function useFrameScope(): () => Element | null {
  const ctx = useContext(Ctx);
  return () => ctx?.registry.root ?? null;
}

export function useGlassInvalidate(): () => void {
  const ctx = useContext(Ctx);
  return () => ctx?.registry.invalidate();
}

const ContainerCtx = createContext<(GlassContainerRecord & {morph?: Morph; touch?: () => void}) | null>(null);

function placeOf(el: HTMLElement, root: HTMLElement | null): Place | null {
  if (!root || !el.isConnected) return null;
  const b = layoutBox(el, root), cx = b.x + b.w / 2;
  return {cx, cy: b.y + b.h / 2, w: b.w, h: b.h, keys: '', hosts: [{node: el, orig: el, cx, w: b.w}]};
}
function containerHost(registry: Registry, morph: () => Morph): MorphHost {
  const none = () => {};
  return {
    rowItems: false, begin: none, end: none, reset: none, resize: none, leave: none, settled: none,
    items: (el) => [el],
    place: (e) => { const p = placeOf(e.el!, registry.root); return p ?? {cx: 0, cy: 0, w: 1, h: 1}; },
    size() {
      const live = [...morph().entries].filter((e) => !e.leaving && e.el?.isConnected), root = registry.root;
      let a: HTMLElement | null = live[0]?.el?.parentElement ?? null;
      while (a && !live.every((e) => a!.contains(e.el))) a = a.parentElement;
      if (!a || !root || a === root) return [0, 0];
      const b = layoutBox(a, root);
      return [b.w, b.h];
    },
    invalidate: () => registry.invalidate(),
  };
}

/** Props of `GlassContainer`. */
export interface GlassContainerProps {
  /** How close members' edges come before they merge, in CSS px (default 8): facing edges join below about half of it. */
  spacing?: number;
  /** How a change of its members animates: 'default' (springs that morph, merge and split their shapes), a spring `[duration, bounce]` or a curve `{bezier, duration}` for everything, or null for none. */
  animation?: ContainerAnimation;
  /** The default animation's tuning, for the library's own controls. @internal */
  settings?: MorphSettings;
  /** Its `<Glass>` members, anywhere below it. */
  children: ReactNode;
  /** The element whose paint is the members' backdrop. @internal */
  backdrop?: RefObject<HTMLElement | null>;
  /** A container whose union and material are driven per frame by its caller. @internal */
  live?: {spacing: number; gaussian?: number; material?: {size: [number, number]; progress: number; from?: [number, number] | null; rim?: number; split?: {kind: 'button' | 'bar'; progress: number} | null} | null; scheme?: 'light' | 'dark' | null; copies?: [number, number] | null};
}

/** Draws its `<Glass>` members as one glass: one backdrop, one adaptive material, their shapes smoothly merged where they come close. It adds no DOM: members keep their own CSS layout. Regular and clear members form separate glasses. */
export function GlassContainer(props: GlassContainerProps) {
  const {spacing = 8, animation = 'default', settings, backdrop, live, children} = props;
  const ctx = useContext(Ctx);
  const [record] = useState<GlassContainerRecord & {morph?: Morph; touch?: () => void}>(() => {
    const r: GlassContainerRecord & {morph?: Morph; touch?: () => void} = {spacing};
    if (animation !== null && ctx) {
      const m: Morph = r.morph = new Morph(containerHost(ctx.registry, (): Morph => m), settings ?? containerMorph(spacing));
      let queued = false;
      r.touch = () => { if (queued || m.dead) return; queued = true; queueMicrotask(() => { queued = false; m.change(); }); };
    }
    return r;
  });
  if (record.morph) {
    record.morph.animation = animation; record.morph.settings = settings ?? containerMorph(spacing);
    for (const e of record.morph.entries) if (!e.leaving) e.snap = e.read() ?? e.snap;
  }
  const seen = useRef<{values: string; backdrop: HTMLElement | null | undefined}>({values: '', backdrop: undefined});
  useLayoutEffect(() => {
    if (live) {
      Object.defineProperty(record, 'spacing', {get: () => live.spacing, configurable: true});
      Object.defineProperty(record, 'gaussian', {get: () => live.gaussian ?? 0, configurable: true});
      Object.defineProperty(record, 'material', {get: () => live.material ?? null, configurable: true});
      Object.defineProperty(record, 'scheme', {get: () => live.scheme ?? null, configurable: true});
      Object.defineProperty(record, 'copies', {get: () => live.copies ?? null, configurable: true});
    }
    if (!live) record.spacing = spacing;
    record.backdrop = backdrop?.current ?? null;
    record.touch?.();
    const now = JSON.stringify([record.spacing, record.gaussian, record.material, record.scheme, record.copies]);
    if (now !== seen.current.values || record.backdrop !== seen.current.backdrop) { seen.current = {values: now, backdrop: record.backdrop}; ctx?.registry.invalidate(); }
  });
  useLayoutEffect(() => () => { if (record.morph) record.morph.dead = true; }, [record]);
  return <ContainerCtx.Provider value={record}>{children}</ContainerCtx.Provider>;
}

/** Props of `Glass`, besides a div's. */
export interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  /** Corner radius in CSS px, or 'capsule' (half the shorter side; default), 'circle' (the circle inscribed in the box), 'ellipse' (the box's ellipse) or 'rounded' (a radius that follows the height, as a rounded button's). */
  radius?: number | 'capsule' | 'circle' | 'ellipse' | 'rounded';
  /** With a number `radius`: a radius of their own for the bottom corners. */
  bottomRadius?: number;
  /** Its own shape, SVG path data in the box's CSS px; replaces `radius`. */
  shape?: string;
  /** Whether the material adapts to how bright the content behind it is. Default: glass up to 64 px on its shorter side does, larger glass doesn't. */
  tracksLuma?: boolean;
  /** false: drawn at fractional positions with antialiased edges, not snapped to whole device pixels. */
  snap?: boolean;
  /** Corner curve: 'continuous' (default) or 'circular'. */
  corner?: 'continuous' | 'circular';
  /** 'regular' (default), 'clear' (more transparent, for glass over photos and video), 'sheet' (a sheet's glass: no refraction past its edges) or 'text' (glass in the shape of text: pass the glyphs' outline as `shape`). */
  variant?: 'regular' | 'clear' | 'sheet' | 'text';
  /** A press lifts the glass into a lens: it grows, magnifies and sharpens what is behind it, and follows the finger a little. */
  interactive?: boolean;
  /** Tints the glass: a system colour ('blue', 'red', ...) or `#rrggbb`. */
  tint?: GlassTint;
  /** Prominent glass: filled with the tint (default blue), its label white. */
  prominent?: boolean;
  /** A disabled control's look: its label dimmed; prominent glass turns grey. */
  disabled?: boolean;
  /** A bar item's platter. @internal */
  bar?: boolean;
  /** An animation's transform over the press, updated each frame. @internal */
  motion?: GlassMotion;
  /** In an animated `<GlassContainer>`: an identity that follows this glass across a change, so it morphs from where it was instead of appearing anew. */
  glassId?: string | number;
  /** The scope `glassId` is compared in. */
  namespace?: string;
  /** How it appears and leaves in an animated container: 'matchedGeometry' (default: it grows out of and merges into the glass beside it), 'materialize' (fades in and out where it is) or 'identity' (at once). */
  transition?: 'matchedGeometry' | 'materialize' | 'identity';
  /** The press's behaviour for a menu's panel. @internal */
  flex?: 'menu';
  /** In a container: part of the merged shape only, not of the material's size. @internal */
  shapeOnly?: boolean;
  /** A control's lifted lens, updated each frame. @internal */
  lens?: LensFrame | null;
  /** Members of a `<GlassContainer>` with the same `union` become one shape over their bounding box (the first member's shape, tint and corners). */
  union?: string;
  /** Its element. */
  ref?: Ref<HTMLDivElement>;
}

export function forwardCapturedClick(e: React.MouseEvent<HTMLElement>, from: Element | null) {
  const host = e.currentTarget;
  if (e.target !== host || !from || from === host || !e.isTrusted) return false;
  const control = from.closest('button, a[href], [role="button"], [role="link"], label');
  if (!control || control === host || !host.contains(control) || control.contains(host)) return false;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (!under || !control.contains(under)) return false;
  e.stopPropagation(); e.preventDefault();
  const {ctrlKey, metaKey, shiftKey, altKey, button, clientX, clientY, screenX, screenY, detail} = e;
  control.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, composed: true, view: window, ctrlKey, metaKey, shiftKey, altKey, button, clientX, clientY, screenX, screenY, detail}));
  return true;
}

/** A piece of glass inside `<GlassRoot>`: lay it out with CSS like any element; it refracts, blurs and tints what is drawn behind it, and its children draw on top of it. */
export function Glass(props: GlassProps) {
  const {radius = 'capsule', bottomRadius, shape, tracksLuma, snap, corner = 'continuous', variant = 'regular', interactive = false, tint, prominent = false, disabled = false, bar = false, flex, shapeOnly, lens, union, motion: given, glassId, namespace, transition = 'matchedGeometry', style, className, children, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture, ref: outer, ...rest} = props;
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('<Glass> must be inside <GlassRoot>');
  const {registry} = ctx;
  const container = useContext(ContainerCtx);
  if (union !== undefined && !container) console.warn('[glass] `union` needs a <GlassContainer>; ignored');
  const ref = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
    if (typeof outer === 'function') outer(el); else if (outer) (outer as RefObject<HTMLDivElement | null>).current = el;
  }, [outer]);
  const record = useRef<GlassRecord | null>(null);
  const cm = container?.morph, [own] = useState<GlassMotion>(() => ({scale: [1, 1], translation: [0, 0], shape: 1})), motion = given ?? (cm ? own : undefined);
  const member = useRef<Entry | null>(null);
  if (cm && member.current) member.current.snap = member.current.read() ?? member.current.snap;

  useLayoutEffect(() => {
    const r: GlassRecord = {el: ref.current!, kind: 'glass', radius, bottomRadius, shape, tracksLuma, snap, corner, variant, interactive, tint, prominent, disabled, bar, flexVariant: flex, shapeOnly, lens, container, union, motion};
    record.current = r;
    registry.records.add(r);
    const m: Entry | null = cm ? {el: r.el, keys: '', motion: motion!, animated: true, leaving: null, id: glassId, ns: namespace, transition, snap: null, last: null,
      read: () => placeOf(r.el, registry.root)} : null;
    member.current = m;
    if (m) cm!.entries.add(m);
    return () => {
      registry.records.delete(r);
      if (m) {
        cm!.entries.delete(m);
        const b = m.snap ?? m.last, root = registry.root;
        if (!cm!.dead && cm!.animation !== null && b && root) {
          const el = r.el.cloneNode(true) as HTMLElement;
          el.setAttribute('aria-hidden', 'true'); el.removeAttribute('id');
          Object.assign(el.style, {position: 'absolute', left: `${b.cx - b.w / 2}px`, top: `${b.cy - b.h / 2}px`, width: `${b.w}px`, height: `${b.h}px`, margin: '0', boxSizing: 'border-box', pointerEvents: 'none', clipPath: ''});
          root.appendChild(el);
          const gr: GlassRecord = {...r, el};
          registry.records.add(gr);
          const ghost: Entry = {...m, el, snap: b, last: b, read: () => placeOf(el, registry.root),
            leaving: () => { registry.records.delete(gr); el.remove(); cm!.entries.delete(ghost); registry.invalidate(); }};
          cm!.entries.add(ghost);
        }
        container!.touch!();
      }
      registry.invalidate();
    };
  }, [registry]);

  useLayoutEffect(() => {
    const r = record.current! as unknown as Record<string, unknown>, next: Record<string, unknown> = {radius, bottomRadius, shape, tracksLuma, snap, corner, variant, interactive, tint, prominent, disabled, bar, flexVariant: flex, shapeOnly, lens, container, union, motion};
    const changed = Object.keys(next).some((k) => r[k] !== next[k]);
    Object.assign(r, next);
    if (member.current) { Object.assign(member.current, {id: glassId, ns: namespace, transition}); container!.touch!(); }
    if (changed) registry.invalidate();
  });

  const touch = (type: 'down' | 'move' | 'up', e: ReactPointerEvent<HTMLDivElement>) => {
    const r = record.current;
    if (!r || !interactive || (disabled && !bar)) return;
    ctx?.registry.renderer?.touch(r, type, e.clientX, e.clientY, e.timeStamp);
  };
  const pressed = useRef<number | null>(null);
  const downOn = useRef<Element | null>(null);
  const forwardClick = (e: React.MouseEvent<HTMLDivElement>) => forwardCapturedClick(e, downOn.current);

  return (
    <div
      ref={setRef}
      {...drawable}
      {...rest}
      className={`lg-glass ${className ?? ''}`}
      style={{...(interactive && (!disabled || bar) ? {touchAction: 'none'} : null), ...style}}
      onPointerDown={(e) => {
        if (interactive && (!disabled || bar)) { e.currentTarget.setPointerCapture(e.pointerId); pressed.current = e.pointerId; downOn.current = e.target as Element; }
        delete e.currentTarget.dataset.lgHanded;
        touch('down', e);
        onPointerDown?.(e);
      }}
      onPointerMove={(e) => {
        touch('move', e);
        onPointerMove?.(e);
      }}
      onPointerUp={(e) => {
        if (pressed.current === e.pointerId) pressed.current = null;
        delete e.currentTarget.dataset.lgHanded;
        touch('up', e);
        onPointerUp?.(e);
      }}
      onPointerCancel={(e) => {
        if (pressed.current === e.pointerId) pressed.current = null;
        delete e.currentTarget.dataset.lgHanded;
        touch('up', e);
        onPointerCancel?.(e);
      }}
      onClickCapture={(e) => { forwardClick(e); rest.onClickCapture?.(e); }}
      onLostPointerCapture={(e) => {
        if (pressed.current === e.pointerId && !('lgHanded' in e.currentTarget.dataset)) { pressed.current = null; touch('up', e); }
        onLostPointerCapture?.(e);
      }}
    >
      <ContainerCtx.Provider value={null}>{children}</ContainerCtx.Provider>
    </div>
  );
}

/** Plain DOM drawn on its own, in paint order, with no glass: content that must sit above a glass that would otherwise cover it, or take the pointer over glass. */
export function GlassLayer({style, className, children, ref: outer, plain = true, ...rest}: HTMLAttributes<HTMLDivElement> & {ref?: Ref<HTMLDivElement>; plain?: boolean}) {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('<GlassLayer> must be inside <GlassRoot>');
  const {registry} = ctx;
  const ref = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
    if (typeof outer === 'function') outer(el); else if (outer) (outer as RefObject<HTMLDivElement | null>).current = el;
  }, [outer]);
  useLayoutEffect(() => {
    const r: GlassRecord = {el: ref.current!, kind: 'layer', radius: 0, variant: 'regular', interactive: false};
    registry.records.add(r);
    registry.invalidate();
    return () => {
      registry.records.delete(r);
      registry.invalidate();
    };
  }, [registry]);
  return (
    <div ref={setRef} {...drawable} {...(plain ? {'data-lg-plain': ''} : {})} {...rest} className={className} style={style}>
      {children}
    </div>
  );
}

/** Text or icons in a palette tone over glass: the element's alpha is its coverage, its colour the tone applied to the glass under it, so it stays legible over anything. */
export function Vibrant({tone, style, className, children, ...rest}: HTMLAttributes<HTMLSpanElement> & {tone: Tone}) {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('<Vibrant> must be inside <GlassRoot>');
  const {registry} = ctx;
  const ref = useRef<HTMLSpanElement>(null);
  const record = useRef<GlassRecord | null>(null);
  useLayoutEffect(() => {
    const r: GlassRecord = {el: ref.current!, kind: 'vibrant', tone, radius: 0, variant: 'regular', interactive: false};
    record.current = r;
    registry.records.add(r);
    registry.invalidate();
    return () => {
      registry.records.delete(r);
      registry.invalidate();
    };
  }, [registry]);
  useLayoutEffect(() => {
    if (!record.current || record.current.tone === tone) return;
    record.current.tone = tone;
    registry.invalidate();
  });
  const color = toneCSS(tone, 'light', true, useGlassPlatform());
  return (
    <span ref={ref} {...drawable} data-lg-tone={tone} {...rest} className={className ? `lg-vibrant ${className}` : 'lg-vibrant'} style={{display: 'inline-block', color, ...style}}>
      {children}
    </span>
  );
}

export function useIconScale() {
  return useContext(Ctx)?.iconSet?.scale ?? 3;
}
export function useIcon(name: string, size: number, variant?: string) {
  const ctx = useContext(Ctx);
  return ctx?.iconSet?.entries[`symbol:${name}|${size}${variant ? `|${variant}` : ''}`] ?? null;
}

export function NamedIcon({name, size = 17, variant, layer, style, className}: {name: string; size?: number; variant?: string; layer?: [number, number]; style?: CSSProperties; className?: string}) {
  const ctx = useContext(Ctx), entry = useIcon(name, size, variant), ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const mask = ref.current?.firstElementChild as HTMLElement | null;
    if (!mask || !entry || !ctx?.iconSet) return;
    if (ref.current!.closest('.lg-glass, .lg-vibrant')) {
      mask.dataset.lgGlyphsGpu = `${ctx.iconSet.base}${encodeURIComponent(entry.file)}`; mask.dataset.lgEdge = ''; mask.style.visibility = 'hidden';
      if (entry.shapes) mask.dataset.lgShapes = JSON.stringify(entry.shapes);
    }
    else { delete mask.dataset.lgGlyphsGpu; mask.style.visibility = ''; }
  });
  if (!entry || !ctx?.iconSet) {
    if (hasIconFallback(name, size, variant)) return <IconFallback name={name} size={size} variant={variant} style={style} className={className} />;
    console.warn(`[glass] no icon "${name}" at ${size} pt${variant ? ` (${variant})` : ''} in <GlassRoot iconSet>`);
    return <span className={className} style={{display: 'inline-block', ...style}} />;
  }
  const [w, h] = entry.frame, scale = ctx.iconSet.scale, url = `${ctx.iconSet.base}${encodeURIComponent(entry.file)}`;
  return (
    <span ref={ref} aria-hidden="true" className={className} style={{display: 'inline-block', position: 'relative', flex: 'none', width: w, height: h, ...style}}>
      { }
      <span style={{position: 'absolute', left: 0, top: 0, translate: `${layer?.[0] ?? entry.layer?.[0] ?? 0}px ${layer?.[1] ?? entry.layer?.[1] ?? 0}px`, width: entry.size[0] / scale, height: entry.size[1] / scale, backgroundColor: 'currentColor', pointerEvents: 'none',
        maskImage: `url("${url}")`, maskSize: `${entry.size[0] / scale}px ${entry.size[1] / scale}px`, maskRepeat: 'no-repeat'}} />
    </span>
  );
}
