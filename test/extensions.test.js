const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

test('per-sound volume settings inherit shared volume by default and support 1–10 overrides', async () => {
  const manifest = JSON.parse(await fs.readFile(path.resolve(__dirname, '../extensions/local/package.json'), 'utf8'));
  const properties = manifest.contributes.configuration.properties;
  for (const kind of ['completion', 'attention']) {
    const setting = properties[`opencodeNotifications.${kind}.volume`];
    assert.deepEqual(setting.type, ['integer', 'null']);
    assert.equal(setting.default, null);
    assert.equal(setting.minimum, 1);
    assert.equal(setting.maximum, 10);
    assert.equal(setting.scope, 'application');
  }
  assert.equal(properties['opencodeNotifications.volume'].default, 10);
});

for (const remoteName of ['ssh-remote', undefined]) {
test(`${remoteName || 'standalone local'}: status, custom sounds, toggles, and local picker`, async t => {
  const commands = new Map();
  const played = [];
  const volumes = [];
  const warnings = [];
  const information = [];
  const titles = [];
  const settings = new Map([
    ['completion.path', '/local/custom completion.wav'],
    ['attention.path', '/local/custom attention.wav'],
  ]);
  const env = new Map();
  const contexts = [];
  const terminal = { processId: Promise.resolve(process.pid) };
  const item = {};
  let pickerOptions;
  let pickerFile = '/local/new attention.wav';
  const commandsAPI = {
    registerCommand: (name, fn) => { commands.set(name, fn); return { dispose() {} }; },
    executeCommand: async (name, ...args) => commands.get(name)?.(...args),
  };
  const commonVSCode = {
    env: { remoteName },
    commands: commandsAPI,
    ConfigurationTarget: { Global: 1 },
    StatusBarAlignment: { Right: 2 },
    workspace: { getConfiguration: () => ({
      get: (key, fallback) => settings.has(key) ? settings.get(key) : fallback,
      update: async (key, value) => { settings.set(key, value); },
    }) },
    Uri: { file: file => ({ scheme: 'file', fsPath: file }) },
    window: {
      state: { focused: false },
      activeTerminal: terminal,
      terminals: [terminal],
      createOutputChannel: () => ({ appendLine() {}, dispose() {}, show() {} }),
      createStatusBarItem: () => Object.assign(item, { show() {}, dispose() {} }),
      onDidCloseTerminal: () => ({ dispose() {} }),
      showInformationMessage(message) { information.push(message); }, showWarningMessage(message) { warnings.push(message); }, showErrorMessage() {},
      showOpenDialog: async options => { pickerOptions = options; return [{ scheme: 'file', fsPath: pickerFile }]; },
    },
  };
  let remoteTick;
  async function load(kind, embedded = false) {
    const filename = path.resolve(__dirname, `../extensions/${kind}/extension.js`);
    const nativeRequire = createRequire(filename);
    const timers = [];
    const module = { exports: {} };
    const sandbox = {
      module, process, Buffer,
      setInterval: callback => { timers.push(callback); return 1; },
      clearInterval() {},
      require: name => {
        if (name === 'vscode') return commonVSCode;
        if (name === './bridge/extension') return { activateBridge: async (context, pluginDirectory) => {
          assert.equal(pluginDirectory, path.join(context.extensionPath, 'bridge', 'plugin'));
          remoteTick = await load('bridge', true);
        } };
        if (name === './audio') return { chime: () => Buffer.alloc(0), play: async (file, run, platform, volume) => { played.push(file); volumes.push(volume); } };
        if (name === 'node:fs/promises') return kind === 'local' ? {
          mkdir: async () => {}, writeFile: async () => {},
        } : {
          ...fs,
          readlink: async () => '/dev/pts/123',
          open: async () => ({ write: async title => { titles.push(title); }, close: async () => {} }),
        };
        return nativeRequire(name);
      },
    };
    vm.runInNewContext(await fs.readFile(filename, 'utf8'), sandbox, { filename });
    const context = {
      extension: { id: 'test-publisher.opencode-notifications' },
      extensionPath: path.dirname(filename),
      globalStorageUri: { fsPath: '/local/storage' },
      subscriptions: [],
      environmentVariableCollection: {
        replace: (key, value) => env.set(key, value),
        clear() {},
      },
    };
    contexts.push(context);
    await module.exports[embedded ? 'activateBridge' : 'activate'](context);
    return timers[0];
  }
  t.after(() => {
    for (const context of contexts.reverse()) for (const sub of context.subscriptions) sub.dispose();
  });
  if (remoteName) remoteTick = await load('bridge');
  else {
    await load('bridge');
    assert.equal(commands.has('opencodeNotificationBridge.poll'), false, 'standalone companion stays inactive locally');
  }
  const localTick = await load('local');
  assert.equal(typeof remoteTick, 'function');
  assert.equal(commands.has('opencodeNotifications.installPlugin'), !remoteName);
  if (!remoteName) {
    await commands.get('opencodeNotifications.configureTitles')();
    assert.equal(settings.get('title'), '${sequence}');
  }
  // Finish the initial baseline poll before sending fresh events.
  await new Promise(resolve => setImmediate(resolve));
  const send = async (type, extra = {}) => {
    const response = await fetch(env.get('OPENCODE_NOTIFICATION_URL'), {
      method: 'POST',
      headers: { authorization: `Bearer ${env.get('OPENCODE_NOTIFICATION_TOKEN')}` },
      body: JSON.stringify({ instanceID: 'instance', ancestors: [process.pid], sessionID: 'root', type, ...extra }),
    });
    assert.equal(response.status, 204);
  };
  const flush = async () => { await localTick(); await new Promise(resolve => setImmediate(resolve)); };
  await send('session.status', { status: 'busy' });
  await remoteTick();
  await flush();
  assert.match(titles.at(-1), /OpenCode — Working/);
  assert.match(item.text, /sync~spin.*Working/);
  await send('question.asked', { requestID: 'q1' });
  await flush();
  assert.match(item.text, /Waiting for input/);
  await send('session.idle');
  await flush();
  assert.deepEqual(played, ['/local/custom attention.wav']);
  await send('question.replied', { requestID: 'q1' });
  await send('session.idle');
  await flush();
  assert.deepEqual(played, ['/local/custom attention.wav', '/local/custom completion.wav']);
  settings.set('completion.enabled', false);
  await send('session.status', { status: 'busy' });
  await send('session.idle');
  await flush();
  assert.equal(played.length, 2);
  await commands.get('opencodeNotifications.testCompletionSound')();
  assert.equal(played.at(-1), '/local/custom completion.wav');
  await commands.get('opencodeNotifications.chooseAttentionSound')();
  assert.equal(pickerOptions.defaultUri.scheme, 'file');
  assert.equal(settings.get('attention.path'), '/local/new attention.wav');
  assert.equal(played.at(-1), '/local/new attention.wav');
  await remoteTick();
  assert.match(titles.at(-1), /OpenCode — Completed/);

  settings.set('completion.enabled', true);
  settings.set('volume', 4);
  const complete = async () => {
    await send('session.status', { status: 'busy' });
    await send('session.idle');
    await flush();
  };
  let count = played.length;
  commonVSCode.window.state.focused = true;
  await complete();
  assert.equal(played.length, ++count, 'focused window with active terminal plays');
  assert.equal(volumes.at(-1), 4);
  commonVSCode.window.state.focused = false;
  commonVSCode.window.activeTerminal = undefined;
  await complete();
  assert.equal(played.length, ++count, 'background window without active terminal plays');

  for (const mode of ['unset', 'override', 'null']) {
    for (const [kind, label, override] of [['completion', 'Completion', 2], ['attention', 'Attention', 8]]) {
      if (mode === 'unset') settings.delete(`${kind}.volume`);
      else settings.set(`${kind}.volume`, mode === 'null' ? null : override);
      const expected = mode === 'override' ? override : 4;
      const before = played.length;
      if (kind === 'completion') await complete();
      else {
        await send('question.asked', { requestID: `volume-${mode}` });
        await flush();
        await send('question.replied', { requestID: `volume-${mode}` });
      }
      assert.equal(played.length, before + 1, `${kind} ${mode}: automatic playback`);
      assert.equal(volumes.at(-1), expected, `${kind} ${mode}: automatic volume`);
      settings.set('soundsEnabled', false);
      settings.set(`${kind}.enabled`, false);
      await commands.get(`opencodeNotifications.test${label}Sound`)();
      assert.equal(played.length, before + 2, `${kind} ${mode}: test bypasses enabled settings`);
      assert.equal(volumes.at(-1), expected, `${kind} ${mode}: test volume`);
      pickerFile = `/local/new ${kind}.wav`;
      await commands.get(`opencodeNotifications.choose${label}Sound`)();
      assert.equal(played.length, before + 3, `${kind} ${mode}: picker preview bypasses enabled settings`);
      assert.equal(played.at(-1), pickerFile);
      assert.equal(pickerOptions.defaultUri.scheme, 'file');
      assert.equal(volumes.at(-1), expected, `${kind} ${mode}: picker preview volume`);
      settings.set('soundsEnabled', true);
      settings.set(`${kind}.enabled`, true);
    }
  }
  settings.set('completion.path', '/local/custom completion.wav');
  count = played.length;

  await commands.get('opencodeNotifications.toggleSounds')();
  assert.equal(settings.get('soundsEnabled'), false);
  await complete();
  await send('question.asked', { requestID: 'q2' });
  await flush();
  assert.equal(played.length, count, 'master switch suppresses both sounds');
  await commands.get('opencodeNotifications.testCompletionSound')();
  assert.equal(played.length, ++count, 'manual test bypasses master switch');
  assert.equal(volumes.at(-1), 4);
  await send('session.error', { errorName: 'MessageAbortedError' });
  await send('session.idle');
  await flush();
  await remoteTick();
  assert.match(item.text, /Ready/);
  assert.match(titles.at(-1), /OpenCode — Ready/);
  assert.equal(played.length, count);
  assert.deepEqual(warnings, []);
  await commands.get('opencodeNotifications.toggleSounds')();
  assert.equal(settings.get('soundsEnabled'), true);
  await complete();
  assert.equal(played.length, ++count);
  settings.set('completion.enabled', false);
  await commands.get('opencodeNotifications.toggleSounds')();
  await commands.get('opencodeNotifications.toggleSounds')();
  assert.equal(settings.get('completion.enabled'), false, 'master toggle preserves individual choices');

  // Exercise the actual plugin -> HTTP -> bridge -> desktop poll/presentation path.
  const old = { ...process.env };
  for (const key of ['OPENCODE_NOTIFICATION_URL', 'OPENCODE_NOTIFICATION_TOKEN']) process.env[key] = env.get(key);
  process.env.TERM_PROGRAM = 'vscode';
  t.after(() => {
    for (const key of ['OPENCODE_NOTIFICATION_URL', 'OPENCODE_NOTIFICATION_TOKEN', 'TERM_PROGRAM']) {
      if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
    }
  });
  const { OpenCodeNotifications } = await import(pathToFileURL(path.resolve(__dirname, '../extensions/bridge/plugin/opencode-notifications.mjs')).href);
  const hooks = await OpenCodeNotifications({ client: { session: { get: async ({ path: { id } }) => ({
    data: { parentID: { child: 'plugin-root', nested: 'child' }[id] },
  }) } } });
  t.after(() => hooks.event({ event: { type: 'server.instance.disposed' } }));
  const pluginSend = (type, sessionID, extra = {}) => hooks.event({ event: { type, properties: { sessionID, ...extra } } });
  settings.set('completion.enabled', true);
  await pluginSend('session.status', 'plugin-root', { status: { type: 'busy' } });
  count = played.length;
  let popups = information.length;
  for (const sessionID of ['plugin-root', 'child', 'nested']) {
    for (const type of ['question.asked', 'permission.asked']) {
      await pluginSend(type, sessionID, { id: 'same' });
      await pluginSend(type, sessionID, { id: 'same' });
    }
  }
  await pluginSend('session.idle', 'plugin-root');
  await pluginSend('session.idle', 'child');
  await flush();
  await remoteTick();
  assert.equal(played.length, count + 6);
  assert.equal(information.length, popups + 6);
  assert.match(information.at(-1), /Waiting for input/);
  assert.match(item.text, /Waiting for input/);
  assert.match(titles.at(-1), /Waiting for input/);
  for (const sessionID of ['plugin-root', 'child', 'nested']) {
    await pluginSend('question.rejected', sessionID, { requestID: 'same' });
    await pluginSend('permission.replied', sessionID, { requestID: 'same' });
  }
  await flush();
  assert.match(item.text, /Working/);
  await pluginSend('session.idle', 'plugin-root');
  await flush();
  assert.equal(played.length, count + 7);
  assert.equal(played.at(-1), '/local/custom completion.wav');

  for (const knob of ['focus', 'soundsEnabled', 'attention.enabled', 'showNotifications']) {
    commonVSCode.window.state.focused = knob === 'focus';
    settings.set('soundsEnabled', knob !== 'soundsEnabled');
    settings.set('attention.enabled', knob !== 'attention.enabled');
    settings.set('showNotifications', knob !== 'showNotifications');
    count = played.length;
    popups = information.length;
    await pluginSend('permission.asked', 'nested', { id: knob });
    await flush();
    assert.equal(played.length, count + (['focus', 'showNotifications'].includes(knob) ? 1 : 0), `${knob}: attention audio setting respected`);
    assert.equal(information.length, popups + (knob === 'showNotifications' ? 0 : 1), `${knob}: popups independent`);
    assert.match(item.text, /Waiting for input/);
    await pluginSend('permission.replied', 'nested', { requestID: knob });
  }
  commonVSCode.window.state.focused = false;
  settings.set('showNotifications', true);
  const poll = commands.get('opencodeNotificationBridge.poll');
  commands.delete('opencodeNotificationBridge.poll');
  await flush();
  assert.match(item.text, /Disconnected/);
  count = played.length;
  popups = information.length;
  await pluginSend('question.asked', 'child', { id: 'disconnected' });
  commands.set('opencodeNotificationBridge.poll', poll);
  await flush();
  assert.equal(played.length, count, 'reconnection does not replay child attention audio');
  assert.equal(information.length, popups, 'reconnection does not replay child popups');
  assert.match(item.text, /Waiting for input/);
  await pluginSend('session.error', 'child', { error: { name: 'APIError' } });
  await flush();
  assert.equal(played.length, count);
  assert.deepEqual(warnings, [], 'child failure cleanup stays silent');
  assert.doesNotMatch(item.text, /Waiting for input/);
});
}
