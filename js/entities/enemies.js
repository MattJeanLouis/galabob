// Variables de gestion des ennemis
let enemies = [];
let enemySpeed = 1;
let enemyDirection = 1; // 1 = vers la droite, -1 = vers la gauche
const enemyDrop = 20;
let enemyShotTimer = 0;
const enemyShotInterval = 2000; // en ms

// Création d'un ennemi
function createEnemy(x, y, type, stage = 1, pattern = ENEMY_PATTERNS.PATROL) {
  // Calculer une taille aléatoire mais avec une taille minimale plus grande
  // La taille de base est augmentée à 45-80 (au lieu de 40)
  const sizeVariation = Math.random() * 0.5 + 0.8; // Entre 0.8 et 1.3 (80% à 130% de la taille de base)
  const baseSize = 45 + Math.floor(Math.random() * 35); // Entre 45 et 80 de base
  const size = Math.floor(baseSize * sizeVariation);
  
  let enemy = { 
    x, 
    y, 
    width: size, 
    height: size, 
    type,
    pattern,
    patternStep: 0,
    startX: x,
    startY: y,
    active: false,
    angle: 0,
    diving: false,
    hasEntered: false, // Indique si l'ennemi est entré complètement dans l'écran
    targetY: y, // Position Y cible pour l'entrée progressive
    oscillationFrequency: 1 + Math.random() * 2, // Fréquence d'oscillation personnalisée
    oscillationAmplitude: 10 + Math.random() * 20, // Amplitude d'oscillation personnalisée
    movementPhase: Math.random() * Math.PI * 2, // Phase aléatoire pour désynchroniser
    sinusoidalMovement: Math.random() > 0.5 // 50% de chance d'avoir un mouvement sinusoïdal supplémentaire
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
    enemy.speedModifier = (0.8 + Math.random() * 0.4) * totalSpeedMultiplier; // Vitesse variable
    enemy.shotChance = 0.0004 * stageMultiplier; // Réduit de 0.001 à 0.0004
    enemy.points = 10;
  } else if (type === "shooter") {
    enemy.color = 'red';
    enemy.hp = Math.ceil(2 * stageMultiplier);
    enemy.speedModifier = (0.6 + Math.random() * 0.4) * totalSpeedMultiplier; // Vitesse variable
    enemy.shotChance = 0.0015 * stageMultiplier; // Réduit de 0.005 à 0.0015
    enemy.points = 20;
  } else if (type === "fast") {
    enemy.color = 'orange';
    enemy.hp = Math.ceil(1 * stageMultiplier);
    enemy.speedModifier = (1.2 + Math.random() * 0.6) * totalSpeedMultiplier; // Vitesse variable
    enemy.shotChance = 0.0008 * stageMultiplier; // Réduit de 0.002 à 0.0008
    enemy.points = 15;
  }
  return enemy;
}

// Cette fonction est maintenant dans stages.js
// function createEnemies() { ... }

// Fonction pour créer une vague d'ennemis (pour compatibilité avec game.js)
function createEnemyWave(count) {
  try {
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
      const x = 50 + Math.random() * (CANVAS_WIDTH - 150);
      const y = -50 - (i * 40) - Math.random() * 30; // Ajout d'aléatoire dans le décalage vertical
      
      // Position cible en fonction de la formation - avec un peu d'aléatoire
      const targetY = 60 + Math.floor(i / 5) * 60 + Math.random() * 30;
      
      // Choisir un des patterns avec probabilités variables - plus de variété
      let pattern;
      const patternRandom = Math.random();
      if (patternRandom < 0.4) { // Réduit de 70% à 40%
        pattern = ENEMY_PATTERNS.PATROL;
      } else if (patternRandom < 0.7) { // Augmenté de 15% à 30%
        pattern = ENEMY_PATTERNS.DIVE;
      } else if (patternRandom < 0.9) { // Augmenté de 15% à 20%
        pattern = ENEMY_PATTERNS.SWEEP;
      } else {
        // 10% de chance d'avoir un nouveau pattern: ZIGZAG
        pattern = ENEMY_PATTERNS.ZIGZAG;
      }
      
      // Créer l'ennemi en utilisant la fonction createEnemy
      const enemy = createEnemy(x, y, enemyTypes[i], stageSystem.currentStage, pattern);
      
      // Personnaliser les attributs spécifiques pour l'entrée
      enemy.hasEntered = false;
      enemy.targetY = targetY;
      
      enemies.push(enemy);
    }
  } catch (e) {
    console.error("Erreur dans createEnemyWave:", e);
  }
}

