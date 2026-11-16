import type {GlassMotion} from './renderer';
import {commit, frameLoop, frameNow} from './frame';

export type Spring = readonly [number, number];
export type Ease = {bezier: readonly [number, number, number, number]; duration: number};
export type Curve = Spring | Ease;
export interface MorphSettings {
  transition: Spring; appear: Spring; delay: {factor: number; min: number; max: number};
  pulse: {up: Spring; height: Spring; heightDelay: number; width: Spring; widthDelay: number; maxScale: number; maxPoints: number; blur: {radius: number; spring: Spring} | null};
  kick: {scale: number; out: Spring; outDelay: number; back: Spring; backDelay: number};
  maxDistance: number;
  materialize: Curve;
}
export const TOOLBAR_MORPH: MorphSettings = {
  transition: [.416, .25], appear: [.5, .3], delay: {factor: .33, min: .083, max: .166},
  pulse: {up: [.292, .5], height: [.416, .416], heightDelay: .113, width: [.416, .5], widthDelay: .142, maxScale: 1.2, maxPoints: 16, blur: null},
  kick: {scale: 1 / 6, out: [.3, 0], outDelay: .06, back: [.6, .2], backDelay: .18}, maxDistance: 12,
  materialize: [.416, .25],
};

const isEase = (c: Curve): c is Ease => !Array.isArray(c);
function bezierAt([x1, y1, x2, y2]: readonly [number, number, number, number], u: number) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const f = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0, hi = 1, t = u;
  for (let i = 0; i < 60; i++) { t = (lo + hi) / 2; if (f(x1, x2, t) < u) lo = t; else hi = t; }
  return f(y1, y2, t);
}
export class Fluid {
  v = 0; f = 0; k = 0; c = 0; to: number; next: {at: number; to: number; spring: Curve} | null = null;
  ease: {from: number; at: number; curve: Ease} | null = null;
  constructor(public x: number, public t: number) { this.to = x; }
  go(at: number, to: number, spring: Curve) {
    if ((this.k !== 0 || this.ease) && at > this.t + 1e-9) { this.next = {at, to, spring}; return this; }
    this.next = null;
    this.at(at); this.t = Math.max(this.t, at); this.to = to;
    if (isEase(spring)) { this.ease = {from: this.x, at: this.t, curve: spring}; this.k = 0; this.v = this.f = 0; return this; }
    this.ease = null;
    this.k = Math.min((2 * Math.PI / spring[0]) ** 2, 44999.99999999999); this.c = -2 * (1 - spring[1]) * Math.sqrt(this.k);
    return this;
  }
  at(time: number): number {
    if (this.next && time >= this.next.at) { const n = this.next; this.next = null; this.at(n.at); this.go(n.at, n.to, n.spring); }
    if (this.ease) {
      const e = this.ease, u = (time - e.at) / e.curve.duration;
      this.t = Math.max(this.t, time);
      this.x = e.from + (this.to - e.from) * bezierAt(e.curve.bezier, u);
      if (u >= 1) { this.x = this.to; this.ease = null; }
      return this.x;
    }
    if (this.k === 0) { this.t = Math.max(this.t, time); return this.x; }
    while (this.t < time) { const vh = this.v + this.f / 600; this.x += vh / 300; this.f = this.c * vh + this.k * (this.to - this.x); this.v = vh + this.f / 600; this.t += 1 / 300; }
    return this.x;
  }
  get settled() { return !this.next && !this.ease && Math.abs(this.x - this.to) < 1e-3 && Math.abs(this.v) < 1e-2; }
}
export class Pulse {
  constructor(private S: MorphSettings['pulse']) {}
  ch: Fluid[] = [new Fluid(1, 0), new Fluid(0, 0), new Fluid(1, 0), new Fluid(0, 0), new Fluid(0, 0)];
  gen = true; steps: {at: number; i: number; spring: readonly [number, number]}[] = [];
  trigger(at: number) {
    const [up, down] = this.gen ? [1, 0] : [0, 1];
    const S = this.S;
    this.ch[up].go(at, 1, S.up); this.ch[2 + up].go(at, 1, S.up);
    this.steps = [{at: at + S.heightDelay, i: 2 + down, spring: S.height}, {at: at + S.widthDelay, i: down, spring: S.width}];
    if (S.blur) { this.ch[4].go(at, 1, S.blur.spring); this.steps.push({at: at + S.widthDelay, i: 4, spring: S.blur.spring}); }
    this.gen = !this.gen;
  }
  blur(t: number) { this.advance(t); return this.S.blur ? this.S.blur.radius * Math.max(0, this.ch[4].at(t)) : 0; }
  private advance(t: number) { while (this.steps.length && this.steps[0].at <= t) { const s = this.steps.shift()!; this.ch[s.i].go(s.at, 0, s.spring); } }
  scale(t: number, size: [number, number]): [number, number] {
    this.advance(t);
    return [0, 1].map((a) => { const L = Math.min(Math.sqrt(this.S.maxScale), Math.sqrt((size[a] + this.S.maxPoints) / size[a])), f = (x: number) => 1 / L + x * (L - 1 / L); return f(this.ch[2 * a].at(t)) * f(this.ch[2 * a + 1].at(t)); }) as [number, number];
  }
  get settled() { return !this.steps.length && this.ch.every((c) => c.settled); }
}
class Kick {
  constructor(private S: MorphSettings['kick']) {}
  x = new Fluid(0, 0); steps: {at: number; to: number; spring: readonly [number, number]}[] = [];
  set(at: number, d: number) {
    for (const s of this.steps) this.x.go(Math.max(at, this.x.t), s.to, s.spring);
    const S = this.S;
    this.steps = [{at: at + S.outDelay, to: d * S.scale, spring: S.out}, {at: at + S.outDelay + S.backDelay, to: 0, spring: S.back}];
  }
  at(t: number) {
    while (this.steps.length && this.steps[0].at <= t) { const s = this.steps.shift()!; this.x.go(s.at, s.to, s.spring); }
    return this.x.at(t);
  }
  get settled() { return !this.steps.length && this.x.settled; }
}

