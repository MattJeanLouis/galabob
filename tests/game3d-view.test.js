/**
 * Banc d'essai du module de vue en perspective, SANS navigateur.
 *
 * Le module importe `three` : on remplace cet import par un faux THREE qui
 * enregistre ce qui est créé et déplacé. On peut alors vérifier pour de vrai :
 *   - la vue LIT l'instantané sans jamais le modifier (la promesse de fond) ;
 *   - le ciel demande bien une image d'astre au jeu, avec le placement ;
 *   - chaque élément de jeu reçu trouve un sprite.
 *
 * Les captures d'écran headless de cet environnement saturent en répétition :
 * ce banc donne une vérification déterministe et rapide.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** Faux THREE : juste ce que le module utilise, plus des compteurs. */
function fauxThree(log) {
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x
  });
  const norm = (v) => {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  };

  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { return this.set(v.x, v.y, v.z); }
    /** VRAIE projection sténopé : sans elle, on ne peut pas vérifier le cadrage
     *  (où tombe le vaisseau, si un ennemi lointain est plus petit…). */
    project(camera) {
      const avant = norm(sub(camera.__cible || { x: 0, y: 0, z: 0 }, camera.position));
      const droite = norm(cross(avant, camera.up));
      const haut = cross(droite, avant);
      const v = sub(this, camera.position);
      const zc = dot(v, avant);
      const f = Math.tan((camera.fov * Math.PI / 180) / 2);
      const xc = dot(v, droite);
      const yc = dot(v, haut);
      const profondeur = zc > 0.001 ? zc : 0.001;
      this.x = xc / (profondeur * f * camera.aspect);
      this.y = yc / (profondeur * f);
      this.z = profondeur;
      return this;
    }
  }
  class Objet {
    constructor(kind) {
      this.kind = kind;
      this.position = new Vector3();
      this.scale = new Vector3(1, 1, 1);
      this.visible = true;
      this.material = {};
      log.push(this);
    }
  }
  class Sprite extends Objet { constructor(m) { super('sprite'); this.material = m || {}; } }
  class Mesh extends Objet { constructor(g, m) { super('mesh'); this.material = m || {}; } }
  return {
    WebGLRenderer: class {
      constructor() {
        this.domElement = { width: 0, height: 0, getContext: () => null };
        this.info = { render: { calls: 0, triangles: 0 } };
      }
      setClearAlpha() {} setPixelRatio() {} setSize(w, h) { this.domElement.width = w; this.domElement.height = h; }
      render() { log.push({ kind: 'render' }); }
    },
    Scene: class { constructor() { this.enfants = []; } add(o) { this.enfants.push(o); log.push({ kind: 'add', objet: o }); } },
    PerspectiveCamera: class {
      constructor(fov) { this.fov = fov || 50; this.position = new Vector3(); this.up = new Vector3(0, 1, 0); this.aspect = 1; this.__cible = null; }
      lookAt(x, y, z) {
        this.__cible = { x, y, z };
        log.push({ kind: 'lookAt', x, y, z });
      }
      updateProjectionMatrix() {}
    },
    Sprite, Mesh, Vector3,
    SpriteMaterial: class { constructor(o) { Object.assign(this, o || {}); } },
    MeshBasicMaterial: class { constructor(o) { Object.assign(this, o || {}); } },
    CanvasTexture: class { constructor(c) { this.image = c; this.needsUpdate = false; } },
    PlaneGeometry: class {}, GridHelper: class extends Objet {
      constructor() { super('grid'); this.material = {}; }
    },
    Color: class { constructor(v) { this.valeur = v; } clone() { return new this.constructor(this.valeur); } },
    AdditiveBlending: 1, SRGBColorSpace: 'srgb', NoToneMapping: 0
  };
}

function charger({ space3d = true } = {}) {
  const log = [];
  const appels = { space3d: [] };
  const canvases = [];
  const contexte2d = {
    clearRect() {}, fillRect() {}, drawImage(...a) { canvases.push(a[0]); },
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    fillStyle: '', globalAlpha: 1, save() {}, restore() {}, translate() {}, scale() {}
  };
  const document = {
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(), width: 0, height: 0,
        getContext: () => contexte2d
      };
      return el;
    }
  };
  const window = {
    SPACE3D: space3d ? {
      frame(options) {
        appels.space3d.push(options);
        return { width: options.width, height: options.height, getContext: () => contexte2d };
      }
    } : undefined,
    drawEnemyBillboard(c) { return true; },
    drawClassicPlayerHull() {}, drawInterceptorPlayerHull() {}, drawBastionPlayerHull() {}
  };
  const context = vm.createContext({
    console, document, window, Math, Object, Array, Number, String, Boolean, JSON, isNaN, parseFloat,
    PALETTE: {
      get: (k) => ({ core: '#ffffff', glow: '#3df5ff', burst: '#3df5ff' })
    },
    FRAME: { time: 3.5, frame: 120 },
    BACKDROP: { themeIndex: () => 2 },
    CANVAS_WIDTH: 800, CANVAS_HEIGHT: 600
  });

  // On remplace l'import ES par un objet global : le module devient testable ici.
  let source = read('js/render/game3d.js')
    .replace(/^import \* as THREE from 'three';$/m, 'const THREE = window.__THREE;');
  context.window.__THREE = fauxThree(log);
  vm.runInContext(source, context);
  return { GAME3D: context.window.GAME3D, log, appels, canvases, context };
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
    explosions: [{ x: 250, y: 150, r: 30, life: 0.4, maxLife: 0.8, alpha: 0.9, col: null }],
    boss: { x: 400, y: 120, rayon: 90, hp: 0.6, color: 'enemyElite', phase: 2, shell: null, alpha: 1 },
    shipRenderer: 'legacy-vector'
  };
}

