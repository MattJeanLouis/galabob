/* =============================================================================
 *  galabob — BOSS  (module global autonome)
 * -----------------------------------------------------------------------------
 *  SIX BOSS, chacun en néon vectoriel, trois phases, attaques télégraphiées,
 *  points faibles lumineux et mort en explosion en chaîne.
 *
 *      index 0 — LA RUCHE    (stage 5)   essaim → éventail → charge
 *      index 1 — LE PRISME   (stage 10)  rayons réfléchis → phare → cage
 *      index 2 — LE SERPENT  (stage 15)  ondulation → morsure → traversée
 *      index 3 — LE CŒUR     (stage 20)  recombine les trois, le plus long
 *      index 4 — LA CITADELLE(stage 25)  tourelles → verrou → siège
 *      index 5 — L’ÉCLIPSE   (stage 30)  binaire → couronnes → rayon orbital
 *
 *  LE MODULE EST AUTONOME. Tant que personne ne l'appelle, il ne fait
 *  strictement rien : aucun effet de bord au chargement, aucun crochet posé sur
 *  la boucle de jeu. Tous les services extérieurs (PALETTE, NEON, JUICE,
 *  gameEvent, spawnEnemyBullet, damagePlayer, createExplosion…) sont appelés
 *  derrière un `typeof` : s'ils manquent, le boss perd du décor, jamais la
 *  logique.
 *
 *  API PUBLIQUE
 *  ------------
 *      BOSS.spawn(index, menace)   // index 0..3, menace >= 1 (boucles de jeu)
 *      BOSS.update(dt)             // dt en SECONDES
 *      BOSS.draw(ctx)              // corps + barre de vie + bannière
 *      BOSS.isActive()             // vrai du spawn jusqu'à la fin de l'agonie
 *      BOSS.isDefeated()           // vrai une fois l'explosion finale terminée
 *      BOSS.reset()
 *      BOSS.hitTest(rect)          // balles joueur -> renvoie la pièce touchée
 *      BOSS.damage(n, x, y)        // renvoie true si le coup a porté
 *  Extras utiles à l'intégration :
 *      BOSS.bodyHitTest(rect)      // corps-à-corps (coque + drones)
 *      BOSS.drawWorld(c) / BOSS.drawHud(c)   // si l'on veut la barre hors caméra
 *      BOSS.indexForStage(stage) / BOSS.isBossStage(stage) / BOSS.STAGES
 *      BOSS.getPhase() / getName() / getHpFraction() / getScore()
 *
 *  CONVENTIONS RESPECTÉES
 *  ----------------------
 *  • Toute vitesse est en PIXELS CSS PAR SECONDE, intégrée en `pos += v * dt`.
 *  • Toute durée interne est en SECONDES (le module reçoit des secondes).
 *  • Toute animation lit FRAME.time — jamais Date.now().
 *  • Toute couleur vient de PALETTE. Tout trait passe par NEON.
 *  • Les balles partent dans le tableau global `enemyBullets` via
 *    spawnEnemyBullet() : les collisions existantes s'appliquent sans un mot
 *    de code en plus. Elles sont marquées `b.boss = true` et le module les
 *    balaie lui-même (voir purgerBalles) — sans quoi une balle tirée vers le
 *    HAUT ne serait jamais recyclée par updateEnemyBullets().
 *
 *  BRANCHEMENT (rien de tout cela n'est fait ici : hors périmètre)
 *  ---------------------------------------------------------------
 *    index.html   <script src="js/entities/boss.js"></script>  après
 *                 projectiles.js / effects.js, avant game.js.
 *    game.js      update()  : if (BOSS.isActive()) BOSS.update(deltaTime/1000);
 *                 collisions : BOSS.hitTest(balle) -> BOSS.damage(b.damage||1, …)
 *                 corps-à-corps : BOSS.bodyHitTest(getPlayerHitbox())
 *                 drawScene() : BOSS.drawWorld(ctx) après drawEnemies(),
 *                 et BOSS.drawHud(ctx) dans le bloc HUD non secoué.
 *                 fin de stage : attendre BOSS.isDefeated().
 *    stages.js    initStage() : if (BOSS.isBossStage(stage)) BOSS.spawn(
 *                     BOSS.indexForStage(stage), BOSS.menaceForStage(stage));
 *  Le détail exact est dans le rapport de l'agent.
 *
 *  LANGAGE VISUEL, LA RÈGLE À NE PAS CASSER
 *  ----------------------------------------
 *  Le corps porte la couleur d'IDENTITÉ du boss ; les POINTS FAIBLES sont
 *  toujours AMBRE (PALETTE 'enemy.fast') et pulsent ; le DANGER (rayons,
 *  corridors de charge, salves imminentes) est toujours ROUGE en pointillés
 *  qui défilent. Le joueur apprend cette grammaire une fois et la relit sur
 *  tous les boss.
 * ========================================================================== */

