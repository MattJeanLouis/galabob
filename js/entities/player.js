// Objet joueur
const player = {
  x: CANVAS_WIDTH / 2 - 20,
  y: CANVAS_HEIGHT - 60,
  width: 40,
  height: 20,
  speed: 5,
  color: 'white',
  lives: 3,
  weapon: 'normal', // 'normal', 'double' ou 'spread'
  weaponTimer: 0  // durée restante de l'effet de power‑up (en ms)
};

// Variables de tir du joueur
let lastShotTime = 0;
const shotCooldown = 300; // en ms

// Mise à jour du joueur
function updatePlayer(deltaTime) {
  // Déplacements du joueur
  if (keys['ArrowLeft'] || keys['Left']) {
    player.x -= player.speed;
    if (player.x < 0) player.x = 0;
  }
  if (keys['ArrowRight'] || keys['Right']) {
    player.x += player.speed;
    if (player.x + player.width > CANVAS_WIDTH)
      player.x = CANVAS_WIDTH - player.width;
  }

  // Tir du joueur selon l'arme utilisée
  if (keys[' ']) {
    let now = Date.now();
    if (now - lastShotTime > shotCooldown) {
      if (player.weapon === 'normal') {
        playerBullets.push({
          x: player.x + player.width / 2 - 2.5,
          y: player.y,
          width: 5,
          height: 10,
          speed: 7,
          color: 'yellow'
        });
      } else if (player.weapon === 'double') {
        // Deux projectiles : gauche et droite
        playerBullets.push({
          x: player.x + player.width / 4 - 2.5,
          y: player.y,
          width: 5,
          height: 10,
          speed: 7,
          color: 'cyan'
        });
        playerBullets.push({
          x: player.x + 3 * player.width / 4 - 2.5,
          y: player.y,
          width: 5,
          height: 10,
          speed: 7,
          color: 'cyan'
        });
      } else if (player.weapon === 'spread') {
        // Trois projectiles : gauche, centre, droite
        playerBullets.push({
          x: player.x + player.width / 2 - 2.5,
          y: player.y,
          width: 5,
          height: 10,
          speed: 7,
          dx: -1, // déviation à gauche
          color: 'magenta'
        });
        playerBullets.push({
          x: player.x + player.width / 2 - 2.5,
          y: player.y,
          width: 5,
          height: 10,
          speed: 7,
          dx: 0,
          color: 'magenta'
        });
        playerBullets.push({
          x: player.x + player.width / 2 - 2.5,
          y: player.y,
          width: 5,
          height: 10,
          speed: 7,
          dx: 1, // déviation à droite
          color: 'magenta'
        });
      }
      lastShotTime = now;
    }
  }

  // Mise à jour du timer d'arme spéciale
  if (player.weapon !== 'normal') {
    player.weaponTimer -= deltaTime;
    if (player.weaponTimer <= 0) {
      player.weapon = 'normal';
      player.weaponTimer = 0;
    }
  }
}

// Dessin du joueur
function drawPlayer() {
  let playerGradient = ctx.createLinearGradient(player.x, player.y, player.x, player.y + player.height);
  playerGradient.addColorStop(0, '#fff');
  playerGradient.addColorStop(1, '#888');
  ctx.fillStyle = playerGradient;
  ctx.beginPath();
  ctx.moveTo(player.x, player.y + player.height);
  ctx.lineTo(player.x + player.width / 2, player.y);
  ctx.lineTo(player.x + player.width, player.y + player.height);
  ctx.closePath();
  ctx.fill();
} 