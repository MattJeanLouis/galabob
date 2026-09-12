const SHIP_ID = /^[a-z][a-z0-9-]*$/;

function positiveNumber(value, name) {
  const number = Number(value);
  if (!(number > 0)) throw new TypeError(`${name} doit etre positif`);
  return number;
}

function normalizeShip(definition) {
  if (!definition || typeof definition !== 'object') throw new TypeError('Vaisseau invalide');
  if (!SHIP_ID.test(definition.id || '')) throw new TypeError('Identifiant de vaisseau invalide');
  if (typeof definition.label !== 'string' || !definition.label.trim()) {
    throw new TypeError('Libelle de vaisseau invalide');
  }
  const renderer = definition.renderer || 'legacy-vector';
  if (!SHIP_ID.test(renderer)) throw new TypeError('Identifiant de rendu invalide');

  const stats = definition.stats || {};
  return Object.freeze({
    ...definition,
    label: definition.label.trim(),
    renderer,
    stats: Object.freeze({
      speedMultiplier: positiveNumber(stats.speedMultiplier ?? 1, 'speedMultiplier'),
      fireRateMultiplier: positiveNumber(stats.fireRateMultiplier ?? 1, 'fireRateMultiplier'),
      hitboxMultiplier: positiveNumber(stats.hitboxMultiplier ?? 1, 'hitboxMultiplier')
    })
  });
}

/** Catalogue de vaisseaux independant du rendu et de la sauvegarde. */
export class ShipRegistry {
  #ships = new Map();

  register(definition) {
    const ship = normalizeShip(definition);
    if (this.#ships.has(ship.id)) throw new Error(`Vaisseau deja enregistre : ${ship.id}`);
    this.#ships.set(ship.id, ship);
    return ship;
  }

  get(id) {
    return this.#ships.get(id) || null;
  }

  list() {
    return [...this.#ships.values()];
  }
}
