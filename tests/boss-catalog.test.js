import test from 'node:test';
import assert from 'node:assert/strict';

test('le catalogue expose six boss et boucle sans trou', async () => {
  globalThis.window = {};
  try {
    await import(`../js/entities/boss.js?catalog=${Date.now()}`);
    const boss = window.BOSS;

    assert.equal(boss.count(), 6);
    assert.deepEqual(boss.STAGES, [5, 10, 15, 20, 25, 30]);
    for (let i = 0; i < boss.count(); i++) {
      assert.equal(boss.indexForStage((i + 1) * 5), i);
    }
    assert.equal(boss.indexForStage(35), 0);
    assert.equal(boss.indexForStage(36), -1);
  } finally {
    delete globalThis.window;
  }
});
