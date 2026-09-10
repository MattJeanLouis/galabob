/* =============================================================================
 *  galabob — FOND STELLAIRE : PARALLAXE PRÉ-RENDUE + CIEL DE THÈME
 * -----------------------------------------------------------------------------
 *  Remplace l'ancienne couche unique d'étoiles blanches (jusqu'à ~2000 appels
 *  arc()/fill() par frame, poste de rendu le plus lourd du jeu).
 *
 *  PRINCIPE
 *  --------
 *  • 3 couches d'étoiles (far / mid / near) sont PRÉ-RENDUES une seule fois sur
 *    des canvas hors-écran de la taille de l'écran, puis affichées par un simple
 *    drawImage répété deux fois (défilement vertical bouclé).
 *    → 6 drawImage par frame au lieu de centaines d'arcs.
 *  • 1 couche de NÉBULEUSE pré-rendue en quart de résolution défile très
 *    lentement derrière tout le reste (gradients radiaux très sombres).
 *    Elle n'est construite QUE si BACKDROP est absent : quand le module de
 *    ciel est là, c'est LUI qui peint la nébuleuse (et dix versions).
 *  • Une poignée d'étoiles PROCHES (le tableau `stars`) est simulée
 *    individuellement et trace son sillage DANS LA SCÈNE (et non dans le
 *    buffer de persistance : les étoiles couvrent tout l'écran à chaque frame,
 *    les y tamponner saturait la persistance et voilait le noir — cf. le
 *    commentaire détaillé au-dessus de la boucle de tracé).
 *  • Le champ ACCÉLÈRE quand l'action monte : combo, avancée dans les stages,
 *    transition de stage (effet warp), et tension demandée par BACKDROP —
 *    voir computeStarWarp().
 *
 *  LE CIEL DE THÈME (js/render/backdrop.js)
 *  ----------------------------------------
 *  Si le global BACKDROP existe, ce fichier devient le CHEF D'ORCHESTRE du
 *  fond complet, dans cet ordre strict :
 *
 *      BACKDROP.drawDeep()   nébuleuse du thème, aurores, brume   ← le plus loin
 *      [couches d'étoiles pré-rendues, teintées par le thème]
 *      BACKDROP.drawFront()  planète (elle DÉCOUPE les étoiles), lunes,
 *                            signature, comète/météores/éclipse/tempête
 *      [étoiles proches simulées]                                 ← le plus près
 *
 *  Les couches d'étoiles prennent la TEINTE et la DENSITÉ du thème courant ;
 *  elles sont reconstruites UNIQUEMENT quand BACKDROP.styleVersion() change,
 *  une couche par frame, avec un fondu croisé de 0,8 s pour qu'aucun changement
 *  de ciel ne « claque ».
 *
 *  Si BACKDROP est absent, TOUT ce fichier se comporte exactement comme avant.
 *
 *  UNITÉS : vitesses en px CSS/seconde, durées en ms (convention TEMPO/FRAME).
 *
 *  COMPATIBILITÉ
 *  -------------
 *  `stars` reste un tableau global NON VIDE : stages.js (initStage) et game.js
 *  testent `stars.length === 0` pour décider de rappeler createStars(), et
 *  stages.js itère `stars` dans son updateStarsTransition().
 * ========================================================================== */

/* Étoiles proches simulées (avec traînée). C'est AUSSI le tableau legacy. */
let stars = [];

/* Couches pré-rendues — régénérées uniquement quand la taille ou le thème change. */
let starLayers = [];
let starNebula = null;

let starFieldW = 0;
let starFieldH = 0;

/* Warp : multiplicateur de vitesse du fond, lissé. */
let starWarp = 1;
let starWarpHoldMs = 0;
let starWarpHoldValue = 1;

/* Garde-fou anti double avance : le champ n'avance qu'une fois par frame. */
let starsLastFrame = -1;

/* --- style de ciel courant (teinte/densité venues du thème) --------------- */
const STAR_STYLE_DEFAULT = { tint: '#ffffff', mix: 0, density: 1, alpha: 1 };
let starStyle = STAR_STYLE_DEFAULT;
let starStyleVersion = -1;       // version de thème avec laquelle on a bâti
let starRebuildQueue = [];       // indices de couches à refaire, une par frame

/* Durée du fondu croisé quand une couche est reteintée (secondes). */
const STAR_TINT_FADE_S = 0.8;

