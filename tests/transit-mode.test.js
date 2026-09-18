import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function runtime(input = {}) {
  const window = { matchMedia: () => ({ matches: false }) };
  const controls = {
    x: 0, y: 0, firing: false,
    axisX() { return this.x; },
    axisY() { return this.y; },
    shoot() { return this.firing; },
    shootBuffered: () => false,
    consumeShoot() {},
    reset() {},
    ...input
  };
  const context = vm.createContext({ window, CANVAS_WIDTH: 1200, CANVAS_HEIGHT: 800, INPUT: controls });
  vm.runInContext(readFileSync(new URL('../js/modes/transit.js', import.meta.url), 'utf8'), context);
  return { transit: window.TRANSIT, controls };
}

test('le transit démarre comme une poursuite sur rail avec formations et obstacles', () => {
  const { transit, controls } = runtime();
  assert.equal(transit.start({ stage: 5, nextStage: 6, loop: 0, mode: 'arcade' }), true);
  const state = transit.debug();
  assert.equal(transit.isActive(), true);
  assert.equal(state.phase, 'chase');
  assert.ok(state.enemies.length >= 5);
  assert.equal(state.asteroids.length, 9);
  const hazards = state.asteroids.filter((asteroid) => asteroid.hazard);
  assert.equal(hazards.length, 3);
  assert.ok(hazards.every((asteroid) => asteroid.r <= 7 && Math.abs(asteroid.x) === 19));
  assert.equal(state.route.distance, 0);

  // La route avance seule, mais le joueur reste maître de sa place dans le cadre.
  controls.x = 1;
  controls.y = -1;
  for (let i = 0; i < 20; i++) transit.update(50);
  assert.equal(transit.isComplete(), false);
  assert.ok(state.route.distance > 300);
  assert.ok(state.ship.x > 0);
  assert.ok(state.ship.y > 0);

  // Les appareils conservent leur dessin relatif au lieu de se disperser.
  const firstWave = state.enemies.filter((enemy) => enemy.waveId === 0);
  const offsets = firstWave.map((enemy) => enemy.x - enemy.baseX);
  assert.ok(Math.max(...offsets) - Math.min(...offsets) < 5);

  // Relâcher rend immédiatement la main, sans inertie d'avion.
  controls.x = 0;
  controls.y = 0;
  transit.update(50);
  assert.equal(state.ship.vx, 0);
  assert.equal(state.ship.vy, 0);
});

test('les tirs ennemis restent des salves évitables', () => {
  const { transit } = runtime();
  transit.start({ stage: 5, nextStage: 6, mode: 'arcade' });
  const state = transit.debug();
  let maximum = 0;
  for (let i = 0; i < 320; i++) {
    transit.update(50);
    maximum = Math.max(maximum, state.enemyShots.length);
  }
  assert.ok(maximum > 0);
  assert.ok(maximum <= 7);
});

test('la route ne se termine qu’après le quota d’ennemis abattus', () => {
  const source = readFileSync(new URL('../js/modes/transit.js', import.meta.url), 'utf8');
  const target = Number(source.match(/const KILL_TARGET = (\d+)/)[1]);
  assert.ok(target > 0, 'le quota doit être défini dans la source');

  const { transit } = runtime();
  transit.start({ stage: 10, nextStage: 11, mode: 'assault' });
  const state = transit.debug();

  // Un seul verrou : le nombre d'appareils détruits. Aucune cible prioritaire
  // ne doit plus retenir la sortie.
  assert.equal(state.kills, 0);

  // On laisse la route atteindre son terme, puis on se place juste sous le
  // quota : la poursuite doit se maintenir.
  state.route.distance = 21999;
  transit.update(16);
  state.kills = target - 1;
  transit.update(16);
  assert.notEqual(state.phase, 'jump');
  assert.equal(transit.isComplete(), false);
  assert.match(state.message, /POURSUITE MAINTENUE/);
  assert.doesNotMatch(state.message, /CIBLE PRIORITAIRE/);

  // Le quota atteint, la sortie part immédiatement.
  state.kills = target;
  transit.update(16);
  assert.equal(state.phase, 'jump');
  assert.match(state.message, /OBJECTIF ATTEINT/);
  for (let i = 0; i < 140; i++) transit.update(16);
  assert.equal(transit.isComplete(), true);

  // Le HUD ne doit plus jamais parler de cible prioritaire.
  assert.doesNotMatch(source, /CIBLE PRIORITAIRE/);
  assert.doesNotMatch(source, /CIBLES PRIORITAIRES/);
  assert.match(source, /ÉLIMINÉS/);
});

test('reset interrompt proprement une mission', () => {
  const { transit } = runtime();
  transit.start({ stage: 10, nextStage: 11, mode: 'assault' });
  transit.update(500);
  transit.reset();
  assert.equal(transit.isActive(), false);
  assert.equal(transit.isComplete(), false);
});
