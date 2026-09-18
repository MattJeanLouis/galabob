/* =============================================================================
 *  galabob — BOUCLE DE JEU, COLLISIONS, PIPELINE DE RENDU
 * -----------------------------------------------------------------------------
 *  Dépendances : config.js, palette.js, utils.js (JUICE), neon.js (NEON),
 *                et les modules d'entités.
 *
 *  Le watchdog anti-freeze a été SUPPRIMÉ : il ne pouvait pas détecter un vrai
 *  blocage (il tournait sur le même thread) mais garantissait un faux positif
 *  au retour d'onglet, qui corrompait la partie. Le cycle de vie est désormais
 *  géré proprement dans main.js (visibilitychange / blur).
 * ========================================================================== */

// Variables d'état du jeu
let gameState = "menu";     // "menu" | "playing" | "shop" | "transit" | "gameover" | "settings"
let isPaused = false;       // pause demandée par le joueur (touche P)
let autoPaused = false;     // pause automatique (onglet caché / perte de focus)
let assaultShopFireArmed = true; // exige un relâchement après le dernier kill

// Minuterie de fin de stage (en ms de temps de jeu, remplace un setTimeout)
let pendingTransitionMs = -1;
// Fenêtre de ramassage des bonus de fin de stage (ms de temps de jeu)
let pendingCollectMs = -1;
// Instant (temps de jeu) où la fenêtre courante s'est ouverte : garde-fou
let collectStartedAt = 0;

/* -----------------------------------------------------------------------------
 *  VUE DES STAGES 2D — « à plat » (historique) ou « en perspective ».
 *  Les deux regardent le MÊME stage et la MÊME simulation : seule la caméra
 *  change. La bascule est donc instantanée, sans risque pour l'équilibrage, et
 *  les hitboxes comme la progression restent rigoureusement identiques.
 * -------------------------------------------------------------------------- */
let viewMode = 'flat';          // 'flat' | 'perspective'
let viewBlend = 0;              // 0 = à plat, 1 = perspective (animation en cours)
const VIEW_BLEND_MS = 420;      // durée de la bascule

/** Bascule de point de vue. Refusée si la vue en perspective est indisponible. */
function toggleViewMode() {
  const wantsPerspective = viewMode !== 'perspective';
  if (wantsPerspective && typeof GAME3D !== 'undefined' &&
      typeof GAME3D.isAvailable === 'function' && !GAME3D.isAvailable()) {
    return false;
  }
  viewMode = wantsPerspective ? 'perspective' : 'flat';
  // Le choix est MÉMORISÉ : le joueur retrouve sa caméra d'une partie à l'autre.
  try {
    const runtime = _runtime();
    if (runtime && runtime.profile && typeof runtime.profile.setViewMode === 'function') {
      runtime.profile.setViewMode(viewMode);
    }
  } catch (e) { /* le profil ne doit jamais bloquer une bascule */ }
  try { gameEvent('uiSelect', { id: 'view' }); } catch (e) { /* audio facultatif */ }
  try { JUICE.punch(0.012); JUICE.flash(PALETTE.get('player').glow, 160, 0.18); }
  catch (e) { /* retour sensoriel facultatif */ }
  // Le décor s'atténue tout de suite : l'animation ne doit pas le laisser
  // éclairer la scène pendant la bascule.
  updateViewBlend(0);
  return true;
}

/** Avance l'animation de bascule en temps RÉEL (jamais gelée par un hitstop). */
function updateViewBlend(realDtMs) {
  const target = viewMode === 'perspective' ? 1 : 0;
  if (viewBlend === target) return;
  const step = Math.max(0, Number(realDtMs) || 0) / VIEW_BLEND_MS;
  viewBlend = target > viewBlend
    ? Math.min(target, viewBlend + step)
    : Math.max(target, viewBlend - step);
  // Le décor céleste s'atténue progressivement : réglé pour la vue à plat, il
  // devenait un aplat laiteux dès qu'on regardait l'horizon.
  if (typeof BACKDROP !== 'undefined' && BACKDROP && typeof BACKDROP.setViewDim === 'function') {
    try { BACKDROP.setViewDim(1 - viewBlend); } catch (e) { /* décor facultatif */ }
  }
}

/** Petit pont de commande, sur le modèle de `window.GALABOB` : il rend la
 *  bascule pilotable au clavier, depuis la console, et par les tests. */
window.GALABOB_VIEW = {
  toggle: () => toggleViewMode(),
  perspective: () => {
    // On n'active pas une vue dont le rendu est indisponible : l'écran
    // resterait vide. `toggleViewMode` porte déjà ce garde-fou.
    viewMode = 'flat'; viewBlend = 0;
    return toggleViewMode();
  },
  flat: () => { viewMode = 'flat'; viewBlend = 0; updateViewBlend(0); },
  state: () => ({ mode: viewMode, blend: viewBlend }),
  /** Positionne le fondu de bascule (0 = à plat, 1 = perspective). Sert à
   *  capturer un instant précis de l'animation — mise au point et vignettes. */
  blend: (v) => { viewBlend = Math.max(0, Math.min(1, Number(v) || 0)); updateViewBlend(0); return viewBlend; },
  snapshot: () => stageSnapshot()
};
let sectorTransitPending = false;
let sectorTransitPreview = false;
let environmentalHazardTimer = 16000;

/* -----------------------------------------------------------------------------
 *  RUNTIME MODERNE — pont temporaire pendant la migration des scripts globaux
 * -------------------------------------------------------------------------- */
function _runtime() {
  return (typeof window !== 'undefined' && window.GALABOB) ? window.GALABOB : null;
}

function _combo() {
  const runtime = _runtime();
  return runtime && runtime.combo ? runtime.combo : null;
}

function _gameRandom() {
  const runtime = _runtime();
  return runtime && runtime.random ? runtime.random.next() : Math.random();
}

function _enforceEntityBudgets() {
  const runtime = _runtime();
  if (!runtime || !runtime.entityBudget) return;
  const budget = runtime.entityBudget;
  budget.enforce('explosions', explosions);
  budget.enforce('powerUps', powerUps);
  if (typeof debris !== 'undefined') budget.enforce('debris', debris);
  if (typeof scorePopups !== 'undefined') budget.enforce('scorePopups', scorePopups);
  if (typeof powerUpPickups !== 'undefined') budget.enforce('powerUpPickups', powerUpPickups);
  if (typeof multiplierSparks !== 'undefined') budget.enforce('multiplierSparks', multiplierSparks);
  if (typeof bombWaves !== 'undefined') budget.enforce('bombWaves', bombWaves);
}

function _randomPowerUpsEnabled() {
  const runtime = _runtime();
  const mode = runtime && runtime.modes ? runtime.modes.current() : null;
  return !mode || mode.randomPowerUps !== false;
}

function _syncLegacyCombo(tracker) {
  if (!tracker) return;
  comboCount = tracker.count;
  comboTimer = tracker.remainingMs;
}

function _modeCall(hook, payload) {
  const runtime = _runtime();
  if (!runtime || !runtime.modes) return undefined;
  try {
    return runtime.modes.call(hook, payload);
  } catch (error) {
    console.error('Mode de jeu, hook ' + hook + ' :', error);
    return undefined;
  }
}

function _selectedShip() {
  const runtime = _runtime();
  if (!runtime || !runtime.ships || !runtime.profile) return null;
  return runtime.ships.get(runtime.profile.data.selectedShip);
}

function _applySelectedShip() {
  const ship = _selectedShip();
  player.shipId = ship ? ship.id : 'classic';
  player.shipStats = ship ? ship.stats : {
    speedMultiplier: 1,
    fireRateMultiplier: 1,
    hitboxMultiplier: 1
  };
}

/* -----------------------------------------------------------------------------
 *  PONT ÉVÉNEMENTIEL — bruitages
 *  game.js n'appelle JAMAIS directement une fonction audio. Il émet un
 *  événement nommé. Le module audio n'a qu'à définir :
 *      SFX.play(name, data)
 *  Événements émis par game.js :
 *      'enemyHit'   {type}            'enemyKill'  {type, combo, points}
 *      'ramKill'    {type}            'playerHit'  {lives}
 *      'playerDeath'{}                'gameOver'   {score, stage}
 *      'stageClear' {stage}           'stageStart' {stage}
 *      'comboUp'    {combo}           'gameStart'  {}
 * -------------------------------------------------------------------------- */
function gameEvent(name, data) {
  try {
    if (typeof SFX !== 'undefined' && SFX && typeof SFX.play === 'function') {
      SFX.play(name, data || {});
    }
  } catch (e) { /* jamais bloquant */ }
}

/* -----------------------------------------------------------------------------
 *  SAUVEGARDE DU MEILLEUR SCORE
 *  Appelée à chaque game over, à la mise en arrière-plan et à la fermeture,
 *  et plus seulement au démarrage d'une nouvelle partie.
 * -------------------------------------------------------------------------- */