/* Définition des couches. Les couleurs/tailles/vitesses viennent de PALETTE
 * et de TEMPO : plus la couche est proche, plus elle est grosse, rapide et
 * lumineuse. `density` module la densité de base TEMPO.STAR_DENSITY. */
const STAR_LAYER_DEFS = [
  { key: 'far',  density: 1.70, sizeMul: 0.80, alpha: 0.38, smear: 0.20, flare: 0.00 },
  { key: 'mid',  density: 0.85, sizeMul: 0.90, alpha: 0.58, smear: 0.55, flare: 0.015 },
  { key: 'near', density: 0.34, sizeMul: 1.05, alpha: 0.85, smear: 1.00, flare: 0.10 }
];

/* -----------------------------------------------------------------------------
 *  ACCÈS AU CIEL DE THÈME (tolérant à son absence)
 * -------------------------------------------------------------------------- */

/** Le module de ciel est-il chargé et opérationnel ? */
function starBackdrop() {
  return (typeof BACKDROP !== 'undefined' && BACKDROP) ? BACKDROP : null;
}

/** Style d'étoiles demandé par le thème courant. Toujours un objet complet. */
function readStarStyle() {
  const B = starBackdrop();
  if (!B || typeof B.starStyle !== 'function') return STAR_STYLE_DEFAULT;
  try {
    const s = B.starStyle() || {};
    return {
      tint: s.tint || '#ffffff',
      mix: clamp(Number(s.mix) || 0, 0, 1),
      density: clamp(Number(s.density) || 1, 0.25, 2),
      alpha: clamp(Number(s.alpha) || 1, 0.25, 1.4)
    };
  } catch (e) {
    return STAR_STYLE_DEFAULT;
  }
}

/** Palette d'une couche, teintée par le thème.
 *  Le NOYAU est bien moins teinté que le halo : une étoile doit rester un point
 *  presque blanc, sinon le ciel devient un aplat de couleur et on perd la
 *  lecture du champ de bataille. */
function starLayerPalette(key, style) {
  const base = (PALETTE.stars && PALETTE.stars[key]) || PALETTE.stars.mid;
  if (!style || !(style.mix > 0)) return base;
  return {
    color: PALETTE.mix(base.color, style.tint, style.mix),
    core: PALETTE.mix(base.core, style.tint, style.mix * 0.5),
    size: base.size,
    alpha: base.alpha,
    speed: base.speed
  };
}

/* -----------------------------------------------------------------------------
 *  OUTILS DE PRÉ-RENDU
 * -------------------------------------------------------------------------- */

/** Petit canvas contenant UNE étoile (dégradé radial). Généré une fois par
 *  couche, puis estampillé N fois : aucun gradient n'est créé au runtime. */
