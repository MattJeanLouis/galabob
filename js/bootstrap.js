import { ComboTracker } from './core/combo-tracker.js';
import { EntityBudget } from './core/entity-budget.js';
import { GameModeRegistry } from './core/modes/game-mode-registry.js';
import { ProfileStore } from './core/profile-store.js';
import { PowerUpRegistry } from './core/powerups/power-up-registry.js';
import { deriveSeed, SeededRandom } from './core/random/seeded-random.js';
import { ShipRegistry } from './core/ships/ship-registry.js';
import { ShipRendererRegistry } from './core/ships/ship-renderer-registry.js';
import { ProgressionRegistry } from './core/stages/progression-registry.js';
import { CLASSIC_SHIP } from './content/ships/classic.js';
import { INTERCEPTOR_SHIP } from './content/ships/interceptor.js';
import { BASTION_SHIP } from './content/ships/bastion.js';
import { createArcadeMode } from './modes/arcade.js';
import { createAssaultMode } from './modes/assault.js';

const tempo = window.TEMPO;
if (!tempo) throw new Error('TEMPO doit etre charge avant le bootstrap');

const progressions = new ProgressionRegistry();
const arcadeProgression = progressions.register('arcade', window.GALABOB_ARCADE_PROGRESSION);
const assaultProgression = progressions.register('assault', window.GALABOB_ASSAULT_PROGRESSION);

const modes = new GameModeRegistry();
modes.register(createArcadeMode(arcadeProgression));
modes.register(createAssaultMode(assaultProgression));
modes.activate('arcade');

let browserStorage = null;
try { browserStorage = window.localStorage; } catch { /* stockage indisponible */ }
const profile = new ProfileStore(browserStorage);
profile.load();

const ships = new ShipRegistry();
ships.register(CLASSIC_SHIP);
ships.register(INTERCEPTOR_SHIP);
ships.register(BASTION_SHIP);
for (const ship of ships.list()) profile.unlockShip(ship.id);

const shipRenderers = new ShipRendererRegistry();
shipRenderers.register('legacy-vector', (context, state) => {
  if (typeof window.drawClassicPlayerHull !== 'function') {
    throw new Error('Rendu du vaisseau classique indisponible');
  }
  window.drawClassicPlayerHull(context, state);
});
shipRenderers.register('interceptor-vector', (context, state) => {
  if (typeof window.drawInterceptorPlayerHull !== 'function') throw new Error('Rendu Intercepteur indisponible');
  window.drawInterceptorPlayerHull(context, state);
});
shipRenderers.register('bastion-vector', (context, state) => {
  if (typeof window.drawBastionPlayerHull !== 'function') throw new Error('Rendu Bastion indisponible');
  window.drawBastionPlayerHull(context, state);
});

const powerUps = new PowerUpRegistry();
for (const definition of window.POWERUP_TYPES || []) powerUps.register(definition);
for (const [alias, target] of Object.entries(window.POWERUP_ALIASES || {})) {
  powerUps.alias(alias, target);
}

function entropySeed() {
  try {
    const seed = new Uint32Array(1);
    window.crypto.getRandomValues(seed);
    return seed[0];
  } catch {
    const highResolutionTime = window.performance && typeof window.performance.now === 'function'
      ? window.performance.now()
      : 0;
    return (Date.now() ^ Math.floor(highResolutionTime * 1000)) >>> 0;
  }
}

const random = new SeededRandom(entropySeed());
const entityBudget = new EntityBudget({
  explosions: 128,
  debris: 180,
  scorePopups: 36,
  powerUps: 24,
  powerUpPickups: 32,
  multiplierSparks: 96,
  bombWaves: 4
});

const runtime = {
  version: 1,
  modes,
  progressions,
  profile,
  ships,
  shipRenderers,
  powerUps,
  random,
  entityBudget,
  runSeed: random.seed,
  newRunSeed(seed = entropySeed()) {
    this.runSeed = random.reseed(seed);
    this.stageSeed = null;
    return this.runSeed;
  },
  beginStageRandom(stage, loop = 0) {
    const mode = modes.current();
    this.stageSeed = deriveSeed(this.runSeed, mode ? mode.id : 'arcade', stage, loop);
    random.reseed(this.stageSeed);
    return this.stageSeed;
  },
  selectNextShip(direction = 1) {
    const available = ships.list().filter((ship) => profile.data.unlockedShips.includes(ship.id));
    if (!available.length) return null;
    const current = available.findIndex((ship) => ship.id === profile.data.selectedShip);
    const next = (Math.max(0, current) + (direction < 0 ? -1 : 1) + available.length) % available.length;
    profile.selectShip(available[next].id);
    return available[next];
  },
  selectNextMode(direction = 1) {
    const available = modes.list();
    const current = available.findIndex((mode) => mode.id === modes.current()?.id);
    const next = (Math.max(0, current) + (direction < 0 ? -1 : 1) + available.length) % available.length;
    return modes.activate(available[next].id);
  },
  combo: new ComboTracker({
    windowMs: tempo.COMBO_WINDOW_MS,
    maximum: tempo.COMBO_MAX
  })
};

// Pont temporaire vers les scripts historiques. Les nouveaux modules importent
// leurs dependances ; les anciens peuvent migrer un par un via ce seul objet.
window.GALABOB = runtime;
window.dispatchEvent(new CustomEvent('galabob:runtime-ready', {
  detail: { version: runtime.version, mode: modes.current().id }
}));