function saveHighScore() {
  try {
    highScore = Number(highScore) || 0;
    if (score > highScore) highScore = score;
    localStorage.setItem('highScore', String(highScore));
  } catch (e) { /* localStorage indisponible */ }

  const runtime = _runtime();
  const mode = runtime && runtime.modes ? runtime.modes.current() : null;
  if (runtime && runtime.profile && mode) {
    // Le record du mode ne prend que le score de la partie en cours : la globale
    // `highScore` est toutes-catégories et contaminait le mode sélectionné au
    // menu avec le record du mode précédent.
    const saved = runtime.profile.mode(mode.id) || {};
    runtime.profile.updateMode(mode.id, {
      ...saved,
      highScore: Math.max(Number(saved.highScore) || 0, Number(score) || 0)
    });
  }
}

/* -----------------------------------------------------------------------------
 *  APPLICATION DU TEMPO AUX MODULES QUI NE LE LISENT PAS ENCORE
 *  Permet d'imposer les nouvelles durées sans modifier stages.js.
 * -------------------------------------------------------------------------- */
function applyTempoToLegacyModules() {
  try {
    if (typeof stageSystem !== 'undefined' && stageSystem) {
      stageSystem.transitionDuration = TEMPO.STAGE_TRANSITION_MS;
    }
  } catch (e) { /* ignoré */ }
}

/* -----------------------------------------------------------------------------
 *  HITBOX JOUEUR
 *  Toutes les collisions QUI BLESSENT le joueur utilisent un petit carré centré
 *  sur le vaisseau (façon Ikaruga), pas l'AABB pleine taille du sprite.
 *  Les collisions BÉNÉFIQUES (ramassage de power-up) gardent l'AABB complète.
 *
 *  Lisible par tous les modules :
 *      player.hitbox         -> {x, y, width, height}, rafraîchi chaque frame
 *      getPlayerHitbox()     -> le même objet (à ne pas conserver, il est muté)
 *      player.invulnerable   -> bool
 *      player.iframeTimer    -> ms restantes
 *      player.blink          -> bool, true une frame sur deux pendant les i-frames
 *      player.respawning     -> bool
 * -------------------------------------------------------------------------- */
const _playerHitbox = { x: 0, y: 0, width: TEMPO.PLAYER_HITBOX, height: TEMPO.PLAYER_HITBOX };

function getPlayerHitbox() {
  const hitboxMultiplier = player && player.shipStats
    ? Number(player.shipStats.hitboxMultiplier) || 1
    : 1;
  const s = TEMPO.PLAYER_HITBOX * hitboxMultiplier;
  _playerHitbox.width = s;
  _playerHitbox.height = s;
  _playerHitbox.x = player.x + player.width / 2 - s / 2;
  _playerHitbox.y = player.y + player.height / 2 - s / 2;
  return _playerHitbox;
}

/** Remet le joueur dans un état propre (nouvelle partie / respawn). */
function resetPlayerState(fullReset) {
  player.vx = 0;
  player.vy = 0;
  player.invulnerable = false;
  player.iframeTimer = 0;
  player.iframeDuration = TEMPO.PLAYER_IFRAME_MS;
  player.respawning = false;
  player.respawnTimer = 0;
  player.blink = false;
  player.hitbox = getPlayerHitbox();
  if (player.handlesOwnBlink === undefined) player.handlesOwnBlink = false;
  if (player.usesPxPerSecond === undefined) player.usesPxPerSecond = false;
  if (fullReset) {
    player.x = CANVAS_WIDTH / 2 - player.width / 2;
    player.y = CANVAS_HEIGHT - player.height - 48;
  }
  // Mémoire du ruban de réacteur : oubliée à toute téléportation, sinon le
  // raccord relierait l'ancienne position à la nouvelle d'un trait en travers.
  player._trailL = null;
  player._trailR = null;
}

/** Met à jour i-frames / respawn / clignotement / hitbox. dtMs en ms de jeu. */
function updatePlayerState(dtMs) {
  if (player.iframeTimer > 0) {
    player.iframeTimer -= dtMs;
    if (player.iframeTimer <= 0) {
      player.iframeTimer = 0;
      player.invulnerable = false;
      player.blink = false;
    } else {
      player.invulnerable = true;
      // Clignotement accéléré vers la fin, pour signaler la reprise du danger.
      const left = player.iframeTimer;
      const period = left < 450 ? TEMPO.PLAYER_BLINK_MS * 0.6 : TEMPO.PLAYER_BLINK_MS;
      player.blink = (Math.floor(left / period) % 2) === 0;
    }
  }

  if (player.respawnTimer > 0) {
    player.respawnTimer -= dtMs;
    if (player.respawnTimer <= 0) {
      player.respawnTimer = 0;
      player.respawning = false;
    }
  }

  player.hitbox = getPlayerHitbox();
}

/* -----------------------------------------------------------------------------
 *  INITIALISATION / RÉINITIALISATION DE LA PARTIE
 * -------------------------------------------------------------------------- */
function initGame() {
  // Le score de la partie précédente a déjà été sauvegardé (game over ou
  // retour au menu) ; le refaire ici l'écrirait dans le mode choisi ENTRE-TEMPS.
  assaultShopFireArmed = true;

  const runtime = _runtime();
  const runSeed = runtime && typeof runtime.newRunSeed === 'function'
    ? runtime.newRunSeed()
    : null;

  score = 0;

  // Point de vue mémorisé : on le restaure sans animation (le joueur n'a pas
  // demandé de bascule), et seulement si le rendu est disponible.
  try {
    const runtime = _runtime();
    const pref = runtime && runtime.profile ? runtime.profile.data.viewMode : null;
    const dispo = typeof GAME3D !== 'undefined' && typeof GAME3D.isAvailable === 'function'
      ? GAME3D.isAvailable() : false;
    viewMode = (pref === 'perspective' && dispo) ? 'perspective' : 'flat';
    viewBlend = viewMode === 'perspective' ? 1 : 0;
    updateViewBlend(0);
  } catch (e) { viewMode = 'flat'; viewBlend = 0; }

  const combo = _combo();
  if (combo) {
    combo.reset();
    _syncLegacyCombo(combo);
  } else {
    comboCount = 0;
    comboTimer = 0;
  }

  enemySpeed = 1;
  enemyDirection = 1;
  enemyShotTimer = 0;

  player.lives = 3;
  // Les TROIS emplacements de power-up (arme / bouclier / modificateurs) et les
  // projectiles spéciaux repartent de zéro : c'est player.js qui sait tout ça.
  if (typeof resetPlayerPowerState === 'function') {
    resetPlayerPowerState();
  } else {
    player.weapon = 'normal';
    player.weaponTimer = 0;
    player.weaponLevel = 1;
  }
  player.fireCooldown = 0;
  _applySelectedShip();
  resetPlayerState(true);

  playerBullets = [];
  enemyBullets = [];
  explosions = [];
  powerUps = [];
  if (typeof bombWaves !== 'undefined' && bombWaves) bombWaves.length = 0;
  if (typeof powerUpPickups !== 'undefined' && powerUpPickups) powerUpPickups.length = 0;
  if (typeof multiplierSparks !== 'undefined' && multiplierSparks) multiplierSparks.length = 0;
  if (typeof debris !== 'undefined') debris = [];
  if (typeof scorePopups !== 'undefined') scorePopups = [];

  pendingTransitionMs = -1;
  pendingCollectMs = -1;
  sectorTransitPending = false;
  sectorTransitPreview = false;
  environmentalHazardTimer = 16000;
  lastReinforcementAt = -1e9;
  isPaused = false;
  autoPaused = false;

  JUICE.reset();
  // Le boss d'une partie précédente ne doit rien laisser derrière lui (il sème
  // ses propres projectiles dans enemyBullets et les balaie lui-même).
  if (typeof BOSS !== 'undefined') { try { BOSS.reset(); } catch (e) { /* ignoré */ } }
  if (typeof TRANSIT !== 'undefined') { try { TRANSIT.reset(); } catch (e) { /* ignoré */ } }
  // Le ciel EMPRUNTE RENDER_CONFIG.aberration pendant une tempête magnétique :
  // sans ce reset, mourir en pleine tempête la laisserait montée dans le menu.
  if (typeof BACKDROP !== 'undefined') { try { BACKDROP.reset(); } catch (e) { /* ignoré */ } }
  if (typeof resetHUD === 'function') resetHUD();
  if (typeof clearEffects === 'function') { try { clearEffects(); } catch (e) { /* ignoré */ } }
  applyTempoToLegacyModules();

  // Système de stages
  stageSystem.currentStage = 1;
  stageSystem.loopCount = 0;          // la boucle infinie repart de la première
  stageSystem.resetStageStats();
  stageSystem.initStage();

  if (typeof stars === 'undefined' || !stars || stars.length === 0) {
    if (typeof createStars === 'function') createStars();
  }

  gameState = "playing";
  updatePlayerSpeed();

  _modeCall('startRun', {
    stage: stageSystem.currentStage,
    loop: stageSystem.loopCount,
    seed: runSeed
  });
  _modeCall('startStage', {
    stage: stageSystem.currentStage,
    loop: stageSystem.loopCount,
    boss: stageSystem.isBossStage()
  });

  JUICE.preset('stageStart');
  gameEvent('gameStart', {});
  gameEvent('stageStart', { stage: stageSystem.currentStage });
}

