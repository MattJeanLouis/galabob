// Tableaux pour les projectiles
let playerBullets = [];
let enemyBullets = [];

// Mise à jour des projectiles du joueur
function updatePlayerBullets() {
  for (let i = playerBullets.length - 1; i >= 0; i--) {
    let bullet = playerBullets[i];
    bullet.y -= bullet.speed;
    if (bullet.dx) {
      bullet.x += bullet.dx * 2;
    }
    if (bullet.y + bullet.height < 0) {
      playerBullets.splice(i, 1);
    }
  }
}

// Mise à jour des projectiles ennemis
function updateEnemyBullets() {
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    let bullet = enemyBullets[i];
    bullet.y += bullet.speed;
    if (bullet.y > CANVAS_HEIGHT) enemyBullets.splice(i, 1);
  }
}

// Dessin des projectiles du joueur
function drawPlayerBullets() {
  playerBullets.forEach(bullet => {
    ctx.fillStyle = bullet.color;
    ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
  });
}

// Dessin des projectiles ennemis
function drawEnemyBullets() {
  enemyBullets.forEach(bullet => {
    ctx.fillStyle = bullet.color;
    ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
  });
} 