import {sdfScene, type SDFDraw, type SDFKind, type SDFScene} from './scene.ts';

export const SDF_FIELD_WGSL = `
struct VertexParams { mvp:mat4x4<f32>, texmat:vec4<f32> };
struct Params { shape:vec4<f32>, normal:vec4<f32>, curve:vec4<f32>, unused:array<vec4<f32>,3>, unionParams:vec4<f32> };
struct VertexOut { @builtin(position) position:vec4<f32>, @location(0) @interpolate(linear,center) point:vec2<f32> };
@group(0) @binding(0) var<uniform> vertexParams:VertexParams;
@group(0) @binding(1) var<uniform> params:Params;
@vertex fn vertexMain(@location(0) position:vec4<f32>,@location(1) point:vec2<f32>)->VertexOut {
 var out:VertexOut;out.position=vertexParams.mvp*position;
 out.point=vertexParams.texmat.xy*point+vertexParams.texmat.zw;return out;
}
fn halfRound(x:f32)->f32 {return unpack2x16float(pack2x16float(vec2<f32>(x,0))).x;}
fn curveSDF(p:vec2<f32>)->vec3<f32> {
 let bottomHalf=params.curve.w>=1.0&&p.y>0.0;
 if(bottomHalf&&params.curve.w==1.0){return rectSDF(p);}
 let point=abs(p);let radius=select(abs(params.curve.z),params.curve.w-1.0,bottomHalf);let expanded=radius*1.5286649465560913;
 let weight=select(params.curve.xy,clamp(params.shape.xy*2.0*-1.4457785175867517/(radius*1.528665)+2.8915570351735034,vec2<f32>(0),vec2<f32>(1)),bottomHalf);
 let effective=mix(expanded,radius,max(weight.x,weight.y));
 let q=point-params.shape.xy+effective;
 let radial=max(vec2<f32>(0),(point-params.shape.xy+expanded)/expanded);
 let radialLength=length(radial);let largest=max(radial.x,radial.y);
 let t=select(clamp(min(radial.x,radial.y)/largest,0.0,1.0),0.0,largest==0.0);
 let polynomial=(((3.1560099124908447-0.9260540008544922*t)*t-3.6412200927734375)*t+1.268030047416687)*t+0.2685309946537018;
 let continuous=radialLength+1.0-1.0/(1.0-t*t*clamp(radialLength,0.0,1.0)*polynomial);
 let circular=length(max(vec2<f32>(0),radial*1.5286649465560913-0.5286650061607361))*0.6541655659675598+0.3458344340324402;
 let x=mix(continuous,circular,weight.x);let y=mix(continuous,circular,weight.y);
 let axis=select(-1.0,1.0,radial.y>radial.x);
 let selected=mix(x,y,clamp(0.5-axis+axis*t,0.0,1.0));
 let distance=min(max(q.x,q.y),0.0)+expanded*halfRound(selected-1.0);
 let positive=max(q,vec2<f32>(0));let fallback=select(vec2<f32>(0,1),vec2<f32>(1,0),q.x>q.y);
 let normal=select(fallback,normalize(positive),dot(positive,positive)>0.0);
 return vec3<f32>(distance,normal*select(vec2<f32>(-1),vec2<f32>(1),p>=vec2<f32>(0)));
}
fn rectSDF(p:vec2<f32>)->vec3<f32>{
 let q=abs(p)-params.shape.xy;
 let n=select(vec2<f32>(0,1),vec2<f32>(1,0),q.x>q.y)*select(vec2<f32>(-1),vec2<f32>(1),p>=vec2<f32>(0));
 return vec3<f32>(max(q.x,q.y),n);
}
fn finish(p:vec2<f32>,value:vec3<f32>)->vec4<f32>{
 let ellipse=normalize(vec2<f32>(p.x,params.shape.x*p.y/params.shape.y));
 let normal=normalize(mix(value.yz,ellipse,params.shape.w));
 let mapped=vec2<f32>(dot(normal,params.normal.xy),dot(normal,params.normal.zw));
 let result=vec4<f32>(value.x,mapped,1);
 let sum=result.x+result.y+result.w+result.z;
 return select(result,vec4<f32>(0,0,0,1),(bitcast<u32>(sum)&0x7f800000u)==0x7f800000u);
}
`;
const UNION = `
@group(0) @binding(2) var previous:texture_2d<f32>;
fn unionWithPrevious(incoming:vec4<f32>,position:vec2<f32>)->vec4<f32>{
 let stored=textureLoad(previous,vec2<i32>(position),0);
 let prior=select(stored,vec4<f32>(10000,0,0,0),stored.w==0.0);
 let width=clamp(0.5-0.5*dot(incoming.yz,prior.yz),0.0,1.0)*max(params.unionParams.x,0.00009999999747378752);
 let h=clamp(0.5*(prior.x-incoming.x)/width+0.5,0.0,1.0);
 return vec4<f32>(mix(prior.x,incoming.x,h)-width*h*(1.0-h),mix(prior.yz,incoming.yz,h),1);
}
`;
const ENTRY: Record<SDFKind, string> = {
  curve: 'return finish(input.point,curveSDF(input.point));',
  rect: 'return finish(input.point,rectSDF(input.point));',
  union: 'return unionWithPrevious(finish(input.point,curveSDF(input.point)),input.position.xy);',
  unionRect: 'return unionWithPrevious(finish(input.point,rectSDF(input.point)),input.position.xy);',
};
const KINDS: SDFKind[] = ['curve', 'rect', 'union', 'unionRect'];
const isUnion = (k: SDFKind) => k === 'union' || k === 'unionRect';