const hidden = (h: HTMLElement, p: number, materialize = false, pulseBlur = 0) => {
  const still = Math.abs(p) < 1e-4 && pulseBlur < 1e-3, opacity = Math.min(1, Math.max(0, 1 - p)), scale = 1 + ((materialize ? 1.2 : .2) - 1) * p, blur = Math.hypot(Math.max(0, 10 * p), pulseBlur);
  if (still) delete h.dataset.lgLayer; else h.dataset.lgLayer = `${opacity} ${scale} ${blur}`;
};

type Cell = {id: string; x: number; w: number};
const devPx = (d: number) => { const k = typeof devicePixelRatio === 'number' ? devicePixelRatio : 3; return Math.round(d * k) / k; };
function itemScore(a: Cell, b: Cell) {
  const lap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return {d: Math.abs(2 * a.x + a.w - 2 * b.x - b.w) < 1e-9 ? 0 : devPx(Math.max(0, -lap)), reuse: lap >= .5 * Math.min(a.w, b.w)};
}
function itemSource(target: Cell, cands: Cell[], others: Cell[], max: number): Cell | null {
  const ok = (r: {reuse: boolean}, c: Cell, t: Cell) => r.reuse || t.w < 3 * c.w;
  let best: Cell | null = null, bd = Infinity, reuse = false, close = false;
  for (const c of cands) {
    const r = itemScore(c, target);
    if (!ok(r, c, target)) continue;
    close ||= r.d <= max;
    if (r.d < bd && !(best && reuse && !r.reuse)) { best = c; bd = r.d; reuse = r.reuse; }
  }
  if (!best || close) return best;
  const b = best;
  return others.some((o) => o.id !== target.id && o.id !== b.id && itemScore(o, target).d <= max && (() => { const r = itemScore(b, o); return r.d < bd && ok(r, b, o); })()) ? b : null;
}

