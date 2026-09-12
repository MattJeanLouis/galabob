/* =============================================================================
 *  galabob — ENNEMIS
 * -----------------------------------------------------------------------------
 *  Réécriture complète : néon vectoriel, delta-time, danger réel.
 *
 *  CE QUI A ÉTÉ RÉPARÉ (bugs bloquants du diagnostic)
 *  --------------------------------------------------
 *  1. LA FORMATION NE SE DÉPLAÇAIT JAMAIS. L'ancien code faisait
 *        enemy.x += enemySpeed * enemyDirection
 *     puis, deux fonctions plus loin, recalculait
 *        enemy.x = enemy.startX + sin(...)
 *     ce qui annulait purement et simplement le déplacement. Désormais le
 *     va-et-vient est porté par une ANCRE DE FORMATION (e.formationX/formationY)
 *     et la respiration sinusoïdale n'est qu'un OFFSET appliqué par-dessus.
 *  2. FORMATION DIAMOND : calculateFormationPositions() renvoyait moins de
 *     positions que d'ennemis demandés (8 pour 16), createFormation lisait donc
 *     entryPaths[i].start sur undefined -> TypeError silencieuse -> stage vide.
 *     La géométrie est corrigée ET toutes les formations sont désormais
 *     garanties de renvoyer EXACTEMENT `count` positions (padding de secours).
 *  3. Toutes les probabilités sont PAR SECONDE et normalisées par le delta-time
 *     (avant : Math.random() < 0.0001 PAR FRAME, soit une plongée toutes les
 *     ~3 minutes par ennemi).
 *  4. Le multiplicateur 0.3 sur shotChance est supprimé, les cadences viennent
 *     de TEMPO.ENEMY_SHOT_CHANCE_PER_SEC.
 *  5. Plus aucun Date.now() pour animer : FRAME.time (temps de JEU) partout.
 *  6. Plus de [...enemies].filter().sort() par frame dans drawEnemies().
 *  7. createEnemy() n'est plus du code mort avec des couleurs CSS 'lime'/'red' :
 *     c'est LA fabrique unique, alimentée par la table ENEMY_TYPES ci-dessous.
 *
 *  CONVENTION DE TEMPS (js/core/config.js)
 *  ---------------------------------------
 *      vitesses en PX CSS / SECONDE     durées en MS     probabilités / SECONDE
 *      pos += vitesse * dt              avec dt = deltaTime / 1000
 *      dt PEUT VALOIR 0 (hitstop, pause) : on ne fait alors rien.
 *
 *  RENDU
 *  -----
 *  Tout passe par NEON.* (js/render/neon.js) et PALETTE (js/core/palette.js).
 *  Aucune couleur en dur, aucun fillRect : des silhouettes VECTORIELLES.
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 *  ÉTAT GLOBAL (noms conservés : game.js écrit dedans)
 * -------------------------------------------------------------------------- */
let enemies = [];

// LEGACY : game.js fait `enemySpeed = 1` (initGame) puis `enemySpeed += 0.2`
// à chaque nouvelle vague. On ne s'en sert plus comme d'une vitesse (elle était
// en px/frame) mais comme d'un BONUS DE NERVOSITÉ cumulé au fil des vagues.
// La vraie vitesse de formation est calculée par getFormationSpeed(), en px/s.
let enemySpeed = 1;

let enemyDirection = 1;                      // 1 = vers la droite, -1 = vers la gauche
const enemyDrop = TEMPO.FORMATION_DROP;      // px de descente au rebond sur un bord

// Salve coordonnée : toutes les `enemyShotInterval` ms, la rangée avant tire
// ensemble. Donne un RYTHME à la pression, au lieu d'un crépitement uniforme.
let enemyShotTimer = 0;
const enemyShotInterval = 2600;              // ms

// Accalmie après l'arrivée d'une vague : le joueur doit VOIR la chorégraphie
// d'entrée avant d'être attaqué, sinon le spectacle est noyé et la première
// mort arrive avant même que la formation soit en place.
let waveGraceMs = 0;

const TWO_PI = Math.PI * 2;

/* =============================================================================
 *  TABLE UNIQUE DES CARACTÉRISTIQUES D'ENNEMIS
 *  Avant : 8 tables divergentes (createEnemy, stages.js, design_ennemie.html…).
 *  Maintenant : CECI, et rien d'autre. Les couleurs viennent de PALETTE.
 * ========================================================================== */
const ENEMY_TYPES = {
  bonus: {
    key: 'bonus', paletteKey: '#ffee55', bulletKey: 'bullet.enemy',
    hp: 2, points: 50, size: 48, speed: 1.8,
    shot: 'single', shotRate: 0, shotSpeed: 0, cooldown: 999999, diveBias: 0
  },
  normal: {
    key: 'normal',
    paletteKey: 'enemy.normal',        // magenta franc
    bulletKey: 'bullet.enemy.normal',
    hp: 1, points: 10, size: 40,
    speed: 1.00,                       // multiplicateur d'entrée / de plongée
    shot: 'single', shotRate: 1.00,
    shotSpeed: TEMPO.ENEMY_BULLET_SPEED,
    cooldown: 620,                     // ms de repos minimum entre deux attaques
    diveBias: 1.00
  },
  shooter: {
    key: 'shooter',
    paletteKey: 'enemy.shooter',       // violet électrique
    bulletKey: 'bullet.enemy.shooter',
    hp: 2, points: 20, size: 44,
    speed: 0.82,
    shot: 'burst3', shotRate: 0.55,
    shotSpeed: TEMPO.ENEMY_BULLET_SPEED_SHOOTER,
    cooldown: 900,
    diveBias: 0.60
  },
  fast: {
    key: 'fast',
    paletteKey: 'enemy.fast',          // ambre / blanc chaud
    bulletKey: 'bullet.enemy.fast',
    hp: 1, points: 15, size: 34,
    speed: 1.45,
    shot: 'spread3', shotRate: 0.60,
    shotSpeed: TEMPO.ENEMY_BULLET_SPEED * 1.06,
    cooldown: 700,
    diveBias: 1.80
  },
  elite: {
    key: 'elite',
    paletteKey: 'enemy.elite',         // rouge néon
    bulletKey: 'bullet.enemy',
    hp: 4, points: 40, size: 50,
    speed: 1.10,
    shot: 'fan5', shotRate: 0.34,      // 5 balles d'un coup : cadence réduite
    shotSpeed: TEMPO.ENEMY_BULLET_SPEED_SHOOTER * 1.05,
    cooldown: 1150,
    diveBias: 1.15
  },
  armored: {
    key: 'armored', paletteKey: 'enemy.armored', bulletKey: 'bullet.enemy.armored',
    hp: 2, points: 45, size: 58, speed: 0.72,
    shot: 'spread3', shotRate: 0.28,
    shotSpeed: TEMPO.ENEMY_BULLET_SPEED * 0.82,
    cooldown: 1450, diveBias: 0.20
  },
  sniper: {
    key: 'sniper', paletteKey: 'enemy.sniper', bulletKey: 'bullet.enemy.sniper',
    hp: 1, points: 35, size: 46, speed: 0.88,
    shot: 'single', shotRate: 0.25,
    shotSpeed: TEMPO.ENEMY_BULLET_SPEED_SHOOTER * 1.58,
    cooldown: 1700, diveBias: 0.35, telegraphMultiplier: 1.65
  },
  asteroid: {
    key: 'asteroid', paletteKey: 'enemy.asteroid', bulletKey: 'bullet.enemy',
    hp: 6, points: 0, size: 64, speed: 1,
    shot: 'single', shotRate: 0, shotSpeed: 0,
    cooldown: 999999, diveBias: 0
  }
};

/** Caractéristiques d'un type. Ne renvoie JAMAIS undefined. */
function enemyStats(type) {
  return ENEMY_TYPES[type] || ENEMY_TYPES.normal;
}

/** Points de vie d'un type au stage donné (progression douce et lisible). */
function enemyHpFor(type, stage) {
  const st = enemyStats(type);
  const bonus = Math.min(2, Math.floor(((stage || 1) - 1) / 4));
  return st.hp + bonus;
}

/** Taille en px CSS, adaptée à la largeur de l'écran. */
function enemySizeFor(type) {
  const st = enemyStats(type);
  const scale = clamp(CANVAS_WIDTH / 1200, 0.72, 1.25);
  return Math.round(st.size * scale);
}

/** Règles du mode courant, sans rendre la fabrique dépendante d'un mode. */
function currentEnemyModeRules() {
  const runtime = (typeof window !== 'undefined') ? window.GALABOB : null;
  const mode = runtime && runtime.modes ? runtime.modes.current() : null;
  return mode && mode.progression && mode.progression.rules
    ? mode.progression.rules
    : {};
}

/* -----------------------------------------------------------------------------
 *  RYTHME — tout est dérivé de TEMPO, plus une seule constante magique.
 * -------------------------------------------------------------------------- */

/** Vitesse latérale de la formation, en PX/SECONDE. */
function getFormationSpeed() {
  const stage = (typeof stageSystem !== 'undefined' && stageSystem.currentStage) || 1;
  let v = TEMPO.FORMATION_SPEED + (stage - 1) * TEMPO.FORMATION_SPEED_PER_STAGE;
  // Bonus hérité de `enemySpeed` (+0.2 par vague survivante dans le stage).
  const legacy = (typeof enemySpeed === 'number' && isFinite(enemySpeed)) ? enemySpeed : 1;
  v += clamp(legacy - 1, 0, 6) * 28;
  return clamp(v, 70, TEMPO.FORMATION_SPEED_MAX);
}

/** Probabilité PAR SECONDE, PAR ENNEMI, de déclencher une plongée. */
function getDiveChance(type, stage) {
  const st = enemyStats(type);
  const base = TEMPO.DIVE_CHANCE_PER_SEC + ((stage || 1) - 1) * TEMPO.DIVE_CHANCE_PER_STAGE;
  return base * st.diveBias;
}

/** Probabilité PAR SECONDE, PAR ENNEMI, d'ouvrir le feu (avant pondération
 *  par le nombre de balles du pattern). */
function getEnemyShotChancePerSec(type, stage) {
  const table = TEMPO.ENEMY_SHOT_CHANCE_PER_SEC || {};
  const base = table[type] != null ? table[type] : 0.22;
  return base * Math.pow(TEMPO.ENEMY_SHOT_STAGE_MULT, Math.max(0, (stage || 1) - 1));
}

/* =============================================================================
 *  FABRIQUE UNIQUE
 *  (l'ancien createEnemy — 58 lignes de code mort avec 'lime'/'red'/'orange' —
 *   est remplacé par celle-ci, qui lit ENEMY_TYPES et PALETTE.)
 * ========================================================================== */
function createEnemy(x, y, type, stage, pattern) {
  stage = stage || 1;
  type = ENEMY_TYPES[type] ? type : 'normal';
  const st = enemyStats(type);
  const size = enemySizeFor(type);
  const col = PALETTE.get(st.paletteKey);

  const e = {
    /* --- géométrie --- */
    x: x, y: y,
    width: size, height: size,
    type: type,
    pattern: pattern || ENEMY_PATTERNS.FORMATION,

    /* --- ancre de formation : LE déplacement d'ensemble se fait ICI --- */
    formationX: x, formationY: y,
    startX: x, startY: y,          // miroirs legacy (utils.js les met à l'échelle)

    /* --- combat --- */
    hp: enemyHpFor(type, stage),
    maxHp: enemyHpFor(type, stage),
    points: st.points,
    color: col.glow,               // compat : certains modules lisent e.color
    speedModifier: st.speed * (0.92 + Math.random() * 0.16),

    /* --- entrée --- */
    hasEntered: false,
    entryProgress: 0,
    entryRate: 1,
    entryDelay: 0,
    entryPath: null,
    targetX: x, targetY: y,

    /* --- plongée : 'none' | 'telegraph' | 'dive' | 'return' --- */
    diveState: 'none',
    diving: false,                 // compat : game.js / anciens modules le lisent
    diveTele: 0, diveTeleMax: TEMPO.DIVE_TELEGRAPH_MS,
    diveT: 0, diveDur: TEMPO.DIVE_DURATION,
    dv0x: 0, dv0y: 0, dv1x: 0, dv1y: 0, dv2x: 0, dv2y: 0, dv3x: 0, dv3y: 0,

    /* --- armement --- */
    charge: 0, chargeMax: TEMPO.ENEMY_SHOT_TELEGRAPH_MS,
    shotCooldown: randRange(220, 900),
    burstLeft: 0, burstTimer: 0, burstGap: 105,
    aimAngle: Math.PI / 2,
    muzzle: 0, muzzleAngle: Math.PI / 2,
    diveAimX: x, diveAimY: CANVAS_HEIGHT * 0.8,

    /* --- rendu --- */
    hitFlash: 0, hitFlashMax: 90,
    lastHitX: x, lastHitY: y,
    faceAngle: 0,
    vx: 0, vy: 0,
    phase: Math.random() * TWO_PI,
    formationIndex: 0,
    _rt: true
  };

  return e;
}

