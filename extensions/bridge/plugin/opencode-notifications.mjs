import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// No dependency installation is needed: OpenCode loads this as a local plugin.
export const OpenCodeNotifications = async ({ client }) => {
  const url = process.env.OPENCODE_NOTIFICATION_URL;
  const token = process.env.OPENCODE_NOTIFICATION_TOKEN;
  if (!url || !token || process.env.TERM_PROGRAM !== 'vscode') return {};
  const instanceID = randomUUID();
  const ancestors = [];
  let pid = process.pid;
  for (let depth = 0; pid > 1 && depth < 64; depth++) {
    ancestors.push(pid);
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    } catch { break; }
  }
  const parents = new Map();
  // Preserve the source and its full ownership chain for input and subtree cleanup.
  // Failed lookups are not cached: retry on the next event rather than guessing a root.
  const sessionPath = async (sessionID) => {
    const path = [];
    let id = sessionID;
    while (id && path.length < 64) {
      if (path.includes(id)) return;
      path.unshift(id);
      if (!parents.has(id)) {
        try {
          const result = await client.session.get({ path: { id } });
          if (!result.data) return;
          parents.set(id, result.data.parentID || undefined);
        } catch { return; }
      }
      id = parents.get(id);
    }
    if (!id) return path;
  };
  const send = async (event) => {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...event, instanceID, ancestors }),
        signal: AbortSignal.timeout(1500),
      });
    } catch { /* Notifications must never interrupt an OpenCode prompt. */ }
  };
  await send({ type: 'heartbeat' });
  const heartbeat = setInterval(() => { void send({ type: 'heartbeat' }); }, 5000);
  heartbeat.unref();
  const supported = new Set([
    'session.status', 'session.idle', 'session.error', 'session.deleted',
    'question.asked', 'question.replied', 'question.rejected',
    'permission.asked', 'permission.replied',
  ]);
  let pending = Promise.resolve();
  return {
    event: async ({ event }) => {
      pending = pending.then(async () => {
        if (event.type === 'server.instance.disposed') { clearInterval(heartbeat); return; }
        if (!supported.has(event.type)) return;
        const properties = event.properties || {};
        const sessionID = properties.sessionID || properties.info?.id;
        if (!sessionID) return;
        const path = await sessionPath(sessionID);
        if (!path) return;
        // Child activity/completion stays silent; errors/deletion only clean input.
        if (path.length > 1 && ['session.status', 'session.idle'].includes(event.type)) return;
        await send({
          type: event.type,
          sessionID,
          sessionPath: path,
          status: properties.status?.type,
          requestID: properties.requestID || properties.id,
          errorName: event.type === 'session.error' ? properties.error?.name : undefined,
        });
        // Keep immutable ancestry after deletion so late descendant cleanup/replies
        // do not require looking up a parent that no longer exists.
      });
      await pending;
    },
  };
};
