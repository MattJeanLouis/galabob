/**
 * Banc d'essai du module de vue en perspective, SANS navigateur.
 *
 * Le module ne dépend plus d'aucune librairie : la projection sténopé est
 * écrite à la main. On peut donc le charger tel quel dans un `vm` et vérifier
 * pour de vrai :
 *   - la vue LIT l'instantané sans jamais le modifier (la promesse de fond) ;
 *   - le cadrage (où tombe le vaisseau, ce qui reste visible) ;
 *   - et surtout LE CONTRAT DE FIDÉLITÉ : le jeu dessine ses propres formes, à
 *     travers une transformation qui amène exactement le centre logique de
 *     chaque entité sur son pixel projeté, à l'échelle de sa profondeur.
 *
 * Ce dernier point est celui qui a coûté le plus cher : une vue « en
 * perspective » qui redessine son propre art n'est pas la même jeu. Le banc
 * vérifie donc la MATRICE, pas seulement le marqueur.
 *
 * Les captures d'écran headless de cet environnement saturent en répétition :
 * ce banc donne une vérification déterministe et rapide.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/**
 * Faux contexte 2D qui TIENT LA MATRICE courante. C'est ce qui permet de
 * vérifier où le jeu croit dessiner : sans elle, on ne saurait que « une
 * fonction a été appelée ».
 */
function fauxContexte(trace) {
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const pile = [];
  const mul = (n) => {
    m = {
      a: m.a * n.a + m.c * n.b,
      b: m.b * n.a + m.d * n.b,
      c: m.a * n.c + m.c * n.d,
      d: m.b * n.c + m.d * n.d,
      e: m.a * n.e + m.c * n.f + m.e,
      f: m.b * n.e + m.d * n.f + m.f
    };
  };
  return {
    get matrice() { return m; },
    /** Où tombe un point du monde après la transformation courante. */
    vers(p) { return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }; },
    save() { pile.push(m); },
    restore() { m = pile.pop() || m; },
    translate(x, y) { mul({ a: 1, b: 0, c: 0, d: 1, e: x, f: y }); },
    scale(x, y) { mul({ a: x, b: 0, c: 0, d: y || x, e: 0, f: 0 }); },
    rotate(a) { mul({ a: Math.cos(a), b: Math.sin(a), c: -Math.sin(a), d: Math.cos(a), e: 0, f: 0 }); },
    setTransform(a, b, c, d, e, f) { m = { a, b, c, d, e, f }; },
    beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
    closePath() {}, fillRect() {}, clearRect() {}, drawImage() {}, fillText() {},
    rect() {}, setLineDash() {}, measureText: () => ({ width: 0 }),
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', filter: 'none',
    shadowBlur: 0, shadowColor: '', lineDashOffset: 0, font: '', textAlign: 'left',
    textBaseline: 'alphabetic'
  };
}

function charger() {
  const trace = [];
  const sourcesSans = [];
  const context = vm.createContext({
    console, Math, Object, Array, Number, String, Boolean, JSON, isNaN, parseFloat, isFinite,
    FRAME: { time: 3.5, frame: 120 }
  });
  context.window = context;

  // L'art du jeu : on enregistre QUI est appelé et OÙ le contexte croit être.
  const noter = (qui, c, modele) => trace.push({ qui, modele, matrice: c.matrice });
  const art = {
    drawEnemyShip(c, tr, e) { noter('ennemi', c, e); },
    ensureEnemyRuntime() {},
    drawPlayerBullet(c, tr, b) { noter('balle-joueur', c, b); },
    drawEnemyBullet(c, tr, b) { noter('balle-ennemie', c, b); },
    drawPowerUp(c, tr, p) { noter('bonus', c, p); },
    drawExplosionParticle(c, p) { noter('explosion', c, p); },
    drawDebrisPiece(c, d) { noter('debris', c, d); },
    drawBombWave(c, w) { noter('bombe', c, w); },
    drawPowerUpPickup(c, f) { noter('ramassage', c, f); },
    drawMultiplierSpark(c, s) { noter('multiplicateur', c, s); },
    drawScorePopup(c, p) { noter('score', c, p); },
    drawPlayer() { noter('vaisseau', context.__ctx, null); },
    drawSlowMotionBands() { noter('bandes-ralenti', context.__ctx, null); },
    drawSlowMotionRing() { noter('champ-ralenti', context.__ctx, null); },
    BOSS: { drawWorld(c) { noter('boss', c, context.__boss); } }
  };
  Object.assign(context, art);
  context.window = context;
  context.__boss = null;

  vm.runInContext(read('js/render/game3d.js'), context);
  context.__ctx = fauxContexte(trace);
  void sourcesSans;
  return { GAME3D: context.GAME3D, trace, context };
}

