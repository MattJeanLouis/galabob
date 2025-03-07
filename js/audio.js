// Système Audio
const audioConfig = {
  musicVolume: localStorage.getItem('musicVolume') ? parseFloat(localStorage.getItem('musicVolume')) : 0.5,
  narrationVolume: localStorage.getItem('narrationVolume') ? parseFloat(localStorage.getItem('narrationVolume')) : 0.8,
  sfxVolume: localStorage.getItem('sfxVolume') ? parseFloat(localStorage.getItem('sfxVolume')) : 0.7,
  currentMusic: null,
  currentNarration: null,
  musicList: [], // Sera rempli automatiquement
  narrationList: [], // Sera rempli automatiquement
  originalMusicVolume: 0, // Pour restaurer le volume après la narration
  narrationPoints: 100, // Points gagnés à la fin d'une narration
  soundEnabled: false, // Indique si le son est activé par l'utilisateur
  fallbackToDefault: true, // Utiliser les fichiers par défaut en cas d'erreur
  autoAdjustVolume: localStorage.getItem('autoAdjustVolume') !== 'false', // Ajuster automatiquement le volume pendant les narrations
  useFadeEffects: localStorage.getItem('useFadeEffects') !== 'false' // Utiliser les effets de fondu
};

// Variable pour suivre l'état d'initialisation des fichiers audio
let audioFilesReady = false;

// Éléments audio
const backgroundMusic = new Audio();
backgroundMusic.loop = true;

const narrationAudio = new Audio();
narrationAudio.loop = false;

