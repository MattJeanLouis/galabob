/* =============================================================================
 *  galabob — LE JOUEUR
 * -----------------------------------------------------------------------------
 *  Ce module tient TROIS promesses :
 *
 *  1. PILOTAGE NERVEUX ET INDÉPENDANT DU FRAMERATE
 *     Tout est en px/s intégrés avec dt (contrat de config.js). Le vaisseau
 *     a une micro-accélération (~45 ms) et une micro-décélération (~40 ms) :
 *     assez pour donner du poids, jamais assez pour sembler mou. Le demi-tour
 *     est encore plus court (~30 ms) pour que les esquives restent sèches.
 *
 *  2. TIR QUI SE SENT
 *     Cadence TEMPO.PLAYER_FIRE_INTERVAL (110 ms au lieu de 300), buffer
 *     d'entrée de 120 ms géré par INPUT, recul (kickback) élastique du
 *     vaisseau, flash de bouche à chaque canon, hitstop et trauma via JUICE.
 *
 *  3. RENDU VECTORIEL NÉON
 *     Plus un seul dégradé gris : la coque est tracée en lignes lumineuses
 *     (NEON.*), le réacteur pulse et s'allonge à l'accélération, une traînée
 *     persistante suit le vaisseau, et un noyau blanc marque en permanence la
 *     VRAIE hitbox (9×9 px, façon Ikaruga) pour que les frôlements soient
 *     lisibles.
 *
 *  4. TROIS EMPLACEMENTS DE POWER-UP INDÉPENDANTS
 *     Avant, tout passait par `player.weapon` : un bouclier aurait écrasé le
 *     laser. Les bonus se rangent désormais dans trois cases distinctes :
 *
 *       • player.weapon (+ weaponLevel 1..3, weaponTimer)  — EXCLUSIF
 *         'normal' | 'double' | 'spread' | 'laser' | 'missiles' | 'mitraille'
 *         | 'onde'.  Un seul canon principal à la fois.
 *
 *       • player.shield  — NOMBRE DE CHARGES (0..PLAYER_SHIELD_MAX). S'AJOUTE.
 *         Chaque charge absorbe un coup ; la rupture est spectaculaire.
 *
 *       • player.mods    — MODIFICATEURS CUMULABLES, minuteries indépendantes
 *         { ralenti, aimant, multiplicateur, surcharge } en ms restantes.
 *
 *     Résultat : laser Nv.3 + bouclier + multiplicateur cohabitent sans se
 *     marcher dessus. Les power-ups INSTANTANÉS (bombe, vie) n'occupent aucune
 *     case et sont traités par powerups.js.
 *
 *  Contrats respectés vis-à-vis de game.js :
 *    • player.usesPxPerSecond = true  -> game.js écrit player.speed en px/s
 *    • player.handlesOwnBlink = true  -> drawPlayer() gère lui-même les i-frames
 *    • player.weapon / player.weaponTimer conservent leur type (string / ms)
 *      car ui/hud.js les affiche.
 *    • `shotCooldown` (globale) reste défini : hud.js l'affiche en debug.
 *
 *  API PUBLIQUE AJOUTÉE (lisible par le HUD, powerups.js, game.js) :
 *    setPlayerWeapon(type)          addPlayerShield(n)     consumePlayerShield()
 *    addPlayerMod(key, ms)          playerHasMod(key)      playerModTimer(key)
 *    playerModFraction(key)         playerScoreMultiplier()
 *    playerTimeScale()              playerMagnetRange()    playerMagnetPull()
 *    resetPlayerPowerState()        applyPlayerDamageToEnemy(i, dmg, x, y)
 *    getPlayerWeaponLabel()         PLAYER_WEAPON_LABELS / PLAYER_MOD_KEYS
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 *  OBJET JOUEUR
 * -------------------------------------------------------------------------- */
const player = {
  shipId: 'classic',
  shipStats: {
    speedMultiplier: 1,
    fireRateMultiplier: 1,
    hitboxMultiplier: 1
  },
  x: CANVAS_WIDTH / 2 - 20,
  y: CANVAS_HEIGHT - 60,
  width: 40,
  height: 22,

  speed: TEMPO.PLAYER_SPEED,      // px/s — réécrit chaque frame par game.js
  color: '#3df5ff',               // legacy ; la vérité est dans PALETTE

  lives: 3,

  /* --- EMPLACEMENT 1 : ARME PRINCIPALE (exclusive) --- */
  weapon: 'normal',               // voir PLAYER_WEAPONS
  weaponTimer: 0,                 // ms restantes de l'arme spéciale
  weaponLevel: 1,                 // 1..3 — niveau de l'arme la plus récente
  // ARMES CUMULÉES. Chaque type ramassé RESTE actif avec son propre niveau et
  // sa propre minuterie : ramasser un spread n'éteint plus le laser, les deux
  // tirent ensemble. `weapon` / `weaponLevel` / `weaponTimer` continuent de
  // désigner la plus récente, pour le HUD et la cadence — rien n'est cassé.
  weapons: {},                    // { type: { level: 1..3, timer: ms } }

  /* --- EMPLACEMENT 2 : BOUCLIER (charges, s'ajoute) --- */
  shield: 0,                      // nombre de charges restantes (0..3)
  shieldPulse: 0,                 // 0..1 — éclat juste après une recharge
  shieldBreak: 0,                 // ms restantes de l'animation de rupture

  /* --- EMPLACEMENT 3 : MODIFICATEURS CUMULABLES (ms restantes) --- */
  mods:    { ralenti: 0, aimant: 0, multiplicateur: 0, surcharge: 0, furie: 0 },
  modsMax: { ralenti: 1, aimant: 1, multiplicateur: 1, surcharge: 1, furie: 1 },

  /* --- état du faisceau continu (arme 'laser') --- */
  laser: { on: false, power: 0, tick: 0, sound: 0, hits: [] },

  /* --- échelle de temps appliquée aux ENNEMIS (bullet-time) --- */
  timeScale: 1,

  /* --- drapeaux de compatibilité lus par game.js --- */
  usesPxPerSecond: true,          // player.speed est en PIXELS PAR SECONDE
  handlesOwnBlink: true,          // drawPlayer() dessine lui-même le clignotement

  /* --- état de pilotage (interne, mais lisible par le HUD/les effets) --- */
  vx: 0,                          // px/s
  vy: 0,                          // px/s — utilisé uniquement en Assaut
  tilt: 0,                        // -1..1 — inclinaison visuelle
  thrust: 0,                      // 0..1 — intensité du réacteur
  kick: 0,                        // px de recul visuel au tir
  fireCooldown: 0,                // ms avant le prochain tir
  charge: 0                       // 0..1 — surbrillance juste après un tir
};

/* -----------------------------------------------------------------------------
 *  Variables de tir (globales historiques : hud.js lit `shotCooldown`)
 * -------------------------------------------------------------------------- */
let shotCooldown = TEMPO.PLAYER_FIRE_INTERVAL;   // ms — cadence courante

// Flashs de bouche vivants : {x, y, life, max, angle, size, color}
const muzzleFlashes = [];

/* -----------------------------------------------------------------------------
 *  Constantes de lissage
 *  `damp(a, b, rate, dt)` attend une FRACTION RESTANTE APRÈS 1 SECONDE.
 *  _playerRate(ms) renvoie le taux qui amène à 95 % de la cible en `ms`.
 * -------------------------------------------------------------------------- */
function _playerRate(ms) {
  return Math.pow(0.05, 1000 / Math.max(1, ms));
}

const PLAYER_RATE_ACCEL  = _playerRate(45);   // mise en vitesse
const PLAYER_RATE_BRAKE  = _playerRate(40);   // arrêt touches relâchées
const PLAYER_RATE_TURN   = _playerRate(30);   // demi-tour : le plus sec
const PLAYER_RATE_TILT   = _playerRate(90);   // inclinaison visuelle
const PLAYER_RATE_THRUST = _playerRate(120);  // montée en régime du réacteur
const PLAYER_RATE_KICK   = _playerRate(TEMPO.PLAYER_KICKBACK_RECOVER);
const PLAYER_RATE_CHARGE = _playerRate(90);
const PLAYER_RATE_LASER  = _playerRate(70);   // montée/descente du faisceau
const PLAYER_RATE_TIME   = _playerRate(160);  // fondu du bullet-time

/* =============================================================================
 *  LES TROIS EMPLACEMENTS — CONSTANTES ET API PUBLIQUE
 * ========================================================================== */

/** Armes principales : EXCLUSIVES, une seule à la fois. */
const PLAYER_WEAPONS = ['normal', 'double', 'spread', 'laser', 'missiles', 'mitraille', 'onde'];

/** Libellés affichables (HUD, popup de ramassage). */
const PLAYER_WEAPON_LABELS = {
  normal: 'CANON',
  double: 'DOUBLE',
  spread: 'SPREAD',
  laser: 'LASER',
  missiles: 'MISSILES',
  mitraille: 'MITRAILLE',
  onde: 'ONDE'
};

/** Modificateurs cumulables : chacun a SA minuterie. */
const PLAYER_MOD_KEYS = ['ralenti', 'aimant', 'multiplicateur', 'surcharge', 'furie'];

/** Cadence de base par arme, en ms (les valeurs historiques restent dans TEMPO). */
const PLAYER_WEAPON_INTERVAL = {
  mitraille: 58,     // cadence ~x2, dégâts réduits de moitié
  missiles: 290,
  onde: 330,
  laser: 1000        // sans objet : le laser est continu (sert au throttle audio)
};
const PLAYER_FIRE_INTERVAL_MIN = 42;   // plancher absolu, surcharge comprise

/* --- bouclier ------------------------------------------------------------- */
const PLAYER_SHIELD_MAX = 3;
const PLAYER_SHIELD_IFRAME_MS = 750;   // répit offert par une rupture de bouclier
const PLAYER_SHIELD_BREAK_MS = 520;    // durée de l'animation de rupture

