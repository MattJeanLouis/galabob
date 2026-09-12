/* =============================================================================
 *  galabob — POWER-UPS
 * -----------------------------------------------------------------------------
 *  TREIZE TYPES, TROIS EMPLACEMENTS INDÉPENDANTS, UNE SEULE TABLE.
 *
 *  1. LE PROBLÈME STRUCTUREL RÉSOLU
 *     Tout passait par `player.weapon` : un bouclier aurait écrasé le laser,
 *     un multiplicateur aurait annulé le spread. Les bonus se rangent
 *     désormais dans TROIS CASES QUI NE SE MARCHENT PAS DESSUS (déclarées et
 *     tenues par js/entities/player.js) :
 *
 *       weapon  EXCLUSIF    double · spread · laser · missiles · mitraille · onde
 *       shield  CHARGES     bouclier (s'ajoute, absorbe un coup par charge)
 *       mods    CUMULABLES  ralenti · aimant · multiplicateur · surcharge
 *                           (minuteries strictement indépendantes)
 *       —       INSTANTANÉ  bombe · vie  (n'occupent aucune case)
 *
 *     LASER Nv.3 + BOUCLIER ×2 + MULTIPLICATEUR ×2 peuvent donc tenir ensemble.
 *
 *  2. TABLE DATA-DRIVEN — `POWERUP_TYPES`
 *     Une seule structure décrit chaque type : clé, libellé, lettre,
 *     emplacement, couleur, forme vectorielle, poids de drop, durée. Le tirage,
 *     le rendu et le ramassage n'ont AUCUNE connaissance en dur : ils lisent
 *     cette table. Ajouter un 14ᵉ type = ajouter une ligne.
 *
 *  3. LISIBILITÉ EN PLEIN COMBAT (le point critique à 13 types)
 *     Chaque bonus porte TROIS marqueurs redondants : une COULEUR unique, une
 *     FORME VECTORIELLE unique (hexagone, losange, pentagone, écusson,
 *     sablier, fer à cheval, étoile 4/8, croix, soleil…) et une LETTRE unique.
 *     Même à moitié caché par une explosion, il reste identifiable.
 *
 *  4. DROP PONDÉRÉ
 *     Fini le `Math.random() < 0.5` entre deux types : tirage à la roulette sur
 *     les poids de la table. Les armes communes tombent souvent, la bombe, la
 *     vie et le ralenti restent des événements.
 *
 *  5. CONVENTIONS RESPECTÉES
 *     Vitesses en px/s intégrées avec dt, durées en ms, animations sur
 *     FRAME.time, couleurs via PALETTE, tracés via NEON, impact via JUICE.
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 *  ÉTAT GLOBAL
 * -------------------------------------------------------------------------- */

// Power-ups en vol
let powerUps = [];

// Effets de ramassage (purement visuels)
const powerUpPickups = [];

// Ondes de choc de BOMBE en cours (balayage de l'écran)
const bombWaves = [];

// Étincelles « ×2 » du multiplicateur, posées sur chaque kill bonifié
const multiplierSparks = [];

const POWERUP_SIZE = 26;             // px CSS — côté de la boîte de collision
const POWERUP_WOBBLE_HZ = 1.1;
const POWERUP_WOBBLE_AMP = 26;       // px/s de dérive latérale

/** Probabilité de butin par ennemi tué.
 *  TEMPO.POWERUP_DROP_CHANCE vaut encore 0.12 dans config.js, hors périmètre ;
 *  ensurePowerUpBridges() y recopie cette valeur au démarrage (voir plus bas). */
const POWERUP_DROP_CHANCE = 0.15;

/* =============================================================================
 *  1. LA TABLE — SOURCE UNIQUE DE VÉRITÉ DES POWER-UPS
 * -----------------------------------------------------------------------------
 *  key      : identifiant interne (== player.weapon / clé de player.mods)
 *  label    : libellé affiché au ramassage
 *  letter   : glyphe central, UNIQUE
 *  slot     : 'weapon' | 'shield' | 'mod' | 'instant'
 *  color    : clé PALETTE ou couleur CSS (PALETTE.get sait résoudre les deux)
 *  shape    : forme vectorielle de la cage (voir _powerUpShapePoints)
 *  weight   : poids de tirage (0 = jamais tiré)
 *  duration : ms (armes et modificateurs) — 0 pour les instantanés
 *  pips     : nombre de marqueurs orbitaux
 *  rare     : ajoute un anneau contre-rotatif — le butin rare doit SE VOIR
 * ========================================================================== */
const POWERUP_TYPES = window.GALABOB_POWER_UP_CATALOGUE;
const POWERUP_ALIASES = window.GALABOB_POWER_UP_ALIASES;
if (!Array.isArray(POWERUP_TYPES) || !POWERUP_ALIASES) {
  throw new Error('Le catalogue des power-ups doit etre charge avant powerups.js');
}

