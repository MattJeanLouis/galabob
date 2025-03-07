# Galaga – Édition Améliorée

Un jeu inspiré de Galaga, développé en JavaScript avec HTML Canvas.

## Structure du Projet

Le projet est organisé comme suit:

```
/
├── index.html            # Page HTML principale
├── css/
│   └── style.css         # Styles CSS
├── js/
│   ├── audio.js          # Gestion du système audio
│   ├── game.js           # Logique principale du jeu
│   ├── main.js           # Point d'entrée et initialisation
│   ├── utils.js          # Fonctions utilitaires
│   ├── core/
│   │   ├── config.js     # Configuration et constantes
│   │   └── input.js      # Gestion des entrées utilisateur
│   ├── entities/
│   │   ├── stars.js      # Gestion du fond étoilé
│   │   ├── player.js     # Logique du joueur
│   │   ├── enemies.js    # Logique des ennemis
│   │   ├── projectiles.js # Gestion des projectiles
│   │   ├── effects.js    # Effets visuels (explosions, etc.)
│   │   └── powerups.js   # Gestion des power-ups
│   └── ui/
│       ├── menus.js      # Menus du jeu
│       └── hud.js        # Affichage HUD
└── assets/
    └── audio/
        ├── musique/      # Fichiers audio pour la musique
        └── narration/    # Fichiers audio pour les narrations
```

## Fonctionnalités

- Système de jeu classique inspiré de Galaga
- Différents types d'ennemis avec des comportements variés
- Power-ups pour améliorer les armes du joueur
- Système audio avancé avec musique et narrations
- Système de combo pour le scoring
- Effets visuels (explosions, débris, screen shake)
- Menu de paramètres avec options audio
- Mode debug pour afficher des statistiques en temps réel

## Comment lancer le jeu

⚠️ **Important** : Le jeu utilise des requêtes `fetch()` pour détecter et charger les fichiers audio. Pour des raisons de sécurité (CORS), ces requêtes sont bloquées lorsque vous ouvrez directement le fichier HTML sans serveur web.

Pour que le jeu fonctionne correctement avec l'audio, vous devez l'exécuter via un serveur web local :

### Option 1 : Python (méthode simple)
Si Python est installé sur votre ordinateur :

```bash
# Pour Python 3
python -m http.server

# Pour Python 2
python -m SimpleHTTPServer
```

Puis accédez à http://localhost:8000 dans votre navigateur.

### Option 2 : Node.js
Si vous avez Node.js installé :

```bash
# Installer http-server globalement (à faire une seule fois)
npm install -g http-server

# Lancer le serveur
http-server
```

Puis accédez à http://localhost:8080 dans votre navigateur.

### Option 3 : Éditeurs de code
- **VS Code** : Installez l'extension "Live Server" et lancez votre projet avec un clic droit sur `index.html` -> "Open with Live Server"
- **WebStorm/PhpStorm** : Utilisez le serveur intégré

## Contrôles

- **Flèches gauche/droite** : Déplacer le vaisseau
- **Espace** : Tirer
- **P** : Pause
- **ESC** : Quitter/Menu principal
- **A** : Afficher/Masquer les réglages audio
- **M** : Changer la musique
- **N** : Déclencher une narration
- **F3** : Afficher/Masquer les statistiques de debug

## Configuration Audio

Le jeu recherche automatiquement les fichiers audio dans les dossiers:
- `assets/audio/musique/` pour les musiques de fond
- `assets/audio/narration/` pour les narrations

Vous pouvez ajouter vos propres fichiers dans ces dossiers et le jeu les détectera automatiquement.

## Développement

Pour contribuer au projet:

1. Cloner ce dépôt
2. Ajouter/modifier des fonctionnalités dans les fichiers JavaScript correspondants
3. Tester en lançant le jeu via un serveur web local (voir instructions ci-dessus)

## Licence

Ce projet est libre d'utilisation à des fins éducatives. 