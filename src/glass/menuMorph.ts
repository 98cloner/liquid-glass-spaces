type Rect = {x: number; y: number; w: number; h: number};
export type Spring = {value: number; velocity: number; target: number; response: number; damping: number;
  smooth?: {age: number; from: [number, number]; to: [number, number]}};

export function step(s: Spring, dt: number) {
  if (dt <= 0 || (s.value === s.target && s.velocity === 0)) return;
  if (s.smooth) {
    const m = s.smooth, a = (m.age += dt), f = (1 + 2 * Math.PI * a) * Math.exp(-2 * Math.PI * a);
    s.response = m.to[0] + (m.from[0] - m.to[0]) * f; s.damping = m.to[1] + (m.from[1] - m.to[1]) * f;
  }
  const w = (2 * Math.PI) / s.response, u = s.value - s.target;
  if (s.damping >= 1) {
    const c = s.velocity + w * u, e = Math.exp(-w * dt);
    s.value = s.target + (u + c * dt) * e;
    s.velocity = (s.velocity - w * c * dt) * e;
  } else {
    const a = s.damping * w, b = w * Math.sqrt(1 - s.damping * s.damping), e = Math.exp(-a * dt), B = (s.velocity + a * u) / b, cos = Math.cos(b * dt), sin = Math.sin(b * dt);
    s.value = s.target + e * (u * cos + B * sin);
    s.velocity = e * (-a * (u * cos + B * sin) + (-u * b * sin + B * b * cos));
  }
  if (Math.abs(s.target - s.value) < 1e-4 && Math.abs(s.velocity) < 1e-3) { s.value = s.target; s.velocity = 0; }
}
export const spring = (value: number): Spring => ({value, velocity: 0, target: value, response: 1, damping: 1});
export const to = (s: Spring, target: number, response: number, damping: number) => Object.assign(s, {target, response, damping});

const OPEN = [0.35, 0.75] as const, CLOSE = [0.49, 0.8] as const, LAUNCH = [0.14, 1] as const, SOURCE_WIDTH = [0.21, 1] as const;
const UNION = 20, UNION_ON = [0.07, 1] as const, UNION_OFF = [0.42, 1] as const;
const POLL = 0.016, DISPLAY = 1 / 60, SPEED = 0.7, LENS_ON = [0.21, 1] as const, BLUR_OFF = [0.315, 0.8] as const;

export interface MenuMorphPose {
  panel: Rect & {radius: number};
  source: Rect & {radius: number};
  q: number;
  rows: number;
  label: number;
  copies: [number, number];
  host: number;
  generations: [number, number];
  expanded: boolean;
  union: number;
  scale: number;
  height: number;
  lens: {scale: number; blur: number; amount: number; height: number};
}

type Channel = 'scale' | 'height' | 'radius' | 'kick' | 'q' | 'x' | 'y' | 'width' | 'sourceScale' | 'sourceX' | 'sourceY' | 'sourceKick' | 'union' | Effect | Owner;
type Effect = 'lens' | 'lensHeight' | 'portalScale' | 'blur';
type Owner = 'copyMenu' | 'copyButton' | 'host' | 'listIn' | 'listOut';
const EFFECTS: Channel[] = ['union', 'lens', 'lensHeight', 'portalScale', 'blur'];
type Due = {at: number; exact?: boolean; run: (at: number, now: number) => void};

export class MenuMorph {
  phase: 'open' | 'close' = 'open';
  released: {value: number; velocity: number} | null = null;
  private t: number | null = null;
  started = 0;
  expanded = false;
  private due: Due[] = [];
  private readonly s0: number;
  private readonly ch: Record<Channel, Spring>;