/* --- modificateurs -------------------------------------------------------- */
const PLAYER_RALENTI_SCALE = 0.34;     // les ENNEMIS tournent à 34 % de leur temps
const PLAYER_SURCHARGE_RATE = 0.60;    // cadence × 0.60 pendant la surcharge
const PLAYER_SCORE_MULT = 2;           // multiplicateur de points
const PLAYER_MAGNET_RANGE_BASE = 120;  // px — attraction naturelle des bonus
const PLAYER_MAGNET_RANGE_MOD = 900;   // px — avec l'aimant : tout l'écran ou presque

/* --- armes spéciales ------------------------------------------------------ */
const LASER_HALF_WIDTH = [5.5, 8.5, 11.5];   // demi-largeur par niveau (px CSS)
const LASER_DPS = [11, 16, 22];              // dégâts par seconde et par niveau
const LASER_TICK_MS = 60;                    // granularité d'application des dégâts
const LASER_SOUND_MS = 130;                  // throttle du bruitage

const MISSILE_SPEED_MIN = 240;   // px/s au lancement (la courbe est visible)
const MISSILE_SPEED_MAX = 1000;  // px/s en pointe
const MISSILE_ACCEL = 1750;      // px/s²
const MISSILE_TURN = 7.6;        // rad/s — braquage maximum
const MISSILE_LIFE_MS = 2400;
const MISSILE_RETARGET_MS = 130;
const MISSILE_DAMAGE = 2;
const MISSILE_R = 5.5;           // demi-boîte de collision (px CSS)

const ONDE_SPEED = 620;          // px/s
const ONDE_HZ = 1.55;            // Hz de l'ondulation
const ONDE_H = 15;               // px CSS de hauteur de collision

const MAX_SPECIAL_SHOTS = 56;

/** Projectiles gérés PAR CE MODULE (missiles + ondes).
 *  Ils ne passent pas par playerBullets : game.js supprime un projectile au
 *  premier contact, ce qui interdirait toute perforation. */
const playerSpecialShots = [];

/* -----------------------------------------------------------------------------
 *  API — EMPLACEMENT 1 : ARME PRINCIPALE
 * -------------------------------------------------------------------------- */

/** true si `type` est une arme principale connue. */
function isPlayerWeapon(type) {
  return PLAYER_WEAPONS.indexOf(type) >= 0;
}

/** Équipe une arme. Le MÊME type fait monter le niveau (1..3), un AUTRE type
 *  remplace l'arme en conservant le niveau acquis.
 *  @returns {string} libellé prêt à afficher */
function setPlayerWeapon(type, durationMs) {
  if (!isPlayerWeapon(type) || type === 'normal') return PLAYER_WEAPON_LABELS.normal;
  const lvl = clamp(player.weaponLevel | 0, 1, 3);

  const duree = durationMs == null ? TEMPO.POWERUP_DURATION_MS : durationMs;
  if (!player.weapons) player.weapons = {};

  // Le MÊME type monte d'un niveau ; un AUTRE type s'AJOUTE au lieu de
  // remplacer. Chaque arme garde sa minuterie propre, ce qui récompense la
  // collecte : tout ramassage apporte quelque chose.
  const dejaLa = player.weapons[type];
  if (dejaLa) {
    dejaLa.level = Math.min(3, (dejaLa.level | 0) + 1);
    dejaLa.timer = Math.max(dejaLa.timer, duree);
  } else {
    player.weapons[type] = { level: 1, timer: duree };
  }

  // `weapon` suit la plus récente : c'est elle qui donne la cadence et le HUD.
  player.weapon = type;
  player.weaponLevel = player.weapons[type].level;
  player.weaponTimer = player.weapons[type].timer;
  player.fireCooldown = 0;          // l'arme est prête tout de suite
  return getPlayerWeaponLabel();
}

/** 'LASER Nv.3' — libellé complet de l'arme courante. */
function getPlayerWeaponLabel() {
  const name = PLAYER_WEAPON_LABELS[player.weapon] || String(player.weapon).toUpperCase();
  const lvl = clamp(player.weaponLevel | 0, 1, 3);
  return lvl > 1 ? name + ' Nv.' + lvl : name;
}

/* -----------------------------------------------------------------------------
 *  API — EMPLACEMENT 2 : BOUCLIER
 * -------------------------------------------------------------------------- */

/** Ajoute des charges de bouclier. @returns {number} charges après ajout. */
function addPlayerShield(n) {
  const add = (n == null ? 1 : n | 0);
  const before = player.shield | 0;
  player.shield = clamp(before + add, 0, PLAYER_SHIELD_MAX);
  player.shieldPulse = 1;
  return player.shield;
}

/** Consomme UNE charge de bouclier à la place d'une vie.
 *  Appelée par le pont de powerups.js, en amont de damagePlayer().
 *  @returns {boolean} true si le coup a été absorbé. */
function consumePlayerShield(source) {
  if (!player || !(player.shield > 0)) return false;

  player.shield -= 1;
  player.shieldBreak = PLAYER_SHIELD_BREAK_MS;
  player.shieldPulse = 1;

  // Répit court : sans ça, la même balle/le même ennemi remange la charge
  // suivante dans la frame d'après.
  player.invulnerable = true;
  player.iframeTimer = Math.max(player.iframeTimer || 0, PLAYER_SHIELD_IFRAME_MS);
  player.iframeDuration = Math.max(player.iframeDuration || 0, PLAYER_SHIELD_IFRAME_MS);

  const cx = player.x + player.width / 2;
  const cy = player.y + player.height / 2;
  const col = PALETTE.get('playerShield');

  // Rupture spectaculaire : gel net, secousse franche, éclat cyan.
  JUICE.hitstop(70);
  JUICE.shake(0.50);
  JUICE.punch(0.020);
  JUICE.flash(col.glow, 220, 0.42);
  JUICE.kick(0, -5);

  if (typeof createShockwave === 'function') {
    try { createShockwave(cx, cy, 'playerShield', 0.16); } catch (e) { /* ignoré */ }
  }
  if (typeof createDebris === 'function') {
    try { createDebris(cx, cy, col.burst, 'fast'); } catch (e) { /* ignoré */ }
  }
  // 'shieldBreak' est le nom propre ; on ne se rabat sur 'ramKill' (impact
  // sourd, crédible pour une coque qui cède) que si sfx.js ne connaît pas
  // encore l'événement — jamais les deux (voir « branchements »).
  const played = (typeof SFX !== 'undefined' && SFX && typeof SFX.play === 'function')
    ? SFX.play('shieldBreak', { left: player.shield, source: source || 'unknown' })
    : false;
  if (!played && typeof gameEvent === 'function') {
    gameEvent('ramKill', { type: 'shield' });
  }
  return true;
}

/* -----------------------------------------------------------------------------
 *  API — EMPLACEMENT 3 : MODIFICATEURS CUMULABLES
 * -------------------------------------------------------------------------- */

/** Ajoute (ou prolonge) un modificateur. Les timers sont INDÉPENDANTS. */
function addPlayerMod(key, ms) {
  if (PLAYER_MOD_KEYS.indexOf(key) < 0) return 0;
  if (!player.mods) player.mods = { ralenti: 0, aimant: 0, multiplicateur: 0, surcharge: 0 };
  if (!player.modsMax) player.modsMax = { ralenti: 1, aimant: 1, multiplicateur: 1, surcharge: 1 };
  const dur = Math.max(0, ms || 0);
  // Prolongation : on empile jusqu'à 2,5 × la durée nominale, pas à l'infini.
  player.mods[key] = Math.min((player.mods[key] || 0) + dur, dur * 2.5);
  player.modsMax[key] = Math.max(player.mods[key], dur);
  return player.mods[key];
}

/** true si le modificateur est actif. */
function playerHasMod(key) {
  return !!(player && player.mods && player.mods[key] > 0);
}

/** Millisecondes restantes sur un modificateur (0 s'il est éteint). */
function playerModTimer(key) {
  return (player && player.mods && player.mods[key] > 0) ? player.mods[key] : 0;
}

/** Fraction restante 0 → 1 d'un modificateur (jauge HUD / pastilles). */
function playerModFraction(key) {
  if (!playerHasMod(key)) return 0;
  const max = (player.modsMax && player.modsMax[key]) || 1;
  return clamp(player.mods[key] / max, 0, 1);
}

/** Multiplicateur de points apporté par l'emplacement MOD (1 ou 2). */
function playerScoreMultiplier() {
  return playerHasMod('multiplicateur') ? PLAYER_SCORE_MULT : 1;
}

/** Échelle de temps à appliquer aux ENNEMIS et à leurs balles (bullet-time).
 *  Le JOUEUR n'est jamais ralenti — c'est tout l'intérêt du bonus. */
function playerTimeScale() {
  return (player && player.timeScale > 0) ? player.timeScale : 1;
}

/** Portée d'attraction des power-ups, en px CSS (lue par powerups.js). */
function playerMagnetRange() {
  return playerHasMod('aimant') ? PLAYER_MAGNET_RANGE_MOD : PLAYER_MAGNET_RANGE_BASE;
}

/** Force d'attraction, en px/s² (lue par powerups.js). */
function playerMagnetPull() {
  return playerHasMod('aimant') ? 2600 : 1400;
}

/** Remise à zéro complète des trois emplacements (nouvelle partie). */
function resetPlayerPowerState() {
  player.weapon = 'normal';
  player.weaponTimer = 0;
  player.weaponLevel = 1;
  player.weapons = {};
  player.shield = 0;
  player.shieldPulse = 0;
  player.shieldBreak = 0;
  for (let i = 0; i < PLAYER_MOD_KEYS.length; i++) {
    player.mods[PLAYER_MOD_KEYS[i]] = 0;
    player.modsMax[PLAYER_MOD_KEYS[i]] = 1;
  }
  player.timeScale = 1;
  player.laser.on = false;
  player.laser.power = 0;
  player.laser.tick = 0;
  player.laser.sound = 0;
  player.laser.hits.length = 0;
  playerSpecialShots.length = 0;
  muzzleFlashes.length = 0;
}

/* =============================================================================
 *  MISE À JOUR
 *  @param {number} deltaTime  ms de TEMPS DE JEU (0 pendant un hitstop/pause)
 * ========================================================================== */
