/* =============================================================================
 *  galabob — SFX : moteur de bruitages 100 % PROCÉDURAL  (objet global `SFX`)
 * -----------------------------------------------------------------------------
 *  ZÉRO fichier audio, ZÉRO dépendance. Tout est synthétisé à la volée en
 *  Web Audio. Esthétique : arcade néon — sweeps courts, bruit filtré, sub bien
 *  présent, aucune queue de réverbération (le jeu doit rester SEC et NERVEUX).
 *
 *  GRAPHE
 *  ------
 *      [bruitages] ──────────────► sfxBus ──┐
 *      [nappe procédurale] ► bedBus ─┐      │
 *      [pistes du propriétaire] ─────┴► musicBus ► duck ──┤
 *      [narration] ─────────────────────────────► voiceBus┤
 *                                                         ▼
 *                                       compresseur/limiteur ► master ► sortie
 *
 *  Le compresseur est un VRAI limiteur de sécurité : quand 20 ennemis explosent
 *  en même temps, ça compresse au lieu de saturer. Il y a EN PLUS un budget de
 *  voix (26 max, atténuation douce au-delà de 15) et un anti-répétition par son.
 *
 *  POLITIQUE AUTOPLAY
 *  ------------------
 *  L'AudioContext n'est créé qu'au PREMIER GESTE UTILISATEUR (clic, touche,
 *  toucher) : aucun contexte suspendu, donc aucun avertissement console.
 *  Les écouteurs sont installés par ce fichier lui-même, personne n'a rien à
 *  brancher.
 *
 *  PONT AVEC LE JEU
 *  ----------------
 *  game.js appelle `gameEvent(name, data)` qui appelle `SFX.play(name, data)`.
 *  Aucun couplage : si ce fichier n'est pas chargé, le jeu tourne en silence.
 *  Les noms sont normalisés (minuscules, sans . _ -), donc 'playerShot',
 *  'player_shot' et 'PLAYERSHOT' déclenchent le même son.
 *
 *  API PUBLIQUE
 *  ------------
 *    SFX.play(name, data)         point d'entrée unique du jeu
 *    SFX.unlock()                 reprend le contexte (appelé sur geste)
 *    SFX.isReady()                bool
 *    SFX.setSfxVolume(v)          0..1 — curseur « Effets sonores »
 *    SFX.setMusicVolume(v)        0..1 — curseur « Musique » (nappe + pistes)
 *    SFX.setEnabled(bool)         coupe/rétablit tout
 *    SFX.setBedEnabled(bool)      coupe/rétablit la nappe procédurale
 *    SFX.duck(amount, ms)         baisse temporairement la musique
 *    SFX.routeMusic(audioEl)      route un <audio> vers le bus musique
 *    SFX.routeVoice(audioEl)      route un <audio> vers le bus voix
 *    SFX.pulse(amount)            pousse l'intensité de la nappe
 *    SFX.state()                  diagnostic
 * ========================================================================== */

