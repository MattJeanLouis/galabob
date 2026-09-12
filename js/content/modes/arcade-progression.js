(function installArcadeProgression(global) {
  const themes = [
    { key: 'aurore', nom: 'AURORE', accent: 'player', grille: 'player', densite: 0.9, horizon: 0.62 },
    { key: 'nebuleuse', nom: 'NÉBULEUSE', accent: 'enemyNormal', grille: 'enemyNormal', densite: 1.1, horizon: 0.58 },
    { key: 'ceinture', nom: 'CEINTURE', accent: 'enemyFast', grille: 'enemyFast', densite: 1.0, horizon: 0.66 },
    { key: 'abime', nom: 'ABÎME', accent: 'enemyShooter', grille: 'enemyShooter', densite: 0.8, horizon: 0.54 },
    { key: 'coeur', nom: 'CŒUR', accent: 'enemyElite', grille: 'enemyElite', densite: 1.2, horizon: 0.70 },
    { key: 'obsidienne', nom: 'OBSIDENNE', accent: 'enemyShooter', grille: 'enemyElite', densite: 0.7, horizon: 0.50 },
    { key: 'polaire', nom: 'COURONNE POLAIRE', accent: 'playerShield', grille: 'player', densite: 1.1, horizon: 0.64 },
    { key: 'solaire', nom: 'CŒUR SOLAIRE', accent: 'powerup.spread', grille: 'enemyFast', densite: 1.3, horizon: 0.72 },
    { key: 'abyssal', nom: 'RÉCIF ABYSSAL', accent: 'powerup.double', grille: 'playerShield', densite: 0.9, horizon: 0.57 },
    { key: 'singularite', nom: 'SINGULARITÉ', accent: 'powerup.life', grille: 'enemyElite', densite: 1.4, horizon: 0.46 }
  ];

  const baseCompositions = [
    { nom: 'RANG SERRÉ', f: 'grid', c: 'curveLeft', stage: 1, poids: 1.00, taille: 0.90 },
    { nom: 'DOUBLE LIGNE', f: 'doubleRow', c: 'curveRight', stage: 2, poids: 1.00, taille: 0.95 },
    { nom: 'CROISEMENT', f: 'grid', c: 'split', stage: 3, poids: 0.95, taille: 1.00 },
    { nom: 'PENDULE', f: 'doubleRow', c: 'zigzag', stage: 4, poids: 0.95, taille: 1.00 },
    { nom: 'LOSANGE', f: 'diamond', c: 'curveRight', stage: 5, poids: 0.95, taille: 0.95 },
    { nom: 'TENAILLE', f: 'diamond', c: 'split', stage: 6, poids: 0.95, taille: 1.00 },
    { nom: 'GRILLE FOLLE', f: 'grid', c: 'zigzag', stage: 7, poids: 0.90, taille: 1.05 },
    { nom: 'CARROUSEL', f: 'circle', c: 'curveLeft', stage: 8, poids: 1.00, taille: 0.95 },
    { nom: 'FRONDE', f: 'doubleRow', c: 'split', stage: 9, poids: 0.90, taille: 1.05 },
    { nom: 'ANNEAU BRISÉ', f: 'circle', c: 'split', stage: 10, poids: 0.95, taille: 1.00 },
    { nom: 'VRILLE', f: 'grid', c: 'spiral', stage: 11, poids: 0.95, taille: 1.05 },
    { nom: 'DIADÈME', f: 'diamond', c: 'zigzag', stage: 12, poids: 0.90, taille: 1.05 },
    { nom: 'SPIRALE', f: 'circle', c: 'spiral', stage: 13, poids: 1.00, taille: 1.00 },
    { nom: 'HERSE', f: 'doubleRow', c: 'spiral', stage: 14, poids: 0.90, taille: 1.10 },
    { nom: 'POINTE', f: 'diamond', c: 'curveLeft', stage: 15, poids: 0.90, taille: 1.05 },
    { nom: 'ORBITE', f: 'circle', c: 'zigzag', stage: 16, poids: 0.95, taille: 1.05 },
    { nom: 'ÉTAU', f: 'diamond', c: 'spiral', stage: 17, poids: 0.95, taille: 1.10 },
    { nom: 'MURAILLE', f: 'grid', c: 'curveRight', stage: 18, poids: 0.90, taille: 1.15 },
    { nom: 'MAELSTRÖM', f: 'circle', c: 'curveRight', stage: 19, poids: 1.00, taille: 1.10 },
    { nom: 'JUGEMENT', f: 'doubleRow', c: 'curveLeft', stage: 20, poids: 1.00, taille: 1.15 }
  ];

  const tierNames = ['FRONTIÈRE', 'RUPTURE', 'OFFENSIVE', 'NÉMÉSIS', 'APOCALYPSE'];
  const compositions = [];
  for (let tier = 0; tier < tierNames.length; tier++) {
    for (const base of baseCompositions) {
      compositions.push({
        ...base,
        nom: tier === 0 ? base.nom : tierNames[tier] + ' · ' + base.nom,
        stage: tier * baseCompositions.length + base.stage,
        poids: base.poids * (1 + tier * 0.04),
        taille: Math.min(1.35, base.taille + tier * 0.04)
      });
    }
  }

  for (const value of [...themes, ...compositions]) Object.freeze(value);

  global.GALABOB_ARCADE_PROGRESSION = Object.freeze({
    stageCount: 100,
    threatSpan: 3.4,
    loopMultiplier: 1.4,
    bossEvery: 5,
    referenceLives: 3,
    themes: Object.freeze(themes),
    compositions: Object.freeze(compositions)
  });
})(window);