function makeStarSprite(glowHex, coreHex, radius) {
  const r = Math.max(0.8, radius);
  const pad = Math.max(3, Math.ceil(r * 3.2));
  const size = pad * 2;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d');
  // Chute TRÈS raide : une étoile est un POINT, pas une tache. Le halo large
  // est le travail du bloom, pas celui du sprite.
  const grad = g.createRadialGradient(pad, pad, 0, pad, pad, pad);
  grad.addColorStop(0.00, coreHex);
  grad.addColorStop(0.07, PALETTE.rgba(glowHex, 0.95));
  grad.addColorStop(0.20, PALETTE.rgba(glowHex, 0.28));
  grad.addColorStop(0.48, PALETTE.rgba(glowHex, 0.06));
  grad.addColorStop(1.00, PALETTE.rgba(glowHex, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return cv;
}

/** Deux branches lumineuses en croix pour les étoiles les plus brillantes. */
function drawStarFlare(g, x, y, coreHex, len) {
  const l = Math.max(4, len);
  g.save();
  g.globalCompositeOperation = 'lighter';

  const h = g.createLinearGradient(x - l, y, x + l, y);
  h.addColorStop(0, PALETTE.rgba(coreHex, 0));
  h.addColorStop(0.5, PALETTE.rgba(coreHex, 0.55));
  h.addColorStop(1, PALETTE.rgba(coreHex, 0));
  g.fillStyle = h;
  g.fillRect(x - l, y - 0.6, l * 2, 1.2);

  const v = g.createLinearGradient(x, y - l * 0.7, x, y + l * 0.7);
  v.addColorStop(0, PALETTE.rgba(coreHex, 0));
  v.addColorStop(0.5, PALETTE.rgba(coreHex, 0.45));
  v.addColorStop(1, PALETTE.rgba(coreHex, 0));
  g.fillStyle = v;
  g.fillRect(x - 0.6, y - l * 0.7, 1.2, l * 1.4);

  g.restore();
}

/** Construit le CANVAS d'une couche d'étoiles (taille de l'écran). */
function buildStarLayerCanvas(def, w, h, style) {
  const pal = starLayerPalette(def.key, style);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  g.globalCompositeOperation = 'lighter';

  const sprite = makeStarSprite(pal.color, pal.core, pal.size * def.sizeMul);
  const sw = sprite.width;
  const dens = (style && style.density) || 1;
  const count = Math.max(14, Math.round(w * h * TEMPO.STAR_DENSITY * def.density * dens));

  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    // Beaucoup de petites, très peu de grosses (produit de deux aléas).
    const sc = 0.42 + Math.random() * Math.random() * 1.05;
    const s = sw * sc;
    g.globalAlpha = (pal.alpha || 1) * (0.22 + Math.random() * Math.random() * 0.78);
    g.drawImage(sprite, x - s / 2, y - s / 2, s, s);
    if (def.flare > 0 && Math.random() < def.flare) {
      drawStarFlare(g, x, y, pal.core, s * 1.1);
    }
  }

  g.globalAlpha = 1;
  return cv;
}

/** Couche complète : canvas + défilement + état de fondu croisé. */
function buildStarLayer(def, w, h, style) {
  const pal = starLayerPalette(def.key, style);
  return {
    canvas: buildStarLayerCanvas(def, w, h, style),
    prev: null,          // canvas de l'ancien thème, le temps du fondu
    fade: 1,             // 0 → 1 : part du prev vers le nouveau
    speed: pal.speed || TEMPO.STAR_SPEED_MID,
    alpha: def.alpha,
    smear: def.smear,
    offset: Math.random() * h
  };
}

/** Reteinte UNE couche en gardant son défilement : l'ancienne image reste
 *  affichée le temps du fondu, donc aucun « saut » du ciel. */
function retintStarLayer(i, style) {
  const def = STAR_LAYER_DEFS[i];
  const L = starLayers[i];
  if (!def || !L) return;
  const cv = buildStarLayerCanvas(def, starFieldW, starFieldH, style);
  L.prev = L.canvas;
  L.canvas = cv;
  L.fade = 0;
  L.speed = starLayerPalette(def.key, style).speed || L.speed;
}

/** Nébuleuse de REPLI : utilisée seulement si BACKDROP n'est pas chargé.
 *  Quelques gradients radiaux TRÈS sombres, en quart de résolution.
 *  Composée en 'lighter' : elle teinte le noir sans jamais l'éclaircir. */
function buildNebula(w, h) {
  const ratio = 0.34;
  const nw = Math.max(8, Math.round(w * ratio));
  const nh = Math.max(8, Math.round(h * ratio));
  const cv = document.createElement('canvas');
  cv.width = nw;
  cv.height = nh;
  const g = cv.getContext('2d');
  g.globalCompositeOperation = 'lighter';

  // Bleu nuit dominant, magenta et cyan par TOUCHES : la nébuleuse doit se
  // deviner, jamais se voir. Tout ce qui se remarque ici écrase le jeu.
  const tints = [
    PALETTE.bg.haze,                     // bleu nuit
    PALETTE.entities.enemyShooter.glow,  // violet
    PALETTE.bg.haze,
    PALETTE.ui.accentAlt,                // magenta
    PALETTE.bg.haze,
    PALETTE.ui.accent                    // cyan
  ];

  const blobs = 6;
  for (let i = 0; i < blobs; i++) {
    const tint = tints[i % tints.length];
    const cx = Math.random() * nw;
    const cy = Math.random() * nh;
    const r = (0.22 + Math.random() * 0.4) * Math.max(nw, nh);
    const squash = 0.45 + Math.random() * 0.9;
    const peak = (i % 2 === 0) ? 0.030 + Math.random() * 0.020
                               : 0.012 + Math.random() * 0.012;

    const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0.00, PALETTE.rgba(tint, peak));
    grad.addColorStop(0.45, PALETTE.rgba(tint, peak * 0.45));
    grad.addColorStop(1.00, PALETTE.rgba(tint, 0));

    g.save();
    g.translate(cx, cy);
    g.rotate(Math.random() * Math.PI);
    g.scale(1, squash);
    g.fillStyle = grad;
    g.fillRect(-r, -r, r * 2, r * 2);
    g.restore();
  }

  // Poussière : de minuscules points bleutés, sous le seuil de perception.
  g.globalAlpha = 0.30;
  g.fillStyle = PALETTE.stars.far.color;
  const dust = Math.round(nw * nh / 1400);
  for (let i = 0; i < dust; i++) {
    g.fillRect(Math.random() * nw, Math.random() * nh, 1, 1);
  }
  g.globalAlpha = 1;

  return { canvas: cv, offset: 0, speed: 11, alpha: 0.62 };
}

