// Configuration globale du jeu
let CANVAS_WIDTH = window.innerWidth;
let CANVAS_HEIGHT = window.innerHeight;

// Constantes pour les patterns de mouvement des ennemis
const ENEMY_PATTERNS = {
  PATROL: 'patrol',    // Patrouille horizontale
  DIVE: 'dive',       // Plongée en arc
  SWEEP: 'sweep'      // Balayage en S
};

// Constantes de vitesse
const SPEED_CONFIG = {
  BASE_PLAYER_SPEED: 5,
  BASE_ENEMY_SPEED: 1,
  SPEED_INCREMENT: 0.0001, // Augmentation par point de score
  MAX_SPEED_MULTIPLIER: 2  // Vitesse maximale = 2x la vitesse de base
};

// Configuration UI et debug
const GAME_CONFIG = {
  showDebugInfo: false,  // État d'affichage des stats
  debugColor: 'rgba(255, 255, 255, 0.7)',  // Couleur du texte debug
  showAudioControls: false  // État d'affichage des contrôles audio
};

// Constantes pour le système de combo
const COMBO_TIMEOUT = 1000; // Temps en ms pour maintenir un combo 