  constructor(private button: Rect, private panel: Rect, private dpr = 3) {
    this.s0 = button.h / 2 / panel.w;
    const [bx, by] = centre(button);
    this.ch = {scale: spring(this.s0), height: spring(panel.w), radius: spring(panel.w / 2), kick: spring(0), q: spring(0), x: spring(bx), y: spring(by),
      width: spring(button.w), sourceScale: spring(1), sourceX: spring(bx), sourceY: spring(by), sourceKick: spring(0), union: spring(0),
      lens: spring(-0.001), lensHeight: spring(20), portalScale: spring(1), blur: spring(0), copyMenu: spring(0), copyButton: spring(1), host: spring(1), listIn: spring(1), listOut: spring(0)};
  }

  place(button: Rect, panel: Rect) {
    this.button = button; this.panel = panel;
    const [x, y] = this.phase === 'open' ? centre(panel) : centre(button), [sx, sy] = this.phase === 'open' ? this.pivot() : centre(button);
    Object.assign(this.ch.x, {target: x}); Object.assign(this.ch.sourceX, {target: sx}); Object.assign(this.ch.sourceY, {target: sy});
    if (!this.due.some((d) => d.exact)) Object.assign(this.ch.y, {target: y});
  }

  private get down() { return this.panel.y + this.panel.h / 2 > this.button.y + this.button.h / 2; }
  private kick(amount: number) { return amount * Math.min(1, Math.max(0.5, (this.panel.h - 60) / 140)) * (this.down ? 1 : -1); }
  private pivot(): [number, number] {
    const {button: B, panel: P, dpr} = this, [bx, by] = centre(B), [px, py] = centre(P), r = B.h / 2;
    const frinta = (v: number) => Math.sign(v) * Math.round(Math.abs(v) * dpr) / dpr;
    const c = [Math.min(P.x + P.w, Math.max(P.x, bx + (px - bx) / 4)), Math.min(P.y + P.h, Math.max(P.y, by + (py - by) / 4))];
    return [frinta(c[0] - r) + r, frinta(c[1] - r) + r];
  }

  go(phase: 'open' | 'close', now: number) {
    this.advance(now);
    this.released = phase === 'open' && this.phase === 'close' ? {value: this.ch.host.value, velocity: this.ch.host.velocity} : null;
    this.phase = phase;
    this.started = now;
    this.expanded = false;
    const {ch, panel, button} = this, open = phase === 'open', [r, d] = open ? OPEN : CLOSE;
    const [x, y] = open ? centre(panel) : centre(button), [sx, sy] = open ? this.pivot() : centre(button);
    to(ch.scale, open ? 1 : this.s0, r, d);
    to(ch.height, open ? panel.h : panel.w, r, d);
    to(ch.radius, open ? panel.w : panel.w / 2, r, d);
    to(ch.q, open ? 1 : 0, r, d);
    to(ch.x, x, r, d); to(ch.y, y, r, d);
    to(ch.width, open ? button.h : button.w, ...(open ? SOURCE_WIDTH : CLOSE) as [number, number]);
    to(ch.sourceScale, open ? 0.25 : 1, r, d);
    to(ch.sourceX, sx, r, d); to(ch.sourceY, sy, r, d);
    to(ch.kick, this.kick(80), ...LAUNCH);
    if (!open) to(ch.sourceKick, -this.kick(40), r, d);
    to(ch.union, UNION, ...UNION_ON);
    to(ch.copyMenu, open ? 1 : 0, 0.2, 1); to(ch.copyButton, open ? 0 : 1, 0.2, 1);
    if (open) Object.assign(ch.host, {value: 1, velocity: 0, target: 1}); else to(ch.host, 0, 0.35, 0.85);
    if (open) {
      Object.assign(ch.listIn, {value: 0, velocity: 0}); to(ch.listIn, 1, 0.4, 1);
      Object.assign(ch.listOut, {value: 1, velocity: 0, smooth: {age: 0, from: [0.65, 0.70710678118], to: [0.4, 1]}}); to(ch.listOut, 0, 0.65, 0.70710678118);
    }
    const depth = 75 * Math.min(1, (open ? Math.min(panel.w, panel.h) : Math.min(button.w, button.h)) / 250);
    if (open && this.settled) ch.lensHeight.value = 20;
    to(ch.lens, -depth, r, d); to(ch.lensHeight, depth, r, d);
    to(ch.portalScale, 1.65 - 0.45 * Math.min(1, Math.max(0, (panel.h - 215) / 305)), ...LENS_ON); to(ch.blur, 4, ...LENS_ON);
    const given = (globalThis as {__menuMorphTimeline?: Record<string, Record<string, number>>}).__menuMorphTimeline?.[phase] ?? {};
    const step = (delay: number, run: Due['run'], name: string): Due => ({at: now + (given[name] ?? Math.ceil(delay * SPEED / POLL - 1e-9) * POLL), run});
    const unkick = () => to(ch.kick, 0, r, d), smoothOff = () => to(ch.union, 0, ...UNION_OFF);
    const lensOff = () => { const off = open ? 0.42 : 0.28; to(ch.lens, -0.001, off, 1); to(ch.lensHeight, 0, off, 1); to(ch.portalScale, 1, ...BLUR_OFF); to(ch.blur, 0, ...BLUR_OFF); };
    this.due = open ? [
      step(0.1, (at, display) => {
        this.expanded = true;
        to(ch.radius, 32, r, d);
        ch.y.target = y - ch.kick.target;
        this.due.push({at: given.restore !== undefined ? at + given.restore : Math.min(display, at + DISPLAY), exact: true, run: () => { ch.y.target = centre(this.panel)[1]; }});
        this.due.sort((a, b) => a.at - b.at || +!!a.exact - +!!b.exact);
      }, 'unkick'),
      step(0.1, unkick, 'unkick'),
      step(0.12, lensOff, 'lensOff'),
      step(0.3, smoothOff, 'smoothOff'),
    ] : [step(0.1, unkick, 'unkick'), step(0.1, lensOff, 'lensOff'), step(0.1, smoothOff, 'smoothOff'), step(0.15, () => to(ch.sourceKick, 0, r, d), 'sourceUnkick')];
    this.due.sort((a, b) => a.at - b.at);
  }

