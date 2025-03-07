// Système de stages
const stageSystem = {
  currentStage: 1,
  maxStage: 10,
  stageCompleted: false,
  transitionActive: false,
  transitionProgress: 0,
  transitionDuration: 5000, // durée en ms
  stageStartTime: 0,
  enemiesPerStage: 30, // Nombre d'ennemis à vaincre pour compléter un stage
  enemiesDefeated: 0,
  
  // Statistiques pour l'écran de fin de stage
  stageStats: {
    score: 0,
    combo: 0,
    timeElapsed: 0
  },
  
  // Paramètres pour l'animation des étoiles
  starSpeedMultiplier: 1,
  maxStarSpeedMultiplier: 10,
  
  // Paramètres pour l'animation du vaisseau durant la transition
  shipTransition: {
    active: false,
    x: 0,
    y: 0,
    targetY: 0,
    speed: 10
  },
  
  // État des différentes phases de la transition
  transitionPhase: 'none', // 'none', 'stageComplete', 'speedUp', 'shipMove', 'stageBegin'
  
  // Réinitialiser les statistiques du stage
  resetStageStats() {
    this.stageStats.score = 0;
    this.stageStats.combo = 0;
    this.stageStats.timeElapsed = 0;
    this.stageStartTime = Date.now();
    this.enemiesDefeated = 0;
    this.stageCompleted = false;
  },
  
  // Initialiser un nouveau stage
  initStage() {
    // Réinitialiser l'état du jeu pour le nouveau stage
    enemySpeed = 1 + (this.currentStage * 0.2); // La vitesse augmente avec les stages
    enemyDirection = 1;
    enemyShotTimer = 0;
    playerBullets = [];
    enemyBullets = [];
    explosions = [];
    powerUps = [];
    
    // Créer les ennemis adaptés au stage actuel
    createEnemiesForStage(this.currentStage);
    
    // Réinitialiser les statistiques du stage
    this.resetStageStats();
    
    // Réinitialiser les paramètres de transition
    this.transitionActive = false;
    this.transitionProgress = 0;
    this.starSpeedMultiplier = 1;
    this.transitionPhase = 'none';
    
    // Remettre le joueur en position normale
    player.x = CANVAS_WIDTH / 2 - player.width / 2;
    player.y = CANVAS_HEIGHT - player.height - 20;
    
    // Jouer une narration de début de stage
    playRandomNarration();
    
    // Remettre le jeu en mode "playing"
    gameState = "playing";
  },
  
  // Démarrer la transition vers le stage suivant
  startTransition() {
    this.transitionActive = true;
    this.transitionProgress = 0;
    this.transitionPhase = 'stageComplete';
    this.starSpeedMultiplier = 1;
    
    // Sauvegarder les statistiques du stage
    this.stageStats.timeElapsed = Date.now() - this.stageStartTime;
    
    // Configurer le vaisseau pour la transition
    this.shipTransition.active = false;
    this.shipTransition.x = player.x;
    this.shipTransition.y = player.y;
    this.shipTransition.targetY = -player.height;
    
    // Pause du gameplay normal
    isPaused = true;
  },
  
  // Passer au stage suivant
  goToNextStage() {
    this.currentStage++;
    if (this.currentStage > this.maxStage) {
      // Victoire finale du jeu si tous les stages sont terminés
      // Pour l'instant on boucle
      this.currentStage = 1;
    }
    
    this.stageCompleted = false;
    isPaused = false;
    this.initStage();
  },
  
  // Mettre à jour la progression de la transition
  updateTransition(deltaTime) {
    if (!this.transitionActive) return;
    
    // Progression de la transition
    this.transitionProgress += deltaTime / this.transitionDuration;
    
    // Gestion des différentes phases de la transition
    if (this.transitionPhase === 'stageComplete') {
      // Phase 1: Afficher "Stage X Complete!"
      if (this.transitionProgress > 0.3) {
        this.transitionPhase = 'speedUp';
      }
    } 
    else if (this.transitionPhase === 'speedUp') {
      // Phase 2: Accélérer les étoiles
      this.starSpeedMultiplier += deltaTime * 0.005;
      if (this.starSpeedMultiplier > this.maxStarSpeedMultiplier) {
        this.starSpeedMultiplier = this.maxStarSpeedMultiplier;
      }
      
      if (this.transitionProgress > 0.5) {
        this.transitionPhase = 'shipMove';
        this.shipTransition.active = true;
      }
    } 
    else if (this.transitionPhase === 'shipMove') {
      // Phase 3: Déplacer le vaisseau vers le haut
      this.shipTransition.y -= this.shipTransition.speed;
      
      if (this.shipTransition.y <= this.shipTransition.targetY) {
        this.transitionPhase = 'stageBegin';
      }
    } 
    else if (this.transitionPhase === 'stageBegin') {
      // Phase 4: Afficher "Stage X"
      if (this.transitionProgress >= 0.9) {
        // Terminer la transition et commencer le stage suivant
        this.goToNextStage();
        this.transitionActive = false;
      }
    }
    
    // Mise à jour des étoiles pendant la transition
    updateStarsTransition();
  },
  
  // Dessiner la transition entre les stages
  drawTransition() {
    if (!this.transitionActive) return;
    
    // Fond noir
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Dessiner les étoiles en accélération
    drawStars();
    
    // Afficher les textes de transition selon la phase actuelle
    ctx.font = 'bold 48px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    
    if (this.transitionPhase === 'stageComplete') {
      // Affichage "Stage X Completed"
      ctx.fillText(`Stage ${this.currentStage} Terminé!`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 50);
      
      // Résumé des statistiques
      ctx.font = '24px Arial';
      ctx.fillText(`Score: ${this.stageStats.score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx.fillText(`Combo Max: ${this.stageStats.combo}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 35);
      ctx.fillText(`Temps: ${Math.floor(this.stageStats.timeElapsed / 1000)}s`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);
    } 
    else if (this.transitionPhase === 'stageBegin') {
      // Affichage "Stage X"
      ctx.fillText(`Stage ${this.currentStage}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      
      // Instructions
      ctx.font = '24px Arial';
      ctx.fillText("Préparez-vous...", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 50);
    }
    
    // Dessiner le vaisseau en mouvement pendant la phase 'shipMove'
    if (this.shipTransition.active) {
      ctx.fillStyle = player.color;
      ctx.fillRect(
        this.shipTransition.x, 
        this.shipTransition.y, 
        player.width, 
        player.height
      );
      
      // Dessiner les propulseurs (effet visuel)
      ctx.fillStyle = 'orange';
      ctx.beginPath();
      ctx.moveTo(this.shipTransition.x + player.width / 2, this.shipTransition.y + player.height);
      ctx.lineTo(this.shipTransition.x + player.width / 2 - 10, this.shipTransition.y + player.height + 15);
      ctx.lineTo(this.shipTransition.x + player.width / 2 + 10, this.shipTransition.y + player.height + 15);
      ctx.fill();
    }
  }
};

// Fonction pour créer des ennemis adaptés au stage actuel
function createEnemiesForStage(stageNumber) {
  enemies = [];
  
  // Nombre d'ennemis dépend du niveau (augmente avec les stages)
  const baseEnemyCount = stageSystem.enemiesPerStage;
  
  // Types d'ennemis selon le stage
  let normalRatio = 0.8;
  let shooterRatio = 0.1;
  let fastRatio = 0.1;
  
  // Ajuster les ratios en fonction du stage
  if (stageNumber >= 3) {
    normalRatio = 0.6;
    shooterRatio = 0.2;
    fastRatio = 0.2;
  }
  if (stageNumber >= 6) {
    normalRatio = 0.4;
    shooterRatio = 0.3;
    fastRatio = 0.3;
  }
  
  // Créer les ennemis initiaux (environ 30-40% du total)
  const initialEnemies = Math.floor(baseEnemyCount * 0.4);
  
  for (let i = 0; i < initialEnemies; i++) {
    const type = determineEnemyType(normalRatio, shooterRatio, fastRatio);
    const size = 30;
    
    // Calculer la position pour former des vagues
    const cols = 10;
    const spacingX = 60;
    const spacingY = 40;
    const startX = (CANVAS_WIDTH - (cols * spacingX)) / 2 + 15;
    
    const col = i % cols;
    const row = Math.floor(i / cols);
    
    enemies.push({
      x: startX + col * spacingX,
      y: 60 + row * spacingY,
      width: size,
      height: size,
      hp: getEnemyHP(type, stageNumber),
      type: type,
      color: getEnemyColor(type),
      speedModifier: getEnemySpeedModifier(type, stageNumber),
      shotChance: getEnemyShotChance(type, stageNumber),
      points: getEnemyPoints(type),
      hasEntered: true
    });
  }
}

// Fonctions auxiliaires pour la création des ennemis
function determineEnemyType(normalRatio, shooterRatio, fastRatio) {
  const rand = Math.random();
  if (rand < normalRatio) return "normal";
  if (rand < normalRatio + shooterRatio) return "shooter";
  return "fast";
}

function getEnemyHP(type, stageNumber) {
  const stageMultiplier = 1 + (stageNumber - 1) * 0.2;
  
  switch (type) {
    case "normal": return Math.ceil(1 * stageMultiplier);
    case "shooter": return Math.ceil(2 * stageMultiplier);
    case "fast": return Math.ceil(1 * stageMultiplier);
    default: return 1;
  }
}

function getEnemyColor(type) {
  switch (type) {
    case "normal": return "red";
    case "shooter": return "purple";
    case "fast": return "green";
    default: return "red";
  }
}

function getEnemySpeedModifier(type, stageNumber) {
  const stageMultiplier = 1 + (stageNumber - 1) * 0.1;
  
  switch (type) {
    case "normal": return 1 * stageMultiplier;
    case "shooter": return 0.7 * stageMultiplier;
    case "fast": return 1.5 * stageMultiplier;
    default: return 1;
  }
}

function getEnemyShotChance(type, stageNumber) {
  const stageMultiplier = 1 + (stageNumber - 1) * 0.1;
  
  switch (type) {
    case "normal": return 0.001 * stageMultiplier;
    case "shooter": return 0.005 * stageMultiplier;
    case "fast": return 0.002 * stageMultiplier;
    default: return 0.001;
  }
}

function getEnemyPoints(type) {
  switch (type) {
    case "normal": return 10;
    case "shooter": return 20;
    case "fast": return 15;
    default: return 10;
  }
}

// Mise à jour spécifique des étoiles pendant la transition
function updateStarsTransition() {
  stars.forEach(star => {
    star.y += star.speed * stageSystem.starSpeedMultiplier;
    if (star.y > CANVAS_HEIGHT) {
      star.y = 0;
      star.x = Math.random() * CANVAS_WIDTH;
    }
  });
} 