export type Place = {cx: number; cy: number; w: number; h: number; hosts: {node: HTMLElement; orig: HTMLElement; cx: number; w: number}[]; keys: string};
export interface Entry {
  el: HTMLElement | null; keys: string; motion: GlassMotion | null; animated: boolean; leaving: (() => void) | null;
  id?: unknown; ns?: string; transition?: 'matchedGeometry' | 'materialize' | 'identity';
  snap: Place | null; last?: Place | null; read: (copy?: boolean) => Place | null;
}
export type Box = {cx: number; cy: number; w: number; h: number};
const apartFrom = (a: Box, b: Box): [number, number] => {
  const apart = b.cx + b.w / 2 <= a.cx - a.w / 2 || a.cx + a.w / 2 <= b.cx - b.w / 2 || b.cy + b.h / 2 <= a.cy - a.h / 2 || a.cy + a.h / 2 <= b.cy - b.h / 2;
  return apart ? [b.cx - a.cx, b.cy - a.cy] : [0, 0];
};
const minimized = (a: Box, b: Box): Box => {
  const mb = (x: number, w: number, X: number, W: number) => (x < X ? Math.min(x + w, Math.max(x, x + w - W)) : x);
  const w = Math.min(a.w, b.w), h = Math.min(a.h, b.h), x = mb(a.cx - a.w / 2, a.w, b.cx - b.w / 2, b.w), y = mb(a.cy - a.h / 2, a.h, b.cy - b.h / 2, b.h);
  return {cx: x + w / 2, cy: y + h / 2, w, h};
};
export interface MorphHost {
  begin(e: Entry): void;
  end(e: Entry): void;
  reset(e: Entry): void;
  resize(e: Entry, f: Box): void;
  place(e: Entry, f: Box, leaving: boolean): Box;
  leave(e: Entry, on: boolean): void;
  rowItems: boolean;
  items(el: HTMLElement): HTMLElement[];
  size(): [number, number];
  settled(): void;
  invalidate(): void;
}

type Fade = {node: HTMLElement; p: Fluid | null; ghost: boolean; x: Fluid | null; w: number; offset: number; index: number; mat?: boolean; id?: string; ox?: number; born?: number};
type Track = {e: Entry; kind: 'stay' | 'new' | 'leave'; cx: Fluid; cy: Fluid; w: Fluid; h: Fluid; shape: Fluid; grow: Fluid | null; pulse: Pulse; anchor: [number, number];
  kx: Kick; ky: Kick; fades: Fade[]; offsets: [number, number][]; mat?: boolean; jump?: boolean; until?: number; leftAt?: number; blurred?: boolean;
  old: {cx: number; w: number; id: string; kept: boolean}[]; pad: number};
export const hostsOf = (el: HTMLElement) => ([...el.children] as HTMLElement[]).filter((h) => h.dataset.lgGhost === undefined);
const logical = (c: Curve) => (isEase(c) ? c.duration : 1.64 * c[0]);

export class Morph {
  entries = new Set<Entry>();
  animation: ContainerAnimation = 'default';
  dead = false;
  private ready = false; private tracks = new Map<Entry, Track>(); private loop = frameLoop(() => { for (const e of this.entries) if (e.el?.isConnected) return e.el; return null; }); private since = 0; private planned: (() => void) | null = null;
  constructor(private host: MorphHost, public settings: MorphSettings) {}

