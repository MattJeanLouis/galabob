import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_SCHEMA_VERSION,
  ProfileStore,
  createDefaultProfile
} from '../js/core/profile-store.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    value: key => values.get(key)
  };
}

test('cree un profil versionne sans inventer de vaisseau jouable', () => {
  const profile = createDefaultProfile();
  assert.equal(profile.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(profile.selectedMode, 'arcade');
  assert.equal(profile.selectedShip, null);
  assert.deepEqual(profile.unlocks.ships, []);
});

test('importe le meilleur score historique sans le perdre', () => {
  const storage = memoryStorage({ highScore: '163370' });
  const store = new ProfileStore(storage);
  const profile = store.load();
  assert.equal(profile.modes.arcade.highScore, 163370);
  assert.ok(storage.value('galabob.profile'));
});

test('isole la progression de chaque mode', () => {
  const store = new ProfileStore(memoryStorage());
  store.load();
  store.updateMode('arcade', { highestStage: 12 });
  store.updateMode('story', { chapter: 2 });
  assert.equal(store.mode('arcade').highestStage, 12);
  assert.equal(store.mode('story').chapter, 2);
});

test('reste utilisable quand le stockage navigateur echoue', () => {
  const brokenStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); }
  };
  const store = new ProfileStore(brokenStorage);
  assert.doesNotThrow(() => store.load());
  assert.equal(store.mode('arcade').highScore, 0);
});

test('deverrouille et selectionne les vaisseaux sans doublon', () => {
  const store = new ProfileStore(memoryStorage());
  store.load();
  store.unlockShip('classic');
  store.unlockShip('classic');
  store.unlockShip('swift');
  assert.deepEqual(store.data.unlocks.ships, ['classic', 'swift']);
  assert.equal(store.selectShip('swift'), 'swift');
  assert.throws(() => store.selectShip('locked'), /verrouille/);
});
