/**
 * The gateway's neutral request and response types. Nothing in this folder imports the database, a service or a vendor
 * SDK type except `anthropic.ts`, so a vendor swap is one new file.
 */

export type AiPurpose = 'ask' | 'extract' | 'phrase' | 'classify';

export type AiContent =
  | { type: 'text'; text: string }
  | { type: 'document'; mediaType: 'application/pdf'; base64: string }
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface AiMessage {
  role: 'user' | 'assistant';
  content: AiContent[];
}

export interface AiToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AiRequest {
  purpose: AiPurpose;
  system: string;
  messages: AiMessage[];
  tools?: AiToolSpec[];
  /** A JSON schema the final text must follow (extraction, classification). */
  jsonSchema?: Record<string, unknown>;
  maxTokens: number;
  signal: AbortSignal;
}

export interface AiResponse {
  stop: 'end' | 'tool_use' | 'max_tokens' | 'refusal';
  content: AiContent[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  readonly name: 'anthropic' | 'openai' | 'fake';
  complete(req: AiRequest): Promise<AiResponse>;
}