/** Vitesse du joueur en fonction du score.
 *  Unité : px/s si player.usesPxPerSecond, sinon px/frame (compat 60 fps). */
function updatePlayerSpeed() {
  const mult = Math.min(
    1 + (score * TEMPO.PLAYER_SPEED_SCORE_STEP),
    TEMPO.PLAYER_SPEED_MAX_MULT
  );
  const shipMult = player.shipStats ? Number(player.shipStats.speedMultiplier) || 1 : 1;
  player.speed = player.usesPxPerSecond
    ? TEMPO.PLAYER_SPEED * mult * shipMult
    : (TEMPO.PLAYER_SPEED / 60) * mult * shipMult;
}

/* -----------------------------------------------------------------------------
 *  BOUCLE DE MISE À JOUR
 *  @param {number} deltaTime  millisecondes de TEMPS DE JEU (== FRAME.dtMs).
 *                             Vaut 0 pendant un hitstop : tous les modules
 *                             doivent le supporter sans division ni NaN.
 * -------------------------------------------------------------------------- */
function update(deltaTime) {
  if (!(deltaTime >= 0)) deltaTime = 0;
  const dt = deltaTime / 1000;

  try {
    // Transition de stage : elle avance même si le reste est gelé.
    if (stageSystem.transitionActive) {
      stageSystem.updateTransition(deltaTime);
      return;
    }

    if (gameState === 'transit') {
      if (deltaTime === 0) return;
      if (typeof TRANSIT === 'undefined') {
        finishSectorTransit();
        return;
      }
      updatePlayerState(deltaTime);
      TRANSIT.update(deltaTime);
      _modeCall('updateTransit', deltaTime);
      // Même pipeline d'effets que les stages 2D : les ramassages, explosions,
      // débris et scores ne changent pas de langage pendant la poursuite.
      if (typeof updatePowerUpFeedback === 'function') updatePowerUpFeedback(deltaTime);
      updateExplosions(deltaTime);
      if (typeof updateDebris === 'function') updateDebris(deltaTime);
      if (typeof updateScorePopups === 'function') updateScorePopups(deltaTime);
      _enforceEntityBudgets();
      if (TRANSIT.isComplete()) finishSectorTransit();
      return;
    }

    // Fenêtre de ramassage de fin de stage. Tant qu'un bonus est à l'écran, la
    // fenêtre NE PEUT PAS expirer : elle est relancée dès qu'elle approche de
    // zéro. Le délai n'est donc pas une limite subie par le joueur, c'est le
    // temps laissé au champ pour se vider — et il ne repart que s'il reste
    // réellement quelque chose à ramasser (jamais pendant la transition).
    if (pendingCollectMs >= 0) {
      pendingCollectMs -= deltaTime;
      const champVide = (typeof powerUps === 'undefined' || !powerUps || powerUps.length === 0);
      // Garde-fou : le temps de GÉNÉROSITÉ est plafonné, quoi qu'il arrive.
      const epuise = (typeof FRAME !== 'undefined' && FRAME)
        ? (FRAME.time - collectStartedAt) * 1000 >= TEMPO.STAGE_COLLECT_MAX_MS
        : false;

      if (champVide || epuise) {
        pendingCollectMs = -1;
        completePowerUpCollection();
      } else if (pendingCollectMs <= 0) {
        // Un bonus attend encore : on lui redonne le temps d'arriver au lieu
        // de le perdre par expiration. Vérifié en jeu : deux bonus en vol en
        // fin de stage arrivent tous les deux avant la fermeture.
        pendingCollectMs = TEMPO.STAGE_COLLECT_MS;
      }
    }

    // Minuterie de fin de stage (remplace l'ancien setTimeout)
    if (pendingTransitionMs >= 0 && consumePowerUpCollection()) {
      // Le ramassage vient de se terminer : on repart sur le délai normal pour
      // que l'écran de transition s'affiche réellement après les bonus.
      pendingTransitionMs = TEMPO.STAGE_COMPLETE_DELAY_MS;
    }
    if (pendingTransitionMs >= 0) {
      pendingTransitionMs -= deltaTime;
      if (pendingTransitionMs <= 0) {
        pendingTransitionMs = -1;
        try {
          beginInterstageFlow();
        } catch (e) {
          console.error("Échec du démarrage de la transition, passage forcé au stage suivant", e);
          try { stageSystem.forceNextStage(); } catch (e2) { softResetStage(); }
        }
      }
    }

    if (gameState === "shop") {
      if (deltaTime === 0) return;
      if (!assaultShopFireArmed && typeof INPUT !== 'undefined' && !INPUT.shoot()) {
        assaultShopFireArmed = true;
      }
      updatePlayerSpeed();
      updatePlayerState(deltaTime);
      updatePlayer(deltaTime);
      updatePlayerBullets(deltaTime);
      _modeCall('updateShop', deltaTime);
      if (typeof updateAssaultShopRoom === 'function') updateAssaultShopRoom(deltaTime);
      updateExplosions(deltaTime);
      if (typeof updateDebris === 'function') updateDebris(deltaTime);
      if (typeof updateScorePopups === 'function') updateScorePopups(deltaTime);
      if (typeof updateStars === 'function') updateStars(deltaTime);
      _enforceEntityBudgets();
      return;
    }

    if (gameState !== "playing" || isPaused) return;
    if (deltaTime === 0) return;   // hitstop : la logique est gelée

    updatePlayerSpeed();
    updatePlayerState(deltaTime);

    // Effets / caméra hérités (JUICE gère déjà le vrai screenshake)
    if (typeof updateScreenShake === 'function') updateScreenShake(deltaTime);

    updatePlayer(deltaTime);
    updatePlayerBullets(deltaTime);

    // Le RALENTI (power-up) ne ralentit QUE la menace : le joueur garde son
    // temps plein. playerTimeScale() vaut 1 hors bullet-time.
    const enemyDt = deltaTime * (typeof playerTimeScale === 'function' ? playerTimeScale() : 1);
    updateEnemyBullets(enemyDt);
    updateEnemies(enemyDt);

    // Obstacles rares, jamais pendant les deux stages d'apprentissage ni un boss.
    if (stageSystem.currentStage >= 3 &&
        !(typeof BOSS !== 'undefined' && BOSS.isActive && BOSS.isActive())) {
      environmentalHazardTimer -= enemyDt;
      if (environmentalHazardTimer <= 0 && typeof spawnAsteroidHazard === 'function') {
        const amount = stageSystem.currentStage >= 12 && _gameRandom() < 0.35 ? 2 : 1;
        if (spawnAsteroidHazard(amount)) {
          environmentalHazardTimer = 26000 + _gameRandom() * 16000;
        } else {
          environmentalHazardTimer = 4000;
        }
      }
    }

    // BOSS — attend des SECONDES. Le ralenti s'applique à lui comme au reste
    // de la menace. dt nul (hitstop) : le module gèle sa logique tout seul.
    if (typeof BOSS !== 'undefined' && BOSS.isActive && BOSS.isActive()) {
      try { BOSS.update(enemyDt / 1000); } catch (e) { console.error('BOSS.update :', e); }
    }

    updatePowerUps(deltaTime);

    updateExplosions(deltaTime);
    if (typeof updateDebris === 'function') updateDebris(deltaTime);
    if (typeof updateScorePopups === 'function') updateScorePopups(deltaTime);
    if (typeof updateStars === 'function') updateStars(deltaTime);
    _enforceEntityBudgets();

    // Expiration du combo : temps de JEU uniquement. Un hitstop ou une pause
    // fournit un delta nul et ne consomme donc plus la chaine.
    const combo = _combo();
    if (combo) {
      combo.step(deltaTime);
      _syncLegacyCombo(combo);
    } else if (comboCount > 0) {
      comboTimer = Math.max(0, comboTimer - deltaTime);
      if (comboTimer === 0) comboCount = 0;
    }

    _modeCall('update', deltaTime);

    processGameLogic();
  } catch (e) {
    console.error("Erreur critique dans la boucle de mise à jour :", e);
  }
}

