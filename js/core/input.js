/* =============================================================================
 *  galabob — ENTRÉES CLAVIER / SOURIS
 * -----------------------------------------------------------------------------
 *  Trois choses ont changé ici :
 *
 *  1. preventDefault() sur les flèches et la barre d'espace.
 *     Avant, tirer faisait défiler la page : la sensation de pilotage était
 *     détruite dès la première seconde. Le blocage est INHIBÉ quand le focus
 *     est dans un champ de formulaire (curseurs de volume, cases à cocher),
 *     pour que le panneau audio reste utilisable au clavier.
 *
 *  2. BUFFER DE TIR (INPUT.bufferMs, 120 ms).
 *     Appuyer sur espace JUSTE AVANT la fin du cooldown ne doit pas être
 *     ignoré : l'appui est mémorisé et le tir part dès que l'arme est prête.
 *     C'est ce qui fait qu'une arme rapide reste précise au lieu de sembler
 *     "manger" les entrées.
 *
 *  3. Une petite API de lecture (INPUT.left/right/shoot) pour que player.js ne
 *     dépende plus de la forme exacte des clés du dictionnaire `keys`.
 *
 *  `keys` reste une globale publique : main.js (releaseAllKeys) et le reste du
 *  code continuent de l'utiliser telle quelle.
 * ========================================================================== */

// Gestion des touches — dictionnaire e.key -> bool
const keys = {};

/* -----------------------------------------------------------------------------
 *  INPUT — état d'entrée de haut niveau
 * -------------------------------------------------------------------------- */
const INPUT = {
  /** Fenêtre du buffer de tir, en millisecondes de TEMPS RÉEL.
   *  (Le buffer doit vivre même pendant un hitstop : c'est de l'entrée
   *   utilisateur, pas de la logique de jeu.) */
  bufferMs: 120,

  _shootAt: -1e9,        // horodatage du dernier APPUI (front montant)
  _shootConsumed: true,  // true dès que le tir bufferisé a été utilisé

  /** Horloge d'entrée : temps réel monotone, en ms. */
  now: function () {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
  },

  /** Touche de tir maintenue (auto-fire). */
  shoot: function () {
    return !!(keys[' '] || keys['Spacebar'] || keys['Space']);
  },

  left: function () {
    return !!(keys['ArrowLeft'] || keys['Left'] || keys['q'] || keys['Q']);
  },

  right: function () {
    return !!(keys['ArrowRight'] || keys['Right'] || keys['d'] || keys['D']);
  },

  /** Direction horizontale : -1, 0 ou +1. */
  axisX: function () {
    return (this.right() ? 1 : 0) - (this.left() ? 1 : 0);
  },

  /** true si un appui récent est encore en attente d'être servi. */
  shootBuffered: function () {
    if (this._shootConsumed) return false;
    if (this.now() - this._shootAt > this.bufferMs) {
      this._shootConsumed = true;   // périmé : on nettoie
      return false;
    }
    return true;
  },

  /** Consomme le buffer (à appeler dès qu'un tir est effectivement parti). */
  consumeShoot: function () {
    this._shootConsumed = true;
  },

  /** Enregistre un front montant de la touche de tir. */
  pressShoot: function () {
    this._shootAt = this.now();
    this._shootConsumed = false;
  },

  /** Remise à zéro (perte de focus, nouvelle partie). */
  reset: function () {
    this._shootConsumed = true;
    this._shootAt = -1e9;
  }
};

window.INPUT = INPUT;

/* -----------------------------------------------------------------------------
 *  Outils internes
 * -------------------------------------------------------------------------- */

/** true si l'événement vise un champ de saisie : on laisse alors le navigateur
 *  faire son travail (curseurs de volume, cases à cocher, bouton Fermer). */
function _isFormTarget(t) {
  if (!t || !t.tagName) return false;
  if (t.isContentEditable) return true;
  const n = String(t.tagName).toUpperCase();
  return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || n === 'BUTTON' || n === 'OPTION';
}

// Touches dont le comportement par défaut du navigateur nuit au jeu :
// défilement de la page (flèches, espace), recherche rapide (F3).
const _SWALLOWED_KEYS = {
  'ArrowLeft': true, 'ArrowRight': true, 'ArrowUp': true, 'ArrowDown': true,
  'Left': true, 'Right': true, 'Up': true, 'Down': true,
  ' ': true, 'Spacebar': true, 'Space': true,
  'F3': true
};