  change() {
    if (this.dead) return;
    const all = [...this.entries].filter((e) => e.el?.isConnected);
    const done = () => { for (const e of all) { if (!this.tracks.has(e) && !e.leaving) e.last = e.read(false); e.snap = null; } };
    if (!this.ready) { this.ready = true; for (const e of all) e.leaving?.(); done(); return; }
    const before = (e: Entry) => e.snap ?? e.last ?? null;
    const moved = (e: Entry) => { if (this.tracks.has(e)) return false; const b = before(e), n = e.read(false); return !!b && !!n && (Math.abs(b.cx - n.cx) > .01 || Math.abs(b.cy - n.cy) > .01 || Math.abs(b.w - n.w) > .01 || Math.abs(b.h - n.h) > .01); };
    const changed = all.some((e) => e.animated && (e.leaving ? this.tracks.get(e)?.kind !== 'leave' : !before(e) || before(e)!.keys !== e.keys || moved(e)));
    if (!changed) { done(); return; }
    for (const e of all) if (!e.animated && e.leaving) e.leaving();
    if (this.animation === null) {
      for (const k of [...this.tracks.values()]) this.settle(k);
      this.tracks.clear(); this.loop.stop();
      for (const e of all) e.leaving?.();
      done(); this.host.invalidate(); this.host.settled();
      return;
    }
    this.run(all.filter((e) => e.animated), before);
    done();
  }

  replan() { if (this.planned && this.tracks.size) { this.planned(); this.host.invalidate(); } }

  private clock() { return frameNow() / 1000; }