/** Où tombe un point du monde à travers une matrice enregistrée. */
function vers(m, p) {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

function instantane() {
  return {
    player: { x: 300, y: 500, width: 40, height: 22, tilt: 0.3, kick: 2, thrust: 0.7, blink: false },
    enemies: [
      { x: 100, y: 90, width: 32, height: 32, type: 'normal' },
      { x: 200, y: 60, width: 32, height: 32, type: 'shooter', hitFlash: 40 }
    ],
    playerBullets: [{ x: 310, y: 480, width: 3, height: 16 }],
    enemyBullets: [{ x: 150, y: 200, width: 5, height: 10, kind: 'fast' }],
    powerUps: [{ x: 400, y: 300, width: 26, height: 26, type: 'spread' }],
    explosions: [{ x: 250, y: 150, r: 30, life: 0.4, maxLife: 0.8, alpha: 0.9, col: null, kind: 0 }],
    debris: [{ x: 260, y: 160, size: 5, rot: 0.4, life: 0.5, maxLife: 0.8, col: null, shape: 0 }],
    bombWaves: [{ x: 320, y: 420, r: 120, age: 100, life: 700 }],
    powerUpPickups: [{ x: 330, y: 410, life: 0.4, max: 0.8, type: 'spread', slot: 'weapon' }],
    multiplierSparks: [{ x: 340, y: 400, life: 0.4, max: 0.8 }],
    scorePopups: [{ x: 350, y: 390, life: 0.4, maxLife: 0.8, text: '+500', col: null, mult: 2, size: 18 }],
    boss: { x: 400, y: 120, rayon: 90, hp: 0.6, color: 'enemyElite', phase: 2 },
    shipRenderer: 'legacy-vector'
  };
}

test('la vue ne MODIFIE jamais l’instantané qu’on lui donne', () => {
  const { GAME3D } = charger();
  const snap = instantane();
  const avant = JSON.stringify(snap);

  const resultat = GAME3D.frame(snap, 800, 600);

  assert.ok(resultat && resultat.markers, 'une projection doit être rendue');
  assert.equal(JSON.stringify(snap), avant,
    'la vue doit être en LECTURE SEULE : c’est la promesse hitboxes/dégâts/progression');
});

test('TOUT ce que le jeu dessine est projeté, sans exception', () => {
  const { GAME3D } = charger();
  const r = GAME3D.frame(instantane(), 800, 600);
  const m = r.markers;

  assert.equal(m.enemies.length, 2, 'les deux ennemis');
  assert.equal(m.shots.length, 1, 'le projectile du joueur');
  assert.equal(m.incoming.length, 1, 'le projectile ennemi');
  assert.equal(m.powerups.length, 1, 'le bonus');
  assert.equal(m.explosions.length, 1, 'la particule d’explosion');
  assert.equal(m.debris.length, 1, 'le débris');
  assert.equal(m.bombWaves.length, 1, 'l’onde de bombe');
  assert.equal(m.pickups.length, 1, 'la gerbe de ramassage');
  assert.equal(m.sparks.length, 1, 'le ×2 du multiplicateur');
  assert.equal(m.popups.length, 1, 'le popup de score');
  assert.ok(m.boss, 'le boss');
  assert.equal(m.boss.hp, 0.6, 'sa vie doit être relayée telle quelle');
  assert.ok(m.ship && m.ship.visible, 'le vaisseau');
});

test('FIDÉLITÉ : le jeu dessine ses propres formes, au bon endroit et à la bonne échelle', () => {
  const { GAME3D, trace, context } = charger();
  const snap = instantane();
  const r = GAME3D.frame(snap, 800, 600);
  context.__boss = snap.boss;
  GAME3D.drawWorld(context.__ctx);

  // Chaque élément tracé doit avoir amené le CENTRE LOGIQUE de son art
  // exactement sur son pixel projeté, et à l'échelle de sa profondeur.
  const attendus = [
    ['ennemi', r.markers.enemies, (o) => ({ x: o.x + o.width / 2, y: o.y + o.height / 2 })],
    ['balle-joueur', r.markers.shots, (o) => ({ x: o.x + (o.width || 3) / 2, y: o.y + (o.drawH || o.height || 16) / 2 })],
    ['balle-ennemie', r.markers.incoming, (o) => ({ x: o.x + (o.width || 5) / 2, y: o.y + (o.drawH || o.height || 10) / 2 })],
    ['bonus', r.markers.powerups, (o) => ({ x: o.x + o.width / 2, y: o.y + o.height / 2 })],
    ['explosion', r.markers.explosions, (o) => ({ x: o.x, y: o.y })],
    ['debris', r.markers.debris, (o) => ({ x: o.x, y: o.y })],
    ['bombe', r.markers.bombWaves, (o) => ({ x: o.x, y: o.y })],
    ['ramassage', r.markers.pickups, (o) => ({ x: o.x, y: o.y })],
    ['multiplicateur', r.markers.sparks, (o) => ({ x: o.x, y: o.y })],
    ['score', r.markers.popups, (o) => ({ x: o.x, y: o.y })],
    ['boss', [r.markers.boss], (o) => ({ x: o.x, y: o.y })]
  ];

  for (const [qui, marqueurs, centre] of attendus) {
    assert.ok(marqueurs.length, `${qui} : au moins un marqueur attendu`);
    for (const marqueur of marqueurs) {
      const modele = marqueur.item || marqueur.entity || marqueur.powerUp ||
        marqueur.bullet || (qui === 'boss' ? snap.boss : null);
      const appel = trace.find((t) => t.qui === qui && (modele == null || t.modele === modele));
      assert.ok(appel, `${qui} doit être tracé par SA fonction de dessin`);
      const cible = centre(modele);
      const ou = vers(appel.matrice, cible);
      assert.ok(Math.abs(ou.x - marqueur.x) < 0.001 && Math.abs(ou.y - marqueur.y) < 0.001,
        `${qui} : le centre logique doit tomber sur le pixel projeté ` +
        `(attendu ${marqueur.x.toFixed(1)},${marqueur.y.toFixed(1)} — obtenu ${ou.x.toFixed(1)},${ou.y.toFixed(1)})`);
      // L'échelle : la distance entre deux points du modèle doit être multipliée
      // par `scale`.
      const a = vers(appel.matrice, cible);
      const b = vers(appel.matrice, { x: cible.x + 100, y: cible.y });
      const rapport = Math.hypot(b.x - a.x, b.y - a.y) / 100;
      assert.ok(Math.abs(rapport - marqueur.scale) < 0.001,
        `${qui} : l’échelle doit être celle de sa profondeur (attendu ${marqueur.scale.toFixed(3)}, obtenu ${rapport.toFixed(3)})`);
    }
  }
});

test('FIDÉLITÉ : le vaisseau est tracé par drawPlayer, le boss par BOSS.drawWorld', () => {
  const { GAME3D, trace, context } = charger();
  const snap = instantane();
  const r = GAME3D.frame(snap, 800, 600);
  context.__boss = snap.boss;
  GAME3D.drawWorld(context.__ctx);

  const vaisseau = trace.find((t) => t.qui === 'vaisseau');
  assert.ok(vaisseau, 'le vaisseau doit venir de l’art du jeu');
  const ou = vers(vaisseau.matrice, { x: snap.player.x + snap.player.width / 2, y: snap.player.y + snap.player.height / 2 });
  assert.ok(Math.abs(ou.x - r.markers.ship.x) < 0.001 && Math.abs(ou.y - r.markers.ship.y) < 0.001,
    'le vaisseau doit être posé sur son pixel projeté');

  assert.ok(trace.some((t) => t.qui === 'boss'), 'le boss doit être rendu par le module boss');
});

test('FIDÉLITÉ : le plus proche est tracé en DERNIER (tri par profondeur)', () => {
  const { GAME3D, trace, context } = charger();
  const snap = instantane();
  // Deux ennemis identiques, l'un au fond, l'autre au contact.
  snap.enemies = [
    { x: 300, y: 30, width: 32, height: 32, type: 'normal' },
    { x: 300, y: 560, width: 32, height: 32, type: 'normal' }
  ];
  GAME3D.frame(snap, 800, 600);
  GAME3D.drawWorld(context.__ctx);

  const ordre = trace.filter((t) => t.qui === 'ennemi').map((t) => t.modele.y);
  assert.deepEqual(ordre, [30, 560],
    'le lointain doit passer avant le proche (la coque opaque du boss ne doit pas ' +
    'recouvrir un ennemi qui lui est antérieur)');
});

test('AUCUN art inventé : plus de sprite, plus de ciel à part, plus de sol', () => {
  const module3d = read('js/render/game3d.js');

  // La vue n'a plus de renderer : elle projette et laisse le jeu dessiner.
  assert.doesNotMatch(module3d, /import\s+\*\s+as\s+THREE/, 'plus de dépendance Three.js');
  assert.doesNotMatch(module3d, /new THREE\./, 'plus aucun objet de scène');
  assert.doesNotMatch(module3d, /Sprite|CanvasTexture|GridHelper|PlaneGeometry/,
    'ni sprite, ni grille : ces éléments n’existent dans aucune autre vue');

  // L'art doit venir du jeu, nommément.
  for (const fn of ['drawEnemyShip', 'drawPlayer', 'drawEnemyBullet', 'drawPowerUp',
    'drawExplosionParticle', 'drawBombWave', 'BOSS.drawWorld']) {
    assert.ok(module3d.includes(fn), `la vue doit passer par ${fn}`);
  }
});

test('CADRAGE : le vaisseau est DEVANT, bas dans le cadre, à toute taille', () => {
  const { GAME3D } = charger();
  const snap = instantane();
  snap.enemies = [];

  // Une bande, pas un point : « derrière le vaisseau » veut dire qu'on le voit
  // bas et de près, sans qu'il colle au bord ni remonte au centre.
  for (const [w, h] of [[800, 600], [1200, 900], [1440, 1080]]) {
    const r = GAME3D.frame({ ...snap }, w, h);
    const pct = r.markers.ship.y / h * 100;
    assert.ok(pct >= 68 && pct <= 88,
      `le vaisseau doit rester bas et lisible en ${w}×${h} (mesuré ${pct.toFixed(0)} %)`);
  }
});

test("AVANCER dans le plan RAPPROCHE le monde (monter = vers l'horizon)", () => {
  const { GAME3D } = charger();

  // La caméra suit le joueur : le vaisseau garde donc sa place à l'écran, et
  // c'est le MONDE qui défile. C'est le contrat de l'objectif — « monter, c'est
  // aller vers l'horizon » — et il se lit sur un ennemi FIXE : plus le joueur
  // monte dans le plan, plus cet ennemi doit être proche (gros, bas, menaçant).
  const mesures = [];
  for (const y of [540, 440, 340, 240]) {
    const snap = instantane();
    snap.player = { ...snap.player, x: 400, y };
    snap.enemies = [{ x: 380, y: 320, width: 32, height: 32, type: 'normal' }];
    const m = GAME3D.frame(snap, 800, 600).markers.enemies[0];
    assert.ok(m, `l’ennemi fixe doit rester dans le cadre (joueur en y=${y})`);
    mesures.push({ y, scale: m.scale });
  }

  for (let i = 1; i < mesures.length; i++) {
    assert.ok(mesures[i].scale > mesures[i - 1].scale,
      `monter doit rapprocher l'ennemi fixe : ${mesures[i - 1].scale.toFixed(3)} -> ${mesures[i].scale.toFixed(3)}`);
  }
  // Et la progression doit être NETTE, pas cosmétique.
  const rapport = mesures[mesures.length - 1].scale / mesures[0].scale;
  assert.ok(rapport > 2,
    `le déplacement doit changer franchement la distance perçue (mesuré ×${rapport.toFixed(1)})`);
});

test('CADRAGE : le terrain reste lisible sur les BORDS', () => {
  const { GAME3D } = charger();

  // Une caméra rapprochée élargit le champ proche : poussée trop loin, elle
  // sortait 60 % du bord latéral du cadre — une menace pouvait tirer sans être
  // vue. C'est le contrepoids du réglage « derrière le vaisseau ».
  for (const [w, h] of [[800, 600], [1200, 900]]) {
    const visibles = [];
    for (let i = 0; i <= 8; i++) {
      const snap = instantane();
      snap.enemies = [{ x: 0, y: Math.round((i / 8) * (h - 42)), width: 32, height: 32, type: 'normal' }];
      snap.player = { ...snap.player, x: w / 2 - 20, y: h - 60 };
      const m = GAME3D.frame(snap, w, h).markers.enemies[0];
      visibles.push(!!(m && m.x >= 0 && m.x <= w && m.y >= 0 && m.y <= h));
    }
    const part = visibles.filter(Boolean).length / visibles.length;
    assert.ok(part >= 0.6,
      `le bord latéral doit rester visible sur au moins 60 % de sa profondeur ` +
      `en ${w}×${h} (mesuré ${Math.round(part * 100)} %)`);
  }
});

test('CADRAGE : la profondeur se lit — le lointain est plus haut et plus petit', () => {
  const { GAME3D } = charger();
  const snap = instantane();
  // Deux ennemis IDENTIQUES, l'un au fond du plan, l'autre près du joueur.
  snap.enemies = [
    { x: 300, y: 40, width: 32, height: 32, type: 'normal' },    // loin
    { x: 300, y: 560, width: 32, height: 32, type: 'normal' }    // près
  ];

  const r = GAME3D.frame(snap, 800, 600);
  const [loin, pres] = r.markers.enemies;
  assert.ok(loin.y < pres.y,
    `le lointain doit être plus HAUT dans le cadre (${Math.round(loin.y)} < ${Math.round(pres.y)})`);
  assert.ok(loin.scale < pres.scale,
    `et plus PETIT (${loin.scale.toFixed(3)} < ${pres.scale.toFixed(3)}) — sinon il n'y a pas de profondeur`);
});

test('CADRAGE : un ennemi qui approche grossit', () => {
  const { GAME3D } = charger();
  const tailles = [];
  for (const y of [60, 300, 540]) {
    const snap = instantane();
    snap.enemies = [{ x: 300, y, width: 32, height: 32, type: 'normal' }];
    tailles.push(GAME3D.frame(snap, 800, 600).markers.enemies[0].scale);
  }
  assert.ok(tailles[0] < tailles[1] && tailles[1] < tailles[2],
    `le grossissement doit croître avec la proximité (${tailles.map((t) => t.toFixed(3)).join(' < ')})`);
});

test('sans boss, aucun marqueur de boss', () => {
  const { GAME3D } = charger();
  const snap = instantane();
  snap.boss = null;
  const r = GAME3D.frame(snap, 800, 600);
  assert.equal(r.markers.boss, null, 'pas de boss, pas de repère');
});

test('la vue se projette sans WebGL, donc elle est toujours disponible', () => {
  const { GAME3D } = charger();
  assert.equal(GAME3D.isAvailable(), true,
    'la projection ne dépend d’aucun rendu matériel : il n’y a plus de « vue indisponible »');
  assert.equal(typeof GAME3D.drawWorld, 'function', 'et elle sait tracer le monde');
});
