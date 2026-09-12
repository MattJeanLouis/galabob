import test from 'node:test';
import assert from 'node:assert/strict';
import { ShipRendererRegistry } from '../js/core/ships/ship-renderer-registry.js';

test('selectionne un rendu de vaisseau par identifiant', () => {
  const registry = new ShipRendererRegistry();
  const calls = [];
  registry.register('legacy-vector', (context, state) => calls.push({ context, state }));

  assert.equal(registry.draw('legacy-vector', 'ctx', { charge: 1 }), true);
  assert.deepEqual(calls, [{ context: 'ctx', state: { charge: 1 } }]);
  assert.equal(registry.draw('absent', 'ctx', {}), false);
});

test('refuse un rendu invalide ou duplique', () => {
  const registry = new ShipRendererRegistry();
  assert.throws(() => registry.register('Bad renderer', () => {}));
  assert.throws(() => registry.register('classic', null));
  registry.register('classic', () => {});
  assert.throws(() => registry.register('classic', () => {}));
});

test('un rendu en erreur laisse le moteur utiliser son repli', () => {
  const registry = new ShipRendererRegistry();
  registry.register('broken', () => { throw new Error('boom'); });

  assert.equal(registry.draw('broken', null, {}), false);
  assert.equal(registry.lastError.message, 'boom');
});
