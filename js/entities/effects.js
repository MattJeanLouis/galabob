/* =============================================================================
 *  galabob — EFFETS : EXPLOSIONS NÉON, DÉBRIS, POPUPS DE SCORE
 * -----------------------------------------------------------------------------
 *  Une explosion n'est plus un disque opaque : c'est une SÉQUENCE en 4 couches,
 *  toutes additives, toutes dessinées dans le buffer émissif de NEON.
 *
 *    1. FLASH    disque blanc pur, ~70 ms — le coup de poing
 *    2. ONDE     anneau fin qui s'étend vite en s'affinant   (NEON.ring)
 *    3. GERBE    étincelles en étoile, traînée + gravité, à LA COULEUR DE
 *                L'ENTITÉ DÉTRUITE (PALETTE.get(type).burst)
 *    4. RÉSIDU   lueur qui décroît lentement
 *
 *  RÈGLES TENUES ICI
 *  -----------------
 *  • Aucune couleur en dur : tout passe par PALETTE. Un ennemi magenta explose
 *    en magenta. Plus aucun dégradé jaune→rouge.
 *  • Aucun gradient créé dans la boucle de rendu (l'ancien code en allouait un
 *    par explosion ET par frame). Les étincelles et les débris sont BATCHÉS
 *    par (couleur, tranche d'alpha, épaisseur) : 4 strokes par lot, pas par
 *    particule.
 *  • Pooling : les particules mortes sont marquées `alive = false` et
 *    recyclées ; aucun splice, aucune ré-allocation en plein combat.
 *  • Delta-time partout : vitesses en px/s, accélérations en px/s², freinages
 *    exponentiels indépendants du framerate, probabilités par seconde.
 *  • Le screenshake appartient à JUICE (déclenché par game.js) : ce module ne
 *    le double JAMAIS.
 *
 *  API PUBLIQUE (signatures inchangées)
 *    createExplosion(x, y, type, opts)   updateExplosions(deltaTime)  drawExplosions()
 *    createDebris(x, y, color, type)     updateDebris(deltaTime)      drawDebris()
 *    createScorePopup(x, y, points, combo) -> points × multiplicateur
 *    updateScorePopups(deltaTime)        drawScorePopups()
 *    updateScreenShake(deltaTime)        triggerShake(intensity, duration)
 *  BONUS (utilisables par les autres modules, sans branchement)
 *    createShockwave(x, y, color, scale) createImpactSparks(x, y, color, angle, count)
 *    createEmbers(x, y, color, count)    clearEffects()
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 *  ÉTAT GLOBAL (game.js et stages.js réaffectent ces tableaux à [] : le pooling
 *  doit donc rester purement local au tableau).
 * -------------------------------------------------------------------------- */
let explosions = [];    // flashes + ondes + étincelles + résidus (tout le feu)
let debris = [];        // éclats vectoriels de carlingue
let scorePopups = [];   // chiffres qui montent

// Combo : déclarés ici historiquement, pilotés par game.js.
let comboTimer = 0;
let comboCount = 0;

// Legacy screenshake — conservé pour compatibilité, sans effet caméra.
let shakeTime = 0;
let shakeIntensity = 0;

/* -----------------------------------------------------------------------------
 *  CONSTANTES
 * -------------------------------------------------------------------------- */
const FX_FLASH = 0;
const FX_SHOCK = 1;
const FX_SPARK = 2;
const FX_RESIDUE = 3;

const FX_MAX = 700;          // plafond de particules d'explosion
const FX_DEBRIS_MAX = 220;   // plafond d'éclats
const FX_POPUP_MAX = 20;     // plafond de popups (au-delà, plus rien n'est lisible)
/** Bas du bandeau HUD (px CSS) : les popups de score ne montent jamais plus haut. */
const FX_HUD_SAFE_TOP = 96;
const FX_ALPHA_STEPS = 5;    // tranches d'alpha pour le batching

const FX_SPARK_DRAG = 0.055;   // fraction de vitesse restante après 1 s
const FX_SPARK_GRAVITY = 190;  // px/s²
const FX_DEBRIS_DRAG = 0.28;
const FX_DEBRIS_GRAVITY = 360; // px/s²

/* Profil d'explosion par type d'entité. `color` : clé PALETTE (défaut = le type
 * lui-même, qui est déjà un alias PALETTE : 'normal', 'shooter', 'fast'…). */
const EXPLOSION_SPEC = {
  normal:  { scale: 1.00, sparks: 15, rings: 1 },
  shooter: { scale: 1.22, sparks: 21, rings: 2 },
  fast:    { scale: 0.86, sparks: 13, rings: 1 },
  elite:   { scale: 1.55, sparks: 30, rings: 2 },
  ram:     { scale: 1.35, sparks: 24, rings: 2, color: 'enemyElite' },
  player:  { scale: 2.00, sparks: 42, rings: 3, color: 'playerDeath', second: 'player' }
};