// Fonction pour charger la liste des fichiers audio avec détection dynamique
function initAudioLists() {
  // Réinitialiser les listes audio
  audioConfig.musicList = [];
  audioConfig.narrationList = [];

  // Liste des extensions de fichiers audio à rechercher
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];

  // Fonction pour lister tous les fichiers audio dans un dossier
  async function scanAllAudioFiles(directory, callback) {
    console.log(`Tentative de listage des fichiers dans ${directory}`);
    
    try {
      // On utilise une requête fetch avec l'option directory pour récupérer la liste des fichiers
      // Comme cette méthode n'est pas standardisée, nous allons tenter à la place de faire
      // des requêtes individuelles pour chaque fichier potentiel
      
      // D'abord, créons une liste des combinaisons potentielles
      const potentialFiles = [];
      
      // Approche 1: Vérifier tous les fichiers dans le dossier
      const response = await fetch(`${directory}/`);
      const dirListing = await response.text();
      
      // Extraire les noms de fichiers de la réponse HTML (si disponible)
      const fileLinks = dirListing.match(/href="([^"]+\.(mp3|wav|ogg|m4a|aac|flac))"/gi);
      
      if (fileLinks && fileLinks.length > 0) {
        // Extraire les noms de fichiers des liens
        fileLinks.forEach(link => {
          const fileName = link.match(/href="([^"]+)"/i)[1];
          const filePath = `${directory}/${fileName}`;
          potentialFiles.push(filePath);
        });
      } else {
        console.log("Méthode de listage directorielle non disponible, essai d'une autre approche");
        
        // Approche 2: Vérifier tous les fichiers du dossier musique
        for (let i = 0; i < 1000; i++) {
          // Limiter la recherche aux 1000 premiers fichiers pour éviter une boucle infinie
          const files = await listDirectoryFiles(directory);
          if (files.length > 0) {
            files.forEach(file => potentialFiles.push(file));
            break;
          }
          
          // Si aucun fichier n'est trouvé, test échoué, on utilise l'approche 3
          if (i === 0) break;
        }
        
        // Approche 3: Méthode simple - test direct pour chaque fichier
        const filesFound = [];
        
        // Vérifier directement chaque fichier dans le dossier
        const directoryContents = await fetch(`${directory}/`);
        const text = await directoryContents.text();
        
        // Rechercher tous les liens dans la page qui ont des extensions audio
        const regex = new RegExp(`href="([^"]+\\.(${audioExtensions.map(ext => ext.substring(1)).join('|')}))`, 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
          const fileName = match[1];
          // Éviter les chemins absolus et les URLs externes
          if (!fileName.includes('://') && !fileName.startsWith('/')) {
            filesFound.push(`${directory}/${fileName}`);
          }
        }
        
        if (filesFound.length > 0) {
          filesFound.forEach(file => potentialFiles.push(file));
        } else {
          // Approche 4: Si rien ne fonctionne, chercher tous les fichiers avec une extension spécifique
          console.log("Aucun fichier audio trouvé avec les méthodes précédentes, tentative avec des noms génériques");
          
          // Liste de noms génériques à essayer
          const baseNames = [
            '', // Rechercher tout fichier *.mp3, etc.
            'file', 'audio', 'sound', 'track', 'music', 'theme', 'narration', 'voice',
            'rodrigo', 'Guillautine', // Noms existants connus
            'intro', 'mission', 'background', 'menu', 'game'
          ];
          
          // Essayer toutes les combinaisons possibles de noms de base et d'extensions
          for (const baseName of baseNames) {
            for (const ext of audioExtensions) {
              potentialFiles.push(`${directory}/${baseName}${ext}`);
              // Ajouter des variantes avec des numéros
              for (let i = 1; i <= 10; i++) {
                potentialFiles.push(`${directory}/${baseName}${i}${ext}`);
              }
            }
          }
        }
      }
      
      // Maintenant, vérifier tous les fichiers potentiels
      const verificationPromises = potentialFiles.map(async (file) => {
        try {
          const response = await fetch(file, { method: 'HEAD' });
          if (response.ok) return file;
          return null;
        } catch (error) {
          return null;
        }
      });
      
      const results = await Promise.all(verificationPromises);
      const validFiles = results.filter(file => file !== null);
      validFiles.forEach(file => callback(file));
      
      console.log(`Nombre de fichiers audio trouvés dans ${directory}: ${validFiles.length}`);
      
      // Si aucun fichier n'est trouvé, essayer avec les noms de fichiers existants connus
      if (validFiles.length === 0) {
        console.warn(`Aucun fichier audio trouvé dans ${directory} avec les méthodes automatiques`);
        
        // Dernière tentative avec les noms de fichiers connus
        let knownFiles = [];
        if (directory.includes('musique')) {
          knownFiles = ['rodrigo.wav', 'theme1.mp3', 'theme2.mp3', 'theme3.mp3'];
        } else if (directory.includes('narration')) {
          knownFiles = ['Guillautine.mp3', 'intro1.mp3', 'intro2.mp3', 'mission1.mp3'];
        }
        
        const knownVerificationPromises = knownFiles.map(async (fileName) => {
          try {
            const file = `${directory}/${fileName}`;
            const response = await fetch(file, { method: 'HEAD' });
            if (response.ok) return file;
            return null;
          } catch (error) {
            return null;
          }
        });
        
        const knownResults = await Promise.all(knownVerificationPromises);
        const validKnownFiles = knownResults.filter(file => file !== null);
        validKnownFiles.forEach(file => callback(file));
        
        console.log(`Fichiers connus trouvés dans ${directory}: ${validKnownFiles.length}`);
      }
    } catch (error) {
      console.error(`Erreur lors de la recherche de fichiers audio dans ${directory}:`, error);
      
      // Si une erreur se produit, essayer la méthode directe pour les fichiers de musique/narration courants
      if (directory.includes('musique')) {
        // Liste des fichiers à tester basée sur ce qu'on voit dans le dossier
        const files = ['rodrigo.wav', 'UpNDown.mp3', 'StupidFlower.mp3', 'SwimingPool.mp3', 'NC.mp3', 'Honeypot.mp3'];
        files.forEach(file => {
          const filePath = `${directory}/${file}`;
          fetch(filePath, { method: 'HEAD' })
            .then(response => {
              if (response.ok) callback(filePath);
            })
            .catch(() => {});
        });
      } else if (directory.includes('narration')) {
        // Liste des fichiers à tester basée sur ce qu'on voit dans le dossier
        const files = ['Guillautine.mp3'];
        const elevenLabsFiles = [];
        for (let i = 1; i <= 30; i++) {
          elevenLabsFiles.push(`ElevenLabs_2024-08-17T${i < 10 ? '0' + i : i}_00_00_L'ile au fleur_ivc_s50_sb50_se0_b_m2.mp3`);
        }
        [...files, ...elevenLabsFiles].forEach(file => {
          const filePath = `${directory}/${file}`;
          fetch(filePath, { method: 'HEAD' })
            .then(response => {
              if (response.ok) callback(filePath);
            })
            .catch(() => {});
        });
      }
    }
  }
  
  // Fonction auxiliaire pour tenter de lister les fichiers du répertoire
  async function listDirectoryFiles(directory) {
    try {
      const response = await fetch(`${directory}/`);
      const text = await response.text();
      
      // Chercher tous les liens qui pourraient être des fichiers audio
      const audioFileRegex = new RegExp(`href="([^"]+\\.(${audioExtensions.map(ext => ext.substring(1)).join('|')}))`, 'gi');
      const files = [];
      let match;
      
      while ((match = audioFileRegex.exec(text)) !== null) {
        const fileName = match[1];
        // Éviter les chemins absolus et les URLs externes
        if (!fileName.includes('://') && !fileName.startsWith('/')) {
          files.push(`${directory}/${fileName}`);
        }
      }
      
      return files;
    } catch (error) {
      console.warn("Impossible de lister les fichiers par la méthode directory", error);
      return [];
    }
  }
  
  // Rechercher les fichiers audio dans les deux dossiers
  scanAllAudioFiles('assets/audio/musique', file => {
    console.log(`Fichier musique trouvé: ${file}`);
    audioConfig.musicList.push(file);
  });
  
  scanAllAudioFiles('assets/audio/narration', file => {
    console.log(`Fichier narration trouvé: ${file}`);
    audioConfig.narrationList.push(file);
  });
  
  // Définir un délai plus long pour attendre que les recherches asynchrones se terminent
  setTimeout(() => {
    console.log("Vérification finale des fichiers audio détectés");
    // Vérifier si des fichiers ont été trouvés et lister le résultat
    if (audioConfig.musicList.length === 0) {
      console.warn("⚠️ Aucun fichier de musique détecté - Vérifiez le dossier assets/audio/musique/");
      // Essai avec hardcoding du nom de fichier si on n'a rien trouvé
      audioConfig.musicList.push('assets/audio/musique/rodrigo.wav');
    } else {
      console.log(`✅ Fichiers musicaux détectés: ${audioConfig.musicList.length}`);
      audioConfig.musicList.forEach((file, index) => {
        console.log(`Musique ${index+1}: ${file}`);
      });
    }
    
    if (audioConfig.narrationList.length === 0) {
      console.warn("⚠️ Aucun fichier de narration détecté - Vérifiez le dossier assets/audio/narration/");
      // Essai avec hardcoding du nom de fichier si on n'a rien trouvé
      audioConfig.narrationList.push('assets/audio/narration/Guillautine.mp3');
    } else {
      console.log(`✅ Fichiers de narration détectés: ${audioConfig.narrationList.length}`);
      audioConfig.narrationList.forEach((file, index) => {
        if (index < 10) { // Limiter l'affichage pour éviter de spammer la console
          console.log(`Narration ${index+1}: ${file}`);
        } else if (index === 10) {
          console.log(`... et ${audioConfig.narrationList.length - 10} autres fichiers de narration`);
        }
      });
    }
    
    // Signaler que les fichiers audio sont prêts
    audioFilesReady = true;
  }, 5000); // Augmenter le délai à 5 secondes pour s'assurer que toutes les requêtes ont le temps de se terminer
}

