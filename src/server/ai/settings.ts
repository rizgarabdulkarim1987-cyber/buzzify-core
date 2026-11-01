import { z } from 'zod';
import type { AnyDb } from '@/server/data/tenant-db';
import { decryptSecret, encryptSecret, parseEncryptionKey } from '@/server/domain/link/secret';
import { aiProviderOverride, buildAiProvider, envApiKey, envFakeProvider, type AiProviderName } from './provider';
import { modelFor } from './provider/models';
import { openAiModelFor } from './provider/openai';
import type { AiProvider } from './provider/types';

/**
 * Which AI provider runs and with which key, as the platform owner saved it (Studio → Settings → AI). Stored in the
 * `PlatformSetting` row `ai`: the key encrypted with AES-256-GCM under `AI_SETTINGS_ENCRYPTION_KEY`, plus its last four
 * characters so the screen can say which key is saved without ever reading it back. A key saved here wins over the
 * server environment's own key for the provider, which stays as the fallback.
 */

export const AI_SETTING_KEY = 'ai';
export const AI_PROVIDER_NAMES = ['anthropic', 'openai'] as const;

const storedProvider = z.object({
  key: z.object({ enc: z.string().min(1), last4: z.string().max(8) }).optional(),
  askModel: z.string().max(120).optional(),
  fastModel: z.string().max(120).optional(),
});
const stored = z.object({
  provider: z.enum(AI_PROVIDER_NAMES).optional(),
  anthropic: storedProvider.default({}),
  openai: storedProvider.default({}),
});
type StoredAi = z.infer<typeof stored>;

function parseStored(value: unknown): StoredAi {
  const parsed = stored.safeParse(value);
  return parsed.success ? parsed.data : { anthropic: {}, openai: {} };
}

export const encryptionKey = () => parseEncryptionKey(process.env.AI_SETTINGS_ENCRYPTION_KEY);

async function readStored(db: AnyDb): Promise<{ data: StoredAi; updatedAt: Date | null }> {
  const row = await db.platformSetting.findUnique({ where: { key: AI_SETTING_KEY }, select: { value: true, updatedAt: true } });
  return { data: parseStored(row?.value), updatedAt: row?.updatedAt ?? null };
}

export interface AiProviderView {
  /** Where the key in use comes from: saved here, the server's environment, or nowhere. */
  keySource: 'saved' | 'environment' | 'none';
  last4: string | null;
  askModel: string;
  fastModel: string;
  /** The built-in models, shown as the placeholder of the fields. */
  defaultAsk: string;
  defaultFast: string;
}

export interface AiSettingsView {
  /** The provider that runs: the saved choice, else AI_PROVIDER, else Anthropic. */
  provider: AiProviderName;
  /** Whether a key can be saved here at all (the server has an encryption key). */
  canStoreKeys: boolean;
  updatedAt: string | null;
  providers: Record<AiProviderName, AiProviderView>;
}

export async function readAiSettings(db: AnyDb): Promise<AiSettingsView> {
  const { data, updatedAt } = await readStored(db);
  const view = (name: AiProviderName): AiProviderView => {
    const own = data[name];
    return {
      keySource: own.key ? 'saved' : envApiKey(name) ? 'environment' : 'none',
      last4: own.key?.last4 ?? null,
      askModel: own.askModel ?? '',
      fastModel: own.fastModel ?? '',
      defaultAsk: name === 'anthropic' ? modelFor('ask') : openAiModelFor('ask'),
      defaultFast: name === 'anthropic' ? modelFor('phrase') : openAiModelFor('phrase'),
    };
  };
  const fromEnv = process.env.AI_PROVIDER?.trim() === 'openai' ? 'openai' : 'anthropic';
  return { provider: data.provider ?? fromEnv, canStoreKeys: encryptionKey() !== null, updatedAt: updatedAt?.toISOString() ?? null, providers: { anthropic: view('anthropic'), openai: view('openai') } };
}

/** What the platform owner sends: an absent field stays as it is; `apiKey: null` removes the saved key; a blank model returns to the default. */
export const aiSettingsInput = z.object({
  provider: z.enum(AI_PROVIDER_NAMES),
  anthropic: z.object({ apiKey: z.string().trim().min(20).max(400).nullable().optional(), askModel: z.string().trim().max(120).optional(), fastModel: z.string().trim().max(120).optional() }).default({}),
  openai: z.object({ apiKey: z.string().trim().min(20).max(400).nullable().optional(), askModel: z.string().trim().max(120).optional(), fastModel: z.string().trim().max(120).optional() }).default({}),
});
export type AiSettingsInput = z.infer<typeof aiSettingsInput>;

export class AiSettingsKeyError extends Error {
  constructor() {
    super('AI_SETTINGS_ENCRYPTION_KEY is not set, so a key cannot be saved');
  }
}

