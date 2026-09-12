function hashSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;

  const text = String(value == null ? '' : value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function deriveSeed(...parts) {
  return hashSeed(parts.map((part) => String(part)).join('\u001f'));
}

export class SeededRandom {
  constructor(seed = 0) {
    this.reseed(seed);
  }

  reseed(seed) {
    this.seed = hashSeed(seed);
    this.state = this.seed;
    return this.seed;
  }

  next() {
    let value = this.state += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    this.state = this.state >>> 0;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }

  integer(maximum) {
    if (!Number.isInteger(maximum) || maximum <= 0) {
      throw new RangeError('La borne doit etre un entier strictement positif');
    }
    return Math.floor(this.next() * maximum);
  }

  pick(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    return values[this.integer(values.length)];
  }
}
