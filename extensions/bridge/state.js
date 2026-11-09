// Session state is independent of the transport and VS Code UI.
/** @typedef {{ status: string, running: boolean, failed: boolean, pending: Map<string, string[]>, requests: Set<string> }} Session */
class SessionTracker {
  constructor() {
    /** @type {Map<string, Session>} */
    this.sessions = new Map();
  }

  /** @param {{type: string, sessionID: string, sessionPath?: string[], status?: string, requestID?: string, errorName?: string}} event */
  apply(event) {
    const path = event.sessionPath || [event.sessionID];
    const rootID = path[0];
    const child = rootID !== event.sessionID;
    if (child && ['session.status', 'session.idle'].includes(event.type)) return;
    let session = this.sessions.get(rootID);
    if (!session) {
      if (child && !['question.asked', 'permission.asked'].includes(event.type)) return;
      session = { status: 'Ready', running: false, failed: false, pending: new Map(), requests: new Set() };
      this.sessions.set(rootID, session);
    }
    const activeStatus = () => session.pending.size ? 'Waiting for input' : session.running ? 'Working' : session.failed ? 'Error' : 'Ready';
    if (child && ['session.error', 'session.deleted'].includes(event.type)) {
      const before = session.pending.size;
      for (const [key, sourcePath] of session.pending) {
        if (sourcePath.includes(event.sessionID)) session.pending.delete(key);
      }
      if (before === session.pending.size) return;
      session.status = activeStatus();
      return { status: session.status, sound: undefined };
    }
    /** @type {'completion' | 'attention' | 'error' | undefined} */
    let sound;
    if (event.type === 'session.status' && ['busy', 'retry'].includes(event.status || '')) {
      session.running = true;
      session.failed = false;
      session.status = session.pending.size ? 'Waiting for input' : 'Working';
    } else if (event.type === 'question.asked' || event.type === 'permission.asked') {
      const key = JSON.stringify([event.sessionID, event.type, event.requestID]);
      if (!event.requestID) return;
      if (session.requests.has(key)) return;
      session.requests.add(key);
      sound = 'attention';
      session.pending.set(key, path);
      session.status = 'Waiting for input';
    } else if (['question.replied', 'question.rejected', 'permission.replied'].includes(event.type)) {
      const type = event.type.startsWith('question.') ? 'question.asked' : 'permission.asked';
      const removed = session.pending.delete(JSON.stringify([event.sessionID, type, event.requestID]));
      if (child && !removed) return;
      session.status = activeStatus();
    } else if (event.type === 'session.error') {
      const interrupted = event.errorName === 'MessageAbortedError';
      sound = interrupted || session.failed ? undefined : 'error';
      session.failed = !interrupted;
      session.running = false;
      session.pending.clear();
      session.status = interrupted ? 'Ready' : 'Error';
    } else if (event.type === 'session.idle' || (event.type === 'session.status' && event.status === 'idle')) {
      if (session.pending.size || session.failed) return;
      if (session.running) {
        session.status = 'Completed';
        sound = 'completion';
      }
      session.running = false;
    } else if (event.type === 'session.deleted') {
      this.sessions.delete(event.sessionID);
      return;
    } else {
      return;
    }
    return { status: session.status, sound };
  }

  status() {
    const statuses = [...this.sessions.values()].map(session => session.status);
    return ['Waiting for input', 'Working', 'Error', 'Completed', 'Ready'].find(status => statuses.includes(status)) || 'Ready';
  }
}

module.exports = { SessionTracker };