function updatePlayer(deltaTime) {
  const dt = deltaTime / 1000;
  if (!(dt > 0)) return;          // hitstop / pause : rien ne bouge, tout se fige

  // Les ponts de powerups.js (bouclier, ralenti, multiplicateur) doivent être
  // en place AVANT que game.js ne fasse tourner ennemis et collisions.
  if (typeof ensurePowerUpBridges === 'function') ensurePowerUpBridges();

  updatePlayerModifiers(deltaTime, dt);
  updatePlayerMovement(dt);
  updatePlayerFiring(deltaTime);
  updatePlayerWeaponTimer(deltaTime);
  updatePlayerLaser(deltaTime, dt);
  updatePlayerSpecialShots(deltaTime, dt);
  updatePlayerShield(deltaTime, dt);
  updateMuzzleFlashes(deltaTime);
}

/* ------------------------------------------------ modificateurs cumulables */

/** Décompte INDÉPENDANT de chaque modificateur + fondu du bullet-time. */
function updatePlayerModifiers(deltaTime, dt) {
  const mods = player.mods;
  for (let i = 0; i < PLAYER_MOD_KEYS.length; i++) {
    const k = PLAYER_MOD_KEYS[i];
    if (mods[k] > 0) {
      mods[k] -= deltaTime;
      if (mods[k] <= 0) {
        mods[k] = 0;
        // Fin de bonus : un petit éclat, pour que la perte se VOIE.
        JUICE.flash(PALETTE.get('neutral').glow, 120, 0.10);
      }
    }
  }

  // Le ralenti s'installe et se retire en fondu : un saut sec se lirait comme
  // un décrochage de framerate, pas comme un pouvoir.
  const target = playerHasMod('ralenti') ? PLAYER_RALENTI_SCALE : 1;
  player.timeScale = damp(player.timeScale, target, PLAYER_RATE_TIME, dt);
  if (Math.abs(player.timeScale - target) < 0.004) player.timeScale = target;
}

/* ------------------------------------------------------------- bouclier -- */
function updatePlayerShield(deltaTime, dt) {
  if (player.shieldBreak > 0) player.shieldBreak = Math.max(0, player.shieldBreak - deltaTime);
  player.shieldPulse = damp(player.shieldPulse, 0, _playerRate(260), dt);
  if (player.shieldPulse < 0.01) player.shieldPulse = 0;
}

/* ------------------------------------------------------------------ pilotage */
function updatePlayerMovement(dt) {
  const dir = (typeof INPUT !== 'undefined' && INPUT.axisX)
    ? INPUT.axisX()
    : ((keys['ArrowRight'] || keys['Right'] ? 1 : 0) - (keys['ArrowLeft'] || keys['Left'] ? 1 : 0));
  const assault = (_playerGameMode() || {}).id === 'assault';
  const dirY = assault && typeof INPUT !== 'undefined' && INPUT.axisY ? INPUT.axisY() : 0;

  // player.speed est en px/s (player.usesPxPerSecond = true).
  const maxSpeed = (player.speed > 0 ? player.speed : TEMPO.PLAYER_SPEED);
  const target = dir * maxSpeed;

  let rate;
  if (dir === 0) rate = PLAYER_RATE_BRAKE;
  else if (dir * player.vx < 0) rate = PLAYER_RATE_TURN;   // demi-tour
  else rate = PLAYER_RATE_ACCEL;

  player.vx = damp(player.vx, target, rate, dt);
  if (dir === 0 && Math.abs(player.vx) < 2) player.vx = 0;

  // L'Assaut se joue dans une bande basse en 2D : assez de latitude pour
  // esquiver et choisir sa distance, sans pouvoir traverser la formation.
  const verticalSpeed = maxSpeed * 0.68;
  const targetYSpeed = dirY * verticalSpeed;
  const verticalRate = dirY === 0 ? PLAYER_RATE_BRAKE : PLAYER_RATE_ACCEL;
  player.vy = damp(player.vy || 0, targetYSpeed, verticalRate, dt);
  if (dirY === 0 && Math.abs(player.vy) < 2) player.vy = 0;

  player.x += player.vx * dt;
  if (assault) player.y += player.vy * dt;

  // Bords : petit rebond amorti, plus vivant qu'un arrêt net.
  const minX = TEMPO.PLAYER_MARGIN;
  const maxX = CANVAS_WIDTH - player.width - TEMPO.PLAYER_MARGIN;
  if (player.x < minX) {
    player.x = minX;
    if (player.vx < 0) player.vx *= -0.18;
  } else if (player.x > maxX) {
    player.x = maxX;
    if (player.vx > 0) player.vx *= -0.18;
  }


  if (assault) {
    const minY = CANVAS_HEIGHT * 0.60;
    const maxY = CANVAS_HEIGHT - player.height - TEMPO.PLAYER_MARGIN;
    if (player.y < minY) {
      player.y = minY;
      if (player.vy < 0) player.vy *= -0.14;
    } else if (player.y > maxY) {
      player.y = maxY;
      if (player.vy > 0) player.vy *= -0.14;
    }
  } else {
    player.vy = 0;
  }

  // Inclinaison visuelle et régime du réacteur.
  const norm = clamp(player.vx / maxSpeed, -1, 1);
  player.tilt = damp(player.tilt, norm, PLAYER_RATE_TILT, dt);
  const movementLoad = Math.max(Math.abs(norm), Math.abs(player.vy / verticalSpeed));
  player.thrust = damp(player.thrust, 0.34 + 0.66 * movementLoad, PLAYER_RATE_THRUST, dt);

  // Retour élastique du recul.
  player.kick = damp(player.kick, 0, PLAYER_RATE_KICK, dt);
  if (player.kick < 0.05) player.kick = 0;
  player.charge = damp(player.charge, 0, PLAYER_RATE_CHARGE, dt);
}

/* ----------------------------------------------------------------------- tir */

function _playerGameMode() {
  const runtime = (typeof window !== 'undefined') ? window.GALABOB : null;
  return runtime && runtime.modes ? runtime.modes.current() : null;
}

function _playerDamageMultiplier() {
  const mode = _playerGameMode();
  return mode && typeof mode.damageMultiplier === 'function'
    ? Math.max(0.05, Number(mode.damageMultiplier()) || 1)
    : 1;
}

/** Cadence courante en ms : arme, niveau et SURCHARGE compris. */
function currentFireInterval() {
  const w = player.weapon;
  let base;
  if (w === 'double') base = TEMPO.PLAYER_FIRE_INTERVAL_DOUBLE;
  else if (w === 'spread') base = TEMPO.PLAYER_FIRE_INTERVAL_SPREAD;
  else if (PLAYER_WEAPON_INTERVAL[w] != null) base = PLAYER_WEAPON_INTERVAL[w];
  else base = TEMPO.PLAYER_FIRE_INTERVAL;

  const lvl = clamp(player.weaponLevel | 0, 1, 3);
  let ms = base * (1 - 0.09 * (lvl - 1));
  const shipFireRate = player.shipStats ? Number(player.shipStats.fireRateMultiplier) || 1 : 1;
  ms /= shipFireRate;
  if (playerHasMod('surcharge')) ms *= PLAYER_SURCHARGE_RATE;
  if (playerHasMod('furie')) ms *= 0.72;
  const mode = _playerGameMode();
  if (mode && typeof mode.adjustFireInterval === 'function') {
    ms = mode.adjustFireInterval(ms, player.weapon);
  }
  return Math.max(PLAYER_FIRE_INTERVAL_MIN, ms);
}

function updatePlayerFiring(deltaTime) {
  const interval = currentFireInterval();
  shotCooldown = interval;                 // exposé au HUD de debug

  if (player.fireCooldown > 0) {
    player.fireCooldown = Math.max(0, player.fireCooldown - deltaTime);
  }

  // En entrant dans l'arsenal, le tir maintenu qui vient de tuer le dernier
  // ennemi ne doit pas acheter un module par accident. Un relâchement réarme
  // explicitement les tirs de sélection.
  if (typeof gameState !== 'undefined' && gameState === 'shop' &&
      typeof assaultShopFireArmed !== 'undefined' && !assaultShopFireArmed) return;

  const held = (typeof INPUT !== 'undefined' && INPUT.shoot) ? INPUT.shoot() : !!keys[' '];
  const buffered = (typeof INPUT !== 'undefined' && INPUT.shootBuffered) ? INPUT.shootBuffered() : false;
  const mode = _playerGameMode();
  // Le chargeur et la recharge du mode Assaut suffisent à rythmer le canon :
  // maintenir la touche vide le chargeur puis reprend automatiquement après
  // la recharge, sans imposer au joueur de marteler Espace.
  const wants = held || buffered;

  // LASER : faisceau CONTINU, aucune cadence. On note juste l'intention de tir ;
  // updatePlayerLaser() fait le reste (montée en puissance, dégâts, son).
  if (player.weapons && player.weapons.laser) {
    player.laser.on = wants;
    // ...mais s'il n'est pas seul, les autres armes doivent tirer aussi :
    // on ne sort que si le laser est la seule arme active.
    if (playerActiveWeapons().length <= 1) {
      if (wants && typeof INPUT !== 'undefined' && INPUT.consumeShoot) INPUT.consumeShoot();
      return;
    }
  } else {
    player.laser.on = false;
  }

  if (player.fireCooldown <= 0 && wants) {
    if (mode && typeof mode.requestShot === 'function' && !mode.requestShot(player.weapon)) {
      if (typeof INPUT !== 'undefined' && INPUT.consumeShoot) INPUT.consumeShoot();
      return;
    }
    firePlayerWeapon();
    player.fireCooldown = interval;
    if (typeof INPUT !== 'undefined' && INPUT.consumeShoot) INPUT.consumeShoot();
  }
}

/** Envoie une salve pour CHAQUE arme active. La logique par arme est inchangée :
 *  on réaffecte simplement l'arme de référence le temps de chaque salve, puis on
 *  restaure. Cumuler laser + spread tire donc les deux dans la même frame. */
function firePlayerWeapon() {
  const actives = playerActiveWeapons();
  if (actives.length <= 1) { fireOneWeapon(); return; }
  const savW = player.weapon, savL = player.weaponLevel;
  for (let i = 0; i < actives.length; i++) {
    // Le laser est CONTINU : il est géré par updatePlayerLaser(), pas ici.
    if (actives[i].type === 'laser') continue;
    player.weapon = actives[i].type;
    player.weaponLevel = actives[i].level;
    fireOneWeapon();
  }
  player.weapon = savW;
  player.weaponLevel = savL;
}

