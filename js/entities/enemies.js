// Variables de gestion des ennemis
let enemies = [];
let enemySpeed = 1;
let enemyDirection = 1; // 1 = vers la droite, -1 = vers la gauche
const enemyDrop = 20;
let enemyShotTimer = 0;
const enemyShotInterval = 2000; // en ms

// Création d'un ennemi
function createEnemy(x, y, type, stage = 1, pattern = ENEMY_PATTERNS.PATROL) {
  let enemy = { 
    x, 
    y, 
    width: 40, 
    height: 30, 
    type,
    pattern,
    patternStep: 0,
    startX: x,
    startY: y,
    active: false,
    angle: 0,
    diving: false,
    hasEntered: false, // Indique si l'ennemi est entré complètement dans l'écran
    targetY: y // Position Y cible pour l'entrée progressive
  };

  // Calculer le multiplicateur de vitesse basé sur le stage et le score
  const stageMultiplier = 1 + (stage - 1) * 0.1;
  const scoreMultiplier = Math.min(
    1 + (score * SPEED_CONFIG.SPEED_INCREMENT),
    SPEED_CONFIG.MAX_SPEED_MULTIPLIER
  );
  
  const totalSpeedMultiplier = stageMultiplier * scoreMultiplier;

  if (type === "normal") {
    enemy.color = 'lime';
    enemy.hp = Math.ceil(1 * stageMultiplier);
    enemy.speedModifier = 1 * totalSpeedMultiplier;
    enemy.shotChance = 0.001 * stageMultiplier;
    enemy.points = 10;
  } else if (type === "shooter") {
    enemy.color = 'red';
    enemy.hp = Math.ceil(2 * stageMultiplier);
    enemy.speedModifier = 0.8 * totalSpeedMultiplier;
    enemy.shotChance = 0.005 * stageMultiplier;
    enemy.points = 20;
  } else if (type === "fast") {
    enemy.color = 'orange';
    enemy.hp = Math.ceil(1 * stageMultiplier);
    enemy.speedModifier = 1.5 * totalSpeedMultiplier;
    enemy.shotChance = 0.002 * stageMultiplier;
    enemy.points = 15;
  }
  return enemy;
}

// Cette fonction est maintenant dans stages.js
// function createEnemies() { ... }

// Fonction pour créer une vague d'ennemis (pour compatibilité avec game.js)
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
  
  // S'assurer que le nombre est valide
  count = Math.max(1, Math.min(count, 30));
  
  // Créer les ennemis "qui arrivent du haut de l'écran"
  for (let i = 0; i < count; i++) {
    // Déterminer le type d'ennemi selon les ratios
    const rand = Math.random();
    let type;
    if (rand < normalRatio) type = "normal";
    else if (rand < normalRatio + shooterRatio) type = "shooter";
    else type = "fast";
    
    const size = 30;
    
    // Calculer la position en haut de l'écran
    const x = Math.random() * (CANVAS_WIDTH - size - 20) + 10;
    // Position initiale au-dessus de l'écran, décalées pour entrer progressivement
    const y = -50 - (i * 30); 
    
    // Position cible en fonction de la position dans la formation
    const targetY = 60 + Math.floor(i / 10) * 40;
    
    // Créer l'ennemi avec le type et stage actuels
    const enemy = createEnemy(x, y, type, stageSystem.currentStage);
    enemy.hasEntered = false; // Pas encore entré dans l'écran
    enemy.targetY = targetY; // Position cible pour l'entrée
    
    enemies.push(enemy);
  }
}

