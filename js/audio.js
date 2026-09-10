/* =============================================================================
 *  galabob — SYSTÈME AUDIO (pistes du propriétaire + narration + réglages)
 * -----------------------------------------------------------------------------
 *  CE QUI A ÉTÉ SUPPRIMÉ, ET POURQUOI
 *  ----------------------------------
 *  • Le SONDAGE PAR FORCE BRUTE (scanAllAudioFiles / listDirectoryFiles /
 *    isAudioFilePlayable en boucle) : il fabriquait 2112 requêtes HTTP au
 *    démarrage — 16 noms génériques × 6 extensions × 11 variantes × 2 dossiers —
 *    et déversait ~190 erreurs 404 dans la console. Remplacé par la lecture
 *    d'UN SEUL fichier : assets/audio/manifest.json.
 *  • Le setTimeout de 5000 ms qui retardait `audioFilesReady` : il bloquait le
 *    lancement du jeu de 5 à 7 secondes. Le jeu démarre maintenant
 *    INSTANTANÉMENT ; l'audio se prépare en tâche de fond.
 *  • Les chemins en dur inexistants ('rodrigo.wav', 'Guillautine.mp3') qui
 *    étaient réinjectés dans les listes quand le sondage échouait : ils
 *    garantissaient une erreur de lecture à chaque partie.
 *  • Le bonus de narration accordé À CHAQUE ÉCHEC : la touche N était un
 *    générateur de score infini (+100 points par pression, sans même un son).
 *    Le bonus n'est plus accordé QUE si une narration a été écoutée jusqu'au
 *    bout, avec en plus un délai de garde.
 *
 *  COMMENT LE PROPRIÉTAIRE AJOUTE SES PISTES
 *  -----------------------------------------
 *  1. déposer les fichiers dans assets/audio/musique/ (ou narration/)
 *  2. ajouter leur nom dans assets/audio/manifest.json
 *  Aucune détection magique : le manifeste est la seule source de vérité, et
 *  c'est précisément ce qui garantit ZÉRO 404 en console.
 *
 *  BRUITAGES
 *  ---------
 *  Ce fichier ne synthétise RIEN : tout le bruitage est dans js/audio/sfx.js
 *  (objet global `SFX`, 100 % procédural). Ici on ne fait que lui transmettre
 *  les réglages des curseurs. Si sfx.js n'est pas chargé, tout continue de
 *  fonctionner, simplement sans bruitages.
 *
 *  API PUBLIQUE CONSERVÉE (appelée par input.js / menus.js / hud.js / stages.js
 *  / main.js — aucune signature n'a changé) :
 *    audioConfig, audioFilesReady, backgroundMusic, narrationAudio,
 *    initAudioLists(), playRandomMusic(), changeRandomMusic(),
 *    playRandomNarration(forceNew), triggerRandomNarration(),
 *    applyNarrationBonus(message), enableGameAudio(), toggleAudioControls(),
 *    updateMusicVolume(v), updateNarrationVolume(v), updateSFXVolume(v),
 *    isAudioFilePlayable(path)
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 *  Préférences persistées (localStorage) — lecture défensive
 * -------------------------------------------------------------------------- */
function _audioReadNumber(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = parseFloat(raw);
    return (isFinite(v) && v >= 0 && v <= 1) ? v : fallback;
  } catch (e) { return fallback; }
}

/** Lit un booléen persisté. Si la clé n'existe pas, écrit la valeur par défaut :
 *  main.js relit `soundEnabled` juste après nous, il doit trouver la même chose. */
function _audioReadBool(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      localStorage.setItem(key, fallback ? 'true' : 'false');
      return fallback;
    }
    return raw === 'true';
  } catch (e) { return fallback; }
}

function _audioPersist(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) { /* ignoré */ }
}

