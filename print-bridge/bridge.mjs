// The Buzzify print bridge: a web page cannot open a raw printer connection, so this small program on the till PC does.
// It takes ESC/POS bytes from the till's page and forwards them to a network printer (port 9100) or a printer shared in
// Windows. It uses only Node's own modules.
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { pathToFileURL } from 'node:url';

const MAX_BODY = 8 * 1024 * 1024;

/** Mirrors src/server/domain/pos/bridge-protocol.ts. */
export function parseTarget(target) {
  const tcp = /^tcp:\/\/([^\s/:]+):(\d{1,5})$/.exec(target);
  if (tcp) return { transport: 'NETWORK', host: tcp[1], port: Number(tcp[2]) };
  const file = /^file:\/\/(.+)$/.exec(target);
  if (file) return { transport: 'FILE', path: file[1] };
  throw new Error('bad target');
}

/** Mirrors printerAddressAllowed in src/server/domain/pos/bridge-protocol.ts: a target must be a printer, never any file or host. */
export function targetAllowed(target, extraPorts = []) {
  const parsed = parseTarget(target);
  if (parsed.transport === 'FILE') return /^\\\\(?:localhost|127\.0\.0\.1)\\[A-Za-z0-9 _-]+(?:\.[A-Za-z0-9 _-]+)*$/.test(parsed.path) && parsed.path.length <= 100;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(parsed.host);
  if (!match) return false;
  const [a, b, c, d] = match.slice(1).map(Number);
  if ([a, b, c, d].some((part) => part > 255)) return false;
  const privateRange = a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  return privateRange && ((parsed.port >= 9100 && parsed.port <= 9109) || extraPorts.includes(parsed.port));
}

export async function defaultSend(target, bytes) {
  const parsed = parseTarget(target);
  if (parsed.transport === 'FILE') {
    await writeFile(parsed.path, bytes);
    return;
  }
  await new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.setTimeout(5000, () => socket.destroy(new Error('printer timed out')));
    socket.once('error', reject);
    socket.connect(parsed.port, parsed.host, () => socket.end(Buffer.from(bytes), resolve));
  });
}

export function startBridge({ port = 9101, allowedOrigins = [], send = defaultSend, extraPorts = [] } = {}) {
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = typeof origin === 'string' && allowedOrigins.includes(origin);
    const reply = (status, body) => {
      const headers = { 'content-type': 'application/json' };
      if (allowed) {
        headers['access-control-allow-origin'] = origin;
        headers['access-control-allow-methods'] = 'POST, GET, OPTIONS';
        headers['access-control-allow-headers'] = 'content-type';
        headers['vary'] = 'origin';
      }
      res.writeHead(status, headers);
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return reply(allowed ? 204 : 403);
    if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true });
    if (req.method !== 'POST' || req.url !== '/print') return reply(404, { ok: false, error: 'not found' });
    if (!allowed) return reply(403, { ok: false, error: 'origin not allowed' });
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) return reply(413, { ok: false, error: 'too large' });
      chunks.push(chunk);
    }
    let job;
    try {
      job = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!targetAllowed(job.target, extraPorts)) throw new Error('target is not a printer');
      if (typeof job.dataBase64 !== 'string') throw new Error('bad data');
    } catch {
      return reply(400, { ok: false, error: 'bad request' });
    }
    try {
      await send(job.target, new Uint8Array(Buffer.from(job.dataBase64, 'base64')));
      return reply(200, { ok: true });
    } catch (error) {
      return reply(502, { ok: false, error: error instanceof Error ? error.message : 'print failed' });
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const origins = [];
  const extraPorts = [];
  let port = 9101;
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--origin') origins.push(process.argv[++i]);
    else if (process.argv[i] === '--port') port = Number(process.argv[++i]);
    else if (process.argv[i] === '--printer-port') extraPorts.push(Number(process.argv[++i]));
  }
  if (origins.length === 0) {
    console.error('Usage: node bridge.mjs --origin https://your-till-address [--port 9101]');
    process.exit(1);
  }
  const running = await startBridge({ port, allowedOrigins: origins, extraPorts });
  console.log(`Buzzify print bridge listening on http://127.0.0.1:${running.port} for ${origins.join(', ')}`);
}
