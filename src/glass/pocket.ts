
import type {Platform} from './platform/types.ts';
import {IOS26_5} from './platform/ios26_5.ts';
import {materialSpring as createMaterialSpring, advanceMaterial as advanceMaterialSpring, retargetMaterial, materialFinished, luminanceDelta} from './motion/spring.ts';

export const quantizeLuma = (v: number, p: Platform = IOS26_5) => Math.min(p.pocket.levels - 1, Math.trunc(p.pocket.levels * Math.max(0, Math.min(1, v)))) / (p.pocket.levels - 1);

export interface PocketState { replay: boolean }


export function pocketLumaStyle(trait: 'light' | 'dark', glass: 'light' | 'dark', luma: number, state: PocketState, velocity = 0, reference: number = trait === 'light' ? 1 : 0, p: Platform = IOS26_5) {
  let replay = state.replay;
  if (replay || velocity < p.pocket.velocityGate) {
    const C = reference, {light, dark} = p.pocket.latch;
    if (trait === 'light') { if (replay && luma < light.off * C) replay = false; else if (!replay && luma > light.on * C) replay = true; }
    else { if (replay && luma > C + dark.off * (1 - C)) replay = false; else if (!replay && luma < C + dark.on * (1 - C)) replay = true; }
  }
  state.replay = replay;
  return {replay, ...styleAlphas(trait, glass, replay, p)};
}
function styleAlphas(trait: 'light' | 'dark', glass: 'light' | 'dark', replay: boolean, p: Platform) {
  const A = p.pocket.alphas;
  return trait === 'light' ? (replay ? A.light.replay : A.light.plain) : replay ? A.dark.replay : glass === 'light' ? A.dark.plainUnderLightGlass : A.dark.plain;
}

export function pocketAlphas(style: 'soft' | 'hard' | 'hidden', trait: 'light' | 'dark', glass: 'light' | 'dark', replay: boolean, p: Platform = IOS26_5) {
  if (style === 'hard') return {replay: p.pocket.alphas.hard, black: 0};
  const s = styleAlphas(trait, glass, replay, p);
  return trait === 'light' ? {replay: s.lightening, black: s.darkening} : {replay: s.darkening, black: 0};
}

export function pocketLuminance(glass: 'light' | 'dark', luma: number, darkening: number, p: Platform = IOS26_5) {
  const L = Math.fround(luma), B = p.pocket.luminance;
  return quantizeLuma(Math.fround(glass === 'light' ? Math.max(B.lightFloor, L + (1 - L) * darkening) : Math.min(B.darkCeiling, L)), p);
}

export function pocketOf(el: HTMLElement): {host: HTMLElement; edge: 'top' | 'bottom'; hardBottom?: number} | null {
  const bars = el.closest<HTMLElement>('[data-lg-bars]');
  let host: HTMLElement | null = null;
  if (bars) host = bars.dataset.lgBars ? document.querySelector<HTMLElement>(`[data-lg-pocket-id="${CSS.escape(bars.dataset.lgBars)}"]`) : null;
  else {
    host = el.closest<HTMLElement>('[data-lg-pocket]');
    const scroll = el.closest('[data-lg-scroll]');
    if (host && scroll && host.contains(scroll)) host = null;
  }
  const edge = el.closest<HTMLElement>('[data-lg-edge]'), hard = Number(edge?.dataset.lgHardBottom);
  return host ? {host, edge: edge?.dataset.lgEdge === 'top' ? 'top' : 'bottom', ...(hard > 0 ? {hardBottom: hard} : {})} : null;
}

export function edgePocketsOf(el: HTMLElement): {host: HTMLElement; edge: 'top' | 'bottom'}[] | null {
  const e = el.closest<HTMLElement>('[data-lg-edge-pockets]');
  if (!e) return null;
  const edge = el.closest<HTMLElement>('[data-lg-edge]')?.dataset.lgEdge === 'top' ? 'top' as const : 'bottom' as const;
  return (e.dataset.lgEdgePockets ?? '').split(' ').filter(Boolean).flatMap((id) => {
    const host = document.querySelector<HTMLElement>(`[data-lg-pocket-id="${CSS.escape(id)}"]`);
    return host ? [{host, edge}] : [];
  });
}

export function pocketFloatingStyle(trait: 'light' | 'dark', visible: boolean, darkening: number): 'light' | 'dark' {
  return trait === 'dark' || visible && darkening > 0 ? 'dark' : 'light';
}

export function pocketMaterial() {
  let value: [number, number] | null = null, target: [number, number] | null = null, pending: [number, number] | null = null;
  let base: [number, number] = [0, 0], epoch = 0, spring: ReturnType<typeof createMaterialSpring> | null = null;
  const delta = (t: [number, number]) => luminanceDelta(Math.fround(t[0] - base[0]));
  return {
    retarget(t: [number, number]) { if (!target || t[0] !== target[0] || t[1] !== target[1]) pending = t; },
    advance(now: number) {
      if (pending) {
        const t = pending;
        pending = null;
        if (!value) value = [t[0], t[1]];
        else {
          value = [value[0], t[1]];
          if (spring) spring = retargetMaterial(spring, delta(t), (now - epoch) / 1000);
          else if (t[0] !== value[0]) { base = [value[0], 0]; epoch = now; spring = createMaterialSpring(delta(t)); }
        }
        target = t;
      }
      if (spring && target) {
        const sp = advanceMaterialSpring(spring, (now - epoch) / 1000);
        spring = sp;
        value = [Math.fround(base[0] + sp.offset[0]), target[1]];
        if (materialFinished(sp)) { value = [target[0], target[1]]; spring = null; }
      }
      return {luminance: value?.[0] ?? null, target: target?.[0] ?? value?.[0] ?? null, fill: value?.[1] ?? 0, moving: !!spring || !!pending};
    },
  };
}

export function criticalSpring(response: number, value = 0) {
  const w = 2 * Math.PI / response;
  let x0 = value, v0 = 0, target = value, t0 = 0;
  const sample = (now: number) => {
    const t = Math.max(0, (now - t0) / 1000), d = x0 - target, c = v0 + w * d, e = Math.exp(-w * t);
    const x = target + (d + c * t) * e, v = (v0 - w * c * t) * e;
    const settled = Math.abs(x - target) < 1e-4 && Math.abs(v) < 1e-3;
    return {value: settled ? target : x, velocity: settled ? 0 : v, settled};
  };
  return {
    sample,
    get target() { return target; },
    retarget(next: number, now: number) { if (next === target) return; const q = sample(now); x0 = q.value; v0 = q.velocity; target = next; t0 = now; },
    set(next: number, now: number) { x0 = target = next; v0 = 0; t0 = now; },
  };
}

