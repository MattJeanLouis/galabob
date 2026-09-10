/* =============================================================================
 *  galabob — PROJECTILES
 * -----------------------------------------------------------------------------
 *  CONVENTION : toutes les vitesses sont en PIXELS CSS PAR SECONDE et sont
 *  intégrées avec dt.  (Avant : `bullet.y -= bullet.speed` une fois par frame,
 *  soit un jeu deux fois plus rapide sur un écran 120 Hz.)
 *
 *  PONT DE COMPATIBILITÉ
 *  ---------------------
 *  D'autres modules (enemies.js) créent encore des balles avec l'ancienne
 *  convention `speed: 3` (px/FRAME). normalizeBullet() détecte ce cas : toute
 *  vitesse inférieure à LEGACY_SPEED_MAX est considérée comme des px/frame et
 *  convertie en px/s (×60). Aucune vitesse légitime du TEMPO n'est en dessous
 *  de 200 px/s : la détection ne peut pas se tromper.
 *
 *  BALAYAGE (anti-tunnel)
 *  ----------------------
 *  Une balle joueur file à 1150 px/s : à 30 fps elle parcourt 38 px par frame
 *  et peut traverser un ennemi sans le toucher. La boîte de collision des
 *  balles JOUEUR est donc étirée sur la distance réellement parcourue dans la
 *  frame (`height` = trajet + longueur visuelle), tandis que `drawH` garde la
 *  longueur d'affichage. Les balles ENNEMIES n'ont volontairement PAS ce
 *  traitement : en cas de framerate bas, l'imprécision doit profiter au joueur.
 *
 *  GRAMMAIRE VISUELLE (référence : les shmups de Cave)
 *  ---------------------------------------------------
 *    • BALLE JOUEUR  : capsule fine et longue, noyau blanc, halo CYAN, traînée.
 *    • BALLE ENNEMIE : losange trapu, noyau blanc, halo ROUGE + anneau.
 *  Deux silhouettes, deux teintes : aucune confusion possible dans le feu.
 * ========================================================================== */

// Tableaux pour les projectiles
let playerBullets = [];
let enemyBullets = [];

// En dessous de cette vitesse, on considère qu'on lit une valeur "px/frame"
// héritée de l'ancien code et on la convertit.
const LEGACY_SPEED_MAX = 60;

// Plafond de sécurité : évite qu'un bug fasse exploser la mémoire.
const MAX_PLAYER_BULLETS = 160;

/* =============================================================================
 *  CRÉATION
 * ========================================================================== */

/** Crée et enregistre un projectile du joueur.
 *  @param {number} x  centre horizontal du canon (px CSS)
 *  @param {number} y  position du bout du canon (px CSS)
 *  @param {object} [opts] {vx, vy, speed, weapon, width, height, damage}
 *  @returns {object} le projectile créé */
function spawnPlayerBullet(x, y, opts) {
  opts = opts || {};
  const w = opts.width == null ? TEMPO.PLAYER_BULLET_W : opts.width;
  const h = opts.height == null ? TEMPO.PLAYER_BULLET_H : opts.height;
  const speed = opts.speed == null ? TEMPO.PLAYER_BULLET_SPEED : opts.speed;

  const b = {
    x: x - w / 2,
    y: y - h,
    width: w,
    height: h,        // étiré au balayage pendant la mise à jour
    drawH: h,         // longueur d'affichage, jamais étirée
    vx: opts.vx || 0,
    vy: opts.vy == null ? -Math.abs(speed) : opts.vy,
    speed: Math.abs(speed),
    weapon: opts.weapon || 'normal',
    damage: opts.damage == null ? 1 : opts.damage,
    age: 0,
    owner: 'player'
  };

  if (playerBullets.length >= MAX_PLAYER_BULLETS) playerBullets.shift();
  playerBullets.push(b);
  return b;
}

/** Crée et enregistre un projectile ennemi. Utilisable par enemies.js :
 *      spawnEnemyBullet(cx, enemy.y + enemy.height, { kind: enemy.type });
 *  @param {object} [opts] {vx, vy, speed, kind, width, height} */
function spawnEnemyBullet(x, y, opts) {
  opts = opts || {};
  const kind = opts.kind || opts.type || 'normal';
  const w = opts.width == null ? TEMPO.ENEMY_BULLET_W : opts.width;
  const h = opts.height == null ? TEMPO.ENEMY_BULLET_H : opts.height;
  const speed = opts.speed == null
    ? (kind === 'shooter' ? TEMPO.ENEMY_BULLET_SPEED_SHOOTER : TEMPO.ENEMY_BULLET_SPEED)
    : opts.speed;

  const b = {
    x: x - w / 2,
    y: y,
    width: w,
    height: h,
    drawH: h,
    vx: opts.vx || 0,
    vy: opts.vy == null ? Math.abs(speed) : opts.vy,
    speed: Math.abs(speed),
    kind: kind,
    age: 0,
    owner: 'enemy'
  };

  enemyBullets.push(b);
  return b;
}