test('la vue ne MODIFIE jamais l’instantané qu’on lui donne', () => {
  const { GAME3D } = charger();
  const snap = instantane();
  const avant = JSON.stringify(snap);

  const resultat = GAME3D.frame(snap, 800, 600);

  assert.ok(resultat && resultat.canvas, 'une image doit être rendue');
  assert.equal(JSON.stringify(snap), avant,
    'la vue doit être en LECTURE SEULE : c’est la promesse hitboxes/dégâts/progression');
});

test('tous les éléments de jeu reçus trouvent leur place', () => {
  const { GAME3D } = charger();
  const snap = instantane();
  const r = GAME3D.frame(snap, 800, 600);

  assert.equal(r.markers.enemies.length, 2, 'les deux ennemis doivent être projetés');
  assert.equal(r.markers.powerups.length, 1, 'le bonus doit être projeté');
  assert.equal(r.markers.explosions.length, 1, 'l’explosion doit être projetée');
  assert.ok(r.markers.boss, 'le boss doit être projeté');
  assert.equal(r.markers.boss.hp, 0.6, 'sa vie doit être relayée telle quelle');
  assert.ok(r.markers.ship && r.markers.ship.visible, 'le vaisseau doit être marqué');
});

test('le ciel demande une image d’astre au jeu, avec son placement', () => {
  const { GAME3D, appels } = charger();
  GAME3D.frame(instantane(), 800, 600);

  assert.ok(appels.space3d.length > 0, 'SPACE3D doit être sollicité pour le ciel');
  const o = appels.space3d[0];
  // Le placement est ce qui manquait : sans x/y/radius, l'astre ne se dessinait
  // pas (essayé, capturé, invisible).
  for (const champ of ['width', 'height', 'x', 'y', 'radius', 'themeIndex']) {
    assert.equal(typeof o[champ], 'number', `SPACE3D doit recevoir ${champ}`);
  }
  assert.ok(o.radius > 0 && o.x > 0 && o.y > 0, 'un placement utilisable');
});

test('sans SPACE3D, la vue fonctionne quand même', () => {
  const { GAME3D } = charger({ space3d: false });
  const r = GAME3D.frame(instantane(), 800, 600);
  assert.ok(r && r.canvas, 'le ciel est un bonus, pas une dépendance');
  assert.equal(r.markers.enemies.length, 2, 'le reste doit continuer de fonctionner');
});

test('CADRAGE : le vaisseau est DEVANT, en bas du cadre', () => {
  const { GAME3D } = charger();
  const snap = instantane();
  snap.enemies = [];
  const r = GAME3D.frame(snap, 800, 600);

  // Être « derrière le vaisseau », c'est le voir bas dans le cadre et de près.
  assert.ok(r.markers.ship.y > 600 * 0.55,
    `le vaisseau doit être dans la moitié basse (y = ${Math.round(r.markers.ship.y)})`);
});

test('CADRAGE : la profondeur se lit — le lointain est plus haut et plus petit', () => {
  const { GAME3D } = charger();
  const snap = instantane();
  // Deux ennemis IDENTIQUES, l'un au fond du plan, l'autre près du joueur.
  snap.enemies = [
    { x: 300, y: 40, width: 32, height: 32, type: 'normal' },    // loin
    { x: 300, y: 560, width: 32, height: 32, type: 'normal' }    // près
  ];
  snap.playerBullets = []; snap.enemyBullets = []; snap.powerUps = [];
  snap.explosions = []; snap.boss = null;

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
    snap.playerBullets = []; snap.enemyBullets = []; snap.powerUps = [];
    snap.explosions = []; snap.boss = null;
    tailles.push(GAME3D.frame(snap, 800, 600).markers.enemies[0].scale);
  }
  assert.ok(tailles[0] < tailles[1] && tailles[1] < tailles[2],
    `le grossissement doit croître avec la proximité (${tailles.map((t) => t.toFixed(3)).join(' < ')})`);
});

test('sans boss, aucune coque n’est affichée', () => {
  const { GAME3D } = charger();
  const snap = instantane();
  snap.boss = null;
  const r = GAME3D.frame(snap, 800, 600);
  assert.equal(r.markers.boss, null, 'pas de boss, pas de repère');
});
