/* =============================================================================
 *  galabob — STRUCTURE DE PROGRESSION, BOSS ET TRANSITIONS
 * -----------------------------------------------------------------------------
 *  CE QUI A CHANGÉ (chantier « progression »)
 *  ------------------------------------------
 *  1. COURBE DE MENACE CONTINUE. Les trois paliers en dur (stage<=2, stage<=4,
 *     puis un `else` qui couvrait TOUT le reste) sont supprimés. `menaceFor()`
 *     produit une courbe continue qui pilote TOUT : effectif, densité de tir,
 *     fréquence et vitesse de plongée, vitesse de formation, PV et proportion
 *     des types d'ennemis. Deux stages voisins ne sont plus jamais identiques.
 *  2. DÉPART BEAUCOUP PLUS DOUX. Mesure de référence : un joueur STRICTEMENT
 *     IMMOBILE mourait en 6-7 s au stage 1 (c'est un niveau de fin de jeu).
 *     La courbe vise ~26 s au stage 1 et ~8 s au stage 20 — voir
 *     `stageSystem.estimateSurvival()`, le modèle est écrit noir sur blanc et
 *     vérifiable hors du jeu.
 *  3. VINGT STAGES (maxStage : 10 -> 20) et 20 COMPOSITIONS (formation ×
 *     chorégraphie) débloquées une par stage : le joueur voit du NOUVEAU
 *     régulièrement jusqu'au bout, et le poids d'une composition fraîchement
 *     débloquée est temporairement majoré (effet « nouveauté »).
 *  4. BOUCLE INFINIE CUMULATIVE. Après le stage 20 : loopCount++ et retour au
 *     stage 1, mais la menace REPART PLUS HAUT (×1.4 par boucle à position
 *     égale). Le stage 1 de la boucle 2 est plus dur que le stage 20 de la
 *     boucle 1. Affichage « STAGE 3-2 » (stage 3, boucle 2).
 *  5. STAGES DE BOSS aux stages 5, 10, 15 et 20 de chaque boucle. L'appel à
 *     `spawnBoss(slot, menace)` (ou `BOSS.spawn`) est protégé par un `typeof` :
 *     si le module boss n'est pas chargé, on retombe sur une formation
 *     renforcée. Le stage n'est terminé QUE quand le boss est mort — détecté
 *     via BOSS.isDefeated(), ou signalé par stageSystem.notifyBossDefeated().
 *  6. HUIT TRANSITIONS (~2 s) au lieu d'une seule : warp, vortex, balayage,
 *     déchirure, onde de choc, plongée, iris, effondrement. Tirage en SAC
 *     (aucune répétition tant que les huit ne sont pas passées) et chacune
 *     PRÉSENTE le décor du stage suivant au lieu de le masquer.
 *  7. RANG DE FIN DE STAGE S/A/B/C (temps, combo max, zéro dégât), affiché
 *     pendant la transition. Le `Date.now()` de resetStageStats() est remplacé
 *     par FRAME.time, comme l'exige la convention.
 *  8. GOUVERNEUR (bas de fichier) : ce fichier n'a le droit de modifier aucun
 *     autre module. Il IMPOSE donc la courbe de menace en enveloppant, à
 *     l'exécution, les fonctions de réglage d'enemies.js (elles restent
 *     appelées, on ne fait que neutraliser leur escalier par stage et appliquer
 *     la courbe). Chaque enveloppe est idempotente, garde une référence à
 *     l'originale, et se désactive d'un seul booléen.
 *
 *  UNITÉS : vitesses en px CSS/s, durées en ms, probabilités PAR SECONDE,
 *  animations sur FRAME.time (JAMAIS Date.now()).
 * ========================================================================== */

/* =============================================================================
 *  1. COURBE DE MENACE
 * -----------------------------------------------------------------------------
 *  `p` est la PROGRESSION ABSOLUE, en « boucles » :
 *      p = 0    -> stage 1, boucle 1
 *      p = 1    -> stage 20, boucle 1
 *      p = 1.275-> stage 1, boucle 2   (LOOP_STEP)
 *  La menace elle-même est géométrique : menace = SPAN^p, avec SPAN = 3.4
 *  (stage 20 = 3,4× le stage 1). LOOP_STEP est calculé pour qu'une boucle
 *  complète vaille exactement ×LOOP_MULT (1.4) À POSITION ÉGALE : le stage 3-2
 *  est 1,4× plus menaçant que le stage 3-1, et le stage 1-2 (3,4^1,275 = 4,76)
 *  dépasse largement le stage 20-1 (3,40).
 * ========================================================================== */

const PROGRESSION = {
  MAX_STAGE: 20,          // stages par boucle
  SPAN: 3.4,              // rapport de menace entre le stage 20 et le stage 1
  LOOP_MULT: 1.4,         // surcharge cumulative par boucle, à position égale
  BOSS_EVERY: 5,          // stages 5, 10, 15, 20
  LIVES_REF: 3            // vies de référence pour l'estimation de survie
};

// Décalage de progression apporté par une boucle complète.
PROGRESSION.LOOP_STEP = 1 + Math.log(PROGRESSION.LOOP_MULT) / Math.log(PROGRESSION.SPAN);

/** Courbe de confort : douce au début, franche ensuite. courbe(0)=0, courbe(1)=1. */
function courbeMenace(k) {
  k = clamp(k, 0, 1);
  return k * (0.45 + 0.55 * k);
}

/** Rampe linéaire bornée : 0 avant `a`, 1 après `b`. */
function _rampe(x, a, b) {
  if (b <= a) return x >= b ? 1 : 0;
  return clamp((x - a) / (b - a), 0, 1);
}

/** Progression absolue (en boucles) d'un stage donné. */
function progressionAbsolue(stage, loop) {
  const s = clamp(Math.round(stage) || 1, 1, PROGRESSION.MAX_STAGE);
  const l = Math.max(0, Math.round(loop) || 0);
  return (s - 1) / (PROGRESSION.MAX_STAGE - 1) + l * PROGRESSION.LOOP_STEP;
}

/** Un stage est-il un stage de BOSS ? (5, 10, 15, 20 de chaque boucle) */
function estStageDeBoss(stage) {
  const s = Math.round(stage) || 1;
  return s > 0 && (s % PROGRESSION.BOSS_EVERY) === 0;
}

/* --- cache : la menace d'un stage ne change pas d'une frame à l'autre ------ */
const _menaceCache = {};

/**
 *  LA fonction de menace. Renvoie un objet COMPLET décrivant tout ce qui doit
 *  varier d'un stage à l'autre. Aucun autre endroit du jeu n'a le droit de
 *  décider « au stage 5, ceci ».
 *
 *  @param {number} stage 1..20
 *  @param {number} loop  0 = première boucle
 */
function menaceFor(stage, loop) {
  const s = clamp(Math.round(stage) || 1, 1, PROGRESSION.MAX_STAGE);
  const l = Math.max(0, Math.round(loop) || 0);
  const cle = s + ':' + l;
  if (_menaceCache[cle]) return _menaceCache[cle];

  const p = progressionAbsolue(s, l);
  const k = courbeMenace(clamp(p, 0, 1));        // courbe de la première boucle
  const sur = Math.max(0, p - 1);                // ce qui dépasse la boucle 1
  // Surcharge cumulative : 1,35^1,275 ≈ ×1,47 par boucle à position égale.
  // C'est ce qui empêche la boucle 2 de repartir au niveau de la boucle 1.
  const boost = Math.pow(1.35, sur);
  const menace = Math.pow(PROGRESSION.SPAN, p);  // scalaire lisible (1 -> 3,4 -> …)

  // « Stage équivalent » : sert aux déblocages (types d'ennemis, compositions)
  // pour que les boucles suivantes gardent TOUT débloqué.
  const stageEq = 1 + p * (PROGRESSION.MAX_STAGE - 1);

  /* --- proportions de types : les élites et les béliers arrivent TARD ----- */
  const wShooter = _rampe(stageEq, 2, 7) * 0.30;
  const wFast    = _rampe(stageEq, 3, 9) * 0.28;
  const wElite   = _rampe(stageEq, 7, 15) * 0.19;
  const wRam     = _rampe(stageEq, 12, 19) * 0.11;
  const wNormal  = Math.max(0.15, 1 - (wShooter + wFast + wElite + wRam));
  const somme = wNormal + wShooter + wFast + wElite + wRam;

  const m = {
    /* --- identité --- */
    stage: s,
    loop: l,
    label: s + '-' + (l + 1),
    p: p,
    stageEq: stageEq,
    menace: menace,
    boss: estStageDeBoss(s),
    // bossIndex : numéro ABSOLU du boss (croît d'une boucle à l'autre).
    // bossSlot  : lequel des quatre boss (0..3) — c'est CE numéro qu'attend
    //             BOSS.spawn(), et les boucles refont donc le même carrousel,
    //             mais avec une menace plus haute.
    bossIndex: estStageDeBoss(s)
      ? (Math.floor(s / PROGRESSION.BOSS_EVERY) - 1) + l * (PROGRESSION.MAX_STAGE / PROGRESSION.BOSS_EVERY)
      : -1,
    bossSlot: estStageDeBoss(s) ? (Math.floor(s / PROGRESSION.BOSS_EVERY) - 1) % 4 : -1,
    // Menace transmise à js/entities/boss.js, QUI ATTEND UN NOMBRE de 1 à 6
    // (REGLAGES.menaceMax) : la courbe continue y est projetée.
    bossMenace: clamp(1 + p * 2.0, 1, 6),

    /* --- effectifs --- */
    // Recalibré sur la cadence de tir réelle : TEMPO.PLAYER_FIRE_INTERVAL est
    // passé de 300 ms à 110 ms (~9 tirs/s) et les balles vont 2,7x plus vite.
    // L'ancien budget lerp(14, 48) était dimensionné pour l'ancienne cadence :
    // les stages se soldaient en quelques secondes. Remonté d'autant.
    budget: Math.round(clamp(lerp(32, 96, k) * (1 + sur * 0.22), 26, 190)),
    // ATTENTION : `budget` règle la DURÉE du stage, `fieldTarget` règle le
    // COÛT DE RENDU. Chaque entité coûte 4 passes de tracé néon, donc gonfler
    // l'effectif simultané se paie en framerate — ce que le budget total, lui,
    // ne coûte rien. On garde donc des stages longs SANS surcharger l'écran.
    premiereVague: Math.round(clamp(lerp(6, 16, k) * (1 + sur * 0.12), 5, 20)),
    fieldTarget: Math.round(clamp(lerp(6, 14, k) * (1 + sur * 0.18), 5, 16)),
    fieldReinforce: 0,                 // calculé juste après (dépend de fieldTarget)

    /* --- feu ---
     *  tirMult multiplie la table TEMPO.ENEMY_SHOT_CHANCE_PER_SEC. Les valeurs
     *  paraissent basses : c'est VOULU. À 16 ennemis à l'écran qui VISENT le
     *  joueur, la table brute tue un joueur immobile en 6 s — mesuré. Voir
     *  stageSystem.estimateSurvival(). */
    tirMult: clamp(lerp(0.085, 0.30, k) * boost, 0.07, 2.10),
    // SALVES COORDONNÉES. Le gouverneur ne peut que SAUTER une salve : sa
    // TAILLE est décidée par triggerEnemyVolley() (enemies.js), qui la fait
    // grimper par MARCHES (1, puis 2 au stage 4, puis 3 au stage 7). On ne
    // pilote donc pas la probabilité directement mais le DÉBIT visé (tirs de
    // salve par seconde) : la probabilité s'en déduit, et la marche d'escalier
    // d'enemies.js est absorbée au lieu d'être subie.
    salveDebit: clamp(lerp(0.045, 0.60, k) * boost, 0.04, 2.2),
    salveTaille: clamp(1 + Math.floor((s - 1) / 3), 1, 3),
    salveChance: 0,                    // dérivé juste après (débit ÷ taille)
    balleMax: Math.round(clamp(lerp(9, 26, k) * (1 + sur * 0.18), 8, 40)),

    /* --- plongées : rares et LENTES au début --- */
    plongeeMult: clamp(lerp(0.15, 0.60, k) * boost, 0.12, 2.4),
    plongeeVitesse: clamp(lerp(0.70, 1.18, k) * (1 + sur * 0.06), 0.65, 1.45),
    plongeeTelegraphe: Math.round(clamp(lerp(430, 250, k) - sur * 20, 190, 460)),
    plongeursMax: Math.round(clamp(lerp(1, 3, k) + sur * 1.2, 1, 6)),

    /* --- formation --- */
    vitesseFormation: clamp(lerp(0.58, 1.32, k) * (1 + sur * 0.10), 0.55, 1.85),

    /* --- résistance --- */
    pvBonus: (stageEq >= 16 ? 2 : stageEq >= 8 ? 1 : 0) + Math.floor(sur * 1.6),

    /* --- répartition des types (somme = 1) --- */
    types: {
      normal:  wNormal / somme,
      shooter: wShooter / somme,
      fast:    wFast / somme,
      elite:   wElite / somme,
      ram:     wRam / somme
    }
  };

  m.fieldReinforce = Math.max(2, Math.round(m.fieldTarget * 0.68));

  // Période moyenne d'une salve dans enemies.js : enemyShotInterval (2600 ms).
  m.salveChance = clamp(m.salveDebit / (m.salveTaille * (1000 / 2600)), 0.05, 1);

  // Mémorisé AVANT l'allègement des stages de boss : sert au repli quand le
  // module boss est absent (le champ ne doit pas rester à moitié vide).
  m.fieldTargetHorsBoss = m.fieldTarget;
  m.budgetHorsBoss = m.budget;

  // Stage de boss : le champ se vide au profit du boss lui-même.
  if (m.boss) {
    m.budget = Math.round(clamp(8 + k * 14, 8, 26));
    m.premiereVague = Math.round(clamp(3 + k * 6, 3, 10));
    m.fieldTarget = Math.round(clamp(m.fieldTarget * 0.45, 3, 9));
    m.fieldReinforce = Math.max(2, Math.round(m.fieldTarget * 0.7));
    m.tirMult *= 0.72;               // le boss fournit déjà l'essentiel du danger
    m.plongeeMult *= 0.75;
    m.salveDebit *= 0.7;
    m.salveChance = clamp(m.salveDebit / (m.salveTaille * (1000 / 2600)), 0.05, 1);
  }

  m.theme = stageThemeFor(s, l);

  // Un module qui fait `Number(menace)` (c'est le cas de boss.js) récupère la
  // menace de boss (1..6) au lieu d'un NaN. L'objet complet reste utilisable
  // tel quel par les modules qui savent le lire.
  Object.defineProperty(m, 'valueOf', {
    value: function () { return this.bossMenace; },
    enumerable: false
  });

  _menaceCache[cle] = m;
  return m;
}

