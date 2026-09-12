/* =============================================================================
 *  galabob — CONFIGURATION CENTRALE
 * -----------------------------------------------------------------------------
 *  Ce fichier est chargé EN PREMIER. Il ne dépend de rien.
 *
 *  CONVENTION DE TEMPS — À RESPECTER PAR TOUS LES MODULES
 *  =====================================================
 *  1. Toute VITESSE s'exprime en PIXELS CSS PAR SECONDE (px/s).
 *  2. Toute CADENCE / DURÉE s'exprime en MILLISECONDES (ms).
 *  3. L'intégration se fait TOUJOURS :   pos += vitesse * dt
 *     où `dt` est en SECONDES.
 *  4. `dt` s'obtient de deux façons strictement équivalentes :
 *        const dt = FRAME.dt;          // secondes  (RECOMMANDÉ)
 *        const dt = deltaTime / 1000;  // deltaTime reçu en paramètre, en ms
 *  5. Toute probabilité "par frame" est INTERDITE. On écrit :
 *        if (Math.random() < chancePerSecond * dt) { ... }
 *  6. Toute animation basée sur le temps utilise FRAME.time (secondes de temps
 *     de JEU, gelé pendant la pause et le hitstop) et JAMAIS Date.now().
 *
 *  Voir aussi : js/utils.js (JUICE), js/core/palette.js (PALETTE),
 *               js/render/neon.js (NEON).
 * ========================================================================== */

// Dimensions logiques du rendu, EN PIXELS CSS (jamais en pixels physiques).
// Mises à jour par resizeCanvas() (js/utils.js).
let CANVAS_WIDTH = window.innerWidth;
let CANVAS_HEIGHT = window.innerHeight;

// Ratio de pixels physiques réellement utilisé pour le backing store du canvas.
// Le contexte est pré-mis à l'échelle : TOUT le code de dessin raisonne en px CSS.
let DPR = 1;

/* -----------------------------------------------------------------------------
 *  FRAME — horloge globale du jeu (mise à jour par js/main.js, une fois/frame)
 *  Lecture seule pour les autres modules.
 * -------------------------------------------------------------------------- */
const FRAME = {
  dt: 0,          // secondes de TEMPS DE JEU écoulées cette frame (0 si gelé/pause)
  dtMs: 0,        // idem, en millisecondes
  rawDt: 0,       // secondes de TEMPS RÉEL écoulées cette frame (clampé)
  rawDtMs: 0,     // idem, en millisecondes
  time: 0,        // secondes de TEMPS DE JEU cumulées depuis le chargement
  realTime: 0,    // secondes de TEMPS RÉEL cumulées depuis le chargement
  frame: 0,       // index de frame
  fps: 60,        // FPS lissé
  hidden: false,  // true si l'onglet est en arrière-plan
  frozen: false,  // true si un hitstop est en cours
  maxFrameMs: 50  // clamp du delta (absorbe alt-tab / breakpoints)
};

/* -----------------------------------------------------------------------------
 *  TEMPO — toutes les constantes de rythme du jeu.
 *  Valeurs volontairement NERVEUSES (demande explicite du propriétaire).
 *  Vitesses en px/s, durées et cadences en ms, probabilités par SECONDE.
 * -------------------------------------------------------------------------- */
