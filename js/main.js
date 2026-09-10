/* =============================================================================
 *  galabob — POINT D'ENTRÉE ET BOUCLE PRINCIPALE
 * -----------------------------------------------------------------------------
 *  BOUCLE À PAS DE TEMPS ROBUSTE
 *  ----------------------------
 *  1. `rawDtMs` = temps réel écoulé, CLAMPÉ à FRAME.maxFrameMs (50 ms).
 *     Un alt-tab de 20 minutes produit donc au pire une frame de 50 ms :
 *     plus aucune téléportation, plus aucun état corrompu au retour.
 *  2. `JUICE.step(rawDtMs)` avance les effets en temps RÉEL et renvoie le
 *     temps de JEU disponible : 0 pendant un hitstop, rawDtMs sinon.
 *  3. `update(dtMs)` reçoit ce temps de jeu, en MILLISECONDES.
 *     `draw()` est appelé À CHAQUE FRAME, même gelée : le rendu ne s'arrête
 *     jamais (c'est tout l'intérêt du hitstop).
 *
 *  CONVENTION IMPOSÉE À TOUS LES MODULES
 *  -------------------------------------
 *      vitesses en PIXELS CSS PAR SECONDE
 *      pos += vitesse * dt              avec  dt = FRAME.dt  (secondes)
 *      ou   dt = deltaTime / 1000       (deltaTime reçu en ms)
 *  Ne jamais supposer 60 fps. Ne jamais utiliser Date.now() pour animer :
 *  utiliser FRAME.time (secondes de temps de jeu, gelé en pause et en hitstop).
 *
 *  DÉMARRAGE
 *  ---------
 *  La boucle démarre IMMÉDIATEMENT. L'audio s'initialise en tâche de fond et
 *  ne bloque plus rien (l'ancien sondage de 2112 chemins + les 7 s d'attente
 *  ont été supprimés).
 * ========================================================================== */

// `ctx` est déclaré avec `let` : NEON le réaffecte temporairement vers le
// buffer émissif pendant la passe de scène. Tout le code de dessin existant
// continue donc de fonctionner sans être modifié.
const canvas = document.getElementById('gameCanvas');
let ctx = canvas.getContext('2d', { alpha: false });

let lastTime = 0;
let loopRunning = false;

/** Réinitialise l'horloge sans toucher à l'état de jeu.
 *  Appelée au retour d'onglet / de focus. */
function resetClock() {
  lastTime = 0;
}

function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);

  if (!lastTime) { lastTime = timestamp; return; }

  // --- temps réel, clampé ---------------------------------------------------
  let rawDtMs = timestamp - lastTime;
  lastTime = timestamp;
  if (!(rawDtMs > 0)) rawDtMs = 0;
  if (rawDtMs > FRAME.maxFrameMs) rawDtMs = FRAME.maxFrameMs;

  FRAME.rawDtMs = rawDtMs;
  FRAME.rawDt = rawDtMs / 1000;
  FRAME.realTime += FRAME.rawDt;
  FRAME.frame++;
  if (rawDtMs > 0) FRAME.fps = FRAME.fps * 0.92 + (1000 / rawDtMs) * 0.08;

  // --- temps de jeu (0 pendant un hitstop) ---------------------------------
  let dtMs = JUICE.step(rawDtMs);
  FRAME.frozen = JUICE.isFrozen();

  // La pause gèle le temps de jeu, SAUF pendant une transition de stage :
  // stages.js met isPaused à true pour figer le gameplay, mais la transition
  // elle-même doit continuer d'avancer avec le vrai delta.
  const transitioning = !!(typeof stageSystem !== 'undefined' && stageSystem && stageSystem.transitionActive);
  if (isPaused && !transitioning) dtMs = 0;

  FRAME.dtMs = dtMs;
  FRAME.dt = dtMs / 1000;
  FRAME.time += FRAME.dt;

  try { update(dtMs); } catch (e) { console.error('update() a levé :', e); }
  try { draw(); } catch (e) { console.error('draw() a levé :', e); }

  NEON.tick();
}

/* -----------------------------------------------------------------------------
 *  CYCLE DE VIE DE LA PAGE
 *  Plus de watchdog : on gère explicitement l'arrière-plan et la perte de focus.
 * -------------------------------------------------------------------------- */