// Fonction plus simple pour vérifier si un fichier audio est jouable
function isAudioFilePlayable(filePath) {
  return new Promise((resolve) => {
    fetch(filePath, { method: 'HEAD' })
      .then(response => {
        if (response.ok) {
          const audio = new Audio();
          audio.addEventListener('canplaythrough', () => {
            resolve(true);
          }, { once: true });
          
          audio.addEventListener('error', () => {
            resolve(false);
          }, { once: true });
          
          audio.src = filePath;
          audio.load();
          
          // Définir un délai maximum pour la vérification
          setTimeout(() => {
            resolve(false);
          }, 1000);
        } else {
          resolve(false);
        }
      })
      .catch(() => resolve(false));
  });
}

// Fonction pour jouer une musique aléatoire avec meilleure gestion d'erreurs
function playRandomMusic() {
  if (!audioConfig.soundEnabled) {
    console.log("Son désactivé, musique non jouée");
    return;
  }
  
  // Vérifier si les fichiers audio sont prêts et disponibles
  if (!audioFilesReady) {
    console.log("Les fichiers audio ne sont pas encore prêts, attente...");
    setTimeout(playRandomMusic, 500);
    return;
  }
  
  if (audioConfig.musicList.length === 0) {
    console.warn("Aucun fichier de musique disponible");
    return;
  }
  
  // Choisir une musique aléatoire différente de la musique actuelle
  let availableMusic = audioConfig.musicList;
  if (audioConfig.currentMusic && audioConfig.musicList.length > 1) {
    availableMusic = audioConfig.musicList.filter(music => music !== audioConfig.currentMusic);
  }
  
  const randomIndex = Math.floor(Math.random() * availableMusic.length);
  const musicPath = availableMusic[randomIndex];
  
  console.log("Tentative de lecture de la musique:", musicPath);
  
  try {
    backgroundMusic.src = musicPath;
    
    // S'assurer que le volume est correctement défini avant de jouer
    backgroundMusic.volume = audioConfig.musicVolume;
    console.log("Volume de musique appliqué:", audioConfig.musicVolume);
    
    backgroundMusic.onerror = function() {
      console.warn(`Erreur lors du chargement de la musique: ${musicPath}`);
      // Retirer ce fichier de la liste et essayer avec un autre
      audioConfig.musicList = audioConfig.musicList.filter(m => m !== musicPath);
      if (audioConfig.musicList.length > 0) {
        setTimeout(playRandomMusic, 500);
      }
    };
    
    // Si les effets de fondu sont activés, commencer avec volume à 0
    let targetVolume = audioConfig.musicVolume;
    if (audioConfig.useFadeEffects) {
      backgroundMusic.volume = 0;
    }
    
    backgroundMusic.play()
      .then(() => {
        console.log("Musique démarrée avec succès:", musicPath);
        audioConfig.currentMusic = musicPath;
        
        // Appliquer un fondu d'entrée si l'option est activée
        if (audioConfig.useFadeEffects) {
          let fadeInInterval = setInterval(() => {
            backgroundMusic.volume = Math.min(targetVolume, backgroundMusic.volume + 0.05);
            if (backgroundMusic.volume >= targetVolume) {
              clearInterval(fadeInInterval);
              console.log("Fondu d'entrée terminé, volume final:", backgroundMusic.volume);
            }
          }, 100);
        }
      })
      .catch(e => {
        console.warn("Erreur de lecture audio:", e);
        if (e.name !== "NotAllowedError") {
          // Si ce n'est pas dû à l'interaction utilisateur, essayer un autre fichier
          audioConfig.musicList = audioConfig.musicList.filter(m => m !== musicPath);
          if (audioConfig.musicList.length > 0) {
            setTimeout(playRandomMusic, 500);
          }
        }
      });
  } catch (err) {
    console.error("Impossible de lire la musique:", err);
  }
}

