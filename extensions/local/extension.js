const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { play, chime } = require('./audio');

/** @param {import('vscode').ExtensionContext} context */
async function activate(context) {
  if (!vscode.env.remoteName) {
    const { activateBridge } = require('./bridge/extension');
    await activateBridge(context, path.join(context.extensionPath, 'bridge', 'plugin'));
    for (const command of ['installPlugin', 'configureTitles']) {
      context.subscriptions.push(vscode.commands.registerCommand(`opencodeNotifications.${command}`, () =>
        vscode.commands.executeCommand(`opencodeNotificationBridge.${command}`)));
    }
  }
  const output = vscode.window.createOutputChannel('OpenCode Notifications');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'opencodeNotifications.showLog';
  context.subscriptions.push(output, status);
  const config = () => vscode.workspace.getConfiguration('opencodeNotifications');
  await fs.mkdir(context.globalStorageUri.fsPath, { recursive: true });
  for (const [kind, notes] of [['completion', [659, 880]], ['attention', [880, 659, 880]]]) {
    await fs.writeFile(path.join(context.globalStorageUri.fsPath, `${kind}.wav`), chime(/** @type {number[]} */ (notes)));
  }
  /** @param {string} kind */
  const automaticSoundEnabled = kind => config().get('soundsEnabled', true) && config().get(`${kind}.enabled`, true);
  /** @param {string} kind @param {boolean} [test] */
  const sound = async (kind, test = false) => {
    if (!test && !automaticSoundEnabled(kind)) return;
    const file = config().get(`${kind}.path`, '') || path.join(context.globalStorageUri.fsPath, `${kind}.wav`);
    const volume = config().get(`${kind}.volume`) ?? config().get('volume', 10);
    try { await play(file, undefined, undefined, volume); }
    catch (error) {
      output.appendLine(`Sound: ${error}`);
      // Keep failures visible without repeatedly showing the same popup.
      const message = String(error);
      if (test || message !== lastSoundError) vscode.window.showWarningMessage(`OpenCode Notifications: ${message}`);
      lastSoundError = message;
    }
  };
  let lastSoundError = '';
  context.subscriptions.push(vscode.commands.registerCommand('opencodeNotifications.toggleSounds', async () => {
    const enabled = !config().get('soundsEnabled', true);
    await config().update('soundsEnabled', enabled, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`OpenCode Notifications: sounds ${enabled ? 'on' : 'off'}.`);
  }));
  for (const kind of ['completion', 'attention']) {
    const label = kind === 'completion' ? 'Completion' : 'Attention';
    context.subscriptions.push(vscode.commands.registerCommand(`opencodeNotifications.choose${label}Sound`, async () => {
      // Explicit file: defaultUri opens the LOCAL picker even in Remote SSH.
      const files = await vscode.window.showOpenDialog({
        title: `Choose ${kind} sound (local computer)`,
        defaultUri: vscode.Uri.file(require('node:os').homedir()),
        canSelectMany: false,
        filters: { Audio: process.platform === 'win32' ? ['wav'] : ['wav', 'ogg', 'flac', 'mp3', 'aiff', 'm4a'] },
      });
      if (!files?.[0]) return;
      if (files[0].scheme !== 'file') {
        vscode.window.showErrorMessage('Choose a sound file on your local computer, not the SSH host.');
        return;
      }
      await config().update(`${kind}.path`, files[0].fsPath, vscode.ConfigurationTarget.Global);
      await sound(kind, true);
    }));
    context.subscriptions.push(vscode.commands.registerCommand(`opencodeNotifications.test${label}Sound`, () => sound(kind, true)));
  }
  context.subscriptions.push(vscode.commands.registerCommand('opencodeNotifications.settings', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`)));
  context.subscriptions.push(vscode.commands.registerCommand('opencodeNotifications.showLog', () => output.show()));

  let cursor = 0;
  let initialized = false;
  let polling = false;
  let disposed = false;
  let bridgeError = '';
  /** @type {Promise<void>} */
  let audioQueue = Promise.resolve();
  const poll = async () => {
    if (polling || disposed) return;
    polling = true;
    try {
      const snapshot = /** @type {{sequence: number, statuses: string[], notices: {id: number, kind: string, status: string}[]}} */ (
        await vscode.commands.executeCommand('opencodeNotificationBridge.poll', cursor));
      if (disposed) return;
      if (!snapshot) throw new Error('No bridge response.');
      bridgeError = '';
      // A bridge restart resets the counter; old sounds are never replayed on connect.
      if (!initialized || snapshot.sequence < cursor) { cursor = snapshot.sequence; initialized = true; }
      else {
        for (const notice of snapshot.notices) {
          cursor = Math.max(cursor, notice.id);
          output.appendLine(`${new Date().toISOString()} ${notice.status}`);
           if ((notice.kind === 'completion' || notice.kind === 'attention') && automaticSoundEnabled(notice.kind)) {
            audioQueue = audioQueue.then(() => disposed ? undefined : sound(notice.kind));
          }
          if (config().get('showNotifications', true)) {
            const message = `OpenCode: ${notice.status}.`;
            if (notice.kind === 'error') vscode.window.showWarningMessage(message);
            else vscode.window.showInformationMessage(message);
          }
        }
      }
      const current = ['Waiting for input', 'Working', 'Error', 'Completed', 'Ready', 'Disconnected']
        .find(s => snapshot.statuses.includes(s)) || 'Ready';
      const icon = current === 'Working' ? 'sync~spin' : current === 'Waiting for input' ? 'question' : current === 'Completed' ? 'check' : current === 'Error' ? 'error' : current === 'Disconnected' ? 'debug-disconnect' : 'terminal';
      status.text = `$(${icon}) OpenCode: ${current}`;
      status.tooltip = 'OpenCode Notifications — click to view the log';
    } catch (error) {
      const message = String(error);
      const guidance = vscode.env.remoteName
        ? 'Install/enable OpenCode Notification Bridge on the SSH host.'
        : 'Reload VS Code to restart local OpenCode event detection.';
      if (bridgeError !== message) output.appendLine(`Bridge unavailable. ${guidance} ${message}`);
      bridgeError = message;
      status.text = '$(debug-disconnect) OpenCode: Disconnected';
      status.tooltip = `${guidance} Click for details.`;
      // Reconnection starts a fresh notification baseline.
      initialized = false;
    } finally {
      if (!disposed) status.show();
      polling = false;
    }
  };
  const timer = setInterval(() => { void poll(); }, 1000);
  context.subscriptions.push({ dispose: () => { disposed = true; clearInterval(timer); } });
  void poll();
}

module.exports = { activate };
