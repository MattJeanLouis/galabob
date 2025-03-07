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
    // Déplacer l'ennemi vers sa position cible avec un mouvement doux
    const entrySpeed = enemy.speedModifier * 2; // Vitesse d'entrée plus douce
    
    // Mouvement progressif vers la cible (avec easing)
    const distanceY = enemy.targetY - enemy.y;
    enemy.y += distanceY * 0.05 * entrySpeed;
    
    // Si l'ennemi est presque à sa position cible
    if (Math.abs(distanceY) < 1) {
      enemy.y = enemy.targetY;
      enemy.hasEntered = true;
      
      // Mémoriser sa position de départ pour les mouvements futurs
      enemy.startX = enemy.x;
      enemy.startY = enemy.y;
    }
    
    // Pendant l'entrée, ne pas appliquer d'autres mouvements
    return;
  }

  // Pattern de patrouille - le mouvement horizontal est géré dans updateEnemies
  if (enemy.pattern === ENEMY_PATTERNS.PATROL) {
    return;
  }
  
  // Pattern de plongée - mouvement en arc vers le joueur
  if (enemy.pattern === ENEMY_PATTERNS.DIVE) {
    if (!enemy.diving) {
      // Commencer la plongée sur un nombre aléatoire (moins fréquent)
      if (Math.random() < 0.001 * enemy.speedModifier) {
        enemy.diving = true;
        enemy.patternStep = 0;
        // Sauvegarder la position de départ
        enemy.diveStartX = enemy.x;
        enemy.diveStartY = enemy.y;
        // Cibler une position aléatoire mais pas trop basse
        const maxDiveDepth = CANVAS_HEIGHT * 0.6; // Limite de plongée à 60% de la hauteur
        enemy.targetX = Math.max(50, Math.min(CANVAS_WIDTH - 50, player.x + (Math.random() - 0.5) * 100));
        enemy.targetY = Math.min(maxDiveDepth, CANVAS_HEIGHT * 0.4 + Math.random() * 100);
      } else {
        // Si pas en plongée, continuer le mouvement horizontal standard
        return;
      }
    } else {
      // Exécuter la plongée avec un mouvement plus doux
      enemy.patternStep += deltaTime * 0.0005 * enemy.speedModifier; // Plus lent pour plus de fluidité
      
      if (enemy.patternStep < 1) {
        // Phase de descente en arc avec easing
        const t = enemy.patternStep;
        // Fonction d'easing : smooth start and stop
        const easeInOut = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        
        const arcX = enemy.diveStartX + (enemy.targetX - enemy.diveStartX) * easeInOut;
        const arcY = enemy.diveStartY + 
          (enemy.targetY - enemy.diveStartY) * (Math.sin(t * Math.PI) * 0.8 + t * 0.2);
        
        enemy.x = arcX;
        enemy.y = arcY;
      } else if (enemy.patternStep < 2) {
        // Phase de remontée avec easing
        const t = enemy.patternStep - 1;
        // Fonction d'easing : smooth start and stop
        const easeInOut = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        
        const returnX = enemy.targetX + (enemy.diveStartX - enemy.targetX) * easeInOut;
        const returnY = enemy.targetY + (enemy.diveStartY - enemy.targetY) * easeInOut;
        
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
  
  // Pattern de balayage - mouvement sinusoïdal plus fluide
  if (enemy.pattern === ENEMY_PATTERNS.SWEEP) {
    // Utiliser le temps pour une oscillation plus naturelle
    const time = Date.now() / 1000; // Temps en secondes
    
    // Oscillation verticale douce
    const amplitude = 15 + 5 * Math.sin(time * 0.5); // Amplitude variable
    const frequency = 1.5 + Math.sin(time * 0.3) * 0.2; // Fréquence variable
    
    const verticalOffset = Math.sin(time * frequency * enemy.speedModifier) * amplitude;
    enemy.y = enemy.startY + verticalOffset;
  }
}

// Mise à jour des ennemis
function updateEnemies(deltaTime) {
  // La limite maximale de descente (50% de la hauteur de l'écran)
  const maxDescentY = CANVAS_HEIGHT * 0.5;
  
  // Détecter les collisions entre ennemis
  detectEnemyCollisions();
  
  // Déplacement horizontal plus doux
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
        // Descendre, mais limiter à la moitié de l'écran
        const descentAmount = enemyDrop;
        const potentialY = enemy.y + descentAmount;
        
        // Ne pas descendre en dessous de la limite
        if (potentialY < maxDescentY) {
          enemy.y = potentialY;
          // Mettre à jour la position de départ pour les patterns
          enemy.startY = enemy.y;
        }
      }
    });
  }
  
  // Appliquer le mouvement horizontal doux pour tous les ennemis qui ne plongent pas
  enemies.forEach(enemy => {
    if (enemy.hasEntered && !enemy.diving) {
      // Mouvement plus fluide avec accélération et décélération
      const targetSpeed = enemySpeed * enemyDirection * enemy.speedModifier;
      
      // Si l'ennemi n'a pas de vitesse actuelle, l'initialiser
      if (enemy.currentSpeedX === undefined) {
        enemy.currentSpeedX = 0;
      }
      
      // Ajuster graduellement la vitesse actuelle vers la vitesse cible
      const speedDiff = targetSpeed - enemy.currentSpeedX;
      enemy.currentSpeedX += speedDiff * 0.1; // 10% de la différence à chaque frame
      
      // Appliquer la vitesse
      enemy.x += enemy.currentSpeedX;
      
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

// Détection et résolution des collisions entre ennemis
function detectEnemyCollisions() {
  // Pour chaque paire d'ennemis
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const enemyA = enemies[i];
      const enemyB = enemies[j];
      
      // Vérifier si les deux ennemis sont entrés et ne sont pas en plongée
      if (enemyA.hasEntered && enemyB.hasEntered && !enemyA.diving && !enemyB.diving) {
        // Vérifier s'il y a collision
        if (rectIntersect(enemyA, enemyB)) {
          // Calculer le vecteur de séparation
          const overlapX = (enemyA.width + enemyB.width) / 2 - Math.abs(enemyA.x - enemyB.x);
          const overlapY = (enemyA.height + enemyB.height) / 2 - Math.abs(enemyA.y - enemyB.y);
          
          // Appliquer une légère répulsion pour éviter le chevauchement
          if (overlapX < overlapY) {
            // Répulsion horizontale
            if (enemyA.x < enemyB.x) {
              enemyA.x -= overlapX / 2;
              enemyB.x += overlapX / 2;
            } else {
              enemyA.x += overlapX / 2;
              enemyB.x -= overlapX / 2;
            }
          } else {
            // Répulsion verticale
            if (enemyA.y < enemyB.y) {
              enemyA.y -= overlapY / 2;
              enemyB.y += overlapY / 2;
            } else {
              enemyA.y += overlapY / 2;
              enemyB.y -= overlapY / 2;
            }
          }
          
          // Mettre à jour les positions de référence
          enemyA.startX = enemyA.x;
          enemyA.startY = enemyA.y;
          enemyB.startX = enemyB.x;
          enemyB.startY = enemyB.y;
        }
      }
    }
  }
}

// Affichage des ennemis
function drawEnemies() {
  // Dessiner d'abord les ennemis qui sont le plus bas (pour une meilleure superposition)
  const sortedEnemies = [...enemies].sort((a, b) => a.y - b.y);
  
  sortedEnemies.forEach(enemy => {
    // Sauvegarder le contexte pour les transformations
    ctx.save();
    
    // Créer un gradient pour donner de la profondeur
    const gradient = ctx.createLinearGradient(
      enemy.x, enemy.y, 
      enemy.x, enemy.y + enemy.height
    );
    
    // Définir les couleurs du gradient selon le type
    const baseColor = enemy.color;
    const darkColor = adjustColor(baseColor, -30); // Version plus sombre
    const lightColor = adjustColor(baseColor, 30);  // Version plus claire
    
    gradient.addColorStop(0, lightColor);
    gradient.addColorStop(0.5, baseColor);
    gradient.addColorStop(1, darkColor);
    
    // Corps principal de l'ennemi
    ctx.fillStyle = gradient;
    
    // Variation de forme selon le type
    if (enemy.type === 'normal') {
      // Forme triangulaire pour les ennemis normaux
      ctx.beginPath();
      ctx.moveTo(enemy.x + enemy.width/2, enemy.y);
      ctx.lineTo(enemy.x, enemy.y + enemy.height);
      ctx.lineTo(enemy.x + enemy.width, enemy.y + enemy.height);
      ctx.closePath();
      ctx.fill();
      
      // Détails
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.beginPath();
      ctx.arc(enemy.x + enemy.width/2, enemy.y + enemy.height/2, 5, 0, Math.PI * 2);
      ctx.fill();
      
    } else if (enemy.type === 'shooter') {
      // Forme hexagonale pour les shooters
      ctx.beginPath();
      const radius = enemy.width / 2;
      const centerX = enemy.x + enemy.width / 2;
      const centerY = enemy.y + enemy.height / 2;
      
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI / 3) + Math.PI / 6;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      
      ctx.closePath();
      ctx.fill();
      
      // Canon central
      ctx.fillStyle = 'white';
      ctx.fillRect(centerX - 2, centerY + 5, 4, enemy.height / 2 - 5);
      
      // Effet lumineux au centre
      const glowGradient = ctx.createRadialGradient(
        centerX, centerY, 2,
        centerX, centerY, 10
      );
      glowGradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
      glowGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 10, 0, Math.PI * 2);
      ctx.fill();
      
    } else if (enemy.type === 'fast') {
      // Forme aérodynamique pour les ennemis rapides
      const centerX = enemy.x + enemy.width / 2;
      const centerY = enemy.y + enemy.height / 2;
      
      // Corps effilé
      ctx.beginPath();
      ctx.moveTo(centerX, enemy.y);
      ctx.lineTo(enemy.x, centerY + 5);
      ctx.lineTo(centerX - 5, enemy.y + enemy.height);
      ctx.lineTo(centerX + 5, enemy.y + enemy.height);
      ctx.lineTo(enemy.x + enemy.width, centerY + 5);
      ctx.closePath();
      ctx.fill();
      
      // Ailes latérales
      ctx.fillStyle = adjustColor(baseColor, 50);
      ctx.beginPath();
      ctx.moveTo(enemy.x, centerY);
      ctx.lineTo(enemy.x - 8, centerY + 8);
      ctx.lineTo(enemy.x, centerY + 12);
      ctx.closePath();
      ctx.fill();
      
      ctx.beginPath();
      ctx.moveTo(enemy.x + enemy.width, centerY);
      ctx.lineTo(enemy.x + enemy.width + 8, centerY + 8);
      ctx.lineTo(enemy.x + enemy.width, centerY + 12);
      ctx.closePath();
      ctx.fill();
    }
    
    // Effet de lueur pour tous les ennemis (différente intensité selon le type)
    const glowSize = enemy.type === 'shooter' ? 15 : (enemy.type === 'fast' ? 10 : 5);
    const glowOpacity = enemy.type === 'shooter' ? 0.3 : (enemy.type === 'fast' ? 0.2 : 0.15);
    
    const glowGradient = ctx.createRadialGradient(
      enemy.x + enemy.width/2, enemy.y + enemy.height/2, 1,
      enemy.x + enemy.width/2, enemy.y + enemy.height/2, glowSize
    );
    glowGradient.addColorStop(0, enemy.color);
    glowGradient.addColorStop(1, `rgba(${hexToRgb(enemy.color)}, 0)`);
    
    ctx.globalAlpha = glowOpacity;
    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(enemy.x + enemy.width/2, enemy.y + enemy.height/2, glowSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    
    // Dessiner la santé (uniquement pour les ennemis avec plus de 1 HP)
    if (enemy.hp > 1) {
      const healthBarWidth = enemy.width * 0.8;
      const healthBarHeight = 3;
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
    
    // Restaurer le contexte
    ctx.restore();
  });
}

// Fonction utilitaire pour ajuster la couleur (éclaircir ou assombrir)
function adjustColor(color, amount) {
  // Si la couleur est au format hexadécimal, la convertir en RGB
  const rgb = hexToRgb(color);
  
  // Ajuster chaque composante
  const r = Math.max(0, Math.min(255, rgb.r + amount));
  const g = Math.max(0, Math.min(255, rgb.g + amount));
  const b = Math.max(0, Math.min(255, rgb.b + amount));
  
  // Retourner la nouvelle couleur au format hexadécimal
  return `rgb(${r}, ${g}, ${b})`;
}

// Fonction utilitaire pour convertir hexadécimal en RGB
function hexToRgb(hex) {
  // Gestion des formats hex et rgb
  if (hex.startsWith('#')) {
    // Format hexadécimal
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  } else if (hex.startsWith('rgb')) {
    // Format RGB déjà
    const match = hex.match(/\d+/g);
    if (match && match.length >= 3) {
      return {
        r: parseInt(match[0]),
        g: parseInt(match[1]),
        b: parseInt(match[2])
      };
    }
  }
  
  // Valeur par défaut si le format n'est pas reconnu
  return { r: 255, g: 0, b: 0 };
} 