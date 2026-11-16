import {contentLensWGSL, copyWGSL, glyphWGSL, premultiplyWGSL, quadWGSL, vibrantWGSL} from './shaders';
import {barDisabledTintMatrix, barProminentLabel, disabledLabel, disabledTintMatrix, paletteVars, prominentLabel, tintMatrix, tintRGBA, toneMatrix, type GlassScheme, type GlassTint, type Tone} from './palette';
import {createRegularGlassRenderer} from './glassGPU.js';
import {createLensPasses, type LensFrame} from './lensGPU';
import {Flex} from './motion/flex.js';
import {advanceFluid, DEFAULT_SPRING, fluidSpring, outputSpring as createMaterialOutputSpring, retargetFluid, type FluidSpring} from './motion/spring.ts';
type MaterialOutputSpring = ReturnType<typeof createMaterialOutputSpring>;
import {MaterialPath} from './material/materialPath.js';
import {createAppearance as createWebToolbarMaterialAppearance} from './material/appearance.ts';
import {lumaNotification, LUMA_LIMITS} from './material/luma.ts';
import {criticalSpring, edgePocketsOf, pocketAlphas, pocketFloatingStyle, pocketLumaStyle, pocketLuminance, pocketMaterial, pocketOf, quantizeLuma, type PocketState} from './pocket';
import {IOS26_5} from './platform/ios26_5.ts';
import type {Platform} from './platform/types.ts';
import {createPocketGPU, type PocketFrame, type PocketGPU} from './pocketGPU';
import {createGroupGPU, type GroupGPU, type GroupSaved} from './groupGPU';
import {FrameProfiler} from './profile';
import {cacheDevice, type DeviceCache, uniformPool} from './gpuCache';
import {bbox, SceneWrites} from './sceneWrites';
import {addPainter, glassClock, presentationOf, presentedGlass, presentedOffset, requestFrame} from './frame';
import {createCATransitionBlur, transitionBlurPlan} from './render/transitionBlur.js';
import {createBackdropGPU, type BackdropSpec} from './backdropGPU';
import {flattenPath, type Contour} from './path';

interface AppearanceSnapshot {
  colorScheme: 'light' | 'dark';
  systemColorScheme: 'light' | 'dark';
  luminance: number | null;
  targetLuminance: number | null;
  materialComposite: {colorScheme: 'light' | 'dark'; weight: number}[];
  targetComposite: number[];
  animationActive: boolean;
  systemAppearanceEpoch: number;
}
interface Appearance {
  beginFeedbackSource(): number;
  snapshot(): AppearanceSnapshot;
  advance(nowMilliseconds: number): AppearanceSnapshot;
  accept(feedback: object, sourceEpoch: number, options?: {filteredLuminance?: number}): boolean;
}

interface GlassPasses {
  ready(id: string, ownTints?: number): boolean;
  prepare(id: string, ownTints?: number): Promise<void>;
  encode(enc: GPUCommandEncoder, o: object): unknown;
  encodeHighlight(enc: GPUCommandEncoder, o: object): void;
  encodeTints(enc: GPUCommandEncoder, o: object): void;
  encodeGlow(enc: GPUCommandEncoder, o: object): void;
  contentBefore(enc: GPUCommandEncoder, o: object): boolean;
  contentMask(enc: GPUCommandEncoder, o: object): void;
  field(id: string): {texture: GPUTexture; origin: number[]} | null;
  collect(onLuma: (id: string, sum: Float32Array) => void): void;
  release(id: string): void;
  endFrame(): void;
  destroy(): void;
}

export interface GlassContainerRecord {
  spacing: number;
  gaussian?: number;
  copies?: [number, number] | null;
  scheme?: GlassScheme | null;
  material?: {size: [number, number]; progress: number; from?: [number, number] | null; rim?: number; split?: {kind: 'button' | 'bar'; progress: number} | null} | null;
  backdrop?: HTMLElement | null;
}

const eventClock = () => (window as unknown as {__glassEventNow?: number}).__glassEventNow ?? glassClock();

export interface GlassRecord {
  el: HTMLElement;
  kind: 'glass' | 'layer' | 'vibrant';
  tone?: Tone;
  tint?: GlassTint;
  prominent?: boolean;
  disabled?: boolean;
  bar?: boolean;
  radius: number | 'capsule' | 'circle' | 'ellipse' | 'rounded';
  bottomRadius?: number;
  shape?: string;
  tracksLuma?: boolean;
  snap?: boolean;
  corner?: 'continuous' | 'circular';
  variant: 'regular' | 'clear' | 'sheet' | 'text';
  container?: GlassContainerRecord | null;
  union?: string;
  interactive: boolean;
  shapeOnly?: boolean;
  lens?: LensFrame | null;
  flexVariant?: 'menu';
  flex?: Flex;
  pressedAt?: number;
  pose?: {scale: number[]; translation: number[]; glow: {big: number; little: number; scale: number; position: number[]; side: number} | null};

  motion?: GlassMotion;
}

export interface GlassMotion { scale: [number, number]; translation: [number, number]; shape: number | [number, number]; radius?: number; glow?: number }

export interface SceneSource {
  root: () => HTMLElement | null;
  glasses: () => GlassRecord[];
  dark: () => boolean;
  platform?: () => Platform;
  placed?: () => void;
  drawn?: () => void;
}

type DrawableCanvas = HTMLCanvasElement & {
  requestPaint(): void;
  updateElementGeometry(el: Element, opts?: {canvasTransform?: DOMMatrix}): void;
};
type DrawQueue = GPUQueue & {
  drawElementImageToTexture(src: {source: Element}, dst: {texture: GPUTexture; size?: number[]}): void;
};
type PaintEvent = Event & {changedElements?: Element[]};

export {glassClock};

let nextId = 0;
function forgetDebug(id: string) {
  const w = window as unknown as Record<string, Record<string, unknown> | undefined>;
  for (const k of ['__glassElements', '__glassLooks', '__glassPockets']) if (w[k]) delete w[k]![id];
}

export function htmlInCanvasSupported(): boolean {
  if (typeof HTMLCanvasElement === 'undefined' || typeof navigator === 'undefined') return false;
  const p = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  return 'gpu' in navigator && 'requestPaint' in p && 'updateElementGeometry' in p && 'onpaint' in p;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function repaintDrawable(el: HTMLElement) {
  const f = el.style.filter;
  if (f === '' || f === 'opacity(1)' || f === 'brightness(1)') el.style.filter = f === 'opacity(1)' ? 'brightness(1)' : 'opacity(1)';
  else el.style.outline = el.style.outline ? '' : '0px solid transparent';
}
const drawnByUs = (records: GlassRecord[]) => records.filter((g) => (g.kind !== 'vibrant' || g.el.hasAttribute('drawable')) && !g.el.closest('[data-lg-hidden]:not([data-lg-portal])'));
const inPortal = (el: Element) => !!el.closest('[data-lg-portal]');

type LayoutMemo = {offset: Map<HTMLElement, [number, number]>; size: Map<HTMLElement, [number, number]>; scroll: Map<HTMLElement, [number, number]>;
  client: Map<HTMLElement, [number, number, number, number]>; overflows: Map<HTMLElement, boolean>; clip: Map<HTMLElement, Rect>; clipAll: Map<HTMLElement, Rect>; z: Map<HTMLElement, number[]>;
  parent: Map<HTMLElement, HTMLElement | null>; root: HTMLElement};
let memo: LayoutMemo | null = null;
const openLayoutMemo = (root: HTMLElement) => { memo = {offset: new Map(), size: new Map(), scroll: new Map(), client: new Map(), overflows: new Map(), clip: new Map(), clipAll: new Map(), z: new Map(),
  parent: new Map(), root}; };
const closeLayoutMemo = () => { memo = null; };
const scrollOf = (e: HTMLElement): [number, number] => {
  let v = memo?.scroll.get(e);
  if (!v) { v = [e.scrollLeft, e.scrollTop]; memo?.scroll.set(e, v); }
  return v;
};
const clientOf = (e: HTMLElement): [number, number, number, number] => {
  let v = memo?.client.get(e);
  if (!v) { v = [e.clientLeft, e.clientTop, e.clientWidth, e.clientHeight]; memo?.client.set(e, v); }
  return v;
};

export function layoutBox(el: HTMLElement, root: HTMLElement): Rect {
  const m = memo?.root === root ? memo : null;
  let x = 0, y = 0;
  for (let e: HTMLElement | null = el; e && e !== root; e = offsetParentOf(e, m)) {
    const [ox, oy] = fractionalOffset(e);
    x += ox;
    y += oy;
  }
  for (let e = el.parentElement; e && e !== root; e = e.parentElement) {
    const [sl, st] = scrollOf(e);
    x -= sl;
    y -= st;
  }
  const [px, py] = presentedOffset(el, root);
  const [w, h] = borderBoxSize(el);
  return {x: x + px, y: y + py, w, h};
}

function offsetParentOf(e: HTMLElement, m: LayoutMemo | null): HTMLElement | null {
  if (!m) return e.offsetParent as HTMLElement | null;
  let v = m.parent.get(e);
  if (v === undefined) { v = e.offsetParent as HTMLElement | null; m.parent.set(e, v); }
  return v;
}

function presentedScale(el: HTMLElement, root: HTMLElement, cx: number, cy: number) {
  let sx = 1, sy = 1, x = cx, y = cy;
  for (let e: HTMLElement | null = el; e && e !== root; e = e.parentElement) {
    const s = presentationOf(e)?.scale;
    if (!s) continue;
    const b = e === el ? null : layoutBox(e, root), ax = b ? b.x + b.w / 2 : x, ay = b ? b.y + b.h / 2 : y;
    x = ax + (x - ax) * s[0]; y = ay + (y - ay) * s[1]; sx *= s[0]; sy *= s[1];
  }
  return {sx, sy, dx: x - cx, dy: y - cy};
}

function snapDevicePixel(v: number): number {
  return Math.floor(v + 0.5 + 0.025);
}


export const roundedRadius = (height: number) => Math.ceil(height * .35 * .5);

function borderBoxSize(el: HTMLElement): [number, number] {
  const known = memo?.size.get(el);
  if (known) return known;
  const v = borderBoxSizeLive(el);
  memo?.size.set(el, v);
  return v;
}
function borderBoxSizeLive(el: HTMLElement): [number, number] {
  const s = getComputedStyle(el);
  const w = parseFloat(s.width), h = parseFloat(s.height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return [el.offsetWidth, el.offsetHeight];
  if (s.boxSizing === 'border-box') return [w, h];
  const sum = (...k: string[]) => k.reduce((a, p) => a + (parseFloat(s.getPropertyValue(p)) || 0), 0);
  return [w + sum('padding-left', 'padding-right', 'border-left-width', 'border-right-width'),
    h + sum('padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width')];
}

function fractionalOffset(e: HTMLElement): [number, number] {
  const known = memo?.offset.get(e);
  if (known) return known;
  const v = fractionalOffsetLive(e);
  memo?.offset.set(e, v);
  return v;
}
function fractionalOffsetLive(e: HTMLElement): [number, number] {
  const p = offsetParentOf(e, memo);
  if (e.dataset.lgExact != null && p && p === e.parentElement) {
    const r = e.getBoundingClientRect(), q = p.getBoundingClientRect(), k = q.width / borderBoxSize(p)[0] || 1;
    return [(r.left - q.left) / k - p.clientLeft + p.scrollLeft, (r.top - q.top) / k - p.clientTop + p.scrollTop];
  }
  const s = getComputedStyle(e);
  if (s.position === 'absolute' || s.position === 'fixed') {
    const left = parseFloat(s.left), top = parseFloat(s.top);
    if (Number.isFinite(left) && Number.isFinite(top)) return [left + (parseFloat(s.marginLeft) || 0), top + (parseFloat(s.marginTop) || 0)];
  }
  return [e.offsetLeft, e.offsetTop];
}

function clipBox(el: HTMLElement, root: HTMLElement, screen = true): Rect {
  const cache = memo && memo.root === root ? (screen ? memo.clip : memo.clipAll) : null, known = cache?.get(el);
  if (known) return {...known};
  const [, , rw, rh] = clientOf(root);
  let c: Rect = screen ? {x: 0, y: 0, w: rw, h: rh} : {x: -1e6, y: -1e6, w: 2e6, h: 2e6};
  for (let e = el.parentElement; e && e !== root; e = e.parentElement) {
    let clips = memo?.overflows.get(e);
    if (clips === undefined) { const s = getComputedStyle(e); clips = !(s.overflowX === 'visible' && s.overflowY === 'visible'); memo?.overflows.set(e, clips); }
    if (!clips) continue;
    const b = layoutBox(e, root), [cl, ct, cw, ch] = clientOf(e);
    const x0 = Math.max(c.x, b.x + cl), y0 = Math.max(c.y, b.y + ct);
    const x1 = Math.min(c.x + c.w, b.x + cl + cw), y1 = Math.min(c.y + c.h, b.y + ct + ch);
    c = {x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0)};
  }
  cache?.set(el, c);
  return {...c};
}

function zPath(el: HTMLElement, root: HTMLElement): number[] {
  const known = memo && memo.root === root ? memo.z.get(el) : undefined;
  if (known) return known;
  const v = zPathLive(el, root);
  if (memo && memo.root === root) memo.z.set(el, v);
  return v;
}
function zPathLive(el: HTMLElement, root: HTMLElement): number[] {
  const path: number[] = [];
  for (let e: HTMLElement | null = el; e && e !== root; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.position !== 'static' && s.zIndex !== 'auto') path.unshift(Number(s.zIndex) || 0);
  }
  return path;
}

