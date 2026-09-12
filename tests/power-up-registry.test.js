import test from 'node:test';
import assert from 'node:assert/strict';
import { PowerUpRegistry } from '../js/core/powerups/power-up-registry.js';

function definition(key, overrides = {}) {
  return {
    key,
    label: key.toUpperCase(),
    slot: 'weapon',
    weight: 10,
    duration: null,
    shape: { kind: 'poly' },
    ...overrides
  };
}

test('enregistre, fige et resout les power-ups et leurs alias', () => {
  const registry = new PowerUpRegistry();
  registry.register(definition('double'));
  registry.alias('twin-shot', 'double');

  assert.equal(registry.get('TWIN SHOT').key, 'double');
  assert.equal(registry.resolve('inconnu').key, 'double');
  assert.ok(Object.isFrozen(registry.get('double')));
  assert.ok(Object.isFrozen(registry.get('double').shape));
});

test('refuse les definitions invalides et les doublons', () => {
  const registry = new PowerUpRegistry();
  assert.throws(() => registry.register(definition('bad', { slot: 'pocket' })));
  registry.register(definition('double'));
  assert.throws(() => registry.register(definition('double')));
  assert.throws(() => registry.alias('ghost', 'absent'));
});

test('adapte les poids a la situation du joueur', () => {
  const registry = new PowerUpRegistry();
  const life = registry.register(definition('life', {
    slot: 'instant', weight: 3, duration: 0
  }));
  const shield = registry.register(definition('shield', {
    slot: 'shield', weight: 12, duration: 0
  }));

  assert.equal(registry.weight(life, { lives: 5 }), 0);
  assert.equal(registry.weight(life, { lives: 1 }), 9);
  assert.ok(Math.abs(registry.weight(shield, { shield: 0, shieldMax: 3 }) - 16.8) < 1e-9);
  assert.ok(Math.abs(registry.weight(shield, { shield: 3, shieldMax: 3 }) - 1.8) < 1e-9);
});

test('effectue un tirage pondere avec une source aleatoire injectable', () => {
  const registry = new PowerUpRegistry();
  registry.register(definition('double', { weight: 1 }));
  registry.register(definition('laser', { weight: 3 }));

  assert.equal(registry.weightedRoll({}, () => 0), 'double');
  assert.equal(registry.weightedRoll({}, () => 0.99), 'laser');
});
