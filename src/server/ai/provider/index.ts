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
  refuseOutsideDevelopment('fake');
  return (fakeInstance ??= new FakeProvider());
}
let fakeInstance: FakeProvider | undefined;

/**
 * Environment variables a hosting platform MAY set on a deployment; a canned AI provider is refused where one is set. This is
 * best effort only: not every host sets one (do not rely on `HOSTINGER`). The guarantee is `NODE_ENV=production` plus the
 * deploy check (`checkProductionEnv`), which fails on `AI_PROVIDER=fake|scripted`.
 */
const DEPLOYMENT_MARKERS = ['VERCEL', 'HOSTINGER', 'RENDER'] as const;

/** Throws when the canned providers (`fake`, `scripted`) are asked for in production or on a deployment. */
function refuseOutsideDevelopment(name: 'fake' | 'scripted'): void {
  if (process.env.NODE_ENV === 'production') throw new Error(`${name} AI provider is not allowed in production`);
  const marker = DEPLOYMENT_MARKERS.find((key) => process.env[key]?.trim());
  if (marker) throw new Error(`${name} AI provider is not allowed on a deployment (${marker} is set)`);
}

/**
 * `AI_PROVIDER=scripted` with `PH_INTAKE_E2E_SCRIPT=<json file>`: the invoice-intake browser tests answer each uploaded file with
 * the reading scripted for its SHA-256. It fails closed: refused in production or on a deployment, and without a script path it
 * throws, so a missing path can never fall through to a real provider.
 */
function envScriptedProvider(): AiProvider {
  refuseOutsideDevelopment('scripted');
  const path = process.env.PH_INTAKE_E2E_SCRIPT?.trim();
  if (!path) throw new Error('AI_PROVIDER=scripted needs PH_INTAKE_E2E_SCRIPT (the script file); it never falls back to a real provider');
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
