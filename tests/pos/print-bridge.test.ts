import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTarget, targetOf } from '@/server/domain/pos/bridge-protocol';
// @ts-expect-error the bridge is plain ESM JavaScript that ships without types
import { startBridge } from '../../print-bridge/bridge.mjs';

type Bridge = { close(): Promise<void>; port: number };
const open: Bridge[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

async function bridge(send: (target: string, bytes: Uint8Array) => Promise<void>): Promise<Bridge> {
  const b: Bridge = await startBridge({ port: 0, allowedOrigins: ['https://studio.example'], send });
  open.push(b);
  return b;
}

const post = (b: Bridge, body: unknown, origin = 'https://studio.example') =>
  fetch(`http://127.0.0.1:${b.port}/print`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });

describe('parseTarget and targetOf', () => {
  it('reads a network and a file target', () => {
    expect(parseTarget('tcp://10.0.0.5:9100')).toEqual({ transport: 'NETWORK', address: '10.0.0.5:9100' });
    expect(parseTarget('file://\\\\localhost\\XP80')).toEqual({ transport: 'FILE', address: '\\\\localhost\\XP80' });
  });

  it('rejects anything else', () => {
    expect(() => parseTarget('http://x')).toThrow('bad target');
    expect(() => parseTarget('tcp://nohost')).toThrow('bad target');
  });

  it('writes a printer back as a target', () => {
    expect(targetOf({ transport: 'NETWORK', address: '10.0.0.5:9100' })).toBe('tcp://10.0.0.5:9100');
    expect(targetOf({ transport: 'FILE', address: '\\\\localhost\\XP80' })).toBe('file://\\\\localhost\\XP80');
  });
});

describe('the bridge', () => {
  it('hands the decoded bytes of an allowed origin to send', async () => {
    const seen: { target: string; bytes: number[] }[] = [];
    const b = await bridge(async (target, bytes) => void seen.push({ target, bytes: [...bytes] }));
    const res = await post(b, { target: 'tcp://10.0.0.5:9100', dataBase64: Buffer.from([1, 2, 3]).toString('base64') });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://studio.example');
    expect(seen).toEqual([{ target: 'tcp://10.0.0.5:9100', bytes: [1, 2, 3] }]);
  });

  it('refuses an origin that is not allowed', async () => {
    const seen: string[] = [];
    const b = await bridge(async (target) => void seen.push(target));
    const res = await post(b, { target: 'tcp://10.0.0.5:9100', dataBase64: 'AQ==' }, 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(seen).toEqual([]);
  });

  it('answers 502 with the reason when the printer cannot be reached', async () => {
    const b = await bridge(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const res = await post(b, { target: 'tcp://10.0.0.5:9100', dataBase64: 'AQ==' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'connect ECONNREFUSED' });
  });

  it('refuses a bad target and an oversized body', async () => {
    const b = await bridge(async () => undefined);
    expect((await post(b, { target: 'http://x', dataBase64: 'AQ==' })).status).toBe(400);
    expect((await post(b, { target: 'tcp://10.0.0.5:9100', dataBase64: 'A'.repeat(9 * 1024 * 1024) })).status).toBe(413);
  });

  it('answers health and an options preflight', async () => {
    const b = await bridge(async () => undefined);
    expect(await (await fetch(`http://127.0.0.1:${b.port}/health`, { headers: { origin: 'https://studio.example' } })).json()).toEqual({ ok: true });
    const pre = await fetch(`http://127.0.0.1:${b.port}/print`, { method: 'OPTIONS', headers: { origin: 'https://studio.example' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('delivers the exact bytes to a real TCP printer by default', async () => {
    const received: Buffer[] = [];
    const printer = createServer((socket) => socket.on('data', (chunk) => received.push(chunk)));
    await new Promise<void>((resolve) => printer.listen(0, '127.0.0.1', resolve));
    const address = printer.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const b: Bridge = await startBridge({ port: 0, allowedOrigins: ['https://studio.example'] });
    open.push(b);
    const res = await post(b, { target: `tcp://127.0.0.1:${port}`, dataBase64: Buffer.from([0x1b, 0x40, 0x41]).toString('base64') });
    expect(res.status).toBe(200);
    expect([...Buffer.concat(received)]).toEqual([0x1b, 0x40, 0x41]);
    await new Promise<void>((resolve) => printer.close(() => resolve()));
  });
});