/* -----------------------------------------------------------------------------
 *  POOL DE PARTICULES
 * -------------------------------------------------------------------------- */
let fxCursor = 0;

function fxNew() {
  return {
    alive: false, kind: FX_FLASH,
    x: 0, y: 0, vx: 0, vy: 0,
    life: 0, maxLife: 1, delay: 0,
    r: 0, r2: 0, w: 1,
    drag: 1, grav: 0,
    alpha: 1, col: null, seed: 0
  };
}

/** Renvoie une particule libre (recyclée si possible, jamais de splice). */
function fxAlloc() {
  const n = explosions.length;
  for (let i = 0; i < n; i++) {
    const idx = (fxCursor + i) % n;
    const p = explosions[idx];
    if (p && p.alive === false) {
      fxCursor = (idx + 1) % n;
      return p;
    }
  }
  if (n < FX_MAX) {
    const p = fxNew();
    explosions.push(p);
    return p;
  }
  // Saturation : on écrase la plus ancienne du curseur.
  const p = explosions[fxCursor] || fxNew();
  fxCursor = (fxCursor + 1) % Math.max(1, explosions.length);
  return p;
}

/* -----------------------------------------------------------------------------
 *  BATCHING DES TRACÉS (étincelles et débris)
 *  Un lot par (couleur, tranche d'alpha, épaisseur) : 4 strokes pour tout le lot
 *  au lieu de 4 strokes par particule.
 * -------------------------------------------------------------------------- */
const fxBatchPool = [];
const fxBatchMap = new Map();
let fxBatchCount = 0;

function fxBatchBegin() {
  fxBatchMap.clear();
  fxBatchCount = 0;
}

function fxBatchGet(col, bucket, width) {
  const key = col.glow + '|' + bucket + '|' + width;
  let b = fxBatchMap.get(key);
  if (b) return b;
  b = fxBatchPool[fxBatchCount];
  if (!b) {
    b = { glow: '', core: '', alpha: 1, width: 1, path: null };
    fxBatchPool.push(b);
  }
  fxBatchCount++;
  b.glow = col.glow;
  b.core = col.core;
  b.alpha = (bucket + 1) / FX_ALPHA_STEPS;
  b.width = width;
  b.path = new Path2D();
  fxBatchMap.set(key, b);
  return b;
}

/** Tranche d'alpha [0, FX_ALPHA_STEPS-1] pour regrouper les particules. */
function fxBucket(a) {
  const b = Math.round(a * FX_ALPHA_STEPS - 0.5);
  return b < 0 ? 0 : (b > FX_ALPHA_STEPS - 1 ? FX_ALPHA_STEPS - 1 : b);
}

/** Quantifie l'épaisseur pour limiter le nombre de lots. */
function fxWidthClass(w) {
  return Math.max(0.8, Math.round(w));
}

/** Vide les lots sur la scène (+ traînée persistante si demandée). */
function fxBatchFlush(c, trailCtx, trailAlpha) {
  if (!fxBatchCount || !c) return;

  c.save();
  c.globalCompositeOperation = 'lighter';
  c.lineCap = 'round';
  c.lineJoin = 'round';

  for (let i = 0; i < fxBatchCount; i++) {
    const b = fxBatchPool[i];
    const a = b.alpha;
    c.strokeStyle = b.glow;
    c.globalAlpha = a * 0.14;
    c.lineWidth = b.width * 5.0;
    c.stroke(b.path);
    c.globalAlpha = a * 0.34;
    c.lineWidth = b.width * 2.4;
    c.stroke(b.path);
    c.globalAlpha = a * 0.90;
    c.lineWidth = b.width * 1.05;
    c.stroke(b.path);
    c.strokeStyle = b.core;
    c.globalAlpha = a;
    c.lineWidth = Math.max(0.5, b.width * 0.45);
    c.stroke(b.path);
  }
  c.restore();

  if (trailCtx && trailAlpha > 0) {
    trailCtx.save();
    trailCtx.globalCompositeOperation = 'lighter';
    trailCtx.lineCap = 'round';
    trailCtx.lineJoin = 'round';
    for (let i = 0; i < fxBatchCount; i++) {
      const b = fxBatchPool[i];
      trailCtx.strokeStyle = b.glow;
      trailCtx.globalAlpha = b.alpha * trailAlpha;
      trailCtx.lineWidth = b.width * 1.6;
      trailCtx.stroke(b.path);
    }
    trailCtx.restore();
  }
}