/* --- index par clé + alias tolérants ------------------------------------- */
const POWERUP_BY_KEY = {};
for (let i = 0; i < POWERUP_TYPES.length; i++) {
  POWERUP_BY_KEY[POWERUP_TYPES[i].key] = POWERUP_TYPES[i];
}

/** Définition d'un type. Ne renvoie JAMAIS null (repli : 'double'). */
function powerUpDef(type) {
  const registry = (typeof window !== 'undefined' && window.GALABOB)
    ? window.GALABOB.powerUps
    : null;
  if (registry) return registry.resolve(type, 'double');
  if (type && typeof type === 'object' && type.key) return type;
  const raw = String(type == null ? '' : type);
  let d = POWERUP_BY_KEY[raw];
  if (d) return d;
  const norm = raw.toLowerCase().replace(/[\s._\-/]/g, '');
  d = POWERUP_BY_KEY[norm] || POWERUP_BY_KEY[POWERUP_ALIASES[norm]];
  return d || POWERUP_BY_KEY.double;
}

/** Triplet PALETTE {core, glow, burst} d'un type. */
function powerUpTriplet(type) {
  return PALETTE.get(powerUpDef(type).color);
}

/** Couleur d'identité (hex) d'un type. Utilisée par player.js pour teinter
 *  les armes qui n'ont pas d'entrée dans PALETTE.weapon(). */
function powerUpColor(type) {
  return powerUpTriplet(type).glow;
}

/** Libellé affichable d'un type (HUD, popups). */
function powerUpLabel(type) {
  return powerUpDef(type).label;
}

/* =============================================================================
 *  2. TIRAGE PONDÉRÉ
 * ========================================================================== */

/** Poids CONTEXTUEL : certains bonus n'ont aucun sens à cet instant précis. */
function _powerUpWeight(def) {
  let w = def.weight || 0;
  if (w <= 0) return 0;

  const p = (typeof player !== 'undefined' && player) ? player : null;
  if (!p) return w;

  if (def.key === 'life') {
    // La vie est le contrepoids du corps-à-corps létal : elle n'apparaît que
    // si le joueur en manque, et d'autant plus qu'il est au bord du gouffre.
    const lives = p.lives | 0;
    if (lives >= 5) return 0;
    if (lives <= 1) return w * 3;
    if (lives === 2) return w * 1.8;
    return w;
  }

  if (def.slot === 'shield') {
    const max = (typeof PLAYER_SHIELD_MAX === 'number') ? PLAYER_SHIELD_MAX : 3;
    if ((p.shield | 0) >= max) return w * 0.15;      // presque jamais, jamais zéro
    if ((p.shield | 0) === 0) return w * 1.4;
    return w;
  }

  if (def.slot === 'weapon' && p.weapon === def.key) {
    // Monter une arme déjà équipée reste utile (Nv.2, Nv.3) mais on privilégie
    // la variété : au niveau max, ce doublon ne sert plus à grand-chose.
    return (p.weaponLevel | 0) >= 3 ? w * 0.35 : w * 0.8;
  }

  return w;
}

/** Tire un type au sort à la roulette pondérée. @returns {string} clé */
function rollPowerUpType() {
  const runtime = (typeof window !== 'undefined') ? window.GALABOB : null;
  if (runtime && runtime.powerUps) {
    const p = (typeof player !== 'undefined' && player) ? player : {};
    return runtime.powerUps.weightedRoll({
      lives: p.lives,
      shield: p.shield,
      shieldMax: (typeof PLAYER_SHIELD_MAX === 'number') ? PLAYER_SHIELD_MAX : 3,
      weapon: p.weapon,
      weaponLevel: p.weaponLevel
    }, runtime.random ? () => runtime.random.next() : Math.random);
  }

  let total = 0;
  const weights = new Array(POWERUP_TYPES.length);
  for (let i = 0; i < POWERUP_TYPES.length; i++) {
    const w = _powerUpWeight(POWERUP_TYPES[i]);
    weights[i] = w;
    total += w;
  }
  if (!(total > 0)) return 'double';

  let r = Math.random() * total;
  for (let i = 0; i < POWERUP_TYPES.length; i++) {
    r -= weights[i];
    if (r <= 0) return POWERUP_TYPES[i].key;
  }
  return POWERUP_TYPES[POWERUP_TYPES.length - 1].key;
}

/* =============================================================================
 *  3. CRÉATION
 * ========================================================================== */

function _powerUpRandom() {
  const runtime = (typeof window !== 'undefined') ? window.GALABOB : null;
  return runtime && runtime.random ? runtime.random.next() : Math.random();
}

/** Crée un power-up. Signature historique conservée :
 *      powerUps.push(createPowerUp(x, y))
 *  @param {string} [forcedType] force un type précis (debug, scénarisation) */
