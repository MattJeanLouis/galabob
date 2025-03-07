// Variables d'état du jeu
let gameState = "menu"; // "menu", "playing", "gameover", "settings"
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
  createEnemies();
  if (stars.length === 0) createStars();
  gameState = "playing";
  player.speed = SPEED_CONFIG.BASE_PLAYER_SPEED;
  
  // Jouer une narration aléatoire au début de la partie
  playRandomNarration();
}

// Boucle de mise à jour
function update(deltaTime) {
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
          
          const earnedPoints = createScorePopup(
            enemies[j].x + enemies[j].width / 2,
            enemies[j].y,
            basePoints,
            comboCount
          );
          
          score += earnedPoints;
          
          // Chance de power-up
          if (Math.random() < 0.2) {
            powerUps.push(createPowerUp(
              enemies[j].x + enemies[j].width / 2 - 10,
              enemies[j].y + enemies[j].height
            ));
          }
          
          enemies.splice(j, 1);
          triggerShake(5, 200);
        }
        break;
      }
    }
  }

  // Collisions : projectiles ennemis vs joueur
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    if (rectIntersect(enemyBullets[i], player)) {
      enemyBullets.splice(i, 1);
      explosions.push({
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
  }

  // Collisions : ennemis vs joueur (contact direct ou passage en bas de l'écran)
  enemies.forEach(enemy => {
    if (rectIntersect(enemy, player) || enemy.y + enemy.height > CANVAS_HEIGHT) {
      explosions.push({
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

  // Nouvelle vague si tous les ennemis sont détruits
  if (enemies.length === 0) {
    enemySpeed += 0.5;
    createEnemies();
  }
}

// Fonction de dessin principale
function draw() {
  ctx.save();
  
  // Application de l'effet de screen shake
  applyScreenShake(ctx);
  
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

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
  }

  ctx.restore();
  
  // Dessiner le menu des paramètres s'il est actif
  if (gameState === "settings") {
    drawSettingsMenu();
  }
} 