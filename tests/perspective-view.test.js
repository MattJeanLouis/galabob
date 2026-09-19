/**
 * Câblage de la VUE EN PERSPECTIVE des stages 2D.
 *
 * Ce que cette vue promet, et que ce fichier verrouille :
 *   1. MÊME STAGE, MÊME SIMULATION, MÊME ART. La vue ne redessine rien : elle
 *      projette, et le jeu trace ses propres formes (`GAME3D.drawWorld`).
 *   2. LE CIEL DU JEU EST CONSERVÉ. Il est peint AVANT la vue, qui le garde :
 *      la planète filaire, la nébuleuse et les étoiles SONT l'identité du jeu.
 *      Les masquer — ce qui a été fait — donnait l'impression d'un autre jeu.
 *   3. LE HUD EST COMMUN AUX DEUX CAMÉRAS. Score, vies, barre du boss et
 *      bannière de stage se lisent en perspective comme à plat.
 *   4. AUCUN ART INVENTÉ : ni sprite, ni grille au sol, ni jauge de boss
 *      fabriquée par la vue. Rien qui n'existe pas déjà dans l'autre caméra.
 *
 * Les régressions qui ont réellement coûté cher :
 *   - la branche de vue placée APRÈS `drawStars()` : le décor recouvrait la vue ;
 *   - puis l'inverse : le décor purement SUPPRIMÉ, d'où un fond noir ;
 *   - et des sprites à la place de l'art du jeu, jugés « moches et pas fidèles ».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const game = () => read('js/game.js');
const module3d = () => read('js/render/game3d.js');

/** Le corps de `drawStagePerspective`, borné par la fonction suivante. */
function blocPerspective() {
  const g = game();
  return g.slice(g.indexOf('function drawStagePerspective()'), g.indexOf('function drawScene()'));
}

test('le décor céleste est peint AVANT la vue, et la vue le GARDE', () => {
  const g = game();
  const branche = g.indexOf('if (viewBlend > 0.001 && gameState');
  const decor = g.indexOf('if (typeof drawStars === \'function\') drawStars();', branche);
  const projection = g.indexOf('if (drawStagePerspective())', branche);

  assert.ok(branche > 0, 'la branche de vue doit exister');
  assert.ok(decor > branche, 'la branche de vue doit peindre le décor céleste');
  assert.ok(projection > decor,
    'le décor doit être peint AVANT la vue : c’est le fond sur lequel elle se pose');
  assert.doesNotMatch(g, /BACKDROP\.setViewDim/,
    'le décor ne doit plus être atténué pour la vue en perspective : il est le MÊME ciel');
});

test('le HUD est commun aux DEUX caméras', () => {
  const g = game();
  assert.match(g, /function drawFixedOverlay\(\)/,
    'la surcouche fixe doit être une fonction partagée, pas un bloc recopié');
  // La surcouche est appelée par la BRANCHE de vue (juste après la projection) :
  // c'est `drawScene` qui l'enchaîne, pas `drawStagePerspective` elle-même.
  const apresProjection = g.slice(g.indexOf('if (drawStagePerspective())'));
  assert.match(apresProjection.slice(0, 300), /drawFixedOverlay\(\)/,
    'la vue en perspective doit la dessiner : sans elle, ni score ni vies — un autre jeu');

  // Et la vue à plat doit continuer de s'en servir (une seule vérité).
  const scene = g.slice(g.indexOf('function drawScene()'));
  assert.match(scene, /drawFixedOverlay\(\)/, 'la vue à plat doit passer par la même surcouche');
});

test('la vue en perspective est composée DANS le tampon émissif', () => {
  const bloc = blocPerspective();
  // Composée dans `ctx`, donc bloom, aberration et vignette du mode classique
  // s'appliquent — c'est ce qui préserve l'ambiance.
  assert.match(bloc, /GAME3D\.drawWorld\(ctx\)/, 'la vue doit laisser le jeu tracer dans la scène');
  assert.match(bloc, /const place = \(c\) =>/, 'la transformation de bascule doit être partagée');
});

test('une transition de stage se voit dans les deux caméras', () => {
  const g = game();
  const transition = g.indexOf('if (stageSystem.transitionActive)');
  const branche = g.indexOf('if (viewBlend > 0.001 && gameState');
  assert.ok(transition > 0 && branche > 0);
  assert.ok(transition < branche,
    'la transition est une annonce de jeu : placée après, la vue en perspective la sautait');
});