/** Étoiles proches simulées une à une : ce sont elles qui laissent une traînée. */
function buildNearStars(w, h) {
  const pal = PALETTE.stars.accent;
  const count = Math.round(clamp(w * h * TEMPO.STAR_DENSITY * 0.16, 6, 22));
  stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      // `speed` est en px/s ; conservé en propriété pour la compat legacy.
      speed: pal.speed * (0.7 + Math.random() * 0.75),
      radius: pal.size * (0.42 + Math.random() * 0.6),
      alpha: pal.alpha * (0.4 + Math.random() * 0.45),
      // Une sur quatre prend la teinte d'accent, les autres le blanc froid.
      accent: Math.random() < 0.25,
      col: Math.random() < 0.25 ? PALETTE.get('player') : PALETTE.get('star'),
      twinkle: Math.random() * Math.PI * 2
    });
  }
  tintNearStars(starStyle);
}

/** Les étoiles proches prennent, elles aussi, la teinte du thème — mais de
 *  moitié : ce sont les plus brillantes, elles doivent rester des POINTS
 *  blancs qu'on distingue instantanément d'un projectile. */
function tintNearStars(style) {
  if (!stars.length) return;
  const baseWhite = PALETTE.get('star');
  const baseAccent = PALETTE.get('player');
  let colWhite = baseWhite;
  let colAccent = baseAccent;

  if (style && style.mix > 0) {
    const m = style.mix * 0.5;
    colWhite = PALETTE.get({
      core: PALETTE.mix(baseWhite.core, style.tint, m * 0.4),
      glow: PALETTE.mix(baseWhite.glow, style.tint, m)
    });
    colAccent = PALETTE.get({
      core: PALETTE.mix(baseAccent.core, style.tint, m * 0.4),
      glow: PALETTE.mix(baseAccent.glow, style.tint, m * 0.75)
    });
  }

  for (let i = 0; i < stars.length; i++) {
    stars[i].col = stars[i].accent ? colAccent : colWhite;
  }
}

/* -----------------------------------------------------------------------------
 *  API PUBLIQUE
 * -------------------------------------------------------------------------- */

/** (Re)génère tout le fond. Appelé par resizeCanvas(), initGame() et
 *  stageSystem.initStage(). Coûteux (~quelques ms) : ne pas appeler par frame. */
function createStars() {
  const w = Math.max(1, Math.round(CANVAS_WIDTH));
  const h = Math.max(1, Math.round(CANVAS_HEIGHT));

  starFieldW = w;
  starFieldH = h;
  starLayers = [];
  starRebuildQueue = [];

  const B = starBackdrop();
  starStyle = readStarStyle();
  starStyleVersion = (B && typeof B.styleVersion === 'function') ? B.styleVersion() : -1;

  try {
    for (let i = 0; i < STAR_LAYER_DEFS.length; i++) {
      starLayers.push(buildStarLayer(STAR_LAYER_DEFS[i], w, h, starStyle));
    }
    // La nébuleuse de repli n'existe QUE sans module de ciel : quand BACKDROP
    // est là, il en peint dix, bien plus riches, et payer les deux serait une
    // dépense pure (mémoire + 2 blits plein écran par frame).
    starNebula = B ? null : buildNebula(w, h);
  } catch (e) {
    console.warn('Fond stellaire : pré-rendu impossible, repli minimal.', e);
    starLayers = [];
    starNebula = null;
  }

  buildNearStars(w, h);

  starWarp = 1;
  starWarpHoldMs = 0;
  starWarpHoldValue = 1;
}

/** Force un coup d'accélérateur sur le fond (warp) pendant `ms`.
 *  Utilisable par n'importe quel module : setStarWarp(3, 400). */
