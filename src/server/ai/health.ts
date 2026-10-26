import { AiProviderError, AiTimeoutError } from './errors';
import type { AiProvider } from './provider/types';
import { toolSpecs } from './tools';

/**
 * The owner's "test the connection": one tiny real request for each way the till uses the provider, so a problem that only
 * one of them has (the big model, the tool schemas, the structured output) is found here and named, not met at the till.
 * Nothing is stored and no restaurant is charged. The detail is a status and an error type, never any content.
 */

export type HealthCheck = { purpose: 'phrase' | 'ask' | 'classify'; ok: boolean; detail: string | null };

const SIGNAL = () => AbortSignal.timeout(40_000);
const text = (value: string) => [{ role: 'user' as const, content: [{ type: 'text' as const, text: value }] }];

function whyFailed(error: unknown): string {
  if (error instanceof AiProviderError) return error.detail ?? 'provider error';
  if (error instanceof AiTimeoutError) return 'timeout';
  return error instanceof Error ? error.name : 'unknown';
}

export async function checkAiProvider(provider: AiProvider): Promise<HealthCheck[]> {
  const attempts: Array<[HealthCheck['purpose'], () => Promise<unknown>]> = [
    ['phrase', () => provider.complete({ purpose: 'phrase', system: 'Reply with the single word: ok', messages: text('ping'), maxTokens: 50, signal: SIGNAL() })],
    // The same model, tools and request shape the Ask screen sends.
    ['ask', () => provider.complete({ purpose: 'ask', system: 'Reply with the single word: ok', messages: text('ping'), tools: toolSpecs('OWNER'), maxTokens: 200, signal: SIGNAL() })],
    // The same structured output the complaint labels ask for.
    [
      'classify',
      () =>
        provider.complete({
          purpose: 'classify',
          system: 'Return the JSON {"ok": true}',
          messages: text('ping'),
          jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
          maxTokens: 100,
          signal: SIGNAL(),
        }),
    ],
  ];
  const out: HealthCheck[] = [];
  for (const [purpose, attempt] of attempts) {
    try {
      await attempt();
      out.push({ purpose, ok: true, detail: null });
    } catch (error) {
      out.push({ purpose, ok: false, detail: whyFailed(error) });
    }
  }
  return out;
}
