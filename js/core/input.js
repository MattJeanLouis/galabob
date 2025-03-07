// Gestion des touches
const keys = {};

// Événements clavier
document.addEventListener('keydown', function (e) {
  keys[e.key] = true;
  
  if (e.key === 'Enter') {
    if (gameState === "menu" || gameState === "gameover") {
      initGame();
    }
  }
  
  if (e.key === 'p' || e.key === 'P') {
    if (gameState === "playing") {
      isPaused = !isPaused;
    }
  }
  
  if (e.key === 'Escape') {
    if (gameState === "playing" || gameState === "gameover") {
      gameState = "menu";
      isPaused = false;
    } else if (gameState === "settings") {
      gameState = "menu";
    }
  }
  
  // Touche S pour les paramètres
  if ((e.key === 's' || e.key === 'S') && gameState === "menu") {
    gameState = "settings";
  }

  // Touche F3 pour afficher/masquer les stats
  if (e.key === 'F3') {
    GAME_CONFIG.showDebugInfo = !GAME_CONFIG.showDebugInfo;
    // Sauvegarder la préférence
    localStorage.setItem('showDebugInfo', GAME_CONFIG.showDebugInfo);
  }
  
  // Touche A pour afficher/masquer les contrôles audio
  if (e.key === 'a' || e.key === 'A') {
    toggleAudioControls();
  }
  
  // Touche M pour changer la musique
  if ((e.key === 'm' || e.key === 'M') && audioConfig.soundEnabled) {
    changeRandomMusic();
    // Ajout d'une notification temporaire
    scorePopups.push({
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT / 2 - 100,
      points: 0,
      text: "Changement de musique",
      lifetime: 1.0,
      dy: -1,
      color: '#4488ff'
    });
  }
  
  // Touche N pour déclencher une narration
  if ((e.key === 'n' || e.key === 'N') && audioConfig.soundEnabled && gameState === "playing") {
    if (triggerRandomNarration()) {
      // Notification seulement si une narration a été déclenchée
      scorePopups.push({
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT / 2 - 100,
        points: 0,
        text: "Narration déclenchée",
        lifetime: 1.0,
        dy: -1,
        color: '#ff88aa'
      });
    }
  }
});

document.addEventListener('keyup', function (e) {
  keys[e.key] = false;
});

// Gestionnaires d'événements pour les contrôles de volume
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('musicVolume').addEventListener('input', function(e) {
    updateMusicVolume(e.target.value);
  });
  
  document.getElementById('narrationVolume').addEventListener('input', function(e) {
    updateNarrationVolume(e.target.value);
  });
  
  document.getElementById('sfxVolume').addEventListener('input', function(e) {
    updateSFXVolume(e.target.value);
  });
  
  document.getElementById('closeVolumeControls').addEventListener('click', function() {
    document.getElementById('volumeControls').style.display = 'none';
  });
  
  // Gestionnaires d'événements pour les options audio additionnelles
  document.getElementById('autoAdjustVolume').addEventListener('change', function(e) {
    audioConfig.autoAdjustVolume = e.target.checked;
    localStorage.setItem('autoAdjustVolume', e.target.checked ? 'true' : 'false');
    console.log(`Ajustement automatique du volume ${e.target.checked ? 'activé' : 'désactivé'}`);
  });
  
  document.getElementById('useFadeEffects').addEventListener('change', function(e) {
    audioConfig.useFadeEffects = e.target.checked;
    localStorage.setItem('useFadeEffects', e.target.checked ? 'true' : 'false');
    console.log(`Effets de fondu ${e.target.checked ? 'activés' : 'désactivés'}`);
  });
  
  // Gestion des événements de clic pour les menus
  canvas.addEventListener('click', function(e) {
    // Convertir les coordonnées de la souris en coordonnées relatives au canvas
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Clic sur le bouton d'activation du son dans le menu principal
    if (gameState === "menu" && !audioConfig.soundEnabled) {
      const soundButtonX = CANVAS_WIDTH / 2 - 100;
      const soundButtonY = CANVAS_HEIGHT / 2 + 120;
      const soundButtonWidth = 200;
      const soundButtonHeight = 40;
      
      if (
        mouseX >= soundButtonX && 
        mouseX <= soundButtonX + soundButtonWidth &&
        mouseY >= soundButtonY &&
        mouseY <= soundButtonY + soundButtonHeight
      ) {
        enableGameAudio();
      }
    }
    
    // Clic sur le bouton "Régler Volumes" dans l'écran des paramètres
    if (gameState === "settings") {
      const volumeButtonX = CANVAS_WIDTH / 2 - 100;
      const volumeButtonY = CANVAS_HEIGHT / 2 - 40;
      const volumeButtonWidth = 200;
      const volumeButtonHeight = 40;
      
      if (
        mouseX >= volumeButtonX && 
        mouseX <= volumeButtonX + volumeButtonWidth &&
        mouseY >= volumeButtonY &&
        mouseY <= volumeButtonY + volumeButtonHeight
      ) {
        toggleAudioControls();
      }
    }
  });
}); 