/** Contexte de traînée, ou null si le bloom/les traînées sont coupés. */
function fxTrailCtx() {
  if (typeof NEON === 'undefined' || !NEON.isEnabled()) return null;
  if (!RENDER_CONFIG.trails) return null;
  return NEON.trail || null;
}

/* -----------------------------------------------------------------------------
 *  CRÉATION D'EFFETS
 * -------------------------------------------------------------------------- */

/* Triplets d'explosion mis en cache. PALETTE.get('#ff2bd6') fabrique un triplet
 * à la volée : sans ce cache on allouerait deux objets par explosion, en plein
 * combat, pour rien. */
const fxBurstCache = new Map();
function fxBurstOf(triplet) {
  const key = triplet.burst;
  let t = fxBurstCache.get(key);
  if (!t) {
    t = PALETTE.get(key);
    if (fxBurstCache.size < 64) fxBurstCache.set(key, t);
  }
  return t;
}

/** Une étincelle. `col` est un triplet PALETTE déjà résolu. */
function fxSpark(x, y, angle, speed, col, life, width, offset) {
  const p = fxAlloc();
  p.alive = true;
  p.kind = FX_SPARK;
  // Décalage de naissance : sans lui, toutes les étincelles se superposent au
  // centre pendant les premières frames et l'additif vire au coton blanc.
  const o = offset || 0;
  p.x = x + Math.cos(angle) * o;
  p.y = y + Math.sin(angle) * o;
  p.vx = Math.cos(angle) * speed;
  p.vy = Math.sin(angle) * speed;
  p.life = life;
  p.maxLife = life;
  p.delay = 0;
  p.drag = FX_SPARK_DRAG;
  p.grav = FX_SPARK_GRAVITY;
  p.w = width;
  p.col = col;
  p.alpha = 1;
  p.seed = Math.random();
  return p;
}

/** Onde de choc annulaire. */
function fxRing(x, y, col, radius, speed, width, life, delay, alpha) {
  const p = fxAlloc();
  p.alive = true;
  p.kind = FX_SHOCK;
  p.x = x; p.y = y;
  p.r = radius;
  p.vx = 0;
  p.vy = speed;          // vitesse radiale (px/s)
  p.drag = 0.06;         // l'onde freine vite : elle claque, elle ne flotte pas
  p.w = width;
  p.life = life;
  p.maxLife = life;
  p.delay = delay || 0;
  p.col = col;
  p.alpha = alpha == null ? 1 : alpha;
  p.seed = Math.random();
  return p;
}

/** Disque de flash. */
function fxFlash(x, y, col, r0, r1, life) {
  const p = fxAlloc();
  p.alive = true;
  p.kind = FX_FLASH;
  p.x = x; p.y = y;
  p.r = r0;
  p.r2 = r1;
  p.life = life;
  p.maxLife = life;
  p.delay = 0;
  p.col = col;
  p.alpha = 1;
  p.seed = Math.random();
  return p;
}

/** Lueur résiduelle. */
function fxResidue(x, y, col, r0, r1, life, alpha) {
  const p = fxAlloc();
  p.alive = true;
  p.kind = FX_RESIDUE;
  p.x = x; p.y = y;
  p.vx = 0;
  p.vy = -14;            // le résidu monte doucement, comme une fumée chaude
  p.r = r0;
  p.r2 = r1;
  p.life = life;
  p.maxLife = life;
  p.delay = 0;
  p.col = col;
  p.alpha = alpha;
  p.seed = Math.random();
  return p;
}

/**
 *  Explosion complète.
 *  @param {number} x,y   centre
 *  @param {string} type  'normal' | 'shooter' | 'fast' | 'elite' | 'ram' |
 *                        'player' — ou n'importe quelle clé/couleur PALETTE.
 *  @param {object} [opts] { scale, sparks, color }
 */