function releaseAllKeys() {
  try {
    if (typeof keys !== 'undefined' && keys) {
      for (const k in keys) keys[k] = false;
    }
  } catch (e) { /* ignoré */ }
}

function handleHidden() {
  FRAME.hidden = true;
  releaseAllKeys();
  if (typeof pauseForVisibility === 'function') pauseForVisibility();
}

function handleVisible() {
  FRAME.hidden = false;
  resetClock();                       // l'horloge repart de zéro, l'état est intact
  if (typeof resumeFromVisibility === 'function') resumeFromVisibility();
}

function installLifecycleHandlers() {
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) handleHidden(); else handleVisible();
  });

  window.addEventListener('blur', function () {
    releaseAllKeys();
    resetClock();
  });

  window.addEventListener('focus', function () {
    resetClock();
  });

  window.addEventListener('pagehide', function () {
    if (typeof saveHighScore === 'function') saveHighScore();
  });

  window.addEventListener('beforeunload', function () {
    if (typeof saveHighScore === 'function') saveHighScore();
  });
}

/* -----------------------------------------------------------------------------
 *  AUDIO — initialisation NON BLOQUANTE
 *  Le jeu ne dépend plus de l'audio pour démarrer. Si le module audio expose
 *  une initialisation, on l'appelle et on continue immédiatement.
 * -------------------------------------------------------------------------- */
function bootAudio() {
  try {
    if (typeof initAudioLists === 'function') initAudioLists();
  } catch (e) {
    console.warn("Initialisation audio échouée (sans conséquence sur le jeu) :", e);
  }

  // audio.js a DÉJÀ lu (et écrit par défaut) 'soundEnabled' au chargement.
  // On ne relit ici que si la clé existe réellement : sinon un localStorage
  // indisponible ou une première visite couperaient le son sans raison.
  try {
    if (typeof audioConfig !== 'undefined' && audioConfig) {
      const raw = localStorage.getItem('soundEnabled');
      if (raw !== null) audioConfig.soundEnabled = (raw === 'true');
      if (typeof applyAudioSettings === 'function') applyAudioSettings();
    }
  } catch (e) { /* ignoré */ }

  // Synchroniser les curseurs de volume s'ils existent.
  try {
    const bind = function (id, valueId, value) {
      const el = document.getElementById(id);
      const lab = document.getElementById(valueId);
      if (el && typeof value === 'number') el.value = Math.round(value * 100);
      if (lab && typeof value === 'number') lab.textContent = Math.round(value * 100) + '%';
    };
    if (typeof audioConfig !== 'undefined' && audioConfig) {
      bind('musicVolume', 'musicVolumeValue', audioConfig.musicVolume);
      bind('narrationVolume', 'narrationVolumeValue', audioConfig.narrationVolume);
      bind('sfxVolume', 'sfxVolumeValue', audioConfig.sfxVolume);
      const a = document.getElementById('autoAdjustVolume');
      const f = document.getElementById('useFadeEffects');
      if (a) a.checked = !!audioConfig.autoAdjustVolume;
      if (f) f.checked = !!audioConfig.useFadeEffects;
    }
  } catch (e) { /* ignoré */ }
}

/* -----------------------------------------------------------------------------
 *  INITIALISATION
 * -------------------------------------------------------------------------- */
function init() {
  if (loopRunning) return;
  loopRunning = true;

  // Préférences
  try {
    GAME_CONFIG.showDebugInfo = localStorage.getItem('showDebugInfo') === 'true';
  } catch (e) { /* ignoré */ }
  try {
    highScore = Number(localStorage.getItem('highScore')) || 0;
  } catch (e) { /* ignoré */ }

  // Moteur de rendu néon (alloue ses buffers, puis resizeCanvas les redimensionne)
  NEON.init(canvas, ctx);

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', resizeCanvas);
  resizeCanvas();

  installLifecycleHandlers();

  // L'audio démarre en tâche de fond, APRÈS le premier rendu.
  requestAnimationFrame(function () { setTimeout(bootAudio, 0); });

  // Démarrage INSTANTANÉ de la boucle.
  requestAnimationFrame(gameLoop);
}

// Le canvas est déjà dans le DOM (les scripts sont en fin de <body>), donc on
// peut démarrer tout de suite ; 'load' sert de filet si le document n'est pas prêt.
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
