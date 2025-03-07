// Tableaux pour les effets visuels
let explosions = [];
let debris = []; // Pour les morceaux d'explosion
let scorePopups = []; // Pour l'affichage des points gagnés
let comboTimer = 0; // Timer pour le système de combo
let comboCount = 0; // Nombre d'ennemis détruits en combo

// Effet de screen shake
let shakeTime = 0;
let shakeIntensity = 0;

// Déclencher un effet de tremblement d'écran
function triggerShake(intensity, duration) {
  shakeIntensity = intensity;
  shakeTime = duration;
}

// Créer une explosion
function createExplosion(x, y, type = 'normal') {
  let maxRadius = 30;
  let color = 'rgba(255, 165, 0, 0.7)'; // Orange par défaut
  
  // Ajuster les paramètres selon le type d'explosion
  if (type === 'player') {
    maxRadius = 50;
    color = 'rgba(255, 0, 0, 0.7)'; // Rouge pour le joueur
    // Déclencher un effet de tremblement plus fort pour le joueur
    triggerShake(10, 500);
  } else if (type === 'shooter') {
    maxRadius = 40;
    color = 'rgba(255, 0, 255, 0.7)'; // Violet pour les shooters
    triggerShake(7, 200);
  } else if (type === 'fast') {
    maxRadius = 25;
    color = 'rgba(0, 255, 0, 0.7)'; // Vert pour les fast
    triggerShake(5, 150);
  } else {
    // Ennemis normaux
    triggerShake(5, 200);
  }
  
  // Ajouter l'explosion principale
  explosions.push({
    x: x,
    y: y,
    radius: 5, // Rayon initial
    maxRadius: maxRadius,
    opacity: 1,
    color: color
  });
  
  // Ajouter quelques petites explosions secondaires
  for (let i = 0; i < 3; i++) {
    explosions.push({
      x: x + (Math.random() * 30 - 15),
      y: y + (Math.random() * 30 - 15),
      radius: 2,
      maxRadius: maxRadius * 0.5,
      opacity: 0.7,
      color: color
    });
  }
}

// Mise à jour des explosions
function updateExplosions(deltaTime) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].radius += 50 * (deltaTime / 1000);
    explosions[i].opacity -= 1 * (deltaTime / 1000);
    if (explosions[i].opacity <= 0 || explosions[i].radius >= explosions[i].maxRadius) {
      explosions.splice(i, 1);
    }
  }
}

// Mise à jour des débris
function updateDebris(deltaTime) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.x += d.dx;
    d.y += d.dy;
    d.rotation += d.rotationSpeed;
    d.lifetime -= deltaTime / 1000;
    
    // Ajout d'une légère gravité
    d.dy += 0.1;
    
    if (d.lifetime <= 0) {
      debris.splice(i, 1);
    }
  }
}

// Mise à jour des popups de score
function updateScorePopups(deltaTime) {
  for (let i = scorePopups.length - 1; i >= 0; i--) {
    const popup = scorePopups[i];
    popup.y += popup.dy;
    popup.lifetime -= deltaTime / 1000;
    
    if (popup.lifetime <= 0) {
      scorePopups.splice(i, 1);
    }
  }
}

// Mise à jour du temps de tremblement d'écran
function updateScreenShake(deltaTime) {
  if (shakeTime > 0) {
    shakeTime -= deltaTime;
    if (shakeTime < 0) shakeTime = 0;
  }
}

// Création de débris d'explosion
function createDebris(x, y, color, type) {
  const debrisPatterns = [
    // Pattern 1: explosion en croix
    () => {
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8;
        debris.push({
          x: x,
          y: y,
          dx: Math.cos(angle) * (Math.random() * 3 + 2),
          dy: Math.sin(angle) * (Math.random() * 3 + 2),
          size: Math.random() * 6 + 4,
          color: color,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.2,
          lifetime: 1.0, // en secondes
          type: 'triangle'
        });
      }
    },
    // Pattern 2: explosion circulaire
    () => {
      for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.5;
        const speed = Math.random() * 2 + 3;
        debris.push({
          x: x,
          y: y,
          dx: Math.cos(angle) * speed,
          dy: Math.sin(angle) * speed,
          size: Math.random() * 4 + 3,
          color: color,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.3,
          lifetime: 1.2,
          type: 'square'
        });
      }
    },
    // Pattern 3: explosion asymétrique
    () => {
      for (let i = 0; i < 10; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 4 + 2;
        debris.push({
          x: x,
          y: y,
          dx: Math.cos(angle) * speed,
          dy: Math.sin(angle) * speed,
          size: Math.random() * 5 + 2,
          color: color,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.4,
          lifetime: 0.8,
          type: 'shard'
        });
      }
    }
  ];

  // Choisir un pattern aléatoire
  const pattern = debrisPatterns[Math.floor(Math.random() * debrisPatterns.length)];
  pattern();
}

// Création d'un popup de score avec système de combo
function createScorePopup(x, y, points, combo) {
  const multiplier = Math.min(combo, 8); // Limite le multiplicateur à 8x
  const finalPoints = points * multiplier;
  
  scorePopups.push({
    x: x,
    y: y,
    points: finalPoints,
    text: `${finalPoints}${multiplier > 1 ? ` x${multiplier}` : ''}`,
    lifetime: 1.0,
    dy: -1,
    color: multiplier > 1 ? `hsl(${30 + multiplier * 30}, 100%, 50%)` : 'white'
  });
  
  return finalPoints;
}

// Dessin des explosions
function drawExplosions() {
  explosions.forEach(exp => {
    ctx.save();
    ctx.globalAlpha = exp.opacity;
    ctx.beginPath();
    ctx.arc(exp.x, exp.y, exp.radius, 0, Math.PI * 2);
    let explosionGrad = ctx.createRadialGradient(exp.x, exp.y, exp.radius / 2, exp.x, exp.y, exp.radius);
    explosionGrad.addColorStop(0, 'yellow');
    explosionGrad.addColorStop(1, 'red');
    ctx.fillStyle = explosionGrad;
    ctx.fill();
    ctx.restore();
  });
}

// Dessin des débris
function drawDebris() {
  debris.forEach(d => {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.rotation);
    ctx.fillStyle = d.color;
    ctx.globalAlpha = d.lifetime; // Fade out progressif
    
    if (d.type === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(-d.size, d.size);
      ctx.lineTo(d.size, 0);
      ctx.lineTo(-d.size, -d.size);
      ctx.closePath();
      ctx.fill();
    } else if (d.type === 'square') {
      ctx.fillRect(-d.size/2, -d.size/2, d.size, d.size);
    } else { // shard
      ctx.beginPath();
      ctx.moveTo(-d.size, 0);
      ctx.lineTo(0, -d.size/2);
      ctx.lineTo(d.size, 0);
      ctx.closePath();
      ctx.fill();
    }
    
    ctx.restore();
  });
}

// Dessin des popups de score
function drawScorePopups() {
  scorePopups.forEach(popup => {
    ctx.save();
    ctx.fillStyle = popup.color;
    ctx.globalAlpha = popup.lifetime;
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(popup.text, popup.x, popup.y);
    ctx.restore();
  });
} 