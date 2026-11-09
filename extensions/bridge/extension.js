const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { constants } = require('node:fs');
const { startServer } = require('./server');
const { SessionTracker } = require('./state');

const symbols = { Ready: '○', Working: '⏳', Completed: '✓', 'Waiting for input': '?', Error: '✕', Disconnected: '⚠' };

/** @param {import('vscode').ExtensionContext} context @param {string} [pluginDirectory] */
async function activateBridge(context, pluginDirectory = path.join(context.extensionPath, 'plugin')) {
  const output = vscode.window.createOutputChannel('OpenCode Notification Bridge');
  context.subscriptions.push(output);
  /** @type {Map<string, {terminal: import('vscode').Terminal, tracker: SessionTracker, seen: number, tty: string, status: string}>} */
  const instances = new Map();
  /** @type {{id: number, kind: string, status: string}[]} */
  const notices = [];
  let sequence = 0;
  // Ordered event processing prevents an idle event overtaking a busy event.
  let pending = Promise.resolve();
  const bridge = await startServer(event => {
    pending = pending.then(async () => {
      let instance = instances.get(event.instanceID);
      if (!instance) {
        for (const terminal of vscode.window.terminals) {
          const pid = await terminal.processId;
          if (!pid || !event.ancestors.includes(pid)) continue;
          let tty = '';
          try { tty = await fs.readlink(`/proc/${pid}/fd/0`); } catch {}
          if (!/^\/dev\/pts\/\d+$/.test(tty)) tty = '';
          instance = { terminal, tracker: new SessionTracker(), seen: Date.now(), tty, status: 'Ready' };
          instances.set(event.instanceID, instance);
          output.appendLine(`Connected OpenCode to terminal ${pid}.`);
          break;
        }
      }
      if (!instance) return;
      instance.seen = Date.now();
      if (event.sessionID) {
        const result = instance.tracker.apply({ ...event, sessionID: event.sessionID });
        if (result?.sound) {
          notices.push({ id: ++sequence, kind: result.sound, status: result.status });
          if (notices.length > 100) notices.shift();
        }
      }
      instance.status = instance.tracker.status();
    }).catch(error => output.appendLine(String(error)));
    return pending;
  });
  context.environmentVariableCollection.persistent = false;
  context.environmentVariableCollection.description = 'Connect terminal OpenCode sessions to notifications.';
  context.environmentVariableCollection.replace('OPENCODE_NOTIFICATION_URL', bridge.url);
  context.environmentVariableCollection.replace('OPENCODE_NOTIFICATION_TOKEN', bridge.token);
  context.subscriptions.push({ dispose: () => {
    context.environmentVariableCollection.clear();
    bridge.server.close();
    bridge.server.closeAllConnections();
  } });

  const tick = setInterval(async () => {
    for (const instance of instances.values()) {
      if (Date.now() - instance.seen > 16000) instance.status = 'Disconnected';
    }
    // Several root sessions may share a terminal. Write exactly one aggregate title.
    for (const terminal of vscode.window.terminals) {
      const related = [...instances.values()].filter(i => i.terminal === terminal);
      if (!related.length) continue;
      const status = ['Waiting for input', 'Working', 'Error', 'Completed', 'Ready', 'Disconnected']
        .find(s => related.some(i => i.status === s)) || 'Ready';
      const tty = related.find(i => i.tty)?.tty;
      if (!tty) continue;
      try {
        const handle = await fs.open(tty, constants.O_WRONLY | constants.O_NOCTTY);
        try {
          await handle.write(`\x1b]0;${symbols[/** @type {keyof typeof symbols} */ (status)]} OpenCode — ${status}\x07`);
        } finally { await handle.close(); }
      } catch (error) { output.appendLine(`Terminal title: ${error}`); }
    }
  }, 1200);
  context.subscriptions.push({ dispose: () => clearInterval(tick) });
  context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => {
    for (const [key, instance] of instances) if (instance.terminal === terminal) instances.delete(key);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('opencodeNotificationBridge.poll', (after = 0) => ({
    sequence,
    notices: notices.filter(n => n.id > after),
    statuses: [...instances.values()].map(i => i.status),
  })));
  context.subscriptions.push(vscode.commands.registerCommand('opencodeNotificationBridge.configureTitles', async () => {
    await vscode.workspace.getConfiguration('terminal.integrated.tabs').update('title', '${sequence}', vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('Terminal status titles enabled.');
  }));
  context.subscriptions.push(vscode.commands.registerCommand('opencodeNotificationBridge.installPlugin', async () => {
    // OpenCode's plugin loader discovers .js/.ts; the source is .mjs for Node tests.
    const directory = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode', 'plugins');
    const target = path.join(directory, 'opencode-notifications.js');
    const source = await fs.readFile(path.join(pluginDirectory, 'opencode-notifications.mjs'));
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(target, source, { flag: 'wx' });
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
      const previous = await fs.readFile(target);
      if (!previous.equals(source)) {
        const choice = await vscode.window.showWarningMessage(`Replace the existing plugin at ${target}?`, { modal: true }, 'Replace');
        if (choice !== 'Replace') return;
        await fs.writeFile(target, source);
      }
    }
    output.appendLine(`Plugin installed at ${target}`);
    vscode.window.showInformationMessage('OpenCode plugin installed. Close and restart OpenCode in a NEW VS Code terminal to connect.');
  }));
  if (process.platform !== 'linux') output.appendLine('Terminal association currently requires a Linux OpenCode host (/proc).');
}

/** @param {import('vscode').ExtensionContext} context */
async function activate(context) {
  // Local windows already have an embedded bridge in the desktop extension.
  if (!vscode.env.remoteName) return;
  await activateBridge(context);
}

module.exports = { activate, activateBridge };
