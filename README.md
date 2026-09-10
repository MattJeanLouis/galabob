# GALABOB

**Un shoot'em up néon vectoriel en JavaScript pur.** Pas de moteur, pas de framework, pas de build : du Canvas 2D et rien d'autre.

```
                    ▲̵̶
                   ╱╲╲        ✵ · ✦ · ✵
                  ╱  ╲╲      ·  ✧  ·  ✦
                 ═════▲═════
                      ║║
```

## Ce que c'est

Un Galaga repensé pour la sensation. Tout ce qui bouge laisse une traînée lumineuse, tout ce qui meurt explose en gerbe, et chaque impact fige brièvement l'image avant de secouer la caméra.

## Ce qu'il y a dedans

**Le rendu.** Un moteur de bloom maison : la scène est dessinée dans un buffer émissif hors-écran, flouté en deux passes, puis recomposé en additif. Par-dessus, aberration chromatique et vignette. Les vaisseaux sont des tracés vectoriels — noyau clair, halo saturé — jamais des formes pleines.

**Le ressenti.** Hitstop à cumul amorti, screenshake par trauma piloté par un bruit lissé, flash plein écran, recul d'arme, éclat au canon. La hitbox du joueur est réduite à quelques pixels, façon Ikaruga : on frôle sans mourir.

**Les traînées.** Buffer persistant atténué par purge roulante — chaque frame nettoie une bande différente, ce qui casse l'arrondi 8 bits et permet des traînées longues sans le voile résiduel qui les accompagne d'habitude.

**Le monde.** 20 stages, chacun avec son ciel : nébuleuses, planètes vectorielles à anneaux, lunes en orbite. Comètes, pluies de météores, éclipses et tempêtes magnétiques traversent le décor. Le fond réagit au jeu — il pulse aux explosions et vire au rouge quand la dernière vie s'approche.

**Les boss.** Un tous les cinq stages, en trois phases chacun. *La Ruche* libère des essaims. *Le Prisme* se scinde en fragments qui renvoient ses rayons. *Le Serpent* ondule et perd ses segments un par un. *Le Cœur* recombine les trois.

**L'arsenal.** Treize power-ups sur trois emplacements indépendants : une arme (laser perforant, missiles chercheurs, mitraille, onde), un bouclier, et des modificateurs cumulables (ralenti, aimant, multiplicateur). Laser niveau 3 + bouclier + multiplicateur se combinent.

**Le son.** Entièrement synthétisé en Web Audio — aucun fichier audio. Chaque bruitage est généré à la volée avec une légère variation pour ne jamais lasser.

## Jouer

Le jeu a besoin d'un serveur local (les modules sont chargés par HTTP) :

```bash
python3 -m http.server 8000
```

Puis ouvrir <http://localhost:8000>.

| Touche | Action |
|---|---|
| ← → | Déplacer |
| Espace | Tirer (maintenir pour l'auto-fire) |
| P | Pause |
| A | Réglages audio |
| F3 | Statistiques de debug |

Pour ajouter tes propres musiques : dépose des fichiers dans `assets/audio/musique/` et déclare-les dans `assets/audio/manifest.json`.

## Sous le capot

Tout le mouvement est exprimé en **pixels par seconde** et intégré avec le delta-time : le jeu se comporte identiquement à 30, 60 ou 144 Hz. Le canvas suit le `devicePixelRatio`, donc le rendu est net sur écran Retina. Une frame complète coûte environ **4 ms** en 3024×1890, soit un quart du budget d'un affichage à 60 Hz.

```
js/
├── core/       config, palette, entrées, stages
├── entities/   joueur, ennemis, boss, projectiles, effets, power-ups, étoiles
├── render/     moteur néon (bloom), décors
├── ui/         HUD, menus
└── audio/      synthèse procédurale
```

## Licence

Libre d'utilisation à des fins éducatives.
