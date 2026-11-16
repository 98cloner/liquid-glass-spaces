import {MATERIAL_WGSL} from '../material/shader.ts';

const MODE4 = `
struct GlassSDFPrefix {
  arg: vec4<f32>,
  tr: vec4<f32>,
  arg2: vec4<f32>,
};
fn glassMode4Half(value: f32) -> f32 {
  return unpack2x16float(pack2x16float(vec2<f32>(value, 0.0))).x;
}
fn glassMode4Supercircle(
  localPoint: vec2<f32>,
  halfSize: vec2<f32>,
  cornerRadius: f32,
  curveWeight: vec2<f32>,
) -> vec3<f32> {
  let point = abs(localPoint);
  let radius = abs(cornerRadius);
  let expandedRadius = radius * 1.5286649465560913;
  let effectiveRadius = mix(
    expandedRadius,
    radius,
    max(curveWeight.x, curveWeight.y),
  );
  let boundsQ = point - halfSize + vec2<f32>(effectiveRadius);
  let expandedQ = point - halfSize + vec2<f32>(expandedRadius);
  let normalized = max(vec2<f32>(0.0), expandedQ / expandedRadius);
  let radial = abs(normalized);
  let radialLength = length(radial);
  let largest = max(radial.x, radial.y);
  let smallest = min(radial.x, radial.y);
  let t = select(clamp(smallest / largest, 0.0, 1.0), 0.0, largest == 0.0);
  let polynomial = (((-0.9260540008544922 * t + 3.1560099124908447) * t
    - 3.6412200927734375) * t + 1.268030047416687) * t
    + 0.2685309946537018;
  let bezier = t * t * clamp(radialLength, 0.0, 1.0) * polynomial;
  let continuousCurve = radialLength + 1.0 - 1.0 / (1.0 - bezier);
  let circularQ = max(
    vec2<f32>(0.0),
    radial * 1.5286649465560913 - vec2<f32>(0.5286650061607361),
  );
  let circularCurve = length(circularQ) * 0.6541655659675598
    + 0.3458344340324402;
  let curveX = mix(continuousCurve, circularCurve, curveWeight.x);
  let curveY = mix(continuousCurve, circularCurve, curveWeight.y);
  let axisSign = select(-1.0, 1.0, radial.y > radial.x);
  let axisBlend = clamp(0.5 - axisSign + axisSign * t, 0.0, 1.0);
  let selectedCurve = mix(curveX, curveY, axisBlend);
  let curvedDistance = expandedRadius * glassMode4Half(selectedCurve - 1.0);
  let boundsDistance = min(
    max(boundsQ.x, boundsQ.y),
    0.0,
  );
  let distance = boundsDistance + curvedDistance;

  let positiveQ = max(boundsQ, vec2<f32>(0.0));
  let fallback = select(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 0.0),
    boundsQ.x > boundsQ.y,
  );
  var gradient = select(
    fallback,
    normalize(positiveQ),
    dot(positiveQ, positiveQ) > 0.0,
  );
  return vec3<f32>(distance, gradient);
}

fn computeGlassSDFMode4(point: vec2<f32>, u: GlassSDFPrefix) -> vec4<f32> {
  let sdf = glassMode4Supercircle(abs(point), u.arg.xy, u.arg2.z, u.arg2.xy);
  let pointSign = select(vec2<f32>(-1.0), vec2<f32>(1.0), point >= vec2<f32>(0.0));
  var normal = sdf.yz * pointSign;
  if (u.arg.w != 0.0) {
    let radial = normalize(vec2<f32>(point.x, u.arg.x * point.y / u.arg.y));
    normal = mix(normal, radial, vec2<f32>(u.arg.w));
  }
  normal = normalize(normal);
  return vec4<f32>(sdf.x, dot(normal, u.tr.xy), dot(normal, u.tr.zw), 1.0);
}
`;
const MODE0 = `
fn computeGlassSDFMode0(point:vec2<f32>,u:GlassSDFPrefix)->vec4<f32> {
 let q=abs(point)-u.arg.xy;
 let pointSign=select(vec2<f32>(-1.0),vec2<f32>(1.0),point>=vec2<f32>(0.0));
 var normal=select(vec2<f32>(0.0,1.0),vec2<f32>(1.0,0.0),q.x>q.y)*pointSign;
 if(u.arg.w!=0.0){
  let radial=normalize(vec2<f32>(point.x,u.arg.x*point.y/u.arg.y));
  normal=mix(normal,radial,vec2<f32>(u.arg.w));
 }
 normal=normalize(normal);
 return vec4<f32>(max(q.x,q.y),dot(normal,u.tr.xy),dot(normal,u.tr.zw),1.0);
}
fn computeAnalyticGlassSDF(point:vec2<f32>,u:GlassSDFPrefix)->vec4<f32>{
 if(i32(u.arg.z)<0){return vec4<f32>(0.0);}
 if(i32(u.arg.z)==0){return computeGlassSDFMode0(point,u);}
 return computeGlassSDFMode4(point,u);
}
fn computeAnalyticGlassShadowSDF(point:vec2<f32>,u:GlassSDFPrefix)->vec4<f32>{
 return computeGlassSDFMode4(point,u);
}
`;