// Fonction pour jouer une narration aléatoire avec meilleure gestion d'erreurs
function playRandomNarration(forceNew = false) {
  if (!audioConfig.soundEnabled) {
    console.log("Son désactivé, narration non jouée");
    // Ajouter quand même les points de bonus
    applyNarrationBonus();
    return false; // Ne pas interrompre une narration en cours
  }
  
  // Vérifier si les fichiers audio sont prêts et disponibles
  if (!audioFilesReady) {
    console.log("Les fichiers audio ne sont pas encore prêts, narration reportée...");
    setTimeout(() => {
      if (gameState === "playing") {
        playRandomNarration(forceNew);
      }
    }, 1000);
    return false; // Ne pas interrompre une narration en cours
  }
  
  if (audioConfig.narrationList.length === 0) {
    console.warn("Aucun fichier de narration disponible");
    // Ajouter quand même les points de bonus sans narration
    applyNarrationBonus();
    return false; // Ne pas interrompre une narration en cours
  }
  
  // Ne pas démarrer une nouvelle narration si une est déjà en cours, sauf si forceNew = true
  if (!forceNew && audioConfig.currentNarration && !narrationAudio.paused && !narrationAudio.ended) {
    console.log("Une narration est déjà en cours, commande ignorée");
    return false;
  }
  
  // Si une narration est en cours mais qu'on force une nouvelle, arrêter la narration actuelle
  if (forceNew && audioConfig.currentNarration && !narrationAudio.paused) {
    console.log("Interruption de la narration en cours pour en jouer une nouvelle");
    narrationAudio.pause();
    // Restaurer le volume de musique si nécessaire
    if (backgroundMusic.played.length > 0 && !backgroundMusic.paused && audioConfig.autoAdjustVolume) {
      backgroundMusic.volume = audioConfig.originalMusicVolume;
    }
  }
  
  // Choisir une narration aléatoire différente de la narration précédente si possible
  let availableNarrations = audioConfig.narrationList;
  if (audioConfig.currentNarration && audioConfig.narrationList.length > 1) {
    availableNarrations = audioConfig.narrationList.filter(narration => narration !== audioConfig.currentNarration);
    console.log(`Sélection parmi ${availableNarrations.length} narrations différentes de la narration actuelle`);
  }
  
  const randomIndex = Math.floor(Math.random() * availableNarrations.length);
  const narrationPath = availableNarrations[randomIndex];
  
  console.log("Tentative de lecture de la narration:", narrationPath);
  
  try {
    // Baisser le volume de la musique pendant la narration si la musique joue et si l'option est activée
    if (backgroundMusic.played.length > 0 && !backgroundMusic.paused && audioConfig.autoAdjustVolume) {
      audioConfig.originalMusicVolume = backgroundMusic.volume;
      backgroundMusic.volume = audioConfig.originalMusicVolume * 0.3; // Réduire à 30%
    }
    
    narrationAudio.src = narrationPath;
    narrationAudio.volume = audioConfig.narrationVolume;
    
    narrationAudio.onerror = function() {
      console.warn(`Erreur lors du chargement de la narration: ${narrationPath}`);
      // Restaurer le volume de musique si l'option est activée
      if (backgroundMusic.played.length > 0 && !backgroundMusic.paused && audioConfig.autoAdjustVolume) {
        backgroundMusic.volume = audioConfig.originalMusicVolume;
      }
      
      // Retirer ce fichier de la liste et essayer avec un autre
      audioConfig.narrationList = audioConfig.narrationList.filter(n => n !== narrationPath);
      if (audioConfig.narrationList.length > 0 && gameState === "playing") {
        setTimeout(() => playRandomNarration(forceNew), 500);
      } else {
        applyNarrationBonus();
      }
    };
    
    // Événement de fin pour restaurer le volume de musique et donner les points
    narrationAudio.onended = function() {
      // Restaurer le volume de musique si l'option est activée
      if (backgroundMusic.played.length > 0 && !backgroundMusic.paused && audioConfig.autoAdjustVolume) {
        backgroundMusic.volume = audioConfig.originalMusicVolume;
      }
      
      // Donner des points au joueur
      applyNarrationBonus("Bonus Narration");
      
      audioConfig.currentNarration = null;
    };
    
    narrationAudio.play()
      .then(() => {
        console.log("Narration démarrée avec succès:", narrationPath);
        audioConfig.currentNarration = narrationPath;
      })
      .catch(e => {
        console.warn("Erreur de lecture narration:", e);
        // Restaurer le volume de musique si l'option est activée
        if (backgroundMusic.played.length > 0 && !backgroundMusic.paused && audioConfig.autoAdjustVolume) {
          backgroundMusic.volume = audioConfig.originalMusicVolume;
        }
        
        if (e.name !== "NotAllowedError") {
          // Si ce n'est pas dû à l'interaction utilisateur, essayer un autre fichier
          audioConfig.narrationList = audioConfig.narrationList.filter(n => n !== narrationPath);
          if (audioConfig.narrationList.length > 0 && gameState === "playing") {
            setTimeout(() => playRandomNarration(forceNew), 500);
          } else {
            applyNarrationBonus();
          }
        }
      });
  } catch (err) {
    console.error("Impossible de lire la narration:", err);
    // En cas d'erreur, restaurer le volume de la musique si l'option est activée
    if (backgroundMusic.played.length > 0 && !backgroundMusic.paused && audioConfig.autoAdjustVolume) {
      backgroundMusic.volume = audioConfig.originalMusicVolume;
    }
    
    // Ajouter quand même les points de bonus sans narration
    applyNarrationBonus();
  }
  return true; // Indiquer que la narration a été déclenchée
}

