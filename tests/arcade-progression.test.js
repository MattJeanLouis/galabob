import test from 'node:test';
import assert from 'node:assert/strict';

test('la progression Arcade decrit 100 stages sans trou', async () => {
  globalThis.window = {};
  try {
    await import(`../js/content/modes/arcade-progression.js?test=${Date.now()}`);
    const progression = window.GALABOB_ARCADE_PROGRESSION;

    assert.equal(progression.stageCount, 100);
    assert.equal(progression.bossEvery, 5);
    assert.equal(progression.compositions.length, progression.stageCount);
    assert.deepEqual(
      progression.compositions.map(item => item.stage),
      Array.from({ length: progression.stageCount }, (_, index) => index + 1)
    );
    assert.ok(progression.themes.length >= 5);
    assert.ok(progression.compositions.every(item => item.poids > 0 && item.taille > 0));
    assert.ok(Object.isFrozen(progression));
  } finally {
    delete globalThis.window;
  }
});