/* =============================================================================
 *  2. THÈMES DE DÉCOR
 *  Un thème tous les 4 stages. Sert à la transition (elle PRÉSENTE le décor
 *  suivant) et peut être lu par le fond stellaire — voir `stageSystem.theme()`.
 * ========================================================================== */
const STAGE_THEMES = [
  { key: 'aurore',    nom: 'AURORE',     accent: 'player',       grille: 'player',       densite: 0.9, horizon: 0.62 },
  { key: 'nebuleuse', nom: 'NÉBULEUSE',  accent: 'enemyNormal',  grille: 'enemyNormal',  densite: 1.1, horizon: 0.58 },
  { key: 'ceinture',  nom: 'CEINTURE',   accent: 'enemyFast',    grille: 'enemyFast',    densite: 1.0, horizon: 0.66 },
  { key: 'abime',     nom: 'ABÎME',      accent: 'enemyShooter', grille: 'enemyShooter', densite: 0.8, horizon: 0.54 },
  { key: 'coeur',     nom: 'CŒUR',       accent: 'enemyElite',   grille: 'enemyElite',   densite: 1.2, horizon: 0.70 }
];

/** Thème d'un stage donné. Ne renvoie jamais null. */
function stageThemeFor(stage, loop) {
  const s = clamp(Math.round(stage) || 1, 1, PROGRESSION.MAX_STAGE);
  const i = Math.min(STAGE_THEMES.length - 1, Math.floor((s - 1) / 4));
  const base = STAGE_THEMES[i];
  return {
    key: base.key,
    nom: base.nom,
    accent: base.accent,
    grille: base.grille,
    densite: base.densite,
    horizon: base.horizon,
    loop: Math.max(0, Math.round(loop) || 0)
  };
}

/* =============================================================================
 *  3. COMPOSITIONS — 20 combinaisons formation × chorégraphie,
 *  débloquées UNE PAR STAGE. Plus jamais de palier figé : à chaque stage le
 *  joueur voit arriver quelque chose qu'il n'avait pas vu la veille, et la
 *  nouveauté est temporairement sur-pondérée pour qu'il la remarque.
 * ========================================================================== */
const STAGE_COMPOSITIONS = [
  { nom: 'RANG SERRÉ',    f: 'grid',      c: 'curveLeft',  stage: 1,  poids: 1.00, taille: 0.90 },
  { nom: 'DOUBLE LIGNE',  f: 'doubleRow', c: 'curveRight', stage: 2,  poids: 1.00, taille: 0.95 },
  { nom: 'CROISEMENT',    f: 'grid',      c: 'split',      stage: 3,  poids: 0.95, taille: 1.00 },
  { nom: 'PENDULE',       f: 'doubleRow', c: 'zigzag',     stage: 4,  poids: 0.95, taille: 1.00 },
  { nom: 'LOSANGE',       f: 'diamond',   c: 'curveRight', stage: 5,  poids: 0.95, taille: 0.95 },
  { nom: 'TENAILLE',      f: 'diamond',   c: 'split',      stage: 6,  poids: 0.95, taille: 1.00 },
  { nom: 'GRILLE FOLLE',  f: 'grid',      c: 'zigzag',     stage: 7,  poids: 0.90, taille: 1.05 },
  { nom: 'CARROUSEL',     f: 'circle',    c: 'curveLeft',  stage: 8,  poids: 1.00, taille: 0.95 },
  { nom: 'FRONDE',        f: 'doubleRow', c: 'split',      stage: 9,  poids: 0.90, taille: 1.05 },
  { nom: 'ANNEAU BRISÉ',  f: 'circle',    c: 'split',      stage: 10, poids: 0.95, taille: 1.00 },
  { nom: 'VRILLE',        f: 'grid',      c: 'spiral',     stage: 11, poids: 0.95, taille: 1.05 },
  { nom: 'DIADÈME',       f: 'diamond',   c: 'zigzag',     stage: 12, poids: 0.90, taille: 1.05 },
  { nom: 'SPIRALE',       f: 'circle',    c: 'spiral',     stage: 13, poids: 1.00, taille: 1.00 },
  { nom: 'HERSE',         f: 'doubleRow', c: 'spiral',     stage: 14, poids: 0.90, taille: 1.10 },
  { nom: 'POINTE',        f: 'diamond',   c: 'curveLeft',  stage: 15, poids: 0.90, taille: 1.05 },
  { nom: 'ORBITE',        f: 'circle',    c: 'zigzag',     stage: 16, poids: 0.95, taille: 1.05 },
  { nom: 'ÉTAU',          f: 'diamond',   c: 'spiral',     stage: 17, poids: 0.95, taille: 1.10 },
  { nom: 'MURAILLE',      f: 'grid',      c: 'curveRight', stage: 18, poids: 0.90, taille: 1.15 },
  { nom: 'MAELSTRÖM',     f: 'circle',    c: 'curveRight', stage: 19, poids: 1.00, taille: 1.10 },
  { nom: 'JUGEMENT',      f: 'doubleRow', c: 'curveLeft',  stage: 20, poids: 1.00, taille: 1.15 }
];

/** Poids courant d'une composition : 0 si pas encore débloquée, majoré juste
 *  après son déblocage (nouveauté), puis stabilisé — jamais nul ensuite. */
function poidsComposition(comp, stageEq) {
  if (stageEq + 0.001 < comp.stage) return 0;
  const age = stageEq - comp.stage;                 // en stages
  const nouveaute = 1 + 1.9 * Math.exp(-age / 2.2); // ×2,9 le jour du déblocage
  return comp.poids * nouveaute;
}

/** Tirage pondéré d'une composition pour le stage courant.
 *  @param {object} m menace du stage
 *  @param {string} eviter nom d'une composition à éviter (anti-répétition) */
function tirerComposition(m, eviter) {
  const dispo = [];
  let total = 0;
  for (let i = 0; i < STAGE_COMPOSITIONS.length; i++) {
    const comp = STAGE_COMPOSITIONS[i];
    let w = poidsComposition(comp, m.stageEq);
    if (w <= 0) continue;
    if (eviter && comp.nom === eviter) w *= 0.12;   // on ne l'interdit pas, on la rend rare
    dispo.push({ comp: comp, w: w });
    total += w;
  }
  if (!dispo.length) return STAGE_COMPOSITIONS[0];

  let r = Math.random() * total;
  for (let i = 0; i < dispo.length; i++) {
    r -= dispo[i].w;
    if (r <= 0) return dispo[i].comp;
  }
  return dispo[dispo.length - 1].comp;
}

/** Une composition est-elle déjà débloquée ? (utilisé par le gouverneur pour
 *  empêcher les vagues de renfort de sortir une chorégraphie non débloquée) */
function compositionDebloquee(formation, choreographie, stageEq) {
  for (let i = 0; i < STAGE_COMPOSITIONS.length; i++) {
    const c = STAGE_COMPOSITIONS[i];
    if (c.f === formation && c.c === choreographie) return stageEq + 0.001 >= c.stage;
  }
  return true;   // combinaison inconnue de la table : on ne bloque pas
}

/* =============================================================================
 *  4. RANG DE FIN DE STAGE (S / A / B / C)
 *  Trois critères, deux points chacun : vitesse d'exécution, chaîne maximale,
 *  intégrité (zéro dégât). Le rang S EXIGE le sans-faute.
 * ========================================================================== */
function calculerRangStage(stats, m) {
  const budget = Math.max(1, (m && m.budget) || 20);
  // Temps « attendu » par ennemi du budget, plus l'installation de la première
  // vague. Calibré sur la cadence actuelle (~9 tirs/s) : à 1,9 s par ennemi,
  // hérité de l'ancienne cadence, le rang S était acquis d'office.
  const par = budget * 0.95 + 6;
  const t = Math.max(0.001, (stats.timeElapsed || 0) / 1000);
  const comboMax = TEMPO.COMBO_MAX || 8;

  let pts = 0;
  const ratioT = t / par;
  if (ratioT <= 0.80) pts += 2; else if (ratioT <= 1.05) pts += 1;

  const ratioC = (stats.combo || 0) / comboMax;
  if (ratioC >= 0.90) pts += 2; else if (ratioC >= 0.55) pts += 1;

  const hits = stats.hits || 0;
  if (hits === 0) pts += 2; else if (hits === 1) pts += 1;

  let lettre = 'C';
  if (pts >= 5 && hits === 0) lettre = 'S';
  else if (pts >= 4) lettre = 'A';
  else if (pts >= 2) lettre = 'B';

  return {
    lettre: lettre,
    points: pts,
    parfait: hits === 0,
    couleur: lettre === 'S' ? 'combo' : lettre === 'A' ? 'player' : lettre === 'B' ? 'neutral' : 'enemyElite',
    mention: lettre === 'S' ? 'SANS UNE ÉGRATIGNURE'
           : lettre === 'A' ? 'PROPRE'
           : lettre === 'B' ? 'CORRECT'
           : 'SURVÉCU'
  };
}

/* =============================================================================
 *  5. TRANSITIONS — huit séquences d'environ deux secondes
 * -----------------------------------------------------------------------------
 *  Chaque transition est une fiche : durée, profil de warp stellaire, fenêtres
 *  d'affichage du bilan et de l'annonce, une fonction `update` (déclenchement
 *  des impacts) et une fonction `draw` (la signature visuelle).
 *  TOUTES peignent le fond stellaire et la grille d'horizon du THÈME SUIVANT :
 *  la transition PRÉSENTE le décor à venir, elle ne le masque pas.
 * ========================================================================== */

/* ------------------------------------------------------------- petits outils */
function _trEase(x) { return smoothstep(clamp(x, 0, 1)); }
function _trDiag() { return Math.hypot(CANVAS_WIDTH, CANVAS_HEIGHT); }

/** Unité typographique des écrans de transition. Calée sur le PLUS PETIT côté :
 *  c'est la seule façon d'occuper l'écran aussi bien sur un 21/9 que sur un
 *  téléphone tenu à la verticale. */
function _trUnite() { return clamp(Math.min(CANVAS_WIDTH, CANVAS_HEIGHT) * 0.072, 24, 88); }

/** GROS TITRE de transition.
 *  Le texte plein de NEON.text tient à petite taille (les lignes de stats sont
 *  nettes), mais à 90 px le noyau quasi blanc + les quatre passes de bloom
 *  fondent la lettre en un pâté lumineux — constaté en capture sur « TERMINÉ »
 *  et sur la lettre du rang. On passe donc par la FONTE VECTORIELLE du HUD
 *  (UIKIT.vector, un seul tracé néon, épaisseur constante) : c'est net à
 *  n'importe quelle taille, et c'est la typographie du reste du jeu.
 *  Repli sur NEON.text (atténué) si menus.js n'est pas chargé. */
