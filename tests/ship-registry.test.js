import test from 'node:test';
import assert from 'node:assert/strict';
import { ShipRegistry } from '../js/core/ships/ship-registry.js';

test('normalise et expose un vaisseau', () => {
  const ships = new ShipRegistry();
  const ship = ships.register({ id: 'classic', label: ' Classique ', stats: { speedMultiplier: 1.1 } });
  assert.equal(ship.label, 'Classique');
  assert.equal(ship.stats.speedMultiplier, 1.1);
  assert.equal(ship.stats.fireRateMultiplier, 1);
  assert.equal(ships.get('classic'), ship);
});

test('refuse les definitions dangereuses', () => {
  const ships = new ShipRegistry();
  assert.throws(() => ships.register({ id: 'Bad Ship', label: 'Bad' }), /invalide/);
  assert.throws(() => ships.register({ id: 'slow', label: 'Slow', stats: { speedMultiplier: 0 } }), /positif/);
  ships.register({ id: 'classic', label: 'Classique' });
  assert.throws(() => ships.register({ id: 'classic', label: 'Copie' }), /deja enregistre/);
});