// Mise à jour du mouvement des ennemis en fonction de leur pattern
function updateEnemyMovement(enemy, deltaTime) {
  try {
    // Vérifications de sécurité pour éviter les erreurs
    if (!enemy || typeof enemy !== 'object') {
      return;
    }
    
    // Cas spécial pour les ennemis en formation
    if (enemy.pattern === ENEMY_PATTERNS.FORMATION) {
      // Vérifier que l'ennemi n'est pas déjà supprimé
      if (enemy.isDeleted) {
        return;
      }
      
      // Si le stage est terminé, ne pas continuer le mouvement
      if (stageSystem.stageCompleted || stageSystem.transitionActive) {
        return;
      }
      
      // Protection contre les calculs intensifs pour les grands nombres d'ennemis
      // Réduire la fréquence de mise à jour pour les ennemis éloignés du joueur
      if (enemies.length > 10) {
        // Si l'ennemi est loin du joueur et du bas de l'écran, n'actualiser que partiellement
        const farFromPlayer = !player || (
          Math.abs(enemy.x - player.x) > 300 && 
          enemy.y < CANVAS_HEIGHT - 200
        );
        
        // Réduire la fréquence de mise à jour pour les ennemis lointains
        if (farFromPlayer && Math.random() > 0.3) {
          return; // Sauter certaines mises à jour pour économiser les ressources
        }
      }
      
      // Vérifier si l'ennemi a commencé sa chorégraphie d'entrée
      if (enemy.startFormationTime && Date.now() < enemy.startFormationTime) {
        return; // Attendre avant de commencer le mouvement
      }
      
      // Si l'ennemi n'est pas encore arrivé en formation
      if (!enemy.hasEntered) {
        try {
          // Augmenter progressivement la progression de la trajectoire
          const speed = 0.006; // Vitesse d'entrée augmentée (était 0.003)
          enemy.entryProgress = enemy.entryProgress || 0;
          enemy.entryProgress += speed * (deltaTime / 16);
          
          // Si la progression est terminée
          if (enemy.entryProgress >= 1) {
            enemy.hasEntered = true;
            enemy.x = enemy.targetX;
            enemy.y = enemy.targetY;
            enemy.startX = enemy.x;
            enemy.startY = enemy.y;
          } else {
            // Calculer la position sur la courbe de Bézier
            const path = enemy.entryPath;
            if (!path || !path.start || !path.end) {
              // Si le chemin est corrompu, avancer directement
              enemy.y += 2;
              if (enemy.y >= enemy.targetY) {
                enemy.hasEntered = true;
                enemy.x = enemy.targetX || enemy.x;
                enemy.y = enemy.targetY || enemy.y;
                enemy.startX = enemy.x;
                enemy.startY = enemy.y;
              }
              return;
            }
            
            // Utiliser une courbe de Bézier cubique pour un mouvement fluide
            const t = enemy.entryProgress;
            const p0 = path.start;
            const p3 = path.end;
            
            // Utiliser les points de contrôle ou créer des points par défaut
            const p1 = (path.controlPoints && path.controlPoints[0]) || { 
              x: p0.x + (p3.x - p0.x) / 3, 
              y: p0.y + (p3.y - p0.y) / 3 
            };
            const p2 = (path.controlPoints && path.controlPoints[1]) || { 
              x: p0.x + 2 * (p3.x - p0.x) / 3, 
              y: p0.y + 2 * (p3.y - p0.y) / 3 
            };
            
            // Calculer le point sur la courbe de Bézier, avec une protection contre NaN
            try {
              const point = calculateBezierPoint(t, p0, p1, p2, p3);
              if (isNaN(point.x) || isNaN(point.y)) {
                // Si le calcul donne NaN, utiliser une approche linéaire simple
                enemy.x = p0.x + (p3.x - p0.x) * t;
                enemy.y = p0.y + (p3.y - p0.y) * t;
              } else {
                enemy.x = point.x;
                enemy.y = point.y;
              }
            } catch (e) {
              // En cas d'erreur dans le calcul, utiliser une approche linéaire simple
              enemy.x = p0.x + (p3.x - p0.x) * t;
              enemy.y = p0.y + (p3.y - p0.y) * t;
            }
          }
        } catch (e) {
          console.error("Erreur dans le calcul de trajectoire d'un ennemi:", e);
          // En cas d'erreur, faire avancer l'ennemi directement
          enemy.y += 2;
          if (enemy.y >= (enemy.targetY || 100)) {
            enemy.hasEntered = true;
          }
        }
        return;
      }
      
      // Une fois en formation, ajouter un léger mouvement de flottement
      const time = Date.now() / 1000;
      const phaseOffset = enemy.formationIndex * 0.2; // Décalage de phase pour éviter le mouvement synchronisé
      
      // Léger mouvement sinusoïdal horizontal
      const horizontalAmplitude = 5;
      const horizontalFrequency = 0.5;
      enemy.x = enemy.startX + Math.sin(time * horizontalFrequency + phaseOffset) * horizontalAmplitude;
      
      // Léger mouvement sinusoïdal vertical
      const verticalAmplitude = 3;
      const verticalFrequency = 0.3;
      enemy.y = enemy.startY + Math.sin(time * verticalFrequency + phaseOffset) * verticalAmplitude;
      
      // Parfois, un ennemi peut plonger pour attaquer (comme dans Galaga)
      if (enemy.hasEntered && !enemy.diving && Math.random() < 0.0001) { // Réduit de 0.0003 à 0.0001
        enemy.diving = true;
        enemy.diveStartX = enemy.x;
        enemy.diveStartY = enemy.y;
        enemy.diveProgress = 0;
        
        // Cibler une position près du joueur
        if (player) {
          enemy.targetX = Math.max(50, Math.min(CANVAS_WIDTH - 50, player.x + (Math.random() * 200 - 100)));
          enemy.targetY = Math.min(CANVAS_HEIGHT * 0.8, CANVAS_HEIGHT * 0.5 + Math.random() * 0.3 * CANVAS_HEIGHT);
        } else {
          enemy.targetX = CANVAS_WIDTH / 2;
          enemy.targetY = CANVAS_HEIGHT * 0.7;
        }
      }
      
      // Gestion de la plongée en formation
      if (enemy.diving) {
        const diveSpeed = 0.0012; // Vitesse de plongée réduite (était 0.002)
        enemy.diveProgress += deltaTime * diveSpeed;
        
        if (enemy.diveProgress < 1) {
          // Descente avec courbe
          const t = enemy.diveProgress;
          
          // Courbe de Bézier pour la descente
          const p0 = { x: enemy.diveStartX, y: enemy.diveStartY };
          const p3 = { x: enemy.targetX, y: enemy.targetY };
          const p1 = { x: p0.x, y: p0.y + 50 };
          const p2 = { x: p3.x, y: p3.y - 50 };
          
          const point = calculateBezierPoint(t, p0, p1, p2, p3);
          enemy.x = point.x;
          enemy.y = point.y;
        } 
        else if (enemy.diveProgress < 2) {
          // Remontée vers la formation
          const t = enemy.diveProgress - 1;
          
          // Courbe de Bézier pour la remontée
          const p0 = { x: enemy.targetX, y: enemy.targetY };
          const p3 = { x: enemy.startX, y: enemy.startY };
          const p1 = { x: p0.x, y: p0.y - 50 };
          const p2 = { x: p3.x, y: p3.y + 50 };
          
          const point = calculateBezierPoint(t, p0, p1, p2, p3);
          enemy.x = point.x;
          enemy.y = point.y;
        }
        else {
          // Fin de la plongée
          enemy.diving = false;
          enemy.x = enemy.startX;
          enemy.y = enemy.startY;
        }
      }
      
      return;
    }
    
    // Si l'ennemi n'a pas encore atteint sa position initiale (entrée progressive)
    if (!enemy.hasEntered) {
      // Mouvement direct vers la cible avec vitesse variable
      const entrySpeed = 2 + Math.random() * 2; // Vitesse d'entrée entre 2 et 4
      enemy.y += entrySpeed;
      
      // Ajout d'un léger mouvement horizontal pour une entrée moins rigide
      if (enemy.sinusoidalMovement) {
        enemy.x += Math.sin(Date.now() / 500 + enemy.movementPhase) * 1.5;
      }
      
      // Si l'ennemi a atteint sa position cible
      if (enemy.y >= enemy.targetY) {
        enemy.y = enemy.targetY;
        enemy.hasEntered = true;
        enemy.startX = enemy.x;
        enemy.startY = enemy.y;
      }
      return;
    }

    // S'assurer que startX et startY sont définis pour éviter les NaN
    if (enemy.startX === undefined) enemy.startX = enemy.x;
    if (enemy.startY === undefined) enemy.startY = enemy.y;

    // Pattern de patrouille - avec mouvement vertical léger
    if (enemy.pattern === ENEMY_PATTERNS.PATROL) {
      if (enemy.sinusoidalMovement) {
        // Ajouter un mouvement vertical ondulant subtil
        const time = Date.now() / 1000;
        const offset = Math.sin(time * enemy.oscillationFrequency + enemy.movementPhase) * (enemy.oscillationAmplitude * 0.3);
        enemy.y = enemy.startY + offset;
      }
      return;
    }
    
    // Pattern de plongée - amélioré
    if (enemy.pattern === ENEMY_PATTERNS.DIVE && !enemy.diving) {
      // Probabilité de plongée ajustée pour être plus fréquente mais pas trop
      if (Math.random() < 0.001) {
        enemy.diving = true;
        enemy.diveStartX = enemy.x;
        enemy.diveStartY = enemy.y;
        enemy.diveProgress = 0;
        
        // Cibler une position plus dynamique - parfois le joueur, parfois aléatoire
        if (Math.random() < 0.7 && player) {
          // Viser près du joueur
          enemy.targetX = Math.max(50, Math.min(CANVAS_WIDTH - 50, player.x + (Math.random() * 200 - 100)));
        } else {
          // Position aléatoire
          enemy.targetX = Math.random() * (CANVAS_WIDTH - 100) + 50;
        }
        enemy.targetY = Math.min(CANVAS_HEIGHT * 0.7, CANVAS_HEIGHT * 0.4 + Math.random() * 0.3 * CANVAS_HEIGHT);
      }
    }
    // Gestion de la plongée améliorée
    else if (enemy.pattern === ENEMY_PATTERNS.DIVE && enemy.diving) {
      // Vitesse de plongée variable
      const diveSpeed = 0.001 + Math.random() * 0.0005;
      enemy.diveProgress += deltaTime * diveSpeed;
      
      if (enemy.diveProgress < 1) {
        // Descente avec courbe
        const t = enemy.diveProgress;
        enemy.x = enemy.diveStartX + (enemy.targetX - enemy.diveStartX) * t;
        // Utilisation d'une courbe de Bézier pour un mouvement plus fluide
        const bezierY = enemy.diveStartY * Math.pow(1-t, 2) + 
                     (enemy.diveStartY + 100) * 2 * (1-t) * t + 
                     enemy.targetY * Math.pow(t, 2);
        enemy.y = bezierY;
      } 
      else if (enemy.diveProgress < 2) {
        // Remontée avec courbe
        const t = enemy.diveProgress - 1;
        enemy.x = enemy.targetX + (enemy.diveStartX - enemy.targetX) * t;
        // Courbe de Bézier pour la remontée
        const bezierY = enemy.targetY * Math.pow(1-t, 2) + 
                     (enemy.targetY - 100) * 2 * (1-t) * t + 
                     enemy.diveStartY * Math.pow(t, 2);
        enemy.y = bezierY;
      }
      else {
        // Fin de la plongée
        enemy.diving = false;
        enemy.x = enemy.diveStartX;
        enemy.y = enemy.diveStartY;
      }
    }
    
    // Pattern de balayage - amélioré
    if (enemy.pattern === ENEMY_PATTERNS.SWEEP && !enemy.diving) {
      // Oscillation verticale avec paramètres personnalisés
      const time = Date.now() / 1000;
      const offset = Math.sin(time * enemy.oscillationFrequency + enemy.movementPhase) * enemy.oscillationAmplitude;
      enemy.y = enemy.startY + offset;
      
      // Ajout d'un léger mouvement horizontal indépendant
      if (enemy.sinusoidalMovement) {
        const horizontalOffset = Math.cos(time * enemy.oscillationFrequency * 0.7 + enemy.movementPhase) * (enemy.oscillationAmplitude * 0.6);
        enemy.x = enemy.startX + horizontalOffset;
      }
    }
    
    // Nouveau pattern: ZigZag
    if (enemy.pattern === ENEMY_PATTERNS.ZIGZAG && !enemy.diving) {
      const time = Date.now() / 1000;
      // Mouvement en dents de scie pour l'axe horizontal
      const triangleWave = Math.abs(((time * enemy.oscillationFrequency * 2 + enemy.movementPhase) % 2) - 1) * 2 - 1;
      const zigzagOffset = triangleWave * enemy.oscillationAmplitude * 1.5;
      enemy.x = enemy.startX + zigzagOffset;
      
      // Léger mouvement vertical sinusoïdal
      if (enemy.sinusoidalMovement) {
        const verticalOffset = Math.sin(time * enemy.oscillationFrequency * 0.5 + enemy.movementPhase) * (enemy.oscillationAmplitude * 0.4);
        enemy.y = enemy.startY + verticalOffset;
      }
    }
  } catch (e) {
    console.error("Erreur dans updateEnemyMovement:", e);
    
    // En cas d'erreur, réinitialiser l'état de l'ennemi pour éviter les freeze
    if (enemy) {
      enemy.diving = false;
      if (enemy.startY) {
        enemy.y = enemy.startY;
      }
      if (enemy.startX) {
        enemy.x = enemy.startX;
      }
    }
  }
}