function _audioNow() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _audioClamp01(v) {
  v = Number(v);
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

/* -----------------------------------------------------------------------------
 *  CONFIGURATION AUDIO
 * -------------------------------------------------------------------------- */
const audioConfig = {
  musicVolume: _audioReadNumber('musicVolume', 0.5),
  narrationVolume: _audioReadNumber('narrationVolume', 0.8),
  sfxVolume: _audioReadNumber('sfxVolume', 0.7),

  currentMusic: null,
  currentNarration: null,

  // Listes de CHEMINS (chaînes) — hud.js les affiche telles quelles.
  musicList: [],
  narrationList: [],
  playedMusicList: [],
  playedNarrationList: [],

  // Métadonnées optionnelles issues du manifeste, indexées par chemin.
  trackInfo: Object.create(null),

  originalMusicVolume: 0,
  narrationPoints: 100,

  // Le son est ACTIF par défaut : il n'existe aucune interface pour le
  // réactiver proprement, et le contexte audio ne démarre de toute façon
  // qu'au premier geste utilisateur (politique autoplay des navigateurs).
  soundEnabled: _audioReadBool('soundEnabled', true),

  autoAdjustVolume: _audioReadBool('autoAdjustVolume', true),
  useFadeEffects: _audioReadBool('useFadeEffects', true),

  // Nappe musicale procédurale (js/audio/sfx.js) : le jeu n'est jamais muet,
  // même sans une seule piste dans assets/audio/musique.
  proceduralMusic: _audioReadBool('proceduralMusic', true),

  // Routage des <audio> dans le graphe Web Audio (permet le ducking et le
  // limiteur commun). Passer à false désactive proprement le routage.
  routeThroughWebAudio: true,

  manifestUrl: 'assets/audio/manifest.json',
  manifestLoaded: false,
  manifestError: null,

  musicFadeMs: 420,      // durée d'un fondu de musique, en ms
  fallbackToDefault: false  // conservé pour compatibilité, plus utilisé
};

/* -----------------------------------------------------------------------------
 *  `audioFilesReady` — conservée pour menus.js.
 *  Plus rien ne bloque : le jeu est jouable immédiatement, avec ou sans piste.
 *  On la laisse à `true` dès le départ pour que le menu n'affiche jamais un
 *  faux « Chargement des fichiers audio… ».
 * -------------------------------------------------------------------------- */
let audioFilesReady = true;

/* -----------------------------------------------------------------------------
 *  ÉLÉMENTS AUDIO
 * -------------------------------------------------------------------------- */
const backgroundMusic = new Audio();
backgroundMusic.loop = true;          // ajusté selon le nombre de pistes
backgroundMusic.preload = 'none';
backgroundMusic.volume = audioConfig.musicVolume;

const narrationAudio = new Audio();
narrationAudio.loop = false;
narrationAudio.preload = 'none';
narrationAudio.volume = audioConfig.narrationVolume;

/* =============================================================================
 *  MANIFESTE
 * ========================================================================== */

/** Fabrique un chemin complet à partir d'une entrée du manifeste. */
function _audioResolvePath(entry, folder) {
  if (!entry) return null;
  let name = null;
  let info = null;

  if (typeof entry === 'string') {
    name = entry;
  } else if (typeof entry === 'object') {
    name = entry.fichier || entry.file || entry.src || entry.path ||
           entry.chemin || entry.nom || entry.name || null;
    info = entry;
  }
  if (!name) return null;
  name = String(name).trim();
  if (!name) return null;

  // Chemin déjà complet (contient un dossier, une URL, ou part de la racine).
  const isAbsolute = /^([a-z]+:)?\/\//i.test(name) || name.charAt(0) === '/' || name.indexOf('/') >= 0;
  const dir = String(folder || '').replace(/\/*$/, '/');
  const path = isAbsolute ? name : dir + name;

  if (info) {
    audioConfig.trackInfo[path] = {
      titre: info.titre || info.title || null,
      gain: (typeof info.gain === 'number') ? _audioClamp01(info.gain) : 1
    };
  }
  return path;
}

/** Extrait une liste de pistes d'une section du manifeste, quelle que soit sa forme. */
function _audioReadSection(section, defaultFolder) {
  if (!section) return [];
  let list = null;
  let folder = defaultFolder;

  if (Array.isArray(section)) {
    list = section;
  } else if (typeof section === 'object') {
    folder = section.dossier || section.folder || section.dir || defaultFolder;
    list = section.pistes || section.tracks || section.files || section.fichiers ||
           section.liste || section.list || null;
  }
  if (!Array.isArray(list)) return [];

  const out = [];
  for (let i = 0; i < list.length; i++) {
    const p = _audioResolvePath(list[i], folder);
    if (p && out.indexOf(p) < 0) out.push(p);
  }
  return out;
}

/**
 * Charge assets/audio/manifest.json. UNE seule requête.
 * En cas d'absence (ou d'ouverture en file://), on n'émet AUCUNE erreur :
 * le jeu tourne parfaitement sans la moindre piste grâce à la nappe procédurale.
 */
function loadAudioManifest() {
  audioConfig.manifestError = null;


/* ---------------------------------------------------------------------------
 *  DÉCOUVERTE AUTOMATIQUE — « je dépose, ça marche »
 * ---------------------------------------------------------------------------
 *  La plupart des serveurs statiques (dont `python -m http.server`) renvoient
 *  la liste d'un dossier en HTML quand on le demande. UNE requête suffit donc
 *  à connaître son contenu — à comparer aux 2112 requêtes du sondage par force
 *  brute qui polluait la console de 404.
 *
 *  Le manifeste reste prioritaire : il permet de fixer un ordre, un titre ou un
 *  gain. Mais s'il est vide, on regarde simplement ce qu'il y a dans le
 *  dossier. Si le serveur n'expose pas d'index (hébergement statique fermé,
 *  GitHub Pages), on n'insiste pas : le manifeste reprend la main.
 * ------------------------------------------------------------------------- */
const AUDIO_EXT = ['.mp3', '.ogg', '.wav', '.m4a', '.aac', '.flac', '.opus', '.webm'];

function _audioScanDossier(dossier) {
  if (typeof fetch !== 'function') return Promise.resolve([]);
  return fetch(dossier, { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.text() : ''; })
    .then(function (html) {
      if (!html) return [];
      const noms = [];
      // On lit les href de l'index. `decodeURIComponent` restitue les accents
      // et les espaces, fréquents dans les noms de fichiers musicaux.
      const re = /href\s*=\s*["']([^"'?#]+)["']/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        let nom = m[1];
        if (nom.indexOf('/') !== -1) nom = nom.substring(nom.lastIndexOf('/') + 1);
        try { nom = decodeURIComponent(nom); } catch (e) { /* nom déjà lisible */ }
        if (!nom || nom.charAt(0) === '.') continue;
        const bas = nom.toLowerCase();
        for (let i = 0; i < AUDIO_EXT.length; i++) {
          if (bas.endsWith(AUDIO_EXT[i])) { if (noms.indexOf(nom) === -1) noms.push(nom); break; }
        }
      }
      noms.sort();
      return noms.map(function (n) { return dossier + n; });
    })
    .catch(function () { return []; });   // pas d'index exposé : silencieux
}

  if (typeof fetch !== 'function') {
    audioConfig.manifestLoaded = true;
    return Promise.resolve(false);
  }

  return fetch(audioConfig.manifestUrl, { cache: 'no-cache' })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (data) {
      const musique = _audioReadSection(
        data.musique || data.music || data.musiques,
        'assets/audio/musique/');
      const narration = _audioReadSection(
        data.narration || data.narrations || data.voix || data.voice,
        'assets/audio/narration/');

      // Le manifeste prime. S'il ne déclare rien, on regarde le dossier :
      // déposer un fichier suffit alors, sans rien avoir à écrire.
      const aScanner = [];
      aScanner.push(musique.length ? Promise.resolve(musique)
                                   : _audioScanDossier('assets/audio/musique/'));
      aScanner.push(narration.length ? Promise.resolve(narration)
                                     : _audioScanDossier('assets/audio/narration/'));

      return Promise.all(aScanner).then(function (res) {
        const mus = res[0] || [];
        const nar = res[1] || [];
        const scanMus = !musique.length && mus.length;
        const scanNar = !narration.length && nar.length;

        audioConfig.musicList = mus;
        audioConfig.narrationList = nar;
        audioConfig.playedMusicList = [];
        audioConfig.playedNarrationList = [];
        audioConfig.manifestLoaded = true;

        // Plusieurs pistes -> vraie playlist (enchaînement), sinon boucle.
        backgroundMusic.loop = (mus.length <= 1);

        console.log('[audio] ' + mus.length + ' piste(s) de musique' +
                    (scanMus ? ' (trouvées dans le dossier)' : '') + ', ' +
                    nar.length + ' narration(s)' +
                    (scanNar ? ' (trouvées dans le dossier)' : '') + '.');
        if (mus.length === 0) {
          console.log('[audio] aucune piste : la nappe procédurale prend le relais. ' +
                      'Déposez vos fichiers dans assets/audio/musique/ — ils seront ' +
                      'détectés automatiquement au prochain chargement.');
        }
        return true;
      });
    })
    .catch(function (err) {
      audioConfig.manifestLoaded = true;
      audioConfig.manifestError = String(err && err.message ? err.message : err);
      // Pas de manifeste = aucune piste connue. On vide les listes plutôt que
      // de garder d'anciennes entrées qui produiraient des erreurs de lecture.
      audioConfig.musicList = [];
      audioConfig.narrationList = [];
      audioConfig.playedMusicList = [];
      audioConfig.playedNarrationList = [];
      backgroundMusic.loop = true;
      // Volontairement en console.log : ce n'est PAS une anomalie, le jeu est
      // parfaitement jouable sans manifeste.
      console.log('[audio] pas de manifeste exploitable (' + audioConfig.manifestError +
                  ') — bruitages procéduraux uniquement.');
      return false;
    });
}

/* =============================================================================
 *  PONT VERS LE MOTEUR DE BRUITAGES
 * ========================================================================== */

function _sfx() {
  return (typeof SFX !== 'undefined' && SFX) ? SFX : null;
}

/** Pousse les réglages des curseurs vers les bus du moteur audio. */
function applyAudioSettings() {
  const s = _sfx();
  if (!s) return;
  try {
    s.setEnabled(audioConfig.soundEnabled);
    s.setSfxVolume(audioConfig.sfxVolume);
    s.setMusicVolume(audioConfig.musicVolume);
    s.setBedEnabled(audioConfig.proceduralMusic);
  } catch (e) { /* jamais bloquant */ }
}

/** Reprend le contexte audio (à appeler depuis un geste utilisateur). */
function unlockAudioContext() {
  const s = _sfx();
  if (!s) return false;
  let ok = false;
  try { ok = s.unlock(); } catch (e) { ok = false; }
  applyAudioSettings();
  return ok;
}

/** Route un élément <audio> dans le graphe Web Audio (ducking + limiteur). */
function _routeElement(el, kind) {
  if (!audioConfig.routeThroughWebAudio) return false;
  const s = _sfx();
  if (!s || !s.isReady || !s.isReady()) return false;
  try {
    return kind === 'voice' ? s.routeVoice(el) : s.routeMusic(el);
  } catch (e) { return false; }
}

/* =============================================================================
 *  FONDUS DE MUSIQUE
 *  Un SEUL fondu peut être actif : l'ancien code empilait des setInterval qui
 *  se battaient entre eux et laissaient régulièrement le volume bloqué à 0.
 * ========================================================================== */
let _musicFadeTimer = null;

function _setMusicElementVolume(v) {
  try { backgroundMusic.volume = _audioClamp01(v); } catch (e) { /* ignoré */ }
}

function _cancelMusicFade() {
  if (_musicFadeTimer) { clearInterval(_musicFadeTimer); _musicFadeTimer = null; }
}

/** Fondu du volume de la musique vers `target` en `ms`, puis `done()`. */
function fadeMusicTo(target, ms, done) {
  _cancelMusicFade();
  target = _audioClamp01(target);
  if (!audioConfig.useFadeEffects || !(ms > 0)) {
    _setMusicElementVolume(target);
    if (done) done();
    return;
  }
  const from = _audioClamp01(backgroundMusic.volume);
  if (Math.abs(from - target) < 0.005) {
    _setMusicElementVolume(target);
    if (done) done();
    return;
  }
  const t0 = _audioNow();
  _musicFadeTimer = setInterval(function () {
    const k = Math.min(1, (_audioNow() - t0) / ms);
    _setMusicElementVolume(from + (target - from) * k);
    if (k >= 1) {
      _cancelMusicFade();
      if (done) done();
    }
  }, 33);
}

/* =============================================================================
 *  LECTEUR DE MUSIQUE
 * ========================================================================== */
let _musicRetries = 0;

/** Volume cible d'une piste (curseur × gain déclaré dans le manifeste). */
function _targetMusicVolume(path) {
  const info = path ? audioConfig.trackInfo[path] : null;
  const gain = (info && typeof info.gain === 'number') ? info.gain : 1;
  return _audioClamp01(audioConfig.musicVolume * gain);
}

/** Retire une piste défaillante de la liste (elle ne sera plus jamais tentée). */
function _dropTrack(path) {
  audioConfig.musicList = audioConfig.musicList.filter(function (m) { return m !== path; });
  audioConfig.playedMusicList = audioConfig.playedMusicList.filter(function (m) { return m !== path; });
  if (audioConfig.currentMusic === path) audioConfig.currentMusic = null;
  backgroundMusic.loop = (audioConfig.musicList.length <= 1);
}

/** Choisit une piste non encore jouée dans le cycle courant (rotation équitable). */
function _pickNextTrack(exclude) {
  const all = audioConfig.musicList;
  if (all.length === 0) return null;
  if (all.length === 1) return all[0];

  let pool = all.filter(function (m) {
    return audioConfig.playedMusicList.indexOf(m) < 0 && m !== exclude;
  });
  if (pool.length === 0) {
    // Cycle terminé : on repart, en évitant simplement de répéter la piste courante.
    audioConfig.playedMusicList = [];
    pool = all.filter(function (m) { return m !== exclude; });
    if (pool.length === 0) pool = all;
  }
  return pool[(Math.random() * pool.length) | 0];
}

function _markPlayed(path) {
  if (path && audioConfig.playedMusicList.indexOf(path) < 0) {
    audioConfig.playedMusicList.push(path);
  }
}

// Jeton de lecture : identifie la demande de lecture courante. Sert à ignorer
// les rappels tardifs d'une piste qui a déjà été remplacée.
let _musicToken = 0;

/** Démarre une piste précise. `fadeIn` = fondu d'entrée. */
function _startTrack(path, fadeIn) {
  if (!path) return false;
  _cancelMusicFade();
  _musicToken++;
  const token = _musicToken;

  const target = _targetMusicVolume(path);
  try {
    backgroundMusic.pause();
    backgroundMusic.src = path;
    backgroundMusic.preload = 'auto';
    backgroundMusic.currentTime = 0;
  } catch (e) { /* certains navigateurs râlent sur currentTime avant chargement */ }

  _setMusicElementVolume(fadeIn && audioConfig.useFadeEffects ? 0 : target);
  _routeElement(backgroundMusic, 'music');

  const p = backgroundMusic.play();
  if (p && p.then) {
    p.then(function () {
      _musicRetries = 0;
      audioConfig.currentMusic = path;
      _markPlayed(path);
      if (fadeIn && audioConfig.useFadeEffects) fadeMusicTo(target, audioConfig.musicFadeMs);
    }).catch(function (err) {
      if (err && err.name === 'NotAllowedError') {
        // Pas encore de geste utilisateur : on réessaiera au déverrouillage.
        audioConfig.currentMusic = null;
        return;
      }
      console.warn('[audio] lecture impossible : ' + path, err && err.name);
      _dropTrack(path);
      if (_musicRetries++ < 3) playRandomMusic();
    });
  } else {
    audioConfig.currentMusic = path;
    _markPlayed(path);
  }

  // FILET DE SÉCURITÉ. Le fondu d'entrée est déclenché par la promesse de
  // play(). Si un navigateur ne la tient jamais alors que la lecture a bien
  // démarré, la musique resterait muette pour toujours (volume figé à 0).
  // On vérifie donc une fois, après la durée du fondu, que le volume est
  // bien remonté — et on le remonte sinon.
  if (fadeIn && audioConfig.useFadeEffects) {
    setTimeout(function () {
      if (token !== _musicToken) return;      // une autre piste a pris la main
      if (_musicFadeTimer) return;            // un fondu est déjà en cours
      if (backgroundMusic.paused) return;     // rien ne joue : rien à corriger
      const t = _targetMusicVolume(path);
      if (t > 0.01 && backgroundMusic.volume < t * 0.05) {
        audioConfig.currentMusic = path;
        _markPlayed(path);
        fadeMusicTo(t, 220);
      }
    }, audioConfig.musicFadeMs + 500);
  }
  return true;
}

/** Joue une piste aléatoire. Retourne false si aucune piste n'est disponible. */
function playRandomMusic() {
  if (!audioConfig.soundEnabled) return false;
  if (audioConfig.musicList.length === 0) return false;  // la nappe procédurale assure
  const path = _pickNextTrack(null);
  if (!path) return false;
  return _startTrack(path, true);
}

/** Passe à une autre piste, avec fondu de sortie puis fondu d'entrée. */
function changeRandomMusic() {
  if (!audioConfig.soundEnabled) return false;
  if (audioConfig.musicList.length === 0) return false;

  const next = _pickNextTrack(audioConfig.currentMusic);
  if (!next || next === audioConfig.currentMusic) return false;

  if (backgroundMusic.paused || !audioConfig.currentMusic) {
    return _startTrack(next, true);
  }
  fadeMusicTo(0, audioConfig.musicFadeMs, function () {
    _startTrack(next, true);
  });
  return true;
}

/** Arrête la musique (avec fondu si demandé). */
function stopMusic(fade) {
  if (fade && audioConfig.useFadeEffects) {
    fadeMusicTo(0, audioConfig.musicFadeMs, function () {
      try { backgroundMusic.pause(); } catch (e) { /* ignoré */ }
    });
  } else {
    _cancelMusicFade();
    try { backgroundMusic.pause(); } catch (e) { /* ignoré */ }
  }
}

// Enchaînement de playlist : quand une piste se termine (loop = false parce
// qu'il y a plusieurs pistes), on passe à la suivante.
backgroundMusic.addEventListener('ended', function () {
  if (!audioConfig.soundEnabled) return;
  if (audioConfig.musicList.length > 1) playRandomMusic();
});

backgroundMusic.addEventListener('error', function () {
  const path = audioConfig.currentMusic;
  if (!path) return;
  console.warn('[audio] piste illisible, retirée de la liste : ' + path);
  _dropTrack(path);
  if (_musicRetries++ < 3) playRandomMusic();
});

/* =============================================================================
 *  NARRATION
 * ========================================================================== */
let _narrationDucking = false;

function _duckMusicForNarration() {
  if (!audioConfig.autoAdjustVolume) return;
  if (_narrationDucking) return;
  if (backgroundMusic.paused || !audioConfig.currentMusic) return;
  _narrationDucking = true;
  // On mémorise le volume CIBLE, jamais le volume instantané : c'est ce qui
  // laissait la musique bloquée à 0 quand une narration démarrait pendant un fondu.
  audioConfig.originalMusicVolume = _targetMusicVolume(audioConfig.currentMusic);
  fadeMusicTo(audioConfig.originalMusicVolume * 0.25, 260);
}

function _restoreMusicAfterNarration() {
  if (!_narrationDucking) return;
  _narrationDucking = false;
  fadeMusicTo(_targetMusicVolume(audioConfig.currentMusic), 420);
}

function _pickNextNarration(exclude) {
  const all = audioConfig.narrationList;
  if (all.length === 0) return null;
  if (all.length === 1) return all[0];

  let pool = all.filter(function (n) {
    return audioConfig.playedNarrationList.indexOf(n) < 0 && n !== exclude;
  });
  if (pool.length === 0) {
    audioConfig.playedNarrationList = [];
    pool = all.filter(function (n) { return n !== exclude; });
    if (pool.length === 0) pool = all;
  }
  return pool[(Math.random() * pool.length) | 0];
}

/**
 * Joue une narration aléatoire.
 * @returns {boolean} true SEULEMENT si une narration a réellement été lancée.
 *   (input.js n'affiche sa notification que dans ce cas : plus de « Narration
 *    déclenchée » mensonger quand il n'y a aucun fichier.)
 */
function playRandomNarration(forceNew) {
  if (!audioConfig.soundEnabled) return false;
  if (audioConfig.narrationList.length === 0) return false;

  const busy = audioConfig.currentNarration && !narrationAudio.paused && !narrationAudio.ended;
  if (busy && !forceNew) return false;

  if (busy && forceNew) {
    try { narrationAudio.pause(); } catch (e) { /* ignoré */ }
  }

  const path = _pickNextNarration(audioConfig.currentNarration);
  if (!path) return false;

  _duckMusicForNarration();

  try {
    narrationAudio.src = path;
    narrationAudio.currentTime = 0;
  } catch (e) { /* ignoré */ }
  try { narrationAudio.volume = _audioClamp01(audioConfig.narrationVolume); } catch (e) { /* ignoré */ }
  _routeElement(narrationAudio, 'voice');

  const p = narrationAudio.play();
  if (p && p.then) {
    p.then(function () {
      audioConfig.currentNarration = path;
      if (audioConfig.playedNarrationList.indexOf(path) < 0) {
        audioConfig.playedNarrationList.push(path);
      }
    }).catch(function (err) {
      _restoreMusicAfterNarration();
      audioConfig.currentNarration = null;
      if (err && err.name !== 'NotAllowedError') {
        console.warn('[audio] narration illisible, retirée de la liste : ' + path);
        audioConfig.narrationList = audioConfig.narrationList.filter(function (n) { return n !== path; });
      }
      // AUCUN bonus ici : un échec ne rapporte rien (ancien bug de score infini).
    });
  } else {
    audioConfig.currentNarration = path;
  }
  return true;
}

narrationAudio.addEventListener('ended', function () {
  _restoreMusicAfterNarration();
  // SEUL endroit où le bonus est accordé : la narration a été écoutée en entier.
  applyNarrationBonus('Bonus Narration');
  audioConfig.currentNarration = null;
});

narrationAudio.addEventListener('error', function () {
  _restoreMusicAfterNarration();
  const path = audioConfig.currentNarration;
  audioConfig.currentNarration = null;
  if (path) {
    console.warn('[audio] narration illisible, retirée de la liste : ' + path);
    audioConfig.narrationList = audioConfig.narrationList.filter(function (n) { return n !== path; });
  }
});

/** Déclenche une narration (touche N). Retourne true si une narration est partie. */
function triggerRandomNarration() {
  return playRandomNarration(true);
}

/* -----------------------------------------------------------------------------
 *  BONUS DE NARRATION
 *  ⚠ CORRECTION DE BUG : l'ancienne version appelait cette fonction sur CHAQUE
 *  chemin d'échec (son désactivé, liste vide, fichier illisible, exception…).
 *  Résultat : maintenir la touche N rapportait +100 points par pression, sans
 *  qu'aucun son ne soit joué. Le bonus est désormais réservé à une narration
 *  réellement écoutée jusqu'au bout, et protégé par un délai de garde.
 * -------------------------------------------------------------------------- */
let _lastNarrationBonusAt = -1e9;

function applyNarrationBonus(message) {
  if (typeof gameState !== 'undefined' && gameState !== 'playing') return false;

  const t = _audioNow();
  if (t - _lastNarrationBonusAt < 5000) return false;   // anti-abus
  _lastNarrationBonusAt = t;

  const points = audioConfig.narrationPoints;
  try {
    if (typeof score === 'number') score += points;
  } catch (e) { return false; }

  try {
    if (typeof scorePopups !== 'undefined' && scorePopups) {
      scorePopups.push({
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT / 2 - 50,
        points: points,
        basePoints: points,
        multiplier: 1,
        text: (message || 'Bonus') + ': +' + points,
        lifetime: 2.0,
        dy: -1,
        color: (typeof PALETTE !== 'undefined' && PALETTE.ui) ? PALETTE.ui.combo : '#ffd166'
      });
    }
  } catch (e) { /* purement cosmétique */ }
  return true;
}

/* =============================================================================
 *  RÉGLAGES (curseurs de index.html, câblés par input.js)
 * ========================================================================== */
function _setLabel(id, value) {
  try {
    const el = document.getElementById(id);
    if (el) el.textContent = value + '%';
  } catch (e) { /* ignoré */ }
}

function updateMusicVolume(value) {
  const volume = _audioClamp01(Number(value) / 100);
  audioConfig.musicVolume = volume;
  _cancelMusicFade();                       // un réglage manuel gagne sur un fondu
  _setMusicElementVolume(_narrationDucking ? volume * 0.25 : _targetMusicVolume(audioConfig.currentMusic));
  _audioPersist('musicVolume', volume);
  _setLabel('musicVolumeValue', Math.round(volume * 100));
  const s = _sfx();
  if (s) { try { s.setMusicVolume(volume); } catch (e) { /* ignoré */ } }
}

function updateNarrationVolume(value) {
  const volume = _audioClamp01(Number(value) / 100);
  audioConfig.narrationVolume = volume;
  try { narrationAudio.volume = volume; } catch (e) { /* ignoré */ }
  _audioPersist('narrationVolume', volume);
  _setLabel('narrationVolumeValue', Math.round(volume * 100));
}

/** ⚠ Ce curseur ne pilotait RIEN avant : il est maintenant branché sur le bus
 *  des bruitages du moteur procédural. */
let _lastSfxPreviewAt = -1e9;

function updateSFXVolume(value) {
  const volume = _audioClamp01(Number(value) / 100);
  audioConfig.sfxVolume = volume;
  _audioPersist('sfxVolume', volume);
  _setLabel('sfxVolumeValue', Math.round(volume * 100));
  const s = _sfx();
  if (s) {
    try {
      s.setSfxVolume(volume);
      // Retour immédiat : on ENTEND ce qu'on règle en bougeant le curseur.
      // (espacé de 140 ms, sinon un glissé de curseur mitraille des clics)
      const t = _audioNow();
      if (volume > 0 && t - _lastSfxPreviewAt > 140 && s.isUnlocked && s.isUnlocked()) {
        _lastSfxPreviewAt = t;
        s.play('enemyHit', { type: 'normal' });
      }
    } catch (e) { /* ignoré */ }
  }
}

function toggleAudioControls() {
  try {
    const controls = document.getElementById('volumeControls');
    if (!controls) return;
    const visible = controls.style.display === 'block';
    controls.style.display = visible ? 'none' : 'block';
  } catch (e) { /* ignoré */ }
}

/* =============================================================================
 *  ACTIVATION DU SON
 * ========================================================================== */
/**
 * Active le son du jeu. Appelée par le bouton du menu (input.js) et par le
 * premier geste utilisateur. Plus aucune alerte bloquante : l'absence de piste
 * n'est pas une erreur, la nappe procédurale prend le relais.
 */
function enableGameAudio() {
  audioConfig.soundEnabled = true;
  _audioPersist('soundEnabled', 'true');

  unlockAudioContext();

  try { backgroundMusic.volume = _targetMusicVolume(audioConfig.currentMusic); } catch (e) { /* ignoré */ }
  try { narrationAudio.volume = audioConfig.narrationVolume; } catch (e) { /* ignoré */ }

  if (audioConfig.musicList.length > 0 && (backgroundMusic.paused || !audioConfig.currentMusic)) {
    playRandomMusic();
  }
  return true;
}

/* -----------------------------------------------------------------------------
 *  DÉVERROUILLAGE AU PREMIER GESTE
 *  Les navigateurs exigent une interaction avant tout son. On écoute une fois,
 *  on déverrouille, on démarre la musique si le propriétaire en a déposé.
 * -------------------------------------------------------------------------- */
let _audioGestureArmed = false;

function _armAudioGesture() {
  if (_audioGestureArmed) return;
  _audioGestureArmed = true;

  const events = ['pointerdown', 'mousedown', 'touchstart', 'keydown'];
  const onGesture = function () {
    const ok = unlockAudioContext();
    if (audioConfig.soundEnabled && audioConfig.musicList.length > 0 &&
        (backgroundMusic.paused || !audioConfig.currentMusic)) {
      playRandomMusic();
    }
    if (ok) {
      for (let i = 0; i < events.length; i++) {
        window.removeEventListener(events[i], onGesture, true);
      }
    }
  };
  for (let i = 0; i < events.length; i++) {
    window.addEventListener(events[i], onGesture, true);
  }
}

/* =============================================================================
 *  INITIALISATION — appelée par bootAudio() dans main.js, APRÈS le 1er rendu.
 *  Ne bloque RIEN : retour immédiat, le manifeste arrive quand il arrive.
 * ========================================================================== */
function initAudioLists() {
  applyAudioSettings();
  _armAudioGesture();

  // Synchronise les libellés des curseurs avec les valeurs persistées.
  _setLabel('musicVolumeValue', Math.round(audioConfig.musicVolume * 100));
  _setLabel('narrationVolumeValue', Math.round(audioConfig.narrationVolume * 100));
  _setLabel('sfxVolumeValue', Math.round(audioConfig.sfxVolume * 100));

  loadAudioManifest().then(function () {
    audioFilesReady = true;
    applyAudioSettings();
    // Si le contexte est déjà déverrouillé (l'utilisateur a cliqué avant que le
    // manifeste n'arrive), on lance la musique tout de suite.
    const s = _sfx();
    if (audioConfig.soundEnabled && audioConfig.musicList.length > 0 &&
        s && s.isReady && s.isReady() && backgroundMusic.paused) {
      playRandomMusic();
    }
  });

  return true;
}

/* -----------------------------------------------------------------------------
 *  Vérification ponctuelle d'un fichier (conservée pour compatibilité).
 *  Une SEULE requête, sur un chemin précis. Plus aucun sondage en masse.
 * -------------------------------------------------------------------------- */
function isAudioFilePlayable(filePath) {
  return new Promise(function (resolve) {
    if (!filePath || typeof fetch !== 'function') { resolve(false); return; }
    fetch(filePath, { method: 'HEAD' })
      .then(function (r) { resolve(!!r.ok); })
      .catch(function () { resolve(false); });
  });
}

/* -----------------------------------------------------------------------------
 *  Mise en arrière-plan : on met la musique en pause plutôt que de la laisser
 *  tourner dans le vide (le jeu, lui, est déjà mis en pause par main.js).
 * -------------------------------------------------------------------------- */
document.addEventListener('visibilitychange', function () {
  try {
    if (document.hidden) {
      if (!backgroundMusic.paused) {
        backgroundMusic.__resumeOnReturn = true;
        backgroundMusic.pause();
      }
    } else if (backgroundMusic.__resumeOnReturn) {
      backgroundMusic.__resumeOnReturn = false;
      if (audioConfig.soundEnabled) {
        const p = backgroundMusic.play();
        if (p && p.catch) p.catch(function () { /* ignoré */ });
      }
    }
  } catch (e) { /* ignoré */ }
});
