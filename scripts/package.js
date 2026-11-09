const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function main() {
  const root = path.resolve(__dirname, '..');
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  for (const name of ['local', 'bridge']) {
    const directory = path.join(root, 'extensions', name);
    if (name === 'local') await fs.copyFile(path.join(root, 'README.md'), path.join(directory, 'README.md'));
    await fs.copyFile(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'));
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    const output = path.join(root, 'dist', `${manifest.name}-${manifest.version}.vsix`);
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@vscode/vsce/vsce'), 'package', '--no-dependencies', '--allow-missing-repository', '--out', output], { cwd: directory, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Packaging ${name} failed.`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
