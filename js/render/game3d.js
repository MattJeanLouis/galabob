/**
 * MENACE — la seconde caméra des stages 2D.
 *
 * MÊME STAGE, MÊME SIMULATION, MÊME ART. Ce module ne fait que REGARDER la
 * scène 2D autrement : le plan du jeu (les `x`/`y` de la simulation) devient un
 * plan horizontal vu de derrière le vaisseau, et « monter » à l'écran devient
 * « aller vers l'horizon ». Rien n'est simulé ici : le module LIT l'état du jeu,
 * le projette, et laisse LE JEU dessiner ses propres formes.
 *
 * LA FIDÉLITÉ VIENT DE LÀ. Chaque élément est tracé par SA fonction habituelle
 * (`drawEnemyShip`, `drawPlayer`, `BOSS.drawWorld`, `drawPlayerBullet`…),
 * simplement à travers une transformation par entité :
 *
 *     translate(position projetée) · scale(pixels par unité du monde)
 *                                  · translate(-centre logique de l'entité)
 *
 * Un tracé néon garde donc exactement son halo, ses passes additives et sa
 * couleur : c'est le même appel de fonction, pas une seconde interprétation.
 *
 * CE QUI A ÉTÉ ESSAYÉ ET ABANDONNÉ — pour ne pas le repayer :
 *
 *  1. LES SPRITES. Rendre l'art du jeu dans un canvas pour l'afficher comme
 *     image garde la FORME mais perd la MATIÈRE : un halo néon n'est pas une
 *     image plate. Le joueur l'a jugé, à juste titre, « moche et pas fidèle ».
 *
 *  2. UN CIEL À PART. Le vrai ciel du jeu — nébuleuse, étoiles, planète — est
 *     déjà peint par `drawStars()`. Le redessiner sur un plan Three.js donnait
 *     deux ciels concurrents, et le nôtre restait VIDE (mesuré en jeu : zéro
 *     image d'astre reçue sur des centaines de frames). Conséquence heureuse :
 *     la vue n'a plus AUCUNE dépendance WebGL — elle compose avec le décor du
 *     jeu, qui est déjà à l'écran. Il n'y a donc plus de « vue indisponible ».
 *
 *  3. UN SOL QUADRILLÉ. Il n'existe dans aucune autre vue du jeu. Un décor
 *     étranger, donc — c'est précisément ce qui faisait dire « un autre jeu »
 *     plutôt que « une autre caméra sur le même ».
 *
 * LA PROJECTION EST ÉCRITE ICI, À LA MAIN, et c'est délibéré : le modèle
 * sténopé tient en quinze lignes, il ne dépend d'aucune librairie, et il se
 * vérifie sans navigateur. `pixelsParUnite` vaut `(hauteur/2) / (profondeur ×
 * tan(fov/2))` : c'est la même valeur à l'horizontale et à la verticale, donc
 * une entité garde ses proportions en toutes circonstances.
 */