async function pipeline(device: GPUDevice, kind: SDFKind) {
  const module = device.createShaderModule({label: `SDF producer ${kind}`,
    code: SDF_FIELD_WGSL + (isUnion(kind) ? UNION : '') + `@fragment fn fragmentMain(input:VertexOut)->@location(0) vec4<f32>{${ENTRY[kind]}}\n`});
  const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === 'error');
  if (errors.length) throw new Error(errors.map((m) => m.message).join('\n'));
  return device.createRenderPipelineAsync({layout: 'auto', vertex: {module, entryPoint: 'vertexMain', buffers: [{arrayStride: 48, attributes: [{shaderLocation: 0, offset: 0, format: 'float32x4'},
    {shaderLocation: 1, offset: 16, format: 'float32x2'}]}]}, fragment: {module, entryPoint: 'fragmentMain', targets: [{format: 'rgba16float'}]}, primitive: {topology: 'triangle-list'}});
}
const shared = new WeakMap<GPUDevice, Promise<GPURenderPipeline[]>>();
export function prepareSDFPipelines(device: GPUDevice) {
  let p = shared.get(device);
  if (!p) shared.set(device, p = Promise.all(KINDS.map((k) => pipeline(device, k))));
  return p;
}

const key = (scene: SDFScene) => JSON.stringify([scene.unionFirst, scene.surfaces, scene.unionSmoothness, scene.size, scene.origin, scene.scissor, scene.renderScale,
  scene.screenCenter, scene.outputSDFEffect, scene.sdfPadding, scene.rootProjectionReference, scene.gradientOvalization, scene.gaussianRadius], (_, v) => Object.is(v, -0) ? '-0' : v);

