import test from 'node:test';
import assert from 'node:assert/strict';

test('le bootstrap expose un runtime arcade complet', async () => {
  const events = [];
  const values = new Map();
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };

  globalThis.window = {
    TEMPO: { COMBO_WINDOW_MS: 1600, COMBO_MAX: 8 },
    GALABOB_ARCADE_PROGRESSION: {
      stageCount: 20,
      bossEvery: 5,
      themes: [{ key: 'space' }],
      compositions: [{ stage: 1 }]
    },
    GALABOB_ASSAULT_PROGRESSION: {
      stageCount: 30,
      bossEvery: 10,
      themes: [{ key: 'assault' }],
      compositions: [{ stage: 1 }]
    },
    localStorage: storage,
    dispatchEvent: event => events.push(event)
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };

  try {
    await import(`../js/bootstrap.js?test=${Date.now()}`);
    assert.equal(window.GALABOB.version, 1);
    assert.equal(window.GALABOB.modes.current().id, 'arcade');
    assert.equal(window.GALABOB.modes.list().length, 2);
    assert.equal(window.GALABOB.progressions.get('arcade').stageCount, 20);
    assert.equal(window.GALABOB.profile.mode('arcade').highScore, 0);
    assert.equal(window.GALABOB.ships.get('classic').label, 'Vaisseau classique');
    assert.equal(window.GALABOB.ships.list().length, 3);
    assert.equal(typeof window.GALABOB.shipRenderers.get('legacy-vector'), 'function');
    assert.equal(window.GALABOB.profile.data.selectedShip, 'classic');
    assert.equal(window.GALABOB.powerUps.list().length, 0);
    const stageSeed = window.GALABOB.beginStageRandom(3, 0);
    assert.equal(window.GALABOB.stageSeed, stageSeed);
    assert.equal(window.GALABOB.selectNextMode().id, 'assault');
    assert.equal(events[0].type, 'galabob:runtime-ready');
  } finally {
    delete globalThis.window;
    delete globalThis.CustomEvent;
  }
});