function _trTitre(c, str, cx, yCentre, taille, couleur, opts) {
  opts = opts || {};
  const alpha = (opts.alpha == null) ? 1 : opts.alpha;
  if (!c || alpha <= 0.01) return;

  if (typeof UIKIT !== 'undefined' && UIKIT && typeof UIKIT.vector === 'function') {
    // UIKIT.vector ancre le HAUT des capitales : on recentre.
    UIKIT.vector(c, str, cx, yCentre - taille / 2, taille, couleur, {
      align: 'center',
      tracking: taille * ((opts.tracking == null) ? 0.28 : opts.tracking),
      width: Math.max(1.3, taille * ((opts.trait == null) ? 0.075 : opts.trait)),
      alpha: alpha,
      glowScale: (opts.glowScale == null) ? 1 : opts.glowScale,
      passes: opts.passes
    });
    return;
  }

  NEON.text(c, str, cx, yCentre, couleur, {
    size: taille, align: 'center', baseline: 'middle', weight: opts.weight || 'bold',
    alpha: alpha * 0.75, glowScale: ((opts.glowScale == null) ? 1 : opts.glowScale) * 0.55
  });
}

/** Fond commun : étoiles (elles avancent en temps réel) — jamais d'aplat noir
 *  plein écran, qui écraserait les traînées. */
function _trFond() {
  try { if (typeof drawStars === 'function') drawStars(); } catch (e) { /* ignoré */ }
}

/** Grille d'horizon en perspective, aux couleurs du thème donné : c'est ELLE
 *  qui « présente » le décor suivant pendant la transition. */
function _trGrille(c, theme, alpha, phase, opts) {
  if (!c || alpha <= 0.01) return;
  opts = opts || {};
  const col = (theme && theme.grille) || 'player';
  const hy = CANVAS_HEIGHT * ((theme && theme.horizon) || 0.6);
  const W = CANVAS_WIDTH;
  const scale = opts.scale == null ? 1 : opts.scale;

  // Ligne d'horizon
  NEON.line(c, 0, hy, W, hy, col, 1.6 * scale, { alpha: alpha * 0.55, passes: 3 });

  // Version LÉGÈRE : utilisée quand la grille est redessinée plusieurs fois
  // dans la même frame (déchirure : une fois par tranche). Moitié moins de
  // traits, aucun intérêt à payer le plein tarif sous un masque.
  const leger = !!opts.leger;
  const nFuyantes = leger ? 5 : 11;
  const nTraverses = leger ? 4 : 8;

  // Fuyantes
  for (let i = 0; i <= nFuyantes; i++) {
    const u = (i / nFuyantes - 0.5) * 2;
    const x = W / 2 + u * W * 0.62;
    NEON.line(c, W / 2 + u * W * 0.075, hy, x, CANVAS_HEIGHT + 40, col, 1.1 * scale,
              { alpha: alpha * 0.22 * (1 - Math.abs(u) * 0.35), passes: 2 });
  }

  // Traverses : elles défilent vers le bas (perspective)
  for (let i = 0; i < nTraverses; i++) {
    const f = ((i / nTraverses) + (phase % 1) + 1) % 1;
    const y = hy + Math.pow(f, 2.4) * (CANVAS_HEIGHT - hy + 60);
    const k = Math.pow(f, 1.2);
    NEON.line(c, W / 2 - W * (0.08 + k * 0.75), y, W / 2 + W * (0.08 + k * 0.75), y,
              col, 1.0 * scale + k * 1.2, { alpha: alpha * 0.20 * (0.35 + k), passes: 2 });
  }
}

/** Étoiles étirées : de simples traits radiaux, l'illusion de vitesse pure. */
function _trVitesse(c, cx, cy, n, longueur, alpha, col, seed, largeur) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const r0 = _trDiag() * 0.06 + (i % 5) * 14;
    const r1 = r0 + longueur * (0.5 + ((i * 37) % 100) / 100);
    NEON.line(c, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0,
                 cx + Math.cos(a) * r1, cy + Math.sin(a) * r1,
              col, largeur == null ? 1.5 : largeur, { alpha: alpha, passes: 2 });
  }
}