const SFX = (function () {
  'use strict';

  const AC = window.AudioContext || window.webkitAudioContext;

  /* ------------------------------------------------------------- réglages */
  const config = {
    master: 0.92,
    sfx: 0.7,          // piloté par le curseur « Effets sonores »
    music: 0.5,        // piloté par le curseur « Musique »
    bed: 0.55,         // niveau propre de la nappe procédurale
    enabled: true,
    bedEnabled: true,
    maxVoices: 26,     // au-delà : le son est REFUSÉ
    softVoices: 15     // au-delà : le son est ATTÉNUÉ (évite la bouillie)
  };

  const S = {
    ctx: null,
    master: null, comp: null,
    sfxBus: null, musicBus: null, voiceBus: null, duck: null, bedBus: null,
    noiseBuf: null,
    unlocked: false,
    voices: 0,
    last: Object.create(null),
    routed: (typeof WeakSet === 'function') ? new WeakSet() : null,
    hiddenDim: 1
  };

  /* --------------------------------------------------------------- outils */
  function noop() {}
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pickOne(arr) { return arr[(Math.random() * arr.length) | 0]; }
  /** Fréquence d'une note MIDI (69 = La 440). */
  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
  }
  /* ---------------------------------------------------------------------------
   *  Lecture DÉFENSIVE de l'état du jeu.
   *  ⚠ Les globales du jeu sont déclarées avec `let`/`const` au niveau du script :
   *  elles n'existent donc PAS sur `window`. On y accède par identifiant, avec un
   *  garde `typeof` (les modules concernés sont chargés après ce fichier, mais
   *  toutes ces lectures ont lieu à l'exécution, jamais au chargement).
   * ------------------------------------------------------------------------ */
  function readGameState() {
    try { return (typeof gameState !== 'undefined') ? gameState : 'menu'; }
    catch (e) { return 'menu'; }
  }
  function readPaused() {
    try { return (typeof isPaused !== 'undefined') ? !!isPaused : false; }
    catch (e) { return false; }
  }
  function readStage() {
    try {
      return (typeof stageSystem !== 'undefined' && stageSystem &&
              typeof stageSystem.currentStage === 'number') ? stageSystem.currentStage : 1;
    } catch (e) { return 1; }
  }
  function readCombo() {
    try { return (typeof comboCount === 'number') ? comboCount : 0; }
    catch (e) { return 0; }
  }
  function readLives() {
    try {
      return (typeof player !== 'undefined' && player && typeof player.lives === 'number')
        ? player.lives : 3;
    } catch (e) { return 3; }
  }
  function readMusicElement() {
    try { return (typeof backgroundMusic !== 'undefined') ? backgroundMusic : null; }
    catch (e) { return null; }
  }

  /* ------------------------------------------------------- budget de voix */
  /** @returns {number|null} facteur de gain, ou null si la voix est refusée. */
  function alloc() {
    if (S.voices >= config.maxVoices) return null;
    S.voices++;
    return S.voices > config.softVoices ? 0.5 : 1;
  }
  function watch(node, seconds) {
    let done = false;
    const release = function () { if (done) return; done = true; if (S.voices > 0) S.voices--; };
    try { node.onended = release; } catch (e) { /* ignoré */ }
    setTimeout(release, Math.max(60, seconds * 1000 + 280));
  }

  /** Anti-répétition : true si le son `key` a déjà joué il y a moins de `minMs`. */
  function tooSoon(key, minMs) {
    const t = nowMs();
    const last = S.last[key];
    if (last !== undefined && t - last < minMs) return true;
    S.last[key] = t;
    return false;
  }

  /* --------------------------------------------------------------- graphe */
  function makeNoise(ac, seconds) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    // Bruit blanc légèrement lissé : moins agressif dans les aigus que du
    // Math.random() brut, plus « souffle » que « friture ».
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      prev = prev * 0.22 + w * 0.78;
      d[i] = prev;
    }
    return buf;
  }

  function buildGraph(ac) {
    const master = ac.createGain();
    master.gain.value = config.master;

    // Limiteur de sécurité : c'est lui qui encaisse les gerbes d'explosions.
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -13;
    comp.knee.value = 14;
    comp.ratio.value = 11;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;

    const sfxBus = ac.createGain();   sfxBus.gain.value = config.sfx;
    const musicBus = ac.createGain(); musicBus.gain.value = 1;
    const voiceBus = ac.createGain(); voiceBus.gain.value = 1;
    const duck = ac.createGain();     duck.gain.value = 1;
    const bedBus = ac.createGain();   bedBus.gain.value = 0.0001;

    sfxBus.connect(comp);
    bedBus.connect(musicBus);
    musicBus.connect(duck);
    duck.connect(comp);
    voiceBus.connect(comp);           // la voix ne subit pas le ducking
    comp.connect(master);
    master.connect(ac.destination);

    S.master = master; S.comp = comp;
    S.sfxBus = sfxBus; S.musicBus = musicBus; S.voiceBus = voiceBus;
    S.duck = duck; S.bedBus = bedBus;
  }

  function ensure() {
    if (S.ctx) return S.ctx;
    if (!AC || !S.unlocked) return null;
    try {
      const ac = new AC();
      buildGraph(ac);
      S.noiseBuf = makeNoise(ac, 2);
      S.ctx = ac;
      if (ac.state !== 'running' && ac.resume) ac.resume().catch(noop);
      startBed();
    } catch (e) {
      console.warn('[SFX] AudioContext indisponible :', e);
      return null;
    }
    return S.ctx;
  }

  function live() {
    if (!config.enabled) return null;
    const ac = ensure();
    if (!ac) return null;
    if (ac.state === 'suspended' && ac.resume) ac.resume().catch(noop);
    return ac;
  }

  /* ------------------------------------------------------- enveloppes/vox */
  /** Enveloppe percussive : 0 → peak en `attack`, puis descente exp jusqu'à `dur`. */
  function env(param, t0, attack, dur, peak) {
    const p = Math.max(0.0005, peak);
    const a = Math.max(0.0012, attack);
    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(p, t0 + a);
    param.exponentialRampToValueAtTime(0.0001, t0 + Math.max(a + 0.012, dur));
  }

  /** Filtre biquad avec balayage de fréquence optionnel (f0 -> f1 sur `dur`). */
  function makeFilter(ac, t0, dur, f) {
    const bq = ac.createBiquadFilter();
    bq.type = f.type || 'lowpass';
    const nyq = ac.sampleRate * 0.5 - 100;
    const f0 = clamp(f.f0 || 1200, 30, nyq);
    const f1 = clamp(f.f1 == null ? f0 : f.f1, 30, nyq);
    bq.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(f1, t0 + Math.max(0.02, dur));
    if (f.q != null) bq.Q.value = f.q;
    return bq;
  }

  /**
   * Oscillateur enveloppé.
   * o = {type,f0,f1,dur,attack,gain,dest,delay,filter,detune,lin,t}
   */
  function tone(o) {
    const ac = S.ctx;
    if (!ac) return;
    const lvl = alloc();
    if (lvl === null) return;
    const t0 = (o.t || ac.currentTime) + (o.delay || 0);
    const dur = o.dur || 0.15;
    const osc = ac.createOscillator();
    osc.type = o.type || 'sine';
    const f0 = Math.max(20, o.f0 || 440);
    const f1 = Math.max(20, o.f1 == null ? f0 : o.f1);
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) {
      if (o.lin) osc.frequency.linearRampToValueAtTime(f1, t0 + dur);
      else osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    }
    if (o.detune) osc.detune.setValueAtTime(o.detune, t0);

    let node = osc;
    if (o.filter) { const bq = makeFilter(ac, t0, dur, o.filter); node.connect(bq); node = bq; }

    const gain = ac.createGain();
    env(gain.gain, t0, o.attack == null ? 0.004 : o.attack, dur, (o.gain == null ? 0.2 : o.gain) * lvl);
    node.connect(gain);
    gain.connect(o.dest || S.sfxBus);

    osc.start(t0);
    osc.stop(t0 + dur + 0.06);
    watch(osc, dur + (o.delay || 0) + 0.1);
  }

  /**
   * Rafale de bruit enveloppée.
   * o = {dur,attack,gain,dest,delay,filter,rate,t}
   */
  function noise(o) {
    const ac = S.ctx;
    if (!ac || !S.noiseBuf) return;
    const lvl = alloc();
    if (lvl === null) return;
    const t0 = (o.t || ac.currentTime) + (o.delay || 0);
    const dur = o.dur || 0.15;

    const src = ac.createBufferSource();
    src.buffer = S.noiseBuf;
    src.playbackRate.value = o.rate || rnd(0.9, 1.1);
    // Départ aléatoire dans le buffer : deux explosions ne sont jamais
    // exactement le même grain de bruit.
    const off = Math.random() * Math.max(0.01, S.noiseBuf.duration - dur - 0.05);

    let node = src;
    if (o.filter) { const bq = makeFilter(ac, t0, dur, o.filter); node.connect(bq); node = bq; }

    const gain = ac.createGain();
    env(gain.gain, t0, o.attack == null ? 0.003 : o.attack, dur, (o.gain == null ? 0.2 : o.gain) * lvl);
    node.connect(gain);
    gain.connect(o.dest || S.sfxBus);

    src.start(t0, off, dur + 0.08);
    src.stop(t0 + dur + 0.08);
    watch(src, dur + (o.delay || 0) + 0.12);
  }

  /* ------------------------------------------------------------- DUCKING */
  /** Baisse la musique de `amount` (0..1) puis la remonte en `ms`. */
  function duck(amount, ms) {
    const ac = S.ctx;
    if (!ac || !S.duck) return;
    const t = ac.currentTime;
    const target = clamp(1 - (amount || 0.25), 0.12, 1);
    const p = S.duck.gain;
    try {
      p.cancelScheduledValues(t);
      p.setValueAtTime(Math.max(0.0001, p.value), t);
      p.linearRampToValueAtTime(target, t + 0.025);
      p.linearRampToValueAtTime(1, t + Math.max(0.12, (ms || 280) / 1000));
    } catch (e) { /* ignoré */ }
  }

  /* =========================================================================
   *  RECETTES DE SONS
   *  Chaque son est LÉGÈREMENT randomisé (hauteur, filtre, durée) pour ne
   *  jamais lasser à la répétition.
   * ====================================================================== */

  /** Tir du joueur — sweep descendant très court et claquant. */
  function playerShot(data) {
    if (!live()) return;
    if (tooSoon('shot', 38)) return;
    const weapon = (data && data.weapon) || 'normal';
    const t = S.ctx.currentTime;
    const p = rnd(0.94, 1.07);

    if (weapon === 'spread') {
      tone({ t: t, type: 'sawtooth', f0: 2000 * p, f1: 520 * p, dur: 0.085, attack: 0.002, gain: 0.20,
             filter: { type: 'lowpass', f0: 5200, f1: 1400, q: 1.1 } });
      tone({ t: t, type: 'square', f0: 1350 * p, f1: 420 * p, dur: 0.07, attack: 0.002, gain: 0.12, detune: 9 });
      noise({ t: t, dur: 0.035, gain: 0.16, filter: { type: 'highpass', f0: 2600, f1: 4200, q: 0.8 } });
    } else if (weapon === 'double') {
      tone({ t: t, type: 'square', f0: 1650 * p, f1: 360 * p, dur: 0.075, attack: 0.0015, gain: 0.19,
             filter: { type: 'lowpass', f0: 3600, f1: 1100, q: 1.2 } });
      tone({ t: t, delay: 0.012, type: 'square', f0: 1420 * p, f1: 330 * p, dur: 0.07, attack: 0.0015, gain: 0.13, detune: -14 });
      tone({ t: t, type: 'sine', f0: 520 * p, f1: 140, dur: 0.075, attack: 0.001, gain: 0.16 });
    } else {
      tone({ t: t, type: 'square', f0: 1620 * p, f1: 330 * p, dur: 0.07, attack: 0.0015, gain: 0.20,
             filter: { type: 'lowpass', f0: rnd(3000, 3800), f1: 1000, q: 1.3 } });
      tone({ t: t, type: 'sine', f0: 480 * p, f1: 130, dur: 0.065, attack: 0.001, gain: 0.15 });
      noise({ t: t, dur: 0.024, gain: 0.10, filter: { type: 'highpass', f0: 2200, f1: 3400, q: 0.7 } });
    }
    pulse(0.015);
  }

  /** Impact sur un ennemi — clic sec et brillant, pas de corps. */
  function enemyHit(data) {
    if (!live()) return;
    if (tooSoon('hit', 22)) return;
    const t = S.ctx.currentTime;
    const type = (data && data.type) || 'normal';
    const bright = type === 'fast' ? 1.25 : (type === 'shooter' ? 0.85 : 1);
    noise({ t: t, dur: 0.036, gain: 0.20,
            filter: { type: 'bandpass', f0: rnd(3000, 4600) * bright, f1: rnd(1800, 2600) * bright, q: 5 } });
    tone({ t: t, type: 'triangle', f0: rnd(1700, 2200) * bright, f1: rnd(900, 1200) * bright,
           dur: 0.05, attack: 0.001, gain: 0.13 });
  }

  /**
   * Explosion — rafale de bruit filtré + sub.
   * size : 0.6 (petit ennemi) → 1.4 (gros / ram)
   */
  function explosion(size, type, extra) {
    if (!live()) return;
    const t = S.ctx.currentTime;
    const s = clamp(size || 1, 0.35, 1.7);
    const dur = 0.19 + s * 0.30;
    const tint = type === 'fast' ? 1.3 : (type === 'shooter' ? 0.85 : 1);

    // Corps : bruit large qui s'assombrit en tombant.
    noise({ t: t, dur: dur, attack: 0.004, gain: 0.34 * (0.7 + s * 0.35),
            filter: { type: 'lowpass', f0: rnd(1900, 2900) * tint / (0.8 + s * 0.35), f1: rnd(90, 150), q: 1.4 } });

    // Résonance de coque : donne un timbre différent selon le type d'ennemi.
    noise({ t: t, dur: dur * 0.55, attack: 0.003, gain: 0.13,
            filter: { type: 'bandpass', f0: rnd(700, 1400) * tint, f1: rnd(220, 420) * tint, q: 3.5 } });

    // Sub : c'est lui qui donne le coup dans le ventre.
    tone({ t: t, type: 'sine', f0: rnd(115, 155) / (0.85 + s * 0.25), f1: 34,
           dur: dur * 0.85, attack: 0.002, gain: 0.30 * (0.6 + s * 0.5) });

    // Crépitement de débris pour les grosses explosions.
    if (s > 0.75) {
      const n = 2 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        noise({ t: t, delay: rnd(0.03, 0.16) * s, dur: rnd(0.02, 0.045), gain: 0.07,
                filter: { type: 'bandpass', f0: rnd(1400, 3800), q: 6 } });
      }
    }
    if (extra !== false && s > 1) duck(0.18 * s, 260);
    pulse(0.05 * s);
  }

  function enemyKill(data) {
    const type = (data && data.type) || 'normal';
    const combo = (data && data.combo) || 1;
    if (tooSoon('kill', 16)) { explosion(0.55, type, false); return; }
    explosion(0.75 + clamp(combo, 1, 8) * 0.055, type);
  }

  /** Collision corps-à-corps : explosion + froissement métallique. */
  function ramKill(data) {
    if (!live()) return;
    explosion(1.25, (data && data.type) || 'normal');
    const t = S.ctx.currentTime;
    noise({ t: t, dur: 0.16, attack: 0.001, gain: 0.20,
            filter: { type: 'bandpass', f0: rnd(1600, 2400), f1: rnd(600, 900), q: 9 } });
    tone({ t: t, type: 'sawtooth', f0: rnd(300, 380), f1: 70, dur: 0.24, attack: 0.001, gain: 0.16,
           filter: { type: 'lowpass', f0: 2400, f1: 400, q: 2 } });
  }

  /** Tir ennemi — timbre SOURD, à l'opposé du tir joueur (lisibilité). */
  function enemyShot(data) {
    if (!live()) return;
    if (tooSoon('eshot', 40)) return;
    const t = S.ctx.currentTime;
    const type = (data && data.type) || 'normal';
    const p = rnd(0.9, 1.12) * (type === 'shooter' ? 1.15 : 1);
    tone({ t: t, type: 'triangle', f0: 560 * p, f1: 210 * p, dur: 0.13, attack: 0.003, gain: 0.16,
           filter: { type: 'lowpass', f0: rnd(700, 1100), f1: rnd(300, 500), q: 2.2 } });
    tone({ t: t, type: 'square', f0: 280 * p, f1: 120 * p, dur: 0.1, attack: 0.004, gain: 0.07 });
    noise({ t: t, dur: 0.05, gain: 0.07, filter: { type: 'bandpass', f0: rnd(350, 620), q: 2 } });
  }

  /** Alerte de plongée — deux bips de tension, montants. */
  function diveAlert(data) {
    if (!live()) return;
    if (tooSoon('dive', 110)) return;
    const t = S.ctx.currentTime;
    const base = rnd(860, 960);
    tone({ t: t, type: 'square', f0: base, f1: base, dur: 0.045, attack: 0.002, gain: 0.16,
           filter: { type: 'bandpass', f0: base * 1.2, q: 7 } });
    tone({ t: t, delay: 0.075, type: 'square', f0: base * 1.34, f1: base * 1.34, dur: 0.055, attack: 0.002, gain: 0.18,
           filter: { type: 'bandpass', f0: base * 1.6, q: 7 } });
    pulse(0.03);
  }

  /** Le joueur encaisse — dur, alarmant, grave. */
  function playerHit(data) {
    if (!live()) return;
    const t = S.ctx.currentTime;
    noise({ t: t, dur: 0.5, attack: 0.002, gain: 0.34,
            filter: { type: 'lowpass', f0: 1600, f1: 110, q: 1.6 } });
    tone({ t: t, type: 'square', f0: rnd(250, 300), f1: 58, dur: 0.42, attack: 0.002, gain: 0.24,
           filter: { type: 'lowpass', f0: 1800, f1: 260, q: 2.4 } });
    tone({ t: t, type: 'sine', f0: 90, f1: 32, dur: 0.55, attack: 0.003, gain: 0.30 });
    // Bip d'alarme (les vies restantes montent en tension)
    const lives = (data && typeof data.lives === 'number') ? data.lives : 2;
    const alarm = 620 + (2 - clamp(lives, 0, 3)) * 90;
    tone({ t: t, delay: 0.14, type: 'square', f0: alarm, f1: alarm, dur: 0.09, attack: 0.004, gain: 0.09,
           filter: { type: 'bandpass', f0: alarm * 1.3, q: 6 } });
    duck(0.4, 500);
    pulse(0.35);
  }

  /** Mort du joueur — plus grave, plus longue, dramatique. */
  function playerDeath() {
    if (!live()) return;
    const t = S.ctx.currentTime;
    noise({ t: t, dur: 1.15, attack: 0.004, gain: 0.40,
            filter: { type: 'lowpass', f0: 1500, f1: 60, q: 1.3 } });
    tone({ t: t, type: 'sawtooth', f0: 210, f1: 27, dur: 1.05, attack: 0.004, gain: 0.24,
           filter: { type: 'lowpass', f0: 1400, f1: 180, q: 3 } });
    tone({ t: t, type: 'sawtooth', f0: 208, f1: 26, dur: 1.05, attack: 0.004, gain: 0.20, detune: 17 });
    tone({ t: t, type: 'sine', f0: 120, f1: 24, dur: 1.3, attack: 0.006, gain: 0.34 });
    // Sirène descendante : la signature « je viens de perdre un vaisseau ».
    tone({ t: t, delay: 0.05, type: 'triangle', f0: 940, f1: 130, dur: 0.85, attack: 0.01, gain: 0.14,
           filter: { type: 'bandpass', f0: 1400, f1: 340, q: 3.5 } });
    duck(0.6, 1100);
    pulse(0.6);
  }

  /** Ramassage de power-up — arpège ascendant satisfaisant. */
  function powerUp(data) {
    if (!live()) return;
    const t = S.ctx.currentTime;
    const type = (data && data.type) || 'double';
    const root = type === 'life' ? 65 : (type === 'spread' ? 62 : 60); // Do5 / Ré / Mi
    const steps = type === 'life' ? [0, 4, 7, 12, 16] : [0, 4, 7, 12];
    for (let i = 0; i < steps.length; i++) {
      const f = hz(root + 12 + steps[i]);
      tone({ t: t, delay: i * 0.052, type: 'triangle', f0: f, f1: f, dur: 0.14, attack: 0.003, gain: 0.15 });
      tone({ t: t, delay: i * 0.052, type: 'square', f0: f * 2, f1: f * 2, dur: 0.07, attack: 0.002, gain: 0.045 });
    }
    noise({ t: t, delay: steps.length * 0.052, dur: 0.18, gain: 0.08,
            filter: { type: 'highpass', f0: 5000, f1: 9000, q: 0.8 } });
    pulse(0.12);
  }

  /** Montée de combo — la note monte avec le multiplicateur. Très satisfaisant. */
  function comboUp(data) {
    if (!live()) return;
    if (tooSoon('combo', 55)) return;
    const combo = clamp((data && data.combo) || 2, 1, 16);
    // Gamme pentatonique : ça monte sans jamais sonner faux.
    const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const idx = clamp(Math.round(combo) - 1, 0, SCALE.length - 1);
    const f = hz(74 + SCALE[idx]);        // Ré5 + degré
    const t = S.ctx.currentTime;
    const gain = 0.10 + idx * 0.007;
    tone({ t: t, type: 'triangle', f0: f, f1: f, dur: 0.17, attack: 0.002, gain: gain });
    tone({ t: t, type: 'sine', f0: f * 2, f1: f * 2, dur: 0.1, attack: 0.002, gain: gain * 0.5 });
    // Écho court : donne du relief sans queue de réverb.
    tone({ t: t, delay: 0.085, type: 'triangle', f0: f * 2, f1: f * 2, dur: 0.12, attack: 0.002, gain: gain * 0.32 });
    pulse(0.04);
  }

  /** Début de stage — fanfare montante, la hauteur suit le numéro de stage. */
  function stageStart(data) {
    if (!live()) return;
    const stage = clamp((data && data.stage) || 1, 1, 99);
    const shift = ((stage - 1) % 4) * 2;   // la fanfare se transpose doucement
    const t = S.ctx.currentTime;
    const notes = [0, 7, 12];
    for (let i = 0; i < notes.length; i++) {
      const f = hz(62 + shift + notes[i]);
      tone({ t: t, delay: i * 0.085, type: 'square', f0: f, f1: f, dur: 0.19, attack: 0.004, gain: 0.11,
             filter: { type: 'lowpass', f0: 4200, f1: 2200, q: 1 } });
      tone({ t: t, delay: i * 0.085, type: 'triangle', f0: f / 2, f1: f / 2, dur: 0.22, attack: 0.004, gain: 0.10 });
    }
    // Souffle ascendant sous la fanfare.
    noise({ t: t, dur: 0.45, attack: 0.15, gain: 0.11,
            filter: { type: 'bandpass', f0: 320, f1: 4200, q: 1.6 } });
    pulse(0.25);
  }

  /** Fin de stage — arpège qui résout, plus brillant. */
  function stageClear(data) {
    if (!live()) return;
    const t = S.ctx.currentTime;
    const notes = [0, 4, 7, 12, 16];
    for (let i = 0; i < notes.length; i++) {
      const f = hz(65 + notes[i]);
      tone({ t: t, delay: i * 0.07, type: 'triangle', f0: f, f1: f, dur: 0.26, attack: 0.003, gain: 0.13 });
      tone({ t: t, delay: i * 0.07 + 0.012, type: 'sine', f0: f * 2, f1: f * 2, dur: 0.16, attack: 0.002, gain: 0.05 });
    }
    noise({ t: t, delay: 0.05, dur: 0.6, attack: 0.01, gain: 0.07,
            filter: { type: 'highpass', f0: 6000, f1: 11000, q: 0.7 } });
    duck(0.2, 700);
    pulse(0.3);
  }

  /** Game over — long, grave, définitif. */
  function gameOver() {
    if (!live()) return;
    const t = S.ctx.currentTime;
    tone({ t: t, type: 'sawtooth', f0: 300, f1: 42, dur: 1.7, attack: 0.02, gain: 0.20,
           filter: { type: 'lowpass', f0: 1200, f1: 130, q: 3 } });
    tone({ t: t, type: 'sawtooth', f0: 297, f1: 41, dur: 1.7, attack: 0.02, gain: 0.16, detune: 22 });
    tone({ t: t, delay: 0.25, type: 'sine', f0: 110, f1: 55, dur: 1.5, attack: 0.03, gain: 0.24 });
    noise({ t: t, dur: 1.4, attack: 0.05, gain: 0.14,
            filter: { type: 'lowpass', f0: 900, f1: 90, q: 1.2 } });
    duck(0.75, 1800);
    bed.pulse = 0;
  }

  /** Lancement de partie — whoosh court puis accord. */
  function gameStart() {
    if (!live()) return;
    const t = S.ctx.currentTime;
    noise({ t: t, dur: 0.35, attack: 0.12, gain: 0.13,
            filter: { type: 'bandpass', f0: 260, f1: 5200, q: 1.4 } });
    [0, 7, 12].forEach(function (n, i) {
      const f = hz(57 + n);
      tone({ t: t, delay: 0.26 + i * 0.008, type: 'sawtooth', f0: f, f1: f, dur: 0.35, attack: 0.006, gain: 0.09,
             filter: { type: 'lowpass', f0: 3200, f1: 1200, q: 1.2 } });
    });
    pulse(0.4);
  }

  /** Vie gagnée. */
  function extraLife() {
    if (!live()) return;
    const t = S.ctx.currentTime;
    [0, 5, 9, 12, 17].forEach(function (n, i) {
      const f = hz(72 + n);
      tone({ t: t, delay: i * 0.06, type: 'triangle', f0: f, f1: f, dur: 0.2, attack: 0.003, gain: 0.14 });
    });
    pulse(0.2);
  }

  /** Bip d'interface générique. */
  function uiBlip(data) {
    if (!live()) return;
    if (tooSoon('ui', 45)) return;
    const t = S.ctx.currentTime;
    const f = (data && data.low) ? 420 : 780;
    tone({ t: t, type: 'square', f0: f, f1: f * 1.5, dur: 0.06, attack: 0.002, gain: 0.08,
           filter: { type: 'bandpass', f0: f * 1.6, q: 4 } });
  }

  /* =========================================================================
   *  NAPPE MUSICALE PROCÉDURALE
   *  Séquenceur à LOOKAHEAD (setInterval qui planifie sur l'horloge audio) :
   *  le rythme reste parfaitement stable même si le rendu rame.
   *  L'intensité monte avec l'action et redescend toute seule.
   * ====================================================================== */
  const BED_TICK_MS = 26;      // période du planificateur
  const BED_LOOKAHEAD = 0.16;  // secondes planifiées d'avance

  // Progression mineure simple, quatre mesures (racines MIDI).
  const BED_ROOTS = [45, 41, 48, 43];              // La2 · Fa2 · Do3 · Sol2
  const BED_SCALE = [0, 3, 7, 10, 12, 15, 19, 22]; // pentatonique mineure étendue
  const BED_BASS = [0, 3, 6, 8, 11, 14];           // pas (sur 16) où la basse frappe

  const bed = {
    timer: null,
    next: 0,
    step: 0,
    intensity: 0.2,
    pulse: 0,
    lastTick: 0
  };

  function pulse(amount) {
    bed.pulse = clamp(bed.pulse + (amount || 0), 0, 1.2);
  }

  /** La nappe s'efface dès que le propriétaire a une vraie piste en lecture. */
  function ownerMusicPlaying() {
    try {
      const el = readMusicElement();
      return !!(el && el.src && !el.paused && !el.ended && el.currentTime > 0);
    } catch (e) { return false; }
  }

  function shouldPlayBed() {
    if (!config.enabled || !config.bedEnabled) return false;
    if (config.music <= 0.001) return false;
    if (ownerMusicPlaying()) return false;
    return true;
  }

  /** Intensité 0..1 déduite de l'état du jeu + des impulsions d'événements. */
  function computeIntensity() {
    let v = 0.2;
    try {
      const st = readGameState();
      if (st === 'menu') v = 0.10;
      else if (st === 'gameover') v = 0.04;
      else if (st === 'settings') v = 0.08;
      else v = 0.34;

      if (st === 'playing') {
        v += clamp((readStage() - 1) * 0.03, 0, 0.22);
        v += clamp(readCombo() * 0.018, 0, 0.16);
        if (readLives() <= 1) v += 0.12;   // dernière vie : ça se tend
      }
    } catch (e) { /* ignoré */ }
    return clamp(v + bed.pulse * 0.55, 0, 1);
  }

  function bedTone(o) {
    const ac = S.ctx;
    if (!ac) return;
    const t0 = o.t;
    const dur = o.dur;
    const osc = ac.createOscillator();
    osc.type = o.type || 'triangle';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.detune) osc.detune.setValueAtTime(o.detune, t0);
    let node = osc;
    if (o.filter) { const bq = makeFilter(ac, t0, dur, o.filter); node.connect(bq); node = bq; }
    const gn = ac.createGain();
    env(gn.gain, t0, o.attack == null ? 0.006 : o.attack, dur, o.gain);
    node.connect(gn);
    gn.connect(S.bedBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function bedNoise(o) {
    const ac = S.ctx;
    if (!ac || !S.noiseBuf) return;
    const src = ac.createBufferSource();
    src.buffer = S.noiseBuf;
    src.playbackRate.value = o.rate || 1;
    let node = src;
    if (o.filter) { const bq = makeFilter(ac, o.t, o.dur, o.filter); node.connect(bq); node = bq; }
    const gn = ac.createGain();
    env(gn.gain, o.t, 0.002, o.dur, o.gain);
    node.connect(gn);
    gn.connect(S.bedBus);
    src.start(o.t, Math.random() * 1.5, o.dur + 0.05);
    src.stop(o.t + o.dur + 0.05);
  }

  function scheduleStep(step, t, spb) {
    const bar = (step / 16) | 0;
    const s16 = step % 16;
    const root = BED_ROOTS[bar % BED_ROOTS.length];
    const I = bed.intensity;

    // --- basse pulsée : le moteur du morceau -------------------------------
    if (BED_BASS.indexOf(s16) >= 0) {
      bedTone({
        t: t, type: 'sawtooth', f: hz(root), dur: spb * 1.7, attack: 0.005,
        gain: 0.16 * (0.55 + I * 0.6),
        filter: { type: 'lowpass', f0: 380 + I * 900, f1: 180 + I * 320, q: 6 }
      });
      bedTone({ t: t, type: 'sine', f: hz(root - 12), dur: spb * 2.2, attack: 0.008, gain: 0.10 * (0.5 + I * 0.7) });
    }

    // --- arpège : dense quand ça chauffe -----------------------------------
    const arpEvery = I > 0.62 ? 1 : (I > 0.3 ? 2 : 4);
    if (s16 % arpEvery === 0) {
      const deg = BED_SCALE[(step * 3 + bar) % BED_SCALE.length];
      const oct = (I > 0.55 && s16 % 8 === 4) ? 12 : 0;
      bedTone({
        t: t, type: 'square', f: hz(root + 24 + deg + oct), dur: spb * 1.3, attack: 0.003,
        gain: 0.055 * (0.35 + I * 0.9),
        filter: { type: 'bandpass', f0: 900 + I * 2600, q: 3 }
      });
    }

    // --- charleston : n'apparaît qu'en haute intensité ---------------------
    if (I > 0.4 && s16 % 2 === 1) {
      bedNoise({ t: t, dur: 0.022, gain: 0.028 * I,
                 filter: { type: 'highpass', f0: 6500, f1: 9000, q: 0.8 } });
    }

    // --- nappe d'accord au début de chaque mesure --------------------------
    if (s16 === 0 && I > 0.28) {
      [0, 3, 7].forEach(function (n, i) {
        bedTone({
          t: t, type: 'sawtooth', f: hz(root + 12 + n), dur: spb * 15, attack: spb * 3,
          gain: 0.022 * (0.4 + I), detune: (i - 1) * 6,
          filter: { type: 'lowpass', f0: 700 + I * 1600, f1: 500 + I * 900, q: 1.4 }
        });
      });
    }

    // --- coup de grosse caisse sur les temps forts -------------------------
    if (I > 0.5 && (s16 === 0 || s16 === 8)) {
      bedTone({ t: t, type: 'sine', f: 110, dur: 0.16, attack: 0.002, gain: 0.14 * I,
                filter: { type: 'lowpass', f0: 420, f1: 90, q: 1 } });
    }
  }

  function bedTick() {
    const ac = S.ctx;
    if (!ac || !S.bedBus) return;
    const t = ac.currentTime;
    const dt = bed.lastTick ? clamp(t - bed.lastTick, 0, 0.5) : 0.026;
    bed.lastTick = t;

    // L'impulsion d'action retombe toute seule (demi-vie ≈ 1,1 s).
    bed.pulse *= Math.pow(0.5, dt / 1.1);
    if (bed.pulse < 0.002) bed.pulse = 0;

    const want = shouldPlayBed();
    const target = want ? computeIntensity() : 0;
    bed.intensity += (target - bed.intensity) * Math.min(1, dt * 1.6);

    const paused = readPaused();
    const level = want
      ? config.bed * config.music * S.hiddenDim * (0.22 + bed.intensity * 0.78) * (paused ? 0.32 : 1)
      : 0.0001;
    try { S.bedBus.gain.setTargetAtTime(Math.max(0.0001, level), t, 0.25); } catch (e) { /* ignoré */ }

    if (!want) { bed.next = t + 0.05; return; }

    // 16es de noire : le tempo lui-même monte avec l'intensité.
    const bpm = 122 + bed.intensity * 34;
    const spb = 60 / bpm / 4;
    if (bed.next < t) bed.next = t + 0.04;
    let guard = 0;
    while (bed.next < t + BED_LOOKAHEAD && guard++ < 32) {
      scheduleStep(bed.step, bed.next, spb);
      bed.next += spb;
      bed.step = (bed.step + 1) % 64;
    }
  }

  function startBed() {
    if (bed.timer || !S.ctx) return;
    bed.next = S.ctx.currentTime + 0.08;
    bed.lastTick = 0;
    bed.timer = setInterval(function () {
      try { bedTick(); } catch (e) { /* jamais bloquant */ }
    }, BED_TICK_MS);
  }

  function stopBed() {
    if (bed.timer) { clearInterval(bed.timer); bed.timer = null; }
  }

  /* =========================================================================
   *  DISPATCHER
   * ====================================================================== */
  function norm(name) {
    return String(name || '').toLowerCase().replace(/[.\-_/\s]/g, '');
  }

  const TABLE = {
    // --- émis par game.js -------------------------------------------------
    gamestart: gameStart,
    stagestart: stageStart,
    stageclear: stageClear,
    enemyhit: enemyHit,
    enemykill: enemyKill,
    ramkill: ramKill,
    comboup: comboUp,
    playerhit: playerHit,
    playerdeath: playerDeath,
    gameover: gameOver,
    // --- à émettre par les autres modules ---------------------------------
    playershot: playerShot,
    powerup: powerUp,
    enemyshot: enemyShot,
    divealert: diveAlert,
    // --- alias tolérants (les agents n'ont pas tous le même vocabulaire) ---
    shoot: playerShot,
    shot: playerShot,
    fire: playerShot,
    playerfire: playerShot,
    playerbullet: playerShot,
    enemyfire: enemyShot,
    enemybullet: enemyShot,
    dive: diveAlert,
    divestart: diveAlert,
    enemydive: diveAlert,
    divetelegraph: diveAlert,
    telegraph: diveAlert,
    pickup: powerUp,
    powerupget: powerUp,
    bonus: powerUp,
    hit: enemyHit,
    impact: enemyHit,
    explosion: enemyKill,
    enemyexplode: enemyKill,
    enemydeath: enemyKill,
    kill: enemyKill,
    ram: ramKill,
    collision: ramKill,
    stagecomplete: stageClear,
    levelclear: stageClear,
    levelstart: stageStart,
    extralife: extraLife,
    life: extraLife,
    combo: comboUp,
    menu: uiBlip,
    uiselect: uiBlip,
    select: uiBlip,
    blip: uiBlip,
    pause: uiBlip
  };

  function play(name, data) {
    try {
      if (!config.enabled) return false;
      const fn = TABLE[norm(name)];
      if (!fn) return false;
      if (!S.unlocked) return false;      // pas encore de geste utilisateur
      fn(data || {});
      return true;
    } catch (e) {
      return false;   // un bruitage ne doit JAMAIS casser une frame
    }
  }

  /* =========================================================================
   *  DÉVERROUILLAGE (politique autoplay) + CYCLE DE VIE
   * ====================================================================== */
  function unlock() {
    S.unlocked = true;
    const ac = ensure();
    if (ac && ac.state !== 'running' && ac.resume) ac.resume().catch(noop);
    return !!(ac && ac.state === 'running');
  }

  function onGesture() {
    unlock();
    if (S.ctx && S.ctx.state === 'running') removeGestureListeners();
  }

  const GESTURES = ['pointerdown', 'mousedown', 'touchstart', 'keydown'];
  function addGestureListeners() {
    for (let i = 0; i < GESTURES.length; i++) {
      window.addEventListener(GESTURES[i], onGesture, true);
    }
  }
  function removeGestureListeners() {
    for (let i = 0; i < GESTURES.length; i++) {
      window.removeEventListener(GESTURES[i], onGesture, true);
    }
  }

  function install() {
    addGestureListeners();
    // Onglet en arrière-plan : on éteint la nappe (les bruitages, eux, ne
    // jouent pas puisque le jeu est en pause). La musique du propriétaire
    // continue : c'est son choix de piste, pas à nous de la couper.
    try {
      document.addEventListener('visibilitychange', function () {
        S.hiddenDim = document.hidden ? 0 : 1;
      });
    } catch (e) { /* ignoré */ }
  }

  /* =========================================================================
   *  ROUTAGE DES ÉLÉMENTS <audio>
   * ====================================================================== */
  function routeTo(el, busName) {
    const ac = ensure();
    if (!ac || !el) return false;
    if (S.routed && S.routed.has(el)) return true;
    try {
      const src = ac.createMediaElementSource(el);
      src.connect(busName === 'voice' ? S.voiceBus : S.musicBus);
      if (S.routed) S.routed.add(el);
      return true;
    } catch (e) {
      // Déjà routé ailleurs, ou navigateur récalcitrant : l'élément continue
      // simplement de sortir en direct. Aucun impact fonctionnel.
      return false;
    }
  }

  /* =========================================================================
   *  RÉGLAGES
   * ====================================================================== */
  function applySfx() {
    if (S.sfxBus && S.ctx) {
      try { S.sfxBus.gain.setTargetAtTime(config.enabled ? config.sfx : 0.0001, S.ctx.currentTime, 0.02); }
      catch (e) { S.sfxBus.gain.value = config.sfx; }
    }
  }

  function setSfxVolume(v) {
    config.sfx = clamp(Number(v) || 0, 0, 1);
    applySfx();
  }

  function setMusicVolume(v) {
    config.music = clamp(Number(v) || 0, 0, 1);
    // le bus de la nappe est recalculé à chaque tick du séquenceur
  }

  function setEnabled(on) {
    config.enabled = !!on;
    applySfx();
    if (!config.enabled && S.bedBus && S.ctx) {
      try { S.bedBus.gain.setTargetAtTime(0.0001, S.ctx.currentTime, 0.1); } catch (e) { /* ignoré */ }
    }
  }

  function setBedEnabled(on) {
    config.bedEnabled = !!on;
  }

  install();

  /* =========================================================================
   *  API
   * ====================================================================== */
  return {
    /** Point d'entrée unique appelé par gameEvent() (game.js). */
    play: play,

    /** Reprend le contexte audio. À appeler sur un geste utilisateur. */
    unlock: unlock,
    isReady: function () { return !!(S.ctx && S.ctx.state === 'running'); },
    isUnlocked: function () { return S.unlocked; },

    setSfxVolume: setSfxVolume,
    setMusicVolume: setMusicVolume,
    setEnabled: setEnabled,
    setBedEnabled: setBedEnabled,
    setMasterVolume: function (v) {
      config.master = clamp(Number(v) || 0, 0, 1);
      if (S.master && S.ctx) {
        try { S.master.gain.setTargetAtTime(config.master, S.ctx.currentTime, 0.02); }
        catch (e) { S.master.gain.value = config.master; }
      }
    },

    duck: duck,
    pulse: pulse,
    routeMusic: function (el) { return routeTo(el, 'music'); },
    routeVoice: function (el) { return routeTo(el, 'voice'); },

    /** Accès direct aux sons (pratique pour un module qui ne passe pas par gameEvent). */
    playerShot: playerShot,
    enemyShot: enemyShot,
    enemyHit: enemyHit,
    enemyKill: enemyKill,
    ramKill: ramKill,
    explosion: explosion,
    playerHit: playerHit,
    playerDeath: playerDeath,
    powerUp: powerUp,
    comboUp: comboUp,
    diveAlert: diveAlert,
    stageStart: stageStart,
    stageClear: stageClear,
    gameOver: gameOver,
    gameStart: gameStart,
    extraLife: extraLife,
    uiBlip: uiBlip,

    /** Nappe procédurale. */
    startBed: startBed,
    stopBed: stopBed,

    config: config,
    state: function () {
      return {
        ready: !!(S.ctx && S.ctx.state === 'running'),
        contextState: S.ctx ? S.ctx.state : 'none',
        voices: S.voices,
        // Réduction du limiteur en dB : négative = du signal circule vraiment.
        reduction: S.comp ? S.comp.reduction : 0,
        time: S.ctx ? S.ctx.currentTime : 0,
        intensity: Math.round(bed.intensity * 100) / 100,
        bedPlaying: !!bed.timer && shouldPlayBed(),
        sfx: config.sfx,
        music: config.music,
        enabled: config.enabled
      };
    }
  };
})();

window.SFX = SFX;