/** Complète un ennemi créé ailleurs (repli de game.js, createSimpleEnemies…)
 *  pour qu'il puisse marcher, plonger, tirer et se dessiner comme les autres. */
function ensureEnemyRuntime(e) {
  if (e._rt) return;
  const type = ENEMY_TYPES[e.type] ? e.type : 'normal';
  const st = enemyStats(type);
  const stage = (typeof stageSystem !== 'undefined' && stageSystem.currentStage) || 1;

  e.type = type;
  e._rt = true;
  if (typeof e.width !== 'number' || !(e.width > 0)) e.width = enemySizeFor(type);
  if (typeof e.height !== 'number' || !(e.height > 0)) e.height = e.width;
  // ANCRE DE FORMATION. Pour un ennemi qui n'est pas encore entré, l'ancre doit
  // être sa DESTINATION (targetX/targetY), jamais sa position de départ : le
  // repli d'urgence de game.js fait naître ses ennemis à y = -60, et les ancrer
  // là les laisserait marcher au-dessus de l'écran, à jamais inatteignables —
  // le stage ne pourrait plus se terminer.
  if (typeof e.formationX !== 'number' || !isFinite(e.formationX)) {
    if (e.hasEntered) {
      e.formationX = (isFinite(e.startX) && e.startX !== 0) ? e.startX : e.x;
    } else {
      e.formationX = (isFinite(e.targetX) && e.targetX !== 0) ? e.targetX : e.x;
    }
  }
  if (typeof e.formationY !== 'number' || !isFinite(e.formationY)) {
    if (e.hasEntered) {
      e.formationY = (isFinite(e.startY) && e.startY !== 0) ? e.startY : e.y;
    } else {
      e.formationY = (isFinite(e.targetY) && e.targetY > -e.height) ? e.targetY : Math.max(e.y, 90);
    }
  }
  if (typeof e.hp !== 'number' || !(e.hp > 0)) e.hp = enemyHpFor(type, stage);
  if (typeof e.maxHp !== 'number' || !(e.maxHp > 0)) e.maxHp = e.hp;
  if (typeof e.points !== 'number' || !(e.points > 0)) e.points = st.points;
  if (typeof e.speedModifier !== 'number' || !isFinite(e.speedModifier)) e.speedModifier = st.speed;
  if (typeof e.pattern !== 'string') e.pattern = ENEMY_PATTERNS.PATROL;
  if (typeof e.targetY !== 'number') e.targetY = e.y;
  if (typeof e.targetX !== 'number') e.targetX = e.x;

  e.color = PALETTE.get(st.paletteKey).glow;
  // Une plongée héritée n'a pas de courbe : on la remet à zéro plutôt que de
  // faire évaluer une Bézier sur des coordonnées absentes.
  e.diveState = 'none';
  e.diving = false;
  if (typeof e.diveTele !== 'number') e.diveTele = 0;
  e.diveTeleMax = TEMPO.DIVE_TELEGRAPH_MS;
  if (typeof e.diveT !== 'number') e.diveT = 0;
  if (typeof e.diveDur !== 'number') e.diveDur = TEMPO.DIVE_DURATION;
  if (typeof e.charge !== 'number') e.charge = 0;
  e.chargeMax = TEMPO.ENEMY_SHOT_TELEGRAPH_MS;
  if (typeof e.shotCooldown !== 'number') e.shotCooldown = randRange(220, 900);
  if (typeof e.burstLeft !== 'number') e.burstLeft = 0;
  if (typeof e.burstTimer !== 'number') e.burstTimer = 0;
  if (typeof e.burstGap !== 'number') e.burstGap = 105;
  if (typeof e.aimAngle !== 'number') e.aimAngle = Math.PI / 2;
  if (typeof e.muzzle !== 'number') e.muzzle = 0;
  if (typeof e.muzzleAngle !== 'number') e.muzzleAngle = Math.PI / 2;
  if (typeof e.diveAimX !== 'number') e.diveAimX = e.x;
  if (typeof e.diveAimY !== 'number') e.diveAimY = CANVAS_HEIGHT * 0.8;
  if (typeof e.hitFlash !== 'number') e.hitFlash = 0;
  if (typeof e.hitFlashMax !== 'number') e.hitFlashMax = 90;
  if (typeof e.faceAngle !== 'number') e.faceAngle = 0;
  if (typeof e.phase !== 'number') e.phase = Math.random() * TWO_PI;
  if (typeof e.formationIndex !== 'number') e.formationIndex = 0;
  if (typeof e.entryProgress !== 'number') e.entryProgress = 0;
  if (typeof e.entryRate !== 'number') e.entryRate = 1;
  if (typeof e.entryDelay !== 'number') e.entryDelay = 0;
  e.vx = e.vx || 0;
  e.vy = e.vy || 0;
}

/* =============================================================================
 *  CRÉATION DES FORMATIONS
 * ========================================================================== */

/** Marge latérale minimale d'une formation. */
function formationMargin() { return clamp(CANVAS_WIDTH * 0.045, 22, 70); }

/** Écart entre deux ennemis d'une formation, adapté à la largeur d'écran. */
function formationSpacing() { return clamp(CANVAS_WIDTH / 15, 54, 88); }

/** Hauteur de la première rangée. */
function formationTopY() { return clamp(CANVAS_HEIGHT * 0.12, 78, 160); }

/** Répartition des types pour une vague. Renvoie EXACTEMENT `count` entrées. */
function buildTypeRoster(count, stage) {
  let normalRatio = 1, shooterRatio = 0, fastRatio = 0, eliteRatio = 0;
  let armoredRatio = 0, sniperRatio = 0;

  if (stage >= 2) { normalRatio = 0.70; shooterRatio = 0.15; fastRatio = 0.15; }
  if (stage >= 3) { normalRatio = 0.48; shooterRatio = 0.22; fastRatio = 0.20; sniperRatio = 0.10; }
  if (stage >= 5) {
    normalRatio = 0.34; shooterRatio = 0.22; fastRatio = 0.18;
    eliteRatio = 0.10; sniperRatio = 0.10; armoredRatio = 0.06;
  }
  if (stage >= 8) {
    normalRatio = 0.24; shooterRatio = 0.20; fastRatio = 0.16;
    eliteRatio = 0.14; sniperRatio = 0.14; armoredRatio = 0.12;
  }

  const roster = [];
  const nShooter = Math.round(count * shooterRatio);
  const nFast = Math.round(count * fastRatio);
  const nElite = Math.round(count * eliteRatio);
  const nArmored = Math.round(count * armoredRatio);
  const nSniper = Math.round(count * sniperRatio);
  const nNormal = Math.max(0, count - nShooter - nFast - nElite - nArmored - nSniper);

  for (let i = 0; i < nNormal; i++) roster.push('normal');
  for (let i = 0; i < nShooter; i++) roster.push('shooter');
  for (let i = 0; i < nFast; i++) roster.push('fast');
  for (let i = 0; i < nElite; i++) roster.push('elite');
  for (let i = 0; i < nArmored; i++) roster.push('armored');
  for (let i = 0; i < nSniper; i++) roster.push('sniper');
  while (roster.length < count) roster.push('normal');
  roster.length = count;

  // Mélange de Fisher-Yates
  for (let i = roster.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = roster[i]; roster[i] = roster[j]; roster[j] = tmp;
  }
  return roster;
}

/** Ajoute une rangée de `n` positions CENTRÉES sur centerX à l'ordonnée y. */
function pushFormationRow(positions, n, y, spacing, centerX, limit) {
  for (let c = 0; c < n && positions.length < limit; c++) {
    positions.push({ x: centerX + (c - (n - 1) / 2) * spacing, y: y });
  }
}

/** Positions FINALES d'une formation.
 *  ⚠ Les positions renvoyées sont des CENTRES (px CSS), pas des coins.
 *  GARANTIE : le tableau contient EXACTEMENT `count` entrées, quelle que soit
 *  la formation. C'est la correction du bug DIAMOND (8 positions pour 16
 *  ennemis -> entryPaths[i].start sur undefined -> stage vide). */
