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
  
  // Déterminer le nombre d'ennemis par type
  const numNormal = Math.floor(count * normalRatio);
  const numShooter = Math.floor(count * shooterRatio);
  const numFast = count - numNormal - numShooter;
  
  // Répartition des types d'ennemis pour une vague équilibrée
  const enemyTypes = [];
  for (let i = 0; i < numNormal; i++) enemyTypes.push("normal");
  for (let i = 0; i < numShooter; i++) enemyTypes.push("shooter");
  for (let i = 0; i < numFast; i++) enemyTypes.push("fast");
  
  // Mélanger les types pour une distribution aléatoire
  for (let i = enemyTypes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [enemyTypes[i], enemyTypes[j]] = [enemyTypes[j], enemyTypes[i]];
  }
  
  // Créer les ennemis "qui arrivent du haut de l'écran"
  for (let i = 0; i < count; i++) {
    // Position initiale en haut de l'écran, avec espacement
    const x = 50 + Math.random() * (CANVAS_WIDTH - 100);
    const y = -50 - (i * 30); // Décalage vertical pour entrée progressive
    
    // Position cible en fonction de la formation
    const targetY = 60 + Math.floor(i / 10) * 40;
    
    // Choisir un des patterns avec probabilités variables
    let pattern;
    const patternRandom = Math.random();
    if (patternRandom < 0.7) {
      pattern = ENEMY_PATTERNS.PATROL; // Pattern de base (70%)
    } else if (patternRandom < 0.85) {
      pattern = ENEMY_PATTERNS.DIVE; // Pattern de plongée (15%)
    } else {
      pattern = ENEMY_PATTERNS.SWEEP; // Pattern de balayage (15%)
    }
    
    // Créer l'ennemi en utilisant la fonction createEnemy
    const enemy = createEnemy(x, y, enemyTypes[i], stageSystem.currentStage, pattern);
    
    // Personnaliser les attributs spécifiques pour l'entrée
    enemy.hasEntered = false;
    enemy.targetY = targetY;
    
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
        
        // Mémoriser sa position de départ pour les mouvements futurs
        enemy.startX = enemy.x;
        enemy.startY = enemy.y;
      }
      
      // Pendant l'entrée, ne pas appliquer d'autres mouvements
      return;
    } else {
      enemy.hasEntered = true;
      enemy.startX = enemy.x;
      enemy.startY = enemy.y;
    }
  }

  // Pattern de patrouille - déplacement horizontal avec rebonds
  if (enemy.pattern === ENEMY_PATTERNS.PATROL) {
    // Le mouvement horizontal se fait directement dans updateEnemies
    return;
  }
  
  // Pattern de plongée - mouvement en arc vers le joueur
  if (enemy.pattern === ENEMY_PATTERNS.DIVE) {
    if (!enemy.diving) {
      // Commencer la plongée sur un nombre aléatoire
      if (Math.random() < 0.002 * enemy.speedModifier) {
        enemy.diving = true;
        enemy.patternStep = 0;
        // Sauvegarder la position de départ
        enemy.diveStartX = enemy.x;
        enemy.diveStartY = enemy.y;
        // Cibler la position du joueur
        enemy.targetX = player.x;
        enemy.targetY = CANVAS_HEIGHT - 100;
      } else {
        // Si pas en plongée, continuer le mouvement horizontal standard
        return;
      }
    } else {
      // Exécuter la plongée
      enemy.patternStep += deltaTime * 0.001 * enemy.speedModifier;
      
      if (enemy.patternStep < 1) {
        // Phase de descente en arc
        const arcX = enemy.diveStartX + (enemy.targetX - enemy.diveStartX) * enemy.patternStep;
        const arcY = enemy.diveStartY + 
          (enemy.targetY - enemy.diveStartY) * (Math.sin(enemy.patternStep * Math.PI) * 0.8 + enemy.patternStep * 0.2);
        
        enemy.x = arcX;
        enemy.y = arcY;
      } else if (enemy.patternStep < 2) {
        // Phase de remontée
        const returnStep = enemy.patternStep - 1;
        const returnX = enemy.targetX + (enemy.diveStartX - enemy.targetX) * returnStep;
        const returnY = enemy.targetY + (enemy.diveStartY - enemy.targetY) * returnStep;
        
        enemy.x = returnX;
        enemy.y = returnY;
      } else {
        // Fin de la plongée
        enemy.diving = false;
        // Revenir à la position de départ
        enemy.x = enemy.diveStartX;
        enemy.y = enemy.diveStartY;
      }
    }
  }
  
  // Pattern de balayage - mouvement sinusoïdal
  if (enemy.pattern === ENEMY_PATTERNS.SWEEP) {
    // Le balayage ne remplace pas le mouvement horizontal, il s'y ajoute
    const time = Date.now() / 1000; // Temps en secondes pour l'oscillation
    
    // Ajout d'un mouvement sinusoïdal vertical
    const verticalOffset = Math.sin(time * enemy.speedModifier) * 20;
    enemy.y = enemy.startY + verticalOffset;
    
    // Le mouvement horizontal se fait toujours dans updateEnemies
  }
}

