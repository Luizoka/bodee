import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(new URL('..', import.meta.url).pathname);
const output = join(root, 'dist-extension');
const expectedHosts = new Set([
  'https://pa.equatorialenergia.com.br',
  'https://api-pa-cliente.equatorialenergia.com.br',
]);
const textExtensions = new Set(['.css', '.html', '.js', '.json']);

function fail(message) { throw new Error(`[check:extension] ${message}`); }
function extension(path) { return path.slice(path.lastIndexOf('.')); }
async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => fail('dist-extension/ não existe. Execute pnpm build:extension.'));
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
async function exists(path) {
  return stat(path).then(() => true).catch(() => false);
}
function requireFile(path, label) {
  return exists(join(output, path)).then((present) => {
    if (!present) fail(`${label} não encontrado: ${path}`);
  });
}

const files = await filesIn(output);
const relativeFiles = files.map((path) => relative(output, path));
const manifestPath = join(output, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (manifest.manifest_version !== 3) fail('manifest_version deve ser 3.');
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)) fail('Versão do manifest inválida.');
if (!manifest.name || !manifest.description || !manifest.action?.default_popup || !manifest.background?.service_worker) {
  fail('Manifest sem metadados ou entradas obrigatórias.');
}
if (JSON.stringify(manifest.permissions) !== JSON.stringify(['scripting', 'downloads'])) {
  fail('Permissões inesperadas no manifest.');
}
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify([...expectedHosts].map((host) => `${host}/*`))) {
  fail('Host permissions inesperadas no manifest.');
}

await requireFile(manifest.action.default_popup, 'Popup');
await requireFile(manifest.background.service_worker, 'Service worker');
for (const contentScript of manifest.content_scripts ?? []) {
  for (const file of contentScript.js ?? []) await requireFile(file, 'Content script');
}
for (const size of ['16', '32', '48', '128']) {
  const icon = manifest.icons?.[size];
  if (!icon) fail(`Ícone ${size}px ausente no manifest.`);
  await requireFile(icon, `Ícone ${size}px`);
  if (manifest.action.default_icon?.[size] !== icon) fail(`Ícone da action ${size}px não corresponde ao ícone principal.`);
}

const forbiddenNames = /(^|\/)(node_modules|test|tests|coverage)(\/|$)|\.env(?:\.|$)|\.map$/i;
for (const path of relativeFiles) if (forbiddenNames.test(path)) fail(`Arquivo proibido no bundle: ${path}`);

const foundHosts = new Set();
for (const path of files) {
  if (!textExtensions.has(extension(path))) continue;
  const content = await readFile(path, 'utf8');
  const label = relative(output, path);
  if (/(\beval\s*\(|\bnew Function\s*\(|<script[^>]+https?:\/\/|import\s*\(\s*['"]https?:\/\/)/i.test(content)) {
    fail(`Execução de código remoto encontrada em ${label}.`);
  }
  if (/(localhost|127\.0\.0\.1|\bplaywright\b|\bnode:|\bprocess\.)/i.test(content)) {
    fail(`Referência de desenvolvimento ou Node encontrada em ${label}.`);
  }
  if (/(ADMIN_API_KEY|DATABASE_URL|CREDENTIALS_ENCRYPTION_KEY|BEGIN (?:RSA |EC )?PRIVATE KEY)/.test(content)) {
    fail(`Possível segredo encontrado em ${label}.`);
  }
  if (extension(path) === '.js') {
    for (const match of content.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const imported = resolve(dirname(path), match[1]);
      if (!await exists(imported)) fail(`Import local ausente em ${label}: ${match[1]}`);
    }
  }
  if (extension(path) === '.html') {
    for (const match of content.matchAll(/(?:src|href)="(\.[^"]+)"/g)) {
      const referenced = resolve(dirname(path), match[1]);
      if (!await exists(referenced)) fail(`Asset local ausente em ${label}: ${match[1]}`);
    }
  }
  for (const match of content.matchAll(/https:\/\/[^\s'"`)<]+/g)) {
    const origin = new URL(match[0]).origin;
    foundHosts.add(origin);
    if (!expectedHosts.has(origin)) fail(`Host não permitido no bundle: ${origin} (${label}).`);
  }
}

console.log(JSON.stringify({
  manifestVersion: manifest.manifest_version,
  version: manifest.version,
  files: relativeFiles.length,
  bytes: (await Promise.all(files.map(async (path) => (await stat(path)).size))).reduce((sum, size) => sum + size, 0),
  permissions: manifest.permissions,
  hosts: [...foundHosts].sort(),
}, null, 2));