function calculateFormationPositions(formationType, count) {
  const positions = [];
  const n = Math.max(1, Math.floor(count) || 1);
  const centerX = CANVAS_WIDTH / 2;
  const topY = formationTopY();
  const spacing = formationSpacing();
  const margin = formationMargin();
  const maxCols = Math.max(2, Math.floor((CANVAS_WIDTH - margin * 2) / spacing));

  switch (formationType) {

    case FORMATIONS.WEDGE: {
      // Pointe en avant puis rangées de plus en plus larges.
      let left = n, row = 0;
      while (left > 0) {
        const take = Math.min(left, maxCols, row + 1);
        pushFormationRow(positions, take, topY + row * spacing * 0.86, spacing, centerX, n);
        left -= take;
        row++;
      }
      break;
    }

    case FORMATIONS.ARC: {
      const cols = Math.max(3, Math.min(maxCols, n));
      let row = 0;
      while (positions.length < n) {
        const take = Math.min(cols, n - positions.length);
        for (let col = 0; col < take; col++) {
          const nx = take <= 1 ? 0 : (col / (take - 1)) * 2 - 1;
          positions.push({
            x: centerX + (col - (take - 1) / 2) * spacing,
            y: topY + row * spacing * 0.92 + Math.abs(nx) * spacing * 0.62
          });
        }
        row++;
      }
      break;
    }

    case FORMATIONS.COLUMNS: {
      const cols = Math.min(n, Math.max(2, Math.min(4, maxCols)));
      const rows = Math.ceil(n / cols);
      for (let row = 0; row < rows; row++) {
        const take = Math.min(cols, n - positions.length);
        // Les colonnes impaires sont légèrement avancées : effet de phalange.
        for (let col = 0; col < take; col++) {
          positions.push({
            x: centerX + (col - (cols - 1) / 2) * spacing * 1.18,
            y: topY + row * spacing * 0.90 + (col % 2) * spacing * 0.26
          });
        }
      }
      break;
    }

    case FORMATIONS.DIAMOND: {
      // Rangées symétriques 1,3,5,…,5,3,1 tronquées pour totaliser EXACTEMENT n.
      let rows = 3;
      while (rows < 11) {
        let sum = 0;
        for (let i = 0; i < rows; i++) sum += 1 + 2 * Math.min(i, rows - 1 - i);
        if (sum >= n) break;
        rows += 2;
      }
      let left = n;
      for (let i = 0; i < rows && left > 0; i++) {
        const ideal = Math.min(1 + 2 * Math.min(i, rows - 1 - i), maxCols);
        const take = Math.min(ideal, left);
        pushFormationRow(positions, take, topY + i * spacing * 0.86, spacing, centerX, n);
        left -= take;
      }
      // Reliquat éventuel : une rangée de plus, au-dessous.
      let extraRow = rows;
      while (positions.length < n) {
        const take = Math.min(maxCols, n - positions.length);
        pushFormationRow(positions, take, topY + extraRow * spacing * 0.86, spacing, centerX, n);
        extraRow++;
      }
      break;
    }

    case FORMATIONS.CIRCLE: {
      // Ellipse (deux anneaux au-delà de 14 pour rester lisible).
      const outer = n > 14 ? Math.ceil(n * 0.65) : n;
      const inner = n - outer;
      const rx = clamp(CANVAS_WIDTH * 0.28, 130, 340);
      const ry = clamp(rx * 0.52, 70, 190);
      const cy = topY + ry + 16;
      for (let i = 0; i < outer; i++) {
        const a = (i / outer) * TWO_PI - Math.PI / 2;
        positions.push({ x: centerX + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
      }
      for (let i = 0; i < inner; i++) {
        const a = (i / Math.max(1, inner)) * TWO_PI - Math.PI / 2 + 0.4;
        positions.push({ x: centerX + Math.cos(a) * rx * 0.48, y: cy + Math.sin(a) * ry * 0.48 });
      }
      break;
    }

    case FORMATIONS.DOUBLE_ROW: {
      const per = Math.min(maxCols, Math.ceil(n / 2));
      pushFormationRow(positions, Math.min(per, n), topY, spacing, centerX, n);
      let row = 1;
      while (positions.length < n) {
        const take = Math.min(per, n - positions.length);
        pushFormationRow(positions, take, topY + row * spacing * 0.92, spacing, centerX, n);
        row++;
      }
      break;
    }

    case FORMATIONS.GRID:
    default: {
      const cols = Math.max(1, Math.min(8, maxCols, n));
      let row = 0;
      while (positions.length < n) {
        const take = Math.min(cols, n - positions.length);
        pushFormationRow(positions, take, topY + row * spacing * 0.88, spacing, centerX, n);
        row++;
      }
      break;
    }
  }

  // FILET DE SÉCURITÉ : jamais moins (ni plus) de `n` positions.
  let guard = 0;
  while (positions.length < n && guard++ < 64) {
    positions.push({ x: centerX, y: topY + (positions.length % 6) * spacing * 0.88 });
  }
  positions.length = n;

  // Tout doit rester à l'écran, avec de la marge pour la marche latérale.
  const rules = currentEnemyModeRules();
  const scale = rules.enemyScale || 1;
  const half = enemySizeFor('elite') * scale / 2;
  const lo = margin + half;
  const hi = CANVAS_WIDTH - margin - half;
  const maxY = CANVAS_HEIGHT * (rules.formationMaxY || 0.45);
  for (let i = 0; i < positions.length; i++) {
    positions[i].x = clamp(positions[i].x, lo, Math.max(lo, hi));
    positions[i].y = clamp(positions[i].y, 40 + half, maxY - half);
  }

  return positions;
}

/** Écarte les ancres qui se touchent après adaptation de taille ou clamp. */
function separateFormationPositions(positions, roster, scale) {
  const rules = currentEnemyModeRules();
  const margin = formationMargin();
  const maxY = CANVAS_HEIGHT * (rules.formationMaxY || 0.45);
  const padding = Math.max(7, formationSpacing() * 0.12);

  for (let pass = 0; pass < 28; pass++) {
    let moved = false;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        let dx = positions[j].x - positions[i].x;
        let dy = positions[j].y - positions[i].y;
        let distance = Math.hypot(dx, dy);
        const ri = enemySizeFor(roster[i]) * scale / 2;
        const rj = enemySizeFor(roster[j]) * scale / 2;
        const wanted = ri + rj + padding;
        if (distance >= wanted) continue;
        if (distance < 0.01) {
          const angle = (i * 2.17 + j * 0.91) % TWO_PI;
          dx = Math.cos(angle); dy = Math.sin(angle); distance = 1;
        }
        const push = (wanted - distance) * 0.52;
        const ux = dx / distance, uy = dy / distance;
        positions[i].x -= ux * push; positions[i].y -= uy * push;
        positions[j].x += ux * push; positions[j].y += uy * push;
        moved = true;
      }
    }
    for (let i = 0; i < positions.length; i++) {
      const radius = enemySizeFor(roster[i]) * scale / 2;
      positions[i].x = clamp(positions[i].x, margin + radius, CANVAS_WIDTH - margin - radius);
      positions[i].y = clamp(positions[i].y, 40 + radius, maxY - radius);
    }
    if (!moved) break;
  }
}

/** Chemins d'entrée (courbes de Bézier) selon la chorégraphie.
 *  Une entrée par position, toujours. Coordonnées en CENTRES. */
function calculateEntryPaths(choreographyType, targetPositions) {
  const paths = [];
  const list = targetPositions || [];
  const total = Math.max(1, list.length);
  const offY = -120;
  const W = CANVAS_WIDTH;

  for (let i = 0; i < list.length; i++) {
    const target = list[i];
    let start, c1, c2;

    switch (choreographyType) {

      case ENTRY_CHOREOGRAPHIES.SPIRAL: {
        const a = (i / total) * TWO_PI;
        start = { x: W / 2, y: offY };
        c1 = { x: W / 2 + Math.cos(a) * W * 0.34, y: 120 + Math.sin(a) * 130 };
        c2 = { x: W / 2 + Math.cos(a + Math.PI) * W * 0.30, y: 240 + Math.sin(a + Math.PI) * 110 };
        break;
      }

      case ENTRY_CHOREOGRAPHIES.ZIGZAG: {
        const side = (i % 2 === 0) ? -1 : 1;
        start = { x: side < 0 ? -70 : W + 70, y: offY + (i % 5) * 26 };
        c1 = { x: W / 2 - side * W * 0.32, y: 130 };
        c2 = { x: W / 2 + side * W * 0.28, y: 250 };
        break;
      }

      case ENTRY_CHOREOGRAPHIES.CURVE_LEFT: {
        start = { x: -80, y: 90 + ((i * 26) % 220) };
        c1 = { x: W * 0.26, y: 40 + ((i * 34) % 170) };
        c2 = { x: W * 0.58, y: 130 };
        break;
      }

      case ENTRY_CHOREOGRAPHIES.CURVE_RIGHT: {
        start = { x: W + 80, y: 90 + ((i * 26) % 220) };
        c1 = { x: W * 0.74, y: 40 + ((i * 34) % 170) };
        c2 = { x: W * 0.42, y: 130 };
        break;
      }

      case ENTRY_CHOREOGRAPHIES.SPLIT: {
        const side = i < total / 2 ? -1 : 1;
        start = { x: W / 2 + side * 30, y: offY };
        c1 = { x: W / 2 + side * W * 0.40, y: 120 };
        c2 = { x: target.x, y: 190 };
        break;
      }

      default: {
        start = { x: target.x, y: offY - (i % 6) * 34 };
        c1 = { x: target.x, y: offY + 60 };
        c2 = { x: target.x, y: (offY + target.y) / 2 };
      }
    }

    paths.push({ start: start, controlPoints: [c1, c2], end: target });
  }

  return paths;
}

/** Longueur approchée d'un chemin d'entrée -> cadence de progression (par seconde). */
function entryRateFor(path, start, target) {
  let len = 0, px = start.x, py = start.y;
  const cps = path && path.controlPoints;
  if (cps) {
    for (let i = 0; i < cps.length; i++) {
      len += Math.hypot(cps[i].x - px, cps[i].y - py);
      px = cps[i].x; py = cps[i].y;
    }
  }
  len += Math.hypot(target.x - px, target.y - py);
  if (!(len > 1)) len = 420;
  // Entre 0,40 s et 1,5 s : la chorégraphie est SPECTACULAIRE, pas ATTENTISTE.
  return clamp(TEMPO.ENTRY_SPEED / len, 1 / 1.5, 1 / 0.40);
}

/** Crée une formation complète. Signature conservée (appelée par game.js).
 *
 *  `append` (RENFORT) : les nouveaux ennemis REJOIGNENT le champ de bataille au
 *  lieu de le remplacer. C'est ce qui supprime le temps mort — jusqu'ici la
 *  vague suivante n'arrivait qu'une fois l'écran VIDE, et le joueur passait la
 *  moitié de la partie à courir après un dernier traînard.
 *
 *  En mode renfort, trois choses ne doivent SURTOUT PAS être touchées :
 *   - `enemies` n'est pas vidé ;
 *   - `enemyDirection` reste tel quel (sinon la formation en place fait un
 *     demi-tour brutal à chaque arrivée) ;
 *   - `waveGraceMs` n'est PAS relevé : cette accalmie gèle les tirs ET les
 *     plongées de TOUT le champ. La relever à chaque renfort rendrait le jeu
 *     mou en permanence.
 *  Les ancres du renfort sont décalées de la dérive courante de la formation
 *  pour que les deux groupes n'en fassent qu'un.
 */
function createFormation(count, formationType, choreographyType, stage, append) {
  stage = stage || 1;

  let driftX = 0, driftY = 0, indexBase = 0, appendTop = Infinity, appendBottom = -Infinity;

  if (append) {
    // Dérive courante de la formation en place (marche latérale + descentes).
    let minX = Infinity, maxX = -Infinity, minY = Infinity, live = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || e.isDeleted || e.isBonus || e.isHazard || typeof e.formationX !== 'number') continue;
      live++;
      if (e.formationX < minX) minX = e.formationX;
      if (e.formationX + e.width > maxX) maxX = e.formationX + e.width;
      if (e.formationY < minY) minY = e.formationY;
      if (e.formationY + e.height > appendBottom) appendBottom = e.formationY + e.height;
    }
    if (live > 0) {
      driftX = ((minX + maxX) / 2) - CANVAS_WIDTH / 2;
      appendTop = minY;
    }
    indexBase = enemies.length;
  } else {
    enemies = [];
    enemyDirection = Math.random() < 0.5 ? -1 : 1;
    enemyShotTimer = enemyShotInterval * 0.9;
    const rules = currentEnemyModeRules();
    waveGraceMs = rules.entryGraceMs == null ? 1100 : rules.entryGraceMs;
  }

  const size = clamp(Math.floor(count) || 1, 1, 34);
  const roster = buildTypeRoster(size, stage);
  // Un renfort est une rangée de relève nette. La forme spectaculaire reste
  // celle de la vague initiale ; empiler une seconde forme complète sur les
  // survivants produirait nécessairement des ancres concurrentes.
  const positions = calculateFormationPositions(append ? FORMATIONS.GRID : formationType, size);
  const rules = currentEnemyModeRules();
  const sparseScale = size <= 10 ? (rules.sparseEnemyScale || 1) : 1;
  const modeScale = (rules.enemyScale || 1) * sparseScale;
  if (append && isFinite(appendTop)) {
    let maxRadius = 0;
    for (let i = 0; i < roster.length; i++) {
      maxRadius = Math.max(maxRadius, enemySizeFor(roster[i]) * modeScale / 2);
    }
    // Si la rangée supérieure manque de place, toute la formation vivante
    // descend juste assez pour ouvrir une voie visible au renfort.
    const minCenter = 40 + maxRadius;
    let desiredCenter = appendTop - maxRadius - 8;
    if (desiredCenter < minCenter) {
      const maxY = CANVAS_HEIGHT * (rules.formationMaxY || 0.45);
      const shift = Math.max(0, Math.min(minCenter - desiredCenter, maxY - appendBottom));
      if (shift > 0) {
        for (let i = 0; i < enemies.length; i++) {
          const live = enemies[i];
          if (!live || live.isDeleted || live.isBonus || live.isHazard) continue;
          live.formationY += shift;
          live.y += shift;
          live.targetY += shift;
        }
        appendTop += shift;
        desiredCenter += shift;
      }
    }
    // Une ancre de renfort n'est jamais autorisée au-dessus de la zone visible.
    driftY = Math.max(minCenter, desiredCenter) - formationTopY();
  }
  separateFormationPositions(positions, roster, modeScale);
  const paths = calculateEntryPaths(choreographyType, positions);

  const fallback = { x: CANVAS_WIDTH / 2, y: formationTopY() };

  for (let i = 0; i < size; i++) {
    const target = positions[i] || fallback;
    const path = paths[i] || { start: { x: target.x, y: -120 }, controlPoints: null, end: target };
    const start = path.start || { x: target.x, y: -120 };

    const e = createEnemy(0, 0, roster[i], stage, ENEMY_PATTERNS.FORMATION);
    if (modeScale !== 1) {
      e.width = Math.round(e.width * modeScale);
      e.height = Math.round(e.height * modeScale);
    }

    // Ancre de formation, en coordonnées COIN (comme e.x / e.y).
    e.formationX = clamp(target.x + driftX, 12, CANVAS_WIDTH - 12) - e.width / 2;
    e.formationY = target.y + driftY - e.height / 2;
    e.startX = e.formationX;
    e.startY = e.formationY;
    e.targetX = e.formationX;
    e.targetY = e.formationY;

    e.x = start.x + driftX - e.width / 2;
    e.y = start.y - e.height / 2;

    e.formationIndex = indexBase + i;
    e.entryPath = path;
    e.entryProgress = 0;
    e.entryRate = entryRateFor(path, start, target) * (rules.entrySpeedMultiplier || 1);
    // Décalage d'entrée : échelonné pour la chorégraphie, mais PLAFONNÉ. Sans
    // ce plafond, une vague de 22 attendrait 1,2 s avant que le dernier parte.
    e.entryDelay = (size > 1)
      ? (i / (size - 1)) * Math.min(size * TEMPO.ENTRY_STAGGER_MS, 620)
      : 0;
    e.hasEntered = false;
    e.phase = i * 0.55 + Math.random() * 0.5;
    e.shotCooldown = 500 + i * 40 + randRange(0, 500);

    enemies.push(e);
  }
}

