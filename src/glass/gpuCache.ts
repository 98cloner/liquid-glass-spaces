const FRAMES = 3, IDLE = 60;

export type DeviceCache = {frame(): void; stats(): {bindGroups: number}};

export function cacheDevice(device: GPUDevice): DeviceCache {
  const ids = new WeakMap<object, number>();
  let next = 1;
  const id = (o: object) => { let v = ids.get(o); if (v === undefined) ids.set(o, v = next++); return v; };

  const createTexture = device.createTexture.bind(device);
  device.createTexture = (d: GPUTextureDescriptor) => {
    const tex = createTexture(d), own = tex.createView.bind(tex), views = new Map<string, GPUTextureView>();
    tex.createView = (vd?: GPUTextureViewDescriptor) => {
      const key = vd ? JSON.stringify(vd) : '';
      let v = views.get(key);
      if (!v) views.set(key, v = own(vd));
      return v;
    };
    return tex;
  };

  const layouts = <P extends GPURenderPipeline | GPUComputePipeline>(p: P): P => {
    const own = p.getBindGroupLayout.bind(p), byIndex = new Map<number, GPUBindGroupLayout>();
    p.getBindGroupLayout = (i: number) => { let l = byIndex.get(i); if (!l) byIndex.set(i, l = own(i)); return l; };
    return p;
  };
  const crp = device.createRenderPipeline.bind(device), crpa = device.createRenderPipelineAsync.bind(device);
  const ccp = device.createComputePipeline.bind(device), ccpa = device.createComputePipelineAsync.bind(device);
  device.createRenderPipeline = (d) => layouts(crp(d));
  device.createRenderPipelineAsync = (d) => crpa(d).then(layouts);
  device.createComputePipeline = (d) => layouts(ccp(d));
  device.createComputePipelineAsync = (d) => ccpa(d).then(layouts);

  const groups = new Map<string, {group: GPUBindGroup; used: number}>();
  let frame = 0;
  const createBindGroup = device.createBindGroup.bind(device);
  device.createBindGroup = (d: GPUBindGroupDescriptor) => {
    let key = `${id(d.layout)}`;
    for (const e of d.entries) {
      const r = e.resource as GPUBindingResource & {buffer?: GPUBuffer; offset?: number; size?: number};
      key += r && typeof r === 'object' && 'buffer' in r && r.buffer ? `|${e.binding}:b${id(r.buffer)}+${r.offset ?? 0}+${r.size ?? ''}` : `|${e.binding}:${id(r as object)}`;
    }
    const known = groups.get(key);
    if (known) { known.used = frame; return known.group; }
    const group = createBindGroup(d);
    groups.set(key, {group, used: frame});
    return group;
  };

  return {
    frame() {
      frame++;
      for (const [k, g] of groups) if (frame - g.used > FRAMES) groups.delete(k);
    },
    stats: () => ({bindGroups: groups.size}),
  };
}

export function uniformPool(device: GPUDevice) {
  const free = new Map<number, {buffer: GPUBuffer; since: number}[]>(), used: GPUBuffer[] = [];
  let paint = 0;
  return {
    take(size: number) {
      const kept = free.get(size)?.pop()?.buffer;
      if (kept) device.queue.writeBuffer(kept, 0, new Uint8Array(size));
      const b = kept ?? device.createBuffer({size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
      used.push(b);
      return b;
    },
    recycle() {
      paint++;
      for (const b of used.splice(0)) { let l = free.get(b.size); if (!l) free.set(b.size, l = []); l.push({buffer: b, since: paint}); }
      for (const l of free.values()) while (l.length && paint - l[0].since > IDLE) l.shift()!.buffer.destroy();
    },
  };
}
