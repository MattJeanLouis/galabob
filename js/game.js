// Variables d'état du jeu
let gameState = "menu"; // "menu", "playing", "gameover", "settings", "transition"
let isPaused = false;

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
  stageSystem.initStage();
  
  if (stars.length === 0) createStars();
  gameState = "playing";
  player.speed = SPEED_CONFIG.BASE_PLAYER_SPEED;
  
  // Jouer une narration aléatoire au début de la partie
  playRandomNarration();
}

// Boucle de mise à jour
function update(deltaTime) {
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

  // Collisions : projectiles du joueur vs ennemis
  for (let i = playerBullets.length - 1; i >= 0; i--) {
    for (let j = enemies.length - 1; j >= 0; j--) {
      if (rectIntersect(playerBullets[i], enemies[j])) {
        enemies[j].hp -= 1;
        playerBullets.splice(i, 1);
        
        // Gestion du combo
        const now = Date.now();
        if (now - comboTimer < COMBO_TIMEOUT) {
          comboCount++;
        } else {
          comboCount = 1;
        }
        comboTimer = now;
        
        if (enemies[j].hp <= 0) {
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
            comboCount > 1 ? 'combo' : 'normal'
          );
          
          // Créer une explosion
          createExplosion(
            enemies[j].x + enemies[j].width / 2,
            enemies[j].y + enemies[j].height / 2,
            enemies[j].type
          );
          
          // Chance de générer un power-up
          if (Math.random() < 0.1) {
            createPowerUp(
              enemies[j].x + enemies[j].width / 2 - 15,
              enemies[j].y
            );
          }
          
          // Retirer l'ennemi
          enemies.splice(j, 1);
          break;
        }
      }
    }
  }

  // Collisions : joueur vs projectiles ennemis
  enemyBullets.forEach(bullet => {
    if (rectIntersect(bullet, player)) {
      // Créer une explosion autour du joueur
      createExplosion(
        player.x + player.width / 2,
        player.y + player.height / 2,
        'player'
      );
      createExplosion({
        x: player.x + player.width / 2,
        y: player.y + player.height / 2,
        radius: 0,
        maxRadius: 30,
        opacity: 1
      });
      triggerShake(8, 300);
      player.lives -= 1;
      if (player.lives <= 0) {
        gameState = "gameover";
      }
    }
  });

  // Vérifier si le stage est terminé
  if (stageSystem.enemiesDefeated >= stageSystem.enemiesPerStage) {
    stageSystem.stageCompleted = true;
    stageSystem.startTransition();
  }
  
  // S'il n'y a plus d'ennemis, en créer de nouveaux en fonction du nombre restant à vaincre
  if (enemies.length === 0 && !stageSystem.stageCompleted) {
    // Calculer combien d'ennemis restent à vaincre dans ce stage
    const enemiesLeft = stageSystem.enemiesPerStage - stageSystem.enemiesDefeated;
    
    // S'il reste encore des ennemis à vaincre, créer une nouvelle vague
    if (enemiesLeft > 0) {
      enemySpeed += 0.2; // Augmenter la vitesse pour les vagues suivantes
      
      // Créer une nouvelle vague d'ennemis, en ajustant selon le nombre qu'il reste à vaincre
      const waveSize = Math.min(Math.floor(stageSystem.enemiesPerStage * 0.3), enemiesLeft);
      createEnemyWave(waveSize);
    }
  }
}

// Fonction pour créer une vague d'ennemis durant un stage
function createEnemyWave(count) {
  // Types d'ennemis selon le stage actuel
  let normalRatio = 0.7;
  let shooterRatio = 0.15;
  let fastRatio = 0.15;
  
  // Ajuster les ratios en fonction du stage
  if (stageSystem.currentStage >= 3) {
    normalRatio = 0.5;
    shooterRatio = 0.25;
    fastRatio = 0.25;
  }
  if (stageSystem.currentStage >= 6) {
    normalRatio = 0.3;
    shooterRatio = 0.35;
    fastRatio = 0.35;
  }
  
  // Créer les ennemis "qui arrivent du haut de l'écran"
  for (let i = 0; i < count; i++) {
    const type = determineEnemyType(normalRatio, shooterRatio, fastRatio);
    const size = 30;
    
    // Calculer la position en haut de l'écran
    const x = Math.random() * (CANVAS_WIDTH - size - 20) + 10;
    
    enemies.push({
      x: x,
      y: -50 - (i * 30), // En dehors de l'écran, décalées pour entrer progressivement
      width: size,
      height: size,
      hp: getEnemyHP(type, stageSystem.currentStage),
      type: type,
      color: getEnemyColor(type),
      speedModifier: getEnemySpeedModifier(type, stageSystem.currentStage),
      shotChance: getEnemyShotChance(type, stageSystem.currentStage),
      points: getEnemyPoints(type),
      hasEntered: false,
      targetY: 60 + Math.floor(i / 10) * 40 // Position cible pour l'entrée
    });
  }
}

// Fonction de dessin principale
function draw() {
  ctx.save();
  
  // Application de l'effet de screen shake
  applyScreenShake(ctx);
  
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Si nous sommes dans une transition de stage, dessiner la transition
  if (stageSystem.transitionActive) {
    stageSystem.drawTransition();
    ctx.restore();
    return;
  }

  // Dessin du fond étoilé
  drawStars();

  // Menu principal
  if (gameState === "menu") {
    drawMenu();
    ctx.restore();
    return;
  }

  // Menu pause
  if (isPaused) {
    drawPauseMenu();
    ctx.restore();
    return;
  }

  // Écran de Game Over
  if (gameState === "gameover") {
    drawGameOverScreen();
    ctx.restore();
    return;
  }

  // Dessiner le jeu en cours
  drawPlayer();
  drawPowerUps();
  drawPlayerBullets();
  drawEnemies();
  drawEnemyBullets();
  drawExplosions();
  drawDebris();
  drawScorePopups();
  drawHUD();

  // Afficher les infos de debug si activées
  if (gameState === "playing") {
    drawDebugInfo();
    
    // Afficher l'info du stage actuel
    ctx.font = '20px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'right';
    ctx.fillText(`Stage ${stageSystem.currentStage} - Ennemis: ${stageSystem.enemiesDefeated}/${stageSystem.enemiesPerStage}`, CANVAS_WIDTH - 20, 30);
  }

  ctx.restore();
  
  // Dessiner le menu des paramètres s'il est actif
  if (gameState === "settings") {
    drawSettingsMenu();
  }
} 