function createExplosion(x, y, type = 'normal', opts) {
  opts = opts || {};

  const spec = EXPLOSION_SPEC[type] || EXPLOSION_SPEC.normal;
  const scale = Math.max(0.25, (opts.scale || 1) * spec.scale);

  // La couleur d'explosion EST l'identité de l'entité (règle non négociable).
  const col = PALETTE.get(opts.color || spec.color || type);
  const burst = fxBurstOf(col);
  const second = spec.second ? PALETTE.get(spec.second) : null;
  const white = PALETTE.get('shock');   // blanc bleuté quasi pur (clé indexée)

  // 1) FLASH — deux images, pas plus. Un point d'exclamation blanc.
  fxFlash(x, y, white, 3 * scale, 9 * scale, 0.05 + 0.015 * scale);

  // 2) ONDES DE CHOC — la première claque (blanche, fine, rapide),
  //    les suivantes sont des échos colorés à peine visibles.
  const rings = spec.rings;
  for (let i = 0; i < rings; i++) {
    fxRing(
      x, y,
      i === 0 ? white : burst,
      4 * scale,
      (i === 0 ? 640 : 330) * scale * (0.9 + Math.random() * 0.25),
      (i === 0 ? 1.9 : 1.2) * scale,
      i === 0 ? 0.19 : 0.26,
      i * 0.06,
      i === 0 ? 0.95 : 0.32
    );
  }

  // 3) GERBE D'ÉTINCELLES — étoile irrégulière, à la couleur de l'ennemi.
  //    Les vitesses sont TRÈS étalées : sans ça, toutes les étincelles se
  //    retrouvent sur le même cercle et la gerbe ressemble à un cadran.
  const count = Math.round((opts.sparks || spec.sparks) * (1.5 + Math.random() * 0.5));
  const base = Math.random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const angle = base + (Math.PI * 2 * i) / count + randRange(-0.42, 0.42);
    const speed = (155 + Math.pow(Math.random(), 2.1) * 830) * (0.7 + scale * 0.4);
    const life = randRange(0.22, 0.95) * (0.8 + scale * 0.25);
    const c2 = (second && i % 3 === 0) ? second : burst;
    fxSpark(x, y, angle, speed, c2, life, randRange(0.9, 2.1) * (0.85 + scale * 0.15),
            randRange(2, 11) * scale + speed * 0.014);
  }

  // Quelques éclats lents et lourds qui retombent : ça donne du poids.
  const heavy = Math.max(2, Math.round(count * 0.14));
  for (let i = 0; i < heavy; i++) {
    const angle = randRange(-Math.PI, 0) + randRange(-0.4, 0.4);
    const s = fxSpark(x, y, angle, randRange(130, 280) * scale, burst,
                      randRange(0.7, 1.35), randRange(1.2, 2.2), randRange(3, 14) * scale);
    s.grav = FX_SPARK_GRAVITY * 2.1;
    s.drag = 0.35;
  }

  // 4) RÉSIDU — la braise qui s'éteint. Discrète : c'est une lueur, pas un nuage.
  fxResidue(x, y, burst, 6 * scale, 14 * scale, 0.45 + 0.3 * scale, 0.16);
  if (scale > 1.3) {
    fxResidue(x + randRange(-8, 8), y + randRange(-8, 8), col,
              5 * scale, 12 * scale, 0.6 + 0.3 * scale, 0.12);
  }
}

/** Onde de choc isolée (utilisable par n'importe quel module). */
function createShockwave(x, y, color = 'shock', scale = 1) {
  const col = PALETTE.get(color);
  fxRing(x, y, col, 4 * scale, 520 * scale, 1.6 * scale, 0.26, 0, 0.8);
}

/** Petite gerbe directionnelle : impact de balle, ricochet, muzzle flash. */
function createImpactSparks(x, y, color = 'neutral', angle = -Math.PI / 2, count = 6) {
  const col = PALETTE.get(color);
  const burst = fxBurstOf(col);
  const n = Math.max(1, count | 0);
  for (let i = 0; i < n; i++) {
    const a = angle + randRange(-0.85, 0.85);
    fxSpark(x, y, a, randRange(120, 380), burst, randRange(0.14, 0.32), randRange(0.9, 1.7));
  }
  fxFlash(x, y, PALETTE.get('shock'), 3, 9, 0.05);
}

/** Braises lentes : utile pour un power-up ramassé ou une charge d'arme. */
function createEmbers(x, y, color = 'neutral', count = 8) {
  const col = PALETTE.get(color);
  const burst = fxBurstOf(col);
  for (let i = 0; i < Math.max(1, count | 0); i++) {
    const s = fxSpark(x, y, randRange(-Math.PI, Math.PI), randRange(30, 120),
                      burst, randRange(0.5, 1.1), randRange(0.9, 1.8));
    s.grav = -40;   // elles montent
    s.drag = 0.2;
  }
}

/** Remet tous les effets à zéro (sans réallouer les tableaux). */
function clearEffects() {
  for (let i = 0; i < explosions.length; i++) if (explosions[i]) explosions[i].alive = false;
  for (let i = 0; i < debris.length; i++) if (debris[i]) debris[i].alive = false;
  for (let i = 0; i < scorePopups.length; i++) if (scorePopups[i]) scorePopups[i].alive = false;
}

/* -----------------------------------------------------------------------------
 *  MISE À JOUR DES EXPLOSIONS
 * -------------------------------------------------------------------------- */