/** Collisions + progression. */
function processGameLogic() {
  try {
    processPlayerBulletCollisions();
    processBodyCollisions();
    processEnemyBulletCollisions();

    const bossEnCours = (typeof BOSS !== 'undefined' && BOSS.isActive && BOSS.isActive());

    // Boss abattu (l'agonie est TERMINÉE) : c'est LUI qui clôt le stage, pas le
    // compteur d'ennemis. Le reset est indispensable : `isDefeated()` reste vrai
    // jusqu'au prochain spawn, et sans lui le stage SUIVANT se terminerait seul.
    if (typeof BOSS !== 'undefined' && BOSS.isDefeated && BOSS.isDefeated() &&
        !stageSystem.stageCompleted) {
      lacherButinDeBoss();
      try { BOSS.reset(); } catch (e) { /* ignoré */ }
      handleStageCompletion();
    } else if (!bossEnCours &&
               stageSystem.enemiesDefeated >= stageSystem.enemiesPerStage &&
               !stageSystem.stageCompleted) {
      handleStageCompletion();
    }

    if (!stageSystem.stageCompleted) {
      handleNewWave();
    }
  } catch (e) {
    console.error("Erreur dans processGameLogic :", e);
  }
}

/* -----------------------------------------------------------------------------
 *  MORT D'UN ENNEMI — chemin unique, partagé par les balles et le corps-à-corps
 *
 *  @param {number} index  position dans `enemies`
 *  @param {string} cause  'bullet' | 'ram'
 *  @returns {number} points marqués
 * -------------------------------------------------------------------------- */
function killEnemyAt(index, cause) {
  const e = enemies[index];
  if (!e || e.isDeleted) return 0;

  e.isDeleted = true;
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height / 2;
  const type = e.type || 'normal';

  // Les obstacles appartiennent au décor jouable : aucun score, crédit, combo,
  // drop ni avancement de stage quand le joueur en brise un.
  if (e.isHazard) {
    if (typeof createExplosion === 'function') {
      try { createExplosion(cx, cy, 'asteroid', { scale: 1.35 }); } catch (err) { /* décor non bloquant */ }
    }
    if (typeof createDebris === 'function') {
      try { createDebris(cx, cy, PALETTE.enemy('asteroid').burst, 'asteroid'); } catch (err) { /* ignoré */ }
    }
    if (typeof BACKDROP !== 'undefined') {
      try { BACKDROP.pulse(PALETTE.enemy('asteroid').burst, 0.55, cx, cy); } catch (err) { /* ignoré */ }
    }
    enemies.splice(index, 1);
    return 0;
  }

  // --- COMBO : compte les KILLS, jamais les impacts de balle ---------------
  const combo = _combo();
  if (combo) {
    comboCount = combo.registerKill();
    comboTimer = combo.remainingMs;
  } else {
    comboCount = comboCount > 0 && comboTimer > 0 ? comboCount + 1 : 1;
    comboTimer = TEMPO.COMBO_WINDOW_MS;
  }
  if (comboCount > 1) gameEvent('comboUp', { combo: comboCount });

  const multiplier = Math.min(comboCount, TEMPO.COMBO_MAX);
  const basePoints = (typeof e.points === 'number' && e.points > 0)
    ? e.points
    : (type === 'shooter' ? 20 : type === 'fast' ? 15 : 10);
  // MULTIPLICATEUR (power-up) : ×2 sur les points, chaîne de combo comprise.
  const scoreMult = (typeof playerScoreMultiplier === 'function') ? playerScoreMultiplier() : 1;
  const points = basePoints * multiplier * scoreMult;

  const modeReward = e.isBonus
    ? _modeCall('bonusEnemyKilled', {
        type: type, cause: cause, basePoints: basePoints, points: points,
        roll: _gameRandom(), pick: _gameRandom()
      })
    : _modeCall('enemyKilled', {
        type: type, cause: cause, basePoints: basePoints, points: points
      });

  score += points;
  if (stageSystem.stageStats) {
    stageSystem.stageStats.score += points;
    if (comboCount > stageSystem.stageStats.combo) stageSystem.stageStats.combo = comboCount;
  }
  if (!e.isBonus && !e.isHazard) stageSystem.enemiesDefeated++;

  if (modeReward && modeReward.credits > 0 && typeof scorePopups !== 'undefined') {
    scorePopups.push({
      x: cx + 34, y: e.y + 28, points: 0,
      text: '+' + modeReward.credits + ' CR', lifetime: 1.15, dy: -0.85,
      color: 'combo'
    });
  }

  // --- Effets ---------------------------------------------------------------
  // createScorePopup reçoit les points de BASE et le multiplicateur : c'est lui
  // qui multiplie pour l'affichage. Ne pas pré-multiplier (double comptage).
  if (typeof createScorePopup === 'function') {
    try { createScorePopup(cx, e.y, basePoints, multiplier); } catch (err) { /* ignoré */ }
  }
  const enemyTriplet = e.isBonus ? PALETTE.get('#ffee55') : PALETTE.enemy(type);
  if (typeof createDebris === 'function') {
    try { createDebris(cx, cy, enemyTriplet.burst, type); } catch (err) { /* ignoré */ }
  }
  if (typeof createExplosion === 'function') {
    // L'ampleur suit l'IMPORTANCE du kill, pas seulement le type d'ennemi.
    const fxScale = (cause === 'ram') ? 1.5 : (multiplier >= 4 ? 1.25 : 1);
    try { createExplosion(cx, cy, type, { scale: fxScale }); } catch (err) { /* ignoré */ }
  }

  // --- Le CIEL réagit : une onde de couleur part de l'explosion -------------
  if (typeof BACKDROP !== 'undefined') {
    const onde = (cause === 'ram') ? 0.85 : Math.min(0.9, 0.40 + multiplier * 0.06);
    try { BACKDROP.pulse(enemyTriplet.burst, onde, cx, cy); }
    catch (err) { /* le fond ne casse jamais une frame */ }
  }

  if (cause === 'ram') {
    JUICE.preset('ramKill');
    gameEvent('ramKill', { type: type });
  } else if (multiplier >= 4) {
    JUICE.preset('bigKill');
    gameEvent('enemyKill', { type: type, combo: multiplier, points: points });
  } else {
    JUICE.preset('enemyKill');
    gameEvent('enemyKill', { type: type, combo: multiplier, points: points });
  }

  // --- Butin ----------------------------------------------------------------
  const customDrop = e.isBonus
    ? (modeReward && modeReward.powerUp)
    : _modeCall('rollEnemyDrop', { enemy: e, roll: _gameRandom(), pick: _gameRandom() });
  if (customDrop && typeof createPowerUp === 'function') {
    try {
      powerUps.push(createPowerUp(cx - 10, e.y, customDrop));
    } catch (err) { /* ignoré */ }
  } else if (!e.isBonus && customDrop === undefined && _randomPowerUpsEnabled() &&
      _gameRandom() < TEMPO.POWERUP_DROP_CHANCE && typeof createPowerUp === 'function') {
    try {
      powerUps.push(createPowerUp(cx - 10, e.y));
    } catch (err) { /* ignoré */ }
  }

  enemies.splice(index, 1);
  return points;
}

/* -----------------------------------------------------------------------------
 *  DÉGÂTS AU JOUEUR — point d'entrée unique (i-frames, explosion, game over)
 *  Utilisable depuis n'importe quel module : damagePlayer('bullet' | 'ram' | …)
 * -------------------------------------------------------------------------- */
function damagePlayer(source) {
  if (!player || player.invulnerable || gameState !== 'playing') return false;

  // BOUCLIER (power-up) : une charge absorbe le coup à la place d'une vie.
  if ((player.shield | 0) > 0 && typeof consumePlayerShield === 'function') {
    if (consumePlayerShield(source)) return true;
  }

  const cx = player.x + player.width / 2;
  const cy = player.y + player.height / 2;

  player.lives -= 1;
  player.invulnerable = true;
  player.iframeTimer = TEMPO.PLAYER_IFRAME_MS;
  player.iframeDuration = TEMPO.PLAYER_IFRAME_MS;
  player.respawning = true;
  player.respawnTimer = TEMPO.PLAYER_RESPAWN_MS;
  player.weapon = 'normal';
  player.weaponTimer = 0;
  player.weaponLevel = 1;

  if (typeof createExplosion === 'function') {
    try { createExplosion(cx, cy, 'player'); } catch (e) { /* ignoré */ }
  }
  if (typeof createDebris === 'function') {
    try { createDebris(cx, cy, PALETTE.get('player').burst, 'player'); } catch (e) { /* ignoré */ }
  }

  const combo = _combo();
  if (combo) {
    combo.reset();
    _syncLegacyCombo(combo);
  } else {
    comboCount = 0;
    comboTimer = 0;
  }

  if (player.lives <= 0) {
    JUICE.preset('playerDeath');
    if (typeof BACKDROP !== 'undefined') {
      try { BACKDROP.pulse('playerDeath', 1.5); } catch (e) { /* ignoré */ }
    }
    gameEvent('playerDeath', {});
    triggerGameOver();
  } else {
    JUICE.preset('playerHit');
    if (typeof BACKDROP !== 'undefined') {
      try { BACKDROP.pulse('playerDeath', 1.2); } catch (e) { /* ignoré */ }
    }
    gameEvent('playerHit', { lives: player.lives, source: source || 'unknown' });
    // Repli au centre bas : on ne veut pas réapparaître collé à un ennemi.
    player.x = CANVAS_WIDTH / 2 - player.width / 2;
    player.y = CANVAS_HEIGHT - player.height - 48;
  }
  return true;
}

