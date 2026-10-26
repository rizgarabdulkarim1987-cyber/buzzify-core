import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiProviderError, AiTimeoutError } from '@/server/ai/errors';
import { fromOpenAiResponse, toOpenAiParams, createOpenAiProvider } from '@/server/ai/provider/openai';
import { setAiProviderForTests } from '@/server/ai/provider';
import { clearAiProviderCache, readAiSettings, resolveAiProvider } from '@/server/ai/settings';
import type { AiRequest } from '@/server/ai/provider/types';
import { saveAiSettings, testAiProvider } from '@/server/studio/actions/ai-settings';
import { aiSettings } from '@/server/studio/queries/ai-settings';
import { ask, codeOf, dataOf, person, prisma, resetWorld, run, useTestDatabase, type Person } from '../fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const KEY = 'sk-test-0123456789abcdefghijWXYZ';
let owner: Person;
let admin: Person;

beforeAll(() => useTestDatabase());
beforeEach(async () => {
  await resetWorld();
  vi.stubEnv('AI_SETTINGS_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_PROVIDER', '');
  setAiProviderForTests(undefined);
  clearAiProviderCache();
  owner = await person('ai-owner', { superAdmin: true });
  await prisma().user.update({ where: { id: owner.userId }, data: { isPlatformOwner: true } });
  admin = await person('ai-admin', { superAdmin: true });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const save = (input: unknown) => run(owner, saveAiSettings, input);
const openai = (extra: Record<string, unknown> = {}) => ({ provider: 'openai', anthropic: {}, openai: { apiKey: KEY, ...extra } });

describe('saving the AI provider settings', () => {
  it('stores the key encrypted, shows only its last four characters and uses it', async () => {
    dataOf(await save(openai({ askModel: 'my-ask', fastModel: 'my-fast' })));
    const row = await prisma().platformSetting.findUnique({ where: { key: 'ai' } });
    expect(JSON.stringify(row?.value)).not.toContain(KEY);
    expect(JSON.stringify(row?.value)).not.toContain('0123456789');
    const view = dataOf(await ask(owner, aiSettings, {}));
    expect(view.provider).toBe('openai');
    expect(view.providers.openai).toMatchObject({ keySource: 'saved', last4: 'WXYZ', askModel: 'my-ask', fastModel: 'my-fast' });
    expect(view.providers.anthropic.keySource).toBe('none');
    expect(JSON.stringify(view)).not.toContain(KEY);
    expect((await resolveAiProvider(prisma()))?.name).toBe('openai');
  });

  it('keeps the saved key when the field is left out, and removes it when told to', async () => {
    dataOf(await save(openai()));
    dataOf(await save({ provider: 'openai', anthropic: {}, openai: { fastModel: 'other' } }));
    expect((await readAiSettings(prisma())).providers.openai).toMatchObject({ keySource: 'saved', last4: 'WXYZ', fastModel: 'other' });
    dataOf(await save({ provider: 'openai', anthropic: {}, openai: { apiKey: null } }));
    expect((await readAiSettings(prisma())).providers.openai.keySource).toBe('none');
    expect(await resolveAiProvider(prisma())).toBeNull();
  });

  it('falls back to the environment key, and a saved key wins over it', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'env-key-0123456789012345678');
    expect((await resolveAiProvider(prisma()))?.name).toBe('anthropic');
    expect((await readAiSettings(prisma())).providers.anthropic.keySource).toBe('environment');
    dataOf(await save({ provider: 'anthropic', anthropic: { apiKey: KEY }, openai: {} }));
    expect((await readAiSettings(prisma())).providers.anthropic.keySource).toBe('saved');
  });

  it('refuses to save a key while the server has no encryption key, and says so', async () => {
    vi.stubEnv('AI_SETTINGS_ENCRYPTION_KEY', '');
    const result = await save(openai());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.fields).toEqual({ apiKey: 'noEncryptionKey' });
    expect(await prisma().platformSetting.findUnique({ where: { key: 'ai' } })).toBeNull();
    expect((await readAiSettings(prisma())).canStoreKeys).toBe(false);
  });

  it('treats a key it can no longer decrypt as no key instead of failing', async () => {
    dataOf(await save(openai()));
    clearAiProviderCache();
    vi.stubEnv('AI_SETTINGS_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    expect(await resolveAiProvider(prisma())).toBeNull();
  });

  it('audits what changed without any key, and only the platform owner may save, read or test', async () => {
    dataOf(await save(openai()));
    const rows = await prisma().auditLog.findMany({ where: { action: 'ai.settings.update' } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(KEY);
    expect(JSON.stringify(rows[0])).not.toContain('WXYZ');
    expect(JSON.stringify(rows[0]?.changes)).toContain('openai.key');
    expect(codeOf(await run(admin, saveAiSettings, openai()))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, aiSettings, {}))).toBe('FORBIDDEN');
    expect(codeOf(await run(admin, testAiProvider, {}))).toBe('FORBIDDEN');
  });

  it('writes no audit row for a save that changes nothing', async () => {
    dataOf(await save({ provider: 'anthropic', anthropic: {}, openai: {} }));
    expect(await prisma().auditLog.count({ where: { action: 'ai.settings.update' } })).toBe(0);
  });

  it('tests the connection with the saved provider and reports a missing key calmly', async () => {
    expect(dataOf(await run(owner, testAiProvider, {}))).toMatchObject({ ok: false, checks: [], detail: 'no key' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }], model: 'm', usage: { prompt_tokens: 3, completion_tokens: 1 } })));
    vi.stubGlobal('fetch', fetchMock);
    dataOf(await save(openai()));
    expect(dataOf(await run(owner, testAiProvider, {}))).toEqual({
      ok: true,
      provider: 'openai',
      detail: null,
      checks: [
        { purpose: 'phrase', ok: true, detail: null },
        { purpose: 'ask', ok: true, detail: null },
        { purpose: 'classify', ok: true, detail: null },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it('names the purpose that fails when only one of them does', async () => {
    const ok = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }], model: 'm' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: { body: string }) =>
        JSON.parse(init.body).tools ? new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'bad_schema' } }), { status: 400 }) : new Response(ok),
      ),
    );
    dataOf(await save(openai()));
    const result = dataOf(await run(owner, testAiProvider, {})) as { ok: boolean; checks: { purpose: string; ok: boolean; detail: string | null }[] };
    expect(result.ok).toBe(false);
    expect(result.checks.map((c) => [c.purpose, c.ok])).toEqual([['phrase', true], ['ask', false], ['classify', true]]);
    expect(result.checks[1]!.detail).toBe('http 400 invalid_request_error bad_schema');
    vi.unstubAllGlobals();
  });
});