function updateExplosions(deltaTime) {
  const dt = (typeof deltaTime === 'number' ? deltaTime : 0) / 1000;
  if (!(dt > 0)) return;

  let alive = 0;

  for (let i = 0; i < explosions.length; i++) {
    const p = explosions[i];
    if (!p || p.alive === false) continue;

    if (p.delay > 0) {
      p.delay -= dt;
      alive++;
      continue;
    }

    p.life -= dt;
    if (p.life <= 0) { p.alive = false; continue; }
    alive++;

    switch (p.kind) {
      case FX_SPARK: {
        const d = Math.pow(p.drag, dt);
        p.vx *= d;
        p.vy = p.vy * d + p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        break;
      }
      case FX_SHOCK: {
        p.r += p.vy * dt;
        p.vy *= Math.pow(p.drag, dt);
        break;
      }
      case FX_RESIDUE: {
        p.y += p.vy * dt;
        break;
      }
      default: break;   // FX_FLASH : purement temporel
    }
  }

  // Le pool s'est complètement vidé : on le rend au ramasse-miettes.
  if (alive === 0 && explosions.length > 128) {
    explosions.length = 0;
    fxCursor = 0;
  }
}

/* -----------------------------------------------------------------------------
 *  DESSIN DES EXPLOSIONS
 * -------------------------------------------------------------------------- */
function drawExplosions() {
  const c = ctx;
  if (!c || !explosions.length) return;

  const trailCtx = fxTrailCtx();
  fxBatchBegin();

  for (let i = 0; i < explosions.length; i++) {
    const p = explosions[i];
    if (!p || p.alive === false || p.delay > 0) continue;

    const k = p.life / p.maxLife;          // 1 → 0
    if (k <= 0) continue;

    switch (p.kind) {

      case FX_SPARK: {
        // L'étincelle est un segment orienté par sa vitesse : plus elle va
        // vite, plus elle s'étire. Aucun gradient, tracé mis en lot.
        const a = k > 0.55 ? 1 : k / 0.55;
        const len = Math.min(46, Math.hypot(p.vx, p.vy) * 0.052 + p.w * 0.9);
        const nx = p.vx, ny = p.vy;
        const inv = 1 / (Math.hypot(nx, ny) || 1);
        const b = fxBatchGet(p.col, fxBucket(a), fxWidthClass(p.w * (0.55 + 0.45 * k)));
        b.path.moveTo(p.x - nx * inv * len, p.y - ny * inv * len);
        b.path.lineTo(p.x, p.y);
        break;
      }

      case FX_SHOCK: {
        const a = Math.pow(k, 1.9) * p.alpha;
        const th = Math.max(0.3, p.w * Math.pow(k, 0.8));
        NEON.ring(c, p.x, p.y, p.r, th, p.col,
                  { alpha: a, glowScale: 0.85, passes: 3 });
        break;
      }

      case FX_FLASH: {
        const t = 1 - k;
        const r = p.r + (p.r2 - p.r) * smoothstep(t);
        NEON.dot(c, p.x, p.y, r, p.col, { alpha: Math.pow(k, 0.9), glowScale: 1.0 });
        break;
      }

      case FX_RESIDUE: {
        const t = 1 - k;
        const r = p.r + (p.r2 - p.r) * t;
        NEON.dot(c, p.x, p.y, r, p.col,
                 { alpha: p.alpha * k * k, glowScale: 1.35 });
        break;
      }
    }
  }

  // Étincelles : 4 strokes par lot + report dans la traînée persistante.
  fxBatchFlush(c, trailCtx, 0.22);
}

/* -----------------------------------------------------------------------------
 *  DÉBRIS — éclats de carlingue, tracés vectoriels
 * -------------------------------------------------------------------------- */
const DEBRIS_TRIANGLE = 0;
const DEBRIS_QUAD = 1;
const DEBRIS_SHARD = 2;

let debrisCursor = 0;

function debrisNew() {
  return {
    alive: false, shape: DEBRIS_TRIANGLE,
    x: 0, y: 0, vx: 0, vy: 0,
    rot: 0, spin: 0, size: 4,
    life: 0, maxLife: 1, col: null
  };
}

function debrisAlloc() {
  const n = debris.length;
  for (let i = 0; i < n; i++) {
    const idx = (debrisCursor + i) % n;
    const d = debris[idx];
    if (d && d.alive === false) {
      debrisCursor = (idx + 1) % n;
      return d;
    }
  }
  if (n < FX_DEBRIS_MAX) {
    const d = debrisNew();
    debris.push(d);
    return d;
  }
  const d = debris[debrisCursor] || debrisNew();
  debrisCursor = (debrisCursor + 1) % Math.max(1, debris.length);
  return d;
}

/**
 *  Éclats projetés. `color` accepte une clé PALETTE ou une couleur CSS
 *  (game.js envoie PALETTE.enemy(type).burst, donc un '#rrggbb').
 */
