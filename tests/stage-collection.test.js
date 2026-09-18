/**
 * La bombe appartient à SON stage, et les bonus de fin de stage se ramassent.
 *
 * Deux régressions couvertes :
 *   1. l'onde de choc d'une bombe (720 ms) survivait au délai de fin de stage
 *      (120 ms) et balayait les ennemis du stage suivant dès leur apparition,
 *      ce qui soldait plusieurs stages d'affilée sans que le joueur ait joué ;
 *   2. `initStage()` vide `powerUps` : tout bonus encore en l'air était perdu
 *      au changement de stage. Il est désormais aimanté vers le joueur avant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** Copies de configuration lues dans la source officielle, jamais devinées. */
function tempoFromConfig() {
  const source = read('js/core/config.js');
  const pick = (name) => {
    const found = source.match(new RegExp(`${name}\\s*:\\s*([0-9.]+)`));
    assert.ok(found, `TEMPO.${name} introuvable dans config.js`);
    return Number(found[1]);
  };
  return { POWERUP_FALL_SPEED: pick('POWERUP_FALL_SPEED'), STAGE_COLLECT_MS: pick('STAGE_COLLECT_MS') };
}

/**
 * Banc d'essai des scripts classiques. Les modules déclarent en `const`/`let`,
 * donc leurs liaisons vivent dans le ROYAUME de la VM et non sur l'objet hôte :
 * après exécution on récupère les vraies références (tableaux compris) depuis
 * `globalThis` du contexte. Sans cela on observerait des copies fantômes.
 */
function sandbox() {
  const tempo = tempoFromConfig();
  const hostWindow = { matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} };
  const player = { x: 200, y: 700, width: 40, height: 24, lives: 3, weapon: 'normal', shield: 0 };
  const frame = { time: 10, dtMs: 16, dt: 0.016 };
  const enemies = [];

  const context = vm.createContext({
    console, document: { getElementById: () => null },
    setTimeout, clearTimeout, setInterval, clearInterval,
    player, FRAME: frame,
    CANVAS_WIDTH: 1200, CANVAS_HEIGHT: 800,
    TEMPO: tempo,
    POWERUP_SIZE: 26, POWERUP_WOBBLE_HZ: 1.1, POWERUP_WOBBLE_AMP: 26,
    POWERUP_DROP_CHANCE: 0.15,
    PALETTE: { get: () => ({ glow: '#fff', burst: '#fff' }), enemy: () => ({ burst: '#fff', glow: '#fff' }) },
    JUICE: { preset() {}, flash() {}, hitstop() {}, shake() {}, punch() {}, isFrozen: () => false, step: (ms) => ms },
    NEON: new Proxy({}, { get: () => () => {} }),
    SFX: { play: () => false }, audioConfig: null,
    gameEvent() {}, createDebris() {}, createExplosion() {}, createEmbers() {},
    createImpactSparks() {}, createScorePopup() {}, createShockwave() {},
    applyPlayerDamageToEnemy() { return false; }, killEnemyAt() { return 0; },
    setPlayerWeapon() {}, addPlayerShield() {}, addPlayerMod() {}, playerHasMod: () => false,
    ensurePowerUpBridges() {}, clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t, smoothstep: (x) => x * x * (3 - 2 * x),
    score: 0, comboCount: 0, comboTimer: 0,
    playerMagnetRange: () => 120, playerMagnetPull: () => 1400,
    // Décor de stage : sans ces fabriques, initStage s'arrêterait avant d'avoir
    // purgé l'onde — c'est justement ce que le test doit observer.
    createFormation() { enemies.push({ x: 0, y: 0, width: 30, height: 24, hp: 1 }); },
    createStars() {}, playRandomNarration() {}, installStageGovernor() {}, applyMenaceToTempo() {},
    createEnemy(x, y) {
      return { x, y, width: 30, height: 24, hp: 1, formationX: x, formationY: y, startX: x, startY: y };
    },
    ENEMY_PATTERNS: { FORMATION: 'formation' },
    // `enemies` appartient à game.js, qu'on ne charge pas : on le fournit pour
    // que la fabrique de décor ci-dessus puisse y écrire.
    enemies,
    enemySpeed: 1, enemyDirection: 1, enemyShotTimer: 0
  });

  const realm = vm.runInContext('globalThis', context);

  // Le catalogue et la progression sont des IIFE qui prennent `window` pour
  // global : on les invoque avec le global réel, d'où ce `window`-proxy aligné
  // sur le royaume — exactement comme le navigateur.
  context.window = new Proxy(hostWindow, {
    get(target, key) {
      if (typeof key === 'symbol' || key in target) return target[key];
      return Reflect.get(realm, key);
    }
  });

  vm.runInContext(`(function (window) {\n${read('js/content/powerups/catalogue.js')}\n})(globalThis);`, context);
  vm.runInContext(`(function (window) {\n${read('js/content/modes/arcade-progression.js')}\n})(globalThis);`, context);
  // utils.js porte damp/rectIntersect/dist2 : on teste les vraies implémentations.
  vm.runInContext(read('js/utils.js'), context);
  vm.runInContext(read('js/entities/powerups.js'), context);
  vm.runInContext(read('js/core/stages.js'), context);

  assert.ok(Array.isArray(realm.GALABOB_POWER_UP_CATALOGUE), 'le catalogue doit être chargé');
  assert.ok(realm.GALABOB_ARCADE_PROGRESSION, 'la progression Arcade doit être chargée');

  // `const`/`let` de haut niveau ne sont PAS des propriétés du global : on lit
  // les liaisons réelles par évaluation, en renvoyant les références.
  const bindings = vm.runInContext('({ powerUps, bombWaves, stageSystem })', context);
  const call = (expression, ...args) => vm.runInContext(expression, context)(...args);
  return {
    context, realm, player, tempo,
    powerUps: bindings.powerUps,
    bombWaves: bindings.bombWaves,
    stageSystem: bindings.stageSystem,
    updatePowerUps: (ms) => call('updatePowerUps', ms),
    resetStageBlast: () => call('resetStageBlast'),
    beginPowerUpCollection: () => call('beginPowerUpCollection'),
    completePowerUpCollection: () => call('completePowerUpCollection'),
    consumePowerUpCollection: () => call('consumePowerUpCollection'),
    isPowerUpCollectionActive: () => call('isPowerUpCollectionActive')
  };
}

