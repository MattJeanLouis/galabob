/* =============================================================================
 *  galabob — PALETTE  (source de vérité UNIQUE des couleurs)
 * -----------------------------------------------------------------------------
 *  Direction artistique : NÉON VECTORIEL (Geometry Wars / Tempest).
 *  Fond noir profond, dominantes CYAN (le joueur) / MAGENTA (la menace) /
 *  BLANC CHAUD (l'énergie).
 *
 *  Toute entité expose un TRIPLET cohérent :
 *    core   : couleur de NOYAU     — trait fin quasi blanc, l'âme du vecteur
 *    glow   : couleur d'IDENTITÉ   — trait large + halo, saturé, c'est LA couleur
 *    burst  : couleur d'EXPLOSION  — gerbes de particules ; correspond TOUJOURS
 *                                    à l'identité de l'entité
 *  et deux champs dérivés utiles :
 *    rgb    : [r,g,b] de `glow`, pour composer des rgba() sans reparser
 *    dim    : version assombrie de `glow`, pour les fonds / barres / rémanences
 *
 *  ⚠️ Les anciennes palettes contradictoires ('lime'/'red'/'orange' de
 *  enemies.js, les #5fff55/#ff55ff/#ffaa22 de stages.js, et les couleurs
 *  d'explosion jaune→rouge de effects.js) sont RÉVOQUÉES. Tout module doit
 *  passer par PALETTE.
 *
 *  API (voir le bas du fichier pour les détails) :
 *    PALETTE.get(key)              -> triplet (jamais null)
 *    PALETTE.enemy(type)           -> triplet
 *    PALETTE.bullet(owner, kind)   -> triplet
 *    PALETTE.powerup(type)         -> triplet
 *    PALETTE.weapon(name)          -> triplet
 *    PALETTE.core / glow / burst   -> string CSS
 *    PALETTE.rgba(x, alpha)        -> 'rgba(r,g,b,a)'
 *    PALETTE.mix(a, b, t)          -> '#rrggbb'
 *    PALETTE.lighten / darken
 *    PALETTE.has(key) / PALETTE.keys()
 * ========================================================================== */

