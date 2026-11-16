import type {Platform} from './types.ts';
export type * from './types.ts';
export {IOS26_5, IOS26_5_TINTED} from './ios26_5.ts';

type DeepPatch<T> = T extends readonly unknown[] ? T : T extends (...a: never[]) => unknown ? T : T extends RegExp | ReadonlySet<unknown> ? T
  : T extends object ? {[K in keyof T]?: DeepPatch<T[K]>} : T;

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/** Another platform from `base`: `patch` replaces the numbers it names (a deep merge), `build` names the result. */
export function derivePlatform(base: Platform, patch: DeepPatch<Platform> & {build: string}): Platform {
  const merge = (a: unknown, b: unknown): unknown => {
    if (!plain(a) || !plain(b)) return b === undefined ? a : b;
    const out: Record<string, unknown> = {...a};
    for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
    return out;
  };
  return merge(base, patch) as Platform;
}
