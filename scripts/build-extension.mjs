import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'extension');
const output = join(root, 'dist-extension');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const packageJson = await readJson(join(root, 'package.json'));
const manifest = await readJson(join(source, 'manifest.json'));
if (manifest.version !== packageJson.version) {
  throw new Error(`Versões divergentes: package.json (${packageJson.version}) e manifest.json (${manifest.version}).`);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const distributionManifest = {
  ...manifest,
  action: { ...manifest.action, default_popup: 'popup/popup.html' },
  background: { ...manifest.background, service_worker: 'background/service-worker.js' },
};
await writeFile(join(output, 'manifest.json'), `${JSON.stringify(distributionManifest, null, 2)}\n`);

await cp(join(source, 'assets'), join(output, 'assets'), { recursive: true });
await cp(join(source, 'icons'), join(output, 'icons'), { recursive: true });
await cp(join(source, 'src', 'popup'), join(output, 'popup'), { recursive: true });
await cp(join(source, 'src', 'shared'), join(output, 'shared'), { recursive: true });
await mkdir(join(output, 'background'), { recursive: true });
await mkdir(join(output, 'services'), { recursive: true });

const worker = await readFile(join(source, 'src', 'background', 'service-worker.js'), 'utf8');
await writeFile(
  join(output, 'background', 'service-worker.js'),
  worker.replace("'../equatorial/client.js'", "'../services/equatorial-client.js'"),
);
await cp(join(source, 'src', 'equatorial', 'client.js'), join(output, 'services', 'equatorial-client.js'));

const popupPath = join(output, 'popup', 'popup.html');
const popup = await readFile(popupPath, 'utf8');
await writeFile(popupPath, popup.replaceAll('../../assets/', '../assets/'));

execFileSync(process.execPath, [join(root, 'scripts', 'check-extension.mjs')], { stdio: 'inherit' });
console.log(`Extensão criada em ${output}`);