// Mise à jour des ennemis
function updateEnemies(deltaTime) {
  try {
    // La limite maximale de descente (50% de la hauteur de l'écran)
    const maxDescentY = CANVAS_HEIGHT * 0.5;
    
    // Vérifications de sécurité
    if (!enemies || !Array.isArray(enemies) || enemies.length === 0) {
      return;
    }
    
    // Simplification - pas de détection de collision temporairement
    // Nous réactiverons cette fonctionnalité quand le jeu fonctionnera sans freeze
    // detectEnemyCollisions();
    
    // Déplacement horizontal plus simple
    let hitEdge = false;
    
    // Vérifier si un ennemi touche un bord
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (enemy && enemy.hasEntered && !enemy.diving) {
        if ((enemyDirection === 1 && enemy.x + enemy.width >= CANVAS_WIDTH - 10) ||
            (enemyDirection === -1 && enemy.x <= 10)) {
          hitEdge = true;
          break;
        }
      }
    }
    
    // Si un ennemi a touché un bord, changer de direction et descendre
    if (hitEdge) {
      enemyDirection *= -1;
      
      for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (enemy && enemy.hasEntered && !enemy.diving) {
          // Descendre, mais limiter à la moitié de l'écran
          const descentAmount = enemyDrop;
          if (enemy.y + descentAmount < maxDescentY) {
            enemy.y += descentAmount;
            // Mettre à jour la position de départ pour les patterns
            enemy.startY = enemy.y;
          }
        }
      }
    }
    
    // Appliquer le mouvement horizontal - simplifié
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (enemy && enemy.hasEntered && !enemy.diving) {
        // Mouvement direct sans accélération pour simplifier
        enemy.x += enemySpeed * enemyDirection * (enemy.speedModifier || 1);
        
        // S'assurer que l'ennemi reste dans les limites de l'écran
        enemy.x = Math.max(10, Math.min(enemy.x, CANVAS_WIDTH - enemy.width - 10));
      }
    }
    
    // Mise à jour du comportement spécifique de chaque ennemi
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (enemy) {
        updateEnemyMovement(enemy, deltaTime);
        
        // Tir des ennemis - uniquement s'ils ont complètement entré dans l'écran
        // Réduire considérablement la probabilité de tir
        const reducedShotChance = (enemy.shotChance || 0.001) * 0.3; // Réduction de 70%
        if (enemy.hasEntered && !enemy.diving && Math.random() < reducedShotChance) {
          enemyBullets.push({
            x: enemy.x + enemy.width / 2 - 2,
            y: enemy.y + enemy.height,
            width: 4,
            height: 10,
            speed: 3, // Vitesse des tirs réduite (était 5)
            color: enemy.type === 'shooter' ? 'magenta' : 'yellow'
          });
        }
      }
    }
  } catch (e) {
    console.error("Erreur dans updateEnemies:", e);
  }
}

