/* =============================================================================
 *  galabob — UTILITAIRES + KIT D'IMPACT (JUICE)
 * -----------------------------------------------------------------------------
 *  Contenu :
 *    1. Maths de base        : clamp, lerp, approach, rand…
 *    2. Collisions           : rectIntersect, rectCircleIntersect, pointInRect…
 *    3. JUICE                : hitstop, screenshake par trauma, flash plein écran
 *    4. resizeCanvas()       : gestion correcte du devicePixelRatio (Retina)
 *
 *  Dépend de : js/core/config.js (CANVAS_WIDTH/HEIGHT, DPR, RENDER_CONFIG, FRAME)
 *              js/core/palette.js (facultatif, pour la couleur par défaut du flash)
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * 1. MATHS
 * -------------------------------------------------------------------------- */

function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

function lerp(a, b, t) { return a + (b - a) * t; }

/** Interpolation exponentielle indépendante du framerate.
 *  `rate` = fraction restante après 1 seconde (0.1 = 90 % rattrapé en 1 s). */
function damp(a, b, rate, dt) { return b + (a - b) * Math.pow(rate, dt); }

/** Avance `current` vers `target` d'au plus `maxDelta`. */
function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return target;
}

function randRange(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
function randSign() { return Math.random() < 0.5 ? -1 : 1; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** Smoothstep classique, t dans [0,1]. */
function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

/* -----------------------------------------------------------------------------
 * 2. COLLISIONS
 *    Toutes ces fonctions raisonnent en PIXELS CSS.
 * -------------------------------------------------------------------------- */

/** AABB vs AABB. Chaque objet doit avoir {x, y, width, height}. */
function rectIntersect(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;

  if (typeof a.x !== 'number' || typeof a.y !== 'number' ||
      typeof a.width !== 'number' || typeof a.height !== 'number' ||
      typeof b.x !== 'number' || typeof b.y !== 'number' ||
      typeof b.width !== 'number' || typeof b.height !== 'number') {
    return false;
  }

  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** AABB vs cercle. rect = {x,y,width,height}, cercle = (cx, cy, r). */
function rectCircleIntersect(rect, cx, cy, r) {
  if (!rect) return false;
  const nx = clamp(cx, rect.x, rect.x + rect.width);
  const ny = clamp(cy, rect.y, rect.y + rect.height);
  const dx = cx - nx, dy = cy - ny;
  return (dx * dx + dy * dy) <= r * r;
}

/** Cercle vs cercle. */
function circleIntersect(x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1, dy = y2 - y1, rr = r1 + r2;
  return (dx * dx + dy * dy) <= rr * rr;
}

/** Point dans un AABB. */
function pointInRect(px, py, rect) {
  if (!rect) return false;
  return px >= rect.x && px <= rect.x + rect.width &&
         py >= rect.y && py <= rect.y + rect.height;
}

/** Distance au carré (évite un sqrt inutile). */
function dist2(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  return dx * dx + dy * dy;
}

/** Centre d'une entité {x,y,width,height}. Renvoie un objet réutilisable-safe. */
function centerOf(e) {
  return { x: e.x + (e.width || 0) / 2, y: e.y + (e.height || 0) / 2 };
}

/** Construit un AABB centré (utile pour les hitbox réduites). */
function boxAround(cx, cy, size, sizeY) {
  const w = size, h = (sizeY == null ? size : sizeY);
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/* =============================================================================
 * 3. JUICE — LE KIT D'IMPACT
 * -----------------------------------------------------------------------------
 *  Référence : "The Art of Screenshake", Jan Willem Nijman (Vlambeer).
 *
 *  TROIS OUTILS :
 *    • HITSTOP  — gèle la LOGIQUE quelques dizaines de ms. Le RENDU continue.
 *                 Cumulable, plafonné à JUICE.config.maxHitstopMs.
 *    • SHAKE    — scalaire `trauma` dans [0,1] qui décroît. Le décalage caméra
 *                 est proportionnel à trauma² et suit un BRUIT LISSÉ (pas un
 *                 jitter aléatoire par frame) : le résultat est organique.
 *    • FLASH    — voile coloré additif plein écran, bref.
 *
 *  UTILISATION DEPUIS N'IMPORTE QUEL MODULE :
 *    JUICE.preset('enemyKill');            // ← le plus simple, recommandé
 *    JUICE.hitstop(45);                    // ms, cumulable
 *    JUICE.shake(0.25);                    // trauma ajouté, 0 → 1
 *    JUICE.flash('#ff2b55', 220, 0.5);     // couleur, durée ms, force 0→1
 *    JUICE.kick(0, -6);                    // impulsion caméra en px CSS
 *    JUICE.punch(0.02);                    // punch-zoom, 0 → 0.15
 *
 *  NE PAS APPELER : JUICE.step() et JUICE.applyCamera() sont réservés à
 *  main.js / neon.js.
 * ========================================================================== */

const JUICE = (function () {
  'use strict';

  /* --- bruit de valeur lissé, 3 pistes indépendantes (x, y, rotation) ------ */
  const NOISE_LEN = 512;
  const NOISE_ROWS = 4;
  const noiseTable = new Float32Array(NOISE_LEN * NOISE_ROWS);
  for (let i = 0; i < noiseTable.length; i++) noiseTable[i] = Math.random() * 2 - 1;

  function valueNoise(row, t) {
    const base = (row % NOISE_ROWS) * NOISE_LEN;
    const i0 = Math.floor(t);
    const f = t - i0;
    const a = noiseTable[base + (((i0 % NOISE_LEN) + NOISE_LEN) % NOISE_LEN)];
    const b = noiseTable[base + ((((i0 + 1) % NOISE_LEN) + NOISE_LEN) % NOISE_LEN)];
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  }

  /** Bruit fractal 2 octaves : plus organique qu'une simple sinusoïde. */
  function fbm(row, t) {
    return valueNoise(row, t) * 0.66 + valueNoise(row + 2, t * 2.17 + 37.3) * 0.34;
  }

  /* --- état --------------------------------------------------------------- */
  const config = {
    maxHitstopMs: 120,     // plafond cumulé du hitstop (7 frames à 60 Hz)
    traumaDecay: 1.65,     // trauma perdu par seconde
    maxOffset: 26,         // px CSS de décalage caméra à trauma = 1
    maxRotation: 0.024,    // radians de rotation caméra à trauma = 1
    shakeFrequency: 24,    // Hz d'avance du curseur de bruit
    kickDecay: 0.0009,     // fraction de kick restante après 1 s
    punchDecay: 0.0012,
    enabled: true
  };

  const state = {
    trauma: 0,
    hitstop: 0,
    cursor: 0,
    offsetX: 0, offsetY: 0, rotation: 0,
    kickX: 0, kickY: 0,
    punch: 0,
    flashColor: '#ffffff',
    flashLeft: 0,
    flashDuration: 0,
    flashStrength: 0
  };

  /* --- presets : un seul appel pour un ressenti cohérent partout ----------- */
  const PRESETS = {
    playerShot:   { hitstop: 0,   shake: 0.010, kick: [0, 1.5] },
    playerShotBig:{ hitstop: 8,  shake: 0.09,  kick: [0, 3] },
    enemyHit:     { hitstop: 10,  shake: 0.10 },
    enemyKill:    { hitstop: 26,  shake: 0.22, punch: 0.006 },
    bigKill:      { hitstop: 48,  shake: 0.38, punch: 0.014 },
    ramKill:      { hitstop: 60, shake: 0.45, punch: 0.018, flash: ['#ff2bd6', 160, 0.28] },
    playerHit:    { hitstop: 85, shake: 0.62, punch: 0.02,  flash: ['#ff2b55', 240, 0.50] },
    playerDeath:  { hitstop: 120, shake: 0.92, punch: 0.035, flash: ['#ffffff', 340, 0.72] },
    powerUp:      { hitstop: 10,  shake: 0.10, flash: ['#00ffc8', 150, 0.18] },
    comboUp:      { hitstop: 5,   shake: 0.05 },
    stageClear:   { hitstop: 38,  shake: 0.30, flash: ['#7df9ff', 420, 0.30] },
    stageStart:   { hitstop: 0,   shake: 0.14, flash: ['#3df5ff', 260, 0.18] },
    gameOver:     { hitstop: 120, shake: 1.00, flash: ['#ff2b55', 600, 0.60] }
  };

  const api = {
    config: config,
    presets: PRESETS,

    /**
     * Gèle la logique pendant `ms`. Cumul AMORTI, plafonné.
     *
     * Le cumul était additif : cinq ennemis détruits dans la même frame
     * empilaient 5x55 ms et saturaient le plafond — un quart de seconde de
     * gel, ressenti comme un freeze. Chaque impact comble maintenant une
     * FRACTION de ce qui reste avant le plafond : le premier coup garde tout
     * son poids, les suivants rendent de moins en moins, et l'ensemble tend
     * vers maxHitstopMs sans jamais y sauter d'un coup.
     */
    hitstop: function (ms) {
      if (!config.enabled || !(ms > 0)) return;
      const cap = config.maxHitstopMs;
      const marge = 1 - state.hitstop / cap;          // 1 quand libre, 0 au plafond
      const ajout = ms * (marge > 0 ? marge : 0);
      state.hitstop = Math.min(Math.max(state.hitstop, state.hitstop + ajout), cap);
    },

    /** Ajoute du trauma. `amount` dans [0,1]. Le décalage suit trauma². */
    shake: function (amount) {
      if (!config.enabled || !(amount > 0)) return;
      state.trauma = clamp(state.trauma + amount, 0, 1);
    },

    /** Impulsion caméra directionnelle, en px CSS (recul d'arme, poussée…). */
    kick: function (dx, dy) {
      if (!config.enabled) return;
      state.kickX += dx || 0;
      state.kickY += dy || 0;
    },

    /** Punch-zoom. `amount` typiquement 0.005 → 0.04. */
    punch: function (amount) {
      if (!config.enabled) return;
      state.punch = Math.min(state.punch + (amount || 0), 0.12);
    },

    /** Voile additif plein écran. Le plus fort gagne. */
    flash: function (color, durationMs, strength) {
      if (!config.enabled) return;
      const s = strength == null ? 0.4 : strength;
      const d = durationMs == null ? 200 : durationMs;
      if (s * 1.0 < state.flashStrength * (state.flashLeft / Math.max(1, state.flashDuration))) return;
      state.flashColor = color || (typeof PALETTE !== 'undefined' ? PALETTE.ui.accent : '#ffffff');
      state.flashDuration = d;
      state.flashLeft = d;
      state.flashStrength = clamp(s, 0, 1);
    },

    /** Applique un preset nommé (voir JUICE.presets). */
    preset: function (name, scale) {
      const p = PRESETS[name];
      if (!p) return;
      const k = scale == null ? 1 : scale;
      if (p.hitstop) api.hitstop(p.hitstop * k);
      if (p.shake) api.shake(p.shake * k);
      if (p.punch) api.punch(p.punch * k);
      if (p.kick) api.kick(p.kick[0] * k, p.kick[1] * k);
      if (p.flash) api.flash(p.flash[0], p.flash[1], p.flash[2] * k);
    },

    /** true tant qu'un hitstop est en cours (la logique doit rester gelée). */
    isFrozen: function () { return state.hitstop > 0; },

    /** Lectures (px CSS / radians). Mises à jour une fois par frame. */
    get trauma() { return state.trauma; },
    get offsetX() { return state.offsetX + state.kickX; },
    get offsetY() { return state.offsetY + state.kickY; },
    get rotation() { return state.rotation; },
    get zoom() { return 1 + state.punch; },
    get hitstopLeft() { return state.hitstop; },

    /** Remet tout à zéro (nouvelle partie, retour au menu). */
    reset: function () {
      state.trauma = 0; state.hitstop = 0;
      state.offsetX = state.offsetY = state.rotation = 0;
      state.kickX = state.kickY = 0; state.punch = 0;
      state.flashLeft = 0; state.flashStrength = 0;
    },

    /* ---- RÉSERVÉ AU MOTEUR (main.js) ------------------------------------ */

    /** Avance JUICE avec le TEMPS RÉEL et renvoie le TEMPS DE JEU disponible.
     *  @param {number} rawDtMs temps réel écoulé, déjà clampé
     *  @returns {number} millisecondes de temps de jeu (0 pendant un hitstop) */
    step: function (rawDtMs) {
      const rdt = rawDtMs / 1000;

      // le bruit et le trauma avancent en TEMPS RÉEL : le shake continue
      // pendant le gel, c'est exactement l'effet recherché.
      state.cursor += rdt * config.shakeFrequency;
      state.trauma = Math.max(0, state.trauma - config.traumaDecay * rdt);

      const t2 = state.trauma * state.trauma;
      state.offsetX = config.maxOffset * t2 * fbm(0, state.cursor);
      state.offsetY = config.maxOffset * t2 * fbm(1, state.cursor * 1.07 + 11.3);
      state.rotation = config.maxRotation * t2 * fbm(2, state.cursor * 0.83 + 23.9);

      const kk = Math.pow(config.kickDecay, rdt);
      state.kickX *= kk; state.kickY *= kk;
      if (Math.abs(state.kickX) < 0.02) state.kickX = 0;
      if (Math.abs(state.kickY) < 0.02) state.kickY = 0;

      state.punch *= Math.pow(config.punchDecay, rdt);
      if (state.punch < 0.0004) state.punch = 0;

      if (state.flashLeft > 0) {
        state.flashLeft = Math.max(0, state.flashLeft - rawDtMs);
      }

      if (state.hitstop > 0) {
        const used = Math.min(state.hitstop, rawDtMs);
        state.hitstop -= used;
        return rawDtMs - used;
      }
      return rawDtMs;
    },

    /** Applique la caméra (décalage + rotation + punch-zoom) au contexte.
     *  Le contexte doit déjà être en repère CSS px. Faire un save() avant. */
    applyCamera: function (c) {
      if (!c) return;
      // TRANSLATION ARRONDIE AU PIXEL. Une translation fractionnaire oblige le
      // navigateur à rééchantillonner chaque drawImage au lieu d'en faire une
      // copie directe — or le décor est une pile d'images plein écran.
      const ox = Math.round(state.offsetX + state.kickX);
      const oy = Math.round(state.offsetY + state.kickY);
      if (ox || oy) c.translate(ox, oy);
      // SEUIL SUR LA ROTATION. Le trauma ne retombe jamais tout à fait à zéro
      // (le tir en réinjecte neuf fois par seconde), donc la rotation restait
      // infime mais NON NULLE — invisible à l'œil, mais suffisante pour
      // interdire tout chemin rapide et faire refiltrer 4,6 Mpx à chaque frame.
      const rot = Math.abs(state.rotation) > 0.0025 ? state.rotation : 0;
      const pun = Math.abs(state.punch) > 0.0015 ? state.punch : 0;
      if (rot || pun) {
        const cx = CANVAS_WIDTH / 2, cy = CANVAS_HEIGHT / 2;
        c.translate(cx, cy);
        if (rot) c.rotate(rot);
        if (pun) c.scale(1 + pun, 1 + pun);
        c.translate(-cx, -cy);
      }
    },

    /** Dessine le voile de flash. Contexte en repère CSS px, non secoué. */
    drawFlash: function (c) {
      if (!c || state.flashLeft <= 0 || state.flashStrength <= 0) return;
      const k = state.flashLeft / Math.max(1, state.flashDuration);
      const a = state.flashStrength * k * k;
      if (a <= 0.002) return;
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = a;
      c.fillStyle = state.flashColor;
      c.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      c.restore();
    }
  };

  return api;
})();

window.JUICE = JUICE;

/** LEGACY — l'ancien screenshake de effects.js. Redirigé vers JUICE pour que
 *  tout appelant historique continue de fonctionner sans double effet. */
function applyScreenShake(c) {
  JUICE.applyCamera(c || (typeof ctx !== 'undefined' ? ctx : null));
}

/* =============================================================================
 * 4. CANVAS — devicePixelRatio, redimensionnement
 * -----------------------------------------------------------------------------
 *  Le backing store fait `taille CSS * DPR` pixels ; le contexte est mis à
 *  l'échelle UNE FOIS via setTransform. Résultat : tout le code de dessin
 *  existant continue de raisonner en pixels CSS, mais le rendu est net sur
 *  écran Retina.
 * ========================================================================== */

let _lastResizeKey = '';

function resizeCanvas() {
  if (typeof canvas === 'undefined' || !canvas) return;

  const cssW = Math.max(1, Math.floor(window.innerWidth));
  const cssH = Math.max(1, Math.floor(window.innerHeight));
  const ratio = Math.min(window.devicePixelRatio || 1, RENDER_CONFIG.maxPixelRatio || 2);

  const key = cssW + 'x' + cssH + '@' + ratio;
  const sizeChanged = (key !== _lastResizeKey);
  _lastResizeKey = key;

  const prevW = CANVAS_WIDTH;
  const prevH = CANVAS_HEIGHT;

  DPR = ratio;
  CANVAS_WIDTH = cssW;
  CANVAS_HEIGHT = cssH;

  if (sizeChanged) {
    // Le CSS force déjà width/height à 100 %, mais on l'écrit explicitement
    // pour que le rapport pixels physiques / pixels CSS soit garanti.
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * ratio);
    canvas.height = Math.round(cssH * ratio);
  }

  // Mise à l'échelle unique : à partir d'ici, 1 unité de dessin = 1 px CSS.
  if (typeof ctx !== 'undefined' && ctx) {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  }

  // Buffers de post-traitement — réalloués UNIQUEMENT si la taille a changé.
  if (sizeChanged && typeof NEON !== 'undefined' && NEON && typeof NEON.resize === 'function') {
    NEON.resize(cssW, cssH, ratio);
  }

  // Repositionner le joueur (clampé, pas recentré : on ne veut pas le téléporter)
  if (typeof player !== 'undefined' && player) {
    player.x = clamp(player.x, TEMPO.PLAYER_MARGIN, cssW - player.width - TEMPO.PLAYER_MARGIN);
    player.y = cssH - player.height - 48;
  }

  // Remettre les ennemis à l'échelle proportionnellement plutôt que de les
  // ré-empiler dans une grille arbitraire (l'ancien code cassait les formations).
  if (sizeChanged && prevW > 0 && prevH > 0 && typeof enemies !== 'undefined' && enemies && enemies.length) {
    const sx = cssW / prevW;
    const sy = cssH / prevH;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e) continue;
      e.x *= sx; e.y *= sy;
      if (typeof e.startX === 'number') e.startX *= sx;
      if (typeof e.startY === 'number') e.startY *= sy;
      if (typeof e.targetX === 'number') e.targetX *= sx;
      if (typeof e.targetY === 'number') e.targetY *= sy;
      if (typeof e.formationX === 'number') e.formationX *= sx;
      if (typeof e.formationY === 'number') e.formationY *= sy;
    }
  }

  // Recréer le fond étoilé à la nouvelle densité
  if (sizeChanged && typeof createStars === 'function') {
    try { createStars(); } catch (e) { console.warn('createStars a échoué :', e); }
  }
}

window.resizeCanvas = resizeCanvas;