const STAGE_TRANSITIONS = [
  /* ---------------------------------------------------------------- 1. WARP */
  {
    key: 'warp',
    nom: 'DISTORSION',
    duree: 1950,
    warpMax: 10,
    ship: true,
    update: function (st, p, dt) {
      if (p > 0.30 && !st.cue1) { st.cue1 = true; JUICE.kick(0, -5); JUICE.punch(0.018); gameEvent('uiBlip', {}); }
      if (p > 0.62 && !st.cue2) { st.cue2 = true; JUICE.shake(0.22); }
    },
    draw: function (c, st, p, ctxData) {
      const cx = CANVAS_WIDTH / 2, cy = CANVAS_HEIGHT / 2;
      _trFond();

      const k = _trEase((p - 0.12) / 0.55);
      _trVitesse(c, cx, cy, 34, _trDiag() * 0.55 * k, 0.16 + 0.30 * k,
                       ctxData.theme.accent, st.seed, 1.4);

      // Couloir : deux horizons qui s'écartent
      const spread = 40 + k * CANVAS_HEIGHT * 0.55;
      NEON.line(c, 0, cy - spread, CANVAS_WIDTH, cy - spread, 'player', 1.4, { alpha: 0.22, passes: 2 });
      NEON.line(c, 0, cy + spread, CANVAS_WIDTH, cy + spread, 'player', 1.4, { alpha: 0.22, passes: 2 });

      _trGrille(c, ctxData.theme, 0.55 * _trEase((p - 0.5) / 0.4), ctxData.t * 0.35);
      NEON.ring(c, cx, cy, 40 + k * CANVAS_WIDTH * 0.5, 2.5, 'player',
                { alpha: 0.40 * (1 - k), passes: 3 });
    }
  },

  /* -------------------------------------------------------------- 2. VORTEX */
  {
    key: 'vortex',
    nom: 'VORTEX',
    duree: 2050,
    warpMax: 5,
    ship: false,
    update: function (st, p, dt) {
      if (p > 0.24 && !st.cue1) { st.cue1 = true; gameEvent('diveAlert', {}); JUICE.shake(0.14); }
      if (p > 0.60 && !st.cue2) {
        st.cue2 = true;
        JUICE.hitstop(40); JUICE.punch(0.04); JUICE.shake(0.42);
        JUICE.flash(PALETTE.get(st.themeKey).glow, 200, 0.30);
        gameEvent('explosion', { size: 'big' });
      }
    },
    draw: function (c, st, p, ctxData) {
      const cx = CANVAS_WIDTH / 2, cy = CANVAS_HEIGHT * 0.48;
      _trFond();

      const aspir = _trEase(p / 0.62);          // aspiration
      const souffle = _trEase((p - 0.60) / 0.34); // relâchement
      const R = _trDiag() * 0.62;
      const rot = ctxData.t * 2.1 + p * 5.0;

      // Cinq bras spiralés : ils se resserrent, puis se dissolvent
      for (let b = 0; b < 5; b++) {
        const pts = [];
        for (let i = 0; i <= 26; i++) {
          const u = i / 26;
          const r = R * (1 - u) * (1 - aspir * 0.85) + souffle * R * u * 0.9;
          const a = rot + b * (Math.PI * 2 / 5) + u * 3.2;
          pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.82);
        }
        NEON.polyline(c, pts, ctxData.theme.accent, 1.8,
                      { alpha: (0.16 + 0.42 * aspir) * (1 - souffle * 0.85), passes: 3 });
      }

      // Noyau : il gonfle, puis explose en anneau
      const noyau = 6 + aspir * 26;
      NEON.dot(c, cx, cy, noyau * (1 - souffle), 'player',
               { alpha: 0.55 + 0.45 * aspir, glowScale: 1.6 });
      if (souffle > 0) {
        NEON.ring(c, cx, cy, souffle * _trDiag() * 0.62, 3.4 * (1 - souffle * 0.7),
                  ctxData.theme.accent, { alpha: 0.55 * (1 - souffle), passes: 4 });
      }

      _trGrille(c, ctxData.theme, 0.6 * souffle, ctxData.t * 0.4);
    }
  },

  /* ------------------------------------------------------------ 3. BALAYAGE */
  {
    key: 'balayage',
    nom: 'BALAYAGE',
    duree: 2000,
    warpMax: 3,
    ship: false,
    update: function (st, p, dt) {
      if (p > 0.18 && !st.cue1) { st.cue1 = true; gameEvent('uiBlip', {}); JUICE.kick(-6, 0); }
      if (p > 0.66 && !st.cue2) { st.cue2 = true; JUICE.shake(0.20); JUICE.punch(0.02); }
    },
    draw: function (c, st, p, ctxData) {
      const W = CANVAS_WIDTH, H = CANVAS_HEIGHT;
      const k = _trEase((p - 0.14) / 0.58);
      const x = -W * 0.12 + k * W * 1.24;      // position du rideau

      // Derrière le rideau (à gauche) : le NOUVEAU décor, déjà repeint.
      c.save();
      c.beginPath(); c.rect(0, 0, Math.max(0, x), H); c.clip();
      _trFond();
      _trGrille(c, ctxData.theme, 0.75, ctxData.t * 0.45);
      c.restore();

      // Devant le rideau (à droite) : l'ancien décor, éteint.
      c.save();
      c.beginPath(); c.rect(Math.max(0, x), 0, Math.max(0, W - x), H); c.clip();
      _trFond();
      _trGrille(c, ctxData.themePrec, 0.16, ctxData.t * 0.18, { scale: 0.8 });
      c.restore();

      // Le rideau lui-même : une lame de lumière + ses éclats
      if (x > -40 && x < W + 40) {
        NEON.beam(c, x - 3, -20, 6, H + 40, 'player', { alpha: 0.95, width: 2.4 });
        for (let i = 0; i < 9; i++) {
          const y = ((i * 137 + st.seed * 90) % 100) / 100 * H;
          const len = 40 + ((i * 53) % 90);
          NEON.line(c, x - len, y, x, y, ctxData.theme.accent, 1.6,
                    { alpha: 0.35, passes: 2 });
        }
      }
    }
  },

  /* ----------------------------------------------------------- 4. DÉCHIRURE */
  {
    key: 'dechirure',
    nom: 'DÉCHIRURE',
    duree: 1900,
    warpMax: 4,
    ship: false,
    update: function (st, p, dt) {
      if (p > 0.16 && !st.cue1) { st.cue1 = true; JUICE.hitstop(30); JUICE.shake(0.32); gameEvent('enemyHit', {}); }
      if (p > 0.34 && !st.cue2) { st.cue2 = true; JUICE.hitstop(26); JUICE.shake(0.26); }
      if (p > 0.70 && !st.cue3) { st.cue3 = true; JUICE.flash('#ffffff', 150, 0.22); JUICE.punch(0.03); }
    },
    draw: function (c, st, p, ctxData) {
      const W = CANVAS_WIDTH, H = CANVAS_HEIGHT;
      const N = 7;
      const ouverture = _trEase((p - 0.10) / 0.22);
      const recolle = _trEase((p - 0.34) / 0.46);
      const amp = W * 0.14 * ouverture * (1 - recolle);

      for (let i = 0; i < N; i++) {
        const y0 = i * H / N;
        const h = H / N + 1;
        const dx = Math.sin(i * 2.7 + st.seed * 6.28) * amp;

        c.save();
        c.beginPath(); c.rect(0, y0, W, h); c.clip();
        c.translate(dx, 0);
        _trFond();
        _trGrille(c, ctxData.theme, 0.30 + 0.45 * recolle, ctxData.t * 0.4, { leger: true });
        c.restore();

        // Bords de tranche : aberration chromatique « à la main »
        if (i > 0 && amp > 0.6) {
          const a = 0.30 * (1 - recolle) + 0.08;
          NEON.line(c, 0, y0, W, y0, 'player', 1.4, { alpha: a, passes: 2 });
          NEON.line(c, 0, y0 + 2, W, y0 + 2, 'enemyNormal', 1.2, { alpha: a * 0.8, passes: 2 });
        }
      }

      if (recolle > 0.02 && recolle < 0.99) {
        NEON.line(c, 0, H / 2, W, H / 2, 'player', 2.2 * (1 - recolle),
                  { alpha: 0.5 * (1 - recolle), passes: 3 });
      }
    }
  },

  /* -------------------------------------------------------- 5. ONDE DE CHOC */
  {
    key: 'onde',
    nom: 'ONDE DE CHOC',
    duree: 1950,
    warpMax: 6,
    ship: true,
    update: function (st, p, dt) {
      if (p > 0.10 && !st.cue1) {
        st.cue1 = true;
        JUICE.hitstop(55); JUICE.shake(0.55); JUICE.punch(0.045);
        JUICE.flash(PALETTE.get(st.themeKey).glow, 260, 0.35);
        gameEvent('explosion', { size: 'big' });
      }
      if (p > 0.48 && !st.cue2) { st.cue2 = true; JUICE.shake(0.18); }
    },
    draw: function (c, st, p, ctxData) {
      const W = CANVAS_WIDTH, H = CANVAS_HEIGHT;
      const ox = st.originX, oy = st.originY;
      const D = _trDiag() * 1.15;
      const front = _trEase((p - 0.08) / 0.60) * D;

      // À l'INTÉRIEUR du front : le décor déjà nettoyé (thème suivant).
      c.save();
      c.beginPath(); c.arc(ox, oy, Math.max(1, front), 0, Math.PI * 2); c.clip();
      _trFond();
      _trGrille(c, ctxData.theme, 0.72, ctxData.t * 0.5);
      c.restore();

      // À l'extérieur : l'ancien décor qui s'éteint.
      c.save();
      c.beginPath();
      c.rect(0, 0, W, H);
      c.arc(ox, oy, Math.max(1, front), 0, Math.PI * 2, true);
      c.clip();
      _trFond();
      _trGrille(c, ctxData.themePrec, 0.14, ctxData.t * 0.2, { scale: 0.8, leger: true });
      c.restore();

      // Les trois fronts
      for (let i = 0; i < 3; i++) {
        const r = front - i * D * 0.075;
        if (r <= 2) continue;
        const fade = clamp(1 - r / D, 0, 1);
        NEON.ring(c, ox, oy, r, (4.2 - i * 1.1) * fade + 0.6, i === 0 ? 'player' : ctxData.theme.accent,
                  { alpha: (0.75 - i * 0.22) * fade, passes: 4 });
      }
      if (front > 4 && front < D) {
        _trVitesse(c, ox, oy, 18, front * 0.22, 0.25 * (1 - front / D),
                         ctxData.theme.accent, st.seed, 1.2);
      }
    }
  },

  /* -------------------------------------------------------------- 6. PLONGÉE */
  {
    key: 'plongee',
    nom: 'PLONGÉE',
    duree: 2100,
    warpMax: 7,
    ship: true,
    update: function (st, p, dt) {
      if (p > 0.20 && !st.cue1) { st.cue1 = true; gameEvent('uiBlip', {}); }
      if (p > 0.74 && !st.cue2) {
        st.cue2 = true;
        JUICE.flash('#ffffff', 220, 0.42); JUICE.hitstop(45); JUICE.shake(0.38); JUICE.punch(0.05);
        gameEvent('explosion', {});
      }
    },
    draw: function (c, st, p, ctxData) {
      const cx = CANVAS_WIDTH / 2, cy = CANVAS_HEIGHT * 0.42;
      _trFond();

      const k = _trEase(p / 0.80);
      const R = CANVAS_HEIGHT * (0.03 + Math.pow(k, 2.3) * 1.55);
      const col = ctxData.theme.accent;
      const traverse = _trEase((p - 0.74) / 0.26);

      if (traverse < 0.98) {
        const a = (1 - traverse) * 0.9;
        // La planète : disque néon, anneau incliné, méridiens, terminateur
        NEON.circle(c, cx, cy, R, col, 2.2, { alpha: a * 0.85, passes: 4 });
        NEON.circle(c, cx, cy, R * 0.985, col, 1.0,
                    { alpha: a * 0.5, fill: true, fillAlpha: 0.10, passes: 2 });

        for (let i = 1; i <= 3; i++) {
          const rr = R * (i / 4);
          NEON.custom(c, function (path) {
            path.ellipse(cx, cy, R, rr, 0, 0, Math.PI * 2);
          }, col, 1.1, { alpha: a * 0.28, passes: 2 });
          NEON.custom(c, function (path) {
            path.ellipse(cx, cy, rr, R, 0, 0, Math.PI * 2);
          }, col, 1.1, { alpha: a * 0.20, passes: 2 });
        }

        // Anneau planétaire
        NEON.custom(c, function (path) {
          path.ellipse(cx, cy, R * 1.55, R * 0.30, -0.42, 0, Math.PI * 2);
        }, 'player', 1.8, { alpha: a * 0.45, passes: 3 });

        // Terminateur : le croissant éclairé
        NEON.custom(c, function (path) {
          path.arc(cx, cy, R * 0.96, -Math.PI * 0.62, Math.PI * 0.18);
        }, 'playerCore', 2.6, { alpha: a * 0.55, passes: 3 });
      }

      if (traverse > 0) {
        _trVitesse(c, cx, cy, 30, _trDiag() * 0.6 * traverse, 0.35 * (1 - traverse * 0.4),
                         'player', st.seed, 1.6);
      }
      _trGrille(c, ctxData.theme, 0.62 * traverse, ctxData.t * 0.5);
    }
  },

  /* ------------------------------------------------------------------ 7. IRIS */
  {
    key: 'iris',
    nom: 'IRIS',
    duree: 1950,
    warpMax: 3,
    ship: false,
    update: function (st, p, dt) {
      if (p > 0.46 && !st.cue1) {
        st.cue1 = true;
        JUICE.hitstop(50); JUICE.shake(0.30);
        JUICE.flash(PALETTE.get(st.themeKey).glow, 240, 0.30);
        gameEvent('uiBlip', {});
      }
    },
    draw: function (c, st, p, ctxData) {
      const W = CANVAS_WIDTH, H = CANVAS_HEIGHT;
      const cx = W / 2, cy = H / 2;
      const Rmax = _trDiag() * 0.56;

      const ferme = _trEase((p - 0.06) / 0.40);
      const ouvre = _trEase((p - 0.52) / 0.40);
      const R = Math.max(2, Rmax * (1 - ferme) + Rmax * ouvre);

      // Le décor : ancien pendant la fermeture, NOUVEAU dès la réouverture
      const nouveau = (p >= 0.50);
      _trFond();
      _trGrille(c, nouveau ? ctxData.theme : ctxData.themePrec,
                     nouveau ? 0.70 * ouvre : 0.20, ctxData.t * 0.4);

      // Masque : tout ce qui est HORS de l'iris est éteint (noir profond).
      c.save();
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = PALETTE.bg.deep;
      c.beginPath();
      c.rect(0, 0, W, H);
      c.arc(cx, cy, R, 0, Math.PI * 2, true);
      c.fill('evenodd');
      c.restore();

      // Le diaphragme : anneau + douze lamelles
      NEON.ring(c, cx, cy, R, 2.6, ctxData.theme.accent, { alpha: 0.8, passes: 4 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + (ferme - ouvre) * 0.6;
        NEON.line(c, cx + Math.cos(a) * R, cy + Math.sin(a) * R,
                     cx + Math.cos(a + 0.42) * (R + 26 + 18 * ferme),
                     cy + Math.sin(a + 0.42) * (R + 26 + 18 * ferme),
                  ctxData.theme.accent, 1.6, { alpha: 0.35, passes: 2 });
      }
      if (ferme > 0.9 && ouvre < 0.1) {
        NEON.dot(c, cx, cy, 10 + 8 * Math.sin(ctxData.t * 12), 'player', { alpha: 0.9, glowScale: 2 });
      }
    }
  },

  /* ----------------------------------------------------------- 8. EFFONDREMENT */
  {
    key: 'effondrement',
    nom: 'EFFONDREMENT',
    duree: 2050,
    warpMax: 8,
    ship: false,
    update: function (st, p, dt) {
      if (p > 0.20 && !st.cue1) { st.cue1 = true; gameEvent('diveAlert', {}); }
      if (p > 0.58 && !st.cue2) {
        st.cue2 = true;
        JUICE.hitstop(70); JUICE.shake(0.7); JUICE.punch(0.06);
        JUICE.flash('#ffffff', 300, 0.5);
        gameEvent('explosion', { size: 'big' });
      }
    },
    draw: function (c, st, p, ctxData) {
      const cx = CANVAS_WIDTH / 2, cy = CANVAS_HEIGHT / 2;
      _trFond();

      const conv = _trEase(p / 0.58);
      const boom = _trEase((p - 0.58) / 0.40);
      const D = _trDiag() * 0.62;

      if (boom < 0.99) {
        for (let i = 0; i < 40; i++) {
          const a = (i / 40) * Math.PI * 2 + st.seed * 3.1;
          const r = D * (1 - Math.pow(conv, 1.7)) * (0.55 + ((i * 29) % 45) / 100);
          const traine = 26 + conv * 120;
          NEON.line(c, cx + Math.cos(a) * (r + traine), cy + Math.sin(a) * (r + traine),
                       cx + Math.cos(a) * r, cy + Math.sin(a) * r,
                    i % 3 === 0 ? 'player' : ctxData.theme.accent, 1.6,
                    { alpha: (0.20 + 0.55 * conv) * (1 - boom), passes: 2 });
        }
        NEON.dot(c, cx, cy, 4 + conv * 30 * (1 - boom), 'playerCore',
                 { alpha: 0.6 + 0.4 * conv, glowScale: 1.8 });
      }

      if (boom > 0) {
        for (let i = 0; i < 3; i++) {
          const r = (boom - i * 0.10) * D * 1.7;
          if (r <= 0) continue;
          NEON.ring(c, cx, cy, r, 4 - i, i === 0 ? 'player' : ctxData.theme.accent,
                    { alpha: 0.7 * (1 - boom), passes: 4 });
        }
        _trVitesse(c, cx, cy, 26, D * boom * 0.9, 0.4 * (1 - boom),
                         ctxData.theme.accent, st.seed, 1.8);
      }

      _trGrille(c, ctxData.theme, 0.65 * boom, ctxData.t * 0.55);
    }
  }
];

/** Index d'une transition par clé (jamais -1 : repli sur 0). */
function _trIndex(key) {
  for (let i = 0; i < STAGE_TRANSITIONS.length; i++) if (STAGE_TRANSITIONS[i].key === key) return i;
  return 0;
}

/* =============================================================================
 *  6. LE SYSTÈME DE STAGES
 * ========================================================================== */

