import { AiProviderError, AiTimeoutError } from '../errors';
import type { AiContent, AiProvider, AiPurpose, AiRequest, AiResponse } from './types';

/**
 * The OpenAI side of the gateway, over plain `fetch` to the Chat Completions API (no SDK). It maps the same neutral request
 * the Anthropic file maps: function tools, a JSON schema for the final text, images and PDFs as data URLs, tool results as
 * `tool` messages. Tool schemas are sent without `strict`, because ours have optional fields; every tool input is validated
 * by the server before it runs, and every number in an answer still passes the grounding check.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const DEFAULTS: Record<AiPurpose, { env: string; model: string; effort: 'low' | 'medium' }> = {
  ask: { env: 'AI_OPENAI_MODEL_ASK', model: 'gpt-5', effort: 'medium' },
  extract: { env: 'AI_OPENAI_MODEL_EXTRACT', model: 'gpt-5', effort: 'medium' },
  phrase: { env: 'AI_OPENAI_MODEL_FAST', model: 'gpt-5-mini', effort: 'low' },
  classify: { env: 'AI_OPENAI_MODEL_FAST', model: 'gpt-5-mini', effort: 'low' },
};

export function openAiModelFor(purpose: AiPurpose, env: Record<string, string | undefined> = process.env): string {
  const entry = DEFAULTS[purpose];
  return env[entry.env]?.trim() || entry.model;
}

/** The GPT-5 and o-series models reason before they answer: they take an effort and spend output tokens on it. */
const reasons = (model: string) => /^(gpt-5|o\d)/.test(model);

type Json = Record<string, unknown>;

function userParts(content: AiContent[]): Json[] {
  const parts: Json[] = [];
  const files = content.filter((c) => c.type === 'image' || c.type === 'document');
  for (const c of [...files, ...content.filter((c) => c.type === 'text')]) {
    if (c.type === 'text') parts.push({ type: 'text', text: c.text });
    else if (c.type === 'image') parts.push({ type: 'image_url', image_url: { url: `data:${c.mediaType};base64,${c.base64}` } });
    else if (c.type === 'document') parts.push({ type: 'file', file: { filename: 'document.pdf', file_data: `data:${c.mediaType};base64,${c.base64}` } });
  }
  return parts;
}

function toMessages(req: AiRequest): Json[] {
  const out: Json[] = [{ role: 'system', content: req.system }];
  for (const message of req.messages) {
    if (message.role === 'assistant') {
      const text = message.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
      const calls = message.content.flatMap((c) => (c.type === 'tool_use' ? [{ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } }] : []));
      out.push({ role: 'assistant', content: text === '' ? null : text, ...(calls.length > 0 ? { tool_calls: calls } : {}) });
      continue;
    }
    for (const c of message.content) if (c.type === 'tool_result') out.push({ role: 'tool', tool_call_id: c.toolUseId, content: c.content });
    const parts = userParts(message.content);
    if (parts.length > 0) out.push({ role: 'user', content: parts });
  }
  return out;
}

/** Pure: the request body for a neutral request. */
export function toOpenAiParams(req: AiRequest, env: Record<string, string | undefined> = process.env): Json {
  const model = openAiModelFor(req.purpose, env);
  const reasoning = reasons(model);
  const body: Json = {
    model,
    messages: toMessages(req),
    // A reasoning model spends part of this on thinking, so it gets room for both.
    max_completion_tokens: reasoning ? req.maxTokens * 3 : req.maxTokens,
    ...(reasoning ? { reasoning_effort: DEFAULTS[req.purpose].effort } : {}),
  };
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
    body.tool_choice = 'auto';
  }
  if (req.jsonSchema) body.response_format = { type: 'json_schema', json_schema: { name: 'result', schema: req.jsonSchema } };
  return body;
}

interface OpenAiChoice {
  finish_reason?: string | null;
  message?: { content?: string | null; refusal?: string | null; tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[] };
}

export function fromOpenAiResponse(json: { choices?: OpenAiChoice[]; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }): AiResponse {
  const choice = json.choices?.[0];
  const message = choice?.message;
  const content: AiContent[] = [];
  if (typeof message?.content === 'string' && message.content !== '') content.push({ type: 'text', text: message.content });
  for (const call of message?.tool_calls ?? []) {
    if (call.type !== 'function' || typeof call.id !== 'string' || typeof call.function?.name !== 'string') continue;
    let input: unknown;
    try {
      input = JSON.parse(call.function.arguments || '{}');
    } catch {
      throw new AiProviderError();
    }
    content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
  }
  const stop = message?.refusal || choice?.finish_reason === 'content_filter' ? 'refusal' : content.some((c) => c.type === 'tool_use') ? 'tool_use' : choice?.finish_reason === 'length' ? 'max_tokens' : 'end';
  return { stop, content, model: json.model ?? 'openai', inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 };
}

export function createOpenAiProvider(apiKey: string, models: { ask?: string | undefined; fast?: string | undefined } = {}): AiProvider {
  const env = { ...process.env, ...(models.ask ? { AI_OPENAI_MODEL_ASK: models.ask, AI_OPENAI_MODEL_EXTRACT: models.ask } : {}), ...(models.fast ? { AI_OPENAI_MODEL_FAST: models.fast } : {}) };
  return {
    name: 'openai',
    async complete(req) {
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(toOpenAiParams(req, env)),
          signal: req.signal,
        });
      } catch (error) {
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new AiTimeoutError();
        throw new AiProviderError(error instanceof Error ? error.name : null);
      }
      if (!response.ok) {
        // Only the status and the error's type and code are read: its message can repeat part of the request or the key.
        const body = (await response.json().catch(() => null)) as { error?: { type?: string; code?: string } } | null;
        throw new AiProviderError(`http ${response.status} ${body?.error?.type ?? ''} ${body?.error?.code ?? ''}`.trim());
      }
      try {
        return fromOpenAiResponse((await response.json()) as Parameters<typeof fromOpenAiResponse>[0]);
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        throw new AiProviderError(error instanceof Error ? error.name : null);
      }
    },
  };
}