function analyticMaterial() {
  let shader = MATERIAL_WGSL;
  const once = (before: string, after: string) => {
    if (shader.split(before).length !== 2) throw new Error('material shader changed: the analytic path needs review');
    shader = shader.replace(before, after);
  };
  once('@location(0) outputUV: vec2<f32>,', '@location(0) sdfUV: vec2<f32>,\n  @location(1) sourceUV: vec2<f32>,');
  once('@group(0) @binding(2) var sdfTexture: texture_2d<f32>;\n@group(0) @binding(3) var sdfSampler: sampler;',
    '@group(0) @binding(2) var<uniform> sdfPrefix: GlassSDFPrefix;\n@group(0) @binding(3) var<uniform> mvp: mat4x4<f32>;');
  const start = shader.indexOf('@vertex\n'), end = shader.indexOf('\nfn roundHalf', start);
  if (start < 0 || end < start) throw new Error('material shader changed: the analytic path needs review');
  shader = shader.slice(0, start) + `@vertex
fn analyticGlassVertex(@location(0) position:vec4<f32>, @location(1) sdfUV:vec2<f32>,
 @location(2) sourceUV:vec2<f32>) -> VertexOutput {
 var output:VertexOutput;
 output.position=mvp*position; output.sdfUV=sdfUV; output.sourceUV=sourceUV;
 return output;
}
` + shader.slice(end);
  once(`  let sourceUV = input.outputUV * params.sourceUVTransform.xy
    + params.sourceUVTransform.zw;
  let sdfUV = input.outputUV * params.sdfUVTransform.xy
    + params.sdfUVTransform.zw;
  let sdfPayload = textureSampleLevel(sdfTexture, sdfSampler, sdfUV, 0.0);`, `  let sourceUV = input.sourceUV;
  let sdfUV = input.sdfUV;
  let sdfPayload = computeAnalyticGlassSDF(sdfUV, sdfPrefix);`);
  once(`    let shiftedPayload = textureSampleLevel(
      sdfTexture,
      sdfSampler,
      sdfUV + vec2<f32>(params.shadowOffsetX, params.shadowOffsetY),
      0.0,
    );`, `    let shiftedPayload = computeAnalyticGlassShadowSDF(
      sdfUV + vec2<f32>(params.shadowOffsetX, params.shadowOffsetY), sdfPrefix);`);
  return MODE4 + MODE0 + shader;
}

export type AnalyticDraw = {prefix: Uint8Array; vertices: Uint8Array; indices: Uint16Array | null; count: number};
type Buffers = {prefix: GPUBuffer; vertices: GPUBuffer; indices: GPUBuffer};

export async function createAnalyticGlass(device: GPUDevice, format: GPUTextureFormat) {
  const module = device.createShaderModule({label: 'analytic glass', code: analyticMaterial()});
  const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === 'error');
  if (errors.length) throw new Error(errors.map((m) => m.message).join('\n'));
  const premul = {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'} as const;
  const pipeline = await device.createRenderPipelineAsync({layout: 'auto', primitive: {topology: 'triangle-list'},
    vertex: {module, entryPoint: 'analyticGlassVertex', buffers: [{arrayStride: 48, attributes: [{shaderLocation: 0, offset: 0, format: 'float32x4'},
      {shaderLocation: 1, offset: 16, format: 'float32x2'}, {shaderLocation: 2, offset: 24, format: 'float32x2'}]}]},
    fragment: {module, entryPoint: 'glassBackgroundNoBleed', targets: [{format, blend: {color: premul, alpha: premul}}]}});
  const buffer = (size: number, usage: number) => device.createBuffer({size, usage: usage | GPUBufferUsage.COPY_DST});
  return {
    glass() {
      const draws: Buffers[] = [], material = buffer(384, GPUBufferUsage.UNIFORM), mvp = buffer(64, GPUBufferUsage.UNIFORM);
      return {
        encode(pass: GPURenderPassEncoder, {draws: list, uniform, size, source, sampler}: {draws: AnalyticDraw[]; uniform: Float32Array; size: readonly number[]; source: GPUTextureView; sampler: GPUSampler}) {
          device.queue.writeBuffer(material, 0, uniform);
          device.queue.writeBuffer(mvp, 0, new Float32Array([2 / size[0], 0, 0, 0, 0, -2 / size[1], 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]));
          pass.setPipeline(pipeline);
          list.forEach((d, i) => {
            const b = draws[i] ??= {prefix: buffer(48, GPUBufferUsage.UNIFORM), vertices: buffer(36 * 48, GPUBufferUsage.VERTEX), indices: buffer(96 * 2, GPUBufferUsage.INDEX)};
            device.queue.writeBuffer(b.prefix, 0, d.prefix);
            device.queue.writeBuffer(b.vertices, 0, d.vertices);
            pass.setBindGroup(0, device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: source}, {binding: 1, resource: sampler},
              {binding: 2, resource: {buffer: b.prefix}}, {binding: 3, resource: {buffer: mvp}}, {binding: 4, resource: {buffer: material}}]}));
            pass.setVertexBuffer(0, b.vertices);
            if (d.indices) { device.queue.writeBuffer(b.indices, 0, d.indices); pass.setIndexBuffer(b.indices, 'uint16'); pass.drawIndexed(d.count); }
            else pass.draw(d.count);
          });
        },
        destroy() { for (const b of [material, mvp, ...draws.flatMap((d) => [d.prefix, d.vertices, d.indices])]) b.destroy(); },
      };
    },
  };
}
