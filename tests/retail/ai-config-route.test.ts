import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_SETTING_KEY, writeAiSettings } from '@/server/ai/settings';
import { prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';
import { mac } from './contract-oracle';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

/** `GET /api/retail/v1/ai-config`: the Anthropic key and model Retails' intake uses, over a signed call only. */

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const CALLER = 'the-caller-secret-shared-with-retails';
const PATH = '/api/retail/v1/ai-config';
const SAVED_KEY = 'sk-ant-saved-key-0123456789-abcdefghij';
const ENV_KEY = 'sk-ant-environment-key-9876543210-zyxw';
const OPENAI_KEY = 'sk-openai-saved-key-0123456789-abcdefg';

function enableRetail() {
  vi.stubEnv('RETAIL_URL', 'https://retail.test');
  vi.stubEnv('RETAIL_SYNC_SECRET', 'the-sync-secret-shared-with-retails');
  vi.stubEnv('RETAIL_CALLER_SECRET', CALLER);
  vi.stubEnv('RETAIL_CALLER_SECRET_PREVIOUS', '');
  vi.stubEnv('RETAIL_HANDOFF_SECRET', 'the-handoff-secret-shared-with-retails');
}

async function call(): Promise<Response> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const { GET } = await import('@/app/api/retail/v1/ai-config/route');
  return GET(
    new Request(`https://studio.example.test${PATH}`, {
      headers: { 'x-bz-timestamp': timestamp, 'x-bz-signature': mac('GET', PATH, timestamp, '', CALLER), 'x-forwarded-for': '203.0.113.9' },
    }),
  );
}

const save = (input: Parameters<typeof writeAiSettings>[1]) => writeAiSettings(prisma(), input, null);

beforeAll(() => useTestDatabase());
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  await resetWorld();
  enableRetail();
  vi.stubEnv('AI_SETTINGS_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_PROVIDER', '');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv('RETAIL_URL', '');
});

describe('GET /api/retail/v1/ai-config', () => {
  it('returns the saved Anthropic key and askModel', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', ENV_KEY);
    await save({ provider: 'anthropic', anthropic: { apiKey: SAVED_KEY, askModel: 'claude-ask-model', fastModel: 'claude-fast-model' }, openai: {} });
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ apiKey: SAVED_KEY, model: 'claude-ask-model' });
  });

  it('returns the env key when none is saved', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', ENV_KEY);
    expect(await (await call()).json()).toEqual({ apiKey: ENV_KEY, model: null });
  });

  it('returns null when there is none', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ apiKey: null, model: null });
  });

  it('returns the Anthropic key even when the Studio runs OpenAI', async () => {
    await save({ provider: 'openai', anthropic: { apiKey: SAVED_KEY }, openai: { apiKey: OPENAI_KEY, askModel: 'gpt-ask' } });
    expect(await (await call()).json()).toEqual({ apiKey: SAVED_KEY, model: null });

    // With no Anthropic key at all, the OpenAI one is never handed out instead.
    await save({ provider: 'openai', anthropic: { apiKey: null }, openai: {} });
    expect(await (await call()).json()).toEqual({ apiKey: null, model: null });
  });

  it('a wrong encryption key reads as no saved key', async () => {
    await save({ provider: 'anthropic', anthropic: { apiKey: SAVED_KEY, askModel: 'claude-ask-model' }, openai: {} });
    vi.stubEnv('AI_SETTINGS_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    expect(await (await call()).json()).toEqual({ apiKey: null, model: 'claude-ask-model' });
    vi.stubEnv('ANTHROPIC_API_KEY', ENV_KEY);
    expect(await (await call()).json()).toEqual({ apiKey: ENV_KEY, model: 'claude-ask-model' });
    vi.stubEnv('AI_SETTINGS_ENCRYPTION_KEY', '');
    expect(await (await call()).json()).toEqual({ apiKey: ENV_KEY, model: 'claude-ask-model' });
  });

  it('a malformed stored setting reads as nothing saved', async () => {
    await prisma().platformSetting.create({ data: { key: AI_SETTING_KEY, value: { anthropic: { key: 'not an object' } } } });
    expect(await (await call()).json()).toEqual({ apiKey: null, model: null });
  });

  it('never logs the key', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    await save({ provider: 'anthropic', anthropic: { apiKey: SAVED_KEY }, openai: {} });
    expect((await call()).status).toBe(200);
    // A refused call carries no key in its body either.
    const timestamp = String(Math.floor(Date.now() / 1000));
    const { GET } = await import('@/app/api/retail/v1/ai-config/route');
    const refused = await GET(new Request(`https://studio.example.test${PATH}`, { headers: { 'x-bz-timestamp': timestamp, 'x-bz-signature': '0'.repeat(64) } }));
    expect(await refused.text()).not.toContain(SAVED_KEY);
    // A database failure while reading is a 503 with a code and no key.
    vi.spyOn(prisma().platformSetting, 'findUnique').mockRejectedValueOnce(new Error(`boom ${SAVED_KEY}`));
    const failed = await call();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain(SAVED_KEY);
    for (const spy of spies) {
      for (const args of spy.mock.calls) expect(JSON.stringify(args.map(String))).not.toContain(SAVED_KEY);
    }
  });

  it('response has no-store', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', ENV_KEY);
    const response = await call();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});