const TEMPO = {
  /* ---------- JOUEUR ---------- */
  PLAYER_SPEED: 520,              // px/s  (avant : 3.5 px/frame ≈ 210 px/s)
  PLAYER_SPEED_MAX_MULT: 1.35,    // multiplicateur max gagné avec le score
  PLAYER_SPEED_SCORE_STEP: 0.00004, // + par point de score
  PLAYER_ACCEL: 6200,             // px/s² — si le module joueur veut de l'inertie
  PLAYER_FRICTION: 8200,          // px/s² — décélération quand aucune touche
  PLAYER_MARGIN: 8,               // px — marge minimale aux bords de l'écran

  PLAYER_FIRE_INTERVAL: 110,      // ms entre deux tirs (avant : 300 ms)
  PLAYER_FIRE_INTERVAL_DOUBLE: 125,
  PLAYER_FIRE_INTERVAL_SPREAD: 150,
  PLAYER_BULLET_SPEED: 1150,      // px/s (avant : 7 px/frame ≈ 420 px/s)
  PLAYER_BULLET_W: 3,             // px CSS
  PLAYER_BULLET_H: 16,            // px CSS
  PLAYER_BULLET_SPREAD_VX: 280,   // px/s de déviation latérale (arme 'spread')
  PLAYER_KICKBACK: 5,             // px de recul visuel du vaisseau au tir
  PLAYER_KICKBACK_RECOVER: 60,    // ms pour revenir de ce recul
  PLAYER_MUZZLE_MS: 70,           // ms de flash de bouche

  PLAYER_IFRAME_MS: 1500,         // durée d'invulnérabilité après un coup
  PLAYER_RESPAWN_MS: 420,         // durée de l'état "respawn"
  PLAYER_BLINK_MS: 70,            // demi-période de clignotement pendant les i-frames
  PLAYER_HITBOX: 9,               // px CSS — côté du carré de collision (façon Ikaruga)

  /* ---------- ENNEMIS ---------- */
  ENEMY_BULLET_SPEED: 430,        // px/s (avant : 3 px/frame ≈ 180 px/s)
  ENEMY_BULLET_SPEED_SHOOTER: 520,
  ENEMY_BULLET_W: 4,
  ENEMY_BULLET_H: 14,

  FORMATION_SPEED: 165,           // px/s — déplacement latéral de la formation
  FORMATION_SPEED_PER_STAGE: 22,  // px/s ajoutés à chaque stage
  FORMATION_SPEED_MAX: 430,       // px/s — plafond
  FORMATION_DROP: 22,             // px descendus quand la formation touche un bord
  FORMATION_BOB_HZ: 0.55,         // Hz — respiration verticale de la formation
  FORMATION_BOB_AMP: 7,           // px
  FORMATION_SWAY_HZ: 0.42,        // Hz — respiration horizontale
  FORMATION_SWAY_AMP: 6,          // px
  FORMATION_MAX_DESCENT: 0.55,    // fraction de la hauteur d'écran à ne pas dépasser

  ENTRY_SPEED: 660,               // px/s — vitesse pendant la chorégraphie d'entrée
  ENTRY_STAGGER_MS: 55,           // ms de décalage entre deux ennemis d'une même vague

  DIVE_SPEED: 660,                // px/s — vitesse de plongée
  DIVE_DURATION: 880,             // ms — durée d'une plongée complète
  DIVE_CHANCE_PER_SEC: 0.11,      // proba PAR SECONDE et PAR ENNEMI de déclencher une plongée
  DIVE_CHANCE_PER_STAGE: 0.018,   // + par stage
  DIVE_MAX_CONCURRENT: 4,         // nb max d'ennemis en plongée simultanée
  DIVE_TELEGRAPH_MS: 320,         // ms de télégraphie AVANT le départ en plongée
  DIVE_RETURN_SPEED: 480,         // px/s — retour en formation après plongée

  ENEMY_SHOT_TELEGRAPH_MS: 170,   // ms de charge visible avant un tir ennemi
  // Probabilité PAR SECONDE et PAR ENNEMI de tirer (avant : ~0.018/s, ridicule)
  ENEMY_SHOT_CHANCE_PER_SEC: { normal: 0.22, shooter: 0.70, fast: 0.38, elite: 0.95 },
  ENEMY_SHOT_STAGE_MULT: 1.08,    // multiplicatif par stage
  ENEMY_SHOT_MAX_ONSCREEN: 26,    // plafond de balles ennemies simultanées
  ENEMY_RAM_DAMAGE: true,         // le corps-à-corps est létal

  /* ---------- STAGES / FLUX ---------- */
  STAGE_TRANSITION_MS: 1600,      // avant : 5000 ms
  STAGE_INTRO_MS: 700,            // ms d'annonce du stage
  STAGE_COMPLETE_DELAY_MS: 120,   // avant : 300 ms
  WAVE_SPAWN_DELAY_MS: 220,
  BOOT_DELAY_MS: 0,               // démarrage INSTANTANÉ — ne jamais remonter

  /* ---------- DENSITÉ DU CHAMP DE BATAILLE ----------
   *  Le jeu ne se jugeait pas sur la difficulté mais sur le VIDE : mesuré,
   *  53 % du temps de jeu se passait avec 2 ennemis ou moins à l'écran, parce
   *  que la vague suivante n'arrivait qu'une fois l'écran totalement nettoyé.
   *  On garde désormais le champ PLEIN : dès qu'il descend sous le seuil de
   *  renfort, une nouvelle vague s'invite pendant que les survivants combattent
   *  encore. Le budget total du stage (enemiesPerStage) est inchangé : c'est le
   *  RYTHME qui change, pas la quantité. */
  FIELD_TARGET: 16,               // ennemis visés simultanément à l'écran
  FIELD_REINFORCE_AT: 10,         // en dessous, un renfort part immédiatement
  FIELD_REINFORCE_COOLDOWN_MS: 650, // anti-rafale entre deux renforts

  /* ---------- COMBO ---------- */
  COMBO_WINDOW_MS: 1600,          // fenêtre pour enchaîner un kill
  COMBO_MAX: 8,                   // multiplicateur maximum

  /* ---------- POWER-UPS ---------- */
  POWERUP_FALL_SPEED: 200,        // px/s
  POWERUP_DURATION_MS: 9000,
  POWERUP_DROP_CHANCE: 0.15,      // proba par ennemi tué (13 types : voir powerups.js)

  /* ---------- ÉTOILES / PARALLAXE ---------- */
  STAR_SPEED_FAR: 26,             // px/s
  STAR_SPEED_MID: 72,             // px/s
  STAR_SPEED_NEAR: 168,           // px/s
  STAR_WARP_MULT: 14,             // multiplicateur pendant la transition de stage
  STAR_DENSITY: 1 / 11000         // étoiles par px² CSS (avant : 1/4000, ~2000 arcs/frame)
};