// Fonction pour déclencher une narration aléatoire
function triggerRandomNarration() {
  // La touche N force toujours une nouvelle narration, même si une est déjà en cours
  const forceNewNarration = true;
  
  // Si on force une nouvelle narration, toujours retourner true pour afficher la notification
  if (forceNewNarration) {
    // Lancer la lecture d'une nouvelle narration en forçant son changement
    return playRandomNarration(forceNewNarration);
  } else {
    // Comportement classique: vérifier si une narration est déjà en cours
    if (audioConfig.currentNarration && !narrationAudio.paused && !narrationAudio.ended) {
      console.log("Une narration est déjà en cours, attente...");
      return false;
    }
    
    return playRandomNarration(false);
  }
}

// Fonction utilitaire pour appliquer le bonus de narration
function applyNarrationBonus(message = "Bonus") {
  score += audioConfig.narrationPoints;
  scorePopups.push({
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2 - 50,
    points: audioConfig.narrationPoints,
    text: `${message}: +${audioConfig.narrationPoints}`,
    lifetime: 2.0,
    dy: -1,
    color: '#00ffff'
  });
}

// Fonctions pour mettre à jour les volumes
function updateMusicVolume(value) {
  const volume = value / 100;
  audioConfig.musicVolume = volume;
  backgroundMusic.volume = volume;
  localStorage.setItem('musicVolume', volume);
  document.getElementById('musicVolumeValue').textContent = `${value}%`;
}