  advance(now: number) {
    if (this.t === null) { this.t = now; return; }
    while (this.due.length && this.due[0].at <= now) {
      const d = this.due.shift()!, at = d.exact ? d.at : Math.max(this.t!, d.at - DISPLAY);
      for (const s of Object.values(this.ch)) step(s, at - this.t!);
      this.t = Math.max(this.t!, at);
      d.run(this.t, now);
    }
    for (const s of Object.values(this.ch)) step(s, now - this.t);
    this.t = now;
  }

  get settled() {
    const tol = (k: Channel) => k === 'scale' || k === 'sourceScale' ? 0.05 / this.panel.w : k === 'q' || k === 'copyMenu' || k === 'copyButton' || k === 'host' || k === 'listIn' || k === 'listOut' ? 1 / 512 : 0.05;
    const done = !this.due.length && (Object.entries(this.ch) as [Channel, Spring][]).every(([k, s]) => EFFECTS.includes(k) || (Math.abs(s.target - s.value) < tol(k) && Math.abs(s.velocity) < 10 * tol(k)));
    if (done) for (const s of Object.values(this.ch)) Object.assign(s, {value: s.target, velocity: 0});
    return done;
  }

  pose(): MenuMorphPose {
    const {ch, panel: P, button: B} = this, sig = ch.scale.value, h = ch.height.value, ss = ch.sourceScale.value, ws = ch.width.value;
    const cx = ch.x.value, cy = ch.y.value + ch.kick.value * sig, sx = ch.sourceX.value, sy = ch.sourceY.value + ch.sourceKick.value * ss;
    return {
      panel: {x: cx - (P.w * sig) / 2, y: cy - (h * sig) / 2, w: P.w * sig, h: h * sig, radius: Math.min(ch.radius.value, h / 2) * sig},
      source: {x: sx - (ws * ss) / 2, y: sy - (B.h * ss) / 2, w: ws * ss, h: B.h * ss, radius: (B.h / 2) * ss * ((globalThis as {__menuPresented?: boolean}).__menuPresented ? clamp01(ch.q.value) : 1)},
      q: ch.q.value, union: Math.max(0, ch.union.value), scale: sig, height: h, expanded: this.expanded,
      rows: clamp01(ch.q.value), label: clamp01((1 - ch.q.value) / 0.65),
      copies: [clamp01(ch.copyButton.value), clamp01(ch.copyMenu.value) * clamp01(ch.host.value)], generations: [clamp01(ch.listIn.value), clamp01(ch.listOut.value)], host: ch.host.value,
      lens: {scale: ch.portalScale.value, blur: Math.max(0, ch.blur.value), amount: Math.min(-0.001, ch.lens.value), height: Math.max(0, ch.lensHeight.value)},
    };
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const centre = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

export interface PanelMorph {
  phase: 'open' | 'close';
  released: {value: number; velocity: number} | null;
  started: number;
  expanded: boolean;
  go(phase: 'open' | 'close', now: number): void;
  advance(now: number): void;
  readonly settled: boolean;
  pose(): MenuMorphPose;
  place(button: Rect, panel: Rect): void;
}

const CONTEXT = [0.3, 0.8] as const, IMPULSE = 0.016;
export class ContextMenuMorph implements PanelMorph {
  phase: 'open' | 'close' = 'open';
  released: {value: number; velocity: number} | null = null;
  started = 0;
  expanded = true;
  private t: number | null = null;
  private readonly ch: Record<'x' | 'y' | 'w' | 'h' | 'q', Spring>;
  constructor(private source: Rect, private panel: Rect) {
    const s = this.small();
    this.ch = {x: spring(s.x + s.w / 2), y: spring(s.y + s.h / 2), w: spring(s.w), h: spring(s.h), q: spring(0)};
  }
  private small(): Rect { const {x, y, w, h} = this.source; return {x: x + w * .3, y: y + h * .3, w: w * .4, h: h * .4}; }
  place(source: Rect, panel: Rect) { this.source = source; this.panel = panel; this.retarget(false); }
  private retarget(kick: boolean) {
    const open = this.phase === 'open', r = open ? this.panel : this.small(), [rs, d] = CONTEXT;
    to(this.ch.x, r.x + r.w / 2, rs, d); to(this.ch.y, r.y + r.h / 2, rs, d); to(this.ch.w, r.w, rs, d); to(this.ch.h, r.h, rs, d);
    const q = this.ch.q, target = open ? 1 : 0, w = 2 * Math.PI / rs;
    if (kick) q.velocity += IMPULSE * w * w * (target - q.value);
    to(q, target, rs, d);
  }
  go(phase: 'open' | 'close', now: number) {
    this.advance(now);
    this.released = null;
    this.phase = phase; this.started = now;
    this.retarget(true);
  }
  advance(now: number) {
    if (this.t === null) { this.t = now; return; }
    for (const s of Object.values(this.ch)) step(s, now - this.t);
    this.t = now;
  }
  get settled() {
    const done = Object.entries(this.ch).every(([k, s]) => { const tol = k === 'q' ? 1 / 512 : .05; return Math.abs(s.target - s.value) < tol && Math.abs(s.velocity) < 10 * tol; });
    if (done) for (const s of Object.values(this.ch)) Object.assign(s, {value: s.target, velocity: 0});
    return done;
  }
  pose(): MenuMorphPose {
    const {ch, panel: P} = this, w = ch.w.value, h = ch.h.value, s = w / P.w, cx = ch.x.value, cy = ch.y.value, q = ch.q.value;
    const root = this.phase === 'open' ? clamp01(q) : .02 + .98 * clamp01(q);
    return {
      panel: {x: cx - w / 2, y: cy - h / 2, w, h, radius: Math.min(32 * s, h / 2)},
      source: {x: cx, y: cy, w: 0, h: 0, radius: 0},
      q, union: 0, scale: s, height: h / s, expanded: true, rows: clamp01(q), label: 0,
      copies: [0, root], generations: [1, 0], host: 1,
      lens: {scale: 1, blur: 0, amount: -0.001, height: 0},
    };
  }
}
