
import {IOS26_5} from '../platform/ios26_5.ts';

const lerp = (p, a, b) => (1 - p) * a + p * b;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const by = (v, t) => typeof v === 'number' ? v : lerp(t, v[0], v[1]);
const behavior = (b, t) => ({trackingResponse: by(b.trackingResponse, t), trackingDamping: by(b.trackingDamping, t), releaseResponse: by(b.releaseResponse, t), releaseDamping: by(b.releaseDamping, t)});

function specification([w, h], variant, F) {
  const R = F.regular, long = Math.max(w, h), small = long < R.ultraSmall, edge = (v, [a, b]) => clamp01((v - a) / (b - a)), p = edge(Math.min(w, h), R.edges);
  if (variant === 'lens') {
    const L = F.lens, t = edge(Math.min(w, h), L.edges);
    return {long, lift: 0, scaleDistance: 0, movement: by(L.movement, t), movementMin: by(L.movementMin, t), movementMax: by(L.movementMax, t), normalization: by(L.normalization, t), glow: {big: 0, little: 0},
      behavior: behavior(L.behavior, t)};
  }
  const movement = {movementMin: R.movement.min, movementMax: R.movement.max, normalization: R.movement.normalization};
  if (variant === 'menu') { const M = F.menu; return {long, lift: M.lift, scaleDistance: M.scaleDistance, movement: M.movement, ...movement, glow: M.glow, behavior: behavior(M.behavior, 0)}; }
  return {
    long, lift: small ? R.lift.small : lerp(p, ...R.lift.range), scaleDistance: small ? R.scaleDistance.small : lerp(p, ...R.scaleDistance.range), movement: R.movement.points, ...movement,
    behavior: behavior(R.behavior, small ? 0 : edge(long, R.edges)),
  };
}

const ema = (was, v, k) => (was ? v.map((x, i) => x * k + was[i] * (1 - k)) : v);

function softLimit(v, lower, upper) {
  const extension = (upper - lower) / 3;
  if (v < lower) { const edge = lower - extension, width = lower - edge; return edge + width * (Math.tanh(((v - edge) / width) * 0.55 - 0.55) + 1); }
  if (v > upper) { const width = upper + extension - upper; return upper + width * Math.tanh(((v - upper) / width) * 0.55); }
  return v;
}
const movementRange = (d, points, min, max) => [Math.max(min, (d - points) / d), Math.min((d + points) / d, max)];

function step(s, dt) {
  if (dt <= 0 || (s.value === s.target && s.velocity === 0)) return;
  const omega = (2 * Math.PI) / s.response, a = omega * s.damping, u = s.value - s.target, e = Math.exp(-a * dt);
  if (s.damping >= 1) {
    const r = Math.sqrt(Math.max(0, a * a - omega * omega));
    if (r < 1e-9) { const c = s.velocity + a * u; s.value = s.target + (u + c * dt) * e; s.velocity = (s.velocity - a * c * dt) * e; }
    else { const r1 = -a + r, r2 = -a - r, c2 = (s.velocity - r1 * u) / (r2 - r1), c1 = u - c2; s.value = s.target + c1 * Math.exp(r1 * dt) + c2 * Math.exp(r2 * dt); s.velocity = c1 * r1 * Math.exp(r1 * dt) + c2 * r2 * Math.exp(r2 * dt); }
  } else {
    const b = Math.sqrt(omega * omega - a * a), sin = Math.sin(dt * b), cos = Math.cos(dt * b), v = (s.velocity + a * u) / b, f = cos * u + sin * v;
    s.value = s.target + e * f;
    s.velocity = e * (b * (cos * v) - b * (u * sin)) - e * (f * a);
  }
  const d = s.target - s.value, w = s.velocity * ((2 * s.damping) / omega);
  if (d * d + w * w <= 1e-6) { s.value = s.target; s.velocity = 0; }
}

function critical(s, dt) {
  if (dt <= 0 || (s.value === s.target && s.velocity === 0)) return;
  const a = (2 * Math.PI) / s.response, u = s.value - s.target, c = s.velocity + a * u, e = Math.exp(-a * dt);
  s.value = s.target + (u + c * dt) * e;
  s.velocity = (s.velocity - a * c * dt) * e;
  const d = s.target - s.value, w = s.velocity * (2 / a);
  if (d * d + w * w <= 1e-6) { s.value = s.target; s.velocity = 0; }
}
const scalar = (value, response = 0.1) => ({value, velocity: 0, target: value, response});