const GAME3D = (() => {
  /* ---------------------------------------------------------------------
   *  PLACEMENT DE LA CAMÉRA
   *  Elle se place AU-DESSUS et DERRIÈRE le vaisseau, et elle RETARDE sur ses
   *  déplacements : c'est ce mou qui donne la sensation d'être à bord. Une
   *  caméra collée et parfaitement centrée donnait une vue d'observation inerte.
   * ------------------------------------------------------------------- */
  const CAM_HEIGHT_RATIO = 0.30;   // altitude = hauteur du canvas × ce ratio
  const CAM_BACK_RATIO = 0.55;     // recul derrière le vaisseau
  const CAM_BACK_MIN = 240;        // plancher : sans lui, le ratio n'agissait plus
  const CAM_LAG_X = 0.14;          // le cadre retarde sur les déplacements
  const CAM_ROLL = 0.10;           // inclinaison du cadre quand on vire
  const CAM_LOOK_RATIO = 0.60;     // distance du point visé devant le vaisseau
  const CAM_LOOK_Y = 30;           // hauteur du point visé

  // Champ LARGE (mesuré) : à 44° la caméra rapprochée laissait 60 % du bord
  // latéral hors cadre — une menace pouvait tirer sans être vue. À 60°, le
  // vaisseau reste bas dans le cadre ET le bord redevient visible sur les deux
  // tiers de sa profondeur.
  const FOV = 60;
  const TAN_HALF_FOV = Math.tan(FOV * Math.PI / 360);

  const NEAR_DEPTH = 60;     // en deçà la projection diverge : on ne trace pas
  const MAX_SCALE = 8;       // garde-fou mémoire sur les rayons projetés
  const MAX_FX = 96;         // particules d'effet projetées
  const MAX_ENEMIES = 48;
  const MAX_SHOTS = 160;
  const MAX_ENEMY_SHOTS = 96;
  const CULL_MARGIN = 160;   // px hors cadre au-delà desquels on ne trace pas
  const BOSS_MARGIN = 520;   // le boss est GRAND : son centre peut être dehors
                             // et sa coque encore à l'image

  let width = 0;
  let height = 0;
  let camX = 0;              // position lissée du cadre (le retard)
  let camRoll = 0;           // inclinaison lissée du cadre
  let marks = null;          // liste d'affichage de la frame courante

  // Base de la caméra, en nombres nus : aucune librairie n'intervient dans la
  // projection, donc elle se teste en quelques millisecondes, sans navigateur.
  let eyeX = 0, eyeY = 0, eyeZ = 0;     // l'œil
  let fwdX = 0, fwdY = 0, fwdZ = 0;     // avant (direction du regard)
  let rgtX = 0, rgtY = 0, rgtZ = 0;     // droite de l'écran
  let upX = 0, upY = 0, upZ = 0;        // haut de l'écran
  let ppmBase = 0;                      // (hauteur / 2) / tan(fov / 2)
  let shipX = 0, shipZ = 0;             // le vaisseau, dans le plan du jeu

  const planeX = (x) => x - width / 2;
  const planeZ = (y) => y - height / 2;

  /** Pose la caméra pour cette frame, et calcule sa base. */
  function placeCamera(snapshot, w, h) {
    width = w; height = h;
    const player = snapshot.player || { x: w / 2, y: h * 0.85, width: 40, height: 22 };
    shipX = planeX(player.x + (player.width || 40) / 2);
    shipZ = planeZ(player.y + (player.height || 22) / 2);

    const camHeight = h * CAM_HEIGHT_RATIO;
    const camBack = Math.max(CAM_BACK_MIN, h * CAM_BACK_RATIO);
    const lagX = shipX - camX;
    camX += lagX * CAM_LAG_X;
    camRoll += ((lagX / Math.max(200, w * 0.35)) * CAM_ROLL - camRoll) * 0.12;

    // Le point visé est DEVANT le vaisseau : c'est lui qui fait qu'on regarde
    // vers l'horizon, et le décalage `lagX` qui garde le vaisseau légèrement
    // décentré quand on vire.
    const lookX = camX + lagX * 0.35;
    const lookZ = shipZ - h * CAM_LOOK_RATIO;

    eyeX = camX; eyeY = camHeight; eyeZ = shipZ + camBack;

    let ax = lookX - eyeX, ay = CAM_LOOK_Y - eyeY, az = lookZ - eyeZ;
    const la = Math.hypot(ax, ay, az) || 1;
    fwdX = ax / la; fwdY = ay / la; fwdZ = az / la;

    // Le vecteur « haut » du cadre porte le roulis : `up` tourne autour de
    // l'axe du regard, donc l'horizon s'incline dans les virages.
    const upx = Math.sin(camRoll), upy = Math.cos(camRoll);
    let sx = fwdY * 0 - fwdZ * upy;
    let sy = fwdZ * upx - fwdX * 0;
    let sz = fwdX * upy - fwdY * upx;
    const ls = Math.hypot(sx, sy, sz) || 1;
    rgtX = sx / ls; rgtY = sy / ls; rgtZ = sz / ls;

    upX = rgtY * fwdZ - rgtZ * fwdY;
    upY = rgtZ * fwdX - rgtX * fwdZ;
    upZ = rgtX * fwdY - rgtY * fwdX;

    ppmBase = (h * 0.5) / TAN_HALF_FOV;
  }

  /**
   * Projette un point DU PLAN DE JEU (x, z — `z` est la profondeur, pas une
   * hauteur) sur l'écran.
   * @returns {{x:number,y:number,depth:number,scale:number}|null} null si le
   * point est derrière l'œil : le projeter le ferait réapparaître à l'envers.
   */
  function project(x, z) {
    const vx = x - eyeX, vy = -eyeY, vz = z - eyeZ;
    const depth = vx * fwdX + vy * fwdY + vz * fwdZ;
    if (!(depth > NEAR_DEPTH)) return null;
    let k = ppmBase / depth;
    if (!(k > 0)) return null;
    if (k > MAX_SCALE) k = MAX_SCALE;
    const side = vx * rgtX + vy * rgtY + vz * rgtZ;
    const haut = vx * upX + vy * upY + vz * upZ;
    return {
      x: width * 0.5 + side * k,
      y: height * 0.5 - haut * k,
      depth,
      scale: k
    };
  }

  const horsCadre = (p, marge) => {
    const m = marge == null ? CULL_MARGIN : marge;
    return p.x < -m || p.x > width + m || p.y < -m || p.y > height + m;
  };

  /** Le centre logique d'une entité du plan : c'est autour de lui que l'art du
   *  jeu se dessine, donc c'est lui que la transformation doit ramener au pixel
   *  projeté. */
  const centreX = (o) => o.x + (o.width || 0) / 2;
  const centreZ = (o) => o.y + (o.height || 0) / 2;

  /** Projette une entité du plan, avec le centre logique de son art. */
  function projeterEntite(o) {
    const p = project(planeX(centreX(o)), planeZ(centreZ(o)));
    if (!p || horsCadre(p)) return null;
    p.centreX = centreX(o);
    p.centreZ = centreZ(o);
    return p;
  }

  /** Projette une liste d'objets PONCTUELS (leur `x`/`y` EST leur centre) :
   *  particules, débris, ondes, popups. L'objet est conservé pour que le jeu le
   *  trace lui-même. */
  function projeterPonctuels(liste, max, marge) {
    const out = [];
    if (!liste) return out;
    for (let i = 0; i < liste.length && out.length < max; i++) {
      const o = liste[i];
      if (!o) continue;
      const p = project(planeX(o.x), planeZ(o.y));
      if (!p || horsCadre(p, marge)) continue;
      p.centreX = o.x;
      p.centreZ = o.y;
      p.item = o;
      out.push(p);
    }
    return out;
  }

  /* ---------------------------------------------------------------------
   *  LA LISTE D'AFFICHAGE
   *  Un seul tri, du plus LOIN au plus PRÈS, pour que la coque opaque du boss
   *  ne passe pas devant un ennemi qui lui est antérieur. Le pool est réutilisé
   *  d'une frame à l'autre : trier ne doit rien allouer.
   * ------------------------------------------------------------------- */
  const _poolEntrees = [];
  const _poolOrdre = [];
  let _poolUtilise = 0;

  function ajouter(kind, entree) {
    let item = _poolEntrees[_poolUtilise];
    if (!item) { item = { kind: '', place: null }; _poolEntrees[_poolUtilise] = item; }
    item.kind = kind;
    item.place = entree;
    _poolUtilise++;
  }

  /* ---------------------------------------------------------------------
   *  LA FRAME
   * ------------------------------------------------------------------- */

  /**
   * Compose la vue : pose la caméra et projette tout ce qui doit être vu.
   * L'instantané porte l'état du stage 2D :
   *   { player, enemies, playerBullets, enemyBullets, powerUps, explosions,
   *     boss, shipRenderer }
   * @returns {{markers: object}|null}
   */
  function frame(snapshot, w, h) {
    if (!snapshot || !(w > 0) || !(h > 0)) return null;
    placeCamera(snapshot, w, h);

    marks = {
      ship: null, boss: null,
      enemies: [], shots: [], incoming: [], powerups: [], explosions: [],
      debris: [], bombWaves: [], pickups: [], sparks: [], popups: []
    };

    // --- vaisseau ---------------------------------------------------------
    // Il est le POINT DE VUE : le projeter sert à savoir où tracer son art, et
    // à garder la même transformation que le reste.
    const ship = project(shipX, shipZ);
    if (ship) {
      // Le centre logique est en coordonnées du MONDE (`drawPlayer` s'y place
      // tout seul) : le confondre avec la coordonnée de plan décalait le
      // vaisseau d'une demi-largeur d'écran.
      ship.centreX = shipX + width / 2;
      ship.centreZ = shipZ + height / 2;
      ship.visible = true;
      marks.ship = ship;
    }

    // --- ennemis ----------------------------------------------------------
    const enemies = snapshot.enemies || [];
    for (let i = 0; i < enemies.length && marks.enemies.length < MAX_ENEMIES; i++) {
      const e = enemies[i];
      if (!e || e.isDeleted) continue;
      if (!isFinite(e.x) || !isFinite(e.y) || !(e.width > 0)) continue;
      const p = projeterEntite(e);
      if (!p) continue;
      p.entity = e;
      marks.enemies.push(p);
    }

    // --- projectiles ------------------------------------------------------
    // Ils voyagent vers l'œil : leur taille DOIT suivre la profondeur, sinon un
    // tir lointain et un tir au contact se lisent pareil.
    const shots = snapshot.playerBullets || [];
    for (let i = 0; i < shots.length && marks.shots.length < MAX_SHOTS; i++) {
      const b = shots[i];
      if (!b) continue;
      const largeur = b.width || 3, hauteur = b.drawH || b.height || 16;
      const p = project(planeX(b.x + largeur / 2), planeZ(b.y + hauteur / 2));
      if (!p || horsCadre(p)) continue;
      p.centreX = b.x + largeur / 2; p.centreZ = b.y + hauteur / 2;
      p.bullet = b;
      marks.shots.push(p);
    }
    const tirs = snapshot.enemyBullets || [];
    for (let i = 0; i < tirs.length && marks.incoming.length < MAX_ENEMY_SHOTS; i++) {
      const b = tirs[i];
      if (!b) continue;
      const largeur = b.width || 5, hauteur = b.drawH || b.height || 10;
      const p = project(planeX(b.x + largeur / 2), planeZ(b.y + hauteur / 2));
      if (!p || horsCadre(p)) continue;
      p.centreX = b.x + largeur / 2; p.centreZ = b.y + hauteur / 2;
      p.bullet = b;
      p.rang = i;
      marks.incoming.push(p);
    }

    // --- bonus ------------------------------------------------------------
    const pickups = snapshot.powerUps || [];
    for (let i = 0; i < pickups.length; i++) {
      const p = pickups[i];
      if (!p || p.isDeleted) continue;
      const q = projeterEntite(p);
      if (!q) continue;
      q.powerUp = p;
      q.type = p.type || 'double';
      marks.powerups.push(q);
    }

    // --- explosions -------------------------------------------------------
    // TOUTES les particules, étincelles comprises : c'est la gerbe entière qui
    // dit « celui-là est mort », et elle doit se produire à SA profondeur.
    marks.explosions = projeterPonctuels(snapshot.explosions, MAX_FX);

    // --- débris de carlingue ---------------------------------------------
    marks.debris = projeterPonctuels(snapshot.debris, MAX_FX);

    // --- ondes de bombe ---------------------------------------------------
    // Le souffle traverse tout l'écran : il doit grandir en s'approchant de
    // l'œil, sinon la bombe perd son impact en perspective.
    marks.bombWaves = projeterPonctuels(snapshot.bombWaves, 8, BOSS_MARGIN);

    // --- retours de ramassage --------------------------------------------
    marks.pickups = projeterPonctuels(snapshot.powerUpPickups, MAX_FX);
    marks.sparks = projeterPonctuels(snapshot.multiplierSparks, MAX_FX);
    marks.popups = projeterPonctuels(snapshot.scorePopups, MAX_FX);

    // --- boss -------------------------------------------------------------
    const b = snapshot.boss;
    if (b) {
      const centre = project(planeX(b.x), planeZ(b.y));
      if (centre && !horsCadre(centre, BOSS_MARGIN)) {
        centre.centreX = b.x;
        centre.centreZ = b.y;
        centre.rayon = Math.max(12, (b.rayon || 90) * centre.scale);
        centre.hp = Math.max(0, Math.min(1, b.hp == null ? 1 : b.hp));
        centre.color = b.color || null;
        centre.phase = b.phase || 1;
        marks.boss = centre;
      }
    }

    return { markers: marks };
  }

  /* ---------------------------------------------------------------------
   *  LE TRACÉ
   * ------------------------------------------------------------------- */

  /** Amène le contexte sur une entité : son centre logique tombe sur le pixel
   *  projeté, à l'échelle de sa profondeur. */
  function cadreSur(c, place) {
    c.translate(place.x, place.y);
    c.scale(place.scale, place.scale);
    c.translate(-place.centreX, -place.centreZ);
  }

  function traceUn(c, kind, place) {
    switch (kind) {
      case 'enemy': {
        const e = place.entity;
        if (typeof window.drawEnemyShip !== 'function') return;
        if (typeof window.ensureEnemyRuntime === 'function' && !e._rt) window.ensureEnemyRuntime(e);
        // Pas de traînée persistante ici : le tampon de traînées vit dans le
        // repère du plan, une transformation par entité n'y aurait aucun sens.
        window.drawEnemyShip(c, null, e, FRAME.time);
        return;
      }
      case 'boss': {
        if (typeof BOSS === 'undefined' || !BOSS || typeof BOSS.drawWorld !== 'function') return;
        BOSS.drawWorld(c);
        return;
      }
      case 'shot': {
        if (typeof window.drawPlayerBullet !== 'function') return;
        window.drawPlayerBullet(c, null, place.bullet);
        return;
      }
      case 'incoming': {
        if (typeof window.drawEnemyBullet !== 'function') return;
        window.drawEnemyBullet(c, null, place.bullet, place.rang, FRAME.time);
        return;
      }
      case 'powerup': {
        if (typeof window.drawPowerUp !== 'function') return;
        window.drawPowerUp(c, null, place.powerUp, FRAME.time);
        return;
      }
      case 'fx': {
        if (typeof window.drawExplosionParticle !== 'function') return;
        window.drawExplosionParticle(c, place.item);
        return;
      }
      case 'debris': {
        if (typeof window.drawDebrisPiece !== 'function') return;
        window.drawDebrisPiece(c, place.item);
        return;
      }
      case 'bomb': {
        if (typeof window.drawBombWave !== 'function') return;
        window.drawBombWave(c, place.item);
        return;
      }
      case 'pickup': {
        if (typeof window.drawPowerUpPickup !== 'function') return;
        window.drawPowerUpPickup(c, place.item);
        return;
      }
      case 'spark': {
        if (typeof window.drawMultiplierSpark !== 'function') return;
        window.drawMultiplierSpark(c, place.item);
        return;
      }
      case 'popup': {
        if (typeof window.drawScorePopup !== 'function') return;
        window.drawScorePopup(c, place.item);
        return;
      }
      case 'ship': {
        if (typeof window.drawPlayer !== 'function') return;
        window.drawPlayer();
        return;
      }
      default: return;
    }
  }

  /**
   * Trace le monde par la caméra : les mêmes fonctions de dessin que la vue à
   * plat, appliquées à la position projetée de chaque élément.
   *
   * À appeler DANS la scène émissive (`ctx`), entre `NEON.beginFrame()` et
   * `NEON.endFrame()` : c'est ce qui lui donne le bloom, l'aberration et la
   * vignette du mode classique.
   * @returns {boolean} false si rien n'a pu être tracé.
   */
  function drawWorld(c) {
    if (!c || !marks) return false;

    _poolUtilise = 0;
    for (let i = 0; i < marks.enemies.length; i++) ajouter('enemy', marks.enemies[i]);
    if (marks.boss) ajouter('boss', marks.boss);
    for (let i = 0; i < marks.shots.length; i++) ajouter('shot', marks.shots[i]);
    for (let i = 0; i < marks.incoming.length; i++) ajouter('incoming', marks.incoming[i]);
    for (let i = 0; i < marks.powerups.length; i++) ajouter('powerup', marks.powerups[i]);
    for (let i = 0; i < marks.explosions.length; i++) ajouter('fx', marks.explosions[i]);
    for (let i = 0; i < marks.debris.length; i++) ajouter('debris', marks.debris[i]);
    for (let i = 0; i < marks.bombWaves.length; i++) ajouter('bomb', marks.bombWaves[i]);
    for (let i = 0; i < marks.pickups.length; i++) ajouter('pickup', marks.pickups[i]);
    for (let i = 0; i < marks.sparks.length; i++) ajouter('spark', marks.sparks[i]);
    for (let i = 0; i < marks.popups.length; i++) ajouter('popup', marks.popups[i]);

    // Du plus loin au plus près : `depth` est la distance à l'œil.
    _poolOrdre.length = _poolUtilise;
    for (let i = 0; i < _poolUtilise; i++) _poolOrdre[i] = _poolEntrees[i];
    _poolOrdre.sort((a, b) => b.place.depth - a.place.depth);

    for (let i = 0; i < _poolOrdre.length; i++) {
      const item = _poolOrdre[i];
      c.save();
      cadreSur(c, item.place);
      try { traceUn(c, item.kind, item.place); }
      catch (err) { console.error('Vue en perspective : tracé ' + item.kind + ' impossible', err); }
      c.restore();
    }

    // Le VAISSEAU en dernier : il est le plus proche de l'œil, et son art porte
    // le noyau blanc qui EST sa hitbox. Il doit rester lisible par-dessus tout.
    if (marks.ship) {
      c.save();
      cadreSur(c, marks.ship);
      try { traceUn(c, 'ship', marks.ship); }
      catch (err) { console.error('Vue en perspective : tracé du vaisseau impossible', err); }
      c.restore();
    }

    // --- repères d'ÉCRAN ---------------------------------------------------
    // Le ralenti pose des bandes de balayage dans le repère de l'ÉCRAN : les
    // projeter les plierait avec le décor, alors qu'elles disent un état du jeu.
    if (typeof window.drawSlowMotionBands === 'function') {
      try { window.drawSlowMotionBands(c); } catch (err) { /* facultatif */ }
    }
    // Le champ de ralenti, lui, entoure le vaisseau : il appartient au monde.
    if (marks.ship && typeof window.drawSlowMotionRing === 'function') {
      c.save();
      cadreSur(c, marks.ship);
      try { window.drawSlowMotionRing(c); } catch (err) { /* facultatif */ }
      c.restore();
    }
    return true;
  }

  return {
    frame,
    drawWorld,
    /**
     * La vue ne dépend plus de WebGL : elle projette et laisse le jeu dessiner.
     * Il n'y a donc plus de « vue indisponible » — et plus de repli à annoncer.
     */
    isAvailable: () => true,
    /** Dimensions réelles du rendu — sert au diagnostic de cadrage. */
    debug: () => ({ width, height }),
    /** Cadrage courant, pour la mise au point depuis la console. */
    view: () => ({
      oeil: { x: eyeX, y: eyeY, z: eyeZ },
      vaisseau: { x: shipX, z: shipZ },
      ppm: ppmBase,
      roulis: camRoll
    }),
    /** Projette un point du plan en pixels écran — diagnostic et tests. */
    projectPoint: (x, z) => project(x - width / 2, z - height / 2),
    reset() {
      camX = 0; camRoll = 0; marks = null;
    }
  };
})();

window.GAME3D = GAME3D;