function updateNarrationVolume(value) {
  const volume = value / 100;
  audioConfig.narrationVolume = volume;
  narrationAudio.volume = volume;
  localStorage.setItem('narrationVolume', volume);
  document.getElementById('narrationVolumeValue').textContent = `${value}%`;
}

function updateSFXVolume(value) {
  const volume = value / 100;
  audioConfig.sfxVolume = volume;
  localStorage.setItem('sfxVolume', volume);
  document.getElementById('sfxVolumeValue').textContent = `${value}%`;
}

// Fonction pour basculer l'affichage des contrôles audio
function toggleAudioControls() {
  const controls = document.getElementById('volumeControls');
  if (controls.style.display === 'block') {
    controls.style.display = 'none';
  } else {
    controls.style.display = 'block';
  }
}

// Fonction pour activer le son du jeu
function enableGameAudio() {
  // Vérifier si les fichiers audio sont prêts
  if (!audioFilesReady) {
    console.log("Les fichiers audio ne sont pas encore prêts, activation reportée...");
    setTimeout(enableGameAudio, 500);
    return;
  }
  
  // Vérifier si nous avons des fichiers audio
  if (audioConfig.musicList.length === 0 && audioConfig.narrationList.length === 0) {
    console.warn("Aucun fichier audio détecté, impossible d'activer le son");
    alert("Aucun fichier audio trouvé dans les dossiers assets/audio/musique et assets/audio/narration.");
    return;
  }
  
  // Créer un contexte audio pour débloquer tous les sons
  const unlockAudio = () => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    // Un bref son silencieux pour débloquer l'audio
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(0, audioContext.currentTime); // Silence
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(0);
    oscillator.stop(0.001);
    
    // Activer l'audio du jeu
    audioConfig.soundEnabled = true;
    localStorage.setItem('soundEnabled', 'true');
    
    // S'assurer que les volumes sont correctement initialisés avant de jouer la musique
    backgroundMusic.volume = audioConfig.musicVolume;
    narrationAudio.volume = audioConfig.narrationVolume;
    
    // Affichage de débogage des valeurs de volume
    console.log("Volume de musique initialisé à:", audioConfig.musicVolume);
    console.log("Volume de narration initialisé à:", audioConfig.narrationVolume);
    console.log("Volume d'effets sonores initialisé à:", audioConfig.sfxVolume);
    
    // Jouer la musique de fond avec un léger délai pour être sûr
    setTimeout(() => {
      if (audioConfig.musicList.length > 0) {
        playRandomMusic();
      }
    }, 100);
    
    // Enlever l'écouteur d'événement une fois utilisé
    document.removeEventListener('click', unlockAudio);
  };
  
  // Certains navigateurs nécessitent une interaction utilisateur pour jouer l'audio
  document.addEventListener('click', unlockAudio, { once: true });
  
  // Simuler un clic pour essayer immédiatement
  unlockAudio();
}

