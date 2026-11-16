import type {Platform, VariantContext, Inputs} from './types.ts';

const f = Math.fround;
const RIM = {
  light: {height: 1, spread: Math.PI / 2, curvature: 0.7, amount: 0.5, extra: 0, opacity: 1, controls: [0.9, 1, 1.5], fill: null},
  dark: {height: 1, spread: Math.PI / 2, curvature: 0.7, amount: 0.5, extra: 0, opacity: 1, controls: [0.06, 0.6, 1.2], fill: [0.6, 0.6, 0.6, 1]},
} as const;
const color = (c: number[]) => ({colorSpace: 'extended-sRGB', components: c});

const LENS_SHADOW: Record<string, number[]> = {light: [0.3374999463558197, 0.45749998092651367, 0.5625], dark: [0.3374999463558197, 0.46544116735458374, 0.5625],
  'light/orange': [0.5625, 0.443197637796402, 0.3374999463558197], 'dark/orange': [0.5625, 0.44402173161506653, 0.3374999463558197]};
export const LENS_RANGE_UPPER = 10.680426794936604;
function lensInputs(inputs: Inputs, {scheme, lens}: VariantContext): Inputs {
  const {h, tint, shadow = null} = lens!;
  return {...inputs,
    inputInnerRefractionAmount: -h / 2, inputInnerRefractionHeight: 0.18 * h, inputOuterRefractionAmount: 0, inputOuterRefractionHeight: 0,
    inputRefractionDistance0: -1, inputRefractionDistance1: -2 / 3, inputRefractionOpacity: 0,
    inputBlurRadius: 2, inputBlurOpacity0: 0, inputBlurOpacity1: 0.25, inputBlurOpacity2: f(0.6), inputBlurOpacity3: f(0.8), inputBlurOpacity4: 1,
    inputBlurDistance0: -10, inputBlurDistance1: 0, inputBlurDistance2: 0, inputBlurDistance3: 0, inputBlurDistance4: 0,
    inputFaceColorMatrixBlack: f(0.1), inputFaceColorMatrixWhite: 1, inputFaceColorMatrixSaturation: 1, inputFaceColorMatrixFillColor: color([1, 1, 1, 0]), inputFaceOpacity: 1,
    inputBleedAmount: 0, inputBleedBlurRadius: 0, inputBleedHeight: 0, inputBleedOpacity: 0, inputBleedDistance0: 1, inputBleedDistance1: 0,
    inputBleedColorMatrixBlack: 0, inputBleedColorMatrixWhite: 1, inputBleedColorMatrixSaturation: 1, inputBleedColorMatrixFillColor: color([0, 0, 0, 0]), inputBleedDarkenBlend: scheme === 'light',
    inputShadowAmount: h / 4, inputShadowHeight: 0, inputShadowBlurRadius: 0, inputShadowOffset: {width: 0, height: 7}, inputShadowDistanceOffset: 0,
    inputShadowOpacity: 0.17999999225139618, inputShadowRadius: 8, inputShadowVibrancyContribution: 0, inputShadowColorMatrixBlack: 0, inputShadowColorMatrixWhite: 1, inputShadowColorMatrixSaturation: 1,
    inputShadowColorMatrixFillColor: color([...(shadow ?? LENS_SHADOW[tint === 'orange' ? `${scheme}/orange` : scheme]), 1]),
    inputSDRHoldingToneEnabled: true, inputSDRHoldingToneWhite: f(0.97), inputSDRGradientDistance0: -2 / 3, inputSDRGradientDistance1: -1 / 3, inputSDRShadowOpacity: f(0.08),
    inputMaxHeadroom: 9999, inputClamp: 0, inputClampPreserveHue: false};
}