function createDebris(x, y, color, type) {
  const col = PALETTE.get(color || type || 'debris');
  const spec = EXPLOSION_SPEC[type] || EXPLOSION_SPEC.normal;
  const scale = spec.scale;

  // Trois chorégraphies, comme avant, mais en px/s et en tracés néon.
  const pattern = Math.floor(Math.random() * 3);
  let count, shardRatio, speedMin, speedMax, life;

  if (pattern === 0) {          // étoile régulière : gros morceaux
    count = 8;  shardRatio = 0.35; speedMin = 90;  speedMax = 420; life = 1.0;
  } else if (pattern === 1) {   // couronne : mélange
    count = 11; shardRatio = 0.60; speedMin = 110; speedMax = 480; life = 1.15;
  } else {                      // gerbe asymétrique : surtout des éclats
    count = 9;  shardRatio = 0.85; speedMin = 80;  speedMax = 560; life = 0.85;
  }

  count = Math.round(count * clamp(scale, 0.7, 1.6));
  const base = Math.random() * Math.PI * 2;

  for (let i = 0; i < count; i++) {
    const angle = pattern === 2
      ? Math.random() * Math.PI * 2
      : base + (Math.PI * 2 * i) / count + randRange(-0.18, 0.18);
    const speed = randRange(speedMin, speedMax) * scale;

    const d = debrisAlloc();
    d.alive = true;
    d.shape = Math.random() < shardRatio ? DEBRIS_SHARD : DEBRIS_TRIANGLE;
    d.x = x;
    d.y = y;
    d.vx = Math.cos(angle) * speed;
    d.vy = Math.sin(angle) * speed;
    d.rot = Math.random() * Math.PI * 2;
    d.spin = randRange(-7, 7);                    // rad/s
    d.size = randRange(2.5, 6) * clamp(scale, 0.8, 1.5);
    d.life = life * randRange(0.75, 1.15);
    d.maxLife = d.life;
    d.col = col;
  }
}

function updateDebris(deltaTime) {
  const dt = (typeof deltaTime === 'number' ? deltaTime : 0) / 1000;
  if (!(dt > 0)) return;

  let alive = 0;
  const drag = Math.pow(FX_DEBRIS_DRAG, dt);

  for (let i = 0; i < debris.length; i++) {
    const d = debris[i];
    if (!d || d.alive === false) continue;

    // Objets legacy éventuellement poussés par un ancien code : on les ignore
    // proprement plutôt que de planter.
    if (typeof d.maxLife !== 'number') { d.alive = false; continue; }

    d.life -= dt;
    if (d.life <= 0) { d.alive = false; continue; }
    alive++;

    d.vx *= drag;
    d.vy = d.vy * drag + FX_DEBRIS_GRAVITY * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.rot += d.spin * dt;
  }

  if (alive === 0 && debris.length > 64) {
    debris.length = 0;
    debrisCursor = 0;
  }
}

function drawDebris() {
  const c = ctx;
  if (!c || !debris.length) return;

  fxBatchBegin();

  for (let i = 0; i < debris.length; i++) {
    const d = debris[i];
    if (!d || d.alive === false || !d.col) continue;

    const k = d.life / d.maxLife;
    const a = k > 0.6 ? 1 : k / 0.6;
    const s = d.size * (0.55 + 0.45 * k);
    const cs = Math.cos(d.rot), sn = Math.sin(d.rot);
    const b = fxBatchGet(d.col, fxBucket(a), fxWidthClass(1 + s * 0.12));
    const p = b.path;

    if (d.shape === DEBRIS_TRIANGLE) {
      p.moveTo(d.x + (-s * cs - s * sn), d.y + (-s * sn + s * cs));
      p.lineTo(d.x + (s * cs), d.y + (s * sn));
      p.lineTo(d.x + (-s * cs + s * sn), d.y + (-s * sn - s * cs));
      p.closePath();
    } else if (d.shape === DEBRIS_QUAD) {
      const h = s * 0.62;
      p.moveTo(d.x + (-h * cs - h * sn), d.y + (-h * sn + h * cs));
      p.lineTo(d.x + (h * cs - h * sn), d.y + (h * sn + h * cs));
      p.lineTo(d.x + (h * cs + h * sn), d.y + (h * sn - h * cs));
      p.lineTo(d.x + (-h * cs + h * sn), d.y + (-h * sn - h * cs));
      p.closePath();
    } else {
      // Éclat : un simple segment, le plus vectoriel de tous.
      p.moveTo(d.x - s * cs, d.y - s * sn);
      p.lineTo(d.x + s * cs, d.y + s * sn);
    }
  }

  fxBatchFlush(c, fxTrailCtx(), 0.16);
}

