import test from 'node:test';
import assert from 'node:assert/strict';
import { GameModeRegistry } from '../js/core/modes/game-mode-registry.js';

test('enregistre, active et appelle un mode', () => {
  const calls = [];
  const modes = new GameModeRegistry();
  modes.register({ id: 'arcade', label: 'Arcade', startRun: value => calls.push(value) });
  modes.activate('arcade');
  modes.call('startRun', 42);

  assert.equal(modes.current().id, 'arcade');
  assert.deepEqual(calls, [42]);
  assert.equal(modes.list().length, 1);
});

test('refuse les identifiants invalides et les doublons', () => {
  const modes = new GameModeRegistry();
  assert.throws(() => modes.register({ id: 'Mode Histoire' }), /invalide/);
  modes.register({ id: 'story' });
  assert.throws(() => modes.register({ id: 'story' }), /deja enregistre/);
  assert.throws(() => modes.activate('inconnu'), /inconnu/);
});
