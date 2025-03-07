// Variables d'état du jeu
let gameState = "menu"; // "menu", "playing", "gameover", "settings", "transition"
let isPaused = false;

// Watchdog anti-freeze
let lastUpdateTime = Date.now();
let watchdogInterval = null;
let framesSinceLastUpdate = 0;

// Initialiser le watchdog anti-freeze
function initWatchdog() {
  // Désactiver tout watchdog existant
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
  }
  
  lastUpdateTime = Date.now();
  framesSinceLastUpdate = 0;
  
  // Créer un nouveau watchdog qui vérifie si le jeu est bloqué
  watchdogInterval = setInterval(() => {
    const now = Date.now();
    if (now - lastUpdateTime > 3000) { // Si pas de mise à jour depuis 3 secondes
      console.warn("WATCHDOG: Freeze détecté! Récupération d'urgence...");
      
      // Récupération d'urgence
      recoverFromFreeze();
    }
  }, 1000); // Vérifier chaque seconde
}

// Fonction de récupération en cas de freeze
function recoverFromFreeze() {
  try {
    // Réinitialiser les tableaux de jeu
    enemies = [];
    playerBullets = [];
    enemyBullets = [];
    powerUps = [];
    explosions = [];
    debris = [];
    scorePopups = [];
    
    // Désactiver la transition de stage si active
    if (stageSystem.transitionActive) {
      stageSystem.transitionActive = false;
      isPaused = false;
    }
    
    // Récupérer les statistiques du stage actuel
    const currentStage = stageSystem.currentStage;
    
    // Si on est au milieu d'un stage, le réinitialiser
    if (gameState === "playing") {
      // Réinitialiser le stage actuel
      stageSystem.resetStageStats();
      stageSystem.initStage();
    } else {
      // Revenir au menu
      gameState = "menu";
    }
    
    // Réinitialiser les variables temporelles
    lastUpdateTime = Date.now();
    framesSinceLastUpdate = 0;
    
    console.log("WATCHDOG: Récupération terminée");
  } catch (e) {
    console.error("WATCHDOG: Échec de la récupération:", e);
    // Dernier recours: revenir au menu principal
    gameState = "menu";
    isPaused = false;
  }
}

// Initialisation / Réinitialisation de la partie
function initGame() {
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('highScore', highScore);
  }
  score = 0;
  enemySpeed = 1;
  enemyDirection = 1;
  enemyShotTimer = 0;
  player.lives = 3;
  player.x = CANVAS_WIDTH / 2 - player.width / 2;
  player.y = CANVAS_HEIGHT - player.height - 20;
  player.weapon = 'normal';
  player.weaponTimer = 0;
  playerBullets = [];
  enemyBullets = [];
  explosions = [];
  powerUps = [];
  
  // Initialiser le système de stages
  stageSystem.currentStage = 1;
  stageSystem.resetStageStats(); // Assurons-nous que les stats sont réinitialisées avant initStage
  stageSystem.initStage();
  
  if (stars.length === 0) createStars();
  gameState = "playing";
  player.speed = SPEED_CONFIG.BASE_PLAYER_SPEED;
  
  // Initialiser le watchdog anti-freeze
  initWatchdog();
}

// Boucle de mise à jour principale
function update(deltaTime) {
  // Signaler que le jeu est actif
  lastUpdateTime = Date.now();
  framesSinceLastUpdate++;
  
  // Protection contre un deltaTime invalide
  if (!deltaTime || deltaTime > 1000) {
    deltaTime = 16; // ~60 FPS
  }
  
  try {
    // Si nous sommes dans une transition de stage, mettre à jour la transition
    if (stageSystem.transitionActive) {
      stageSystem.updateTransition(deltaTime);
      return;
    }
    
    if (gameState !== "playing" || isPaused) return;
  
    // Calculer la vitesse actuelle du joueur basée sur le score
    const playerSpeedMultiplier = Math.min(
      1 + (score * SPEED_CONFIG.SPEED_INCREMENT),
      SPEED_CONFIG.MAX_SPEED_MULTIPLIER
    );
    player.speed = SPEED_CONFIG.BASE_PLAYER_SPEED * playerSpeedMultiplier;
  
    // Mise à jour du shake
    updateScreenShake(deltaTime);
    
    // Mise à jour du joueur
    updatePlayer(deltaTime);
    
    // Mise à jour des projectiles
    updatePlayerBullets();
    updateEnemyBullets();
    
    // Mise à jour des ennemis
    updateEnemies(deltaTime);
    
    // Mise à jour des power-ups
    updatePowerUps();
    
    // Mise à jour des effets visuels
    updateExplosions(deltaTime);
    updateDebris(deltaTime);
    updateScorePopups(deltaTime);
    updateStars();
    
    // Gestion du système de combo
    if (Date.now() - comboTimer > COMBO_TIMEOUT) {
      comboCount = 0;
    }
  
    // Gestion des collisions et de la logique du jeu
    processGameLogic();
  } catch (e) {
    console.error("Erreur critique dans la boucle de mise à jour:", e);
    // Ne pas planter le jeu, continuer avec la prochaine frame
  }
}