function setStarWarp(multiplier, ms) {
  const m = Math.max(1, Number(multiplier) || 1);
  if (m >= starWarpHoldValue || starWarpHoldMs <= 0) {
    starWarpHoldValue = Math.min(m, TEMPO.STAR_WARP_MULT);
  }
  starWarpHoldMs = Math.max(starWarpHoldMs, Number(ms) || 0);
}

/** Cible de vitesse du fond selon l'intensité de l'action. */
function computeStarWarp() {
  let target = 1;

  const sys = (typeof stageSystem !== 'undefined') ? stageSystem : null;

  if (sys && sys.transitionActive) {
    // Warp de transition : stages.js fait monter starSpeedMultiplier.
    const m = Number(sys.starSpeedMultiplier) || 1;
    target = clamp(1 + (m - 1) * 2.2, 1, TEMPO.STAR_WARP_MULT);
  } else if (typeof gameState !== 'undefined' && gameState === 'playing') {
    // En jeu : le fond se tend avec le combo et l'avancée dans les stages.
    let combo = 1;
    if (typeof getComboMultiplier === 'function') {
      try { combo = getComboMultiplier(); } catch (e) { combo = 1; }
    }
    target = 1 + (combo - 1) * 0.17;
    if (sys && sys.currentStage > 1) {
      target += Math.min(0.55, (sys.currentStage - 1) * 0.055);
    }
    // Tension demandée par le ciel (BACKDROP.setIntensity) : les étoiles
    // accélèrent quand l'action monte, même sans combo.
    const B = starBackdrop();
    if (B && typeof B.warpBoost === 'function') {
      try { target += clamp(Number(B.warpBoost()) || 0, 0, 1.2); } catch (e) { /* ignoré */ }
    }
  }

  if (starWarpHoldMs > 0) target = Math.max(target, starWarpHoldValue);
  return target;
}

/** Suit le thème : si BACKDROP a changé de ciel, on reteinte les couches —
 *  UNE PAR FRAME, et jamais pendant qu'une autre reconstruction est en cours.
 *  Le fondu croisé (0,8 s) est ce qui empêche le ciel de « claquer ». */
function syncStarTheme(dt) {
  const B = starBackdrop();
  if (!B || !starLayers.length) return;

  let version = starStyleVersion;
  try { version = B.styleVersion(); } catch (e) { return; }

  if (version !== starStyleVersion) {
    starStyleVersion = version;
    starStyle = readStarStyle();
    starRebuildQueue = [0, 1, 2];
    tintNearStars(starStyle);
  }

  // Une seule reconstruction par frame : reteinter les trois couches d'un coup
  // coûterait ~3 ms et se verrait comme un à-coup.
  if (starRebuildQueue.length) {
    const i = starRebuildQueue.shift();
    try { retintStarLayer(i, starStyle); }
    catch (e) { console.warn('Fond stellaire : reteinte impossible.', e); }
  }

  // Avance des fondus croisés.
  if (dt > 0) {
    for (let i = 0; i < starLayers.length; i++) {
      const L = starLayers[i];
      if (L.fade < 1) {
        L.fade += dt / STAR_TINT_FADE_S;
        if (L.fade >= 1) { L.fade = 1; L.prev = null; }
      }
    }
  }
}

