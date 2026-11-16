import {MATERIAL_STRUCT_WGSL} from './host.ts';

export const MATERIAL_WGSL = `
${MATERIAL_STRUCT_WGSL}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) outputUV: vec2<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var sdfTexture: texture_2d<f32>;
@group(0) @binding(3) var sdfSampler: sampler;
@group(0) @binding(4) var<uniform> params: GlassMaterialUniform;

@vertex
fn variableBlurVert(@builtin(vertex_index) index: u32) -> VertexOutput {
  let uv = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
  var output: VertexOutput;
  output.position = vec4<f32>(
    uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0),
    0.0,
    1.0,
  );
  output.outputUV = uv;
  return output;
}

@vertex
fn variableBlurQuadVert(@builtin(vertex_index) index: u32) -> VertexOutput {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0), vec2<f32>(0.0, 0.0));
  let uv = corners[index];
  var output: VertexOutput;
  output.position = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
  output.outputUV = uv;
  return output;
}

fn roundHalf(value: f32) -> f32 {
  return unpack2x16float(pack2x16float(vec2<f32>(value, 0.0))).x;
}

fn sphereProfile(amount: f32, inverseHeight: f32, distance: f32) -> f32 {
  if (bitcast<u32>(inverseHeight) == 0x7f800000u) {
    return select(amount, 0.0, distance < 0.0);
  }
  let t = clamp(inverseHeight * -distance, 0.0, 1.0);
  return amount * (1.0 - clamp(sqrt((2.0 - t) * t), 0.0, 1.0));
}

fn transformedGradient(gradient: vec2<f32>, displacement: f32) -> vec2<f32> {
  let transformed = vec2<f32>(
    dot(params.displacementMatrix.xy, gradient),
    dot(params.displacementMatrix.zw, gradient),
  );
  return transformed * displacement;
}

fn blurLOD(displacedDistance: f32) -> f32 {
  if (params.blurRadius == 0.0) { return 0.0; }
  let distance = params.blurDistance;
  let span0 = distance.y - distance.x;
  let span1 = distance.z - distance.y;
  let w0 = clamp(fma(displacedDistance, 1.0 / span0, -distance.x / span0), 0.0, 1.0);
  let w1 = clamp(fma(displacedDistance, 1.0 / span1, -distance.y / span1), 0.0, 1.0);
  var w2 = 0.0;
  if (!(distance.z == 0.0 && distance.w == 0.0)) {
    w2 = clamp(fma(displacedDistance, 1.0 / (distance.w - distance.z),
      -distance.z / (distance.w - distance.z)), 0.0, 1.0);
  }
  let contribution = (params.blurAlpha.y * w0 + params.blurAlpha.z * w1)
    + params.blurAlpha.w * w2;
  let factor = params.blurAlpha.x - contribution;
  let radius = factor * params.blurRadius;
  let logInput = select(1.0 + 0.5 * radius, radius, radius >= 2.0);
  return max(0.0, log2(logInput));
}

fn sourceAt(sourceUV: vec2<f32>, displacement: vec2<f32>, lod: f32) -> vec4<f32> {
  return textureSampleLevel(
    sourceTexture,
    sourceSampler,
    sourceUV + displacement,
    lod,
  );
}

fn radiusLOD(radius: f32) -> f32 {
  return max(0.0, log2(select(1.0 + 0.5 * radius, radius, radius >= 2.0)));
}

fn snapSourceRGB(rgb: vec3<f32>) -> vec3<f32> {
  return select(rgb, vec3<f32>(0.0), abs(rgb) < vec3<f32>(0.0000009999999974752427));
}

fn shadowCDF(shiftedDistance: f32) -> f32 {
  var x = roundHalf(params.shadowInvRadius * shiftedDistance);
  x = roundHalf(clamp(roundHalf(fma(0.25, x, 0.5)), 0.0, 1.0));
  x = roundHalf(fma(4.0, x, -2.0));
  let x2 = roundHalf(x * x);
  var polynomial = roundHalf(fma(0.0029544830322265625, x2, -0.034454345703125));
  polynomial = roundHalf(fma(polynomial, x2, 0.168212890625));
  polynomial = roundHalf(fma(polynomial, x2, -0.560546875));
  return roundHalf(fma(polynomial, x, 0.5));
}

fn faceColor(source: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    dot(source, params.faceCM0.xyz) + params.faceCM0.w,
    dot(source, params.faceCM1.xyz) + params.faceCM1.w,
    dot(source, params.faceCM2.xyz) + params.faceCM2.w,
  );
}

fn applyHoldingTone(material: vec4<f32>, distance: f32) -> vec4<f32> {
  let distance0 = params.holdingDistance0;
  let distance1 = params.holdingDistance1;
  var weight = 0.0;
  if (distance < distance0) {
    weight = 1.0;
  } else if (distance < distance1) {
    weight = 1.0 - (distance - distance0) / (distance1 - distance0);
  }
  weight = weight * params.holdingTone;
  let candidateAlpha = clamp(material.a, 0.0, 1.0);
  let candidateRGB = params.holdingToneWhite * material.rgb
    * candidateAlpha / max(material.a, 0.000001);
  return mix(material, vec4<f32>(candidateRGB, candidateAlpha), weight);
}

fn clampPremultiplied(material: vec4<f32>) -> vec4<f32> {
  let limit = params.clampLimit;
  if (!(limit > 0.0)) { return material; }
  var straight = material.rgb / max(material.a, 0.0000009999999974752427);
  if (params.clampPreserveHue > 0.0) {
    let maximum = max(max(straight.r, straight.g), straight.b);
    if (maximum > limit) { straight *= limit / maximum; }
  } else {
    straight = clamp(straight, vec3<f32>(-0.75), vec3<f32>(limit));
  }
  return vec4<f32>(straight * material.a, material.a);
}

@fragment
fn glassBackgroundNoBleed(input: VertexOutput) -> @location(0) vec4<f32> {
  let sourceUV = input.outputUV * params.sourceUVTransform.xy
    + params.sourceUVTransform.zw;
  let sdfUV = input.outputUV * params.sdfUVTransform.xy
    + params.sdfUVTransform.zw;
  let sdfPayload = textureSampleLevel(sdfTexture, sdfSampler, sdfUV, 0.0);
  let distance = sdfPayload.x;
  let aa = max(fwidth(distance), 0.00009999999747378752);
  let coverage = clamp(0.5 - distance / aa, 0.0, 1.0) * sdfPayload.w;

  var shadowMaterial = vec4<f32>(0.0);
  if (coverage < 1.0) {
    let shiftedPayload = textureSampleLevel(
      sdfTexture,
      sdfSampler,
      sdfUV + vec2<f32>(params.shadowOffsetX, params.shadowOffsetY),
      0.0,
    );
    let shadowDisplacement = sphereProfile(
      params.shadowAmount,
      params.shadowInvHeight,
      distance + params.shadowDistanceOffset,
    );
    let shadowFactor = params.shadowOpacity * shadowCDF(shiftedPayload.x);
    if (coverage == 0.0 && shadowFactor * shiftedPayload.w < 0.0000009999999974752427) {
      discard;
    }
    var shadowRGB = vec3<f32>(params.shadowCM0.w, params.shadowCM1.w, params.shadowCM2.w);
    var shadowAlpha = params.shadowAlpha;
    if (params.shadowVibrancy > 0.0000009999999974752427) {
      let sampleValue = sourceAt(sourceUV, transformedGradient(sdfPayload.yz, shadowDisplacement),
        radiusLOD(params.shadowBlurRadius));
      let straight = snapSourceRGB(sampleValue.rgb / max(sampleValue.a, 0.000001));
      shadowRGB = vec3<f32>(dot(straight, params.shadowCM0.xyz),
        dot(straight, params.shadowCM1.xyz), dot(straight, params.shadowCM2.xyz))
        * params.shadowVibrancy + shadowRGB;
      shadowAlpha = mix(shadowAlpha, 1.0, params.shadowVibrancy);
    }
    shadowMaterial = vec4<f32>(shadowRGB, shadowAlpha) * shadowFactor * shiftedPayload.w;
  }

  var faceMaterial = vec4<f32>(0.0);
  if (coverage > 0.0) {
    let innerDisplacement = sphereProfile(
      params.innerRefractionAmount,
      params.innerRefractionInvHeight,
      distance,
    );
    let outerDisplacement = sphereProfile(
      params.outerRefractionAmount,
      params.outerRefractionInvHeight,
      distance,
    );
    let gradient = sdfPayload.yz;
    var refracted = vec4<f32>(0.0);
    if (params.complexRefraction != 0.0) {
      let innerSource = sourceAt(sourceUV, transformedGradient(gradient, innerDisplacement),
        blurLOD(distance + innerDisplacement));
      refracted = vec4<f32>(snapSourceRGB(innerSource.rgb), innerSource.a);
      if (params.refractionOpacity > 0.0) {
        let outerSource = sourceAt(sourceUV, transformedGradient(gradient, outerDisplacement),
          blurLOD(distance + outerDisplacement));
        let span = params.refractionDistance1 - params.refractionDistance0;
        let refractionMix = clamp(fma(distance, 1.0 / span,
          -params.refractionDistance0 / span), 0.0, 1.0) * params.refractionOpacity;
        refracted = mix(refracted, vec4<f32>(snapSourceRGB(outerSource.rgb), outerSource.a), refractionMix);
      }
    } else {
      let sampled = sourceAt(sourceUV, vec2<f32>(0.0), radiusLOD(params.blurRadius));
      refracted = vec4<f32>(snapSourceRGB(sampled.rgb), sampled.a);
    }
    let straight = refracted.rgb / max(refracted.a, 0.000001);
    var faceRGB = straight;
    if (params.faceOpacity > 0.0) {
      faceRGB = mix(straight, faceColor(straight), params.faceOpacity);
    }
    if (params.bleedOpacity > 0.0) {
      let displacement = sphereProfile(params.bleedAmount, params.bleedInvHeight, distance);
      let sampled = sourceAt(sourceUV, transformedGradient(gradient, displacement), radiusLOD(params.bleedBlurRadius));
      let bleedSource = snapSourceRGB(sampled.rgb / max(sampled.a, 0.000001));
      let bleedRGB = vec3<f32>(dot(bleedSource, params.bleedCM0.xyz) + params.bleedCM0.w,
        dot(bleedSource, params.bleedCM1.xyz) + params.bleedCM1.w,
        dot(bleedSource, params.bleedCM2.xyz) + params.bleedCM2.w);
      let span = params.bleedDistance1 - params.bleedDistance0;
      let ramp = clamp(fma(distance, 1.0 / span, -params.bleedDistance0 / span), 0.0, 1.0);
      let luminance = clamp(dot(faceRGB, vec3<f32>(0.21250000596046448, 0.715399980545044, 0.07209999859333038)), 0.0, 1.0);
      let darken = params.bleedDarkenScale * luminance + params.bleedDarkenOffset;
      let weightedRamp = darken * darken * ramp;
      faceRGB = mix(faceRGB, bleedRGB, weightedRamp * weightedRamp * params.bleedOpacity);
    }
    faceMaterial = vec4<f32>(faceRGB, 1.0);
  }

  var material = mix(shadowMaterial, faceMaterial, coverage);
  material = applyHoldingTone(material, distance);
  material = clampPremultiplied(material);
  material = vec4<f32>(material.rgb * params.edrScale, material.a);
  return material;
}
`;

export function materialShaderVertexUV() {
  return MATERIAL_WGSL
    .replace('@location(0) outputUV: vec2<f32>,', '@location(0) outputUV: vec2<f32>,\n  @location(1) sourceUV: vec2<f32>,\n  @location(2) sdfUV: vec2<f32>,')
    .replaceAll('output.outputUV = uv;', `output.outputUV = uv;
  output.sourceUV = uv * params.sourceUVTransform.xy + params.sourceUVTransform.zw;
  output.sdfUV = uv * params.sdfUVTransform.xy + params.sdfUVTransform.zw;`)
    .replace(`let sourceUV = input.outputUV * params.sourceUVTransform.xy
    + params.sourceUVTransform.zw;
  let sdfUV = input.outputUV * params.sdfUVTransform.xy
    + params.sdfUVTransform.zw;`, `let sourceUV = input.sourceUV;
  let sdfUV = input.sdfUV;`);
}
