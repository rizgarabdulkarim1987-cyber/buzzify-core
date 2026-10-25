import { createAnthropicProvider } from './anthropic';
import { FakeProvider } from './fake';
import type { AiProvider } from './types';

/**
 * The provider for this process: `AI_PROVIDER=anthropic` (default) with ANTHROPIC_API_KEY, or `fake` for tests and demos
 * (refused in production). Without a key there is none, and every AI screen shows the calm "not available" message.
 */

let instance: AiProvider | null | undefined;
let override: AiProvider | null | undefined;

export function getAiProvider(): AiProvider | null {
  if (override !== undefined) return override;
  if (instance !== undefined) return instance;
  const name = process.env.AI_PROVIDER?.trim() || 'anthropic';
  if (name === 'fake') {
    if (process.env.NODE_ENV === 'production') throw new Error('fake AI provider is not allowed in production');
    instance = new FakeProvider();
  } else {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    instance = key ? createAnthropicProvider(key) : null;
  }
  return instance;
}

/** Tests: replace the provider (null = none); undefined restores the environment's choice. */
export function setAiProviderForTests(provider: AiProvider | null | undefined): void {
  override = provider;
  if (provider === undefined) instance = undefined;
}
