import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssaultMode } from '../js/modes/assault.js';

test('la salle arsenal propose trois modules, un refresh et deux routes', () => {
  const alerts = [];
  globalThis.window = {
    player: { weapon: 'normal', lives: 3 },
    addPlayerShield: () => {},
    hudAlert: (text, sub) => alerts.push({ text, sub })
  };

  try {
    const mode = createAssaultMode({});
    mode.startRun();
    for (let index = 0; index < 50; index++) mode.enemyKilled({ basePoints: 10 });
    const result = mode.completeStage({ stage: 1 });

    assert.deepEqual(result, { openShop: true });
    assert.equal(mode.getState().shopOpen, true);
    assert.equal(mode.getState().credits, 228);
    assert.equal(mode.getShopOffers().length, 3);
    assert.equal(new Set(mode.getShopOffers().map(offer => offer.id)).size, 3);
    assert.equal(mode.getState().routes.length, 2);
    assert.equal(new Set(mode.getState().routes.map(route => route.id)).size, 2);

    const firstRevision = mode.getState().shopRevision;
    assert.equal(mode.getRefreshCost(), 30);
    assert.equal(mode.refreshShop(), true);
    assert.equal(mode.getState().credits, 198);
    assert.equal(mode.getRefreshCost(), 50);
    assert.ok(mode.getState().shopRevision > firstRevision);

    const affordable = mode.getShopOffers().find(offer => offer.cost <= mode.getState().credits);
    assert.ok(affordable);
    assert.equal(mode.purchase(affordable.id), true);
    assert.equal(affordable.sold, true);
    const route = mode.getState().routes[0];
    assert.equal(mode.chooseRoute(route.id), true);
    mode.closeShop();
    assert.equal(mode.getState().shopOpen, false);
    mode.startStage({ stage: 2 });
    assert.equal(mode.getState().activeRoute.id, route.id);
  } finally {
    delete globalThis.window;
  }
});

test('les armes ramassées sont temporaires et consomment des munitions', () => {
  globalThis.window = {
    player: { weapon: 'normal', weapons: {}, weaponLevel: 1 },
    setPlayerWeapon(type) {
      this.player.weapon = type;
      this.player.weapons[type] = { level: 1, timer: 3600000 };
    }
  };
  try {
    const mode = createAssaultMode({});
    mode.startRun();
    assert.notEqual(mode.rollEnemyDrop({ roll: 0, pick: 0 }), 'double');
    const recycledDouble = mode.collectPowerUp({ definition: { key: 'double' } });
    assert.equal(recycledDouble.handled, true);
    assert.equal(mode.getState().extensions.double, false);
    assert.equal(mode.getState().credits, 10);
    const spread = mode.collectPowerUp({ definition: { key: 'spread' } });
    assert.equal(spread.handled, true);
    assert.equal(mode.getState().extensions.spread, undefined);
    assert.equal(mode.getState().ammo.spread, 12);
    assert.equal(mode.requestShot('spread'), true);
    assert.equal(mode.getState().ammo.spread, 11);

    mode.update(1250);
    const heavy = mode.collectPowerUp({ definition: { key: 'missiles' } });
    assert.equal(heavy.handled, true);
    assert.equal(mode.getState().ammo.missiles, 10);
    assert.equal(mode.requestShot('missiles'), true);
    assert.equal(mode.getState().ammo.missiles, 9);
  } finally {
    delete globalThis.window;
  }
});

test('le canon Assaut bloque pendant la recharge puis reprend', () => {
  globalThis.window = { player: { weapon: 'normal' } };
  try {
    const mode = createAssaultMode({});
    mode.startRun();
    assert.equal(mode.damageMultiplier(), 1);
    assert.equal(mode.requestShot('normal'), true);
    assert.equal(mode.requestShot('normal'), true);
    assert.equal(mode.requestShot('normal'), false);
    assert.ok(mode.getState().reloadRemaining > 0);
    mode.update(1250);
    assert.equal(mode.getState().magazine, 2);
    assert.equal(mode.requestShot('normal'), true);
    mode.startStage({ stage: 2 });
    assert.equal(mode.damageMultiplier(), 0.42);
  } finally {
    delete globalThis.window;
  }
});
