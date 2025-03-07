// Variables pour le HUD
let score = 0;
let highScore = localStorage.getItem('highScore') || 0;

// Affichage du HUD en jeu
function drawHUD() {
  ctx.fillStyle = 'white';
  ctx.font = '20px Arial';
  ctx.textAlign = 'left';
  ctx.fillText("Score : " + score, 10, 30);
  ctx.fillText("Vies : " + player.lives, 10, 55);
  
  // Affichage du stage actuel
  ctx.textAlign = 'center';
  ctx.fillText(`Stage ${stageSystem.currentStage}`, CANVAS_WIDTH / 2, 30);
  
  // Barre de progression du stage
  const progressBarWidth = 200;
  const progressBarHeight = 15;
  const progressBarX = (CANVAS_WIDTH - progressBarWidth) / 2;
  const progressBarY = 40;
  
  // Vérifier que enemiesPerStage n'est pas zéro pour éviter une division par zéro
  const progress = stageSystem.enemiesPerStage > 0 
    ? Math.min(stageSystem.enemiesDefeated / stageSystem.enemiesPerStage, 1) 
    : 0;
  
  // Fond de la barre
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.fillRect(progressBarX, progressBarY, progressBarWidth, progressBarHeight);
  
  // Barre de progression
  ctx.fillStyle = 'rgba(0, 255, 100, 0.7)';
  ctx.fillRect(progressBarX, progressBarY, progressBarWidth * progress, progressBarHeight);
  
  // Bordure de la barre
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.strokeRect(progressBarX, progressBarY, progressBarWidth, progressBarHeight);
  
  // Affichage des ennemis restants
  ctx.font = '14px Arial';
  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.fillText(`${stageSystem.enemiesDefeated}/${stageSystem.enemiesPerStage}`, CANVAS_WIDTH / 2, progressBarY + progressBarHeight + 15);
  
  // Retour au style de base pour les autres éléments du HUD
  ctx.textAlign = 'left';
  
  // Affichage des armes
  if (player.weapon !== 'normal') {
    ctx.fillText("Arme : " + player.weapon, 10, 80);
    ctx.fillText("Temps restant : " + Math.ceil(player.weaponTimer / 1000) + "s", 10, 105);
  }
}

// Affichage des informations de debug
function drawDebugInfo() {
  if (!GAME_CONFIG.showDebugInfo) return;

  ctx.fillStyle = GAME_CONFIG.debugColor;
  ctx.font = '14px Consolas';
  ctx.textAlign = 'left';
  
  let y = 150;
  const lineHeight = 20;
  
  // Stats du joueur
  ctx.fillText(`Vitesse joueur: ${player.speed.toFixed(2)}`, 10, y);
  y += lineHeight;
  ctx.fillText(`Cadence de tir: ${(1000/shotCooldown).toFixed(1)}/s`, 10, y);
  y += lineHeight;
  
  // Info sur le stage actuel
  ctx.fillText(`Stage: ${stageSystem.currentStage}/${stageSystem.maxStage}`, 10, y);
  y += lineHeight;
  ctx.fillText(`Ennemis vaincus: ${stageSystem.enemiesDefeated}/${stageSystem.enemiesPerStage}`, 10, y);
  y += lineHeight;
  
  // Vérifier que stageStartTime existe pour éviter une erreur
  if (stageSystem.stageStartTime) {
    ctx.fillText(`Temps stage: ${Math.floor((Date.now() - stageSystem.stageStartTime)/1000)}s`, 10, y);
    y += lineHeight;
  }
  
  // Stats des ennemis
  ctx.fillText("Ennemis:", 10, y);
  y += lineHeight;
  
  let displayedEnemies = 0;
  enemies.forEach(enemy => {
    // Limiter l'affichage à 5 ennemis pour éviter l'encombrement
    if (displayedEnemies < 5) {
      ctx.fillText(`  ${enemy.type}: v=${enemy.speedModifier.toFixed(2)}`, 10, y);
      y += lineHeight;
      displayedEnemies++;
    }
  });
  
  if (enemies.length > 5) {
    ctx.fillText(`  ... et ${enemies.length - 5} autres`, 10, y);
    y += lineHeight;
  }
  
  // Affichage des informations audio
  if (audioConfig.soundEnabled) {
    y += lineHeight;
    ctx.fillText("Audio:", 10, y);
    y += lineHeight;
    
    // Affichage de la musique en cours
    if (audioConfig.currentMusic) {
      const musicName = audioConfig.currentMusic.split('/').pop().replace(/\.(mp3|wav|ogg|m4a|aac|flac)$/i, '');
      ctx.fillText(`  ♫ Musique: ${musicName}`, 10, y);
      y += lineHeight;
      
      // Affichage de l'état de la rotation des musiques
      ctx.fillText(`  Rotation musique: ${audioConfig.playedMusicList.length}/${audioConfig.musicList.length} pistes jouées`, 10, y);
      y += lineHeight;
    }
    
    // Affichage de la narration en cours
    if (audioConfig.currentNarration) {
      const narrationName = audioConfig.currentNarration.split('/').pop().replace(/\.(mp3|wav|ogg|m4a|aac|flac)$/i, '');
      const narrationStatus = (!narrationAudio.paused && !narrationAudio.ended) ? "en cours" : "terminée";
      ctx.fillText(`  🔊 Narration: ${narrationName} (${narrationStatus})`, 10, y);
      y += lineHeight;
      
      // Affichage de l'état de la rotation des narrations
      ctx.fillText(`  Rotation narration: ${audioConfig.playedNarrationList.length}/${audioConfig.narrationList.length} pistes jouées`, 10, y);
      y += lineHeight;
    }
  }
} 