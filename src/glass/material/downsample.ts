export const DOWNSAMPLE_WGSL = `
struct DownsampleUniform {
  sourceLevel: f32,
  dx: f32,
  dy: f32,
  unused: f32,
  clampRect: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: DownsampleUniform;
@group(0) @binding(2) var linearSampler: sampler;

@vertex
fn downsampleBlurVert(@builtin(vertex_index) index: u32) -> VertexOutput {
  let uv = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
  var output: VertexOutput;
  output.position = vec4<f32>(uv * vec2<f32>(2.0, -2.0)
    + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
  output.uv = uv;
  return output;
}

fn loadOrZero(coord: vec2<i32>, level: i32, dimensions: vec2<i32>) -> vec4<f32> {
  if (any(coord < vec2<i32>(0)) || any(coord >= dimensions)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(sourceTexture, coord, level);
}

fn sampleLinearClampToZero(uv: vec2<f32>, level: i32) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture, level));
  let texel = uv * vec2<f32>(dimensions) - vec2<f32>(0.5);
  let base = vec2<i32>(floor(texel));
  let fraction = fract(texel);
  if (all(base >= vec2<i32>(0)) && all(base + vec2<i32>(1) < dimensions)) {
    return textureSampleLevel(sourceTexture, linearSampler, uv, f32(level));
  }
  let top = mix(
    loadOrZero(base, level, dimensions),
    loadOrZero(base + vec2<i32>(1, 0), level, dimensions),
    fraction.x,
  );
  let bottom = mix(
    loadOrZero(base + vec2<i32>(0, 1), level, dimensions),
    loadOrZero(base + vec2<i32>(1, 1), level, dimensions),
    fraction.x,
  );
  return mix(top, bottom, fraction.y);
}

fn sampleOffset(uv: vec2<f32>, offset: vec2<f32>, level: i32) -> vec4<f32> {
  return sampleLinearClampToZero(
    uv + offset * vec2<f32>(params.dx, params.dy),
    level,
  );
}

@fragment
fn variableBlurDownsampleFrag(input: VertexOutput) -> @location(0) vec4<f32> {
  let level = i32(params.sourceLevel);
  let innerOffset = 1.9600850343704224;
  let outerOffset = 3.9206759929656982;

  var inner = sampleOffset(input.uv, vec2<f32>(0.0, -innerOffset), level)
    + sampleOffset(input.uv, vec2<f32>(-innerOffset, 0.0), level);
  inner = inner + sampleOffset(input.uv, vec2<f32>(0.0, innerOffset), level);
  inner = inner + sampleOffset(input.uv, vec2<f32>(innerOffset, 0.0), level);

  var diagonal = sampleOffset(input.uv, vec2<f32>(-innerOffset, innerOffset), level)
    + sampleOffset(input.uv, vec2<f32>(-innerOffset, -innerOffset), level);
  diagonal = diagonal
    + sampleOffset(input.uv, vec2<f32>(innerOffset, -innerOffset), level);
  diagonal = diagonal
    + sampleOffset(input.uv, vec2<f32>(innerOffset, innerOffset), level);

  var outer = sampleOffset(input.uv, vec2<f32>(-outerOffset, 0.0), level)
    + sampleOffset(input.uv, vec2<f32>(0.0, -outerOffset), level);
  outer = outer + sampleOffset(input.uv, vec2<f32>(0.0, outerOffset), level);
  outer = outer + sampleOffset(input.uv, vec2<f32>(outerOffset, 0.0), level);

  var value = inner * 0.09018599987030029
    + sampleLinearClampToZero(input.uv, level) * 0.10549700260162354;
  value = value + diagonal * 0.07709799706935883;
  value = value + outer * 0.05634099990129471;
  return value;
}
`;