/** Salve d'UNE arme — celle désignée par player.weapon. */
function fireOneWeapon() {
  const lvl = clamp(player.weaponLevel | 0, 1, 3);
  const cx = player.x + player.width / 2;
  const noseY = player.y - 2;
  const speed = TEMPO.PLAYER_BULLET_SPEED + (lvl - 1) * 110;
  const w = player.weapon;
  const over = playerHasMod('surcharge');
  const flashesBefore = muzzleFlashes.length;

  if (w === 'double') {
    const dx = player.width * 0.26;
    _playerShot(cx - dx, noseY + 4, 0, speed, 'double');
    _playerShot(cx + dx, noseY + 4, 0, speed, 'double');
    if (lvl >= 2) _playerShot(cx, noseY - 3, 0, speed * 1.06, 'double');
    if (lvl >= 3) {
      _playerShot(cx - dx * 1.7, noseY + 8, -TEMPO.PLAYER_BULLET_SPREAD_VX * 0.35, speed, 'double');
      _playerShot(cx + dx * 1.7, noseY + 8,  TEMPO.PLAYER_BULLET_SPREAD_VX * 0.35, speed, 'double');
    }

  } else if (w === 'spread') {
    const s = TEMPO.PLAYER_BULLET_SPREAD_VX;
    _playerShot(cx, noseY, 0, speed, 'spread');
    _playerShot(cx - 4, noseY + 3, -s, speed * 0.96, 'spread');
    _playerShot(cx + 4, noseY + 3,  s, speed * 0.96, 'spread');
    if (lvl >= 2) {
      _playerShot(cx - 8, noseY + 7, -s * 1.9, speed * 0.9, 'spread');
      _playerShot(cx + 8, noseY + 7,  s * 1.9, speed * 0.9, 'spread');
    }
    if (lvl >= 3) {
      _playerShot(cx - 12, noseY + 11, -s * 2.9, speed * 0.86, 'spread');
      _playerShot(cx + 12, noseY + 11,  s * 2.9, speed * 0.86, 'spread');
    }

  } else if (w === 'mitraille') {
    // Cadence doublée, dégâts réduits de moitié : un rideau de plomb.
    // Léger éventail aléatoire — c'est de la MITRAILLE, pas de la dentelle.
    const j = 26 + lvl * 10;                 // px/s de dispersion
    const dx = player.width * 0.20;
    _playerShot(cx - dx, noseY + 4, randRange(-j, j), speed * 1.02, 'double', 0.5, _wcolor("mitraille"));
    _playerShot(cx + dx, noseY + 4, randRange(-j, j), speed * 1.02, 'double', 0.5, _wcolor("mitraille"));
    if (lvl >= 2) _playerShot(cx, noseY - 2, randRange(-j, j) * 0.6, speed * 1.08, 'double', 0.5, _wcolor("mitraille"));
    if (lvl >= 3) {
      _playerShot(cx - dx * 2.2, noseY + 9, randRange(-j, j) - 90, speed * 0.98, 'double', 0.5, _wcolor("mitraille"));
      _playerShot(cx + dx * 2.2, noseY + 9, randRange(-j, j) + 90, speed * 0.98, 'double', 0.5, _wcolor("mitraille"));
    }

  } else if (w === 'missiles') {
    _fireMissiles(cx, noseY, lvl, over);

  } else if (w === 'onde') {
    _fireOnde(cx, noseY, lvl, over);

  } else {
    _playerShot(cx, noseY, 0, speed, 'normal');
  }

  // SURCHARGE : deux canons latéraux + deux obliques VIENNENT S'AJOUTER à
  // l'arme équipée, quelle qu'elle soit. C'est le bonus « tous canons ».
  if (over) {
    const s = TEMPO.PLAYER_BULLET_SPREAD_VX;
    const ex = player.width * 0.46;
    _playerShot(cx - ex, noseY + 10, -s * 0.55, speed * 0.98, 'spread', 1, _wcolor("surcharge"));
    _playerShot(cx + ex, noseY + 10,  s * 0.55, speed * 0.98, 'spread', 1, _wcolor("surcharge"));
    _playerShot(cx - ex * 1.5, noseY + 14, -s * 1.6, speed * 0.9, 'spread', 1, _wcolor("surcharge"));
    _playerShot(cx + ex * 1.5, noseY + 14,  s * 1.6, speed * 0.9, 'spread', 1, _wcolor("surcharge"));
  }

  // Le rendu est ADDITIF : sept flashs de bouche simultanés saturent l'écran
  // en blanc. On répartit l'énergie lumineuse sur le nombre de canons.
  const added = muzzleFlashes.length - flashesBefore;
  if (added > 1) {
    const power = clamp(1.25 / Math.sqrt(added), 0.30, 1);
    for (let i = muzzleFlashes.length - added; i < muzzleFlashes.length; i++) {
      muzzleFlashes[i].power = power;
    }
  }

  // --- retour sensoriel -----------------------------------------------------
  player.kick = TEMPO.PLAYER_KICKBACK * (w === 'spread' ? 1.35 : 1);
  player.charge = 1;

  // 'playerShot' : trauma seul. 'playerShotBig' : + 12 ms de hitstop.
  // Dosage réduit : à 9 tirs/seconde, le plein effet serait écœurant.
  if (w === 'spread' || w === 'onde') JUICE.preset('playerShotBig', 0.55);
  else if (w === 'missiles') JUICE.preset('playerShotBig', 0.40);
  else if (w === 'mitraille') JUICE.preset('playerShot', 0.45);   // 17 tirs/s : on dose
  else JUICE.preset('playerShot', 0.85);

  if (typeof gameEvent === 'function') {
    gameEvent('playerShot', { weapon: w, level: lvl });
  }
}

/** Couleur d'une famille de bonus, résolue paresseusement : la table vit dans
 *  powerups.js, chargé APRÈS ce fichier. null => couleur d'arme par défaut. */
function _wcolor(key) {
  if (typeof powerUpColor === 'function') {
    const c = powerUpColor(key);
    if (c) return c;
  }
  return null;
}

/** Un projectile + son flash de bouche. vx/vy en px/s.
 *  @param {number} [damage] dégâts (0.5 pour la mitraille)
 *  @param {string} [color]  teinte forcée du flash de bouche */
function _playerShot(x, y, vx, speed, kind, damage, color) {
  if (typeof spawnPlayerBullet === 'function') {
    spawnPlayerBullet(x, y, {
      vx: vx,
      speed: speed,
      weapon: kind,
      damage: (damage == null ? 1 : damage) * _playerDamageMultiplier()
    });
  }
  spawnMuzzleFlash(x, y, kind, vx, color);
}

/* -------------------------------------------------------------- flash de tir */
function spawnMuzzleFlash(x, y, kind, vx, color) {
  if (muzzleFlashes.length > 24) muzzleFlashes.shift();
  muzzleFlashes.push({
    x: x,
    y: y,
    life: TEMPO.PLAYER_MUZZLE_MS,
    max: TEMPO.PLAYER_MUZZLE_MS,
    kind: kind || 'normal',
    color: color || null,           // teinte forcée (armes hors palette)
    angle: Math.atan2(-1, (vx || 0) / 900),
    size: 4.5 + Math.random() * 2,
    power: 1,
    spin: randRange(-1, 1)
  });
}

function updateMuzzleFlashes(deltaTime) {
  for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
    const m = muzzleFlashes[i];
    m.life -= deltaTime;
    // le flash suit le vaisseau : il naît au canon, il ne flotte pas derrière
    m.x += player.vx * (deltaTime / 1000);
    if (m.life <= 0) muzzleFlashes.splice(i, 1);
  }
}

/* ------------------------------------------------------------- arme spéciale */
function updatePlayerWeaponTimer(deltaTime) {
  if (!player.weapons) player.weapons = {};
  const timerMode = _playerGameMode();
  const timersEnabled = !timerMode || timerMode.weaponTimers !== false;

  // game.js remet weapon='normal' quand le joueur est touché : on vide alors
  // TOUTES les armes, sinon elles ressusciteraient à la frame suivante.
  if (player.weapon === 'normal') {
    for (const k in player.weapons) delete player.weapons[k];
    player.weaponLevel = 1;
    player.weaponTimer = 0;
    return;
  }

  // Chaque arme s'éteint pour son compte.
  let restantes = 0, plusLongue = 0, typeLePlusLong = null;
  for (const type in player.weapons) {
    const a = player.weapons[type];
    if (timersEnabled) a.timer -= deltaTime;
    if (a.timer <= 0) { delete player.weapons[type]; continue; }
    restantes++;
    if (a.timer > plusLongue) { plusLongue = a.timer; typeLePlusLong = type; }
  }

  if (!restantes) {
    player.weapon = 'normal';
    player.weaponLevel = 1;
    player.weaponTimer = 0;
    return;
  }
  // Si l'arme de référence vient d'expirer, on bascule sur celle qui durera
  // le plus longtemps — le HUD et la cadence restent cohérents.
  if (!player.weapons[player.weapon]) player.weapon = typeLePlusLong;
  player.weaponLevel = player.weapons[player.weapon].level;
  player.weaponTimer = player.weapons[player.weapon].timer;
}

/** Liste des armes actives, la plus récente en tête. */
function playerActiveWeapons() {
  const out = [];
  if (!player.weapons) return out;
  if (player.weapons[player.weapon]) {
    out.push({ type: player.weapon, level: player.weapons[player.weapon].level });
  }
  for (const type in player.weapons) {
    if (type !== player.weapon) out.push({ type: type, level: player.weapons[type].level });
  }
  return out;
}

/* =============================================================================
 *  ARMES SPÉCIALES — LASER, MISSILES, ONDE
 * -----------------------------------------------------------------------------
 *  POURQUOI CES TROIS ARMES VIVENT ICI ET PAS DANS playerBullets.
 *  game.js supprime un projectile joueur au PREMIER contact
 *  (processPlayerBulletCollisions -> `if (hit) playerBullets.splice(i, 1)`).
 *  Un rayon perforant, une onde qui traverse une rangée ou un missile qui
 *  explose à sa façon ne peuvent donc pas passer par ce tableau. Ces armes
 *  gèrent elles-mêmes leur déplacement, leurs collisions et leur rendu, depuis
 *  updatePlayer()/drawPlayer() — deux fonctions que game.js appelle déjà.
 *  Aucun branchement extérieur n'est nécessaire.
 * ========================================================================== */

