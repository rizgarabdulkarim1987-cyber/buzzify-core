import { retailConfig } from '@/server/retail/config';
import { signRetailRequest } from '@/server/retail/signing';
import type { ProvisionBody, RetailState } from '@/server/retail/snapshot';

/**
 * Studio -> Retails calls (Retails' `/api/core/v1/provision` and `/api/core/v1/state`), signed with RETAIL_SYNC_SECRET.
 * Each has a 5 s timeout, refuses redirects and is never cached. An answer is sorted into what the sender does next:
 *
 * - `ok` (2xx): the parsed JSON body (null when it is not JSON);
 * - `notFound` (404): Retails has no such business;
 * - `permanent` (400, 413, 422): sending the same again cannot succeed; a 422 carries Retails' rule code;
 * - `retry` (401, 429, 5xx, any other status, a timeout or a network error): it may succeed later.
 *
 * An error body is never read, except a 422's `code`, and nothing here logs. A missing or invalid setting throws
 * `RetailConfigError` (it names the variable only).
 */

export type RetailAnswer = { kind: 'ok'; body: unknown } | { kind: 'notFound' } | { kind: 'permanent'; code: string } | { kind: 'retry'; code: string };

export interface RetailClient {
  provision(body: ProvisionBody): Promise<RetailAnswer>;
  pushState(state: RetailState): Promise<RetailAnswer>;
  readState(coreBusinessId: string): Promise<RetailAnswer>;
}

export const RETAIL_REQUEST_TIMEOUT_MS = 5_000;

const PERMANENT = new Set([400, 413, 422]);
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Retails' rule code from a 422 (`{ ok: false, code }`), or HTTP_422 when it has none we can trust. */
async function ruleCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { code?: unknown } | null;
    return typeof body?.code === 'string' && CODE.test(body.code) ? body.code : 'HTTP_422';
  } catch {
    return 'HTTP_422';
  }
}

async function signedCall(method: 'GET' | 'POST', pathWithQuery: string, payload?: unknown): Promise<RetailAnswer> {
  const config = retailConfig();
  const url = `${config.baseUrl}${pathWithQuery}`;
  const body = payload === undefined ? '' : JSON.stringify(payload);
  // The signed path is what the server will read: the pathname plus the query exactly as sent.
  const target = new URL(url);
  const headers: Record<string, string> = {
    ...signRetailRequest(method, target.pathname + target.search, body, config.syncSecret),
    accept: 'application/json',
  };
  if (payload !== undefined) headers['content-type'] = 'application/json';

  const signal = AbortSignal.timeout(RETAIL_REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload === undefined ? undefined : body, signal, cache: 'no-store', redirect: 'error' });
  } catch {
    return { kind: 'retry', code: signal.aborted ? 'TIMEOUT' : 'NETWORK' };
  }

  if (res.ok) {
    try {
      return { kind: 'ok', body: await res.json() };
    } catch {
      return signal.aborted ? { kind: 'retry', code: 'TIMEOUT' } : { kind: 'ok', body: null };
    }
  }
  if (res.status === 422) return { kind: 'permanent', code: await ruleCode(res) };
  await res.body?.cancel().catch(() => undefined);
  if (res.status === 404) return { kind: 'notFound' };
  const code = `HTTP_${res.status}`;
  return PERMANENT.has(res.status) ? { kind: 'permanent', code } : { kind: 'retry', code };
}

export function createHttpRetailClient(): RetailClient {
  return {
    provision: (body) => signedCall('POST', '/api/core/v1/provision', body),
    pushState: (state) => signedCall('POST', '/api/core/v1/state', state),
    readState: (coreBusinessId) => signedCall('GET', `/api/core/v1/state?coreBusinessId=${encodeURIComponent(coreBusinessId)}`),
  };
}
