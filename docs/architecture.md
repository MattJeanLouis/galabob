# Architecture de Galabob

## Direction

Galabob reste un jeu Canvas 2D et Web Audio execute dans le navigateur. Le
serveur ne fournit que des fichiers statiques. La consolidation se fait par
migrations courtes : le mode arcade doit rester jouable apres chaque etape.

## Frontieres cibles

```text
bootstrap / application
├── moteur commun (temps, entrees, rendu, audio, collisions)
├── contenu partage (vaisseaux, armes, power-ups, ennemis, decors)
├── modes
│   ├── arcade
│   ├── assaut (futur, inspire de Titan Attacks)
│   └── histoire (futur)
└── profil persistant (reglages, records et progression par mode)
```

Un **etat d'ecran** (`menu`, `settings`, `playing`, `gameover`) n'est pas un
mode de jeu. Un mode possede les regles d'une partie : creation des stages,
progression, economie, victoire et recompenses.

## Regles de dependance

1. Les nouveaux modules utilisent `import` et `export`.
2. `window.GALABOB` est le seul pont autorise vers les scripts historiques.
3. Le moteur commun ne depend jamais d'un mode concret.
4. Les definitions de contenu sont des donnees validees, pas des branches dans
   la boucle principale.
5. Le temps de gameplay vient uniquement du delta de jeu ; aucune mecanique ne
   doit dependre de `Date.now()`.
6. Toute optimisation commence par une mesure et conserve un budget explicite.

## Migration en cours

- `js/bootstrap.js` construit le runtime partage.
- `GameModeRegistry` accueille le mode arcade et les futurs modes.
- `ComboTracker` est le premier etat de gameplay extrait et testable seul.
- `ProfileStore` versionne les records, debloquages et progressions par mode ;
  il importe automatiquement l'ancien `highScore`.
- `ShipRegistry` definit le contrat commun des vaisseaux. Le vaisseau historique
  est enregistre sous l'identifiant stable `classic`. Sa vitesse, sa cadence et
  sa hitbox passent deja par le contrat partage.
- `ShipRendererRegistry` choisit maintenant la coque via son identifiant de
  rendu. Les boucliers, bonus, traînées et hitbox restent communs aux vaisseaux.
- `PowerUpRegistry` valide le catalogue historique et centralise les alias ainsi
  que les poids contextuels. Les nouveaux modes peuvent interroger ce catalogue
  sans connaitre le fichier de rendu.
- Les treize definitions vivent dans `js/content/powerups/catalogue.js` ; le
  rendu et l'application des effets restent dans `js/entities/powerups.js`.
- `SeededRandom` fournit une graine par partie et une sous-graine stable par
  stage. Compositions, ennemis, butin et renforts y passent deja ; les effets
  purement visuels restent volontairement libres.
- `js/content/modes/arcade-progression.js` porte maintenant les paramètres de
  boucle, les thèmes et les 100 compositions. `stages.js` les exécute mais ne
  possède plus ce contenu.
- `ProgressionRegistry` valide et isole ces fiches par mode. Assaut et Histoire
  pourront donc définir leur propre longueur, leurs boss et leurs compositions.
- `EntityBudget` plafonne les effets secondaires (débris, explosions, popups et
  bonus) ; la qualité néon adaptative existante réduit ensuite résolution et
  bloom si le framerate reste durablement insuffisant.
- `game.js` et `stages.js` restent historiques et seront reduits progressivement.

## Prochaines extractions

1. Extraire le rendu du vaisseau selectionne de player.js.
2. Extraire les effets de power-ups en strategies independantes.
3. Definitions et generateur de stages deterministes.
4. Controle tactile et calibration graphique mobile.
