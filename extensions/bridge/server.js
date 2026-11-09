const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');

/** @typedef {{instanceID: string, ancestors: number[], type: string, sessionID?: string, sessionPath?: string[], status?: string, requestID?: string, errorName?: string}} BridgeEvent */
/** @param {unknown} value @returns {value is BridgeEvent} */
function isEvent(value) {
  if (!value || typeof value !== 'object') return false;
  const e = /** @type {Record<string, unknown>} */ (value);
  return typeof e.instanceID === 'string' && e.instanceID.length <= 100 &&
    Array.isArray(e.ancestors) && e.ancestors.length <= 64 &&
    e.ancestors.every(n => Number.isSafeInteger(n) && n > 0) &&
    typeof e.type === 'string' && e.type.length < 100 &&
    (e.sessionID === undefined || (typeof e.sessionID === 'string' && e.sessionID.length < 200)) &&
    (e.sessionPath === undefined || (Array.isArray(e.sessionPath) && e.sessionPath.length > 0 && e.sessionPath.length <= 64 &&
      e.sessionPath.every(id => typeof id === 'string' && id.length > 0 && id.length < 200) &&
      new Set(e.sessionPath).size === e.sessionPath.length && e.sessionPath.at(-1) === e.sessionID)) &&
    (e.requestID === undefined || (typeof e.requestID === 'string' && e.requestID.length < 200)) &&
    (e.errorName === undefined || (typeof e.errorName === 'string' && e.errorName.length < 100)) &&
    (e.status === undefined || ['busy', 'retry', 'idle'].includes(String(e.status)));
}

/** @param {(event: BridgeEvent) => Promise<void>} receive */
async function startServer(receive) {
  const token = randomBytes(32).toString('hex');
  const server = http.createServer((req, res) => {
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(404).end();
      return;
    }
    let size = 0;
    const chunks = /** @type {Buffer[]} */ ([]);
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 16384) req.destroy();
      else chunks.push(chunk);
    });
    req.on('end', async () => {
      try {
        const event = JSON.parse(Buffer.concat(chunks).toString());
        if (!isEvent(event)) { res.writeHead(400).end(); return; }
        await receive(event);
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
    req.on('error', () => {});
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { server, token, url: `http://127.0.0.1:${address.port}/event` };
}

module.exports = { startServer, isEvent };