/** Chemin de dégâts UNIQUE, calqué sur celui de game.js (hitFlash, combo, kill).
 *  @param {number} index   position dans `enemies`
 *  @param {number} dmg     dégâts
 *  @param {number} [hx]    point d'impact (pour l'éclat de l'ennemi)
 *  @param {number} [hy]
 *  @param {boolean} [quiet] true = pas de hitstop/son sur un simple impact
 *                           (indispensable pour le laser, qui touche 60×/s)
 *  @returns {boolean} true si l'ennemi est mort */
function applyPlayerDamageToEnemy(index, dmg, hx, hy, quiet) {
  if (typeof enemies === 'undefined' || !enemies) return false;
  const e = enemies[index];
  if (!e || e.isDeleted) return false;

  e.hp -= (dmg == null ? 1 : dmg);
  e.hitFlash = 90;
  e.hitFlashMax = 90;
  if (typeof hx === 'number') e.lastHitX = hx;
  if (typeof hy === 'number') e.lastHitY = hy;

  if (e.hp <= 0) {
    if (typeof killEnemyAt === 'function') {
      killEnemyAt(index, 'bullet');
    } else {
      e.isDeleted = true;
      enemies.splice(index, 1);
    }
    return true;
  }

  if (!quiet) {
    JUICE.preset('enemyHit');
    if (typeof gameEvent === 'function') gameEvent('enemyHit', { type: e.type });
  }
  return false;
}

/** Ennemi visible le plus proche d'un point. null si le ciel est vide. */
function _nearestEnemy(x, y) {
  if (typeof enemies === 'undefined' || !enemies) return null;
  let best = null, bestD = Infinity;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || e.isDeleted) continue;
    if (e.y + e.height < -10) continue;              // pas encore entré en scène
    if (e.y > CANVAS_HEIGHT + 10) continue;
    const ex = e.x + e.width / 2, ey = e.y + e.height / 2;
    // Les cibles DEVANT le vaisseau comptent double : un missile qui fait
    // demi-tour vers un traînard dans le dos se lit comme un bug.
    const d = dist2(x, y, ex, ey) * (ey > y ? 3.2 : 1);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

/* -----------------------------------------------------------------------------
 *  BOSS — les armes spéciales ne passent PAS par playerBullets, donc elles ne
 *  croisent jamais le test de collision de game.js. Sans ce pont, un boss était
 *  purement et simplement INVULNÉRABLE au laser, aux missiles et aux ondes.
 *  Le boss n'est pas dans `enemies` (ses drones non plus) : il a sa propre API.
 *
 *  @param {{x,y,width,height}} box  zone de l'arme
 *  @param {number} degats
 *  @returns {object|null} la pièce touchée (pour la mémoire de perforation)
 * -------------------------------------------------------------------------- */
function _toucherBoss(box, degats, dejaTouche) {
  if (typeof BOSS === 'undefined' || !BOSS || typeof BOSS.isActive !== 'function') return null;
  if (!BOSS.isActive()) return null;
  try {
    const cible = BOSS.hitTest(box);
    if (!cible) return null;
    if (dejaTouche && dejaTouche.indexOf(cible) >= 0) return null;
    // On vise le CENTRE de la pièce touchée : BOSS.damage() retrouve ainsi sa
    // cible sans ambiguïté et pose ses étincelles au bon endroit.
    BOSS.damage(degats, cible.x, cible.y);
    return cible;
  } catch (e) {
    console.error('BOSS.damage depuis une arme spéciale :', e);
    return null;
  }
}

/* -----------------------------------------------------------------------------
 *  LASER — rayon continu perforant
 * -------------------------------------------------------------------------- */

/** Demi-largeur courante du faisceau, en px CSS. */
function _laserHalfWidth() {
  const lvl = clamp(player.weaponLevel | 0, 1, 3);
  const base = LASER_HALF_WIDTH[lvl - 1] * (playerHasMod('surcharge') ? 1.45 : 1);
  return base * (0.55 + 0.45 * player.laser.power);
}

/** Applique un « tic » de dégâts à TOUTE la colonne balayée par le faisceau. */
function _laserApplyTick(chunk, hw, noseY) {
  if (typeof enemies === 'undefined' || !enemies) return;
  const L = player.laser;
  const cx = player.x + player.width / 2;
  const x0 = cx - hw, x1 = cx + hw;

  for (let j = enemies.length - 1; j >= 0; j--) {
    const e = enemies[j];
    if (!e || e.isDeleted) continue;
    if (e.x > x1 || e.x + e.width < x0) continue;
    if (e.y > noseY || e.y + e.height < -24) continue;

    const hy = e.y + e.height;
    const killed = applyPlayerDamageToEnemy(j, chunk, cx, hy, true);
    if (!killed) {
      if (L.hits.length > 20) L.hits.shift();
      L.hits.push({ x: cx, y: hy, life: 150, max: 150 });
    }
  }

  // Le faisceau transperce aussi le BOSS : une pièce par tic, la plus proche.
  const cible = _toucherBoss({ x: x0, y: -24, width: hw * 2, height: noseY + 24 }, chunk, null);
  if (cible) {
    if (L.hits.length > 20) L.hits.shift();
    L.hits.push({ x: cx, y: cible.y, life: 150, max: 150 });
  }
}

function updatePlayerLaser(deltaTime, dt) {
  const L = player.laser;
  const isLaser = (player.weapon === 'laser');

  // Montée/descente en puissance : le faisceau s'ALLUME, il n'apparaît pas.
  L.power = damp(L.power, (isLaser && L.on) ? 1 : 0, PLAYER_RATE_LASER, dt);
  if (L.power < 0.008) L.power = 0;

  for (let i = L.hits.length - 1; i >= 0; i--) {
    L.hits[i].life -= deltaTime;
    if (L.hits[i].life <= 0) L.hits.splice(i, 1);
  }

  if (!isLaser || L.power <= 0.12) { L.tick = 0; L.sound = 0; return; }

  const lvl = clamp(player.weaponLevel | 0, 1, 3);
  const hw = _laserHalfWidth();
  const noseY = player.y - 2;
  const dps = LASER_DPS[lvl - 1] * (playerHasMod('surcharge') ? 1.55 : 1) * L.power;

  // Dégâts appliqués par paliers de 60 ms : à 60 fps ça reste continu, mais
  // le nombre d'éclats d'impact ne dépend plus du framerate.
  L.tick += deltaTime;
  let guard = 8;
  while (L.tick >= LASER_TICK_MS && guard-- > 0) {
    L.tick -= LASER_TICK_MS;
    _laserApplyTick(dps * (LASER_TICK_MS / 1000), hw, noseY);
  }

  // Retour physique continu : recul entretenu + grondement de caméra léger.
  player.kick = Math.max(player.kick, 2.4 * L.power);
  player.charge = Math.max(player.charge, 0.40 + 0.20 * Math.sin(FRAME.time * 44));
  JUICE.shake(0.22 * L.power * dt);

  L.sound -= deltaTime;
  if (L.sound <= 0) {
    L.sound = LASER_SOUND_MS;
    if (typeof gameEvent === 'function') gameEvent('playerShot', { weapon: 'laser', level: lvl });
  }
}

/* -----------------------------------------------------------------------------
 *  MISSILES — têtes chercheuses
 * -------------------------------------------------------------------------- */
function _fireMissiles(cx, noseY, lvl, over) {
  const n = 2 + (lvl - 1) + (over ? 1 : 0);      // 2 → 4 (+1 en surcharge)
  for (let i = 0; i < n; i++) {
    const side = (i % 2 === 0) ? -1 : 1;
    const rank = Math.floor(i / 2);
    // Départ en éventail LARGE : c'est ce qui rend la courbe de rattrapage
    // lisible. Un missile qui part déjà droit sur sa cible n'a pas d'allure.
    const ang = -Math.PI / 2 + side * (0.62 + rank * 0.26);
    _spawnMissile(cx + side * (7 + rank * 7), noseY + 4 + rank * 3, ang);
  }
}

function _spawnMissile(x, y, ang) {
  if (playerSpecialShots.length >= MAX_SPECIAL_SHOTS) playerSpecialShots.shift();
  playerSpecialShots.push({
    kind: 'missile',
    x: x, y: y, px: x, py: y,
    ang: ang,
    speed: MISSILE_SPEED_MIN,
    age: 0,
    life: MISSILE_LIFE_MS,
    retarget: 0,
    target: null,
    damage: MISSILE_DAMAGE * (playerHasMod('surcharge') ? 1.5 : 1) * _playerDamageMultiplier(),
    seed: Math.random() * 6.2832
  });
  spawnMuzzleFlash(x, y, 'double', Math.cos(ang) * 900, _wcolor('missiles'));
}

/* -----------------------------------------------------------------------------
 *  ONDE — projectile large qui ondule et perfore
 * -------------------------------------------------------------------------- */
function _fireOnde(cx, noseY, lvl, over) {
  if (playerSpecialShots.length >= MAX_SPECIAL_SHOTS) playerSpecialShots.shift();
  playerSpecialShots.push({
    kind: 'onde',
    x: cx, y: noseY, x0: cx, py: noseY,
    w: (70 + (lvl - 1) * 28) * (over ? 1.3 : 1),
    h: ONDE_H,
    speed: ONDE_SPEED + (lvl - 1) * 70,
    amp: 32 + (lvl - 1) * 9,
    phase: Math.random() * 6.2832,
    age: 0,
    damage: _playerDamageMultiplier(),
    hits: []                     // perfore : chaque ennemi n'est touché QU'UNE fois
  });
  spawnMuzzleFlash(cx, noseY, 'spread', 0, _wcolor('onde'));
}

/* -----------------------------------------------------------------------------
 *  MISE À JOUR COMMUNE DES PROJECTILES SPÉCIAUX
 * -------------------------------------------------------------------------- */
