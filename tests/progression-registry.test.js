import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressionRegistry } from '../js/core/stages/progression-registry.js';

const VALID = Object.freeze({
  stageCount: 20,
  bossEvery: 5,
  themes: Object.freeze([{ key: 'space' }]),
  compositions: Object.freeze([{ stage: 1, nom: 'LIGNE' }])
});

test('isole la progression de chaque mode', () => {
  const registry = new ProgressionRegistry();
  registry.register('arcade', VALID);

  assert.equal(registry.get('arcade'), VALID);
  assert.equal(registry.isBossStage('arcade', 5), true);
  assert.equal(registry.isBossStage('arcade', 4), false);
  assert.deepEqual(registry.next('arcade', 19, 0), { stage: 20, loop: 0 });
  assert.deepEqual(registry.next('arcade', 20, 0), { stage: 1, loop: 1 });
});

test('refuse une progression incomplete ou incoherente', () => {
  const registry = new ProgressionRegistry();
  assert.throws(() => registry.register('Arcade', VALID));
  assert.throws(() => registry.register('arcade', { ...VALID, stageCount: 0 }));
  assert.throws(() => registry.register('arcade', { ...VALID, bossEvery: 21 }));
  assert.throws(() => registry.register('arcade', { ...VALID, themes: [] }));
  assert.throws(() => registry.register('arcade', {
    ...VALID,
    compositions: [{ stage: 21 }]
  }));
});

