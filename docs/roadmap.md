# Feuille de route Galabob

Cette feuille de route fixe les objectifs produit connus afin que les travaux
techniques restent au service du jeu.

## Modes prevus

1. **Arcade** — mode actuel désormais étendu à 100 stages, 10 zones, 100
   compositions progressives et 20 combats de boss en évolutions successives.
2. **Assaut** — première version jouable inspirée du rythme de Titan Attacks :
   30 vagues scénarisées, lignes descendantes sans plongeurs Arcade, tir manuel
   à chargeur, dégâts progressifs, munitions spéciales, crédits par élimination
   et boutique entre les secteurs.
3. **Histoire** — missions, objectifs et narration ; conception reportee.

Les modes partagent le moteur et le catalogue de contenu, mais possedent leur
progression, leurs regles de victoire et leur sauvegarde.

## Phase 1 — Fondation

- controles syntaxiques et tests sans dependance externe ;
- runtime ES module et registre de modes ;
- combo base sur le temps de jeu ;
- profil versionne par mode avec migration du meilleur score ;
- migration progressive des globales ;
- registres de vaisseaux et de power-ups ;
- stages deterministes pilotes par les donnees ;
- test de demarrage dans un vrai navigateur.

Condition de sortie : le mode arcade conserve son comportement, les nouveaux
systemes sont testables seuls et aucun contenu futur n'exige de grossir une
boucle principale monolithique.

## Phase 2 — Mobile et distribution

- pilotage tactile ;
- HUD adapte au portrait et au paysage ;
- calibration graphique sur telephones modestes ;
- manifeste PWA, icones, cache hors ligne et HTTPS ;
- deploiement statique reproductible sur Raspberry Pi.

## Phase 3 — Extension Arcade

- catalogue de vaisseaux et selection du pilote ;
- nouveaux power-ups avec raretes et regles de cumul ;
- themes de decor composables ;
- progression hybride : jalons crees a la main et stages generes de maniere
  reproductible ;
- extension par paliers jusqu'a 100 stages, avec equilibrage mesure.

## Phase 4 — Nouveaux modes

Le mode Assaut sera construit en premier sur le moteur consolide. Le mode
Histoire viendra ensuite, une fois son contenu narratif defini.