const distance = (box, player) =>
  Math.hypot(box.x + 13 - (player.x + player.width / 2), box.y + 13 - (player.y + player.height / 2));

function makePowerUp() {
  return { x: 900, y: 40, width: 26, height: 26, vx: 0, vy: 0, age: 0, spin: 0, spinRate: 1.8, phase: 0 };
}

test('une onde de choc ne franchit jamais un changement de stage', () => {
  const bench = sandbox();
  assert.equal(typeof bench.resetStageBlast, 'function', 'resetStageBlast doit exister');

  bench.bombWaves.push({ x: 0, y: 0, r: 0, maxR: 1000, age: 0, life: 720, hits: [] });
  assert.equal(bench.bombWaves.length, 1);

  // `initStage` est le passage obligé de TOUS les chemins de stage suivant
  // (goToNextStage, forceNextStage, softResetStage) : la purge y est posée.
  assert.match(bench.stageSystem.initStage.toString(), /resetStageBlast\(\)/,
    'initStage doit purger l’onde héritée');
  assert.match(read('js/game.js'), /resetStageBlast\(\)/, 'la fin de stage doit purger l’onde active');

  bench.stageSystem.initStage();
  assert.equal(bench.bombWaves.length, 0, 'aucune onde ne doit survivre à l’entrée du stage suivant');
  assert.equal(bench.stageSystem.enemiesDefeated, 0, 'le compteur du nouveau stage repart de zéro');
});

test('sans ramassage actif, un bonus lointain reste hors de portée', () => {
  const bench = sandbox();
  const box = makePowerUp();
  bench.powerUps.push(box);
  assert.ok(distance(box, bench.player) > 120, 'le banc doit placer le bonus hors aimant');

  bench.updatePowerUps(16);
  assert.equal(bench.powerUps.length, 1, 'il ne doit pas être ramassé de loin');
  assert.equal(box.vx, 0, 'aucune attraction ne doit s’appliquer hors ramassage');
  assert.ok(box.vy > 0 && box.vy <= bench.tempo.POWERUP_FALL_SPEED,
    'il continue simplement de tomber, à la vitesse de chute prévue');
});

test('le ramassage de fin de stage attire les bonus et les encaisse', () => {
  const bench = sandbox();
  const box = makePowerUp();
  bench.powerUps.push(box);

  bench.beginPowerUpCollection();
  assert.equal(bench.isPowerUpCollectionActive(), true);
  assert.equal(bench.consumePowerUpCollection(), false, 'rien à consommer avant la fermeture');

  bench.updatePowerUps(16);
  assert.ok(bench.powerUps.length === 0 || distance(box, bench.player) < 1100,
    'le bonus doit fondre sur le joueur');

  let remaining = bench.tempo.STAGE_COLLECT_MS;
  while (bench.powerUps.length && remaining > 0) {
    bench.updatePowerUps(16);
    remaining -= 16;
  }
  assert.equal(bench.powerUps.length, 0, 'la fenêtre de ramassage doit vider le champ');
  assert.ok(remaining > 0, 'le ramassage doit tenir dans la fenêtre annoncée');

  bench.completePowerUpCollection();
  assert.equal(bench.consumePowerUpCollection(), true);
  assert.equal(bench.consumePowerUpCollection(), false, 'l’événement ne se consomme qu’une fois');
});

test('la transition attend le ramassage puis repart sur son délai normal', () => {
  const game = read('js/game.js');

  assert.match(game, /pendingCollectMs >= 0/, 'la boucle doit suivre la fenêtre de ramassage');
  assert.match(game, /beginPowerUpCollection\(\)/, 'la fin de stage doit ouvrir la fenêtre');
  assert.match(game, /consumePowerUpCollection\(\)/, 'la boucle doit réagir à sa fermeture');

  // La transition ne doit plus pouvoir partir pendant que le joueur ramasse.
  const collection = game.indexOf('pendingCollectMs >= 0');
  const transition = game.indexOf('if (pendingTransitionMs >= 0) {');
  assert.ok(collection >= 0 && transition > collection, 'le ramassage doit précéder la transition');

  // Aucun chemin de sortie ne doit laisser la fenêtre ouverte.
  assert.match(game, /pendingCollectMs = -1;\s*\n\s*resetPowerUpCollection/, 'le retour au menu doit annuler la fenêtre');
  assert.match(game, /pendingTransitionMs = -1;\s*\n\s*pendingCollectMs = -1;/, 'la boutique d’Assaut doit l’annuler aussi');

  // La fenêtre est ouverte AVANT les étapes susceptibles d'échouer : sans cela,
  // une erreur dans la clôture du stage la saute et la transition part aussitôt.
  const opened = game.indexOf('beginPowerUpCollection();');
  const risky = game.indexOf("JUICE.preset('stageClear')");
  assert.ok(opened > 0 && risky > opened, 'la fenêtre doit être ouverte avant les effets de fin de stage');
});