function glowPointStep(g, dt, T) {
  const d = g.driver;
  if (!d || dt <= 0) return;
  const r = {value: d.response, velocity: d.responseVelocity, target: T.response, response: T.smoothing};
  critical(r, dt);
  d.response = r.value;
  d.responseVelocity = r.velocity;
  const a = (2 * Math.PI) / Math.max(d.response, T.response), e = Math.exp(-a * dt);
  g.point = g.point.map((v, i) => {
    const u = v - g.target[i], b = d.velocity[i] + a * u;
    d.velocity[i] = (b - a * (u + b * dt)) * e;
    return g.target[i] + (u + b * dt) * e;
  });
  const weight = (2 * T.response) / (2 * Math.PI), pixel = (1 / g.deviceScale) ** 2;
  if (g.point.every((v, i) => (g.target[i] - v) ** 2 + (d.velocity[i] * weight) ** 2 <= pixel)) { g.point = [...g.target]; g.driver = null; }
}
const retarget = (s, target, response) => Object.assign(s, {target, response});

function glowOpacity([w, h], R) {
  if (Math.max(w, h) < R.ultraSmall) return {...R.glow.small};
  const t = clamp01((Math.min(w, h) - R.edges[0]) / (R.edges[1] - R.edges[0]));
  return {big: lerp(t, ...R.glow.big), little: lerp(t, ...R.glow.little)};
}

export class Flex {
  /** @param {number[]} size @param {number} [deviceScale] @param {'menu' | 'lens'} [variant] @param {import('../platform/types.ts').Platform} [platform] */
  constructor(size, deviceScale = 3, variant = undefined, platform = IOS26_5) {
    this.size = size;
    this.deviceScale = deviceScale;
    this.variant = variant;
    this.F = platform.flex;
    this.spec = specification(size, variant, this.F);
    this.glow = null;
    this.active = false;
    this.channels = [1, 1, 0, 0].map((value) => ({value, velocity: 0, target: value, response: 1, damping: 1}));
    this.time = null;
    this.translation = [0, 0];
  }

  resize(size) {
    if (size[0] === this.size[0] && size[1] === this.size[1]) return;
    this.size = size;
    this.spec = specification(size, this.variant, this.F);
  }

  get idle() { return !this.active && this.channels.every((c) => c.value === c.target && c.velocity === 0); }
  get settled() {
    const glow = this.glow;
    return this.channels.every((c) => c.value === c.target && c.velocity === 0)
      && (!glow || (!glow.driver && [glow.big, glow.little, glow.scale].every((c) => c.value === c.target && c.velocity === 0)));
  }

  down(point, seconds) {
    if (this.active) return;
    this.glowTime = seconds - 0.4 / 60.06;
    if (this.idle) this.resume = true;
    const local = this.local(point);
    this.active = true;
    this.initial = point;
    this.initialLocal = local;
    this.raw = [0, 0];
    this.internal = [0, 0];
    this.integrator = {};
    const clamped = local.map((v, i) => Math.max(0, Math.min(this.size[i], Math.floor(v)))), {big} = this.glowOpacity();
    const G = this.F.glow;
    this.glow = {big: retarget(this.glow?.big ?? scalar(0), big, G.response), little: scalar(0), scale: scalar(1, G.scaleResponse), point: clamped, target: clamped, driver: null, tracking: false, dissipated: false, deviceScale: this.deviceScale};
    retarget(this.glow.little, this.glowOpacity().little, G.response);
  }

  glowOpacity() { return this.spec.glow ?? glowOpacity(this.size, this.F.regular); }

  local(point) {
    return point.map((v, i) => (v - this.size[i] / 2 - this.translation[i]) / this.channels[i].value + this.size[i] / 2);
  }

  move(point) {
    if (!this.active) return;
    const p = this.local(point), start = this.local(this.initial), inside = p.map((v, i) => Math.max(0, Math.min(this.size[i], v))), clamped = inside.map(Math.floor);
    this.raw = p.map((v, i) => v - start[i]);
    this.internal = inside.map((v, i) => v - this.initialLocal[i]);
    const glow = this.glow, G = this.F.glow;
    if (clamped.every((v, i) => Math.abs(v - glow.target[i]) <= 1 / this.deviceScale) && !glow.driver) { glow.point = clamped; glow.target = clamped; }
    else {
      glow.target = clamped;
      glow.driver ??= {response: glow.tracking ? G.tracking.response : G.tracking.first, responseVelocity: 0, velocity: [0, 0]};
      glow.tracking = true;
    }
    if (!glow.dissipated && Math.hypot(p[0] - this.initialLocal[0], p[1] - this.initialLocal[1]) > G.dissipation.distance) {
      glow.dissipated = true;
      retarget(glow.little, this.glowOpacity().little * G.dissipation.little, G.dissipation.response);
      retarget(glow.scale, G.dissipation.scale, G.dissipation.response);
    }
  }