// Mise à jour des ennemis
function updateEnemies(deltaTime) {
  // Déplacement horizontal collectif des ennemis
  let hitEdge = false;
  
  // Vérifier si un ennemi touche un bord
  enemies.forEach(enemy => {
    if (enemy.hasEntered && !enemy.diving) {
      if ((enemyDirection === 1 && enemy.x + enemy.width >= CANVAS_WIDTH - 10) ||
          (enemyDirection === -1 && enemy.x <= 10)) {
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
        // Mettre à jour la position de départ pour les patterns
        enemy.startY = enemy.y;
      }
    });
  }
  
  // Appliquer le mouvement horizontal standard pour tous les ennemis qui ne plongent pas
  enemies.forEach(enemy => {
    if (enemy.hasEntered && !enemy.diving) {
      enemy.x += enemySpeed * enemyDirection * enemy.speedModifier;
      
      // S'assurer que l'ennemi reste dans les limites de l'écran
      enemy.x = Math.max(10, Math.min(enemy.x, CANVAS_WIDTH - enemy.width - 10));
    }
  });
  
  // Mise à jour du comportement spécifique de chaque ennemi
  enemies.forEach(enemy => {
    updateEnemyMovement(enemy, deltaTime);
    
    // Tir des ennemis - uniquement s'ils ont complètement entré dans l'écran
    if (enemy.hasEntered && !enemy.diving && Math.random() < enemy.shotChance) {
      enemyBullets.push({
        x: enemy.x + enemy.width / 2 - 2,
        y: enemy.y + enemy.height,
        width: 4,
        height: 10,
        speed: 5,
        color: enemy.type === 'shooter' ? 'magenta' : 'yellow'
      });
    }
  });
}

// Affichage des ennemis
function drawEnemies() {
  enemies.forEach(enemy => {
    // Couleur de base de l'ennemi
    ctx.fillStyle = enemy.color;
    
    // Gradient pour améliorer l'apparence
    const gradient = ctx.createLinearGradient(
      enemy.x, enemy.y, 
      enemy.x, enemy.y + enemy.height
    );
    gradient.addColorStop(0, enemy.color);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
    
    // Dessiner des détails selon le type d'ennemi
    if (enemy.type === 'shooter') {
      // Dessin du canon pour les shooters
      ctx.fillStyle = 'white';
      ctx.fillRect(enemy.x + enemy.width/2 - 2, enemy.y + enemy.height - 5, 4, 8);
    } else if (enemy.type === 'fast') {
      // Indicateur visuel pour les ennemis rapides
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.moveTo(enemy.x + 5, enemy.y + 5);
      ctx.lineTo(enemy.x + enemy.width - 5, enemy.y + 5);
      ctx.lineTo(enemy.x + enemy.width/2, enemy.y + enemy.height - 5);
      ctx.fill();
    }
    
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