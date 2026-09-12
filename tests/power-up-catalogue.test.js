import test from 'node:test';
import assert from 'node:assert/strict';

test('le catalogue de contenu contient 16 bonus valides et distincts', async () => {
  globalThis.window = {};
  try {
    await import(`../js/content/powerups/catalogue.js?test=${Date.now()}`);
    const catalogue = window.GALABOB_POWER_UP_CATALOGUE;
    const aliases = window.GALABOB_POWER_UP_ALIASES;

    assert.equal(catalogue.length, 16);
    assert.equal(new Set(catalogue.map(item => item.key)).size, catalogue.length);
    assert.equal(new Set(catalogue.map(item => item.letter)).size, catalogue.length);
    assert.ok(catalogue.every(item => Object.isFrozen(item) && Object.isFrozen(item.shape)));

    const keys = new Set(catalogue.map(item => item.key));
    assert.ok(Object.values(aliases).every(target => keys.has(target)));
    assert.ok(Object.isFrozen(catalogue));
    assert.ok(Object.isFrozen(aliases));
  } finally {
    delete globalThis.window;
  }
});