  up(seconds) {
    if (!this.active) return;
    const rest = this.channels.every((c) => c.value === c.target && c.velocity === 0);
    if (this.time !== null) for (const c of this.channels) step(c, seconds - this.time);
    this.time = seconds;
    const glow = this.glow;
    if (glow && this.glowTime !== undefined && seconds > this.glowTime) {
      const own = seconds - this.glowTime;
      for (const c of [glow.big, glow.little, glow.scale]) critical(c, own);
      glowPointStep(glow, own, this.F.glow.tracking);
      this.glowTime = seconds;
    }
    this.resume = this.lead = rest;
    this.active = false;
    this.retarget();
    const G = this.F.glow;
    retarget(this.glow.big, 0, G.release);
    retarget(this.glow.little, 0, G.release);
    retarget(this.glow.scale, G.releaseScale, G.scaleResponse);
  }

  sampleCenter(center, time) {
    const was = this.integrator, gap = was.last === undefined ? null : time - was.last;
    if (gap !== null && gap < 0.0001) return;
    const k = this.F.integrator, start = gap !== null && gap > 0.05 ? {} : was, position = ema(start.position, center, k);
    if (start.last === undefined) { this.integrator = {position, last: time, velocity: [0, 0], acceleration: [0, 0]}; return; }
    const velocity = ema(start.velocityFilter, position.map((v, i) => (v - start.position[i]) / gap), k);
    const acceleration = ema(start.accelerationFilter, velocity.map((v, i) => (v - start.velocity[i]) / gap), k);
    this.integrator = {position, last: time, velocity, velocityFilter: velocity, accelerationFilter: acceleration, acceleration};
  }

  targets() {
    if (!this.active) return [1, 1, 0, 0];
    const [w, h] = this.size, {long, lift, scaleDistance} = this.spec;
    let sx = (long + lift) / long, sy = sx, dx = 0, dy = 0;
    const [rx, ry] = this.raw, [ix, iy] = this.internal;
    if (scaleDistance > 0 && rx !== 0) { const a = Math.abs(ix) / (scaleDistance * 4) + (Math.abs(rx) - Math.abs(ix)) / scaleDistance; sy -= a; sx += a; dx = a * Math.sign(rx) * w; }
    if (scaleDistance > 0 && ry !== 0) { const a = Math.abs(iy) / (scaleDistance * 4) + (Math.abs(ry) - Math.abs(iy)) / scaleDistance; sx -= a; sy += a; dy = a * Math.sign(ry) * h; }
    const {movement, movementMin, movementMax, normalization} = this.spec;
    const [ax, ay] = (this.integrator.acceleration ?? [0, 0]).map((v) => v / normalization), [lx, ux] = movementRange(w, movement, movementMin, movementMax), [ly, uy] = movementRange(h, movement, movementMin, movementMax);
    if (ax !== 0) { const own = softLimit(lerp(ax, 1, ux), lx, ux); sx += own - 1; dx += (1 - own) * 0.2 * w; sy += softLimit(lerp(ax, 1, ly), ly, uy) - 1; }
    if (ay !== 0) { const own = softLimit(lerp(ay, 1, uy), ly, uy); sy += own - 1; dy += (1 - own) * 0.2 * h; sx += softLimit(lerp(ay, 1, lx), lx, ux) - 1; }
    return [sx, sy, dx, dy];
  }

  retarget() {
    const b = this.spec.behavior, response = this.active ? b.trackingResponse : b.releaseResponse, damping = this.active ? b.trackingDamping : b.releaseDamping;
    this.targets().forEach((target, i) => { const c = this.channels[i]; if (c.target !== target) Object.assign(c, {target, response, damping}); });
  }

  /** @param {number} seconds @param {number[]} center @param {number[] | null} [outer] */
  frame(seconds, center, outer = null) {
    const dt = this.resume ? 0 : this.time === null ? 0 : seconds - this.time;
    const tick = !this.resume && seconds !== this.time;
    const lead = this.lead && tick ? 0.4 / 60.06 : 0;
    if (tick) this.lead = false;
    this.resume = false;
    for (const c of this.channels) step(c, dt + lead);
    const glow = this.glow;
    if (glow) {
      const own = seconds - (this.glowTime ?? seconds);
      this.glowTime = seconds;
      for (const c of [glow.big, glow.little, glow.scale]) critical(c, own);
      glowPointStep(glow, own, this.F.glow.tracking);
    }
    this.time = seconds;
    const issued = this.issuedScale ?? [1, 1];
    if (this.active) this.sampleCenter(center.map((v, i) => v + this.translation[i] * (outer ? issued[i] * outer[i] : 1)), 1 + seconds);
    this.retarget();
    const [sx, sy, dx, dy] = this.channels.map((c) => c.value);
    this.translation = [dx, dy];
    this.issuedScale = [sx, sy];
    if (!this.shown) this.firstShown = seconds;
    const shown = glow && (glow.big.value > 0 || glow.little.value > 0) ? {first: seconds === this.firstShown, big: glow.big.value, little: glow.little.value, scale: glow.scale.value, position: glow.point, side: Math.min(Math.min(...this.size) * this.F.glow.side.times, this.F.glow.side.max)} : null;
    this.shown = !!shown;
    return {scale: [sx, sy], translation: this.translation, glow: shown};
  }
}
