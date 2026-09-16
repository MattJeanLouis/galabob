/**
 * Definition du mode historique.
 *
 * Ses regles vivent encore dans game.js et stages.js. Les hooks constituent la
 * couture de migration : les futurs modes pourront etre ajoutes sans etendre
 * les conditionnelles globales, puis les regles arcade seront deplacees ici
 * progressivement.
 */
export function createArcadeMode(progression = null) {
  return {
    id: 'arcade',
    label: 'Arcade',
    hasScore: true,
    hasEndlessLoops: true,
    progression,
    startRun() {
      if (typeof window.hudAlert === 'function') {
        window.hudAlert('CODE VISUEL', 'CYAN : VOUS · ROUGE : DANGER · VERT : BONUS', '#22f5a7', 2600);
      }
    },
    update() {},
    completeStage() {},
    endRun() {}
  };
}
