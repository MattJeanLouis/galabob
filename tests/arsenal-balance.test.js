/**
 * Équilibrage de l'ARSENAL : plafond d'armes simultanées et dilution.
 *
 * Mesure d'origine : les armes se cumulaient sans limite et chacune gardait sa
 * pleine puissance. Six armes donnaient ×8,5 les dégâts d'un canon nu alors que
 * les PV des boss sont calibrés sur 8,5 PV/s (boss.js), et la cadence suivait la
 * DERNIÈRE arme ramassée — ramasser un missiles après un double faisait donc
 * BAISSER les dégâts. Ces tests figent les trois règles qui corrigent cela.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

function harness() {
  const context = vm.createContext({
    console,
    window: { matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} },
    document: { getElementById: () => null },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    spawnMuzzleFlash() {}, applyPlayerDamageToEnemy() { return false; }, killEnemyAt() { return 0; },
    createImpactSparks() {}, createExplosion() {}, createDebris() {}, createEmbers() {},
    createScorePopup() {}, gameEvent() {},
    BOSS: null,
    INPUT: { shoot: () => true, shootBuffered: () => false, consumeShoot() {}, axisX: () => 0, axisY: () => 0 },
    PALETTE: {
      get: () => ({ glow: '#fff', core: '#fff', burst: '#fff', halo: '#fff' }),
      enemy: () => ({ glow: '#fff', core: '#fff', burst: '#fff', halo: '#fff' })
    },
    JUICE: { preset() {}, flash() {}, hitstop() {}, shake() {}, punch() {}, isFrozen: () => false, step: (ms) => ms },
    NEON: new Proxy({}, { get: () => () => {} })
  });

  vm.runInContext(read('js/core/config.js'), context);
  vm.runInContext(read('js/core/palette.js'), context);
  vm.runInContext(read('js/utils.js'), context);
  vm.runInContext(read('js/entities/projectiles.js'), context);
  vm.runInContext(read('js/entities/player.js'), context);

  const get = (expr) => vm.runInContext(expr, context);
  const call = (expr, ...args) => vm.runInContext(expr, context)(...args);
  const player = get('player');
  const TEMPO = get('TEMPO');
  const playerBullets = get('playerBullets');

  const reset = () => call('resetPlayerPowerState');
  const equip = (...types) => { for (const type of types) call('setPlayerWeapon', type, 60000); };
  /** Dégâts d'une salve complète, et cadence, pour l'arsenal en place. */
  const volley = () => {
    playerBullets.length = 0;
    call('firePlayerWeapon');
    return playerBullets.reduce((sum, bullet) => sum + (bullet.damage || 0), 0);
  };

  return { player, TEMPO, reset, equip, volley, interval: () => call('currentFireInterval'), get };
}

test('le nombre d’armes simultanées est plafonné, la plus ancienne cède la place', () => {
  const bench = harness();
  bench.reset();
  bench.equip('double', 'spread', 'missiles', 'mitraille');

  const actives = Object.keys(bench.player.weapons);
  assert.equal(actives.length, bench.TEMPO.PLAYER_WEAPON_LIMIT,
    'l’arsenal ne doit jamais dépasser le plafond');
  assert.deepEqual(actives.sort(), ['missiles', 'mitraille', 'spread'].sort(),
    'les armes les plus RÉCENTES restent, la plus ancienne (double) est évincée');
  assert.equal(bench.player.weaponEvicted, 'double', 'l’éviction doit être signalée à l’appelant');
});

test('une arme seule garde 100 % de sa puissance, le cumul la dilue', () => {
  const bench = harness();
  const degats = () => bench.get('_playerDamageMultiplier')();

  bench.reset();
  bench.equip('double');
  const seul = degats();

  bench.equip('spread');
  const deux = degats();

  bench.equip('missiles');
  const trois = degats();

  assert.equal(seul, 1, 'une arme seule ne doit subir aucune dilution');
  assert.ok(deux > seul && deux < 1.5, `deux armes doivent rester sous ×1,5 (mesuré ${deux.toFixed(3)})`);
  assert.ok(trois > deux && trois < 1.35, `trois armes doivent rester sous ×1,35 (mesuré ${trois.toFixed(3)})`);
});

test('ramasser une arme lente ne fait jamais baisser la cadence', () => {
  const bench = harness();

  bench.reset();
  bench.equip('missiles');                       // 290 ms, la plus lente
  const missilesSeul = bench.interval();

  bench.equip('double');                         // 125 ms
  const avecDouble = bench.interval();
  assert.ok(avecDouble < missilesSeul,
    `ajouter une arme rapide doit accélérer la cadence (${Math.round(missilesSeul)} -> ${Math.round(avecDouble)} ms)`);

  // L'inverse est le vrai test : la cadence ne doit pas s'effondrer.
  bench.reset();
  bench.equip('double');
  const doubleSeul = bench.interval();
  bench.equip('missiles');
  const avecMissiles = bench.interval();
  assert.ok(avecMissiles > doubleSeul, 'une arme lente pèse, c’est voulu');
  assert.ok(avecMissiles < 290,
    `mais elle est MOYENNÉE avec les autres, pas imposée (${Math.round(avecMissiles)} ms < 290 ms)`);
  assert.ok(Math.abs(avecMissiles - (doubleSeul + 290) / 2) < 1,
    'la cadence doit être la moyenne des armes actives');
});

test('la puissance de l’arsenal complet reste bornée', () => {
  const bench = harness();
  const dps = () => {
    const degats = bench.volley();
    return degats * (1000 / bench.interval());
  };

  bench.reset();
  bench.equip('double');
  const reference = dps();

  bench.reset();
  bench.equip('double', 'spread', 'missiles');
  const complet = dps();

  assert.ok(reference > 0, 'le canon de référence doit infliger des dégâts');
  assert.ok(complet / reference < 4,
    `l’arsenal complet doit rester sous ×4 le canon de référence (mesuré ×${(complet / reference).toFixed(1)})`);
  assert.ok(complet / reference > 1.5,
    `mais rester une récompense notable (mesuré ×${(complet / reference).toFixed(1)})`);
});

test('le plafond et la dilution restent pilotés par config.js', () => {
  const config = read('js/core/config.js');
  assert.match(config, /PLAYER_WEAPON_LIMIT\s*:\s*\d+/, 'le plafond doit être réglable');
  assert.match(config, /PLAYER_WEAPON_SCALE\s*:\s*[0-9.]+/, 'la dilution doit être réglable');
  // Aucune trace de l'ancienne rampe par arme, qui dépendait de l'ordre.
  assert.doesNotMatch(read('js/entities/player.js'), /PLAYER_WEAPON_RAMP/);
});