const stageSystem = {
  currentStage: 1,
  maxStage: PROGRESSION.MAX_STAGE,        // 20 (était 10)
  loopCount: 0,                           // 0 = première boucle
  stageCompleted: false,
  transitionActive: false,
  transitionProgress: 0,
  transitionDuration: TEMPO.STAGE_TRANSITION_MS,   // écrasé par la fiche de transition
  stageStartTime: 0,                      // ms de TEMPS DE JEU (FRAME.time × 1000)
  enemiesPerStage: 14,                    // recalculé par la menace dans initStage()
  enemiesDefeated: 0,

  // Statistiques du stage en cours (lues par la transition pour le rang)
  stageStats: {
    score: 0,
    combo: 0,
    timeElapsed: 0,
    hits: 0                               // dégâts encaissés : 0 => rang S possible
  },
  lastRank: null,                         // dernier rang attribué (objet)

  // Accélération du fond stellaire pendant la transition (lu par stars.js)
  starSpeedMultiplier: 1,
  maxStarSpeedMultiplier: 10,

  // Vaisseau qui quitte l'écran pendant la transition. `speed` est en PX/SECONDE.
  shipTransition: { active: false, x: 0, y: 0, targetY: 0, speed: 1600 },

  // 'none' | 'stageComplete' | 'speedUp' | 'shipMove' | 'stageBegin'  (compat)
  transitionPhase: 'none',

  // Transition en cours (fiche + état volatil)
  transition: null,
  transitionState: null,
  _bag: [],                               // sac de tirage sans répétition
  _lastTransitionKey: '',

  // Composition de la dernière vague d'ouverture (anti-répétition)
  lastComposition: '',

  // Boss
  bossActive: false,
  bossDefeated: false,
  bossIndex: -1,
  _bossSeen: false,
  _bossGraceMs: 0,

  /* ==================================================================== menace */

  /** Menace du stage courant (objet complet, mis en cache). */
  menace() {
    return menaceFor(this.currentStage, this.loopCount);
  },

  /** Menace d'un stage arbitraire — pratique pour les autres modules. */
  menaceAt(stage, loop) {
    return menaceFor(stage, loop == null ? this.loopCount : loop);
  },

  /** Thème de décor du stage courant (ou d'un stage donné). */
  theme(stage, loop) {
    if (stage == null) return this.menace().theme;
    return stageThemeFor(stage, loop == null ? this.loopCount : loop);
  },
  currentTheme() { return this.menace().theme; },

  /** Libellé « 3-2 » : stage 3, boucle 2. */
  stageLabel(stage, loop) {
    const s = (stage == null) ? this.currentStage : stage;
    const l = (loop == null) ? this.loopCount : loop;
    return s + '-' + (l + 1);
  },

  /** Stage suivant (et boucle suivante) sans rien modifier. */
  nextStageInfo() {
    let s = this.currentStage + 1;
    let l = this.loopCount;
    if (s > this.maxStage) { s = 1; l++; }
    return { stage: s, loop: l };
  },

  isBossStage(stage) {
    return estStageDeBoss(stage == null ? this.currentStage : stage);
  },

  /* ==================================================================== stats */
  resetStageStats() {
    this.stageStats.score = 0;
    this.stageStats.combo = 0;
    this.stageStats.timeElapsed = 0;
    this.stageStats.hits = 0;
    // CONVENTION : horloge de JEU, jamais Date.now() (corrige stages.js:170).
    this.stageStartTime = FRAME.time * 1000;
    this.enemiesDefeated = 0;
    this.stageCompleted = false;
  },

  /** Temps écoulé dans le stage courant, en ms de temps de JEU. */
  stageElapsedMs() {
    return Math.max(0, FRAME.time * 1000 - this.stageStartTime);
  },

  /** Appelé par le gouverneur quand le joueur encaisse : sert au rang. */
  notePlayerHit() {
    if (this.stageStats) this.stageStats.hits = (this.stageStats.hits || 0) + 1;
  },

  /* ------------------------------------------------------- démarrer un stage */
  initStage() {
    try {
      installStageGovernor();                        // idempotent

      const m = this.menace();

      this.enemiesPerStage = m.budget;
      applyMenaceToTempo(m);                    // densité de champ, plongées, balles

      // `enemySpeed` est l'ancien scalaire hérité : il repart à 1 et gagne +0.2
      // par vague survivante (game.js). getFormationSpeed() en fait un bonus.
      enemySpeed = 1;
      enemyDirection = Math.random() < 0.5 ? -1 : 1;
      enemyShotTimer = 1200;

      playerBullets = [];
      enemyBullets = [];
      explosions = [];
      powerUps = [];

      this.resetStageStats();

      this.transitionActive = false;
      this.transitionProgress = 0;
      this.starSpeedMultiplier = 1;
      this.transitionPhase = 'none';
      this.shipTransition.active = false;

      this.bossActive = false;
      this.bossDefeated = false;
      this.bossIndex = m.boss ? m.bossIndex : -1;
      this._bossSeen = false;
      this._bossGraceMs = 0;

      // Le joueur repart au centre bas.
      if (typeof player !== 'undefined' && player) {
        player.x = CANVAS_WIDTH / 2 - player.width / 2;
        player.y = CANVAS_HEIGHT - player.height - 48;
      }

      const created = createEnemiesForStage(this.currentStage);
      if (!created && !this.bossActive) {
        console.warn("Utilisation de la méthode alternative de création d'ennemis");
        this.createSimpleEnemies();
      }

      if (typeof stars === 'undefined' || !stars || stars.length === 0) {
        if (typeof createStars === 'function') createStars();
      }

      // Narration : purement optionnelle, jamais bloquante.
      try {
        if (typeof playRandomNarration === 'function' &&
            typeof audioConfig !== 'undefined' && audioConfig && audioConfig.soundEnabled) {
          playRandomNarration();
        }
      } catch (e) { /* ignoré : l'audio ne doit jamais casser un stage */ }

      gameState = "playing";
      isPaused = false;
    } catch (e) {
      console.error("Erreur lors de l'initialisation du stage:", e);
      gameState = "menu";
    }
  },

  /* --------------------------------------------- secours : formation minimale */
  createSimpleEnemies() {
    enemies = [];
    waveGraceMs = 1100;          // même accalmie d'arrivée que createFormation

    const m = this.menace();
    const spacing = clamp(CANVAS_WIDTH / 14, 58, 92);
    const cols = clamp(Math.floor((CANVAS_WIDTH - 120) / spacing), 3, 7);
    const rows = clamp(Math.round(m.premiereVague / cols), 1, 3);
    const centerX = CANVAS_WIDTH / 2;
    const topY = clamp(CANVAS_HEIGHT * 0.13, 80, 160);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Répartition pilotée par la menace : au stage 1, que du 'normal'.
        const type = tirerTypeSelonMenace(m);
        const cx = centerX + (col - (cols - 1) / 2) * spacing;
        const cy = topY + row * spacing * 0.9;
        const e = createEnemy(0, 0, type, this.currentStage, ENEMY_PATTERNS.FORMATION);
        e.formationX = cx - e.width / 2;
        e.formationY = cy - e.height / 2;
        e.startX = e.formationX;
        e.startY = e.formationY;
        e.x = e.formationX;
        e.y = e.formationY;
        e.formationIndex = row * cols + col;
        e.phase = e.formationIndex * 0.5;
        e.hasEntered = true;
        e.entryProgress = 1;
        enemies.push(e);
      }
    }
  },

  /* ====================================================================== boss */

  /** Le module boss (ou n'importe qui) signale que le boss est mort. */
  notifyBossDefeated(info) {
    if (!this.bossActive) return;
    this.bossActive = false;
    this.bossDefeated = true;

    try {
      JUICE.preset('bigKill');
      JUICE.flash(PALETTE.get('player').glow, 420, 0.45);
      JUICE.shake(0.8);
      gameEvent('explosion', { size: 'boss', info: info || null });
    } catch (e) { /* ignoré */ }

    // Le budget du stage est immédiatement soldé : game.js enchaîne sur la
    // fin de stage à la frame suivante (c'est SA logique, on ne la double pas).
    this.enemiesDefeated = this.enemiesPerStage;
  },

  /** Le boss est-il encore vivant ? true / false / null (indéterminable). */
  _bossAlive() {
    try {
      if (typeof BOSS !== 'undefined' && BOSS) {
        // API de js/entities/boss.js : isDefeated() ne passe à true qu'À LA FIN
        // de l'agonie. On laisse donc l'explosion se jouer avant de solder le
        // stage, ce qui est exactement le bon moment de lecture.
        if (typeof BOSS.isDefeated === 'function' && BOSS.isDefeated()) return false;
        if (typeof BOSS.isActive === 'function') return !!BOSS.isActive();
        if (typeof BOSS.isAlive === 'function') return !!BOSS.isAlive();
        if (typeof BOSS.active === 'boolean') return BOSS.active;
        if (BOSS.current) return !(BOSS.current.isDeleted || BOSS.current.hp <= 0);
      }
    } catch (e) { /* ignoré */ }
    try {
      if (typeof boss !== 'undefined' && boss) {
        return !(boss.isDeleted || (typeof boss.hp === 'number' && boss.hp <= 0));
      }
    } catch (e) { /* ignoré */ }
    return null;
  },

  /* ------------------------------------------------------------------- tick
   *  Appelé UNE fois par frame par le gouverneur (enveloppe de updateEnemies).
   *  C'est le seul endroit où stages.js observe la partie en cours. */
  tick(dtMs) {
    if (!(dtMs > 0)) return;
    if (this.transitionActive) return;

    this.stageStats.timeElapsed = this.stageElapsedMs();

    if (!this.bossActive) return;

    // Tant que le boss vit, le stage NE PEUT PAS se terminer : on garde le
    // compteur de kills juste sous le budget (les escortes continuent d'arriver).
    if (this.enemiesDefeated >= this.enemiesPerStage) {
      this.enemiesDefeated = Math.max(0, this.enemiesPerStage - 1);
    }

    // Surveillance du module boss : s'il expose son état, on s'en sert ;
    // sinon on attend notifyBossDefeated().
    this._bossGraceMs += dtMs;
    const vivant = this._bossAlive();
    if (vivant === true) {
      this._bossSeen = true;
    } else if (vivant === false && this._bossSeen) {
      this.notifyBossDefeated({ source: 'poll' });
    } else if (vivant === null && !this._bossSeen && this._bossGraceMs > 30000) {
      // Le module boss n'expose AUCUN état observable et n'a jamais appelé
      // notifyBossDefeated() : on ne fait pas gagner le stage d'office (ce
      // serait pire), on le repasse simplement en stage normal — le joueur
      // reste maître de sa progression au lieu d'être bloqué à vie.
      console.warn('stages.js : aucun état de boss détectable après 30 s. ' +
                   'Le module boss doit appeler stageSystem.notifyBossDefeated() ' +
                   'ou exposer BOSS.isAlive(). Stage repassé en mode normal.');
      this.bossActive = false;
    }
  },

  /* --------------------------------------------------- lancer la transition */
  startTransition() {
    if (this.transitionActive) return;

    playerBullets = [];
    enemyBullets = [];

    const m = this.menace();
    const suivant = this.nextStageInfo();

    this.stageStats.timeElapsed = this.stageElapsedMs();
    this.lastRank = calculerRangStage(this.stageStats, m);

    const fiche = this.pickTransition(m);
    this.transition = fiche;
    this.transitionDuration = fiche.duree;

    const px = (typeof player !== 'undefined' && player) ? player.x : CANVAS_WIDTH / 2;
    const py = (typeof player !== 'undefined' && player) ? player.y : CANVAS_HEIGHT - 80;
    const ph = (typeof player !== 'undefined' && player) ? player.height : 24;
    const pw = (typeof player !== 'undefined' && player) ? player.width : 40;

    this.transitionState = {
      seed: Math.random(),
      originX: px + pw / 2,
      originY: py + ph / 2,
      themeKey: stageThemeFor(suivant.stage, suivant.loop).accent,
      cue1: false, cue2: false, cue3: false
    };

    this.transitionActive = true;
    this.transitionProgress = 0;
    this.transitionPhase = 'stageComplete';
    this.starSpeedMultiplier = 1;

    this.shipTransition = {
      active: false,
      x: px, y: py,
      targetY: -ph - 40,
      speed: 1600            // px/s : ~640 ms pour traverser l'écran
    };

    try {
      JUICE.preset('stageClear');
      gameEvent('stageClear', { stage: this.currentStage, loop: this.loopCount, rang: this.lastRank.lettre });
    } catch (e) { /* ignoré */ }

    // Le gameplay est figé, mais main.js laisse la transition avancer.
    isPaused = true;
  },

  /** Tirage d'une transition SANS répétition : sac mélangé de huit fiches.
   *  Après un stage de boss, l'onde de choc est imposée (l'explosion finale
   *  nettoie l'écran — c'est la lecture juste du moment). */
  pickTransition(m) {
    if (m && m.boss) {
      const onde = STAGE_TRANSITIONS[_trIndex('onde')];
      this._lastTransitionKey = onde.key;
      // On retire l'onde du sac pour ne pas la revoir tout de suite après.
      for (let i = this._bag.length - 1; i >= 0; i--) {
        if (this._bag[i] === onde.key) this._bag.splice(i, 1);
      }
      return onde;
    }

    if (!this._bag.length) {
      this._bag = STAGE_TRANSITIONS.map(function (t) { return t.key; });
      // Mélange de Fisher-Yates
      for (let i = this._bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = this._bag[i]; this._bag[i] = this._bag[j]; this._bag[j] = tmp;
      }
      // Jamais deux fois de suite la même à cheval sur deux sacs.
      if (this._bag.length > 1 && this._bag[0] === this._lastTransitionKey) {
        this._bag.push(this._bag.shift());
      }
    }

    const key = this._bag.shift();
    this._lastTransitionKey = key;
    return STAGE_TRANSITIONS[_trIndex(key)];
  },

  /* -------------------------------------------------- avancer la transition */
  updateTransition(deltaTime) {
    if (!this.transitionActive) return;

    // Convention : un delta nul (hitstop, pause) ne fait RIEN. Surtout pas de
    // repli à 16 ms, qui casserait le hitstop et le pas de temps variable.
    const dtMs = (deltaTime > 0) ? deltaTime : 0;
    const dt = dtMs / 1000;
    if (dt <= 0) return;

    const fiche = this.transition || STAGE_TRANSITIONS[0];
    const dur = (this.transitionDuration > 0) ? this.transitionDuration : TEMPO.STAGE_TRANSITION_MS;
    this.transitionProgress += dtMs / dur;

    if (this.transitionProgress > 2.5) {
      console.warn("Progression anormale détectée, forçage de la fin de transition");
      this.forceCompleteTransition();
      return;
    }

    const p = clamp(this.transitionProgress, 0, 1);
    const st = this.transitionState || {};

    // Phases historiques (conservées : d'autres modules peuvent les lire)
    this.transitionPhase = (p < 0.30) ? 'stageComplete'
                         : (p < 0.48) ? 'speedUp'
                         : (p < 0.72) ? 'shipMove'
                         : 'stageBegin';

    // Profil de warp stellaire : montée puis retour au calme.
    const cible = 1 + (fiche.warpMax - 1) * Math.sin(clamp(p, 0, 1) * Math.PI);
    this.starSpeedMultiplier = clamp(
      approach(this.starSpeedMultiplier, cible, dt * 26),
      1, this.maxStarSpeedMultiplier
    );

    // Vaisseau : il s'arrache pendant le deuxième tiers, si la fiche le prévoit.
    if (fiche.ship) {
      if (!this.shipTransition.active && p > 0.34 && this.shipTransition.y > this.shipTransition.targetY) {
        this.shipTransition.active = true;
      }
      if (this.shipTransition.active) {
        this.shipTransition.y -= this.shipTransition.speed * dt;   // PX/SECONDE
        if (this.shipTransition.y <= this.shipTransition.targetY) this.shipTransition.active = false;
      }
    }

    // Impacts propres à la transition (hitstop, flash, bruitages)
    try { if (fiche.update) fiche.update(st, p, dt); } catch (e) { /* ignoré */ }

    if (this.transitionProgress >= 0.995) {
      this.completeTransition();
      return;
    }

    if (typeof updateStarsTransition === 'function') {
      try { updateStarsTransition(dtMs); } catch (e) { /* ignoré */ }
    }
  },

  completeTransition() {
    try {
      this.goToNextStage();
    } catch (e) {
      console.error("Erreur lors du passage au stage suivant:", e);
      this.forceNextStage();
    } finally {
      this.resetTransitionState();
    }
  },

  forceCompleteTransition() {
    console.warn("Forçage de la fin de transition");
    this.forceNextStage();
    this.resetTransitionState();
  },

  resetTransitionState() {
    this.transitionActive = false;
    this.transitionProgress = 0;
    this.transitionPhase = 'none';
    this.starSpeedMultiplier = 1;
    this.transition = null;
    this.transitionState = null;
    if (this.shipTransition) this.shipTransition.active = false;
    isPaused = false;
  },

  /** Avance d'un stage. Au-delà du stage 20 : boucle suivante, menace cumulée. */
  goToNextStage() {
    this.currentStage++;
    if (this.currentStage > this.maxStage) {
      this.currentStage = 1;
      this.loopCount++;                       // ⇦ la difficulté NE REPART PLUS À ZÉRO
      try {
        JUICE.flash(PALETTE.get('enemyElite').glow, 520, 0.4);
        JUICE.shake(0.5);
        gameEvent('extraLife', { loop: this.loopCount });
      } catch (e) { /* ignoré */ }
    }

    this.stageCompleted = false;
    this.enemiesDefeated = 0;

    this.initStage();
    this.announceStage();
  },

  forceNextStage() {
    console.warn("Utilisation de la méthode de secours pour passer au stage suivant");

    enemies = [];
    playerBullets = [];
    enemyBullets = [];
    explosions = [];
    powerUps = [];

    this.currentStage++;
    if (this.currentStage > this.maxStage) { this.currentStage = 1; this.loopCount++; }

    this.stageCompleted = false;
    this.enemiesDefeated = 0;
    isPaused = false;

    if (typeof player !== 'undefined' && player) {
      player.x = CANVAS_WIDTH / 2 - (player.width || 40) / 2;
      player.y = CANVAS_HEIGHT - (player.height || 20) - 48;
    }

    try {
      this.initStage();
      this.announceStage();
    } catch (e) {
      console.error("Échec critique lors de l'initialisation forcée du stage:", e);
      gameState = "menu";
    }
  },

  /** Annonce d'un NOUVEAU stage. game.js ne déclenche 'stageStart' qu'au tout
   *  premier stage (initGame) : on complète ici pour les stages suivants, sans
   *  jamais doubler. */
  announceStage() {
    try {
      if (typeof JUICE !== 'undefined' && JUICE.preset) JUICE.preset('stageStart');
      if (typeof gameEvent === 'function') {
        gameEvent('stageStart', {
          stage: this.currentStage,
          loop: this.loopCount,
          boss: this.isBossStage()
        });
      }
      if (typeof setStarWarp === 'function') setStarWarp(4, 320);
    } catch (e) { /* ignoré */ }
  },

  /* ========================================================= rendu de la transition */
  drawTransition() {
    if (!this.transitionActive) return;

    const c = ctx;
    if (!c) return;

    const fiche = this.transition || STAGE_TRANSITIONS[0];
    const st = this.transitionState || { seed: 0, originX: CANVAS_WIDTH / 2, originY: CANVAS_HEIGHT / 2 };
    const p = clamp(this.transitionProgress, 0, 1);
    const suivant = this.nextStageInfo();

    const data = {
      t: FRAME.time,
      theme: stageThemeFor(suivant.stage, suivant.loop),
      themePrec: stageThemeFor(this.currentStage, this.loopCount),
      suivant: suivant
    };

    // Signature de la transition (elle peint aussi le fond : chacune a sa
    // manière de découper l'écran, on ne peut pas mutualiser le fond).
    try {
      fiche.draw(c, st, p, data);
    } catch (e) {
      console.error('Erreur dans la transition ' + fiche.key + ' :', e);
      _trFond();
    }

    // Bilan du stage terminé (rang), puis annonce du stage suivant.
    this.drawStageReport(c, p);
    this.drawNextBanner(c, p, data);

    // Vaisseau qui s'arrache vers le haut
    if (this.shipTransition && this.shipTransition.active) {
      this.drawTransitionShip(c);
    }
  },

  /** Bilan : STAGE X-Y TERMINÉ, rang, score, combo, temps.
   *  MISE EN PAGE : tout dérive d'une UNITÉ `u` calée sur le PLUS PETIT côté de
   *  l'écran. L'ancienne version se calait sur la largeur et plafonnait à 56 px :
   *  sur un écran large, le bilan était un timbre-poste perdu au milieu, et le
   *  disque du rang chevauchait le mot TERMINÉ (constaté en capture). */
  drawStageReport(c, p) {
    const a = _trEase(p / 0.10) * (1 - _trEase((p - 0.44) / 0.14));
    if (a <= 0.01) return;

    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT * 0.44;
    const u = _trUnite();
    const rang = this.lastRank || calculerRangStage(this.stageStats, this.menace());
    const pop = _trEase((p - 0.10) / 0.12);

    /* --- en-tête ---------------------------------------------------------- */
    _trTitre(c, 'STAGE ' + this.stageLabel(), cx, cy - u * 2.50, u, 'player',
             { alpha: a * 0.92, glowScale: 1.0 });
    _trTitre(c, 'TERMINÉ', cx, cy - u * 1.52, u * 0.46, 'combo',
             { alpha: a * 0.80, glowScale: 0.9, tracking: 0.42, trait: 0.085 });

    /* --- le RANG : une lettre, énorme, dans son sceau --------------------- */
    const ry = cy + u * 0.22;
    const rs = u * (1.45 + 0.30 * (1 - pop));
    const anneau = u * 1.18;
    NEON.ring(c, cx, ry, anneau, 2.2, rang.couleur, { alpha: a * pop * 0.5, passes: 3 });
    if (pop < 0.99) {
      // Onde d'apparition : le sceau se referme sur la lettre.
      NEON.ring(c, cx, ry, anneau * (1 + (1 - pop) * 1.8), 2.6, rang.couleur,
                { alpha: a * (1 - pop) * 0.55, passes: 3 });
    }
    // Quatre encoches : le sceau se lit comme un médaillon, pas comme un rond.
    for (let i = 0; i < 4; i++) {
      const ang = Math.PI / 4 + i * Math.PI / 2;
      NEON.line(c, cx + Math.cos(ang) * anneau * 0.96, ry + Math.sin(ang) * anneau * 0.96,
                   cx + Math.cos(ang) * anneau * 1.22, ry + Math.sin(ang) * anneau * 1.22,
                rang.couleur, 2.0, { alpha: a * pop * 0.45, passes: 2 });
    }
    _trTitre(c, rang.lettre, cx, ry, rs, rang.couleur,
             { alpha: a * pop, glowScale: 1.25, trait: 0.09 });
    NEON.text(c, rang.mention, cx, ry + u * 1.62, rang.couleur, {
      size: u * 0.30, align: 'center', baseline: 'middle', weight: 'normal',
      alpha: a * pop * 0.78, glowScale: 0.5, font: PALETTE.ui.fontMono
    });

    /* --- les chiffres ----------------------------------------------------- */
    const rows = [
      'SCORE  ' + (this.stageStats.score | 0),
      'COMBO  x' + (this.stageStats.combo | 0),
      'TEMPS  ' + Math.floor((this.stageStats.timeElapsed || 0) / 1000) + 's',
      'DÉGÂTS ' + (this.stageStats.hits | 0)
    ];
    const ligne = u * 0.46;
    for (let i = 0; i < rows.length; i++) {
      const ra = clamp((p - 0.06 - i * 0.035) / 0.09, 0, 1) * a;
      NEON.text(c, rows[i], cx, ry + u * 2.28 + i * ligne, 'ui', {
        size: u * 0.30, align: 'center', baseline: 'middle', alpha: ra * 0.8,
        font: PALETTE.ui.fontMono, weight: 'normal', glowScale: 0.6
      });
    }
  },

  /** Annonce : STAGE X-Y (+ nom du thème, + AVERTISSEMENT BOSS), jauge. */
  drawNextBanner(c, p, data) {
    const a = _trEase((p - 0.56) / 0.16);
    if (a <= 0.01) return;

    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT * 0.46;
    const size = _trUnite() * 1.42;      // même unité que le bilan, en plus gros
    const t = FRAME.time;
    const suivant = data.suivant;
    const boss = estStageDeBoss(suivant.stage);
    const label = suivant.stage + '-' + (suivant.loop + 1);

    _trTitre(c, 'STAGE ' + label, cx, cy - size * 0.1, size * (0.85 + 0.15 * a),
             boss ? 'enemyElite' : 'player', { alpha: 0.35 + 0.6 * a, glowScale: 1.1 });

    // Deux liserés qui s'écartent du titre : le regard est amené au centre.
    const ec = size * (0.9 + 2.6 * a);
    for (let i = -1; i <= 1; i += 2) {
      NEON.line(c, cx + i * ec, cy - size * 0.1, cx + i * (ec + size * 2.2), cy - size * 0.1,
                boss ? 'enemyElite' : 'player', 1.6, { alpha: a * 0.35, passes: 2 });
    }

    NEON.text(c, data.theme.nom, cx, cy + size * 0.80, data.theme.accent, {
      size: size * 0.24, align: 'center', baseline: 'middle', weight: 'normal',
      alpha: a * 0.75, glowScale: 0.5, font: PALETTE.ui.fontMono
    });

    if (boss) {
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(t * 6));
      _trTitre(c, 'ALERTE - BOSS', cx, cy + size * 1.24, size * 0.30, 'enemyElite',
               { alpha: a * pulse, glowScale: 1.1, tracking: 0.40 });
    } else {
      _trTitre(c, 'PRÊT ?', cx, cy + size * 1.24, size * 0.28, 'combo',
               { alpha: a * (0.45 + 0.35 * Math.abs(Math.sin(t * 4))), glowScale: 0.9, tracking: 0.40 });
    }

    // Jauge de départ
    const barW = clamp(CANVAS_WIDTH * 0.30, 180, 620);
    const by = cy + size * 1.78;
    const k = _trEase((p - 0.58) / 0.40);
    NEON.line(c, cx - barW / 2, by, cx + barW / 2, by, 'ui', 1.2, { alpha: a * 0.20, passes: 2 });
    NEON.line(c, cx - barW / 2, by, cx - barW / 2 + barW * k, by,
              boss ? 'enemyElite' : 'player', 2.4, { alpha: a * 0.9, passes: 3 });

    // Boucle : discret, mais toujours lisible.
    if (this.loopCount > 0 || suivant.loop > 0) {
      NEON.text(c, 'BOUCLE ' + (suivant.loop + 1) + '  ×' +
                   (Math.round(menaceFor(suivant.stage, suivant.loop).menace * 10) / 10),
                cx, by + size * 0.42, 'enemyFast', {
        size: size * 0.20, align: 'center', baseline: 'middle', weight: 'normal',
        alpha: a * 0.7, glowScale: 0.5, font: PALETTE.ui.fontMono
      });
    }
  },

  /** Le vaisseau du joueur, en vecteur, avec sa plume de réacteur et sa traînée. */
  drawTransitionShip(c) {
    const st = this.shipTransition;
    const w = (typeof player !== 'undefined' && player && player.width) ? player.width : 40;
    const h = (typeof player !== 'undefined' && player && player.height) ? player.height : 22;
    const cx = st.x + w / 2;
    const top = st.y;
    const bot = st.y + h;
    const t = FRAME.time;

    // Traînée persistante dans le buffer NEON
    if (RENDER_CONFIG.trails && NEON.trail && NEON.isEnabled()) {
      NEON.line(NEON.trail, cx, bot, cx, bot + h * 5, 'playerThruster', w * 0.28,
                { alpha: 0.55, passes: 2 });
    }

    NEON.shape(c, [
      cx,           top - h * 0.35,
      cx + w * 0.5, bot,
      cx,           bot - h * 0.35,
      cx - w * 0.5, bot
    ], 'player', 2.2, { alpha: 1, fill: true, fillAlpha: 0.25, glowScale: 1.3 });

    const flame = h * (2.2 + Math.abs(Math.sin(t * 26)) * 1.4);
    NEON.polyline(c, [
      cx - w * 0.20, bot,
      cx,            bot + flame,
      cx + w * 0.20, bot
    ], 'playerThruster', 2.6, { alpha: 0.9, glowScale: 1.8, passes: 4 });

    NEON.dot(c, cx, bot - h * 0.15, w * 0.10, 'playerCore', { alpha: 1, glowScale: 1.4 });
  },

  /* ============================================================ instrumentation
   *  Estimation du temps de survie d'un joueur STRICTEMENT IMMOBILE, en
   *  secondes. C'est la mesure de référence du chantier (6-7 s avant, cible
   *  ~26 s au stage 1 et ~8 s au stage 20). Modèle explicite :
   *   • seuls les ennemis de la rangée avant tirent réellement (hasAllyBelow
   *     divise la cadence par 10) : facteur `frontRow`, resserré quand le champ
   *     est dense ;
   *   • un ennemi ne peut pas tirer plus vite que son cooldown ;
   *   • une balle visée touche presque à coup sûr un joueur immobile (0,92) ;
   *   • une plongée touche environ 42 % du temps ;
   *   • après un coup, ~1,9 s d'invulnérabilité + réapparition.
   *  Utilisable hors du jeu : stageSystem.estimateSurvival(1, 0). */
  estimateSurvival(stage, loop) {
    const m = menaceFor(stage == null ? this.currentStage : stage,
                        loop == null ? this.loopCount : loop);

    const RATES = (typeof ENEMY_TYPES !== 'undefined' && ENEMY_TYPES)
      ? null : { normal: 1.00, shooter: 0.55, fast: 0.60, elite: 0.34, ram: 0.30 };

    let chance = 0;
    for (const k in m.types) {
      const part = m.types[k];
      if (part <= 0) continue;
      const base = (TEMPO.ENEMY_SHOT_CHANCE_PER_SEC && TEMPO.ENEMY_SHOT_CHANCE_PER_SEC[k] != null)
        ? TEMPO.ENEMY_SHOT_CHANCE_PER_SEC[k] : 0.22;
      const rate = RATES ? RATES[k]
        : ((ENEMY_TYPES[k] && ENEMY_TYPES[k].shotRate != null) ? ENEMY_TYPES[k].shotRate : 1);
      chance += part * base * rate;
    }
    chance *= m.tirMult;

    const frontRow = clamp(0.78 - 0.022 * (m.fieldTarget - 5), 0.42, 0.80);
    const parEnnemi = 1 / (1 / Math.max(0.0001, chance) + 0.8);   // cooldown moyen
    let tirs = m.fieldTarget * frontRow * parEnnemi;
    tirs += m.salveChance * (1000 / 2600) * m.salveTaille;        // salves coordonnées

    const plongees = Math.min(m.plongeursMax / 2.6,
                              m.fieldTarget * TEMPO.DIVE_CHANCE_PER_SEC * m.plongeeMult);

    let danger = tirs * 0.92 + plongees * 0.42;
    // Sur un stage de boss, le champ est allégé mais le boss reprend la charge :
    // sans le module boss on ne peut que l'estimer.
    if (m.boss) danger *= 1.55;
    if (danger < 0.0005) danger = 0.0005;

    const vies = PROGRESSION.LIVES_REF;
    return Math.round((vies * (1 / danger + 1.92)) * 10) / 10;
  },

  /** Tableau de bord texte de toute la courbe (console). */
  debugCurve(loop) {
    const l = loop || 0;
    const lignes = [];
    for (let s = 1; s <= PROGRESSION.MAX_STAGE; s++) {
      const m = menaceFor(s, l);
      lignes.push(
        'stage ' + String(m.label).padStart(5) +
        ' | menace ' + m.menace.toFixed(2).padStart(5) +
        ' | ennemis ' + String(m.budget).padStart(3) +
        ' | champ ' + String(m.fieldTarget).padStart(3) +
        ' | tir ×' + m.tirMult.toFixed(2) +
        ' | plongée ×' + m.plongeeMult.toFixed(2) +
        ' | pv+' + m.pvBonus +
        ' | survie ' + String(this.estimateSurvival(s, l)).padStart(5) + ' s' +
        (m.boss ? '  << BOSS' : '')
      );
    }
    return lignes.join('\n');
  }
};