const req = (extra: Partial<AiRequest> = {}): AiRequest => ({ purpose: 'ask', system: 'rules', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], maxTokens: 100, signal: new AbortController().signal, ...extra });

describe('the OpenAI mapping', () => {
  it('sends tools without strict, tool results as tool messages, and a reasoning effort on GPT-5 only', () => {
    const body = toOpenAiParams(
      req({
        tools: [{ name: 'getDailyReport', description: 'd', inputSchema: { type: 'object', properties: {} } }],
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'sales?' }] },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'getDailyReport', input: { day: '2026-10-24' } }] },
          { role: 'user', content: [{ type: 'tool_result', toolUseId: 'call_1', content: '{"total":5}' }] },
        ],
      }),
      {},
    );
    expect(body.model).toBe('gpt-5');
    expect(body.reasoning_effort).toBe('medium');
    expect(body.max_completion_tokens).toBe(300);
    expect(body.tool_choice).toBe('auto');
    expect(JSON.stringify(body.tools)).not.toContain('strict');
    expect(body.messages).toEqual([
      { role: 'system', content: 'rules' },
      { role: 'user', content: [{ type: 'text', text: 'sales?' }] },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'getDailyReport', arguments: '{"day":"2026-10-24"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"total":5}' },
    ]);
    const plain = toOpenAiParams(req(), { AI_OPENAI_MODEL_ASK: 'gpt-4.1' });
    expect(plain.model).toBe('gpt-4.1');
    expect(plain).not.toHaveProperty('reasoning_effort');
    expect(plain.max_completion_tokens).toBe(100);
  });

  it('sends a PDF and an image as data URLs before the text, and a JSON schema as the response format', () => {
    const body = toOpenAiParams(
      req({ purpose: 'extract', jsonSchema: { type: 'object' }, messages: [{ role: 'user', content: [{ type: 'text', text: 'read' }, { type: 'document', mediaType: 'application/pdf', base64: 'QQ==' }, { type: 'image', mediaType: 'image/png', base64: 'Qg==' }] }] }),
      {},
    );
    const parts = (body.messages as { content: { type: string }[] }[])[1]!.content;
    expect(parts.map((p) => p.type)).toEqual(['file', 'image_url', 'text']);
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'result', schema: { type: 'object' } } });
  });

  it('reads text, tool calls, refusals, truncation and usage', () => {
    expect(fromOpenAiResponse({ model: 'm', choices: [{ finish_reason: 'stop', message: { content: 'done' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } })).toEqual({ stop: 'end', content: [{ type: 'text', text: 'done' }], model: 'm', inputTokens: 5, outputTokens: 2 });
    const calls = fromOpenAiResponse({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'listLowStock', arguments: '{}' } }] } }] });
    expect(calls.stop).toBe('tool_use');
    expect(calls.content).toEqual([{ type: 'tool_use', id: 'c', name: 'listLowStock', input: {} }]);
    expect(fromOpenAiResponse({ choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'no' } }] }).stop).toBe('refusal');
    expect(fromOpenAiResponse({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }).stop).toBe('refusal');
    expect(fromOpenAiResponse({ choices: [{ finish_reason: 'length', message: { content: 'cut' } }] }).stop).toBe('max_tokens');
    expect(() => fromOpenAiResponse({ choices: [{ message: { tool_calls: [{ id: 'c', type: 'function', function: { name: 'x', arguments: '{oops' } }] } }] })).toThrow(AiProviderError);
  });

  
  it('fails calmly on an HTTP error, a dropped connection and a timeout, naming the status and type but never the message', async () => {
    const provider = createOpenAiProvider(KEY);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'insufficient_quota', message: `Incorrect key ${KEY}` } }), { status: 429 })));
    const failure = await provider.complete(req()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AiProviderError);
    expect((failure as AiProviderError).detail).toBe('http 429 invalid_request_error insufficient_quota');
    expect(JSON.stringify(failure)).not.toContain(KEY);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network'))));
    await expect(provider.complete(req())).rejects.toBeInstanceOf(AiProviderError);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))));
    await expect(provider.complete(req())).rejects.toBeInstanceOf(AiTimeoutError);
    vi.unstubAllGlobals();
  });
});