// Fonction séparée pour la logique du jeu
function processGameLogic() {
  try {
    // Collisions : projectiles du joueur vs ennemis
    processPlayerBulletCollisions();
    
    // Collisions : joueur vs projectiles ennemis
    processEnemyBulletCollisions();
    
    // Vérifier si le stage est terminé
    if (stageSystem.enemiesDefeated >= stageSystem.enemiesPerStage && !stageSystem.stageCompleted) {
      handleStageCompletion();
    }
    
    // En dernier recours, si tous les ennemis sont supprimés mais que le stage n'est pas terminé
    // et qu'il reste des ennemis à vaincre, créer une nouvelle vague
    if (enemies.length === 0 && !stageSystem.stageCompleted) {
      handleNewWave();
    }
  } catch (e) {
    console.error("Erreur dans processGameLogic:", e);
  }
}

// Traiter les collisions des projectiles du joueur
function processPlayerBulletCollisions() {
  try {
    for (let i = playerBullets.length - 1; i >= 0; i--) {
      // Vérifier que le projectile existe toujours
      if (!playerBullets[i]) {
        continue;
      }
      
      let bulletHit = false;
      
      for (let j = enemies.length - 1; j >= 0; j--) {
        // Vérifier que l'ennemi existe toujours
        if (!enemies[j]) {
          continue;
        }
        
        try {
          if (rectIntersect(playerBullets[i], enemies[j])) {
            enemies[j].hp -= 1;
            bulletHit = true;
            
            // Gestion du combo
            const now = Date.now();
            if (now - comboTimer < COMBO_TIMEOUT) {
              comboCount++;
            } else {
              comboCount = 1;
            }
            comboTimer = now;
            
            if (enemies[j].hp <= 0) {
              try {
                // Marquer l'ennemi comme supprimé pour éviter tout traitement ultérieur
                enemies[j].isDeleted = true;
                
                // Créer l'explosion et les débris
                createDebris(
                  enemies[j].x + enemies[j].width / 2,
                  enemies[j].y + enemies[j].height / 2,
                  enemies[j].color,
                  enemies[j].type
                );
                
                // Calculer et afficher les points avec le système de combo
                let basePoints;
                if (enemies[j].type === "normal") basePoints = 10;
                else if (enemies[j].type === "shooter") basePoints = 20;
                else if (enemies[j].type === "fast") basePoints = 15;
                else basePoints = 10;
                
                const points = basePoints * comboCount;
                score += points;
                stageSystem.stageStats.score += points; // Ajout des points aux stats du stage
                
                // Mettre à jour le combo maximal enregistré pour ce stage
                if (comboCount > stageSystem.stageStats.combo) {
                  stageSystem.stageStats.combo = comboCount;
                }
                
                // Comptabiliser l'ennemi vaincu pour le stage actuel
                stageSystem.enemiesDefeated++;
                
                // Afficher le score gagné
                createScorePopup(
                  enemies[j].x + enemies[j].width / 2,
                  enemies[j].y,
                  points,
                  comboCount
                );
                
                // Créer une explosion
                createExplosion(
                  enemies[j].x + enemies[j].width / 2,
                  enemies[j].y + enemies[j].height / 2,
                  enemies[j].type
                );
                
                // Chance de générer un power-up
                if (Math.random() < 0.1) {
                  const newPowerUp = createPowerUp(
                    enemies[j].x + enemies[j].width / 2 - 10,
                    enemies[j].y
                  );
                  powerUps.push(newPowerUp);
                }
                
                // Retirer l'ennemi
                enemies.splice(j, 1);
              } catch (e) {
                console.error("Erreur lors de la suppression d'un ennemi:", e);
                // En cas d'erreur, on supprime simplement l'ennemi
                if (enemies[j]) {
                  enemies.splice(j, 1);
                }
              }
            }
            break; // Sortir de la boucle des ennemis pour ce projectile
          }
        } catch (e) {
          console.error("Erreur lors de la vérification de collision:", e);
        }
      }
      
      // Si le projectile a touché quelque chose, le supprimer
      if (bulletHit) {
        playerBullets.splice(i, 1);
      }
    }
  } catch (e) {
    console.error("Erreur dans processPlayerBulletCollisions:", e);
  }
}