export type SDFEncoder = ReturnType<typeof createSDFEncoder>;
export function createSDFEncoder(device: GPUDevice, pipelines: GPURenderPipeline[]) {
  type Buffers = {vertices: GPUBuffer; indices: GPUBuffer; vertexUniform: GPUBuffer; uniform: GPUBuffer};
  const set = (): Buffers => ({vertices: buf(768, GPUBufferUsage.VERTEX), indices: buf(128, GPUBufferUsage.INDEX), vertexUniform: buf(80, GPUBufferUsage.UNIFORM), uniform: buf(112, GPUBufferUsage.UNIFORM)});
  const buf = (size: number, usage: number) => device.createBuffer({size, usage: usage | GPUBufferUsage.COPY_DST});
  const sets: Buffers[] = [], records: {pipeline: GPURenderPipeline; previous: GPUTexture | null; bind: GPUBindGroup; bundle?: GPURenderBundle; count?: number}[] = [];
  const written = new WeakMap<GPUBuffer, {bytes: Uint8Array; source: ArrayBufferView | null}>(), views = new WeakMap<GPUTexture, GPUTextureView>();
  const write = (buffer: GPUBuffer, data: ArrayBufferView) => {
    const old = written.get(buffer);
    if (old?.source === data) return;
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (old?.bytes.length === bytes.length && old.bytes.every((v, i) => v === bytes[i])) { old.source = data; return; }
    device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    written.set(buffer, {bytes: bytes.slice(), source: data});
  };
  const view = (t: GPUTexture) => { let v = views.get(t); if (!v) views.set(t, v = t.createView()); return v; };
  const padded = new WeakMap<Uint16Array, Uint8Array>();
  const recent: {key: string; draws: SDFDraw[]}[] = [];
  const drawsOf = (scene: SDFScene) => {
    const k = key(scene), i = recent.findIndex((r) => r.key === k);
    if (i >= 0) { const r = recent.splice(i, 1)[0]; recent.push(r); return r.draws; }
    const draws = sdfScene(scene);
    recent.push({key: k, draws});
    if (recent.length > 4) recent.shift();
    return draws;
  };
  return {
    encode(encoder: GPUCommandEncoder, {target, previous, ...scene}: SDFScene & {target: GPUTexture; previous: GPUTexture}) {
      const draws = drawsOf(scene), size = scene.size as [number, number];
      draws.forEach((draw, i) => {
        const union = isUnion(draw.kind), buffers = sets[i] ??= set(), pipeline = pipelines[KINDS.indexOf(draw.kind)];
        write(buffers.vertices, draw.vertices); write(buffers.vertexUniform, draw.vertexUniform); write(buffers.uniform, draw.uniform);
        let indices = padded.get(draw.indices);
        if (!indices) { indices = new Uint8Array(Math.ceil(draw.indices.byteLength / 4) * 4); indices.set(new Uint8Array(draw.indices.buffer, draw.indices.byteOffset, draw.indices.byteLength)); padded.set(draw.indices, indices); }
        write(buffers.indices, indices);
        if (union) encoder.copyTextureToTexture({texture: previous}, {texture: target}, size);
        const pass = encoder.beginRenderPass({colorAttachments: [{view: view(union ? target : previous), loadOp: i === 0 && !scene.unionFirst ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0]}]});
        let r = records[i];
        if (!r || r.pipeline !== pipeline || r.previous !== (union ? previous : null))
          r = records[i] = {pipeline, previous: union ? previous : null, bind: device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: buffers.vertexUniform}},
            {binding: 1, resource: {buffer: buffers.uniform}}, ...(union ? [{binding: 2, resource: view(previous)}] : [])]})};
        pass.setScissorRect(draw.scissor[0], draw.scissor[1], draw.scissor[2], draw.scissor[3]);
        if (!r.bundle || r.count !== draw.indices.length) {
          const b = device.createRenderBundleEncoder({colorFormats: ['rgba16float']});
          b.setPipeline(pipeline); b.setBindGroup(0, r.bind); b.setVertexBuffer(0, buffers.vertices); b.setIndexBuffer(buffers.indices, 'uint16'); b.drawIndexed(draw.indices.length);
          r.bundle = b.finish(); r.count = draw.indices.length;
        }
        pass.executeBundles([r.bundle]);
        pass.end();
        if (union && i < draws.length - 1) encoder.copyTextureToTexture({texture: target}, {texture: previous}, size);
      });
      if (!draws.some((d) => isUnion(d.kind))) encoder.copyTextureToTexture({texture: previous}, {texture: target}, size);
    },
    destroy() { records.length = 0; for (const s of sets) for (const b of Object.values(s)) b.destroy(); },
  };
}
