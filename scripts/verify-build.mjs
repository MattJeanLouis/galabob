import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
const indexPath = resolve(dist, 'index.html');

if (!existsSync(indexPath)) throw new Error('dist/index.html est absent.');

const html = readFileSync(indexPath, 'utf8');
const references = [...html.matchAll(/(?:src|href)=["']([^"'#?]+)["']/g)]
  .map((match) => match[1])
  .filter((path) => !/^(?:https?:|data:)/.test(path));

const missing = references.filter((path) => {
  const clean = path.replace(/^\.\//, '').replace(/^\//, '');
  return !existsSync(resolve(dist, clean));
});

if (missing.length) {
  throw new Error(`Ressources absentes de la build : ${missing.join(', ')}`);
}

console.log(`Build autonome vérifiée (${references.length} ressources référencées).`);
