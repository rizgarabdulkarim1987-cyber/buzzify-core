import { describe, expect, it } from 'vitest';
import { toAnthropicParams } from '@/server/ai/provider/anthropic';
import { extractionJsonSchema } from '@/server/domain/pharmacy/intake';
import { EXTRACT_SYSTEM_PROMPT } from '@/server/pharmacy/intake/extract';

/**
 * The schema the provider receives (phase 5, task 5 review I-1). Strict structured output rejects limits, so the walk below fails
 * on any keyword the provider adapters document as unsupported; the limits are enforced by Zod on the answer.
 */

const FORBIDDEN = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'format', 'uniqueItems', 'minProperties', 'maxProperties'];

function keywordsIn(node: unknown, path = '$'): string[] {
  if (Array.isArray(node)) return node.flatMap((n, i) => keywordsIn(n, `${path}[${i}]`));
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) => [...(FORBIDDEN.includes(key) ? [`${path}.${key}`] : []), ...(key === 'properties' ? Object.entries(value as object).flatMap(([name, v]) => keywordsIn(v, `${path}.properties.${name}`)) : keywordsIn(value, `${path}.${key}`))]);
}

type Node = { type?: unknown; additionalProperties?: unknown; required?: string[]; properties?: Record<string, Node>; items?: Node };
function objects(node: Node, path = '$'): { path: string; node: Node }[] {
  const here = node.type === 'object' ? [{ path, node }] : [];
  return [...here, ...Object.entries(node.properties ?? {}).flatMap(([k, v]) => objects(v, `${path}.${k}`)), ...(node.items ? objects(node.items, `${path}[]`) : [])];
}

describe('the extraction schema sent to the provider', () => {
  it('carries no keyword that strict structured output rejects', () => {
    expect(keywordsIn(extractionJsonSchema)).toEqual([]);
  });

  it('is strict for OpenAI too: every object closed (additionalProperties false) with every key required', () => {
    const all = objects(extractionJsonSchema as unknown as Node);
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const { path, node } of all) {
      expect(node.additionalProperties, path).toBe(false);
      expect((node.required ?? []).slice().sort(), path).toEqual(Object.keys(node.properties ?? {}).sort());
    }
  });

  it('reaches the Anthropic request without a forbidden keyword', () => {
    const { body } = toAnthropicParams({ purpose: 'extract', system: 's', messages: [], jsonSchema: extractionJsonSchema as unknown as Record<string, unknown>, maxTokens: 10, signal: new AbortController().signal }, {});
    expect(keywordsIn((body.output_config as { format: { schema: unknown } }).format.schema)).toEqual([]);
  });

  it('strips limits from any response schema in the adapter, not only tools', () => {
    const limited = { type: 'object', additionalProperties: false, required: ['n'], properties: { n: { type: 'integer', minimum: 0, maximum: 5 }, s: { type: 'string', maxLength: 3 }, l: { type: 'array', maxItems: 2, items: { type: 'string' } } } };
    const { body } = toAnthropicParams({ purpose: 'extract', system: 's', messages: [], jsonSchema: limited, maxTokens: 10, signal: new AbortController().signal }, {});
    expect(keywordsIn((body.output_config as { format: { schema: unknown } }).format.schema)).toEqual([]);
  });
});

describe('the extraction prompt', () => {
  it('tells the model to copy header text as printed, to null an inexact decimal or an ambiguous separator, and to keep digits as written', () => {
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/copy supplier name, invoice number and invoice date exactly as printed/i);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/more decimals than the currency/i);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/thousands separator from a decimal point/i);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/Eastern Arabic digits exactly as written/i);
  });
});