// Détection et résolution des collisions entre ennemis
function detectEnemyCollisions() {
  try {
    // Limiter le nombre de vérifications de collision pour éviter la surcharge
    const maxChecks = 100;
    let checksPerformed = 0;
    
    // Pour chaque paire d'ennemis
    for (let i = 0; i < enemies.length && checksPerformed < maxChecks; i++) {
      for (let j = i + 1; j < enemies.length && checksPerformed < maxChecks; j++) {
        checksPerformed++;
        
        const enemyA = enemies[i];
        const enemyB = enemies[j];
        
        // Vérifier si les deux ennemis sont entrés et ne sont pas en plongée
        if (enemyA && enemyB && enemyA.hasEntered && enemyB.hasEntered && 
            !enemyA.diving && !enemyB.diving) {
          
          // Test de collision simplifié (AABB)
          const collision = 
            enemyA.x < enemyB.x + enemyB.width &&
            enemyA.x + enemyA.width > enemyB.x &&
            enemyA.y < enemyB.y + enemyB.height &&
            enemyA.y + enemyA.height > enemyB.y;
          
          if (collision) {
            // Définir une petite répulsion pour éviter le chevauchement
            const repulsionForce = 1.0;
            
            // Répulsion horizontale simple
            if (enemyA.x < enemyB.x) {
              enemyA.x -= repulsionForce;
              enemyB.x += repulsionForce;
            } else {
              enemyA.x += repulsionForce;
              enemyB.x -= repulsionForce;
            }
            
            // S'assurer que les ennemis restent dans les limites de l'écran
            enemyA.x = Math.max(10, Math.min(enemyA.x, CANVAS_WIDTH - enemyA.width - 10));
            enemyB.x = Math.max(10, Math.min(enemyB.x, CANVAS_WIDTH - enemyB.width - 10));
            
            // Mettre à jour les positions de référence
            enemyA.startX = enemyA.x;
            enemyB.startX = enemyB.x;
          }
        }
      }
    }
  } catch (e) {
    console.error("Erreur lors de la détection des collisions:", e);
  }
}

