const fs = require('node:fs/promises');
const path = require('node:path');

// The desktop extension embeds the same bridge implementation used over SSH.
// Keep one source of truth; generated copies are ignored in version control.
async function syncBridge() {
  const root = path.resolve(__dirname, '..', 'extensions');
  for (const file of ['extension.js', 'server.js', 'state.js', 'plugin/opencode-notifications.mjs']) {
    const target = path.join(root, 'local', 'bridge', file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(root, 'bridge', file), target);
  }
}

syncBridge().catch(error => { console.error(error); process.exitCode = 1; });
