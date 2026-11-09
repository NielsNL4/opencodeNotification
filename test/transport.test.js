const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { startServer } = require('../extensions/bridge/server');
const { SessionTracker } = require('../extensions/bridge/state');

test('loopback transport authenticates and validates requests before delivering them', async t => {
  const received = [];
  const bridge = await startServer(async event => { received.push(event); });
  t.after(() => { bridge.server.close(); bridge.server.closeAllConnections(); });
  const post = (body, token = bridge.token) => fetch(bridge.url, {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  const valid = { instanceID: 'instance', ancestors: [process.pid], type: 'heartbeat' };
  assert.equal((await post(valid, 'wrong')).status, 401);
  assert.equal((await post({ ...valid, ancestors: ['not a pid'] })).status, 400);
  for (const sessionPath of [[], ['other'], ['root', 'root'], [1], Array(65).fill('root')]) {
    assert.equal((await post({ ...valid, sessionID: 'root', sessionPath })).status, 400);
  }
  assert.equal((await post(valid)).status, 204);
  assert.deepEqual(received, [valid]);
});

test('real plugin delivers ordered root-session events and silences child activity', async t => {
  const received = [];
  const tracker = new SessionTracker();
  const sounds = [];
  const bridge = await startServer(async event => {
    received.push(event);
    if (event.sessionID) {
      const result = tracker.apply(event);
      if (result?.sound) sounds.push(result.sound);
    }
  });
  t.after(() => { bridge.server.close(); bridge.server.closeAllConnections(); });
  const old = { ...process.env };
  Object.assign(process.env, { OPENCODE_NOTIFICATION_URL: bridge.url, OPENCODE_NOTIFICATION_TOKEN: bridge.token, TERM_PROGRAM: 'vscode' });
  t.after(() => {
    for (const key of ['OPENCODE_NOTIFICATION_URL', 'OPENCODE_NOTIFICATION_TOKEN', 'TERM_PROGRAM']) {
      if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
    }
  });
  const { OpenCodeNotifications } = await import(pathToFileURL(path.resolve(__dirname, '../extensions/bridge/plugin/opencode-notifications.mjs')).href);
  const calls = [];
  const hooks = await OpenCodeNotifications({ client: { session: { get: async ({ path: { id } }) => {
    calls.push(id);
    return { data: { id, parentID: id === 'child' ? 'root' : undefined } };
  } } } });
  t.after(() => hooks.event({ event: { type: 'server.instance.disposed' } }));
  const send = (type, properties) => hooks.event({ event: { type, properties } });
  await Promise.all([
    send('session.status', { sessionID: 'root', status: { type: 'busy' } }),
    send('session.status', { sessionID: 'child', status: { type: 'busy' } }),
    send('session.idle', { sessionID: 'child' }),
    send('question.asked', { sessionID: 'root', id: 'question' }),
    send('session.idle', { sessionID: 'root' }),
    send('question.replied', { sessionID: 'root', requestID: 'question' }),
    send('permission.asked', { sessionID: 'root', id: 'permission' }),
    send('permission.replied', { sessionID: 'root', requestID: 'permission' }),
    send('session.status', { sessionID: 'root', status: { type: 'idle' } }),
    send('session.idle', { sessionID: 'root' }),
  ]);
  assert.deepEqual(sounds, ['attention', 'attention', 'completion']);
  assert.equal(tracker.status(), 'Completed');
  assert.equal(received.some(e => e.sessionID === 'child'), false);
  assert.deepEqual(calls, ['root', 'child']);
  assert.equal(received[0].ancestors.includes(process.pid), true);
  await send('session.status', { sessionID: 'root', status: { type: 'busy' } });
  await send('session.error', { sessionID: 'root', error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } });
  await send('session.idle', { sessionID: 'root' });
  assert.equal(received.at(-2).errorName, 'MessageAbortedError');
  assert.equal(tracker.status(), 'Ready');
  assert.deepEqual(sounds, ['attention', 'attention', 'completion']);
  await send('session.status', { sessionID: 'root', status: { type: 'busy' } });
  await send('session.error', { sessionID: 'root', error: { name: 'APIError' } });
  assert.equal(tracker.status(), 'Error');
  assert.equal(sounds.at(-1), 'error');
});

test('real plugin routes nested input, retries lookup failures, and cleans deleted subtrees silently', async t => {
  const tracker = new SessionTracker();
  const sounds = [];
  const received = [];
  const bridge = await startServer(async event => {
    received.push(event);
    if (event.sessionID) {
      const result = tracker.apply(event);
      if (result?.sound) sounds.push(result.sound);
    }
  });
  t.after(() => { bridge.server.close(); bridge.server.closeAllConnections(); });
  const old = { ...process.env };
  Object.assign(process.env, { OPENCODE_NOTIFICATION_URL: bridge.url, OPENCODE_NOTIFICATION_TOKEN: bridge.token, TERM_PROGRAM: 'vscode' });
  t.after(() => {
    for (const key of ['OPENCODE_NOTIFICATION_URL', 'OPENCODE_NOTIFICATION_TOKEN', 'TERM_PROGRAM']) {
      if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
    }
  });
  const { OpenCodeNotifications } = await import(pathToFileURL(path.resolve(__dirname, '../extensions/bridge/plugin/opencode-notifications.mjs')).href);
  let fail = true;
  const hooks = await OpenCodeNotifications({ client: { session: { get: async ({ path: { id } }) => {
    if (id === 'child' && fail) { fail = false; throw new Error('temporary'); }
    return { data: { parentID: { nested: 'child', child: 'root', sibling: 'root', cycle: 'cycle' }[id] } };
  } } } });
  t.after(() => hooks.event({ event: { type: 'server.instance.disposed' } }));
  const send = (type, sessionID, extra = {}) => hooks.event({ event: { type, properties: { sessionID, ...extra } } });
  await send('session.status', 'root', { status: { type: 'busy' } });
  await send('permission.asked', 'nested', { id: 'same' });
  assert.deepEqual(sounds, [], 'failed ancestor lookup must not guess a root');
  for (const sessionID of ['root', 'child', 'nested', 'sibling']) {
    for (const type of ['question.asked', 'permission.asked']) {
      await send(type, sessionID, { id: 'same' });
      await send(type, sessionID, { id: 'same' });
    }
  }
  assert.deepEqual(sounds, Array(8).fill('attention'));
  assert.deepEqual(received.find(e => e.sessionID === 'nested').sessionPath, ['root', 'child', 'nested']);
  await send('session.idle', 'root');
  await send('session.idle', 'nested');
  await send('session.status', 'child', { status: { type: 'busy' } });
  await send('session.error', 'child', { error: { name: 'APIError' } });
  assert.equal(tracker.status(), 'Waiting for input');
  await send('question.replied', 'sibling', { requestID: 'same' });
  await send('permission.replied', 'sibling', { requestID: 'same' });
  assert.equal(tracker.status(), 'Waiting for input', 'root requests remain');
  await send('session.deleted', 'child');
  await send('session.error', 'nested', { error: { name: 'MessageAbortedError' } });
  await send('question.rejected', 'root', { requestID: 'same' });
  await send('permission.replied', 'root', { requestID: 'same' });
  assert.equal(tracker.status(), 'Working');
  assert.equal(sounds.length, 8, 'cleanup and child lifecycle emit no notices');
  await send('session.idle', 'root');
  assert.equal(sounds.at(-1), 'completion');
  const count = received.length;
  await send('question.asked', 'cycle', { id: 'q' });
  assert.equal(received.length, count, 'invalid ancestry is not delivered');
});

test('plugin does nothing outside a connected VS Code terminal', async t => {
  const previous = process.env.TERM_PROGRAM;
  delete process.env.TERM_PROGRAM;
  t.after(() => { if (previous !== undefined) process.env.TERM_PROGRAM = previous; });
  const { OpenCodeNotifications } = await import(pathToFileURL(path.resolve(__dirname, '../extensions/bridge/plugin/opencode-notifications.mjs')).href);
  assert.deepEqual(await OpenCodeNotifications({ client: {} }), {});
});
