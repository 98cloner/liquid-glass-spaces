
export type Scheme = 'light' | 'dark';
export type ByScheme<T> = T | {light: T; dark: T};
export type RGBA = readonly [number, number, number, number];

export type Size = {times: number; of?: 'largest' | 'min'; min?: number; max?: number};
export type Range = {at: readonly [number, number]; from: ByScheme<number>; to: ByScheme<number>; reverse?: boolean; extension?: {width: number; target: number}};
export type Px = {px: number; plus?: number};
export type Value = ByScheme<number | Size | Range | Px>;
export type Colour = ByScheme<RGBA | null>;

export type RecipeSpec = {
  shadow: {offset: readonly [Value, Value]; amount: Value; height: Value; distanceOffset: Value; blurRadius: Value; radius: Value;
    black: Value; white: Value; saturation: Value; fill: Colour; opacity: Value; vibrancy: Value};
  blur: {radius: Value; distances: readonly [Value, Value, Value, Value, Value]; weights: readonly [Value, Value, Value, Value, Value]; opacity: Value};
  refraction: {innerHeight: Value; innerAmount: Value; outerHeight: Value; outerAmount: Value; distance0: Value; distance1: Value; opacity: Value};
  face: {opacity: Value; black: Value; white: Value; saturation: Value; fill: Colour};
  bleed: {amount: Value; height: Value; blurRadius: Value; opacity: Value; distance0: Value; distance1: Value; black: Value; white: Value; saturation: Value;
    fill: Colour; darken: ByScheme<boolean>};
  sdr: {maxHeadroom: Value; shadowOpacity: Value; holdingWhite: Value; gradient0: Value; gradient1: Value};
};

export type LuminanceSpec = {
  below: number;
  absent: ByScheme<number>;
  faceFillAlpha: ByScheme<Range>;
  faceBlack: {min: number; offset: number};
  faceWhite: {max: ByScheme<number>; offset: number};
  shadowFillAlpha: ByScheme<Range>;
  tracksUpTo: number;
  outputSpring: {own: number; pocket: number};
};

type Patch<T> = {[K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? Patch<T[K]> | T[K] : T[K]};

export type Inputs = Record<string, number | boolean | string | {width: number; height: number} | {colorSpace: string; components: number[]} | null>;
export type VariantContext = {width: number; height: number; scheme: Scheme; lens: LensState | null};
export type LensState = {h: number; tint: string; shadow?: readonly number[] | null; large?: boolean; q?: number};
export type VariantSpec = {
  inputs: (inputs: Inputs, c: VariantContext) => Inputs;
  rangeUpper?: number;
  margin?: number | ((c: VariantContext) => number | null);
  progress?: (c: VariantContext) => number | null;
};

export type PerScheme<T> = {light: T; dark: T};
export type Matrix = readonly number[];

export type LabelLevel = 'label' | 'secondary-label' | 'tertiary-label' | 'quaternary-label' | 'quinary-label';
export type SystemColor = 'red' | 'orange' | 'yellow' | 'green' | 'mint' | 'teal' | 'cyan' | 'blue' | 'indigo' | 'purple' | 'pink' | 'brown' | 'gray';
export type PaletteSpec = {
  labels: Record<LabelLevel, PerScheme<number>>;
  systemColors: Record<SystemColor, PerScheme<readonly [number, number, number]>>;
  colourVibrancy: {diagonal: number; shift: PerScheme<number>};
  vibrancy: {'menu-highlight': PerScheme<Matrix>; 'tab-label': PerScheme<Matrix>; 'alert-preferred': PerScheme<Matrix>; 'notification-date': Matrix; 'popover-shadow': Matrix};
  menu: {label: PerScheme<string>; header: PerScheme<string>; separator: PerScheme<string>; indicator: PerScheme<string>};
  tint: PerScheme<{saturation: number; lightness: number; black: number; white: number}> & {grey: {black: number; white: number}; luma: readonly [number, number, number]};
  disabled: {tint: readonly [number, number, number]; alpha: PerScheme<number>; labelOpacity: number; barAlpha: PerScheme<number>};
};

export type RimLight = {height: number; spread: number; curvature: number; amount: number; extra: number; opacity: number; controls: readonly [number, number, number]; fill: RGBA | null};
export type HighlightSpec = {
  rim: PerScheme<{key: RimLight; fill: RimLight}>;
  angles: {key: number; fill: number};
  text: {face: {matrix: Matrix}; rim: {matrix: Matrix; height: number; spread: number; amount: number; curvature: number; angles: {key: number; fill: number}}};
};

export type Lerp = number | readonly [number, number];
export type FlexBehavior = {trackingResponse: Lerp; trackingDamping: Lerp; releaseResponse: Lerp; releaseDamping: Lerp};
export type FlexSpec = {
  regular: {edges: readonly [number, number]; ultraSmall: number; lift: {small: number; range: readonly [number, number]}; scaleDistance: {small: number; range: readonly [number, number]};
    movement: {points: number; min: number; max: number; normalization: number}; behavior: FlexBehavior;
    glow: {small: {big: number; little: number}; big: readonly [number, number]; little: readonly [number, number]}};
  menu: {lift: number; scaleDistance: number; movement: number; glow: {big: number; little: number}; behavior: FlexBehavior};
  lens: {edges: readonly [number, number]; movement: Lerp; movementMin: Lerp; movementMax: Lerp; normalization: Lerp; behavior: FlexBehavior};
  integrator: number;
  glow: {response: number; release: number; dissipation: {distance: number; little: number; scale: number; response: number}; releaseScale: number; scaleResponse: number;
    tracking: {first: number; response: number; smoothing: number}; side: {times: number; max: number}};
};

export type LensSpringSpec = {response: number; damping: number; impulse: number};
export type LiquidLensSpec = {
  lift: LensSpringSpec; unlift: LensSpringSpec; hang: number;
  key: Record<string, Matrix>; fill: PerScheme<Matrix>;
  inner: {opacity: number; radius: number; offset: number};
  restShadow: {opacity: number; radius: number; offset: number};
  blur: number;
  curvature: {lifted: number; rest: number};
};

export type PocketAlphas = {darkening: number; lightening: number};
export type PocketSpec = {
  levels: number; velocityGate: number;
  latch: {light: {off: number; on: number}; dark: {off: number; on: number}};
  alphas: {light: {replay: PocketAlphas; plain: PocketAlphas}; dark: {replay: PocketAlphas; plain: PocketAlphas; plainUnderLightGlass: PocketAlphas}; hard: number};
  luminance: {lightFloor: number; darkCeiling: number};
  springs: {alpha: number; visibility: number};
  interval: number;
};

export type DiffusionSpec = {increased: boolean; face: {black: ByScheme<number>; white: ByScheme<number>; saturation: ByScheme<number>; fillAlpha: ByScheme<number>}};

export type Platform = {
  build: string;
  recipe: RecipeSpec;
  luminance: LuminanceSpec;
  frost: Record<1 | 2, {recipe?: Patch<RecipeSpec>; luminance?: Patch<LuminanceSpec>}>;
  diffusion: DiffusionSpec;
  ovalization: number;
  variants: Record<string, VariantSpec>;
  toward: {one: RegExp; maxHeadroom: number; split: Record<string, ReadonlySet<string>>};
  palette: PaletteSpec;
  highlight: HighlightSpec;
  flex: FlexSpec;
  lens: LiquidLensSpec;
  pocket: PocketSpec;
};
