import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const outputRoot = resolve(projectRoot, 'dist');

/**
 * Galabob charge encore son moteur historique avec des scripts classiques.
 * Vite empaquette la nouvelle couche Three.js, tandis que ce petit plugin
 * transporte le runtime classique et les médias dans le dossier publiable.
 */
function copyClassicRuntime() {
  return {
    name: 'galabob-copy-classic-runtime',
    closeBundle() {
      mkdirSync(outputRoot, { recursive: true });
      for (const directory of ['js', 'assets']) {
        const source = resolve(projectRoot, directory);
        if (existsSync(source)) {
          cpSync(source, resolve(outputRoot, directory), { recursive: true });
        }
      }
    }
  };
}

export default defineConfig({
  // Le jeu peut ainsi vivre à la racine du Pi ou dans /galabob/.
  base: './',
  plugins: [copyClassicRuntime()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 650
  }
});