/** Vague libre (hors formation). Conservée pour compatibilité ; elle délègue
 *  désormais à createFormation pour ne plus dupliquer la logique. */
function createEnemyWave(count) {
  try {
    const stage = (typeof stageSystem !== 'undefined' && stageSystem.currentStage) || 1;
    const formations = Object.values(FORMATIONS);
    const choreos = [
      ENTRY_CHOREOGRAPHIES.CURVE_LEFT, ENTRY_CHOREOGRAPHIES.CURVE_RIGHT,
      ENTRY_CHOREOGRAPHIES.ZIGZAG, ENTRY_CHOREOGRAPHIES.SPLIT, ENTRY_CHOREOGRAPHIES.SPIRAL
    ];
    createFormation(clamp(count || 8, 1, 30), pick(formations), pick(choreos), stage);
  } catch (e) {
    console.error("Erreur dans createEnemyWave:", e);
  }
}

/* =============================================================================
 *  MISE À JOUR
 * ========================================================================== */

/* Point de Bézier cubique, SANS allocation (résultat dans _bz). */
const _bz = { x: 0, y: 0 };
function bezierXY(t, x0, y0, x1, y1, x2, y2, x3, y3) {
  const u = 1 - t;
  const u2 = u * u, u3 = u2 * u;
  const t2 = t * t, t3 = t2 * t;
  const a = u3, b = 3 * u2 * t, c = 3 * u * t2, d = t3;
  _bz.x = a * x0 + b * x1 + c * x2 + d * x3;
  _bz.y = a * y0 + b * y1 + c * y2 + d * y3;
  if (!isFinite(_bz.x)) _bz.x = x0 + (x3 - x0) * t;
  if (!isFinite(_bz.y)) _bz.y = y0 + (y3 - y0) * t;
  return _bz;
}

/* -----------------------------------------------------------------------------
 *  1. MARCHE DE LA FORMATION — LE BUG BLOQUANT N°1
 *  Le va-et-vient est porté par l'ANCRE (formationX/formationY). Les oscillations
 *  sinusoïdales sont ensuite ajoutées PAR-DESSUS dans applyFormationOffsets(),
 *  au lieu d'écraser la position comme le faisait l'ancien code.
 * -------------------------------------------------------------------------- */
function updateFormationMarch(dt) {
  let minX = Infinity, maxX = -Infinity, lowest = -Infinity, n = 0;

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || e.isDeleted || e.isBonus || e.isHazard || !e.hasEntered) continue;
    if (e.diveState === 'dive' || e.diveState === 'return') continue;
    n++;
    if (e.formationX < minX) minX = e.formationX;
    if (e.formationX + e.width > maxX) maxX = e.formationX + e.width;
    if (e.formationY + e.height > lowest) lowest = e.formationY + e.height;
  }

  let step = 0;
  let drop = 0;

  if (n > 0) {
    const margin = 10;
    const span = maxX - minX;
    const room = CANVAS_WIDTH - margin * 2;

    // Formation plus large que l'écran (fenêtre réduite brutalement) : on la
    // recentre au lieu de laisser les deux corrections de bord se battre.
    if (span > room) {
      const shift = (CANVAS_WIDTH / 2 - (minX + span / 2));
      if (Math.abs(shift) > 0.5) {
        for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          if (e && !e.isDeleted) e.formationX += shift * Math.min(1, dt * 6);
        }
      }
      return;
    }

    step = getFormationSpeed() * enemyDirection * dt;

    // Rebond sur les bords : demi-tour + descente d'un cran (Galaga).
    if (enemyDirection > 0 && maxX + step > CANVAS_WIDTH - margin) {
      enemyDirection = -1; step = 0; drop = enemyDrop;
    } else if (enemyDirection < 0 && minX + step < margin) {
      enemyDirection = 1; step = 0; drop = enemyDrop;
    }

    // Rattrapage si la formation déborde déjà (redimensionnement de fenêtre…)
    if (maxX + step > CANVAS_WIDTH - margin) step = (CANVAS_WIDTH - margin) - maxX;
    if (minX + step < margin) step = margin - minX;

    // Le mode Assaut avance comme une armée d'invasion : toute la ligne
    // descend continuellement au lieu d'envoyer les plongeurs de l'Arcade.
    const runtime = (typeof window !== 'undefined') ? window.GALABOB : null;
    const mode = runtime && runtime.modes ? runtime.modes.current() : null;
    const rules = mode && mode.progression ? mode.progression.rules : null;
    if (rules && rules.descentPerSecond > 0) {
      drop += rules.descentPerSecond * (1 + Math.max(0, stageSystem.currentStage - 1) * 0.018) * dt;
    }

    // On ne descend jamais au-delà de la limite de sécurité.
    if (drop > 0 && lowest + drop > CANVAS_HEIGHT * TEMPO.FORMATION_MAX_DESCENT) drop = 0;
  }

  if (step === 0 && drop === 0) return;

  // L'ancre de TOUS les ennemis avance, y compris ceux qui entrent encore et
  // ceux qui sont en plongée : ils rejoindront une formation qui a bougé.
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || e.isDeleted) continue;
    e.formationX += step;
    e.formationY += drop;
  }
}

/* -----------------------------------------------------------------------------
 *  2. RESPIRATION ET PATTERNS — de simples OFFSETS autour de l'ancre
 * -------------------------------------------------------------------------- */
function applyFormationOffsets(e) {
  const t = FRAME.time;                     // temps de JEU (jamais Date.now())
  const ph = e.phase + e.formationIndex * 0.28;

  let ox = Math.sin(t * TWO_PI * TEMPO.FORMATION_SWAY_HZ + ph) * TEMPO.FORMATION_SWAY_AMP;
  let oy = Math.sin(t * TWO_PI * TEMPO.FORMATION_BOB_HZ + ph * 0.7) * TEMPO.FORMATION_BOB_AMP;

  if (e.pattern === ENEMY_PATTERNS.SWEEP) {
    oy += Math.sin(t * 1.75 + ph) * e.height * 0.55;
    ox += Math.cos(t * 1.15 + ph) * e.width * 0.45;
  } else if (e.pattern === ENEMY_PATTERNS.ZIGZAG) {
    const tri = Math.abs(((t * 1.15 + ph / TWO_PI) % 2) - 1) * 2 - 1;
    ox += tri * e.width * 0.85;
  }

  // Anticipation de plongée : l'ennemi RECULE et vibre avant de fondre.
  if (e.diveState === 'telegraph') {
    const k = 1 - clamp(e.diveTele / Math.max(1, e.diveTeleMax), 0, 1);
    oy -= smoothstep(k) * e.height * 0.45;
    ox += Math.sin(k * 46) * e.width * 0.08;
  }

  e.x = e.formationX + ox;
  e.y = e.formationY + oy;
}

/* -----------------------------------------------------------------------------
 *  3. ENTRÉE EN SCÈNE (chorégraphie de Bézier, à vitesse constante)
 * -------------------------------------------------------------------------- */