const PALETTE = (function () {
  'use strict';

  /* ---------------------------------------------------------------- outils */

  /** Extrait [r,g,b] d'un 'rgb(...)' / 'rgba(...)'. null si ce n'en est pas un. */
  function parseRgbFunc(str) {
    if (typeof str !== 'string') return null;
    const m = /^rgba?\s*\(([^)]+)\)/i.exec(str.trim());
    if (!m) return null;
    const parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const v = [0, 1, 2].map(function (i) {
      const s2 = parts[i];
      const n = parseFloat(s2);
      if (!isFinite(n)) return 255;
      return s2.indexOf('%') >= 0 ? Math.round(n * 2.55) : Math.round(n);
    });
    return [Math.max(0, Math.min(255, v[0])),
            Math.max(0, Math.min(255, v[1])),
            Math.max(0, Math.min(255, v[2]))];
  }

  function hexToRgb(hex) {
    if (typeof hex !== 'string') return [255, 255, 255];
    const fromFunc = parseRgbFunc(hex);
    if (fromFunc) return fromFunc;
    let h = hex.trim();
    if (h.charAt(0) === '#') h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length < 6) return [255, 255, 255];
    const n = parseInt(h.slice(0, 6), 16);
    if (isNaN(n)) return [255, 255, 255];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r, g, b) {
    const c = (v) => {
      const i = Math.max(0, Math.min(255, Math.round(v)));
      return (i < 16 ? '0' : '') + i.toString(16);
    };
    return '#' + c(r) + c(g) + c(b);
  }

  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    const k = Math.max(0, Math.min(1, t));
    return rgbToHex(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
  }

  const lighten = (hex, t) => mix(hex, '#ffffff', t);
  const darken = (hex, t) => mix(hex, '#000000', t);

  /** Construit un triplet complet à partir de core/glow/burst. */
  function T(core, glow, burst) {
    const g = glow;
    return {
      core: core,
      glow: g,
      burst: burst || g,
      dim: darken(g, 0.62),
      soft: lighten(g, 0.45),
      rgb: hexToRgb(g),
      coreRgb: hexToRgb(core),
      burstRgb: hexToRgb(burst || g)
    };
  }

  /* ------------------------------------------------------------ le fond */

  const bg = {
    deep: '#02030a',                       // noir profond, hors-jeu
    base: '#05060f',                       // fond de la scène
    haze: '#0a1024',                       // brume de fond / dégradé haut
    grid: 'rgba(70, 130, 200, 0.075)',     // grille vectorielle discrète
    vignette: 'rgba(0, 0, 0, 0.60)',
    scanline: 'rgba(0, 0, 0, 0.16)'
  };

  /* -------------------------------------------------------- les entités */

  const entities = {
    /* --- joueur : le CYAN, seule teinte froide et amicale de l'écran --- */
    player:         T('#ffffff', '#3df5ff', '#7ffcff'),
    playerCore:     T('#ffffff', '#a8fbff', '#a8fbff'),
    playerShield:   T('#ffffff', '#8affff', '#8affff'),
    playerThruster: T('#fff3d6', '#ff9d3d', '#ffc247'),
    playerDeath:    T('#ffffff', '#ff2b55', '#ff5a7a'),

    /* --- ennemis : la MENACE, du magenta au violet à l'ambre --- */
    enemyNormal:  T('#ffd9f6', '#ff2bd6', '#ff2bd6'),  // magenta franc
    enemyShooter: T('#e8d9ff', '#9d5bff', '#9d5bff'),  // violet électrique
    enemyFast:    T('#fff1d2', '#ffb03a', '#ffb03a'),  // ambre / blanc chaud
    enemyElite:   T('#ffffff', '#ff2b55', '#ff2b55'),  // rouge néon
    enemyDiving:  T('#ffffff', '#ff5ad0', '#ff2bd6'),  // teinte de plongée (télégraphie)

    /* --- projectiles joueur : famille cyan → blanc chaud --- */
    bulletPlayer: T('#ffffff', '#7df9ff', '#7df9ff'),
    bulletDouble: T('#ffffff', '#4dd2ff', '#4dd2ff'),
    bulletSpread: T('#fffdf2', '#ffd98a', '#ffd98a'),

    /* --- projectiles ennemis : rouge de danger, lisibilité avant tout --- */
    bulletEnemy:        T('#ffe3e9', '#ff2b55', '#ff2b55'),
    bulletEnemyShooter: T('#ffe0f2', '#ff3fa8', '#ff3fa8'),
    bulletEnemyFast:    T('#fff0dd', '#ff7a2b', '#ff7a2b'),

    /* --- power-ups : vert menthe / or, jamais confondables avec la menace --- */
    powerupDouble: T('#ffffff', '#00ffc8', '#00ffc8'),
    powerupSpread: T('#fffaf0', '#ffd166', '#ffd166'),
    powerupLife:   T('#ffffff', '#ff4fa3', '#ff4fa3'),
    // Les 10 types ajoutés par powerups.js : une couleur d'identité chacun,
    // toutes distinctes entre elles ET des trois familles ci-dessus.
    powerupLaser:     T('#ffe0fb', '#ff4df0', '#ff4df0'),
    powerupMissiles:  T('#ffe9cf', '#ff9d3d', '#ff9d3d'),
    powerupMitraille: T('#eaffd0', '#a6ff3d', '#a6ff3d'),
    powerupOnde:      T('#dff1ff', '#4db8ff', '#4db8ff'),
    powerupBouclier:  T('#ffffff', '#8affff', '#8affff'),
    powerupRalenti:   T('#dfe3ff', '#6f7dff', '#6f7dff'),
    powerupAimant:    T('#ffe1f2', '#ff6ec7', '#ff6ec7'),
    powerupMultiplicateur: T('#fffce0', '#ffee55', '#ffee55'),
    powerupSurcharge: T('#f4e3ff', '#c86bff', '#c86bff'),
    powerupBombe:     T('#ffffff', '#ffffff', '#ffffff'),

    /* --- divers --- */
    debris:   T('#ffffff', '#9fe8ff', '#9fe8ff'),
    shock:    T('#ffffff', '#d8f6ff', '#d8f6ff'),
    combo:    T('#fffaf0', '#ffd166', '#ffd166'),
    neutral:  T('#ffffff', '#8fb8d8', '#8fb8d8')
  };

  /* ------------------------------------------------------------ l'UI/HUD */

  const ui = {
    text:      '#e8f6ff',
    textDim:   'rgba(178, 214, 240, 0.55)',
    textWarm:  '#ffe8c2',
    accent:    '#3df5ff',   // cyan — identité joueur
    accentAlt: '#ff2bd6',   // magenta — identité menace
    good:      '#00ffc8',
    warn:      '#ff2b55',
    combo:     '#ffd166',
    life:      '#3df5ff',
    barBg:     'rgba(61, 245, 255, 0.13)',
    barFill:   '#3df5ff',
    barEdge:   '#a8fbff',
    frame:     'rgba(61, 245, 255, 0.35)',
    shadow:    'rgba(2, 3, 10, 0.85)',
    font:      '"Eurostile", "Michroma", "Orbitron", "Arial Black", Arial, sans-serif',
    fontMono:  '"SF Mono", "JetBrains Mono", Consolas, monospace'
  };

  /* -------------------------------------------------- étoiles / parallaxe */

  const stars = {
    far:  { color: '#2b3a63', core: '#5c74a8', size: 0.7, alpha: 0.55, speed: 26 },
    mid:  { color: '#6d8fbf', core: '#a9c8ea', size: 1.0, alpha: 0.75, speed: 72 },
    near: { color: '#d6ecff', core: '#ffffff', size: 1.6, alpha: 1.00, speed: 168 },
    accent: { color: '#3df5ff', core: '#ffffff', size: 1.8, alpha: 0.9, speed: 210 }
  };

  /* -------------------------------------------- table de résolution de clés */

  // Normalisation : minuscules, sans '.', '_', '-', ni espaces.
  //   'enemy.normal' == 'enemy_normal' == 'enemyNormal' == 'ENEMYNORMAL'
  function norm(k) {
    return String(k).toLowerCase().replace(/[\s._\-/]/g, '');
  }

  const index = {};
  function reg(key, triplet) { index[norm(key)] = triplet; }

  // clés canoniques
  for (const k in entities) reg(k, entities[k]);

  // alias — tout ce que le code existant peut envoyer
  reg('enemy.normal', entities.enemyNormal);
  reg('enemy.shooter', entities.enemyShooter);
  reg('enemy.fast', entities.enemyFast);
  reg('enemy.elite', entities.enemyElite);
  reg('normal', entities.enemyNormal);      // createExplosion(x, y, 'normal')
  reg('shooter', entities.enemyShooter);    // createExplosion(x, y, 'shooter')
  reg('fast', entities.enemyFast);          // createExplosion(x, y, 'fast')
  reg('elite', entities.enemyElite);
  reg('enemy', entities.enemyNormal);
  reg('ram', entities.enemyElite);

  reg('bullet.player', entities.bulletPlayer);
  reg('bullet.player.normal', entities.bulletPlayer);
  reg('bullet.player.double', entities.bulletDouble);
  reg('bullet.player.spread', entities.bulletSpread);
  reg('bullet.enemy', entities.bulletEnemy);
  reg('bullet.enemy.normal', entities.bulletEnemy);
  reg('bullet.enemy.shooter', entities.bulletEnemyShooter);
  reg('bullet.enemy.fast', entities.bulletEnemyFast);

  reg('weapon.normal', entities.bulletPlayer);
  reg('weapon.double', entities.bulletDouble);
  reg('weapon.spread', entities.bulletSpread);

  reg('powerup.double', entities.powerupDouble);
  reg('powerup.spread', entities.powerupSpread);
  reg('powerup.life', entities.powerupLife);
  reg('powerup.laser', entities.powerupLaser);
  reg('powerup.missiles', entities.powerupMissiles);
  reg('powerup.mitraille', entities.powerupMitraille);
  reg('powerup.onde', entities.powerupOnde);
  reg('powerup.bouclier', entities.powerupBouclier);
  reg('powerup.ralenti', entities.powerupRalenti);
  reg('powerup.aimant', entities.powerupAimant);
  reg('powerup.multiplicateur', entities.powerupMultiplicateur);
  reg('powerup.surcharge', entities.powerupSurcharge);
  reg('powerup.bombe', entities.powerupBombe);
  reg('powerup.vie', entities.powerupLife);
  reg('powerup.shield', entities.powerupBouclier);
  reg('powerup.slow', entities.powerupRalenti);
  reg('powerup.magnet', entities.powerupAimant);
  reg('powerup.x2', entities.powerupMultiplicateur);
  reg('powerup.bomb', entities.powerupBombe);
  reg('powerup.wave', entities.powerupOnde);

  // Armes : hud.js et projectiles.js passent par PALETTE.weapon(nom).
  reg('weapon.laser', entities.powerupLaser);
  reg('weapon.missiles', entities.powerupMissiles);
  reg('weapon.mitraille', entities.powerupMitraille);
  reg('weapon.onde', entities.powerupOnde);
  reg('bullet.player.mitraille', entities.powerupMitraille);
  reg('bullet.player.surcharge', entities.powerupSurcharge);
  reg('bullet.player.laser', entities.powerupLaser);
  reg('bullet.player.missiles', entities.powerupMissiles);
  reg('bullet.player.onde', entities.powerupOnde);
  reg('double', entities.powerupDouble);    // createPowerUp type
  reg('spread', entities.powerupSpread);
  reg('life', entities.powerupLife);

  reg('hud', T(ui.text, ui.accent, ui.accent));
  reg('ui', T(ui.text, ui.accent, ui.accent));
  reg('star', T(stars.near.core, stars.near.color, stars.near.color));

  /* ----------------------------------------------------------------- API */

  function get(key) {
    if (!key) return entities.neutral;
    if (typeof key === 'object') {
      // triplet déjà résolu, ou objet {core, glow}
      if (key.glow || key.core) {
        return key.rgb ? key : T(key.core || lighten(key.glow, 0.7), key.glow || key.core, key.burst);
      }
      return entities.neutral;
    }
    const found = index[norm(key)];
    if (found) return found;
    // couleur CSS brute : on fabrique un triplet à la volée
    if (typeof key === 'string' && (key.charAt(0) === '#' || key.indexOf('rgb') === 0 || key.indexOf('hsl') === 0)) {
      if (key.charAt(0) === '#') return T(lighten(key, 0.72), key, key);
      // rgb()/rgba()/hsl() : on garde la chaîne telle quelle (l'alpha compte)
      // mais on renseigne `rgb` avec les VRAIES composantes quand on sait les lire,
      // sinon PALETTE.rgba() d'une couleur douce renverrait du blanc pur.
      const comp = parseRgbFunc(key) || [255, 255, 255];
      return { core: '#ffffff', glow: key, burst: key, dim: key, soft: key, rgb: comp, coreRgb: [255, 255, 255], burstRgb: comp };
    }
    return entities.neutral;
  }

  function rgba(x, alpha) {
    const a = alpha == null ? 1 : Math.max(0, Math.min(1, alpha));
    let rgbArr;
    if (typeof x === 'string' && x.charAt(0) === '#') rgbArr = hexToRgb(x);
    else if (Array.isArray(x)) rgbArr = x;
    else rgbArr = get(x).rgb;
    return 'rgba(' + rgbArr[0] + ',' + rgbArr[1] + ',' + rgbArr[2] + ',' + a + ')';
  }

  return {
    bg: bg,
    entities: entities,
    ui: ui,
    stars: stars,

    /** Triplet d'une entité. Accepte 'player', 'enemy.normal', 'normal',
     *  'bullet.player.spread', une couleur CSS brute, ou un triplet.
     *  Ne renvoie JAMAIS null (repli : entities.neutral). */
    get: get,

    /** true si la clé est connue de la palette (hors couleurs CSS brutes). */
    has: function (key) { return !!index[norm(key)]; },

    /** Liste des clés canoniques normalisées (debug). */
    keys: function () { return Object.keys(index).sort(); },

    /** Raccourcis vers un des trois membres du triplet. */
    core:  function (key) { return get(key).core; },
    glow:  function (key) { return get(key).glow; },
    burst: function (key) { return get(key).burst; },
    dim:   function (key) { return get(key).dim; },

    /** Triplet d'un type d'ennemi : 'normal' | 'shooter' | 'fast' | 'elite'. */
    enemy: function (type) {
      const t = get('enemy' + norm(type || 'normal'));
      return t === entities.neutral ? entities.enemyNormal : t;
    },

    /** Triplet d'un projectile.
     *  owner : 'player' | 'enemy'
     *  kind  : 'normal' | 'double' | 'spread'  (joueur)
     *          'normal' | 'shooter' | 'fast'   (ennemi) */
    bullet: function (owner, kind) {
      const o = norm(owner || 'player');
      const k = norm(kind || 'normal');
      const t = index[norm('bullet.' + o + '.' + k)];
      if (t) return t;
      return o === 'enemy' ? entities.bulletEnemy : entities.bulletPlayer;
    },

    /** Triplet d'un power-up : 'double' | 'spread' | 'life'. */
    powerup: function (type) {
      return index[norm('powerup.' + norm(type || 'double'))] || entities.powerupDouble;
    },

    /** Triplet de l'arme courante du joueur : 'normal' | 'double' | 'spread'. */
    weapon: function (name) {
      return index[norm('weapon.' + norm(name || 'normal'))] || entities.bulletPlayer;
    },

    /** 'rgba(r,g,b,a)' depuis une clé de palette, un hex, ou un [r,g,b]. */
    rgba: rgba,

    /** Interpolation linéaire entre deux couleurs hex. t dans [0,1]. */
    mix: mix,
    lighten: lighten,
    darken: darken,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex
  };
})();

window.PALETTE = PALETTE;