function updatePlayerSpecialShots(deltaTime, dt) {
  const hasEnemies = (typeof enemies !== 'undefined' && enemies);

  for (let i = playerSpecialShots.length - 1; i >= 0; i--) {
    const s = playerSpecialShots[i];
    if (!s) { playerSpecialShots.splice(i, 1); continue; }

    s.age += deltaTime;
    s.px = s.x;
    s.py = s.y;

    /* ------------------------------------------------------------ MISSILE */
    if (s.kind === 'missile') {
      s.speed = Math.min(MISSILE_SPEED_MAX, s.speed + MISSILE_ACCEL * dt);

      s.retarget -= deltaTime;
      if (s.retarget <= 0 || !s.target || s.target.isDeleted) {
        s.target = _nearestEnemy(s.x, s.y);
        s.retarget = MISSILE_RETARGET_MS;
      }

      let want;
      if (s.target && !s.target.isDeleted) {
        want = Math.atan2((s.target.y + s.target.height / 2) - s.y,
                          (s.target.x + s.target.width / 2) - s.x);
      } else {
        want = -Math.PI / 2;                       // pas de cible : cap au nord
      }
      let da = want - s.ang;
      da = Math.atan2(Math.sin(da), Math.cos(da)); // ramené dans [-π, π]
      const maxTurn = (s.target ? MISSILE_TURN : 3.4) * dt;
      s.ang += clamp(da, -maxTurn, maxTurn);

      s.x += Math.cos(s.ang) * s.speed * dt;
      s.y += Math.sin(s.ang) * s.speed * dt;

      // --- collision : petite boîte autour de la tête ---------------------
      if (hasEnemies) {
        const box = boxAround(s.x, s.y, MISSILE_R * 2);
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (!e || e.isDeleted) continue;
          if (!rectIntersect(box, e)) continue;
          _missileDetonate(s, j);
          playerSpecialShots.splice(i, 1);
          break;
        }
        if (playerSpecialShots[i] !== s) continue;   // détruit ci-dessus
      }

      // Le boss : même détonation, mais les dégâts passent par son API.
      if (_toucherBoss(boxAround(s.x, s.y, MISSILE_R * 2), s.damage, null)) {
        _missileDetonate(s, -1);
        playerSpecialShots.splice(i, 1);
        continue;
      }

      if (s.age > s.life || s.x < -80 || s.x > CANVAS_WIDTH + 80 ||
          s.y < -80 || s.y > CANVAS_HEIGHT + 90) {
        _missileFizzle(s);
        playerSpecialShots.splice(i, 1);
      }
      continue;
    }

    /* --------------------------------------------------------------- ONDE */
    s.y -= s.speed * dt;
    s.phase += ONDE_HZ * 6.2832 * dt;
    s.x = s.x0 + Math.sin(s.phase) * s.amp;

    const boxOnde = { x: s.x - s.w / 2, y: s.y - s.h / 2, width: s.w, height: s.h };
    const pieceBoss = _toucherBoss(boxOnde, s.damage, s.hits);
    if (pieceBoss) {
      s.hits.push(pieceBoss);
      if (s.hits.length > 40) s.hits.shift();
      if (typeof createImpactSparks === 'function') {
        try { createImpactSparks(pieceBoss.x, pieceBoss.y, _wcolor('onde') || 'bulletDouble', -Math.PI / 2, 4); }
        catch (err) { /* ignoré */ }
      }
    }

    if (hasEnemies) {
      const box = boxOnde;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (!e || e.isDeleted) continue;
        if (s.hits.indexOf(e) >= 0) continue;       // déjà perforé
        if (!rectIntersect(box, e)) continue;

        s.hits.push(e);
        if (s.hits.length > 40) s.hits.shift();
        const hx = clamp(e.x + e.width / 2, s.x - s.w / 2, s.x + s.w / 2);
        applyPlayerDamageToEnemy(j, s.damage, hx, s.y);
        if (typeof createImpactSparks === 'function') {
          try { createImpactSparks(hx, s.y, _wcolor('onde') || 'bulletDouble', -Math.PI / 2, 4); }
          catch (err) { /* ignoré */ }
        }
      }
    }

    if (s.y < -40) playerSpecialShots.splice(i, 1);
  }
}

/** Un missile touche : explosion locale, dégâts, secousse. */
function _missileDetonate(m, index) {
  const col = _wcolor('missiles') || 'playerThruster';
  applyPlayerDamageToEnemy(index, m.damage, m.x, m.y, true);

  JUICE.hitstop(14);
  JUICE.shake(0.14);
  if (typeof createExplosion === 'function') {
    try { createExplosion(m.x, m.y, 'fast', { scale: 0.55 }); } catch (e) { /* ignoré */ }
  }
  if (typeof createImpactSparks === 'function') {
    try { createImpactSparks(m.x, m.y, col, m.ang + Math.PI, 7); } catch (e) { /* ignoré */ }
  }
  if (typeof gameEvent === 'function') gameEvent('enemyHit', { type: 'missile' });
}

/** Un missile expire : il se consume, il ne disparaît pas d'un coup. */
function _missileFizzle(m) {
  if (typeof createImpactSparks === 'function') {
    try {
      createImpactSparks(m.x, m.y, _wcolor('missiles') || 'playerThruster', m.ang + Math.PI, 3);
    } catch (e) { /* ignoré */ }
  }
}

/* =============================================================================
 *  RENDU DES ARMES SPÉCIALES
 * ========================================================================== */

/** Le rayon : halo large, noyau blanc, barreaux qui défilent, gueule ardente. */
function drawPlayerLaser(c) {
  const L = player.laser;
  if (L.power <= 0.02) return;

  const col = _wcolor('laser') || 'bulletPlayer';
  const cx = player.x + player.width / 2;
  const noseY = player.y - 4;
  const hw = _laserHalfWidth();
  const t = FRAME.time;

  // Scintillement à deux fréquences : le faisceau VIT, il ne stagne pas.
  const flick = 0.84 + 0.11 * Math.sin(t * 47) + 0.05 * Math.sin(t * 113 + 1.7);
  const a = clamp(L.power * flick, 0, 1);

  // Colonne : halo coloré + noyau presque blanc (une seule passe NEON suffit,
  // strokeNeon empile déjà halo/corps/noyau).
  NEON.line(c, cx, 0, cx, noseY, col, hw * 1.15, {
    alpha: a * 0.78, glowScale: 1.55, cap: 'butt', coreWidth: hw * 0.5
  });
  NEON.line(c, cx, 0, cx, noseY, 'playerCore', Math.max(0.9, hw * 0.34), {
    alpha: a * 0.9, passes: 2, cap: 'butt'
  });

  // Barreaux d'énergie qui remontent : c'est ce qui donne la VITESSE.
  const step = 44;
  const off = (t * 820) % step;
  for (let y = noseY - off; y > -step; y -= step) {
    const k = clamp(y / Math.max(1, noseY), 0, 1);
    NEON.line(c, cx - hw * 1.25, y, cx + hw * 1.25, y, col, 1.3, {
      alpha: a * 0.40 * (1 - k * 0.6), passes: 2
    });
  }

  // Gueule du canon : point ardent + anneau qui bat.
  NEON.dot(c, cx, noseY, hw * 1.1, col, { alpha: a * 0.95, glowScale: 2.0 });
  NEON.ring(c, cx, noseY, hw * 2.1 + 3.5 * Math.sin(t * 26), 1.5, col,
            { alpha: a * 0.45, passes: 3 });

  // Colonne rémanente dans le buffer de traînées : le rayon laisse une marque.
  const tr = _playerTrailCtx();
  if (tr) {
    NEON.line(tr, cx, 0, cx, noseY, col, hw * 1.0, { alpha: 0.14 * a, passes: 2 });
  }

  // Impacts : une couronne à chaque ennemi transpercé.
  for (let i = 0; i < L.hits.length; i++) {
    const h = L.hits[i];
    const k = clamp(h.life / h.max, 0, 1);
    NEON.ring(c, h.x, h.y, hw * 1.4 + (1 - k) * 17, 1.6 * k + 0.4, col,
              { alpha: k * 0.8, passes: 3 });
    NEON.dot(c, h.x, h.y, 2.2 * k, 'playerCore', { alpha: k * 0.8, glowScale: 1.4 });
  }
}

/** Missiles et ondes. */
function drawPlayerSpecialShots(c) {
  if (!playerSpecialShots.length) return;
  const tr = _playerTrailCtx();
  const t = FRAME.time;
  const colM = _wcolor('missiles') || 'playerThruster';
  const colO = _wcolor('onde') || 'bulletDouble';

  for (let i = 0; i < playerSpecialShots.length; i++) {
    const s = playerSpecialShots[i];
    if (!s) continue;

    if (s.kind === 'missile') {
      const ca = Math.cos(s.ang), sa = Math.sin(s.ang);
      const birth = s.age < 90 ? 1 - s.age / 90 : 0;

      // Traînée persistante : le chemin RÉELLEMENT parcouru, d'où la courbe.
      if (tr) {
        NEON.line(tr, s.px, s.py, s.x, s.y, colM, 2.4, { alpha: 0.52, passes: 2 });
      }

      // Corps : chevron orienté dans l'axe de vol.
      NEON.polyline(c, [
        s.x - ca * 9 - sa * 3.6, s.y - sa * 9 + ca * 3.6,
        s.x + ca * 5.5, s.y + sa * 5.5,
        s.x - ca * 9 + sa * 3.6, s.y - sa * 9 - ca * 3.6
      ], colM, 1.7, { alpha: 1, glowScale: 1.15 });

      // Tête chaude.
      NEON.dot(c, s.x + ca * 3.5, s.y + sa * 3.5, 1.9 + birth * 1.6, colM,
               { alpha: 1, glowScale: 1.35 });

      // Flamme de propulsion, pulsée sur l'horloge de JEU.
      const fl = 8 + 5 * Math.sin(t * 46 + s.seed) + s.speed / 260;
      NEON.line(c, s.x - ca * 8, s.y - sa * 8, s.x - ca * (8 + fl), s.y - sa * (8 + fl),
                'playerThruster', 1.5, { alpha: 0.55, passes: 2, glowScale: 1.2 });

    } else {
      // ONDE : un ruban sinusoïdal large, deux traits parallèles + embouts.
      const N = 16;
      const half = s.w / 2;
      const front = [], back = [];
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const px = s.x - half + s.w * u;
        const wob = Math.sin(u * Math.PI * 3 + s.phase * 2.2) * 5.5;
        front.push(px, s.y + wob);
        back.push(px, s.y + wob + 7);
      }
      if (tr) NEON.polyline(tr, front, colO, 3.0, { alpha: 0.34, passes: 2 });

      NEON.polyline(c, front, colO, 2.7, { alpha: 0.98, glowScale: 1.5 });
      NEON.polyline(c, back, colO, 1.3, { alpha: 0.38, passes: 2 });
      NEON.dot(c, s.x - half, s.y, 2.4, colO, { alpha: 0.9, glowScale: 1.5 });
      NEON.dot(c, s.x + half, s.y, 2.4, colO, { alpha: 0.9, glowScale: 1.5 });
      NEON.dot(c, s.x, s.y - 1, 2.0, 'playerCore', { alpha: 0.7, glowScale: 1.1 });
    }
  }
}