/** Petite notification à l'écran, sans dépendre de effects.js. */
function _inputNotice(text, color) {
  try {
    if (typeof scorePopups === 'undefined' || !scorePopups) return;
    scorePopups.push({
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2 - 100,
      points: 0,
      text: text,
      lifetime: 1.0,
      dy: -1,
      color: color || (typeof PALETTE !== 'undefined' ? PALETTE.ui.accent : '#4488ff')
    });
  } catch (e) { /* purement cosmétique */ }
}

/* -----------------------------------------------------------------------------
 *  CLAVIER
 * -------------------------------------------------------------------------- */
document.addEventListener('keydown', function (e) {
  const inForm = _isFormTarget(e.target);

  // Dans un champ de formulaire, seule Échap reste un raccourci de jeu.
  if (inForm && e.key !== 'Escape') return;

  if (_SWALLOWED_KEYS[e.key]) {
    e.preventDefault();
  }

  // Front montant de la touche de tir -> alimente le buffer.
  // (On teste l'état AVANT de l'écrire : l'auto-répétition du clavier ne doit
  //  pas ré-armer le buffer en continu.)
  const wasDown = keys[e.key] === true;
  if (!wasDown && !e.repeat && (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Space')) {
    INPUT.pressShoot();
  }

  keys[e.key] = true;

  /* Retour sonore des raccourcis d'écran.
   * Le clic de souris émettait bien 'uiSelect' ; le clavier, lui, était MUET —
   * or c'est la façon normale de naviguer ici (ENTRÉE, ÉCHAP, S, P sont
   * affichés comme les commandes officielles dans le menu). Valider une entrée
   * de menu sans le moindre bip donne une interface morte. */
  const _uiClick = function (id) {
    if (typeof gameEvent === 'function') { try { gameEvent('uiSelect', { id: id }); } catch (err) { /* ignoré */ } }
  };

  if (e.key === 'Enter') {
    if (gameState === "menu" || gameState === "gameover") {
      _uiClick(gameState === "menu" ? 'play' : 'retry');
      initGame();
    }
  }

  if (e.key === 'p' || e.key === 'P') {
    if (gameState === "playing") {
      isPaused = !isPaused;
      _uiClick(isPaused ? 'pause' : 'resume');
    }
  }

  if (e.key === 'Escape') {
    if (gameState === "playing" || gameState === "gameover") {
      _uiClick('quit');
      gameState = "menu";
      isPaused = false;
    } else if (gameState === "settings") {
      _uiClick('back');
      gameState = "menu";
    }
  }

  // Touche S pour les paramètres
  if ((e.key === 's' || e.key === 'S') && gameState === "menu") {
    _uiClick('settings');
    gameState = "settings";
  }

  // Touche F3 pour afficher/masquer les stats
  if (e.key === 'F3') {
    GAME_CONFIG.showDebugInfo = !GAME_CONFIG.showDebugInfo;
    try { localStorage.setItem('showDebugInfo', GAME_CONFIG.showDebugInfo); } catch (err) { /* ignoré */ }
  }

  // Touche A pour afficher/masquer les contrôles audio
  if (e.key === 'a' || e.key === 'A') {
    if (typeof toggleAudioControls === 'function') toggleAudioControls();
  }

  // Touche M pour changer la musique
  if ((e.key === 'm' || e.key === 'M') &&
      typeof audioConfig !== 'undefined' && audioConfig && audioConfig.soundEnabled) {
    if (typeof changeRandomMusic === 'function') {
      changeRandomMusic();
      _inputNotice("Changement de musique", typeof PALETTE !== 'undefined' ? PALETTE.ui.accent : '#4488ff');
    }
  }

  // Touche N pour déclencher une narration
  if ((e.key === 'n' || e.key === 'N') && gameState === "playing" &&
      typeof audioConfig !== 'undefined' && audioConfig && audioConfig.soundEnabled) {
    if (typeof triggerRandomNarration === 'function' && triggerRandomNarration()) {
      _inputNotice("Narration déclenchée", typeof PALETTE !== 'undefined' ? PALETTE.ui.accentAlt : '#ff88aa');
    }
  }
});

document.addEventListener('keyup', function (e) {
  if (_SWALLOWED_KEYS[e.key] && !_isFormTarget(e.target)) {
    e.preventDefault();
  }
  keys[e.key] = false;
});

// Perte de focus : on purge le buffer de tir (main.js relâche déjà les touches).
window.addEventListener('blur', function () {
  INPUT.reset();
});

/* -----------------------------------------------------------------------------
 *  PANNEAU AUDIO ET CLICS SUR LE CANVAS
 *  Chaque accès au DOM est protégé : si un élément disparaît de index.html,
 *  le reste des gestionnaires (notamment le clic canvas) doit survivre.
 * -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', function () {
  const on = function (id, evt, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, fn);
  };

  on('musicVolume', 'input', function (e) {
    if (typeof updateMusicVolume === 'function') updateMusicVolume(e.target.value);
  });

  on('narrationVolume', 'input', function (e) {
    if (typeof updateNarrationVolume === 'function') updateNarrationVolume(e.target.value);
  });

  on('sfxVolume', 'input', function (e) {
    if (typeof updateSFXVolume === 'function') updateSFXVolume(e.target.value);
  });

  on('closeVolumeControls', 'click', function () {
    const p = document.getElementById('volumeControls');
    if (p) p.style.display = 'none';
  });

  on('autoAdjustVolume', 'change', function (e) {
    if (typeof audioConfig !== 'undefined' && audioConfig) audioConfig.autoAdjustVolume = e.target.checked;
    try { localStorage.setItem('autoAdjustVolume', e.target.checked ? 'true' : 'false'); } catch (err) { /* ignoré */ }
  });

  on('useFadeEffects', 'change', function (e) {
    if (typeof audioConfig !== 'undefined' && audioConfig) audioConfig.useFadeEffects = e.target.checked;
    try { localStorage.setItem('useFadeEffects', e.target.checked ? 'true' : 'false'); } catch (err) { /* ignoré */ }
  });

  // --- clics sur le canvas (menus) ---------------------------------------
  if (typeof canvas === 'undefined' || !canvas) return;

  canvas.addEventListener('click', function (e) {
    const bounds = canvas.getBoundingClientRect();
    const mouseX = e.clientX - bounds.left;
    const mouseY = e.clientY - bounds.top;

    const soundOff = !(typeof audioConfig !== 'undefined' && audioConfig && audioConfig.soundEnabled);

    // Les rectangles cliquables sont désormais définis À UN SEUL ENDROIT :
    // UIKIT.hitRects (js/ui/menus.js), qui dessine les boutons au même endroit.
    // Le repli reproduit les coordonnées historiques si menus.js n'est pas là.
    const rect = function (name, fx, fy) {
      if (typeof UIKIT !== 'undefined' && UIKIT.hitRects && UIKIT.hitRects[name]) {
        return UIKIT.hitRects[name]();
      }
      return { x: CANVAS_WIDTH / 2 - 100, y: CANVAS_HEIGHT / 2 + fy, width: 200, height: 40 };
    };
    const inRect = function (r) {
      return mouseX >= r.x && mouseX <= r.x + r.width &&
             mouseY >= r.y && mouseY <= r.y + r.height;
    };

    // Bouton d'activation du son dans le menu principal
    if (gameState === "menu" && soundOff) {
      if (inRect(rect('soundButton', 0, 120))) {
        if (typeof enableGameAudio === 'function') enableGameAudio();
      }
    }

    // Bouton "Régler Volumes" dans l'écran des paramètres
    if (gameState === "settings") {
      if (inRect(rect('volumeButton', 0, -40))) {
        if (typeof toggleAudioControls === 'function') toggleAudioControls();

        if (soundOff) {
          if (typeof enableGameAudio === 'function') enableGameAudio();
        } else if (typeof backgroundMusic !== 'undefined' && backgroundMusic &&
                   backgroundMusic.volume === 0 && audioConfig.musicVolume > 0) {
          backgroundMusic.volume = audioConfig.musicVolume;
          if (backgroundMusic.paused && audioConfig.currentMusic) {
            const p = backgroundMusic.play();
            if (p && p.catch) p.catch(function (err) { console.warn("Impossible de démarrer la musique:", err); });
          }
        }
      }
    }
  });
});
