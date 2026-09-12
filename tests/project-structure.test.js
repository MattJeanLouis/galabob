import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('les scripts et feuilles declares dans index.html existent', () => {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const sources = [...html.matchAll(/(?:src|href)="([^"#?]+\.(?:js|css))"/g)]
    .map(match => match[1]);

  assert.ok(sources.length > 0);
  for (const source of sources) {
    assert.equal(existsSync(resolve(root, source)), true, `${source} est introuvable`);
  }

  assert.ok(html.indexOf('js/bootstrap.js') < html.indexOf('js/main.js'),
    'le runtime modulaire doit etre initialise avant le demarrage du jeu');
  assert.ok(html.indexOf('js/content/powerups/catalogue.js') <
    html.indexOf('js/entities/powerups.js'),
  'les donnees de bonus doivent etre chargees avant leur logique');
  assert.ok(html.indexOf('js/content/modes/arcade-progression.js') <
    html.indexOf('js/core/stages.js'),
  'la progression Arcade doit etre chargee avant le moteur de stages');
  assert.ok(html.indexOf('js/content/modes/assault-progression.js') <
    html.indexOf('js/core/stages.js'),
  'la progression Assaut doit etre chargee avant le moteur de stages');
});

test('le manifeste audio est un JSON valide avec ses deux sections', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'assets/audio/manifest.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.musique?.pistes));
  assert.ok(Array.isArray(manifest.narration?.pistes));
});