/* -----------------------------------------------------------------------------
 *  RENDER_CONFIG — qualité et post-traitement (lu par js/render/neon.js)
 * -------------------------------------------------------------------------- */
const RENDER_CONFIG = {
  // Plafond du devicePixelRatio. MESURÉ sur un Retina : à 2, le canvas fait
  // 4,6 Mpx et la composition coûte ~27 ms par frame CÔTÉ NAVIGATEUR (le JS,
  // lui, ne consomme que 1,7 ms) — le pipeline néon traverse la surface 5 à 6
  // fois par frame (scène, deux bloom, traînées, aberration, vignette), soit
  // ~27 Mpx de remplissage. Le coût est donc proportionnel à la surface, et
  // c'est le seul levier qui compte vraiment. À 1.5, la surface tombe de 44 %.
  maxPixelRatio: 1.5,
  bloom: true,          // activer le moteur de bloom néon
  bloomIntensity: 1.0,  // 0 → 2
  bloomBlurA: 5,        // rayon de flou du buffer 1/4 (en px de ce buffer)
  bloomBlurB: 9,        // rayon de flou du buffer 1/8
  bloomWeightA: 0.62,
  bloomWeightB: 0.48,
  aberration: 1.8,      // px CSS de décalage de l'aberration chromatique (0 = off)
  trails: true,         // traînées de mouvement persistantes
  // Fraction conservée d'une frame à l'autre (à 60 fps).
  // L'ancien plafond dur de 0.75 est levé : la PURGE ROULANTE (ci-dessous)
  // casse l'arrondi 8 bits, donc les alphas faibles atteignent zéro au lieu
  // de geler. Mesuré : plancher 0/255 et traînée de 20 frames (contre 8).
  trailFade: 0.95,
  // Purge roulante : chaque frame, UNE bande du buffer subit cette atténuation
  // bien plus forte. Chaque pixel y passe tous les `trailPurgeBands` frames.
  // C'est ce qui garantit l'extinction totale ; le découpage en bandes évite
  // que l'écran entier ne clignote au rythme de la purge.
  trailPurge: 0.35,
  trailPurgeBands: 10,
  vignette: 0.30,       // 0 → 1
  autoQuality: true,    // rétrograde automatiquement si le framerate s'effondre
  quality: 3            // 3 = complet, 2 = sans aberration, 1 = bloom simple, 0 = pas de bloom
};

/* -----------------------------------------------------------------------------
 *  LEGACY — conservé pour compatibilité avec le code existant.
 *  BASE_PLAYER_SPEED est désormais exprimé en px/s comme TEMPO.PLAYER_SPEED.
 * -------------------------------------------------------------------------- */
const SPEED_CONFIG = {
  BASE_PLAYER_SPEED: TEMPO.PLAYER_SPEED,   // px/s
  BASE_ENEMY_SPEED: TEMPO.FORMATION_SPEED, // px/s
  SPEED_INCREMENT: TEMPO.PLAYER_SPEED_SCORE_STEP,
  MAX_SPEED_MULTIPLIER: TEMPO.PLAYER_SPEED_MAX_MULT
};

// Constantes pour les patterns de mouvement des ennemis
const ENEMY_PATTERNS = {
  PATROL: 'patrol',       // Patrouille horizontale
  DIVE: 'dive',           // Plongée en arc
  SWEEP: 'sweep',         // Balayage en S
  ZIGZAG: 'zigzag',       // Mouvement en zigzag
  FORMATION: 'formation'  // Ennemis en formation ordonnée
};

// Constantes pour les formations et chorégraphies
const FORMATIONS = {
  GRID: 'grid',
  DIAMOND: 'diamond',
  CIRCLE: 'circle',
  DOUBLE_ROW: 'doubleRow',
  WEDGE: 'wedge',
  ARC: 'arc',
  COLUMNS: 'columns'
};

// Configurations des chorégraphies d'entrée
const ENTRY_CHOREOGRAPHIES = {
  SPIRAL: 'spiral',
  ZIGZAG: 'zigzag',
  CURVE_LEFT: 'curveLeft',
  CURVE_RIGHT: 'curveRight',
  SPLIT: 'split'
};

// Configuration UI et debug
const GAME_CONFIG = {
  showDebugInfo: false,
  debugColor: 'rgba(200, 235, 255, 0.75)',
  showAudioControls: false
};

// Fenêtre du système de combo (ms). Alias historique de TEMPO.COMBO_WINDOW_MS.
const COMBO_TIMEOUT = TEMPO.COMBO_WINDOW_MS;

// Miroirs sur window pour l'introspection / le debug console.
window.FRAME = FRAME;
window.TEMPO = TEMPO;
window.RENDER_CONFIG = RENDER_CONFIG;
window.GAME_CONFIG = GAME_CONFIG;
