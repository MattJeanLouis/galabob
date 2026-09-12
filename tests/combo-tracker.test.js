import test from 'node:test';
import assert from 'node:assert/strict';
import { ComboTracker } from '../js/core/combo-tracker.js';

test('le combo avance avec le temps de jeu fourni', () => {
  const combo = new ComboTracker({ windowMs: 1600, maximum: 8 });
  assert.equal(combo.registerKill(), 1);
  combo.step(600);
  assert.equal(combo.fraction(), 0.625);
  assert.equal(combo.registerKill(), 2);
  assert.equal(combo.fraction(), 1);
});

test('un delta nul ne consomme pas le combo', () => {
  const combo = new ComboTracker({ windowMs: 1600, maximum: 8 });
  combo.registerKill();
  combo.step(0);
  combo.step(-100);
  assert.equal(combo.fraction(), 1);
});

test('le combo expire et son multiplicateur est borne', () => {
  const combo = new ComboTracker({ windowMs: 100, maximum: 2 });
  combo.registerKill();
  combo.registerKill();
  combo.registerKill();
  assert.equal(combo.multiplier(), 2);
  combo.step(100);
  assert.equal(combo.count, 0);
  assert.equal(combo.fraction(), 0);
  assert.equal(combo.multiplier(), 1);
});