test('la vue ne peut plus être indisponible : elle ne dépend d’aucun rendu matériel', () => {
  assert.match(module3d(), /isAvailable: \(\) => true/,
    'la projection sténopé est écrite ici : il n’y a plus de dépendance WebGL à tester');

  // Le repli défensif reste : si la projection échouait, l'écran ne doit pas
  // rester vide, et le joueur doit savoir pourquoi.
  const g = game();
  assert.match(g, /viewMode = 'flat';/, 'la vue doit pouvoir se replier');
  assert.match(g, /hudAlert\('VUE EN PERSPECTIVE INDISPONIBLE'/,
    'le repli doit être annoncé, pas subi en silence');
});

test('l’instantané ne copie rien : il référence l’état vivant du jeu', () => {
  const g = game();
  const snapshot = g.slice(g.indexOf('function stageSnapshot()'), g.indexOf('/** Compose la vue en perspective'));
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

test('tout ce qui se dessine en jeu est transporté par l’instantané', () => {
  const g = game();
  const snapshot = g.slice(g.indexOf('function stageSnapshot()'), g.indexOf('/** Compose la vue en perspective'));

  // Les effets font partie de la grammaire du jeu : les omettre en perspective
  // ferait une vue INCOMPLÈTE, donc un autre jeu.
  for (const champ of ['enemyBullets', 'powerUps', 'explosions', 'debris', 'bombWaves',
    'powerUpPickups', 'multiplierSparks', 'scorePopups', 'boss']) {
    assert.ok(snapshot.includes(champ + ':'), `l’instantané doit porter ${champ}`);
  }

  // Et la vue doit tous les projeter.
  const m = module3d();
  for (const marqueur of ['enemies', 'shots', 'incoming', 'powerups', 'explosions',
    'debris', 'bombWaves', 'pickups', 'sparks', 'popups', 'boss', 'ship']) {
    assert.match(m, new RegExp(marqueur + ':'), `le marqueur « ${marqueur} » doit être projeté`);
  }
});

test('AUCUN art inventé : ni sprite, ni sol, ni jauge fabriquée', () => {
  const m = module3d();
  assert.doesNotMatch(m, /Sprite|CanvasTexture|GridHelper|PlaneGeometry|import \* as THREE/,
    'la vue ne possède plus aucun objet de scène : elle projette');

  // L'art vient du jeu, nommément.
  for (const nom of ['drawEnemyShip', 'drawPlayer', 'drawEnemyBullet', 'drawPowerUp',
    'drawPlayerBullet', 'drawExplosionParticle', 'drawBombWave', 'BOSS.drawWorld']) {
    assert.ok(m.includes(nom), `la vue doit passer par ${nom}`);
  }

  // La vue ne trace RIEN elle-même : aucun appel direct à NEON dans la
  // composition de la bascule. Les seuls tracés sont ceux du jeu.
  assert.doesNotMatch(blocPerspective(), /NEON\./,
    'la vue ne redessine pas : elle laisse le jeu dessiner');
});

test('le boss est rendu par le module boss, pas réinterprété', () => {
  const boss = read('js/entities/boss.js');
  assert.match(boss, /viewport: viewport/, 'le boss doit exposer viewport()');
  assert.match(boss, /BOSS3D\.frame\(viewport\(\)\)/,
    'le rendu de sa coque doit passer par le MÊME contrat, pas une copie');

  const m = module3d();
  assert.match(m, /BOSS\.drawWorld/, 'la vue doit confier le boss au module boss');
  assert.doesNotMatch(blocPerspective(), /NEON\.ring|NEON\.dot|boss\.shell/,
    'la vue ne doit plus fabriquer d’anneau de cible ni de jauge : le boss se dessine lui-même');
});

test('la bascule est un plan de caméra animé, pas un simple fondu', () => {
  const g = game();
  assert.match(g, /VIEW_BLEND_MS\s*=\s*\d+/, 'la durée doit être nommée et réglable');
  assert.match(g, /function updateViewBlend/, 'l’animation doit avoir son avance');
  // Le mouvement : l'image arrive de plus haut et se pose.
  assert.match(g, /const chute = \(1 - t\) \*/, 'la bascule doit comporter un mouvement');
  assert.match(g, /const zoom = 1 \+ \(1 - t\) \*/, 'et une arrivée en profondeur');
  // Le monde se matérialise, sans tampon intermédiaire.
  assert.match(g, /ctx\.fillRect\(-64, -64,/, 'la matérialisation doit être une simple passe');
});

test('le point de vue est mémorisé et restauré', () => {
  const g = game();
  assert.match(g, /profile\.setViewMode\(viewMode\)/, 'la bascule doit être mémorisée');
  assert.match(g, /profile\.data\.viewMode/, 'la préférence doit être relue');

  const profile = read('js/core/profile-store.js');
  assert.match(profile, /viewMode: 'flat'/, 'un défaut doit exister');
  assert.match(profile, /source\.viewMode === 'perspective'/, 'la valeur doit être validée');
  assert.match(profile, /setViewMode\(mode\)/, 'le profil doit exposer un setter');
});

test('l’art unitaire est exposé par les modules d’entités', () => {
  // La vue projette CHAQUE élément à sa propre profondeur : il lui faut donc le
  // tracé unitaire, et pas seulement la passe complète (qui dessine tout le
  // monde dans le même repère).
  assert.match(read('js/entities/enemies.js'), /window\.drawEnemyShip = drawEnemyShip/);
  assert.match(read('js/entities/player.js'), /window\.drawPlayer = drawPlayer/);
  assert.match(read('js/entities/projectiles.js'), /window\.drawPlayerBullet = drawPlayerBullet/);
  assert.match(read('js/entities/projectiles.js'), /window\.drawEnemyBullet = drawEnemyBullet/);
  assert.match(read('js/entities/powerups.js'), /window\.drawPowerUp = drawPowerUp/);

  // Et la passe complète doit continuer de n'être qu'une boucle sur l'unitaire :
  // une seule vérité de tracé, donc aucun risque de divergence entre les vues.
  assert.match(read('js/entities/projectiles.js'), /drawPlayerBullets\(\)[\s\S]{0,200}drawPlayerBullet\(c, tr,/);
  assert.match(read('js/entities/powerups.js'), /function drawPowerUps\(\)[\s\S]{0,300}drawPowerUp\(c, tr,/);
});
