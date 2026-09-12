export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_STORAGE_KEY = 'galabob.profile';

function cleanPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

export function createDefaultProfile() {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    selectedMode: 'arcade',
    selectedShip: null,
    unlocks: {
      ships: []
    },
    modes: {
      arcade: {
        highScore: 0,
        highestStage: 1
      }
    }
  };
}

function normalizeProfile(value, legacyHighScore) {
  const defaults = createDefaultProfile();
  const source = value && typeof value === 'object' ? value : {};
  const sourceUnlocks = source.unlocks && typeof source.unlocks === 'object' ? source.unlocks : {};
  const sourceModes = source.modes && typeof source.modes === 'object' ? source.modes : {};
  const arcade = sourceModes.arcade && typeof sourceModes.arcade === 'object'
    ? sourceModes.arcade
    : {};

  const ships = Array.isArray(sourceUnlocks.ships)
    ? [...new Set(sourceUnlocks.ships.filter(id => typeof id === 'string' && id.length > 0))]
    : defaults.unlocks.ships;
  const modes = { ...sourceModes };
  modes.arcade = {
    ...arcade,
    highScore: Math.max(
      cleanPositiveInteger(arcade.highScore, 0),
      cleanPositiveInteger(legacyHighScore, 0)
    ),
    highestStage: Math.max(1, cleanPositiveInteger(arcade.highestStage, 1))
  };

  return {
    ...defaults,
    ...source,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    selectedMode: typeof source.selectedMode === 'string' ? source.selectedMode : defaults.selectedMode,
    selectedShip: ships.includes(source.selectedShip) ? source.selectedShip : (ships[0] || null),
    unlocks: { ...sourceUnlocks, ships },
    modes
  };
}

/** Stockage versionne, injectable et testable sans navigateur. */
export class ProfileStore {
  constructor(storage, { key = PROFILE_STORAGE_KEY } = {}) {
    this.storage = storage || null;
    this.key = key;
    this.data = createDefaultProfile();
  }

  load() {
    let parsed = null;
    let legacyHighScore = 0;
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw) parsed = JSON.parse(raw);
      legacyHighScore = this.storage?.getItem('highScore') || 0;
    } catch {
      // Un profil en memoire garde le jeu jouable si le stockage est bloque.
    }
    this.data = normalizeProfile(parsed, legacyHighScore);
    this.save();
    return this.data;
  }

  save() {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.data));
      return true;
    } catch {
      return false;
    }
  }

  mode(id) {
    return this.data.modes[id] || null;
  }

  updateMode(id, patch) {
    if (typeof id !== 'string' || !id) throw new TypeError('Identifiant de mode invalide');
    if (!patch || typeof patch !== 'object') throw new TypeError('Mise a jour de mode invalide');
    this.data.modes[id] = { ...(this.data.modes[id] || {}), ...patch };
    this.save();
    return this.data.modes[id];
  }

  unlockShip(id) {
    if (typeof id !== 'string' || !id) throw new TypeError('Identifiant de vaisseau invalide');
    if (!this.data.unlocks.ships.includes(id)) this.data.unlocks.ships.push(id);
    if (!this.data.selectedShip) this.data.selectedShip = id;
    this.save();
    return this.data.unlocks.ships;
  }

  selectShip(id) {
    if (!this.data.unlocks.ships.includes(id)) throw new Error(`Vaisseau verrouille : ${id}`);
    this.data.selectedShip = id;
    this.save();
    return id;
  }
}