/* -----------------------------------------------------------------------------
 *  POPUPS DE SCORE
 * -------------------------------------------------------------------------- */

/* Chaînes de police mises en cache : quantifiées au demi-pixel, elles évitent
 * une concaténation et une re-analyse du raccourci CSS `font` à chaque tracé. */
const fxFontCache = new Map();
function fxFontFor(size) {
  const q = Math.max(6, Math.round(size * 2) / 2);
  let f = fxFontCache.get(q);
  if (!f) {
    f = 'bold ' + q + 'px ' + PALETTE.ui.font;
    if (fxFontCache.size < 128) fxFontCache.set(q, f);
  }
  return f;
}

/** Texte lumineux SANS ctx.shadowBlur.
 *  Mesuré : NEON.text (shadowBlur) coûtait 1,74 ms/frame pour 40 popups, soit
 *  huit fois tout le reste des effets réunis. Ici le halo est un contour épais
 *  en 'lighter' : c'est le bloom de NEON qui fait le travail de diffusion,
 *  gratuitement, puisque tout est déjà peint dans le buffer émissif. */
function fxText(c, str, x, y, col, size, alpha, glowWidth) {
  if (alpha <= 0.004) return;
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.font = fxFontFor(size);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.miterLimit = 2;

  c.strokeStyle = col.glow;
  c.globalAlpha = alpha * 0.30;
  c.lineWidth = size * (glowWidth == null ? 0.30 : glowWidth);
  c.strokeText(str, x, y);

  c.globalAlpha = alpha * 0.55;
  c.lineWidth = size * 0.13;
  c.strokeText(str, x, y);

  c.fillStyle = col.core;
  c.globalAlpha = alpha;
  c.fillText(str, x, y);
  c.restore();
}

/* Palier de couleur selon le multiplicateur. Triplets résolus une seule fois. */
let popupTiers = null;
function popupColor(mult) {
  if (!popupTiers) {
    popupTiers = [
      PALETTE.get('hud'),          // x1  — cyan/blanc
      PALETTE.get('combo'),        // x2  — or
      PALETTE.get('powerupSpread'),// x3-4 — or chaud
      PALETTE.get('playerThruster'),// x5-6 — ambre
      PALETTE.get('powerupLife')   // x7+ — rose néon
    ];
  }
  if (mult <= 1) return popupTiers[0];
  if (mult === 2) return popupTiers[1];
  if (mult <= 4) return popupTiers[2];
  if (mult <= 6) return popupTiers[3];
  return popupTiers[4];
}

let popupCursor = 0;

function popupNew() {
  return {
    _fx: true, alive: false,
    x: 0, y: 0, vy: 0,
    life: 0, maxLife: 1,
    text: '', mult: 1, points: 0,
    col: null, size: 18, drift: 0
  };
}

function popupAlloc() {
  const n = scorePopups.length;
  for (let i = 0; i < n; i++) {
    const idx = (popupCursor + i) % n;
    const p = scorePopups[idx];
    // `alive === false` ne peut concerner qu'un popup déjà passé par
    // popupNormalize() ou createScorePopup() : ceux que audio.js et input.js
    // poussent à la main arrivent avec `alive` indéfini et sont donc à l'abri.
    if (p && p.alive === false) {
      popupCursor = (idx + 1) % n;
      return p;
    }
  }
  if (n < FX_POPUP_MAX) {
    const p = popupNew();
    scorePopups.push(p);
    return p;
  }
  const p = scorePopups[popupCursor];
  popupCursor = (popupCursor + 1) % Math.max(1, scorePopups.length);
  if (p) return p;
  const q = popupNew();
  scorePopups.push(q);
  return q;
}

/** Normalise un popup poussé par du code externe (audio.js, input.js) :
 *  {x, y, points, text, lifetime, dy (px/frame), color}. */
function popupNormalize(p) {
  p._fx = false;
  p.alive = true;
  p.maxLife = (typeof p.lifetime === 'number' && p.lifetime > 0) ? p.lifetime : 1;
  p.life = p.maxLife;
  p.vy = (typeof p.dy === 'number' ? p.dy : -1) * 60;   // px/frame -> px/s
  p.mult = 1;
  p.points = Number(p.points) || 0;
  p.text = p.text != null ? String(p.text) : String(p.points);
  p.col = PALETTE.get(p.color || 'hud');
  p.size = 19;
  p.drift = 0;
}

/**
 *  Popup de score.
 *  CONTRAT : on reçoit les points de BASE et le MULTIPLICATEUR ; on affiche
 *  base × multiplicateur. game.js ajoute exactement la même chose au score.
 *  (L'ancien code multipliait une valeur déjà multipliée : double compte.)
 *  @returns {number} les points réellement affichés.
 */