function updateEnemyEntry(e, dtMs, dt) {
  if (e.entryDelay > 0) { e.entryDelay -= dtMs; return; }

  const ex = e.formationX + e.width / 2;      // l'ancre bouge : la cible aussi
  const ey = e.formationY + e.height / 2;

  e.entryProgress += e.entryRate * dt * clamp(e.speedModifier, 0.65, 1.8);

  if (e.entryProgress >= 1) {
    e.entryProgress = 1;
    e.hasEntered = true;
    e.x = e.formationX;
    e.y = e.formationY;
    return;
  }

  const path = e.entryPath;
  if (!path || !path.start) {
    // Chemin corrompu : on file droit sur l'ancre plutôt que de lever.
    const step = TEMPO.ENTRY_SPEED * dt;
    const dx = ex - (e.x + e.width / 2);
    const dy = ey - (e.y + e.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    if (d <= step) { e.x = e.formationX; e.y = e.formationY; e.hasEntered = true; return; }
    e.x += dx / d * step;
    e.y += dy / d * step;
    return;
  }

  const p0 = path.start;
  const cps = path.controlPoints;
  const p1 = (cps && cps[0]) || { x: p0.x + (ex - p0.x) / 3, y: p0.y + (ey - p0.y) / 3 };
  const p2 = (cps && cps[1]) || { x: p0.x + 2 * (ex - p0.x) / 3, y: p0.y + 2 * (ey - p0.y) / 3 };

  bezierXY(e.entryProgress, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, ex, ey);
  e.x = _bz.x - e.width / 2;
  e.y = _bz.y - e.height / 2;
}

/* -----------------------------------------------------------------------------
 *  4. PLONGÉE — télégraphie, vol, retour
 * -------------------------------------------------------------------------- */

/** Tente de déclencher une plongée. Probabilité PAR SECONDE (jamais par frame). */
function tryStartDive(e, dt, stage) {
  if (waveGraceMs > 0) return false;
  if (!e.hasEntered || e.diveState !== 'none') return false;
  if (e.charge > 0 || e.burstLeft > 0) return false;
  if (typeof gameState !== 'undefined' && gameState !== 'playing') return false;

  let chance = getDiveChance(e.type, stage);
  if (e.pattern === ENEMY_PATTERNS.DIVE) chance *= 1.8;
  if (Math.random() >= chance * dt) return false;

  // Cap visé mémorisé DÈS la télégraphie : la ligne d'anticipation affichée
  // est donc exactement celle que l'ennemi va suivre. Le joueur peut LIRE.
  let px = CANVAS_WIDTH / 2;
  if (typeof player !== 'undefined' && player) {
    px = player.x + player.width / 2 + (player.vx || 0) * 0.20;
  }
  e.diveAimX = clamp(px + randRange(-70, 70), 40, CANVAS_WIDTH - 40);
  e.diveAimY = clamp(
    (typeof player !== 'undefined' && player ? player.y : CANVAS_HEIGHT * 0.8) + 10,
    CANVAS_HEIGHT * 0.45, CANVAS_HEIGHT - 30
  );

  e.diveState = 'telegraph';
  e.diveTele = TEMPO.DIVE_TELEGRAPH_MS;
  e.diveTeleMax = TEMPO.DIVE_TELEGRAPH_MS;

  // Le son doit prévenir PENDANT la télégraphie (320 ms), pas au départ.
  if (typeof gameEvent === 'function') gameEvent('diveAlert', { type: e.type });
  return true;
}

/** Construit la courbe de plongée au sortir de la télégraphie. */
function beginDivePath(e) {
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height / 2;
  const px = (typeof e.diveAimX === 'number') ? e.diveAimX : CANVAS_WIDTH / 2;
  const py = (typeof e.diveAimY === 'number') ? e.diveAimY : CANVAS_HEIGHT * 0.78;
  const side = (cx < px) ? 1 : -1;

  e.dv0x = cx;                              e.dv0y = cy;
  e.dv1x = cx + side * randRange(20, 120);  e.dv1y = cy + randRange(90, 200);
  e.dv2x = px + randRange(-45, 45);         e.dv2y = py - randRange(10, 130);
  e.dv3x = clamp(px + randRange(-170, 170), -60, CANVAS_WIDTH + 60);
  e.dv3y = CANVAS_HEIGHT + 130;

  const len = Math.hypot(e.dv1x - e.dv0x, e.dv1y - e.dv0y)
            + Math.hypot(e.dv2x - e.dv1x, e.dv2y - e.dv1y)
            + Math.hypot(e.dv3x - e.dv2x, e.dv3y - e.dv2y);

  const sp = TEMPO.DIVE_SPEED * clamp(e.speedModifier, 0.7, 1.8);
  e.diveDur = clamp(len / Math.max(60, sp) * 1000,
                    TEMPO.DIVE_DURATION * 0.55, TEMPO.DIVE_DURATION * 1.9);
  e.diveT = 0;
  e.diveState = 'dive';
  e.diving = true;
  e.shotCooldown = Math.min(e.shotCooldown, 200);
}

function updateDiveFlight(e, dtMs) {
  e.diveT += dtMs;
  const t = clamp(e.diveT / Math.max(1, e.diveDur), 0, 1);
  bezierXY(t, e.dv0x, e.dv0y, e.dv1x, e.dv1y, e.dv2x, e.dv2y, e.dv3x, e.dv3y);
  e.x = _bz.x - e.width / 2;
  e.y = _bz.y - e.height / 2;

  if (t >= 1 || e.y > CANVAS_HEIGHT + 70) {
    // Sortie par le bas, retour par le haut : c'est la boucle de Galaga.
    e.diveState = 'return';
    e.diving = true;
    e.x = clamp(e.formationX + randRange(-40, 40), 10, Math.max(10, CANVAS_WIDTH - e.width - 10));
    e.y = -e.height - randRange(20, 100);
  }
}

function updateDiveReturn(e, dt) {
  const tx = e.formationX;
  const ty = e.formationY;
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  const step = TEMPO.DIVE_RETURN_SPEED * clamp(e.speedModifier, 0.8, 1.7) * dt;

  if (d <= step || d < 3) {
    e.x = tx; e.y = ty;
    e.diveState = 'none';
    e.diving = false;
    e.diveT = 0;
    e.shotCooldown = Math.max(e.shotCooldown, 300);
  } else {
    e.x += dx / d * step;
    e.y += dy / d * step;
  }
}

/* -----------------------------------------------------------------------------
 *  5. ARMEMENT — télégraphie de charge puis pattern selon le TYPE
 * -------------------------------------------------------------------------- */

/** Angle de tir vers le joueur, contraint vers le bas de l'écran. */
function enemyAimAngle(e) {
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height * 0.85;
  let a = Math.PI / 2;                       // droit vers le bas par défaut

  if (typeof player !== 'undefined' && player &&
      typeof gameState !== 'undefined' && gameState === 'playing') {
    a = Math.atan2((player.y + player.height * 0.45) - cy, (player.x + player.width / 2) - cx);
  }
  if (!isFinite(a)) a = Math.PI / 2;

  // Jamais de tir vers le haut : si le joueur est au-dessus, on rase de côté.
  if (a < 0) a = (Math.cos(a) >= 0) ? 0.22 : Math.PI - 0.22;
  return clamp(a, 0.22, Math.PI - 0.22);
}

/** Un ennemi juste en dessous ? Alors on laisse la rangée avant tirer. */
function hasAllyBelow(e) {
  const cx = e.x + e.width / 2;
  const reach = e.width * 0.6;
  for (let i = 0; i < enemies.length; i++) {
    const o = enemies[i];
    if (!o || o === e || o.isDeleted || !o.hasEntered) continue;
    if (o.y <= e.y + e.height * 0.5) continue;
    if (Math.abs((o.x + o.width / 2) - cx) < reach) return true;
  }
  return false;
}

/** Ouvre la charge : c'est CE moment que le joueur doit voir venir. */
function startEnemyCharge(e) {
  const telegraph = TEMPO.ENEMY_SHOT_TELEGRAPH_MS * (enemyStats(e.type).telegraphMultiplier || 1);
  e.charge = telegraph;
  e.chargeMax = telegraph;
  e.aimAngle = enemyAimAngle(e);
}

/** Envoie une balle. Passe par spawnEnemyBullet() de projectiles.js quand il
 *  existe (vitesses en px/s, vx/vy intégrés là-bas), sinon pousse un objet brut
 *  que normalizeBullet() saura reprendre. */
function emitEnemyShot(e, angle) {
  if (typeof enemyBullets === 'undefined' || !enemyBullets) return;
  if (enemyBullets.length >= TEMPO.ENEMY_SHOT_MAX_ONSCREEN) return;

  const st = enemyStats(e.type);
  const sp = st.shotSpeed;
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height * 0.80;
  const vx = Math.cos(angle) * sp;
  const vy = Math.sin(angle) * sp;

  e.muzzle = 95;
  e.muzzleAngle = angle;

  // Pont bruitages : SFX.play('enemyShot') a son propre anti-répétition (40 ms),
  // donc une gerbe de 5 ne produit qu'un seul son.
  if (typeof gameEvent === 'function') gameEvent('enemyShot', { type: e.type });

  if (typeof spawnEnemyBullet === 'function') {
    spawnEnemyBullet(cx, cy, { vx: vx, vy: vy, speed: sp, kind: e.type });
    return;
  }

  enemyBullets.push({
    x: cx - TEMPO.ENEMY_BULLET_W / 2, y: cy,
    width: TEMPO.ENEMY_BULLET_W, height: TEMPO.ENEMY_BULLET_H, drawH: TEMPO.ENEMY_BULLET_H,
    vx: vx, vy: vy, speed: sp,
    kind: e.type, type: e.type, owner: 'enemy', age: 0,
    color: PALETTE.bullet('enemy', e.type).glow
  });
}

/** Pattern de tir, dicté par le TYPE d'ennemi (fin du tir unique universel). */
function fireEnemyPattern(e) {
  const st = enemyStats(e.type);
  const a = enemyAimAngle(e);
  e.aimAngle = a;

  switch (st.shot) {
    case 'burst3':                  // canonnier : rafale visée de 3 coups
      e.burstLeft = 3;
      e.burstTimer = 0;
      e.burstGap = 105;
      return;                       // le cooldown est posé à la fin de la rafale

    case 'spread3':                 // intercepteur : gerbe de 3
      emitEnemyShot(e, a - 0.22);
      emitEnemyShot(e, a);
      emitEnemyShot(e, a + 0.22);
      break;

    case 'fan5':                    // élite : éventail de 5
      for (let i = -2; i <= 2; i++) emitEnemyShot(e, a + i * 0.26);
      break;

    case 'single':
    default:
      emitEnemyShot(e, a);
      break;
  }

  e.shotCooldown = st.cooldown * randRange(0.85, 1.25);
}

function updateEnemyWeapon(e, dtMs, dt, stage) {
  if (e.shotCooldown > 0) e.shotCooldown -= dtMs;
  if (e.muzzle > 0) e.muzzle -= dtMs;

  // Rafale en cours
  if (e.burstLeft > 0) {
    e.burstTimer -= dtMs;
    if (e.burstTimer <= 0) {
      emitEnemyShot(e, enemyAimAngle(e));
      e.burstLeft--;
      e.burstTimer = e.burstGap;
      if (e.burstLeft <= 0) e.shotCooldown = enemyStats(e.type).cooldown * randRange(0.9, 1.3);
    }
    return;
  }

  // Charge en cours (télégraphie)
  if (e.charge > 0) {
    e.charge -= dtMs;
    if (e.charge <= 0) { e.charge = 0; fireEnemyPattern(e); }
    return;
  }

  if (!e.hasEntered) return;
  if (waveGraceMs > 300) return;             // accalmie d'arrivée de vague
  if (e.shotCooldown > 0) return;
  if (e.diveState === 'telegraph' || e.diveState === 'return') return;
  if (typeof gameState !== 'undefined' && gameState !== 'playing') return;
  if (typeof enemyBullets !== 'undefined' && enemyBullets.length >= TEMPO.ENEMY_SHOT_MAX_ONSCREEN) return;

  const st = enemyStats(e.type);
  let chance = getEnemyShotChancePerSec(e.type, stage) * st.shotRate;
  if (e.diveState === 'dive') chance *= 1.45;        // les plongeurs harcèlent
  else if (hasAllyBelow(e)) chance *= 0.10;          // priorité à la rangée avant

  // Garde-fou : ENEMY_SHOT_STAGE_MULT est multiplicatif (1.08^9 = ×2 au stage 10).
  // On plafonne pour que la fin de partie reste un rideau LISIBLE, pas un mur.
  if (chance > 1.2) chance = 1.2;

  if (Math.random() < chance * dt) startEnemyCharge(e);
}

/** Salve coordonnée : donne un RYTHME à la pression au lieu d'un crépitement. */
function triggerEnemyVolley(stage) {
  if (waveGraceMs > 0) return;
  if (typeof gameState !== 'undefined' && gameState !== 'playing') return;
  if (typeof enemyBullets !== 'undefined' &&
      enemyBullets.length > TEMPO.ENEMY_SHOT_MAX_ONSCREEN * 0.55) return;

  const n = enemies.length;
  if (!n) return;

  const wanted = clamp(1 + Math.floor(((stage || 1) - 1) / 3), 1, 3);
  const off = Math.floor(Math.random() * n);
  let fired = 0;

  for (let k = 0; k < n && fired < wanted; k++) {
    const e = enemies[(k + off) % n];
    if (!e || e.isDeleted || e.isBonus || e.isHazard || !e.hasEntered) continue;
    if (e.charge > 0 || e.burstLeft > 0 || e.shotCooldown > 0) continue;
    if (e.diveState === 'telegraph' || e.diveState === 'return') continue;
    if (hasAllyBelow(e)) continue;
    startEnemyCharge(e);
    fired++;
  }
}

/* -----------------------------------------------------------------------------
 *  6. ORIENTATION — les patterns DIVE/SWEEP/ZIGZAG deviennent enfin LISIBLES
 * -------------------------------------------------------------------------- */
function updateEnemyFacing(e, prevX, prevY, dt) {
  const vx = (e.x - prevX) / dt;
  const vy = (e.y - prevY) / dt;
  e.vx = vx;
  e.vy = vy;

  let target;
  if (!e.hasEntered || e.diveState === 'dive' || e.diveState === 'return') {
    // Nez dans le sens de la marche (silhouettes dessinées nez vers le BAS).
    const sp = Math.hypot(vx, vy);
    target = (sp > 45) ? Math.atan2(-vx, vy) : e.faceAngle;
  } else {
    target = enemyDirection * 0.13;          // simple inclinaison dans la marche
  }

  let d = target - e.faceAngle;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  e.faceAngle += d * (1 - Math.pow(0.0009, dt));   // lissage indépendant du fps

  if (e.faceAngle > Math.PI) e.faceAngle -= TWO_PI;
  else if (e.faceAngle < -Math.PI) e.faceAngle += TWO_PI;
}

/* -----------------------------------------------------------------------------
 *  7. AIGUILLAGE PAR ENNEMI (signature conservée)
 * -------------------------------------------------------------------------- */
function updateEnemyMovement(enemy, deltaTime) {
  try {
    if (!enemy || typeof enemy !== 'object' || enemy.isDeleted) return;
    if (!enemy._rt) ensureEnemyRuntime(enemy);

    const dtMs = (deltaTime > 0) ? deltaTime : 0;
    const dt = dtMs / 1000;
    if (dt <= 0) return;                     // hitstop / pause : on ne fait rien

    if (!enemy.hasEntered) { updateEnemyEntry(enemy, dtMs, dt); return; }

    if (enemy.diveState === 'telegraph') {
      enemy.diveTele -= dtMs;
      if (enemy.diveTele <= 0) { beginDivePath(enemy); }
    }
    if (enemy.diveState === 'dive')   { updateDiveFlight(enemy, dtMs); return; }
    if (enemy.diveState === 'return') { updateDiveReturn(enemy, dt);   return; }

    applyFormationOffsets(enemy);
  } catch (err) {
    console.error("Erreur dans updateEnemyMovement:", err);
    if (enemy) {
      enemy.diveState = 'none';
      enemy.diving = false;
      if (isFinite(enemy.formationX)) enemy.x = enemy.formationX;
      if (isFinite(enemy.formationY)) enemy.y = enemy.formationY;
    }
  }
}

/* -----------------------------------------------------------------------------
 *  8. BOUCLE PRINCIPALE DES ENNEMIS
 * -------------------------------------------------------------------------- */
function updateEnemies(deltaTime) {
  try {
    if (!enemies || !Array.isArray(enemies) || enemies.length === 0) return;

    const dtMs = (deltaTime > 0) ? deltaTime : 0;
    const dt = dtMs / 1000;
    if (dt <= 0) return;                     // hitstop / pause

    if (typeof stageSystem !== 'undefined' && stageSystem &&
        (stageSystem.stageCompleted || stageSystem.transitionActive)) return;

    const stage = (typeof stageSystem !== 'undefined' && stageSystem.currentStage) || 1;

    // Ennemis créés ailleurs (repli de game.js, createSimpleEnemies…)
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e && !e._rt) ensureEnemyRuntime(e);
    }

    if (waveGraceMs > 0) waveGraceMs -= dtMs;

    updateFormationMarch(dt);

    // Salve coordonnée
    enemyShotTimer -= dtMs;
    if (enemyShotTimer <= 0) {
      enemyShotTimer = enemyShotInterval * randRange(0.72, 1.35);
      triggerEnemyVolley(stage);
    }

    // Plongeurs simultanés : montée en puissance par stage, plafonnée par TEMPO.
    // Au stage 1 il y a TOUJOURS un plongeur en approche, mais un seul : le
    // joueur apprend à lire l'attaque avant d'en affronter quatre.
    const maxDivers = TEMPO.DIVE_MAX_CONCURRENT <= 0
      ? 0
      : clamp(1 + Math.floor(stage / 2), 1, TEMPO.DIVE_MAX_CONCURRENT);

    let divers = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e && !e.isDeleted && e.diveState !== 'none') divers++;
    }

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || e.isDeleted) continue;

      const prevX = e.x, prevY = e.y;

      if (e.isBonus) {
        e.x += e.vx * dt;
        e.y = e.bonusBaseY + Math.sin(FRAME.time * 7 + e.phase) * 18;
        e.faceAngle = e.vx > 0 ? -Math.PI / 2 : Math.PI / 2;
        if (e.x > CANVAS_WIDTH + e.width + 40 || e.x < -e.width - 40) {
          enemies.splice(i, 1);
          i--;
        }
        continue;
      }

      if (e.isHazard) {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.faceAngle += e.spin * dt;
        if (e.y > CANVAS_HEIGHT + e.height + 50 ||
            e.x > CANVAS_WIDTH + e.width + 50 || e.x < -e.width - 50) {
          enemies.splice(i, 1);
          i--;
        }
        continue;
      }

      if (e.hitFlash > 0) { e.hitFlash -= dtMs; if (e.hitFlash < 0) e.hitFlash = 0; }

      updateEnemyMovement(e, dtMs);

      // Filet absolu : une fois entré, aucun membre d'une formation ne peut
      // remonter hors champ, même si une oscillation ou un renfort déplace son
      // ancre pendant la même frame.
      if (e.hasEntered && e.diveState === 'none' && e.y < 10) {
        e.y = 10;
        e.formationY = Math.max(e.formationY, 10);
        e.targetY = Math.max(e.targetY, 10);
      }

      if (e.hasEntered && e.diveState === 'none' && divers < maxDivers) {
        if (tryStartDive(e, dt, stage)) divers++;
      }

      updateEnemyWeapon(e, dtMs, dt, stage);
      updateEnemyFacing(e, prevX, prevY, dt);

      // Miroirs de compatibilité pour les modules qui lisent encore ces champs.
      e.diving = (e.diveState === 'dive' || e.diveState === 'return');
      e.startX = e.formationX;
      e.startY = e.formationY;
    }
  } catch (err) {
    console.error("Erreur dans updateEnemies:", err);
  }
}

