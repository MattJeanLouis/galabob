export class EntityBudget {
  constructor(limits = {}) {
    this.limits = Object.freeze({ ...limits });
    this.discarded = Object.create(null);
  }

  enforce(name, values) {
    const maximum = this.limits[name];
    if (!Array.isArray(values) || !Number.isInteger(maximum) || maximum < 0) return 0;
    const overflow = Math.max(0, values.length - maximum);
    if (!overflow) return 0;
    values.splice(0, overflow);
    this.discarded[name] = (this.discarded[name] || 0) + overflow;
    return overflow;
  }

  resetMetrics() {
    this.discarded = Object.create(null);
  }
}

