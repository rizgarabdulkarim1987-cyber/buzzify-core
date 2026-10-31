import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { envFakeProvider } from '@/server/ai/provider';
import { FileScriptedProvider } from '@/server/ai/provider/scripted';

/**
 * The browser tests drive a dev server in another process, so their scripted AI answers come from a JSON file named by an
 * environment variable. That hook must exist only when asked for (`AI_PROVIDER=scripted` and a path) and never in production.
 */

afterEach(() => vi.unstubAllEnvs());

const bytes = Buffer.from('one invoice picture');
const sha = createHash('sha256').update(bytes).digest('hex');
const request = { system: 's', messages: [{ role: 'user' as const, content: [{ type: 'document' as const, mediaType: 'application/pdf', base64: bytes.toString('base64') }] }], maxOutputTokens: 100 };

describe('AI_PROVIDER=scripted', () => {
  it('is refused in production, whatever else is set', () => {
    vi.stubEnv('AI_PROVIDER', 'scripted');
    vi.stubEnv('PH_INTAKE_E2E_SCRIPT', '/tmp/script.json');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => envFakeProvider()).toThrow(/not allowed in production/);
  });

  it('fails closed without a script path: it never falls back to a real provider', () => {
    for (const path of ['', '   ', undefined]) {
      vi.stubEnv('AI_PROVIDER', 'scripted');
      vi.stubEnv('PH_INTAKE_E2E_SCRIPT', path as string);
      vi.stubEnv('NODE_ENV', 'test');
      expect(() => envFakeProvider()).toThrow(/needs PH_INTAKE_E2E_SCRIPT/);
    }
  });

  it('is refused on a deployment even outside production', () => {
    for (const marker of ['VERCEL', 'HOSTINGER', 'RENDER']) {
      vi.stubEnv(marker, '1');
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('PH_INTAKE_E2E_SCRIPT', '/tmp/script.json');
      for (const name of ['scripted', 'fake']) {
        vi.stubEnv('AI_PROVIDER', name);
        expect(() => envFakeProvider(), `${name} on ${marker}`).toThrow(/not allowed on a deployment/);
      }
      vi.stubEnv(marker, '');
    }
  });

  it('forgets answers removed from the script file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'scripted-'));
    try {
      const file = path.join(dir, 'script.json');
      writeFileSync(file, JSON.stringify({ [sha]: '{"a":1}' }));
      const provider = new FileScriptedProvider(file);
      await provider.complete(request as never);
      writeFileSync(file, '{}');
      await expect(provider.complete(request as never)).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is not what the other provider names give', () => {
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('PH_INTAKE_E2E_SCRIPT', '/tmp/script.json');
    vi.stubEnv('NODE_ENV', 'test');
    expect(envFakeProvider()).toBeUndefined();
  });

  it('with a path outside production gives the file-backed provider', () => {
    vi.stubEnv('AI_PROVIDER', 'scripted');
    vi.stubEnv('PH_INTAKE_E2E_SCRIPT', '/tmp/script.json');
    vi.stubEnv('NODE_ENV', 'test');
    expect(envFakeProvider()).toBeInstanceOf(FileScriptedProvider);
  });
});

describe('FileScriptedProvider', () => {
  it('answers a document with the answer scripted for its hash, re-reading the file on every call', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'scripted-'));
    try {
      const file = path.join(dir, 'script.json');
      writeFileSync(file, JSON.stringify({ [sha]: '{"first":true}' }));
      const provider = new FileScriptedProvider(file);
      const first = await provider.complete(request as never);
      expect(first.content).toEqual([{ type: 'text', text: '{"first":true}' }]);
      writeFileSync(file, JSON.stringify({ [sha]: '{"second":true}' }));
      const second = await provider.complete(request as never);
      expect(second.content).toEqual([{ type: 'text', text: '{"second":true}' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails like a provider error for a document nobody scripted, and when the file is missing', async () => {
    const provider = new FileScriptedProvider(path.join(tmpdir(), 'no-such-script.json'));
    await expect(provider.complete(request as never)).rejects.toThrow();
  });
});
