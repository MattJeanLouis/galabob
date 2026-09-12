/** Definition du vaisseau historique, dont le rendu reste dans player.js. */
export const CLASSIC_SHIP = {
  id: 'classic',
  label: 'Vaisseau classique',
  renderer: 'legacy-vector',
  stats: {
    speedMultiplier: 1,
    fireRateMultiplier: 1,
    hitboxMultiplier: 1
  }
};
