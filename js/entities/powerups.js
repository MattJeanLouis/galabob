// Power-ups pour changer d'arme
let powerUps = [];

// Création d'un power-up
function createPowerUp(x, y) {
  let types = ['double', 'spread'];
  let type = types[Math.floor(Math.random() * types.length)];
  return {
    x: x,
    y: y,
    width: 20,
    height: 20,
    type: type,
    color: (type === 'double' ? 'blue' : 'purple'),
    speed: 2
  };
}

// Mise à jour des power-ups
function updatePowerUps() {
  try {
    if (!player) return; // Vérifier que le joueur existe
    
    for (let i = powerUps.length - 1; i >= 0; i--) {
      let p = powerUps[i];
      // Vérifier que le power-up existe
      if (!p) {
        powerUps.splice(i, 1);
        continue;
      }
      
      p.y += p.speed;
      if (p.y > CANVAS_HEIGHT) {
        powerUps.splice(i, 1);
        continue;
      }
      
      if (rectIntersect(p, player)) {
        player.weapon = p.type;
        player.weaponTimer = 10000; // 10 secondes
        powerUps.splice(i, 1);
      }
    }
  } catch (e) {
    console.error("Erreur dans updatePowerUps:", e);
  }
}

// Dessin des power-ups
function drawPowerUps() {
  powerUps.forEach(p => {
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.width, p.height);
    ctx.strokeStyle = 'white';
    ctx.strokeRect(p.x, p.y, p.width, p.height);
  });
} 