/** Séparation douce entre ennemis. Les slots de formation ne se chevauchent plus
 *  par construction : cette fonction n'est plus appelée par la boucle, elle est
 *  conservée (et corrigée) pour les modules externes qui la connaissent. */
function detectEnemyCollisions() {
  try {
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (!a || a.isDeleted || !a.hasEntered || a.diveState !== 'none') continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        if (!b || b.isDeleted || !b.hasEntered || b.diveState !== 'none') continue;
        if (!rectIntersect(a, b)) continue;
        // On écarte les ANCRES, pas les positions : sinon on se battrait avec
        // les oscillations, qui réécrivent x/y à chaque frame.
        const push = 1.2;
        if (a.formationX <= b.formationX) { a.formationX -= push; b.formationX += push; }
        else { a.formationX += push; b.formationX -= push; }
      }
    }
  } catch (e) {
    console.error("Erreur lors de la détection des collisions:", e);
  }
}

/* =============================================================================
 *  RENDU NÉON VECTORIEL
 * -----------------------------------------------------------------------------
 *  Les silhouettes sont décrites UNE FOIS en coordonnées UNITAIRES (le vaisseau
 *  tient dans [-0.7, 0.7], NEZ VERS LE BAS, +y). Elles sont transformées à la
 *  volée (échelle + rotation) dans des tampons réutilisés : aucune allocation,
 *  aucun ctx.scale() — l'épaisseur des traits reste donc en px écran, ce qui est
 *  indispensable pour que le noyau clair du néon garde sa finesse.
 * ========================================================================== */

/* Tampons réutilisés (jamais réalloués) */
const _sbuf = [];
const _unit = [];
const _o = { alpha: 1, glowScale: 1, fill: false, fillAlpha: 0.28, dash: null, dashOffset: 0, passes: undefined };
let _enemyContrastSprite = null;

/** Masque doux réutilisé sous chaque menace. Il assombrit localement le décor
 *  déjà peint dans le buffer sans ajouter de bloom ni de coût de flou par frame. */
function enemyContrastSprite() {
  if (_enemyContrastSprite) return _enemyContrastSprite;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const g = cv.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(48, 48, 5, 48, 48, 47);
  grad.addColorStop(0.00, 'rgba(1, 2, 8, 0.86)');
  grad.addColorStop(0.44, 'rgba(1, 2, 8, 0.72)');
  grad.addColorStop(0.72, 'rgba(1, 2, 8, 0.34)');
  grad.addColorStop(1.00, 'rgba(1, 2, 8, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 96, 96);
  _enemyContrastSprite = cv;
  return cv;
}

function opt(alpha, glowScale, fill, fillAlpha, passes) {
  _o.alpha = alpha == null ? 1 : alpha;
  _o.glowScale = glowScale == null ? 1 : glowScale;
  _o.fill = !!fill;
  _o.fillAlpha = fillAlpha == null ? 0.26 : fillAlpha;
  _o.dash = null;
  _o.dashOffset = 0;
  _o.passes = passes;
  return _o;
}

/** Transforme un tracé unitaire (échelle `s`, rotation cos/sin) et l'empile. */
function toScreen(unit, cx, cy, s, cos, sin) {
  const n = unit.length;
  _sbuf.length = n;
  for (let i = 0; i < n; i += 2) {
    const px = unit[i] * s, py = unit[i + 1] * s;
    _sbuf[i]     = cx + px * cos - py * sin;
    _sbuf[i + 1] = cy + px * sin + py * cos;
  }
  return _sbuf;
}

function eShape(c, unit, cx, cy, s, cos, sin, col, w, o) {
  NEON.shape(c, toScreen(unit, cx, cy, s, cos, sin), col, w, o);
}

function ePoly(c, unit, cx, cy, s, cos, sin, col, w, o) {
  NEON.polyline(c, toScreen(unit, cx, cy, s, cos, sin), col, w, o);
}

function eLine(c, cx, cy, s, cos, sin, ax, ay, bx, by, col, w, o) {
  const x1 = cx + (ax * s) * cos - (ay * s) * sin;
  const y1 = cy + (ax * s) * sin + (ay * s) * cos;
  const x2 = cx + (bx * s) * cos - (by * s) * sin;
  const y2 = cy + (bx * s) * sin + (by * s) * cos;
  NEON.line(c, x1, y1, x2, y2, col, w, o);
}

function eDot(c, cx, cy, s, cos, sin, ax, ay, r, col, o) {
  const x = cx + (ax * s) * cos - (ay * s) * sin;
  const y = cy + (ax * s) * sin + (ay * s) * cos;
  NEON.dot(c, x, y, r, col, o);
}

function eRing(c, cx, cy, s, cos, sin, ax, ay, r, thick, col, o) {
  const x = cx + (ax * s) * cos - (ay * s) * sin;
  const y = cy + (ax * s) * sin + (ay * s) * cos;
  NEON.ring(c, x, y, r, thick, col, o);
}

/* --------------------------------- SILHOUETTES UNITAIRES ------------------ */

/* MITE — magenta. Corps fuselé, deux ailes qui battent, deux antennes. */
const SHAPE_NORMAL_BODY = [
   0.00,  0.52,
   0.20,  0.16,
   0.13, -0.28,
   0.00, -0.46,
  -0.13, -0.28,
  -0.20,  0.16
];

/* CANONNIER — violet. Coque large, deux canons, épaulements. */
const SHAPE_SHOOTER_BODY = [
  -0.34, -0.24,
   0.34, -0.24,
   0.46,  0.10,
   0.24,  0.36,
  -0.24,  0.36,
  -0.46,  0.10
];

/* INTERCEPTEUR — ambre. Dard effilé. */
const SHAPE_FAST_BODY = [
   0.00,  0.58,
   0.21, -0.08,
   0.10, -0.42,
  -0.10, -0.42,
  -0.21, -0.08
];

/* ÉLITE — rouge. Étoile à 8 branches. */
const SHAPE_ELITE_STAR = (function () {
  const a = [];
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * TWO_PI - Math.PI / 2;
    const r = (i % 2 === 0) ? 0.58 : 0.25;
    a.push(Math.cos(ang) * r, Math.sin(ang) * r);
  }
  return a;
})();

/* ------------------------------------ DESSIN PAR TYPE --------------------- */

function drawShipNormal(c, cx, cy, s, cos, sin, col, w, alpha, gs, t, phase) {
  const flap = 1 + Math.sin(t * 5.2 + phase) * 0.11;

  eShape(c, SHAPE_NORMAL_BODY, cx, cy, s, cos, sin, col, w, opt(alpha, gs, true, 0.20));

  // Aile gauche puis droite (miroir), en tracé ouvert : ça reste VECTORIEL.
  for (let side = -1; side <= 1; side += 2) {
    _unit.length = 10;
    _unit[0] = side * 0.17;         _unit[1] = -0.10;
    _unit[2] = side * 0.52 * flap;  _unit[3] = -0.36 * flap;
    _unit[4] = side * 0.66 * flap;  _unit[5] =  0.06;
    _unit[6] = side * 0.33;         _unit[7] =  0.27;
    _unit[8] = side * 0.17;         _unit[9] =  0.12;
    ePoly(c, _unit, cx, cy, s, cos, sin, col, w * 0.9, opt(alpha * 0.95, gs));
  }

  // Antennes
  eLine(c, cx, cy, s, cos, sin,  0.07, -0.40,  0.25, -0.68, col, w * 0.6, opt(alpha * 0.75, gs));
  eLine(c, cx, cy, s, cos, sin, -0.07, -0.40, -0.25, -0.68, col, w * 0.6, opt(alpha * 0.75, gs));

  // Œil : le point de mire du joueur.
  eDot(c, cx, cy, s, cos, sin, 0, -0.04, s * 0.13, col, opt(alpha, gs * 1.1));
}