/* -----------------------------------------------------------------------------
 *  BOUCLIER — halo hexagonal autour du vaisseau
 * -------------------------------------------------------------------------- */
function drawPlayerShield(c, cx, cy, alpha) {
  const n = player.shield | 0;
  const brk = player.shieldBreak;
  const t = FRAME.time;
  const col = _wcolor('bouclier') || 'playerShield';

  // --- rupture : l'hexagone éclate vers l'extérieur ------------------------
  if (brk > 0) {
    const k = clamp(brk / PLAYER_SHIELD_BREAK_MS, 0, 1);   // 1 → 0
    const e = 1 - k;
    const r = 28 + e * 62;
    NEON.ring(c, cx, cy, r, 2.6 * k + 0.4, col, { alpha: k * 0.85, passes: 3 });
    for (let i = 0; i < 6; i++) {
      const a0 = i * Math.PI / 3 + e * 0.7;
      const a1 = a0 + Math.PI / 3;
      // Six segments d'hexagone qui s'écartent et tournent : c'est une COQUE
      // qui se brise, pas un simple cercle qui s'efface.
      const rr = r * (1 + 0.08 * Math.sin(i * 2.1 + e * 6));
      NEON.line(c,
        cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr,
        cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr,
        col, 2.2 * k + 0.3, { alpha: k * 0.75, passes: 3 });
    }
    NEON.dot(c, cx, cy, 4 + e * 10, col, { alpha: k * 0.4, glowScale: 2.2 });
  }

  if (n <= 0) return;

  // --- coque active --------------------------------------------------------
  const pulse = 1 + 0.055 * Math.sin(t * 5.4) + player.shieldPulse * 0.22;
  const r = (25 + n * 2.4) * pulse;
  const spin = t * 0.55;
  const a = alpha * (0.34 + 0.16 * n + player.shieldPulse * 0.45);

  const hex = [];
  for (let i = 0; i < 6; i++) {
    const ang = spin + i * Math.PI / 3;
    hex.push(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.86);
  }
  NEON.shape(c, hex, col, 1.7, {
    alpha: clamp(a, 0, 1), fill: true, fillAlpha: 0.10 + 0.03 * n, glowScale: 1.35
  });

  // Anneau pointillé contre-rotatif : lisible même immobile.
  NEON.ring(c, cx, cy, r * 0.82, 1.2, col, {
    alpha: clamp(a * 0.7, 0, 1), dash: [6, 10], dashOffset: t * 40, passes: 2
  });

  // Une pastille par charge, au sommet de la coque : le compte se lit d'un œil.
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i - (n - 1) / 2) * 0.46;
    NEON.dot(c, cx + Math.cos(ang) * r * 1.06, cy + Math.sin(ang) * r * 0.92,
             1.7 + player.shieldPulse, col, { alpha: clamp(a * 1.6, 0, 1), glowScale: 1.3 });
  }
}

/* -----------------------------------------------------------------------------
 *  PASTILLES DE MODIFICATEURS — un satellite par bonus cumulable actif
 *  Le HUD n'est pas dans mon périmètre : ces pastilles garantissent que l'état
 *  des trois emplacements se lit SUR le vaisseau, sans quitter l'action des yeux.
 * -------------------------------------------------------------------------- */