// Mise à jour du mouvement des ennemis en fonction de leur pattern
function updateEnemyMovement(enemy, deltaTime) {
  // Si l'ennemi n'a pas encore atteint sa position initiale (entrée progressive)
  if (!enemy.hasEntered) {
    // Déplacer l'ennemi vers sa position cible
    const entrySpeed = enemy.speedModifier * 3; // Entrée plus rapide que le mouvement normal
    
    if (enemy.y < enemy.targetY) {
      enemy.y += entrySpeed;
      
      // Si l'ennemi a atteint sa position cible
      if (enemy.y >= enemy.targetY) {
        enemy.y = enemy.targetY;
        enemy.hasEntered = true;
      }
      
      // Pendant l'entrée, ne pas appliquer d'autres mouvements
      return;
    } else {
      enemy.hasEntered = true;
    }
  }

  // Pattern de patrouille - déplacement horizontal avec rebonds
  if (enemy.pattern === ENEMY_PATTERNS.PATROL) {
    enemy.x += enemySpeed * enemyDirection * enemy.speedModifier;
    return;
  }
  
  // Pattern de plongée - mouvement en arc vers le joueur
  if (enemy.pattern === ENEMY_PATTERNS.DIVE) {
    if (!enemy.diving) {
      // Commencer la plongée sur un nombre aléatoire
      if (Math.random() < 0.005 * enemy.speedModifier) {
        enemy.diving = true;
        enemy.patternStep = 0;
        // Sauvegarder la position de départ
        enemy.startX = enemy.x;
        enemy.startY = enemy.y;
        // Cibler la position du joueur
        enemy.targetX = player.x;
        enemy.targetY = CANVAS_HEIGHT - 100;
      }
    } else {
      // Exécuter la plongée
      enemy.patternStep += deltaTime * 0.001 * enemy.speedModifier;
      
      if (enemy.patternStep < 1) {
        // Phase de descente en arc
        const arcX = enemy.startX + (enemy.targetX - enemy.startX) * enemy.patternStep;
        const arcY = enemy.startY + 
          (enemy.targetY - enemy.startY) * (Math.sin(enemy.patternStep * Math.PI) * 0.8 + enemy.patternStep * 0.2);
        
        enemy.x = arcX;
        enemy.y = arcY;
      } else if (enemy.patternStep < 2) {
        // Phase de remontée
        const returnStep = enemy.patternStep - 1;
        const returnX = enemy.targetX + (enemy.startX - enemy.targetX) * returnStep;
        const returnY = enemy.targetY + (enemy.startY - enemy.targetY) * returnStep;
        
        enemy.x = returnX;
        enemy.y = returnY;
      } else {
        // Fin de la plongée
        enemy.diving = false;
        enemy.x = enemy.startX;
        enemy.y = enemy.startY;
      }
      return;
    }
  }
  
  // Pattern de balayage - mouvement sinusoïdal
  if (enemy.pattern === ENEMY_PATTERNS.SWEEP) {
    enemy.patternStep += deltaTime * 0.001 * enemy.speedModifier;
    enemy.x = enemy.startX + Math.sin(enemy.patternStep) * 100;
    return;
  }
}

// Mise à jour des ennemis
function updateEnemies(deltaTime) {
  // Déplacement des ennemis
  let hitEdge = false;
  
  // Vérifier si un ennemi touche un bord
  enemies.forEach(enemy => {
    if (!enemy.diving && enemy.hasEntered) {
      if ((enemyDirection === 1 && enemy.x + enemy.width > CANVAS_WIDTH - 10) ||
          (enemyDirection === -1 && enemy.x < 10)) {
        hitEdge = true;
      }
    }
  });
  
  // Si un ennemi a touché un bord, changer de direction et descendre
  if (hitEdge) {
    enemyDirection *= -1;
    enemies.forEach(enemy => {
      if (enemy.hasEntered && !enemy.diving) {
        enemy.y += enemyDrop;
      }
    });
  }
  
  // Mise à jour de chaque ennemi
  enemies.forEach(enemy => {
    updateEnemyMovement(enemy, deltaTime);
    
    // Tir des ennemis
    if (enemy.hasEntered && Math.random() < enemy.shotChance) {
      enemyBullets.push({
        x: enemy.x + enemy.width / 2 - 2,
        y: enemy.y + enemy.height,
        width: 4,
        height: 10,
        speed: 5,
        color: 'yellow'
      });
    }
  });
}

// Affichage des ennemis
function drawEnemies() {
  enemies.forEach(enemy => {
    ctx.fillStyle = enemy.color;
    ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
    
    // Dessiner la santé (uniquement pour les ennemis avec plus de 1 HP)
    if (enemy.hp > 1) {
      const healthBarWidth = enemy.width * 0.8;
      const healthBarHeight = 4;
      const healthBarX = enemy.x + (enemy.width - healthBarWidth) / 2;
      const healthBarY = enemy.y - healthBarHeight - 2;
      
      // Fond de la barre de vie
      ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
      ctx.fillRect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);
      
      // Barre de vie
      const healthPercentage = enemy.hp / (enemy.type === 'shooter' ? 2 : 1);
      ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
      ctx.fillRect(healthBarX, healthBarY, healthBarWidth * healthPercentage, healthBarHeight);
    }
  });
} 