function createPowerUp(x, y, forcedType) {
  const def = forcedType ? powerUpDef(forcedType) : powerUpDef(rollPowerUpType());
  const trip = PALETTE.get(def.color);

  return {
    x: x,
    y: y,
    width: POWERUP_SIZE,
    height: POWERUP_SIZE,
    type: def.key,
    def: def,
    color: trip.glow,                    // legacy : certains modules lisent .color
    speed: TEMPO.POWERUP_FALL_SPEED,     // px/s
    vx: 0,
    vy: TEMPO.POWERUP_FALL_SPEED,        // px/s
    spin: _powerUpRandom() * Math.PI * 2,
    spinRate: (_powerUpRandom() < 0.5 ? -1 : 1) *
      (1.2 + _powerUpRandom()),                  // rad/s
    phase: _powerUpRandom() * Math.PI * 2,
    age: 0,
    magnet: false
  };
}

/* =============================================================================
 *  4. MISE À JOUR
 * ========================================================================== */
function updatePowerUps(deltaTime) {
  try {
    ensurePowerUpBridges();

    const dt = deltaTime / 1000;
    if (!(dt > 0)) return;
    if (typeof player === 'undefined' || !player) return;

    const pcx = player.x + player.width / 2;
    const pcy = player.y + player.height / 2;

    // Portée et force d'attraction : l'AIMANT les fait exploser (player.js).
    const range = (typeof playerMagnetRange === 'function') ? playerMagnetRange() : 120;
    const pull = (typeof playerMagnetPull === 'function') ? playerMagnetPull() : 1400;
    const range2 = range * range;

    for (let i = powerUps.length - 1; i >= 0; i--) {
      const p = powerUps[i];
      if (!p) { powerUps.splice(i, 1); continue; }

      // --- compatibilité : power-up créé par un code non converti -----------
      if (typeof p.vy !== 'number') {
        let s = Math.abs(typeof p.speed === 'number' ? p.speed : 0);
        if (s === 0) s = TEMPO.POWERUP_FALL_SPEED;
        else if (s < 60) s *= 60;               // ancienne unité : px/frame
        p.vy = s;
        p.speed = s;
      }
      if (typeof p.vx !== 'number') p.vx = 0;
      if (typeof p.age !== 'number') p.age = 0;
      if (typeof p.spin !== 'number') { p.spin = 0; p.spinRate = 1.8; p.phase = 0; }
      if (!p.def) p.def = powerUpDef(p.type);

      p.age += deltaTime;

      // --- aimant ----------------------------------------------------------
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      const dx = pcx - cx, dy = pcy - cy;
      const d2 = dx * dx + dy * dy;
      p.magnet = d2 < range2;

      if (p.magnet) {
        const d = Math.sqrt(d2) || 1;
        p.vx += (dx / d) * pull * dt;
        p.vy += (dy / d) * pull * dt;
        // frein visqueux : la course reste lisible au lieu d'osciller
        const k = Math.pow(0.02, dt);
        p.vx *= k; p.vy *= k;
        p.vy = Math.max(p.vy, TEMPO.POWERUP_FALL_SPEED * 0.4);
      } else {
        p.vx = damp(p.vx, 0, Math.pow(0.05, 4), dt);
        p.vy = damp(p.vy, TEMPO.POWERUP_FALL_SPEED, Math.pow(0.05, 3), dt);
      }

      // --- déplacement -----------------------------------------------------
      const wobble = p.magnet ? 0 : Math.sin(FRAME.time * POWERUP_WOBBLE_HZ * 6.2832 + p.phase) * POWERUP_WOBBLE_AMP;
      p.x += (p.vx + wobble) * dt;
      p.y += p.vy * dt;
      p.spin += p.spinRate * dt;

      if (p.y > CANVAS_HEIGHT + 40) { powerUps.splice(i, 1); continue; }

      // --- ramassage : AABB pleine taille (collision bénéfique) ------------
      if (rectIntersect(p, player)) {
        applyPowerUp(p.type, p.x + p.width / 2, p.y + p.height / 2);
        powerUps.splice(i, 1);
      }
    }

    updateBombWaves(deltaTime, dt);

    // --- effets de ramassage ------------------------------------------------
    for (let i = powerUpPickups.length - 1; i >= 0; i--) {
      const fx = powerUpPickups[i];
      fx.life -= deltaTime;
      fx.y -= 42 * dt;
      if (fx.life <= 0) powerUpPickups.splice(i, 1);
    }

    // --- étincelles du multiplicateur --------------------------------------
    for (let i = multiplierSparks.length - 1; i >= 0; i--) {
      const s = multiplierSparks[i];
      s.life -= deltaTime;
      s.y -= 58 * dt;
      if (s.life <= 0) multiplierSparks.splice(i, 1);
    }
  } catch (e) {
    console.error("Erreur dans updatePowerUps:", e);
  }
}

/* =============================================================================
 *  5. APPLICATION — AIGUILLAGE PAR EMPLACEMENT
 * ========================================================================== */

/** Applique un power-up au joueur, avec tout le retour sensoriel.
 *  Signature historique conservée : applyPowerUp(type, x, y). */
