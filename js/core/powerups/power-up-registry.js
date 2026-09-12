const POWER_UP_SLOTS = new Set(['weapon', 'shield', 'mod', 'instant']);

function normalizeKey(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[\s._\-/]/g, '');
}

function validateDefinition(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new TypeError('La definition du power-up doit etre un objet');
  }
  if (!normalizeKey(definition.key)) throw new TypeError('Le power-up doit avoir un identifiant');
  if (typeof definition.label !== 'string' || !definition.label.trim()) {
    throw new TypeError('Le power-up doit avoir un libelle');
  }
  if (!POWER_UP_SLOTS.has(definition.slot)) {
    throw new TypeError('Emplacement de power-up invalide: ' + definition.slot);
  }
  if (!Number.isFinite(definition.weight) || definition.weight < 0) {
    throw new TypeError('Le poids du power-up doit etre positif ou nul');
  }
  if (definition.duration !== null &&
      (!Number.isFinite(definition.duration) || definition.duration < 0)) {
    throw new TypeError('La duree du power-up doit etre positive, nulle ou null');
  }
  if (!definition.shape || typeof definition.shape !== 'object') {
    throw new TypeError('Le power-up doit definir une forme');
  }
}

function contextualWeight(definition, context) {
  const base = Number(definition.weight) || 0;
  if (base <= 0) return 0;

  if (definition.key === 'life') {
    const lives = Number(context.lives);
    if (!Number.isFinite(lives)) return base;
    if (lives >= 5) return 0;
    if (lives <= 1) return base * 3;
    if (lives === 2) return base * 1.8;
  }

  if (definition.slot === 'shield') {
    const shield = Number(context.shield);
    const maximum = Number.isFinite(Number(context.shieldMax))
      ? Number(context.shieldMax)
      : 3;
    if (!Number.isFinite(shield)) return base;
    if (shield >= maximum) return base * 0.15;
    if (shield === 0) return base * 1.4;
  }

  if (definition.slot === 'weapon' && context.weapon === definition.key) {
    return Number(context.weaponLevel) >= 3 ? base * 0.35 : base * 0.8;
  }

  return base;
}

export class PowerUpRegistry {
  #definitions = new Map();
  #aliases = new Map();

  register(definition) {
    validateDefinition(definition);
    const key = normalizeKey(definition.key);
    if (this.#definitions.has(key)) throw new Error('Power-up deja enregistre: ' + key);

    const stored = Object.freeze({
      ...definition,
      key,
      shape: Object.freeze({ ...definition.shape })
    });
    this.#definitions.set(key, stored);
    return stored;
  }

  alias(alias, target) {
    const aliasKey = normalizeKey(alias);
    const targetKey = normalizeKey(target);
    if (!aliasKey) throw new TypeError('Alias de power-up invalide');
    if (!this.#definitions.has(targetKey)) throw new Error('Power-up cible inconnu: ' + target);
    this.#aliases.set(aliasKey, targetKey);
    return this;
  }

  get(key) {
    const normalized = normalizeKey(key);
    return this.#definitions.get(normalized) ||
      this.#definitions.get(this.#aliases.get(normalized)) || null;
  }

  resolve(value, fallback = 'double') {
    if (value && typeof value === 'object' && value.key) {
      return this.get(value.key) || value;
    }
    return this.get(value) || this.get(fallback);
  }

  list() {
    return Array.from(this.#definitions.values());
  }

  weight(definition, context = {}) {
    return contextualWeight(definition, context);
  }

  weightedRoll(context = {}, random = Math.random) {
    const definitions = this.list();
    const weights = definitions.map((definition) => this.weight(definition, context));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!(total > 0)) return this.resolve(null)?.key || null;

    const sample = Number(random());
    let cursor = Math.min(Math.max(Number.isFinite(sample) ? sample : 0, 0), 1 - Number.EPSILON) * total;
    for (let index = 0; index < definitions.length; index++) {
      cursor -= weights[index];
      if (cursor <= 0) return definitions[index].key;
    }
    return definitions[definitions.length - 1].key;
  }
}