/* =============================================================================
 *  NORMALISATION — accueille les projectiles créés par du code non converti
 * ========================================================================== */

/** Complète un projectile hérité : vx/vy en px/s, drawH, age, kind.
 *  @param {object} b
 *  @param {number} sign  -1 vers le haut (joueur), +1 vers le bas (ennemi) */
function normalizeBullet(b, sign) {
  if (b.drawH == null) b.drawH = (typeof b.height === 'number' ? b.height : 10);
  if (b.age == null) b.age = 0;

  if (typeof b.vy !== 'number') {
    let s = Math.abs(typeof b.speed === 'number' ? b.speed : 0);
    if (s === 0) s = (sign < 0 ? TEMPO.PLAYER_BULLET_SPEED : TEMPO.ENEMY_BULLET_SPEED);
    else if (s < LEGACY_SPEED_MAX) s *= 60;    // ancienne unité : px/frame
    b.vy = sign * s;
    b.speed = s;
  }

  if (typeof b.vx !== 'number') {
    // `dx` historique : déviation appliquée ×2 par frame, soit ×120 px/s.
    b.vx = (typeof b.dx === 'number') ? b.dx * 120 : 0;
  }

  if (!b.kind) {
    // enemies.js code encore ses balles par couleur CSS ; on rétablit un type.
    if (b.type) b.kind = b.type;
    else if (b.color === 'magenta' || b.color === '#ff00ff') b.kind = 'shooter';
    else b.kind = 'normal';
  }
  return b;
}

/* =============================================================================
 *  MISE À JOUR
 * ========================================================================== */

/** Projectiles du joueur. @param {number} deltaTime ms de temps de jeu. */
function updatePlayerBullets(deltaTime) {
  const dt = deltaTime / 1000;
  if (!(dt > 0)) return;

  for (let i = playerBullets.length - 1; i >= 0; i--) {
    const b = playerBullets[i];
    if (!b) { playerBullets.splice(i, 1); continue; }

    normalizeBullet(b, -1);

    b.age += deltaTime;

    const dy = b.vy * dt;         // négatif : vers le haut
    b.x += b.vx * dt;
    b.y += dy;

    // Balayage : la boîte couvre le trajet parcouru dans la frame.
    b.height = b.drawH + Math.abs(dy);

    if (b.y + b.drawH < -24 ||
        b.x + b.width < -40 || b.x > CANVAS_WIDTH + 40) {
      playerBullets.splice(i, 1);
    }
  }
}

/** Projectiles ennemis. @param {number} deltaTime ms de temps de jeu. */
function updateEnemyBullets(deltaTime) {
  const dt = deltaTime / 1000;
  if (!(dt > 0)) return;

  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const b = enemyBullets[i];
    if (!b) { enemyBullets.splice(i, 1); continue; }

    normalizeBullet(b, 1);

    b.age += deltaTime;

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.y > CANVAS_HEIGHT + 24 ||
        b.x + b.width < -40 || b.x > CANVAS_WIDTH + 40) {
      enemyBullets.splice(i, 1);
    }
  }
}

/* =============================================================================
 *  RENDU
 * ========================================================================== */

/** Contexte des traînées, ou null si elles sont désactivées. */
/** Longueur (en secondes) du segment de traînée tamponné à chaque frame.
 *
 *  On tamponne EXACTEMENT le chemin parcouru depuis la frame précédente, avec
 *  un léger recouvrement (×1.25) pour qu'il n'y ait aucun trou.
 *  Avant, la traînée était un segment de longueur et de pente FIXES : sa pente
 *  ne correspondait pas à la trajectoire réelle des tirs en biais, si bien que
 *  les tampons successifs se lisaient comme une chaîne de bâtonnets penchés le
 *  long d'un chemin plus plat, au lieu d'un sillage continu.
 *  Suivre la vitesse réelle rend le sillage correct à toute vitesse, tout
 *  angle et tout fps. */
function _trailStep() {
  const dt = (FRAME && FRAME.dt > 0) ? FRAME.dt : (1 / 60);
  return Math.min(Math.max(dt, 1 / 240), 1 / 20) * 1.25;
}