/** Avance le champ. `dt` en SECONDES. Supporte dt === 0. */
function advanceStarField(dt) {
  starsLastFrame = FRAME.frame;
  const sec = (typeof dt === 'number' && isFinite(dt)) ? Math.max(0, dt) : 0;

  // Le ciel de thème avance AVANT le champ : il fixe la tension (warpBoost),
  // la position de la planète et l'état des événements de cette frame.
  // On l'appelle même à dt = 0 (hitstop, pause) : il gèle son animation tout
  // seul, mais continue d'étaler ses pré-rendus en attente.
  const B = starBackdrop();
  if (B && typeof B.update === 'function') {
    try { B.update(sec); } catch (e) { console.warn('BACKDROP.update a échoué :', e); }
  }

  syncStarTheme(sec);

  if (!(sec > 0)) return;

  if (starWarpHoldMs > 0) {
    starWarpHoldMs -= sec * 1000;
    if (starWarpHoldMs <= 0) {
      starWarpHoldMs = 0;
      starWarpHoldValue = 1;
    }
  }

  // Montée rapide, redescente plus douce (damp : fraction restante après 1 s).
  const target = computeStarWarp();
  starWarp = damp(starWarp, target, target > starWarp ? 0.004 : 0.12, sec);

  const h = starFieldH || CANVAS_HEIGHT || 1;

  for (let i = 0; i < starLayers.length; i++) {
    const L = starLayers[i];
    L.offset += L.speed * starWarp * sec;
    if (L.offset >= h || L.offset < 0) {
      L.offset -= Math.floor(L.offset / h) * h;
    }
  }

  if (starNebula) {
    // La nébuleuse ne warpe qu'à moitié : elle est censée être très loin.
    starNebula.offset += starNebula.speed * (1 + (starWarp - 1) * 0.35) * sec;
    if (starNebula.offset >= h) starNebula.offset -= Math.floor(starNebula.offset / h) * h;
  }

  const w = starFieldW || CANVAS_WIDTH || 1;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    s.y += s.speed * starWarp * sec;
    s.twinkle += sec * 3.4;
    if (s.y > h) {
      s.y -= h;
      s.x = Math.random() * w;
    }
  }
}

/** Appelée par game.js dans la boucle de jeu. `deltaTime` en MILLISECONDES. */
function updateStars(deltaTime) {
  const ms = (typeof deltaTime === 'number' && isFinite(deltaTime)) ? deltaTime : FRAME.dtMs;
  advanceStarField(ms / 1000);
}

/** SUPPLANTE volontairement la version de stages.js (chargé AVANT ce fichier).
 *  L'ancienne appliquait `star.y += star.speed * multiplicateur` PAR FRAME, donc
 *  dépendante du framerate. Ici la transition ne fait que demander le warp :
 *  l'avance réelle est faite par drawStars() en temps réel.
 *  Si l'ordre des <script> venait à changer, la version de stages.js
 *  redeviendrait active : elle est inoffensive (elle itère les mêmes objets). */
function updateStarsTransition() {
  const sys = (typeof stageSystem !== 'undefined') ? stageSystem : null;
  if (!sys) return;
  const m = Number(sys.starSpeedMultiplier) || 1;
  setStarWarp(clamp(1 + (m - 1) * 2.2, 1, TEMPO.STAR_WARP_MULT), 120);
}

/** Blit d'une couche pré-rendue, deux fois pour le bouclage vertical.
 *  Pendant un changement de thème, l'ancienne image et la nouvelle se croisent
 *  au MÊME offset : le ciel change de couleur sans jamais se déplacer. */
function blitStarLayer(c, L, alpha, offset) {
  const w = starFieldW, h = starFieldH;
  const oy = ((offset % h) + h) % h;
  if (L.prev && L.fade < 1) {
    c.globalAlpha = clamp(alpha * (1 - L.fade), 0, 1);
    c.drawImage(L.prev, 0, oy - h, w, h);
    c.drawImage(L.prev, 0, oy, w, h);
    c.globalAlpha = clamp(alpha * L.fade, 0, 1);
  } else {
    c.globalAlpha = clamp(alpha, 0, 1);
  }
  c.drawImage(L.canvas, 0, oy - h, w, h);
  c.drawImage(L.canvas, 0, oy, w, h);
}

