// Récupération du canvas et du contexte
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Boucle principale du jeu
let lastTime = 0;
function gameLoop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  let deltaTime = timestamp - lastTime;
  lastTime = timestamp;
  update(deltaTime);
  draw();
  
  requestAnimationFrame(gameLoop);
}

// Initialisation du jeu
function init() {
  // Initialiser les listes audio et attendre leur chargement
  audioFilesReady = false;
  
  // Ajout d'un message de chargement dans la console
  console.log("🎵 Initialisation du système audio...");
  console.log("🔍 Recherche de fichiers audio dans les dossiers assets/audio/musique/ et assets/audio/narration/...");
  
  // Créer un élément pour afficher le statut de chargement
  const loadingStatus = document.createElement('div');
  loadingStatus.style.position = 'fixed';
  loadingStatus.style.top = '10px';
  loadingStatus.style.left = '10px';
  loadingStatus.style.padding = '5px 10px';
  loadingStatus.style.background = 'rgba(0,0,0,0.7)';
  loadingStatus.style.color = '#ffaa00';
  loadingStatus.style.fontFamily = 'Arial, sans-serif';
  loadingStatus.style.fontSize = '14px';
  loadingStatus.style.borderRadius = '5px';
  loadingStatus.textContent = "Chargement des fichiers audio...";
  document.body.appendChild(loadingStatus);
  
  // Initialiser les listes audio
  initAudioLists();
  
  // Vérifier si le son était activé précédemment
  audioConfig.soundEnabled = localStorage.getItem('soundEnabled') === 'true';
  
  // Initialiser les contrôles de volume avec les valeurs sauvegardées
  document.getElementById('musicVolume').value = audioConfig.musicVolume * 100;
  document.getElementById('narrationVolume').value = audioConfig.narrationVolume * 100;
  document.getElementById('sfxVolume').value = audioConfig.sfxVolume * 100;
  
  document.getElementById('musicVolumeValue').textContent = `${Math.round(audioConfig.musicVolume * 100)}%`;
  document.getElementById('narrationVolumeValue').textContent = `${Math.round(audioConfig.narrationVolume * 100)}%`;
  document.getElementById('sfxVolumeValue').textContent = `${Math.round(audioConfig.sfxVolume * 100)}%`;

  // Initialiser les checkbox des options audio
  document.getElementById('autoAdjustVolume').checked = audioConfig.autoAdjustVolume;
  document.getElementById('useFadeEffects').checked = audioConfig.useFadeEffects;
  
  // Attendre que les fichiers audio soient détectés avant de lancer la musique
  let checkAudioReadyInterval = setInterval(() => {
    if (audioFilesReady) {
      clearInterval(checkAudioReadyInterval);
      console.log("✅ Initialisation audio terminée");
      
      // Mettre à jour le message de statut
      loadingStatus.style.color = '#00ff00';
      loadingStatus.textContent = `Audio chargé: ${audioConfig.musicList.length} musiques, ${audioConfig.narrationList.length} narrations`;
      
      // Faire disparaître le message après 3 secondes
      setTimeout(() => {
        loadingStatus.style.opacity = '0';
        loadingStatus.style.transition = 'opacity 1s';
        // Supprimer l'élément après la transition
        setTimeout(() => {
          document.body.removeChild(loadingStatus);
        }, 1000);
      }, 3000);
      
      // Lancer une musique aléatoire si le son est activé
      if (audioConfig.soundEnabled && audioConfig.musicList.length > 0) {
        playRandomMusic();
      }
      
      // Démarrer la boucle de jeu
      requestAnimationFrame(gameLoop);
    } else {
      // Mettre à jour le message de chargement
      loadingStatus.textContent = `Recherche de fichiers audio... (${audioConfig.musicList.length + audioConfig.narrationList.length} trouvés)`;
    }
  }, 1000);
  
  // Timeout de sécurité au cas où audioFilesReady ne serait jamais défini à true
  setTimeout(() => {
    if (!audioFilesReady) {
      audioFilesReady = true;
      console.warn("⚠️ Délai d'attente dépassé pour la détection audio");
      loadingStatus.style.color = '#ff5500';
      loadingStatus.textContent = "Détection audio incomplète - Certaines fonctionnalités audio peuvent être limitées";
    }
  }, 7000);
  
  // Charger l'état des stats debug
  GAME_CONFIG.showDebugInfo = localStorage.getItem('showDebugInfo') === 'true';
  
  // Ajouter l'écouteur d'événement pour le redimensionnement
  window.addEventListener('resize', resizeCanvas);
  
  // Appeler resizeCanvas au chargement initial
  resizeCanvas();
}

// Démarrer l'initialisation après chargement de la page
window.addEventListener('load', init); 