// Fond étoilé animé
let stars = [];

// Fonction pour créer les étoiles
function createStars() {
  stars = [];
  const starCount = Math.floor((CANVAS_WIDTH * CANVAS_HEIGHT) / 4000); // Adapter le nombre d'étoiles à la taille
  for (let i = 0; i < starCount; i++) {
    stars.push({
      x: Math.random() * CANVAS_WIDTH,
      y: Math.random() * CANVAS_HEIGHT,
      radius: Math.random() * 1.5 + 0.5,
      speed: Math.random() * 0.5 + 0.2
    });
  }
}

// Mise à jour du fond étoilé
function updateStars() {
  stars.forEach(star => {
    star.y += star.speed;
    if (star.y > CANVAS_HEIGHT) {
      star.y = 0;
      star.x = Math.random() * CANVAS_WIDTH;
    }
  });
}

// Dessin du fond étoilé
function drawStars() {
  stars.forEach(star => {
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
  });
} 