/* -----------------------------------------------------------------------------
 *  RETOUR AU MENU (Échap, bouton QUITTER, MENU PRINCIPAL)
 *  Sans cette remise à zéro, la minuterie d'inter-stage continuait de courir
 *  sous le menu et relançait la partie toute seule ; le boss, la poursuite et
 *  le ciel du secteur restaient aussi actifs derrière l'écran-titre.
 * -------------------------------------------------------------------------- */
function returnToMenu() {
  if (gameState === 'playing' || gameState === 'transit' || gameState === 'shop') saveHighScore();
  score = 0;
  gameState = "menu";
  isPaused = false;
  autoPaused = false;
  pendingTransitionMs = -1;
  pendingCollectMs = -1;
  resetPowerUpCollection();
  sectorTransitPending = false;
  sectorTransitPreview = false;
  stageSystem.transitionActive = false;
  JUICE.reset();
  if (typeof BOSS !== 'undefined') { try { BOSS.reset(); } catch (e) { /* ignoré */ } }
  if (typeof TRANSIT !== 'undefined') { try { TRANSIT.reset(); } catch (e) { /* ignoré */ } }
  if (typeof BACKDROP !== 'undefined') { try { BACKDROP.reset(); } catch (e) { /* ignoré */ } }
  if (typeof clearEffects === 'function') { try { clearEffects(); } catch (e) { /* ignoré */ } }
}

function triggerGameOver() {
  gameState = "gameover";
  isPaused = false;
  pendingTransitionMs = -1;
  saveHighScore();
  JUICE.preset('gameOver');
  if (typeof BOSS !== 'undefined') { try { BOSS.reset(); } catch (e) { /* ignoré */ } }
  if (typeof BACKDROP !== 'undefined') { try { BACKDROP.reset(); } catch (e) { /* ignoré */ } }
  _modeCall('endRun', {
    score: score,
    stage: stageSystem.currentStage,
    loop: stageSystem.loopCount
  });
  gameEvent('gameOver', { score: score, stage: stageSystem.currentStage });
}

/* -----------------------------------------------------------------------------
 *  COLLISIONS
 * -------------------------------------------------------------------------- */

/** Projectiles du joueur contre ennemis. */
function processPlayerBulletCollisions() {
  try {
    for (let i = playerBullets.length - 1; i >= 0; i--) {
      const b = playerBullets[i];
      if (!b) { playerBullets.splice(i, 1); continue; }

      let hit = false;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (!e || e.isDeleted) continue;
        if (!rectIntersect(b, e)) continue;

        hit = true;
        e.hp -= (b.damage || 1);
        e.hitFlash = 90;                 // ms — lu par le module ennemis
        e.hitFlashMax = 90;              // dénominateur du fondu (enemies.js)
        e.lastHitX = b.x + (b.width || 0) / 2;
        e.lastHitY = b.y;

        if (e.hp <= 0) {
          killEnemyAt(j, 'bullet');
        } else {
          JUICE.preset('enemyHit');
          gameEvent('enemyHit', { type: e.type });
        }
        break;
      }

      // Le BOSS n'est PAS dans `enemies` (ni ses drones) : ses morts fausseraient
      // le compteur de fin de stage. Il a donc son propre test de collision.
      if (!hit && typeof BOSS !== 'undefined' && BOSS.isActive && BOSS.isActive()) {
        try {
          const cible = BOSS.hitTest(b);
          if (cible && BOSS.damage(b.damage || 1, b.x + (b.width || 0) / 2, b.y)) hit = true;
        } catch (e) { console.error('BOSS.hitTest/damage :', e); }
      }

      if (hit) playerBullets.splice(i, 1);
    }
  } catch (e) {
    console.error("Erreur dans processPlayerBulletCollisions :", e);
  }
}

/** CORPS-À-CORPS joueur <-> ennemi. Absent jusqu'ici : un ennemi qui plongeait
 *  sur le joueur le traversait. L'ennemi meurt, le joueur perd une vie. */
function processBodyCollisions() {
  try {
    if (!player || player.invulnerable || gameState !== 'playing') return;
    if (!TEMPO.ENEMY_RAM_DAMAGE) return;

    const hb = getPlayerHitbox();
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (!e || e.isDeleted) continue;
      if (e.hasEntered === false && e.y + e.height < 0) continue;   // pas encore à l'écran
      if (!rectIntersect(hb, e)) continue;

      killEnemyAt(j, 'ram');
      damagePlayer('ram');
      return;   // une seule collision par frame : les i-frames couvrent le reste
    }

    // Coque du boss, ses drones et les tentacules du Cœur. Sans ça, le plongeon
    // de La Ruche et les tentacules seraient purement décoratifs.
    if (typeof BOSS !== 'undefined' && BOSS.isActive && BOSS.isActive() && BOSS.bodyHitTest(hb)) {
      damagePlayer('boss');
      return;
    }
  } catch (e) {
    console.error("Erreur dans processBodyCollisions :", e);
  }
}

/** Projectiles ennemis contre le joueur (hitbox réduite + i-frames). */
function processEnemyBulletCollisions() {
  try {
    if (!player || gameState !== 'playing') return;
    if (player.invulnerable) return;   // les tirs traversent pendant les i-frames

    const hb = getPlayerHitbox();
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      if (!b) { enemyBullets.splice(i, 1); continue; }
      if (!rectIntersect(b, hb)) continue;

      enemyBullets.splice(i, 1);
      damagePlayer('bullet');
      break;
    }
  } catch (e) {
    console.error("Erreur dans processEnemyBulletCollisions :", e);
  }
}

/* -----------------------------------------------------------------------------
 *  PROGRESSION
 * -------------------------------------------------------------------------- */

function handleStageCompletion() {
  let modeResult = null;
  try {
    stageSystem.stageCompleted = true;

    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i]) enemies[i].isDeleted = true;
    }

    // Le RAMASSAGE est ouvert AVANT toute étape susceptible d'échouer : une
    // erreur dans le reste de la clôture ne doit jamais le sauter (le `catch`
    // ci-dessous passe directement au stage suivant — ce serait une transition
    // instantanée, précisément le symptôme qu'on corrige).
    pendingTransitionMs = TEMPO.STAGE_COMPLETE_DELAY_MS;
    pendingCollectMs = TEMPO.STAGE_COLLECT_MS;
    collectStartedAt = (typeof FRAME !== 'undefined' && FRAME) ? FRAME.time : 0;
    beginPowerUpCollection();

    // --- étapes non critiques : une erreur ici ne doit rien interrompre ------
    try {
      resetStageBlast();
      JUICE.preset('stageClear');
      gameEvent('stageClear', { stage: stageSystem.currentStage });
      modeResult = _modeCall('completeStage', {
        stage: stageSystem.currentStage,
        loop: stageSystem.loopCount,
        score: score
      });
      // Le record par mode ne doit jamais pouvoir bloquer une fin de stage.
      const runtime = _runtime();
      const mode = runtime && runtime.modes ? runtime.modes.current() : null;
      if (runtime && runtime.profile && mode) {
        const saved = runtime.profile.mode(mode.id) || {};
        runtime.profile.updateMode(mode.id, {
          ...saved,
          highestStage: Math.max(Number(saved.highestStage) || 1, stageSystem.currentStage)
        });
      }
    } catch (sideEffectError) {
      console.error('Fin de stage : étape non critique ignorée —', sideEffectError);
    }

    sectorTransitPending = (stageSystem.currentStage % 5) === 0;
  } catch (e) {
    console.error("Erreur dans handleStageCompletion :", e);
    softResetStage();
    return;
  }

  // La boutique d'Assaut remplace le flux normal ; elle se décide après coup,
  // une fois la fenêtre de ramassage posée.
  if (modeResult && modeResult.openShop) {
    playerBullets.length = 0;
    if (typeof playerSpecialShots !== 'undefined' && playerSpecialShots) playerSpecialShots.length = 0;
    gameState = 'shop';
    assaultShopFireArmed = false;
    // La salle d'arsenal est un niveau jouable : le temps, le pilotage et les
    // projectiles continuent. Seule la menace de combat est absente.
    isPaused = false;
    pendingTransitionMs = -1;
    pendingCollectMs = -1;
  }
}

/** Horodatage (temps de JEU) du dernier renfort — évite les rafales. */
let lastReinforcementAt = -1e9;

