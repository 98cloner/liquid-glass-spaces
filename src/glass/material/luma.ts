import {fma64} from '../math.js';

export const LUMA_LIMITS = {maxComputeInvocationsPerWorkgroup: 512, maxComputeWorkgroupSizeX: 32, maxComputeWorkgroupSizeY: 16, maxComputeWorkgroupStorageSize: 512 * 16};

const u16 = (x: number, y: number) => {
  if (![x, y].every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffff)) throw new RangeError('luma ushort2 field is out of range');
  return (x | (y << 16)) >>> 0;
};
export function lumaRegion(sourceBounds: readonly number[], level: number) {
  if (sourceBounds.some((v) => !Number.isInteger(v) || v < 0 || v > 0x7fffffff) || !Number.isInteger(level) || level < 0 || level > 31)
    throw new RangeError('nonnegative int32 Bounds and mip level 0..31 required');
  const origin = [sourceBounds[0] >> level, sourceBounds[1] >> level], size = [Math.max(1, sourceBounds[2] >> level), Math.max(1, sourceBounds[3] >> level)];
  const bounds = [origin[0] + size[0], origin[1] + size[1]];
  u16(origin[0], origin[1]); u16(bounds[0], bounds[1]);
  return {origin, bounds, size, level};
}
export function lumaDispatch(origin: readonly number[], bounds: readonly number[]) {
  const width = bounds[0] - origin[0], height = bounds[1] - origin[1];
  if (width < 0 || height < 0) throw new RangeError('luma bounds must not precede origin');
  const groupsX = Math.ceil(Math.ceil(width / 8) / 32), groupsY = Math.ceil(height / 16), threadGroupCount = groupsX * groupsY;
  return {groupsX, groupsY, threadGroupCount, iterations: threadGroupCount};
}
export function lumaUniform({origin, bounds, level, pixelPerSample = 1}: {origin: readonly number[]; bounds: readonly number[]; level: number; pixelPerSample?: number}) {
  const d = lumaDispatch(origin, bounds);
  return new Uint32Array([u16(origin[0], origin[1]), u16(bounds[0], bounds[1]), d.iterations, d.threadGroupCount, pixelPerSample | (level << 8), 0, 0, 0]);
}

export const LUMA_WGSL = `
struct LumaComputeUniforms {
  packedOrigin: u32,
  packedBounds: u32,
  iterations: u32,
  threadGroupCount: u32,
  packedTail: u32,
  padding0: u32,
  padding1: u32,
  padding2: u32,
};

@group(0) @binding(0) var stage1Texture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> stage1Uniforms: LumaComputeUniforms;
@group(0) @binding(2) var<storage, read_write> stage1Output: array<vec4<f32>>;

var<workgroup> stage1Partial: array<vec4<f32>, 512>;

fn unpackU16Pair(value: u32) -> vec2<u32> {
  return vec2<u32>(value & 0xffffu, value >> 16u);
}

@compute @workgroup_size(32, 16, 1)
fn computeAverageLuma(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_index) localIndex: u32,
  @builtin(workgroup_id) groupId: vec3<u32>,
  @builtin(num_workgroups) groupCount: vec3<u32>,
) {
  let origin = unpackU16Pair(stage1Uniforms.packedOrigin);
  let bounds = unpackU16Pair(stage1Uniforms.packedBounds);
  var point = vec2<u32>(gid.x * 8u + origin.x, gid.y + origin.y);
  var local = vec4<f32>(0.0);
  for (var index = 0u; index < 8u; index += 1u) {
    if (point.x < bounds.x && point.y < bounds.y) {
      local = local + textureLoad(stage1Texture, vec2<i32>(point), 0);
    }
    point.x += 1u;
  }
  stage1Partial[localIndex] = local;
  workgroupBarrier();

  var stride = 256u;
  loop {
    if (localIndex < stride) {
      stage1Partial[localIndex] =
        stage1Partial[localIndex] + stage1Partial[localIndex + stride];
    }
    workgroupBarrier();
    if (stride == 1u) {
      break;
    }
    stride = stride >> 1u;
  }
  if (localIndex == 0u) {
    stage1Output[groupId.x + groupId.y * groupCount.x] = stage1Partial[0];
  }
}

@group(0) @binding(0) var<uniform> stage2Uniforms: LumaComputeUniforms;
@group(0) @binding(1) var<storage, read> stage2Input: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> stage2Output: array<vec4<f32>>;

@compute @workgroup_size(1, 1, 1)
fn computeSumLuma(@builtin(local_invocation_index) localIndex: u32) {
  let begin = localIndex * stage2Uniforms.iterations;
  let end = min(begin + stage2Uniforms.iterations,
                stage2Uniforms.threadGroupCount);
  var total = vec4<f32>(0.0);
  for (var index = begin; index < end; index += 1u) {
    total = total + stage2Input[index];
  }
  stage2Output[localIndex] = total;
}
`;

export async function createLumaPipelines(device: GPUDevice) {
  const module = device.createShaderModule({label: 'average luma', code: LUMA_WGSL});
  const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === 'error');
  if (errors.length) throw new Error(errors.map((m) => m.message).join('\n'));
  const [stage1, stage2] = await Promise.all([device.createComputePipelineAsync({label: 'compute_average_luma', layout: 'auto', compute: {module, entryPoint: 'computeAverageLuma'}}),
    device.createComputePipelineAsync({label: 'compute_sum_luma', layout: 'auto', compute: {module, entryPoint: 'computeSumLuma'}})]);
  return {stage1, stage2};
}

export function lumaNotification(sum: ArrayLike<number>, callbackScale = 1) {
  const [r, g, b, a] = Array.from(sum, Math.fround);
  const reported = a <= 0 ? -1 : Math.fround(((fma64(g, 0.7152, r * 0.2126) + b * 0.0722) * Math.fround(callbackScale)) / a);
  const scaled = Math.fround(reported * 64), magnitude = Math.floor(Math.abs(scaled) + 0.5);
  return Math.fround((scaled < 0 || Object.is(scaled, -0) ? -magnitude : magnitude) * Math.fround(1 / 64));
}
