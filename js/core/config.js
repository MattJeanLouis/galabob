// Configuration globale du jeu
let CANVAS_WIDTH = window.innerWidth;
let CANVAS_HEIGHT = window.innerHeight;

// Constantes pour les patterns de mouvement des ennemis
const ENEMY_PATTERNS = {
  PATROL: 'patrol',      // Patrouille horizontale
  DIVE: 'dive',         // Plongée en arc
  SWEEP: 'sweep',       // Balayage en S
  ZIGZAG: 'zigzag',     // Mouvement en zigzag
  FORMATION: 'formation' // Nouveau: ennemis en formation ordonnée
};

// Constantes pour les formations et chorégraphies
const FORMATIONS = {
  GRID: 'grid',           // Formation en grille classique
  DIAMOND: 'diamond',     // Formation en losange
  CIRCLE: 'circle',       // Formation en cercle
  DOUBLE_ROW: 'doubleRow' // Formation en double ligne
};

// Configurations des chorégraphies d'entrée
const ENTRY_CHOREOGRAPHIES = {
  SPIRAL: 'spiral',       // Entrée en spirale
  ZIGZAG: 'zigzag',       // Entrée en zigzag
  CURVE_LEFT: 'curveLeft', // Courbe depuis la gauche
  CURVE_RIGHT: 'curveRight', // Courbe depuis la droite
  SPLIT: 'split'           // Division en deux groupes
};

// Constantes de vitesse
const SPEED_CONFIG = {
  BASE_PLAYER_SPEED: 3.5,
  BASE_ENEMY_SPEED: 1,
  SPEED_INCREMENT: 0.00005,
  MAX_SPEED_MULTIPLIER: 1.5
};

// Configuration UI et debug
const GAME_CONFIG = {
  showDebugInfo: false,  // État d'affichage des stats
  debugColor: 'rgba(255, 255, 255, 0.7)',  // Couleur du texte debug
  showAudioControls: false  // État d'affichage des contrôles audio
};

// Constantes pour le système de combo
const COMBO_TIMEOUT = 1000; // Temps en ms pour maintenir un combo 