/* -----------------------------------------------------------------------------
 *  ALIMENTATION DU CHAMP DE BATAILLE
 *
 *  Avant : appelée uniquement quand `enemies.length === 0`. Résultat mesuré au
 *  banc — 53 % du temps de jeu avec 2 ennemis ou moins à l'écran, des plages de
 *  10 s à courir après un unique traînard, et un écran noir aux trois quarts.
 *  C'était ça, la vraie cause du « c'est trop lent », pas la vitesse des unités.
 *
 *  Maintenant : appelée à CHAQUE frame. Elle maintient le champ peuplé —
 *  renfort dès que l'effectif passe sous FIELD_REINFORCE_AT, tant que le budget
 *  du stage n'est pas épuisé. Le nombre total d'ennemis par stage ne change pas.
 * -------------------------------------------------------------------------- */
function handleNewWave() {
  try {
    let alive = 0;
    for (let i = 0; i < enemies.length; i++) {
      if (enemies[i] && !enemies[i].isDeleted && !enemies[i].isBonus && !enemies[i].isHazard) alive++;
    }

    const enemiesLeft = stageSystem.enemiesPerStage - stageSystem.enemiesDefeated;

    if (enemiesLeft > stageSystem.enemiesPerStage || enemiesLeft < 0) {
      console.warn("Compteur d'ennemis incohérent, fin de stage forcée");
      stageSystem.enemiesDefeated = stageSystem.enemiesPerStage;
      stageSystem.stageCompleted = true;
      pendingTransitionMs = TEMPO.STAGE_COMPLETE_DELAY_MS;
      return;
    }

    if (enemiesLeft <= 0) return;

    // Effectif VISÉ à l'écran. On ne s'arrête pas quand le « budget » du stage
    // est déjà sorti : le stage se termine sur le COMPTE DE morts, pas sur le
    // compte d'apparitions. Tant qu'il reste des kills à faire, il reste des
    // ennemis à l'écran — le champ ne se vide plus jamais en cours de stage.
    // (+2 de marge pour que la fin de stage n'oblige pas à courir après un
    //  unique traînard fuyant.)
    // Pendant un combat de boss, la piétaille reste une ESCORTE : trois unités
    // au plus. Le boss doit rester la vedette, et sa barre de vie lisible.
    const bossEnCours = (typeof BOSS !== 'undefined' && BOSS.isActive && BOSS.isActive());
    const cible = bossEnCours ? Math.min(3, TEMPO.FIELD_TARGET) : TEMPO.FIELD_TARGET;

    const desired = Math.min(cible, enemiesLeft + 2);
    if (alive >= desired) return;

    const empty = (alive === 0);

    // Champ encore assez peuplé : rien à faire.
    if (!empty && alive > (bossEnCours ? 1 : TEMPO.FIELD_REINFORCE_AT)) return;

    // Anti-rafale — sauf si l'écran est VIDE, où l'on repeuple sans attendre.
    if (!empty && FRAME.time * 1000 - lastReinforcementAt < TEMPO.FIELD_REINFORCE_COOLDOWN_MS) return;

    lastReinforcementAt = FRAME.time * 1000;
    enemySpeed += empty ? 0.2 : 0.08;

    const waveSize = Math.max(1, desired - alive);
    const formations = Object.values(FORMATIONS);
    const choreographies = Object.values(ENTRY_CHOREOGRAPHIES);
    let randomFormation = formations[Math.floor(_gameRandom() * formations.length)];
    let randomChoreography = choreographies[Math.floor(_gameRandom() * choreographies.length)];

    // Dans une campagne scénarisée, les renforts gardent le langage visuel du
    // secteur courant. Les formes changent au secteur suivant, pas au hasard
    // au milieu d'une bataille déjà lisible.
    const runtime = (typeof window !== 'undefined') ? window.GALABOB : null;
    const mode = runtime && runtime.modes ? runtime.modes.current() : null;
    const progression = mode && mode.progression;
    if (progression && progression.rules && progression.rules.scriptedCompositions) {
      const index = Math.max(0, stageSystem.currentStage - 1) % progression.compositions.length;
      const composition = progression.compositions[index];
      randomFormation = composition.f;
      randomChoreography = composition.c;
    }

    try {
      createFormation(waveSize, randomFormation, randomChoreography, stageSystem.currentStage, !empty);
    } catch (e) {
      console.error("Erreur lors de la création d'une vague, repli simple :", e);
      for (let i = 0; i < waveSize; i++) {
        enemies.push({
          x: _gameRandom() * Math.max(1, CANVAS_WIDTH - 60) + 30,
          y: -60 - i * 34,
          width: 46,
          height: 46,
          type: "normal",
          hp: 1,
          points: 10,
          color: PALETTE.enemy('normal').glow,
          hasEntered: false,
          diving: false,
          speedModifier: 1,
          targetY: 110 + i * 22,
          startX: 0,
          startY: 0,
          pattern: ENEMY_PATTERNS.PATROL
        });
      }
    }
  } catch (e) {
    console.error("Erreur dans handleNewWave :", e);
  }
}

/** Un boss vaincu lâche trois bonus : c'est la récompense du combat long. */
function lacherButinDeBoss() {
  if (!_randomPowerUpsEnabled()) return;
  if (typeof createPowerUp !== 'function' || typeof powerUps === 'undefined') return;
  for (let k = 0; k < 3; k++) {
    try {
      powerUps.push(createPowerUp(CANVAS_WIDTH / 2 - 10 + (k - 1) * 70, CANVAS_HEIGHT * 0.35));
    } catch (err) { /* ignoré */ }
  }
}

function continueAfterAssaultShop() {
  const runtime = _runtime();
  const mode = runtime && runtime.modes ? runtime.modes.current() : null;
  if (!mode || mode.id !== 'assault') return;
  if (typeof mode.closeShop === 'function') mode.closeShop();
  gameState = 'playing';
  isPaused = false;
  beginInterstageFlow();
}

/** Les blocs de cinq stages se terminent par une traversée pilotable. */
function beginInterstageFlow() {
  if (!sectorTransitPending) {
    stageSystem.startTransition();
    return;
  }
  sectorTransitPending = false;
  sectorTransitPreview = false;
  const runtime = _runtime();
  const mode = runtime && runtime.modes ? runtime.modes.current() : null;
  const next = stageSystem.nextStageInfo();
  playerBullets.length = 0;
  enemyBullets.length = 0;
  if (typeof playerSpecialShots !== 'undefined') playerSpecialShots.length = 0;
  if (typeof TRANSIT === 'undefined' || !TRANSIT.start({
    stage: stageSystem.currentStage,
    nextStage: next.stage,
    loop: stageSystem.loopCount,
    mode: mode ? mode.id : 'arcade',
    shipId: player.shipId
  })) {
    stageSystem.startTransition();
    return;
  }
  gameState = 'transit';
  isPaused = false;
  JUICE.preset('stageStart');
}

function finishSectorTransit() {
  try { if (typeof TRANSIT !== 'undefined') TRANSIT.reset(); } catch (_) { /* ignoré */ }
  gameState = 'playing';
  isPaused = false;
  if (sectorTransitPreview) {
    sectorTransitPreview = false;
    return;
  }
  try {
    stageSystem.goToNextStage();
  } catch (error) {
    console.error('Fin du transit intersectoriel :', error);
    stageSystem.forceNextStage();
  }
}

/** Dernier recours si le système de stages part en vrille : on repart proprement
 *  sur le stage courant SANS détruire la partie (score et vies conservés). */
function softResetStage() {
  try {
    enemies = [];
    playerBullets = [];
    enemyBullets = [];
    // BOSS.reset() purge aussi les balles qu'il avait semées dans enemyBullets.
    if (typeof BOSS !== 'undefined') { try { BOSS.reset(); } catch (e) { /* ignoré */ } }
    pendingTransitionMs = -1;
    sectorTransitPending = false;
    sectorTransitPreview = false;
    if (typeof TRANSIT !== 'undefined') { try { TRANSIT.reset(); } catch (_) { /* ignoré */ } }
    stageSystem.transitionActive = false;
    isPaused = false;
    stageSystem.resetStageStats();
    stageSystem.initStage();
  } catch (e) {
    console.error("softResetStage a échoué :", e);
    gameState = "menu";
    isPaused = false;
  }
}

/* -----------------------------------------------------------------------------
 *  CYCLE DE VIE — appelé par main.js (visibilitychange / blur / focus)
 * -------------------------------------------------------------------------- */
function pauseForVisibility() {
  if ((gameState === 'playing' || gameState === 'shop' || gameState === 'transit') && !isPaused) {
    isPaused = true;
    autoPaused = true;
  }
  saveHighScore();
}

function resumeFromVisibility() {
  if (autoPaused) {
    isPaused = false;
    autoPaused = false;
  }
}

/* =============================================================================
 *  RENDU
 * -----------------------------------------------------------------------------
 *  draw() ne dessine plus directement : il ouvre la passe émissive de NEON,
 *  laisse drawScene() peindre, referme, puis lance la recomposition néon.
 * ========================================================================== */
