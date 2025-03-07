// Variables de gestion des ennemis
let enemies = [];
let enemySpeed = 1;
let enemyDirection = 1; // 1 = vers la droite, -1 = vers la gauche
const enemyDrop = 20;
let enemyShotTimer = 0;
const enemyShotInterval = 2000; // en ms

// Création d'un ennemi
function createEnemy(x, y, type, pattern = ENEMY_PATTERNS.PATROL) {
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
    diving: false
  };

  // Calculer le multiplicateur de vitesse basé sur le score
  const speedMultiplier = Math.min(
    1 + (score * SPEED_CONFIG.SPEED_INCREMENT),
    SPEED_CONFIG.MAX_SPEED_MULTIPLIER
  );

  if (type === "normal") {
    enemy.color = 'lime';
    enemy.hp = 1;
    enemy.speedModifier = 1 * speedMultiplier;
  } else if (type === "shooter") {
    enemy.color = 'red';
    enemy.hp = 2;
    enemy.speedModifier = 0.8 * speedMultiplier;
  } else if (type === "fast") {
    enemy.color = 'orange';
    enemy.hp = 1;
    enemy.speedModifier = 1.2 * speedMultiplier;
  }
  return enemy;
}

// Création d'une vague d'ennemis
function createEnemies() {
  enemies = [];
  const rows = 4;
  const cols = 10;
  const enemyWidth = 40;
  const enemyHeight = 30;
  const paddingX = 20;
  const paddingY = 20;
  const offsetX = (CANVAS_WIDTH - (cols * enemyWidth + (cols - 1) * paddingX)) / 2;
  const offsetY = 50;

  const patterns = Object.values(ENEMY_PATTERNS);
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let x = offsetX + col * (enemyWidth + paddingX);
      let y = offsetY + row * (enemyHeight + paddingY);
      
      let rnd = Math.random();
      let type = "normal";
      if (rnd < 0.1) type = "fast";
      else if (rnd < 0.3) type = "shooter";
      
      const pattern = patterns[Math.floor(Math.random() * patterns.length)];
      enemies.push(createEnemy(x, y, type, pattern));
    }
  }
}

// Gestion du mouvement des ennemis
function updateEnemyMovement(enemy, deltaTime) {
  const time = Date.now() / 1000;
  
  if (!enemy.diving) {
    // Mouvement de patrouille de base
    enemy.x = enemy.startX + Math.sin(time) * 30;
    enemy.y = enemy.startY + Math.sin(time * 0.5) * 10;
    
    // Chance de commencer une plongée
    if (Math.random() < 0.001 * enemy.speedModifier) {
      enemy.diving = true;
      enemy.angle = 0;
      enemy.diveStartX = enemy.x;
      enemy.diveStartY = enemy.y;
    }
  } else {
    // Gestion des différents patterns de plongée
    switch(enemy.pattern) {
      case ENEMY_PATTERNS.DIVE:
        // Plongée en arc simple
        enemy.angle += deltaTime * 0.002 * enemy.speedModifier;
        enemy.x = enemy.diveStartX + Math.sin(enemy.angle) * 200;
        enemy.y = enemy.diveStartY + Math.sin(enemy.angle * 0.5) * 300;
        
        // Retour en formation si l'arc est complet
        if (enemy.angle >= Math.PI) {
          enemy.diving = false;
          enemy.x = enemy.startX;
          enemy.y = enemy.startY;
        }
        break;
        
      case ENEMY_PATTERNS.SWEEP:
        // Mouvement en S
        enemy.angle += deltaTime * 0.001 * enemy.speedModifier;
        enemy.x = enemy.diveStartX + Math.sin(enemy.angle * 2) * 150;
        enemy.y = enemy.diveStartY + enemy.angle * 50;
        
        // Retour en formation après une certaine distance
        if (enemy.angle >= Math.PI * 2) {
          enemy.diving = false;
          enemy.x = enemy.startX;
          enemy.y = enemy.startY;
        }
        break;
        
      default: // PATROL
        // Simple descente et remontée
        enemy.angle += deltaTime * 0.001 * enemy.speedModifier;
        enemy.y = enemy.diveStartY + Math.sin(enemy.angle) * 200;
        
        if (enemy.angle >= Math.PI) {
          enemy.diving = false;
          enemy.x = enemy.startX;
          enemy.y = enemy.startY;
        }
        break;
    }
  }
  
  // Maintenir les ennemis dans les limites de l'écran
  enemy.x = Math.max(0, Math.min(enemy.x, CANVAS_WIDTH - enemy.width));
  enemy.y = Math.max(0, Math.min(enemy.y, CANVAS_HEIGHT - enemy.height));
}

// Mise à jour de tous les ennemis
function updateEnemies(deltaTime) {
  // Déplacement horizontal et rebond des ennemis
  let needReverse = false;
  enemies.forEach(enemy => {
    enemy.x += enemySpeed * enemyDirection * enemy.speedModifier;
    if (enemy.x <= 0 || enemy.x + enemy.width >= CANVAS_WIDTH) {
      needReverse = true;
    }
  });
  if (needReverse) {
    enemyDirection *= -1;
    enemies.forEach(enemy => {
      enemy.y += enemyDrop;
    });
  }

  // Mise à jour du mouvement avancé des ennemis
  enemies.forEach(enemy => {
    updateEnemyMovement(enemy, deltaTime);
  });
  
  // Tir des ennemis
  enemyShotTimer += deltaTime;
  if (enemyShotTimer > enemyShotInterval && enemies.length > 0) {
    // Privilégier les ennemis de type shooter
    let shooterCandidates = enemies.filter(e => e.type === "shooter");
    let shooter;
    if (shooterCandidates.length > 0) {
      shooter = shooterCandidates[Math.floor(Math.random() * shooterCandidates.length)];
    } else {
      shooter = enemies[Math.floor(Math.random() * enemies.length)];
    }
    enemyBullets.push({
      x: shooter.x + shooter.width / 2 - 2.5,
      y: shooter.y + shooter.height,
      width: 5,
      height: 10,
      speed: 3,
      color: 'orange'
    });
    enemyShotTimer = 0;
  }
}

// Dessin des ennemis
function drawEnemies() {
  enemies.forEach(enemy => {
    let grad = ctx.createLinearGradient(enemy.x, enemy.y, enemy.x, enemy.y + enemy.height);
    grad.addColorStop(0, enemy.color);
    grad.addColorStop(1, '#000');
    ctx.fillStyle = grad;
    ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
    if (enemy.type !== 'normal') {
      ctx.fillStyle = 'white';
      ctx.font = '10px Arial';
      ctx.fillText(enemy.type, enemy.x + 2, enemy.y + enemy.height - 2);
    }
  });
} 