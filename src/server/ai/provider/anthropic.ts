import Anthropic from '@anthropic-ai/sdk';
import { AiProviderError, AiTimeoutError } from '../errors';
import { effortFor, modelFor, usesFallback } from './models';
import type { AiContent, AiProvider, AiRequest, AiResponse } from './types';

/**
 * The only file that knows the vendor SDK and reads the API key. It maps the neutral request to the Messages API (`strict`
 * tools with `tool_choice: auto`, `output_config` for effort and JSON format, a top-level cache breakpoint for the fixed Ask
 * prompt) and the response back. No sampling parameters and no thinking configuration are sent: the models decide.
 */

export interface AnthropicParams {
  beta: boolean;
  body: Record<string, unknown>;
}

function block(content: AiContent): Record<string, unknown> {
  switch (content.type) {
    case 'text':
      return { type: 'text', text: content.text };
    case 'document':
      return { type: 'document', source: { type: 'base64', media_type: content.mediaType, data: content.base64 } };
    case 'image':
      return { type: 'image', source: { type: 'base64', media_type: content.mediaType, data: content.base64 } };
    case 'tool_use':
      return { type: 'tool_use', id: content.id, name: content.name, input: content.input };
    case 'tool_result':
      return { type: 'tool_result', tool_use_id: content.toolUseId, content: content.content, ...(content.isError ? { is_error: true } : {}) };
  }
}

/** Strict tools reject numeric and length limits ("For 'integer' type, properties maximum, minimum are not supported"); the server still checks every tool input before it runs. */
const UNSUPPORTED = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems']);
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (schema === null || typeof schema !== 'object') return schema;
  return Object.fromEntries(Object.entries(schema).filter(([key]) => !UNSUPPORTED.has(key)).map(([key, value]) => [key, strictSchema(value)]));
}

const isFile = (c: AiContent) => c.type === 'document' || c.type === 'image';

/** Pure: what is sent for a request. Documents and images come before the text, as the API asks. */
export function toAnthropicParams(req: AiRequest, env: Record<string, string | undefined> = process.env): AnthropicParams {
  const model = modelFor(req.purpose, env);
  const beta = usesFallback(model);
  const messages = req.messages.map((message) => ({
    role: message.role,
    content: [...message.content.filter(isFile), ...message.content.filter((c) => !isFile(c))].map(block),
  }));
  const body: Record<string, unknown> = {
    model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages,
    output_config: { effort: effortFor(req.purpose), ...(req.jsonSchema ? { format: { type: 'json_schema', schema: strictSchema(req.jsonSchema) } } : {}) },
  };
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: strictSchema(tool.inputSchema), strict: true }));
    body.tool_choice = { type: 'auto' };
  }
  if (req.purpose === 'ask') body.cache_control = { type: 'ephemeral' };
  if (beta) {
    body.betas = ['server-side-fallback-2026-07-01'];
    body.fallbacks = 'default';
  }
  return { beta, body };
}

function fromContent(content: unknown): AiContent[] {
  const out: AiContent[] = [];
  for (const item of Array.isArray(content) ? (content as Record<string, unknown>[]) : []) {
    if (item.type === 'text' && typeof item.text === 'string') out.push({ type: 'text', text: item.text });
    else if (item.type === 'tool_use' && typeof item.id === 'string' && typeof item.name === 'string') out.push({ type: 'tool_use', id: item.id, name: item.name, input: item.input });
  }
  return out;
}

export function fromAnthropicMessage(message: { stop_reason?: string | null; content: unknown; model: string; usage?: { input_tokens?: number; output_tokens?: number } }): AiResponse {
  const stop = message.stop_reason === 'end_turn' ? 'end' : message.stop_reason === 'tool_use' ? 'tool_use' : message.stop_reason === 'refusal' ? 'refusal' : 'max_tokens';
  return { stop, content: fromContent(message.content), model: message.model, inputTokens: message.usage?.input_tokens ?? 0, outputTokens: message.usage?.output_tokens ?? 0 };
}

/** The status and error type of a failed call, and the API's own short message (it describes the account or the model, never the request). */
function describeAnthropicError(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    const inner = (error.error as { error?: { type?: string; message?: string } } | undefined)?.error;
    return `http ${error.status ?? 'none'} ${inner?.type ?? ''} ${(inner?.message ?? '').slice(0, 160)}`.trim();
  }
  return error instanceof Error ? error.name : 'unknown';
}

export function createAnthropicProvider(apiKey: string, models: { ask?: string | undefined; fast?: string | undefined } = {}): AiProvider {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  // Models the Super Admin saved win over the environment's, which win over the defaults.
  const env = { ...process.env, ...(models.ask ? { AI_MODEL_ASK: models.ask, AI_MODEL_EXTRACT: models.ask } : {}), ...(models.fast ? { AI_MODEL_FAST: models.fast } : {}) };
  return {
    name: 'anthropic',
    modelFor: (purpose) => modelFor(purpose, env),
    async complete(req) {
      const { beta, body } = toAnthropicParams(req, env);
      try {
        // The SDK's request types are narrower than this neutral mapping, which the mapping test pins.
        const message = beta
          ? await client.beta.messages.create(body as unknown as Parameters<typeof client.beta.messages.create>[0], { signal: req.signal, timeout: 160_000 })
          : await client.messages.create(body as unknown as Parameters<typeof client.messages.create>[0], { signal: req.signal, timeout: 160_000 });
        return fromAnthropicMessage(message as unknown as Parameters<typeof fromAnthropicMessage>[0]);
      } catch (error) {
        if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError || (error instanceof Error && error.name === 'TimeoutError')) throw new AiTimeoutError();
        throw new AiProviderError(describeAnthropicError(error));
      }
    },
  };
}
