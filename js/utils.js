// Fonction utilitaire : détection de collision entre deux rectangles
function rectIntersect(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// Fonction pour appliquer l'effet de tremblement d'écran au dessin
function applyScreenShake(ctx) {
  if (shakeTime > 0) {
    let dx = (Math.random() - 0.5) * shakeIntensity;
    let dy = (Math.random() - 0.5) * shakeIntensity;
    ctx.translate(dx, dy);
  }
}

// Fonction de redimensionnement du canvas
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  CANVAS_WIDTH = canvas.width;
  CANVAS_HEIGHT = canvas.height;
  
  // Repositionner le joueur
  if (player) {
    player.x = CANVAS_WIDTH / 2 - player.width / 2;
    player.y = CANVAS_HEIGHT - 100;
  }
  
  // Repositionner les ennemis
  if (enemies.length > 0) {
    const rows = 4;
    const cols = 10;
    const enemyWidth = 40;
    const enemyHeight = 30;
    const paddingX = 20;
    const paddingY = 20;
    const offsetX = (CANVAS_WIDTH - (cols * enemyWidth + (cols - 1) * paddingX)) / 2;
    const offsetY = 50;
    
    enemies.forEach((enemy, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      enemy.x = offsetX + col * (enemyWidth + paddingX);
      enemy.y = offsetY + row * (enemyHeight + paddingY);
    });
  }
  
  // Recréer les étoiles pour le fond
  createStars();
} 