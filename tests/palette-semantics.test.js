import test from 'node:test';
import assert from 'node:assert/strict';

test('les trois camps utilisent des familles chromatiques incompatibles', async () => {
  globalThis.window = {};
  try {
    await import(`../js/core/palette.js?semantics=${Date.now()}`);
    const palette = window.PALETTE;

    const playerShots = ['normal', 'double', 'spread', 'laser', 'missiles', 'mitraille', 'onde']
      .map(key => palette.weapon(key).glow);
    const hostileShots = ['normal', 'shooter', 'fast', 'armored', 'sniper']
      .map(key => palette.bullet('enemy', key).glow);
    const rewards = ['reward.common', 'reward.tech', 'reward.rare', 'reward.vital']
      .map(key => palette.get(key).glow);

    assert.equal(playerShots.every(color => !hostileShots.includes(color)), true);
    assert.equal(rewards.every(color => !hostileShots.includes(color)), true);
    assert.equal(rewards.every(color => !playerShots.includes(color)), true);
  } finally {
    delete globalThis.window;
  }
});
