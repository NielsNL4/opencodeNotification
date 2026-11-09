const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SessionTracker } = require('../extensions/bridge/state');

test('completion requires a busy transition and duplicate idle events are silent', () => {
  const tracker = new SessionTracker();
  const send = (type, extra = {}) => tracker.apply({ type, sessionID: 'root', ...extra });
  assert.equal(send('session.idle').sound, undefined);
  assert.equal(send('session.status', { status: 'busy' }).status, 'Working');
  assert.equal(send('session.status', { status: 'retry' }).sound, undefined);
  assert.equal(send('session.status', { status: 'idle' }).sound, 'completion');
  assert.equal(send('session.idle').sound, undefined);
  assert.equal(tracker.status(), 'Completed');
});

test('descendant cleanup isolates source, kind, siblings and roots without completion', () => {
  for (const cleanup of ['session.deleted', 'session.error']) {
    const tracker = new SessionTracker();
    const send = (type, sessionPath, extra = {}) => tracker.apply({ type, sessionPath, sessionID: sessionPath.at(-1), requestID: 'id', ...extra });
    send('session.status', ['root'], { status: 'busy' });
    for (const path of [['root'], ['root', 'a'], ['root', 'a', 'nested'], ['root', 'b'], ['other']]) {
      assert.equal(send('question.asked', path).sound, 'attention');
      assert.equal(send('permission.asked', path).sound, 'attention');
      assert.equal(send('question.asked', path), undefined);
    }
    send('question.replied', ['root', 'a']);
    assert.equal(tracker.sessions.get('root').pending.size, 7);
    assert.equal(send(cleanup, ['root', 'a']).sound, undefined);
    assert.equal(tracker.sessions.get('root').pending.size, 4, 'only a and its descendants cleaned');
    send('permission.replied', ['root', 'a']);
    assert.equal(tracker.sessions.get('root').pending.size, 4, 'late reply cannot clear siblings');
    assert.equal(send('session.idle', ['root']), undefined);
    send('session.error', ['root'], { errorName: 'MessageAbortedError' });
    assert.equal(tracker.sessions.get('root').pending.size, 0);
    assert.equal(tracker.status(), 'Waiting for input', 'other root stays waiting');
    send('session.deleted', ['other']);
    assert.equal(tracker.status(), 'Ready');
    assert.equal(send('session.idle', ['root']).sound, undefined);
  }
});

test('late child cleanup and replies cannot change a finished or deleted root', () => {
  const tracker = new SessionTracker();
  tracker.apply({ type: 'session.status', sessionID: 'root', status: 'busy' });
  tracker.apply({ type: 'session.idle', sessionID: 'root' });
  const lateEvents = ['session.error', 'session.deleted', 'permission.replied', 'question.rejected'];
  for (const type of lateEvents) {
    assert.equal(tracker.apply({ type, sessionID: 'child', sessionPath: ['root', 'child'], requestID: 'late' }), undefined);
    assert.equal(tracker.status(), 'Completed');
  }
  tracker.apply({ type: 'session.deleted', sessionID: 'root' });
  for (const type of lateEvents) tracker.apply({ type, sessionID: 'child', sessionPath: ['root', 'child'] });
  assert.equal(tracker.sessions.size, 0);
});

test('questions and permissions wait independently and each request sounds once', () => {
  const tracker = new SessionTracker();
  const send = (type, requestID, extra = {}) => tracker.apply({ type, sessionID: 'root', requestID, ...extra });
  send('session.status', undefined, { status: 'busy' });
  assert.equal(send('question.asked', 'q1').sound, 'attention');
  assert.equal(send('question.asked', 'q1'), undefined);
  assert.equal(send('permission.asked', 'p1').sound, 'attention');
  assert.equal(send('session.idle'), undefined);
  assert.equal(send('session.status', undefined, { status: 'busy' }).status, 'Waiting for input');
  assert.equal(send('question.replied', 'q1').status, 'Waiting for input');
  assert.equal(send('permission.replied', 'p1').status, 'Working');
  assert.equal(send('question.asked', 'q1'), undefined);
  assert.equal(send('session.idle').sound, 'completion');
});

test('failure does not play completion; a subsequent prompt can succeed', () => {
  const tracker = new SessionTracker();
  const send = (type, extra = {}) => tracker.apply({ type, sessionID: 'root', ...extra });
  send('session.status', { status: 'busy' });
  assert.equal(send('session.error').sound, 'error');
  assert.equal(send('session.error').sound, undefined);
  assert.equal(send('session.idle'), undefined);
  assert.equal(tracker.status(), 'Error');
  send('session.status', { status: 'busy' });
  assert.equal(send('session.idle').sound, 'completion');
});

test('one completed session cannot hide another working or waiting session', () => {
  const tracker = new SessionTracker();
  tracker.apply({ type: 'session.status', sessionID: 'a', status: 'busy' });
  tracker.apply({ type: 'session.status', sessionID: 'b', status: 'busy' });
  tracker.apply({ type: 'session.idle', sessionID: 'a' });
  assert.equal(tracker.status(), 'Working');
  tracker.apply({ type: 'question.asked', sessionID: 'b', requestID: 'q' });
  assert.equal(tracker.status(), 'Waiting for input');
  tracker.apply({ type: 'session.deleted', sessionID: 'b' });
  assert.equal(tracker.status(), 'Completed');
});

test('interruption clears pending input and stays Ready through idle until a new prompt', () => {
  const tracker = new SessionTracker();
  const send = (type, extra = {}) => tracker.apply({ type, sessionID: 'root', ...extra });
  send('session.status', { status: 'busy' });
  send('question.asked', { requestID: 'q' });
  assert.deepEqual(send('session.error', { errorName: 'MessageAbortedError' }), { status: 'Ready', sound: undefined });
  assert.deepEqual(send('session.idle'), { status: 'Ready', sound: undefined });
  assert.equal(send('session.status', { status: 'idle' }).sound, undefined);
  assert.equal(tracker.status(), 'Ready');
  send('session.status', { status: 'busy' });
  assert.equal(send('session.idle').sound, 'completion');
});