// Affichage des ennemis - Version simplifiée
function drawEnemies() {
  try {
    // Si le stage est en transition, ne pas dessiner
    if (stageSystem.stageCompleted || stageSystem.transitionActive) {
      return;
    }
    
    // Créer une copie sécurisée du tableau d'ennemis pour éviter les modifications pendant le rendu
    let enemiesCopy;
    try {
      enemiesCopy = [...enemies].filter(enemy => enemy && !enemy.isDeleted);
    } catch (e) {
      console.warn("Erreur lors de la copie du tableau d'ennemis:", e);
      enemiesCopy = [];
    }
    
    // Dessiner les ennemis du plus bas au plus haut
    enemiesCopy.sort((a, b) => (a.y || 0) - (b.y || 0))
      .forEach(enemy => {
        try {
          // Vérifier que l'ennemi existe et a les propriétés nécessaires
          if (!enemy || !enemy.x || !enemy.y || !enemy.width || !enemy.height || !enemy.type) {
            return; // Ignorer les ennemis invalides
          }
          
          // Corps principal de l'ennemi - Utiliser une couleur simple au lieu de gradients complexes
          ctx.fillStyle = enemy.color || '#ff0000';
          
          // Formes simplifiées selon le type
          if (enemy.type === 'normal') {
            // Triangle
            ctx.beginPath();
            ctx.moveTo(enemy.x + enemy.width/2, enemy.y);
            ctx.lineTo(enemy.x, enemy.y + enemy.height);
            ctx.lineTo(enemy.x + enemy.width, enemy.y + enemy.height);
            ctx.closePath();
            ctx.fill();
            
            // Détail central (plus grand pour les ennemis plus grands)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.beginPath();
            ctx.arc(enemy.x + enemy.width/2, enemy.y + enemy.height/2, enemy.width/8, 0, Math.PI * 2);
            ctx.fill();
          } 
          else if (enemy.type === 'shooter') {
            // Rectangle avec un canon
            ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
            
            // Canon (plus grand pour les ennemis plus grands)
            ctx.fillStyle = 'white';
            ctx.fillRect(
              enemy.x + enemy.width/2 - enemy.width/10, 
              enemy.y + enemy.height - enemy.height/3, 
              enemy.width/5, 
              enemy.height/3
            );
            
            // Cercle central
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.beginPath();
            ctx.arc(enemy.x + enemy.width/2, enemy.y + enemy.height/2, enemy.width/6, 0, Math.PI * 2);
            ctx.fill();
          } 
          else if (enemy.type === 'fast') {
            // Forme aérodynamique simplifiée
            ctx.beginPath();
            ctx.moveTo(enemy.x + enemy.width/2, enemy.y);
            ctx.lineTo(enemy.x, enemy.y + enemy.height);
            ctx.lineTo(enemy.x + enemy.width, enemy.y + enemy.height);
            ctx.closePath();
            ctx.fill();
            
            // Traits aérodynamiques
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.beginPath();
            // Trait horizontal au centre
            ctx.moveTo(enemy.x + enemy.width/4, enemy.y + enemy.height/2);
            ctx.lineTo(enemy.x + enemy.width*3/4, enemy.y + enemy.height/2);
            // Traits diagonaux
            ctx.moveTo(enemy.x + enemy.width/4, enemy.y + enemy.height/3);
            ctx.lineTo(enemy.x + enemy.width/2, enemy.y + enemy.height*2/3);
            ctx.lineTo(enemy.x + enemy.width*3/4, enemy.y + enemy.height/3);
            ctx.stroke();
          } 
          else {
            // Fallback pour tout autre type
            ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
          }
          
          // Dessiner la santé (uniquement pour les ennemis avec plus de 1 HP)
          if (enemy.hp > 1) {
            const healthBarWidth = enemy.width * 0.8;
            const healthBarHeight = 4; // Un peu plus épais pour les grands ennemis
            const healthBarX = enemy.x + (enemy.width - healthBarWidth) / 2;
            const healthBarY = enemy.y - healthBarHeight - 2;
            
            // Fond de la barre de vie
            ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.fillRect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);
            
            // Barre de vie
            const maxHp = enemy.type === 'shooter' ? 2 : 1;
            const healthPercentage = Math.min(1, Math.max(0, enemy.hp / maxHp));
            ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
            ctx.fillRect(healthBarX, healthBarY, healthBarWidth * healthPercentage, healthBarHeight);
          }
        } catch (e) {
          console.warn("Erreur lors du rendu d'un ennemi:", e);
          // Continuer avec les autres ennemis
        }
      });
  } catch (e) {
    console.error("Erreur lors du rendu des ennemis:", e);
  }
}

