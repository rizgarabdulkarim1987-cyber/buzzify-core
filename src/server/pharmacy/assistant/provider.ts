import { MAX_TOKENS } from '@/server/ai/provider/models';
import type { AiProvider } from '@/server/ai/provider/types';
import { type AssistantTool } from '@/server/domain/pharmacy/assistant-domain';
import { runAssistantAi, type AssistantCallOptions } from '@/server/pharmacy/intake/assistant-ai';
import { TOOL_SPECS } from './tool-shapes';

/**
 * The model, as the assistant sees it (R7-6): one function from a request to either tool calls or text. The assistant is written
 * against this interface and tested with a scripted one (`tests/pharmacy/assistant-mock.ts`); no test and no phase 7 code makes a
 * real model call. `gatedProvider` is the ONLY adapter from this interface to a real `AiProvider`, and it goes through
 * `runAssistantAi`, the same budget gate as invoice reading (reserve, call, settle), so a call without budget never reaches the model.
 */

export interface AssistantRequest {
  stage: 'choose' | 'phrase';
  system: string;
  user: string;
  /** Only the choosing stage offers tools; the phrasing stage offers none (the model cannot act on what it reads). */
  tools?: ReadonlyArray<{ name: AssistantTool; description: string; inputSchema: Record<string, unknown> }>;
}

export type AssistantReply = { kind: 'tools'; calls: Array<{ name: string; input: unknown }> } | { kind: 'text'; text: string };

export type AssistantProvider = (request: AssistantRequest) => Promise<AssistantReply>;

export type DegradeReason =
  | 'NO_AI_PERMISSION'
  | 'NO_TOOL'
  | 'AI_PRICING_NOT_SET'
  | 'AI_PRICING_MODEL_MISMATCH'
  | 'AI_NOT_IN_PLAN'
  | 'AI_NOT_CONFIGURED'
  | 'AI_INPUT_TOO_LARGE'
  | 'AI_BUDGET_REACHED'
  | 'EXTRACTION_IN_PROGRESS'
  | 'LEASE_LOST'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_ERROR'
  | 'AI_REFUSED'
  | 'UNGROUNDED';

/** Thrown by a provider that cannot answer; `ask` turns it into the plain tables with this reason. Never reaches a caller of `ask`. */
export class AssistantDegraded extends Error {
  constructor(readonly reason: DegradeReason) {
    super(reason);
    this.name = 'AssistantDegraded';
  }
}

export const specsOf = (tools: readonly AssistantTool[]): NonNullable<AssistantRequest['tools']> => tools.map((name) => ({ name, ...TOOL_SPECS[name] }));

type Db = Parameters<typeof runAssistantAi>[0];

/**
 * The adapter to a real model, wired through the budget gate. `provider` and `pricing` are injectable (tests pass a scripted
 * `AiProvider`); in production they come from the platform's configuration, and with none configured every call degrades.
 */
export function gatedProvider(db: Db, restaurantId: string, now: Date, opts: Pick<AssistantCallOptions, 'provider' | 'pricing'> = {}): AssistantProvider {
  return async (request) => {
    const result = await runAssistantAi(
      db,
      {
        restaurantId,
        now,
        maxOutputTokens: request.stage === 'choose' ? 400 : Math.min(MAX_TOKENS.ask, 600),
        input: {
          system: request.system,
          messages: [{ role: 'user', content: [{ type: 'text', text: request.user }] }],
          ...(request.tools ? { tools: request.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } : {}),
        },
      },
      opts,
    );
    if (!result.ok) throw new AssistantDegraded(result.code);
    const content = result.response.content;
    const calls = content.flatMap((c) => (c.type === 'tool_use' ? [{ name: c.name, input: c.input }] : []));
    if (request.stage === 'choose') return { kind: 'tools', calls };
    return { kind: 'text', text: content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n').trim() };
  };
}

export type { AiProvider };