/** Dessin du fond. `ctx` pointe sur le buffer émissif de NEON pendant la scène. */
function drawStars() {
  const c = ctx;
  if (!c) return;

  // (Re)construction paresseuse : premier appel, ou taille d'écran changée.
  if (!starLayers.length || starFieldW !== Math.round(CANVAS_WIDTH) ||
      starFieldH !== Math.round(CANVAS_HEIGHT)) {
    createStars();
    if (!starLayers.length) return;
  }

  // Menus, game over, transitions de stage : update() ne tourne pas, on avance
  // ici en TEMPS RÉEL pour que le fond reste vivant.
  if (starsLastFrame !== FRAME.frame) advanceStarField(FRAME.rawDt || 0);

  const B = starBackdrop();
  const w = starFieldW;
  const h = starFieldH;

  /* ---- 1. LE PLUS LOIN : nébuleuse du thème, aurores, brume --------------- */
  if (B && typeof B.drawDeep === 'function') {
    try { B.drawDeep(c); } catch (e) { console.warn('BACKDROP.drawDeep a échoué :', e); }
  }

  // L'éclipse assombrit TOUT le ciel, étoiles comprises : c'est ce qui fait la
  // différence entre « une lune passe » et « la lumière s'en va ».
  let skyDim = 1;
  if (B && typeof B.dim === 'function') {
    try { skyDim = 1 - clamp(Number(B.dim()) || 0, 0, 1) * 0.62; } catch (e) { skyDim = 1; }
  }

  c.save();
  c.globalCompositeOperation = 'lighter';
  c.imageSmoothingEnabled = true;

  // --- nébuleuse de repli (seulement si BACKDROP n'en peint pas) -----------
  if (starNebula) {
    const o = starNebula.offset;
    c.globalAlpha = clamp(starNebula.alpha * skyDim, 0, 1);
    c.drawImage(starNebula.canvas, 0, o - h, w, h);
    c.drawImage(starNebula.canvas, 0, o, w, h);
  }

  /* ---- 2. LES COUCHES D'ÉTOILES, de la plus lointaine à la plus proche ---- */
  const styleAlpha = starStyle.alpha || 1;
  const smearAmount = starWarp - 1;
  for (let i = 0; i < starLayers.length; i++) {
    const L = starLayers[i];
    const o = L.offset;
    const a = L.alpha * styleAlpha * skyDim;

    blitStarLayer(c, L, a, o);

    // Filé de vitesse : deux copies décalées vers l'arrière, de plus en plus
    // faibles. Beaucoup moins cher qu'un vrai flou et parfaitement lisible.
    // Seuil volontairement haut : le filé ne coûte des blits qu'aux vrais
    // moments de warp (transition de stage), jamais pour un simple combo.
    if (smearAmount > 0.8) {
      const step = Math.min(90, smearAmount * L.speed * L.smear * 0.016);
      if (step > 2.5) {
        for (let k = 1; k <= 2; k++) {
          // Décalage ramené dans [0, h) : sans ça la copie fantôme laisse un
          // trou en bas de l'écran quand le pas devient grand.
          const oy = ((o - step * k) % h + h) % h;
          const ga = a * (k === 1 ? 0.34 : 0.16) * Math.min(1, smearAmount * 0.5);
          c.globalAlpha = clamp(ga, 0, 1);
          c.drawImage(L.canvas, 0, oy - h, w, h);
          c.drawImage(L.canvas, 0, oy, w, h);
        }
      }
    }
  }

  c.globalAlpha = 1;
  c.restore();

  /* ---- 3. LE CIEL PROCHE : planète (elle DÉCOUPE les étoiles), lunes,
   *        signature du thème, comète / météores / éclipse / tempête -------- */
  if (B && typeof B.drawFront === 'function') {
    try { B.drawFront(c); } catch (e) { console.warn('BACKDROP.drawFront a échoué :', e); }
  }

  /* ---- 4. LE PLUS PRÈS : étoiles simulées, avec sillage ------------------- */
  //
  //  Elles passent DEVANT la planète : c'est le plan le plus proche de l'œil,
  //  et c'est ce contraste (un point net qui file sur un disque immobile) qui
  //  vend l'échelle du corps céleste.
  //
  //  Le sillage est tracé DANS LA SCÈNE, plus dans le buffer de persistance.
  //  Raison mesurée : les étoiles couvrent tout l'écran à chaque frame ; en
  //  les tamponnant dans le buffer de traînées, 99,96 % des pixels de ce
  //  buffer finissaient allumés en permanence. Comme l'alpha y est stocké sur
  //  8 bits prémultipliés, l'atténuation multiplicative NE DESCEND JAMAIS
  //  jusqu'à zéro : le voile restait, et le noir profond de la direction
  //  artistique virait au gris laiteux (mesuré : +28 % de luminance moyenne).
  //  Un trait tracé une fois par frame donne exactement le même sillage, sans
  //  rémanence — et sans brûler l'écran des menus.
  const tail = 0.042 * starWarp;

  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const tw = 0.78 + 0.22 * Math.sin(s.twinkle);
    const a = s.alpha * tw * skyDim;
    NEON.dot(c, s.x, s.y, s.radius, s.col, { alpha: a });
    const len = s.speed * starWarp * tail * 3.2;
    if (len > 1.5) {
      NEON.line(c, s.x, s.y - len, s.x, s.y, s.col,
                s.radius * 0.8, { alpha: a * 0.30, passes: 2, halo: false });
    }
  }
}