/* =============================================================================
 *  7. CRÉATION DES ENNEMIS D'UN STAGE
 * ========================================================================== */

/** Le type 'ram' n'existe que si un autre module l'a ajouté à ENEMY_TYPES.
 *  Tant qu'il n'est pas là, sa part revient aux élites. */
function typeRamDisponible() {
  return !!(typeof ENEMY_TYPES !== 'undefined' && ENEMY_TYPES && ENEMY_TYPES.ram);
}

/** Répartition EXACTE d'une vague selon la menace (mêmes garanties que
 *  buildTypeRoster : exactement `count` entrées, mélangées). */
function rosterSelonMenace(count, m) {
  const n = Math.max(0, Math.floor(count) || 0);
  const roster = [];
  const ram = typeRamDisponible();

  let nElite = Math.round(n * m.types.elite);
  const nRam = ram ? Math.round(n * m.types.ram) : 0;
  if (!ram) nElite += Math.round(n * m.types.ram);

  const lots = [
    ['shooter', Math.round(n * m.types.shooter)],
    ['fast',    Math.round(n * m.types.fast)],
    ['elite',   nElite],
    ['ram',     nRam]
  ];

  for (let i = 0; i < lots.length; i++) {
    for (let j = 0; j < lots[i][1] && roster.length < n; j++) roster.push(lots[i][0]);
  }
  while (roster.length < n) roster.push('normal');
  roster.length = n;

  // Mélange de Fisher-Yates : la rangée avant ne doit pas être triée par type.
  for (let i = roster.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = roster[i]; roster[i] = roster[j]; roster[j] = tmp;
  }
  return roster;
}

