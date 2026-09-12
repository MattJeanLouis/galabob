import test from 'node:test';
import assert from 'node:assert/strict';

test('le mode Assaut possede sa propre campagne de 30 vagues', async () => {
  globalThis.window = {};
  try {
    await import(`../js/content/modes/arcade-progression.js?assault=${Date.now()}`);
    await import(`../js/content/modes/assault-progression.js?test=${Date.now()}`);
    const progression = window.GALABOB_ASSAULT_PROGRESSION;

    assert.equal(progression.stageCount, 30);
    assert.equal(progression.bossEvery, 10);
    assert.equal(progression.compositions.length, 30);
    assert.ok(progression.rules.formationSpeedMultiplier > 1);
    assert.ok(progression.rules.budgetMultiplier < 1);
    assert.equal(progression.rules.disableDives, true);
    assert.equal(progression.rules.scriptedCompositions, true);
  } finally {
    delete globalThis.window;
  }
});
