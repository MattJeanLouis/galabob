/**
 * Câblage de la VUE EN PERSPECTIVE des stages 2D.
 *
 * Deux régressions ont réellement coûté cher pendant la mise au point, et ce
 * fichier les garde :
 *   1. la branche de vue était placée APRÈS `drawStars()` : le décor céleste
 *      était peint par-dessus la vue 3D, ce qui donnait un fond bleu plein ;
 *   2. la vue pouvait rester active alors que le rendu 3D était indisponible,
 *      laissant un écran vide.
 *
 * Il vérifie aussi la promesse de fond : la vue ne change QUE la présentation —
 * l'instantané qu'elle reçoit ne contient que des références vers l'état vivant
 * du jeu, jamais de copie, et la bascule est mémorisée dans le profil.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('la vue en perspective est composée AVANT le décor céleste', () => {
  const game = read('js/game.js');
  const vue = game.indexOf('if (viewBlend > 0.001 && gameState');
  const decor = game.indexOf('if (typeof drawStars === \'function\') drawStars();');
  assert.ok(vue > 0, 'la branche de vue doit exister');
  assert.ok(decor > 0, 'l’appel au décor doit exister');
  assert.ok(vue < decor,
    'la vue doit être composée AVANT drawStars, sinon le décor la recouvre ' +
    '(c’est l’erreur qui donnait un fond bleu plein écran)');
});

test('un rendu 3D indisponible ramène à la vue à plat au lieu d’un écran vide', () => {
  const game = read('js/game.js');
  assert.match(game, /GAME3D\.isAvailable/, 'la disponibilité doit être testée');
  assert.match(game, /viewMode = 'flat';/, 'la vue doit se replier');
  assert.match(game, /hudAlert\('VUE EN PERSPECTIVE INDISPONIBLE'/,
    'le repli doit être annoncé, pas subi en silence');
});

test('l’instantané ne copie rien : il référence l’état vivant du jeu', () => {
  const snapshot = read('js/game.js').slice(
    read('js/game.js').indexOf('function stageSnapshot()'),
    read('js/game.js').indexOf('/** Compose la vue en perspective')
  );
  assert.ok(snapshot.length > 0, 'l’instantané doit être trouvable');

  // Des références directes : la vue lit la simulation, elle ne la duplique pas.
  for (const champ of ['player: player', 'enemies: enemies', 'playerBullets: playerBullets']) {
    assert.ok(snapshot.includes(champ), `l’instantané doit référencer ${champ}`);
  }
  // Des LECTURES scalaires sont permises (la vie du boss, sa phase…) : la vue
  // n'a pas à recalculer un pourcentage. Ce qui est interdit, c'est de COPIER
  // les collections ou d'en modifier une seule.
  assert.doesNotMatch(snapshot, /\.slice\(|\.map\(|JSON\.parse|JSON\.stringify/,
    'aucune copie de collection : la vue doit lire l’état vivant');
  assert.doesNotMatch(snapshot, /\.push\(|\.splice\(|delete\s/,
    'aucune mutation : la vue ne simule rien');
});

test('la bascule est un plan de caméra animé, pas un simple fondu', () => {
  const game = read('js/game.js');
  assert.match(game, /VIEW_BLEND_MS\s*=\s*\d+/, 'la durée doit être nommée et réglable');
  assert.match(game, /function updateViewBlend/, 'l’animation doit avoir son avance');
  // Le mouvement : l'image arrive de plus haut et se pose.
  assert.match(game, /const chute = \(1 - t\) \*/, 'la bascule doit comporter un mouvement');
  assert.match(game, /const zoom = 1 \+ \(1 - t\) \*/, 'et une arrivée en profondeur');
  // Le repère de hitbox subit la même transformation que l'image.
  assert.match(game, /const place = \(c\) =>/, 'la transformation doit être partagée');
});

test('le point de vue est mémorisé et restauré', () => {
  const game = read('js/game.js');
  assert.match(game, /profile\.setViewMode\(viewMode\)/, 'la bascule doit être mémorisée');
  assert.match(game, /profile\.data\.viewMode/, 'la préférence doit être relue');

  const profile = read('js/core/profile-store.js');
  assert.match(profile, /viewMode: 'flat'/, 'un défaut doit exister');
  assert.match(profile, /source\.viewMode === 'perspective'/, 'la valeur doit être validée');
  assert.match(profile, /setViewMode\(mode\)/, 'le profil doit exposer un setter');
});

test('les éléments de jeu à voir sont projetés : bonus et explosions', () => {
  const module3d = read('js/render/game3d.js');
  for (const marqueur of ['enemies', 'powerups', 'explosions', 'boss', 'ship']) {
    assert.match(module3d, new RegExp(marqueur + ':'), `le marqueur « ${marqueur} » doit être projeté`);
  }

  const game = read('js/game.js');
  // Chaque marqueur doit être TRACÉ, sinon le calcul ne sert à rien.
  assert.match(game, /result\.markers && result\.markers\.powerups/, 'les bonus doivent être tracés');
  assert.match(game, /result\.markers && result\.markers\.explosions/, 'les explosions doivent être tracées');
  assert.match(game, /result\.markers\.boss|markers && result\.markers\.boss/, 'le boss doit être tracé');

  // Et l'instantané doit transporter les sources correspondantes.
  const snapshot = read('js/game.js').slice(
    read('js/game.js').indexOf('function stageSnapshot()'),
    read('js/game.js').indexOf('/** Compose la vue en perspective')
  );
  for (const champ of ['enemyBullets', 'powerUps', 'explosions', 'boss']) {
    assert.ok(snapshot.includes(champ + ':'), `l’instantané doit porter ${champ}`);
  }
});

test('la vue ne MODIFIE jamais la simulation : elle ne fait que lire', () => {
  const module3d = read('js/render/game3d.js');

  // Aucune écriture dans les objets REÇUS (player, ennemis, balles, bonus).
  // C'est la promesse de fond de la vue : hitboxes, dégâts et progression
  // restent exactement ceux du 2D. Une seule affectation la casserait.
  const interdites = module3d.match(
    /\b(player|e|b|p)\.(x|y|hp|hpMax|damage|score|life|alive|isDeleted)\s*=[^=]/g
  ) || [];
  assert.deepEqual(interdites, [],
    'la vue ne doit jamais écrire dans les objets de jeu : ' + interdites.join(', '));

  // Et l'instantané ne doit contenir que des lectures : pas de recopie profonde.
  assert.doesNotMatch(module3d, /JSON\.parse\(JSON\.stringify/, 'aucune copie profonde');
});

test('le rendu 3D entre dans le même pipeline néon que la vue à plat', () => {
  const game = read('js/game.js');
  const draw = game.slice(
    game.indexOf('function drawStagePerspective()'),
    game.indexOf('function drawScene()')
  );
  // Composé DANS le tampon émissif (`ctx`), donc bloom, aberration et vignette
  // du mode classique s'appliquent — c'est ce qui préserve l'ambiance.
  assert.match(draw, /ctx\.drawImage\(result\.canvas/, 'la vue doit être composée dans la scène');
  assert.match(draw, /'source-over'/, 'composition normale, pas un mélange additif global');

  const module3d = read('js/render/game3d.js');
  // L'art vient du jeu : on ne redessine pas les vaisseaux.
  assert.match(module3d, /drawEnemyBillboard/, 'les ennemis doivent venir de l’art du jeu');
  assert.match(module3d, /drawClassicPlayerHull|SHIP_RENDERERS/, 'la coque doit venir du jeu');
});
