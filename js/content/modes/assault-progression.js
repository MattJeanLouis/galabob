(function installAssaultProgression(global) {
  const arcade = global.GALABOB_ARCADE_PROGRESSION;
  if (!arcade) throw new Error('La progression Arcade doit preceder le mode Assaut');

  const themes = Object.freeze([
    arcade.themes[5], arcade.themes[3], arcade.themes[7],
    arcade.themes[8], arcade.themes[9], arcade.themes[4]
  ]);
  // La campagne introduit ses géométries par familles : lignes militaires,
  // pointes, arcs, puis dispositifs circulaires et entrées complexes.
  const recipes = [
    ['PREMIER CONTACT', 'grid', 'curveLeft'],
    ['LIGNE DE FRONT', 'doubleRow', 'curveRight'],
    ['AVANT-GARDE', 'wedge', 'split'],
    ['VOÛTE', 'arc', 'curveLeft'],
    ['FER DE LANCE', 'diamond', 'curveRight'],
    ['PHALANGE', 'columns', 'zigzag'],
    ['TENAILLE', 'wedge', 'curveRight'],
    ['ARC BRISÉ', 'arc', 'split'],
    ['PRISME', 'diamond', 'zigzag'],
    ['BLOCUS', 'circle', 'curveLeft'],
    ['TOURS DE GARDE', 'columns', 'curveRight'],
    ['TRIDENT', 'wedge', 'spiral'],
    ['ORBITE', 'circle', 'split'],
    ['ÉCLIPSE', 'arc', 'zigzag'],
    ['COURONNE', 'diamond', 'spiral'],
    ['MUR MOBILE', 'grid', 'split'],
    ['FORTERESSE', 'columns', 'spiral'],
    ['ÉPERON', 'wedge', 'zigzag'],
    ['ANNEAU D’ASSAUT', 'circle', 'curveRight'],
    ['FAILLE', 'arc', 'spiral'],
    ['POINTE ROUGE', 'diamond', 'split'],
    ['QUATRE TOURS', 'columns', 'curveLeft'],
    ['ÉVENTAIL', 'wedge', 'curveLeft'],
    ['HORIZON COURBE', 'arc', 'curveRight'],
    ['VORTEX', 'circle', 'spiral'],
    ['MATRICE', 'grid', 'zigzag'],
    ['DIADÈME', 'diamond', 'curveLeft'],
    ['CITADELLE', 'columns', 'split'],
    ['MÂCHOIRE', 'wedge', 'curveRight'],
    ['SIÈGE FINAL', 'circle', 'zigzag']
  ];
  const compositions = Object.freeze(recipes.map((recipe, index) => Object.freeze({
    nom: 'ASSAUT ' + String(index + 1).padStart(2, '0') + ' · ' + recipe[0],
    f: recipe[1], c: recipe[2], stage: index + 1,
    poids: 1,
    taille: Math.min(1.28, 1 + Math.floor(index / 5) * 0.045)
  })));

  global.GALABOB_ASSAULT_PROGRESSION = Object.freeze({
    stageCount: 30,
    threatSpan: 4.2,
    loopMultiplier: 1.25,
    bossEvery: 10,
    referenceLives: 3,
    themes,
    compositions,
    rules: Object.freeze({
      budgetMultiplier: 0.86,
      fieldMultiplier: 1.48,
      formationSpeedMultiplier: 1.20,
      shotMultiplier: 0.88,
      disableDives: true,
      descentPerSecond: 8,
      enemyScale: 1.12,
      sparseEnemyScale: 1.18,
      formationMaxY: 0.53,
      entryGraceMs: 650,
      entrySpeedMultiplier: 1.22,
      scriptedCompositions: true
    })
  });
})(window);