function drawShipShooter(c, cx, cy, s, cos, sin, col, w, alpha, gs, t, phase) {
  eShape(c, SHAPE_SHOOTER_BODY, cx, cy, s, cos, sin, col, w, opt(alpha, gs, true, 0.20));

  for (let side = -1; side <= 1; side += 2) {
    // Canon
    eLine(c, cx, cy, s, cos, sin, side * 0.27, 0.28, side * 0.27, 0.64, col, w * 1.35, opt(alpha, gs));
    // Épaulement
    _unit.length = 6;
    _unit[0] = side * 0.46; _unit[1] =  0.10;
    _unit[2] = side * 0.62; _unit[3] = -0.08;
    _unit[4] = side * 0.50; _unit[5] =  0.26;
    ePoly(c, _unit, cx, cy, s, cos, sin, col, w * 0.85, opt(alpha * 0.9, gs));
    // Pointe supérieure
    eLine(c, cx, cy, s, cos, sin, side * 0.18, -0.24, side * 0.29, -0.52, col, w * 0.7, opt(alpha * 0.8, gs));
  }

  // Anneau interne en rotation lente : le « réacteur » du canonnier.
  const o = opt(alpha * 0.8, gs, false, 0, 3);
  o.dash = [4, 5];
  o.dashOffset = t * 26;
  eRing(c, cx, cy, s, cos, sin, 0, 0.03, s * 0.24, w * 0.7, col, o);

  eDot(c, cx, cy, s, cos, sin, 0, 0.03, s * 0.10, col, opt(alpha, gs * 1.15));
}

function drawShipFast(c, cx, cy, s, cos, sin, col, w, alpha, gs, t, phase) {
  eShape(c, SHAPE_FAST_BODY, cx, cy, s, cos, sin, col, w, opt(alpha, gs, true, 0.22));

  for (let side = -1; side <= 1; side += 2) {
    _unit.length = 6;
    _unit[0] = side * 0.21; _unit[1] = -0.08;
    _unit[2] = side * 0.52; _unit[3] = -0.48;
    _unit[4] = side * 0.15; _unit[5] = -0.28;
    ePoly(c, _unit, cx, cy, s, cos, sin, col, w * 0.9, opt(alpha, gs));
  }

  // Tuyères : elles pulsent, c'est ce qui vend la VITESSE.
  const pulse = 0.62 + Math.abs(Math.sin(t * 11 + phase)) * 0.38;
  for (let side = -1; side <= 1; side += 2) {
    eLine(c, cx, cy, s, cos, sin, side * 0.075, -0.42, side * 0.075, -0.42 - 0.26 * pulse,
          'playerThruster', w * 0.8, opt(alpha * pulse * 0.85, gs * 1.3));
  }

  eDot(c, cx, cy, s, cos, sin, 0, 0.12, s * 0.10, col, opt(alpha, gs * 1.1));
}

function drawShipElite(c, cx, cy, s, cos, sin, col, w, alpha, gs, t, phase) {
  const spin = t * 0.9 + phase;
  const rc = Math.cos(spin), rs = Math.sin(spin);
  // Rotation propre de l'étoile, composée avec l'orientation du vaisseau.
  const ccos = cos * rc - sin * rs;
  const csin = sin * rc + cos * rs;

  eShape(c, SHAPE_ELITE_STAR, cx, cy, s, ccos, csin, col, w * 0.9, opt(alpha, gs, true, 0.16));

  const o = opt(alpha * 0.85, gs, false, 0, 3);
  o.dash = [6, 7];
  o.dashOffset = -t * 42;
  eRing(c, cx, cy, s, cos, sin, 0, 0, s * 0.38, w * 0.8, col, o);

  _unit.length = 6;
  _unit[0] =  0.00; _unit[1] =  0.30;
  _unit[2] =  0.26; _unit[3] = -0.16;
  _unit[4] = -0.26; _unit[5] = -0.16;
  eShape(c, _unit, cx, cy, s, cos, sin, col, w * 0.75, opt(alpha * 0.9, gs));

  eDot(c, cx, cy, s, cos, sin, 0, 0, s * 0.14, col, opt(alpha, gs * 1.2));
}

function drawShipArmored(c, cx, cy, s, cos, sin, col, w, alpha, gs, t, phase) {
  // Une forteresse courte et large : la silhouette annonce immédiatement les PV.
  _unit.length = 16;
  _unit[0] = 0; _unit[1] = 0.58;
  _unit[2] = 0.50; _unit[3] = 0.32;
  _unit[4] = 0.62; _unit[5] = -0.14;
  _unit[6] = 0.30; _unit[7] = -0.48;
  _unit[8] = 0; _unit[9] = -0.36;
  _unit[10] = -0.30; _unit[11] = -0.48;
  _unit[12] = -0.62; _unit[13] = -0.14;
  _unit[14] = -0.50; _unit[15] = 0.32;
  eShape(c, _unit, cx, cy, s, cos, sin, col, w * 1.25, opt(alpha, gs, true, 0.24));
  for (let side = -1; side <= 1; side += 2) {
    eLine(c, cx, cy, s, cos, sin, side * 0.23, -0.25, side * 0.48, 0.28,
      col, w * 1.05, opt(alpha * 0.8, gs));
  }
  const pulse = 0.72 + Math.sin(t * 3.2 + phase) * 0.16;
  eRing(c, cx, cy, s, cos, sin, 0, 0.03, s * 0.22, w, col, opt(alpha * pulse, gs));
  eDot(c, cx, cy, s, cos, sin, 0, 0.03, s * 0.10, col, opt(alpha, gs * 1.2));
}

function drawShipSniper(c, cx, cy, s, cos, sin, col, w, alpha, gs, t) {
  // Aiguille asymétrique et viseur : peu de PV, mais un tir rapide et précis.
  _unit.length = 12;
  _unit[0] = 0; _unit[1] = 0.68;
  _unit[2] = 0.22; _unit[3] = 0.06;
  _unit[4] = 0.12; _unit[5] = -0.52;
  _unit[6] = -0.08; _unit[7] = -0.34;
  _unit[8] = -0.42; _unit[9] = 0.02;
  _unit[10] = -0.16; _unit[11] = 0.22;
  eShape(c, _unit, cx, cy, s, cos, sin, col, w, opt(alpha, gs, true, 0.15));
  eLine(c, cx, cy, s, cos, sin, 0, -0.48, 0, 0.58, col, w * 0.65, opt(alpha, gs));
  const sight = opt(alpha * 0.8, gs, false, 0, 3);
  sight.dash = [3, 5]; sight.dashOffset = -t * 24;
  eRing(c, cx, cy, s, cos, sin, -0.05, 0.02, s * 0.24, w * 0.65, col, sight);
  eDot(c, cx, cy, s, cos, sin, -0.05, 0.02, s * 0.07, col, opt(alpha, gs * 1.35));
}

function drawAsteroid(c, cx, cy, s, cos, sin, col, w, alpha, gs) {
  _unit.length = 18;
  const radii = [0.56, 0.44, 0.61, 0.48, 0.58, 0.43, 0.62, 0.47, 0.54];
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * TWO_PI - Math.PI / 2;
    _unit[i * 2] = Math.cos(a) * radii[i];
    _unit[i * 2 + 1] = Math.sin(a) * radii[i];
  }
  eShape(c, _unit, cx, cy, s, cos, sin, col, w, opt(alpha, gs, true, 0.13));
  eLine(c, cx, cy, s, cos, sin, -0.26, -0.14, 0.12, 0.24, col, w * 0.60, opt(alpha * 0.55, gs));
  eLine(c, cx, cy, s, cos, sin, 0.12, 0.24, 0.34, 0.06, col, w * 0.55, opt(alpha * 0.48, gs));
  eRing(c, cx, cy, s, cos, sin, 0.20, -0.18, s * 0.12, w * 0.55, col, opt(alpha * 0.50, gs));
}

/** Aiguillage des silhouettes. */
function drawEnemySilhouette(c, type, cx, cy, s, cos, sin, col, w, alpha, gs, t, phase) {
  switch (type) {
    case 'bonus':   drawShipElite(c, cx, cy, s, cos, sin, col, w * 1.25, alpha, gs * 1.35, t * 1.8, phase); break;
    case 'shooter': drawShipShooter(c, cx, cy, s, cos, sin, col, w, alpha, gs, t, phase); break;
    case 'fast':    drawShipFast(c, cx, cy, s, cos, sin, col, w, alpha, gs, t, phase);    break;
    case 'elite':   drawShipElite(c, cx, cy, s, cos, sin, col, w, alpha, gs, t, phase);   break;
    case 'armored': drawShipArmored(c, cx, cy, s, cos, sin, col, w, alpha, gs, t, phase); break;
    case 'sniper':  drawShipSniper(c, cx, cy, s, cos, sin, col, w, alpha, gs, t);          break;
    case 'asteroid':drawAsteroid(c, cx, cy, s, cos, sin, col, w, alpha, gs);                 break;
    case 'normal':
    default:        drawShipNormal(c, cx, cy, s, cos, sin, col, w, alpha, gs, t, phase);  break;
  }
}

/* ------------------------------------ TÉLÉGRAPHIES ------------------------ */

/** Anticipation de plongée : anneau qui se resserre, ligne d'intention vers la
 *  cible RÉELLE, chevrons d'accélération. Le joueur voit l'attaque arriver. */
function drawDiveTelegraph(c, e, cx, cy, s, k) {
  const key = 'enemyDiving';

  NEON.ring(c, cx, cy, s * (2.3 - 1.5 * k), 1.7, key, {
    alpha: 0.18 + 0.55 * (1 - k), passes: 3, glowScale: 1.2
  });

  if (isFinite(e.diveAimX) && isFinite(e.diveAimY)) {
    NEON.line(c, cx, cy + s * 0.6, e.diveAimX, e.diveAimY, key, 1.4, {
      alpha: 0.08 + 0.26 * k, dash: [5, 14], dashOffset: -FRAME.time * 110, passes: 2
    });
    NEON.ring(c, e.diveAimX, e.diveAimY, 5 + 18 * k, 1.2, key, { alpha: 0.32 * k, passes: 2 });
  }

  const ch = s * (0.95 + k * 0.75);
  NEON.polyline(c, [
    cx - s * 0.36, cy + ch - s * 0.24,
    cx,            cy + ch,
    cx + s * 0.36, cy + ch - s * 0.24
  ], key, 2, { alpha: 0.22 + 0.62 * k, passes: 3 });
}

/** Charge de tir : un éclat grandit au canon, deux traits convergent dessus. */
function drawShotCharge(c, e, cx, cy, s, k) {
  const key = PALETTE.bullet('enemy', e.type);
  const a = e.aimAngle || Math.PI / 2;
  if (e.type === 'sniper') {
    const reach = Math.max(CANVAS_WIDTH, CANVAS_HEIGHT) * 1.15;
    NEON.line(c, cx, cy, cx + Math.cos(a) * reach, cy + Math.sin(a) * reach,
      PALETTE.bullet('enemy', 'sniper'), 1.1, {
        alpha: 0.08 + k * 0.30, dash: [3, 12], dashOffset: -FRAME.time * 90,
        passes: 2, cap: 'butt'
      });
  }
  const ca = Math.cos(a), sa = Math.sin(a);
  const mx = cx + ca * s * 0.74;
  const my = cy + sa * s * 0.74;

  // Noyau serré : la charge doit se LIRE comme un point qui grossit, pas comme
  // une nappe diffuse qui noie la silhouette.
  NEON.dot(c, mx, my, 1.0 + 3.2 * k, key, { alpha: 0.40 + 0.60 * k, glowScale: 0.75 + k * 0.45 });

  const conv = (1 - k) * s * 0.9 + 4;
  NEON.line(c, mx - sa * conv, my + ca * conv, mx - sa * 2.5, my + ca * 2.5, key, 1.4,
            { alpha: k * 0.85, passes: 2 });
  NEON.line(c, mx + sa * conv, my - ca * conv, mx + sa * 2.5, my - ca * 2.5, key, 1.4,
            { alpha: k * 0.85, passes: 2 });
}