function applyPowerUp(type, x, y) {
  const def = powerUpDef(type);

  // Point d'origine des effets : le module, ou le vaisseau à défaut.
  if (typeof x !== 'number') x = player.x + player.width / 2;
  if (typeof y !== 'number') y = player.y;

  let label = def.label;
  let extraEvent = null;
  let handledByMode = false;

  // Certains modes remplacent la minuterie par une économie de munitions.
  const runtime = (typeof window !== 'undefined') ? window.GALABOB : null;
  const mode = runtime && runtime.modes ? runtime.modes.current() : null;
  if (mode && typeof mode.collectPowerUp === 'function') {
    const result = mode.collectPowerUp({ definition: def, x: x, y: y });
    if (result && result.handled) {
      handledByMode = true;
      label = result.label || def.label;
    }
  }

  if (!handledByMode) switch (def.slot) {

    /* --- EMPLACEMENT 1 : arme principale, EXCLUSIVE ---------------------- */
    case 'weapon': {
      const dur = def.duration || TEMPO.POWERUP_DURATION_MS;
      if (typeof setPlayerWeapon === 'function') {
        label = setPlayerWeapon(def.key, dur);
      } else {                                   // repli défensif
        player.weapon = def.key;
        player.weaponTimer = dur;
        player.weaponLevel = 1;
      }
      break;
    }

    /* --- EMPLACEMENT 2 : bouclier, S'AJOUTE ------------------------------ */
    case 'shield': {
      const n = (typeof addPlayerShield === 'function')
        ? addPlayerShield(def.charges || 1)
        : (player.shield = (player.shield | 0) + 1);
      label = 'BOUCLIER ×' + n;
      break;
    }

    /* --- EMPLACEMENT 3 : modificateurs CUMULABLES ------------------------ */
    case 'mod': {
      if (typeof addPlayerMod === 'function') addPlayerMod(def.key, def.duration);
      const secs = Math.round((def.duration || 0) / 1000);
      label = def.label + (secs ? ' ' + secs + 's' : '');
      break;
    }

    /* --- SANS EMPLACEMENT : effet instantané ----------------------------- */
    case 'instant':
    default: {
      if (def.key === 'life') {
        player.lives = Math.min((player.lives | 0) + 1, 9);
        label = '+1 VIE';
        extraEvent = 'extraLife';
      } else if (def.key === 'bombe') {
        triggerPowerUpBomb(x, y);
        label = 'BOMBE';
      } else if (def.key === 'arsenal') {
        const duration = def.effectDuration || TEMPO.POWERUP_DURATION_MS;
        if (typeof setPlayerWeapon === 'function') {
          setPlayerWeapon('double', duration);
          setPlayerWeapon('spread', duration);
          setPlayerWeapon('missiles', duration);
        }
        label = 'ARSENAL COMPLET';
      }
      break;
    }
  }

  /* --- RETOUR SENSORIEL : flash + hitstop + trauma + son ----------------- */
  const trip = PALETTE.get(def.color);
  const impact = def.impact || 1;

  JUICE.preset('powerUp', impact);
  JUICE.flash(trip.glow, 170 * impact, clamp(0.22 * impact, 0, 0.9));
  JUICE.hitstop(8 * impact);
  JUICE.shake(0.06 * impact);
  JUICE.punch(0.004 * impact);

  powerUpPickups.push({
    x: x,
    y: y,
    life: 560,
    max: 560,
    type: def.key,
    slot: def.slot,
    label: label
  });

  if (typeof createDebris === 'function') {
    try { createDebris(x, y, trip.burst, 'fast'); } catch (e) { /* ignoré */ }
  }
  // Braises montantes à la couleur du bonus (helper de effects.js).
  if (typeof createEmbers === 'function') {
    try { createEmbers(x, y, trip.glow, Math.round(12 * impact)); } catch (e) { /* ignoré */ }
  }
  if (typeof gameEvent === 'function') {
    gameEvent('powerUp', {
      type: def.key, slot: def.slot, key: def.key, level: player.weaponLevel
    });
    if (extraEvent) gameEvent(extraEvent, { lives: player.lives });
  }
}

/* =============================================================================
 *  6. BOMBE — flash blanc + onde de choc qui balaie l'écran
 * -----------------------------------------------------------------------------
 *  L'onde n'est PAS qu'un décor : elle efface les balles ennemies qu'elle
 *  franchit et endommage tout ce qu'elle traverse, au fil de son expansion.
 *  Le joueur voit donc littéralement le danger se faire balayer.
 * ========================================================================== */
const BOMB_DAMAGE = 4;
const BOMB_LIFE_MS = 720;