/** Tire UN type d'ennemi selon la répartition de la menace. */
function tirerTypeSelonMenace(m) {
  const t = m.types;
  let r = Math.random();
  if ((r -= t.normal) < 0) return 'normal';
  if ((r -= t.shooter) < 0) return 'shooter';
  if ((r -= t.fast) < 0) return 'fast';
  if ((r -= t.elite) < 0) return 'elite';
  return typeRamDisponible() ? 'ram' : 'elite';
}

function createEnemiesForStage(stageNumber) {
  try {
    enemies = [];

    const sys = stageSystem;
    const m = menaceFor(stageNumber, sys.loopCount);

    if (!sys.enemiesPerStage || sys.enemiesPerStage <= 0) sys.enemiesPerStage = m.budget;

    /* --- stage de BOSS -------------------------------------------------- */
    if (m.boss) {
      const ok = spawnBossSafely(m.bossSlot, m);
      if (ok) {
        sys.bossActive = true;
        sys.bossDefeated = false;
        sys._bossSeen = false;
        sys._bossGraceMs = 0;
        try {
          JUICE.flash(PALETTE.get('enemyElite').glow, 380, 0.30);
          gameEvent('diveAlert', { boss: true });
        } catch (e) { /* ignoré */ }

        // Escorte : le boss n'est pas seul, mais il reste la vedette.
        const comp = tirerComposition(m, sys.lastComposition);
        sys.lastComposition = comp.nom;
        createFormation(Math.max(3, Math.round(m.premiereVague * 0.8)), comp.f, comp.c, stageNumber);
        return true;
      }
      // Pas de module boss : on retombe sur une vague RENFORCÉE (garde-fou du
      // périmètre — ce fichier n'a pas le droit d'écrire js/entities/boss.js).
      console.info('Module boss absent : repli sur une formation renforcée.');
      sys.enemiesPerStage = m.budgetHorsBoss;
      TEMPO.FIELD_TARGET = m.fieldTargetHorsBoss;
      TEMPO.FIELD_REINFORCE_AT = Math.max(2, Math.round(m.fieldTargetHorsBoss * 0.68));
    }

    /* --- stage normal ---------------------------------------------------- */
    const comp = tirerComposition(m, sys.lastComposition);
    sys.lastComposition = comp.nom;

    const initialEnemies = clamp(
      Math.round(m.premiereVague * comp.taille * (m.boss ? 1.4 : 1)),
      3, Math.min(26, sys.enemiesPerStage)
    );

    createFormation(initialEnemies, comp.f, comp.c, stageNumber);
    return enemies.length > 0;
  } catch (e) {
    console.error("Erreur lors de la création des ennemis:", e);
    return false;
  }
}

/** Appel PROTÉGÉ au module boss (écrit par un autre agent : il peut ne pas
 *  exister, ne pas être chargé, ou changer de forme). Ne jette jamais. */
function spawnBossSafely(index, menace) {
  // `menace` est l'objet complet ; son valueOf() vaut menace.bossMenace, donc
  // un module qui attend un simple nombre (BOSS.spawn le fait) reçoit la bonne
  // valeur sans rien changer de son côté.
  try {
    if (typeof spawnBoss === 'function') return spawnBoss(index, menace) !== false;
  } catch (e) {
    console.warn('spawnBoss() a échoué :', e);
    return false;
  }
  try {
    if (typeof BOSS !== 'undefined' && BOSS && typeof BOSS.spawn === 'function') {
      return BOSS.spawn(index, menace) !== false;
    }
  } catch (e) {
    console.warn('BOSS.spawn() a échoué :', e);
  }
  return false;
}

/* =============================================================================
 *  8. FAÇADES — la table de vérité est ENEMY_TYPES (js/entities/enemies.js).
 *  Ces fonctions sont conservées parce que d'autres modules peuvent les appeler,
 *  mais elles ne DÉFINISSENT plus rien : elles délèguent.
 * ========================================================================== */

function determineEnemyType(normalRatio, shooterRatio, fastRatio) {
  const r = Math.random();
  if (r < normalRatio) return "normal";
  if (r < normalRatio + shooterRatio) return "shooter";
  return "fast";
}

function getEnemyHP(type, stageNumber) {
  if (typeof enemyHpFor === 'function') return enemyHpFor(type, stageNumber || 1);
  return 1;
}

/** Couleur d'identité (halo) du type. Source unique : PALETTE. */
function getEnemyColor(type) {
  return PALETTE.enemy(type).glow;
}

function getEnemySpeedModifier(type, stageNumber) {
  const base = (typeof enemyStats === 'function') ? enemyStats(type).speed : 1;
  const m = menaceFor(stageNumber || stageSystem.currentStage, stageSystem.loopCount);
  return base * clamp(m.vitesseFormation, 0.55, 1.9);
}

/** ⚠ Probabilité PAR SECONDE (jamais par frame). */
function getEnemyShotChance(type, stageNumber) {
  if (typeof getEnemyShotChancePerSec === 'function') {
    return getEnemyShotChancePerSec(type, stageNumber || 1);
  }
  const table = TEMPO.ENEMY_SHOT_CHANCE_PER_SEC || {};
  const base = table[type] != null ? table[type] : 0.22;
  return base * menaceFor(stageNumber || 1, stageSystem.loopCount).tirMult;
}

function getEnemyPoints(type) {
  if (typeof enemyStats === 'function') return enemyStats(type).points;
  return 10;
}

/* =============================================================================
 *  9. GOUVERNEUR DE MENACE
 * -----------------------------------------------------------------------------
 *  PÉRIMÈTRE : ce fichier ne peut modifier AUCUN autre fichier. Or la courbe de
 *  menace doit piloter des réglages qui vivent dans enemies.js (cadence de tir,
 *  plongées, vitesse de formation, PV, répartition des types) et dans la boucle
 *  de game.js (densité du champ). Le gouverneur résout ça À L'EXÉCUTION :
 *   • il ENVELOPPE les fonctions de réglage d'enemies.js. L'originale est
 *     toujours appelée (avec stage = 1, pour neutraliser son escalier interne),
 *     puis la courbe s'applique. Rien n'est réécrit, rien n'est perdu.
 *   • il écrit les quelques champs de TEMPO qui décrivent la DENSITÉ du champ
 *     de bataille (game.js les relit à chaque frame). Les valeurs d'origine
 *     sont mémorisées : on repart toujours d'elles, jamais d'un cumul.
 *   • il fournit le seul point d'accroche par frame dont stages.js a besoin
 *     (enveloppe de updateEnemies -> stageSystem.tick).
 *  Tout est idempotent, protégé par typeof, et débrayable :
 *      stageSystem.governor.enabled = false;
 *  L'intégrateur qui préfère un branchement propre trouvera dans le rapport le
 *  code exact à poser dans enemies.js / game.js — le gouverneur devient alors
 *  inutile et peut être coupé.
 * ========================================================================== */

const STAGE_GOVERNOR = {
  installed: false,
  enabled: true,
  orig: {},          // références aux fonctions d'origine
  tempo0: null       // valeurs TEMPO d'origine
};

/** Menace courante, jamais nulle. */
function _menaceCourante() {
  try { return stageSystem.menace(); }
  catch (e) { return menaceFor(1, 0); }
}

/** Applique à TEMPO les champs de DENSITÉ pilotés par la menace.
 *  (game.js relit TEMPO.FIELD_* à chaque frame : c'est le seul levier
 *   disponible sans toucher à game.js.) */