/** Dernier écran rendu — sert à purger la persistance au changement d'écran. */
let _lastDrawnScreen = '';

function draw() {
  try {
    // Changement d'écran => purge des traînées. Sans ça, les sillages de la
    // partie précédente restent BRÛLÉS dans le buffer de persistance et
    // réapparaissent en fantômes derrière le titre du menu ou le GAME OVER
    // (l'atténuation multiplicative 8 bits ne descend jamais à zéro).
    const screen = gameState + (stageSystem.transitionActive ? ':transition' : '');
    if (screen !== _lastDrawnScreen) {
      _lastDrawnScreen = screen;
      if (typeof NEON.clearTrail === 'function') NEON.clearTrail();
    }

    NEON.beginFrame();          // vide les buffers, branche `ctx`, pose la caméra
    try {
      drawScene();
    } catch (e) {
      console.error("Erreur dans drawScene :", e);
    }
    NEON.endFrame();            // replie les traînées, débranche `ctx`

    NEON.composite();           // bloom + aberration chromatique -> canvas visible
    JUICE.drawFlash(NEON.mainCtx || ctx);   // voile plein écran, hors bloom

    if (GAME_CONFIG.showDebugInfo && typeof drawDebugInfo === 'function') {
      try { drawDebugInfo(); } catch (e) { /* ignoré */ }
    }
  } catch (e) {
    console.error("Erreur critique dans draw :", e);
    try { NEON.endFrame(); } catch (e2) { /* ignoré */ }
  }
}

/**
 * L'instantané transmis à la vue en perspective : uniquement ce que la caméra a
 * besoin de VOIR. Aucune donnée de gameplay n'est copiée ni modifiée — la
 * simulation continue de tourner exactement comme en vue à plat.
 */
function stageSnapshot() {
  return {
    player: player,
    enemies: enemies,
    playerBullets: playerBullets,
    // Les projectiles ennemis font partie de la lisibilité : en perspective on
    // ne voyait pas ce qui arrivait, faute de les projeter.
    enemyBullets: (typeof enemyBullets !== 'undefined') ? enemyBullets : [],
    // Les bonus doivent rester identifiables : sans eux, on ne sait pas quoi
    // aller chercher en perspective.
    powerUps: (typeof powerUps !== 'undefined' && powerUps) ? powerUps : [],
    // Les impacts doivent se produire LÀ OÙ ils ont lieu : sans eux, une
    // destruction lointaine ne se lisait pas.
    explosions: (typeof explosions !== 'undefined') ? explosions : [],
    // Le boss : sa position et sa vie, pour qu'il soit localisable en
    // perspective. `_state` est l'introspection officielle du module boss.
    boss: (typeof BOSS !== 'undefined' && BOSS && BOSS.isActive && BOSS.isActive())
      ? {
          x: BOSS._state ? BOSS._state.x : CANVAS_WIDTH / 2,
          y: BOSS._state ? BOSS._state.y : 120,
          rayon: BOSS._state && BOSS._state.rayon ? BOSS._state.rayon : 90,
          hp: (typeof BOSS.getHpFraction === 'function') ? BOSS.getHpFraction() : 1,
          color: (typeof BOSS.getColor === 'function') ? BOSS.getColor() : null,
          phase: (typeof BOSS.getPhase === 'function') ? BOSS.getPhase() : 1
        }
      : null,
    shipRenderer: (typeof player !== 'undefined' && player && player.shipRenderer)
      ? player.shipRenderer : 'legacy-vector'
  };
}

/** Compose la vue en perspective des stages 2D dans le buffer émissif.
 *  @returns {boolean} false si le rendu 3D est indisponible — la boucle repasse
 *  alors en vue à plat, sinon l'écran resterait vide. */