function _bulletTrailCtx() {
  if (typeof NEON === 'undefined' || !NEON.trail) return null;
  if (!RENDER_CONFIG.trails || !NEON.isEnabled()) return null;
  return NEON.trail;
}

/** Projectiles du joueur : capsule fine, noyau blanc, traînée, flash de naissance. */
function drawPlayerBullets() {
  const c = ctx;
  const tr = _bulletTrailCtx();

  for (let i = 0; i < playerBullets.length; i++) {
    const b = playerBullets[i];
    if (!b) continue;

    const key = PALETTE.weapon(b.weapon || 'normal');
    const h = b.drawH || TEMPO.PLAYER_BULLET_H;
    const w = b.width || TEMPO.PLAYER_BULLET_W;
    const cx = b.x + w / 2;

    // Naissance : la balle jaillit un peu plus large et plus lumineuse.
    const birth = b.age < 55 ? 1 - b.age / 55 : 0;

    // Traînée persistante : le chemin exact parcouru depuis la frame d'avant.
    if (tr) {
      const st = _trailStep();
      NEON.line(tr, cx, b.y + h, cx - (b.vx || 0) * st, b.y + h - (b.vy || 0) * st, key, 2.0, {
        alpha: 0.46, passes: 2
      });
    }

    // Sillage court dans la scène : c'est lui qui donne la LONGUEUR, la
    // lecture d'une lance et non d'une bille.
    NEON.line(c, cx - b.vx * 0.004, b.y + h * 0.8, cx - b.vx * 0.013, b.y + h + 13,
              key, 1.5, { alpha: 0.34, passes: 3 });

    // Corps : capsule néon (halo coloré + noyau quasi blanc).
    NEON.beam(c, b.x - birth * 0.5, b.y, w + birth, h, key, {
      alpha: 1,
      glowScale: 0.82 + birth * 0.5
    });

    // Épine blanche : le noyau net qui survit au bloom.
    NEON.line(c, cx, b.y + 2, cx, b.y + h - 2, 'playerCore', 0.8,
              { alpha: 0.9, passes: 2 });

    // Éclat de naissance — discret : une salve 'spread' en fait naître sept
    // au même endroit, et le rendu est additif.
    if (birth > 0.3) {
      NEON.ring(c, cx, b.y + h * 0.5, 3 + (1 - birth) * 12, 1.1, key,
                { alpha: (birth - 0.3) * 0.42, passes: 3 });
    }
  }
}

/** Projectiles ennemis : losange trapu, halo rouge, anneau tournant.
 *  Silhouette et couleur volontairement à l'opposé de celles du joueur. */
function drawEnemyBullets() {
  const c = ctx;
  const tr = _bulletTrailCtx();
  const t = FRAME.time;

  for (let i = 0; i < enemyBullets.length; i++) {
    const b = enemyBullets[i];
    if (!b) continue;

    const key = PALETTE.bullet('enemy', b.kind || 'normal');
    const w = b.width || TEMPO.ENEMY_BULLET_W;
    const h = b.drawH || b.height || TEMPO.ENEMY_BULLET_H;
    const cx = b.x + w / 2;
    const cy = b.y + h / 2;
    const rx = w * 0.95;
    const ry = h * 0.62;

    if (tr) {
      const st = _trailStep();
      NEON.line(tr, cx, cy, cx - (b.vx || 0) * st, cy - (b.vy || 0) * st, key, 2.2, {
        alpha: 0.42, passes: 2
      });
    }

    // Losange : pointe en bas (sens de la marche).
    NEON.shape(c, [
      cx, cy + ry,
      cx + rx, cy,
      cx, cy - ry,
      cx - rx, cy
    ], key, 1.8, { alpha: 1, fill: true, fillAlpha: 0.42, glowScale: 1.35 });

    // Noyau blanc : c'est le point qui tue, il doit rester net dans le bloom.
    NEON.dot(c, cx, cy, 1.6, 'bulletEnemy', { alpha: 1, glowScale: 0.9 });

    // Anneau de menace, en rotation lente : lisible même sur fond chargé.
    NEON.ring(c, cx, cy, rx * 1.55, 1.0, key, {
      alpha: 0.30 + 0.14 * Math.sin(t * 7 + i),
      dash: [3, 4],
      dashOffset: t * 22,
      passes: 2
    });
  }
}

/* -----------------------------------------------------------------------------
 *  Exposition explicite (les autres modules sont chargés dans un ordre fixe,
 *  mais un accès via window reste utile au debug console).
 * -------------------------------------------------------------------------- */
window.spawnPlayerBullet = spawnPlayerBullet;
window.spawnEnemyBullet = spawnEnemyBullet;