function triggerPowerUpBomb(x, y) {
  const white = PALETTE.get('#ffffff');

  // --- la claque ------------------------------------------------------------
  JUICE.hitstop(95);
  JUICE.shake(0.85);
  JUICE.punch(0.030);
  JUICE.flash(white.glow, 460, 0.95);

  // --- l'écran se vide de ses balles ---------------------------------------
  if (typeof enemyBullets !== 'undefined' && enemyBullets) {
    const n = Math.min(enemyBullets.length, 24);   // on n'illumine pas 200 balles
    for (let i = 0; i < n; i++) {
      const b = enemyBullets[i];
      if (!b || typeof createImpactSparks !== 'function') continue;
      try { createImpactSparks(b.x, b.y, 'shock', Math.random() * 6.2832, 3); }
      catch (e) { /* ignoré */ }
    }
    enemyBullets.length = 0;
  }

  bombWaves.push({
    x: x, y: y,
    r: 0,
    maxR: Math.hypot(CANVAS_WIDTH, CANVAS_HEIGHT) * 1.05,
    age: 0,
    life: BOMB_LIFE_MS,
    hits: []
  });

  if (typeof createShockwave === 'function') {
    try { createShockwave(x, y, 'shock', 0.6); } catch (e) { /* ignoré */ }
  }
  if (typeof gameEvent === 'function') {
    // 'bomb' est le nom propre ; 'ramKill' garantit un retour AUDIBLE tant que
    // sfx.js ne connaît pas l'événement (voir « branchements »).
    const played = (typeof SFX !== 'undefined' && SFX && typeof SFX.play === 'function')
      ? SFX.play('bomb', { x: x, y: y })
      : false;
    if (!played) gameEvent('ramKill', { type: 'bomb' });
  }
}

function updateBombWaves(deltaTime, dt) {
  for (let i = bombWaves.length - 1; i >= 0; i--) {
    const w = bombWaves[i];
    w.age += deltaTime;
    const k = clamp(w.age / w.life, 0, 1);

    // Expansion en freinage : très rapide au départ, elle s'étale à la fin.
    w.r = w.maxR * (1 - Math.pow(1 - k, 2.4));

    // --- balayage des balles ennemies apparues APRÈS le flash --------------
    if (typeof enemyBullets !== 'undefined' && enemyBullets) {
      const r2 = w.r * w.r;
      for (let j = enemyBullets.length - 1; j >= 0; j--) {
        const b = enemyBullets[j];
        if (!b) { enemyBullets.splice(j, 1); continue; }
        if (dist2(w.x, w.y, b.x, b.y) <= r2) enemyBullets.splice(j, 1);
      }
    }

    // --- dégâts sur tout ce que le front traverse --------------------------
    if (typeof enemies !== 'undefined' && enemies) {
      const r2 = w.r * w.r;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (!e || e.isDeleted) continue;
        if (w.hits.indexOf(e) >= 0) continue;
        const ex = e.x + e.width / 2, ey = e.y + e.height / 2;
        if (dist2(w.x, w.y, ex, ey) > r2) continue;

        w.hits.push(e);
        if (typeof applyPlayerDamageToEnemy === 'function') {
          applyPlayerDamageToEnemy(j, BOMB_DAMAGE, ex, ey, true);
        } else {
          e.hp -= BOMB_DAMAGE;
          if (e.hp <= 0 && typeof killEnemyAt === 'function') killEnemyAt(j, 'bullet');
        }
      }
    }

    if (k >= 1) bombWaves.splice(i, 1);
  }
}

/* =============================================================================
 *  7. RENDU
 * ========================================================================== */

/** Contexte des traînées, ou null. */
function _powerUpTrailCtx() {
  if (typeof NEON === 'undefined' || !NEON.trail) return null;
  if (!RENDER_CONFIG.trails || !NEON.isEnabled()) return null;
  return NEON.trail;
}

/* --- fabriques de formes vectorielles (repère local, origine au centre) --- */

function _polyPoints(r, sides, rot, sx, sy) {
  const pts = [];
  const kx = sx == null ? 1 : sx;
  const ky = sy == null ? 1 : sy;
  for (let i = 0; i < sides; i++) {
    const a = (rot || 0) + i * Math.PI * 2 / sides;
    pts.push(Math.cos(a) * r * kx, Math.sin(a) * r * ky);
  }
  return pts;
}

function _starPoints(r, points, inner, rot) {
  const pts = [];
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const a = (rot || 0) + i * Math.PI / points;
    const rr = (i % 2 === 0) ? r : r * inner;
    pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return pts;
}

/** Écusson (bouclier). */
function _shieldPoints(r) {
  return [
    0, -r,
    r * 0.86, -r * 0.55,
    r * 0.86, r * 0.20,
    0, r,
    -r * 0.86, r * 0.20,
    -r * 0.86, -r * 0.55
  ];
}

/** Sablier (ralenti). */
function _hourglassPoints(r) {
  return [
    -r * 0.80, -r * 0.84,
    r * 0.80, -r * 0.84,
    r * 0.15, 0,
    r * 0.80, r * 0.84,
    -r * 0.80, r * 0.84,
    -r * 0.15, 0
  ];
}

/** Fer à cheval (aimant) : deux branches vers le haut, arc en bas.
 *  Le rayon intérieur (0,62) est choisi pour dégager un puits central où la
 *  lettre reste lisible : la forme ne doit jamais manger son propre glyphe. */