export function paintOrder<T extends {el: HTMLElement}>(records: T[], root: HTMLElement): T[] {
  const keyed = records.map((r) => ({r, z: zPath(r.el, root)}));
  keyed.sort((a, b) => {
    for (let i = 0; i < Math.max(a.z.length, b.z.length); i++) {
      const d = (a.z[i] ?? 0) - (b.z[i] ?? 0);
      if (d) return d;
    }
    return a.r.el.compareDocumentPosition(b.r.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  return keyed.map((k) => k.r);
}

function clipPathFor(box: Rect, sx: number, sy: number, cx: number, cy: number, clip: Rect): string {
  const x0 = cx - (box.w / 2) * sx, y0 = cy - (box.h / 2) * sy;
  const top = Math.max(0, (clip.y - y0) / sy), left = Math.max(0, (clip.x - x0) / sx);
  const bottom = Math.max(0, (y0 + box.h * sy - (clip.y + clip.h)) / sy);
  const right = Math.max(0, (x0 + box.w * sx - (clip.x + clip.w)) / sx);
  if (top + left + bottom + right < 0.01) return '';
  const r = (v: number) => `${Math.round(v * 100) / 100}px`;
  return `inset(${r(top)} ${r(right)} ${r(bottom)} ${r(left)})`;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const SHADOW_MARGIN_PT = 32;
const UNIFORM_STRIDE = 256;
let texUsage = 0;
const TEX_USAGE_OF = () => texUsage ||= GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;


export interface FrameStats {
  frames: number;
  snapshotsDrawn: number;
  reblurs: number;
  pending: number;
  unprepared: number;
  adapting: number;
}

export class GlassRenderer {
  private get platform(): Platform { return this.source.platform?.() ?? IOS26_5; }
  private ctx: GPUCanvasContext;
  private format: GPUTextureFormat;
  private sampler: GPUSampler;
  private pipes!: {quad: GPURenderPipeline; present: GPURenderPipeline; vibrant: GPURenderPipeline; premultiply: GPURenderPipeline; glyph: GPURenderPipeline;
    layer: GPURenderPipeline; lensLayer: GPURenderPipeline; contentLens: GPURenderPipeline; portal: GPURenderPipeline; vibrantLayer: GPURenderPipeline; glyphLayer: GPURenderPipeline};
  private backdrops!: ReturnType<typeof createBackdropGPU>;
  private layerBlur!: {encode(a: {encoder: GPUCommandEncoder; source: GPUTexture; plan: unknown; id: unknown}): {texture: GPUTexture}; retain(ids: Set<unknown>): void; destroy(): void};
  private layerTextures: GPUTexture[] = [];
  private texturePool = new Map<string, {tex: GPUTexture; since: number}[]>();
  private texturePaints = 0;
  private frameTexture(w: number, h: number) {
    const tex = this.texturePool.get(`${w}x${h}`)?.pop()?.tex ?? this.device.createTexture({size: [w, h], format: 'rgba8unorm', usage: TEX_USAGE_OF()});
    this.layerTextures.push(tex);
    return tex;
  }
  private recycleFrameTextures() {
    const n = ++this.texturePaints;
    for (const x of this.layerTextures) { const k = `${x.width}x${x.height}`; let l = this.texturePool.get(k); if (!l) this.texturePool.set(k, l = []); l.push({tex: x, since: n}); }
    this.layerTextures = [];
    for (const l of this.texturePool.values()) while (l.length && n - l[0].since > 60) l.shift()!.tex.destroy();
  }
  private glyphTextures = new Map<string, GPUTexture | null>();
  private shapeTextures: GPUTexture[] = [];
  private shapeCache = new Map<string, {path: Path2D; rule: CanvasFillRule; x: number; y: number}[]>();
  private parsedShapes(json: string) {
    let v = this.shapeCache.get(json);
    if (!v) {
      v = (JSON.parse(json) as {x: number; y: number; rule: string; d: string}[]).map((sh) => ({path: new Path2D(sh.d), rule: sh.rule === 'even-odd' ? 'evenodd' : 'nonzero', x: sh.x, y: sh.y}));
      this.shapeCache.set(json, v);
    }
    return v;
  }
  private targets: {w: number; h: number; scene: GPUTexture; sample: GPUTexture; dest: GPUTexture} | null = null;
  private offscreen: GPUTexture | null = null;
  private grouped: GPUTexture | null = null;
  private routeRest: GPUTexture | null = null;
  private glassIds = new WeakMap<object, string>();
  private liveIds = new Set<string>();
  private paths = new Map<string, MaterialPath>();
  private appearances = new Map<string, {app: Appearance; epoch: number; feedbackId: number; pocket: string | null; outputs: MaterialOutputSpring | null; lumaAt: number; timer: number | null; tone: {spring: FluidSpring | null; w: number; target: number; epoch: number} | null}>();
  private lookIds = new Map<string, string>();
  private pockets = new Map<string, PocketState & {style: 'soft' | 'hard' | 'hidden'; attached?: boolean; inherited?: boolean; born?: boolean; lumaOff?: boolean; darkening: number; glass: 'light' | 'dark'; material: ReturnType<typeof pocketMaterial>;
    visibility: ReturnType<typeof criticalSpring>; replayAlpha: ReturnType<typeof criticalSpring>; blackAlpha: ReturnType<typeof criticalSpring>;
    velocity: number; scrollTop: number; scrollAt: number | null; lumaAt: number | null; timer: number | null}>();
  private pocketIds = new WeakMap<HTMLElement, string>();
  private snapshots = new Map<Element, {raw: GPUTexture; tex: GPUTexture}>();
  private schemes = new WeakMap<HTMLElement, GlassScheme>();
  private uniforms: GPUBuffer | null = null;
  private offPaint: () => void;
  stats: FrameStats = {frames: 0, snapshotsDrawn: 0, reblurs: 0, pending: 0, adapting: 0, unprepared: 0};

  static async create(canvas: HTMLCanvasElement, source: SceneSource): Promise<GlassRenderer> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter');
    const device = await adapter.requestDevice({requiredLimits: LUMA_LIMITS, requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : []});
    if (typeof (device.queue as DrawQueue).drawElementImageToTexture !== 'function')
      throw new Error('GPUQueue.drawElementImageToTexture missing');
    const cache = cacheDevice(device);
    const passes = (await createRegularGlassRenderer(device)) as GlassPasses;
    const r = new GlassRenderer(canvas as DrawableCanvas, device, source, passes, await createPocketGPU(device), await createGroupGPU(device));
    r.deviceCache = cache;
    return r;
  }

  private lens: ReturnType<typeof createLensPasses>;
  private toneSystem(el: Element, scheme: GlassScheme): GlassScheme {
    return el.closest('[data-lg-tone-color="page"]') ? (this.source.dark() ? 'dark' : 'light') : scheme;
  }
  private constructor(private canvas: DrawableCanvas, private device: GPUDevice, private source: SceneSource, private passes: GlassPasses, private pocketGPU: PocketGPU, private groupGPU: GroupGPU) {
    this.uniformPool = uniformPool(device);
    this.prof = new FrameProfiler(device, device.features.has('timestamp-query'));
    this.lens = createLensPasses(device);
    this.ctx = canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({device, format: this.format, alphaMode: 'opaque'});
    type UAData = {getHighEntropyValues(hints: string[]): Promise<{fullVersionList?: {brand: string; version: string}[]}>};
    (navigator as unknown as {userAgentData?: UAData}).userAgentData?.getHighEntropyValues(['fullVersionList']).then((v) => {
      const build = Number(v.fullVersionList?.find((b) => b.brand === 'Chromium')?.version.split('.')[2]);
      this.nestedRecordFixed = build >= 8118;
    }).catch(() => {});
    this.sampler = device.createSampler({magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge'});
    this.createPipelines();
    device.addEventListener('uncapturederror', (e) => console.error('[glass] gpu:', (e as GPUUncapturedErrorEvent).error.message));
    let recorded: Rect = {x: 0, y: 0, w: 0, h: 0};
    const inView = (): Rect => {
      const r = canvas.getBoundingClientRect(), k = r.width > 0 ? canvas.clientWidth / r.width : 1;
      const x0 = Math.max(0, -r.left), y0 = Math.max(0, -r.top), x1 = Math.min(r.width, innerWidth - r.left), y1 = Math.min(r.height, innerHeight - r.top);
      return {x: x0 * k, y: y0 * k, w: Math.max(0, x1 - x0) * k, h: Math.max(0, y1 - y0) * k};
    };
    const check = () => {
      if (this.nestedRecordFixed) return;
      const v = inView();
      if (v.w < 1 || v.h < 1) return;
      if (v.x >= recorded.x - 1 && v.y >= recorded.y - 1 && v.x + v.w <= recorded.x + recorded.w + 1 && v.y + v.h <= recorded.y + recorded.h + 1) return;
      recorded = v;
      for (const el of canvas.querySelectorAll<HTMLElement>('[drawable]')) repaintDrawable(el);
      this.invalidate();
    };
    const seen = new IntersectionObserver(check, {threshold: Array.from({length: 21}, (_, i) => i / 20)});
    seen.observe(canvas);
    addEventListener('scroll', check, {capture: true, passive: true});
    addEventListener('resize', check);
    const nearby = new IntersectionObserver((es) => {
      const v = es[es.length - 1].isIntersecting;
      if (v === this.near) return;
      this.near = v;
      if (v) canvas.requestPaint();
    }, {rootMargin: '25%'});
    nearby.observe(canvas);
    const onPaint = (e: Event) => {
      const changed0 = (e as PaintEvent).changedElements ?? [], dpr = window.devicePixelRatio || 1;
      if (!changed0.length && !this.asked && canvas.width === Math.max(1, Math.round(canvas.clientWidth * dpr)) && canvas.height === Math.max(1, Math.round(canvas.clientHeight * dpr))) return;
      if (!this.near && this.drawn) { for (const el of changed0) this.missed.add(el); this.asked = true; return; }
      this.asked = false;
      try {
        const changed = this.missed.size ? [...this.missed, ...changed0] : changed0;
        this.missed.clear();
        if (changed.length) { const v = inView(), x0 = Math.max(v.x, recorded.x), y0 = Math.max(v.y, recorded.y);
          recorded = {x: x0, y: y0, w: Math.max(0, Math.min(v.x + v.w, recorded.x + recorded.w) - x0), h: Math.max(0, Math.min(v.y + v.h, recorded.y + recorded.h) - y0)}; }
        const root = this.source.root();
        if (root) openLayoutMemo(root);
        this.render(new Set(changed));
        this.drawn = true;
      } catch (error) {
        console.error('[glass] render failed', error);
      } finally { closeLayoutMemo(); this.prof.finish(); this.deviceCache?.frame(); this.uniformPool.recycle(); }
    };
    const onScroll = () => { this.asked = true; this.syncClips(); };
    const mutated = new MutationObserver((records) => {
      if (this.asked) return;
      const first = new Map<Node, Map<string | null, string | null>>();
      for (const r of records) {
        if (r.type === 'childList') { this.invalidate(); return; }
        const m = first.get(r.target) ?? first.set(r.target, new Map()).get(r.target)!;
        if (!m.has(r.attributeName)) m.set(r.attributeName, r.oldValue);
      }
      for (const [node, m] of first) for (const [name, was] of m) {
        if ((name === null ? node.nodeValue : (node as Element).getAttribute(name)) !== was) { this.invalidate(); return; }
      }
    });
    mutated.observe(canvas, {subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true});
    canvas.addEventListener('paint', onPaint);
    canvas.addEventListener('scroll', onScroll, {capture: true, passive: true});
    const offPainter = addPainter(() => this.invalidate(), canvas);
    this.offPaint = () => {
      seen.disconnect(); nearby.disconnect(); mutated.disconnect(); removeEventListener('scroll', check, {capture: true}); removeEventListener('resize', check);
      offPainter();
      canvas.removeEventListener('paint', onPaint);
      canvas.removeEventListener('scroll', onScroll, {capture: true});
    };
  }

  private clipPaths = new Map<HTMLElement, string>();

  touch(g: GlassRecord, type: 'down' | 'move' | 'up', clientX: number, clientY: number, timeStamp: number) {
    const root = this.source.root();
    if (!root) return;
    const box = layoutBox(g.el, root), r = root.getBoundingClientRect(), k = r.width / borderBoxSize(root)[0] || 1;
    const p = [(clientX - r.left) / k - box.x, (clientY - r.top) / k - box.y];
    const flex = (g.flex ??= new Flex([box.w, box.h], window.devicePixelRatio, g.flexVariant, this.platform));
    if (type === 'down') { flex.resize([box.w, box.h]); flex.down(p, (eventClock() ?? timeStamp) / 1000); g.pressedAt = (eventClock() ?? timeStamp) / 1000; }
    else if (type === 'move') flex.move(p);
    else flex.up((eventClock() ?? timeStamp) / 1000);
    this.invalidate();
  }

  private place(g: GlassRecord, root: HTMLElement) {
    const box = layoutBox(g.el, root), clip = clipBox(g.el, root), hitClip = clipBox(g.el, root, false);
    const ps = presentedScale(g.el, root, box.x + box.w / 2, box.y + box.h / 2);
    const mo = g.motion, sx = (g.pose?.scale[0] ?? 1) * (mo?.scale[0] ?? 1) * ps.sx, sy = (g.pose?.scale[1] ?? 1) * (mo?.scale[1] ?? 1) * ps.sy;
    const tx = (g.pose?.translation[0] ?? 0) + (mo?.translation[0] ?? 0) + ps.dx, ty = (g.pose?.translation[1] ?? 0) + (mo?.translation[1] ?? 0) + ps.dy, shape = mo?.shape ?? 1;
    const shx = typeof shape === 'number' ? shape : shape[0], shy = typeof shape === 'number' ? shape : shape[1];
    let cx = box.x + box.w / 2 + tx, cy = box.y + box.h / 2 + ty;
    const host = g.kind === 'glass' && !g.interactive ? this.flexHostOf(g.el) : null;
    let still = {cx: box.x + box.w / 2 + ps.dx, cy: box.y + box.h / 2 + ps.dy, sx: ps.sx, sy: ps.sy}, fsx = sx, fsy = sy;
    if (host?.pose) {
      const hb = layoutBox(host.el, root), hx = hb.x + hb.w / 2, hy = hb.y + hb.h / 2, [hs0, hs1] = host.pose.scale, [ht0, ht1] = host.pose.translation;
      const H = (x: number, y: number) => [hx + (x - hx) * hs0 + ht0, hy + (y - hy) * hs1 + ht1];
      [cx, cy] = H(cx, cy);
      const [bx, by] = H(still.cx, still.cy); still = {cx: bx, cy: by, sx: still.sx * hs0, sy: still.sy * hs1};
      fsx = sx * hs0; fsy = sy * hs1;
    }
    const m = g.kind === 'glass' ? SHADOW_MARGIN_PT : 0, rx = fsx * Math.max(1, shx), ry = fsy * Math.max(1, shy);
    const reach: Rect = {x: cx - (box.w / 2) * rx - m, y: cy - (box.h / 2) * ry - m, w: box.w * rx + 2 * m, h: box.h * ry + 2 * m};
    const visible = box.w > 0 && box.h > 0 && clip.w > 0 && clip.h > 0;
    const free = ps.sx !== 1 || ps.sy !== 1 ? presentedOffset(g.el, root) : null;
    return {g, box, clip, hitClip, sx: fsx, sy: fsy, tx: cx - (box.x + box.w / 2), ty: cy - (box.y + box.h / 2), cx, cy, reach, visible, shx, shy, still, free};
  }

  private flexHostOf(el: HTMLElement): GlassRecord | null {
    const hostEl = el.closest('[data-lg-flex-scope]')?.querySelector('[data-lg-flex-host]');
    if (!hostEl || hostEl === el) return null;
    for (const r of this.source.glasses()) if (r.el === hostEl) return r;
    return null;
  }

  private everPlaced = new WeakSet<Element>();
  private rasterCover = new WeakMap<Element, Rect>();
  private placedOnCanvas = new WeakMap<Element, Rect>();
  private recull = new WeakSet<Element>();
  private nestedRecordFixed = false;
  private prof!: FrameProfiler;
  deviceCache: DeviceCache | null = null;
  private uniformPool: ReturnType<typeof uniformPool>;
  private writes = new SceneWrites();

  private applyClip(p: ReturnType<GlassRenderer['place']>) {
    const shown = p.box.w > 0 && p.box.h > 0 && p.hitClip.w > 0 && p.hitClip.h > 0;
    const value = shown ? clipPathFor(p.box, p.sx, p.sy, p.cx, p.cy, p.hitClip) : 'inset(100%)';
    if ((this.clipPaths.get(p.g.el) ?? '') === value) return;
    this.clipPaths.set(p.g.el, value);
    p.g.el.style.clipPath = value;
  }

  private syncClips() {
    const root = this.source.root();
    if (!root) return;
    const own = !memo;
    if (own) openLayoutMemo(root);
    let places: ReturnType<GlassRenderer['place']>[];
    try { places = drawnByUs(this.source.glasses()).map((g) => this.place(g, root)); } finally { if (own) closeLayoutMemo(); }
    for (const p of places) this.applyClip(p);
  }

  private materialPath(glass: {id: string}, surfaces: {member: {g: GlassRecord}; rect: {w: number; h: number}; contents: number | null}[], seconds: number) {
    const forced = (window as unknown as {__glassPath?: 'A' | 'T'}).__glassPath;
    if (surfaces.some((e) => e.contents !== null)) return 'T';
    if (surfaces.some((e) => e.member.g.bottomRadius !== undefined)) return 'T';
    if (surfaces.length !== 1) { this.paths.delete(glass.id); return forced ?? 'T'; }
    let state = this.paths.get(glass.id);
    if (!state) this.paths.set(glass.id, (state = new MaterialPath()));
    const {member: {g}, rect: {w, h}} = surfaces[0];
    if (g.pressedAt !== undefined) { state.invalidate(g.pressedAt); g.pressedAt = undefined; state.pressing = true; }
    else if (state.pressing && g.flex?.idle) { state.invalidate(seconds); state.pressing = false; }
    const path = state.update(seconds, [w, h], [w, h]);
    return forced ?? path;
  }

  private asked = true;
  private near = true;
  private drawn = false;
  private missed = new Set<Element>();
  invalidate() {
    this.asked = true;
    if (this.near || !this.drawn) this.canvas.requestPaint();
  }

  private lumaDue(st: {lumaAt: number | null; timer: number | null}, wall: number) {
    const I = this.platform.pocket.interval, EARLY = 35;
    const deadline = st.lumaAt ?? wall;
    if (wall < deadline - EARLY) {
      if (st.timer === null) st.timer = window.setTimeout(() => { st.timer = null; this.invalidate(); }, deadline - EARLY - wall + 1);
      return false;
    }
    st.lumaAt = (Math.floor(Math.max(wall, deadline) / I) + 1) * I;
    return true;
  }

  destroy() {
    this.offPaint();
    for (const id of this.liveIds) forgetDebug(id);
    for (const id of this.pocketGPU.ids()) forgetDebug(id);
    this.passes.destroy();
    this.device.destroy();
  }

  private createPipelines() {
    const d = this.device;
    const mod = (code: string) => d.createShaderModule({code});
    const copy = mod(copyWGSL), quad = mod(quadWGSL), vibrant = mod(vibrantWGSL), premultiply = mod(premultiplyWGSL), glyph = mod(glyphWGSL);
    const premul: GPUBlendState = {color: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}};
    const pipe = (module: GPUShaderModule, vs: string, fs: string, format: GPUTextureFormat, blend?: GPUBlendState) =>
      d.createRenderPipeline({layout: 'auto', vertex: {module, entryPoint: vs}, fragment: {module, entryPoint: fs, targets: [{format, blend}]}, primitive: {topology: 'triangle-list'}});
    this.pipes = {
      quad: pipe(quad, 'vsQuad', 'fsQuad', 'rgba8unorm', premul),
      present: pipe(copy, 'vsFull', 'fsCopy', this.format),
      vibrant: pipe(vibrant, 'vsQuad', 'fsVibrant', 'rgba8unorm'),
      premultiply: pipe(premultiply, 'vsFull', 'fsPremultiply', 'rgba16float'),
      glyph: pipe(glyph, 'vsQuad', 'fsGlyph', 'rgba8unorm'),
      layer: pipe(quad, 'vsQuad', 'fsLayer', 'rgba8unorm', premul),
      lensLayer: pipe(quad, 'vsQuad', 'fsLensLayer', 'rgba8unorm', premul),
      contentLens: pipe(mod(contentLensWGSL), 'vsQuad', 'fsContentLens', 'rgba8unorm', premul),
      portal: pipe(quad, 'vsQuad', 'fsPortal', 'rgba8unorm'),
      vibrantLayer: pipe(vibrant, 'vsQuad', 'fsVibrant', 'rgba8unorm', premul),
      glyphLayer: pipe(glyph, 'vsQuad', 'fsGlyph', 'rgba8unorm', premul),
    };
    this.layerBlur = createCATransitionBlur(d, 'rgba8unorm');
    this.backdrops = createBackdropGPU(d);
  }

  private ensureTargets(w: number, h: number) {
    if (this.targets && this.targets.w === w && this.targets.h === h) return this.targets;
    if (this.targets) for (const t of [this.targets.scene, this.targets.sample, this.targets.dest]) t.destroy();
    const tex = (tw: number, th: number) => this.device.createTexture({size: [Math.max(1, tw), Math.max(1, th)], format: 'rgba8unorm', usage: TEX_USAGE_OF()});
    this.targets = {w, h, scene: tex(w, h), sample: tex(w, h), dest: tex(w, h)};
    this.writes.track(this.targets.scene); this.writes.track(this.targets.sample);
    return this.targets;
  }

  private snapshot(el: HTMLElement, dpr: number, changed: Set<Element>): GPUTexture | null {
    const [bw, bh] = borderBoxSize(el), w = Math.round(bw * dpr), h = Math.round(bh * dpr);
    if (w < 1 || h < 1) return null;
    let s = this.snapshots.get(el);
    const stale = !s || s.raw.width !== w || s.raw.height !== h;
    if (stale) {
      s?.raw.destroy(); s?.tex.destroy();
      s = {raw: this.device.createTexture({size: [w, h], format: 'rgba8unorm', usage: TEX_USAGE_OF()}), tex: this.device.createTexture({size: [w, h], format: 'rgba16float', usage: TEX_USAGE_OF()})};
      this.snapshots.set(el, s);
    }
    if (stale || changed.has(el)) {
      try {
        (this.device.queue as DrawQueue).drawElementImageToTexture({source: el}, {texture: s!.raw, size: [w, h]});
        this.stats.snapshotsDrawn++;
      } catch {
        this.snapshots.delete(el);
        s!.raw.destroy(); s!.tex.destroy();
        return null;
      }
      const prev = this.prof.at('snapshot'), enc = this.prof.encoder(this.device.createCommandEncoder()), p = enc.beginRenderPass({colorAttachments: [{view: s!.tex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
      p.setPipeline(this.pipes.premultiply);
      p.setBindGroup(0, this.device.createBindGroup({layout: this.pipes.premultiply.getBindGroupLayout(0), entries: [{binding: 0, resource: s!.raw.createView()}]}));
      p.draw(3);
      p.end();
      this.device.queue.submit([enc.finish()]);
      this.prof.at(prev);
    }
    return s!.tex;
  }

  private render(changed: Set<Element>) {
    const canvas = this.canvas, root = this.source.root(), dpr = window.devicePixelRatio || 1;
    if (!root) return;
    const prof = this.prof;
    prof.begin();
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    const W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const now = glassClock() ?? performance.now();
    const traceLog = (window as unknown as {__glassTrace?: Record<string, unknown>[]}).__glassTrace;
    const trace: {t: number; at: number; pockets: Record<string, unknown>; glasses: Record<string, unknown>} | null = Array.isArray(traceLog)
      ? {t: +now.toFixed(2), at: +performance.now().toFixed(2), pockets: {}, glasses: {}} : null;
    if (trace) traceLog!.push(trace);
    for (const el of changed) { const p = this.placedOnCanvas.get(el); if (p) this.rasterCover.set(el, p); this.recull.delete(el); }

    const t = this.ensureTargets(W, H);
    const glasses = paintOrder(drawnByUs(this.source.glasses()), root);
    const dark = this.source.dark() ? 1 : 0;
    const rootTex = this.snapshot(root, dpr, changed);

    let moving = false, adapting = 0;
    for (const g of this.source.glasses()) if (g.flex && g.el.closest('[data-lg-hidden]')) { g.pose = g.flex.frame(now / 1000, [0, 0]); if (!g.flex.settled) moving = true; }
    const placed: ReturnType<GlassRenderer['place']>[] = [];
    const items = glasses.flatMap((g) => {
      if (g.flex) {
        const injected = (window as unknown as {__glassInjectPose?: GlassRecord['pose']}).__glassInjectPose;
        g.pose = injected ?? g.flex.frame(now / 1000, [0, 0]);
        (window as unknown as {__glassPose?: unknown}).__glassPose = g.pose;
        if (!g.flex.settled) moving = true;
      }
      const p = this.place(g, root);
      placed.push(p);
      return p.visible ? [{...p, fg: this.snapshot(g.el, dpr, changed)}] : [];
    });
    for (const p of placed) this.applyClip(p);
    type Frame = {g: {el: HTMLElement}; box: Rect; cx: number; cy: number; sx: number; sy: number};
    const rootFrame: Frame = {g: {el: root}, box: layoutBox(root, root), cx: root.offsetWidth / 2, cy: root.offsetHeight / 2, sx: 1, sy: 1};
    const glassItems = new Map(items.filter((i) => i.g.kind === 'glass').map((i) => [i.g.el, i]));
    const frameOf = (el: HTMLElement): Frame => { const o = glassItems.get(el); return !o ? rootFrame : o.g.lens ? {...o, ...o.still} : o; };
    const toCanvas = (f: Frame, x: number, y: number): [number, number] => [f.cx + (x - (f.box.x + f.box.w / 2)) * f.sx, f.cy + (y - (f.box.y + f.box.h / 2)) * f.sy];
    const drawableAbove = (el: Element): HTMLElement => { for (let a = el.parentElement; a && a !== root; a = a.parentElement) if (a.hasAttribute('drawable')) return a; return root; };
    const cssShift = (el: Element, f: Element): [number, number] => {
      let x = 0, y = 0;
      for (let a = el.parentElement; a && a !== f && a !== root; a = a.parentElement) {
        if (a.dataset.lgExact != null) continue;
        const s = getComputedStyle(a), t = s.translate === 'none' ? [] : s.translate.split(' ').map(parseFloat), m = s.transform === 'none' ? null : new DOMMatrix(s.transform);
        x += (t[0] || 0) + (m?.m41 ?? 0); y += (t[1] || 0) + (m?.m42 ?? 0);
      }
      return [x, y];
    };
    const placeIn = (n: HTMLElement, f: HTMLElement): Rect => {
      if (n.dataset.lgItem !== undefined && n.parentElement) {
        const h = inFrame(n.parentElement, f), [w, hh] = borderBoxSize(n);
        return {x: h.x + h.w / 2 - w / 2, y: h.y + h.h / 2 - hh / 2, w, h: hh};
      }
      const b = layoutBox(n, root), [dx, dy] = cssShift(n, f);
      return {x: b.x + dx, y: b.y + dy, w: b.w, h: b.h};
    };
    const inFrame = (el: HTMLElement, f: HTMLElement, unscale?: {host: HTMLElement; x: number; y: number; s: number}): Rect => {
      if (el === f) return f === root ? rootFrame.box : layoutBox(f, root);
      if (el !== root && el.hasAttribute('drawable')) return placeIn(el, f);
      const d = drawableAbove(el), db = d === root ? rootFrame.box : layoutBox(d, root), q = d.getBoundingClientRect(), c = el.getBoundingClientRect();
      const kx = q.width / db.w || 1, ky = q.height / db.h || 1;
      let left = c.left, top = c.top, w = c.width, h = c.height;
      if (unscale && unscale.host.contains(el) && d.contains(unscale.host)) { left = unscale.x + (left - unscale.x) / unscale.s; top = unscale.y + (top - unscale.y) / unscale.s; w /= unscale.s; h /= unscale.s; }
      const e = {x: db.x + (left - q.left) / kx, y: db.y + (top - q.top) / ky, w: w / kx, h: h / ky};
      if (d === f || d === root) return e;
      const p = inFrame(d, f);
      return {x: e.x - db.x + p.x, y: e.y - db.y + p.y, w: e.w, h: e.h};
    };
    for (const it of items) {
      if (it.g.kind !== 'vibrant') continue;
      const o = it.g.el.parentElement?.closest<HTMLElement>('.lg-glass');
      if (!o || !glassItems.has(o)) continue;
      const f = frameOf(o), b = placeIn(it.g.el, o);
      [it.cx, it.cy] = toCanvas(f, b.x + b.w / 2, b.y + b.h / 2);
      it.sx = f.sx; it.sy = f.sy;
    }

    const slots = 2 + items.length * 2;
    if (!this.uniforms || this.uniforms.size < slots * UNIFORM_STRIDE) {
      this.uniforms?.destroy();
      this.uniforms = this.device.createBuffer({size: Math.max(4, slots * 2) * UNIFORM_STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    }
    const u = new Float32Array((slots * UNIFORM_STRIDE) / 4);
    const at = (slot: number) => (slot * UNIFORM_STRIDE) / 4;
    u.set([W, H, (root.offsetWidth / 2) * dpr, (root.offsetHeight / 2) * dpr, (root.offsetWidth / 2) * dpr, (root.offsetHeight / 2) * dpr], at(0));
    items.forEach((it, i) => {
      const hw = (it.box.w / 2) * it.sx * dpr, hh = (it.box.h / 2) * it.sy * dpr;
      u.set([W, H, it.cx * dpr, it.cy * dpr, hw, hh], at(2 + i * 2));
    });
    this.device.queue.writeBuffer(this.uniforms, 0, u);

    const buf = (slot: number, size: number): GPUBindingResource => ({buffer: this.uniforms!, offset: slot * UNIFORM_STRIDE, size});
    const group = (p: GPURenderPipeline, entries: GPUBindingResource[]) =>
      this.device.createBindGroup({layout: p.getBindGroupLayout(0), entries: entries.map((resource, binding) => ({binding, resource}))});
    const view = (tex: GPUTexture) => tex.createView();
    const bg = dark ? {r: 0, g: 0, b: 0, a: 1} : {r: 1, g: 1, b: 1, a: 1};
    const writes = this.writes;
    writes.begin();
    const enc = writes.encoder(prof.encoder(this.device.createCommandEncoder()));
    const pass = (target: GPUTexture | GPUTextureView, load: 'clear' | 'load', draw: (p: GPURenderPassEncoder) => void) => {
      const v = target instanceof GPUTexture ? target.createView() : target;
      const p = enc.beginRenderPass({colorAttachments: [{view: v, loadOp: load, storeOp: 'store', clearValue: bg}]});
      draw(p);
      p.end();
    };
    const fullscreen = (p: GPURenderPassEncoder, pipe: GPURenderPipeline, entries: GPUBindingResource[]) => {
      p.setPipeline(pipe);
      p.setBindGroup(0, group(pipe, entries));
      p.draw(3);
    };
    let routeBase: GPUTexture | null = null;
    let routeRestBase: GPUTexture | null = null;
    let sampleFrom: GPUTexture | null = null, sourceMark = 0, sampleMark = 0;
    const refreshSample = () => {
      const src = routeBase ?? t.scene, whole = routeBase !== null || src !== sampleFrom || writes.since(t.sample, sampleMark).length > 0;
      const r = whole ? {x: 0, y: 0, w: W, h: H} : bbox(writes.since(src, sourceMark));
      if (r) enc.copyTextureToTexture({texture: src, origin: [r.x, r.y]}, {texture: t.sample, origin: [r.x, r.y]}, [r.w, r.h]);
      if (routeBase) { this.lens.group(enc, t.sample, t.scene, 1, false); sampleFrom = null; }
      else sampleFrom = src;
      sourceMark = writes.mark(src); sampleMark = writes.mark(t.sample);
      this.stats.reblurs++;
    };
    const scheme = dark ? 'dark' : 'light';
    const idOf = (o: object) => {
      let id = this.glassIds.get(o);
      if (!id) this.glassIds.set(o, (id = `g${nextId++}`));
      return id;
    };
    const byGlass = new Map<string, (typeof items)[number][]>();
    const firstFade = new Map<string, string>(), fadeGroups = new Map<string, string>(), lookIds = new Map<string, string>();
    for (const it of items) {
      if (it.g.kind !== 'glass') continue;
      const c = inPortal(it.g.el) ? null : it.g.container, base = c ? `${idOf(c)}${it.g.variant === 'clear' ? 'c' : ''}` : idOf(it.g.el);
      let id = base;
      if (c) {
        const p = presentedGlass(it.g.el, root), fade = `${p.glass} ${p.materialize} ${p.dematerialize}`, first = firstFade.get(base);
        if (first === undefined) firstFade.set(base, fade);
        else if (first !== fade) { const k = `${base}|${fade}`; id = fadeGroups.get(k) ?? `${base}/${idOf(it.g.el)}`; fadeGroups.set(k, id); }
        lookIds.set(id, base);
      }
      if (!byGlass.has(id)) byGlass.set(id, []);
      byGlass.get(id)!.push(it);
    }
    this.lookIds = lookIds;
    const lookOf = (id: string) => lookIds.get(id) ?? id;
    const glassOf = new Map([...byGlass].flatMap(([id, members]) => members.map((m) => [m, {id, members}] as const)));
    const pocketIdOf = (h: HTMLElement) => {
      let id = this.pocketIds.get(h);
      if (!id) this.pocketIds.set(h, (id = `p${nextId++}`));
      return id;
    };
    const pocketKey = (p: {host: HTMLElement; edge: 'top' | 'bottom'}) => `${pocketIdOf(p.host)}${p.edge === 'top' ? 't' : 'b'}`;
    const bands = new Map<string, {host: HTMLElement; edge: 'top' | 'bottom'; hardBottom?: number; x0: number; y0: number; x1: number; y1: number; floating: HTMLElement[]; attached: boolean}>();
    const addBar = (p: {host: HTMLElement; edge: 'top' | 'bottom'; hardBottom?: number}, b: Rect, attached: boolean) => {
      const key = pocketKey(p), o = bands.get(key);
      if (o) Object.assign(o, {x0: Math.min(o.x0, b.x), y0: Math.min(o.y0, b.y), x1: Math.max(o.x1, b.x + b.w), y1: Math.max(o.y1, b.y + b.h), hardBottom: o.hardBottom ?? p.hardBottom, attached: o.attached || attached});
      else bands.set(key, {...p, x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h, floating: [], attached});
    };
    for (const it of items) {
      const floating = it.g.kind === 'layer' && it.g.el.hasAttribute('data-lg-floating');
      if (!floating && (it.g.kind !== 'glass' || it.g.variant === 'clear' || it.g.variant === 'text' || it.g.lens)) continue;
      if (it.g.el.hasAttribute('data-lg-band-skip')) continue;
      const p = pocketOf(it.g.el), b = p ? layoutBox(it.g.el, root) : null;
      if (!p || !b || !floating && Math.min(b.w, b.h) > 64) continue;
      const key = pocketKey(p), o = bands.get(key);
      if (floating) { if (o) o.floating.push(it.g.el); else bands.set(key, {...p, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, floating: [it.g.el], attached: false}); }
      const region = floating ? it.g.el.dataset.lgPocketRegion?.split(' ').map(Number) : null;
      if (floating && !(region?.length === 2 && region.every(Number.isFinite))) continue;
      const b0 = region ? layoutBox(it.g.el.closest<HTMLElement>('[data-lg-edge]') ?? it.g.el, root) : b;
      if (region) Object.assign(b0, {x: b.x, w: b.w, y: b0.y + region[0], h: region[1] - region[0]});
      const bt = floating ? null : it.g.el.closest<HTMLElement>('[data-lg-band-top]');
      if (bt) { const y = layoutBox(bt, root).y + Number(bt.dataset.lgBandTop); Object.assign(b0, {y, h: b0.y + b0.h - y}); }
      const registered = edgePocketsOf(it.g.el);
      addBar(p, b0, !registered || registered.some((r) => r.host === p.host && r.edge === p.edge));
      for (const r of registered ?? []) if (r.host !== p.host || r.edge !== p.edge) addBar(r, b0, true);
    }
    (window as unknown as {__glassBands?: Record<string, number[]>}).__glassBands = Object.fromEntries([...bands].map(([k, v]) => [k, [+v.x0.toFixed(1), +v.y0.toFixed(1), +v.x1.toFixed(1), +v.y1.toFixed(1)]]));
    const pocketFrames = new Map<string, {frame: PocketFrame; scroll: HTMLElement | null; host: HTMLElement}>();
    for (const [id, band] of bands) {
      if (!Number.isFinite(band.y0)) continue;
      const host = band.host, top = band.edge === 'top';
      const style = (['soft', 'hard', 'hidden'].includes(host.dataset.lgPocket ?? '') ? host.dataset.lgPocket : 'soft') as 'soft' | 'hard' | 'hidden';
      let st = this.pockets.get(id);
      if (!st) {
        st = {replay: false, darkening: 0, style, glass: scheme, material: pocketMaterial(), visibility: criticalSpring(this.platform.pocket.springs.visibility), replayAlpha: criticalSpring(this.platform.pocket.springs.alpha), blackAlpha: criticalSpring(this.platform.pocket.springs.alpha),
          velocity: 0, scrollTop: 0, scrollAt: null, lumaAt: (Math.floor((glassClock() ?? performance.now()) / this.platform.pocket.interval) + 1) * this.platform.pocket.interval, timer: null};
        st.darkening = pocketLumaStyle(scheme, scheme, scheme === 'light' ? 1 : 0, st, 0, undefined, this.platform).darkening;
        const a0 = pocketAlphas(style, scheme, scheme, st.replay, this.platform);
        st.replayAlpha.set(a0.replay, now); st.blackAlpha.set(a0.black, now);
        const fromId = host.dataset.lgPocketFrom, fromHost = fromId ? document.querySelector<HTMLElement>(`[data-lg-pocket-id="${CSS.escape(fromId)}"]`) : null;
        const src = fromHost ? this.pockets.get(pocketKey({host: fromHost, edge: band.edge})) : undefined;
        if (src) { st.replayAlpha.set(src.replayAlpha.sample(now).value, now); st.blackAlpha.set(src.blackAlpha.sample(now).value, now); st.inherited = true; }
        const [bx, by] = presentedOffset(host, root);
        st.born = bx !== 0 || by !== 0;
        this.pockets.set(id, st);
      }
      const restyled = st.style !== style;
      st.style = style;
      const hb = layoutBox(host, root), x0 = Math.floor(hb.x * dpr), x1 = Math.ceil((hb.x + hb.w) * dpr);
      const oy = top ? hb.y * dpr : (band.y0 - 64.8) * dpr;
      const y0 = Math.floor(top ? oy : style === 'hard' ? band.y0 * dpr : oy), y1 = Math.ceil(top ? (style === 'hard' ? Math.max(band.y1, band.hardBottom ?? 0) : band.y1 + 64.8) * dpr : (hb.y + hb.h) * dpr);
      const [mx, my] = st.born ? presentedOffset(host, root) : [0, 0];
      const lx0 = Math.max(hb.x, (top ? hb.x : band.x0) + mx), lx1 = Math.min(hb.x + hb.w, (top ? hb.x + hb.w : band.x1) + mx);
      st.lumaOff = lx1 - lx0 < 1;
      const cx0 = x0 + Math.floor((lx0 * dpr - x0) / 16) * 16, cx1 = x0 + Math.ceil((lx1 * dpr - x0) / 16) * 16;
      const cy0 = oy + Math.floor(((band.y0 + my) * dpr - oy) / 16) * 16, cy1 = oy + Math.ceil(((band.y1 + my) * dpr - oy) / 16) * 16;
      const scroll = host.querySelector<HTMLElement>(':scope > [data-lg-scroll]');
      let reaches = true;
      if (scroll) {
        const sTop = scroll.scrollTop;
        if (st.scrollAt !== null && now > st.scrollAt) st.velocity = Math.abs(sTop - st.scrollTop) / (now - st.scrollAt);
        st.scrollTop = sTop; st.scrollAt = now;
        let extent = 0;
        for (const c of scroll.children) if (c instanceof HTMLElement) extent = Math.max(extent, c.offsetTop + c.offsetHeight + (parseFloat(getComputedStyle(c).marginBottom) || 0));
        extent = Math.min(scroll.scrollHeight, extent + (parseFloat(getComputedStyle(scroll).paddingBottom) || 0));
        const sb = layoutBox(scroll, root), contentTop = sb.y - sTop + (Number(scroll.dataset.lgContentTop) || 0), contentBottom = sb.y - sTop + extent;
        reaches = Math.min(band.y1, contentBottom) > Math.max(band.y0, contentTop) + .0001;
      }
      const dbg = (window as unknown as {__pocketAlpha?: number[]}).__pocketAlpha;
      const target = pocketAlphas(style, scheme, st.glass, st.replay, this.platform), visible = style === 'hidden' || !band.attached ? 0 : style === 'hard' || reaches ? 1 : 0;
      const reattached = st.attached !== band.attached;
      st.attached = band.attached;
      for (const [spring, v] of [[st.replayAlpha, target.replay], [st.blackAlpha, target.black], [st.visibility, visible]] as const)
        if (restyled || reattached && spring === st.visibility) spring.set(v, now); else spring.retarget(v, now);
      const vis = st.visibility.sample(now), ra = st.replayAlpha.sample(now), ba = st.blackAlpha.sample(now);
      if (!vis.settled || !ra.settled || !ba.settled) moving = true;
      const a = dbg ? {replay: dbg[1], black: dbg[2]} : {replay: ra.value, black: ba.value};
      if (trace) trace.pockets[id] = {scroll: scroll ? +scroll.scrollTop.toFixed(2) : null, vel: +st.velocity.toFixed(4), latch: st.replay, reaches, visible: +vis.value.toFixed(4), replay: +ra.value.toFixed(4), black: +ba.value.toFixed(4), glass: st.glass};
      if (st.inherited && ra.settled && ba.settled) st.inherited = false;
      const fstyle = pocketFloatingStyle(scheme, visible > 0, st.inherited ? (ba.value * 2 > pocketAlphas(style, scheme, st.glass, false, this.platform).black ? 1 : 0) : st.darkening);
      for (const el of band.floating) if (el.dataset.lgFloatingStyle !== fstyle) { el.dataset.lgFloatingStyle = fstyle; el.style.setProperty('--lg-floating', fstyle === 'dark' ? '#fff' : '#000'); }
      const floats = band.floating.length > 0, inset = floats ? 0 : Math.min(10, (band.y1 - band.y0) / 2);
      const contourY = (top ? band.y1 - inset : band.y0 + inset) * dpr;
      const frame: PocketFrame = {rect: [x0, y0, x1 - x0, y1 - y0], style, blur: floats, top, grid: top ? [(hb.x - 120) * dpr, (hb.y - 120) * dpr] : [(hb.x - 65 - 120) * dpr, contourY - 120 * dpr], contour: [(hb.x - 65) * dpr, contourY, (hb.x + hb.w + 65) * dpr],
        radius: (floats ? 18 : 24) * dpr, dpr, opacity: dbg ? dbg[0] : vis.value, replay: a.replay, black: a.black, luma: [cx0, cy0, cx1 - cx0, cy1 - cy0]};
      pocketFrames.set(id, {frame, scroll, host});
    }
    for (const id of this.pocketGPU.ids()) if (!pocketFrames.has(id)) { this.pocketGPU.release(id); this.pockets.delete(id); forgetDebug(id); }
    const pocketStarts = new Map<HTMLElement, string[]>(), pocketEnds = new Map<(typeof items)[number] | null, string[]>();
    for (const [id, {scroll}] of pocketFrames) {
      const k = scroll ? items.findIndex((it) => it.g.el === scroll) : -1;
      if (scroll && k >= 0) pocketStarts.set(scroll, [...(pocketStarts.get(scroll) ?? []), id]);
      let e = k + 1;
      while (scroll && e < items.length && scroll.contains(items[e].g.el)) e++;
      const at = e < items.length ? items[e] : null;
      pocketEnds.set(at, [...(pocketEnds.get(at) ?? []), id]);
    }
    this.groupGPU.begin(writes, (n) => this.uniformPool.take(n));
    const groups = new Map<HTMLElement, {first: number; last: number; saved: GroupSaved | null; done: boolean}>(), itemIndex = new Map(items.map((it, i) => [it, i]));
    const identity = new Map<HTMLElement, boolean>(), isIdentity = (el: HTMLElement) => {
      let v = identity.get(el);
      if (v === undefined) { const o = presentationOf(el)?.opacity ?? 1; identity.set(el, v = !(o < 1) && !el.dataset.lgCard && !el.hasAttribute('data-lg-below-card')); }
      return v;
    };
    items.forEach((it, i) => {
      for (let gEl = it.g.el.closest<HTMLElement>('[data-lg-group]'); gEl; gEl = gEl.parentElement?.closest<HTMLElement>('[data-lg-group]') ?? null) {
        if (isIdentity(gEl)) continue;
        const g = groups.get(gEl);
        if (g) g.last = i; else groups.set(gEl, {first: i, last: i, saved: null, done: false});
      }
    });
    const elementOf = (it: (typeof items)[number]) => {
      const wPt = it.box.w * it.sx * it.shx, hPt = it.box.h * it.sy * it.shy;
      const snap = it.g.lens || it.g.snap === false ? (v: number) => v : snapDevicePixel;
      const [fx, fy] = it.free ?? [0, 0], lx = snap((it.box.x - fx) * dpr), ly = snap((it.box.y - fy) * dpr), x0 = lx + fx * dpr, y0 = ly + fy * dpr;
      const w0 = snap((it.box.x - fx + it.box.w) * dpr) - lx, h0 = snap((it.box.y - fy + it.box.h) * dpr) - ly;
      const w = w0 * it.sx * it.shx, h = h0 * it.sy * it.shy;
      return {member: it, contents: null as number | null, path: null as {local: {segments: Float32Array; contours: Contour[]; at: number[]; k: number[]}; key: string} | null, rect: {x: x0 + (w0 - w) / 2 + it.tx * dpr, y: y0 + (h0 - h) / 2 + it.ty * dpr, w, h},
        radius: it.g.motion?.radius !== undefined ? it.g.motion.radius : typeof it.g.radius === 'number' ? it.g.radius * Math.min(it.sx * it.shx, it.sy * it.shy) : it.g.radius === 'rounded' ? roundedRadius(h / dpr) : Math.min(wPt, hPt) / 2, cornerStyle: it.g.radius === 'circle' || it.g.radius === 'ellipse' || it.g.radius === 0 || it.g.corner === 'circular' ? 0 : 1,
        bottomRadius: typeof it.g.radius === 'number' && it.g.bottomRadius !== undefined && it.g.motion?.radius === undefined ? it.g.bottomRadius * Math.min(it.sx * it.shx, it.sy * it.shy) : undefined};
    };
    const inBox = (e: ReturnType<typeof elementOf>) => {
      if (e.member.g.shape) {
        const f = flattenPath(e.member.g.shape), X = e.rect.x / dpr, Y = e.rect.y / dpr, kx = e.rect.w / dpr / e.member.box.w, ky = e.rect.h / dpr / e.member.box.h;
        const key = `${X},${Y},${kx},${ky}|${e.member.g.shape}`, b = f.bounds;
        return {...e, contents: e.member.g.tint || e.member.g.prominent ? 11 : 0, path: {local: {segments: f.segments, contours: f.contours, at: [X, Y], k: [kx, ky]}, key}, rect: {x: (X + b.x * kx) * dpr, y: (Y + b.y * ky) * dpr, w: b.w * kx * dpr, h: b.h * ky * dpr}};
      }
      if (e.member.g.radius === 'capsule') e.radius = Math.min(e.rect.w, e.rect.h) / dpr / 2;
      if (e.member.g.radius === 'ellipse' && Math.abs(e.rect.w - e.rect.h) / dpr >= .001) return {...e, contents: e.member.g.tint || e.member.g.prominent ? 11 : 0};
      if (e.member.g.radius !== 'circle' && e.member.g.radius !== 'ellipse') return e;
      const side = Math.min(e.rect.w, e.rect.h);
      return {...e, radius: side / dpr / 2, rect: {x: e.rect.x + (e.rect.w - side) / 2, y: e.rect.y + (e.rect.h - side) / 2, w: side, h: side}};
    };
    const hull = (a: Rect, b: Rect): Rect => {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      return {x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y};
    };
    const elementsOf = (members: (typeof items)[number][]) => {
      const out: ReturnType<typeof elementOf>[] = [], unions = new Map<string, ReturnType<typeof elementOf>>();
      for (const m of members) {
        const e = elementOf(m), first = m.g.container && m.g.union !== undefined ? unions.get(m.g.union) : undefined;
        if (first) first.rect = hull(first.rect, e.rect);
        else {
          out.push(e);
          if (m.g.container && m.g.union !== undefined) unions.set(m.g.union, e);
        }
      }
      return out.map(inBox);
    };
    const live = new Set<string>();
    const ownerOf = (it: (typeof items)[number]) => (it.g.kind === 'vibrant' ? (it.g.el.parentElement?.closest('.lg-glass') as HTMLElement | null) : null);
    const owned = new Set(items.filter((it) => { const o = ownerOf(it); return o && items.some((g) => g.g.el === o && g.g.kind === 'glass'); }));
    const unders = new Map<string, GPUTexture>();
    const underOf = (el: Element) => { const k = el.closest('[data-lg-under]')?.getAttribute('data-lg-under'); return k != null ? unders.get(k) ?? null : null; };
    const underTexture = (k: string) => { let x = unders.get(k); if (!x) { x = this.frameTexture(W, H); enc.copyTextureToTexture({texture: t.scene}, {texture: x}, [W, H]); unders.set(k, x); } return x; };
    const toneWeights = new Map<Element, {scheme: GlassScheme; w: number}>();
    const toneAt = (tone: Tone, scheme: GlassScheme, el: Element) => {
      const tw = toneWeights.get(el.parentElement?.closest('.lg-glass') ?? el);
      if (!tw || tw.scheme !== scheme || tw.w === (scheme === 'dark' ? 1 : 0)) return toneMatrix(tone, scheme, this.toneSystem(el, scheme), this.platform);
      const a = toneMatrix(tone, 'light', this.toneSystem(el, 'light'), this.platform), b = toneMatrix(tone, 'dark', this.toneSystem(el, 'dark'), this.platform);
      return a.map((v, i) => v + (b[i] - v) * tw.w);
    };
    const drawVibrant = (vi: (typeof items)[number], scheme: GlassScheme) => {
      const was = prof.at('content vibrant');
      try { drawVibrantNow(vi, scheme); } finally { prof.at(was); }
    };
    const drawVibrantNow = (vi: (typeof items)[number], scheme: GlassScheme) => {
      const j = items.indexOf(vi), under = underOf(vi.g.el);
      if (!vi.fg || !vi.g.tone) return;
      const bx = vi.cx - (vi.box.w / 2) * vi.sx, by = vi.cy - (vi.box.h / 2) * vi.sy, bw = vi.box.w * vi.sx, bh = vi.box.h * vi.sy;
      const x0 = Math.max(0, Math.floor(Math.max(bx, vi.clip.x) * dpr)), y0 = Math.max(0, Math.floor(Math.max(by, vi.clip.y) * dpr));
      const x1 = Math.min(W, Math.ceil(Math.min(bx + bw, vi.clip.x + vi.clip.w) * dpr)), y1 = Math.min(H, Math.ceil(Math.min(by + bh, vi.clip.y + vi.clip.h) * dpr));
      if (x1 <= x0 || y1 <= y0) return;
      let opacity = 1;
      for (let a: HTMLElement | null = vi.g.el.parentElement; a && a !== root; a = a.parentElement) opacity *= parseFloat(getComputedStyle(a).opacity);
      if (opacity <= 0) return;
      if (offscreen && bare && vi.g.el.closest('[data-lg-item]')) return;
      this.device.queue.writeBuffer(this.uniforms!, (3 + j * 2) * UNIFORM_STRIDE, new Float32Array([...toneAt(vi.g.tone, scheme, vi.g.el), opacity, under ? 1 : 0]));
      if (!under) enc.copyTextureToTexture({texture: t.scene, origin: [x0, y0]}, {texture: t.dest, origin: [x0, y0]}, [x1 - x0, y1 - y0]);
      const pipe = under ? this.pipes.vibrantLayer : this.pipes.vibrant;
      pass(t.scene, 'load', (p) => {
        p.setScissorRect(x0, y0, x1 - x0, y1 - y0);
        p.setPipeline(pipe);
        p.setBindGroup(0, group(pipe, [view(vi.fg!), this.sampler, buf(2 + j * 2, 32), view(under ?? t.dest), buf(3 + j * 2, 96)]));
        p.draw(6);
      });
    };

    this.backdrops.flush();
    for (const x of this.shapeTextures) x.destroy();
    this.shapeTextures = [];
    const glyphTexture = (url: string) => {
      if (!this.glyphTextures.has(url)) {
        this.glyphTextures.set(url, null);
        fetch(url).then((r) => r.blob()).then((b) => createImageBitmap(b, {premultiplyAlpha: 'none', colorSpaceConversion: 'none'})).then((bitmap) => {
          const tex = this.device.createTexture({size: [bitmap.width, bitmap.height], format: 'rgba8unorm', usage: TEX_USAGE_OF()});
          this.device.queue.copyExternalImageToTexture({source: bitmap}, {texture: tex}, [bitmap.width, bitmap.height]);
          this.glyphTextures.set(url, tex);
          this.invalidate();
        });
      }
      return this.glyphTextures.get(url);
    };
    const glyphPlace = (m: Frame, el: HTMLElement, unscale?: {host: HTMLElement; x: number; y: number; s: number}) => {
      let tex = glyphTexture(el.dataset.lgGlyphsGpu!);
      if (!tex) return null;
      const r = layoutBox(el, root), e = inFrame(el, m.g.el, unscale);
      const v = el.dataset.lgEdge !== undefined ? el.closest<HTMLElement>('.lg-vibrant') : null, vp = v?.parentElement;
      let ex = 0, ey = 0;
      if (v && vp && m.g.el.contains(v) && vp.children.length === 1 && !vp.hasAttribute('drawable')) {
        const a = placeIn(v, m.g.el), b = inFrame(vp, m.g.el);
        if (Math.abs(a.w - b.w) < .02 && Math.abs(a.h - b.h) < .02) { ex = b.x - a.x; ey = b.y - a.y; }
      }
      const own = unscale || !r.w ? 1 : e.w / r.w, ownY = unscale || !r.h ? 1 : e.h / r.h;
      const lx = e.x + ex + (r.w * own) / 2 - (m.box.x + m.box.w / 2), ly = e.y + ey + (r.h * ownY) / 2 - (m.box.y + m.box.h / 2);
      const hw0 = (tex.width / 2) * (dpr / Math.round(tex.width / r.w)) * own, hh0 = (tex.height / 2) * (dpr / Math.round(tex.width / r.w)) * ownY;
      const restX = snapDevicePixel((m.box.x + m.box.w / 2 + lx) * dpr - hw0) + hw0 - (m.box.x + m.box.w / 2) * dpr, restY = snapDevicePixel((m.box.y + m.box.h / 2 + ly) * dpr - hh0) + hh0 - (m.box.y + m.box.h / 2) * dpr;
      let cx = m.cx * dpr + restX * m.sx, cy = m.cy * dpr + restY * m.sy;
      const texel = dpr / Math.round(tex.width / r.w);
      let hw = (tex.width / 2) * texel * m.sx * own, hh = (tex.height / 2) * texel * m.sy * ownY;
      const phase = (el.closest<HTMLElement>('[data-lg-phase]')?.dataset.lgPhase ?? '0 0').split(' ').map(Number);
      if (m.sx === 1 && m.sy === 1) { cx = snapDevicePixel(cx - hw - phase[0]) + hw + phase[0]; cy = snapDevicePixel(cy - hh - phase[1]) + hh + phase[1]; }
      let pad = el.dataset.lgEdge !== undefined ? 1 : 0;
      const shapes = el.dataset.lgShapes;
      if (shapes && !(m.sx === 1 && m.sy === 1)) {
        const X0 = Math.floor(cx - hw) - 1, Y0 = Math.floor(cy - hh) - 1, cw = Math.ceil(cx + hw) + 1 - X0, ch = Math.ceil(cy + hh) + 1 - Y0;
        const canvas = new OffscreenCanvas(cw, ch), c = canvas.getContext('2d')!;
        c.fillStyle = '#fff';
        for (const sh of this.parsedShapes(shapes)) {
          c.setTransform(m.sx * dpr, 0, 0, m.sy * dpr, cx - hw - X0 + sh.x * m.sx * dpr, cy - hh - Y0 + sh.y * m.sy * dpr);
          c.fill(sh.path, sh.rule);
        }
        tex = this.device.createTexture({size: [cw, ch], format: 'rgba8unorm', usage: TEX_USAGE_OF()});
        this.device.queue.copyExternalImageToTexture({source: canvas}, {texture: tex}, [cw, ch]);
        this.shapeTextures.push(tex);
        cx = X0 + cw / 2; cy = Y0 + ch / 2; hw = cw / 2; hh = ch / 2; pad = 0;
      }
      const rot = (Number(el.closest<HTMLElement>('[data-lg-rotate]')?.dataset.lgRotate) || 0) * Math.PI / 180;
      return {tex, cx, cy, hw, hh, pad, rot};
    };
    const drawGlyphs = (m: (typeof items)[number], s: number[], scheme: GlassScheme, overPage = false) => {
      const was = prof.at('content glyphs');
      try { drawGlyphsNow(m, s, scheme, overPage); } finally { prof.at(was); }
    };
    const drawGlyphsNow = (m: (typeof items)[number], s: number[], scheme: GlassScheme, overPage = false) => {
      for (const el of m.g.el.querySelectorAll<HTMLElement>('[data-lg-glyphs-gpu]')) {
        if (layerOf(el)) continue;
        const at = glyphPlace(m, el);
        if (!at) continue;
        const {tex, cx, cy, pad, rot} = at, hw = Math.abs(Math.cos(rot)) * at.hw + Math.abs(Math.sin(rot)) * at.hh, hh = Math.abs(Math.sin(rot)) * at.hw + Math.abs(Math.cos(rot)) * at.hh;
        const cb = clipBox(el, root), c0 = Math.floor(cb.x * dpr + 1e-6), c1 = Math.floor(cb.y * dpr + 1e-6), c2 = Math.ceil((cb.x + cb.w) * dpr - 1e-6), c3 = Math.ceil((cb.y + cb.h) * dpr - 1e-6);
        const x0 = Math.max(s[0], c0, Math.floor(cx - hw) - pad), y0 = Math.max(s[1], c1, Math.floor(cy - hh) - pad), x1 = Math.min(s[0] + s[2], c2, Math.ceil(cx + hw) + pad), y1 = Math.min(s[1] + s[3], c3, Math.ceil(cy + hh) + pad);
        if (x1 <= x0 || y1 <= y0) continue;
        const rgba = getComputedStyle(el).color.match(/[\d.]+/g)!.map(Number);
        let opacity = 1;
        for (let a: HTMLElement | null = el.parentElement; a && a !== root; a = a.parentElement) opacity *= parseFloat(getComputedStyle(a).opacity);
        rgba[3] = (rgba[3] ?? 1) * opacity;
        const u = this.uniformPool.take(368);
        this.device.queue.writeBuffer(u, 0, new Float32Array([W, H, cx, cy, at.hw, at.hh, pad, rot]));
        const tone = items.find((v) => v.g.kind === 'vibrant' && v.g.tone && v.g.el.contains(el))?.g.tone;
        const under = tone ? underOf(el) : null, pipe = under ? this.pipes.glyphLayer : this.pipes.glyph;
        this.device.queue.writeBuffer(u, 256, new Float32Array([rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] ?? 1, ...(tone ? toneAt(tone, scheme, el) : new Float32Array(20)), tone ? 1 : 0, overPage ? 1 : 0, under ? 1 : 0, 0]));
        if (!under) enc.copyTextureToTexture({texture: t.scene, origin: [x0, y0]}, {texture: t.dest, origin: [x0, y0]}, [x1 - x0, y1 - y0]);
        pass(t.scene, 'load', (p) => {
          p.setScissorRect(x0, y0, x1 - x0, y1 - y0);
          p.setPipeline(pipe);
          p.setBindGroup(0, group(pipe, [view(tex), this.sampler, {buffer: u, offset: 0, size: 32}, view(under ?? t.dest), {buffer: u, offset: 256, size: 112}]));
          p.draw(6);
        });
      }
    };

    (window as unknown as {__glassLayers?: unknown[]}).__glassLayers = [];
    this.recycleFrameTextures();
    const usedEls = new Set<Element>(), layerIds = new Set<unknown>(), drawnLayers = new Set<Element>();
    let drawOne: (it: (typeof items)[number]) => void = () => {};
    let offscreen = 0, bare = false;
    let consumer = -1;
    const noLayers = !!(window as unknown as {__glassNoLayers?: boolean}).__glassNoLayers;
    const layerOf = (el: Element) => (noLayers ? null : el.closest<HTMLElement>('[data-lg-layer]'));
    const placedItems: {el: HTMLElement; m: DOMMatrix; w: number; h: number; owner: HTMLElement}[] = [];
    const itemTexture = (host: HTMLElement) => {
      const w = host.querySelector<HTMLElement>(':scope > [data-lg-item]');
      if (!w) return null;
      const src = (w as unknown as {__lgSource?: Element}).__lgSource;
      usedEls.add(w); if (src) usedEls.add(src);
      return this.snapshot(w, dpr, changed) ?? (src ? this.snapshots.get(src)?.tex ?? null : null);
    };
    const itemAt = (host: HTMLElement, o: (typeof items)[number] | null) => {
      const fe = o ? o.g.el : root, f = frameOf(fe), h = inFrame(host, fe), [cx, cy] = toCanvas(f, h.x + h.w / 2, h.y + h.h / 2);
      return {cx, cy, sx: f.sx, sy: f.sy};
    };
    const drawItems = (scope: HTMLElement, o: (typeof items)[number] | null, s: number[]) => {
      const was = prof.at('content items');
      try { drawItemsNow(scope, o, s); } finally { prof.at(was); }
    };
    const drawItemsNow = (scope: HTMLElement, o: (typeof items)[number] | null, s: number[]) => {
      for (const w of scope.querySelectorAll<HTMLElement>('[data-lg-item]')) {
        const host = w.parentElement!;
        if ((o ? host.closest('.lg-glass') !== o.g.el : !!host.closest('.lg-glass'))) continue;
        const at = itemAt(host, o), [lw, lh] = borderBoxSize(w);
        placedItems.push({el: w, m: new DOMMatrix([at.sx, 0, 0, at.sy, at.cx - lw / 2 * at.sx, at.cy - lh / 2 * at.sy]), w: lw, h: lh, owner: o ? o.g.el : root});
        if (layerOf(host)) continue;
        const tex = itemTexture(host);
        let a = 1;
        for (let e: HTMLElement | null = host; e && e !== scope && e !== root; e = e.parentElement) a *= parseFloat(getComputedStyle(e).opacity);
        if (!tex || !(a > 0)) continue;
        const u = this.uniformPool.take(32);
        this.device.queue.writeBuffer(u, 0, new Float32Array([W, H, at.cx * dpr, at.cy * dpr, tex.width / 2 * at.sx, tex.height / 2 * at.sy, a, 0]));
        pass(t.scene, 'load', (p) => { p.setScissorRect(s[0], s[1], s[2], s[3]); p.setPipeline(this.pipes.layer); p.setBindGroup(0, group(this.pipes.layer, [view(tex), this.sampler, {buffer: u, offset: 0, size: 32}])); p.draw(6); });
      }
    };
    const drawLayer = (host: HTMLElement, o: (typeof items)[number] | null, s: number[], scheme: GlassScheme, overPage: boolean) => {
      const was = prof.at('content layer');
      try { drawLayerNow(host, o, s, scheme, overPage); } finally { prof.at(was); }
    };
    const drawLayerNow = (host: HTMLElement, o: (typeof items)[number] | null, s: number[], scheme: GlassScheme, overPage: boolean) => {
      if (drawnLayers.has(host)) return;
      if (consumer === 0 && host.dataset.lgConsumer === '1') return;
      drawnLayers.add(host);
      const [opacity, scale, given] = (host.dataset.lgLayer ?? '').split(' ').map(Number);
      const portalSpec = host.dataset.lgPortalSpec?.split(' ') ?? null;
      const own = portalSpec ? null : host === o?.g.el ? o.fg : itemTexture(host);
      if (!(opacity > 0) || !(scale > 0)) return;
      const fe = o ? o.g.el : root, frame = frameOf(fe), sx = frame.sx, sy = frame.sy, hp = inFrame(host, fe);
      const blur = given * (sx + sy) / 2;
      const hs = getComputedStyle(host), hm = hs.transform === 'none' ? null : new DOMMatrix(hs.transform), ks = (parseFloat(hs.scale) || 1) * (hm ? hm.a : 1);
      const [ox, oy] = hs.transformOrigin.split(' ').map(parseFloat), [bw, bh] = borderBoxSize(host), fx = bw > 0 ? ox / bw : .5, fy = bh > 0 ? oy / bh : .5;
      const [cx, cy] = toCanvas(frame, hp.x + fx * hp.w, hp.y + fy * hp.h);
      const hc = host.getBoundingClientRect(), unscale = {host, x: hc.left + fx * hc.width, y: hc.top + fy * hc.height, s: ks};
      type Draw = {rect: Rect; draw: (p: GPURenderPassEncoder, X0: number, Y0: number, Lw: number, Lh: number, dest: GPUTexture) => void};
      const between = (el: Element) => { let a = 1; for (let e = el.parentElement; e && e !== host; e = e.parentElement) a *= parseFloat(getComputedStyle(e).opacity); return a; };
      const draws: Draw[] = [];
      if (own) {
        const hw = own.width / 2 * sx, hh = own.height / 2 * sy, qx = cx * dpr, qy = cy * dpr;
        const u = this.uniformPool.take(32);
        draws.push({rect: {x: qx - hw, y: qy - hh, w: 2 * hw, h: 2 * hh}, draw: (p, X0, Y0, Lw, Lh) => {
          this.device.queue.writeBuffer(u, 0, new Float32Array([Lw, Lh, qx - X0, qy - Y0, hw, hh, 1, 0]));
          p.setPipeline(this.pipes.layer); p.setBindGroup(0, group(this.pipes.layer, [view(own), this.sampler, {buffer: u, offset: 0, size: 32}])); p.draw(6);
        }});
      }
      if (portalSpec) {
        const [key, ...rest] = portalSpec, [expanded, sc, pcx, pcy, ps, clipW, clipH, r, bx0, by0, bw, bh, contentOnly] = rest.map(Number);
        const it = items.find((i) => i.g.kind === 'glass' && i.g.el.closest(`[data-lg-portal="${CSS.escape(key)}"]`));
        if (!it || !(ps > 0) || !(sc > 0)) return;
        if (this.offscreen?.width !== W || this.offscreen?.height !== H) { this.offscreen?.destroy(); this.offscreen = this.device.createTexture({size: [W, H], format: 'rgba8unorm', usage: TEX_USAGE_OF()}); this.writes.track(this.offscreen); }
        const O = this.offscreen!;
        enc.beginRenderPass({colorAttachments: [{view: O.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]}).end();
        const scene = t.scene;
        t.scene = O; offscreen++; bare = contentOnly === 1;
        try { drawOne(it); } finally { offscreen--; bare = false; t.scene = scene; }
        const hw = clipW * ps / 2 * dpr + 1, hh = clipH * ps / 2 * dpr + 1, qx = pcx * dpr, qy = pcy * dpr;
        const u = this.uniformPool.take(320);
        draws.push({rect: {x: qx - hw, y: qy - hh, w: 2 * hw, h: 2 * hh}, draw: (p, X0, Y0, Lw, Lh) => {
          this.device.queue.writeBuffer(u, 0, new Float32Array([Lw, Lh, qx - X0, qy - Y0, hw, hh, 0, 0]));
          this.device.queue.writeBuffer(u, 256, new Float32Array([X0, Y0, dpr, expanded, pcx, pcy, ps, sc, clipW, clipH, r, 0, bx0, by0, bw, bh]));
          p.setPipeline(this.pipes.portal); p.setBindGroup(0, group(this.pipes.portal, [view(O), this.sampler, {buffer: u, offset: 0, size: 32}, {buffer: u, offset: 256, size: 64}])); p.draw(6);
        }});
        if (contentOnly === 1) for (const vi of items) {
          if (vi.g.kind !== 'vibrant' || !vi.fg || !vi.g.tone || !it.g.el.contains(vi.g.el) || !vi.g.el.closest('[data-lg-item]')) continue;
          const k = expanded > .5 ? ps : ps * sc, cx0 = vi.cx - bx0, cy0 = vi.cy - by0;
          const lx = expanded > .5 ? cx0 : (cx0 - bw / 2) * sc + clipW / 2, ly = expanded > .5 ? cy0 : cy0 * sc;
          const vx = (pcx + (lx - clipW / 2) * ps) * dpr, vy = (pcy + (ly - clipH / 2) * ps) * dpr;
          const vw = vi.box.w / 2 * vi.sx * k * dpr, vh = vi.box.h / 2 * vi.sy * k * dpr;
          const uv = this.uniformPool.take(352), tone = vi.g.tone, fg = vi.fg;
          this.device.queue.writeBuffer(uv, 256, new Float32Array([...toneAt(tone, scheme, vi.g.el), between(vi.g.el), 1]));
          draws.push({rect: {x: vx - vw, y: vy - vh, w: 2 * vw, h: 2 * vh}, draw: (p, X0, Y0, Lw, Lh, dest) => {
            this.device.queue.writeBuffer(uv, 0, new Float32Array([Lw, Lh, vx - X0, vy - Y0, vw, vh, 0, 0]));
            p.setPipeline(this.pipes.vibrantLayer); p.setBindGroup(0, group(this.pipes.vibrantLayer, [view(fg), this.sampler, {buffer: uv, offset: 0, size: 32}, view(dest), {buffer: uv, offset: 256, size: 96}])); p.draw(6);
          }});
        }
      }
      if (!portalSpec) for (const v of host.querySelectorAll<HTMLElement>('.lg-vibrant')) {
        const tone = v.dataset.lgTone as Tone | undefined, src = (v as unknown as {__lgSource?: Element}).__lgSource;
        const fg = this.snapshot(v, dpr, changed) ?? (src ? this.snapshots.get(src)?.tex : undefined);
        usedEls.add(v); if (src) usedEls.add(src);
        if (!fg || !tone) continue;
        const vb = placeIn(v, fe), [vx, vy] = toCanvas(frame, vb.x + vb.w / 2, vb.y + vb.h / 2).map((c) => c * dpr);
        const vw = vb.w / 2 * sx * dpr, vh = vb.h / 2 * sy * dpr;
        const u = this.uniformPool.take(352);
        this.device.queue.writeBuffer(u, 256, new Float32Array([...toneAt(tone, scheme, v), between(v), 1]));
        draws.push({rect: {x: vx - vw, y: vy - vh, w: 2 * vw, h: 2 * vh}, draw: (p, X0, Y0, Lw, Lh, dest) => {
          this.device.queue.writeBuffer(u, 0, new Float32Array([Lw, Lh, vx - X0, vy - Y0, vw, vh, 0, 0]));
          p.setPipeline(this.pipes.vibrantLayer); p.setBindGroup(0, group(this.pipes.vibrantLayer, [view(fg), this.sampler, {buffer: u, offset: 0, size: 32}, view(dest), {buffer: u, offset: 256, size: 96}])); p.draw(6);
        }});
      }
      if (!portalSpec) for (const el of host.querySelectorAll<HTMLElement>('[data-lg-glyphs-gpu]')) {
        const at = glyphPlace(frame, el, unscale);
        if (!at) continue;
        const {tex, cx: gx, cy: gy, hw, hh, pad} = at;
        const rgba = getComputedStyle(el).color.match(/[\d.]+/g)!.map(Number), toneEl = el.closest<HTMLElement>('.lg-vibrant'), tone = toneEl && host.contains(toneEl) ? toneEl.dataset.lgTone as Tone | undefined : undefined;
        const u = this.uniformPool.take(368);
        this.device.queue.writeBuffer(u, 256, new Float32Array([rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, (rgba[3] ?? 1) * between(el), ...(tone ? toneAt(tone, scheme, el) : new Float32Array(20)), tone ? 1 : 0, overPage ? 1 : 0, 1, 0]));
        draws.push({rect: {x: gx - hw - pad, y: gy - hh - pad, w: 2 * (hw + pad), h: 2 * (hh + pad)}, draw: (p, X0, Y0, Lw, Lh, dest) => {
          this.device.queue.writeBuffer(u, 0, new Float32Array([Lw, Lh, gx - X0, gy - Y0, hw, hh, pad, 0]));
          p.setPipeline(this.pipes.glyphLayer); p.setBindGroup(0, group(this.pipes.glyphLayer, [view(tex), this.sampler, {buffer: u, offset: 0, size: 32}, view(dest), {buffer: u, offset: 256, size: 112}])); p.draw(6);
        }});
      }
      if (!draws.length) return;
      const all = draws.map((d) => d.rect).reduce(hull), mg = blur > 0 ? Math.ceil(3 * blur * dpr) + 2 : 1;
      const X0 = Math.floor(all.x) - mg, Y0 = Math.floor(all.y) - mg, Lw = Math.ceil(all.x + all.w) + mg - X0, Lh = Math.ceil(all.y + all.h) + mg - Y0;
      if (Lw > 4096 || Lh > 4096) return;
      const L = this.frameTexture(Lw, Lh), dest = this.frameTexture(Lw, Lh);
      const ix0 = Math.max(0, X0), iy0 = Math.max(0, Y0), ix1 = Math.min(W, X0 + Lw), iy1 = Math.min(H, Y0 + Lh);
      if (ix0 !== X0 || iy0 !== Y0 || ix1 !== X0 + Lw || iy1 !== Y0 + Lh) enc.beginRenderPass({colorAttachments: [{view: dest.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]}).end();
      if (ix1 > ix0 && iy1 > iy0) enc.copyTextureToTexture({texture: t.scene, origin: [ix0, iy0]}, {texture: dest, origin: [ix0 - X0, iy0 - Y0]}, [ix1 - ix0, iy1 - iy0]);
      if (own) { const dp = enc.beginRenderPass({colorAttachments: [{view: dest.createView(), loadOp: 'load', storeOp: 'store'}]}); draws[0].draw(dp, X0, Y0, Lw, Lh, dest); dp.end(); }
      const lp = enc.beginRenderPass({colorAttachments: [{view: L.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
      for (const d of draws) d.draw(lp, X0, Y0, Lw, Lh, dest);
      lp.end();
      const gens = host.dataset.lgGenerations?.split(' ').map(Number);
      let content = L;
      if (gens && gens.length === 2 && gens.every(Number.isFinite)) {
        content = this.frameTexture(Lw, Lh);
        const gp = enc.beginRenderPass({colorAttachments: [{view: content.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
        for (const a of gens) {
          if (!(a > 0)) continue;
          const gu = this.uniformPool.take(32);
          this.device.queue.writeBuffer(gu, 0, new Float32Array([Lw, Lh, Lw / 2, Lh / 2, Lw / 2, Lh / 2, Math.min(1, a), 0]));
          gp.setPipeline(this.pipes.layer); gp.setBindGroup(0, group(this.pipes.layer, [view(L), this.sampler, {buffer: gu, offset: 0, size: 32}])); gp.draw(6);
        }
        gp.end();
      }
      const plan = blur * dpr > .05 ? transitionBlurPlan(blur, dpr) : null;
      layerIds.add(host);
      const out = plan ? this.layerBlur.encode({encoder: enc, source: content, plan, id: host}).texture : content;
      const px = cx * dpr, py = cy * dpr, qx = px + (X0 + Lw / 2 - px) * scale, qy = py + (Y0 + Lh / 2 - py) * scale;
      ((window as unknown as {__glassLayers?: unknown[]}).__glassLayers ??= []).push({label: host.getAttribute('aria-label') ?? host.textContent, rect: [qx - Lw / 2 * scale, qy - Lh / 2 * scale, Lw * scale, Lh * scale], opacity, blur, draws: draws.length});
      const lens = host.dataset.lgLens?.split(' ').map(Number) ?? null, valid = !!lens && lens.length >= 2 && lens.every(Number.isFinite);
      const local = valid && lens!.length >= 3 && o?.g.lens ? o : null, field = valid && o && !local ? this.passes.field(glassOf.get(o)?.id ?? '') : null;
      const lensed = !!field;
      const u = this.uniformPool.take(lensed || local ? 320 : 32);
      const sx0 = qx - Lw / 2 * scale, sy0 = qy - Lh / 2 * scale;
      if (local) {
        (window as unknown as {__contentLens?: number[]}).__contentLens = [local.box.w, local.box.h, local.sx, local.sy, local.cx, local.cy];
        const Ax = dpr * local.sx, Ay = dpr * local.sy, lx = local.cx * dpr, ly = local.cy * dpr, hw = local.box.w / 2, hh = local.box.h / 2;
        const x0 = Math.min(sx0, lx - hw * Ax), y0 = Math.min(sy0, ly - hh * Ay), x1 = Math.max(sx0 + Lw * scale, lx + hw * Ax), y1 = Math.max(sy0 + Lh * scale, ly + hh * Ay);
        this.device.queue.writeBuffer(u, 0, new Float32Array([W, H, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, opacity, 0]));
        this.device.queue.writeBuffer(u, 256, new Float32Array([lx, ly, hw, hh, Ax, Ay, lens![1], 0, lens![2], 0.5, lens![0], 0, sx0, sy0, Lw * scale, Lh * scale]));
      } else this.device.queue.writeBuffer(u, 0, new Float32Array([W, H, qx, qy, Lw / 2 * scale, Lh / 2 * scale, opacity, 0]));
      if (lensed) this.device.queue.writeBuffer(u, 256, new Float32Array([field!.origin[0], field!.origin[1], lens![0], lens![1] * dpr]));
      const pipe = local ? this.pipes.contentLens : lensed ? this.pipes.lensLayer : this.pipes.layer;
      const extra = local ? [{buffer: u, offset: 256, size: 64}] : lensed ? [{buffer: u, offset: 256, size: 16}, view(field!.texture)] : [];
      let [c0, c1, c2, c3] = [s[0], s[1], s[0] + s[2], s[1] + s[3]];
      if (o) for (let e = host.parentElement; e && fe.contains(e); e = e.parentElement) {
        const es = getComputedStyle(e);
        if (es.overflowX !== 'visible' || es.overflowY !== 'visible') {
          const b = inFrame(e, fe), [x0, y0] = toCanvas(frame, b.x + e.clientLeft, b.y + e.clientTop), [x1, y1] = toCanvas(frame, b.x + e.clientLeft + e.clientWidth, b.y + e.clientTop + e.clientHeight);
          c0 = Math.max(c0, Math.floor(x0 * dpr + 1e-6)); c1 = Math.max(c1, Math.floor(y0 * dpr + 1e-6)); c2 = Math.min(c2, Math.ceil(x1 * dpr - 1e-6)); c3 = Math.min(c3, Math.ceil(y1 * dpr - 1e-6));
        }
        if (e === fe) break;
      }
      if (c2 <= c0 || c3 <= c1) return;
      pass(t.scene, 'load', (p) => { p.setScissorRect(c0, c1, c2 - c0, c3 - c1); p.setPipeline(pipe); p.setBindGroup(0, group(pipe, [view(out), this.sampler, {buffer: u, offset: 0, size: 32}, ...extra])); p.draw(6); });
    };

    prof.at('page');
    pass(t.scene, 'clear', (p) => {
      if (!rootTex) return;
      p.setPipeline(this.pipes.quad);
      p.setBindGroup(0, group(this.pipes.quad, [view(rootTex), this.sampler, buf(0, 32)]));
      p.draw(6);
    });
    drawItems(root, null, [0, 0, W, H]);
    if (!noLayers) for (const h of root.querySelectorAll<HTMLElement>('[data-lg-layer]')) if (!h.closest('.lg-glass')) drawLayer(h, null, [0, 0, W, H], scheme, true);
    if (items.some((it) => it.g.kind === 'glass')) refreshSample();

    const drawn: Rect[] = [];
    const runEdges = (at: (typeof items)[number] | null) => {
      const i = at ? itemIndex.get(at) ?? -1 : items.length, ending = pocketEnds.get(at) ?? [];
      const scrolls = ending.map((id) => pocketFrames.get(id)!.scroll).filter((e): e is HTMLElement => !!e);
      const finish = (inside: boolean) => {
        for (const [el, g] of [...groups].sort((a, b) => (a[1].last - a[1].first) - (b[1].last - b[1].first))) {
          if (g.done || !g.saved || g.last >= i || scrolls.some((sc) => sc.contains(el)) !== inside) continue;
          g.done = true;
          const opacity = presentationOf(el)?.opacity ?? 1, card = el.dataset.lgCard ? Number(el.dataset.lgCard) : null, b = card !== null ? layoutBox(el, root) : null;
          const over = el.hasAttribute('data-lg-below-card') ? el.closest('[data-lg-nav-stack]')?.querySelector<HTMLElement>('[data-lg-card]') ?? null : null, ob = over ? layoutBox(over, root) : null;
          const was = prof.at('group');
          this.groupGPU.composite(enc, t.scene, g.saved, {opacity: Number.isFinite(opacity) ? opacity : 1,
            under: ob ? {rect: [ob.x * dpr, ob.y * dpr, ob.w * dpr, ob.h * dpr], radius: Number(over!.dataset.lgCard) * dpr} : undefined,
            card: b ? {rect: [b.x * dpr, b.y * dpr, b.w * dpr, b.h * dpr], radius: card! * dpr, shadow: [.04, 12 * dpr, -3 * dpr]} : undefined});
          refreshSample(); drawn.length = 0;
          prof.at(was);
        }
      };
      finish(true);
      const was = prof.at('pocket');
      for (const id of ending) if (this.pocketGPU.edge(enc, id, t.scene, pocketFrames.get(id)!.frame)) { refreshSample(); drawn.length = 0; }
      prof.at(was);
      pocketEnds.delete(at);
      finish(false);
      for (const g of [...groups.values()].sort((a, b) => (b.last - b.first) - (a.last - a.first))) if (g.first === i && !g.saved) g.saved = this.groupGPU.save(enc, t.scene);
    };
    drawOne = (it) => {
      if (!offscreen && consumer < 0) {
        prof.at('pocket');
        for (const id of pocketStarts.get(it.g.el) ?? []) { const f = pocketFrames.get(id)!.frame; if (f.style !== 'hidden') this.pocketGPU.background(enc, id, t.scene, f); }
        runEdges(it);
      }
      prof.at('glass prepare');
      if (owned.has(it)) return;
      if (!offscreen && inPortal(it.g.el)) return;
      const uk = !offscreen ? it.g.el.closest('[data-lg-under]')?.getAttribute('data-lg-under') : null;
      if (uk != null) underTexture(uk);
      if (it.g.kind === 'vibrant') {
        if (layerOf(it.g.el)) return;
        const given = it.g.el.closest<HTMLElement>('[data-lg-scheme]')?.dataset.lgScheme;
        drawVibrant(it, given === 'light' || given === 'dark' ? given : scheme);
        const c = it.clip, sx = Math.max(0, Math.floor(c.x * dpr)), sy = Math.max(0, Math.floor(c.y * dpr));
        const ex = Math.min(W, Math.ceil((c.x + c.w) * dpr)), ey = Math.min(H, Math.ceil((c.y + c.h) * dpr));
        if (ex > sx && ey > sy) drawGlyphs(it, [sx, sy, ex - sx, ey - sy], scheme, true);
        return;
      }
      const isGlass = it.g.kind === 'glass';
      const owner = glassOf.get(it);
      if (owner && owner.members[0] !== it) return;
      const members = owner?.members ?? [it];
      const reach = members.map((m) => m.reach);
      const m4 = isGlass && !offscreen && consumer < 0 && it.g.lens && (window as unknown as {__lensRoute?: boolean}).__lensRoute !== false ? Math.min(1, 4 * it.g.lens.provider) : 1;
      if (m4 > 0 && m4 <= 0.998039186) {
        if (this.grouped?.width !== W || this.grouped?.height !== H) { this.grouped?.destroy(); this.grouped = this.device.createTexture({size: [W, H], format: 'rgba8unorm', usage: TEX_USAGE_OF()}); this.writes.track(this.grouped); }
        const G = this.grouped!;
        const restBackdrop = !!it.g.lens?.rest.backdrop;
        if (restBackdrop) {
          if (this.routeRest?.width !== W || this.routeRest?.height !== H) { this.routeRest?.destroy(); this.routeRest = this.device.createTexture({size: [W, H], format: 'rgba8unorm', usage: TEX_USAGE_OF()}); }
          enc.copyTextureToTexture({texture: t.scene}, {texture: this.routeRest!}, [W, H]);
        }
        for (const first of [true, false]) {
          refreshSample();
          enc.beginRenderPass({colorAttachments: [{view: G.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]}).end();
          const scene = t.scene; routeBase = scene; routeRestBase = restBackdrop ? this.routeRest : null; t.scene = G; consumer = 0;
          for (const m of members) for (const h of [m.g.el, ...m.g.el.querySelectorAll('[data-lg-layer]')]) drawnLayers.delete(h);
          try { drawOne(it); } finally { consumer = -1; t.scene = scene; routeBase = null; routeRestBase = null; }
          this.lens.group(enc, t.scene, G, m4, first);
        }
        drawn.length = 0; drawn.push(...reach);
        return;
      }
      const copies = isGlass && !offscreen && consumer < 0 ? it.g.container?.copies ?? null : null;
      if (copies) {
        if (this.grouped?.width !== W || this.grouped?.height !== H) { this.grouped?.destroy(); this.grouped = this.device.createTexture({size: [W, H], format: 'rgba8unorm', usage: TEX_USAGE_OF()}); this.writes.track(this.grouped); }
        const G = this.grouped!;
        copies.forEach((w, k) => {
          if (!(w > 0)) return;
          refreshSample();
          enc.beginRenderPass({colorAttachments: [{view: G.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]}).end();
          const scene = t.scene;
          t.scene = G; consumer = k;
          for (const m of members) for (const h of [m.g.el, ...m.g.el.querySelectorAll('[data-lg-layer]')]) drawnLayers.delete(h);
          try { drawOne(it); } finally { consumer = -1; t.scene = scene; }
          const u = this.uniformPool.take(32);
          this.device.queue.writeBuffer(u, 0, new Float32Array([W, H, W / 2, H / 2, W / 2, H / 2, w, 0]));
          pass(t.scene, 'load', (p) => { p.setPipeline(this.pipes.layer); p.setBindGroup(0, group(this.pipes.layer, [view(G), this.sampler, {buffer: u, offset: 0, size: 32}])); p.draw(6); });
        });
        drawn.length = 0; drawn.push(...reach);
        return;
      }
      if (isGlass && !offscreen && consumer < 0 && drawn.some((r) => reach.some((m) => overlaps(r, m)))) {
        refreshSample();
        drawn.length = 0;
      }
      const scissorOf = (c: Rect) => {
        const sx = Math.max(0, Math.floor(c.x * dpr)), sy = Math.max(0, Math.floor(c.y * dpr));
        const ex = Math.min(W, Math.ceil((c.x + c.w) * dpr)), ey = Math.min(H, Math.ceil((c.y + c.h) * dpr));
        return ex > sx && ey > sy ? [sx, sy, ex - sx, ey - sy] : null;
      };
      const quadIn = (m: (typeof items)[number], s: number[]) => {
        const hw = (m.box.w / 2) * m.sx * dpr, hh = (m.box.h / 2) * m.sy * dpr;
        const x0 = Math.max(s[0], Math.floor(m.cx * dpr - hw)), y0 = Math.max(s[1], Math.floor(m.cy * dpr - hh)), x1 = Math.min(s[0] + s[2], Math.ceil(m.cx * dpr + hw)), y1 = Math.min(s[1] + s[3], Math.ceil(m.cy * dpr + hh));
        return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
      };
      const clip = members.map((m) => m.clip).reduce(hull);
      const scissor = scissorOf(clip);
      if (!scissor) return;
      const surfaces = isGlass ? elementsOf(members) : [];
      const out = 64 * dpr;
      if (isGlass && surfaces.length && surfaces.every((e) => e.rect.y + e.rect.h <= -out || e.rect.y >= H + out || e.rect.x + e.rect.w <= -out || e.rect.x >= W + out)) return;
      if (isGlass) ((window as unknown as {__glassElements?: Record<string, number[][]>}).__glassElements ??= {})[owner!.id] = surfaces.map((e) => [e.rect.x, e.rect.y, e.rect.w, e.rect.h]);
      const bd = it.g.container?.backdrop, bdBox = bd ? layoutBox(bd, root) : null;
      const ownScheme = (isGlass && it.g.container?.scheme) || scheme;
      const {glass: fade, materialize: grow, dematerialize: shrink} = isGlass ? presentedGlass(members[0].g.el, root) : {glass: 1, materialize: null, dematerialize: 1};
      const unscale = isGlass && it.g.variant === 'sheet' ? it.sx : 1;
      if (unscale !== 1) for (const e of surfaces) { e.radius /= unscale; if (e.bottomRadius !== undefined) e.bottomRadius /= unscale; }
      const glass = isGlass ? {id: owner!.id, target: t.scene, dpr: dpr * unscale, scheme: ownScheme, scissor, variant: it.g.variant, surfaces, spacing: it.g.container?.spacing ?? null, gaussian: it.g.container?.gaussian ?? 0, materialSize: it.g.container?.material?.size ?? (it.g.variant === 'sheet' ? [it.box.w, it.box.h] as [number, number] : null), materialProgress: (it.g.container?.material?.progress ?? 1) * fade * shrink, materialFrom: it.g.container?.material?.from ?? null, materialSplit: it.g.container?.material?.split ?? null, rimOpacity: (it.g.container?.material?.rim ?? 1) * fade * shrink,
        rect: bdBox ? {x: snapDevicePixel(bdBox.x * dpr), y: snapDevicePixel(bdBox.y * dpr), w: Math.round(bdBox.w * dpr), h: Math.round(bdBox.h * dpr)} : surfaces.map((e) => e.rect).reduce(hull)} : null;
      const tintOf = (m: (typeof items)[number]) => m.g.tint ?? (m.g.prominent ? 'blue' : undefined);
      const tintPasses = new Map<string, {member: (typeof items)[number]; own: typeof surfaces}>();
      for (const e of surfaces) {
        const tint = tintOf(e.member);
        if (!tint) continue;
        const key = e.member.g.disabled && e.member.g.prominent ? (e.member.g.bar ? `${tint}/bar-off` : 'disabled/off') : tint.startsWith('#') ? tintRGBA(tint, scheme, this.platform).join() : tint;
        if (!tintPasses.has(key)) tintPasses.set(key, {member: e.member, own: []});
        tintPasses.get(key)!.own.push(e);
      }
      const partial = tintPasses.size > 1 || (tintPasses.size === 1 && [...tintPasses.values()][0].own.length < surfaces.length);
      const ownTints = partial ? tintPasses.size : 0;
      const mat = glass && grow !== null && !it.g.lens ? {...glass, id: `${glass.id} materialize`, materialProgress: glass.materialProgress * grow, rimOpacity: glass.rimOpacity * grow} : null;
      let drawGlass = false;
      if (mat && !(offscreen && bare)) { live.add(mat.id); if (!this.passes.ready(mat.id)) void this.passes.prepare(mat.id); }
      if (glass && !(offscreen && bare)) {
        live.add(glass.id);
        if (this.passes.ready(glass.id, ownTints)) drawGlass = true;
        else {
          const prepared = this.passes.prepare(glass.id, ownTints);
          if (this.passes.ready(glass.id, ownTints)) drawGlass = true;
          else {
            this.stats.pending++; this.stats.unprepared++;
            prepared.then(() => { this.stats.pending--; this.invalidate(); }, (e) => console.error('[glass] prepare failed', e));
          }
        }
      }
      let look: AppearanceSnapshot | null = null;
      const lens = isGlass ? it.g.lens ?? null : null;
      const largest = members.reduce((a, b) => (b.box.w * b.box.h > a.box.w * a.box.h ? b : a));
      const tracksGlassLuma = glass !== null && !lens && !glass.materialSize && largest.g.tracksLuma !== false && largest.g.variant !== 'text' && Math.min(largest.box.w, largest.box.h) <= this.platform.luminance.tracksUpTo;
      const lookId = glass ? lookOf(glass.id) : '';
      if (glass && !tracksGlassLuma) this.appearances.delete(lookId);
      const host = glass && tracksGlassLuma && it.g.variant !== 'clear' ? pocketOf(members[0].g.el) : null, inPocket = host ? pocketKey(host) : null;
      if (glass && drawGlass && it.g.variant !== 'clear' && tracksGlassLuma) {
        let a = this.appearances.get(lookId);
        const kept = a && a.pocket !== inPocket ? a.outputs : null;
        if (a && a.pocket !== inPocket) { this.appearances.delete(lookId); a = undefined; }
        if (!a) {
          const app = createWebToolbarMaterialAppearance(() => (this.source.dark() ? 'dark' : 'light')) as unknown as Appearance;
          a = {app, epoch: app.beginFeedbackSource(), feedbackId: 0, pocket: inPocket, outputs: members[0].g.el.hasAttribute('data-lg-uikit-platter') ? kept ?? createMaterialOutputSpring() : null, lumaAt: (Math.floor((glassClock() ?? performance.now()) / this.platform.pocket.interval) + 1) * this.platform.pocket.interval, timer: null, tone: null};
          this.appearances.set(lookId, a);
        }
        look = a.app.advance(now);
        if (look.animationActive) moving = true;
        if (look.luminance === null) adapting++;
      }
      const debug = window as unknown as {__glassLooks?: Record<string, unknown>; __glassForceLuminance?: number};
      if (glass && look) (debug.__glassLooks ??= {})[glass.id] = look;
      const forced = typeof debug.__glassForceLuminance === 'number' ? debug.__glassForceLuminance : null;
      const pid = glass && look ? this.appearances.get(lookId)?.pocket ?? null : null, pocket = pid ? this.pockets.get(pid) ?? null : null, hard = pocket?.style === 'hard';
      const pm = pocket ? pocket.material.advance(now) : null;
      if (pm?.moving) moving = true;
      if (trace && glass && look) trace.glasses[glass.id] = {pocket: pid, scheme: look.colorScheme, own: look.luminance, luminance: pm ? pm.luminance : null, fill: pm ? pm.fill : null, forced};
      const entry = glass && look ? this.appearances.get(lookId) ?? null : null, outputs = entry?.outputs ?? null;
      const fallback = pocket ? (() => { const L = this.source.dark() ? 0 : 1; return hard ? L : pocketLuminance(pocket.glass, L, pocket.darkening, this.platform); })() : null;
      const destination = pm ? pm.target ?? fallback : look?.targetLuminance ?? null;
      if (outputs) outputs.response = pm ? this.platform.luminance.outputSpring.pocket : this.platform.luminance.outputSpring.own;
      if (outputs && outputs.advance(now)) moving = true;
      const adapted = look ? {scheme: look.colorScheme,
        materialComposite: outputs ? look.targetComposite.flatMap((weight, i) => weight ? [{colorScheme: i ? 'dark' as const : 'light' as const, weight}] : []) : look.materialComposite,
        luminance: forced ?? (outputs ? destination ?? null : pm ? pm.luminance ?? look.luminance : look.luminance), outputs: outputs && destination !== null && destination !== undefined ? outputs : null,
        pocket: pocket ? {fill: hard ? 0 : pm!.fill, frost: hard ? 2 : 1} : null} : {};
      if (trace && glass && look && 'luminance' in adapted) (trace.glasses[glass.id] as Record<string, unknown>).material = adapted.luminance;
      if (glass && drawGlass && lens) {
        prof.at('lens');
        const warped = this.lens.warp(enc, {target: t.scene, source: routeBase ?? undefined, rect: glass.rect, dpr, frame: lens,
          blur: (source, radius) => { const id = `lens ${glass.id}`; layerIds.add(id); return this.layerBlur.encode({encoder: enc, source, plan: transitionBlurPlan(radius, dpr), id}).texture; }});
        const rested = lens.rest.opacity > 0 && !!lens.rest.image;
        if (rested) this.lens.rest(enc, {target: t.scene, rect: glass.rect, frame: lens});
        const backdropped = this.lens.backdrop(enc, {target: t.scene, source: routeRestBase ?? routeBase ?? undefined, rect: glass.rect, dpr, frame: lens,
          blur: (source, radius) => { const id = `lens rest ${glass.id}`; layerIds.add(id); return this.layerBlur.encode({encoder: enc, source, plan: transitionBlurPlan(radius, dpr), id}).texture; }});
        if (warped || rested || backdropped) refreshSample();
      }
      const drawMat = !!mat && drawGlass && this.passes.ready(mat.id);
      prof.at('material');
      const fadeSaved = glass && drawGlass && fade < 1 ? this.groupGPU.save(enc, t.scene) : null;
      if (glass && drawGlass)
        this.passes.encode(enc, {...glass, ...adapted, platform: this.platform, ...(lens ? {variant: 'lens', lens: {h: lens.large ? lens.large.H : lens.recipe, tint: lens.tint, shadow: lens.shadow ?? null, large: !!lens.large, q: lens.large?.q ?? 1}} : null), backdrop: t.sample, materialPath: this.materialPath(glass, surfaces, now / 1000), tracks: tracksGlassLuma,
          noLuminance: largest.g.tracksLuma === false,
          layoutShortSide: members.some((m) => m.g.flex && !m.g.flex.idle && m.g.el.hasAttribute('data-lg-uikit-platter')) ? Math.min(largest.box.w, largest.box.h) : null,
          sampleClip: [clip.x * dpr, clip.y * dpr, (clip.x + clip.w) * dpr, (clip.y + clip.h) * dpr]});
      if (glass && drawGlass && lens) this.lens.fade(enc, {target: t.scene, sample: t.sample, rect: glass.rect, dpr, frame: lens});
      if (drawMat) {
        this.passes.encodeHighlight(enc, {...glass, ...adapted, platform: this.platform});
        this.passes.encode(enc, {...mat!, ...adapted, platform: this.platform, tracks: tracksGlassLuma, backdrop: t.sample, materialPath: surfaces.length === 1 && surfaces[0].contents === null ? 'A' : 'T',
          sampleClip: [clip.x * dpr, clip.y * dpr, (clip.x + clip.w) * dpr, (clip.y + clip.h) * dpr]});
      }
      const glassScheme: GlassScheme = look?.colorScheme ?? ownScheme;
      if (glass && look) {
        const e = this.appearances.get(lookId);
        const target = look.colorScheme === 'dark' ? 1 : 0;
        let w: number;
        if (e?.outputs) {
          const st = e.tone ??= {spring: null, w: target, target, epoch: now};
          if (st.target !== target) {
            const settings = {...DEFAULT_SPRING, response: e.outputs.response};
            if (st.spring) st.spring = retargetFluid(st.spring, [target], (now - st.epoch) / 1000, settings);
            else { st.spring = fluidSpring([st.w], [target], settings); st.epoch = now; }
            st.target = target;
          }
          if (st.spring) {
            st.spring = advanceFluid(st.spring, (now - st.epoch) / 1000);
            st.w = st.spring.offset[0];
            if (Math.abs(st.w - target) < 1e-4 && Math.abs(st.spring.velocity[0]) < 1e-3) { st.w = target; st.spring = null; } else moving = true;
          }
          w = st.w;
        } else w = look.materialComposite.reduce((a, c) => a + (c.colorScheme === 'dark' ? c.weight : 0), 0);
        for (const m of members) toneWeights.set(m.g.el, {scheme: look.colorScheme, w: Math.max(0, Math.min(1, w))});
      }
      prof.at('tints');
      const tintAt = shrink * (grow ?? 1), tintSaved = glass && drawGlass && tintPasses.size && tintAt < 1 ? this.groupGPU.save(enc, t.scene) : null;
      if (glass && drawGlass && tintPasses.size) this.passes.encodeTints(enc, {...glass, tints: [...tintPasses.values()].map(({member: m, own}) => ({
        matrix: m.g.disabled && m.g.prominent ? (m.g.bar ? barDisabledTintMatrix(tintOf(m)!, scheme, glassScheme, this.platform) : disabledTintMatrix(scheme, glassScheme, this.platform)) : tintMatrix(tintOf(m)!, scheme, glassScheme, this.platform), own: partial ? own : null}))});
      if (tintSaved) this.groupGPU.composite(enc, t.scene, tintSaved, {opacity: tintAt});
      if (fadeSaved) this.groupGPU.composite(enc, t.scene, fadeSaved, {opacity: fade});
      prof.at('content');
      for (const m of members) {
        const tint = tintOf(m);
        const paletteKey = `${glassScheme}/${m.g.prominent ? tint : ''}/${m.g.disabled ? 'off' : ''}` as GlassScheme;
        if (!isGlass || this.schemes.get(m.g.el) === paletteKey) continue;
        this.schemes.set(m.g.el, paletteKey);
        const vars = paletteVars(glassScheme, this.platform);
        if (m.g.prominent && tint) vars['--lg-label'] = m.g.bar ? barProminentLabel(glassScheme) : prominentLabel(tint, glassScheme);
        if (m.g.disabled && !m.g.bar) vars['--lg-label'] = disabledLabel(glassScheme, this.platform);
        for (const [key, val] of Object.entries(vars)) m.g.el.style.setProperty(key, val);
        m.g.el.dataset.glassScheme = glassScheme;
      }
      members.forEach((m) => {
        prof.at(isGlass ? 'content' : 'content (plain item)');
        const s = scissorOf(m.clip);
        const shaped = m.g.el.dataset.lgClip !== undefined && !!m.g.motion && (typeof m.g.motion.shape === 'number' ? m.g.motion.shape !== 1 : m.g.motion.shape[0] !== 1 || m.g.motion.shape[1] !== 1);
        const clipped = !!(glass && drawGlass && s && ((m.g.flex && !m.g.flex.idle) || shaped) && this.passes.contentBefore(enc, {id: glass.id, target: t.scene, region: s}));
        const ownLayer = isGlass && !!s && !!layerOf(m.g.el) && m.g.el.dataset.lgLayer !== undefined;
        const outs = isGlass && s ? [...m.g.el.querySelectorAll<HTMLElement>('[data-lg-dest-out]')] : [];
        const outSaved = outs.length ? this.groupGPU.save(enc, t.scene) : null;
        const blur = !isGlass ? presentationOf(m.g.el)?.blur ?? 0 : 0;
        const backdrop = !isGlass && s ? m.g.el.dataset.lgBackdrop : undefined;
        if (backdrop !== undefined) {
          const spec = JSON.parse(backdrop) as BackdropSpec, w = m.box.w * m.sx, h = m.box.h * m.sy, x = m.cx - w / 2, y = m.cy - h / 2;
          const [cx, cy, cw, ch] = spec.capture ?? [0, 0, m.box.w, m.box.h];
          layerIds.add(m.g.el);
          this.backdrops.encode(enc, {target: t.scene, id: m.g.el, dpr, scale: Math.min(m.sx, m.sy), spec, radius: (spec.radius ?? Math.min(m.box.w, m.box.h) / 2) * Math.min(m.sx, m.sy) * dpr,
            shape: {x: x * dpr, y: y * dpr, w: w * dpr, h: h * dpr}, capture: {x: (x + cx * m.sx) * dpr, y: (y + cy * m.sy) * dpr, w: cw * m.sx * dpr, h: ch * m.sy * dpr}});
        } else if (m.fg && s && !ownLayer && blur * dpr > .05) {
          const fg = m.fg, mg = Math.ceil(3 * blur * dpr) + 2, Lw = fg.width + 2 * mg, Lh = fg.height + 2 * mg;
          const P = this.frameTexture(Lw, Lh);
          const u = this.uniformPool.take(288);
          const k = fg.width ? ((m.box.w / 2) * m.sx * dpr) / (fg.width / 2) : 1;
          this.device.queue.writeBuffer(u, 0, new Float32Array([Lw, Lh, Lw / 2, Lh / 2, fg.width / 2, fg.height / 2, 1, 0]));
          this.device.queue.writeBuffer(u, 256, new Float32Array([W, H, m.cx * dpr, m.cy * dpr, (Lw / 2) * k, (Lh / 2) * k, 1, 0]));
          const pp = enc.beginRenderPass({colorAttachments: [{view: P.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
          pp.setPipeline(this.pipes.quad); pp.setBindGroup(0, group(this.pipes.quad, [view(fg), this.sampler, {buffer: u, offset: 0, size: 32}])); pp.draw(6); pp.end();
          layerIds.add(m.g.el);
          const out = this.layerBlur.encode({encoder: enc, source: P, plan: transitionBlurPlan(blur, dpr), id: m.g.el}).texture;
          pass(t.scene, 'load', (p) => {
            p.setScissorRect(s[0], s[1], s[2], s[3]);
            p.setPipeline(this.pipes.layer);
            p.setBindGroup(0, group(this.pipes.layer, [view(out), this.sampler, {buffer: u, offset: 256, size: 32}]));
            p.draw(6);
          });
        } else if (m.fg && s && !ownLayer && quadIn(m, s))
          pass(t.scene, 'load', (p) => {
            const q = quadIn(m, s)!;
            p.setScissorRect(q[0], q[1], q[2], q[3]);
            p.setPipeline(this.pipes.quad);
            p.setBindGroup(0, group(this.pipes.quad, [view(m.fg!), this.sampler, buf(2 + items.indexOf(m) * 2, 32)]));
            p.draw(6);
          });
        if (isGlass && s) drawItems(m.g.el, m, s);
        const uSrc = isGlass && s && !offscreen ? m.g.el.getAttribute('data-lg-under-source') : null;
        if (uSrc != null && s) {
          const x = underTexture(uSrc), hw = m.box.w / 2 * m.sx, hh = m.box.h / 2 * m.sy;
          const ux = Math.max(0, s[0], Math.floor((m.cx - hw) * dpr)), uy = Math.max(0, s[1], Math.floor((m.cy - hh) * dpr));
          const uw = Math.min(W, s[0] + s[2], Math.ceil((m.cx + hw) * dpr)) - ux, uh = Math.min(H, s[1] + s[3], Math.ceil((m.cy + hh) * dpr)) - uy;
          if (uw > 0 && uh > 0) enc.copyTextureToTexture({texture: t.scene, origin: [ux, uy]}, {texture: x, origin: [ux, uy]}, [uw, uh]);
        }
        if (isGlass) for (const vi of owned) if (ownerOf(vi) === m.g.el && !layerOf(vi.g.el)) drawVibrant(vi, glassScheme);
        if (isGlass && s) drawGlyphs(m, s, glassScheme);
        if (isGlass && s && !noLayers) for (const h of [...(ownLayer ? [m.g.el] : []), ...m.g.el.querySelectorAll<HTMLElement>('[data-lg-layer]')]) drawLayer(h, m, s, glassScheme, false);
        if (clipped) this.passes.contentMask(enc, {id: glass!.id, target: t.scene, region: s});
        if (outSaved) {
          prof.at('content dest-out');
          for (const o of outs) {
            const lh = o.closest<HTMLElement>('[data-lg-layer]'), b = lh && m.g.el.contains(lh) ? inFrame(o, m.g.el) : layoutBox(o, root);
            if (!(b.w > 0 && b.h > 0)) continue;
            this.groupGPU.composite(enc, t.scene, outSaved, {opacity: 1, under: {rect: [(b.x + m.tx) * dpr, (b.y + m.ty) * dpr, b.w * dpr, b.h * dpr], radius: (Math.min(b.w, b.h) / 2) * dpr}});
          }
          refreshSample();
        }
      });
      const glows = (after: boolean) => { if (glass && drawGlass) for (const e of surfaces) {
        const g = e.member.g;
        if (!g.pose?.glow || (g.flexVariant === 'menu') !== after) continue;
        const w = e.member.box.w, h = e.member.box.h, radius = typeof g.radius === 'number' ? g.radius : g.radius === 'rounded' ? roundedRadius(h) : Math.min(w, h) / 2;
        const share = g.motion?.glow ?? 1, glow = share < 1 ? {...g.pose.glow, big: g.pose.glow.big * share, little: g.pose.glow.little * share} : g.pose.glow;
        this.passes.encodeGlow(enc, {...glass, element: e, view: elementOf(e.member).rect, glow, size: [w, h], viewRadius: radius,
          inPlace: g.el.hasAttribute('data-lg-uikit-platter')});
      } };
      prof.at('glows');
      const glowAt = fade * shrink, glowSaved = glowAt < 1 && glass && drawGlass && surfaces.some((e) => e.member.g.pose?.glow) ? this.groupGPU.save(enc, t.scene) : null;
      glows(false);
      if (glowSaved) this.groupGPU.composite(enc, t.scene, glowSaved, {opacity: glowAt});
      prof.at(lens ? 'lens' : 'highlight');
      if (glass && drawGlass && lens) { const field = this.passes.field(glass.id); if (field) this.lens.encode(enc, {target: t.scene, rect: glass.rect, field, dpr, frame: lens, scale: [it.sx, it.sy], source: routeBase ?? undefined}); }
      else if (drawMat) this.passes.encodeHighlight(enc, {...mat!, ...adapted, platform: this.platform});
      else if (glass && drawGlass) this.passes.encodeHighlight(enc, {...glass, ...adapted, platform: this.platform});
      glows(true);
      if (!offscreen && consumer < 0) drawn.push(...reach);
    };
    items.forEach((it) => drawOne(it));
    runEdges(null);

    for (const id of this.liveIds)
      if (!live.has(id)) {
        this.passes.release(id);
        this.appearances.delete(id);
        forgetDebug(id);
      }
    this.liveIds = live;

    prof.at('present');
    pass(this.ctx.getCurrentTexture().createView(), 'clear', (p) => fullscreen(p, this.pipes.present, [view(t.scene), this.sampler]));
    prof.end(enc);
    this.device.queue.submit([enc.finish()]);
    prof.submitted();
    this.passes.endFrame();
    this.lens.endFrame();
    this.layerBlur.retain(layerIds);
    const frame = this.stats.frames;
    this.passes.collect((id, sum) => {
      const a = this.appearances.get(this.lookIds.get(id) ?? id);
      if (!a) return;
      if (a.pocket) return;
      const wall = glassClock() ?? performance.now();
      if (!this.lumaDue(a, wall)) return;
      const before = a.app.snapshot();
      const accepted = a.app.accept({sum, generation: {feedbackID: ++a.feedbackId, backgroundColorScheme: before.systemColorScheme,
        materialAppearanceEpoch: before.systemAppearanceEpoch, requestedFrame: frame}}, a.epoch, a.outputs ? {filteredLuminance: quantizeLuma(lumaNotification(sum, 1), this.platform)} : undefined);
      const after = a.app.snapshot();
      if (accepted && (before.luminance === null || before.targetLuminance !== after.targetLuminance || before.colorScheme !== after.colorScheme || after.animationActive))
        this.invalidate();
    });
    this.pocketGPU.collect((pid, c, b) => {
      const st = this.pockets.get(pid);
      if (!st) return;
      const host = pocketFrames.get(pid)?.host, [hx, hy] = host ? presentedOffset(host, root) : [0, 0];
      if ((hx !== 0 || hy !== 0) && (!st.born || st.lumaOff)) return;
      const wall = glassClock() ?? performance.now();
      if (!this.lumaDue(st, wall)) return;
      const lumaC = quantizeLuma(lumaNotification(c, 1), this.platform), sum = st.style === 'hard' && b ? b : c;
      const luma = sum === c ? lumaC : quantizeLuma(lumaNotification(sum, 1), this.platform);
      let glass: 'light' | 'dark' | null = null, changed = false;
      for (const a of this.appearances.values()) {
        if (a.pocket !== pid) continue;
        const before = a.app.snapshot();
        const accepted = a.app.accept({sum, generation: {feedbackID: ++a.feedbackId, backgroundColorScheme: before.systemColorScheme,
          materialAppearanceEpoch: before.systemAppearanceEpoch, requestedFrame: frame}}, a.epoch, {filteredLuminance: luma});
        const after = a.app.snapshot();
        glass ??= after.colorScheme;
        if (accepted && (before.luminance === null || before.targetLuminance !== after.targetLuminance || before.colorScheme !== after.colorScheme || after.animationActive)) changed = true;
      }
      const trait = this.source.dark() ? 'dark' : 'light', ref = b && st.style !== 'hidden' ? quantizeLuma(lumaNotification(b, 1), this.platform) : undefined;
      const replay = st.replay, darkening = pocketLumaStyle(trait, glass ?? st.glass, lumaC, st, st.velocity, ref, this.platform).darkening;
      if (!st.replay && st.velocity >= this.platform.pocket.velocityGate) this.invalidate();
      st.glass = glass ?? st.glass;
      st.material.retarget([st.style === 'hard' ? luma : pocketLuminance(st.glass, lumaC, darkening, this.platform), st.style === 'hard' || st.glass !== 'light' ? 0 : darkening]);
      const log = ((window as unknown as {__glassPockets?: Record<string, unknown[]>}).__glassPockets ??= {})[pid] ??= [];
      log.push([frame, lumaC, luma, st.replay, darkening]);
      if (Array.isArray(traceLog)) traceLog.push({pocketLuma: pid, at: +performance.now().toFixed(2), frame, lumaC, luma, latch: st.replay, darkening, ref: ref ?? null, vel: +st.velocity.toFixed(4)});
      if (log.length > 64) log.splice(0, log.length - 64);
      if (changed || replay !== st.replay || darkening !== st.darkening) { st.darkening = darkening; this.invalidate(); }
    });

    const LEAD = 100;
    const onCanvas = (m: DOMMatrix, w: number, h: number, pad = 0): Rect => {
      if (!(m.a > 0 && m.d > 0)) return {x: 0, y: 0, w: 0, h: 0};
      const x0 = Math.max(0, (-pad - m.e) / m.a), y0 = Math.max(0, (-pad - m.f) / m.d), x1 = Math.min(w, (cssW + pad - m.e) / m.a), y1 = Math.min(h, (cssH + pad - m.f) / m.d);
      return {x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0)};
    };
    const within = (a: Rect, b: Rect) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
    const place = (el: HTMLElement, m: DOMMatrix, w: number, h: number) => {
      const near = onCanvas(m, w, h, LEAD), cover = this.rasterCover.get(el);
      let at = m;
      if (!this.nestedRecordFixed && near.w > 0.5 && near.h > 0.5 && cover && !within(near, cover)) {
        if (!this.recull.has(el)) { this.recull.add(el); repaintDrawable(el); }
        if (w * m.a <= cssW && h * m.d <= cssH) at = new DOMMatrix([m.a, 0, 0, m.d, Math.min(Math.max(m.e, 0), cssW - w * m.a), Math.min(Math.max(m.f, 0), cssH - h * m.d)]);
      }
      this.placedOnCanvas.set(el, onCanvas(at, w, h));
      canvas.updateElementGeometry(el, {canvasTransform: at});
    };
    const nested = new Map<HTMLElement, typeof placedItems>();
    for (const p of placedItems) { const l = nested.get(p.owner); if (l) l.push(p); else nested.set(p.owner, [p]); }
    const placeNested = (owner: HTMLElement) => { for (const {el, m, w, h} of nested.get(owner) ?? []) place(el, m, w, h); nested.delete(owner); };
    canvas.updateElementGeometry(root, {canvasTransform: new DOMMatrix()});
    placeNested(root);
    for (const it of items) { place(it.g.el, new DOMMatrix([it.sx, 0, 0, it.sy, it.cx - (it.box.w / 2) * it.sx, it.cy - (it.box.h / 2) * it.sy]), it.box.w, it.box.h); placeNested(it.g.el); }
    for (const owner of [...nested.keys()]) placeNested(owner);
    const away = new DOMMatrix([1, 0, 0, 1, -1e5, -1e5]);
    for (const g of glasses) if (!items.some((it) => it.g === g)) {
      canvas.updateElementGeometry(g.el, {canvasTransform: away});
      for (const w of g.el.querySelectorAll<HTMLElement>('[data-lg-item]')) if (w.closest('.lg-glass') === g.el) canvas.updateElementGeometry(w, {canvasTransform: away});
    }
    let first = false;
    for (const el of [...items.map((it) => it.g.el), ...placedItems.map((p) => p.el)]) if (!this.everPlaced.has(el)) { this.everPlaced.add(el); first = true; }
    if (first) this.source.placed?.();
    for (const [el, s] of [...this.snapshots]) {
      if (el !== root && !glasses.some((g) => g.el === el) && !usedEls.has(el)) {
        s.raw.destroy(); s.tex.destroy();
        this.snapshots.delete(el);
      }
    }

    this.stats.adapting = adapting;
    this.stats.frames++;
    if (this.stats.frames === 1) this.source.drawn?.();
    (window as unknown as {__glass: FrameStats}).__glass = this.stats;
    if (moving) requestFrame(this.canvas);
  }
}
