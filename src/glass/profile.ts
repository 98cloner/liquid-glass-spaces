
type Stat = {gpu: number; passes: number; invalid: number; cpu: number};
type Slot = {set: GPUQuerySet; resolve: GPUBuffer; read: GPUBuffer; busy: boolean};
const CAPACITY = 1024;

export class FrameProfiler {
  private on = false;
  private label = 'prepare';
  private cpuAt = 0;
  private frameStart = 0;
  private slot: Slot | null = null;
  private labels: string[] = [];
  private details: string[] = [];
  private slots: Slot[] = [];
  private stats = new Map<string, Stat>();
  private frames: {gpu: number | null; cpu: number}[] = [];
  private untimed = 0;
  private record: {gpu: number | null; cpu: number} | null = null;

  constructor(private device: GPUDevice, private timestamps: boolean) {
    const w = window as unknown as {__glassProfileReport?: () => unknown; __glassProfileReset?: () => void};
    w.__glassProfileReport = () => this.report();
    w.__glassProfileReset = () => { this.stats.clear(); this.frames = []; this.untimed = 0; };
  }

  private get wanted() { return !!(window as unknown as {__glassProfile?: boolean}).__glassProfile; }
  private stat(label: string) { let s = this.stats.get(label); if (!s) this.stats.set(label, s = {gpu: 0, passes: 0, invalid: 0, cpu: 0}); return s; }

  begin() {
    this.on = this.wanted;
    if (!this.on) return;
    this.frameStart = this.cpuAt = performance.now();
    this.label = 'prepare';
    this.labels = [];
    this.details = [];
    this.record = {gpu: null, cpu: 0};
    this.slot = this.timestamps ? this.slots.find((s) => !s.busy) ?? (this.slots.length < 4 ? this.newSlot() : null) : null;
  }

  at(label: string): string {
    const prev = this.label;
    if (!this.on) return prev;
    const now = performance.now();
    this.stat(prev).cpu += now - this.cpuAt;
    this.cpuAt = now;
    this.label = label;
    return prev;
  }

  encoder(enc: GPUCommandEncoder): GPUCommandEncoder {
    if (!this.on || !this.slot) return enc;
    const timed = <D extends GPURenderPassDescriptor | GPUComputePassDescriptor>(d: D | undefined): D | undefined => {
      if (this.labels.length * 2 + 2 > CAPACITY) { this.untimed++; return d; }
      const i = this.labels.length;
      this.labels.push(this.label);
      this.details.push(d?.label ?? '');
      return {...(d ?? {}), timestampWrites: {querySet: this.slot!.set, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1}} as D;
    };
    return new Proxy(enc, {get: (target, key) => {
      if (key === 'beginRenderPass') return (d: GPURenderPassDescriptor) => target.beginRenderPass(timed(d)!);
      if (key === 'beginComputePass') return (d?: GPUComputePassDescriptor) => target.beginComputePass(timed(d));
      const v = Reflect.get(target, key);
      return typeof v === 'function' ? v.bind(target) : v;
    }});
  }

  end(enc: GPUCommandEncoder) {
    if (!this.on) return;
    this.at('present');
    if (this.slot && this.labels.length) {
      enc.resolveQuerySet(this.slot.set, 0, this.labels.length * 2, this.slot.resolve, 0);
      enc.copyBufferToBuffer(this.slot.resolve, 0, this.slot.read, 0, this.labels.length * 16);
    }
  }

  submitted() {
    if (!this.on) return;
    this.at('after');
    const slot = this.slot, labels = this.labels, details = this.details, record = this.record!;
    this.slot = null;
    if (!slot || !labels.length) return;
    slot.busy = true;
    slot.read.mapAsync(GPUMapMode.READ, 0, labels.length * 16).then(() => {
      const t = new BigUint64Array(slot.read.getMappedRange(0, labels.length * 16).slice(0));
      (window as unknown as {__glassProfileRaw?: unknown}).__glassProfileRaw = {labels, details, t: [...t].map(String)};
      slot.read.unmap();
      slot.busy = false;
      const t0 = t[0];
      let frontier = t0, first = true;
      for (let i = 0; i < labels.length; i++) {
        const b = t[2 * i], e = t[2 * i + 1], s = this.stat(labels[i]);
        s.passes++;
        if (e < b || b < t0) { s.invalid++; continue; }
        if (first) { frontier = b; first = false; }
        if (e > frontier) { s.gpu += Number(e - frontier) / 1e6; frontier = e; }
      }
      record.gpu = Number(frontier - t0) / 1e6;
    }, () => { slot.busy = false; });
  }

  finish() {
    if (!this.on || !this.record) return;
    this.at(this.label);
    this.record.cpu = performance.now() - this.frameStart;
    this.frames.push(this.record);
    if (this.frames.length > 2000) this.frames.shift();
    this.record = null;
  }

  private newSlot(): Slot {
    const s: Slot = {set: this.device.createQuerySet({type: 'timestamp', count: CAPACITY}),
      resolve: this.device.createBuffer({size: CAPACITY * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC}),
      read: this.device.createBuffer({size: CAPACITY * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST}), busy: false};
    this.slots.push(s);
    return s;
  }

  report() {
    const gpuFrames = this.frames.map((f) => f.gpu).filter((g): g is number => g !== null), n = Math.max(1, gpuFrames.length), m = Math.max(1, this.frames.length);
    const q = (a: number[], p: number) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3); };
    const stages = Object.fromEntries([...this.stats].sort((a, b) => b[1].gpu - a[1].gpu).map(([k, s]) => [k, {
      gpu: +(s.gpu / n).toFixed(3), passes: +(s.passes / n).toFixed(1), invalid: +(s.invalid / n).toFixed(1), cpu: +(s.cpu / m).toFixed(3)}]));
    return {frames: this.frames.length, timedFrames: gpuFrames.length, timestamps: this.timestamps, untimedPasses: this.untimed,
      gpuSpan: {median: q(gpuFrames, .5), p90: q(gpuFrames, .9)}, cpu: {median: q(this.frames.map((f) => f.cpu), .5), p90: q(this.frames.map((f) => f.cpu), .9)}, stages};
  }
}
