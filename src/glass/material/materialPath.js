const AGE = 0.33400000000000002, SIZE_STEP = 2;

export class MaterialPath {
  ages = [Infinity, Infinity, Infinity, Infinity];
  next = 0;
  lastChange = -Infinity;
  size = null;
  scale = null;
  eligible = true;
  pressing = false;

  invalidate(seconds) {
    this.ages.fill(0);
    this.lastChange = seconds;
    this.eligible = false;
  }

  update(seconds, size, scale) {
    const first = !this.size;
    let changed = first || Math.abs(size[0] - this.size[0]) >= SIZE_STEP || Math.abs(size[1] - this.size[1]) >= SIZE_STEP;
    if (changed) this.size = size;
    changed ||= !!this.scale && (scale[0] !== this.scale[0] || scale[1] !== this.scale[1]);
    this.scale = scale;
    this.ages[this.next] = seconds - this.lastChange;
    this.next = (this.next + 1) & 3;
    if (changed && this.size !== null && !first) this.lastChange = seconds;
    this.eligible = this.ages.every((age) => age > AGE);
    return this.eligible ? 'T' : 'A';
  }
}
