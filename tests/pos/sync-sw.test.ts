import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { indicatorState } from '@/lib/pos-sync/indicator';

type Handler = (event: Record<string, unknown>) => void;

/** Runs public/pos/sw.js against a stub worker scope with an in-memory Cache Storage. */
function boot(network: (url: string) => Promise<{ ok: boolean; body: string }>) {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, { body: string }>>();
  const fetched: string[] = [];
  const cacheOf = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    const key = (r: unknown) => new URL(typeof r === 'string' ? r : (r as { url: string }).url, 'https://till.test').pathname;
    return {
      match: async (r: unknown) => store.get(key(r)),
      put: async (r: unknown, v: { body: string }) => void store.set(key(r), v),
    };
  };
  const response = (r: { ok: boolean; body: string }) => ({ ok: r.ok, body: r.body, clone: () => response(r), text: async () => r.body });
  const scope = {
    location: { origin: 'https://till.test' },
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const context = {
    self: scope,
    URL,
    Promise,
    Set,
    caches: { open: async (n: string) => cacheOf(n), keys: async () => [...stores.keys()], delete: async (n: string) => stores.delete(n) },
    fetch: async (r: unknown) => {
      const url = new URL(typeof r === 'string' ? r : (r as { url: string }).url, 'https://till.test').pathname;
      fetched.push(url);
      return response(await network(url));
    },
  };
  runInNewContext(readFileSync(join(process.cwd(), 'public/pos/sw.js'), 'utf8'), context);
  const request = (path: string, init: { method?: string; mode?: string } = {}) => ({ url: `https://till.test${path}`, method: init.method ?? 'GET', mode: init.mode ?? 'no-cors' });
  const dispatch = async (path: string, init?: { method?: string; mode?: string }) => {
    let answer: Promise<unknown> | undefined;
    handlers.get('fetch')!({ request: request(path, init), respondWith: (p: Promise<unknown>) => (answer = p) });
    return answer === undefined ? 'passed' : await answer;
  };
  const install = async () => {
    let wait: Promise<unknown> = Promise.resolve();
    handlers.get('install')!({ waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
  };
  return { dispatch, install, fetched, stores };
}

const shellHtml = '<html><script src="/_next/static/chunks/app.js"></script><link href="/_next/static/css/a.css"></html>';

describe('the till service worker', () => {
  it('stores the shell and the scripts it names at install, and answers a failed /pos navigation with the shell', async () => {
    let online = true;
    const sw = boot(async (url) => {
      if (!online) throw new Error('offline');
      return { ok: true, body: url === '/pos/offline' ? shellHtml : 'asset' };
    });
    await sw.install();
    expect([...sw.stores.get('pos-sw-v1-shell')!.keys()]).toEqual(['/pos/offline']);
    expect([...sw.stores.get('pos-sw-v1-static')!.keys()].sort()).toEqual(['/_next/static/chunks/app.js', '/_next/static/css/a.css']);
    online = false;
    const page = (await sw.dispatch('/pos/tables', { mode: 'navigate' })) as { body: string };
    expect(page.body).toBe(shellHtml);
    const script = (await sw.dispatch('/_next/static/chunks/app.js')) as { body: string };
    expect(script.body).toBe('asset');
  });

  it('never touches an API call, a write, or a page outside /pos, and never stores another page', async () => {
    const sw = boot(async () => ({ ok: true, body: 'x' }));
    expect(await sw.dispatch('/api/pos/sync', { method: 'POST' })).toBe('passed');
    expect(await sw.dispatch('/api/pos/sync/snapshot')).toBe('passed');
    expect(await sw.dispatch('/studio/menus', { mode: 'navigate' })).toBe('passed');
    await sw.dispatch('/pos/tables', { mode: 'navigate' });
    expect(sw.stores.get('pos-sw-v1-shell')?.has('/pos/tables') ?? false).toBe(false);
  });
});

describe('the connection indicator', () => {
  const base = { online: true, syncing: false, signedOut: false, pending: 0, attention: 0 };
  it('puts what needs the cashier first, then a lapsed session, then a send, then no network', () => {
    expect(indicatorState({ ...base, attention: 1, signedOut: true, pending: 2, syncing: true, online: false })).toBe('attention');
    expect(indicatorState({ ...base, signedOut: true, pending: 2, syncing: true })).toBe('signedOut');
    expect(indicatorState({ ...base, syncing: true, online: false })).toBe('syncing');
    expect(indicatorState({ ...base, online: false })).toBe('offline');
    expect(indicatorState(base)).toBe('online');
  });
  it('does not call a lapsed session a problem while nothing waits to be sent', () => {
    expect(indicatorState({ ...base, signedOut: true })).toBe('online');
  });
});