function applyMenaceToTempo(m) {
  if (!STAGE_GOVERNOR.enabled) return;
  if (!STAGE_GOVERNOR.tempo0) {
    STAGE_GOVERNOR.tempo0 = {
      FIELD_TARGET: TEMPO.FIELD_TARGET,
      FIELD_REINFORCE_AT: TEMPO.FIELD_REINFORCE_AT,
      FIELD_REINFORCE_COOLDOWN_MS: TEMPO.FIELD_REINFORCE_COOLDOWN_MS,
      DIVE_MAX_CONCURRENT: TEMPO.DIVE_MAX_CONCURRENT,
      DIVE_SPEED: TEMPO.DIVE_SPEED,
      DIVE_TELEGRAPH_MS: TEMPO.DIVE_TELEGRAPH_MS,
      ENEMY_SHOT_MAX_ONSCREEN: TEMPO.ENEMY_SHOT_MAX_ONSCREEN
    };
  }
  const t0 = STAGE_GOVERNOR.tempo0;

  TEMPO.FIELD_TARGET = m.fieldTarget;
  TEMPO.FIELD_REINFORCE_AT = m.fieldReinforce;
  // Au début, les renforts prennent leur temps : le joueur doit pouvoir
  // respirer entre deux vagues.
  TEMPO.FIELD_REINFORCE_COOLDOWN_MS = Math.round(
    clamp(lerp(1500, t0.FIELD_REINFORCE_COOLDOWN_MS, courbeMenace(clamp(m.p, 0, 1))), 420, 1800)
  );
  TEMPO.DIVE_MAX_CONCURRENT = m.plongeursMax;
  TEMPO.DIVE_SPEED = Math.round(t0.DIVE_SPEED * m.plongeeVitesse);
  TEMPO.DIVE_TELEGRAPH_MS = m.plongeeTelegraphe;
  TEMPO.ENEMY_SHOT_MAX_ONSCREEN = m.balleMax;
}

/** Installe les enveloppes. Appelée depuis initStage() : à ce moment tous les
 *  scripts sont chargés. Idempotente. */
function installStageGovernor() {
  if (STAGE_GOVERNOR.installed) return;
  STAGE_GOVERNOR.installed = true;

  // Les originales sont capturées dans des CONSTANTES LOCALES, jamais relues
  // depuis un objet partagé : si ce fichier venait à être ré-évalué (ou le
  // drapeau `installed` remis à zéro), une enveloppe ne pourrait jamais
  // s'appeler elle-même. STAGE_GOVERNOR.orig n'est là que pour l'introspection.
  const O = STAGE_GOVERNOR.orig;
  const marque = function (fn, nom) { fn.__stageGov = nom; return fn; };

  /* --- cadence de tir : on neutralise l'escalier par stage d'enemies.js --- */
  if (typeof getEnemyShotChancePerSec === 'function' && !getEnemyShotChancePerSec.__stageGov) {
    const orig = getEnemyShotChancePerSec;
    O.shot = orig;
    getEnemyShotChancePerSec = marque(function (type, stage) {
      if (!STAGE_GOVERNOR.enabled) return orig(type, stage);
      return orig(type, 1) * _menaceCourante().tirMult;   // base sans escalier
    }, 'shot');
  }

  /* --- plongées ---------------------------------------------------------- */
  if (typeof getDiveChance === 'function' && !getDiveChance.__stageGov) {
    const orig = getDiveChance;
    O.dive = orig;
    getDiveChance = marque(function (type, stage) {
      if (!STAGE_GOVERNOR.enabled) return orig(type, stage);
      return orig(type, 1) * _menaceCourante().plongeeMult;
    }, 'dive');
  }

  /* --- vitesse de la formation ------------------------------------------- */
  if (typeof getFormationSpeed === 'function' && !getFormationSpeed.__stageGov) {
    const orig = getFormationSpeed;
    O.speed = orig;
    getFormationSpeed = marque(function () {
      if (!STAGE_GOVERNOR.enabled) return orig();
      // L'originale lit stageSystem.currentStage : on la fait raisonner au
      // stage 1 (appel SYNCHRONE, aucun autre code ne tourne entre-temps),
      // puis on applique la courbe. Son bonus `enemySpeed` est préservé.
      const memo = stageSystem.currentStage;
      let v;
      try {
        stageSystem.currentStage = 1;
        v = orig();
      } finally {
        stageSystem.currentStage = memo;
      }
      return clamp(v * _menaceCourante().vitesseFormation, 55, TEMPO.FORMATION_SPEED_MAX);
    }, 'speed');
  }

  /* --- points de vie ------------------------------------------------------ */
  if (typeof enemyHpFor === 'function' && !enemyHpFor.__stageGov) {
    const orig = enemyHpFor;
    O.hp = orig;
    enemyHpFor = marque(function (type, stage) {
      if (!STAGE_GOVERNOR.enabled) return orig(type, stage);
      return orig(type, 1) + _menaceCourante().pvBonus;
    }, 'hp');
  }

  /* --- répartition des types : les élites arrivent TARD ------------------- */
  if (typeof buildTypeRoster === 'function' && !buildTypeRoster.__stageGov) {
    const orig = buildTypeRoster;
    O.roster = orig;
    buildTypeRoster = marque(function (count, stage) {
      if (!STAGE_GOVERNOR.enabled) return orig(count, stage);
      return rosterSelonMenace(count, _menaceCourante());
    }, 'roster');
  }

  /* --- salve coordonnée : rare au début ----------------------------------- */
  if (typeof triggerEnemyVolley === 'function' && !triggerEnemyVolley.__stageGov) {
    const orig = triggerEnemyVolley;
    O.volley = orig;
    triggerEnemyVolley = marque(function (stage) {
      if (!STAGE_GOVERNOR.enabled) return orig(stage);
      if (Math.random() > _menaceCourante().salveChance) return;  // salve sautée
      return orig(stage);
    }, 'volley');
  }

  /* --- compositions non débloquées : on les remplace ---------------------- */
  if (typeof createFormation === 'function' && !createFormation.__stageGov) {
    const orig = createFormation;
    O.formation = orig;
    createFormation = marque(function (count, formationType, choreographyType, stage, append) {
      if (STAGE_GOVERNOR.enabled) {
        const m = _menaceCourante();
        if (!compositionDebloquee(formationType, choreographyType, m.stageEq)) {
          const comp = tirerComposition(m, stageSystem.lastComposition);
          formationType = comp.f;
          choreographyType = comp.c;
        }
      }
      return orig(count, formationType, choreographyType, stage, append);
    }, 'formation');
  }

  /* --- point d'accroche par frame ----------------------------------------- */
  if (typeof updateEnemies === 'function' && !updateEnemies.__stageGov) {
    const orig = updateEnemies;
    O.update = orig;
    updateEnemies = marque(function (deltaTime) {
      try { stageSystem.tick(deltaTime > 0 ? deltaTime : 0); } catch (e) { /* ignoré */ }
      return orig(deltaTime);
    }, 'update');
    try { window.updateEnemies = updateEnemies; } catch (e) { /* ignoré */ }
  }

  /* --- NOUVELLE PARTIE : la boucle repart à zéro ---------------------------
   *  game.js:179 fait `stageSystem.currentStage = 1` mais ignore loopCount (il
   *  n'existait pas). Sans ça, la partie suivant un game-over en boucle 3
   *  démarrerait au stage 1 AVEC la menace de la boucle 4. Même motif
   *  d'enveloppe que powerups.js (marqueur __galabob*). */
  if (typeof initGame === 'function' && !initGame.__stageLoopReset) {
    const origInit = initGame;
    const wrappedInit = function () {
      stageSystem.loopCount = 0;
      stageSystem.lastComposition = '';
      stageSystem._bag = [];
      stageSystem._lastTransitionKey = '';
      stageSystem.bossActive = false;
      stageSystem.bossDefeated = false;
      stageSystem.lastRank = null;
      return origInit.apply(this, arguments);
    };
    wrappedInit.__stageLoopReset = true;
    initGame = wrappedInit;
    try { window.initGame = wrappedInit; } catch (e) { /* ignoré */ }
  }

  /* --- dégâts encaissés : c'est ce qui décide du rang S -------------------- */
  if (typeof damagePlayer === 'function' && !damagePlayer.__stageGov) {
    const orig = damagePlayer;
    O.damage = orig;
    damagePlayer = marque(function (source) {
      try { stageSystem.notePlayerHit(); } catch (e) { /* ignoré */ }
      return orig(source);
    }, 'damage');
    try { window.damagePlayer = damagePlayer; } catch (e) { /* ignoré */ }
  }

  // La menace du stage courant doit être appliquée tout de suite.
  try { applyMenaceToTempo(_menaceCourante()); } catch (e) { /* ignoré */ }
}

stageSystem.governor = STAGE_GOVERNOR;
stageSystem.installStageGovernor = installStageGovernor;
stageSystem.installGovernor = installStageGovernor;   // alias court

/* =============================================================================
 *  10. ÉTOILES PENDANT LA TRANSITION
 *  NOTE : js/entities/stars.js est chargé APRÈS ce fichier et REDÉFINIT cette
 *  fonction (il gère le warp lui-même, en px/s). La version ci-dessous n'est
 *  donc qu'un filet de sécurité si l'ordre des <script> venait à changer.
 * ========================================================================== */
function updateStarsTransition(deltaTime) {
  try {
    if (typeof setStarWarp === 'function') {
      const m = Number(stageSystem.starSpeedMultiplier) || 1;
      setStarWarp(clamp(1 + (m - 1) * 2.2, 1, TEMPO.STAR_WARP_MULT), 140);
      return;
    }

    if (!stars || !Array.isArray(stars)) return;

    const dt = ((deltaTime > 0) ? deltaTime : FRAME.dtMs) / 1000;
    if (!(dt > 0)) return;

    const mult = Number(stageSystem.starSpeedMultiplier) || 1;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      if (!s) continue;
      // `speed` est en px/s (convention TEMPO).
      s.y += (s.speed || TEMPO.STAR_SPEED_MID) * mult * dt;
      if (s.y > CANVAS_HEIGHT) {
        s.y -= CANVAS_HEIGHT;
        s.x = Math.random() * CANVAS_WIDTH;
      }
    }
  } catch (e) { /* ignoré : le fond ne doit jamais casser une transition */ }
}

/* =============================================================================
 *  11. EXPORTS ET POINTS D'ACCROCHE POUR LES AUTRES MODULES
 * -----------------------------------------------------------------------------
 *  • stageSystem.menace()                 -> objet de menace du stage courant
 *  • stageSystem.menaceAt(stage, loop)    -> idem pour un stage arbitraire
 *  • stageSystem.currentTheme()           -> thème de décor courant
 *  • stageSystem.theme(stage, loop)       -> thème d'un stage donné
 *  • stageSystem.stageLabel()             -> « 3-2 »
 *  • stageSystem.isBossStage(stage)       -> true aux stages 5/10/15/20
 *  • stageSystem.notifyBossDefeated(info) -> à appeler à la mort du boss
 *  • stageBossDefeated(info)              -> même chose, en global
 *
 *  CONTRAT BOSS (aligné sur l'API réelle de js/entities/boss.js)
 *  ------------------------------------------------------------
 *  À l'entrée d'un stage 5/10/15/20, stages.js appelle, dans l'ordre :
 *      spawnBoss(slot, menace)        si ce global existe,
 *      sinon BOSS.spawn(slot, menace).
 *  `slot` vaut 0..3 (identique à BOSS.indexForStage(stage)) et `menace` est
 *  l'objet complet dont le valueOf() renvoie menace.bossMenace, un NOMBRE de
 *  1 à 6 — exactement ce qu'attend BOSS.spawn(). Le stage reste ouvert tant
 *  que BOSS.isDefeated() est faux (l'agonie se joue donc en entier) ; il se
 *  solde ensuite tout seul. Aucun module boss n'a besoin d'appeler quoi que
 *  ce soit : la surveillance suffit. notifyBossDefeated() reste disponible
 *  pour un module qui préfère prévenir explicitement.
 *  • stageSystem.estimateSurvival(s, l)   -> outil de réglage (secondes)
 *  • stageSystem.debugCurve(loop)         -> toute la courbe, en texte
 *  • stageSystem.governor.enabled = false -> coupe le pilotage à l'exécution
 * ========================================================================== */
window.stageSystem = stageSystem;
window.PROGRESSION = PROGRESSION;
window.menaceFor = menaceFor;
window.STAGE_COMPOSITIONS = STAGE_COMPOSITIONS;
window.STAGE_THEMES = STAGE_THEMES;

/** Raccourci global pour le module boss : `stageBossDefeated()` à la mort du
 *  boss. Équivaut à stageSystem.notifyBossDefeated(). */
window.stageBossDefeated = function (info) {
  try { stageSystem.notifyBossDefeated(info); } catch (e) { console.error(e); }
};
