// Système de stages
const stageSystem = {
  currentStage: 1,
  maxStage: 10,
  stageCompleted: false,
  transitionActive: false,
  transitionProgress: 0,
  transitionDuration: 5000, // durée en ms
  stageStartTime: 0,
  enemiesPerStage: 30, // Nombre d'ennemis à vaincre pour compléter un stage
  enemiesDefeated: 0,
  
  // Statistiques pour l'écran de fin de stage
  stageStats: {
    score: 0,
    combo: 0,
    timeElapsed: 0
  },
  
  // Paramètres pour l'animation des étoiles
  starSpeedMultiplier: 1,
  maxStarSpeedMultiplier: 10,
  
  // Paramètres pour l'animation du vaisseau durant la transition
  shipTransition: {
    active: false,
    x: 0,
    y: 0,
    targetY: 0,
    speed: 10
  },
  
  // État des différentes phases de la transition
  transitionPhase: 'none', // 'none', 'stageComplete', 'speedUp', 'shipMove', 'stageBegin'
  
  // Réinitialiser les statistiques du stage
  resetStageStats() {
    this.stageStats.score = 0;
    this.stageStats.combo = 0;
    this.stageStats.timeElapsed = 0;
    this.stageStartTime = Date.now();
    this.enemiesDefeated = 0;
    this.stageCompleted = false;
  },
  
  // Initialiser un nouveau stage
  initStage() {
    try {
      // Réinitialiser l'état du jeu pour le nouveau stage
      enemySpeed = 1 + (this.currentStage * 0.2); // La vitesse augmente avec les stages
      enemyDirection = 1;
      enemyShotTimer = 0;
      playerBullets = [];
      enemyBullets = [];
      explosions = [];
      powerUps = [];
      
      // Réinitialiser les statistiques du stage
      this.resetStageStats();
      
      // Réinitialiser les paramètres de transition
      this.transitionActive = false;
      this.transitionProgress = 0;
      this.starSpeedMultiplier = 1;
      this.transitionPhase = 'none';
      
      // Remettre le joueur en position normale
      player.x = CANVAS_WIDTH / 2 - player.width / 2;
      player.y = CANVAS_HEIGHT - player.height - 20;
      
      // Créer les ennemis adaptés au stage actuel
      const enemiesCreated = createEnemiesForStage(this.currentStage);
      
      // Si les ennemis n'ont pas pu être créés, utiliser une méthode alternative simple
      if (!enemiesCreated) {
        console.warn("Utilisation de la méthode alternative de création d'ennemis");
        this.createSimpleEnemies();
      }
      
      // S'assurer que les étoiles sont créées
      if (!stars || stars.length === 0) {
        createStars();
      }
      
      // Jouer une narration de début de stage si le son est activé
      if (audioConfig.soundEnabled) {
        try {
          playRandomNarration();
        } catch (e) {
          console.error("Erreur lors de la lecture de la narration:", e);
        }
      }
      
      // Remettre le jeu en mode "playing"
      gameState = "playing";
    } catch (e) {
      console.error("Erreur lors de l'initialisation du stage:", e);
      
      // Fallback en cas d'erreur critique
      gameState = "menu";
    }
  },
  
  // Méthode simple de secours pour créer des ennemis basiques
  createSimpleEnemies() {
    // Vider le tableau d'ennemis
    enemies = [];
    
    // Taille des ennemis - augmentée pour plus de visibilité
    const size = 45;
    
    // Créer une simple rangée d'ennemis
    const rowCount = Math.min(3, this.currentStage);
    const colCount = 5;
    
    for (let row = 0; row < rowCount; row++) {
      for (let col = 0; col < colCount; col++) {
        enemies.push({
          x: 50 + col * 100,
          y: 50 + row * 50,
          width: size,
          height: size,
          hp: 1,
          type: "normal",
          color: "#ff0000",
          speedModifier: 1,
          shotChance: 0.001,
          points: 10,
          hasEntered: true,
          pattern: ENEMY_PATTERNS.PATROL,
          startX: 50 + col * 100,
          startY: 50 + row * 50
        });
      }
    }
  },
  
  // Démarrer la transition vers le stage suivant
  startTransition() {
    // Protection contre les appels multiples
    if (this.transitionActive) {
      console.log("Transition déjà active, ignoré");
      return;
    }
    
    console.log("Démarrage de la transition vers le stage suivant");
    
    // Nettoyage préventif
    playerBullets = [];
    enemyBullets = [];
    
    // Définir les états de transition
    this.transitionActive = true;
    this.transitionProgress = 0;
    this.transitionPhase = 'stageComplete';
    this.starSpeedMultiplier = 1;
    
    // Sauvegarder les statistiques du stage
    this.stageStats.timeElapsed = Date.now() - this.stageStartTime;
    
    // Configurer le vaisseau pour la transition
    this.shipTransition = {
      active: false,
      x: player.x,
      y: player.y,
      targetY: -player.height,
      speed: 10
    };
    
    // Pause du gameplay normal
    isPaused = true;
  },
  
  // Mettre à jour la progression de la transition
  updateTransition(deltaTime) {
    if (!this.transitionActive) return;
    
    // Protection contre les valeurs invalides
    if (!deltaTime || deltaTime < 0 || deltaTime > 1000) {
      deltaTime = 16; // Valeur par défaut sécuritaire (~60fps)
    }
    
    // Progression de la transition
    const progressIncrement = deltaTime / this.transitionDuration;
    this.transitionProgress += progressIncrement;
    
    // Vérifier une progression extrême pour éviter les blocages
    if (this.transitionProgress > 5) {
      console.warn("Progression anormale détectée, forçage de la fin de transition");
      this.forceCompleteTransition();
      return;
    }
    
    // Gestion des différentes phases de la transition
    switch (this.transitionPhase) {
      case 'stageComplete':
        // Phase 1: Afficher "Stage X Complete!"
        if (this.transitionProgress > 0.3) {
          this.transitionPhase = 'speedUp';
        }
        break;
        
      case 'speedUp':
        // Phase 2: Accélérer les étoiles
        this.starSpeedMultiplier += deltaTime * 0.005;
        if (this.starSpeedMultiplier > this.maxStarSpeedMultiplier) {
          this.starSpeedMultiplier = this.maxStarSpeedMultiplier;
        }
        
        if (this.transitionProgress > 0.5) {
          this.transitionPhase = 'shipMove';
          this.shipTransition.active = true;
        }
        break;
        
      case 'shipMove':
        // Phase 3: Déplacer le vaisseau vers le haut
        if (this.shipTransition) {
          this.shipTransition.y -= this.shipTransition.speed;
          
          if (this.shipTransition.y <= this.shipTransition.targetY) {
            this.transitionPhase = 'stageBegin';
          }
        } else {
          // Protection si shipTransition n'est pas défini
          this.transitionPhase = 'stageBegin';
        }
        break;
        
      case 'stageBegin':
        // Phase 4: Afficher "Stage X"
        if (this.transitionProgress >= 0.9) {
          this.completeTransition();
        }
        break;
        
      default:
        // Si la phase n'est pas reconnue, on passe à la fin
        console.warn("Phase de transition non reconnue:", this.transitionPhase);
        this.completeTransition();
    }
    
    // Mise à jour des étoiles pendant la transition
    if (typeof updateStarsTransition === 'function') {
      updateStarsTransition();
    }
  },
  
  // Terminer normalement la transition et passer au stage suivant
  completeTransition() {
    try {
      this.goToNextStage();
    } catch (e) {
      console.error("Erreur lors du passage au stage suivant:", e);
      this.forceNextStage();
    } finally {
      this.resetTransitionState();
    }
  },
  
  // Forcer la fin de la transition en cas de problème
  forceCompleteTransition() {
    console.warn("Forçage de la fin de transition");
    this.forceNextStage();
    this.resetTransitionState();
  },
  
  // Réinitialiser l'état de transition
  resetTransitionState() {
    this.transitionActive = false;
    this.transitionProgress = 0;
    this.transitionPhase = 'none';
    this.starSpeedMultiplier = 1;
    
    // S'assurer que le jeu n'est plus en pause
    isPaused = false;
  },
  
  // Passer au stage suivant de façon sécurisée
  goToNextStage() {
    // Incrémenter le stage
    this.currentStage++;
    if (this.currentStage > this.maxStage) {
      this.currentStage = 1; // Retour au début après avoir terminé tous les stages
    }
    
    // Réinitialiser l'état du jeu
    this.stageCompleted = false;
    this.enemiesDefeated = 0;
    
    // Initialiser le nouveau stage
    this.initStage();
  },
  
  // Méthode de secours pour forcer le passage au stage suivant
  forceNextStage() {
    console.warn("Utilisation de la méthode de secours pour passer au stage suivant");
    
    // Nettoyage complet des objets du jeu
    enemies = [];
    playerBullets = [];
    enemyBullets = [];
    explosions = [];
    powerUps = [];
    
    // Incrémenter le stage
    this.currentStage++;
    if (this.currentStage > this.maxStage) {
      this.currentStage = 1;
    }
    
    // Réinitialiser les états
    this.stageCompleted = false;
    this.enemiesDefeated = 0;
    isPaused = false;
    
    // Repositionner le joueur
    if (player) {
      player.x = CANVAS_WIDTH / 2 - (player.width || 40) / 2;
      player.y = CANVAS_HEIGHT - (player.height || 20) - 20;
    }
    
    // Forcer l'initialisation du nouveau stage
    try {
      this.initStage();
    } catch (e) {
      console.error("Échec critique lors de l'initialisation forcée du stage:", e);
      gameState = "menu"; // Retour au menu en dernier recours
    }
  },
  
  // Dessiner la transition entre les stages
  drawTransition() {
    if (!this.transitionActive) return;
    
    // Fond noir
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Dessiner les étoiles en accélération
    drawStars();
    
    // Afficher les textes de transition selon la phase actuelle
    ctx.font = 'bold 48px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    
    if (this.transitionPhase === 'stageComplete') {
      // Affichage "Stage X Completed"
      ctx.fillText(`Stage ${this.currentStage} Terminé!`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 50);
      
      // Résumé des statistiques
      ctx.font = '24px Arial';
      ctx.fillText(`Score: ${this.stageStats.score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx.fillText(`Combo Max: ${this.stageStats.combo}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 35);
      ctx.fillText(`Temps: ${Math.floor(this.stageStats.timeElapsed / 1000)}s`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);
    } 
    else if (this.transitionPhase === 'stageBegin') {
      // Affichage "Stage X"
      ctx.fillText(`Stage ${this.currentStage}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      
      // Instructions
      ctx.font = '24px Arial';
      ctx.fillText("Préparez-vous...", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 50);
    }
    
    // Dessiner le vaisseau en mouvement pendant la phase 'shipMove'
    if (this.shipTransition.active) {
      ctx.fillStyle = player.color;
      ctx.fillRect(
        this.shipTransition.x, 
        this.shipTransition.y, 
        player.width, 
        player.height
      );
      
      // Dessiner les propulseurs (effet visuel)
      ctx.fillStyle = 'orange';
      ctx.beginPath();
      ctx.moveTo(this.shipTransition.x + player.width / 2, this.shipTransition.y + player.height);
      ctx.lineTo(this.shipTransition.x + player.width / 2 - 10, this.shipTransition.y + player.height + 15);
      ctx.lineTo(this.shipTransition.x + player.width / 2 + 10, this.shipTransition.y + player.height + 15);
      ctx.fill();
    }
  }
};

// Fonction pour créer des ennemis adaptés au stage actuel
function createEnemiesForStage(stageNumber) {
  try {
    // Réinitialiser le tableau des ennemis
    enemies = [];
    
    // Définir un nombre minimum d'ennemis pour éviter une division par zéro
    if (!stageSystem.enemiesPerStage || stageSystem.enemiesPerStage <= 0) {
      stageSystem.enemiesPerStage = 10;
    }
    
    // Limiter la taille de la vague initiale pour éviter les surcharges
    const initialEnemies = Math.min(16, Math.floor(stageSystem.enemiesPerStage * 0.5));
    
    // Sélectionner une formation selon le niveau
    let formationType, choreographyType;
    
    // Choisir une formation selon le stage
    if (stageNumber <= 2) {
      formationType = FORMATIONS.GRID; // Formation standard pour débuter
    } else if (stageNumber <= 4) {
      // Alterner entre différentes formations pour les stages intermédiaires
      const formationRoll = Math.random();
      if (formationRoll < 0.5) {
        formationType = FORMATIONS.DOUBLE_ROW;
      } else {
        formationType = FORMATIONS.DIAMOND;
      }
    } else {
      // Utiliser des formations plus complexes pour les stages avancés
      const formationRoll = Math.random();
      if (formationRoll < 0.4) {
        formationType = FORMATIONS.CIRCLE;
      } else if (formationRoll < 0.7) {
        formationType = FORMATIONS.DIAMOND;
      } else {
        formationType = FORMATIONS.DOUBLE_ROW;
      }
    }
    
    // Choisir une chorégraphie d'entrée selon le stage
    if (stageNumber <= 2) {
      // Chorégraphies simples pour débuter
      const choreoRoll = Math.random();
      if (choreoRoll < 0.6) {
        choreographyType = ENTRY_CHOREOGRAPHIES.CURVE_LEFT;
      } else {
        choreographyType = ENTRY_CHOREOGRAPHIES.CURVE_RIGHT;
      }
    } else if (stageNumber <= 4) {
      // Chorégraphies plus variées pour les stages intermédiaires
      const choreoRoll = Math.random();
      if (choreoRoll < 0.4) {
        choreographyType = ENTRY_CHOREOGRAPHIES.ZIGZAG;
      } else if (choreoRoll < 0.7) {
        choreographyType = ENTRY_CHOREOGRAPHIES.SPLIT;
      } else {
        choreographyType = ENTRY_CHOREOGRAPHIES.CURVE_LEFT;
      }
    } else {
      // Chorégraphies avancées pour les stages élevés
      const choreoRoll = Math.random();
      if (choreoRoll < 0.4) {
        choreographyType = ENTRY_CHOREOGRAPHIES.SPIRAL;
      } else if (choreoRoll < 0.7) {
        choreographyType = ENTRY_CHOREOGRAPHIES.SPLIT;
      } else {
        choreographyType = ENTRY_CHOREOGRAPHIES.ZIGZAG;
      }
    }
    
    // Créer la formation avec les paramètres déterminés
    createFormation(initialEnemies, formationType, choreographyType, stageNumber);
    
    return true;
  } catch (e) {
    console.error("Erreur lors de la création des ennemis:", e);
    return false;
  }
}

// Fonctions auxiliaires pour la création des ennemis
function determineEnemyType(normalRatio, shooterRatio, fastRatio) {
  const rand = Math.random();
  if (rand < normalRatio) return "normal";
  if (rand < normalRatio + shooterRatio) return "shooter";
  return "fast";
}

function getEnemyHP(type, stageNumber) {
  const stageMultiplier = 1 + (stageNumber - 1) * 0.2;
  
  switch (type) {
    case "normal": return Math.ceil(1 * stageMultiplier);
    case "shooter": return Math.ceil(2 * stageMultiplier);
    case "fast": return Math.ceil(1 * stageMultiplier);
    default: return 1;
  }
}

function getEnemyColor(type) {
  switch (type) {
    case "normal": return "#5fff55"; // Vert clair
    case "shooter": return "#ff55ff"; // Rose
    case "fast": return "#ffaa22"; // Orange
    default: return "#ff5555"; // Rouge par défaut
  }
}

function getEnemySpeedModifier(type, stageNumber) {
  const stageMultiplier = 1 + (stageNumber - 1) * 0.1;
  
  switch (type) {
    case "normal": return 1 * stageMultiplier;
    case "shooter": return 0.7 * stageMultiplier;
    case "fast": return 1.5 * stageMultiplier;
    default: return 1;
  }
}

function getEnemyShotChance(type, stageNumber) {
  const stageMultiplier = 1 + (stageNumber - 1) * 0.1;
  
  switch (type) {
    case "normal": return 0.001 * stageMultiplier;
    case "shooter": return 0.005 * stageMultiplier;
    case "fast": return 0.002 * stageMultiplier;
    default: return 0.001;
  }
}

function getEnemyPoints(type) {
  switch (type) {
    case "normal": return 10;
    case "shooter": return 20;
    case "fast": return 15;
    default: return 10;
  }
}

// Mise à jour spécifique des étoiles pendant la transition
function updateStarsTransition() {
  // Vérifier que stars existe et est un tableau
  if (!stars || !Array.isArray(stars)) return;
  
  stars.forEach(star => {
    star.y += star.speed * stageSystem.starSpeedMultiplier;
    if (star.y > CANVAS_HEIGHT) {
      star.y = 0;
      star.x = Math.random() * CANVAS_WIDTH;
    }
  });
} 