function createScorePopup(x, y, points, combo) {
  const base = Number(points) || 0;

  let mult = 1;
  if (typeof combo === 'number' && isFinite(combo)) {
    mult = Math.max(1, Math.min(Math.floor(combo), TEMPO.COMBO_MAX));
  } else if (combo === 'combo') {
    mult = 2;
  }

  const finalPoints = Math.round(base * mult);

  const p = popupAlloc();
  p._fx = true;
  p.alive = true;
  p.x = x + randRange(-5, 5);
  p.y = y;
  p.vy = -255 - mult * 10;
  p.maxLife = 0.82 + Math.min(0.5, mult * 0.05);
  p.life = p.maxLife;
  p.mult = mult;
  p.points = finalPoints;
  p.text = String(finalPoints);
  p.col = popupColor(mult);
  // La taille suit l'importance, mais reste bornée : un chiffre trop gros
  // sature le bloom et devient une tache blanche illisible.
  p.size = 15 + Math.min(8, Math.log(1 + finalPoints) * 2.0) + (mult - 1) * 1.2;
  p.drift = randRange(-9, 9);

  // Le combo qui monte mérite son onde.
  if (mult >= 3) createShockwave(x, y, p.col, 0.55 + mult * 0.06);

  return finalPoints;
}

function updateScorePopups(deltaTime) {
  const dt = (typeof deltaTime === 'number' ? deltaTime : 0) / 1000;
  if (!(dt > 0)) return;

  let alive = 0;

  for (let i = 0; i < scorePopups.length; i++) {
    const p = scorePopups[i];
    if (!p) continue;
    if (p.alive === undefined) popupNormalize(p);
    if (p.alive === false) continue;

    p.life -= dt;
    if (p.life <= 0) { p.alive = false; continue; }
    alive++;

    p.y += p.vy * dt;
    p.x += p.drift * dt;
    // Freinage : le chiffre jaillit puis se pose.
    p.vy = damp(p.vy, -16, 0.006, dt);
    p.drift = damp(p.drift, 0, 0.05, dt);

    // Les chiffres ne montent PAS dans le bandeau du HUD : un kill haut dans
    // la formation envoyait son popup par-dessus « STAGE n » et la barre de
    // progression, qui devenaient illisibles au plus fort de l'action.
    if (p.y < FX_HUD_SAFE_TOP) { p.y = FX_HUD_SAFE_TOP; if (p.vy < 0) p.vy = 0; }
  }

  if (alive === 0 && scorePopups.length > 24) {
    scorePopups.length = 0;
    popupCursor = 0;
  }
}

function drawScorePopups() {
  const c = ctx;
  if (!c || !scorePopups.length) return;

  for (let i = 0; i < scorePopups.length; i++) {
    const p = scorePopups[i];
    if (!p) continue;
    if (p.alive === undefined) popupNormalize(p);
    if (p.alive === false) continue;

    const k = p.life / p.maxLife;                 // 1 → 0
    const age = p.maxLife - p.life;

    // Apparition : un pop élastique court, puis retour à l'échelle nominale.
    let scale;
    if (age < 0.09) scale = lerp(0.45, 1.16, smoothstep(age / 0.09));
    else scale = lerp(1.16, 1, smoothstep(clamp((age - 0.09) / 0.16, 0, 1)));

    const alpha = k > 0.45 ? 1 : k / 0.45;
    const size = p.size * scale;

    fxText(c, p.text, p.x, p.y, p.col, size, alpha * 0.95, 0.26 + p.mult * 0.012);

    if (p.mult > 1) {
      fxText(c, '×' + p.mult, p.x, p.y + size * 0.8, p.col, size * 0.58, alpha * 0.9, 0.3);
    }
  }
}

/* -----------------------------------------------------------------------------
 *  LEGACY — screenshake
 *  Le vrai screenshake appartient à JUICE (js/utils.js), déclenché par game.js
 *  via les presets. On garde ces deux fonctions pour ne casser aucun appelant,
 *  MAIS createExplosion ne les appelle plus : sinon chaque kill secouerait
 *  l'écran deux fois.
 * -------------------------------------------------------------------------- */
function triggerShake(intensity, duration) {
  shakeIntensity = Number(intensity) || 0;
  shakeTime = Number(duration) || 0;
  if (typeof JUICE !== 'undefined' && JUICE && typeof JUICE.shake === 'function') {
    JUICE.shake(clamp(shakeIntensity / 22, 0, 0.55));
  }
}

function updateScreenShake(deltaTime) {
  if (shakeTime > 0) {
    shakeTime -= (typeof deltaTime === 'number' ? deltaTime : 0);
    if (shakeTime <= 0) {
      shakeTime = 0;
      shakeIntensity = 0;
    }
  }
}
