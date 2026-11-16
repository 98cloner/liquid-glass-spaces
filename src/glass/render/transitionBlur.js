const E={box4VarianceThreshold:5.5*5.5,box2VarianceThreshold:3.5*3.5,compensation:{2:1.75,4:2.75},pairWeightCutoff:.002,capability:27,maxSide:13},f32=Math.fround;
function transitionBlurDownsampleForVariance(variance){
 if(variance>E.box4VarianceThreshold)return 4;
 if(variance>E.box2VarianceThreshold)return 2;
 return 1;
}
function transitionBlurKernel(variance,capability=E.capability){
 const cap=Math.max(15,Math.min(27,capability));
 const g=[];for(let i=0;i<=E.maxSide;i++)g.push(Math.exp(-.5*i*i/variance));
 const total=g[0]+2*g.slice(1).reduce((a,b)=>a+b,0),n=g.map(v=>v/total);
 const pairs=[{w:n[0]/2+n[1],o:n[1]/(n[0]/2+n[1])}];
 for(let i=2;i+1<=E.maxSide;i+=2){const w=n[i]+n[i+1];pairs.push({w,o:w>0?(i*n[i]+(i+1)*n[i+1])/w:i});}
 const allowed=pairs.map((p,k)=>k<4||cap>=4*k+3);
 let dropped=0;const kept=[];
 pairs.forEach((p,k)=>{if(k>0&&(!allowed[k]||p.w<E.pairWeightCutoff)){dropped+=p.w;kept.push(null);}else kept.push(p);});
 let last=0;kept.forEach((p,k)=>{if(p)last=k;});
 const weights=[],offsets=[];
 for(let k=0;k<=last;k++){const p=kept[k];weights.push(f32(p?p.w+(k===0?dropped:0):0));offsets.push(f32(p?p.o:0));}
 return {taps:4*last+3,weights,offsets};
}
export function transitionBlurPlan(radius,scale){
 if(!(radius>0)||!(scale>0))return null;
 const sigma=f32(radius*scale),physical=f32(sigma*sigma),downsample=transitionBlurDownsampleForVariance(physical);
 const s=downsample===1?0:E.compensation[downsample];
 const variance=Math.max(downsample===1?physical:(physical-s*s)/(downsample*downsample),1e-6);
 return {sigma,downsample,variance,...transitionBlurKernel(variance)};
}

const WGSL= `
struct U {size:vec4f,valid:vec4f,axis:vec4f,weights:array<vec4f,2>,offsets:array<vec4f,2>};
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var image:texture_2d<f32>;
@group(0) @binding(2) var linearSampler:sampler;
struct V{@builtin(position) position:vec4f};
@vertex fn vertex(@builtin(vertex_index) i:u32)->V {let q=vec2f(f32((i<<1u)&2u),f32(i&2u));var o:V;o.position=vec4f(q*vec2f(2,-2)+vec2f(-1,1),0,1);return o;}
fn lin(uv:vec2f)->vec4f {return textureSampleLevel(image,linearSampler,clamp(uv,u.valid.xy,u.valid.zw),0);}
@fragment fn downsample4(v:V)->@location(0) vec4f {
 let c=v.position.xy*u.size.zw/u.size.xy;let d=1/u.size.xy;
 return .25*(lin(c+vec2f(-d.x,d.y))+lin(c+vec2f(d.x,d.y))+lin(c+vec2f(-d.x,-d.y))+lin(c+vec2f(d.x,-d.y)));
}
@fragment fn downsample2(v:V)->@location(0) vec4f {return lin(v.position.xy*u.size.zw/u.size.xy);}
@fragment fn reconstruct(v:V)->@location(0) vec4f {return lin(v.position.xy*u.size.zw/u.size.xy);}
@fragment fn gaussian(v:V)->@location(0) vec4f {
 let c=v.position.xy*u.size.zw/u.size.xy;let step=u.axis.xy/u.size.xy;var sum=vec4f(0);
 for(var i=0;i<8;i++){let w=u.weights[i/4][i%4];if(w==0){continue;}let o=u.offsets[i/4][i%4];sum+=w*(lin(c-step*o)+lin(c+step*o));}
 return sum;
}`;

export function createCATransitionBlur(device,format='bgra8unorm'){
 const module=device.createShaderModule({label:'CA transition gaussian blur',code:WGSL});
 const pipeline=entryPoint=>device.createRenderPipeline({label:`CA transition blur ${entryPoint}`,layout:'auto',vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint,targets:[{format}]}});
 const pipes={downsample4:pipeline('downsample4'),downsample2:pipeline('downsample2'),gaussian:pipeline('gaussian'),reconstruct:pipeline('reconstruct')};
 const sampler=device.createSampler({minFilter:'linear',magFilter:'linear'}),entries=new Map();
 const texture=(entry,name,size)=>{let t=entry[name];if(!t||t.width!==size[0]||t.height!==size[1]){t?.destroy();t=entry[name]=device.createTexture({label:`transition blur ${name}`,size,format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT});}return t;};
 function encode({encoder,source,valid=[source.width,source.height],plan,id}){
  let entry=entries.get(id);if(!entry){entry={buffers:[0,1,2,3].map(()=>device.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}))};entries.set(id,entry);}
  const full=[source.width,source.height],ds=plan.downsample,reduced=valid.map(n=>Math.ceil(n/ds));
  const weights=[...plan.weights,...Array(8).fill(0)].slice(0,8),offsets=[...plan.offsets,...Array(8).fill(0)].slice(0,8);
  const draw=(index,pipelineName,input,inputValid,target,perPixel,axis=[0,0])=>{
   const size=[input.width,input.height];
   device.queue.writeBuffer(entry.buffers[index],0,new Float32Array([...size,...perPixel,.5/size[0],.5/size[1],(inputValid[0]-.5)/size[0],(inputValid[1]-.5)/size[1],...axis,0,0,...weights,...offsets]));
   const p=pipes[pipelineName];
   const pass=encoder.beginRenderPass({label:`transition blur ${pipelineName}`,colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}]});
   pass.setPipeline(p);pass.setBindGroup(0,device.createBindGroup({layout:p.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:entry.buffers[index]}},{binding:1,resource:input.createView()},{binding:2,resource:sampler}]}));pass.draw(3);pass.end();
  };
  let input=source,inputValid=valid;
  if(ds>1){const down=texture(entry,'down',reduced);draw(0,ds===4?'downsample4':'downsample2',source,valid,down,[ds,ds]);input=down;inputValid=reduced;}
  const horizontal=texture(entry,'horizontal',ds>1?reduced:full);
  draw(1,'gaussian',input,inputValid,horizontal,[1,1],[1,0]);
  if(ds===1){const output=texture(entry,'output',full);draw(2,'gaussian',horizontal,valid,output,[1,1],[0,1]);return {texture:output,plan};}
  const vertical=texture(entry,'vertical',reduced);
  draw(2,'gaussian',horizontal,reduced,vertical,[1,1],[0,1]);
  const output=texture(entry,'output',full);
  draw(3,'reconstruct',vertical,reduced,output,[1/ds,1/ds]);
  return {texture:output,plan};
 }
 return {encode,retain(ids){for(const [id,e]of entries)if(!ids.has(id)){for(const k of ['down','horizontal','vertical','output'])e[k]?.destroy();e.buffers.forEach(b=>b.destroy());entries.delete(id);}},
  destroy(){for(const e of entries.values()){for(const k of ['down','horizontal','vertical','output'])e[k]?.destroy();e.buffers.forEach(b=>b.destroy());}entries.clear();}};
}
