import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { zipSync } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist-extension');
const release = join(root, 'release');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

execFileSync(process.execPath, [join(root, 'scripts', 'build-extension.mjs')], { stdio: 'inherit' });

async function collect(directory) {
  const archive = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(archive, await collect(path));
    else if (entry.isFile()) archive[relative(output, path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
  }
  return archive;
}

const filename = `bodee-extension-${packageJson.version}.zip`;
const archive = zipSync(await collect(output), { level: 9 });
await mkdir(release, { recursive: true });
await writeFile(join(release, filename), archive);
console.log(`Pacote criado em ${join(release, filename)} (${(await stat(join(release, filename))).size} bytes)`);