// Traiter les collisions des projectiles ennemis avec le joueur
function processEnemyBulletCollisions() {
  try {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      // Vérifier que le projectile existe
      if (!enemyBullets[i] || !player) {
        continue;
      }
      
      try {
        if (rectIntersect(enemyBullets[i], player)) {
          // Retirer le projectile
          enemyBullets.splice(i, 1);
          
          // Créer une explosion autour du joueur
          createExplosion(
            player.x + player.width / 2,
            player.y + player.height / 2,
            'player'
          );
          
          triggerShake(8, 300);
          player.lives -= 1;
          if (player.lives <= 0) {
            gameState = "gameover";
          }
        }
      } catch (e) {
        console.error("Erreur lors de la vérification de collision avec le joueur:", e);
      }
    }
  } catch (e) {
    console.error("Erreur dans processEnemyBulletCollisions:", e);
  }
}

// Gérer la complétion d'un stage
function handleStageCompletion() {
  try {
    console.log("Stage terminé! Ennemis vaincus: " + stageSystem.enemiesDefeated);
    
    // Double protection contre les appels multiples
    stageSystem.stageCompleted = true;
    
    // Nettoyage préventif
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i]) {
        enemies[i].isDeleted = true;
      }
    }
    
    // Démarrer la transition avec un court délai pour éviter les conflits d'état
    setTimeout(() => {
      try {
        stageSystem.startTransition();
      } catch (e) {
        console.error("Échec du démarrage de la transition, utilisation du mécanisme de secours", e);
        // Mécanisme de secours
        stageSystem.forceNextStage();
      }
    }, 300); // Augmenté à 300ms pour donner plus de temps
  } catch (e) {
    console.error("Erreur dans handleStageCompletion:", e);
    // En cas d'échec critique, essayer de récupérer
    recoverFromFreeze();
  }
}

// Gérer la création d'une nouvelle vague
function handleNewWave() {
  try {
    // Calculer combien d'ennemis restent à vaincre dans ce stage
    const enemiesLeft = stageSystem.enemiesPerStage - stageSystem.enemiesDefeated;
    
    // Protection contre un blocage potentiel
    if (enemiesLeft > stageSystem.enemiesPerStage || enemiesLeft < 0) {
      console.warn("Nombre d'ennemis restants incohérent, forçage de fin de stage");
      stageSystem.enemiesDefeated = stageSystem.enemiesPerStage;
      stageSystem.stageCompleted = true;
      setTimeout(() => stageSystem.startTransition(), 300);
      return;
    }
    
    // S'il reste encore des ennemis à vaincre, créer une nouvelle vague
    if (enemiesLeft > 0) {
      enemySpeed += 0.2; // Augmenter la vitesse pour les vagues suivantes
      
      // Créer une nouvelle vague d'ennemis, en ajustant selon le nombre qu'il reste à vaincre
      const waveSize = Math.min(Math.floor(stageSystem.enemiesPerStage * 0.3), enemiesLeft);
      
      // Sélectionner aléatoirement une formation et une chorégraphie
      const formations = Object.values(FORMATIONS);
      const choreographies = Object.values(ENTRY_CHOREOGRAPHIES);
      
      const randomFormation = formations[Math.floor(Math.random() * formations.length)];
      const randomChoreography = choreographies[Math.floor(Math.random() * choreographies.length)];
      
      try {
        // Créer une nouvelle formation avec des patterns plus variés
        createFormation(waveSize, randomFormation, randomChoreography, stageSystem.currentStage);
      } catch (e) {
        console.error("Erreur lors de la création d'une nouvelle vague:", e);
        // En cas d'échec, utiliser une méthode de secours simple
        for (let i = 0; i < waveSize; i++) {
          const x = Math.random() * (CANVAS_WIDTH - 50);
          const y = -50 - i * 30;
          const enemy = {
            x: x,
            y: y,
            width: 50,
            height: 50,
            type: "normal",
            hp: 1,
            color: "lime",
            hasEntered: false,
            targetY: 100 + i * 20,
            pattern: ENEMY_PATTERNS.PATROL
          };
          enemies.push(enemy);
        }
      }
    }
  } catch (e) {
    console.error("Erreur dans handleNewWave:", e);
  }
}