function _magnetPoints(r) {
  const pts = [];
  const N = 10;
  pts.push(r, -r * 0.80);
  for (let i = 0; i <= N; i++) {                 // arc extérieur, droite -> gauche
    const a = (i / N) * Math.PI;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  pts.push(-r, -r * 0.80);
  pts.push(-r * 0.62, -r * 0.80);
  for (let i = N; i >= 0; i--) {                 // arc intérieur, gauche -> droite
    const a = (i / N) * Math.PI;
    pts.push(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
  }
  pts.push(r * 0.62, -r * 0.80);
  return pts;
}

/** Croix (vie). */
function _crossPoints(r) {
  const t = r * 0.34;
  return [
    t, -r, t, -t, r, -t, r, t, t, t, t, r,
    -t, r, -t, t, -r, t, -r, -t, -t, -t, -t, -r
  ];
}

/** Points de la cage d'un type, pour un rayon donné. */
function _powerUpShapePoints(def, r) {
  const s = def.shape || { kind: 'poly', sides: 6, rot: 0 };
  switch (s.kind) {
    case 'star':      return _starPoints(r, s.points || 5, s.inner || 0.45, s.rot);
    case 'shield':    return _shieldPoints(r);
    case 'hourglass': return _hourglassPoints(r);
    case 'magnet':    return _magnetPoints(r);
    case 'cross':     return _crossPoints(r);
    default:          return _polyPoints(r, s.sides || 6, s.rot, s.sx, s.sy);
  }
}

/** Un module en vol : halo pulsant + cage + lettre + noyau. */
function drawPowerUps() {
  const c = ctx;
  const t = FRAME.time;
  const tr = _powerUpTrailCtx();

  for (let i = 0; i < powerUps.length; i++) {
    const p = powerUps[i];
    if (!p) continue;

    const def = p.def || (p.def = powerUpDef(p.type));
    const col = PALETTE.get(def.color);
    const cx = p.x + p.width / 2;
    const cy = p.y + p.height / 2;
    const r = p.width / 2;
    const pulse = 1 + 0.11 * Math.sin(t * 6.4 + (p.phase || 0));
    const alpha = p.magnet ? 1 : 0.94;

    // Traînée : sillage vertical, plus long quand le module est aspiré.
    if (tr) {
      NEON.line(tr, cx, cy, cx - (p.vx || 0) * 0.012, cy - (p.magnet ? 26 : 14),
                col, 2.4, { alpha: p.magnet ? 0.45 : 0.26, passes: 2 });
    }

    c.save();
    c.translate(cx, cy);

    // Halo de fond, non tourné : l'objet doit se voir de loin, et PULSER.
    const halo = 0.26 + 0.14 * Math.sin(t * 5.1 + (p.phase || 0) * 1.7);
    NEON.dot(c, 0, 0, r * 0.46 * pulse, col, { alpha: halo, glowScale: 2.0 });

    // --- la CAGE : forme vectorielle propre au type ------------------------
    c.save();
    c.rotate(p.spin || 0);
    c.scale(pulse, pulse);

    NEON.shape(c, _powerUpShapePoints(def, r), col, 1.7, {
      alpha: alpha, fill: true, fillAlpha: 0.16, glowScale: 1.15
    });

    // Rayons du soleil (bombe) : la seule forme qui déborde de sa cage.
    const rays = def.shape && def.shape.rays;
    if (rays) {
      for (let k = 0; k < rays; k++) {
        const a = k * Math.PI * 2 / rays + t * 0.9;
        NEON.line(c, Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05,
                     Math.cos(a) * r * 1.55, Math.sin(a) * r * 1.55,
                  col, 1.4, { alpha: alpha * 0.7, passes: 3 });
      }
    }

    // Marqueurs orbitaux : leur NOMBRE est un indice de plus.
    const pips = def.pips == null ? 3 : def.pips;
    for (let k = 0; k < pips; k++) {
      const a = k * (Math.PI * 2 / Math.max(1, pips));
      NEON.dot(c, Math.cos(a) * r * 1.34, Math.sin(a) * r * 1.34, 1.4, col,
               { alpha: alpha * 0.8 });
    }
    c.restore();

    // Anneau contre-rotatif des bonus RARES : on doit se jeter dessus.
    if (def.rare) {
      NEON.ring(c, 0, 0, r * 1.62 + 1.5 * Math.sin(t * 4.3), 1.1, col, {
        alpha: alpha * 0.5, dash: [4, 7], dashOffset: t * 34, passes: 2
      });
    }

    // --- la LETTRE : redondance de lecture, toujours d'aplomb -------------
    if (def.letter) {
      NEON.text(c, def.letter, 0, 0.5, col, {
        size: Math.round(r * 1.15),
        align: 'center',
        baseline: 'middle',
        alpha: alpha,
        glowScale: 0.8
      });
    }

    c.restore();
  }

  drawBombWaves(c);
  drawSlowMotionOverlay(c);
  drawMultiplierSparks(c);
  drawPowerUpPickups(c);
}

/** Gerbe d'anneaux + libellé au moment du ramassage.
 *  La gerbe change de dessin selon l'EMPLACEMENT : arme (éclats radiaux),
 *  bouclier (hexagone qui se referme), mod (anneau pointillé), instantané
 *  (double détonation). Le ressenti dit déjà ce qu'on vient de gagner. */
function drawPowerUpPickups(c) {
  for (let i = 0; i < powerUpPickups.length; i++) {
    const fx = powerUpPickups[i];
    const k = clamp(fx.life / fx.max, 0, 1);
    const e = 1 - k;                       // 0 → 1 au fil de l'effet
    const def = powerUpDef(fx.type);
    const col = PALETTE.get(def.color);
    const big = def.impact || 1;

    NEON.ring(c, fx.x, fx.y, 6 + e * 64 * big, 2.4 * k, col, { alpha: k * 0.75, passes: 3 });
    NEON.ring(c, fx.x, fx.y, 2 + e * 34 * big, 1.4 * k, 'debris', { alpha: k * 0.55, passes: 2 });

    if (fx.slot === 'shield') {
      // Une coque hexagonale se referme sur le point de ramassage.
      const r = 46 * k + 10;
      const pts = _polyPoints(r, 6, e * 1.2);
      NEON.shape(c, pts, col, 1.8 * k + 0.3, { alpha: k * 0.7, passes: 3 });

    } else if (fx.slot === 'mod') {
      // Anneau pointillé qui se resserre : une DURÉE vient de démarrer.
      NEON.ring(c, fx.x, fx.y, 52 * k + 8, 1.6, col, {
        alpha: k * 0.7, dash: [5, 8], dashOffset: e * 60, passes: 3
      });

    } else {
      // Armes et instantanés : six éclats radiaux.
      const spokes = fx.slot === 'instant' ? 10 : 6;
      for (let s = 0; s < spokes; s++) {
        const a = s * Math.PI * 2 / spokes + e * 0.9;
        const r0 = 8 + e * 30 * big, r1 = r0 + 10 * k * big;
        NEON.line(c,
          fx.x + Math.cos(a) * r0, fx.y + Math.sin(a) * r0,
          fx.x + Math.cos(a) * r1, fx.y + Math.sin(a) * r1,
          col, 1.6, { alpha: k * 0.7, passes: 3 });
      }
    }

    if (fx.label) {
      NEON.text(c, fx.label, fx.x, fx.y - 22 - e * 14, col, {
        size: 15,
        align: 'center',
        baseline: 'middle',
        alpha: k
      });
    }
  }
}

/** L'onde de la bombe : un front blanc qui traverse tout l'écran. */
function drawBombWaves(c) {
  for (let i = 0; i < bombWaves.length; i++) {
    const w = bombWaves[i];
    const k = clamp(w.age / w.life, 0, 1);
    const f = 1 - k;                              // énergie restante

    // Front principal : large au départ, fin à la sortie de l'écran.
    NEON.ring(c, w.x, w.y, w.r, 2 + 7 * f, '#ffffff', { alpha: 0.20 + 0.70 * f, passes: 4 });
    NEON.ring(c, w.x, w.y, w.r * 0.86, 1.4 + 3 * f, '#8affff', { alpha: 0.45 * f, passes: 3 });
    NEON.ring(c, w.x, w.y, w.r * 0.70, 1.0 + 2 * f, '#c86bff', { alpha: 0.30 * f, passes: 2 });

    // Rayons : le souffle, pas seulement l'anneau.
    const spokes = 18;
    for (let s = 0; s < spokes; s++) {
      const a = s * Math.PI * 2 / spokes + k * 0.5;
      const r0 = w.r * 0.78, r1 = w.r * (1 + 0.06 * f);
      NEON.line(c, w.x + Math.cos(a) * r0, w.y + Math.sin(a) * r0,
                   w.x + Math.cos(a) * r1, w.y + Math.sin(a) * r1,
                '#ffffff', 1.4, { alpha: 0.42 * f, passes: 2 });
    }

    // Cœur incandescent du premier tiers.
    if (k < 0.35) {
      const kk = 1 - k / 0.35;
      NEON.dot(c, w.x, w.y, 10 + 46 * kk, '#ffffff', { alpha: kk * 0.55, glowScale: 2.2 });
    }
  }
}

/** RALENTI : l'écran doit DIRE qu'il est au ralenti, sans masquer l'action.
 *  Bandes horizontales lentes + anneau de champ autour du vaisseau. */
function drawSlowMotionOverlay(c) {
  const ts = (typeof playerTimeScale === 'function') ? playerTimeScale() : 1;
  if (ts > 0.985) return;

  const floor = (typeof PLAYER_RALENTI_SCALE === 'number') ? PLAYER_RALENTI_SCALE : 0.34;
  const k = clamp((1 - ts) / Math.max(0.001, 1 - floor), 0, 1);
  const col = powerUpColor('ralenti');
  const t = FRAME.time;

  // Bandes de balayage : lentes, espacées, discrètes.
  const step = 96;
  const off = (t * 26) % step;
  for (let y = -off; y < CANVAS_HEIGHT; y += step) {
    NEON.line(c, 0, y, CANVAS_WIDTH, y, col, 1.0, { alpha: k * 0.10, passes: 2 });
  }

  // Champ autour du vaisseau : c'est LUI qui est resté à vitesse normale.
  if (typeof player !== 'undefined' && player) {
    const cx = player.x + player.width / 2;
    const cy = player.y + player.height / 2;
    for (let i = 0; i < 2; i++) {
      const r = 60 + i * 34 + 7 * Math.sin(t * 2.2 - i);
      NEON.ring(c, cx, cy, r, 1.1, col, {
        alpha: k * (0.22 - i * 0.08),
        dash: [10, 16],
        dashOffset: (i % 2 ? 1 : -1) * t * 28,
        passes: 2
      });
    }
  }
}

/** Le « ×2 » posé sur chaque kill pendant le multiplicateur. */
function drawMultiplierSparks(c) {
  if (!multiplierSparks.length) return;
  const col = PALETTE.get(powerUpDef('multiplicateur').color);
  for (let i = 0; i < multiplierSparks.length; i++) {
    const s = multiplierSparks[i];
    const k = clamp(s.life / s.max, 0, 1);
    NEON.text(c, '×2', s.x, s.y, col, {
      size: 13, align: 'center', baseline: 'middle', alpha: k * 0.9
    });
    NEON.ring(c, s.x, s.y, 8 + (1 - k) * 16, 1.1, col, { alpha: k * 0.4, passes: 2 });
  }
}

/* =============================================================================
 *  8. PONTS D'INTÉGRATION (temporaires)
 * -----------------------------------------------------------------------------
 *  Quatre comportements demandés touchent des fonctions de game.js, qui est
 *  HORS DE MON PÉRIMÈTRE. Plutôt que de livrer des bonus inertes, ce module
 *  enveloppe ces fonctions globales AU DÉMARRAGE, depuis son propre fichier :
 *
 *    damagePlayer      -> le BOUCLIER absorbe le coup avant la perte de vie
 *    killEnemyAt       -> le MULTIPLICATEUR double les points marqués
 *    updateEnemies     -> le RALENTI ralentit les ennemis (pas le joueur)
 *    updateEnemyBullets-> idem pour leurs projectiles
 *    initGame          -> remise à zéro des trois emplacements
 *    TEMPO.POWERUP_DROP_CHANCE -> passe de 0.12 à POWERUP_DROP_CHANCE (0.15)
 *
 *  Chaque enveloppe est IDEMPOTENTE et marquée : si le propriétaire applique
 *  un jour les branchements propres décrits dans le rapport, il lui suffit de
 *  supprimer cette section — rien d'autre ne bouge.
 * ========================================================================== */

let _powerUpBridgesWired = false;

function ensurePowerUpBridges() {
  if (_powerUpBridgesWired) return;
  // game.js est chargé APRÈS ce fichier : on attend qu'il soit évalué.
  if (typeof damagePlayer !== 'function' || typeof killEnemyAt !== 'function') return;
  _powerUpBridgesWired = true;

  /* --- PLUS RIEN À PONTER -------------------------------------------------
   *  Les quatre enveloppes d'origine (BOUCLIER dans damagePlayer, MULTIPLICATEUR
   *  dans killEnemyAt, RALENTI sur updateEnemies/updateEnemyBullets, remise à
   *  zéro dans initGame) ont été REMPLACÉES par les branchements propres décrits
   *  dans le rapport : ils sont désormais écrits en clair dans js/game.js, et le
   *  taux de butin vit dans TEMPO (config.js). Les garder ici DOUBLERAIT leur
   *  effet (points ×4, ralenti ×0.11) : c'est pour ça que la section est vide.
   *  La fonction est conservée parce que player.js l'appelle encore.
   * ---------------------------------------------------------------------- */
}

// Branchement AU PLUS TÔT : la toute première partie est lancée depuis le menu,
// donc avant qu'updatePlayer()/updatePowerUps() n'aient jamais tourné. Sans ce
// réveil anticipé, l'enveloppe d'initGame() manquerait ce premier appel.
if (typeof window !== 'undefined') {
  setTimeout(ensurePowerUpBridges, 0);
  window.addEventListener('load', ensurePowerUpBridges);
}

/* -----------------------------------------------------------------------------
 *  EXPOSITION EXPLICITE
 * -------------------------------------------------------------------------- */
window.POWERUP_TYPES = POWERUP_TYPES;
window.POWERUP_ALIASES = POWERUP_ALIASES;
window.POWERUP_DROP_CHANCE = POWERUP_DROP_CHANCE;
window.powerUpDef = powerUpDef;
window.powerUpColor = powerUpColor;
window.powerUpTriplet = powerUpTriplet;
window.powerUpLabel = powerUpLabel;
window.rollPowerUpType = rollPowerUpType;
window.createPowerUp = createPowerUp;
window.applyPowerUp = applyPowerUp;
window.triggerPowerUpBomb = triggerPowerUpBomb;
window.ensurePowerUpBridges = ensurePowerUpBridges;