function drawPlayerMods(c, cx, cy, alpha) {
  let active = 0;
  for (let i = 0; i < PLAYER_MOD_KEYS.length; i++) {
    if (playerHasMod(PLAYER_MOD_KEYS[i])) active++;
  }
  if (!active) return;

  const t = FRAME.time;
  const r = 34;
  let n = 0;
  for (let i = 0; i < PLAYER_MOD_KEYS.length; i++) {
    const key = PLAYER_MOD_KEYS[i];
    if (!playerHasMod(key)) continue;

    const frac = playerModFraction(key);
    const ang = t * 0.85 + (n / active) * Math.PI * 2;
    const px = cx + Math.cos(ang) * r;
    const py = cy + Math.sin(ang) * r * 0.62;
    const col = _wcolor(key) || 'neutral';

    // Clignotement d'alerte dans la dernière seconde.
    const warn = frac < 0.22 ? (0.45 + 0.55 * Math.abs(Math.sin(t * 13))) : 1;
    const a = clamp(alpha * 0.85 * warn, 0, 1);

    NEON.dot(c, px, py, 2.1, col, { alpha: a, glowScale: 1.4 });
    // Arc de temps restant : la pastille se vide en tournant.
    const p = new Path2D();
    p.arc(px, py, 5.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    NEON.custom(c, p, col, 1.3, { alpha: a * 0.8, passes: 2, cap: 'butt' });
    n++;
  }
}

/* =============================================================================
 *  RENDU — TRACÉ VECTORIEL NÉON
 * ========================================================================== */

// Chemins statiques, construits une seule fois (aucune allocation par frame).
let _shipHull = null;
let _shipCockpit = null;
let _shipSpine = null;

function _buildShipPaths() {
  const hull = new Path2D();
  hull.moveTo(0, -14);      // nez
  hull.lineTo(4.5, -4);
  hull.lineTo(19, 9);       // aile droite
  hull.lineTo(9, 6);
  hull.lineTo(6.5, 11);     // dérive droite
  hull.lineTo(0, 6.5);
  hull.lineTo(-6.5, 11);    // dérive gauche
  hull.lineTo(-9, 6);
  hull.lineTo(-19, 9);      // aile gauche
  hull.lineTo(-4.5, -4);
  hull.closePath();
  _shipHull = hull;

  const cock = new Path2D();
  cock.moveTo(0, -9);
  cock.lineTo(3.2, -2);
  cock.lineTo(0, 4);
  cock.lineTo(-3.2, -2);
  cock.closePath();
  _shipCockpit = cock;

  const spine = new Path2D();
  spine.moveTo(-11, 3.5); spine.lineTo(-11, 9.5);
  spine.moveTo(11, 3.5);  spine.lineTo(11, 9.5);
  spine.moveTo(-4.5, -4); spine.lineTo(4.5, -4);
  _shipSpine = spine;
}

/** Contexte des traînées, ou null si elles sont désactivées. */
function _playerTrailCtx() {
  if (typeof NEON === 'undefined' || !NEON.trail) return null;
  if (!RENDER_CONFIG.trails || !NEON.isEnabled()) return null;
  return NEON.trail;
}

function drawPlayer() {
  if (!_shipHull) {
    try { _buildShipPaths(); } catch (e) { return; }
  }

  const c = ctx;
  const t = FRAME.time;
  const cx = player.x + player.width / 2;
  const cy = player.y + player.height / 2 + player.kick;   // recul visuel

  // --- lisibilité pendant les i-frames -------------------------------------
  let alpha = 1;
  if (player.invulnerable) alpha = player.blink ? 0.30 : 0.92;

  // --- apparition / réapparition -------------------------------------------
  let scale = 1;
  if (player.respawning && player.respawnTimer > 0) {
    const k = 1 - clamp(player.respawnTimer / Math.max(1, TEMPO.PLAYER_RESPAWN_MS), 0, 1);
    scale = 0.55 + 0.45 * smoothstep(k);
    alpha *= 0.35 + 0.65 * k;
  }

  drawPlayerTrail(cx, cy, alpha);

  // --- armes spéciales : repère MONDE, hors de la transformation du vaisseau
  try { drawPlayerSpecialShots(c); } catch (e) { /* ignoré */ }
  try { drawPlayerLaser(c); } catch (e) { /* ignoré */ }

  c.save();
  c.translate(cx, cy);
  c.rotate(player.tilt * 0.20);
  if (scale !== 1) c.scale(scale, scale);

  // Réacteur : dessiné avant la coque pour passer dessous.
  drawPlayerThruster(c, t, alpha);

  const runtime = (typeof window !== 'undefined') ? window.GALABOB : null;
  const ship = runtime && runtime.ships ? runtime.ships.get(player.shipId) : null;
  const rendererId = ship ? ship.renderer : 'legacy-vector';
  const rendered = runtime && runtime.shipRenderers
    ? runtime.shipRenderers.draw(rendererId, c, { alpha: alpha, time: t, charge: player.charge })
    : false;
  if (!rendered) drawClassicPlayerHull(c, { alpha: alpha, time: t, charge: player.charge });

  c.restore();

  // --- bouclier d'invulnérabilité (repère non ambigu) ----------------------
  if (player.invulnerable && player.iframeTimer > 0) {
    const k = clamp(player.iframeTimer / Math.max(1, player.iframeDuration || TEMPO.PLAYER_IFRAME_MS), 0, 1);
    const r = 24 + 4 * Math.sin(t * 9);
    NEON.ring(c, cx, cy, r, 1.6, 'playerShield', {
      alpha: 0.16 + 0.34 * k,
      dash: [7, 9],
      dashOffset: -t * 46
    });
  }

  // --- BOUCLIER (emplacement 2) et MODIFICATEURS (emplacement 3) -----------
  // Dessinés hors de la transformation du vaisseau : la coque ne s'incline pas
  // avec le pilote, et les pastilles restent horizontales donc lisibles.
  try { drawPlayerShield(c, cx, cy, alpha); } catch (e) { /* ignoré */ }
  try { drawPlayerMods(c, cx, cy, alpha); } catch (e) { /* ignoré */ }

  // --- NOYAU = LA VRAIE HITBOX (9×9 px) ------------------------------------
  // Le joueur doit voir ce qui le tue. Ce point blanc EST la surface mortelle.
  NEON.dot(c, cx, cy, 1.9 + 0.35 * Math.sin(t * 11), 'playerCore', {
    alpha: player.invulnerable ? 0.40 : 0.85,
    glowScale: 0.85
  });

  drawMuzzleFlashes(c);
}

function drawClassicPlayerHull(c, state) {
  const alpha = state.alpha;
  const t = state.time;
  // Coque : halo large + noyau blanc.
  const boost = 1 + state.charge * 0.30;
  NEON.custom(c, _shipHull, 'player', 1.9, {
    alpha: alpha,
    glowScale: boost,
    join: 'round'
  });
  NEON.fillPath(c, _shipHull, 'player', { alpha: alpha * 0.13, glowAlpha: 0.16, coreAlpha: 0.04 });

  // Détails internes
  NEON.custom(c, _shipSpine, 'player', 1.0, { alpha: alpha * 0.55, passes: 3 });
  NEON.custom(c, _shipCockpit, 'playerCore', 1.1, {
    alpha: alpha * (0.42 + 0.18 * Math.sin(t * 4.2)),
    passes: 3
  });

  // Feux de position : deux points aux extrémités d'ailes
  const blinkNav = 0.35 + 0.30 * Math.sin(t * 6.5);
  NEON.dot(c, -19, 9, 1.1, 'playerShield', { alpha: alpha * blinkNav });
  NEON.dot(c, 19, 9, 1.1, 'playerShield', { alpha: alpha * blinkNav });
}

let _interceptorHull = null;
let _bastionHull = null;

function _variantHull(points) {
  const path = new Path2D();
  path.moveTo(points[0], points[1]);
  for (let index = 2; index < points.length; index += 2) path.lineTo(points[index], points[index + 1]);
  path.closePath();
  return path;
}

function drawInterceptorPlayerHull(c, state) {
  if (!_interceptorHull) {
    _interceptorHull = _variantHull([0, -18, 5, -4, 18, 10, 4, 6, 0, 13, -4, 6, -18, 10, -5, -4]);
  }
  NEON.custom(c, _interceptorHull, 'player', 1.7, {
    alpha: state.alpha, glowScale: 1.1 + state.charge * 0.25, join: 'round'
  });
  NEON.fillPath(c, _interceptorHull, 'player', { alpha: state.alpha * 0.10, glowAlpha: 0.14 });
  NEON.line(c, 0, -13, 0, 7, 'playerCore', 1.2, { alpha: state.alpha * 0.75, passes: 3 });
  NEON.dot(c, 0, -3, 1.7, 'playerCore', { alpha: state.alpha });
}

function drawBastionPlayerHull(c, state) {
  if (!_bastionHull) {
    _bastionHull = _variantHull([0, -14, 9, -6, 22, 3, 18, 12, 7, 9, 0, 14, -7, 9, -18, 12, -22, 3, -9, -6]);
  }
  NEON.custom(c, _bastionHull, 'playerShield', 2.2, {
    alpha: state.alpha, glowScale: 1.2 + state.charge * 0.30, join: 'round'
  });
  NEON.fillPath(c, _bastionHull, 'playerShield', { alpha: state.alpha * 0.15, glowAlpha: 0.18 });
  NEON.line(c, -12, 3, 12, 3, 'player', 1.4, { alpha: state.alpha * 0.75, passes: 3 });
  NEON.dot(c, 0, -2, 2.4, 'playerCore', { alpha: state.alpha });
}

/* ------------------------------------------------------------- le réacteur */
function drawPlayerThruster(c, t, alpha) {
  // Longueur : régime + pulsation rapide. Le réacteur "respire" à l'arrêt et
  // s'étire nettement dès qu'on pousse.
  const pulse = 0.82 + 0.18 * Math.sin(t * 38);
  const len = (8 + 22 * player.thrust) * pulse;
  const spread = 3.2 + 1.3 * player.thrust;
  const a = alpha * (0.34 + 0.30 * player.thrust);

  for (let s = -1; s <= 1; s += 2) {
    const ex = s * 6.5;
    const ey = 10;
    // flamme en chevron
    NEON.polyline(c, [
      ex - spread, ey,
      ex, ey + len,
      ex + spread, ey
    ], 'playerThruster', 1.6, { alpha: a, glowScale: 1.25 });
    // noyau chaud
    NEON.line(c, ex, ey, ex, ey + len * 0.55, 'playerCore', 0.9, { alpha: a * 0.55, passes: 2 });
  }

  // souffle central plus court, dans l'échancrure de la coque
  NEON.line(c, 0, 6.5, 0, 6.5 + len * 0.45, 'playerThruster', 1.2, { alpha: a * 0.40, passes: 2 });
}

/* ---------------------------------------------------------- la traînée -- */
function drawPlayerTrail(cx, cy, alpha) {
  const tr = _playerTrailCtx();
  if (!tr) return;

  // Deux jets rémanents derrière les réacteurs.
  //
  //  Le tracé RELIE la position de la frame précédente à la position courante.
  //  Avant, chaque frame tamponnait un segment PENCHÉ de longueur fixe : en
  //  déplacement latéral rapide, les tampons successifs étaient distants de
  //  ~8 px et penchés de 30°, ce qui donnait un peigne de bâtonnets séparés
  //  au lieu d'un panache — l'artefact le plus visible du rendu au zoom.
  //  Un segment de raccord produit un ruban continu, quelle que soit la
  //  vitesse et quel que soit le fps.
  const len = 10 + 26 * player.thrust;
  const a = alpha * (0.13 + 0.19 * player.thrust);
  const y = cy + 10;

  for (let s = -1; s <= 1; s += 2) {
    const ex = cx + s * 6.5;
    const key = (s < 0) ? '_trailL' : '_trailR';
    const prev = player[key];

    // Raccord avec la frame précédente — ignoré après un saut de position
    // (respawn, redimensionnement, retour d'onglet) pour ne pas barrer l'écran.
    if (prev && Math.abs(prev.x - ex) < 220 && Math.abs(prev.y - y) < 90) {
      NEON.line(tr, prev.x, prev.y, ex, y, 'playerThruster', 2.2, {
        alpha: a, glowScale: 1.1, passes: 3
      });
    }
    if (!prev) player[key] = { x: ex, y: y };
    else { prev.x = ex; prev.y = y; }

    // Souffle vers le bas : le panache existe aussi à l'arrêt.
    NEON.line(tr, ex, y, ex, y + len, 'playerThruster', 2.0, {
      alpha: a * 0.8, glowScale: 1.1, passes: 2
    });
  }
  NEON.dot(tr, cx, cy + 8, 2.0, 'player', { alpha: alpha * 0.09 });
}

/* --------------------------------------------------------- flashs de bouche */
function drawMuzzleFlashes(c) {
  for (let i = 0; i < muzzleFlashes.length; i++) {
    const m = muzzleFlashes[i];
    const k = clamp(m.life / m.max, 0, 1);
    if (k <= 0) continue;

    const key = m.color ? PALETTE.get(m.color) : PALETTE.weapon(m.kind);
    const p = m.power == null ? 1 : m.power;
    const r = m.size * (0.5 + 1.2 * k);

    // éclat central
    NEON.dot(c, m.x, m.y, r * 0.40, key, { alpha: k * 0.62 * p, glowScale: 1.15 });

    // étoile à 4 branches, orientée dans l'axe du tir
    const spikes = 5 * k + 2;
    const ang = m.angle + m.spin * (1 - k) * 0.6;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    NEON.line(c, m.x - ca * spikes * 0.5, m.y - sa * spikes * 0.5,
                 m.x + ca * spikes * 1.35, m.y + sa * spikes * 1.35,
                 key, 1.4, { alpha: k * 0.55 * p, passes: 3 });
    NEON.line(c, m.x - sa * spikes * 0.6, m.y + ca * spikes * 0.6,
                 m.x + sa * spikes * 0.6, m.y - ca * spikes * 0.6,
                 key, 1.0, { alpha: k * 0.34 * p, passes: 2 });

    // anneau qui s'ouvre
    if (k > 0.15) {
      NEON.ring(c, m.x, m.y, (1 - k) * 11 + 2.5, 1.2, key, { alpha: k * 0.36 * p, passes: 3 });
    }
  }
}

/* =============================================================================
 *  EXPOSITION EXPLICITE
 *  Les scripts sont globaux et chargés dans un ordre fixe, mais un accès via
 *  window rend le contrat lisible pour les autres modules (HUD, powerups, game)
 *  et utilisable depuis la console de debug.
 * ========================================================================== */
window.player = player;
window.drawClassicPlayerHull = drawClassicPlayerHull;
window.drawInterceptorPlayerHull = drawInterceptorPlayerHull;
window.drawBastionPlayerHull = drawBastionPlayerHull;
window.setPlayerWeapon = setPlayerWeapon;
window.getPlayerWeaponLabel = getPlayerWeaponLabel;
window.isPlayerWeapon = isPlayerWeapon;
window.addPlayerShield = addPlayerShield;
window.consumePlayerShield = consumePlayerShield;
window.addPlayerMod = addPlayerMod;
window.playerHasMod = playerHasMod;
window.playerModTimer = playerModTimer;
window.playerModFraction = playerModFraction;
window.playerScoreMultiplier = playerScoreMultiplier;
window.playerTimeScale = playerTimeScale;
window.playerMagnetRange = playerMagnetRange;
window.playerMagnetPull = playerMagnetPull;
window.resetPlayerPowerState = resetPlayerPowerState;
window.applyPlayerDamageToEnemy = applyPlayerDamageToEnemy;
window.PLAYER_WEAPONS = PLAYER_WEAPONS;
window.PLAYER_WEAPON_LABELS = PLAYER_WEAPON_LABELS;
window.PLAYER_MOD_KEYS = PLAYER_MOD_KEYS;
window.PLAYER_SHIELD_MAX = PLAYER_SHIELD_MAX;
window.playerSpecialShots = playerSpecialShots;
