import type {Inputs} from '../platform/types.ts';

const STEP = 1 / 300, HALF = 1 / 600, MAX_STIFFNESS = 44999.99999999999;
export type SpringSettings = {response: number; dampingFraction: number; blendDuration: number};
export const DEFAULT_SPRING: SpringSettings = Object.freeze({response: 0.5, dampingFraction: 1, blendDuration: 0});
export function springCoefficients(s: SpringSettings = DEFAULT_SPRING) {
  const w = Math.PI * 2 / Math.max(Number.MIN_VALUE, s.response), stiffness = Math.min(w * w, MAX_STIFFNESS);
  return {stiffness, damping: -2 * s.dampingFraction * Math.sqrt(stiffness)};
}


export type FluidSpring = {offset: number[]; velocity: number[]; force: number[]; time: number; target: number[]; settings: SpringSettings};
export const fluidSpring = (value: readonly number[], target: readonly number[] = value, settings: SpringSettings = DEFAULT_SPRING): FluidSpring =>
  ({offset: [...value], velocity: value.map(() => 0), force: value.map(() => 0), time: 0, target: [...target], settings: {...settings}});
export function advanceFluid(s: FluidSpring, time: number): FluidSpring {
  if (time <= s.time) return s;
  let {offset, velocity, force, time: t} = s;
  const {stiffness, damping} = springCoefficients(s.settings);
  while (t < time) {
    const half = velocity.map((v, i) => v + force[i] * HALF);
    offset = offset.map((v, i) => v + half[i] * STEP);
    force = offset.map((v, i) => damping * half[i] + stiffness * (s.target[i] - v));
    velocity = half.map((v, i) => v + force[i] * HALF);
    t += STEP;
  }
  return {...s, offset, velocity, force, time: t};
}
export function retargetFluid(s: FluidSpring, target: readonly number[], at: number, settings: SpringSettings = s.settings): FluidSpring {
  return {...s, offset: [...advanceFluid(s, at).offset], velocity: [...s.velocity], force: [...s.force], time: at, target: [...target], settings: {...settings}};
}


const f = Math.fround, EPSILON = 2 ** -26;
export const COMPOSITE_EPSILON = EPSILON;
type Lanes = number[];
const sparse = (v: number) => Math.abs(v) < EPSILON ? 0 : v;
const add = (a: Lanes, b: Lanes) => [f(a[0] + b[0]), a[1] + b[1], a[2] + b[2], ...(a.length === 5 ? [sparse(a[3] + b[3]), sparse(a[4] + b[4])] : [])];
const sub = (a: Lanes, b: Lanes) => [f(a[0] - b[0]), a[1] - b[1], a[2] - b[2], ...(a.length === 5 ? [sparse(a[3] - b[3]), sparse(a[4] - b[4])] : [])];
const scale = (a: Lanes, k: number) => [a.length === 5 && k === 0 ? 0 : f(a[0] * f(k)), a[1] * k, a[2] * k, ...(a.length === 5 ? [sparse(a[3] * k), sparse(a[4] * k)] : [])];
const norm = (a: Lanes) => { let r = f(a[0] * a[0]); if (a.length === 5) { r += a[3] * a[3]; r += a[4] * a[4]; } return r + (a[1] * a[1] + a[2] * a[2]); };

export const compositeDelta = (luminance: number, weights: readonly number[]) => [f(luminance), 0, 0, ...weights.map(sparse)];
export const luminanceDelta = (luminance: number) => [f(luminance), 0, 0];
export type MaterialSpring = {offset: Lanes; velocity: Lanes; force: Lanes; target: Lanes; time: number; settings: SpringSettings};
export const materialSpring = (target: Lanes, settings: SpringSettings = DEFAULT_SPRING): MaterialSpring =>
  ({offset: target.map(() => 0), velocity: target.map(() => 0), force: target.map(() => 0), target: [...target], time: 0, settings: {...settings}});
export function advanceMaterial(s: MaterialSpring, time: number): MaterialSpring {
  if (!Number.isFinite(time)) throw new Error('Invalid material sample time');
  const {stiffness, damping} = springCoefficients(s.settings);
  let {offset, velocity, force, time: t} = s;
  if (time - t > 1) t = time - 1 / 60;
  while (t < time) {
    const half = add(velocity, scale(force, HALF));
    offset = add(offset, scale(half, STEP));
    force = add(scale(half, damping), scale(sub(s.target, offset), stiffness));
    velocity = add(half, scale(force, HALF));
    t += STEP;
  }
  return {...s, offset, velocity, force, time: t, target: [...s.target]};
}
export function materialFinished(s: MaterialSpring) {
  if (Math.max(norm(s.velocity), norm(s.force)) > 0.0036) return false;
  const limit = norm(scale(s.target, 0.01));
  return limit <= 0 || norm(sub(s.target, s.offset)) <= limit;
}
export function retargetMaterial(s: MaterialSpring, target: Lanes, time: number): MaterialSpring {
  const at = advanceMaterial(s, time);
  return {...s, offset: [...(materialFinished(at) ? s.target : at.offset)], target: [...target], time};
}


const TOLERANCE = 1 / 4096;
const isColour = (v: unknown): v is {components: number[]} => !!v && typeof v === 'object' && Array.isArray((v as {components?: unknown}).components) && (v as {components: number[]}).components.length === 4;
function lanesOf(inputs: Inputs) {
  const keys: string[] = [], values: number[] = [];
  for (const [k, v] of Object.entries(inputs)) {
    if (typeof v === 'number' && Number.isFinite(v)) { keys.push(k); values.push(v); }
    else if (isColour(v)) { const [r, g, b, a] = v.components; keys.push(k); values.push(r * a, g * a, b * a, a); }
  }
  return {keys: keys.join(','), values};
}
export function outputSpring() {
  let state: FluidSpring | null = null, epoch = 0, keys: string | null = null, target: number[] | null = null, presented: number[] | null = null, now = 0;
  return {
    response: DEFAULT_SPRING.response,
    advance(ms: number) {
      now = ms;
      if (state) {
        state = advanceFluid(state, (ms - epoch) / 1000);
        presented = state.offset;
        if (presented.every((v, i) => Math.abs(v - target![i]) < TOLERANCE) && state.velocity.every((v) => Math.abs(v) < TOLERANCE * 10)) { presented = target; state = null; }
      }
      return state !== null;
    },
    get key() { return state ? `out ${now}` : `out ${target ? target.join(' ') : ''}`; },
    apply(inputs: Inputs): Inputs {
      const l = lanesOf(inputs);
      if (keys !== l.keys) { keys = l.keys; target = l.values; presented = l.values; state = null; }
      else if (l.values.some((v, i) => v !== target![i])) {
        target = l.values;
        const settings = {...DEFAULT_SPRING, response: this.response};
        if (state) state = retargetFluid(state, target, (now - epoch) / 1000, settings);
        else { epoch = now; state = fluidSpring(presented!, target, settings); }
        presented = state.offset;
      }
      if (presented === target) return inputs;
      const out: Inputs = {...inputs};
      let i = 0;
      for (const [k, v] of Object.entries(inputs)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = presented![i++];
        else if (isColour(v)) {
          const [r, g, b, a] = presented!.slice(i, i + 4); i += 4;
          out[k] = {...v, components: a > 0 ? [r / a, g / a, b / a, a] : [...v.components.slice(0, 3), 0]} as Inputs[string];
        }
      }
      return out;
    },
  };
}
