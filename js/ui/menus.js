// Menu principal
function drawMenu() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  
  ctx.fillStyle = '#00ff00';
  ctx.font = '50px Arial';
  ctx.textAlign = 'center';
  ctx.fillText("GALAGA", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 3);
  
  ctx.fillStyle = 'white';
  ctx.font = '25px Arial';
  ctx.fillText("Meilleur score : " + highScore, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);
  ctx.fillText("Appuyez sur ENTRÉE pour jouer", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 20);
  ctx.fillText("Appuyez sur S pour les paramètres", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 60);
  
  // Afficher l'état du chargement audio
  if (!audioFilesReady) {
    ctx.fillStyle = '#ffaa00';
    ctx.fillText("Chargement des fichiers audio...", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 100);
  }
  // Afficher un indicateur si le son est désactivé
  else if (!audioConfig.soundEnabled) {
    ctx.fillStyle = '#ff6666';
    ctx.fillText("Son désactivé - Cliquez sur activer ci-dessous", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 100);
    
    // Dessiner un bouton pour activer le son
    ctx.fillStyle = '#4488ff';
    ctx.fillRect(CANVAS_WIDTH / 2 - 100, CANVAS_HEIGHT / 2 + 120, 200, 40);
    ctx.fillStyle = 'white';
    ctx.fillText("Activer le Son", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 145);
  }
  
  ctx.font = '20px Arial';
  ctx.fillStyle = 'white';
  
  // Ajuster la position des contrôles en fonction de l'état
  let controlsY;
  if (!audioFilesReady) {
    controlsY = CANVAS_HEIGHT / 2 + 150;
  } else if (!audioConfig.soundEnabled) {
    controlsY = CANVAS_HEIGHT / 2 + 180;
  } else {
    controlsY = CANVAS_HEIGHT / 2 + 100;
  }
  
  ctx.fillText("Contrôles :", CANVAS_WIDTH / 2, controlsY);
  ctx.fillText("← → : Déplacements", CANVAS_WIDTH / 2, controlsY + 30);
  ctx.fillText("ESPACE : Tirer", CANVAS_WIDTH / 2, controlsY + 60);
  ctx.fillText("P : Pause", CANVAS_WIDTH / 2, controlsY + 90);
  ctx.fillText("A : Réglages Audio", CANVAS_WIDTH / 2, controlsY + 120);
  ctx.fillText("M : Changer Musique", CANVAS_WIDTH / 2, controlsY + 150);
  ctx.fillText("N : Nouvelle Narration", CANVAS_WIDTH / 2, controlsY + 180);
  ctx.fillText("F3 : Afficher/Masquer les stats", CANVAS_WIDTH / 2, controlsY + 210);
}

// Menu pause
function drawPauseMenu() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  
  ctx.fillStyle = 'white';
  ctx.font = '40px Arial';
  ctx.textAlign = 'center';
  ctx.fillText("PAUSE", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);
  
  ctx.font = '25px Arial';
  ctx.fillText("Score actuel : " + score, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 10);
  ctx.fillText("P pour reprendre", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 50);
  ctx.fillText("ESC pour quitter", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 90);
}

// Écran de game over
function drawGameOverScreen() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  
  ctx.fillStyle = 'red';
  ctx.font = '50px Arial';
  ctx.textAlign = 'center';
  ctx.fillText("Game Over", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 3);
  
  ctx.fillStyle = 'white';
  ctx.font = '30px Arial';
  ctx.fillText("Score final : " + score, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
  if (score > highScore) {
    ctx.fillStyle = '#00ff00';
    ctx.fillText("Nouveau Record !", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40);
  }
  
  ctx.fillStyle = 'white';
  ctx.font = '25px Arial';
  ctx.fillText("ENTRÉE pour rejouer", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 90);
  ctx.fillText("ESC pour le menu principal", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 130);
}

// Écran des paramètres
function drawSettingsMenu() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  
  ctx.fillStyle = '#00ff00';
  ctx.font = '40px Arial';
  ctx.textAlign = 'center';
  ctx.fillText("PARAMÈTRES", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 3);
  
  // Audio
  ctx.fillStyle = 'white';
  ctx.font = '25px Arial';
  ctx.fillText("Paramètres Audio", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 100);
  
  // Bouton pour ouvrir les contrôles de volume
  ctx.fillStyle = '#4488ff';
  ctx.fillRect(CANVAS_WIDTH / 2 - 100, CANVAS_HEIGHT / 2 - 80, 200, 40);
  ctx.fillStyle = 'white';
  ctx.fillText("Régler Volumes", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 55);
  
  // Informations sur les commandes audio
  ctx.fillStyle = '#aaddff';
  ctx.font = '20px Arial';
  ctx.fillText("Commandes audio en jeu :", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 10);
  ctx.fillText("M : Changer de musique", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 20);
  ctx.fillText("N : Déclencher une narration", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 50);
  
  // Informations sur les options supplémentaires
  ctx.fillStyle = '#ddccff';
  ctx.fillText("Options audio avancées :", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 90);
  ctx.fillText("- Réglage de volume", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 120);
  ctx.fillText("- Ajustement automatique du volume", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 150);
  ctx.fillText("- Effets de fondu sonore", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 180);
  
  // Debug info toggle
  ctx.fillStyle = GAME_CONFIG.showDebugInfo ? '#00ff00' : 'gray';
  ctx.fillText("Stats de debug : " + (GAME_CONFIG.showDebugInfo ? "ON" : "OFF"), 
    CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 230);
  
  // Retour
  ctx.fillStyle = 'white';
  ctx.fillText("ESC pour revenir au menu", CANVAS_WIDTH / 2, CANVAS_HEIGHT - 100);
} 