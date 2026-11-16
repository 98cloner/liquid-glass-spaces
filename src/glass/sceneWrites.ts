export type Rect = {x: number; y: number; w: number; h: number};
type Watch = (r: Rect) => void;

function subtract(a: Rect, b: Rect): Rect[] {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return [a];
  const out: Rect[] = [];
  if (y0 > a.y) out.push({x: a.x, y: a.y, w: a.w, h: y0 - a.y});
  if (y1 < a.y + a.h) out.push({x: a.x, y: y1, w: a.w, h: a.y + a.h - y1});
  if (x0 > a.x) out.push({x: a.x, y: y0, w: x0 - a.x, h: y1 - y0});
  if (x1 < a.x + a.w) out.push({x: x1, y: y0, w: a.x + a.w - x1, h: y1 - y0});
  return out;
}
export function uncovered(r: Rect, cover: Rect[]): Rect[] {
  let parts = [r];
  for (const c of cover) parts = parts.flatMap((p) => subtract(p, c));
  return parts.filter((p) => p.w > 0 && p.h > 0);
}
export const bbox = (rs: Rect[]): Rect | null => {
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
};
const clampTo = (r: Rect, w: number, h: number): Rect | null => {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y)), x1 = Math.min(w, Math.ceil(r.x + r.w)), y1 = Math.min(h, Math.ceil(r.y + r.h));
  return x1 > x0 && y1 > y0 ? {x: x0, y: y0, w: x1 - x0, h: y1 - y0} : null;
};

export class SceneWrites {
  private views = new WeakMap<GPUTextureView, GPUTexture>();
  private tracked = new WeakSet<GPUTexture>();
  private log = new Map<GPUTexture, {seq: number; r: Rect}[]>();
  private watches = new Map<GPUTexture, Set<Watch>>();
  private seq = 0;

  track(tex: GPUTexture) {
    if (this.tracked.has(tex)) return;
    this.tracked.add(tex);
    const own = tex.createView, views = this.views;
    (tex as unknown as {createView: GPUTexture['createView']}).createView = function (this: GPUTexture, d?: GPUTextureViewDescriptor) {
      const v = own.call(this, d);
      if (!d) views.set(v, this);
      return v;
    };
  }

  begin() { this.log.clear(); this.watches.clear(); }
  mark(tex: GPUTexture) { return this.log.get(tex)?.length ?? 0; }
  since(tex: GPUTexture, mark: number): Rect[] { return (this.log.get(tex) ?? []).slice(mark).map((e) => e.r); }
  watch(tex: GPUTexture, fn: Watch) {
    let s = this.watches.get(tex);
    if (!s) this.watches.set(tex, s = new Set());
    s.add(fn);
    return () => { s!.delete(fn); };
  }

  private write(tex: GPUTexture, r: Rect | null) {
    if (!r) return;
    for (const fn of [...(this.watches.get(tex) ?? [])]) fn(r);
    let l = this.log.get(tex);
    if (!l) this.log.set(tex, l = []);
    l.push({seq: this.seq++, r});
  }

  encoder(inner: GPUCommandEncoder): GPUCommandEncoder {
    const self = this;
    return new Proxy(inner, {get(target, key) {
      if (key === 'beginRenderPass') return (d: GPURenderPassDescriptor) => {
        const a = [...d.colorAttachments][0], tex = a?.view instanceof GPUTextureView ? self.views.get(a.view) : undefined;
        if (!tex || [...d.colorAttachments].length !== 1) return target.beginRenderPass(d);
        return self.recordPass(target, d, tex, a!.loadOp === 'clear');
      };
      if (key === 'copyTextureToTexture') return (src: GPUTexelCopyTextureInfo, dst: GPUTexelCopyTextureInfo, size: GPUExtent3DStrict) => {
        if (self.tracked.has(dst.texture)) {
          const [w, h] = Array.isArray(size) ? [size[0], size[1] ?? 1] : [(size as GPUExtent3DDict).width, (size as GPUExtent3DDict).height ?? 1];
          const o = dst.origin as number[] | undefined, ox = Array.isArray(o) ? o[0] ?? 0 : (o as GPUOrigin3DDict | undefined)?.x ?? 0, oy = Array.isArray(o) ? o[1] ?? 0 : (o as GPUOrigin3DDict | undefined)?.y ?? 0;
          self.write(dst.texture, clampTo({x: ox, y: oy, w, h}, dst.texture.width, dst.texture.height));
        }
        return target.copyTextureToTexture(src, dst, size);
      };
      const v = Reflect.get(target, key);
      return typeof v === 'function' ? v.bind(target) : v;
    }});
  }

  private recordPass(target: GPUCommandEncoder, d: GPURenderPassDescriptor, tex: GPUTexture, clear: boolean): GPURenderPassEncoder {
    const W = tex.width, H = tex.height, calls: [string, unknown[]][] = [];
    let scissor: Rect = {x: 0, y: 0, w: W, h: H}, viewport: Rect = {x: 0, y: 0, w: W, h: H}, region: Rect | null = clear ? {x: 0, y: 0, w: W, h: H} : null;
    const drawn = () => {
      const x0 = Math.max(scissor.x, viewport.x), y0 = Math.max(scissor.y, viewport.y), x1 = Math.min(scissor.x + scissor.w, viewport.x + viewport.w), y1 = Math.min(scissor.y + scissor.h, viewport.y + viewport.h);
      if (x1 <= x0 || y1 <= y0) return;
      const r = {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
      region = region ? bbox([region, r]) : r;
    };
    const rec: Record<string, unknown> = {label: d.label ?? ''};
    for (const k of ['setPipeline', 'setBindGroup', 'setVertexBuffer', 'setIndexBuffer', 'setBlendConstant', 'setStencilReference', 'pushDebugGroup', 'popDebugGroup', 'insertDebugMarker',
      'beginOcclusionQuery', 'endOcclusionQuery', 'executeBundles'])
      rec[k] = (...args: unknown[]) => { calls.push([k, args]); };
    rec.setScissorRect = (x: number, y: number, w: number, h: number) => { scissor = {x, y, w, h}; calls.push(['setScissorRect', [x, y, w, h]]); };
    rec.setViewport = (x: number, y: number, w: number, h: number, a: number, b: number) => { viewport = {x, y, w, h}; calls.push(['setViewport', [x, y, w, h, a, b]]); };
    for (const k of ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']) rec[k] = (...args: unknown[]) => { drawn(); calls.push([k, args]); };
    rec.end = () => {
      const r = region && clampTo(region, W, H);
      this.write(tex, r);
      const p = target.beginRenderPass({...d, label: r ? `${d.label ? d.label + ' ' : ''}${r.w}x${r.h}` : d.label}) as unknown as Record<string, (...a: unknown[]) => void>;
      for (const [k, args] of calls) p[k](...args);
      (p as unknown as GPURenderPassEncoder).end();
    };
    return rec as unknown as GPURenderPassEncoder;
  }
}