/** iOS 26.5's glass, Liquid Glass set to Clear: the default platform. */
export const IOS26_5: Platform = {
  build: '23F77',
  recipe: {
    shadow: {
      offset: [0, 8], amount: {times: 0.625, max: 75}, height: {times: 0.4}, distanceOffset: 0, blurRadius: 40, radius: 24,
      black: 0, white: {light: 1, dark: 0.5}, saturation: {light: 1.8, dark: 1}, fill: {light: [0, 0, 0, 0.12], dark: null},
      opacity: {at: [48, 160], from: 0.25, to: {light: 0.5, dark: 0.4}, reverse: true},
      vibrancy: {at: [64, 160], from: 0, to: 1},
    },
    blur: {radius: {at: [48, 160], from: 4 / 3, to: 4}, distances: [{times: -0.5, of: 'min'}, -1, 0, 0, {times: 2}], weights: [1, 0.5, 0.5, 1, 1], opacity: 1},
    refraction: {innerHeight: {times: 0.25, of: 'min', min: 0, max: 20}, innerAmount: {times: -0.8, of: 'min', min: -60, max: Infinity},
      outerHeight: {times: 0.125}, outerAmount: {times: 0.2}, distance0: -1, distance1: {px: 1, plus: -1}, opacity: 0.3},
    face: {opacity: 1, black: {light: 0.5, dark: 0.2}, white: {light: 1.03, dark: 0.6}, saturation: 1, fill: {light: [1, 1, 1, 0.4], dark: [0, 0, 0, 0.4]}},
    bleed: {amount: {times: 0.35}, height: {times: 0.35}, blurRadius: {times: 0.7, max: 160}, opacity: {at: [64, 160], from: 0, to: {light: 0.5, dark: 0.8}},
      distance0: 1, distance1: 0, black: {light: 0.9, dark: 0}, white: {light: 1, dark: 0.5}, saturation: {light: 1.2, dark: 1}, fill: null, darken: {light: true, dark: false}},
    sdr: {maxHeadroom: 9999, shadowOpacity: {at: [48, 160], from: 0.08, to: 0.24}, holdingWhite: 0.97, gradient0: {px: -2}, gradient1: {px: -1}},
  },
  luminance: {
    below: 64, absent: {light: 1, dark: 0},
    faceFillAlpha: {light: {at: [0.3, 1], from: 0.25, to: 0.6, reverse: true}, dark: {at: [0, 0.7], from: 0.25, to: 0.5}},
    faceBlack: {min: 0.1, offset: -0.15}, faceWhite: {max: {light: 1.03, dark: 0.9}, offset: 0.45},
    shadowFillAlpha: {at: [0.4, 0.95], from: 0.18, to: 0.3, reverse: true, extension: {target: 0.05, width: 0.01}},
    tracksUpTo: 64, outputSpring: {own: 0.5, pocket: 0.6},
  },
  frost: {
    1: {recipe: {blur: {radius: {at: [48, 160], from: 2 / 3, to: 2 / 3}}, face: {saturation: {light: 1.1, dark: 1.3}, fill: {light: [1, 1, 1, 0], dark: [0, 0, 0, 0]}}},
      luminance: {faceFillAlpha: {light: {at: [0.3, 1], from: 0, to: 0, reverse: true}, dark: {at: [0, 0.7], from: 0, to: 0}}, faceBlack: {min: 0.1, offset: -0.2}}},
    2: {recipe: {blur: {radius: {at: [48, 160], from: 0, to: 0}}, face: {saturation: {light: 1.1, dark: 1.3}, fill: {light: [1, 1, 1, 0], dark: [0, 0, 0, 0]}}},
      luminance: {faceFillAlpha: {light: {at: [0.3, 1], from: 0, to: 0, reverse: true}, dark: {at: [0, 0.7], from: 0, to: 0}}, faceBlack: {min: 0.1, offset: -0.2}}},
  },
  diffusion: {increased: false,
    face: {black: {light: 0.25, dark: 0.2}, white: {light: 1.03, dark: 0.75}, saturation: 2, fillAlpha: {light: 0.8, dark: 0.6}}},
  ovalization: 0.5,
  variants: {
    clear: {rangeUpper: 1, margin: 0, inputs: (inputs, {width, height}) => {
      const m = Math.min(width, height);
      return {...inputs,
        inputBleedAmount: 0, inputBleedHeight: 0, inputBleedBlurRadius: 0, inputBleedOpacity: 0,
        inputBleedColorMatrixBlack: f(0.75), inputBleedColorMatrixWhite: 1, inputBleedColorMatrixSaturation: f(1.2), inputBleedDarkenBlend: true,
        inputBlurDistance4: 0, inputBlurRadius: 1,
        inputClamp: f(1.375824),
        inputFaceColorMatrixBlack: f(0.075), inputFaceColorMatrixWhite: f(1.15), inputFaceColorMatrixSaturation: f(1.06),
        inputFaceColorMatrixFillColor: color([1, 1, 1, 0]),
        inputInnerRefractionAmount: Math.max(-m, -60), inputInnerRefractionHeight: Math.min((m * 36) / 100, 20),
        inputRefractionOpacity: 0,
        inputShadowColorMatrixBlack: 0, inputShadowColorMatrixWhite: 1, inputShadowColorMatrixSaturation: f(1.2),
        inputShadowColorMatrixFillColor: color([0, 0, 0, f(0.1)]),
        inputShadowOpacity: 0, inputShadowRadius: 0, inputShadowBlurRadius: 0, inputShadowVibrancyContribution: 0,
      };
    }},
    sheet: {inputs: (inputs) => ({...inputs, inputBleedAmount: 0, inputBleedHeight: 0, inputBleedBlurRadius: 0, inputBleedOpacity: 0,
      inputOuterRefractionAmount: 0, inputOuterRefractionHeight: 0, inputBlurDistance4: 0, inputShadowBlurRadius: 0, inputShadowVibrancyContribution: 0})},
    text: {rangeUpper: 1, inputs: (inputs, {height}) => {
      const k = height / 90;
      return {...inputs,
        inputBleedAmount: 48, inputBleedBlurRadius: 30, inputBleedHeight: 6, inputBleedOpacity: f(0.75), inputBleedDistance0: f(0.75), inputBleedDistance1: 0,
        inputBleedColorMatrixBlack: 0, inputBleedColorMatrixWhite: 1, inputBleedColorMatrixSaturation: 1, inputBleedColorMatrixFillColor: color([1, 1, 1, 0]), inputBleedDarkenBlend: false,
        inputBlurRadius: f(7.75), inputBlurDistance0: -24, inputBlurDistance1: -1, inputBlurDistance2: 0, inputBlurDistance3: 0, inputBlurDistance4: 0,
        inputBlurOpacity0: f(0.375), inputBlurOpacity1: f(0.875), inputBlurOpacity2: f(0.5), inputBlurOpacity3: 1, inputBlurOpacity4: 1,
        inputClamp: 1, inputClampPreserveHue: false, inputMaxHeadroom: f(1.2),
        inputFaceOpacity: 0, inputFaceColorMatrixBlack: f(0.425), inputFaceColorMatrixWhite: 1, inputFaceColorMatrixSaturation: 1, inputFaceColorMatrixFillColor: color([0, 0, 0, 0]),
        inputInnerRefractionAmount: f(-71.63333333333333 * k), inputInnerRefractionHeight: f(6 * k), inputOuterRefractionAmount: 0, inputOuterRefractionHeight: 0,
        inputRefractionDistance0: -1, inputRefractionDistance1: 10, inputRefractionOpacity: 0,
        inputSDRHoldingToneEnabled: true, inputSDRHoldingToneWhite: f(0.97), inputSDRGradientDistance0: -2 / 3, inputSDRGradientDistance1: -1 / 3, inputSDRShadowOpacity: f(0.08),
        inputShadowAmount: 0, inputShadowHeight: 0, inputShadowBlurRadius: 0, inputShadowOffset: {width: 0, height: 0}, inputShadowDistanceOffset: 0, inputShadowOpacity: 0, inputShadowRadius: 0,
        inputShadowVibrancyContribution: 0, inputShadowColorMatrixBlack: 0, inputShadowColorMatrixWhite: 1, inputShadowColorMatrixSaturation: 1, inputShadowColorMatrixFillColor: color([0, 0, 0, 0])};
    }},
    lens: {rangeUpper: LENS_RANGE_UPPER, margin: ({lens}) => lens?.large ? null : 0, progress: ({lens}) => lens!.large ? Math.max(1e-4, lens!.q!) : null,
      inputs: (inputs, c) => {
        const small = lensInputs(inputs, c);
        if (!c.lens!.large) return small;
        const h = c.lens!.h;
        return {...small, inputInnerRefractionAmount: -h / 4, inputInnerRefractionHeight: f(0.1 * h), inputBlurRadius: 0, inputBlurOpacity1: 0, inputBlurOpacity2: 0, inputBlurOpacity3: 0, inputBlurOpacity4: 0,
          inputFaceColorMatrixBlack: 0, inputFaceColorMatrixFillColor: color(c.scheme === 'light' ? [1, 1, 1, 0] : [0, 0, 0, 0]),
          inputShadowOpacity: f(0.1), inputShadowColorMatrixFillColor: color([0, 0, 0, 1]), inputSDRHoldingToneEnabled: c.lens!.q! >= 0.5};
      }},
  },
  toward: {
    one: /ColorMatrix(Saturation|White)$|^inputClamp$|^inputSDRHoldingToneWhite$/, maxHeadroom: 1.2,
    split: {
      button: new Set(['inputBleedAmount', 'inputBleedBlurRadius', 'inputBleedHeight', 'inputBleedOpacity', 'inputBlurDistance0', 'inputBlurDistance4',
        'inputInnerRefractionAmount', 'inputInnerRefractionHeight', 'inputOuterRefractionAmount', 'inputOuterRefractionHeight',
        'inputShadowAmount', 'inputShadowBlurRadius', 'inputShadowHeight', 'inputShadowVibrancyContribution']),
      bar: new Set(['inputBleedBlurRadius', 'inputBleedOpacity', 'inputBlurRadius', 'inputSDRShadowOpacity', 'inputShadowBlurRadius', 'inputShadowOpacity',
        'inputShadowVibrancyContribution']),
    },
  },
  palette: {
    labels: {label: {light: 1, dark: 0.95}, 'secondary-label': {light: 0.55, dark: 0.6}, 'tertiary-label': {light: 0.3, dark: 0.28},
      'quaternary-label': {light: 0.25, dark: 0.15}, 'quinary-label': {light: 0.25, dark: 0.15}},
    systemColors: {
      red: {light: [255, 56, 60], dark: [255, 66, 69]}, orange: {light: [255, 141, 40], dark: [255, 146, 48]}, yellow: {light: [255, 204, 0], dark: [255, 214, 0]},
      green: {light: [52, 199, 89], dark: [48, 209, 88]}, mint: {light: [0, 200, 179], dark: [0, 218, 195]}, teal: {light: [0, 195, 208], dark: [0, 210, 224]},
      cyan: {light: [0, 192, 232], dark: [60, 211, 254]}, blue: {light: [0, 136, 255], dark: [0, 145, 255]}, indigo: {light: [97, 85, 245], dark: [109, 124, 255]},
      purple: {light: [203, 48, 224], dark: [219, 52, 242]}, pink: {light: [255, 45, 85], dark: [255, 55, 95]}, brown: {light: [172, 127, 94], dark: [183, 138, 102]},
      gray: {light: [142, 142, 147], dark: [142, 142, 147]},
    },
    colourVibrancy: {diagonal: 0.5, shift: {light: -0.5, dark: 0}},
    vibrancy: {
      'menu-highlight': {
        light: [1.1776419878005981, -0.1426014006137848, -0.02704049088060856, 0, -0.08399999141693115, -0.07218798995018005, 1.1079829931259155, -0.027795499190688133, 0, -0.08399999141693115,
          -0.07294298708438873, -0.14146900177001953, 1.2224119901657104, 0, -0.08399999141693115, 0, 0, 0, 1, 0],
        dark: [1.0605319738388062, -0.07796578109264374, -0.014566199854016304, 0, 0.11999999731779099, -0.03931839019060135, 1.022549033164978, -0.01523062027990818, 0, 0.11999999731779099,
          -0.039982810616493225, -0.0769692063331604, 1.0849519968032837, 0, 0.12000010162591934, 0, 0, 0, 1, 0],
      },
      'tab-label': {
        light: [0.8087, -0.6438, -0.0649, 0, 0, -0.1913, 0.3563, -0.065, 0, 0, -0.1914, -0.6436, 0.935, 0, 0, 0, 0, 0, 1, 0],
        dark: [0.798, -0.6795, -0.0685, 0, 0.95, -0.202, 0.3206, -0.0686, 0, 0.95, -0.202, -0.6794, 0.9314, 0, 0.95, 0, 0, 0, 1, 0],
      },
      'alert-preferred': {
        light: [.5, 0, 0, 0, -.5, 0, .5, 0, 0, .0333, 0, 0, .5, 0, .5, 0, 0, 0, 1, 0],
        dark: [.5, 0, 0, 0, 0, 0, .5, 0, 0, .5686, 0, 0, .5, 0, 1, 0, 0, 0, 1, 0],
      },
      'notification-date': [1.00445, -0.384424, -0.0740304, 0, 0.538, -0.195383, 0.816138, -0.0747552, 0, 0.538, -0.196108, -0.383336, 1.12544, 0, 0.538, 0, 0, 0, 1, 0],
      'popover-shadow': [0.671875, -0.171875, 0.078125, 0, 0, -0.09375, 0.578125, 0.078125, 0, 0.015625, -0.09375, -0.171875, 0.828125, 0, 0, -0.234375, -0.453125, -0.09375, 1, 0],
    },
    menu: {label: {light: 'rgb(0 0 0 / .96)', dark: 'rgb(255 255 255 / .96)'}, header: {light: 'rgb(60 60 67 / .6)', dark: 'rgb(235 235 245 / .6)'},
      separator: {light: 'rgb(0 0 0 / .08)', dark: 'rgb(255 255 255 / .08)'}, indicator: {light: 'rgb(0 0 0 / .35)', dark: 'rgb(255 255 255 / .35)'}},
    tint: {light: {saturation: 1.2, lightness: 0.6, black: 0.15, white: 1}, dark: {saturation: 0.95, lightness: 1.1, black: 0.15, white: 0.75},
      grey: {black: 0.95, white: 0.1}, luma: [0.2126, 0.7152, 0.0722]},
    disabled: {tint: [120, 120, 128], alpha: {light: 0.12, dark: 0.24}, labelOpacity: 0.75, barAlpha: {light: 0.45, dark: 0.35}},
  },
  highlight: {
    rim: {light: {key: RIM.light, fill: RIM.light}, dark: {key: RIM.dark, fill: RIM.dark}},
    angles: {key: -Math.PI / 4, fill: 3 * Math.PI / 4},
    text: {
      face: {matrix: [1, 0, 0, 0, 0.2375, 0, 1, 0, 0, 0.2375, 0, 0, 1, 0, 0.2375, 0, 0, 0, 1, 0]},
      rim: {matrix: [1.6031, -1.3352, -0.1346, 0, 1.2, -0.3968, 0.665, -0.1348, 0, 1.2, -0.397, -1.3349, 1.8652, 0, 1.2, 0, 0, 0, 1, 0],
        height: 0.8125, spread: 0.8726907582653611, amount: 0.5, curvature: 0.7, angles: {key: 0, fill: Math.PI}},
    },
  },
  flex: {
    regular: {edges: [44, 160], ultraSmall: 120, lift: {small: 16, range: [16, 4]}, scaleDistance: {small: 2000, range: [6000, 24000]},
      movement: {points: 10, min: 0.9, max: 1.1, normalization: 10000},
      behavior: {trackingResponse: [0.262, 0.314], trackingDamping: 0.625, releaseResponse: [0.4, 0.36], releaseDamping: [0.375, 0.6]},
      glow: {small: {big: 1, little: 1}, big: [1, 0], little: [0.3, 0.2]}},
    menu: {lift: 0, scaleDistance: 6000, movement: 5, glow: {big: 0, little: 0.5}, behavior: {trackingResponse: 0.15, trackingDamping: 0.5, releaseResponse: 0.6, releaseDamping: 0.5}},
    lens: {edges: [37, 70], movement: [10, 100], movementMin: [0.9, 0.75], movementMax: [1.1, 1.15], normalization: [2000, 2500],
      behavior: {trackingResponse: [0.444, 0.5], trackingDamping: [0.56, 0.9], releaseResponse: [0.444, 0.5], releaseDamping: [0.56, 1]}},
    integrator: 0.3,
    glow: {response: 0.1, release: 0.5, dissipation: {distance: 50, little: 0.5, scale: 2, response: 0.5}, releaseScale: 4, scaleResponse: 0.5,
      tracking: {first: 0.15, response: 0.0015, smoothing: 1}, side: {times: 1.5, max: 160}},
  },
  lens: {
    lift: {response: 0.27, damping: 0.625, impulse: 0.032}, unlift: {response: 0.5, damping: 0.7, impulse: 0.016}, hang: 0.22,
    key: {
      light: [2.0172998905181885, -1.287500023841858, -0.1297999918460846, 0, -0.5999999642372131, -0.24959999322891235, 0.725600004196167, -0.08479999750852585, 0, -0.04349999874830246, -0.19139999151229858, -0.6435999870300293, 1.1349999904632568, 0, 0.19999998807907104, 0, 0, 0, 1, 0],
      dark: [2.0172998905181885, -1.287500023841858, -0.1297999918460846, 0, -0.5999999642372131, -0.24390000104904175, 0.7092999815940857, -0.08289999514818192, 0, -0.019999999552965164, -0.19139999151229858, -0.6435999870300293, 1.1349999904632568, 0, 0.19999998807907104, 0, 0, 0, 1, 0],
      'light/orange': [1.0087000131607056, -0.6437999606132507, -0.0648999959230423, 0, 0.19999998807907104, -0.24639999866485596, 0.7164999842643738, -0.08370000123977661, 0, -0.030299998819828033, -0.3308999836444855, -1.1126999855041504, 1.9621999263763428, 0, -0.3831000030040741, 0, 0, 0, 1, 0],
      'dark/orange': [1.0087000131607056, -0.6437999606132507, -0.0648999959230423, 0, 0.19999998807907104, -0.24329999089241028, 0.7074999809265137, -0.08269999921321869, 0, -0.017500000074505806, -0.3222000002861023, -1.083299994468689, 1.9103999137878418, 0, -0.3464999794960022, 0, 0, 0, 1, 0],
},
    fill: {
      light: [1.2740999460220337, -0.7599999904632568, -0.07660000026226044, 0, 1.125, -0.22589999437332153, 0.7400999665260315, -0.07669999450445175, 0, 1.125, -0.22599999606609344, -0.7597999572753906, 1.4232999086380005, 0, 1.125, 0, 0, 0, 1, 0],
      dark: [1.2874000072479248, -0.7152999639511108, -0.07209999859333038, 0, 0.75, -0.2125999927520752, 0.7847999930381775, -0.0722000002861023, 0, 0.75, -0.2126999944448471, -0.7150999903678894, 1.427799940109253, 0, 0.75, 0, 0, 0, 1, 0],
},
    inner: {opacity: 0.12, radius: 3, offset: 7}, restShadow: {opacity: 0.14, radius: 5, offset: 1}, blur: 6, curvature: {lifted: 0.8, rest: 0.7},
  },
  pocket: {
    levels: 32, velocityGate: 0.15,
    latch: {light: {off: 0.7, on: 0.9}, dark: {off: 0.3, on: 0.1}},
    alphas: {light: {replay: {darkening: 0, lightening: 0.85}, plain: {darkening: 0.25, lightening: 0}},
      dark: {replay: {darkening: 0.85, lightening: 0}, plain: {darkening: 0.6, lightening: 0}, plainUnderLightGlass: {darkening: 0.1, lightening: 0}}, hard: 0.9},
    luminance: {lightFloor: 0.75, darkCeiling: 0.4},
    springs: {alpha: 0.6, visibility: 0.2},
    interval: 250,
  },
};

/** iOS 26.5's glass, Liquid Glass set to Tinted: the same, more opaque. */
export const IOS26_5_TINTED: Platform = {...IOS26_5, diffusion: {...IOS26_5.diffusion, increased: true}};
