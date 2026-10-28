import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBridgeUrl, writeBridgeUrl } from '@/app/pos/_ui/print/bridge-url';
import { printDoc } from '@/app/pos/_ui/print/print-client';
import type { PaperDoc } from '@/server/domain/pos/paper';
import type { PrinterView } from '@/server/pos/printers';

const DOC: PaperDoc = { rows: [{ kind: 'text', align: 'center', left: 'Hello' }] };
const printer = (over: Partial<PrinterView> = {}): PrinterView => ({
  id: 'p', name: 'Front', role: 'RECEIPT', transport: 'NETWORK', address: '10.0.0.5:9100', paperWidth: 80, cut: true, drawerPin: 2, isDefault: true, sectionId: null, sortOrder: 0, ...over,
});
const render = vi.fn(() => ({ rgba: new Uint8ClampedArray(16 * 8 * 4).fill(255), width: 16, height: 8 }));

function fakeFetch(response: { ok: boolean; status: number; json: unknown } | Error) {
  const calls: { url: string; body: { target: string; dataBase64: string } }[] = [];
  const impl = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (response instanceof Error) throw response;
    return { ok: response.ok, status: response.status, json: async () => response.json };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const bytesOf = (base64: string) => [...Buffer.from(base64, 'base64')];
const has = (bytes: number[], seq: number[]) => bytes.some((_, i) => seq.every((b, j) => bytes[i + j] === b));

beforeEach(() => {
  render.mockClear();
  vi.unstubAllGlobals();
});

describe('printDoc', () => {
  it('posts the job for the printer to the bridge', async () => {
    const { impl, calls } = fakeFetch({ ok: true, status: 200, json: { ok: true } });
    const result = await printDoc(DOC, printer(), { drawer: false, fetchImpl: impl, render, bridgeUrl: 'http://127.0.0.1:9101', dir: 'ltr' });
    expect(result).toEqual({ ok: true });
    expect(calls[0].url).toBe('http://127.0.0.1:9101/print');
    expect(calls[0].body.target).toBe('tcp://10.0.0.5:9100');
    expect(bytesOf(calls[0].body.dataBase64).slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(render).toHaveBeenCalledWith(DOC, 576, 'ltr', expect.any(String));
  });

  it('draws 58 mm paper at 384 dots', async () => {
    const { impl } = fakeFetch({ ok: true, status: 200, json: { ok: true } });
    await printDoc(DOC, printer({ paperWidth: 58 }), { drawer: false, fetchImpl: impl, render, bridgeUrl: 'http://127.0.0.1:9101', dir: 'rtl' });
    expect(render).toHaveBeenCalledWith(DOC, 384, 'rtl', expect.any(String));
  });

  it('kicks the drawer only when asked and the printer has a pin', async () => {
    const withKick = fakeFetch({ ok: true, status: 200, json: { ok: true } });
    await printDoc(DOC, printer({ drawerPin: 2 }), { drawer: true, fetchImpl: withKick.impl, render, bridgeUrl: 'http://127.0.0.1:9101', dir: 'ltr' });
    expect(has(bytesOf(withKick.calls[0].body.dataBase64), [0x1b, 0x70, 0x00, 0x3c, 0x78])).toBe(true);

    const notAsked = fakeFetch({ ok: true, status: 200, json: { ok: true } });
    await printDoc(DOC, printer({ drawerPin: 2 }), { drawer: false, fetchImpl: notAsked.impl, render, bridgeUrl: 'http://127.0.0.1:9101', dir: 'ltr' });
    expect(has(bytesOf(notAsked.calls[0].body.dataBase64), [0x1b, 0x70])).toBe(false);

    const noPin = fakeFetch({ ok: true, status: 200, json: { ok: true } });
    await printDoc(DOC, printer({ drawerPin: null }), { drawer: true, fetchImpl: noPin.impl, render, bridgeUrl: 'http://127.0.0.1:9101', dir: 'ltr' });
    expect(has(bytesOf(noPin.calls[0].body.dataBase64), [0x1b, 0x70])).toBe(false);
  });

  it('reports an unreachable bridge', async () => {
    const { impl } = fakeFetch(new TypeError('Failed to fetch'));
    expect(await printDoc(DOC, printer(), { drawer: false, fetchImpl: impl, render, bridgeUrl: 'http://127.0.0.1:9101', dir: 'ltr' })).toMatchObject({ ok: false, reason: 'bridge' });
  });

  it('reports a printer the bridge could not reach, with the bridge text', async () => {
    const { impl } = fakeFetch({ ok: false, status: 502, json: { ok: false, error: 'connect ECONNREFUSED' } });
    expect(await printDoc(DOC, printer(), { drawer: false, fetchImpl: impl, render, bridgeUrl: 'http://127.0.0.1:9101', dir: 'ltr' })).toEqual({ ok: false, reason: 'printer', message: 'connect ECONNREFUSED' });
  });

  it('reports a bridge that refuses the origin as a bridge problem', async () => {
    const { impl } = fakeFetch({ ok: false, status: 403, json: { ok: false, error: 'origin not allowed' } });
    expect(await printDoc(DOC, printer(), { drawer: false, fetchImpl: impl, render, bridgeUrl: 'http://127.0.0.1:9101', dir: 'ltr' })).toMatchObject({ ok: false, reason: 'bridge' });
  });
});

describe('the bridge address of this device', () => {
  function stubStorage(store: Record<string, string> | 'throws') {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => {
        if (store === 'throws') throw new Error('blocked');
        return store[key] ?? null;
      },
      setItem: (key: string, value: string) => {
        if (store === 'throws') throw new Error('blocked');
        store[key] = value;
      },
    });
  }

  it('is the local default when nothing is saved or storage is blocked', () => {
    stubStorage({});
    expect(readBridgeUrl()).toBe('http://127.0.0.1:9101');
    stubStorage('throws');
    expect(readBridgeUrl()).toBe('http://127.0.0.1:9101');
  });

  it('keeps a local address and ignores a remote one', () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    writeBridgeUrl('http://localhost:9200');
    expect(readBridgeUrl()).toBe('http://localhost:9200');
    writeBridgeUrl('http://evil.example:9101');
    expect(readBridgeUrl()).toBe('http://localhost:9200');
    store['pos.bridgeUrl'] = 'https://evil.example';
    expect(readBridgeUrl()).toBe('http://127.0.0.1:9101');
  });
});