// Fonction pour changer la musique actuelle par une autre aléatoire
function changeRandomMusic() {
  if (!audioConfig.soundEnabled) {
    console.log("Son désactivé, changement de musique non effectué");
    return;
  }
  
  if (audioConfig.musicList.length <= 1) {
    console.log("Impossible de changer de musique - Une seule musique disponible");
    return;
  }
  
  // Filtrer la liste pour exclure la musique actuelle
  const availableMusic = audioConfig.musicList.filter(music => music !== audioConfig.currentMusic);
  
  if (availableMusic.length === 0) {
    console.log("Pas d'autre musique disponible");
    return;
  }
  
  // Choisir une nouvelle musique aléatoire
  const randomIndex = Math.floor(Math.random() * availableMusic.length);
  const newMusicPath = availableMusic[randomIndex];
  
  console.log("Changement de musique vers:", newMusicPath);
  
  // Sauvegarder le volume actuel
  const currentVolume = audioConfig.musicVolume;
  
  // Vérifier si le volume était à zéro alors qu'il ne devrait pas l'être
  if (backgroundMusic.volume === 0 && currentVolume > 0) {
    console.log("Correction du volume à zéro lors du changement de musique");
    backgroundMusic.volume = currentVolume;
  }
  
  // Si l'option de fondu est désactivée, changer la musique immédiatement
  if (!audioConfig.useFadeEffects) {
    backgroundMusic.src = newMusicPath;
    backgroundMusic.volume = currentVolume; // Maintenir le volume actuel
    backgroundMusic.play()
      .then(() => {
        console.log("Nouvelle musique démarrée avec succès (sans fondu)");
        audioConfig.currentMusic = newMusicPath;
      })
      .catch(e => {
        console.warn("Erreur lors du changement de musique:", e);
        // Essayer avec une autre musique en cas d'échec
        audioConfig.musicList = audioConfig.musicList.filter(m => m !== newMusicPath);
        if (audioConfig.musicList.length > 0) {
          setTimeout(changeRandomMusic, 500);
        }
      });
    return;
  }
  
  // Si l'option de fondu est activée, utiliser la transition
  // Fondu de sortie
  let fadeOutInterval = setInterval(() => {
    backgroundMusic.volume = Math.max(0, backgroundMusic.volume - 0.1);
    if (backgroundMusic.volume <= 0) {
      clearInterval(fadeOutInterval);
      
      // Charger et jouer la nouvelle musique
      backgroundMusic.src = newMusicPath;
      backgroundMusic.volume = 0; // Commencer à 0 pour le fondu d'entrée
      backgroundMusic.play()
        .then(() => {
          console.log("Nouvelle musique démarrée avec succès (avec fondu)");
          audioConfig.currentMusic = newMusicPath;
          
          // Fondu d'entrée
          let fadeInInterval = setInterval(() => {
            backgroundMusic.volume = Math.min(currentVolume, backgroundMusic.volume + 0.1);
            if (backgroundMusic.volume >= currentVolume) {
              clearInterval(fadeInInterval);
            }
          }, 100);
        })
        .catch(e => {
          console.warn("Erreur lors du changement de musique:", e);
          // Essayer avec une autre musique en cas d'échec
          audioConfig.musicList = audioConfig.musicList.filter(m => m !== newMusicPath);
          if (audioConfig.musicList.length > 0) {
            setTimeout(changeRandomMusic, 500);
          }
        });
    }
  }, 50);
} 