/** Éclair de bouche juste après le départ du coup. */
function drawMuzzleFlash(c, e, cx, cy, s) {
  const k = clamp(e.muzzle / 95, 0, 1);
  if (k <= 0) return;
  const key = PALETTE.bullet('enemy', e.type);
  const a = e.muzzleAngle || Math.PI / 2;
  const ca = Math.cos(a), sa = Math.sin(a);
  const mx = cx + ca * s * 0.76;
  const my = cy + sa * s * 0.76;

  NEON.dot(c, mx, my, 2 + 7 * k, key, { alpha: k, glowScale: 1.4 });
  NEON.line(c, mx, my, mx + ca * s * 1.15 * k, my + sa * s * 1.15 * k, key, 2.2,
            { alpha: k * 0.7, passes: 3 });
}

/** Points de vie : des segments néon, pas une barre rouge/verte opaque.
 *  Affichés UNIQUEMENT sur un ennemi déjà entamé : une jauge au-dessus de
 *  chaque vaisseau transformerait l'écran en tableau de bord. */
function drawEnemyHealth(c, e, cx, s) {
  const n = Math.max(1, Math.min(6, e.maxHp | 0));
  const seg = Math.max(4, s * 0.40);
  const gap = 3;
  const total = n * seg + (n - 1) * gap;
  const y = e.y - 7;
  let x = cx - total / 2;

  for (let i = 0; i < n; i++) {
    const alive = i < e.hp;
    NEON.line(c, x, y, x + seg, y, alive ? 'combo' : 'neutral', 2,
              { alpha: alive ? 0.85 : 0.16, passes: 2 });
    x += seg + gap;
  }
}

/* ------------------------------------ UN ENNEMI --------------------------- */

function drawEnemyShip(c, tr, e, t) {
  const st = enemyStats(e.type);
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height / 2;

  const flash = e.hitFlash > 0 ? clamp(e.hitFlash / Math.max(1, e.hitFlashMax || 90), 0, 1) : 0;
  const tele = (e.diveState === 'telegraph')
    ? 1 - clamp(e.diveTele / Math.max(1, e.diveTeleMax || TEMPO.DIVE_TELEGRAPH_MS), 0, 1)
    : 0;
  const chargeK = (e.charge > 0)
    ? 1 - clamp(e.charge / Math.max(1, e.chargeMax || TEMPO.ENEMY_SHOT_TELEGRAPH_MS), 0, 1)
    : 0;

  const breathe = 1 + Math.sin(t * 3.2 + e.phase) * 0.035;
  const s = e.width * 0.5 * breathe * (1 + flash * 0.20 + tele * 0.16);
  const ang = e.faceAngle || 0;
  const cos = Math.cos(ang), sin = Math.sin(ang);

  // Couleur = IDENTITÉ du type ; vire vers la teinte de plongée en télégraphie.
  const key = (tele > 0.02) ? 'enemyDiving' : st.paletteKey;
  const w = clamp(s * 0.11, 1.3, 3.2);
  const gs = 1 + tele * 0.9 + chargeK * 0.25;

  // Séparation figure/fond : indispensable lorsqu'un ennemi passe devant un
  // soleil, un disque d'accrétion ou une planète fortement éclairée.
  const contrast = enemyContrastSprite();
  if (contrast) {
    const pad = s * (e.isHazard ? 1.55 : 1.32);
    c.save();
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = e.isHazard ? 0.66 : 0.94;
    c.drawImage(contrast, cx - pad, cy - pad, pad * 2, pad * 2);
    c.restore();
  }

  // Traînée persistante : RÉSERVÉE à l'entrée et à la plongée. En formation, la
  // marche latérale dépasse 300 px/s aux stages élevés : y laisser une traînée
  // transformerait toute la vague en pâté lumineux.
  const streaking = (!e.hasEntered || e.diveState === 'dive' || e.diveState === 'return');
  if (tr && streaking) {
    const sp = Math.hypot(e.vx || 0, e.vy || 0);
    if (sp > 200) {
      const kk = clamp((sp - 200) / 700, 0, 1);
      NEON.line(tr, cx, cy, cx - (e.vx || 0) * 0.05, cy - (e.vy || 0) * 0.05, key,
                Math.max(2, s * 0.5), { alpha: 0.28 + kk * 0.34, passes: 2 });
    }
  }

  drawEnemySilhouette(c, e.type, cx, cy, s, cos, sin, key, w, 1, gs, t, e.phase);

  // Flash blanc d'impact + étincelle orientée sur le point de contact.
  if (flash > 0) {
    // Halo court : un flash trop diffus efface la silhouette et le joueur perd
    // l'information « lequel ai-je touché ».
    drawEnemySilhouette(c, e.type, cx, cy, s * 1.05, cos, sin, '#ffffff',
                        w * 1.05, flash * 0.78, 1.15, t, e.phase);
    if (isFinite(e.lastHitX) && isFinite(e.lastHitY)) {
      const dx = e.lastHitX - cx, dy = e.lastHitY - cy;
      const d = Math.hypot(dx, dy) || 1;
      NEON.line(c, e.lastHitX, e.lastHitY,
                e.lastHitX + dx / d * 18 * flash, e.lastHitY + dy / d * 18 * flash,
                '#ffffff', 2, { alpha: flash, passes: 3 });
      NEON.dot(c, e.lastHitX, e.lastHitY, 2 + 5 * flash, '#ffffff', { alpha: flash });
    }
  }

  if (tele > 0)    drawDiveTelegraph(c, e, cx, cy, s, tele);
  if (chargeK > 0) drawShotCharge(c, e, cx, cy, s, chargeK);
  if (e.muzzle > 0) drawMuzzleFlash(c, e, cx, cy, s);
  if (e.maxHp > 1 && e.hp > 0 && e.hp < e.maxHp) drawEnemyHealth(c, e, cx, s);
}

/* ------------------------------------ LA PASSE ---------------------------- */

/** Rendu de tous les ennemis.
 *  L'ancien code faisait [...enemies].filter().sort() À CHAQUE FRAME (2 tableaux
 *  + un tri de 16 à 30 éléments, 60 fois par seconde). En rendu additif l'ordre
 *  de dessin n'a aucune importance : une seule boucle, zéro allocation. */
function drawEnemies() {
  try {
    if (typeof stageSystem !== 'undefined' && stageSystem &&
        (stageSystem.stageCompleted || stageSystem.transitionActive)) return;
    if (typeof NEON === 'undefined' || !NEON) return;

    const c = ctx;
    if (!c) return;

    const t = FRAME.time;
    const tr = (RENDER_CONFIG.trails && NEON.trail && NEON.isEnabled()) ? NEON.trail : null;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || e.isDeleted) continue;
      if (!isFinite(e.x) || !isFinite(e.y) || !(e.width > 0)) continue;
      if (e.y > CANVAS_HEIGHT + 160 || e.y + e.height < -200) continue;
      if (!e._rt) ensureEnemyRuntime(e);
      drawEnemyShip(c, tr, e, t);
    }
  } catch (err) {
    console.error("Erreur lors du rendu des ennemis:", err);
  }
}

/* =============================================================================
 *  LEGACY — conservés pour ne rien casser chez les autres modules.
 *  Les anciennes tables de couleurs qu'ils servaient ont disparu : tout passe
 *  désormais par PALETTE.
 * ========================================================================== */

/** Conversion hex -> {r,g,b}. Délègue à PALETTE (source de vérité unique). */
function hexToRgb(hex) {
  try {
    const c = PALETTE.hexToRgb(typeof hex === 'string' ? hex : '#ff2bd6');
    return { r: c[0], g: c[1], b: c[2] };
  } catch (e) {
    return { r: 255, g: 43, b: 214 };
  }
}

/** Éclaircit / assombrit une couleur. `amount` en unités 0-255 comme avant. */
function adjustColor(color, amount) {
  try {
    const t = clamp(Math.abs(amount) / 255, 0, 1);
    const hex = (typeof color === 'string' && color.charAt(0) === '#')
      ? color : PALETTE.get(color).glow;
    return amount >= 0 ? PALETTE.lighten(hex, t) : PALETTE.darken(hex, t);
  } catch (e) {
    return color;
  }
}

/** Point sur une courbe de Bézier cubique. Signature historique conservée. */
function calculateBezierPoint(t, p0, p1, p2, p3) {
  if (!isFinite(t)) t = 0;
  t = clamp(t, 0, 1);
  if (!p0 || !p1 || !p2 || !p3) return { x: 0, y: 0 };
  bezierXY(t, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  return { x: _bz.x, y: _bz.y };
}

/* Exposition explicite (debug console / modules chargés plus tard). */
window.ENEMY_TYPES = ENEMY_TYPES;
window.createFormation = createFormation;
window.updateEnemies = updateEnemies;
window.drawEnemies = drawEnemies;

/** Convoyeur doré : traverse rapidement le haut de l'écran et ne tire jamais. */
window.spawnBonusEnemy = function spawnBonusEnemy() {
  for (let i = 0; i < enemies.length; i++) {
    if (enemies[i] && !enemies[i].isDeleted && enemies[i].isBonus) return false;
  }
  const fromLeft = Math.random() < 0.5;
  const stage = typeof stageSystem !== 'undefined' ? stageSystem.currentStage : 1;
  const size = enemySizeFor('bonus');
  const y = clamp(CANVAS_HEIGHT * (0.18 + Math.random() * 0.16), 90, CANVAS_HEIGHT * 0.38);
  const e = createEnemy(fromLeft ? -size - 30 : CANVAS_WIDTH + 30, y, 'bonus', stage, ENEMY_PATTERNS.SWEEP);
  e.isBonus = true;
  e.hasEntered = true;
  // Fragile lors de sa première apparition, puis renforcé tous les dix secteurs.
  e.hp = e.maxHp = 1 + Math.floor((stage - 1) / 10);
  const speedProgress = clamp((stage - 1) / 24, 0, 1);
  const earlySpeed = clamp(CANVAS_WIDTH * 0.32, 300, 430);
  const lateSpeed = clamp(CANVAS_WIDTH * 0.68, 600, 820);
  e.vx = (fromLeft ? 1 : -1) * (earlySpeed + (lateSpeed - earlySpeed) * speedProgress);
  e.bonusBaseY = y;
  e.phase = Math.random() * TWO_PI;
  enemies.push(e);
  if (typeof hudAlert === 'function') hudAlert('CONVOYEUR BONUS', 'DÉTRUISEZ-LE AVANT SA FUITE', '#ffee55', 1050);
  if (typeof gameEvent === 'function') gameEvent('diveAlert', { bonus: true });
  return true;
};

/** Obstacle environnemental rare : annoncé, lent et indépendant du stage. */
window.spawnAsteroidHazard = function spawnAsteroidHazard(count) {
  for (let i = 0; i < enemies.length; i++) {
    if (enemies[i] && !enemies[i].isDeleted && enemies[i].isHazard) return false;
  }
  const stage = typeof stageSystem !== 'undefined' ? stageSystem.currentStage : 1;
  const amount = clamp(Math.floor(count) || 1, 1, 2);
  for (let i = 0; i < amount; i++) {
    const lane = amount === 1 ? 0.22 + Math.random() * 0.56 : (i === 0 ? 0.28 : 0.72);
    const size = clamp(enemySizeFor('asteroid') * (0.82 + Math.random() * 0.38), 46, 86);
    const e = createEnemy(lane * CANVAS_WIDTH - size / 2, -size - 80 - i * 130,
      'asteroid', stage, ENEMY_PATTERNS.SWEEP);
    e.width = e.height = size;
    e.hp = e.maxHp = 6 + Math.floor((stage - 1) / 8);
    e.isHazard = true;
    e.hasEntered = true;
    e.vx = (Math.random() - 0.5) * 55;
    e.vy = clamp(185 + stage * 5 + Math.random() * 45, 190, 340);
    e.spin = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.55);
    e.faceAngle = Math.random() * TWO_PI;
    enemies.push(e);
  }
  if (typeof hudAlert === 'function') hudAlert('DANGER ORBITAL', 'ASTÉROÏDES EN APPROCHE', '#ffb46b', 1500);
  return true;
};