// Fonction de dessin principale
function draw() {
  try {
    // Signaler que le jeu continue de fonctionner
    framesSinceLastUpdate++;
    
    ctx.save();
    
    // Application de l'effet de screen shake
    applyScreenShake(ctx);
    
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Si nous sommes dans une transition de stage, dessiner la transition
    if (stageSystem.transitionActive) {
      try {
        stageSystem.drawTransition();
      } catch (e) {
        console.error("Erreur lors du rendu de la transition:", e);
        // En cas d'erreur, juste dessiner un fond noir
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }
      ctx.restore();
      return;
    }

    // Dessin du fond étoilé
    try {
      drawStars();
    } catch (e) {
      console.error("Erreur lors du dessin des étoiles:", e);
    }

    // Menu principal
    if (gameState === "menu") {
      try {
        drawMenu();
      } catch (e) {
        console.error("Erreur lors du dessin du menu:", e);
      }
      ctx.restore();
      return;
    }

    // Menu pause
    if (isPaused) {
      try {
        drawPauseMenu();
      } catch (e) {
        console.error("Erreur lors du dessin du menu pause:", e);
      }
      ctx.restore();
      return;
    }

    // Écran de Game Over
    if (gameState === "gameover") {
      try {
        drawGameOverScreen();
      } catch (e) {
        console.error("Erreur lors du dessin de l'écran de game over:", e);
      }
      ctx.restore();
      return;
    }

    // Dessiner le jeu en cours - chaque fonction dans un bloc try-catch séparé
    try {
      drawPlayer();
    } catch (e) {
      console.error("Erreur lors du dessin du joueur:", e);
    }
    
    try {
      drawPowerUps();
    } catch (e) {
      console.error("Erreur lors du dessin des power-ups:", e);
    }
    
    try {
      drawPlayerBullets();
    } catch (e) {
      console.error("Erreur lors du dessin des projectiles du joueur:", e);
    }
    
    try {
      drawEnemies();
    } catch (e) {
      console.error("Erreur lors du dessin des ennemis:", e);
    }
    
    try {
      drawEnemyBullets();
    } catch (e) {
      console.error("Erreur lors du dessin des projectiles ennemis:", e);
    }
    
    try {
      drawExplosions();
    } catch (e) {
      console.error("Erreur lors du dessin des explosions:", e);
    }
    
    try {
      drawDebris();
    } catch (e) {
      console.error("Erreur lors du dessin des débris:", e);
    }
    
    try {
      drawScorePopups();
    } catch (e) {
      console.error("Erreur lors du dessin des popups de score:", e);
    }
    
    try {
      drawHUD();
    } catch (e) {
      console.error("Erreur lors du dessin du HUD:", e);
    }

    // Afficher les infos de debug si activées
    if (gameState === "playing" && GAME_CONFIG.showDebugInfo) {
      try {
        drawDebugInfo();
      } catch (e) {
        console.error("Erreur lors du dessin des infos de debug:", e);
      }
    }

    ctx.restore();
    
    // Dessiner le menu des paramètres s'il est actif
    if (gameState === "settings") {
      try {
        drawSettingsMenu();
      } catch (e) {
        console.error("Erreur lors du dessin du menu des paramètres:", e);
      }
    }
  } catch (e) {
    console.error("Erreur critique dans la fonction draw:", e);
    // Tenter de restaurer le contexte en cas d'erreur
    try {
      ctx.restore();
    } catch (e2) {
      // Ignorer
    }
  }
} 