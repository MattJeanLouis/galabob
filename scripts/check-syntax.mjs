import { readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../js/', import.meta.url));

function collectJavaScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectJavaScriptFiles(path));
    else if (extname(entry.name) === '.js') files.push(path);
  }
  return files;
}

const failures = [];
const files = collectJavaScriptFiles(sourceRoot).sort();

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    failures.push({
      file: relative(projectRoot, file),
      output: (result.stderr || result.stdout || '').trim()
    });
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`\n${failure.file}\n${failure.output}`);
  }
  process.exitCode = 1;
} else {
  console.log(`${files.length} fichiers JavaScript valides.`);
}