// Fonction utilitaire pour convertir hexadécimal en RGB
function hexToRgb(hex) {
  // Sécurisation - si hex est undefined ou null, retourner une valeur par défaut
  if (!hex) return { r: 255, g: 0, b: 0 };
  
  try {
    // Gestion des formats hex et rgb
    if (typeof hex === 'string' && hex.startsWith('#')) {
      // Format hexadécimal (#RRGGBB)
      if (hex.length === 7) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return { r: isNaN(r) ? 0 : r, g: isNaN(g) ? 0 : g, b: isNaN(b) ? 0 : b };
      }
      // Format hexadécimal court (#RGB)
      else if (hex.length === 4) {
        const r = parseInt(hex.slice(1, 2), 16);
        const g = parseInt(hex.slice(2, 3), 16);
        const b = parseInt(hex.slice(3, 4), 16);
        return { 
          r: isNaN(r) ? 0 : r * 17, 
          g: isNaN(g) ? 0 : g * 17, 
          b: isNaN(b) ? 0 : b * 17 
        };
      }
    } 
    else if (typeof hex === 'string' && hex.startsWith('rgb')) {
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
  } catch (e) {
    console.error("Erreur lors de la conversion de couleur:", e);
  }
  
  // Valeur par défaut si le format n'est pas reconnu ou en cas d'erreur
  return { r: 255, g: 0, b: 0 };
}

// Fonction utilitaire pour ajuster la couleur (éclaircir ou assombrir)
function adjustColor(color, amount) {
  try {
    // Si la couleur est au format hexadécimal, la convertir en RGB
    const rgb = hexToRgb(color);
    
    // Ajuster chaque composante
    const r = Math.max(0, Math.min(255, rgb.r + amount));
    const g = Math.max(0, Math.min(255, rgb.g + amount));
    const b = Math.max(0, Math.min(255, rgb.b + amount));
    
    // Retourner la nouvelle couleur au format RGB
    return `rgb(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)})`;
  } catch (e) {
    console.error("Erreur lors de l'ajustement de couleur:", e);
    return color; // Retourner la couleur d'origine en cas d'erreur
  }
}

