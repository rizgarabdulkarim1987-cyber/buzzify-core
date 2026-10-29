import { createAnthropicProvider } from './anthropic';
import { FakeProvider } from './fake';
import { createOpenAiProvider } from './openai';
import { FileScriptedProvider } from './scripted';
import type { AiProvider } from './types';

/**
 * Building a provider. Which one runs and with which key is decided in `../resolve.ts` (the Super Admin's saved settings,
 * then these environment variables); this folder only knows how to make one. `AI_PROVIDER=fake` gives canned answers for
 * tests and demos and is refused in production.
 */

export type AiProviderName = 'anthropic' | 'openai';

/** Model names the Super Admin may override; `ask` also serves extraction, `fast` serves phrasing and classifying. */
export interface ModelOverrides {
  ask?: string | undefined;
  fast?: string | undefined;
}

let override: AiProvider | null | undefined;

/** The environment's own key for a provider: the fallback while no key is saved in the settings. */
export function envApiKey(name: AiProviderName): string | null {
  const value = (name === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY)?.trim();
  return value ? value : null;
}

/** The provider the environment names for demos and tests, or undefined when it names a real one. */
export function envFakeProvider(): AiProvider | undefined {
  if (process.env.AI_PROVIDER?.trim() === 'scripted') return envScriptedProvider();
  if (process.env.AI_PROVIDER?.trim() !== 'fake') return undefined;
  if (process.env.NODE_ENV === 'production') throw new Error('fake AI provider is not allowed in production');
  return (fakeInstance ??= new FakeProvider());
}
let fakeInstance: FakeProvider | undefined;

/**
 * `AI_PROVIDER=scripted` with `PH_INTAKE_E2E_SCRIPT=<json file>`: the invoice-intake browser tests answer each uploaded file with
 * the reading scripted for its SHA-256. Refused in production, and without a script path it names no provider.
 */
function envScriptedProvider(): AiProvider | undefined {
  if (process.env.NODE_ENV === 'production') throw new Error('scripted AI provider is not allowed in production');
  const path = process.env.PH_INTAKE_E2E_SCRIPT?.trim();
  if (!path) return undefined;
  return (scriptedInstance ??= new FileScriptedProvider(path));
}
let scriptedInstance: FileScriptedProvider | undefined;

export function buildAiProvider(name: AiProviderName, apiKey: string, models: ModelOverrides = {}): AiProvider {
  return name === 'anthropic' ? createAnthropicProvider(apiKey, models) : createOpenAiProvider(apiKey, models);
}

/** Tests: replace the provider (null = none); undefined restores the normal choice. */
export function setAiProviderForTests(provider: AiProvider | null | undefined): void {
  override = provider;
}

export function aiProviderOverride(): AiProvider | null | undefined {
  return override;
}
