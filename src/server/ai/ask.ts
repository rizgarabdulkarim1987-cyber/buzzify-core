import { z } from 'zod';
import { baghdadDayOf } from '@/lib/baghdad';
import { AI_LOCALES } from '@/server/domain/pos/ai';
import type { PosRole } from '@/server/domain/pos/permissions';
import { dayField } from '@/server/pos/report';
import { AiOutputRejectedError } from './errors';
import { checkGrounding, collectNumbers, extractNumbers, hasAccusation, periodNumbers } from './grounding';
import { requireAi } from './package';
import { systemPrompt } from './prompts';
import { MAX_TOKENS } from './provider/models';
import type { AiContent, AiMessage } from './provider/types';
import { runAi, type AiEnv } from './run';
import { runTool, toolSpecs, type AiToolName } from './tools';
import { untrusted } from './untrusted';
import { getAiUsage } from './usage';

export const MAX_TOOL_ROUNDS = 5;
const MAX_CALLS_PER_ROUND = 4;

export const askInput = z
  .object({
    locale: z.enum(AI_LOCALES),
    question: z.string().trim().min(1).max(1000),
    history: z.array(z.object({ q: z.string().max(1000), a: z.string().max(4000) }).strict()).max(6),
    /** Tests only: the Baghdad day the answer is written on. */
    today: dayField.optional(),
  })
  .strict();

export interface AskSource {
  tool: AiToolName;
  period: { from: string; to: string } | null;
  method: string;
  empty: boolean;
  truncated: boolean;
}

export interface AskAnswer {
  text: string;
  sources: AskSource[];
  used: number;
  limit: number;
}

/**
 * Ask Buzzify AI: the model answers only by calling the read tools it is offered for this role. Each answer carries its
 * sources (tool, period, method) built by code, so the model cannot drop them, and every number in the text must come from a
 * tool result, the period or the question.
 */
export async function askBuzzify(env: AiEnv & { role: PosRole }, rawInput: unknown, now = new Date()): Promise<AskAnswer> {
  const pkg = await requireAi(env.db, env.restaurantId);
  const input = askInput.parse(rawInput);
  const today = input.today ?? baghdadDayOf(now);
  const system = systemPrompt('ask', { locale: input.locale, today });
  const text = (value: string): AiContent[] => [{ type: 'text', text: value }];

  const answer = await runAi(env, {
    feature: 'ASK',
    now,
    work: async (call) => {
      const messages: AiMessage[] = [
        ...input.history.flatMap((turn): AiMessage[] => [
          { role: 'user', content: text(turn.q) },
          { role: 'assistant', content: text(turn.a) },
        ]),
        { role: 'user', content: text(untrusted('question', input.question)) },
      ];
      const sources: AskSource[] = [];
      const allowed = new Set<number>([...periodNumbers(today), ...extractNumbers(input.question)]);
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const res = await call({ purpose: 'ask', system, messages, tools: toolSpecs(env.role), maxTokens: MAX_TOKENS.ask });
        const uses = res.content.flatMap((c) => (c.type === 'tool_use' ? [c] : []));
        if (res.stop !== 'tool_use' || uses.length === 0) {
          const final = res.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n').trim();
          if (final === '' || !checkGrounding(final, allowed).ok || hasAccusation(final)) throw new AiOutputRejectedError();
          return { text: final, sources };
        }
        messages.push({ role: 'assistant', content: res.content });
        const results: AiContent[] = [];
        for (const use of uses.slice(0, MAX_CALLS_PER_ROUND)) {
          try {
            const { output, json } = await runTool(env, use.name, use.input);
            sources.push({ tool: output.method.slice('ai.method.'.length) as AiToolName, period: output.period, method: output.method, empty: output.empty, truncated: output.truncated });
            collectNumbers(output.data, allowed);
            for (const n of periodNumbers(output.period?.from ?? '', output.period?.to ?? '')) allowed.add(n);
            results.push({ type: 'tool_result', toolUseId: use.id, content: json });
          } catch {
            results.push({ type: 'tool_result', toolUseId: use.id, content: 'refused', isError: true });
          }
        }
        for (const use of uses.slice(MAX_CALLS_PER_ROUND)) results.push({ type: 'tool_result', toolUseId: use.id, content: 'refused', isError: true });
        messages.push({ role: 'user', content: results });
      }
      throw new AiOutputRejectedError();
    },
  });
  const usage = await getAiUsage(env.db, env.restaurantId, pkg.monthlyLimit, now);
  return { ...answer, used: usage.used, limit: usage.limit };
}
