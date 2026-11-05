import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { coreProvisionInput, coreStateSchema, handoffNonce, verifyHandoff, verifyRequest, type CoreState, type HandoffClaims } from './contract-oracle';

/*
 * A fake Buzzify Retail: a real HTTP server on a random local port that answers Studio the way Retails' own routes do
 * (src/app/api/core/v1/{provision,state,handoff/*} on core-link-a). Every signed call is checked with the oracle
 * (Retails' verifyRequest, coreProvisionInput, coreStateSchema), and every handoff token with Retails' verifyHandoff and
 * its nonce rule. It keeps state like Retails: a snapshot whose version is not above the one it has is ignored
 * ({applied:false}), and a state push for a business it never provisioned is a 404. A helper, not a test.
 */

export interface Received {
  method: string;
  /** Pathname plus the raw query, as signed. */
  path: string;
  body: string;
  status: number;
  /** Why the fake refused it (signature, schema), or null when it was accepted or the fake was down. */
  refused: string | null;
}

export interface FakeBusiness {
  businessId: string;
  version: number;
  state: CoreState;
  provisionedWith: unknown;
}

export interface FakeRetails {
  /** `http://127.0.0.1:<port>`: what RETAIL_URL and Retails' APP_URL are set to. */
  readonly origin: string;
  readonly callbackUrl: string;
  /** Every request in order (the handoff routes included). */
  readonly received: Received[];
  /** The signed sync calls only (provision and state). */
  sync(): Received[];
  /** Businesses by coreBusinessId. */
  readonly businesses: Map<string, FakeBusiness>;
  /** Tokens the callback accepted, in order. */
  readonly signIns: HandoffClaims[];
  /** While true every request is answered 503 (Retails down behind its proxy) and nothing is kept. */
  down: boolean;
  /** What a reconciliation read reports for this month's AI use (half units). */
  aiHalfUnits: number;
  close(): Promise<void>;
}

const STATE_COOKIE = 'rt_core_handoff';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function headersOf(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) for (const v of value) headers.append(name, v);
  }
  return headers;
}

export async function startFakeRetails(opts: { syncSecret: string; handoffSecret: string; studioOrigin: string }): Promise<FakeRetails> {
  const received: Received[] = [];
  const businesses = new Map<string, FakeBusiness>();
  const signIns: HandoffClaims[] = [];
  const pendingStates = new Set<string>();
  let seq = 0;

  const fake = {
    origin: '',
    callbackUrl: '',
    received,
    businesses,
    signIns,
    down: false,
    aiHalfUnits: 6,
    sync: () => received.filter((r) => r.path.startsWith('/api/core/v1/provision') || r.path.startsWith('/api/core/v1/state')),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  } as FakeRetails & { origin: string; callbackUrl: string };

  /** Retails' applyCoreState: only a newer version replaces what it has. */
  const apply = (business: FakeBusiness, state: CoreState): boolean => {
    if (state.version <= business.version) return false;
    business.version = state.version;
    business.state = state;
    return true;
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = req.url ?? '/';
    const url = new URL(path, fake.origin);
    const method = req.method ?? 'GET';
    const body = await readBody(req);
    const entry: Received = { method, path, body, status: 0, refused: null };
    received.push(entry);

    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      entry.status = status;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
      res.end(payload === undefined ? '' : JSON.stringify(payload));
    };
    const redirect = (location: string, headers: Record<string, string> = {}) => {
      entry.status = 302;
      res.writeHead(302, { location, 'cache-control': 'no-store', ...headers });
      res.end();
    };
    const refuse = (status: number, code: string) => {
      entry.refused = code;
      send(status, { ok: false, code });
    };

    if (fake.down) return send(503, { ok: false, code: 'UNAVAILABLE' });

    // ---- the browser side of the handoff (Retails' startHandoff / callback) ----
    if (method === 'GET' && url.pathname === '/api/core/v1/handoff/start') {
      const state = randomBytes(32).toString('base64url');
      pendingStates.add(state);
      const target = new URL(`${opts.studioOrigin}/api/retail/v1/handoff`);
      target.searchParams.set('return', fake.callbackUrl);
      target.searchParams.set('state', state);
      target.searchParams.set('nonce', handoffNonce(state));
      return redirect(target.toString(), { 'set-cookie': `${STATE_COOKIE}=${state}; Path=/api/core/v1/handoff; HttpOnly; SameSite=Lax` });
    }
    if (method === 'GET' && url.pathname === '/api/core/v1/handoff/callback') {
      const cookieState = /(?:^|;\s*)rt_core_handoff=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      const state = url.searchParams.get('state');
      const token = url.searchParams.get('token') ?? '';
      if (!cookieState || cookieState !== state || !pendingStates.delete(cookieState)) return refuse(400, 'STATE');
      const verdict = verifyHandoff(token, [opts.handoffSecret]);
      if (!verdict.ok) return refuse(401, `TOKEN_${verdict.reason}`);
      if (verdict.claims.nonce !== handoffNonce(cookieState)) return refuse(401, 'NONCE');
      signIns.push(verdict.claims);
      return redirect('/retail/home');
    }

    // ---- the signed sync calls ----
    const verdict = verifyRequest({ method, path, body, headers: headersOf(req) }, [opts.syncSecret]);
    if (!verdict.ok) return refuse(401, `UNAUTHORIZED_${verdict.reason}`);

    if (method === 'POST' && url.pathname === '/api/core/v1/provision') {
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        return refuse(400, 'INVALID_INPUT');
      }
      const parsed = coreProvisionInput.safeParse(raw);
      if (!parsed.success) return refuse(400, 'INVALID_INPUT');
      const existing = businesses.get(parsed.data.coreBusinessId);
      if (existing) {
        apply(existing, parsed.data.state);
        return send(200, { businessId: existing.businessId });
      }
      seq += 1;
      const business: FakeBusiness = { businessId: `rtb_${seq}`, version: parsed.data.state.version, state: parsed.data.state, provisionedWith: raw };
      businesses.set(parsed.data.coreBusinessId, business);
      return send(200, { businessId: business.businessId });
    }
    if (method === 'POST' && url.pathname === '/api/core/v1/state') {
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        return refuse(400, 'INVALID_INPUT');
      }
      const parsed = coreStateSchema.safeParse(raw);
      if (!parsed.success) return refuse(400, 'INVALID_INPUT');
      const business = businesses.get(parsed.data.coreBusinessId);
      if (!business) return send(404, { ok: false, code: 'NOT_FOUND' });
      const applied = apply(business, parsed.data);
      return send(200, { applied, version: business.version });
    }
    if (method === 'GET' && url.pathname === '/api/core/v1/state') {
      const id = url.searchParams.get('coreBusinessId')?.trim() ?? '';
      if (id.length === 0 || id.length > 128) return refuse(400, 'INVALID_INPUT');
      const business = businesses.get(id);
      if (!business) return send(404, { ok: false, code: 'NOT_FOUND' });
      return send(200, { version: business.version, status: business.state.status, aiUsageMonth: { month: '2026-11', units: fake.aiHalfUnits } });
    }
    return send(404, { ok: false, code: 'NOT_FOUND' });
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  fake.origin = `http://127.0.0.1:${port}`;
  fake.callbackUrl = `${fake.origin}/api/core/v1/handoff/callback`;
  return fake;
}
