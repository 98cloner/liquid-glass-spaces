import {lumaNotification} from './luma.ts';
import {advanceMaterial, compositeDelta, COMPOSITE_EPSILON, materialFinished, materialSpring, retargetMaterial, type MaterialSpring} from '../motion/spring.ts';

type Scheme = 'light' | 'dark';
const f = Math.fround;
const RANGES: Record<Scheme, [number, number]> = {light: [f(0.2), 0.5], dark: [f(0.6), f(0.9)]};
const weightsOf = (s: Scheme) => s === 'light' ? [1, 0] : [0, 1];
const round32 = (v: number) => { const x = f(f(v) * 32), m = Math.floor(Math.abs(x) + 0.5); return f((x < 0 || Object.is(x, -0) ? -m : m) * f(1 / 32)); };

export function createAppearance(system: () => Scheme) {
  let sys: Scheme | null = null, scheme: Scheme | null = null, luminance: number | null = null, target: number | null = null, lastID = 0;
  let spring: MaterialSpring | null = null, base = 0, epoch: number | null = null, pending = false, lastFrame: number | null = null;
  let weights = [1, 0], baseWeights = [1, 0], targetWeights = [1, 0], sourceEpoch: number | null = null, nextSource = 0, systemEpoch = 0;
  const sync = () => {
    const next = system();
    if (next !== sys) { sys = next; systemEpoch++; scheme = next; luminance = target = null; spring = null; epoch = null; pending = false; weights = weightsOf(next); baseWeights = [...weights]; targetWeights = [...weights]; }
  };
  const snapshot = () => ({colorScheme: scheme!, luminance, targetLuminance: target, systemColorScheme: sys!, systemAppearanceEpoch: systemEpoch, animationActive: pending || spring !== null,
    materialComposite: weights.flatMap((w, i) => Math.abs(w) < COMPOSITE_EPSILON ? [] : [{colorScheme: (i ? 'dark' : 'light') as Scheme, weight: w}]), targetComposite: weightsOf(scheme!)});
  return {
    beginFeedbackSource() { sync(); sourceEpoch = ++nextSource; lastID = 0; return sourceEpoch; },
    snapshot() { sync(); return snapshot(); },
    advance(ms: number) {
      sync();
      if (!Number.isFinite(ms) || (lastFrame !== null && ms < lastFrame)) throw new TypeError('monotonic material frame time required');
      lastFrame = ms;
      if (pending) {
        const delta = () => compositeDelta(f(target! - base), targetWeights.map((w, i) => w - baseWeights[i]));
        if (spring) spring = retargetMaterial(spring, delta(), (ms - epoch!) / 1000);
        else { base = luminance!; baseWeights = [...weights]; epoch = ms; spring = materialSpring(delta()); }
        pending = false;
      }
      if (spring) {
        spring = advanceMaterial(spring, (ms - epoch!) / 1000);
        luminance = f(base + spring.offset[0]);
        weights = baseWeights.map((w, i) => w + spring!.offset[3 + i]);
        if (materialFinished(spring)) { luminance = target; weights = [...targetWeights]; spring = null; epoch = null; }
      }
      return snapshot();
    },
    accept(feedback: {sum: ArrayLike<number>; generation: {feedbackID: number; backgroundColorScheme: Scheme; materialAppearanceEpoch: number}}, source: number | null = null,
      {filteredLuminance, admitLuma = true}: {filteredLuminance?: number; admitLuma?: boolean} = {}) {
      sync();
      const g = feedback.generation;
      if (sourceEpoch !== null && (source !== sourceEpoch || g.backgroundColorScheme !== sys || g.materialAppearanceEpoch !== systemEpoch)) return false;
      if (!Number.isSafeInteger(g.feedbackID) || g.feedbackID <= lastID) return false;
      const notification = lumaNotification(feedback.sum, 1);
      if (!Number.isFinite(notification) || notification < 0) return false;
      if (!admitLuma) { lastID = g.feedbackID; return true; }
      if (filteredLuminance !== undefined && !Number.isFinite(filteredLuminance)) throw new TypeError('finite filtered luma required');
      lastID = g.feedbackID;
      let value: number, writes: boolean;
      if (filteredLuminance === undefined) { const r = round32(notification), prev = target ?? NaN; writes = prev !== r; value = writes ? r : prev; }
      else { value = f(filteredLuminance); writes = target !== value; }
      const before = scheme, [lo, hi] = RANGES[sys!], L = f(value);
      if (L < lo) scheme = 'dark'; else if (L > hi) scheme = 'light';
      target = value; targetWeights = weightsOf(scheme!);
      if (luminance === null) { luminance = target; weights = [...targetWeights]; baseWeights = [...weights]; }
      else if (writes || scheme !== before) pending = true;
      return true;
    },
  };
}