  private run(entries: Entry[], before: (e: Entry) => Place | null) {
    const S = this.settings, anim = this.animation!, glassy = anim === 'default', host = this.host;
    const tr: Curve = glassy ? S.transition : anim, ap: Curve = glassy ? S.appear : anim, matC: Curve = glassy ? S.materialize : anim;
    const T0 = this.clock();
    this.since = T0;
    for (const k of [...this.tracks.values()]) if (!k.e.el?.isConnected) this.tracks.delete(k.e);
    const resized = new Set<Track>(), pulsed = new Set<Track>();
    const relay = new Map<Entry, Entry>(), relayed = new Set<Entry>();
    if (host.rowItems && !entries.some((e) => !e.leaving && before(e))) {
      const outs = entries.filter((e) => e.leaving && this.tracks.get(e)?.kind !== 'leave' && before(e)).sort((a, b) => before(a)!.cx - before(b)!.cx);
      const ins = entries.filter((e) => !e.leaving && !before(e)).map((e) => [e, e.read(false)?.cx ?? 0] as const).sort((a, b) => a[1] - b[1]).map(([e]) => e);
      ins.forEach((e, i) => { if (outs[i]) { relay.set(e, outs[i]); relayed.add(outs[i]); } });
    }
    for (const e of relayed) {
      this.tracks.delete(e);
      if (e.el) e.el.dataset.lgHidden = '';
      e.leaving?.();
    }
    for (const e of entries) {
      if (relayed.has(e)) continue;
      const partner = relay.get(e), el = e.el!, s = partner ? before(partner) : before(e);
      let k = this.tracks.get(e);
      const was = k?.kind ?? null, kind = e.leaving ? 'leave' : k || s ? 'stay' : 'new';
      const oldK = s ? s.keys.split('|') : [], newK = e.keys.split('|'), live = host.items(el);
      const keep = (j: number) => kind === 'stay' && !!s && j < oldK.length && oldK[j] === newK[j] && s.hosts[j]?.orig === live[j];
      const replaced = kind !== 'leave' && !!s && (s.keys !== e.keys);
      if (!k) {
        k = {e, kind, cx: new Fluid(s?.cx ?? 0, T0), cy: new Fluid(s?.cy ?? 0, T0), w: new Fluid(s?.w ?? 0, T0), h: new Fluid(s?.h ?? 0, T0), shape: new Fluid(1, T0),
          grow: null, pulse: new Pulse(S.pulse), anchor: [.5, .5], kx: new Kick(S.kick), ky: new Kick(S.kick), fades: [], offsets: [], old: [], pad: 0};
        this.tracks.set(e, k);
      }
      host.begin(e);
      k.kind = kind; k.offsets = []; k.jump = false;
      if (was === 'leave' && kind !== 'leave') { host.leave(e, false); k.until = undefined; }
      if (kind === 'leave' && was !== 'leave') {
        host.leave(e, true); k.leftAt = T0;
        for (const n of host.items(el)) { const f = k.fades.find((x) => x.node === n); if (f) { if (!f.p) f.p = new Fluid(0, T0); f.p.go(T0, 1, tr); } else { k.fades.push({node: n, p: new Fluid(0, T0).go(T0, 1, tr), ghost: false, x: null, w: 0, offset: 0, index: -1}); } }
      }
      if (replaced || kind === 'new') {
        const olds = s?.hosts ?? [];
        k.pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
        k.old = olds.map(({cx, w}, i) => ({cx, w, kept: keep(i), id: keep(i) ? `n${i}` : `o${i}@${T0}`}));
        olds.forEach(({node, orig, cx, w}, i) => {
          const old = k.fades.find((x) => x.node === orig);
          if (keep(i)) { if (old) { old.index = i; old.x ??= new Fluid(cx, T0); } else k.fades.push({node: orig, p: null, ghost: false, x: new Fluid(cx, T0), w, offset: 0, index: i}); return; }
          node.dataset.lgGhost = ''; node.removeAttribute('role'); node.setAttribute('aria-hidden', 'true');
          Object.assign(node.style, {position: 'absolute', top: '50%', translate: '', pointerEvents: 'none'});
          if (node.hasAttribute('data-lg-fill')) Object.assign(node.style, {right: 'auto', bottom: 'auto', left: '0px', width: `${w}px`, height: `${s?.h ?? 0}px`});
          el.appendChild(node);
          node.style.marginTop = `${-node.offsetHeight / 2}px`;
          const p = old?.p ?? new Fluid(0, T0);
          k.fades = k.fades.filter((x) => x !== old);
          k.fades.push({node, p: p.go(T0, 1, tr), ghost: true, x: new Fluid(cx, T0), w, offset: 0, index: -1, id: k.old[i].id, ox: cx});
        });
        live.forEach((n, j) => { if (keep(j)) return; k.fades = k.fades.filter((x) => x.node !== n); hidden(n, 1); k.fades.push({node: n, p: new Fluid(1, T0), ghost: false, x: null, w: 0, offset: 0, index: j}); });
        if (kind === 'stay') k.grow = null;
      }
      if (replaced) resized.add(k);
    }
    const tracks = [...this.tracks.values()].filter((k) => entries.includes(k.e) && !relayed.has(k.e));
    const plan = (T: number) => {
      const target = new Map<Track, Box & {hosts: number[]; ws: number[]}>();
      for (const k of tracks) {
        if (k.kind === 'leave') continue;
        host.reset(k.e);
        const now = k.e.read(false)!;
        k.e.last = now;
        target.set(k, {cx: now.cx, cy: now.cy, w: now.w, h: now.h, hosts: now.hosts.map((x) => x.cx), ws: now.hosts.map((x) => x.w)});
      }
      const stayers = tracks.filter((k) => k.kind === 'stay');
      const dpr = devicePixelRatio || 1, px = (d: number) => Math.sign(d) * Math.round(Math.abs(d) * dpr) / dpr;
      const axis = (a0: number, a1: number, b0: number, b1: number) => (Math.abs((a0 + a1) - (b0 + b1)) < 1e-9 ? 0 : px(Math.max(0, Math.max(a0, b0) - Math.min(a1, b1))));
      const dist = (a: Box, b: Box) => Math.hypot(axis(a.cx - a.w / 2, a.cx + a.w / 2, b.cx - b.w / 2, b.cx + b.w / 2), axis(a.cy - a.h / 2, a.cy + a.h / 2, b.cy - b.h / 2, b.cy + b.h / 2));
      const nsOk = (a: Entry, b: Entry) => (a.id === undefined) === (b.id === undefined) && (a.id === undefined || (a.ns ?? '') === (b.ns ?? ''));
      const match = (e: Entry, b: Box, others: [Entry, Box][]) => {
        let src: Track | null = null, best = Infinity;
        for (const q of stayers) { if (!nsOk(e, q.e)) continue; const d = dist(target.get(q)!, b); if (d < best) { best = d; src = q; } }
        if (!src) return null;
        const t = target.get(src)!;
        if (best > S.maxDistance + 1e-6 && !others.some(([o, ob]) => o !== e && nsOk(e, o) && dist(ob, b) <= S.maxDistance + 1e-6 && dist(t, ob) < best)) return null;
        return {src, offset: apartFrom(t, b)};
      };
      const side = (o: number) => (o < 0 ? 1 : o > 0 ? 0 : .5);
      const frame = (k: Track): Box => ({cx: k.cx.x, cy: k.cy.x, w: k.w.x, h: k.h.x});
      const go = (k: Track, b: Box, c: Curve, at = T) => { k.cx.go(at, b.cx, c); k.cy.go(at, b.cy, c); k.w.go(at, b.w, c); k.h.go(at, b.h, c); };
      const [cw, ch] = host.size();
      const newcomers = tracks.filter((k) => k.kind === 'new' && target.has(k)).map((k) => [k.e, target.get(k)!] as [Entry, Box]);
      const leavers = tracks.filter((k) => k.kind === 'leave').map((k) => [k.e, frame(k)] as [Entry, Box]);
      const removing = new Map<Track, [number, number][]>();
      for (const k of tracks) k.offsets = [];
      for (const k of tracks) {
        const t = target.get(k);
        if (k.kind === 'stay' && t) {
          go(k, t, tr); k.shape.go(T, 1, tr);
          const pad = k.pad, cell = (id: string, cx: number, w: number): Cell => ({id, x: cx - w / 2 - pad, w: w + 2 * pad});
          const news = t.hosts.map((cx, j) => cell(`n${j}`, cx, t.ws[j])), olds = k.old.map((o, i) => (o.kept && news[i] ? {...news[i]} : cell(o.id, o.cx, o.w)));
          for (const f of k.fades) {
            if (f.ghost && f.node.hasAttribute('data-lg-fill')) { f.x!.go(T, t.cx, tr); continue; }
            if (f.ghost) { const m = itemSource(cell(f.id!, f.ox!, f.w), news, olds, S.maxDistance); f.x!.go(T, m ? t.hosts[+m.id.slice(1)] : f.ox!, tr); continue; }
            const at = t.hosts[f.index] ?? t.cx;
            f.offset = at - t.cx;
            if (!f.p) { f.x!.go(T, at, tr); continue; }
            if (f.p.to !== 0 || f.p.k === 0) { f.p.go(T, 0, tr); f.born = T0; }
            if (f.born === T0) {
              const m = itemSource(news[f.index], olds, news, S.maxDistance), o = m && k.old.find((x) => x.id === m.id);
              f.x = o ? new Fluid(o.cx, T0) : null;
            }
            f.x?.go(T, at, tr);
          }
        }
        if (k.kind === 'new' && t && !k.jump) {
          const twin = k.e.id === undefined ? null : tracks.find((q) => q.kind === 'leave' && q.e.id === k.e.id && (q.e.ns ?? '') === (k.e.ns ?? '') && q.leftAt === T0);
          if (twin || k.e.transition === 'identity') {
            k.jump = true;
            for (const f of k.fades) hidden(f.node, 0);
            k.fades = []; k.cx = new Fluid(t.cx, T); k.cy = new Fluid(t.cy, T); k.w = new Fluid(t.w, T); k.h = new Fluid(t.h, T); k.shape = new Fluid(1, T); k.grow = null;
            if (twin) twin.until = T;
            continue;
          }
          const m0 = k.e.transition === 'materialize' ? null : match(k.e, t, newcomers);
          const m = m0 ?? (relay.size ? {src: k, offset: [0, 0] as [number, number], own: true} : null);
          if (!m) {
            k.cx = new Fluid(t.cx, T); k.cy = new Fluid(t.cy, T); k.w = new Fluid(t.w, T); k.h = new Fluid(t.h, T); k.shape = new Fluid(1.2, T).go(T, 1, matC); k.grow = null; k.anchor = [.5, .5]; k.mat = true;
            k.fades.forEach((f) => { if (!f.ghost) { f.p = new Fluid(1, T).go(T, 0, matC); f.mat = true; f.offset = t.hosts[f.index] - t.cx; } });
            continue;
          }
          const src = m.src, was = frame(src), from = 'own' in m ? {cx: t.cx, cy: t.cy, w: t.w, h: t.h} : minimized(target.get(src) ?? was, t);
          const offset: [number, number] = 'own' in m ? m.offset : apartFrom(was, t);
          const start = glassy ? T + S.delay.min + Math.min(S.delay.max, S.delay.factor * Math.hypot(offset[0], offset[1]) / Math.hypot(cw, ch)) : T;
          k.cx = new Fluid(from.cx, start).go(start, t.cx, ap); k.cy = new Fluid(from.cy, start).go(start, t.cy, ap);
          k.w = new Fluid(from.w, start).go(start, t.w, ap); k.h = new Fluid(from.h, start).go(start, t.h, ap);
          k.shape = new Fluid(.2, start).go(start, 1, ap); k.grow = new Fluid(0, start).go(start, 1, ap);
          k.anchor = [side(offset[0]), side(offset[1])];
          if (glassy && !('own' in m)) { src.offsets.push(offset); k.offsets.push(offset); }
          k.mat = false;
          k.fades.forEach((f, j) => { if (!f.ghost) { f.p = new Fluid(1, start).go(start, 0, ap); f.offset = t.hosts[j] - t.cx; } });
        }
        if (k.kind === 'leave') {
          if (k.e.transition === 'identity') { k.until = T; continue; }
          const b = frame(k), m = k.e.transition === 'materialize' ? null : match(k.e, b, leavers), a = m && target.get(m.src);
          if (a) {
            go(k, minimized(a, b), tr);
            k.shape.go(T, .2, tr);
            if (glassy) removing.set(m!.src, [...(removing.get(m!.src) ?? []), m!.offset]);
            k.until ??= T + logical(tr);
          } else { k.shape.go(T, 1.2, matC); k.fades.forEach((f) => { f.mat = true; if (f.p) f.p.go(T, 1, matC); }); k.until ??= T + logical(matC); }
        }
      }
      if (glassy) for (const k of tracks) {
        const mine = [...k.offsets, ...(removing.get(k) ?? [])];
        if (k.kind === 'stay') k.anchor = mine.length && !resized.has(k) ? [side(mine.reduce((a, o) => a + o[0], 0)), side(mine.reduce((a, o) => a + o[1], 0))] : [.5, .5];
        if (((k.kind === 'new' && !k.mat && !k.jump) || (k.kind === 'stay' && (resized.has(k) || mine.length || Math.abs(k.w.x - k.w.to) > .01 || Math.abs(k.h.x - k.h.to) > .01))) && !pulsed.has(k)) { k.pulse.trigger(T); pulsed.add(k); }
        if (k.offsets.length) { k.kx.set(T, k.offsets.reduce((a, o) => a + o[0], 0) / k.offsets.length); k.ky.set(T, k.offsets.reduce((a, o) => a + o[1], 0) / k.offsets.length); }
      }
    };
    const apply = (T: number) => {
      const live = tracks.filter((k) => this.tracks.has(k.e));
      const at = live.map((k): Box => ({cx: k.cx.at(T), cy: k.cy.at(T), w: k.w.at(T), h: k.h.at(T)}));
      live.forEach((k, i) => host.resize(k.e, at[i]));
      const laid = live.map((k, i) => host.place(k.e, at[i], k.kind === 'leave'));
      live.forEach((k, i) => {
        const f = at[i], L = laid[i], m = k.e.motion, grow = k.grow ? k.grow.at(T) : 1;
        if (m) {
          const [sx, sy] = k.pulse.scale(T, [f.w, f.h]), sh = k.shape.at(T);
          m.scale = [sx, sy];
          m.translation = [f.cx - L.cx + (k.anchor[0] - .5) * f.w * (1 - sx) + k.kx.at(T), f.cy - L.cy + (k.anchor[1] - .5) * f.h * (1 - sy) + k.ky.at(T)];
          m.shape = L === f ? sh : [sh * f.w / L.w, sh * f.h / L.h];
          const fp = k.kind === 'leave' ? k.fades.find((x) => x.p && !x.ghost)?.p?.at(T) : undefined;
          m.glow = fp === undefined ? 1 : Math.min(1, Math.max(0, 1 - fp));
        }
        const to = k.cx.to, pb = k.pulse.blur(T);
        if (pb > 0 || k.blurred) {
          for (const n of host.items(k.e.el!)) if (!k.fades.some((x) => x.node === n && x.p)) hidden(n, 0, false, pb);
          k.blurred = pb > 0;
        }
        for (const x of k.fades) {
          if (x.p) hidden(x.node, x.p.at(T), x.mat, pb);
          if (x.ghost) x.node.style.left = `${x.x!.at(T) - x.w / 2 - (f.cx - f.w / 2)}px`;
          else if (host.rowItems && k.kind !== 'leave' && !x.node.hasAttribute('data-lg-fill')) x.node.style.translate = `${k.grow ? x.offset * (grow - 1) : (x.x ? x.x.at(T) : to + x.offset) - (f.cx + x.offset)}px 0`;
          else x.x?.at(T);
        }
      });
      host.invalidate();
    };
    plan(T0);
    apply(T0);
    this.planned = () => plan(T0);
    let first = true;
    const step = () => {
      const pinned = (window as unknown as {__morphAt?: number}).__morphAt, T = typeof pinned === 'number' ? this.since + pinned : this.clock();
      if (first) { first = false; plan(T0); }
      apply(T);
      commit(() => { for (const k of [...this.tracks.values()]) if (k.kind === 'leave' && k.until !== undefined && T >= k.until) { this.settle(k); this.tracks.delete(k.e); } });
      const quiet = (k: Track) => [k.cx, k.cy, k.w, k.h, k.shape].every((x) => x.settled) && k.pulse.settled && k.kx.settled && k.ky.settled && k.fades.every((f) => (!f.p || f.p.settled) && (!f.x || f.x.settled));
      if (typeof pinned !== 'number' && T - this.since > .3 && [...this.tracks.values()].every(quiet)) {
        commit(() => { for (const k of this.tracks.values()) this.settle(k); });
        this.tracks.clear(); this.planned = null;
        host.invalidate(); host.settled();
        return false;
      }
      return true;
    };
    this.loop.start(step);
  }

  private settle(k: Track) {
    if (k.kind === 'leave') { k.e.leaving?.(); return; }
    for (const f of k.fades) if (f.ghost) f.node.remove(); else { if (f.p) hidden(f.node, 0); f.node.style.translate = ''; }
    if (k.blurred && k.e.el) { for (const n of this.host.items(k.e.el)) hidden(n, 0); k.blurred = false; }
    k.fades = [];
    Object.assign(k.e.motion ?? {}, {scale: [1, 1], translation: [0, 0], shape: 1, glow: 1});
    this.host.end(k.e);
    k.e.last = k.e.read(false);
  }
}

export const containerMorph = (spacing: number): MorphSettings => ({
  transition: [.5, .3], appear: [.5, .3], delay: {factor: .4, min: .1, max: .2},
  pulse: {up: [.35, .6], height: [.5, .5], heightDelay: .135, width: [.5, .6], widthDelay: .17, maxScale: 1.2, maxPoints: 16, blur: {radius: 10, spring: [.5, .3]}},
  kick: {scale: 1 / 6, out: [.3, 0], outDelay: .06, back: [.6, .2], backDelay: .18}, maxDistance: spacing, materialize: [.5, 0],
});
export type ContainerAnimation = 'default' | Curve | null;