function drawStagePerspective() {
  const result = (typeof GAME3D !== 'undefined' && typeof GAME3D.frame === 'function')
    ? GAME3D.frame(stageSnapshot(), CANVAS_WIDTH, CANVAS_HEIGHT)
    : null;
  if (!result || !result.canvas) return false;

  // Le canvas 3D entre dans la MÊME scène émissive que la vue à plat : c'est ce
  // qui lui donne le bloom, l'aberration et la vignette du mode classique.
  //
  // BASCULE = PLAN DE CAMÉRA, pas un simple fondu. Pendant l'animation, l'image
  // arrive de plus haut et légèrement plus large, puis se pose : on lit un
  // mouvement de caméra qui se place derrière le vaisseau, pas une dissolution.
  const t = Math.max(0, Math.min(1, viewBlend));
  const chute = (1 - t) * 90;                 // px : la caméra descend se poser
  const zoom = 1 + (1 - t) * 0.10;            // elle arrive d'un peu plus loin
  const cx = CANVAS_WIDTH / 2, cy = CANVAS_HEIGHT / 2;
  const place = (c) => {
    c.translate(cx, cy + chute);
    c.scale(zoom, zoom);
    c.translate(-cx, -cy);
  };

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = t;
  place(ctx);
  ctx.drawImage(result.canvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.restore();

  // --- BOSS : anneau de cible et jauge de vie, à sa position projetée ------
  // Il n'est pas encore coiffé de sa coque 3D : il est LOCALISABLE et sa vie
  // se lit, ce qui est le minimum pour se battre. La coque viendra ensuite.
  const boss = result.markers && result.markers.boss;
  if (boss && typeof NEON !== 'undefined') {
    ctx.save();
    place(ctx);
    const cle = boss.color || 'enemyElite';
    // Deux cercles concentriques : la silhouette, puis la part de vie restante.
    NEON.ring(ctx, boss.x, boss.y, boss.r, 1.6, cle,
      { alpha: 0.42 * t, dash: [7, 5], passes: 2, composite: 'lighter' });
    NEON.ring(ctx, boss.x, boss.y, boss.r * 0.82, 2.6, 'danger',
      { alpha: 0.75 * t, passes: 3, composite: 'lighter' });
    // La jauge suit le pourtour : lisible sans quitter l'action.
    const arc = Math.max(0.02, boss.hp);
    NEON.ring(ctx, boss.x, boss.y, boss.r * 1.12, 2.2, 'playerCore',
      { alpha: 0.6 * t, dash: [arc * 160, 999], dashOffset: -40, passes: 2, composite: 'lighter' });
    NEON.dot(ctx, boss.x, boss.y, Math.max(3, boss.r * 0.14), cle,
      { alpha: 0.85 * t, glowScale: 0.5, passes: 2 });
    ctx.restore();
  }

  // --- EXPLOSIONS : les impacts se produisent LÀ OÙ ils ont lieu -----------
  // Même grammaire que la vue à plat (halo additif), mais à la position
  // projetée : une destruction lointaine se lit enfin.
  const impacts = (result.markers && result.markers.explosions) || [];
  if (impacts.length && typeof NEON !== 'undefined') {
    ctx.save();
    place(ctx);
    for (const f of impacts) {
      const rayon = Math.max(3, Math.min(90, f.r || 4));
      const couleur = f.color || 'enemyNormal';
      NEON.dot(ctx, f.x, f.y, rayon * 0.5, couleur,
        { alpha: 0.55 * f.alpha * t, glowScale: 0.9, passes: 2, composite: 'lighter' });
      NEON.ring(ctx, f.x, f.y, rayon, Math.max(1, rayon * 0.12), couleur,
        { alpha: 0.5 * f.alpha * t, passes: 2, composite: 'lighter' });
    }
    ctx.restore();
  }

  // --- BONUS : même grammaire que la vue à plat, projetée -------------------
  // Le sprite 3D n'existe pas pour les bonus : on les trace en néon à leur
  // position projetée, dans la couleur de leur famille. Ils restent donc
  // identifiables au premier coup d'œil, comme dans le mode classique.
  const pickups = (result.markers && result.markers.powerups) || [];
  if (pickups.length && typeof NEON !== 'undefined') {
    ctx.save();
    place(ctx);
    for (const p of pickups) {
      const cle = 'powerup.' + (p.type || 'double');
      const taille = Math.max(7, Math.min(26, (p.scale || 1) * 30));
      const pulse = Math.sin((FRAME.time * 6) + p.x * 0.01) * 0.16;
      NEON.ring(ctx, p.x, p.y, taille + pulse * 10, 1.3, cle,
        { alpha: 0.55 * t, dash: [5, 4], passes: 2 });
      NEON.dot(ctx, p.x, p.y, Math.max(2.2, taille * 0.28), cle,
        { alpha: 0.9 * t, glowScale: 0.5, passes: 2 });
    }
    ctx.restore();
  }

  // Le vaisseau est marqué d'un noyau blanc : sa VRAIE hitbox, identique à
  // celle de la vue à plat. Le joueur doit pouvoir lire son esquive partout.
  // Le repère subit la MÊME transformation que l'image, sinon il se détache.
  const marker = result.markers && result.markers.ship;
  if (marker && marker.visible && typeof NEON !== 'undefined') {
    ctx.save();
    place(ctx);
    NEON.dot(ctx, marker.x, marker.y, 2.4, 'playerCore',
      { alpha: 0.85 * t, glowScale: 0.35, passes: 2 });
    NEON.ring(ctx, marker.x, marker.y, 9, 1.1, 'player',
      { alpha: 0.42 * t, dash: [3, 5], passes: 2 });
    ctx.restore();
  }
  return true;
}

/** Tout le contenu de la scène. `ctx` pointe ici sur le buffer émissif. */
function drawScene() {
  // --- VUE EN PERSPECTIVE ---------------------------------------------------
  // Placée AVANT le décor et les étoiles : c'est l'erreur qui donnait un fond
  // bleu. `drawStars()` peint le ciel 2D ; en perspective il ne doit pas être
  // peint du tout, sinon il recouvre la vue 3D (qui a son propre fond).
  if (viewBlend > 0.001 && gameState === 'playing') {
    const troisDPrete = typeof GAME3D !== 'undefined' &&
      typeof GAME3D.isAvailable === 'function' && GAME3D.isAvailable();
    if (troisDPrete && drawStagePerspective()) return;
    if (!troisDPrete) {
      // Rendu indisponible : on repasse à la vue à plat plutôt que de laisser
      // un écran vide, et on annonce pourquoi.
      viewMode = 'flat';
      viewBlend = 0;
      if (typeof BACKDROP !== 'undefined' && BACKDROP && typeof BACKDROP.setViewDim === 'function') {
        try { BACKDROP.setViewDim(1); } catch (e) { /* ignoré */ }
      }
      try {
        const why = GAME3D.failureReason ? GAME3D.failureReason() : null;
        if (typeof hudAlert === 'function') {
          hudAlert('VUE EN PERSPECTIVE INDISPONIBLE', why ? String(why).slice(0, 60) : 'WEBGL REQUIS', '#ff2b55', 2200);
        }
      } catch (e) { /* l'annonce ne doit jamais bloquer le rendu */ }
    }
  }

  // --- transition de stage -------------------------------------------------
  if (stageSystem.transitionActive) {
    try {
      stageSystem.drawTransition();
    } catch (e) {
      console.error("Erreur lors du rendu de la transition :", e);
    }
    return;
  }

  if (gameState === 'transit') {
    try { if (typeof TRANSIT !== 'undefined') TRANSIT.draw(ctx); }
    catch (e) { console.error('Erreur draw transit :', e); }
    try { if (typeof drawPowerUpFeedback === 'function') drawPowerUpFeedback(); } catch (e) { console.error('Erreur power-ups transit :', e); }
    try { drawExplosions(); } catch (e) { console.error('Erreur explosions transit :', e); }
    if (typeof drawDebris === 'function') try { drawDebris(); } catch (e) { /* décoratif */ }
    if (typeof drawScorePopups === 'function') try { drawScorePopups(); } catch (e) { /* décoratif */ }

    // Score, vies, combo, bouclier, arme et munitions : le HUD habituel reste
    // la source de vérité, fixé hors du screenshake comme dans les stages 2D.
    const transitCamera = ctx.getTransform ? ctx.getTransform() : null;
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    try { drawHUD(); } catch (e) { console.error('Erreur HUD transit :', e); }
    if (isPaused) {
      try { drawPauseMenu(); } catch (e) { /* menu facultatif */ }
    }
    ctx.restore();
    if (transitCamera && ctx.setTransform) ctx.setTransform(transitCamera);
    return;
  }

  // --- fond étoilé ---------------------------------------------------------
  try {
    if (typeof drawStars === 'function') drawStars();
  } catch (e) {
    console.error("Erreur lors du dessin des étoiles :", e);
  }

  if (gameState === "shop") {
    try { drawAssaultShop(); } catch (e) { console.error("Erreur drawAssaultShop :", e); }
    return;
  }

  // --- menus ---------------------------------------------------------------
  if (gameState === "menu") {
    try { drawMenu(); } catch (e) { console.error("Erreur drawMenu :", e); }
    return;
  }

  if (gameState === "settings") {
    try { drawSettingsMenu(); } catch (e) { console.error("Erreur drawSettingsMenu :", e); }
    return;
  }

  if (gameState === "gameover") {
    try { drawGameOverScreen(); } catch (e) { console.error("Erreur drawGameOverScreen :", e); }
    return;
  }

  // --- jeu -----------------------------------------------------------------
  // Le clignotement d'invulnérabilité est appliqué ici, sauf si le module
  // joueur déclare le gérer lui-même (player.handlesOwnBlink = true).
  const hidePlayer = player.blink && !player.handlesOwnBlink;
  if (!hidePlayer) {
    try { drawPlayer(); } catch (e) { console.error("Erreur drawPlayer :", e); }
  }

  try { drawPowerUps(); } catch (e) { console.error("Erreur drawPowerUps :", e); }
  try { drawPlayerBullets(); } catch (e) { console.error("Erreur drawPlayerBullets :", e); }
  try { drawEnemies(); } catch (e) { console.error("Erreur drawEnemies :", e); }
  if (typeof BOSS !== 'undefined') {
    try { BOSS.drawWorld(ctx); } catch (e) { console.error("Erreur BOSS.drawWorld :", e); }
  }
  try { drawEnemyBullets(); } catch (e) { console.error("Erreur drawEnemyBullets :", e); }
  try { drawExplosions(); } catch (e) { console.error("Erreur drawExplosions :", e); }
  if (typeof drawDebris === 'function') {
    try { drawDebris(); } catch (e) { console.error("Erreur drawDebris :", e); }
  }
  if (typeof drawScorePopups === 'function') {
    try { drawScorePopups(); } catch (e) { console.error("Erreur drawScorePopups :", e); }
  }
  /* --- surcouche FIXE : HUD et menu pause ---------------------------------
   *  Le HUD sort de la caméra de JUICE. Il était jusqu'ici dessiné DANS la
   *  transformation de screenshake : sur une grosse explosion, le décalage
   *  poussait les éléments de bord hors de l'écran — « SCORE » amputé de son
   *  S, « MEILLEUR » de son M, le badge de chaîne coupé par le bord gauche.
   *  Ça ne se lit pas comme de l'impact, ça se lit comme un bug d'affichage.
   *  L'écran continue de trembler ; les repères, eux, restent d'aplomb.
   *  (Bonus : les zones cliquables du menu pause sont enfin enregistrées aux
   *   coordonnées réelles de la souris, et non aux coordonnées secouées.)   */
  const _cam = ctx.getTransform ? ctx.getTransform() : null;
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  try { drawHUD(); } catch (e) { console.error("Erreur drawHUD :", e); }

  // Barre de vie + bannière du boss : dans le bloc à repère FIXE, pour qu'une
  // grosse secousse ne les pousse pas hors de l'écran (même raison que le HUD).
  if (typeof BOSS !== 'undefined') {
    try { BOSS.drawHud(ctx); } catch (e) { console.error("Erreur BOSS.drawHud :", e); }
  }

  if (isPaused) {
    try { drawPauseMenu(); } catch (e) { console.error("Erreur drawPauseMenu :", e); }
  }

  ctx.restore();
  if (_cam && ctx.setTransform) ctx.setTransform(_cam);
}

/* -----------------------------------------------------------------------------
 *  Aides publiques
 * -------------------------------------------------------------------------- */

/** Multiplicateur de combo courant (1 .. TEMPO.COMBO_MAX). Pour le HUD. */
function getComboMultiplier() {
  const combo = _combo();
  return combo ? combo.multiplier() : Math.max(1, Math.min(comboCount || 1, TEMPO.COMBO_MAX));
}

/** Fraction de temps restant sur le combo courant, 0 → 1. Pour une jauge HUD. */
function getComboFraction() {
  const combo = _combo();
  if (combo) return combo.fraction();
  if (!comboCount) return 0;
  return clamp(comboTimer / TEMPO.COMBO_WINDOW_MS, 0, 1);
}

window.getPlayerHitbox = getPlayerHitbox;
window.damagePlayer = damagePlayer;
window.killEnemyAt = killEnemyAt;
window.gameEvent = gameEvent;
window.getComboMultiplier = getComboMultiplier;
window.getComboFraction = getComboFraction;
window.saveHighScore = saveHighScore;
window.returnToMenu = returnToMenu;
window.continueAfterAssaultShop = continueAfterAssaultShop;
/** Aperçu développeur sans modifier le stage courant à l'arrivée. */
window.previewSectorTransit = function () {
  if (gameState === 'menu' || gameState === 'gameover') initGame();
  if (typeof TRANSIT === 'undefined') return false;
  sectorTransitPreview = true;
  gameState = 'transit';
  isPaused = false;
  return TRANSIT.start({
    stage: 5,
    nextStage: 6,
    loop: stageSystem.loopCount,
    mode: (_runtime()?.modes?.current()?.id) || 'arcade',
    shipId: player.shipId
  });
};