// Créer une formation d'ennemis à l'entrée
function createFormation(count, formationType, choreographyType, stage = 1) {
  // Vider le tableau d'ennemis précédents si nécessaire
  enemies = [];
  
  // Paramètres de base
  const formationSize = Math.min(count, 30); // Limiter pour éviter les surcharges
  
  // Types d'ennemis selon le stage actuel
  let normalRatio = 0.7;
  let shooterRatio = 0.15;
  let fastRatio = 0.15;
  
  // Ajuster les ratios en fonction du stage
  if (stage >= 3) {
    normalRatio = 0.5;
    shooterRatio = 0.25;
    fastRatio = 0.25;
  }
  if (stage >= 6) {
    normalRatio = 0.3;
    shooterRatio = 0.35;
    fastRatio = 0.35;
  }
  
  // Préparer un tableau avec les types d'ennemis à utiliser
  const enemyTypes = [];
  for (let i = 0; i < Math.ceil(formationSize * normalRatio); i++) enemyTypes.push("normal");
  for (let i = 0; i < Math.ceil(formationSize * shooterRatio); i++) enemyTypes.push("shooter");
  for (let i = 0; i < Math.ceil(formationSize * fastRatio); i++) enemyTypes.push("fast");
  
  // Mélanger pour une distribution aléatoire
  for (let i = enemyTypes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [enemyTypes[i], enemyTypes[j]] = [enemyTypes[j], enemyTypes[i]];
  }
  
  // Limiter à la taille exacte demandée
  while (enemyTypes.length > formationSize) {
    enemyTypes.pop();
  }
  
  // Définir les positions initiales et les trajectoires selon la chorégraphie
  const positions = calculateFormationPositions(formationType, formationSize);
  const entryPaths = calculateEntryPaths(choreographyType, positions);
  
  // Créer les ennemis avec leurs trajectoires
  for (let i = 0; i < formationSize; i++) {
    // Positions de départ, en dehors de l'écran selon la chorégraphie
    const startPosition = entryPaths[i].start;
    const targetPosition = positions[i];
    
    // Créer l'ennemi avec une taille uniforme
    const baseSize = 50; // Taille standard pour tous
    const enemy = {
      x: startPosition.x,
      y: startPosition.y,
      width: baseSize,
      height: baseSize,
      type: enemyTypes[i],
      pattern: ENEMY_PATTERNS.FORMATION,
      formationIndex: i,          // Index dans la formation
      entryPath: entryPaths[i],   // Chemin d'entrée à suivre
      entryProgress: 0,           // Progression sur le chemin (0-1)
      targetX: targetPosition.x,  // Position finale dans la formation
      targetY: targetPosition.y,
      hasEntered: false,          // Pas encore à sa position finale
      color: getEnemyColor(enemyTypes[i]),
      hp: getEnemyHP(enemyTypes[i], stage),
      speedModifier: 1,
      shotChance: getEnemyShotChance(enemyTypes[i], stage),
      startFormationTime: Date.now() + i * 100 // Réduit de 200 à 100ms pour une entrée plus rapide
    };
    
    enemies.push(enemy);
  }
}

// Calculer les positions finales selon le type de formation
function calculateFormationPositions(formationType, count) {
  const positions = [];
  const centerX = CANVAS_WIDTH / 2;
  const topY = 80; // Position en haut de l'écran
  const spacing = 60; // Espacement entre les ennemis
  
  switch (formationType) {
    case FORMATIONS.GRID:
      // Formation classique en grille (comme Galaga original)
      const cols = 8;
      const rows = Math.ceil(count / cols);
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        positions.push({
          x: centerX - (cols * spacing / 2) + col * spacing,
          y: topY + row * spacing
        });
      }
      break;
      
    case FORMATIONS.DIAMOND:
      // Formation en losange
      const diamondSize = Math.ceil(Math.sqrt(count));
      let index = 0;
      for (let row = 0; row < diamondSize; row++) {
        const rowWidth = row < diamondSize / 2 ? row * 2 + 1 : (diamondSize - row) * 2 - 1;
        for (let col = 0; col < rowWidth && index < count; col++) {
          positions.push({
            x: centerX - (rowWidth * spacing / 2) + col * spacing,
            y: topY + row * spacing
          });
          index++;
        }
      }
      break;
      
    case FORMATIONS.CIRCLE:
      // Formation en cercle
      const radius = Math.min(count * 10, 150);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        positions.push({
          x: centerX + Math.cos(angle) * radius,
          y: topY + 100 + Math.sin(angle) * radius
        });
      }
      break;
      
    case FORMATIONS.DOUBLE_ROW:
      // Formation en double ligne (style Galaga)
      const enemiesPerRow = Math.ceil(count / 2);
      for (let i = 0; i < count; i++) {
        const row = i < enemiesPerRow ? 0 : 1;
        const col = i % enemiesPerRow;
        positions.push({
          x: centerX - (enemiesPerRow * spacing / 2) + col * spacing,
          y: topY + row * spacing
        });
      }
      break;
      
    default:
      // Formation en ligne par défaut
      for (let i = 0; i < count; i++) {
        positions.push({
          x: centerX - (count * spacing / 2) + i * spacing,
          y: topY
        });
      }
  }
  
  return positions;
}