/** What changed, with no key and no model ever repeated beyond its name: the audit row is built from this. */
export interface AiSettingsChange {
  provider: { before: AiProviderName; after: AiProviderName };
  keys: Partial<Record<AiProviderName, 'saved' | 'removed'>>;
  models: AiProviderName[];
}

export async function writeAiSettings(db: AnyDb, input: AiSettingsInput, updatedById: string | null): Promise<AiSettingsChange> {
  const key = encryptionKey();
  const before = await readAiSettings(db);
  const { data } = await readStored(db);
  const next: StoredAi = { provider: input.provider, anthropic: { ...data.anthropic }, openai: { ...data.openai } };
  const change: AiSettingsChange = { provider: { before: before.provider, after: input.provider }, keys: {}, models: [] };

  for (const name of AI_PROVIDER_NAMES) {
    const patch = input[name];
    const own = next[name];
    if (patch.apiKey === null) {
      if (own.key) change.keys[name] = 'removed';
      delete own.key;
    } else if (typeof patch.apiKey === 'string') {
      if (!key) throw new AiSettingsKeyError();
      own.key = { enc: encryptSecret(patch.apiKey, key), last4: patch.apiKey.slice(-4) };
      change.keys[name] = 'saved';
    }
    for (const [field, value] of [['askModel', patch.askModel], ['fastModel', patch.fastModel]] as const) {
      if (value === undefined) continue;
      const was = own[field] ?? '';
      if (value === '') delete own[field];
      else own[field] = value;
      if (was !== value && !change.models.includes(name)) change.models.push(name);
    }
  }

  await db.platformSetting.upsert({
    where: { key: AI_SETTING_KEY },
    create: { key: AI_SETTING_KEY, value: next, updatedById },
    update: { value: next, updatedById },
  });
  clearAiProviderCache();
  return change;
}

/**
 * The Anthropic key and model Buzzify Retail should use (`GET /api/retail/v1/ai-config`): the saved Anthropic key,
 * whatever provider the Studio itself runs, else the environment's Anthropic key; model = the saved Anthropic
 * `askModel` or null. Never the OpenAI key. Never logs.
 *
 * A saved key that cannot be read (the encryption key is missing or wrong) throws `AiKeyUnreadableError`, and the route
 * answers 503: Retails then keeps the key it has cached instead of hearing "no key" and switching its AI off.
 */
export class AiKeyUnreadableError extends Error {
  constructor() {
    super('The saved AI key cannot be read');
    this.name = 'AiKeyUnreadableError';
  }
}

export async function readAnthropicConfig(db: AnyDb): Promise<{ apiKey: string | null; model: string | null }> {
  const { anthropic } = (await readStored(db)).data;
  let apiKey: string | null = null;
  if (anthropic.key) {
    const secret = encryptionKey();
    if (!secret) throw new AiKeyUnreadableError();
    try {
      apiKey = decryptSecret(anthropic.key.enc, secret) || null;
    } catch {
      throw new AiKeyUnreadableError();
    }
  }
  return { apiKey: apiKey ?? envApiKey('anthropic'), model: anthropic.askModel || null };
}

// A resolved provider is kept for a short while, so a request does not decrypt and rebuild it; a save clears it here at once
// (another server instance sees the change within the time below).
const CACHE_MS = 30_000;
let cache: { at: number; provider: AiProvider | null } | null = null;

export function clearAiProviderCache(): void {
  cache = null;
}

/**
 * The provider for this request. Tests may force one; `AI_PROVIDER=fake` names the canned one; otherwise the saved choice
 * and key, falling back to the environment's. Null (no key anywhere) makes every AI screen show the calm "not available".
 */
export async function resolveAiProvider(db: AnyDb, now: number = Date.now()): Promise<AiProvider | null> {
  const forced = aiProviderOverride();
  if (forced !== undefined) return forced;
  const fake = envFakeProvider();
  if (fake) return fake;
  if (cache && now - cache.at < CACHE_MS) return cache.provider;

  const { data } = await readStored(db);
  const name: AiProviderName = data.provider ?? (process.env.AI_PROVIDER?.trim() === 'openai' ? 'openai' : 'anthropic');
  const own = data[name];
  let apiKey: string | null = null;
  const secret = encryptionKey();
  if (own.key && secret) {
    try {
      apiKey = decryptSecret(own.key.enc, secret);
    } catch {
      apiKey = null; // a wrong or changed encryption key: treated as no saved key, never as a crash
    }
  }
  apiKey ??= envApiKey(name);
  const provider = apiKey ? buildAiProvider(name, apiKey, { ask: own.askModel, fast: own.fastModel }) : null;
  cache = { at: now, provider };
  return provider;
}