const BOSS = (function () {
  'use strict';

  /* ===========================================================================
   *  1. RÉGLAGES
   * ======================================================================== */

  const RUCHE = 0, PRISME = 1, SERPENT = 2, COEUR = 3, CITADELLE = 4, ECLIPSE = 5;

  /** Stage de convocation de chaque boss. */
  const STAGES = [5, 10, 15, 20, 25, 30];

  // Les boucles ne se contentent plus de gonfler les PV : elles portent une
  // identité annoncée, un rythme et une densité de pattern distincts.
  const VARIANTES = [
    { nom: '', hp: 1.00, vitesse: 1.00, cadence: 1.00, balles: 0 },
    { nom: 'SURCHARGÉ', hp: 1.10, vitesse: 1.07, cadence: 1.10, balles: 1 },
    { nom: 'ABYSSAL', hp: 1.18, vitesse: 1.12, cadence: 1.16, balles: 2 }
  ];

  const REGLAGES = {
    /* --- durée de combat visée -------------------------------------------
     *  Les PV sont DÉDUITS d'une durée cible et d'un DPS de référence, au lieu
     *  d'être un nombre magique : si l'arme du joueur change, il suffit de
     *  corriger dpsRef ici pour que les boss restent dans la fenêtre
     *  des 40-70 s demandée.
     *  dpsRef = cadence 110 ms, ~70 % de touches, dégât 1 -> ~8,5 PV/s. */
    dpsRef: 8.5,
    dureeVisee: [40, 44, 32, 50, 42, 46],   // secondes, boss par boss

    /* --- montée en difficulté avec les boucles ---------------------------- */
    menaceMax: 6,
    menacePv: 0.15,        // + de PV par cran de menace
    menaceCadence: 0.12,   // attaques plus rapprochées
    menaceVitesse: 0.06,   // balles plus rapides
    menaceBalles: 1,       // + de balles par éventail et par cran

    /* --- rythme du combat -------------------------------------------------- */
    entree: 2.3,           // s — descente + annonce, boss invulnérable
    agonie: 3.0,           // s — explosion en chaîne
    invulnPhase: 1.0,      // s — bouclier pendant un changement de phase
    seuils: [0.66, 0.33],  // fractions de PV des bascules de phase

    /* --- plafonds de sécurité --------------------------------------------- */
    maxBalles: 150,        // balles ennemies simultanées tolérées par le boss
    // Durée MAXIMALE de poursuite d'un drone, en secondes. Au-delà, il rompt
    // et sort par le bas. Sans cette limite, un drone qui atteint la hauteur
    // du joueur devient inévitable : le joueur ne bouge que latéralement, il
    // n'a aucun axe de fuite. Un poursuivant doit faire UNE passe, pas camper.
    dureeChasse: 2.4,
    maxDrones: 16,
    maxRayons: 12,
    vieBalle: 11           // s — au-delà, une balle de boss est recyclée
  };

  /* ===========================================================================
   *  2. ÉTAT
   * ======================================================================== */

  const S = {
    actif: false,
    vaincu: false,
    index: -1,
    variant: 0,
    variantCycle: 0,
    variantProfile: null,
    menace: 1,
    def: null,

    /* identité */
    nom: '', sous: '', coul: 'neutral',

    /* vie */
    hp: 0, hpMax: 0,
    hpFantome: 0,          // barre blanche retardataire
    fantomeDelai: 0,
    pulseBarre: 0,

    /* progression */
    phase: 1,
    invuln: 0,

    /* cycle : 'inactif' | 'entree' | 'combat' | 'bascule' | 'mort' */
    etat: 'inactif',
    t: 0,                  // secondes depuis le spawn
    tEtat: 0,              // secondes dans l'état courant

    /* corps */
    x: 0, y: 0, angle: 0,
    flash: 0,              // 0..1 — éclat blanc à l'impact

    /* pièces, essaims, rayons */
    parts: [],
    drones: [],
    rayons: [],

    /* attaque courante */
    att: null,
    derniereAtt: '',

    /* agonie */
    detonations: [],

    /* bannière plein écran */
    ban: { texte: '', sous: '', t: 0, duree: 0, coul: '' },

    /* multiplicateurs dérivés de la menace */
    multVitesse: 1, multCadence: 1, bonusBalles: 0,

    /* divers */
    memo: {},              // bac à sable propre au boss courant
    points: 0,
    hudExplicite: false,
    derniereTouche: null,
    derniereToucheT: -1
  };

  /* ===========================================================================
   *  3. PETITS OUTILS (privés : le module ne dépend d'aucun global de maths)
   * ======================================================================== */

  const TAU = Math.PI * 2;

  function cl(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lp(a, b, t) { return a + (b - a) * t; }
  function ss(t) { t = cl(t, 0, 1); return t * t * (3 - 2 * t); }
  function rr(a, b) { return a + Math.random() * (b - a); }

  /** Amortissement indépendant du framerate : fraction restante après 1 s. */
  function damp2(a, b, taux, dt) { return b + (a - b) * Math.pow(taux, dt); }

  /** Temps de JEU en secondes (gelé en pause et en hitstop). Jamais Date.now(). */
  function tps() { return (typeof FRAME !== 'undefined' && FRAME) ? FRAME.time : 0; }

  /** Temps RÉEL : réservé aux clignotements d'alerte, qui doivent rester
   *  lisibles même pendant un hitstop. */
  function tpsReel() { return (typeof FRAME !== 'undefined' && FRAME) ? FRAME.realTime : 0; }

  function larg() { return (typeof CANVAS_WIDTH === 'number' ? CANVAS_WIDTH : 800); }
  function haut() { return (typeof CANVAS_HEIGHT === 'number' ? CANVAS_HEIGHT : 600); }

  /** Échelle de tous les gabarits, pour que le boss tienne à l'écran partout. */
  function ech() { return cl(larg() / 1200, 0.60, 1.30); }

  /** Centre du joueur (objet réutilisé : zéro allocation par frame). */
  const _pj = { x: 0, y: 0 };
  function joueur() {
    if (typeof player !== 'undefined' && player) {
      _pj.x = player.x + (player.width || 0) / 2;
      _pj.y = player.y + (player.height || 0) / 2;
    } else {
      _pj.x = larg() / 2;
      _pj.y = haut() * 0.86;
    }
    return _pj;
  }

  /** Angle de tir vers le joueur depuis (x, y). */
  function viser(x, y) {
    const p = joueur();
    return Math.atan2(p.y - y, p.x - x);
  }

  /** Distance d'un point au SEGMENT [x0,y0 → x1,y1]. Sert aux rayons. */
  function distSegment(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const l2 = dx * dx + dy * dy;
    if (l2 < 1e-6) return Math.hypot(px - x0, py - y0);
    let t = ((px - x0) * dx + (py - y0) * dy) / l2;
    t = cl(t, 0, 1);
    return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
  }

  /** AABB contre cercle (repli local : le module ne suppose pas utils.js). */
  function rectCercle(r, cx, cy, rad) {
    if (!r || typeof r.x !== 'number') return false;
    const w = r.width || 0, h = r.height || 0;
    const nx = cl(cx, r.x, r.x + w);
    const ny = cl(cy, r.y, r.y + h);
    const dx = cx - nx, dy = cy - ny;
    return (dx * dx + dy * dy) <= rad * rad;
  }

  /* --- ponts vers le reste du jeu, tous facultatifs ------------------------ */

  function evt(nom, data) {
    try { if (typeof gameEvent === 'function') gameEvent(nom, data || {}); }
    catch (e) { /* un bruitage ne casse jamais une frame */ }
  }

  function juice(nom, echelle) {
    try { if (typeof JUICE !== 'undefined' && JUICE.preset) JUICE.preset(nom, echelle); }
    catch (e) { /* ignoré */ }
  }

  function secousse(v) {
    try { if (typeof JUICE !== 'undefined' && JUICE.shake) JUICE.shake(v); }
    catch (e) { /* ignoré */ }
  }

  function gel(ms) {
    try { if (typeof JUICE !== 'undefined' && JUICE.hitstop) JUICE.hitstop(ms); }
    catch (e) { /* ignoré */ }
  }

  function voile(coul, ms, force) {
    try { if (typeof JUICE !== 'undefined' && JUICE.flash) JUICE.flash(coul, ms, force); }
    catch (e) { /* ignoré */ }
  }

  function boum(x, y, type, opts) {
    try { if (typeof createExplosion === 'function') createExplosion(x, y, type, opts); }
    catch (e) { /* ignoré */ }
  }

  function eclats(x, y, coul, type) {
    try { if (typeof createDebris === 'function') createDebris(x, y, coul, type); }
    catch (e) { /* ignoré */ }
  }

  function etincelles(x, y, coul, angle, n) {
    try { if (typeof createImpactSparks === 'function') createImpactSparks(x, y, coul, angle, n); }
    catch (e) { /* ignoré */ }
  }

  function onde(x, y, coul, e) {
    try { if (typeof createShockwave === 'function') createShockwave(x, y, coul, e); }
    catch (e) { /* ignoré */ }
  }

  function popup(x, y, base, mult) {
    try { if (typeof createScorePopup === 'function') createScorePopup(x, y, base, mult); }
    catch (e) { /* ignoré */ }
  }

  function blesserJoueur(source) {
    try { if (typeof damagePlayer === 'function') return !!damagePlayer(source || 'boss'); }
    catch (e) { /* ignoré */ }
    return false;
  }

  function marquerPoints(n, x, y) {
    S.points += n;
    try { if (typeof score === 'number') score += n; } catch (e) { /* ignoré */ }
    if (x != null) popup(x, y, n, 1);
  }

  /** Couleur du Cœur : le magenta de la menace fondu dans le rouge d'élite.
   *  Calculée à la demande pour ne rien exiger de PALETTE au chargement. */
  let _coulCoeur = null;
  function coulCoeur() {
    if (_coulCoeur) return _coulCoeur;
    try {
      _coulCoeur = PALETTE.mix(PALETTE.entities.enemyNormal.glow,
                               PALETTE.entities.enemyElite.glow, 0.5);
    } catch (e) { _coulCoeur = '#ff2b95'; }
    return _coulCoeur;
  }

  /** Membre CSS d'un triplet PALETTE, avec repli si PALETTE manque. */
  function css(coul, membre) {
    try { return PALETTE.get(coul)[membre || 'glow']; }
    catch (e) { return (typeof coul === 'string' && coul.charAt(0) === '#') ? coul : '#ffffff'; }
  }

  /** Couleur commune des points faibles : AMBRE. */
  const FAIBLE = 'enemy.fast';
  /** Couleur commune du danger imminent : ROUGE. */
  const DANGER = 'bullet.enemy';

  /* ===========================================================================
   *  4. PROJECTILES
   * ======================================================================== */

  /** Une balle du boss, poussée dans le tableau global `enemyBullets`.
   *  @param {number} angle radians   @param {number} v px/s (avant menace) */
  function tirer(x, y, angle, v, kind, opts) {
    if (typeof spawnEnemyBullet !== 'function') return null;
    if (typeof enemyBullets !== 'undefined' && enemyBullets &&
        enemyBullets.length >= REGLAGES.maxBalles) return null;
    opts = opts || {};
    const vit = Math.max(40, v * S.multVitesse);
    let b = null;
    try {
      b = spawnEnemyBullet(x, y, {
        vx: Math.cos(angle) * vit,
        vy: Math.sin(angle) * vit,
        speed: vit,
        kind: kind || 'normal',
        width: opts.width == null ? 5 : opts.width,
        height: opts.height == null ? 15 : opts.height
      });
    } catch (e) { return null; }
    if (b) {
      // spawnEnemyBullet pose le coin haut-gauche : on recentre, sinon une
      // balle tirée vers le haut ou de côté sort visuellement de son canon.
      b.y -= (b.height || 15) / 2;
      b.boss = true;
      b.nee = tps();
    }
    return b;
  }

  /** Éventail : `nb` balles réparties sur `ouverture` radians autour d'`angle`. */
  function eventail(x, y, angle, nb, ouverture, v, kind) {
    const n = Math.max(1, nb | 0);
    const pas = n > 1 ? ouverture / (n - 1) : 0;
    const a0 = angle - ouverture / 2;
    for (let i = 0; i < n; i++) tirer(x, y, a0 + pas * i, v, kind);
  }

  /** Anneau complet de balles (le Cœur s'en sert beaucoup). */
  function anneau(x, y, nb, v, kind, decalage) {
    const n = Math.max(1, nb | 0);
    for (let i = 0; i < n; i++) tirer(x, y, (decalage || 0) + i * TAU / n, v, kind);
  }

  /** Recyclage des balles du boss : `updateEnemyBullets` ne supprime que ce qui
   *  sort par le BAS ou par les côtés. Une salve tirée vers le haut resterait
   *  donc vivante à jamais. On balaie nous-mêmes ce qu'on a semé. */
  function purgerBalles(toutes) {
    if (typeof enemyBullets === 'undefined' || !enemyBullets) return;
    const W = larg(), H = haut(), t = tps();
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      if (!b || !b.boss) continue;
      if (toutes ||
          b.y + (b.height || 0) < -60 || b.y > H + 60 ||
          b.x + (b.width || 0) < -60 || b.x > W + 60 ||
          (t - (b.nee || t)) > REGLAGES.vieBalle) {
        enemyBullets.splice(i, 1);
      }
    }
  }

  /* ===========================================================================
   *  5. PIÈCES (coques, points faibles, fragments, segments…)
   * -----------------------------------------------------------------------
   *  Une pièce est un DISQUE de collision plus un rôle. Les gros corps plats
   *  sont composés de plusieurs disques : c'est plus juste qu'un seul cercle
   *  et bien plus rapide qu'un polygone.
   *
   *    kind      rôle                                   dégâts reçus
   *    ------    -----------------------------------    ------------
   *    'coque'   blindage : le corps du boss             x1.0 (x0.30 si fermé)
   *    'faible'  point faible lumineux, destructible     x2.4
   *    'fragment' éclat du Prisme, destructible          x1.5
   *    'segment' anneau du Serpent, destructible         x1.5 / x0.20 blindé
   *    'tete'    tête du Serpent                         x1.4 / x0.25 blindée
   *
   *  hp === Infinity  -> pièce indestructible (elle ne fait que router les
   *  dégâts vers la réserve globale S.hp, qui reste la seule vérité).
   * ======================================================================== */

  function ajouterPart(id, kind, ox, oy, r, hp, extra) {
    const p = {
      id: id, kind: kind,
      ox: ox, oy: oy,          // décalage par rapport au centre du boss
      x: 0, y: 0,              // position absolue, recalculée chaque frame
      abs: false,              // true : la pièce pose elle-même x/y
      r: r,
      hp: hp, hpMax: (hp === Infinity ? 1 : hp),
      vivant: true,
      vulnerable: true,
      armure: 0.30,            // multiplicateur quand `vulnerable` est faux
      flash: 0,                // 0..1 — éclat blanc d'impact
      mort: 0,                 // 0..1 — fondu de destruction
      t: Math.random() * TAU,  // phase d'animation propre
      angle: 0
    };
    if (extra) for (const k in extra) p[k] = extra[k];
    S.parts.push(p);
    return p;
  }

  function part(id) {
    for (let i = 0; i < S.parts.length; i++) if (S.parts[i].id === id) return S.parts[i];
    return null;
  }

  function partsDe(kind) {
    const out = [];
    for (let i = 0; i < S.parts.length; i++) {
      if (S.parts[i].kind === kind && S.parts[i].vivant) out.push(S.parts[i]);
    }
    return out;
  }

  function compter(kind) {
    let n = 0;
    for (let i = 0; i < S.parts.length; i++) {
      if (S.parts[i].kind === kind && S.parts[i].vivant) n++;
    }
    return n;
  }

  function retirerParts(kind) {
    for (let i = S.parts.length - 1; i >= 0; i--) {
      if (S.parts[i].kind === kind) S.parts.splice(i, 1);
    }
  }

  /** Replace les pièces attachées au corps. Les pièces `abs` s'en chargent. */
  function ancrerParts() {
    const cs = Math.cos(S.angle), sn = Math.sin(S.angle);
    for (let i = 0; i < S.parts.length; i++) {
      const p = S.parts[i];
      if (p.abs) continue;
      p.x = S.x + p.ox * cs - p.oy * sn;
      p.y = S.y + p.ox * sn + p.oy * cs;
    }
  }

  function multiplicateur(p) {
    if (!p) return 0;
    if (!p.vulnerable) return p.armure;
    switch (p.kind) {
      case 'faible':   return 2.0;
      case 'fragment': return 1.5;
      case 'segment':  return 1.5;
      case 'tete':     return 1.4;
      default:         return 1.0;
    }
  }

  /* ===========================================================================
   *  6. CHAÎNE ARTICULÉE (Serpent, tentacules du Cœur)
   * -----------------------------------------------------------------------
   *  Contrainte de distance pure : chaque maillon est REPOSÉ à `ecart` du
   *  précédent. Aucune intégration, donc aucune dépendance au framerate — le
   *  corps est identique à 30 comme à 144 fps.
   * ======================================================================== */

  function creerChaine(n, ecart, x, y) {
    const ch = { ecart: ecart, seg: [] };
    for (let i = 0; i < n; i++) ch.seg.push({ x: x, y: y + i * ecart, a: Math.PI / 2 });
    return ch;
  }

  function suivreChaine(ch, tx, ty) {
    const s = ch.seg;
    if (!s.length) return;
    s[0].x = tx; s[0].y = ty;
    for (let i = 1; i < s.length; i++) {
      const p = s[i - 1], q = s[i];
      let dx = q.x - p.x, dy = q.y - p.y;
      let d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-4) { dx = 0; dy = 1; d = 1; }
      const k = ch.ecart / d;
      q.x = p.x + dx * k;
      q.y = p.y + dy * k;
      q.a = Math.atan2(p.y - q.y, p.x - q.x);
    }
    s[0].a = (s.length > 1)
      ? Math.atan2(s[0].y - s[1].y, s[0].x - s[1].x)
      : -Math.PI / 2;
  }

  /* ===========================================================================
   *  7. ORDONNANCEUR D'ATTAQUE — TÉLÉGRAPHIE → SALVE → RÉCUPÉRATION
   * -----------------------------------------------------------------------
   *  Aucune attaque ne part sans anticipation visible : c'est la règle du
   *  chantier. L'ordonnanceur impose la structure, chaque boss n'écrit que le
   *  dessin de sa télégraphie et l'effet de sa salve.
   * ======================================================================== */

  /** @param {string} nom      identifiant lu par le dessin de télégraphie
   *  @param {number} tele     secondes d'anticipation
   *  @param {number} feu      secondes minimales de salve
   *  @param {number} recup    secondes de repos après la salve
   *  @param {number} [nb]     nombre de coups (1 par défaut)
   *  @param {number} [gap]    secondes entre deux coups (0 = tout d'un bloc) */
  function lancerAttaque(nom, tele, feu, recup, nb, gap) {
    const c = S.multCadence;
    S.att = {
      nom: nom,
      etat: 'tele',
      t: 0, k: 0,
      tele: Math.max(0.12, tele / c),   // même sous menace, l'anticipation reste lisible
      feu: feu,
      recup: Math.max(0.15, recup / c),
      nb: nb == null ? 1 : Math.max(1, nb | 0),
      gap: gap == null ? 0 : gap,
      emis: 0, acc: 0,
      memo: {}
    };
    S.derniereAtt = nom;
    return S.att;
  }

  /** Avance la séquence. `onTir(i, a)` est appelé une fois par coup.
   *  @returns {string} 'libre' | 'tele' | 'feu' | 'recup' | 'fin' */
  function avancerAttaque(dt, onTir) {
    // Entrée, bascule de phase, agonie : la séquence est GELÉE, et surtout on
    // ne renvoie ni 'fin' ni 'libre' — sans quoi le boss réarmerait une attaque
    // pendant son annonce et tirerait avant d'être en jeu.
    if (!S.peutAttaquer) return 'gel';
    const a = S.att;
    if (!a || !a.nom) return 'libre';
    a.t += dt;

    if (a.etat === 'tele') {
      a.k = a.tele > 0 ? cl(a.t / a.tele, 0, 1) : 1;
      if (a.t < a.tele) return 'tele';
      a.etat = 'feu';
      a.t -= a.tele;               // le reliquat de la frame n'est pas perdu
      a.emis = 0;
      a.acc = 0;
      if (a.gap <= 0) {            // salve d'un seul bloc
        for (let i = 0; i < a.nb; i++) { if (onTir) onTir(i, a); }
        a.emis = a.nb;
      }
    }

    if (a.etat === 'feu') {
      a.k = 1;
      if (a.gap > 0) {
        a.acc += dt;
        let garde = 0;
        while (a.emis < a.nb && a.acc >= 0 && garde++ < 32) {
          if (onTir) onTir(a.emis, a);
          a.emis++;
          a.acc -= a.gap;
        }
      }
      if (a.emis >= a.nb && a.t >= a.feu) { a.etat = 'recup'; a.t -= a.feu; }
      else return 'feu';
    }

    if (a.etat === 'recup') {
      if (a.t >= a.recup) { a.nom = ''; a.etat = 'libre'; a.k = 0; return 'fin'; }
      return 'recup';
    }
    return a.etat;
  }

  function libre() { return !S.att || !S.att.nom; }
  function enTele() { return !!(S.att && S.att.nom && S.att.etat === 'tele'); }

  /** Tirage pondéré d'une attaque, en évitant de répéter la même deux fois. */
  function choisir(liste) {
    let total = 0;
    for (let i = 0; i < liste.length; i++) {
      const p = (liste[i][0] === S.derniereAtt) ? liste[i][1] * 0.25 : liste[i][1];
      total += p;
    }
    let r = Math.random() * total;
    for (let i = 0; i < liste.length; i++) {
      const p = (liste[i][0] === S.derniereAtt) ? liste[i][1] * 0.25 : liste[i][1];
      r -= p;
      if (r <= 0) return liste[i][0];
    }
    return liste[liste.length - 1][0];
  }

  /* ===========================================================================
   *  8. GÉOMÉTRIE NÉON — fabriques de polygones réutilisées partout
   * ======================================================================== */

  /** Polygone régulier à `n` côtés, tableau PLAT [x,y,x,y…] (NEON l'accepte). */
  function poly(cx, cy, r, n, rot, aplat) {
    const p = [];
    const ky = (aplat == null ? 1 : aplat);
    for (let i = 0; i < n; i++) {
      const a = (rot || 0) + i * TAU / n;
      p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r * ky);
    }
    return p;
  }

  /** Hexagone — la brique de La Ruche. */
  function hexa(cx, cy, r, rot, aplat) { return poly(cx, cy, r, 6, rot, aplat); }

  /** Étoile / rosace : rayons alternés r1 / r2. */
  function etoile(cx, cy, r1, r2, n, rot) {
    const p = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (rot || 0) + i * Math.PI / n;
      const r = (i % 2 === 0) ? r1 : r2;
      p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    return p;
  }

  /** Contexte des traînées persistantes, ou null si elles sont coupées. */
  function trail() {
    if (typeof NEON === 'undefined' || !NEON.trail) return null;
    if (typeof RENDER_CONFIG !== 'undefined' && !RENDER_CONFIG.trails) return null;
    if (typeof NEON.isEnabled === 'function' && !NEON.isEnabled()) return null;
    return NEON.trail;
  }

  /* ===========================================================================
   *  9. TÉLÉGRAPHIE — la grammaire de l'anticipation
   * -----------------------------------------------------------------------
   *  `k` va de 0 (l'attaque vient d'être décidée) à 1 (elle part MAINTENANT).
   *  Trois signaux, jamais mélangés :
   *    • teleLigne / teleCorridor : « le danger viendra de CETTE direction »
   *    • teleEventail             : « voici EXACTEMENT où passeront les balles »
   *    • teleCharge               : « le canon se remplit, comptez avec moi »
   * ======================================================================== */

  /** Ligne de visée en pointillés qui défilent, de plus en plus dense. */
  function teleLigne(c, x0, y0, x1, y1, k, coul, ep) {
    const t = tpsReel();
    NEON.line(c, x0, y0, x1, y1, coul || DANGER, (ep || 1.4) * (0.7 + k * 1.1), {
      alpha: 0.10 + k * k * 0.52,
      dash: [9, 13 - k * 7],
      dashOffset: -t * (110 + k * 240),
      passes: 2
    });
  }

  /** Corridor de charge : deux bords parallèles qui se resserrent sur la cible. */
  function teleCorridor(c, x0, y0, x1, y1, demi, k, coul) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;
    const w = demi * lp(1.35, 1, ss(k));
    const a = 0.08 + k * k * 0.40;
    NEON.line(c, x0 + nx * w, y0 + ny * w, x1 + nx * w, y1 + ny * w, coul || DANGER, 1.6,
              { alpha: a, passes: 2 });
    NEON.line(c, x0 - nx * w, y0 - ny * w, x1 - nx * w, y1 - ny * w, coul || DANGER, 1.6,
              { alpha: a, passes: 2 });
    // Hachures qui remontent le corridor : la direction devient évidente.
    const t = tpsReel();
    const n = 7;
    for (let i = 0; i < n; i++) {
      const u = ((i / n) + (t * 0.55) % 1) % 1;
      const px = lp(x0, x1, u), py = lp(y0, y1, u);
      const ww = w * (0.35 + 0.65 * u);
      NEON.line(c, px + nx * ww, py + ny * ww, px - nx * ww, py - ny * ww, coul || DANGER, 1.1,
                { alpha: a * 0.55 * (1 - u), passes: 2 });
    }
  }

  /** Rayons fantômes de la salve à venir : ils SONT les futures trajectoires. */
  function teleEventail(c, x, y, angle, nb, ouverture, portee, k, coul) {
    const n = Math.max(1, nb | 0);
    const pas = n > 1 ? ouverture / (n - 1) : 0;
    const a0 = angle - ouverture / 2;
    const t = tpsReel();
    for (let i = 0; i < n; i++) {
      const a = a0 + pas * i;
      const p = portee * (0.35 + 0.65 * ss(k));
      NEON.line(c, x, y, x + Math.cos(a) * p, y + Math.sin(a) * p, coul || DANGER, 1.3, {
        alpha: 0.07 + k * k * 0.40,
        dash: [6, 11],
        dashOffset: -t * 190,
        passes: 2
      });
    }
    teleCharge(c, x, y, 12 * ech(), k, coul);
  }

  /** Anneau de charge qui se referme sur le canon + noyau qui gonfle. */
  function teleCharge(c, x, y, r, k, coul) {
    const col = coul || DANGER;
    NEON.ring(c, x, y, r * lp(2.6, 1.02, ss(k)), 1.5, col,
              { alpha: 0.16 + k * 0.55, passes: 3 });
    NEON.dot(c, x, y, r * (0.16 + k * 0.55), col,
             { alpha: 0.35 + k * 0.65, glowScale: 1 + k * 1.4 });
    if (k > 0.86) {
      // Dernier tiers de seconde : l'éclair blanc de départ.
      const u = (k - 0.86) / 0.14;
      NEON.ring(c, x, y, r * (1 + u * 2.2), 2.2, 'shock', { alpha: 0.55 * (1 - u), passes: 3 });
    }
  }

  /** Point d'exclamation : dernier recours de lisibilité au-dessus d'un danger. */
  function teleAlerte(c, x, y, k, coul) {
    if (k < 0.25) return;
    const s = 9 * ech() * (1 + k * 0.35);
    const a = (0.35 + 0.55 * Math.abs(Math.sin(tpsReel() * 12))) * ss((k - 0.25) / 0.75);
    NEON.line(c, x, y - s, x, y + s * 0.25, coul || DANGER, 2.4, { alpha: a, passes: 3 });
    NEON.dot(c, x, y + s * 0.85, 1.9, coul || DANGER, { alpha: a });
  }

  /* ===========================================================================
   *  10. ESSAIM DE DRONES  (Ruche, puis Cœur)
   * -----------------------------------------------------------------------
   *  Les drones sont gérés PAR LE BOSS, pas par le tableau global `enemies` :
   *  sinon leurs morts alimenteraient le compteur de fin de stage et le stage
   *  se terminerait sous les pieds du boss. Ils passent par BOSS.hitTest() et
   *  BOSS.bodyHitTest() comme le reste du corps.
   * ======================================================================== */

  function lacherDrone(x, y, angle, coul) {
    if (S.drones.length >= REGLAGES.maxDrones) return null;
    const e = ech();
    const d = {
      kind: 'drone',
      x: x, y: y,
      vx: Math.cos(angle) * rr(180, 260),
      vy: Math.sin(angle) * rr(180, 260),
      r: 13 * e,
      hp: 2 + Math.floor(S.menace * 0.5),
      vie: 0,
      etat: 'sortie',
      phase: Math.random() * TAU,
      tir: rr(0.9, 2.4),
      flash: 0,
      coul: coul || S.coul,
      angle: angle
    };
    S.drones.push(d);
    return d;
  }

  function majDrones(dt) {
    const H = haut(), W = larg();
    const p = joueur();
    for (let i = S.drones.length - 1; i >= 0; i--) {
      const d = S.drones[i];
      d.vie += dt;
      d.flash = Math.max(0, d.flash - dt * 5);

      if (d.etat === 'sortie') {
        // Éjection : on freine fort, le drone « se pose » avant de chasser.
        const k = Math.pow(0.02, dt);
        d.vx *= k; d.vy *= k;
        if (d.vie > 0.55) d.etat = 'chasse';
      } else if (d.etat === 'rupture') {
        // Passe terminée : piqué vers le bas, plus AUCUNE correction de cap.
        // C'est ce qui rend le drone esquivable — sa trajectoire est figée,
        // le joueur peut la lire et s'écarter.
        d.vx *= Math.pow(0.25, dt);
        d.vy += 1150 * dt;
        if (d.vy > 760) d.vy = 760;
      } else {
        // Chasse BORNÉE dans le temps et en hauteur : au-delà, on rompt.
        if (d.vie > REGLAGES.dureeChasse || d.y > H * 0.70) {
          d.etat = 'rupture';
          d.flash = 0.5;                    // éclat : la rupture est télégraphiée
        }
        // Chasse : cap tenu vers le joueur, avec une dérive sinusoïdale qui
        // rend la trajectoire lisible sans la rendre triviale à esquiver.
        const cible = Math.atan2(p.y - d.y, p.x - d.x);
        let da = cible - d.angle;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        d.angle += cl(da, -2.6 * dt, 2.6 * dt);
        const v = (180 + 26 * S.menace) * (S.index === COEUR ? 1.12 : 1);
        const lat = Math.sin(tps() * 4.2 + d.phase) * 90;
        d.vx = Math.cos(d.angle) * v - Math.sin(d.angle) * lat;
        d.vy = Math.sin(d.angle) * v + Math.cos(d.angle) * lat;

        d.tir -= dt;
        if (d.tir <= 0 && d.y < H * 0.82) {
          d.tir = rr(1.6, 3.2) / S.multCadence;
          tirer(d.x, d.y, viser(d.x, d.y), 330, 'fast', { width: 4, height: 12 });
          evt('enemyShot', { type: 'fast' });
        }
      }

      d.x += d.vx * dt;
      d.y += d.vy * dt;

      // Traînée : un essaim sans sillage se lit comme des confettis.
      const tr = trail();
      if (tr) {
        NEON.line(tr, d.x, d.y, d.x - d.vx * 0.035, d.y - d.vy * 0.035, d.coul, 2.2,
                  { alpha: 0.30, passes: 2 });
      }

      if (d.vie > 16 || d.y > H + 70 || d.x < -90 || d.x > W + 90) S.drones.splice(i, 1);
    }
  }

  function tuerDrone(i, silencieux) {
    const d = S.drones[i];
    if (!d) return;
    S.drones.splice(i, 1);
    boum(d.x, d.y, 'fast', { scale: 0.75 });
    eclats(d.x, d.y, css(d.coul, 'burst'), 'fast');
    if (!silencieux) {
      juice('enemyKill', 0.55);
      evt('enemyKill', { type: 'fast' });
      marquerPoints(25, d.x, d.y);
    }
  }

  function dessinerDrones(c) {
    const t = tps();
    for (let i = 0; i < S.drones.length; i++) {
      const d = S.drones[i];
      const r = d.r * (1 + Math.sin(t * 9 + d.phase) * 0.07);
      const a = d.angle + Math.PI / 2;
      const col = d.flash > 0 ? 'shock' : d.coul;
      // Coque : petit delta pointé vers sa cible.
      NEON.shape(c, [
        d.x + Math.cos(a - Math.PI / 2) * r * 1.35, d.y + Math.sin(a - Math.PI / 2) * r * 1.35,
        d.x + Math.cos(a + Math.PI * 0.72) * r, d.y + Math.sin(a + Math.PI * 0.72) * r,
        d.x + Math.cos(a - Math.PI * 0.72) * r, d.y + Math.sin(a - Math.PI * 0.72) * r
      ], col, 1.7, { alpha: 1, fill: true, fillAlpha: 0.30, glowScale: 1.15, passes: 3 });
      // Noyau : le point qu'il faut viser, et qui trahit sa direction.
      NEON.dot(c, d.x, d.y, r * 0.26, FAIBLE, { alpha: 0.9, glowScale: 1.2 });
      if (d.etat === 'sortie') {
        const k = cl(d.vie / 0.55, 0, 1);
        NEON.ring(c, d.x, d.y, r * (1.2 + k * 2.4), 1.2, col, { alpha: 0.42 * (1 - k), passes: 2 });
      }
    }
  }

  /* ===========================================================================
   *  11. RAYONS  (Prisme, puis Cœur)
   * -----------------------------------------------------------------------
   *  Un rayon est une POLYLIGNE : il rebondit de fragment en fragment. Il vit
   *  en deux temps — 'charge' (tracé fantôme, inoffensif) puis 'feu' (trait
   *  plein, mortel). Le joueur voit donc le chemin exact avant qu'il ne brûle.
   * ======================================================================== */

  function creerRayon(points, charge, feu, coul, demi) {
    if (S.rayons.length >= REGLAGES.maxRayons) return null;
    const r = {
      pts: points,               // [{x,y}, …] au moins deux points
      etat: 'charge',
      t: 0,
      charge: charge,
      feu: feu,
      demi: demi == null ? 5 * ech() : demi,
      coul: coul || DANGER,
      touche: false
    };
    S.rayons.push(r);
    return r;
  }

  function majRayons(dt) {
    const p = joueur();
    const rayonJoueur = (typeof TEMPO !== 'undefined' && TEMPO.PLAYER_HITBOX)
      ? TEMPO.PLAYER_HITBOX * 0.5 : 5;

    for (let i = S.rayons.length - 1; i >= 0; i--) {
      const r = S.rayons[i];
      r.t += dt;

      if (r.etat === 'charge') {
        if (r.t >= r.charge) {
          r.etat = 'feu';
          r.t = 0;
          evt('enemyShot', { type: 'shooter' });
          secousse(0.10);
          if (r.pts.length) onde(r.pts[0].x, r.pts[0].y, r.coul, 0.7);
        }
      } else if (r.etat === 'feu') {
        // Collision : distance du joueur à chaque tronçon. Le rayon ne blesse
        // qu'une seule fois — les i-frames font le reste.
        if (!r.touche) {
          for (let j = 0; j + 1 < r.pts.length; j++) {
            const d = distSegment(p.x, p.y, r.pts[j].x, r.pts[j].y, r.pts[j + 1].x, r.pts[j + 1].y);
            if (d <= r.demi + rayonJoueur) {
              if (blesserJoueur('boss-rayon')) r.touche = true;
              break;
            }
          }
        }
        if (r.t >= r.feu) S.rayons.splice(i, 1);
      }
    }
  }

  function dessinerRayons(c) {
    for (let i = 0; i < S.rayons.length; i++) {
      const r = S.rayons[i];
      const pts = r.pts;
      if (!pts || pts.length < 2) continue;

      if (r.etat === 'charge') {
        const k = cl(r.t / Math.max(0.001, r.charge), 0, 1);
        for (let j = 0; j + 1 < pts.length; j++) {
          teleLigne(c, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y, k, r.coul, 1.6);
        }
        for (let j = 0; j < pts.length; j++) {
          teleCharge(c, pts[j].x, pts[j].y, 7 * ech(), k, r.coul);
        }
      } else {
        // Salve : le trait plein, avec un noyau blanc qui survit au bloom et
        // une largeur qui s'effondre en fin de vie (le rayon « se coupe »).
        const u = cl(r.t / Math.max(0.001, r.feu), 0, 1);
        const w = r.demi * 2 * (u < 0.12 ? ss(u / 0.12) : 1 - ss(Math.max(0, (u - 0.7) / 0.3)));
        const plat = [];
        for (let j = 0; j < pts.length; j++) plat.push(pts[j].x, pts[j].y);
        NEON.polyline(c, plat, r.coul, Math.max(0.6, w), {
          alpha: 0.95, glowScale: 1.6, passes: 4
        });
        NEON.polyline(c, plat, 'shock', Math.max(0.4, w * 0.30), { alpha: 0.9, passes: 2 });
        for (let j = 0; j < pts.length; j++) {
          NEON.dot(c, pts[j].x, pts[j].y, w * 0.75, 'shock',
                   { alpha: 0.8, glowScale: 1.5 });
        }
      }
    }
  }

  /* ===========================================================================
   *  12. BOSS 0 — LA RUCHE  (stage 5)
   * -----------------------------------------------------------------------
   *  Gros fuselage alvéolaire. Trois ALVÉOLES ambre sous le ventre : ce sont
   *  les points faibles, et ce sont elles qui pondent l'essaim. En détruire
   *  une tarit une source de drones — le joueur choisit donc entre nettoyer
   *  l'écran et tarir la source.
   *      Phase 1  ESSAIM    : les alvéoles s'ouvrent et lâchent des drones.
   *      Phase 2  ÉVENTAIL  : salves en éventail depuis les trois alvéoles.
   *      Phase 3  CHARGE    : la Ruche plonge sur le joueur en semant des balles.
   * ======================================================================== */

  const DEF_RUCHE = {
    nom: 'LA RUCHE',
    sous: 'NID ALVÉOLAIRE',
    coul: 'enemy.normal',

    init: function () {
      const e = ech(), m = S.memo;
      m.larg = 320 * e;
      m.haut = 140 * e;
      m.ouv = 0;              // ouverture des alvéoles, 0..1
      m.mix = 0;              // 0 = vol libre, 1 = charge en cours
      m.charge = false;
      m.cibleX = 0; m.cibleY = 0;
      m.inclin = 0;
      m.semis = 0;            // minuterie de semis de balles pendant la charge
      m.cellules = [];        // nid d'abeille décoratif, calculé une fois
      const cols = 7, rows = 3;
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < cols - (r % 2); i++) {
          const x = (i - (cols - 1 - (r % 2)) / 2) * m.larg * 0.115 + (r % 2 ? m.larg * 0.057 : 0);
          const y = (r - (rows - 1) / 2) * m.haut * 0.235;
          if (Math.abs(x) > m.larg * 0.40 * (1 - Math.abs(y) / (m.haut * 0.62))) continue;
          m.cellules.push({ x: x, y: y, r: m.larg * 0.055, ph: Math.random() * TAU });
        }
      }

      // Coque : trois disques le long du fuselage — bien plus juste qu'un
      // cercle unique sur un corps aussi large.
      ajouterPart('coqueG', 'coque', -m.larg * 0.30, 0, m.haut * 0.44, Infinity);
      ajouterPart('coqueC', 'coque', 0, -m.haut * 0.05, m.haut * 0.58, Infinity);
      ajouterPart('coqueD', 'coque', m.larg * 0.30, 0, m.haut * 0.44, Infinity);
      construireAlveoles();

      S.x = larg() / 2;
      S.y = -m.haut;
    },

    /** Les alvéoles repoussent à chaque changement de phase : le combat garde
     *  ses cibles jusqu'au bout, et la bascule se lit comme une régénération. */
    reconstruire: construireAlveoles,

    update: function (dt) {
      const m = S.memo, e = ech(), W = larg(), H = haut();

      /* ---- vol -------------------------------------------------------- */
      const amp = Math.max(40, W * 0.5 - m.larg * 0.60);
      const libX = W / 2 + Math.sin(S.t * (0.40 + S.phase * 0.07)) * amp;
      const libY = H * 0.205 + Math.sin(S.t * 0.95) * 10 * e;

      // Fin de plongeon : sur la MONTRE. La faire dépendre de `mix` créerait
      // un verrou (mix ne redescend que si la charge est finie, et vice versa)
      // et la Ruche resterait collée au joueur pour toujours.
      if (m.charge && S.t > m.chargeFin) m.charge = false;
      if (m.charge) {
        m.mix = Math.min(1, m.mix + dt * 2.4);
      } else {
        m.mix = Math.max(0, m.mix - dt * 1.9);
      }
      const k = ss(m.mix);
      S.x = lp(libX, m.cibleX, k);
      S.y = lp(libY, m.cibleY, k);
      S.angle = lp(0, m.inclin, k) + Math.sin(S.t * 1.6) * 0.02;

      S.x = cl(S.x, m.larg * 0.42, W - m.larg * 0.42);

      /* ---- ouverture des alvéoles : elles respirent, et béent en salve --- */
      const veut = enTele() || (S.att && S.att.etat === 'feu') ? 1 : 0.25;
      m.ouv = damp2(m.ouv, veut, 0.02, dt);

      /* ---- semis de balles pendant la charge ---------------------------- */
      if (m.charge && m.mix > 0.25) {
        m.semis -= dt;
        if (m.semis <= 0) {
          m.semis = 0.13 / S.multCadence;
          const a = Math.PI / 2 + rr(-0.5, 0.5);
          tirer(S.x + rr(-m.larg * 0.32, m.larg * 0.32), S.y + m.haut * 0.3, a, 300, 'normal');
        }
      }

      /* ---- attaques ----------------------------------------------------- */
      const etat = avancerAttaque(dt, onTirRuche);
      if (etat === 'fin' || etat === 'libre') {
        if (!m.charge) programmerRuche();
      }
    },

    dessiner: function (c) { dessinerRuche(c); }
  };

  function construireAlveoles() {
    const m = S.memo;
    retirerParts('faible');
    const pv = S.hpMax * 0.055;
    const xs = [-m.larg * 0.27, 0, m.larg * 0.27];
    for (let i = 0; i < 3; i++) {
      ajouterPart('alv' + i, 'faible', xs[i], m.haut * 0.30, m.larg * 0.075, pv,
                  { rang: i, pondu: 0 });
    }
  }

  /** Choix et armement de la prochaine attaque, selon la phase. */
  function programmerRuche() {
    const m = S.memo;
    const alv = compter('faible');

    if (S.phase === 1) {
      const nom = choisir([['essaim', alv > 0 ? 1.0 : 0], ['dard', 0.55]]);
      if (nom === 'essaim') lancerAttaque('essaim', 1.05, 0.6, 2.5, 3 + Math.max(0, alv - 1) * 2, 0.10);
      else lancerAttaque('dard', 0.50, 0.30, 1.0, 3, 0.11);

    } else if (S.phase === 2) {
      const nom = choisir([['eventail', 1.0], ['essaim', alv > 0 ? 0.45 : 0], ['dard', 0.4]]);
      if (nom === 'eventail') lancerAttaque('eventail', 0.85, 0.55, 1.5, 3, 0.20);
      else if (nom === 'essaim') lancerAttaque('essaim', 1.0, 0.45, 2.0, 3, 0.11);
      else lancerAttaque('dard', 0.45, 0.28, 0.9, 4, 0.10);

    } else {
      const nom = choisir([['charge', 1.0], ['eventail', 0.75], ['essaim', alv > 0 ? 0.35 : 0]]);
      if (nom === 'charge') {
        const a = lancerAttaque('charge', 1.10, 1.55, 0.9, 1, 0);
        const p = joueur();
        a.memo.x = cl(p.x, m.larg * 0.42, larg() - m.larg * 0.42);
        a.memo.y = cl(p.y - haut() * 0.16, haut() * 0.24, haut() * 0.60);
        evt('divealert', {});
      } else if (nom === 'eventail') {
        lancerAttaque('eventail', 0.70, 0.5, 1.1, 4, 0.16);
      } else {
        lancerAttaque('essaim', 0.9, 0.45, 1.6, 4, 0.10);
      }
    }
  }

  /** Un « coup » de la salve courante. Appelé par l'ordonnanceur. */
  function onTirRuche(i, a) {
    const m = S.memo;
    const alv = partsDe('faible');

    if (a.nom === 'essaim') {
      // Chaque alvéole vivante pond à tour de rôle : l'œil suit la source.
      if (!alv.length) return;
      const src = alv[i % alv.length];
      const base = Math.PI / 2 + (src.ox / Math.max(1, m.larg * 0.5)) * 0.75;
      lacherDrone(src.x, src.y + src.r * 0.6, base + rr(-0.35, 0.35), S.coul);
      src.pondu = 0.35;
      evt('enemyShot', { type: 'normal' });
      secousse(0.04);

    } else if (a.nom === 'dard') {
      const src = alv.length ? alv[i % alv.length] : { x: S.x, y: S.y + m.haut * 0.3 };
      const ang = viser(src.x, src.y);
      tirer(src.x, src.y, ang, 400, 'shooter', { width: 6, height: 17 });
      evt('enemyShot', { type: 'shooter' });

    } else if (a.nom === 'eventail') {
      const nb = 9 + S.phase + S.bonusBalles * 2;
      const ouv = 1.15 + i * 0.12;
      const src = alv.length ? alv[i % alv.length] : { x: S.x, y: S.y + m.haut * 0.3 };
      const ang = Math.PI / 2 + Math.sin(S.t * 1.3 + i) * 0.22;
      eventail(src.x, src.y, ang, nb, ouv, 330 + i * 18, 'normal');
      evt('enemyShot', { type: 'shooter' });
      secousse(0.10);
      gel(16);

    } else if (a.nom === 'charge') {
      // La charge n'est pas un tir : c'est le départ du plongeon.
      m.charge = true;
      m.chargeFin = S.t + 1.45;
      m.cibleX = a.memo.x;
      m.cibleY = a.memo.y;
      m.inclin = (a.memo.x - S.x) / larg() * 0.55;
      m.semis = 0;
      juice('enemyHit', 1.2);
      secousse(0.26);
      evt('ramKill', { type: 'elite' });
    }
  }

  function dessinerRuche(c) {
    const m = S.memo, e = ech(), t = tps();
    const cs = Math.cos(S.angle), sn = Math.sin(S.angle);
    const X = (ox, oy) => S.x + ox * cs - oy * sn;
    const Y = (ox, oy) => S.y + ox * sn + oy * cs;
    const col = S.flash > 0.02 ? 'shock' : S.coul;
    const W = m.larg, H = m.haut;

    /* --- coque : hexagone très aplati, la silhouette de la ruche --------- */
    const coque = [];
    const profil = [
      [-0.50, 0.00], [-0.33, -0.42], [0.33, -0.42], [0.50, 0.00],
      [0.34, 0.38], [0.00, 0.50], [-0.34, 0.38]
    ];
    for (let i = 0; i < profil.length; i++) {
      coque.push(X(profil[i][0] * W, profil[i][1] * H), Y(profil[i][0] * W, profil[i][1] * H));
    }
    NEON.shape(c, coque, col, 2.6, {
      alpha: 1, fill: true, fillAlpha: 0.13, glowScale: 1.25, passes: 4
    });

    /* --- nid d'abeille : chaque cellule respire avec un décalage de phase - */
    for (let i = 0; i < m.cellules.length; i++) {
      const ce = m.cellules[i];
      const puls = 0.5 + 0.5 * Math.sin(t * 2.4 + ce.ph + ce.x * 0.01);
      const r = ce.r * (0.82 + puls * 0.16);
      NEON.shape(c, hexa(X(ce.x, ce.y), Y(ce.x, ce.y), r, S.angle + Math.PI / 6),
                 col, 1.1, { alpha: 0.18 + puls * 0.24, passes: 2 });
    }

    /* --- nervures : deux arêtes qui filent d'un bout à l'autre ----------- */
    NEON.line(c, X(-W * 0.46, -H * 0.06), Y(-W * 0.46, -H * 0.06),
                 X(W * 0.46, -H * 0.06), Y(W * 0.46, -H * 0.06), col, 1.6,
              { alpha: 0.45, passes: 3 });
    NEON.line(c, X(-W * 0.40, H * 0.22), Y(-W * 0.40, H * 0.22),
                 X(W * 0.40, H * 0.22), Y(W * 0.40, H * 0.22), col, 1.3,
              { alpha: 0.32, passes: 2 });

    /* --- mandibules latérales : elles s'écartent quand la ruche s'ouvre --- */
    const ecart = 0.10 + m.ouv * 0.14;
    for (let s = -1; s <= 1; s += 2) {
      NEON.polyline(c, [
        X(s * W * 0.46, -H * 0.10), Y(s * W * 0.46, -H * 0.10),
        X(s * W * 0.62, H * (0.04 + ecart)), Y(s * W * 0.62, H * (0.04 + ecart)),
        X(s * W * 0.44, H * (0.30 + ecart)), Y(s * W * 0.44, H * (0.30 + ecart))
      ], col, 2.0, { alpha: 0.85, glowScale: 1.15, passes: 3 });
    }

    /* --- alvéoles : les points faibles, ambre, ouverts et pulsants ------- */
    for (let i = 0; i < S.parts.length; i++) {
      const p = S.parts[i];
      if (p.kind !== 'faible') continue;
      dessinerAlveole(c, p, t);
    }

    /* --- œil central : le cœur de la ruche, il change avec la phase ------ */
    const battement = 0.5 + 0.5 * Math.sin(t * (2.6 + S.phase * 0.9));
    NEON.ring(c, X(0, -H * 0.06), Y(0, -H * 0.06), W * (0.075 + battement * 0.015), 1.8,
              col, { alpha: 0.55, passes: 3 });
    NEON.dot(c, X(0, -H * 0.06), Y(0, -H * 0.06), W * 0.026 * (0.8 + battement * 0.5),
             S.phase >= 3 ? DANGER : col, { alpha: 0.9, glowScale: 1.5 });

    /* --- télégraphies ---------------------------------------------------- */
    const a = S.att;
    if (a && a.nom && a.etat === 'tele') {
      const alv = partsDe('faible');
      if (a.nom === 'essaim') {
        for (let i = 0; i < alv.length; i++) {
          teleCharge(c, alv[i].x, alv[i].y + alv[i].r * 0.5, alv[i].r * 0.9, a.k, S.coul);
        }
      } else if (a.nom === 'dard') {
        for (let i = 0; i < alv.length; i++) {
          const ang = viser(alv[i].x, alv[i].y);
          teleLigne(c, alv[i].x, alv[i].y,
                    alv[i].x + Math.cos(ang) * haut(), alv[i].y + Math.sin(ang) * haut(),
                    a.k, DANGER, 1.5);
        }
      } else if (a.nom === 'eventail') {
        const nb = 9 + S.phase + S.bonusBalles * 2;
        for (let i = 0; i < alv.length; i++) {
          teleEventail(c, alv[i].x, alv[i].y, Math.PI / 2, nb, 1.15, haut() * 0.55, a.k, DANGER);
        }
      } else if (a.nom === 'charge') {
        const p0x = S.x, p0y = S.y + H * 0.45;
        teleCorridor(c, p0x, p0y, a.memo.x, haut() + 40, W * 0.30, a.k, DANGER);
        teleAlerte(c, a.memo.x, haut() * 0.72, a.k, DANGER);
        // Le fuselage se cabre : l'anticipation est aussi dans la posture.
        NEON.ring(c, S.x, S.y, W * (0.55 - a.k * 0.16), 2.2, DANGER,
                  { alpha: 0.10 + a.k * 0.35, dash: [14, 10], dashOffset: -tpsReel() * 160, passes: 3 });
      }
    }
  }

  function dessinerAlveole(c, p, t) {
    const ouv = S.memo.ouv;
    const puls = 0.5 + 0.5 * Math.sin(t * 5 + p.t);
    const r = p.r * (0.9 + puls * 0.10 + ouv * 0.18);
    const col = p.flash > 0.02 ? 'shock' : FAIBLE;

    // Volets qui s'écartent : on VOIT l'alvéole s'ouvrir avant la ponte.
    for (let s = -1; s <= 1; s += 2) {
      NEON.polyline(c, [
        p.x + s * r * 0.95, p.y - r * 0.65,
        p.x + s * r * (1.25 + ouv * 0.55), p.y + r * (0.15 + ouv * 0.5),
        p.x + s * r * 0.5, p.y + r * 0.95
      ], S.coul, 1.5, { alpha: 0.55, passes: 2 });
    }

    NEON.shape(c, hexa(p.x, p.y, r, Math.PI / 6), col, 2.2, {
      alpha: 0.95, fill: true, fillAlpha: 0.28 + ouv * 0.24, glowScale: 1.35 + ouv * 0.5, passes: 4
    });
    NEON.dot(c, p.x, p.y, r * (0.22 + ouv * 0.14), col, { alpha: 1, glowScale: 1.5 });

    // Jauge de la cellule : un arc qui se vide, lisible sans chiffre.
    const f = cl(p.hp / p.hpMax, 0, 1);
    if (f < 0.999) {
      const pth = new Path2D();
      pth.arc(p.x, p.y, r * 1.55, -Math.PI / 2, -Math.PI / 2 + TAU * f);
      NEON.custom(c, pth, col, 2.2, { alpha: 0.8, cap: 'butt', passes: 3 });
    }
    if (p.pondu > 0) {
      const k = cl(p.pondu / 0.35, 0, 1);
      NEON.ring(c, p.x, p.y, r * (1 + (1 - k) * 2.6), 1.6, col, { alpha: 0.55 * k, passes: 2 });
    }
  }

  /* ===========================================================================
   *  13. BOSS 1 — LE PRISME  (stage 10)
   * -----------------------------------------------------------------------
   *  Un noyau cristallin entouré de FRAGMENTS qui gravitent. Le noyau est
   *  blindé tant que les fragments l'entourent : son bouclier est dessiné en
   *  pointillés dont la densité DIT combien de fragments restent. Chaque
   *  fragment détruit ouvre le bouclier d'un cran — et retire un miroir au
   *  boss, donc un rebond à ses rayons.
   *      Phase 1  RÉFLEXION : rayon noyau → fragment → fragment → écran.
   *      Phase 2  PHARE     : les fragments se resserrent, trois rayons balaient.
   *      Phase 3  CAGE      : les fragments s'écartent et se relient entre eux.
   * ======================================================================== */

  const DEF_PRISME = {
    nom: 'LE PRISME',
    sous: 'RÉSEAU RÉFRACTAIRE',
    coul: 'enemy.shooter',

    init: function () {
      const e = ech(), m = S.memo;
      m.rayonOrbite = 150 * e;
      m.orbiteVoulu = 150 * e;
      m.rot = 0;
      m.vitRot = 0.42;
      m.rNoyau = 46 * e;
      m.spin = 0;
      m.ouverture = 0;        // 0 = noyau fermé, 1 = noyau béant
      m.balayage = 0;
      m.nbFrag = 5;

      ajouterPart('noyau', 'coque', 0, 0, m.rNoyau, Infinity);
      ajouterPart('coeurP', 'faible', 0, 0, m.rNoyau * 0.44, Infinity,
                  { vulnerable: false, armure: 0.30 });
      construireFragments();

      S.x = larg() / 2;
      S.y = -m.rNoyau * 2;
    },

    reconstruire: construireFragments,

    update: function (dt) {
      const m = S.memo, e = ech(), W = larg(), H = haut();

      /* ---- dérive du noyau : lent Lissajous dans le tiers supérieur ----- */
      const amp = Math.max(30, W * 0.5 - m.rayonOrbite - 50 * e);
      S.x = W / 2 + Math.sin(S.t * 0.33) * amp * 0.85;
      S.y = H * 0.27 + Math.sin(S.t * 0.51 + 1.1) * H * 0.045;
      S.angle = 0;
      m.spin += dt * (0.55 + S.phase * 0.22);

      /* ---- orbite des fragments ---------------------------------------- */
      m.orbiteVoulu = (S.phase === 1 ? 155 : S.phase === 2 ? 95 : 235) * e;
      m.rayonOrbite = damp2(m.rayonOrbite, m.orbiteVoulu, 0.06, dt);
      m.vitRot = (S.phase === 1 ? 0.42 : S.phase === 2 ? 1.35 : 0.72) * (1 + (S.menace - 1) * 0.08);
      m.rot += m.vitRot * dt;

      const frags = partsDe('fragment');
      for (let i = 0; i < frags.length; i++) {
        const f = frags[i];
        const a = m.rot + f.rang * TAU / Math.max(1, m.nbFrag);
        const r = m.rayonOrbite * (1 + Math.sin(S.t * 1.7 + f.rang) * 0.05);
        f.ox = Math.cos(a) * r;
        f.oy = Math.sin(a) * r * 0.72;   // orbite écrasée : plus lisible en 2D
        f.angle = a + Math.PI / 2 + m.spin * 0.6;
      }

      /* ---- bouclier du noyau : il s'ouvre à mesure qu'on casse ---------- */
      const restant = frags.length;
      const noy = part('noyau');
      const cp = part('coeurP');
      if (noy) {
        noy.vulnerable = restant <= 1;
        noy.armure = restant >= 4 ? 0.45 : restant >= 2 ? 0.68 : 0.90;
      }
      if (cp) {
        cp.vulnerable = restant <= 2;
        cp.armure = 0.30;
      }
      m.ouverture = damp2(m.ouverture, restant <= 2 ? 1 : 0, 0.05, dt);

      /* ---- balayage du phare -------------------------------------------- */
      if (m.balayage > 0) m.balayage -= dt;

      /* ---- attaques ------------------------------------------------------ */
      const etat = avancerAttaque(dt, onTirPrisme);
      if (etat === 'fin' || etat === 'libre') programmerPrisme();
    },

    dessiner: function (c) { dessinerPrisme(c); }
  };

  function construireFragments() {
    const m = S.memo;
    retirerParts('fragment');
    m.nbFrag = S.phase === 1 ? 5 : S.phase === 2 ? 4 : 6;
    const pv = S.hpMax * (S.phase === 3 ? 0.05 : 0.065);
    for (let i = 0; i < m.nbFrag; i++) {
      ajouterPart('frag' + i, 'fragment', 0, 0, 26 * ech(), pv, { rang: i, tir: rr(1.2, 3.4) });
    }
  }

  /** Chemin d'un rayon réfléchi : noyau → f1 → f2 → bord de l'écran.
   *  Le prolongement final part dans la direction f1→f2 : la réflexion se
   *  LIT, elle n'est pas décorative. */
  function cheminReflechi(f1, f2) {
    const pts = [{ x: S.x, y: S.y }, { x: f1.x, y: f1.y }];
    if (f2) {
      pts.push({ x: f2.x, y: f2.y });
      const dx = f2.x - f1.x, dy = f2.y - f1.y;
      const d = Math.hypot(dx, dy) || 1;
      const L = larg() + haut();
      pts.push({ x: f2.x + dx / d * L, y: f2.y + dy / d * L });
    } else {
      // Sans second miroir, le rayon rebondit vers le joueur : le boss
      // affaibli devient plus direct, donc plus dangereux.
      const a = viser(f1.x, f1.y);
      const L = larg() + haut();
      pts.push({ x: f1.x + Math.cos(a) * L, y: f1.y + Math.sin(a) * L });
    }
    return pts;
  }

  function programmerPrisme() {
    const frags = partsDe('fragment');

    if (S.phase === 1) {
      const nom = choisir([['reflexion', 1.0], ['esquilles', 0.5]]);
      if (nom === 'reflexion') lancerAttaque('reflexion', 0.95, 1.30, 1.5, frags.length >= 3 ? 2 : 1, 0.42);
      else lancerAttaque('esquilles', 0.55, 0.45, 1.2, 3, 0.16);

    } else if (S.phase === 2) {
      const nom = choisir([['phare', 1.0], ['esquilles', 0.55], ['reflexion', 0.45]]);
      if (nom === 'phare') lancerAttaque('phare', 1.00, 1.95, 1.5, 1, 0);
      else if (nom === 'esquilles') lancerAttaque('esquilles', 0.50, 0.5, 1.0, 4, 0.14);
      else lancerAttaque('reflexion', 0.85, 1.1, 1.2, 2, 0.35);

    } else {
      const nom = choisir([['cage', 1.0], ['reflexion', 0.6], ['esquilles', 0.5]]);
      if (nom === 'cage') lancerAttaque('cage', 1.10, 1.90, 1.6, 1, 0);
      else if (nom === 'reflexion') lancerAttaque('reflexion', 0.80, 1.2, 1.1, 3, 0.30);
      else lancerAttaque('esquilles', 0.45, 0.6, 0.9, 5, 0.12);
    }

    // Mémorise les miroirs choisis DÈS la décision : la télégraphie et la
    // salve doivent montrer exactement le même chemin.
    const a = S.att;
    if (a && (a.nom === 'reflexion')) {
      a.memo.paires = [];
      for (let i = 0; i < a.nb; i++) {
        if (!frags.length) { a.memo.paires.push(null); continue; }
        const f1 = frags[(i * 2) % frags.length];
        const f2 = frags.length > 1 ? frags[(i * 2 + 1 + i) % frags.length] : null;
        a.memo.paires.push({ f1: f1, f2: (f2 === f1 ? null : f2) });
      }
    } else if (a && a.nom === 'phare') {
      a.memo.base = viser(S.x, S.y) - 0.5;
      a.memo.sens = Math.random() < 0.5 ? 1 : -1;
    }
  }

  function onTirPrisme(i, a) {
    const m = S.memo;
    const frags = partsDe('fragment');

    if (a.nom === 'reflexion') {
      const pr = a.memo.paires && a.memo.paires[i];
      if (!pr || !pr.f1 || !pr.f1.vivant) {
        // Le miroir a été détruit pendant la télégraphie : tir direct, mais
        // annoncé par sa propre petite charge (le rayon garde 0,25 s d'avance).
        const ang = viser(S.x, S.y);
        const L = larg() + haut();
        creerRayon([{ x: S.x, y: S.y },
                    { x: S.x + Math.cos(ang) * L, y: S.y + Math.sin(ang) * L }],
                   0.25, 0.40, DANGER, 5 * ech());
        return;
      }
      creerRayon(cheminReflechi(pr.f1, pr.f2 && pr.f2.vivant ? pr.f2 : null),
                 0.05, 0.42, DANGER, 5.5 * ech());
      juice('enemyHit', 0.8);
      secousse(0.14);

    } else if (a.nom === 'esquilles') {
      // Chaque fragment crache une balle : la menace vient de la couronne,
      // pas du centre. Décalage d'un fragment à l'autre pour rester lisible.
      for (let j = 0; j < frags.length; j++) {
        const f = frags[j];
        const ang = viser(f.x, f.y) + (j - frags.length / 2) * 0.06;
        tirer(f.x, f.y, ang, 380 + i * 12, 'shooter', { width: 5, height: 15 });
      }
      evt('enemyShot', { type: 'shooter' });

    } else if (a.nom === 'phare') {
      // Trois rayons solidaires qui pivotent : le balayage est UNE attaque,
      // pas trente. On les recrée à cadence fixe pendant la fenêtre de feu.
      m.balayage = 1.95;
      m.phareBase = a.memo.base;
      m.phareSens = a.memo.sens;
      m.phareT = 0;

    } else if (a.nom === 'cage') {
      // Les fragments se relient deux à deux : une cage tournante avec des
      // ouvertures franches. Le joueur cherche la brèche, il ne subit pas.
      if (frags.length < 2) return;
      for (let j = 0; j < frags.length; j += 2) {
        const f1 = frags[j], f2 = frags[(j + 1) % frags.length];
        creerRayon([{ x: f1.x, y: f1.y }, { x: f2.x, y: f2.y }],
                   0.05, 1.85, DANGER, 4.5 * ech());
      }
      m.cageT = 1.85;
      juice('enemyHit', 1.0);
      secousse(0.2);
    }
  }

  /** Le phare : rayons régénérés chaque frame pour suivre la rotation.
   *  Appelé depuis la mise à jour globale, après les attaques. */
  function majPharePrisme(dt) {
    const m = S.memo;
    if (!(m.balayage > 0)) return;
    m.phareT = (m.phareT || 0) + dt;
    const vit = 0.85 * (1 + (S.menace - 1) * 0.07) * (m.phareSens || 1);
    const base = (m.phareBase || 0) + m.phareT * vit;
    const L = larg() + haut();
    const p = joueur();
    const rj = (typeof TEMPO !== 'undefined' && TEMPO.PLAYER_HITBOX) ? TEMPO.PLAYER_HITBOX * 0.5 : 5;
    const demi = 5.5 * ech();
    const nb = 3;
    m.phareAngles = m.phareAngles || [];
    m.phareAngles.length = 0;
    for (let i = 0; i < nb; i++) {
      const a = base + i * TAU / nb;
      m.phareAngles.push(a);
      const x1 = S.x + Math.cos(a) * L, y1 = S.y + Math.sin(a) * L;
      if (distSegment(p.x, p.y, S.x, S.y, x1, y1) <= demi + rj) blesserJoueur('boss-phare');
    }
  }

  function dessinerPhare(c) {
    const m = S.memo;
    if (!(m.balayage > 0) || !m.phareAngles) return;
    const L = larg() + haut();
    const k = cl(m.balayage / 1.95, 0, 1);
    const w = 11 * ech() * (k > 0.85 ? (1 - k) / 0.15 : Math.min(1, k / 0.12 + 0.2));
    for (let i = 0; i < m.phareAngles.length; i++) {
      const a = m.phareAngles[i];
      const x1 = S.x + Math.cos(a) * L, y1 = S.y + Math.sin(a) * L;
      NEON.line(c, S.x, S.y, x1, y1, DANGER, Math.max(0.6, w), {
        alpha: 0.85, glowScale: 1.6, passes: 4
      });
      NEON.line(c, S.x, S.y, x1, y1, 'shock', Math.max(0.4, w * 0.28), { alpha: 0.85, passes: 2 });
    }
  }

  function dessinerPrisme(c) {
    const m = S.memo, e = ech(), t = tps();
    const col = S.flash > 0.02 ? 'shock' : S.coul;
    const frags = partsDe('fragment');
    const restant = frags.length;

    /* --- halo d'orbite : la scène du combat, dessinée au sol ------------- */
    NEON.ring(c, S.x, S.y, m.rayonOrbite, 1.0, col, {
      alpha: 0.10, dash: [5, 16], dashOffset: tpsReel() * 40, passes: 2
    });

    /* --- liens noyau ↔ fragments : on VOIT le réseau qui l'alimente ------ */
    for (let i = 0; i < frags.length; i++) {
      const f = frags[i];
      const puls = 0.5 + 0.5 * Math.sin(t * 3.4 - i * 0.7);
      NEON.line(c, S.x, S.y, f.x, f.y, col, 1.1, {
        alpha: 0.10 + puls * 0.16, dash: [3, 9], dashOffset: -t * 70, passes: 2
      });
    }

    /* --- fragments : éclats triangulaires, noyau ambre = point faible ---- */
    for (let i = 0; i < frags.length; i++) dessinerFragment(c, frags[i], t);

    /* --- bouclier du noyau : sa DENSITÉ dit combien de miroirs restent --- */
    if (restant > 0) {
      const seg = Math.max(4, restant * 4);
      NEON.ring(c, S.x, S.y, m.rNoyau * 1.42, 2.0 + restant * 0.25, col, {
        alpha: 0.18 + restant * 0.07,
        dash: [Math.max(3, 46 / seg * 3), Math.max(4, 46 / seg * 2.2)],
        dashOffset: -t * 55,
        passes: 3
      });
    }

    /* --- noyau : deux triangles opposés qui tournent en sens inverse ----- */
    const r = m.rNoyau * (1 + Math.sin(t * 2.2) * 0.03);
    NEON.shape(c, poly(S.x, S.y, r, 3, m.spin), col, 2.6,
               { alpha: 1, fill: true, fillAlpha: 0.14, glowScale: 1.3, passes: 4 });
    NEON.shape(c, poly(S.x, S.y, r, 3, -m.spin * 0.8 + Math.PI), col, 2.2,
               { alpha: 0.9, fill: true, fillAlpha: 0.10, glowScale: 1.2, passes: 3 });
    NEON.shape(c, poly(S.x, S.y, r * 0.62, 6, m.spin * 1.6), col, 1.4,
               { alpha: 0.5, passes: 2 });

    /* --- cœur du prisme : point faible, scellé tant que les miroirs vivent */
    const cp = part('coeurP');
    if (cp) {
      const ouv = m.ouverture;
      const rc = cp.r * (0.55 + ouv * 0.7) * (1 + Math.sin(t * 6) * 0.06);
      const colc = cp.flash > 0.02 ? 'shock' : (cp.vulnerable ? FAIBLE : col);
      NEON.shape(c, poly(S.x, S.y, rc, 6, -m.spin * 1.2), colc, 2.0, {
        alpha: 0.45 + ouv * 0.55, fill: true, fillAlpha: 0.25 + ouv * 0.4,
        glowScale: 1.2 + ouv * 0.8, passes: 4
      });
      if (ouv > 0.35) {
        NEON.dot(c, S.x, S.y, rc * 0.45, FAIBLE, { alpha: ouv, glowScale: 1.8 });
        NEON.ring(c, S.x, S.y, rc * (1.6 + Math.sin(t * 4) * 0.2), 1.4, FAIBLE,
                  { alpha: ouv * 0.5, passes: 2 });
      }
    }

    dessinerPhare(c);

    /* --- télégraphies ---------------------------------------------------- */
    const a = S.att;
    if (a && a.nom && a.etat === 'tele') {
      if (a.nom === 'reflexion' && a.memo.paires) {
        for (let i = 0; i < a.memo.paires.length; i++) {
          const pr = a.memo.paires[i];
          if (!pr || !pr.f1 || !pr.f1.vivant) continue;
          const pts = cheminReflechi(pr.f1, pr.f2 && pr.f2.vivant ? pr.f2 : null);
          const kk = cl(a.k - i * 0.10, 0, 1);
          for (let j = 0; j + 1 < pts.length; j++) {
            teleLigne(c, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y, kk, DANGER, 1.6);
          }
          for (let j = 1; j < pts.length - 1; j++) {
            teleCharge(c, pts[j].x, pts[j].y, 9 * e, kk, DANGER);
          }
        }
        teleCharge(c, S.x, S.y, m.rNoyau * 0.5, a.k, DANGER);

      } else if (a.nom === 'phare') {
        const L = larg() + haut();
        for (let i = 0; i < 3; i++) {
          const ang = a.memo.base + i * TAU / 3;
          teleLigne(c, S.x, S.y, S.x + Math.cos(ang) * L, S.y + Math.sin(ang) * L, a.k, DANGER, 1.8);
        }
        // Flèche du sens de rotation : le joueur sait de quel côté fuir.
        const pth = new Path2D();
        const rr2 = m.rNoyau * 2.1;
        pth.arc(S.x, S.y, rr2, a.memo.base, a.memo.base + a.memo.sens * 1.5, a.memo.sens < 0);
        NEON.custom(c, pth, DANGER, 2.0, { alpha: 0.15 + a.k * 0.45, cap: 'butt', passes: 3 });
        teleCharge(c, S.x, S.y, m.rNoyau * 0.55, a.k, DANGER);

      } else if (a.nom === 'cage') {
        for (let j = 0; j < frags.length; j += 2) {
          const f1 = frags[j], f2 = frags[(j + 1) % frags.length];
          teleLigne(c, f1.x, f1.y, f2.x, f2.y, a.k, DANGER, 1.7);
        }
        for (let j = 0; j < frags.length; j++) teleCharge(c, frags[j].x, frags[j].y, 10 * e, a.k, DANGER);

      } else if (a.nom === 'esquilles') {
        for (let j = 0; j < frags.length; j++) {
          const f = frags[j];
          const ang = viser(f.x, f.y);
          teleLigne(c, f.x, f.y, f.x + Math.cos(ang) * haut(), f.y + Math.sin(ang) * haut(),
                    a.k, DANGER, 1.2);
        }
      }
    }
  }

  function dessinerFragment(c, f, t) {
    const col = f.flash > 0.02 ? 'shock' : S.coul;
    const r = f.r * (0.92 + Math.sin(t * 3 + f.rang) * 0.06);
    const a = f.angle;
    // Éclat : un triangle allongé, orienté sur son orbite.
    const pts = [
      f.x + Math.cos(a) * r * 1.35, f.y + Math.sin(a) * r * 1.35,
      f.x + Math.cos(a + 2.3) * r, f.y + Math.sin(a + 2.3) * r,
      f.x + Math.cos(a - 2.3) * r, f.y + Math.sin(a - 2.3) * r
    ];
    NEON.shape(c, pts, col, 2.0, {
      alpha: 1, fill: true, fillAlpha: 0.16, glowScale: 1.2, passes: 3
    });
    // Facette interne : elle donne l'épaisseur du cristal.
    NEON.line(c, f.x + Math.cos(a) * r * 1.2, f.y + Math.sin(a) * r * 1.2,
                 f.x - Math.cos(a) * r * 0.4, f.y - Math.sin(a) * r * 0.4, col, 1.0,
              { alpha: 0.35, passes: 2 });
    // Noyau ambre : LE point à viser.
    const fr = cl(f.hp / f.hpMax, 0, 1);
    NEON.dot(c, f.x, f.y, r * (0.20 + fr * 0.14), FAIBLE,
             { alpha: 0.75 + 0.25 * Math.sin(t * 7 + f.rang), glowScale: 1.3 });
    if (fr < 0.999) {
      const pth = new Path2D();
      pth.arc(f.x, f.y, r * 1.55, -Math.PI / 2, -Math.PI / 2 + TAU * fr);
      NEON.custom(c, pth, FAIBLE, 1.8, { alpha: 0.7, cap: 'butt', passes: 2 });
    }
  }

  /* ===========================================================================
   *  14. BOSS 2 — LE SERPENT  (stage 15)
   * -----------------------------------------------------------------------
   *  Un corps articulé de quinze maillons qui ondule à travers l'écran. Un
   *  SEUL maillon est vulnérable à la fois : le dernier de la queue, allumé en
   *  ambre. Les autres renvoient les balles (0,20x) avec une gerbe de
   *  ricochet. On remonte donc le corps maillon par maillon, et la tête —
   *  blindée tant qu'il reste plus de trois maillons — finit par s'ouvrir.
   *      Phase 1  ONDULATION : une onde parcourt le corps, chaque maillon tire.
   *      Phase 2  MORSURE    : le serpent se love et la tête frappe en rafale.
   *      Phase 3  TRAVERSÉE  : il fonce d'un bord à l'autre dans un corridor.
   * ======================================================================== */

  const DEF_SERPENT = {
    nom: 'LE SERPENT',
    sous: 'CHAÎNE VERTÉBRÉE',
    coul: 'enemy.elite',

    init: function () {
      const e = ech(), m = S.memo;
      m.nbSeg = 10;
      m.ecart = 36 * e;
      m.rTete = 34 * e;
      m.rSeg = 24 * e;
      m.vmax = 380;
      m.charge = false;
      m.gueule = 0;           // 0 = mâchoires fermées, 1 = béantes
      m.onde = -1;            // position 0..1 de l'onde le long du corps
      m.hx = larg() / 2;
      m.hy = -m.ecart * 4;

      m.chaine = creerChaine(m.nbSeg + 1, m.ecart, m.hx, m.hy);

      const pvTete = Infinity;                 // la tête ne meurt pas : la
      const pvSeg = S.hpMax * 0.050;           // réserve globale décide.
      ajouterPart('tete', 'tete', 0, 0, m.rTete, pvTete,
                  { abs: true, vulnerable: false, armure: 0.55 });
      for (let i = 0; i < m.nbSeg; i++) {
        // 0.28 : assez sourd pour que viser la lumière reste LE bon geste,
        // assez ouvert pour qu'un joueur qui arrose ne soit jamais bloqué.
        ajouterPart('seg' + i, 'segment', 0, 0, m.rSeg, pvSeg,
                    { abs: true, rang: i, vulnerable: false, armure: 0.28 });
      }
      S.x = m.hx; S.y = m.hy;
    },

    /** Bascule de phase : le serpent ne « repousse » pas, il se raidit.
     *  On remet simplement les maillons restants à pleine énergie. */
    reconstruire: function () {
      const segs = partsDe('segment');
      for (let i = 0; i < segs.length; i++) segs[i].hp = segs[i].hpMax;
    },

    update: function (dt) {
      const m = S.memo, e = ech(), W = larg(), H = haut();

      /* ---- cible de la tête, selon la phase ------------------------------ */
      let tx, ty;
      if (m.charge) {
        tx = m.chX; ty = m.chY;
        m.vmax = 980 + S.menace * 40;
      } else if (S.phase === 1) {
        tx = W / 2 + Math.sin(S.t * 0.52) * W * 0.40;
        ty = H * 0.25 + Math.sin(S.t * 1.15) * H * 0.085;
        m.vmax = 350 + S.menace * 18;
      } else if (S.phase === 2) {
        const cx = W / 2 + Math.sin(S.t * 0.21) * W * 0.16;
        const cy = H * 0.31;
        const r = W * (0.15 + 0.05 * Math.sin(S.t * 0.47));
        const a = S.t * 1.45;
        tx = cx + Math.cos(a) * r;
        ty = cy + Math.sin(a) * r * 0.55;
        m.vmax = 455 + S.menace * 22;
      } else {
        // Rond de piste : il patrouille le pourtour, prêt à traverser.
        const a = S.t * 0.62;
        tx = W / 2 + Math.cos(a) * W * 0.40;
        ty = H * 0.30 + Math.sin(a * 1.6) * H * 0.16;
        m.vmax = 540 + S.menace * 26;
      }

      /* ---- pilotage : cap tenu à vitesse plafonnée (jamais de saut) ------ */
      const dx = tx - m.hx, dy = ty - m.hy;
      const d = Math.hypot(dx, dy);
      if (d > 0.5) {
        const pas = Math.min(d, m.vmax * dt);
        m.hx += dx / d * pas;
        m.hy += dy / d * pas;
      }
      m.hx = cl(m.hx, -m.ecart * 2, W + m.ecart * 2);
      m.hy = cl(m.hy, -m.ecart * 2, H * 0.80);

      suivreChaine(m.chaine, m.hx, m.hy);

      // Fin de traversée : arrivé au bout, il redevient libre.
      if (m.charge && (d < 40 || S.t > m.chargeFin)) m.charge = false;

      /* ---- report de la chaîne sur les pièces --------------------------- */
      const seg = m.chaine.seg;
      const tete = part('tete');
      if (tete) { tete.x = seg[0].x; tete.y = seg[0].y; tete.angle = seg[0].a; }
      S.x = seg[0].x; S.y = seg[0].y;

      const segs = partsDe('segment');
      for (let i = 0; i < segs.length; i++) {
        const n = seg[i + 1];
        if (!n) continue;
        segs[i].x = n.x; segs[i].y = n.y; segs[i].angle = n.a;
        // Seuls les TROIS derniers maillons vivants sont ouverts : une
        // cible unique était trop avare quand la queue fouettait vite.
        segs[i].vulnerable = (i >= segs.length - 3);
      }
      if (tete) tete.vulnerable = (segs.length <= 4) || m.gueule > 0.8;

      /* ---- mâchoires ----------------------------------------------------- */
      const veut = (S.att && S.att.nom === 'morsure') ? (S.att.etat === 'tele' ? S.att.k : 1) : 0.12;
      m.gueule = damp2(m.gueule, veut, 0.02, dt);

      /* ---- onde le long du corps (télégraphie de la phase 1) ------------- */
      if (m.onde >= 0) {
        m.onde += dt * 1.5;
        if (m.onde > 1.4) m.onde = -1;
      }

      /* ---- attaques ------------------------------------------------------ */
      const etat = avancerAttaque(dt, onTirSerpent);
      if (etat === 'fin' || etat === 'libre') programmerSerpent();
    },

    dessiner: function (c) { dessinerSerpent(c); }
  };

  function programmerSerpent() {
    const m = S.memo;
    const nSeg = compter('segment');

    if (S.phase === 1) {
      const nom = choisir([['onde', 1.0], ['crachat', 0.45]]);
      if (nom === 'onde') {
        m.onde = 0;
        lancerAttaque('onde', 0.75, 0.9, 1.5, Math.max(1, nSeg), 0.055);
      } else {
        lancerAttaque('crachat', 0.60, 0.7, 1.3, 9, 0.07);
      }

    } else if (S.phase === 2) {
      const nom = choisir([['morsure', 1.0], ['onde', 0.5], ['crachat', 0.6]]);
      if (nom === 'morsure') lancerAttaque('morsure', 0.80, 0.55, 1.1, 3, 0.13);
      else if (nom === 'onde') { m.onde = 0; lancerAttaque('onde', 0.70, 0.8, 1.2, Math.max(1, nSeg), 0.05); }
      else lancerAttaque('crachat', 0.55, 0.9, 1.0, 13, 0.06);

    } else {
      const nom = choisir([['traversee', 1.0], ['morsure', 0.7], ['crachat', 0.55]]);
      if (nom === 'traversee') {
        const a = lancerAttaque('traversee', 1.05, 1.30, 0.8, 1, 0);
        const W = larg(), H = haut();
        const p = joueur();
        const gauche = (m.hx > W / 2);
        a.memo.x0 = gauche ? W + 60 : -60;
        a.memo.x1 = gauche ? -60 : W + 60;
        a.memo.y = cl(p.y - H * 0.10, H * 0.22, H * 0.72);
        evt('divealert', {});
      } else if (nom === 'morsure') {
        lancerAttaque('morsure', 0.70, 0.5, 0.9, 4, 0.11);
      } else {
        lancerAttaque('crachat', 0.50, 1.0, 0.9, 15, 0.055);
      }
    }
  }

  function onTirSerpent(i, a) {
    const m = S.memo;
    const segs = partsDe('segment');
    const tete = part('tete');
    const hx = tete ? tete.x : S.x, hy = tete ? tete.y : S.y;

    if (a.nom === 'onde') {
      // L'onde remonte le corps : le maillon `i` tire quand elle l'atteint.
      const s = segs[i % Math.max(1, segs.length)];
      if (!s) return;
      const ang = Math.PI / 2 + Math.sin(s.rang * 0.9 + S.t) * 0.55;
      tirer(s.x, s.y, ang, 340, 'normal', { width: 5, height: 14 });
      s.flash = Math.max(s.flash, 0.35);
      if (i % 3 === 0) evt('enemyShot', { type: 'normal' });

    } else if (a.nom === 'crachat') {
      // Spirale crachée par la gueule : lisible parce qu'elle est RÉGULIÈRE.
      const base = (a.memo.base == null) ? (a.memo.base = viser(hx, hy)) : a.memo.base;
      const ang = base + i * 0.55 * (a.memo.sens || (a.memo.sens = Math.random() < 0.5 ? 1 : -1));
      tirer(hx, hy, ang, 360, 'fast', { width: 5, height: 14 });
      if (i % 3 === 0) evt('enemyShot', { type: 'fast' });

    } else if (a.nom === 'morsure') {
      const ang = viser(hx, hy) + (i - 1) * 0.10;
      tirer(hx, hy, ang, 470, 'shooter', { width: 6, height: 18 });
      evt('enemyShot', { type: 'shooter' });
      secousse(0.08);

    } else if (a.nom === 'traversee') {
      m.charge = true;
      m.chargeFin = S.t + 2.2;
      m.hx = a.memo.x0;
      m.hy = a.memo.y;
      m.chX = a.memo.x1;
      m.chY = a.memo.y;
      // Le corps est téléporté avec la tête, sinon il se déplierait en travers.
      const seg = m.chaine.seg;
      const dir = (a.memo.x1 > a.memo.x0) ? -1 : 1;
      for (let j = 0; j < seg.length; j++) {
        seg[j].x = a.memo.x0 + dir * j * m.ecart;
        seg[j].y = a.memo.y;
        seg[j].a = dir > 0 ? Math.PI : 0;
      }
      juice('enemyHit', 1.3);
      secousse(0.3);
      evt('ramKill', { type: 'elite' });
    }
  }

  function dessinerSerpent(c) {
    const m = S.memo, e = ech(), t = tps();
    const seg = m.chaine.seg;
    const segs = partsDe('segment');
    const tete = part('tete');
    const colBase = S.flash > 0.02 ? 'shock' : S.coul;

    /* --- colonne : une polyligne qui relie tout le corps ------------------ */
    const plat = [];
    for (let i = 0; i < segs.length + 1 && i < seg.length; i++) plat.push(seg[i].x, seg[i].y);
    if (plat.length >= 4) {
      NEON.polyline(c, plat, colBase, 5.5 * e, { alpha: 0.30, glowScale: 1.4, passes: 3 });
      NEON.polyline(c, plat, colBase, 1.6 * e, { alpha: 0.65, passes: 2 });
    }

    /* --- traînée : le sillage du corps grave le trajet ------------------- */
    const tr = trail();
    if (tr && plat.length >= 4) {
      NEON.polyline(tr, plat, colBase, 3.2 * e, { alpha: 0.16, passes: 2 });
    }

    /* --- maillons -------------------------------------------------------- */
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const ouvert = s.vulnerable;
      const col = s.flash > 0.02 ? 'shock' : (ouvert ? FAIBLE : colBase);
      const a = s.angle;
      const r = s.r * (ouvert ? 1.06 : 1) * (1 + Math.sin(t * 4 - i * 0.5) * 0.04);

      // Anneau vertébral, écrasé dans l'axe du corps.
      const pts = [];
      for (let k = 0; k < 6; k++) {
        const ang = a + Math.PI / 2 + k * TAU / 6;
        pts.push(s.x + Math.cos(ang) * r * (k % 2 ? 0.72 : 1),
                 s.y + Math.sin(ang) * r * (k % 2 ? 0.72 : 1));
      }
      NEON.shape(c, pts, col, ouvert ? 2.2 : 1.6, {
        alpha: ouvert ? 1 : 0.62, fill: true,
        fillAlpha: ouvert ? 0.26 : 0.08, glowScale: ouvert ? 1.4 : 0.85,
        passes: ouvert ? 4 : 2
      });

      // Ailerons : ils donnent le sens de la marche.
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const ang = a + Math.PI / 2 * sgn;
        NEON.line(c, s.x + Math.cos(ang) * r * 0.7, s.y + Math.sin(ang) * r * 0.7,
                     s.x + Math.cos(ang) * r * 1.6 - Math.cos(a) * r * 0.5,
                     s.y + Math.sin(ang) * r * 1.6 - Math.sin(a) * r * 0.5,
                  col, 1.4, { alpha: ouvert ? 0.75 : 0.30, passes: 2 });
      }

      if (ouvert) {
        // LE point à viser : noyau ambre + anneau de vie.
        const f = cl(s.hp / s.hpMax, 0, 1);
        NEON.dot(c, s.x, s.y, r * 0.34, FAIBLE,
                 { alpha: 0.85 + 0.15 * Math.sin(t * 9), glowScale: 1.6 });
        const pth = new Path2D();
        pth.arc(s.x, s.y, r * 1.35, -Math.PI / 2, -Math.PI / 2 + TAU * f);
        NEON.custom(c, pth, FAIBLE, 2.0, { alpha: 0.8, cap: 'butt', passes: 3 });
      } else {
        // Plaque de blindage : sombre, mate, elle DIT « ça ricoche ».
        NEON.line(c, s.x + Math.cos(a) * r * 0.6, s.y + Math.sin(a) * r * 0.6,
                     s.x - Math.cos(a) * r * 0.6, s.y - Math.sin(a) * r * 0.6,
                  colBase, 1.1, { alpha: 0.28, passes: 2 });
      }

      // Onde de télégraphie qui remonte le corps.
      if (m.onde >= 0) {
        const u = cl(1 - Math.abs((i / Math.max(1, segs.length)) - m.onde) * 5, 0, 1);
        if (u > 0.01) {
          NEON.ring(c, s.x, s.y, r * (1.3 + u * 0.8), 2.0, DANGER,
                    { alpha: u * 0.75, passes: 3 });
        }
      }
    }

    /* --- tête ------------------------------------------------------------- */
    if (tete) {
      const a = tete.angle;
      const r = tete.r;
      const ouvert = tete.vulnerable;
      const col = tete.flash > 0.02 ? 'shock' : colBase;
      const g = m.gueule;

      // Museau : un fer de lance.
      NEON.shape(c, [
        tete.x + Math.cos(a) * r * 1.7, tete.y + Math.sin(a) * r * 1.7,
        tete.x + Math.cos(a + 2.1) * r * 1.15, tete.y + Math.sin(a + 2.1) * r * 1.15,
        tete.x - Math.cos(a) * r * 0.85, tete.y - Math.sin(a) * r * 0.85,
        tete.x + Math.cos(a - 2.1) * r * 1.15, tete.y + Math.sin(a - 2.1) * r * 1.15
      ], col, 2.8, { alpha: 1, fill: true, fillAlpha: 0.16, glowScale: 1.35, passes: 4 });

      // Mâchoires : deux mandibules qui s'écartent avant de mordre.
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const ang = a + sgn * (0.30 + g * 0.62);
        NEON.polyline(c, [
          tete.x + Math.cos(a) * r * 0.4, tete.y + Math.sin(a) * r * 0.4,
          tete.x + Math.cos(ang) * r * 1.5, tete.y + Math.sin(ang) * r * 1.5,
          tete.x + Math.cos(ang + sgn * 0.35) * r * 2.2, tete.y + Math.sin(ang + sgn * 0.35) * r * 2.2
        ], g > 0.5 ? DANGER : col, 2.0, { alpha: 0.55 + g * 0.45, glowScale: 1.2, passes: 3 });
      }

      // Yeux : deux points faibles quand la tête s'ouvre, sinon deux fentes.
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const ang = a + sgn * 0.72;
        const ex = tete.x + Math.cos(ang) * r * 0.72;
        const ey = tete.y + Math.sin(ang) * r * 0.72;
        if (ouvert) {
          NEON.dot(c, ex, ey, r * 0.20, FAIBLE,
                   { alpha: 0.8 + 0.2 * Math.sin(t * 8 + sgn), glowScale: 1.6 });
        } else {
          NEON.line(c, ex - Math.cos(a) * r * 0.22, ey - Math.sin(a) * r * 0.22,
                       ex + Math.cos(a) * r * 0.22, ey + Math.sin(a) * r * 0.22,
                    col, 1.6, { alpha: 0.55, passes: 2 });
        }
      }

      // Blindage crânien : un arc qui s'efface quand les maillons tombent.
      if (!ouvert) {
        const nSeg = segs.length;
        const dens = cl(nSeg / 6, 0, 1);
        NEON.ring(c, tete.x, tete.y, r * 1.75, 2.2, colBase, {
          alpha: 0.18 + dens * 0.30,
          dash: [Math.max(3, 4 + dens * 12), Math.max(5, 16 - dens * 8)],
          dashOffset: -t * 60, passes: 3
        });
      } else {
        NEON.ring(c, tete.x, tete.y, r * (1.9 + Math.sin(t * 5) * 0.12), 1.8, FAIBLE,
                  { alpha: 0.45, passes: 3 });
      }
    }

    /* --- télégraphies ---------------------------------------------------- */
    const at = S.att;
    if (at && at.nom && at.etat === 'tele' && tete) {
      if (at.nom === 'morsure') {
        const ang = viser(tete.x, tete.y);
        teleLigne(c, tete.x, tete.y,
                  tete.x + Math.cos(ang) * (larg() + haut()),
                  tete.y + Math.sin(ang) * (larg() + haut()), at.k, DANGER, 2.0);
        teleCharge(c, tete.x, tete.y, tete.r * 0.6, at.k, DANGER);

      } else if (at.nom === 'crachat') {
        const base = viser(tete.x, tete.y);
        teleEventail(c, tete.x, tete.y, base + 1.2, 5, 2.4, haut() * 0.4, at.k, DANGER);

      } else if (at.nom === 'traversee') {
        teleCorridor(c, at.memo.x0, at.memo.y, at.memo.x1, at.memo.y,
                     (m.rSeg + 8 * e), at.k, DANGER);
        teleAlerte(c, larg() * 0.5, at.memo.y - m.rSeg * 2.4, at.k, DANGER);

      } else if (at.nom === 'onde') {
        // L'onde de charge remonte déjà le corps : on la double d'un liseré.
        for (let i = 0; i < segs.length; i++) {
          teleCharge(c, segs[i].x, segs[i].y, segs[i].r * 0.35,
                     cl(at.k * 1.4 - i * 0.03, 0, 1), DANGER);
        }
      }
    }
  }

  /* ===========================================================================
   *  15. BOSS 3 — LE CŒUR  (stage 20, boss final)
   * -----------------------------------------------------------------------
   *  Il recombine les trois précédents, une mécanique par phase, et il BAT :
   *  toute la mise en scène est calée sur un battement dont la fréquence monte
   *  à mesure qu'il s'affaiblit. Le joueur entend et voit l'agonie arriver.
   *      Phase 1  SYSTOLE  — la Ruche  : quatre valves lâchent l'essaim.
   *      Phase 2  DIASTOLE — le Prisme : quatre éclats orbitent, rayons réfléchis.
   *      Phase 3  ARRÊT    — le Serpent : deux tentacules fouettent, cœur béant.
   * ======================================================================== */

  const DEF_COEUR = {
    nom: 'LE CŒUR',
    sous: 'ORGANE TERMINAL',

    init: function () {
      const e = ech(), m = S.memo;
      m.r = 82 * e;
      m.rNoyau = 30 * e;
      m.rValve = 108 * e;
      m.batt = 0;             // phase du battement, 0..1
      m.pulse = 0;            // 0..1, éclat au moment du battement
      m.rot = 0;
      m.ouvert = 0;           // 0 = cœur clos, 1 = béant (point faible offert)
      m.fenetre = 0;          // secondes restantes d'ouverture en phase 1/2
      m.prochaineFenetre = 7;
      m.rayonOrbite = 150 * e;
      m.tentacules = [];

      ajouterPart('coque', 'coque', 0, 0, m.r, Infinity);
      ajouterPart('noyau', 'faible', 0, 0, m.rNoyau, Infinity,
                  { vulnerable: false, armure: 0.22 });
      construireValves();

      S.x = larg() / 2;
      S.y = -m.r * 2;
    },

    reconstruire: function () {
      const m = S.memo;
      construireValves();
      retirerParts('fragment');
      m.tentacules.length = 0;

      if (S.phase === 2) {
        // DIASTOLE : les éclats du Prisme se détachent du muscle.
        for (let i = 0; i < 4; i++) {
          ajouterPart('frag' + i, 'fragment', 0, 0, 26 * ech(), S.hpMax * 0.055,
                      { rang: i });
        }
      } else if (S.phase === 3) {
        // ARRÊT : deux tentacules sortent du cœur, le noyau ne se referme plus.
        for (let i = 0; i < 2; i++) m.tentacules.push(creerTentacule(i === 0 ? -1 : 1));
      }
    },

    update: function (dt) {
      const m = S.memo, e = ech(), W = larg(), H = haut();

      /* ---- vol : une dérive lente, il n'a pas besoin de fuir ------------- */
      S.x = W / 2 + Math.sin(S.t * 0.27) * Math.max(20, W * 0.5 - m.rValve - 60 * e) * 0.7;
      S.y = H * 0.28 + Math.sin(S.t * 0.44) * H * 0.035;
      m.rot += dt * (0.28 + S.phase * 0.14);

      /* ---- LE BATTEMENT : l'horloge du combat --------------------------- */
      const f = cl(S.hp / Math.max(1, S.hpMax), 0, 1);
      const bpm = 52 + (1 - f) * 78 + (S.menace - 1) * 6;   // 52 -> 130 bpm
      const avant = m.batt;
      m.batt = (m.batt + dt * bpm / 60) % 1;
      if (m.batt < avant) {
        m.pulse = 1;
        secousse(0.05 + (1 - f) * 0.05);
        evt('enemyHit', { type: 'elite' });
      }
      m.pulse = Math.max(0, m.pulse - dt * 3.2);

      /* ---- fenêtre d'ouverture du noyau (phases 1 et 2) ------------------ */
      const noy = part('noyau');
      if (S.phase >= 3) {
        m.fenetre = 999;
      } else {
        m.prochaineFenetre -= dt;
        if (m.prochaineFenetre <= 0 && m.fenetre <= 0) {
          m.fenetre = 2.4;
          m.prochaineFenetre = 8.5 / S.multCadence;
          onde(S.x, S.y, FAIBLE, 2.0);
          voile(css(FAIBLE), 200, 0.16);
          evt('divealert', {});
        }
        if (m.fenetre > 0) m.fenetre -= dt;
      }
      const offert = (m.fenetre > 0);
      if (noy) { noy.vulnerable = offert; }
      m.ouvert = damp2(m.ouvert, offert ? 1 : 0, 0.03, dt);

      /* ---- éclats orbitants (phase 2) ------------------------------------ */
      const frags = partsDe('fragment');
      if (frags.length) {
        m.rayonOrbite = damp2(m.rayonOrbite, 165 * e, 0.06, dt);
        for (let i = 0; i < frags.length; i++) {
          const fr = frags[i];
          const a = m.rot * 2.1 + fr.rang * TAU / 4;
          fr.ox = Math.cos(a) * m.rayonOrbite;
          fr.oy = Math.sin(a) * m.rayonOrbite * 0.68;
          fr.angle = a + Math.PI / 2;
        }
      }

      /* ---- tentacules (phase 3) ------------------------------------------ */
      for (let i = 0; i < m.tentacules.length; i++) majTentacule(m.tentacules[i], dt);

      /* ---- attaques ------------------------------------------------------ */
      const etat = avancerAttaque(dt, onTirCoeur);
      if (etat === 'fin' || etat === 'libre') programmerCoeur();
    },

    dessiner: function (c) { dessinerCoeur(c); }
  };

  function construireValves() {
    const m = S.memo;
    retirerParts('faible');
    ajouterPart('noyau', 'faible', 0, 0, m.rNoyau, Infinity,
                { vulnerable: false, armure: 0.22 });
    const pv = S.hpMax * 0.042;
    for (let i = 0; i < 4; i++) {
      const a = i * TAU / 4 + Math.PI / 4;
      ajouterPart('valve' + i, 'faible', Math.cos(a) * m.rValve, Math.sin(a) * m.rValve * 0.78,
                  m.r * 0.30, pv, { rang: i, pondu: 0 });
    }
  }

  /* --- tentacules : corde paramétrique, zéro intégration, zéro dérive ----- */
  function creerTentacule(cote) {
    const e = ech();
    return {
      cote: cote,
      n: 10,
      ecart: 26 * e,
      r: 12 * e,
      base: cote > 0 ? 0.55 : Math.PI - 0.55,   // orientation de départ
      cible: cote > 0 ? 0.55 : Math.PI - 0.55,
      amp: 0.42,
      fouet: 0,
      pts: []
    };
  }

  function majTentacule(tn, dt) {
    const m = S.memo, t = tps();
    const p = joueur();
    const ancX = S.x + tn.cote * m.r * 0.72;
    const ancY = S.y + m.r * 0.35;

    // Pendant un fouet, la corde se tend vers le joueur ; sinon elle ondule.
    if (tn.fouet > 0) {
      tn.fouet -= dt;
      tn.cible = Math.atan2(p.y - ancY, p.x - ancX);
      tn.amp = damp2(tn.amp, 0.08, 0.02, dt);
    } else {
      tn.cible = (tn.cote > 0 ? 0.75 : Math.PI - 0.75) + Math.sin(t * 0.9 + tn.cote) * 0.35;
      tn.amp = damp2(tn.amp, 0.42, 0.08, dt);
    }
    tn.base = damp2(tn.base, tn.cible, 0.02, dt);

    tn.pts.length = 0;
    let x = ancX, y = ancY;
    tn.pts.push({ x: x, y: y });
    for (let j = 1; j < tn.n; j++) {
      const u = j / (tn.n - 1);
      const a = tn.base + Math.sin(t * 3.1 + u * 4.4 + tn.cote * 2) * tn.amp * (0.35 + u);
      x += Math.cos(a) * tn.ecart;
      y += Math.sin(a) * tn.ecart;
      tn.pts.push({ x: x, y: y });
    }
  }

  function programmerCoeur() {
    const m = S.memo;
    const val = compter('faible');

    if (S.phase === 1) {
      const nom = choisir([['essaim', val > 1 ? 1.0 : 0], ['eventail', 0.8], ['dard', 0.5]]);
      if (nom === 'essaim') lancerAttaque('essaim', 1.00, 0.7, 2.0, 4, 0.10);
      else if (nom === 'eventail') lancerAttaque('eventail', 0.80, 0.6, 1.4, 3, 0.18);
      else lancerAttaque('dard', 0.45, 0.35, 0.9, 4, 0.10);

    } else if (S.phase === 2) {
      const frags = partsDe('fragment');
      const nom = choisir([['reflexion', frags.length ? 1.0 : 0], ['anneau', 0.8],
                           ['esquilles', frags.length ? 0.6 : 0], ['eventail', 0.5]]);
      if (nom === 'reflexion') {
        const a = lancerAttaque('reflexion', 0.90, 1.2, 1.3, Math.min(2, frags.length), 0.40);
        a.memo.paires = [];
        for (let i = 0; i < a.nb; i++) {
          const f1 = frags[i % frags.length];
          const f2 = frags.length > 1 ? frags[(i + 2) % frags.length] : null;
          a.memo.paires.push({ f1: f1, f2: (f2 === f1 ? null : f2) });
        }
      } else if (nom === 'anneau') lancerAttaque('anneau', 0.75, 0.9, 1.3, 3, 0.24);
      else if (nom === 'esquilles') lancerAttaque('esquilles', 0.50, 0.5, 1.0, 4, 0.13);
      else lancerAttaque('eventail', 0.70, 0.6, 1.1, 4, 0.15);

    } else {
      const nom = choisir([['fouet', 1.0], ['spirale', 0.9], ['anneau', 0.7],
                           ['essaim', val > 1 ? 0.5 : 0]]);
      if (nom === 'fouet') lancerAttaque('fouet', 0.95, 1.30, 1.0, 1, 0);
      else if (nom === 'spirale') lancerAttaque('spirale', 0.70, 1.60, 1.1, 26, 0.06);
      else if (nom === 'anneau') lancerAttaque('anneau', 0.60, 1.0, 1.0, 4, 0.22);
      else lancerAttaque('essaim', 0.85, 0.6, 1.4, 5, 0.09);
    }
  }

  function onTirCoeur(i, a) {
    const m = S.memo;
    const val = partsDe('faible');
    const sources = [];
    for (let j = 0; j < val.length; j++) if (val[j].id !== 'noyau') sources.push(val[j]);

    if (a.nom === 'essaim') {
      if (!sources.length) return;
      const s = sources[i % sources.length];
      lacherDrone(s.x, s.y, Math.atan2(s.oy, s.ox), S.coul);
      s.pondu = 0.35;
      evt('enemyShot', { type: 'normal' });

    } else if (a.nom === 'dard') {
      const s = sources.length ? sources[i % sources.length] : { x: S.x, y: S.y };
      tirer(s.x, s.y, viser(s.x, s.y), 430, 'shooter', { width: 6, height: 18 });
      evt('enemyShot', { type: 'shooter' });

    } else if (a.nom === 'eventail') {
      const nb = 11 + S.phase * 2 + S.bonusBalles * 2;
      eventail(S.x, S.y + m.r * 0.5, Math.PI / 2 + Math.sin(S.t + i) * 0.2, nb,
               1.35 + i * 0.08, 340 + i * 16, 'normal');
      evt('enemyShot', { type: 'shooter' });
      secousse(0.10);

    } else if (a.nom === 'anneau') {
      // Couronne complète, décalée d'un cran à chaque tour : les intervalles
      // tournent, le joueur doit lire la rotation et non mémoriser un trou.
      const nb = 16 + S.bonusBalles * 2;
      anneau(S.x, S.y, nb, 300 + i * 22, 'normal', m.rot * 1.7 + i * (TAU / nb) * 0.5);
      evt('enemyShot', { type: 'normal' });
      secousse(0.12);
      gel(14);

    } else if (a.nom === 'esquilles') {
      const frags = partsDe('fragment');
      for (let j = 0; j < frags.length; j++) {
        tirer(frags[j].x, frags[j].y, viser(frags[j].x, frags[j].y), 390, 'shooter');
      }
      evt('enemyShot', { type: 'shooter' });

    } else if (a.nom === 'reflexion') {
      const pr = a.memo.paires && a.memo.paires[i];
      const L = larg() + haut();
      if (pr && pr.f1 && pr.f1.vivant) {
        creerRayon(cheminReflechi(pr.f1, pr.f2 && pr.f2.vivant ? pr.f2 : null),
                   0.05, 0.45, DANGER, 6 * ech());
      } else {
        const ang = viser(S.x, S.y);
        creerRayon([{ x: S.x, y: S.y },
                    { x: S.x + Math.cos(ang) * L, y: S.y + Math.sin(ang) * L }],
                   0.25, 0.40, DANGER, 6 * ech());
      }
      secousse(0.16);

    } else if (a.nom === 'spirale') {
      // Deux bras opposés : une spirale seule se contourne trop vite.
      const base = (a.memo.base == null)
        ? (a.memo.base = viser(S.x, S.y))
        : a.memo.base;
      const sens = a.memo.sens || (a.memo.sens = Math.random() < 0.5 ? 1 : -1);
      const ang = base + i * 0.42 * sens;
      tirer(S.x, S.y, ang, 330, 'fast', { width: 5, height: 14 });
      tirer(S.x, S.y, ang + Math.PI, 330, 'fast', { width: 5, height: 14 });
      if (i % 4 === 0) evt('enemyShot', { type: 'fast' });

    } else if (a.nom === 'fouet') {
      for (let j = 0; j < m.tentacules.length; j++) m.tentacules[j].fouet = 1.25;
      juice('enemyHit', 1.2);
      secousse(0.24);
      evt('ramKill', { type: 'elite' });
    }
  }

  function dessinerCoeur(c) {
    const m = S.memo, e = ech(), t = tps();
    const col = S.flash > 0.02 ? 'shock' : S.coul;
    const batt = 1 + Math.pow(m.pulse, 2) * 0.13 + Math.sin(m.batt * TAU) * 0.025;
    const r = m.r * batt;

    /* --- onde de battement : elle part du cœur à chaque contraction ------ */
    if (m.pulse > 0.02) {
      NEON.ring(c, S.x, S.y, r * (1.15 + (1 - m.pulse) * 2.6), 2.4, col,
                { alpha: m.pulse * 0.45, passes: 3 });
    }

    /* --- tentacules (phase 3), dessinés SOUS le corps -------------------- */
    for (let i = 0; i < m.tentacules.length; i++) dessinerTentacule(c, m.tentacules[i], t);

    /* --- couronne d'orbite ----------------------------------------------- */
    const frags = partsDe('fragment');
    for (let i = 0; i < frags.length; i++) {
      NEON.line(c, S.x, S.y, frags[i].x, frags[i].y, col, 1.1,
                { alpha: 0.12 + 0.14 * Math.sin(t * 3 - i), dash: [3, 9], dashOffset: -t * 70, passes: 2 });
      dessinerFragment(c, frags[i], t);
    }

    /* --- anneaux du muscle : trois cerceaux à vitesses distinctes -------- */
    for (let i = 0; i < 3; i++) {
      const rr2 = r * (1.22 + i * 0.26);
      NEON.ring(c, S.x, S.y, rr2, 1.6 - i * 0.3, col, {
        alpha: 0.30 - i * 0.07,
        dash: [10 + i * 8, 12 + i * 6],
        dashOffset: (i % 2 ? 1 : -1) * t * (40 + i * 26),
        passes: 2
      });
    }

    /* --- corps : rosace à huit lobes, gonflée par le battement ----------- */
    NEON.shape(c, etoile(S.x, S.y, r, r * 0.74, 8, m.rot), col, 2.8, {
      alpha: 1, fill: true, fillAlpha: 0.13 + m.pulse * 0.10, glowScale: 1.3 + m.pulse * 0.5, passes: 4
    });
    NEON.shape(c, etoile(S.x, S.y, r * 0.72, r * 0.50, 8, -m.rot * 1.4), col, 1.7,
               { alpha: 0.55, passes: 3 });

    /* --- ventricules : quatre nervures qui pulsent en décalé ------------- */
    for (let i = 0; i < 4; i++) {
      const a = m.rot + i * TAU / 4 + Math.PI / 4;
      const u = 0.5 + 0.5 * Math.sin(m.batt * TAU - i * 0.5);
      NEON.line(c, S.x + Math.cos(a) * r * 0.30, S.y + Math.sin(a) * r * 0.30,
                   S.x + Math.cos(a) * r * (0.95 + u * 0.12),
                   S.y + Math.sin(a) * r * (0.95 + u * 0.12),
                col, 2.0, { alpha: 0.30 + u * 0.40, passes: 3 });
    }

    /* --- noyau : le point faible ultime, scellé puis béant --------------- */
    const noy = part('noyau');
    if (noy) {
      const ouv = m.ouvert;
      const rn = m.rNoyau * (0.55 + ouv * 0.85) * batt;
      const colN = noy.flash > 0.02 ? 'shock' : (noy.vulnerable ? FAIBLE : col);
      // Volets qui se rétractent : l'ouverture est MÉCANIQUE, donc lisible.
      for (let i = 0; i < 4; i++) {
        const a = m.rot * -0.7 + i * TAU / 4;
        const d = m.rNoyau * (1.0 + ouv * 1.5);
        NEON.polyline(c, [
          S.x + Math.cos(a - 0.5) * d, S.y + Math.sin(a - 0.5) * d,
          S.x + Math.cos(a) * d * 1.45, S.y + Math.sin(a) * d * 1.45,
          S.x + Math.cos(a + 0.5) * d, S.y + Math.sin(a + 0.5) * d
        ], col, 1.6, { alpha: 0.35 + ouv * 0.35, passes: 2 });
      }
      NEON.shape(c, poly(S.x, S.y, rn, 6, m.rot * 2), colN, 2.2, {
        alpha: 0.5 + ouv * 0.5, fill: true, fillAlpha: 0.22 + ouv * 0.45,
        glowScale: 1.2 + ouv, passes: 4
      });
      if (ouv > 0.25) {
        NEON.dot(c, S.x, S.y, rn * 0.5, FAIBLE, { alpha: ouv, glowScale: 2 });
        NEON.ring(c, S.x, S.y, rn * (1.8 + Math.sin(t * 6) * 0.2), 1.6, FAIBLE,
                  { alpha: ouv * 0.55, passes: 3 });
      }
    }

    /* --- valves : quatre points faibles ambre en périphérie -------------- */
    for (let i = 0; i < S.parts.length; i++) {
      const p = S.parts[i];
      if (p.kind !== 'faible' || p.id === 'noyau') continue;
      dessinerValve(c, p, t);
    }

    /* --- télégraphies ---------------------------------------------------- */
    const a = S.att;
    if (a && a.nom && a.etat === 'tele') {
      const val = [];
      for (let i = 0; i < S.parts.length; i++) {
        if (S.parts[i].kind === 'faible' && S.parts[i].id !== 'noyau' && S.parts[i].vivant) val.push(S.parts[i]);
      }
      if (a.nom === 'essaim') {
        for (let i = 0; i < val.length; i++) teleCharge(c, val[i].x, val[i].y, val[i].r * 0.9, a.k, S.coul);
      } else if (a.nom === 'dard') {
        for (let i = 0; i < val.length; i++) {
          const ang = viser(val[i].x, val[i].y);
          teleLigne(c, val[i].x, val[i].y, val[i].x + Math.cos(ang) * haut(),
                    val[i].y + Math.sin(ang) * haut(), a.k, DANGER, 1.4);
        }
      } else if (a.nom === 'eventail') {
        teleEventail(c, S.x, S.y + m.r * 0.5, Math.PI / 2, 11 + S.phase * 2,
                     1.35, haut() * 0.55, a.k, DANGER);
      } else if (a.nom === 'anneau' || a.nom === 'spirale') {
        const nb = a.nom === 'anneau' ? 16 : 8;
        teleEventail(c, S.x, S.y, m.rot * 1.7, nb, TAU * (nb - 1) / nb, m.r * 3.2, a.k, DANGER);
      } else if (a.nom === 'esquilles') {
        for (let j = 0; j < frags.length; j++) {
          const ang = viser(frags[j].x, frags[j].y);
          teleLigne(c, frags[j].x, frags[j].y, frags[j].x + Math.cos(ang) * haut(),
                    frags[j].y + Math.sin(ang) * haut(), a.k, DANGER, 1.2);
        }
      } else if (a.nom === 'reflexion' && a.memo.paires) {
        for (let i = 0; i < a.memo.paires.length; i++) {
          const pr = a.memo.paires[i];
          if (!pr || !pr.f1 || !pr.f1.vivant) continue;
          const pts = cheminReflechi(pr.f1, pr.f2 && pr.f2.vivant ? pr.f2 : null);
          for (let j = 0; j + 1 < pts.length; j++) {
            teleLigne(c, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y, a.k, DANGER, 1.6);
          }
        }
      } else if (a.nom === 'fouet') {
        const p = joueur();
        for (let i = 0; i < m.tentacules.length; i++) {
          const tn = m.tentacules[i];
          const anc = tn.pts.length ? tn.pts[0] : { x: S.x, y: S.y };
          teleCorridor(c, anc.x, anc.y, p.x, p.y, tn.r * 1.6, a.k, DANGER);
        }
        teleAlerte(c, joueur().x, joueur().y - 46 * e, a.k, DANGER);
      }
    }
  }

  function dessinerTentacule(c, tn, t) {
    if (tn.pts.length < 2) return;
    const plat = [];
    for (let i = 0; i < tn.pts.length; i++) plat.push(tn.pts[i].x, tn.pts[i].y);
    const chaud = tn.fouet > 0;
    const col = chaud ? DANGER : S.coul;
    NEON.polyline(c, plat, col, tn.r * 0.9, { alpha: chaud ? 0.55 : 0.30, glowScale: 1.4, passes: 3 });
    NEON.polyline(c, plat, col, tn.r * 0.24, { alpha: 0.75, passes: 2 });
    for (let i = 1; i < tn.pts.length; i++) {
      const u = i / (tn.pts.length - 1);
      NEON.dot(c, tn.pts[i].x, tn.pts[i].y, tn.r * (0.42 - u * 0.22),
               chaud ? DANGER : S.coul, { alpha: 0.45 + 0.3 * Math.sin(t * 6 - i * 0.6) });
    }
    const bout = tn.pts[tn.pts.length - 1];
    NEON.dot(c, bout.x, bout.y, tn.r * 0.5, chaud ? 'shock' : FAIBLE,
             { alpha: 0.85, glowScale: 1.6 });
  }

  function dessinerValve(c, p, t) {
    const m = S.memo;
    const puls = 0.5 + 0.5 * Math.sin(m.batt * TAU - p.rang * 0.6);
    const r = p.r * (0.88 + puls * 0.16);
    const col = p.flash > 0.02 ? 'shock' : FAIBLE;
    // Conduit qui la relie au muscle : la valve APPARTIENT au cœur.
    NEON.line(c, S.x, S.y, p.x, p.y, S.coul, 2.6 * (0.6 + puls * 0.5),
              { alpha: 0.16 + puls * 0.16, passes: 2 });
    NEON.shape(c, poly(p.x, p.y, r, 5, m.rot * 1.3 + p.rang), col, 2.0, {
      alpha: 0.95, fill: true, fillAlpha: 0.26, glowScale: 1.3, passes: 4
    });
    NEON.dot(c, p.x, p.y, r * 0.34, col, { alpha: 0.9, glowScale: 1.4 });
    const f = cl(p.hp / p.hpMax, 0, 1);
    if (f < 0.999) {
      const pth = new Path2D();
      pth.arc(p.x, p.y, r * 1.5, -Math.PI / 2, -Math.PI / 2 + TAU * f);
      NEON.custom(c, pth, col, 2.0, { alpha: 0.8, cap: 'butt', passes: 3 });
    }
    if (p.pondu > 0) {
      const k = cl(p.pondu / 0.35, 0, 1);
      NEON.ring(c, p.x, p.y, r * (1 + (1 - k) * 2.4), 1.6, col, { alpha: 0.5 * k, passes: 2 });
    }
  }

  /* ===========================================================================
   *  16. BOSS 4 — LA CITADELLE
   * -----------------------------------------------------------------------
   *  Une forteresse large dont les quatre tourelles tournent autour du noyau.
   *  Chaque phase accélère la rotation et transforme la géométrie du barrage.
   * ======================================================================== */

  const DEF_CITADELLE = {
    nom: 'LA CITADELLE',
    sous: 'FORTERESSE ORBITALE',
    coul: 'enemy.shooter',

    init: function () {
      const e = ech(), m = S.memo;
      m.r = 72 * e;
      m.orbite = 132 * e;
      m.rot = 0;
      m.ouverture = 0;
      ajouterPart('cit-coeur', 'coque', 0, 0, m.r, Infinity);
      ajouterPart('cit-aile-g', 'coque', -m.r * 1.15, 0, m.r * 0.55, Infinity);
      ajouterPart('cit-aile-d', 'coque', m.r * 1.15, 0, m.r * 0.55, Infinity);
      construireTourellesCitadelle();
      S.x = larg() / 2;
      S.y = -m.orbite;
    },

    reconstruire: construireTourellesCitadelle,

    update: function (dt) {
      const m = S.memo, W = larg(), H = haut();
      const amp = Math.max(20, W * 0.34 - m.orbite);
      S.x = W / 2 + Math.sin(S.t * (0.28 + S.phase * 0.035)) * amp;
      S.y = H * 0.235 + Math.sin(S.t * 0.72) * 10 * ech();
      S.angle = 0;
      m.rot += dt * (0.28 + S.phase * 0.13) * (S.variant ? 1.15 : 1);
      m.ouverture = damp2(m.ouverture, enTele() ? 1 : 0.15, 0.025, dt);

      const tourelles = partsDe('faible');
      for (let i = 0; i < tourelles.length; i++) {
        const p = tourelles[i];
        const a = m.rot + p.rang * TAU / 4;
        p.ox = Math.cos(a) * m.orbite;
        p.oy = Math.sin(a) * m.orbite * 0.54;
        p.angle = a;
      }

      const etat = avancerAttaque(dt, onTirCitadelle);
      if (etat === 'fin' || etat === 'libre') programmerCitadelle();
    },

    dessiner: dessinerCitadelle
  };

  function construireTourellesCitadelle() {
    const m = S.memo;
    retirerParts('faible');
    const pv = S.hpMax * 0.048;
    for (let i = 0; i < 4; i++) {
      const a = m.rot + i * TAU / 4;
      ajouterPart('cit-t' + i, 'faible', Math.cos(a) * m.orbite,
                  Math.sin(a) * m.orbite * 0.54, m.r * 0.29, pv, { rang: i });
    }
  }

  function programmerCitadelle() {
    let nom;
    if (S.phase === 1) nom = choisir([['bastion', 1], ['verrou', 0.65]]);
    else if (S.phase === 2) nom = choisir([['croix', 1], ['verrou', 0.8], ['bastion', 0.55]]);
    else nom = choisir([['siege', 1], ['croix', 0.85], ['verrou', 0.55]]);

    if (nom === 'bastion') lancerAttaque(nom, 0.80, 0.65, 1.25, 4, 0.16);
    else if (nom === 'verrou') lancerAttaque(nom, 0.68, 0.55, 0.95, 5 + S.phase, 0.12);
    else if (nom === 'croix') lancerAttaque(nom, 0.95, 0.75, 1.15, 3, 0.24);
    else lancerAttaque(nom, 1.15, 1.00, 1.25, 3, 0.28);
  }

  function onTirCitadelle(i, a) {
    const m = S.memo;
    const ts = partsDe('faible');
    const src = ts.length ? ts[i % ts.length] : { x: S.x, y: S.y };
    if (a.nom === 'bastion') {
      eventail(src.x, src.y, Math.PI / 2, 5 + S.phase + S.bonusBalles,
               0.72, 320 + S.phase * 18, 'normal');
    } else if (a.nom === 'verrou') {
      tirer(src.x, src.y, viser(src.x, src.y), 430, 'shooter', { width: 6, height: 18 });
    } else if (a.nom === 'croix') {
      for (let j = 0; j < ts.length; j++) {
        const ang = viser(ts[j].x, ts[j].y) + (i - 1) * 0.12;
        eventail(ts[j].x, ts[j].y, ang, 3 + S.bonusBalles, 0.30, 350, 'fast');
      }
    } else if (a.nom === 'siege') {
      const n = 14 + S.bonusBalles * 2;
      anneau(S.x, S.y, n, 285 + i * 24, 'normal', m.rot + i * TAU / (n * 2));
      if (i === 1 && S.variant > 0) {
        for (let j = 0; j < ts.length; j++) lacherDrone(ts[j].x, ts[j].y, Math.PI / 2, S.coul);
      }
    }
    evt('enemyShot', { type: a.nom === 'verrou' ? 'shooter' : 'elite' });
    secousse(a.nom === 'siege' ? 0.16 : 0.07);
  }

  function dessinerCitadelle(c) {
    const m = S.memo, t = tps();
    const col = S.flash > 0.02 ? 'shock' : S.coul;
    const ts = partsDe('faible');

    // Bras et grande silhouette d'abord : la forteresse se lit comme un seul
    // objet, même lorsque ses tourelles sont très éloignées du centre.
    for (let i = 0; i < ts.length; i++) {
      const p = ts[i];
      NEON.line(c, S.x, S.y, p.x, p.y, col, 3.2, { alpha: 0.28, passes: 3 });
      NEON.line(c, S.x, S.y, p.x, p.y, 'shock', 0.8, { alpha: 0.28, passes: 1 });
    }
    NEON.shape(c, poly(S.x, S.y, m.r * 1.42, 8, -m.rot * 0.32, 0.72), col, 3.2,
               { alpha: 1, fill: true, fillAlpha: 0.16, glowScale: 1.35, passes: 4 });
    NEON.shape(c, etoile(S.x, S.y, m.r, m.r * 0.58, 8, m.rot * 0.55), col, 1.8,
               { alpha: 0.72, fill: true, fillAlpha: 0.10, passes: 3 });
    NEON.ring(c, S.x, S.y, m.r * (0.36 + m.ouverture * 0.12), 3.0, FAIBLE,
              { alpha: 0.72 + m.ouverture * 0.25, glowScale: 1.5, passes: 4 });

    for (let i = 0; i < ts.length; i++) {
      const p = ts[i], pc = p.flash > 0.02 ? 'shock' : FAIBLE;
      NEON.shape(c, poly(p.x, p.y, p.r * 1.35, 6, p.angle + t * 0.25), col, 2.0,
                 { alpha: 0.9, fill: true, fillAlpha: 0.18, passes: 3 });
      NEON.dot(c, p.x, p.y, p.r * 0.45, pc, { alpha: 0.95, glowScale: 1.55 });
      NEON.line(c, p.x, p.y, p.x + Math.cos(viser(p.x, p.y)) * p.r * 1.8,
                p.y + Math.sin(viser(p.x, p.y)) * p.r * 1.8, pc, 2.2,
                { alpha: 0.7, passes: 2 });
    }

    const a = S.att;
    if (!a || a.etat !== 'tele') return;
    if (a.nom === 'verrou' || a.nom === 'croix') {
      for (let i = 0; i < ts.length; i++) {
        const ang = viser(ts[i].x, ts[i].y);
        teleLigne(c, ts[i].x, ts[i].y, ts[i].x + Math.cos(ang) * haut(),
                  ts[i].y + Math.sin(ang) * haut(), a.k, DANGER, 1.5);
      }
    } else if (a.nom === 'bastion') {
      for (let i = 0; i < ts.length; i++) teleEventail(c, ts[i].x, ts[i].y, Math.PI / 2,
        5 + S.phase, 0.72, haut() * 0.55, a.k, DANGER);
    } else {
      teleEventail(c, S.x, S.y, m.rot, 14, TAU * 13 / 14, m.orbite * 1.45, a.k, DANGER);
      teleAlerte(c, S.x, S.y + m.orbite, a.k, DANGER);
    }
  }

  /* ===========================================================================
   *  17. BOSS 5 — L’ÉCLIPSE
   * -----------------------------------------------------------------------
   *  Deux astres de guerre tournent autour d'un puits noir. Le danger vient
   *  tantôt des deux soleils, tantôt du rayon qui les relie au joueur.
   * ======================================================================== */

  const DEF_ECLIPSE = {
    nom: 'L’ÉCLIPSE',
    sous: 'BINAIRE DE GUERRE',
    coul: 'enemy.elite',

    init: function () {
      const e = ech(), m = S.memo;
      m.r = 40 * e;
      m.orbite = 105 * e;
      m.rot = -Math.PI / 2;
      m.pulse = 0;
      ajouterPart('ecl-puits', 'coque', 0, 0, m.r * 0.92, Infinity,
                  { vulnerable: false, armure: 0.35 });
      construireAstresEclipse();
      S.x = larg() / 2;
      S.y = -m.orbite;
    },

    reconstruire: construireAstresEclipse,

    update: function (dt) {
      const m = S.memo, W = larg(), H = haut();
      S.x = W / 2 + Math.sin(S.t * 0.31) * Math.max(18, W * 0.20);
      S.y = H * 0.235 + Math.sin(S.t * 0.57) * 13 * ech();
      S.angle = 0;
      m.rot += dt * (0.48 + S.phase * 0.18) * (S.variant ? 1.12 : 1);
      m.pulse = damp2(m.pulse, enTele() ? 1 : 0, 0.035, dt);
      const astres = partsDe('faible');
      for (let i = 0; i < astres.length; i++) {
        const p = astres[i], ang = m.rot + p.rang * Math.PI;
        p.ox = Math.cos(ang) * m.orbite;
        p.oy = Math.sin(ang) * m.orbite * 0.58;
      }
      const etat = avancerAttaque(dt, onTirEclipse);
      if (etat === 'fin' || etat === 'libre') programmerEclipse();
    },

    dessiner: dessinerEclipse
  };

  function construireAstresEclipse() {
    const m = S.memo;
    retirerParts('faible');
    const pv = S.hpMax * 0.075;
    for (let i = 0; i < 2; i++) {
      const a = m.rot + i * Math.PI;
      ajouterPart('ecl-astre-' + i, 'faible', Math.cos(a) * m.orbite,
                  Math.sin(a) * m.orbite * 0.58, m.r, pv, { rang: i });
    }
  }

  function programmerEclipse() {
    let nom;
    if (S.phase === 1) nom = choisir([['convergence', 1], ['corona', 0.65]]);
    else if (S.phase === 2) nom = choisir([['corona', 1], ['cisaille', 0.8], ['convergence', 0.5]]);
    else nom = choisir([['occultation', 1], ['cisaille', 0.8], ['corona', 0.65]]);
    if (nom === 'convergence') lancerAttaque(nom, 0.72, 0.65, 1.05, 7, 0.105);
    else if (nom === 'corona') lancerAttaque(nom, 0.92, 0.85, 1.25, 3, 0.27);
    else if (nom === 'cisaille') lancerAttaque(nom, 0.82, 0.75, 1.05, 5, 0.14);
    else lancerAttaque(nom, 1.20, 1.15, 1.30, 2 + (S.variant > 0 ? 1 : 0), 0.40);
  }

  function onTirEclipse(i, a) {
    const m = S.memo, astres = partsDe('faible');
    if (!astres.length) astres.push({ x: S.x, y: S.y });
    const src = astres[i % astres.length];
    if (a.nom === 'convergence') {
      tirer(src.x, src.y, viser(src.x, src.y), 420, 'shooter', { width: 6, height: 18 });
    } else if (a.nom === 'corona') {
      for (let j = 0; j < astres.length; j++) {
        const n = 10 + S.bonusBalles * 2;
        anneau(astres[j].x, astres[j].y, n, 285 + i * 20, 'normal', m.rot + i * TAU / (n * 2));
      }
    } else if (a.nom === 'cisaille') {
      for (let j = 0; j < astres.length; j++) {
        eventail(astres[j].x, astres[j].y, viser(astres[j].x, astres[j].y),
                 4 + S.bonusBalles, 0.46, 360, 'fast');
      }
    } else if (a.nom === 'occultation') {
      const p = joueur(), L = larg() + haut();
      const dx = p.x - src.x, dy = p.y - src.y, d = Math.hypot(dx, dy) || 1;
      creerRayon([{ x: src.x, y: src.y },
                   { x: src.x + dx / d * L, y: src.y + dy / d * L }],
                  0.06, 0.58, DANGER, 7 * ech());
    }
    evt('enemyShot', { type: a.nom === 'convergence' ? 'shooter' : 'elite' });
    secousse(a.nom === 'occultation' ? 0.20 : 0.09);
  }

  function dessinerEclipse(c) {
    const m = S.memo, t = tps();
    const col = S.flash > 0.02 ? 'shock' : S.coul;
    const astres = partsDe('faible');

    NEON.ring(c, S.x, S.y, m.orbite, 1.4, col,
              { alpha: 0.20, dash: [9, 15], dashOffset: -t * 55, passes: 2 });
    if (astres.length === 2) {
      NEON.line(c, astres[0].x, astres[0].y, astres[1].x, astres[1].y, col, 2.4,
                { alpha: 0.22 + m.pulse * 0.20, dash: [5, 9], dashOffset: t * 90, passes: 3 });
    }
    // Le puits central reste sombre, ceinturé de deux anneaux lumineux.
    NEON.shape(c, poly(S.x, S.y, m.r * 1.05, 12, -m.rot * 0.3), col, 2.5,
               { alpha: 0.75, fill: true, fillAlpha: 0.05, passes: 3 });
    NEON.ring(c, S.x, S.y, m.r * (1.35 + Math.sin(t * 2.2) * 0.08), 1.5, 'shock',
              { alpha: 0.28, passes: 2 });

    for (let i = 0; i < astres.length; i++) {
      const p = astres[i], pc = p.flash > 0.02 ? 'shock' : FAIBLE;
      const rays = 10 + S.phase * 2;
      NEON.shape(c, etoile(p.x, p.y, p.r * 1.35, p.r * 0.72, rays, t * (i ? -0.45 : 0.45)),
                 col, 2.2, { alpha: 0.88, fill: true, fillAlpha: 0.13, glowScale: 1.3, passes: 4 });
      NEON.dot(c, p.x, p.y, p.r * (0.40 + m.pulse * 0.12), pc,
               { alpha: 0.96, glowScale: 1.7 + m.pulse });
      NEON.ring(c, p.x, p.y, p.r * (1.55 + Math.sin(t * 4 + i) * 0.12), 1.3, pc,
                { alpha: 0.48, passes: 2 });
    }

    const a = S.att;
    if (!a || a.etat !== 'tele') return;
    if (a.nom === 'convergence' || a.nom === 'cisaille' || a.nom === 'occultation') {
      for (let i = 0; i < astres.length; i++) {
        const ang = viser(astres[i].x, astres[i].y);
        teleLigne(c, astres[i].x, astres[i].y,
                  astres[i].x + Math.cos(ang) * haut(), astres[i].y + Math.sin(ang) * haut(),
                  a.k, DANGER, a.nom === 'occultation' ? 2.5 : 1.4);
        if (a.nom === 'occultation') teleAlerte(c, joueur().x, joueur().y - 48 * ech(), a.k, DANGER);
      }
    } else {
      for (let i = 0; i < astres.length; i++) teleEventail(c, astres[i].x, astres[i].y,
        m.rot, 10, TAU * 9 / 10, m.orbite * 1.45, a.k, DANGER);
    }
  }

  /* --- catalogue des boss ------------------------------------------------- */
  const DEFS = [DEF_RUCHE, DEF_PRISME, DEF_SERPENT, DEF_COEUR, DEF_CITADELLE, DEF_ECLIPSE];

  /* ===========================================================================
   *  16. BANNIÈRE — l'annonce plein écran
   * ======================================================================== */

  function annoncer(texte, sous, coul, duree) {
    S.ban.texte = texte;
    S.ban.sous = sous || '';
    S.ban.coul = coul || S.coul;
    S.ban.duree = duree || 1.6;
    S.ban.t = 0;
  }

  function dessinerBanniere(c) {
    const b = S.ban;
    if (!b.texte || b.t >= b.duree) return;
    const u = cl(b.t / b.duree, 0, 1);
    const ouv = ss(cl(u / 0.16, 0, 1));
    const fer = 1 - ss(cl((u - 0.72) / 0.28, 0, 1));
    const a = ouv * fer;
    if (a <= 0.01) return;

    const W = larg(), H = haut(), s = ech();
    const cx = W / 2, cy = H * 0.38;
    const taille = cl(W * 0.055, 26, 62);

    // Deux liserés qui s'écartent : le texte est POSÉ, pas jeté.
    const lw = cl(W * 0.30, 180, 520) * (0.4 + ouv * 0.6);
    NEON.line(c, cx - lw, cy - taille * 0.95, cx + lw, cy - taille * 0.95, b.coul, 1.6,
              { alpha: a * 0.45, passes: 2 });
    NEON.line(c, cx - lw, cy + taille * 0.55, cx + lw, cy + taille * 0.55, b.coul, 1.6,
              { alpha: a * 0.45, passes: 2 });

    NEON.text(c, b.texte, cx, cy - taille * 0.14, b.coul, {
      size: taille * (0.88 + ouv * 0.12), align: 'center', baseline: 'middle',
      alpha: a * 0.95, glowScale: 0.85
    });
    if (b.sous) {
      NEON.text(c, b.sous, cx, cy + taille * 0.34, 'ui', {
        size: taille * 0.26, align: 'center', baseline: 'middle', weight: 'normal',
        alpha: a * 0.7, glowScale: 0.5, font: (typeof PALETTE !== 'undefined' ? PALETTE.ui.fontMono : undefined)
      });
    }
  }

  /* ===========================================================================
   *  17. BARRE DE VIE — dessinée ici, en néon, jamais déléguée au HUD
   * -----------------------------------------------------------------------
   *  Trois couches : le fond, la barre BLANCHE retardataire (elle montre ce
   *  qu'on vient d'arracher), puis la barre pleine. Deux encoches marquent les
   *  seuils de phase : le joueur voit approcher la bascule.
   * ======================================================================== */

  function dessinerBarre(c) {
    if (!S.actif || S.etat === 'inactif') return;
    const s = ech(), W = larg();
    const lar = cl(W * 0.60, 300, 980);
    const h = Math.max(11, 15 * s);
    const x = (W - lar) / 2;
    const y = Math.max(78, 96 * s);
    const ent = ss(cl(S.tEtat / 0.8, 0, 1));
    const app = (S.etat === 'entree') ? ent : 1;
    if (app <= 0.01) return;

    const hpMax = Math.max(1, S.hpMax);
    const f = (S.etat === 'entree') ? ss(cl(S.tEtat / (REGLAGES.entree * 0.75), 0, 1))
                                    : cl(S.hp / hpMax, 0, 1);
    const fg = (S.etat === 'entree') ? f : cl(S.hpFantome / hpMax, 0, 1);
    const pulse = S.pulseBarre;
    const col = S.coul;

    /* --- cadre ----------------------------------------------------------- */
    NEON.rect(c, x, y, lar, h, col, 1.4, {
      alpha: app * (0.30 + pulse * 0.25), fill: true, fillAlpha: 0.07, passes: 2
    });

    /* --- fantôme blanc : le dégât qu'on vient d'infliger ------------------ */
    if (fg > f + 0.001) {
      NEON.rect(c, x + lar * f, y + 1.5, lar * (fg - f), h - 3, 'shock', 0.8, {
        alpha: app * 0.55, fill: true, fillAlpha: 0.85, passes: 2
      });
    }

    /* --- remplissage ------------------------------------------------------ */
    if (f > 0.001) {
      NEON.rect(c, x + 1.5, y + 1.5, Math.max(1, lar * f - 3), h - 3, col, 1.0, {
        alpha: app * (0.85 + pulse * 0.15), fill: true, fillAlpha: 0.55,
        glowScale: 1 + pulse, passes: 3
      });
      // Arête vive au bord de la jauge : c'est elle qui « avance ».
      NEON.line(c, x + lar * f, y + 1, x + lar * f, y + h - 1, 'shock', 1.8,
                { alpha: app * (0.7 + pulse * 0.3), passes: 3 });
    }

    /* --- graduations + encoches de phase --------------------------------- */
    for (let i = 1; i < 10; i++) {
      const gx = x + lar * (i / 10);
      NEON.line(c, gx, y + h * 0.62, gx, y + h - 2, col, 0.9, { alpha: app * 0.22, passes: 1 });
    }
    for (let i = 0; i < REGLAGES.seuils.length; i++) {
      const gx = x + lar * REGLAGES.seuils[i];
      const passe = f <= REGLAGES.seuils[i];
      NEON.line(c, gx, y - 4 * s, gx, y + h + 4 * s, passe ? 'ui' : FAIBLE, 1.6,
                { alpha: app * (passe ? 0.25 : 0.75), passes: 2 });
    }

    /* --- chevrons d'extrémité --------------------------------------------- */
    const ch = new Path2D();
    ch.moveTo(x - 7 * s, y - 2); ch.lineTo(x - 12 * s, y + h / 2); ch.lineTo(x - 7 * s, y + h + 2);
    ch.moveTo(x + lar + 7 * s, y - 2); ch.lineTo(x + lar + 12 * s, y + h / 2); ch.lineTo(x + lar + 7 * s, y + h + 2);
    NEON.custom(c, ch, col, 1.6, { alpha: app * 0.6, passes: 2 });

    /* --- identité + phase -------------------------------------------------- */
    const ts = cl(13 * s, 10, 19);
    NEON.text(c, S.nom, x, y - 7 * s, col, {
      size: ts, align: 'left', baseline: 'alphabetic', alpha: app * 0.95, glowScale: 0.7
    });
    NEON.text(c, S.sous, x, y + h + ts * 1.15, 'ui', {
      size: ts * 0.62, align: 'left', baseline: 'alphabetic', weight: 'normal',
      alpha: app * 0.5, glowScale: 0.4,
      font: (typeof PALETTE !== 'undefined' ? PALETTE.ui.fontMono : undefined)
    });

    // Trois pastilles de phase : celle en cours bat au rythme du combat.
    for (let i = 0; i < 3; i++) {
      const px = x + lar - (2 - i) * ts * 1.15;
      const py = y - 7 * s - ts * 0.30;
      const active = (i + 1) === S.phase;
      const passee = (i + 1) < S.phase;
      const r = ts * (active ? 0.30 + 0.06 * Math.sin(tpsReel() * 6) : 0.20);
      NEON.dot(c, px, py, r, active ? FAIBLE : (passee ? 'ui' : col),
               { alpha: app * (active ? 1 : passee ? 0.30 : 0.55), glowScale: active ? 1.5 : 0.8 });
    }
    NEON.text(c, 'PHASE ' + ['I', 'II', 'III'][cl(S.phase - 1, 0, 2)],
              x + lar, y + h + ts * 1.15, col, {
      size: ts * 0.62, align: 'right', baseline: 'alphabetic', weight: 'normal',
      alpha: app * 0.65, glowScale: 0.4,
      font: (typeof PALETTE !== 'undefined' ? PALETTE.ui.fontMono : undefined)
    });

    /* --- bouclier de bascule : la barre se blinde une seconde ------------- */
    if (S.invuln > 0) {
      const k = cl(S.invuln / REGLAGES.invulnPhase, 0, 1);
      NEON.rect(c, x - 3, y - 3, lar + 6, h + 6, 'shock', 1.6, {
        alpha: app * 0.5 * k, dash: [8, 7], dashOffset: -tpsReel() * 130, passes: 3
      });
    }
  }

  /* ===========================================================================
   *  18. PHASES, DÉGÂTS, MORT
   * ======================================================================== */

  function fraction() { return cl(S.hp / Math.max(1, S.hpMax), 0, 1); }

  function verifierPhase() {
    if (S.etat !== 'combat') return;
    const f = fraction();
    const seuil = REGLAGES.seuils[S.phase - 1];
    if (seuil == null || f > seuil) return;
    basculerPhase();
  }

  function basculerPhase() {
    S.phase = Math.min(3, S.phase + 1);
    S.etat = 'bascule';
    S.tEtat = 0;
    S.invuln = REGLAGES.invulnPhase;
    S.att = null;

    // On rend l'écran au joueur : les balles en vol sont converties en éclats.
    const bal = (typeof enemyBullets !== 'undefined' && enemyBullets) ? enemyBullets : null;
    if (bal) {
      for (let i = bal.length - 1; i >= 0; i--) {
        const b = bal[i];
        if (!b) continue;
        etincelles(b.x, b.y, S.coul, Math.random() * TAU, 3);
      }
      purgerBalles(true);
    }
    S.rayons.length = 0;

    juice('bigKill', 1.4);
    voile(css(S.coul), 320, 0.42);
    onde(S.x, S.y, 'shock', 3.2);
    onde(S.x, S.y, S.coul, 2.4);
    boum(S.x, S.y, 'elite', { scale: 1.9 });
    evt('ramKill', { type: 'elite' });
    annoncer('PHASE ' + ['I', 'II', 'III'][S.phase - 1], S.sous, FAIBLE, 1.5);

    // Le boss se reconfigure : nouvelles cibles, nouvelle grammaire.
    if (S.def && typeof S.def.reconstruire === 'function') {
      try { S.def.reconstruire(); } catch (e) { console.error('BOSS.reconstruire :', e); }
    }
  }

  /** Destruction d'une pièce : gerbe, prime de dégâts, crochet du boss. */
  function tuerPart(p) {
    p.vivant = false;
    p.hp = 0;
    boum(p.x, p.y, p.kind === 'segment' ? 'elite' : 'shooter', { scale: 1.25 });
    eclats(p.x, p.y, css(FAIBLE, 'burst'), 'elite');
    onde(p.x, p.y, FAIBLE, 1.4);
    juice('bigKill', 0.8);
    evt('enemyKill', { type: 'elite' });
    marquerPoints(120, p.x, p.y);

    // Prime : casser un point faible fait VRAIMENT avancer la barre.
    appliquerDegats(p.hpMax * 0.50);

    if (S.def && typeof S.def.partDetruite === 'function') {
      try { S.def.partDetruite(p); } catch (e) { /* ignoré */ }
    }
    for (let i = S.parts.length - 1; i >= 0; i--) {
      if (S.parts[i] === p) { S.parts.splice(i, 1); break; }
    }
  }

  /** Le Serpent raccourcit : le maillon détruit quitte aussi la chaîne. */
  DEF_SERPENT.partDetruite = function (p) {
    const m = S.memo;
    if (!m.chaine || p.kind !== 'segment') return;
    if (m.chaine.seg.length > 2) m.chaine.seg.pop();
  };

  function appliquerDegats(n) {
    if (!(n > 0)) return;
    S.hp = Math.max(0, S.hp - n);
    S.fantomeDelai = 0.35;
    S.pulseBarre = Math.min(1, S.pulseBarre + 0.25 + n / Math.max(1, S.hpMax) * 4);
    if (S.hp <= 0 && S.etat !== 'mort') commencerMort();
    else verifierPhase();
  }

  /** Pièce la plus plausible sous le point (x, y). Priorité aux points faibles :
   *  quand deux zones se recouvrent, viser la lumière doit toujours payer. */
  const PRIORITE = { faible: 0, fragment: 1, segment: 2, tete: 3, coque: 4 };
  function trouverPart(x, y) {
    let best = null, bestScore = 1e9;
    for (let i = 0; i < S.parts.length; i++) {
      const p = S.parts[i];
      if (!p.vivant) continue;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > p.r * 1.30) continue;
      const sc = (PRIORITE[p.kind] || 5) * 1000 + d;
      if (sc < bestScore) { bestScore = sc; best = p; }
    }
    if (best) return best;
    // Repli : la pièce la plus proche, pour qu'un tir rasant ne soit pas perdu.
    let near = null, nd = 1e9;
    for (let i = 0; i < S.parts.length; i++) {
      const p = S.parts[i];
      if (!p.vivant) continue;
      const d = Math.hypot(x - p.x, y - p.y) - p.r;
      if (d < nd) { nd = d; near = p; }
    }
    return (nd < 40 * ech()) ? near : null;
  }

  function commencerMort() {
    S.etat = 'mort';
    S.tEtat = 0;
    S.invuln = 0;
    S.att = null;
    S.rayons.length = 0;
    S.hp = 0;

    // Les drones tombent avec leur mère.
    for (let i = S.drones.length - 1; i >= 0; i--) tuerDrone(i, true);
    purgerBalles(true);

    /* --- file de détonations : le corps part morceau par morceau ---------- */
    S.detonations.length = 0;
    const duree = REGLAGES.agonie * 0.72;
    const n = 22;
    for (let i = 0; i < n; i++) {
      const src = S.parts.length ? S.parts[i % S.parts.length] : null;
      const rad = src ? src.r : 40 * ech();
      S.detonations.push({
        dx: (src ? src.x - S.x : 0) + rr(-rad, rad),
        dy: (src ? src.y - S.y : 0) + rr(-rad, rad),
        t: (i / n) * duree + rr(-0.04, 0.04),
        fait: false,
        gros: (i % 5 === 0)
      });
    }
    S.detonations.push({ dx: 0, dy: 0, t: duree + 0.16, fait: false, final: true });

    juice('playerDeath', 0.7);
    voile('#ffffff', 260, 0.35);
    evt('ramKill', { type: 'elite' });
    annoncer(S.nom + ' — DÉTRUIT', 'ZONE DÉGAGÉE', FAIBLE, 2.4);
  }

  function majMort(dt) {
    const t = S.tEtat;
    for (let i = 0; i < S.detonations.length; i++) {
      const d = S.detonations[i];
      if (d.fait || t < d.t) continue;
      d.fait = true;

      const x = S.x + d.dx, y = S.y + d.dy;
      if (d.final) {
        // Le dernier souffle : tout part d'un coup, l'écran blanchit.
        boum(x, y, 'player', { scale: 3.4 });
        boum(x, y, 'elite', { scale: 2.8 });
        eclats(x, y, css(S.coul, 'burst'), 'elite');
        onde(x, y, 'shock', 5.5);
        onde(x, y, S.coul, 4.2);
        juice('gameOver', 0.8);
        voile('#ffffff', 520, 0.85);
        evt('stageClear', { stage: -1 });
      } else {
        boum(x, y, d.gros ? 'elite' : 'shooter', { scale: d.gros ? 1.7 : 1.0 });
        if (d.gros) eclats(x, y, css(S.coul, 'burst'), 'elite');
        secousse(d.gros ? 0.30 : 0.16);
        gel(d.gros ? 26 : 12);
        evt(d.gros ? 'ramKill' : 'enemyKill', { type: 'elite' });
      }
    }

    if (t >= REGLAGES.agonie) {
      S.actif = false;
      S.vaincu = true;
      S.etat = 'inactif';
      S.parts.length = 0;
      S.rayons.length = 0;
      S.drones.length = 0;
    }
  }

  function dessinerMort(c) {
    const u = cl(S.tEtat / REGLAGES.agonie, 0, 1);
    // Fissures qui s'ouvrent depuis le centre, de plus en plus nombreuses.
    const n = Math.floor(u * 14);
    for (let i = 0; i < n; i++) {
      const a = i * 2.399 + S.t;                       // angle d'or : jamais régulier
      const L = (60 + i * 14) * ech() * (0.5 + u);
      NEON.line(c, S.x, S.y, S.x + Math.cos(a) * L, S.y + Math.sin(a) * L, 'shock', 2.0, {
        alpha: 0.25 + 0.4 * Math.abs(Math.sin(tpsReel() * 22 + i)), passes: 3
      });
    }
    // Anneaux d'effondrement.
    for (let i = 0; i < 3; i++) {
      const k = (u * 2.2 + i * 0.33) % 1;
      NEON.ring(c, S.x, S.y, k * larg() * 0.55, 2.6 * (1 - k), 'shock',
                { alpha: 0.35 * (1 - k), passes: 3 });
    }
    NEON.dot(c, S.x, S.y, (18 + u * 60) * ech(), 'shock',
             { alpha: 0.25 + u * 0.6, glowScale: 1.6 });
  }

  /* ===========================================================================
   *  19. MISE À JOUR DES PIÈCES ET DU CORPS
   * ======================================================================== */

  function majParts(dt) {
    for (let i = 0; i < S.parts.length; i++) {
      const p = S.parts[i];
      p.flash = Math.max(0, p.flash - dt * 4.5);
      if (p.pondu > 0) p.pondu = Math.max(0, p.pondu - dt);
      p.t += dt;
    }
    S.flash = Math.max(0, S.flash - dt * 5);
    S.pulseBarre = Math.max(0, S.pulseBarre - dt * 2.2);

    // Barre fantôme : elle attend un instant, puis rattrape en glissant.
    if (S.fantomeDelai > 0) S.fantomeDelai -= dt;
    else S.hpFantome = damp2(S.hpFantome, S.hp, 0.02, dt);
    if (S.hpFantome < S.hp) S.hpFantome = S.hp;

    if (S.ban.texte) S.ban.t += dt;
  }

  /* ===========================================================================
   *  20. CYCLE DE VIE
   * ======================================================================== */

  /** Le Serpent entre en pilotant sa tête : pas de descente imposée. */
  DEF_SERPENT.entreeVerticale = false;

  function reset() {
    S.actif = false;
    S.vaincu = false;
    S.index = -1;
    S.variant = 0;
    S.variantCycle = 0;
    S.variantProfile = VARIANTES[0];
    S.def = null;
    S.etat = 'inactif';
    S.t = 0; S.tEtat = 0;
    S.phase = 1;
    S.invuln = 0;
    S.hp = 0; S.hpMax = 0; S.hpFantome = 0; S.fantomeDelai = 0; S.pulseBarre = 0;
    S.flash = 0;
    S.parts.length = 0;
    S.drones.length = 0;
    S.rayons.length = 0;
    S.detonations.length = 0;
    S.att = null;
    S.derniereAtt = '';
    S.derniereTouche = null;
    S.derniereToucheT = -1;
    S.points = 0;
    S.ban.texte = '';
    S.memo = {};
    S.multVitesse = 1; S.multCadence = 1; S.bonusBalles = 0;
    purgerBalles(true);
  }

  /** Convoque un boss.
   *  @param {number} index   index dans le catalogue DEFS
   *  @param {number} [menace] 1 = première boucle ; monte à chaque bouclage
   *  @returns {boolean} */
  function spawn(index, menace) {
    reset();
    const i = cl(index | 0, 0, DEFS.length - 1);
    const def = DEFS[i];
    const absoluteIndex = menace && typeof menace === 'object' && Number.isFinite(menace.bossIndex)
      ? menace.bossIndex
      : i;

    S.index = i;
    S.variantCycle = Math.max(0, Math.floor(absoluteIndex / DEFS.length));
    S.variant = S.variantCycle % VARIANTES.length;
    S.variantProfile = VARIANTES[S.variant];
    S.def = def;
    S.menace = cl(Number(menace) || 1, 1, REGLAGES.menaceMax);
    S.multVitesse = (1 + (S.menace - 1) * REGLAGES.menaceVitesse) * S.variantProfile.vitesse;
    S.multCadence = (1 + (S.menace - 1) * REGLAGES.menaceCadence) * S.variantProfile.cadence;
    S.bonusBalles = Math.floor((S.menace - 1) * REGLAGES.menaceBalles) + S.variantProfile.balles;

    S.nom = def.nom + (S.variantProfile.nom ? ' · ' + S.variantProfile.nom : '');
    S.sous = def.sous + (S.variantCycle >= VARIANTES.length ? ' · NIVEAU ' + (S.variantCycle + 1) : '');
    S.coul = def.coul || coulCoeur();

    // PV déduits de la durée visée : voir REGLAGES.dureeVisee.
    S.hpMax = Math.round(REGLAGES.dpsRef * REGLAGES.dureeVisee[i] *
                         (1 + (S.menace - 1) * REGLAGES.menacePv) * S.variantProfile.hp);
    S.hp = S.hpMax;
    S.hpFantome = S.hpMax;

    S.phase = 1;
    S.etat = 'entree';
    S.t = 0; S.tEtat = 0;
    S.actif = true;
    S.vaincu = false;
    S.att = null;

    try { def.init(); }
    catch (e) { console.error('BOSS.init a échoué :', e); reset(); return false; }

    S.yDepart = S.y;

    annoncer(S.nom, S.sous + (S.menace > 1 ? ' · MENACE ' + Math.round(S.menace) : ''), S.coul, 2.4);
    juice('stageStart');
    voile(css(S.coul), 420, 0.30);
    evt('divealert', {});
    return true;
  }

  /** @param {number} dt SECONDES de temps de jeu (0 pendant un hitstop). */
  function update(dt) {
    if (!S.actif) return;
    if (!(dt > 0)) return;                 // gelé : la logique ne bouge pas
    if (dt > 0.05) dt = 0.05;              // même garde-fou que la boucle mère

    S.t += dt;
    S.tEtat += dt;
    if (S.invuln > 0) S.invuln = Math.max(0, S.invuln - dt);
    S.peutAttaquer = (S.etat === 'combat');

    try {
      if (S.etat === 'mort') {
        majMort(dt);
      } else {
        if (S.def && typeof S.def.update === 'function') S.def.update(dt);

        if (S.etat === 'entree') {
          const k = cl(S.tEtat / REGLAGES.entree, 0, 1);
          if (S.def.entreeVerticale !== false) S.y = lp(S.yDepart, S.y, ss(k));
          if (k >= 1) {
            S.etat = 'combat';
            S.tEtat = 0;
            annoncer('PHASE I', S.sous, FAIBLE, 1.2);
          }
        } else if (S.etat === 'bascule') {
          if (S.tEtat >= REGLAGES.invulnPhase) { S.etat = 'combat'; S.tEtat = 0; }
        }
      }
    } catch (e) {
      console.error('BOSS.update a levé :', e);
    }

    // Le phare du Prisme vit hors de l'ordonnanceur : il balaie en continu.
    if (S.index === PRISME && S.etat !== 'mort') {
      try { majPharePrisme(dt); } catch (e) { /* ignoré */ }
    }

    ancrerParts();
    majParts(dt);

    if (S.etat !== 'mort') {
      majDrones(dt);
      majRayons(dt);
    }
    purgerBalles(false);
  }

  /* ===========================================================================
   *  21. RENDU
   * ======================================================================== */

  function drawWorld(c) {
    if (!S.actif || typeof NEON === 'undefined') return;
    c = c || (typeof ctx !== 'undefined' ? ctx : null);
    if (!c) return;
    try {
      if (S.etat !== 'mort' || S.tEtat < REGLAGES.agonie * 0.78) {
        if (S.def && typeof S.def.dessiner === 'function') S.def.dessiner(c);
      }
      dessinerDrones(c);
      dessinerRayons(c);

      // Bouclier de bascule : une coquille hexagonale qui encaisse.
      if (S.invuln > 0 && S.etat !== 'mort') {
        const k = cl(S.invuln / REGLAGES.invulnPhase, 0, 1);
        const r = 130 * ech() * (1.35 - k * 0.30);
        NEON.shape(c, poly(S.x, S.y, r, 6, tps() * 0.9), 'shock', 2.0, {
          alpha: 0.20 + k * 0.35, dash: [12, 9], dashOffset: -tpsReel() * 150, passes: 3
        });
      }

      if (S.etat === 'mort') dessinerMort(c);
    } catch (e) {
      console.error('BOSS.drawWorld a levé :', e);
    }
  }

  function drawHud(c, interne) {
    if (!interne) S.hudExplicite = true;
    if (!S.actif || typeof NEON === 'undefined') return;
    c = c || (typeof ctx !== 'undefined' ? ctx : null);
    if (!c) return;
    try {
      dessinerBarre(c);
      dessinerBanniere(c);
    } catch (e) {
      console.error('BOSS.drawHud a levé :', e);
    }
  }

  function draw(c) {
    c = c || (typeof ctx !== 'undefined' ? ctx : null);
    if (!c) return;
    drawWorld(c);
    if (!S.hudExplicite) drawHud(c, true);
  }

  /* ===========================================================================
   *  22. COLLISIONS
   * ======================================================================== */

  /** Cible touchée par un rectangle (balle du joueur), ou null.
   *  Les drones passent devant : les abattre doit rester réflexe.
   *  @param {{x:number,y:number,width:number,height:number}} rect */
  function hitTest(rect) {
    if (!S.actif || !rect) return null;
    if (S.etat === 'entree' || S.etat === 'mort') return null;

    for (let i = 0; i < S.drones.length; i++) {
      const d = S.drones[i];
      if (rectCercle(rect, d.x, d.y, d.r)) {
        S.derniereTouche = d; S.derniereToucheT = tps();
        return d;
      }
    }

    let best = null, bestScore = 1e9;
    for (let i = 0; i < S.parts.length; i++) {
      const p = S.parts[i];
      if (!p.vivant) continue;
      if (!rectCercle(rect, p.x, p.y, p.r)) continue;
      const cx = rect.x + (rect.width || 0) / 2;
      const cy = rect.y + (rect.height || 0) / 2;
      const sc = (PRIORITE[p.kind] || 5) * 1000 + Math.hypot(cx - p.x, cy - p.y);
      if (sc < bestScore) { bestScore = sc; best = p; }
    }
    if (best) { S.derniereTouche = best; S.derniereToucheT = tps(); }
    return best;
  }

  /** Corps-à-corps : vrai si le rectangle touche quoi que ce soit de solide
   *  (coque, maillon, éclat, valve, drone, tentacule). */
  function bodyHitTest(rect) {
    if (!S.actif || !rect) return false;
    if (S.etat === 'entree' || S.etat === 'mort') return false;

    for (let i = 0; i < S.parts.length; i++) {
      const p = S.parts[i];
      if (!p.vivant) continue;
      if (rectCercle(rect, p.x, p.y, p.r * 0.92)) return true;
    }
    for (let i = 0; i < S.drones.length; i++) {
      const d = S.drones[i];
      if (rectCercle(rect, d.x, d.y, d.r * 0.85)) return true;
    }
    const tn = S.memo && S.memo.tentacules;
    if (tn) {
      for (let i = 0; i < tn.length; i++) {
        const pts = tn[i].pts;
        for (let j = 0; j + 1 < pts.length; j++) {
          const cx = rect.x + (rect.width || 0) / 2;
          const cy = rect.y + (rect.height || 0) / 2;
          const rr2 = Math.max((rect.width || 0), (rect.height || 0)) / 2;
          if (distSegment(cx, cy, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y) <= tn[i].r + rr2) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /** Applique `n` dégâts au point (x, y).
   *  @returns {boolean} true si le coup a porté (la balle doit être consommée) */
  function damage(n, x, y) {
    if (!S.actif) return false;
    if (S.etat === 'entree' || S.etat === 'mort') return false;

    n = (typeof n === 'number' && n > 0) ? n : 1;
    if (x == null || y == null) { x = S.x; y = S.y; }

    /* --- 1. la cible que hitTest vient de désigner ----------------------- */
    let cible = null;
    const memo = S.derniereTouche;
    if (memo && (tps() - S.derniereToucheT) < 0.06) {
      const encore = (memo.kind === 'drone') ? (S.drones.indexOf(memo) >= 0) : !!memo.vivant;
      if (encore && Math.hypot(x - memo.x, y - memo.y) <= memo.r * 2.2) cible = memo;
    }
    if (!cible) cible = trouverPart(x, y);
    if (!cible) return false;

    /* --- 2. un drone : c'est lui qui encaisse, pas le boss --------------- */
    if (cible.kind === 'drone') {
      cible.hp -= n;
      cible.flash = 1;
      etincelles(x, y, cible.coul, -Math.PI / 2, 4);
      if (cible.hp <= 0) {
        const idx = S.drones.indexOf(cible);
        if (idx >= 0) tuerDrone(idx);
      } else {
        juice('enemyHit', 0.5);
        evt('enemyHit', { type: 'fast' });
      }
      S.derniereTouche = null;
      return true;
    }

    /* --- 3. bouclier de bascule : rien ne passe, mais le tir se voit ------ */
    if (S.invuln > 0) {
      etincelles(x, y, 'shock', Math.atan2(y - S.y, x - S.x), 4);
      S.pulseBarre = Math.min(1, S.pulseBarre + 0.10);   // la barre encaisse, visiblement
      return true;
    }

    /* --- 4. dégâts ------------------------------------------------------- */
    const mult = multiplicateur(cible);
    const degats = n * mult;
    cible.flash = 1;

    if (mult < 0.5) {
      // Ricochet : gerbe froide, pas de secousse. Le message est « pas ici ».
      etincelles(x, y, S.coul, Math.atan2(y - cible.y, x - cible.x), 3);
      evt('enemyHit', { type: 'normal' });
    } else {
      S.flash = Math.min(1, S.flash + 0.10 * mult);
      etincelles(x, y, cible.kind === 'coque' ? S.coul : FAIBLE,
                 Math.atan2(y - cible.y, x - cible.x), cible.kind === 'coque' ? 4 : 6);
      juice('enemyHit', mult >= 2 ? 0.9 : 0.6);
      evt('enemyHit', { type: cible.kind === 'coque' ? 'normal' : 'elite' });
    }

    if (cible.vulnerable && cible.hp !== Infinity) cible.hp -= degats;
    appliquerDegats(degats);

    if (S.etat !== 'mort' && cible.vivant && cible.hp !== Infinity && cible.hp <= 0) {
      tuerPart(cible);
    }
    return true;
  }

  /* ===========================================================================
   *  23. AIDES DE PROGRESSION (facultatives, mais elles évitent que plusieurs
   *      fichiers différents réinventent la même table)
   * ======================================================================== */

  /** Index du boss à convoquer pour ce stage, ou -1. */
  function indexForStage(stage) {
    const s = stage | 0;
    if (s <= 0 || s % 5 !== 0) return -1;
    return ((s / 5 - 1) % DEFS.length + DEFS.length) % DEFS.length;
  }

  function isBossStage(stage) { return indexForStage(stage) >= 0; }

  /** Niveau de menace conseillé pour ce stage (1 à la première boucle). */
  function menaceForStage(stage) {
    const s = Math.max(1, stage | 0);
    return cl(1 + Math.floor((s - 1) / 20), 1, REGLAGES.menaceMax);
  }

  /* ===========================================================================
   *  24. API
   * ======================================================================== */

  return {
    /* --- cycle --- */
    spawn: spawn,
    update: update,
    draw: draw,
    drawWorld: drawWorld,
    drawHud: function (c) { return drawHud(c, false); },
    reset: reset,

    /* --- interrogation --- */
    isActive: function () { return S.actif; },
    isDefeated: function () { return S.vaincu; },
    isDying: function () { return S.actif && S.etat === 'mort'; },
    isVulnerable: function () { return S.actif && S.etat === 'combat' && S.invuln <= 0; },
    getPhase: function () { return S.phase; },
    getIndex: function () { return S.index; },
    getVariant: function () { return S.variant; },
    getName: function () { return S.nom; },
    getSubtitle: function () { return S.sous; },
    getColor: function () { return S.coul; },
    getHp: function () { return S.hp; },
    getMaxHp: function () { return S.hpMax; },
    getHpFraction: fraction,
    getMenace: function () { return S.menace; },
    getScore: function () { return S.points; },
    getDrones: function () { return S.drones; },

    /* --- collisions --- */
    hitTest: hitTest,
    bodyHitTest: bodyHitTest,
    damage: damage,

    /* --- progression --- */
    STAGES: STAGES.slice(),
    indexForStage: indexForStage,
    isBossStage: isBossStage,
    menaceForStage: menaceForStage,
    stageForIndex: function (i) { return STAGES[cl(i | 0, 0, DEFS.length - 1)]; },
    count: function () { return DEFS.length; },

    /* --- réglages, exposés pour l'équilibrage à chaud --- */
    config: REGLAGES,

    /** Introspection (console). NE PAS écrire dedans depuis le jeu. */
    _state: S
  };
})();

window.BOSS = BOSS;