// Calculer les chemins d'entrée selon la chorégraphie
function calculateEntryPaths(choreographyType, targetPositions) {
  const entryPaths = [];
  const offscreenY = -100; // Position au-dessus de l'écran
  
  switch (choreographyType) {
    case ENTRY_CHOREOGRAPHIES.SPIRAL:
      // Les ennemis entrent en spirale
      for (let i = 0; i < targetPositions.length; i++) {
        const target = targetPositions[i];
        const angleOffset = (i / targetPositions.length) * Math.PI * 2;
        entryPaths.push({
          start: { x: CANVAS_WIDTH / 2, y: offscreenY },
          controlPoints: [
            { x: CANVAS_WIDTH / 2 + Math.cos(angleOffset) * 200, y: 100 + Math.sin(angleOffset) * 100 },
            { x: CANVAS_WIDTH / 2 + Math.cos(angleOffset + Math.PI) * 200, y: 200 + Math.sin(angleOffset + Math.PI) * 100 }
          ],
          end: target
        });
      }
      break;
      
    case ENTRY_CHOREOGRAPHIES.ZIGZAG:
      // Entrée en zigzag de gauche à droite
      for (let i = 0; i < targetPositions.length; i++) {
        const target = targetPositions[i];
        const side = i % 2 === 0 ? -1 : 1;
        entryPaths.push({
          start: { x: side > 0 ? -50 : CANVAS_WIDTH + 50, y: offscreenY + i * 20 },
          controlPoints: [
            { x: CANVAS_WIDTH / 4 * (side < 0 ? 3 : 1), y: 100 },
            { x: CANVAS_WIDTH / 4 * (side < 0 ? 1 : 3), y: 200 }
          ],
          end: target
        });
      }
      break;
      
    case ENTRY_CHOREOGRAPHIES.CURVE_LEFT:
      // Entrée en courbe depuis la gauche
      for (let i = 0; i < targetPositions.length; i++) {
        const target = targetPositions[i];
        entryPaths.push({
          start: { x: -50, y: 100 + (i * 20) % 200 },
          controlPoints: [
            { x: CANVAS_WIDTH / 4, y: 50 + (i * 30) % 150 },
            { x: CANVAS_WIDTH / 2, y: 100 }
          ],
          end: target
        });
      }
      break;
      
    case ENTRY_CHOREOGRAPHIES.CURVE_RIGHT:
      // Entrée en courbe depuis la droite
      for (let i = 0; i < targetPositions.length; i++) {
        const target = targetPositions[i];
        entryPaths.push({
          start: { x: CANVAS_WIDTH + 50, y: 100 + (i * 20) % 200 },
          controlPoints: [
            { x: CANVAS_WIDTH * 3/4, y: 50 + (i * 30) % 150 },
            { x: CANVAS_WIDTH / 2, y: 100 }
          ],
          end: target
        });
      }
      break;
      
    case ENTRY_CHOREOGRAPHIES.SPLIT:
      // Division en deux groupes
      for (let i = 0; i < targetPositions.length; i++) {
        const target = targetPositions[i];
        const side = i < targetPositions.length / 2 ? -1 : 1;
        entryPaths.push({
          start: { x: CANVAS_WIDTH / 2, y: offscreenY },
          controlPoints: [
            { x: CANVAS_WIDTH / 2 + side * 200, y: 100 },
            { x: target.x, y: 150 }
          ],
          end: target
        });
      }
      break;
      
    default:
      // Entrée simple en ligne droite
      for (let i = 0; i < targetPositions.length; i++) {
        const target = targetPositions[i];
        entryPaths.push({
          start: { x: target.x, y: offscreenY - i * 30 },
          controlPoints: [
            { x: target.x, y: (offscreenY + target.y) / 2 }
          ],
          end: target
        });
      }
  }
  
  return entryPaths;
}

// Fonction utilitaire pour calculer un point sur une courbe de Bézier
function calculateBezierPoint(t, p0, p1, p2, p3) {
  // Protection contre les valeurs NaN
  if (isNaN(t) || t < 0 || t > 1) {
    t = Math.max(0, Math.min(1, t || 0));
  }
  
  // Vérification que tous les points sont valides
  if (!p0 || !p1 || !p2 || !p3 || 
      typeof p0.x !== 'number' || typeof p0.y !== 'number' ||
      typeof p1.x !== 'number' || typeof p1.y !== 'number' ||
      typeof p2.x !== 'number' || typeof p2.y !== 'number' ||
      typeof p3.x !== 'number' || typeof p3.y !== 'number') {
    
    // En cas de données invalides, retourner un point par défaut
    console.warn("Points invalides dans calculateBezierPoint");
    return { x: 0, y: 0 };
  }
  
  try {
    const oneMinusT = 1 - t;
    const oneMinusT2 = oneMinusT * oneMinusT;
    const oneMinusT3 = oneMinusT2 * oneMinusT;
    const t2 = t * t;
    const t3 = t2 * t;
    
    // Calcul avec protection contre les dépassements numériques
    const x = oneMinusT3 * p0.x + 
              3 * oneMinusT2 * t * p1.x + 
              3 * oneMinusT * t2 * p2.x + 
              t3 * p3.x;
              
    const y = oneMinusT3 * p0.y + 
              3 * oneMinusT2 * t * p1.y + 
              3 * oneMinusT * t2 * p2.y + 
              t3 * p3.y;
    
    // Vérifier que le résultat est valide
    if (isNaN(x) || isNaN(y) || !isFinite(x) || !isFinite(y)) {
      // Interpolation linéaire en cas d'échec
      return {
        x: p0.x + t * (p3.x - p0.x),
        y: p0.y + t * (p3.y - p0.y)
      };
    }
    
    return { x, y };
  } catch (e) {
    console.error("Erreur dans calculateBezierPoint:", e);
    // Fallback: interpolation linéaire simple
    return {
      x: p0.x + t * (p3.x - p0.x),
      y: p0.y + t * (p3.y - p0.y)
    };
  }
} 